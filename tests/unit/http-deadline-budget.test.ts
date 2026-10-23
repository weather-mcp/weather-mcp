import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import https from 'node:https';
import { AxiosError, AxiosHeaders, CanceledError, isCancel } from 'axios';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { withRequestDeadline } from '../../src/utils/httpDeadline.js';
import { runWithToolBudget } from '../../src/utils/toolBudget.js';

/**
 * The request deadline under a tool call's budget (design plan `plan-tool-time-budget`, §2): inside
 * a budget the wrapper's deadline is the smaller of the request's own `timeout` and the remainder;
 * a request with no `timeout` is bounded by the remainder; a request that starts with the budget
 * spent rejects at once, without calling the inner adapter. The clamp feeds the wrapper's own timer
 * and message only — the inner config still carries the request's own `timeout`. Outside a budget
 * nothing changes; `http-deadline.test.ts` is that lock and this file does not import from it.
 *
 * Each budgeted row calls the adapter as the first statement of the run's `fn`, so the store is
 * read synchronously at adapter entry: a continuation reached through a faked timer would not
 * carry it.
 */

function makeConfig(extra: Partial<InternalAxiosRequestConfig> = {}): InternalAxiosRequestConfig {
  return {
    url: 'https://upstream.example/path',
    method: 'get',
    headers: new AxiosHeaders({ Accept: 'application/json' }),
    ...extra,
  } as InternalAxiosRequestConfig;
}

type Seen = { config?: InternalAxiosRequestConfig; error?: unknown };

/** Never settles and never reads its signal: the case that needs the race. */
function hangIgnoringSignal(seen: Seen = {}): AxiosAdapter {
  return (config) => {
    seen.config = config;
    return new Promise<AxiosResponse>(() => {});
  };
}

/** Never settles on its own; rejects with axios's CanceledError when its signal aborts. */
function axiosLike(seen: Seen = {}): AxiosAdapter {
  return (config) => {
    seen.config = config;
    return new Promise<AxiosResponse>((_resolve, reject) => {
      const cancel = (): void => {
        seen.error = new CanceledError(undefined, config);
        reject(seen.error);
      };
      if (config.signal?.aborted) {
        cancel();
        return;
      }
      config.signal?.addEventListener?.('abort', cancel, { once: true });
    });
  };
}

/** Observe a promise's state without awaiting it. */
function track<T>(p: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  p.then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    }
  );
  return state;
}

function okResponse(config: InternalAxiosRequestConfig): AxiosResponse {
  return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

let t = 0;
const clock = { now: () => t };

/** Run one request through `adapter` inside a 55 000 ms budget that started at t = 0. */
function inBudget(adapter: AxiosAdapter, config: InternalAxiosRequestConfig) {
  return track(runWithToolBudget(55_000, async () => adapter(config), clock));
}

describe('withRequestDeadline under a tool budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('(a) the own timeout is the smaller: rejects at 30 000 in axios timeout vocabulary', async () => {
    const config = makeConfig({ timeout: 30_000 });
    const state = inBudget(withRequestDeadline(hangIgnoringSignal()), config);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
    const err = state.error as AxiosError;
    expect(err).toBeInstanceOf(AxiosError);
    expect(err.code).toBe('ECONNABORTED');
    expect(err.message).toBe('timeout of 30000ms exceeded');
    expect(err.config).toBe(config);
    expect(isCancel(err)).toBe(false);
  });

  it('(b) the remainder is the smaller: rejects at 15 000, and the inner config keeps its own timeout', async () => {
    const seen: Seen = {};
    const config = makeConfig({ timeout: 30_000 });
    // The budget started at t = 0; the request starts 40 s into it.
    const run = runWithToolBudget(
      55_000,
      async () => {
        t = 40_000;
        return withRequestDeadline(hangIgnoringSignal(seen))(config);
      },
      clock
    );
    const state = track(run);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = state.error as AxiosError;
    expect(err).toBeInstanceOf(AxiosError);
    expect(err.code).toBe('ECONNABORTED');
    expect(err.message).toBe('timeout of 15000ms exceeded');
    expect(err.config).toBe(config);
    expect(seen.config?.timeout).toBe(30_000);
    expect(seen.config?.signal).toBeDefined();
  });

  it('(c) a request with no timeout of its own is bounded by the remainder', async () => {
    const seen: Seen = {};
    const config = makeConfig();
    const state = track(
      runWithToolBudget(
        55_000,
        async () => {
          t = 40_000;
          return withRequestDeadline(hangIgnoringSignal(seen))(config);
        },
        clock
      )
    );

    expect(seen.config).not.toBe(config);
    expect(seen.config?.signal).toBeDefined();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((state.error as AxiosError).message).toBe('timeout of 15000ms exceeded');
    expect((state.error as AxiosError).code).toBe('ECONNABORTED');
  });

  describe('(d) a spent budget fails at once, without calling the inner adapter', () => {
    for (const startAt of [55_000, 70_000]) {
      for (const [name, extra] of [
        ['with timeout', { timeout: 30_000 }],
        ['without timeout', {}],
      ] as const) {
        it(`t = ${startAt}, ${name}`, async () => {
          const inner = vi.fn(hangIgnoringSignal());
          const config = makeConfig(extra);
          const state = track(
            runWithToolBudget(
              55_000,
              async () => {
                t = startAt;
                return withRequestDeadline(inner)(config);
              },
              clock
            )
          );

          await flushMicrotasks();
          expect(state.settled).toBe(true);
          expect(inner).toHaveBeenCalledTimes(0);
          expect(vi.getTimerCount()).toBe(0);
          const err = state.error as AxiosError;
          expect(err).toBeInstanceOf(AxiosError);
          expect(err.code).toBe('ECONNABORTED');
          expect(err.message).toBe('timeout of 0ms exceeded');
          expect(err.config).toBe(config);
        });
      }
    }
  });

  it("(e) a caller's cancel passes through unchanged under a clamp, and the timer is cleared", async () => {
    const seen: Seen = {};
    const caller = new AbortController();
    const config = makeConfig({ timeout: 30_000, signal: caller.signal });
    const state = track(
      runWithToolBudget(
        55_000,
        async () => {
          t = 40_000;
          return withRequestDeadline(axiosLike(seen))(config);
        },
        clock
      )
    );
    setTimeout(() => caller.abort(), 5000);

    await vi.advanceTimersByTimeAsync(5000);
    expect(state.settled).toBe(true);
    expect(state.error).toBe(seen.error);
    expect(isCancel(state.error)).toBe(true);
    expect((state.error as AxiosError).code).toBe('ERR_CANCELED');
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('(f) control, outside any budget', () => {
    it('timeout: 3000 fires at 3000 and the inner config minus signal deep-equals the input', async () => {
      const seen: Seen = {};
      const config = makeConfig({ timeout: 3000 });
      const state = track(withRequestDeadline(hangIgnoringSignal(seen))(config));

      const { signal, ...rest } = seen.config as InternalAxiosRequestConfig;
      expect(signal).toBeDefined();
      expect(rest).toEqual(config);
      await vi.advanceTimersByTimeAsync(2999);
      expect(state.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((state.error as AxiosError).message).toBe('timeout of 3000ms exceeded');
    });

    it('no timeout: the same config object, no timer', () => {
      const seen: Seen = {};
      const config = makeConfig();
      withRequestDeadline(hangIgnoringSignal(seen))(config).catch(() => undefined);
      expect(seen.config).toBe(config);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('(g) the tunnel rides the clamped timer', () => {
    const PROXY_VARS = [
      'HTTPS_PROXY',
      'https_proxy',
      'ALL_PROXY',
      'all_proxy',
      'NO_PROXY',
      'no_proxy',
      'HTTP_PROXY',
      'http_proxy',
    ] as const;
    let savedEnv: Record<string, string | undefined>;

    beforeEach(() => {
      savedEnv = {};
      for (const name of PROXY_VARS) {
        savedEnv[name] = process.env[name];
        delete process.env[name];
      }
    });

    afterEach(() => {
      for (const name of PROXY_VARS) {
        const value = savedEnv[name];
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    });

    it('proxy: false, a TunnelAgent, and its signal aborts at 15 000', async () => {
      process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
      const seen: Seen = {};
      const config = makeConfig({ timeout: 30_000 });
      const state = track(
        runWithToolBudget(
          55_000,
          async () => {
            t = 40_000;
            return withRequestDeadline(hangIgnoringSignal(seen))(config);
          },
          clock
        )
      );

      const inner = seen.config;
      expect(inner?.proxy).toBe(false);
      const agent = inner?.httpsAgent as https.Agent;
      expect(agent).toBeInstanceOf(https.Agent);
      expect(agent.constructor.name).toBe('TunnelAgent');

      await vi.advanceTimersByTimeAsync(14_999);
      expect(inner?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(inner?.signal?.aborted).toBe(true);
      expect((state.error as AxiosError).message).toBe('timeout of 15000ms exceeded');
    });
  });

  it('(h) the budget is read per request: the second request after the budget is spent fails at once', async () => {
    let calls = 0;
    const inner: AxiosAdapter = (config) => {
      calls++;
      return Promise.resolve(okResponse(config));
    };
    const adapter = withRequestDeadline(inner);
    const first = makeConfig({ timeout: 30_000 });
    const second = makeConfig({ timeout: 30_000 });

    const state = track(
      runWithToolBudget(
        55_000,
        async () => {
          t = 50_000;
          const response = await adapter(first);
          expect(response.status).toBe(200);
          t = 56_000;
          return adapter(second);
        },
        clock
      )
    );

    await flushMicrotasks();
    expect(state.settled).toBe(true);
    expect(calls).toBe(1);
    const err = state.error as AxiosError;
    expect(err.code).toBe('ECONNABORTED');
    expect(err.message).toBe('timeout of 0ms exceeded');
    expect(err.config).toBe(second);
  });
});
