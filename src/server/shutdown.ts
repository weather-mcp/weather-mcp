/**
 * Shutdown coordinator: one bounded, run-once teardown for every way the stdio session can end.
 *
 * `src/index.ts` wires stdin `end`/`close`, `server.onclose`, `SIGTERM` and `SIGINT` to the one
 * trigger this module returns. The contracts:
 *
 * - **Run once.** The first trigger starts the run; every later trigger — including one fired from
 *   inside a step, as `server.close()` fires `server.onclose` — returns the same promise.
 * - **Every step runs, in order.** A step that throws is logged and does not skip the steps after it.
 * - **Bounded.** One deadline covers the whole run. When it fires, the pending step is named in a
 *   warning and the process exits 1. The deadline timer is deliberately **ref'd**: a pending
 *   promise holds no handle, so with an unref'd deadline a step that hangs without I/O would let
 *   the loop drain and exit 0 before the deadline fired. It exists only during teardown and is
 *   cleared when the walk completes, so it holds the process for at most `deadlineMs`.
 * - **Exit 0** when every step completed, **exit 1** when a step threw or the deadline fired.
 *   `exit` is called at most once.
 * - **Stderr only.** Everything goes through `logger`. After stdin EOF the client may already have
 *   closed stdout, and stdout is the protocol transport besides.
 */

import { logger } from '../utils/logger.js';

/**
 * The whole shutdown run's time budget.
 *
 * The binding constraint is the MCP SDK's own stdio client
 * (`@modelcontextprotocol/sdk/dist/esm/client/stdio.js`, `close()`): it ends the server's stdin,
 * waits 2000 ms, then sends `SIGTERM`. 1500 ms finishes inside that window with margin, and it is
 * several times the transport's normal teardown. Deliberately a constant, not an env var — an env
 * var is permanent and per-feature.
 */
export const SHUTDOWN_DEADLINE_MS = 1500;

export interface ShutdownStep {
  name: string;
  run: () => Promise<void> | void;
}

export interface ShutdownScheduler {
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export interface ShutdownDeps {
  steps: ReadonlyArray<ShutdownStep>;
  deadlineMs: number;
  /** `process.exit` in production. */
  exit: (code: number) => void;
  scheduler?: ShutdownScheduler;
}

const defaultScheduler: ShutdownScheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle)
};

export function createShutdown(deps: ShutdownDeps): (reason: string) => Promise<void> {
  const scheduler = deps.scheduler ?? defaultScheduler;
  let running: Promise<void> | undefined;
  let exited = false;

  const finish = (code: number): void => {
    if (exited) {
      return;
    }
    exited = true;
    deps.exit(code);
  };

  const run = async (reason: string): Promise<void> => {
    logger.info('Shutting down', { reason });

    let pending: string | undefined;
    const deadline = scheduler.setTimeout(() => {
      logger.warn('Shutdown deadline reached', { pendingStep: pending, deadlineMs: deps.deadlineMs });
      finish(1);
    }, deps.deadlineMs);

    let failed = false;
    for (const step of deps.steps) {
      if (exited) {
        return;
      }
      pending = step.name;
      try {
        await step.run();
      } catch (error) {
        failed = true;
        // Name and code only, never the message: the mqtt step's errors are mqtt's, and they
        // carry the broker host and port (the rule at `blitzortung.ts`'s connect-error log).
        const failure = error as NodeJS.ErrnoException;
        logger.error('Shutdown step failed', undefined, {
          step: step.name,
          name: failure?.name,
          code: failure?.code
        });
      }
    }
    pending = undefined;

    scheduler.clearTimeout(deadline);
    if (exited) {
      return;
    }
    logger.info('Shutdown complete', { failed });
    finish(failed ? 1 : 0);
  };

  return (reason: string): Promise<void> => {
    if (running) {
      return running;
    }
    // Deferred launch: `running = run(reason)` would evaluate `run` — synchronously, up to its
    // first `await` — before the assignment, so a first step that re-enters the trigger would see
    // an empty memo and start a second run. The microtask publishes the memo first.
    running = Promise.resolve().then(() => run(reason));
    return running;
  };
}
