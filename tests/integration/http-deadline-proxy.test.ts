import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
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
 * Makes no external call: the target host is `.invalid` and neither proxy ever tunnels. The
 * proxy variables are set only in each child's environment (G119); the cwd is a fresh temp
 * directory so the repo `.env` is never loaded (G26).
 */

const TSX_LOADER = import.meta.resolve('tsx');
const AXIOS_URL = import.meta.resolve('axios');
const DEADLINE_MODULE_URL = new URL('../../src/utils/httpDeadline.ts', import.meta.url).href;

const CASE_TIMEOUT_MS = 15_000;
const CONTROL_WAIT_MS = 1_500;
const TIMEOUT_MS = 500;

interface Proxy {
  readonly server: Server;
  readonly sockets: Set<Socket>;
  connects: number;
  port: number;
}

function startProxy(mode: 'silent' | 'reset'): Promise<Proxy> {
  const sockets = new Set<Socket>();
  const proxy: Proxy = { server: createServer(), sockets, connects: 0, port: 0 };
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
  return new Promise((resolve) => {
    proxy.server.listen(0, '127.0.0.1', () => {
      proxy.port = (proxy.server.address() as AddressInfo).port;
      resolve(proxy);
    });
  });
}

function buildScript(wrapped: boolean, extraConfig: string): string {
  return [
    `import axios from ${JSON.stringify(AXIOS_URL)};`,
    `import { withRequestDeadline } from ${JSON.stringify(DEADLINE_MODULE_URL)};`,
    `const client = axios.create({ timeout: ${TIMEOUT_MS}${wrapped ? ', adapter: withRequestDeadline()' : ''} });`,
    'const start = performance.now();',
    'const report = (code, message) => {',
    '  process.stdout.write(JSON.stringify({ code, message, ms: performance.now() - start }) + "\\n");',
    '};',
    `client.get('https://deadline-test.invalid/', { ${extraConfig} }).then(`,
    '  () => report("RESOLVED", ""),',
    '  (err) => report(err && err.code, err && err.message)',
    ');'
  ].join('\n');
}

interface RunningChild {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdout: () => string;
  readonly exited: Promise<number | null>;
}

const tempDirs: string[] = [];
const liveChildren = new Set<ChildProcessWithoutNullStreams>();

async function run(proxy: Proxy, script: string): Promise<RunningChild> {
  const cwd = await mkdtemp(join(tmpdir(), 'http-deadline-'));
  tempDirs.push(cwd);
  const env: NodeJS.ProcessEnv = { ...process.env };
  const url = `http://127.0.0.1:${proxy.port}`;
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
  child.stderr.on('data', () => undefined);
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      liveChildren.delete(child);
      resolve(code);
    });
  });
  return { child, stdout: () => Buffer.concat(chunks).toString('utf8'), exited };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Outcome {
  code: unknown;
  message: unknown;
  ms: number;
}

function parseOutcome(stdout: string): Outcome {
  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] as string) as Outcome;
}

let silent: Proxy;
let reset: Proxy;

beforeAll(async () => {
  silent = await startProxy('silent');
  reset = await startProxy('reset');
});

afterAll(async () => {
  for (const proxy of [silent, reset]) {
    for (const socket of proxy.sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.server.close(() => resolve()));
  }
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

afterEach(() => {
  for (const child of liveChildren) child.kill('SIGKILL');
  liveChildren.clear();
  silent.connects = 0;
  reset.connects = 0;
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
