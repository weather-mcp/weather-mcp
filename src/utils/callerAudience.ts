/**
 * Who receives the text of the current tool call: the machine's owner, or a
 * remote caller.
 *
 * The stdio entry has one caller, and that caller owns the machine: a file
 * path in an error helps them. The HTTP entry's callers are on other machines:
 * a host path or raw runtime error text tells them about a server they do not
 * run. The audience decides which text a caller-facing message carries.
 *
 * The audience travels in an `AsyncLocalStorage`, as the tool budget does
 * (`toolBudget.ts`), so no parameter is threaded through 17 handlers and a
 * composite tool's sections inherit it. The dispatch in
 * `src/server/weatherServer.ts` is the one writer.
 *
 * Outside a scope the answer is "local". That keeps every path that never
 * sets a scope — the stdio entry, a unit test, the lightning pre-warm — on the
 * text it had before this module existed.
 *
 * Pure: no I/O, no logging, no timer.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface CallerAudienceStore {
  remote: boolean;
}

const storage = new AsyncLocalStorage<CallerAudienceStore>();

/**
 * Run `fn` with the caller audience set. The store is installed synchronously,
 * before `fn` runs its first statement, and covers everything `fn` awaits.
 * `fn`'s value passes through; a throw or rejection propagates unchanged.
 */
export function runWithCallerAudience<T>(remote: boolean, fn: () => T): T {
  return storage.run({ remote }, fn);
}

/** True only inside a scope that was opened for a remote caller. */
export function isRemoteCaller(): boolean {
  return storage.getStore()?.remote === true;
}
