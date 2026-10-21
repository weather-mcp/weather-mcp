import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { connect, createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Proves the wall-clock request deadline (`src/utils/httpDeadline.ts`) against a proxy that
 * accepts the TCP connection and then never answers the CONNECT ("silent") or resets it
 * ("reset"). Every row runs in a child process so that exit behaviour is observable.
 *
 * Behind the silent proxy the wrapper rejects on time and the child exits: the wrapped client
 * tunnels through a per-request agent (src/utils/proxyTunnel.ts) hooked on the deadline's signal,
 * which destroys the pending CONNECT socket. The unwrapped client still tunnels through axios's
 * bundled https-proxy-agent, which has no cancel hook (the positive control).
 *
 * The tunnel rows prove a working proxy still tunnels, over a plain and an `https:` proxy, with
 * credentials, and that a proxy's 407 still reaches axios as `response.status` 407. They tunnel
 * to a loopback TLS origin whose self-signed certificate (`tests/fixtures/tls/`) the child trusts
 * through `NODE_EXTRA_CA_CERTS`.
 *
 * Makes no external call: every target is `.invalid` or a loopback origin, and every tunnel ends
 * at that origin. The proxy variables are set only in each child's environment (G119); the cwd is
 * a fresh temp directory so the repo `.env` is never loaded (G26).
 */

const TSX_LOADER = import.meta.resolve('tsx');
const AXIOS_URL = import.meta.resolve('axios');
const DEADLINE_MODULE_URL = new URL('../../src/utils/httpDeadline.ts', import.meta.url).href;

const CASE_TIMEOUT_MS = 15_000;
const CONTROL_WAIT_MS = 1_500;
const TIMEOUT_MS = 500;
const TUNNEL_TIMEOUT_MS = 8_000;

const TLS_CERT_PATH = fileURLToPath(new URL('../fixtures/tls/localhost.crt', import.meta.url));
const TLS_CERT = readFileSync(TLS_CERT_PATH);
const TLS_KEY = readFileSync(new URL('../fixtures/tls/localhost.key', import.meta.url));

interface Proxy {
  readonly server: Server;
  readonly sockets: Set<Socket>;
  connects: number;
  port: number;
  /** The last CONNECT request's headers, lower-cased names (tunnel and refuse modes). */
  lastHeaders: Record<string, string>;
}

type ProxyMode = 'silent' | 'reset' | 'tunnel' | 'refuse';

/** CONNECT header lines after the request line, as a lower-cased name → value map. */
function parseHeaders(head: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of head.split('\r\n').slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

/**
 * 'silent' accepts the CONNECT and never answers; 'reset' resets it. 'tunnel' answers 200 and
 * pipes to the loopback origin at `originPort`; 'refuse' answers 407. `tls` serves the proxy itself
 * over TLS, from the fixture.
 */
function startProxy(mode: ProxyMode, options: { tls?: boolean; originPort?: number } = {}): Promise<Proxy> {
  const sockets = new Set<Socket>();
  const server = options.tls ? createTlsServer({ cert: TLS_CERT, key: TLS_KEY }) : createServer();
  const proxy: Proxy = { server, sockets, connects: 0, port: 0, lastHeaders: {} };
  if (mode === 'tunnel' || mode === 'refuse') {
    proxy.server.on(options.tls ? 'secureConnection' : 'connection', (socket: Socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
      let buffered = Buffer.alloc(0);
      const onData = (chunk: Buffer): void => {
        buffered = Buffer.concat([buffered, chunk]);
        const end = buffered.indexOf('\r\n\r\n');
        if (end === -1) return;
        socket.removeListener('data', onData);
        proxy.connects += 1;
        proxy.lastHeaders = parseHeaders(buffered.subarray(0, end).toString('latin1'));
        if (mode === 'refuse') {
          socket.end(
            'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\n' +
              'Content-Length: 0\r\nConnection: close\r\n\r\n'
          );
          return;
        }
        const upstream = connect({ host: '127.0.0.1', port: options.originPort ?? 0 }, () => {
          socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
          const rest = buffered.subarray(end + 4);
          if (rest.length > 0) upstream.write(rest);
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        upstream.on('error', () => socket.destroy());
        upstream.on('close', () => socket.destroy());
        socket.on('close', () => upstream.destroy());
      };
      socket.on('data', onData);
    });
    return listen(proxy);
  }
  proxy.server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    let buffered = '';
    let seen = false;
    socket.on('data', (chunk: Buffer) => {
      if (seen) return;
      buffered += chunk.toString('latin1');
      if (!/^CONNECT /.test(buffered) || !buffered.includes('\r\n')) return;
      seen = true;
      proxy.connects += 1;
      if (mode === 'reset') socket.resetAndDestroy();
    });
  });
  return listen(proxy);
}

function listen(proxy: Proxy): Promise<Proxy> {
  return new Promise((resolve) => {
    proxy.server.listen(0, '127.0.0.1', () => {
      proxy.port = (proxy.server.address() as AddressInfo).port;
      resolve(proxy);
    });
  });
}

interface Origin {
  readonly server: ReturnType<typeof createHttpsServer>;
  requests: number;
  port: number;
}

/** A loopback TLS origin that answers every request 200 with a small JSON body. */
function startOrigin(): Promise<Origin> {
  const origin: Origin = {
    server: createHttpsServer({ cert: TLS_CERT, key: TLS_KEY }, (_req, res) => {
      origin.requests += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    }),
    requests: 0,
    port: 0
  };
  return new Promise((resolve) => {
    origin.server.listen(0, '127.0.0.1', () => {
      origin.port = (origin.server.address() as AddressInfo).port;
      resolve(origin);
    });
  });
}

function buildScript(
  wrapped: boolean,
  extraConfig: string,
  target = 'https://deadline-test.invalid/',
  timeout = TIMEOUT_MS
): string {
  return [
    `import axios from ${JSON.stringify(AXIOS_URL)};`,
    `import { withRequestDeadline } from ${JSON.stringify(DEADLINE_MODULE_URL)};`,
    `const client = axios.create({ timeout: ${timeout}${wrapped ? ', adapter: withRequestDeadline()' : ''} });`,
    'const start = performance.now();',
    'const report = (code, message, status) => {',
    '  process.stdout.write(JSON.stringify({ code, message, status, ms: performance.now() - start }) + "\\n");',
    '};',
    `client.get(${JSON.stringify(target)}, { ${extraConfig} }).then(`,
    '  (res) => report("RESOLVED", "", res.status),',
    '  (err) => report(err && err.code, err && err.message, err && err.response && err.response.status)',
    ');'
  ].join('\n');
}

interface RunningChild {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<number | null>;
}

const tempDirs: string[] = [];
const liveChildren = new Set<ChildProcessWithoutNullStreams>();

interface RunOptions {
  /** The child's proxy URL, for userinfo or an `https:` proxy. Default: plain http to `proxy`. */
  readonly proxyUrl?: string;
  readonly extraEnv?: NodeJS.ProcessEnv;
}

async function run(proxy: Proxy, script: string, options: RunOptions = {}): Promise<RunningChild> {
  const cwd = await mkdtemp(join(tmpdir(), 'http-deadline-'));
  tempDirs.push(cwd);
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.extraEnv };
  const url = options.proxyUrl ?? `http://127.0.0.1:${proxy.port}`;
  env.HTTPS_PROXY = url;
  env.https_proxy = url;
  for (const key of ['NO_PROXY', 'no_proxy', 'HTTP_PROXY', 'http_proxy', 'NODE_USE_ENV_PROXY']) {
    delete env[key];
  }
  const child = spawn(process.execPath, ['--import', TSX_LOADER, '--input-type=module', '-e', script], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  liveChildren.add(child);
  const chunks: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => chunks.push(c));
  const errChunks: Buffer[] = [];
  child.stderr.on('data', (c: Buffer) => errChunks.push(c));
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      liveChildren.delete(child);
      resolve(code);
    });
  });
  return {
    child,
    stdout: () => Buffer.concat(chunks).toString('utf8'),
    stderr: () => Buffer.concat(errChunks).toString('utf8'),
    exited
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Outcome {
  code: unknown;
  message: unknown;
  status?: number;
  ms: number;
}

function parseOutcome(stdout: string): Outcome {
  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] as string) as Outcome;
}

let silent: Proxy;
let reset: Proxy;
let origin: Origin;
let tunnel: Proxy;
let tlsTunnel: Proxy;
let refuse: Proxy;

beforeAll(async () => {
  silent = await startProxy('silent');
  reset = await startProxy('reset');
  origin = await startOrigin();
  tunnel = await startProxy('tunnel', { originPort: origin.port });
  tlsTunnel = await startProxy('tunnel', { originPort: origin.port, tls: true });
  refuse = await startProxy('refuse');
});

afterAll(async () => {
  for (const proxy of [silent, reset, tunnel, tlsTunnel, refuse]) {
    for (const socket of proxy.sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.server.close(() => resolve()));
  }
  origin.server.closeAllConnections();
  await new Promise<void>((resolve) => origin.server.close(() => resolve()));
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

afterEach(() => {
  for (const child of liveChildren) child.kill('SIGKILL');
  liveChildren.clear();
  for (const proxy of [silent, reset, tunnel, tlsTunnel, refuse]) proxy.connects = 0;
  origin.requests = 0;
});

async function waitForLine(running: RunningChild, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (running.stdout().includes('\n')) return;
    await sleep(25);
  }
}

describe('positive control: the unwrapped client never settles behind a silent proxy', () => {
  it(
    'is still alive with empty stdout after the CONNECT',
    async () => {
      const running = await run(silent, buildScript(false, ''));
      await sleep(CONTROL_WAIT_MS);
      expect(running.child.exitCode).toBeNull();
      expect(running.stdout()).toBe('');
      expect(silent.connects).toBe(1);
      running.child.kill('SIGKILL');
      await running.exited;
    },
    CASE_TIMEOUT_MS
  );
});

describe('silent proxy', () => {
  it(
    'wrapped: rejects with the axios timeout vocabulary at the deadline',
    async () => {
      const running = await run(silent, buildScript(true, ''));
      await waitForLine(running, 5_000);
      const outcome = parseOutcome(running.stdout());
      expect(outcome.code).toBe('ECONNABORTED');
      expect(outcome.message).toBe(`timeout of ${TIMEOUT_MS}ms exceeded`);
      expect(outcome.ms).toBeGreaterThanOrEqual(TIMEOUT_MS);
      expect(outcome.ms).toBeLessThan(700);
      expect(silent.connects).toBe(1);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'the child exits 0 after the deadline, and the proxy sees its socket close',
    async () => {
      // G150's successor Verify: the deadline's signal reaches a per-request tunnel agent
      // (src/utils/proxyTunnel.ts) that destroys the pending CONNECT socket, so nothing holds the
      // process once the request has settled. A RED row means the deadline no longer reaches the
      // agent — the socket leaks again, one per timed-out request in a long-lived server.
      const running = await run(silent, buildScript(true, ''));
      await waitForLine(running, 5_000);
      expect(running.stdout()).toContain('ECONNABORTED');
      const code = await running.exited;
      expect(code).toBe(0);
      expect(silent.sockets.size).toBe(0);
    },
    CASE_TIMEOUT_MS
  );
});

describe('resetting proxy: the client settles by itself and the wrapper passes it through', () => {
  const rows: Array<[string, boolean, string]> = [
    ['unwrapped', false, ''],
    ['wrapped', true, ''],
    ['wrapped, maxRedirects 0 (native transport)', true, 'maxRedirects: 0']
  ];

  it.each(rows)(
    '%s: ECONNRESET within 200 ms, exit 0',
    async (_name, wrapped, extra) => {
      const running = await run(reset, buildScript(wrapped, extra));
      const code = await running.exited;
      const outcome = parseOutcome(running.stdout());
      expect(outcome.code).toBe('ECONNRESET');
      expect(outcome.ms).toBeLessThan(200);
      expect(code).toBe(0);
      expect(reset.connects).toBe(1);
    },
    CASE_TIMEOUT_MS
  );
});

describe('a working proxy still tunnels, and a refusal keeps its status', () => {
  const trustFixture = { NODE_EXTRA_CA_CERTS: TLS_CERT_PATH };
  const target = (): string => `https://127.0.0.1:${origin.port}/`;

  it(
    'tunnel, plain proxy: 200 from the origin, exit 0',
    async () => {
      const running = await run(tunnel, buildScript(true, '', target(), TUNNEL_TIMEOUT_MS), {
        extraEnv: trustFixture
      });
      const code = await running.exited;
      const outcome = parseOutcome(running.stdout());
      expect(outcome.code).toBe('RESOLVED');
      expect(outcome.status).toBe(200);
      expect(code).toBe(0);
      expect(tunnel.connects).toBe(1);
      expect(origin.requests).toBe(1);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'tunnel, https: proxy: 200 from the origin, exit 0',
    async () => {
      const running = await run(tlsTunnel, buildScript(true, '', target(), TUNNEL_TIMEOUT_MS), {
        proxyUrl: `https://127.0.0.1:${tlsTunnel.port}`,
        extraEnv: trustFixture
      });
      const code = await running.exited;
      const outcome = parseOutcome(running.stdout());
      expect(outcome.code).toBe('RESOLVED');
      expect(outcome.status).toBe(200);
      expect(code).toBe(0);
      expect(tlsTunnel.connects).toBe(1);
      expect(origin.requests).toBe(1);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'credentials: Proxy-Authorization on the CONNECT, and the password in no output',
    async () => {
      const running = await run(tunnel, buildScript(true, '', target(), TUNNEL_TIMEOUT_MS), {
        proxyUrl: `http://user:p%40ss@127.0.0.1:${tunnel.port}`,
        extraEnv: trustFixture
      });
      const code = await running.exited;
      const outcome = parseOutcome(running.stdout());
      expect(outcome.code).toBe('RESOLVED');
      expect(outcome.status).toBe(200);
      expect(code).toBe(0);
      expect(tunnel.lastHeaders['proxy-authorization']).toBe('Basic dXNlcjpwQHNz');
      for (const output of [running.stdout(), running.stderr()]) {
        expect(output).not.toContain('p%40ss');
        expect(output).not.toContain('p@ss');
      }
    },
    CASE_TIMEOUT_MS
  );

  it(
    '407: ERR_BAD_REQUEST with response.status 407, exit 0',
    async () => {
      const running = await run(refuse, buildScript(true, '', target(), TUNNEL_TIMEOUT_MS), {
        extraEnv: trustFixture
      });
      const code = await running.exited;
      const outcome = parseOutcome(running.stdout());
      expect(outcome.code).toBe('ERR_BAD_REQUEST');
      expect(outcome.status).toBe(407);
      expect(code).toBe(0);
      expect(refuse.connects).toBe(1);
      expect(origin.requests).toBe(0);
    },
    CASE_TIMEOUT_MS
  );
});
