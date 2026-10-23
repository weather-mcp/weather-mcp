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
 *   inner request. Whatever the inner adapter does afterwards is ignored (settle-once).
 * - The abort also releases a pending proxy socket. On an `https:` request that `proxy-from-env`
 *   routes through a proxy, the inner adapter receives `proxy: false` and a per-request tunnel
 *   agent (`proxyTunnel.ts`) hooked on **this** signal, so the deadline destroys the CONNECT socket
 *   that axios's bundled https-proxy-agent would hold until the proxy closed it. The hook is the
 *   signal, not the request: Node emits no event on a request destroyed before it has a socket.
 *   `proxy: false` is load-bearing: without it axios's `setProxy` (`lib/adapters/http.js`) swaps
 *   any non-https-proxy-agent `httpsAgent` for its own tunnel. A request with no timeout has no
 *   signal and keeps axios's own tunnel; every client in `src/` sets a timeout.
 * - A caller's own `signal` is chained in, and a caller's cancel stays axios's `ERR_CANCELED`.
 * - The deadline timer is ref'd (G114) and cleared on every settle path, with the caller-signal
 *   listener, so the timer itself holds a process for at most `timeout`.
 * - Inside a tool call the deadline is clamped to the call's remaining budget (`toolBudget.ts`,
 *   design plan `plan-tool-time-budget`): a request gets the smaller of its own `timeout` and the
 *   remainder, a request with no `timeout` of its own is bounded by the remainder, and a request
 *   that starts with the budget spent rejects at once with `timeout of 0ms exceeded`, without
 *   calling the inner adapter. Outside a tool call nothing here changes.
 *
 * This module reads no runtime axios export at module scope or in `withRequestDeadline()` itself
 * (the `proxyTunnel.js` and `toolBudget.js` imports are ours, not axios's):
 * thirteen unit-test mocks of `axios` expose only `create`, and they construct services that call
 * this at construction. Only the returned adapter, when a request runs, reads `axios.*`.
 *
 * Node 18 compatible: no `AbortSignal.any`, no `AbortSignal.timeout`.
 */

import axios from 'axios';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { createTunnelAgent, tunnelProxyFor } from './proxyTunnel.js';
import { remainingToolBudgetMs } from './toolBudget.js';

/** axios's `GenericAbortSignal` declares no `reason` and makes the listener methods optional. */
type ReasonedSignal = NonNullable<InternalAxiosRequestConfig['signal']> & {
  readonly reason?: unknown;
};

/** The abort reason that marks our own deadline, as distinct from a caller's cancel. */
const DEADLINE = Symbol('httpDeadline.deadline');

/**
 * The proxy to tunnel `config` through: an `https:` target, no caller `proxy`, and a proxy that
 * `proxy-from-env` selects. Anything else, including a URL that does not parse, is no tunnel.
 */
function tunnelProxy(config: InternalAxiosRequestConfig): URL | undefined {
  if (config.proxy !== undefined) {
    return undefined;
  }
  let href: string;
  try {
    href = new URL(config.url ?? '', config.baseURL).href;
  } catch {
    return undefined;
  }
  return href.startsWith('https:') ? tunnelProxyFor(href) : undefined;
}

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

    const own = config.timeout;
    const ownBounded = own !== undefined && Number.isFinite(own) && own > 0;
    const remaining = remainingToolBudgetMs();
    let timeout: number;
    if (remaining === undefined) {
      if (!ownBounded) {
        // axios semantics: no timeout means no deadline. Same config object, no new signal.
        return adapter(config);
      }
      timeout = own;
    } else {
      if (remaining <= 0) {
        // The tool call's budget is spent: fail before any socket, in the vocabulary every mapper reads.
        return Promise.reject(deadlineError(0, config));
      }
      // The clamp feeds this wrapper's timer and message only; `config.timeout` is never rewritten.
      timeout = ownBounded ? Math.min(own, Math.ceil(remaining)) : Math.ceil(remaining);
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
        const proxy = tunnelProxy(config);
        pending =
          proxy === undefined
            ? adapter({ ...config, signal: controller.signal })
            : adapter({
                ...config,
                signal: controller.signal,
                proxy: false,
                httpsAgent: createTunnelAgent(proxy, controller.signal)
              });
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
