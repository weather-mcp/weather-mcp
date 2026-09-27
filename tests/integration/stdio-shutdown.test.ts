import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SHUTDOWN_DEADLINE_MS } from '../../src/server/shutdown.js';

/**
 * Spawns the real server from source (never imports `src/index.ts` — G61: an
 * import runs `main()` unconditionally, attaching the real transport to the
 * test worker's own stdin) and proves it exits when its client closes stdin,
 * per the MCP stdio lifecycle (design plan `.devdocs/plan-stdio-eof-shutdown.md`
 * §1) rather than relying on the client's `SIGTERM` fallback.
 *
 * The `Shutting down` line is the discriminator, not the exit code (G41): after
 * T1's `.unref()`'d housekeeping timers, a tree with no stdin trigger at all
 * (T3 reverted) also exits 0 on EOF, because the event loop simply drains once
 * nothing else is live. Only the coordinator's log line proves it ran.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY_PATH = join(__dirname, '../../src/index.ts');
const SHUTDOWN_MODULE_URL = pathToFileURL(join(__dirname, '../../src/server/shutdown.ts')).href;

// `--import tsx` resolves relative to the child's cwd, and the cwd here is a
// fresh temp directory outside the repo (G26), so resolve tsx's loader hook
// from this test file instead and pass the resolved specifier explicitly.
const TSX_LOADER = import.meta.resolve('tsx');

const READY_LINE = 'Weather MCP Server started';
const READY_TIMEOUT_MS = 20_000;
const EXIT_GRACE_MS = 3_000;
const EXIT_TIMEOUT_MS = SHUTDOWN_DEADLINE_MS + EXIT_GRACE_MS;
const CASE_TIMEOUT_MS = 30_000;

interface ParsedLogLine {
  timestamp?: string;
  level?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

interface SpawnedServer {
  child: ChildProcessWithoutNullStreams;
  stdoutChunks: Buffer[];
  stderrChunks: Buffer[];
}

const liveChildren = new Set<ChildProcessWithoutNullStreams>();
const tempDirs: string[] = [];

/**
 * Offline recipe (G61's three variables, plus G26's cwd/HOME discipline): no
 * tool is ever called, so `ENABLED_TOOLS` and every upstream key are
 * irrelevant, but they and every other configuration variable are still
 * deleted so the child's behaviour depends only on what this helper sets.
 */
function buildEnv(home: string): NodeJS.ProcessEnv {
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
  env.HOME = home;
  env.ANALYTICS_ENABLED = 'false';
  env.ANALYTICS_SALT = 'stdio-shutdown-test';
  env.WEATHER_LIGHTNING_PREWARM = 'false';
  env.LOG_LEVEL = '1';
  return env;
}

function waitForReady(child: ChildProcessWithoutNullStreams, stderrChunks: Buffer[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const isReady = (): boolean => Buffer.concat(stderrChunks).toString('utf8').includes(READY_LINE);

    if (isReady()) {
      resolve();
      return;
    }

    const onData = (): void => {
      if (isReady()) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(
        new Error(
          `server exited before it was ready (code=${String(code)}, signal=${String(signal)}); ` +
            `stderr so far:\n${Buffer.concat(stderrChunks).toString('utf8')}`
        )
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `server did not print "${READY_LINE}" within ${READY_TIMEOUT_MS}ms; ` +
            `stderr so far:\n${Buffer.concat(stderrChunks).toString('utf8')}`
        )
      );
    }, READY_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timer);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    }

    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`process did not exit within ${timeoutMs}ms of the close`));
    }, timeoutMs);

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function parseLogLines(buf: Buffer): ParsedLogLine[] {
  const lines: ParsedLogLine[] = [];
  for (const raw of buf.toString('utf8').split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    try {
      lines.push(JSON.parse(line) as ParsedLogLine);
    } catch {
      // Non-JSON stderr noise (there should be none on this path) is ignored;
      // the assertions below count named messages, not raw line counts.
    }
  }
  return lines;
}

async function spawnServer(): Promise<SpawnedServer> {
  const cwd = await mkdtemp(join(tmpdir(), 'stdio-eof-cwd-'));
  const home = await mkdtemp(join(tmpdir(), 'stdio-eof-home-'));
  tempDirs.push(cwd, home);

  const child = spawn(process.execPath, ['--import', TSX_LOADER, ENTRY_PATH], {
    cwd,
    env: buildEnv(home),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  await waitForReady(child, stderrChunks);

  // Let the process settle for one real tick before the caller acts. Calling
  // `stdin.end()`/`kill()` from inside the same I/O callback that detected
  // readiness races the child's own event loop in a way no real MCP client
  // reproduces: pipe EOF and a POSIX signal are two independent kernel
  // delivery paths, and which one the child's scheduler resolves first is
  // otherwise a coin flip that depends on how the readiness check happened to
  // be driven. Verified empirically (mutation M2, T4): a 0ms `setTimeout`
  // still let a second, un-memoised coordinator's SIGTERM path race ahead of
  // `server.onclose` roughly 30% of the time and mask the mutation; 50ms
  // reddened 10/10. The correct coordinator's behaviour never depends on this
  // race (every trigger source feeds the same memo), so this delay only
  // stabilises the mutation check — it changes nothing the coordinator's own
  // contract cares about.
  await new Promise((resolve) => setTimeout(resolve, 50));

  return { child, stdoutChunks, stderrChunks };
}

afterEach(async () => {
  for (const child of liveChildren) {
    child.kill('SIGKILL');
  }
  liveChildren.clear();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('stdio shutdown on stdin EOF', () => {
  it(
    'exits cleanly, once, with no shutdown-path stdout, on stdin EOF alone',
    async () => {
      const { child, stdoutChunks, stderrChunks } = await spawnServer();

      // Only bytes written after the close count: a startup write to stdout
      // (dotenv can print a banner there) is out of this test's scope; the
      // contract is the shutdown path.
      const stdoutLenAtClose = Buffer.concat(stdoutChunks).length;

      child.stdin.end();

      const { code, signal } = await waitForExit(child, EXIT_TIMEOUT_MS);

      expect(code).toBe(0);
      expect(signal).toBeNull();

      const stdoutAfterClose = Buffer.concat(stdoutChunks).subarray(stdoutLenAtClose);
      expect(stdoutAfterClose.length).toBe(0);

      const lines = parseLogLines(Buffer.concat(stderrChunks));

      const shuttingDown = lines.filter((line) => line.message === 'Shutting down');
      expect(shuttingDown).toHaveLength(1);
      expect(['stdin end', 'stdin close']).toContain(shuttingDown[0]?.metadata?.reason);

      const complete = lines.filter((line) => line.message === 'Shutdown complete');
      expect(complete).toHaveLength(1);
    },
    CASE_TIMEOUT_MS
  );

  it(
    'exits exactly once when SIGTERM arrives during EOF teardown',
    async () => {
      const { child, stdoutChunks, stderrChunks } = await spawnServer();

      const stdoutLenAtClose = Buffer.concat(stdoutChunks).length;

      child.stdin.end();
      child.kill('SIGTERM');

      const { code, signal } = await waitForExit(child, EXIT_TIMEOUT_MS);

      expect(code).toBe(0);
      expect(signal).toBeNull();

      const stdoutAfterClose = Buffer.concat(stdoutChunks).subarray(stdoutLenAtClose);
      expect(stdoutAfterClose.length).toBe(0);

      const lines = parseLogLines(Buffer.concat(stderrChunks));

      // Whichever reason won the race (stdin end/close vs SIGTERM), the memo
      // means exactly one run happens.
      const shuttingDown = lines.filter((line) => line.message === 'Shutting down');
      expect(shuttingDown).toHaveLength(1);

      const complete = lines.filter((line) => line.message === 'Shutdown complete');
      expect(complete).toHaveLength(1);
    },
    CASE_TIMEOUT_MS
  );
});

describe('shutdown deadline in a real process', () => {
  it(
    'a step that hangs without holding any handle still exits 1 at the deadline',
    async () => {
      // A pending promise owns no libuv handle. With an unref'd deadline, nothing would keep the
      // loop alive and the process would drain to exit 0 with no warning (diff-review DR-M1). A
      // unit test cannot see this: the Vitest worker holds handles of its own.
      const cwd = await mkdtemp(join(tmpdir(), 'stdio-eof-deadline-'));
      tempDirs.push(cwd);
      const script = [
        `import { createShutdown } from ${JSON.stringify(SHUTDOWN_MODULE_URL)};`,
        'const shutdown = createShutdown({',
        "  steps: [{ name: 'handle-free-hang', run: () => new Promise(() => {}) }],",
        '  deadlineMs: 200,',
        '  exit: (code) => process.exit(code)',
        '});',
        "void shutdown('deadline regression');"
      ].join('\n');

      const child = spawn(process.execPath, ['--import', TSX_LOADER, '--input-type=module', '-e', script], {
        cwd,
        env: buildEnv(cwd),
        stdio: ['pipe', 'pipe', 'pipe']
      });
      liveChildren.add(child);
      child.once('exit', () => liveChildren.delete(child));
      const stderrChunks: Buffer[] = [];
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const { code, signal } = await waitForExit(child, 15_000);

      expect(signal).toBeNull();
      expect(code).toBe(1);
      const lines = parseLogLines(Buffer.concat(stderrChunks));
      const deadline = lines.filter((line) => line.message === 'Shutdown deadline reached');
      expect(deadline).toHaveLength(1);
      expect(deadline[0]?.metadata).toEqual({ pendingStep: 'handle-free-hang', deadlineMs: 200 });
    },
    CASE_TIMEOUT_MS
  );
});
