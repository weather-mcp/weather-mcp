/**
 * A wall-clock deadline for every axios request.
 *
 * Lifecycle contract (design plan `plan-http-request-deadline`):
 * - One absolute deadline bounds the whole request — connect, the proxy CONNECT, TLS, headers and
 *   the body. axios's own `timeout` is a socket-inactivity timer on the follow-redirects transport,
 *   and follow-redirects arms it only on the request's `socket` event, which a CONNECT-tunnel
 *   agent emits only after the proxy answers. Behind a proxy that never answers, or resets, the
 *   request would never settle.
 * - The deadline reports itself in axios's own timeout vocabulary — code `ECONNABORTED`, message
 *   `timeout of <N>ms exceeded`, the request's `config` — so every service's error mapper and
 *   `isTransientFailure` read it as the timeout they already handle, and no mapper changes (G138).
 *   It always emits `ECONNABORTED`: nothing here sets `timeoutErrorMessage` or
 *   `transitional.clarifyTimeoutError`, so neither is honoured.
 * - It races the inner adapter rather than only signalling it (G148): the promise settles at the
 *   deadline whether or not the inner adapter honours the abort, and the abort then releases the
 *   inner request's socket. Whatever the inner adapter does afterwards is ignored (settle-once).
 * - A caller's own `signal` is chained in, and a caller's cancel stays axios's `ERR_CANCELED`.
 * - The deadline timer is ref'd (G114) and cleared on every settle path, with the caller-signal
 *   listener, so it holds a process for at most `timeout`.
 *
 * This module reads no runtime axios export at module scope or in `withRequestDeadline()` itself:
 * thirteen unit-test mocks of `axios` expose only `create`, and they construct services that call
 * this at construction. Only the returned adapter, when a request runs, reads `axios.*`.
 *
 * Node 18 compatible: no `AbortSignal.any`, no `AbortSignal.timeout`.
 */

import axios from 'axios';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

/** axios's `GenericAbortSignal` declares no `reason` and makes the listener methods optional. */
type ReasonedSignal = NonNullable<InternalAxiosRequestConfig['signal']> & {
  readonly reason?: unknown;
};

/** The abort reason that marks our own deadline, as distinct from a caller's cancel. */
const DEADLINE = Symbol('httpDeadline.deadline');

function deadlineError(timeout: number, config: InternalAxiosRequestConfig, request?: unknown) {
  return new axios.AxiosError(
    'timeout of ' + timeout + 'ms exceeded',
    'ECONNABORTED',
    config,
    request
  );
}

/**
 * Wrap an axios adapter with a wall-clock deadline of the merged config's `timeout`. With no
 * `inner`, the adapter resolves axios's default on the first request and memoises it.
 */
export function withRequestDeadline(inner?: AxiosAdapter): AxiosAdapter {
  let resolved: AxiosAdapter | undefined = inner;

  return (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    if (resolved === undefined) {
      resolved = axios.getAdapter(axios.defaults.adapter);
    }
    const adapter = resolved;

    const timeout = config.timeout;
    if (timeout === undefined || !Number.isFinite(timeout) || timeout <= 0) {
      // axios semantics: no timeout means no deadline. Same config object, no new signal.
      return adapter(config);
    }

    const controller = new AbortController();
    const callerSignal = config.signal as ReasonedSignal | undefined;
    const onCallerAbort = (): void => {
      controller.abort(callerSignal?.reason);
    };
    if (callerSignal?.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal?.addEventListener?.('abort', onCallerAbort, { once: true });
    }

    return new Promise<AxiosResponse>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        clearTimeout(timer);
        callerSignal?.removeEventListener?.('abort', onCallerAbort);
      };

      // Ref'd on purpose, G114: on a reset CONNECT nothing else holds the loop.
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(deadlineError(timeout, config));
        controller.abort(DEADLINE);
      }, timeout);

      let pending: Promise<AxiosResponse>;
      try {
        pending = adapter({ ...config, signal: controller.signal });
      } catch (err) {
        pending = Promise.reject(err);
      }

      pending.then(
        (response) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(response);
        },
        (err: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          // Unreachable while the race above settles first; kept so a future reordering cannot
          // leak axios's ERR_CANCELED for our own deadline.
          if (axios.isCancel(err) && controller.signal.reason === DEADLINE) {
            const request = (err as { request?: unknown }).request;
            reject(deadlineError(timeout, config, request));
            return;
          }
          reject(err);
        }
      );
    });
  };
}
