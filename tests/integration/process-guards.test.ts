/**
 * Process guards in a real process (plan-http-entry-hardening, design contract 7).
 *
 * A unit test cannot see either behaviour: Vitest holds the worker alive and
 * replaces the console (G34, G140). Each case spawns a child from source that
 * installs the guards the way the entries do, and reads the child's real exit
 * code, stdout and stderr. No child imports an entry (G61).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUARDS_URL = pathToFileURL(join(__dirname, '../../src/server/processGuards.ts')).href;
const SHUTDOWN_URL = pathToFileURL(join(__dirname, '../../src/server/shutdown.ts')).href;
// Resolved from this file: the child's cwd is a temp directory outside the repo (G26).
const TSX_LOADER = import.meta.resolve('tsx');

const SENTINEL = 'zqguard7731';
const CASE_TIMEOUT_MS = 30_000;

interface ParsedLogLine {
  level?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

interface Outcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  lines: ParsedLogLine[];
}

const liveChildren = new Set<ChildProcessWithoutNullStreams>();
const tempDirs: string[] = [];

afterEach(async () => {
  for (const child of liveChildren) child.kill('SIGKILL');
  liveChildren.clear();
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function buildEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key === 'ENABLED_TOOLS' ||
      key === 'LOG_LEVEL' ||
      key === 'LOG_PII' ||
      // Vitest sets NODE_ENV=test; the child runs as a real process would (G140).
      key === 'NODE_ENV' ||
      key.startsWith('ANALYTICS_') ||
      key.startsWith('WEATHER_') ||
      key.startsWith('BLITZORTUNG_')
    ) {
      delete env[key];
    }
  }
  env.HOME = home;
  env.LOG_LEVEL = '1';
  return env;
}

function parseLogLines(stderr: string): ParsedLogLine[] {
  const lines: ParsedLogLine[] = [];
  for (const raw of stderr.split('\n')) {
    if (!raw.startsWith('{')) continue;
    try {
      lines.push(JSON.parse(raw) as ParsedLogLine);
    } catch {
      // Not a log line.
    }
  }
  return lines;
}

async function runChild(script: string): Promise<Outcome> {
  const cwd = await mkdtemp(join(tmpdir(), 'process-guards-'));
  tempDirs.push(cwd);
  const child = spawn(process.execPath, ['--import', TSX_LOADER, '--input-type=module', '-e', script], {
    cwd,
    env: buildEnv(cwd),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  liveChildren.add(child);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child did not exit in time')), 20_000);
    child.once('exit', (exitCode, exitSignal) => {
      clearTimeout(timer);
      resolve({ code: exitCode, signal: exitSignal });
    });
  });
  liveChildren.delete(child);
  const stderrText = Buffer.concat(stderr).toString('utf8');
  return { code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: stderrText, lines: parseLogLines(stderrText) };
}

const REJECT = `void Promise.reject(new Error('${SENTINEL} at /opt/app/zq.js'));`;
const STAY_UP = "setTimeout(() => { process.stdout.write('STILL-UP\\n'); process.exit(0); }, 300);";

describe('unhandledRejection', () => {
  it(
    'control: without the guards the rejection ends the process and prints the error',
    async () => {
      const outcome = await runChild([REJECT, STAY_UP].join('\n'));

      // This is what the guards replace, and it proves the harness would see a leak.
      expect(outcome.code).toBe(1);
      expect(outcome.stdout).not.toContain('STILL-UP');
      expect(outcome.stderr).toContain(SENTINEL);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'with the guards the process stays up and writes one line with no message and no stack',
    async () => {
      const outcome = await runChild(
        [
          `import { installProcessGuards } from ${JSON.stringify(GUARDS_URL)};`,
          "installProcessGuards({ emitter: process, onFatal: () => { process.stdout.write('FATAL-CALLED\\n'); } });",
          REJECT,
          STAY_UP
        ].join('\n')
      );

      expect(outcome.signal).toBeNull();
      expect(outcome.code).toBe(0);
      expect(outcome.stdout).toContain('STILL-UP');
      expect(outcome.stdout).not.toContain('FATAL-CALLED');

      const rejections = outcome.lines.filter((line) => line.message === 'Unhandled promise rejection');
      expect(rejections).toHaveLength(1);
      expect(rejections[0]?.level).toBe('ERROR');
      expect(rejections[0]?.metadata).toEqual({ securityEvent: true, error: { name: 'Error' } });

      expect(outcome.stderr).not.toContain(SENTINEL);
      expect(outcome.stderr).not.toContain('/opt/app');
      expect(outcome.stderr).not.toMatch(/\n\s+at /);
    },
    CASE_TIMEOUT_MS
  );
});

describe('uncaughtException', () => {
  // The entries' own wiring, word for word: a crashed flag the coordinator's exit reads.
  const entryWiring = (markCrashed: boolean): string =>
    [
      `import { installProcessGuards } from ${JSON.stringify(GUARDS_URL)};`,
      `import { createShutdown } from ${JSON.stringify(SHUTDOWN_URL)};`,
      'let crashed = false;',
      'const shutdown = createShutdown({',
      "  steps: [{ name: 'marker', run: () => { process.stdout.write('STEP-RAN\\n'); } }],",
      '  deadlineMs: 1500,',
      '  exit: (code) => process.exit(crashed ? 1 : code)',
      '});',
      `installProcessGuards({ emitter: process, onFatal: (reason) => { ${markCrashed ? 'crashed = true; ' : ''}void shutdown(reason); } });`,
      `setTimeout(() => { throw new Error('${SENTINEL} at /opt/app/zq.js'); }, 50);`,
      // Keeps the loop alive: only the shutdown can end this process.
      'setInterval(() => {}, 1000);'
    ].join('\n');

  it(
    'runs the shutdown steps inside the deadline and exits 1',
    async () => {
      const outcome = await runChild(entryWiring(true));

      expect(outcome.signal).toBeNull();
      expect(outcome.code).toBe(1);
      expect(outcome.stdout).toContain('STEP-RAN');

      expect(outcome.lines.filter((line) => line.message === 'Uncaught exception')).toHaveLength(1);
      const shuttingDown = outcome.lines.filter((line) => line.message === 'Shutting down');
      expect(shuttingDown).toHaveLength(1);
      expect(shuttingDown[0]?.metadata).toEqual({ reason: 'uncaughtException' });
      // Every step completed; the 1 is the entry's, not the deadline's.
      expect(outcome.lines.filter((line) => line.message === 'Shutdown complete')).toHaveLength(1);
      expect(outcome.lines.filter((line) => line.message === 'Shutdown deadline reached')).toHaveLength(0);

      expect(outcome.stderr).not.toContain(SENTINEL);
      expect(outcome.stderr).not.toContain('/opt/app');
      expect(outcome.stderr).not.toMatch(/\n\s+at /);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'control: without the crashed flag the same run would exit 0',
    async () => {
      const outcome = await runChild(entryWiring(false));

      // A clean shutdown exits 0, so the flag is what makes a crash exit 1.
      expect(outcome.code).toBe(0);
      expect(outcome.stdout).toContain('STEP-RAN');
    },
    CASE_TIMEOUT_MS
  );
});
