/**
 * One wall-clock budget per tool call.
 *
 * A tool call can start many requests, one after another or fanned out. Each
 * request has its own deadline (`httpDeadline.ts`), so the calls together can
 * outlast the client. The budget is the single instant by which the whole tool
 * call must have answered: `max(API_TIMEOUT_MS, 55 000)` ms after it starts.
 *
 * The budget travels in an `AsyncLocalStorage`. Every request a tool call
 * starts can read it at the HTTP seam, so no parameter is threaded through 17
 * handlers and 20 services.
 *
 * Why `max`: an operator who sets `API_TIMEOUT_MS` above the floor asked for
 * longer requests, and the budget must not cut them short. Why 55 000: the
 * MCP SDK abandons a request after `DEFAULT_REQUEST_TIMEOUT_MSEC` (60 000,
 * `protocol.js:8`). The 5 s margin lets the server answer first.
 *
 * Why monotonic: the clock defaults to `performance.now`, as `RequestSpacer`
 * does. Only differences are compared, so a system-clock correction cannot
 * stretch or shrink the budget.
 *
 * This module arms no timer of its own. It holds a deadline instant, not a
 * timer. The per-request deadline, clamped to the remainder, does the
 * aborting (G114).
 *
 * A nested run replaces the budget for its own scope (`AsyncLocalStorage`
 * semantics). Nothing nests today.
 *
 * Pure and I/O-free apart from the injected clock.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** The SDK's 60 000 ms request timeout, less a 5 s margin. */
export const TOOL_BUDGET_FLOOR_MS = 55_000;

export interface ToolBudgetDeps {
  /**
   * Monotonic clock in ms. Defaults to `() => performance.now()`, looked up
   * at call time so a spy installed after import is seen.
   */
  now?: () => number;
}

interface ToolBudgetStore {
  deadlineAt: number;
  now: () => number;
}

const storage = new AsyncLocalStorage<ToolBudgetStore>();

/**
 * The budget for one tool call: the larger of the configured API timeout and
 * the floor. A non-finite or non-positive input gives the floor.
 */
export function toolBudgetMs(apiTimeoutMs: number): number {
  if (!Number.isFinite(apiTimeoutMs) || apiTimeoutMs <= 0) {
    return TOOL_BUDGET_FLOOR_MS;
  }
  return Math.max(apiTimeoutMs, TOOL_BUDGET_FLOOR_MS);
}

/**
 * Run `fn` with a budget of `budgetMs` starting now. The store is installed
 * synchronously, before `fn` runs its first statement. `fn`'s value passes
 * through and its rejection propagates as the same object.
 */
export function runWithToolBudget<T>(
  budgetMs: number,
  fn: () => Promise<T>,
  deps: ToolBudgetDeps = {}
): Promise<T> {
  const now = deps.now ?? (() => performance.now());
  const store: ToolBudgetStore = { deadlineAt: now() + budgetMs, now };
  return storage.run(store, fn);
}

/**
 * Milliseconds left in the current tool call's budget, or `undefined` outside
 * a run. Never negative: `0` means spent.
 */
export function remainingToolBudgetMs(): number | undefined {
  const store = storage.getStore();
  if (store === undefined) return undefined;
  return Math.max(0, store.deadlineAt - store.now());
}
