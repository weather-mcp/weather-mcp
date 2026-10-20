import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEventListeners } from 'node:events';
import { AxiosError, AxiosHeaders, CanceledError, isCancel } from 'axios';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { withRequestDeadline } from '../../src/utils/httpDeadline.js';

/**
 * The request-deadline adapter's contract (design plan `plan-http-request-deadline`, Verification):
 * one wall-clock deadline at the merged config's `timeout`, raced against the inner adapter and
 * reported in axios's own timeout vocabulary; no deadline at `timeout: 0`; a caller's cancel passes
 * through unchanged; every settle path clears its timer and its listener. The inner adapter is
 * injected, so this file needs no `axios` mock and opens no socket.
 */

function makeConfig(extra: Partial<InternalAxiosRequestConfig> = {}): InternalAxiosRequestConfig {
  return {
    url: 'https://upstream.example/path',
    method: 'get',
    headers: new AxiosHeaders({ Accept: 'application/json' }),
    ...extra,
  } as InternalAxiosRequestConfig;
}

type Seen = { config?: InternalAxiosRequestConfig; abortedAtEntry?: boolean };

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
    seen.abortedAtEntry = config.signal?.aborted === true;
    return new Promise<AxiosResponse>((_resolve, reject) => {
      const cancel = (): void => reject(new CanceledError(undefined, config));
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

describe('withRequestDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('(a) rejects at exactly timeout with axios timeout vocabulary', () => {
    for (const [name, make] of [
      ['hangIgnoringSignal (the race)', hangIgnoringSignal],
      ['axiosLike (no ERR_CANCELED leaks)', axiosLike],
    ] as const) {
      it(name, async () => {
        const config = makeConfig({ timeout: 3000 });
        const state = track(withRequestDeadline(make())(config));

        await vi.advanceTimersByTimeAsync(2999);
        expect(state.settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(state.settled).toBe(true);
        const err = state.error as AxiosError;
        expect(err).toBeInstanceOf(AxiosError);
        expect(err.name).toBe('AxiosError');
        expect(err.code).toBe('ECONNABORTED');
        expect(err.message).toBe('timeout of 3000ms exceeded');
        expect(err.config).toBe(config);
        expect(isCancel(err)).toBe(false);
      });
    }
  });

  it('(b) reads the merged config: a per-request timeout of 500 fires at 500', async () => {
    const adapter = withRequestDeadline(hangIgnoringSignal());
    const short = track(adapter(makeConfig({ timeout: 500 })));
    const long = track(adapter(makeConfig({ timeout: 3000 })));

    await vi.advanceTimersByTimeAsync(499);
    expect(short.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((short.error as AxiosError).message).toBe('timeout of 500ms exceeded');
    expect(long.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2500);
    expect((long.error as AxiosError).message).toBe('timeout of 3000ms exceeded');
  });

  describe('(c) no deadline when timeout is 0 or absent', () => {
    for (const [name, extra] of [
      ['timeout: 0', { timeout: 0 }],
      ['timeout absent', {}],
    ] as const) {
      it(name, async () => {
        const seen: Seen = {};
        const config = makeConfig(extra);
        const state = track(withRequestDeadline(hangIgnoringSignal(seen))(config));

        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(state.settled).toBe(false);
        expect(seen.config).toBe(config);
        expect(seen.config?.signal).toBeUndefined();
      });
    }
  });

  it('(d) a caller abort mid-flight passes the same CanceledError through', async () => {
    const seen: Seen = {};
    const caller = new AbortController();
    const reason = new Error('caller deadline');
    let thrown: unknown;
    const inner: AxiosAdapter = (config) =>
      axiosLike(seen)(config).catch((err: unknown) => {
        thrown = err;
        throw err;
      });
    const state = track(
      withRequestDeadline(inner)(makeConfig({ timeout: 3000, signal: caller.signal }))
    );

    await vi.advanceTimersByTimeAsync(100);
    caller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);

    expect(state.settled).toBe(true);
    expect(state.error).toBe(thrown);
    expect((state.error as CanceledError<unknown>).code).toBe('ERR_CANCELED');
    expect(caller.signal.aborted).toBe(true);
    expect((seen.config?.signal as AbortSignal).reason).toBe(reason);
  });

  it('(e) a caller signal already aborted at entry reaches the inner aborted', async () => {
    const seen: Seen = {};
    const caller = new AbortController();
    caller.abort();
    const state = track(
      withRequestDeadline(axiosLike(seen))(makeConfig({ timeout: 3000, signal: caller.signal }))
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(seen.abortedAtEntry).toBe(true);
    expect((state.error as CanceledError<unknown>).code).toBe('ERR_CANCELED');
  });

  describe('(f) cleanup on every settle path', () => {
    it('after a resolved request', async () => {
      const caller = new AbortController();
      const inner: AxiosAdapter = (config) => Promise.resolve(okResponse(config));
      const res = await withRequestDeadline(inner)(
        makeConfig({ timeout: 3000, signal: caller.signal })
      );
      expect(res.status).toBe(200);
      expect(vi.getTimerCount()).toBe(0);
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    });

    it('after a non-cancel inner rejection, passed through by identity', async () => {
      const caller = new AbortController();
      const config = makeConfig({ timeout: 3000, signal: caller.signal });
      const reset = new AxiosError('x', 'ECONNRESET', config);
      const inner: AxiosAdapter = () => Promise.reject(reset);
      await expect(withRequestDeadline(inner)(config)).rejects.toBe(reset);
      expect(vi.getTimerCount()).toBe(0);
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    });

    it('after a deadline rejection', async () => {
      const caller = new AbortController();
      const state = track(
        withRequestDeadline(hangIgnoringSignal())(
          makeConfig({ timeout: 3000, signal: caller.signal })
        )
      );
      await vi.advanceTimersByTimeAsync(3000);
      expect((state.error as AxiosError).code).toBe('ECONNABORTED');
      expect(vi.getTimerCount()).toBe(0);
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    });

    it('after an inner adapter that throws synchronously', async () => {
      const boom = new Error('sync');
      const inner: AxiosAdapter = () => {
        throw boom;
      };
      await expect(withRequestDeadline(inner)(makeConfig({ timeout: 3000 }))).rejects.toBe(boom);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('(g) settles once: the inner CanceledError after the deadline changes nothing', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      let innerSettled = false;
      const inner: AxiosAdapter = (config) => {
        const p = axiosLike()(config);
        p.catch(() => {
          innerSettled = true;
        });
        return p;
      };
      const state = track(withRequestDeadline(inner)(makeConfig({ timeout: 3000 })));
      await vi.advanceTimersByTimeAsync(3000);

      expect(innerSettled).toBe(true);
      expect((state.error as AxiosError).code).toBe('ECONNABORTED');
      expect(isCancel(state.error)).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('(h) positive control: the stub alone, unwrapped, is still pending at 2x timeout', async () => {
    const state = track(hangIgnoringSignal()(makeConfig({ timeout: 3000 })));
    await vi.advanceTimersByTimeAsync(6000);
    expect(state.settled).toBe(false);
  });

  it('(i) the inner config deep-equals the input on every key except signal', async () => {
    const seen: Seen = {};
    const config = makeConfig({ timeout: 3000, params: { lat: 1, lon: 2 }, maxRedirects: 5 });
    track(withRequestDeadline(hangIgnoringSignal(seen))(config));

    const { signal, ...rest } = seen.config as InternalAxiosRequestConfig;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(rest).toEqual(config);
    expect(config.signal).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3000);
  });

  describe('(j) a minimal axios-compatible signal with no listener methods and no reason', () => {
    it('not aborted: does not throw, and the deadline still fires', async () => {
      const state = track(
        withRequestDeadline(hangIgnoringSignal())(
          makeConfig({ timeout: 3000, signal: { aborted: false } })
        )
      );
      await vi.advanceTimersByTimeAsync(3000);
      expect((state.error as AxiosError).code).toBe('ECONNABORTED');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('aborted: the inner sees its injected signal already aborted', async () => {
      const seen: Seen = {};
      const state = track(
        withRequestDeadline(axiosLike(seen))(
          makeConfig({ timeout: 3000, signal: { aborted: true } })
        )
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(seen.abortedAtEntry).toBe(true);
      expect((state.error as CanceledError<unknown>).code).toBe('ERR_CANCELED');
    });
  });
});
