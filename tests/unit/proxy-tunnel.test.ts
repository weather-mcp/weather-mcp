import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import type { Duplex } from 'node:stream';
import {
  buildConnectRequest,
  createTunnelAgent,
  parseConnectResponse,
  tunnelProxyFor
} from '../../src/utils/proxyTunnel.js';

/**
 * The tunnel agent's pure contract (design plan `plan-proxy-socket-release`): proxy selection by
 * the same `proxy-from-env` function axios calls, the CONNECT bytes, the answer parser, and the
 * pre-socket paths of `createConnection`. Runs under tests/setup/no-network.ts: every socket row
 * here is refused by the guard or dialled through a spy, never opened. The socket rows that need a
 * real proxy are in tests/integration/http-deadline-proxy.test.ts.
 */

const PROXY_VARS = [
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
  'HTTP_PROXY',
  'http_proxy'
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const name of PROXY_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of PROXY_VARS) {
    const value = savedEnv[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  vi.restoreAllMocks();
});

type Settled = { err: (Error & { code?: string }) | null; stream?: Duplex };

/** A `createConnection` callback that resolves with what it was given. */
function capture(): { cb: (err: Error | null, stream?: Duplex) => void; settled: Promise<Settled> } {
  let resolve!: (value: Settled) => void;
  const settled = new Promise<Settled>((r) => {
    resolve = r;
  });
  return { cb: (err, stream) => resolve({ err, stream }), settled };
}

/** A stand-in proxy socket: an emitter with the methods the agent calls, and a read queue. */
class StubSocket extends EventEmitter {
  written: string[] = [];
  destroyed = false;
  private queue: Buffer[] = [];
  write(data: string): boolean {
    this.written.push(data);
    return true;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
  read(): Buffer | null {
    return this.queue.shift() ?? null;
  }
  unshift(): void {}
  feed(text: string): void {
    this.queue.push(Buffer.from(text, 'latin1'));
    this.emit('readable');
  }
}

const TARGETS = [
  'https://api.weather.gov/x',
  'https://api.open-meteo.com/x',
  'https://aviationweather.gov/x',
  'https://127.0.0.1:8443/x'
];

describe('(a) tunnelProxyFor selects as axios does', () => {
  it.each(TARGETS)('%s: HTTPS_PROXY alone selects the proxy', (target) => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
    expect(tunnelProxyFor(target)?.href).toBe('http://127.0.0.1:3128/');
  });

  it.each(TARGETS)('%s: NO_PROXY naming the host bypasses', (target) => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
    process.env.NO_PROXY = new URL(target).hostname;
    expect(tunnelProxyFor(target)).toBeUndefined();
  });

  it.each(TARGETS)('%s: NO_PROXY=* bypasses', (target) => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
    process.env.NO_PROXY = '*';
    expect(tunnelProxyFor(target)).toBeUndefined();
  });

  it.each(TARGETS)('%s: no proxy variable selects nothing', (target) => {
    expect(tunnelProxyFor(target)).toBeUndefined();
  });

  it('an http: target with only HTTPS_PROXY set selects nothing', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
    expect(tunnelProxyFor('http://api.weather.gov/x')).toBeUndefined();
  });

  it('a proxy value that is not a URL selects nothing and does not throw', () => {
    process.env.HTTPS_PROXY = 'not a url';
    expect(() => tunnelProxyFor('https://api.weather.gov/x')).not.toThrow();
    expect(tunnelProxyFor('https://api.weather.gov/x')).toBeUndefined();
  });
});

describe('(b) buildConnectRequest', () => {
  it('a plain proxy', () => {
    expect(buildConnectRequest('api.weather.gov', 443, new URL('http://proxy.invalid:3128'))).toBe(
      'CONNECT api.weather.gov:443 HTTP/1.1\r\nHost: api.weather.gov:443\r\nConnection: close\r\n\r\n'
    );
  });

  it('percent-encoded userinfo is decoded into Proxy-Authorization', () => {
    const request = buildConnectRequest('h.invalid', 443, new URL('http://user:p%40ss@proxy.invalid/'));
    expect(request).toContain('Proxy-Authorization: Basic dXNlcjpwQHNz\r\n');
  });

  it('a malformed escape goes out literally and does not throw', () => {
    let request = '';
    expect(() => {
      request = buildConnectRequest('h.invalid', 443, new URL('http://u:p%ZZ@proxy.invalid/'));
    }).not.toThrow();
    expect(request).toContain('Proxy-Authorization: Basic dTpwJVpa\r\n');
  });

  it('an IPv6 origin is bracketed', () => {
    expect(buildConnectRequest('::1', 443, new URL('http://proxy.invalid/'))).toMatch(
      /^CONNECT \[::1\]:443 HTTP\/1\.1\r\nHost: \[::1\]:443\r\n/
    );
  });

  it('no Proxy-Authorization line without userinfo', () => {
    expect(buildConnectRequest('h.invalid', 443, new URL('http://proxy.invalid/'))).not.toContain(
      'Proxy-Authorization'
    );
  });
});

describe('(c) parseConnectResponse', () => {
  it('incomplete → undefined', () => {
    expect(parseConnectResponse(Buffer.from('HTTP/1.1 200 Connection established\r\n'))).toBeUndefined();
  });

  it('200 → status and the offset past the blank line', () => {
    const text = 'HTTP/1.1 200 Connection established\r\n\r\n';
    expect(parseConnectResponse(Buffer.from(text))).toEqual({ statusCode: 200, headerEnd: text.length });
  });

  it('407 with headers → 407, headerEnd past the blank line', () => {
    const head = 'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="t"\r\n\r\n';
    expect(parseConnectResponse(Buffer.from(head + 'body'))).toEqual({
      statusCode: 407,
      headerEnd: head.length
    });
  });

  it('a garbage first line → statusCode 0', () => {
    expect(parseConnectResponse(Buffer.from('SSH-2.0-OpenSSH\r\n\r\n'))?.statusCode).toBe(0);
  });

  it('70 KiB with no terminator → statusCode 0 (a reset)', () => {
    expect(parseConnectResponse(Buffer.alloc(70 * 1024, 'a'))?.statusCode).toBe(0);
  });
});

describe('(d) createConnection with an already-aborted signal', () => {
  it('fails ECONNABORTED without dialling, naming nothing about the proxy', async () => {
    const dial = vi.spyOn(net, 'connect');
    const controller = new AbortController();
    controller.abort();
    const agent = createTunnelAgent(new URL('http://u:s3kr1t@127.0.0.1:3128'), controller.signal);
    const { cb, settled } = capture();
    agent.createConnection({ host: 'origin.invalid', port: 443, servername: 'origin.invalid' }, cb);
    const { err } = await settled;
    expect(err?.code).toBe('ECONNABORTED');
    expect(err?.message).not.toMatch(/s3kr1t|127\.0\.0\.1|3128/);
    expect(dial).not.toHaveBeenCalled();
  });
});

describe('(e) a connect failure passes through', () => {
  it('the guard refusal reaches the callback with its own code', async () => {
    const agent = createTunnelAgent(new URL('http://u:s3kr1t@127.0.0.1:1/'), new AbortController().signal);
    const { cb, settled } = capture();
    agent.createConnection({ host: 'origin.invalid', port: 443, servername: 'origin.invalid' }, cb);
    const { err } = await settled;
    expect(err?.code).toBe('EUNITNET');
    expect(err?.message).not.toMatch(/s3kr1t|127\.0\.0\.1/);
  });

  // Node's dial error names the endpoint (`connect EACCES proxy.private:3128`); only its code may cross.
  for (const scheme of ['http', 'https'] as const) {
    it(`${scheme}: proxy → the code survives, the host, port and userinfo do not`, async () => {
      const proxySocket = new StubSocket();
      if (scheme === 'https') {
        vi.spyOn(tls, 'connect').mockImplementation(() => proxySocket as unknown as tls.TLSSocket);
      } else {
        vi.spyOn(net, 'connect').mockImplementation(() => proxySocket as unknown as net.Socket);
      }
      const agent = createTunnelAgent(
        new URL(`${scheme}://pxuser:s3kr1t@proxy.private:3128`),
        new AbortController().signal
      );
      const { cb, settled } = capture();
      agent.createConnection({ host: 'origin.invalid', port: 443, servername: 'origin.invalid' }, cb);
      proxySocket.emit(
        'error',
        Object.assign(new Error('connect EACCES proxy.private:3128 pxuser:s3kr1t'), { code: 'EACCES' })
      );
      const { err } = await settled;
      expect(err?.code).toBe('EACCES');
      expect(err?.message).toBe('proxy connection failed');
      expect(err).not.toHaveProperty('cause');
      expect(proxySocket.destroyed).toBe(true);
    });
  }
});

describe('(f) the module logs nothing', () => {
  it('imports no logger and writes no console', () => {
    const source = readFileSync(new URL('../../src/utils/proxyTunnel.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('logger');
    expect(source).not.toContain('console.');
  });
});

describe('(g) an IPv6 proxy is dialled by its bare address', () => {
  it('http: proxy → net.connect host ::1, port 3128', () => {
    const dial = vi.spyOn(net, 'connect').mockImplementation(() => new StubSocket() as unknown as net.Socket);
    const agent = createTunnelAgent(new URL('http://[::1]:3128'), new AbortController().signal);
    agent.createConnection({ host: 'origin.invalid', port: 443 }, () => undefined);
    expect(dial).toHaveBeenCalledTimes(1);
    expect(dial.mock.calls[0]?.[0]).toMatchObject({ host: '::1', port: 3128 });
  });

  it('https: proxy → tls.connect host ::1, port 3128, no IP servername', () => {
    const dial = vi.spyOn(tls, 'connect').mockImplementation(() => new StubSocket() as unknown as tls.TLSSocket);
    const agent = createTunnelAgent(new URL('https://[::1]:3128'), new AbortController().signal);
    agent.createConnection({ host: 'origin.invalid', port: 443 }, () => undefined);
    expect(dial).toHaveBeenCalledTimes(1);
    const options = dial.mock.calls[0]?.[0] as tls.ConnectionOptions;
    expect(options).toMatchObject({ host: '::1', port: 3128 });
    // RFC 6066 forbids an IP SNI (Node's DEP0123); identity is checked against `host`.
    expect(options.servername).toBeUndefined();
  });
});

describe('(h) the origin TLS servername falls back on an empty value', () => {
  it('an IP origin with servername "" is upgraded with the origin IP, over the proxy socket', async () => {
    const proxySocket = new StubSocket();
    vi.spyOn(net, 'connect').mockImplementation(() => proxySocket as unknown as net.Socket);
    const upgraded = new StubSocket();
    const upgrade = vi.spyOn(tls, 'connect').mockImplementation(() => upgraded as unknown as tls.TLSSocket);
    const agent = createTunnelAgent(
      new URL('http://proxy.example.invalid:3128'),
      new AbortController().signal
    );
    const { cb, settled } = capture();
    agent.createConnection({ host: '203.0.113.5', port: 443, servername: '' } as never, cb);
    proxySocket.emit('connect');
    expect(proxySocket.written[0]).toMatch(/^CONNECT 203\.0\.113\.5:443 HTTP\/1\.1\r\n/);
    proxySocket.feed('HTTP/1.1 200 Connection established\r\n\r\n');
    const { err, stream } = await settled;
    expect(err).toBeNull();
    expect(stream).toBe(upgraded);
    const options = upgrade.mock.calls[0]?.[0] as tls.ConnectionOptions;
    expect(options.servername).toBe('203.0.113.5');
    expect(options.socket).toBe(proxySocket);
    expect(options).not.toHaveProperty('host');
  });
});
