/**
 * Unit tests for `src/server/shutdown.ts` — the run-once, bounded shutdown coordinator that every
 * way the stdio session can end is routed through (`src/index.ts`).
 *
 * The module is pure apart from `logger`, and every call to `createShutdown` builds fresh closure
 * state, so one static import serves the whole file (no `vi.resetModules()`). Steps, `exit` and the
 * scheduler are injected; the fake scheduler follows `lightning-prewarm.test.ts`'s shape.
 *
 * Stdout is asserted on the `console.log` identity, never on `process.stdout.write` — Vitest swaps
 * `globalThis.console`, so a stream spy records nothing (G34). The stream-level claim is made in a
 * real child process by `tests/integration/stdio-shutdown.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createShutdown, SHUTDOWN_DEADLINE_MS, type ShutdownStep } from '../../src/server/shutdown.js';
import { logger } from '../../src/utils/logger.js';

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

/** A fake scheduler that records its one deadline callback and lets a test fire it. */
function createFakeScheduler() {
  let deadlineFn: (() => void) | undefined;
  const setTimeout = vi.fn((fn: () => void, _ms: number) => {
    deadlineFn = fn;
    return 42 as unknown as TimeoutHandle;
  });
  const clearTimeout = vi.fn((_handle: TimeoutHandle) => {});
  return {
    setTimeout,
    clearTimeout,
    fire(): void {
      if (!deadlineFn) {
        throw new Error('createFakeScheduler: no deadline was ever armed');
      }
      deadlineFn();
    }
  };
}

/** Let every queued microtask (and the chains they start) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

function recordingSteps(order: string[], names: string[]): ShutdownStep[] {
  return names.map((name) => ({ name, run: () => { order.push(name); } }));
}

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(logger, 'info');
  warnSpy = vi.spyOn(logger, 'warn');
  errorSpy = vi.spyOn(logger, 'error');
  consoleLogSpy = vi.spyOn(console, 'log');
  // The logger writes to console.error; keep it off the reporter.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function infoMessages(): string[] {
  return infoSpy.mock.calls.map((call: unknown[]) => call[0] as string);
}

describe('createShutdown', () => {
  it('contract 1 — a clean run walks every step in order and exits 0 once', async () => {
    const order: string[] = [];
    const scheduler = createFakeScheduler();
    const exit = vi.fn();
    const trigger = createShutdown({
      steps: recordingSteps(order, ['a', 'b', 'c']),
      deadlineMs: 1000,
      exit,
      scheduler
    });

    await trigger('test');

    expect(order).toEqual(['a', 'b', 'c']);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(scheduler.clearTimeout).toHaveBeenCalledTimes(1);
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(42);
    expect(infoMessages().filter((m) => m === 'Shutting down')).toHaveLength(1);
    expect(infoSpy).toHaveBeenCalledWith('Shutting down', { reason: 'test' });
    expect(infoSpy).toHaveBeenCalledWith('Shutdown complete', { failed: false });
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  describe('contract 2 — run once', () => {
    it('returns the same promise to every trigger and runs each step once', async () => {
      const order: string[] = [];
      const exit = vi.fn();
      const trigger = createShutdown({
        steps: recordingSteps(order, ['a', 'b', 'c']),
        deadlineMs: 1000,
        exit,
        scheduler: createFakeScheduler()
      });

      const first = trigger('one');
      const second = trigger('two');
      const third = trigger('three');
      expect(second).toBe(first);
      expect(third).toBe(first);
      await first;

      expect(order).toEqual(['a', 'b', 'c']);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(infoMessages().filter((m) => m === 'Shutting down')).toHaveLength(1);
      expect(infoSpy).toHaveBeenCalledWith('Shutting down', { reason: 'one' });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('a FIRST step that re-enters the trigger synchronously does not start a second run', async () => {
      const order: string[] = [];
      const exit = vi.fn();
      let trigger: (reason: string) => Promise<void> = async () => {};
      let reentered: Promise<void> | undefined;
      trigger = createShutdown({
        steps: [
          {
            name: 'a',
            run: () => {
              order.push('a');
              // Not awaited: `server.close()` fires `server.onclose` the same way.
              reentered = trigger('reentrant');
            }
          },
          ...recordingSteps(order, ['b', 'c'])
        ],
        deadlineMs: 1000,
        exit,
        scheduler: createFakeScheduler()
      });

      const first = trigger('outer');
      await first;

      expect(reentered).toBe(first);
      expect(order).toEqual(['a', 'b', 'c']);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
      expect(infoMessages().filter((m) => m === 'Shutting down')).toHaveLength(1);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('contract 3 — a throwing step does not skip later ones', () => {
    // Synthetic credential marker (G112): the absence assertion needs a secret that can leak.
    const marker = 'pw-eof-hyg';
    const failureMessage = `connect ECONNREFUSED mqtt://u5er-eof:${marker}@broker.example:1883`;

    function makeFailure(): NodeJS.ErrnoException {
      const failure: NodeJS.ErrnoException = new Error(failureMessage);
      failure.code = 'ECONNREFUSED';
      return failure;
    }

    const cases: Array<[string, () => Promise<void> | void]> = [
      ['async rejection', async () => { throw makeFailure(); }],
      ['synchronous throw', () => { throw makeFailure(); }]
    ];

    it.each(cases)('%s: later steps run, exit 1, and the log names the step without the message', async (_label, failing) => {
      const order: string[] = [];
      const exit = vi.fn();
      const trigger = createShutdown({
        steps: [
          { name: 'a', run: () => { order.push('a'); } },
          { name: 'b', run: () => { order.push('b'); return failing(); } },
          { name: 'c', run: () => { order.push('c'); } }
        ],
        deadlineMs: 1000,
        exit,
        scheduler: createFakeScheduler()
      });

      await trigger('test');

      expect(order).toEqual(['a', 'b', 'c']);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('Shutdown step failed', undefined, {
        step: 'b',
        name: 'Error',
        code: 'ECONNREFUSED'
      });
      expect(infoSpy).toHaveBeenCalledWith('Shutdown complete', { failed: true });

      for (const spy of [infoSpy, warnSpy, errorSpy, consoleErrorSpy]) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(marker);
      }
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  it('contract 4 — the deadline names the pending step, exits 1 once, and stops the walk', async () => {
    const order: string[] = [];
    const scheduler = createFakeScheduler();
    const exit = vi.fn();
    const trigger = createShutdown({
      steps: [
        { name: 'a', run: () => { order.push('a'); } },
        { name: 'b', run: () => { order.push('b'); return new Promise<void>(() => {}); } },
        { name: 'c', run: () => { order.push('c'); } }
      ],
      deadlineMs: 1000,
      exit,
      scheduler
    });

    void trigger('test');
    await flush();
    expect(order).toEqual(['a', 'b']);
    expect(exit).not.toHaveBeenCalled();

    scheduler.fire();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(warnSpy).toHaveBeenCalledWith('Shutdown deadline reached', { pendingStep: 'b', deadlineMs: 1000 });

    await flush();
    expect(order).toEqual(['a', 'b']);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(infoMessages()).not.toContain('Shutdown complete');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('contract 5 — the deadline is armed with the configured value', async () => {
    const scheduler = createFakeScheduler();
    const trigger = createShutdown({ steps: [], deadlineMs: 1234, exit: vi.fn(), scheduler });

    await trigger('test');

    expect(scheduler.setTimeout).toHaveBeenCalledTimes(1);
    expect(scheduler.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1234);
  });

  // The deadline must hold the loop while teardown runs: a pending promise owns no handle, so an
  // unref'd deadline lets a handle-free hang drain to exit 0 (diff-review DR-M1). The process-level
  // proof is in tests/integration/stdio-shutdown.test.ts.
  it('contract 6 — the real deadline timer holds the process while teardown runs', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const exit = vi.fn();
    const trigger = createShutdown({
      steps: [{ name: 'never', run: () => new Promise<void>(() => {}) }],
      deadlineMs: 60_000,
      exit
    });

    void trigger('test');
    await flush();

    const handles = setTimeoutSpy.mock.results.map((r) => r.value as NodeJS.Timeout);
    try {
      expect(handles).toHaveLength(1);
      // Positive control: an unref'd timer in this environment reports false.
      const control = setTimeout(() => {}, 1e6).unref();
      try {
        expect(control.hasRef()).toBe(false);
      } finally {
        clearTimeout(control);
      }
      expect(handles[0].hasRef()).toBe(true);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      for (const handle of handles) {
        clearTimeout(handle);
      }
    }
  });

  it('contract 8 — the deadline fits inside the SDK client\'s 2000 ms grace before SIGTERM', () => {
    expect(SHUTDOWN_DEADLINE_MS).toBeGreaterThan(0);
    expect(SHUTDOWN_DEADLINE_MS).toBeLessThan(2000);
  });
});
