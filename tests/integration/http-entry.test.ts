/**
 * Subprocess contracts for the HTTP entry (`src/http.ts`).
 *
 * The entry is spawned from source (never imported — G61: an import runs `main()`).
 * The issuer is a loopback server in this process, so nothing leaves the machine
 * and the file also passes under a dead proxy with NO_PROXY set (G119).
 *
 * Rows, from the plan (T8):
 *   1. a refusal exits non-zero with its fixed reason and never binds the port
 *   2. stdin at EOF at boot does not stop the server
 *   3. SIGTERM with a request half-sent still exits, bounded
 *   4. SIGINT idle exits 0
 *   5. nothing identifying reaches stderr, at LOG_LEVEL=0 and LOG_PII=true
 *
 * Stdout must stay empty in every row.
 */

import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createConnection, createServer as createNetServer, type AddressInfo } from 'node:net';
import { SHUTDOWN_DEADLINE_MS } from '../../src/server/shutdown.js';
import {
  ERR_ISSUER_REQUIRED,
  ERR_PORT,
  ERR_PUBLIC_URL_HTTPS,
  ERR_PUBLIC_URL_REQUIRED
} from '../../src/config/http.js';
import {
  ERR_DISCOVERY_ISSUER_MISMATCH,
  ERR_DISCOVERY_UNREADABLE
} from '../../src/server/oauthDiscovery.js';
import {
  createTestIssuer,
  startIssuerServer,
  type IssuerServer,
  type IssuerServerOptions,
  type TestIssuer
} from '../helpers/oauthTestIssuer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY_PATH = join(__dirname, '../../src/http.ts');
// Resolved from this file: the child's cwd is a temp directory outside the repo (G26).
const TSX_LOADER = import.meta.resolve('tsx');

const READY_LINE = 'Weather MCP HTTP server listening';
const READY_TIMEOUT_MS = 20_000;
const EXIT_TIMEOUT_MS = SHUTDOWN_DEADLINE_MS + 3_000;
const CASE_TIMEOUT_MS = 40_000;
const MCP_HEADERS = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-entry-test', version: '1' } }
};

interface ParsedLogLine {
  message?: string;
  level?: string;
  metadata?: Record<string, unknown>;
}

interface Entry {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

let issuer: TestIssuer;
const liveChildren = new Set<ChildProcess>();
const liveIssuers: IssuerServer[] = [];
const tempDirs: string[] = [];

beforeAll(async () => {
  issuer = await createTestIssuer();
});

afterEach(async () => {
  for (const child of liveChildren) child.kill('SIGKILL');
  liveChildren.clear();
  for (const srv of liveIssuers.splice(0)) await srv.close();
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

afterAll(() => {
  for (const child of liveChildren) child.kill('SIGKILL');
});

/** Bind port 0, read the number, close. The child is handed a port that was free a moment ago. */
async function freePort(): Promise<number> {
  const srv = createNetServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const { port } = srv.address() as AddressInfo;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

/** True when nothing holds the port: the bind itself is the proof (G41), not a missing log line. */
async function portIsFree(port: number): Promise<boolean> {
  const srv = createNetServer();
  const bound = await new Promise<boolean>((resolve) => {
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => resolve(true));
  });
  if (bound) await new Promise<void>((resolve) => srv.close(() => resolve()));
  return bound;
}

async function issuerServer(options?: IssuerServerOptions): Promise<IssuerServer> {
  const srv = await startIssuerServer(issuer, options);
  liveIssuers.push(srv);
  return srv;
}

/** Offline recipe: every configuration variable the child could inherit is deleted first (G26). */
function buildEnv(home: string, overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key === 'ENABLED_TOOLS' ||
      key === 'LOG_LEVEL' ||
      key === 'LOG_PII' ||
      key.startsWith('ANALYTICS_') ||
      key.startsWith('WEATHER_') ||
      key.startsWith('BLITZORTUNG_')
    ) {
      delete env[key];
    }
  }
  // Vitest sets NODE_ENV=test, which silences express's default error logger. The child
  // must run production-shaped, so a stack printed by that handler would show up.
  delete env.NODE_ENV;
  env.NO_PROXY = '127.0.0.1,localhost';
  env.no_proxy = '127.0.0.1,localhost';
  env.HOME = home;
  env.DOTENV_CONFIG_PATH = '/nonexistent';
  env.ANALYTICS_ENABLED = 'false';
  env.ANALYTICS_SALT = 'http-entry-test';
  env.WEATHER_LIGHTNING_PREWARM = 'false';
  env.LOG_LEVEL = '1';
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

async function spawnEntry(
  overrides: Record<string, string | undefined>,
  stdin: 'pipe' | 'ignore' = 'pipe'
): Promise<Entry> {
  const cwd = await mkdtemp(join(tmpdir(), 'http-entry-cwd-'));
  const home = await mkdtemp(join(tmpdir(), 'http-entry-home-'));
  tempDirs.push(cwd, home);

  const child = spawn(process.execPath, ['--import', TSX_LOADER, ENTRY_PATH], {
    cwd,
    env: buildEnv(home, overrides),
    stdio: [stdin, 'pipe', 'pipe']
  });
  liveChildren.add(child);

  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout?.on('data', (c: Buffer) => out.push(c));
  child.stderr?.on('data', (c: Buffer) => err.push(c));

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      liveChildren.delete(child);
      resolve({ code, signal });
    });
  });

  return {
    child,
    stdout: () => Buffer.concat(out).toString('utf8'),
    stderr: () => Buffer.concat(err).toString('utf8'),
    exited
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not happen within ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function waitForReady(entry: Entry): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exitedEarly: string | undefined;
  void entry.exited.then(({ code, signal }) => {
    exitedEarly = `code=${String(code)}, signal=${String(signal)}`;
  });
  while (Date.now() < deadline) {
    if (entry.stderr().includes(READY_LINE)) return;
    if (exitedEarly !== undefined) {
      throw new Error(`entry exited before it was ready (${exitedEarly}); stderr:\n${entry.stderr()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`entry did not print "${READY_LINE}" within ${READY_TIMEOUT_MS}ms; stderr:\n${entry.stderr()}`);
}

function parseLogLines(text: string): ParsedLogLine[] {
  const lines: ParsedLogLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    try {
      lines.push(JSON.parse(line) as ParsedLogLine);
    } catch {
      // Non-JSON stderr is ignored here; row 5 scans the raw text.
    }
  }
  return lines;
}

function refusalReason(stderr: string): unknown {
  const refusals = parseLogLines(stderr).filter((l) => l.message === 'HTTP entry refused to start');
  expect(refusals).toHaveLength(1);
  return refusals[0]?.metadata?.reason;
}

interface Live {
  entry: Entry;
  port: number;
  base: string;
  publicUrl: string;
  issuerServer: IssuerServer;
}

async function startLive(
  extra: Record<string, string | undefined> = {},
  options: { stdin?: 'pipe' | 'ignore'; path?: string } = {}
): Promise<Live> {
  const srv = await issuerServer();
  const port = await freePort();
  const publicUrl = `http://127.0.0.1:${port}${options.path ?? '/mcp'}`;
  const entry = await spawnEntry(
    {
      WEATHER_HTTP_PORT: String(port),
      WEATHER_HTTP_PUBLIC_URL: publicUrl,
      WEATHER_OAUTH_ISSUER: srv.origin,
      ...extra
    },
    options.stdin
  );
  await waitForReady(entry);
  return { entry, port, base: `http://127.0.0.1:${port}`, publicUrl, issuerServer: srv };
}

function claimsFor(live: Live, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: live.issuerServer.origin,
    aud: new URL(live.publicUrl).href,
    sub: 'user-1',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...extra
  };
}

describe('HTTP entry: refusals never bind', () => {
  const rows: Array<{
    name: string;
    reason: string;
    env: (srv: IssuerServer, publicUrl: string) => Record<string, string | undefined>;
    issuerOptions?: IssuerServerOptions;
    /** A row whose port value is itself the fault has no port to check. */
    portRow?: boolean;
  }> = [
    {
      name: 'no public URL',
      reason: ERR_PUBLIC_URL_REQUIRED,
      env: (srv) => ({ WEATHER_HTTP_PUBLIC_URL: undefined, WEATHER_OAUTH_ISSUER: srv.origin })
    },
    {
      name: 'no issuer',
      reason: ERR_ISSUER_REQUIRED,
      env: (_srv, publicUrl) => ({ WEATHER_HTTP_PUBLIC_URL: publicUrl, WEATHER_OAUTH_ISSUER: undefined })
    },
    {
      name: 'an http public URL on a public host',
      reason: ERR_PUBLIC_URL_HTTPS,
      env: (srv) => ({ WEATHER_HTTP_PUBLIC_URL: 'http://example.com/mcp', WEATHER_OAUTH_ISSUER: srv.origin })
    },
    {
      name: 'a bad port',
      reason: ERR_PORT,
      portRow: false,
      env: (srv, publicUrl) => ({
        WEATHER_HTTP_PORT: '70000',
        WEATHER_HTTP_PUBLIC_URL: publicUrl,
        WEATHER_OAUTH_ISSUER: srv.origin
      })
    },
    {
      name: 'the issuer server answering 500',
      reason: ERR_DISCOVERY_UNREADABLE,
      issuerOptions: { metadataStatus500: true },
      env: (srv, publicUrl) => ({ WEATHER_HTTP_PUBLIC_URL: publicUrl, WEATHER_OAUTH_ISSUER: srv.origin })
    },
    {
      name: 'the issuer server naming a different issuer',
      reason: ERR_DISCOVERY_ISSUER_MISMATCH,
      issuerOptions: { namedIssuer: 'http://127.0.0.1:1' },
      env: (srv, publicUrl) => ({ WEATHER_HTTP_PUBLIC_URL: publicUrl, WEATHER_OAUTH_ISSUER: srv.origin })
    }
  ];

  for (const row of rows) {
    it(
      `refuses with ${row.name}, exits non-zero, and leaves the port free`,
      async () => {
        const srv = await issuerServer(row.issuerOptions);
        const port = await freePort();
        const publicUrl = `http://127.0.0.1:${port}/mcp`;
        const entry = await spawnEntry({ WEATHER_HTTP_PORT: String(port), ...row.env(srv, publicUrl) });
        const { code } = await withTimeout(entry.exited, EXIT_TIMEOUT_MS, 'exit');

        expect(code).toBe(1);
        expect(refusalReason(entry.stderr())).toBe(row.reason);
        expect(entry.stderr()).not.toContain(READY_LINE);
        expect(entry.stdout()).toBe('');
        if (row.portRow !== false) expect(await portIsFree(port)).toBe(true);
      },
      CASE_TIMEOUT_MS
    );
  }

  it(
    'refuses when the issuer server is not running, and leaves the port free',
    async () => {
      const dead = await issuerServer();
      const deadOrigin = dead.origin;
      await dead.close();
      const port = await freePort();
      const entry = await spawnEntry({
        WEATHER_HTTP_PORT: String(port),
        WEATHER_HTTP_PUBLIC_URL: `http://127.0.0.1:${port}/mcp`,
        WEATHER_OAUTH_ISSUER: deadOrigin
      });
      const { code } = await withTimeout(entry.exited, EXIT_TIMEOUT_MS, 'exit');

      expect(code).toBe(1);
      expect(refusalReason(entry.stderr())).toBe(ERR_DISCOVERY_UNREADABLE);
      expect(entry.stdout()).toBe('');
      expect(await portIsFree(port)).toBe(true);
    },
    CASE_TIMEOUT_MS
  );
});

describe('HTTP entry: discovery runs before the bind', () => {
  it(
    'refuses connections on the port while discovery is still pending',
    async () => {
      // A refused child exits, and an exit frees its port, so the post-exit check above cannot
      // see a bind that happened too early. This probes the port while the child is alive.
      const srv = await issuerServer({ metadataDelayMs: 1_500, metadataStatus500: true });
      const port = await freePort();
      const entry = await spawnEntry({
        WEATHER_HTTP_PORT: String(port),
        WEATHER_HTTP_PUBLIC_URL: `http://127.0.0.1:${port}/mcp`,
        WEATHER_OAUTH_ISSUER: srv.origin
      });
      await withTimeout(srv.metadataSeen, READY_TIMEOUT_MS, 'discovery request');

      const outcome = await new Promise<string>((resolve) => {
        const sock = createConnection({ host: '127.0.0.1', port });
        sock.once('connect', () => {
          sock.destroy();
          resolve('connected');
        });
        sock.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
      });
      expect(outcome).toBe('ECONNREFUSED');

      const { code } = await withTimeout(entry.exited, EXIT_TIMEOUT_MS, 'exit');
      expect(code).toBe(1);
      expect(refusalReason(entry.stderr())).toBe(ERR_DISCOVERY_UNREADABLE);
      expect(entry.stdout()).toBe('');
    },
    CASE_TIMEOUT_MS
  );
});

describe('HTTP entry: lifecycle', () => {
  it(
    'stays up with stdin at EOF from boot, and answers /healthz',
    async () => {
      const live = await startLive({}, { stdin: 'ignore' });
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      expect(live.entry.child.exitCode).toBeNull();
      const res = await fetch(`${live.base}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
      expect(live.entry.stdout()).toBe('');
    },
    CASE_TIMEOUT_MS
  );

  it(
    'shuts down, bounded, on SIGTERM with a request half-sent',
    async () => {
      const live = await startLive();
      const bearer = await issuer.sign({ claims: claimsFor(live) });

      const req = http.request({
        host: '127.0.0.1',
        port: live.port,
        method: 'POST',
        path: '/mcp',
        agent: false,
        headers: { ...MCP_HEADERS, Authorization: `Bearer ${bearer}`, 'Content-Length': '1000' }
      });
      req.on('error', () => undefined);
      req.write('0123456789');
      // The 10 bytes must be on the server's socket before the signal, or this is an idle shutdown.
      await new Promise((resolve) => setTimeout(resolve, 300));

      live.entry.child.kill('SIGTERM');
      const { code } = await withTimeout(live.entry.exited, EXIT_TIMEOUT_MS, 'exit');
      req.destroy();

      // The exit code may be 0 or 1 (the plan). The run records which one this is.
      expect([0, 1]).toContain(code);
      const lines = parseLogLines(live.entry.stderr());
      expect(lines.filter((l) => l.message === 'Shutting down')).toHaveLength(1);
      expect(lines.filter((l) => l.message === 'Shutting down')[0]?.metadata?.reason).toBe('SIGTERM');
      // Exactly one terminal line: the steps finished, or the ref'd deadline (G114) ended the run.
      const complete = lines.filter((l) => l.message === 'Shutdown complete').length;
      const deadline = lines.filter((l) => l.message === 'Shutdown deadline reached').length;
      expect(complete + deadline).toBe(1);
      if (deadline === 1) expect(code).toBe(1);
      expect(live.entry.stdout()).toBe('');
      process.stderr.write(`[http-entry row 3] exit code after SIGTERM with a half-sent request: ${String(code)}\n`);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'exits 0 on an idle SIGINT',
    async () => {
      const live = await startLive();
      live.entry.child.kill('SIGINT');
      const { code, signal } = await withTimeout(live.entry.exited, EXIT_TIMEOUT_MS, 'exit');

      expect(code).toBe(0);
      expect(signal).toBeNull();
      const lines = parseLogLines(live.entry.stderr());
      expect(lines.filter((l) => l.message === 'Shutting down')).toHaveLength(1);
      expect(lines.filter((l) => l.message === 'Shutdown complete')).toHaveLength(1);
      expect(live.entry.stdout()).toBe('');
    },
    CASE_TIMEOUT_MS
  );
});

describe('HTTP entry: log sentinel', () => {
  it(
    'writes no marker, token, route path or request body to stderr, at LOG_LEVEL=0 with LOG_PII=true',
    async () => {
      const live = await startLive({ LOG_LEVEL: '0', LOG_PII: 'true' }, { path: '/zqpath7731' });
      const claims = claimsFor(live, { sub: 'zqsub7731', client_id: 'zqclient7731' });
      const bearerValid = await issuer.sign({ claims });
      const bearerForged = await issuer.sign({ claims, withOtherKey: true });
      const route = '/zqpath7731';

      const post = (bearer: string, body: string): Promise<number> =>
        fetch(`${live.base}${route}`, {
          method: 'POST',
          headers: { ...MCP_HEADERS, Authorization: `Bearer ${bearer}` },
          body
        }).then(async (res) => {
          await res.arrayBuffer();
          return res.status;
        });

      expect(await post(bearerValid, JSON.stringify(INITIALIZE))).toBe(200);
      expect(await post(bearerForged, JSON.stringify(INITIALIZE))).toBe(401);
      expect(await post(bearerValid, '[zqbody7731]')).toBe(400);

      live.entry.child.kill('SIGTERM');
      await withTimeout(live.entry.exited, EXIT_TIMEOUT_MS, 'exit');
      const stderr = live.entry.stderr();
      const lines = parseLogLines(stderr);

      // Non-vacuous: the lines that could have leaked are there.
      expect(lines.filter((l) => l.message === 'Access token rejected').length).toBeGreaterThanOrEqual(1);
      expect(lines.filter((l) => l.message === 'HTTP request').length).toBeGreaterThanOrEqual(3);
      expect(lines.filter((l) => l.message === 'HTTP request rejected').length).toBeGreaterThanOrEqual(1);

      expect(stderr).not.toContain('zqsub7731');
      expect(stderr).not.toContain('zqclient7731');
      expect(stderr).not.toContain('zqbody7731');
      expect(stderr).not.toContain('zqpath7731');
      // Any piece of either bearer, split on dots: the header.payload.signature parts and the raw string.
      for (const bearer of [bearerValid, bearerForged]) {
        expect(stderr).not.toContain(bearer);
        for (const part of bearer.split('.')) expect(stderr).not.toContain(part);
      }
      expect(live.entry.stdout()).toBe('');
    },
    CASE_TIMEOUT_MS
  );
});
