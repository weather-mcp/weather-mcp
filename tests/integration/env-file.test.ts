import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { PRESETS, TOOL_NAMES } from '../../src/config/tools.js';
import { ENV_FILE_UNREADABLE_PREFIX } from '../../src/config/envFile.js';
import { ERR_ISSUER_REQUIRED, ERR_PUBLIC_URL_REQUIRED } from '../../src/config/http.js';

/**
 * The server reads a `.env` only from the path in DOTENV_CONFIG_PATH. Every row spawns the real
 * entry from source (G61: an import would run `main()`), in a fresh cwd and a fresh HOME (G26).
 * Stream claims about stdout are made in a child (G34). Each child is given stdin EOF and awaited
 * (G37); `afterAll` kills any leftover.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const STDIO_ENTRY = join(__dirname, '../../src/index.ts');
const HTTP_ENTRY = join(__dirname, '../../src/http.ts');
const DEV_WRAPPER = join(__dirname, '../../scripts/dev-entry.mjs');
// Resolved from this file: the child's cwd is outside the repo.
const TSX_LOADER = import.meta.resolve('tsx');

const WAIT_MS = 15_000;
const CASE_TIMEOUT_MS = 40_000;
const BASIC_COUNT = PRESETS.basic.length;
const FULL_COUNT = TOOL_NAMES.length;

const liveChildren = new Set<ChildProcessWithoutNullStreams>();
const tempDirs: string[] = [];

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  toolCount: number | undefined;
}

function buildEnv(home: string, extra: Record<string, string>, http: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key === 'ENABLED_TOOLS' ||
      key === 'LOG_LEVEL' ||
      key === 'LOG_PII' ||
      key.startsWith('ANALYTICS_') ||
      key.startsWith('WEATHER_') ||
      key.startsWith('BLITZORTUNG_') ||
      key.startsWith('DOTENV_')
    ) {
      delete env[key];
    }
  }
  // Vitest sets NODE_ENV=test; the HTTP child must run production-shaped.
  if (http) delete env.NODE_ENV;
  env.HOME = home;
  env.ANALYTICS_ENABLED = 'false';
  env.ANALYTICS_SALT = 'env-file-test';
  env.WEATHER_LIGHTNING_PREWARM = 'false';
  env.LOG_LEVEL = '1';
  env.NO_PROXY = '127.0.0.1,localhost';
  env.no_proxy = '127.0.0.1,localhost';
  Object.assign(env, extra);
  return env;
}

async function makeCwd(envFile: string | undefined): Promise<{ cwd: string; home: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'env-file-cwd-'));
  const home = await mkdtemp(join(tmpdir(), 'env-file-home-'));
  tempDirs.push(cwd, home);
  if (envFile !== undefined) await writeFile(join(cwd, '.env'), envFile);
  return { cwd, home };
}

function start(
  entry: string | string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): { child: ChildProcessWithoutNullStreams; out: Buffer[]; err: Buffer[]; exited: Promise<number | null> } {
  const entryArgs = Array.isArray(entry) ? entry : [entry];
  const child = spawn(process.execPath, ['--import', TSX_LOADER, ...entryArgs], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  liveChildren.add(child);
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => out.push(c));
  child.stderr.on('data', (c: Buffer) => err.push(c));
  const exited = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`child did not exit within ${WAIT_MS}ms; stderr:\n${Buffer.concat(err).toString('utf8')}`));
    }, WAIT_MS);
    child.once('exit', (code) => {
      clearTimeout(timer);
      liveChildren.delete(child);
      resolve(code);
    });
  });
  return { child, out, err, exited };
}

/** Drive a stdio server through initialize and tools/list, then end stdin and await exit. */
async function runStdio(
  cwd: string,
  home: string,
  extra: Record<string, string>,
  entry: string | string[] = STDIO_ENTRY
): Promise<RunResult> {
  const { child, out, err, exited } = start(entry, cwd, buildEnv(home, extra, false));
  const messages = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'env-file-test', version: '0.0.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ];
  for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);

  const answered = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no tools/list answer within ${WAIT_MS}ms`)), WAIT_MS);
    const poll = setInterval(() => {
      const hasAnswer = Buffer.concat(out)
        .toString('utf8')
        .split('\n')
        .some((l) => l.includes('"id":2') && l.includes('"tools"'));
      if (hasAnswer) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }
    }, 25);
    void exited.then(() => {
      clearTimeout(timer);
      clearInterval(poll);
      resolve();
    });
  });
  try {
    await answered;
  } finally {
    child.stdin.end();
  }
  const code = await exited;
  const stdout = Buffer.concat(out).toString('utf8');
  const stderr = Buffer.concat(err).toString('utf8');
  let toolCount: number | undefined;
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const msg = JSON.parse(line) as { id?: number; result?: { tools?: unknown[] } };
      if (msg.id === 2 && Array.isArray(msg.result?.tools)) toolCount = msg.result.tools.length;
    } catch {
      // A non-JSON stdout line is asserted on by row 5, not here.
    }
  }
  return { code, stdout, stderr, toolCount };
}

async function expectFile(path: string, needle: string): Promise<void> {
  await access(path);
  const { readFile } = await import('node:fs/promises');
  expect(await readFile(path, 'utf8')).toContain(needle);
}

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const addr = srv.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

afterAll(async () => {
  for (const child of liveChildren) child.kill('SIGKILL');
  liveChildren.clear();
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('the .env file is read only from DOTENV_CONFIG_PATH', () => {
  it('sanity: the preset counts differ', () => {
    expect(BASIC_COUNT).toBeGreaterThan(0);
    expect(FULL_COUNT).toBeGreaterThan(BASIC_COUNT);
  });

  it(
    'row 1: no implicit .env in the working directory',
    async () => {
      const { cwd, home } = await makeCwd('ENABLED_TOOLS=all\n');
      await expectFile(join(cwd, '.env'), 'ENABLED_TOOLS=all');
      const r = await runStdio(cwd, home, {});
      expect(r.toolCount).toBe(BASIC_COUNT);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'row 2: an absolute DOTENV_CONFIG_PATH is honoured (row 1 positive control)',
    async () => {
      const { cwd, home } = await makeCwd('ENABLED_TOOLS=all\n');
      await expectFile(join(cwd, '.env'), 'ENABLED_TOOLS=all');
      const r = await runStdio(cwd, home, { DOTENV_CONFIG_PATH: join(cwd, '.env') });
      expect(r.toolCount).toBe(FULL_COUNT);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'row 3: a relative DOTENV_CONFIG_PATH resolves against the working directory',
    async () => {
      const { cwd, home } = await makeCwd('ENABLED_TOOLS=all\n');
      await expectFile(join(cwd, '.env'), 'ENABLED_TOOLS=all');
      const r = await runStdio(cwd, home, { DOTENV_CONFIG_PATH: '.env' });
      expect(r.toolCount).toBe(FULL_COUNT);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'row 4: a variable the client set wins over the file, whatever DOTENV_* override says',
    async () => {
      const { cwd, home } = await makeCwd('ENABLED_TOOLS=all\n');
      await expectFile(join(cwd, '.env'), 'ENABLED_TOOLS=all');
      const r = await runStdio(cwd, home, {
        DOTENV_CONFIG_PATH: join(cwd, '.env'),
        ENABLED_TOOLS: 'basic',
        DOTENV_OVERRIDE: 'true',
        DOTENV_CONFIG_OVERRIDE: 'true',
      });
      expect(r.toolCount).toBe(BASIC_COUNT);
    },
    CASE_TIMEOUT_MS
  );

  describe('row 5: stdout stays protocol-only under DOTENV_DEBUG and DOTENV_ENCODING', () => {
    for (const variant of ['readable', 'missing'] as const) {
      it(
        `(${variant} path)`,
        async () => {
          const { cwd, home } = await makeCwd('ENABLED_TOOLS=all\n');
          const path = variant === 'readable' ? join(cwd, '.env') : join(cwd, 'absent.env');
          if (variant === 'readable') await expectFile(path, 'ENABLED_TOOLS=all');
          const r = await runStdio(cwd, home, {
            DOTENV_CONFIG_PATH: path,
            DOTENV_DEBUG: 'true',
            DOTENV_ENCODING: 'latin1',
          });
          const lines = r.stdout.split('\n').filter((l) => l.trim() !== '');
          expect(lines.length).toBeGreaterThanOrEqual(2);
          for (const line of lines) {
            const msg = JSON.parse(line) as { jsonrpc?: unknown };
            expect(msg.jsonrpc).toBe('2.0');
          }
        },
        CASE_TIMEOUT_MS
      );
    }
  });

  it(
    'row 6: an unreadable path warns once on stderr, without the path, and the server still answers',
    async () => {
      const { cwd, home } = await makeCwd(undefined);
      const path = join(cwd, 'zqenv7731', 'missing.env');
      expect(path).toContain('zqenv7731');
      const r = await runStdio(cwd, home, { DOTENV_CONFIG_PATH: path });
      expect(r.toolCount).toBe(BASIC_COUNT);
      const warnings = r.stderr.split('\n').filter((l) => l.startsWith(ENV_FILE_UNREADABLE_PREFIX));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('ENOENT');
      expect(r.stderr).not.toContain('zqenv7731');
    },
    CASE_TIMEOUT_MS
  );

  it(
    'row 7: the HTTP entry reads no implicit .env, and reads the named one',
    async () => {
      const port = await freePort();
      const body = `WEATHER_HTTP_PUBLIC_URL=http://127.0.0.1:${port}/mcp\n`;
      const refusal = async (extra: (cwd: string) => Record<string, string>): Promise<{ code: number | null; reasons: unknown[] }> => {
        const { cwd, home } = await makeCwd(body);
        await expectFile(join(cwd, '.env'), 'WEATHER_HTTP_PUBLIC_URL=');
        const { child, err, exited } = start(HTTP_ENTRY, cwd, buildEnv(home, extra(cwd), true));
        child.stdin.end();
        const code = await exited;
        const reasons: unknown[] = [];
        for (const raw of Buffer.concat(err).toString('utf8').split('\n')) {
          try {
            const l = JSON.parse(raw) as { message?: string; metadata?: { reason?: unknown } };
            if (l.message === 'HTTP entry refused to start') reasons.push(l.metadata?.reason);
          } catch {
            // not a JSON line
          }
        }
        return { code, reasons };
      };
      const without = await refusal(() => ({}));
      expect(without.code).not.toBe(0);
      expect(without.reasons).toEqual([ERR_PUBLIC_URL_REQUIRED]);
      const withPath = await refusal((cwd) => ({ DOTENV_CONFIG_PATH: join(cwd, '.env') }));
      expect(withPath.code).not.toBe(0);
      expect(withPath.reasons).toEqual([ERR_ISSUER_REQUIRED]);
    },
    CASE_TIMEOUT_MS
  );
});

// `npm run dev` runs scripts/dev-entry.mjs, which names ./.env in DOTENV_CONFIG_PATH when none is
// named. "None" is the loader's own absence rule: unset or empty (diff-review codex-C1).
describe('the dev wrapper names ./.env only when no path is named', () => {
  const WRAPPED = [DEV_WRAPPER, STDIO_ENTRY];

  it(
    'unset: loads ./.env',
    async () => {
      const { cwd, home } = await makeCwd('ENABLED_TOOLS=all\n');
      await expectFile(join(cwd, '.env'), 'ENABLED_TOOLS=all');
      const r = await runStdio(cwd, home, {}, WRAPPED);
      expect(r.toolCount).toBe(FULL_COUNT);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'empty: loads ./.env',
    async () => {
      const { cwd, home } = await makeCwd('ENABLED_TOOLS=all\n');
      await expectFile(join(cwd, '.env'), 'ENABLED_TOOLS=all');
      const r = await runStdio(cwd, home, { DOTENV_CONFIG_PATH: '' }, WRAPPED);
      expect(r.toolCount).toBe(FULL_COUNT);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'a named path wins over ./.env',
    async () => {
      const { cwd, home } = await makeCwd('ENABLED_TOOLS=all\n');
      await expectFile(join(cwd, '.env'), 'ENABLED_TOOLS=all');
      const other = join(cwd, 'other.env');
      await writeFile(other, 'ENABLED_TOOLS=basic\n');
      const r = await runStdio(cwd, home, { DOTENV_CONFIG_PATH: other }, WRAPPED);
      expect(r.toolCount).toBe(BASIC_COUNT);
    },
    CASE_TIMEOUT_MS
  );
});
