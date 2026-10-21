/**
 * A per-request CONNECT tunnel agent that the request deadline can cancel.
 *
 * Lifecycle contract (design plan `plan-proxy-socket-release`):
 * - The cancel hook is the deadline's own `AbortSignal`, handed to an agent built for that one
 *   request — not the request. Node emits no event (`close`, `error`, `abort`, `socket`) on an
 *   `http.ClientRequest` destroyed before it is assigned a socket, so an agent that listens to
 *   the request never learns that the CONNECT it is waiting on is no longer wanted. Measured: that
 *   agent, axios's bundled https-proxy-agent 5, https-proxy-agent 9 and Node's native env proxy
 *   all leave the proxy socket open behind a proxy that never answers.
 * - `createConnection` settles through its callback (the agent-base 7 shape): Node's
 *   `Agent.createSocket` accepts a returned socket or the callback, so its request bookkeeping is
 *   unchanged. Every path settles the callback exactly once.
 * - A 200 answer is upgraded to TLS to the origin, as https-proxy-agent 5 does
 *   (`dist/agent.js:118-128`). Any other answer is replayed to the request as that HTTP response,
 *   on a fake socket, after the proxy socket is destroyed — hpa 5's replay (`agent.js:130-152`),
 *   so a 407 reaches every service's error mapper as `response.status` 407, and no origin request
 *   byte reaches the proxy. A proxy that closes before answering is `ECONNRESET`; a socket error
 *   keeps its own code (G138) under a fixed message, because Node's names the proxy endpoint.
 * - No pooling: `keepAlive: false`. The tunnel it replaces sent `Connection: close` too.
 * - It logs nothing and never stringifies the proxy URL, which can carry credentials. No error it
 *   produces names the proxy host, port or userinfo.
 *
 * Node 18 compatible: no `AbortSignal.any`, no `AbortSignal.timeout`.
 */

import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import type { ClientRequest } from 'node:http';
import type { Duplex } from 'node:stream';
import { getProxyForUrl } from 'proxy-from-env';

/** A CONNECT answer whose header block has not ended by this many bytes is treated as a reset. */
const MAX_CONNECT_RESPONSE_BYTES = 64 * 1024;

const HEADER_TERMINATOR = '\r\n\r\n';

type ConnectionCallback = (err: Error | null, stream: Duplex) => void;

/**
 * The proxy axios would use for `url`, from the same `proxy-from-env` function axios calls
 * (`HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, either case). `undefined` for no proxy, or for a proxy
 * value that is not a URL.
 */
export function tunnelProxyFor(url: string): URL | undefined {
  const raw = getProxyForUrl(url);
  if (!raw) {
    return undefined;
  }
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

/** Percent-decode URL userinfo; a malformed escape (`%ZZ`) goes out literally instead of throwing. */
function decodeUserinfo(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The CONNECT request for `host:port`, with `Proxy-Authorization` when the proxy URL has userinfo. */
export function buildConnectRequest(host: string, port: number, proxy: URL): string {
  const authority = `${net.isIPv6(host) ? `[${host}]` : host}:${port}`;
  let request = `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n`;
  if (proxy.username || proxy.password) {
    const credentials = `${decodeUserinfo(proxy.username)}:${decodeUserinfo(proxy.password)}`;
    request += `Proxy-Authorization: Basic ${Buffer.from(credentials).toString('base64')}\r\n`;
  }
  return request + '\r\n';
}

/**
 * The proxy's answer, once its header block is complete: the status code and the byte offset just
 * past the blank line. `undefined` while incomplete. A first line that is not `HTTP/`, or a header
 * block past 64 KiB, is `statusCode: 0` — the caller treats it as a reset.
 */
export function parseConnectResponse(
  buffered: Buffer
): { statusCode: number; headerEnd: number } | undefined {
  const end = buffered.indexOf(HEADER_TERMINATOR);
  if (end === -1) {
    if (buffered.length > MAX_CONNECT_RESPONSE_BYTES) {
      return { statusCode: 0, headerEnd: buffered.length };
    }
    return undefined;
  }
  const headerEnd = end + HEADER_TERMINATOR.length;
  const firstLine = buffered.subarray(0, buffered.indexOf('\r\n')).toString('latin1');
  const match = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(firstLine);
  return { statusCode: match ? Number(match[1]) : 0, headerEnd };
}

function abortError(): Error {
  return Object.assign(new Error('proxy CONNECT aborted'), { code: 'ECONNABORTED' });
}

function resetError(message: string): Error {
  return Object.assign(new Error(message), { code: 'ECONNRESET' });
}

/** Node's `Agent.prototype.addRequest`, which `@types/node` does not declare. */
type AddRequest = (this: https.Agent, req: ClientRequest, ...rest: unknown[]) => void;

class TunnelAgent extends https.Agent {
  private request: ClientRequest | undefined;

  constructor(
    private readonly proxy: URL,
    private readonly signal: AbortSignal
  ) {
    super({ keepAlive: false, maxSockets: Infinity });
  }

  /** Stash the request: a non-200 answer is replayed onto it, and `createConnection` never sees it. */
  addRequest(req: ClientRequest, ...rest: unknown[]): void {
    this.request = req;
    (https.Agent.prototype as unknown as { addRequest: AddRequest }).addRequest.call(
      this,
      req,
      ...rest
    );
  }

  createConnection(options: https.RequestOptions, callback?: ConnectionCallback): undefined {
    // Node's callback reads the stream only when `err` is null.
    const settle = (err: Error | null, stream?: Duplex): void => {
      callback?.(err, stream as Duplex);
    };
    const { proxy, signal } = this;
    const req = this.request;
    const originHost = options.host ?? 'localhost';
    const originPort = Number(options.port ?? 443);

    if (signal.aborted) {
      settle(abortError());
      return undefined;
    }

    // URL.hostname keeps IPv6 brackets (G109); a socket dial needs the bare address.
    const proxyHost = proxy.hostname.replace(/^\[|\]$/g, '');
    const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));
    const secureProxy = proxy.protocol === 'https:';
    const socket: net.Socket = secureProxy
      ? tls.connect({
          host: proxyHost,
          port: proxyPort,
          servername: net.isIP(proxyHost) ? undefined : proxyHost
        })
      : net.connect({ host: proxyHost, port: proxyPort });

    let done = false;
    let buffered = Buffer.alloc(0);

    const detach = (): void => {
      signal.removeEventListener('abort', onAbort);
      socket.removeListener('readable', onReadable);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      socket.removeListener('end', onClose);
      socket.removeListener(secureProxy ? 'secureConnect' : 'connect', onConnect);
    };

    const fail = (err: Error): void => {
      if (done) return;
      done = true;
      detach();
      // A late error from the destroyed socket must not become an uncaught exception.
      socket.on('error', () => undefined);
      socket.destroy();
      settle(err);
    };

    // Attached in the same synchronous run as the dial (G20): an abort during connect setup lands.
    function onAbort(): void {
      fail(abortError());
    }

    // Node's dial error names the proxy host and port: keep its code (G138), never its message.
    function onError(err: Error): void {
      fail(Object.assign(new Error('proxy connection failed'), { code: (err as NodeJS.ErrnoException).code }));
    }

    function onClose(): void {
      fail(resetError('proxy closed before answering CONNECT'));
    }

    function onConnect(): void {
      socket.write(buildConnectRequest(originHost, originPort, proxy));
    }

    function onReadable(): void {
      let chunk: Buffer | null;
      while ((chunk = socket.read() as Buffer | null) !== null) {
        buffered = Buffer.concat([buffered, chunk]);
      }
      const answer = parseConnectResponse(buffered);
      if (answer === undefined || done) {
        return;
      }
      if (answer.statusCode === 0) {
        fail(resetError('proxy sent an unreadable CONNECT answer'));
        return;
      }
      done = true;
      detach();

      if (answer.statusCode === 200) {
        // The request owns the socket from here, and axios's own abort path destroys it.
        const rest = buffered.subarray(answer.headerEnd);
        if (rest.length > 0) {
          socket.unshift(rest);
        }
        // Every caller TLS option rides through; the origin's address is the tunnel, not a dial.
        const tlsOptions: Record<string, unknown> = { ...options };
        for (const key of ['host', 'hostname', 'path', 'port']) {
          delete tlsOptions[key];
        }
        // Truthy fallback, as hpa 5 (`agent.js:124`): Node sets servername '' for an IP origin,
        // and an empty name would let TLS identity fall through to the proxy's host.
        const servername = (options as { servername?: string }).servername || originHost;
        settle(null, tls.connect({ ...(tlsOptions as tls.ConnectionOptions), socket, servername }));
        return;
      }

      // Any other answer: destroy the proxy socket before a request byte is written, then replay
      // the proxy's own response to the request so its status reaches axios.
      socket.on('error', () => undefined);
      socket.destroy();
      if (req === undefined) {
        settle(resetError('proxy refused CONNECT'));
        return;
      }
      const response = buffered;
      const fake = new net.Socket({ writable: false });
      fake.readable = true;
      req.once('socket', (s: net.Socket) => {
        s.push(response);
        s.push(null);
      });
      settle(null, fake);
    }

    signal.addEventListener('abort', onAbort, { once: true });
    socket.on('error', onError);
    socket.on('close', onClose);
    socket.on('end', onClose);
    socket.on(secureProxy ? 'secureConnect' : 'connect', onConnect);
    socket.on('readable', onReadable);
    return undefined;
  }
}

/**
 * An agent for one request that tunnels through `proxy`, and destroys its pending proxy socket
 * when `signal` aborts.
 */
export function createTunnelAgent(proxy: URL, signal: AbortSignal): https.Agent {
  return new TunnelAgent(proxy, signal);
}
