/**
 * Process guards: what the server does with an error nothing caught.
 *
 * Node's default for both events is to print the error and its stack to stderr
 * and exit 1. That is wrong here twice over. The raw text bypasses the log
 * rules (`src/utils/logger.ts`): a message can carry what a user typed and a
 * stack carries absolute paths. And the exit skips the bounded shutdown — on
 * the HTTP entry it ends the server for every caller because of one request.
 *
 * - **`unhandledRejection`: log and continue.** A promise nobody awaited has
 *   rejected. The work that owned it has failed, and the rest of the process
 *   is intact. Exiting would let any caller who can reach a floating rejection
 *   restart the HTTP server at will.
 * - **`uncaughtException`: log, then shut down and exit 1.** Node documents the
 *   process state as undefined after one. A throw inside the lightning feed's
 *   message handler can leave the strike buffer half-updated, and lightning is
 *   safety data. The entry runs its ordinary bounded shutdown and exits 1.
 *
 * Both lines go through `describeErrorForLogging`: the error's class and code,
 * and its message and stack only under `LOG_PII`. The `Error` is never passed
 * to `logger.error` as its second argument.
 *
 * This module registers two listeners and nothing else: no timer, no I/O, no
 * state. The entry owns the exit code, so `src/server/shutdown.ts` is unchanged.
 * `createHttpApp` registers nothing; each entry calls this once, in `main()`.
 */

import { describeErrorForLogging, logger } from '../utils/logger.js';

export interface ProcessGuardDeps {
  /** `process` in production. */
  emitter: Pick<NodeJS.Process, 'on'>;
  /**
   * Called once per uncaught exception, after it is logged. The entry marks
   * the run as crashed and starts its shutdown.
   */
  onFatal: (reason: string) => void;
}

export const UNHANDLED_REJECTION_LOG = 'Unhandled promise rejection';
export const UNCAUGHT_EXCEPTION_LOG = 'Uncaught exception';

export function installProcessGuards(deps: ProcessGuardDeps): void {
  deps.emitter.on('unhandledRejection', (reason: unknown) => {
    logger.error(UNHANDLED_REJECTION_LOG, undefined, {
      securityEvent: true,
      error: describeErrorForLogging(reason)
    });
  });

  deps.emitter.on('uncaughtException', (error: unknown) => {
    logger.error(UNCAUGHT_EXCEPTION_LOG, undefined, {
      securityEvent: true,
      error: describeErrorForLogging(error)
    });
    deps.onFatal('uncaughtException');
  });
}
