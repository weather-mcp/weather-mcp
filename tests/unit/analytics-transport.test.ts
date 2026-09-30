import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type https from 'node:https';
import { sendBatch, REQUEST_DEADLINE_MS } from '../../src/analytics/transport.js';
import { logger } from '../../src/utils/logger.js';
import type { AnalyticsEvent } from '../../src/analytics/types.js';

/**
 * The analytics upload's lifecycle (design plan `plan-analytics-transport-deadline` §1–§2):
 * one absolute deadline, settle once at the headers, the body discarded, and every way the
 * request can end settles it. The request is injected, so no socket is opened here; the one
 * contract that uses the real `https.request` (the defaults lock) meets `no-network.ts`'s
 * `EUNITNET`, which is an ordinary request error.
 */

const ENDPOINT = 'https://analytics.example/v1/events';
const HOST_SENTINEL = 'analytics.example';

const EVENTS: AnalyticsEvent[] = [
  {
    version: '0.0.0-test',
    tool: 'get_forecast',
    status: 'success',
    timestamp_hour: '2026-09-29T12:00:00.000Z',
    analytics_level: 'minimal',
  },
];

/** Node's `ClientRequest` as far as the transport uses it. */
class FakeRequest extends EventEmitter {
  write = vi.fn();
  end = vi.fn();
  destroyedWith: Error | undefined;
  destroy = vi.fn((err?: Error) => {
    this.destroyedWith = err;
    // The order probe variant B observed: 'error' (when given one), then 'close'.
    process.nextTick(() => {
      if (err) {
        this.emit('error', err);
      }
      this.emit('close');
    });
    return this;
  });
}

class FakeResponse extends EventEmitter {
  resume = vi.fn();
  constructor(public statusCode: number) {
    super();
  }
}

interface Harness {
  req: FakeRequest;
  options: () => https.RequestOptions;
  respond: (status: number) => FakeResponse;
  request: typeof https.request;
}

function harness(): Harness {
  const req = new FakeRequest();
  let captured: https.RequestOptions | undefined;
  let callback: ((res: FakeResponse) => void) | undefined;
  const request = ((options: https.RequestOptions, cb: (res: FakeResponse) => void) => {
    captured = options;
    callback = cb;
    return req;
  }) as unknown as typeof https.request;
  return {
    req,
    options: () => captured as https.RequestOptions,
    respond: (status) => {
      const res = new FakeResponse(status);
      callback?.(res);
      return res;
    },
    request,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Outcome = 'resolved' | 'rejected' | 'pending';
function track(p: Promise<void>): { outcome: () => Outcome; error: () => unknown } {
  let outcome: Outcome = 'pending';
  let error: unknown;
  p.then(
    () => {
      outcome = 'resolved';
    },
    (e) => {
      outcome = 'rejected';
      error = e;
    }
  );
  return { outcome: () => outcome, error: () => error };
}

let spies: {
  debug: ReturnType<typeof vi.spyOn>;
  info: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
  consoleLog: ReturnType<typeof vi.spyOn>;
};

function everyLoggedArgument(): string {
  return JSON.stringify(
    [spies.debug, spies.info, spies.warn, spies.error].flatMap((s) => s.mock.calls),
    (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v)
  );
}

beforeEach(() => {
  spies = {
    debug: vi.spyOn(logger, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(logger, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(logger, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(logger, 'error').mockImplementation(() => {}),
    consoleLog: vi.spyOn(console, 'log'),
  };
});

afterEach(() => {
  // Stdout is the MCP transport; nothing in the upload may write to it (G34: spy by identity).
  expect(spies.consoleLog).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('sendBatch', () => {
  it('contract 1 — a 2xx settles at the headers, with the body drained and never retained', async () => {
    const h = harness();
    const t = track(sendBatch(EVENTS, ENDPOINT, '0.0.0-test', { request: h.request, deadlineMs: 1000 }));
    const res = h.respond(200);
    await sleep(0);

    // No 'end' was ever emitted: the status line alone decided it.
    expect(t.outcome()).toBe('resolved');
    expect(res.resume).toHaveBeenCalledTimes(1);
    expect(res.listenerCount('data')).toBe(0);
    expect(res.listenerCount('error')).toBe(1);
    h.req.emit('close');
  });

  it('contract 2 — a non-2xx rejects, and the body is still drained', async () => {
    const h = harness();
    const t = track(sendBatch(EVENTS, ENDPOINT, '0.0.0-test', { request: h.request, deadlineMs: 1000 }));
    const res = h.respond(503);
    await sleep(0);

    expect(t.outcome()).toBe('rejected');
    expect((t.error() as Error).message).toBe('HTTP 503');
    expect(res.resume).toHaveBeenCalledTimes(1);
    expect(spies.warn).toHaveBeenCalledTimes(1);
    h.req.emit('close');
  });

  it('contract 3 — an error before the headers rejects once, and no log carries the hostname', async () => {
    const h = harness();
    const t = track(sendBatch(EVENTS, ENDPOINT, '0.0.0-test', { request: h.request, deadlineMs: 1000 }));
    h.req.emit(
      'error',
      Object.assign(new Error(`getaddrinfo ENOTFOUND ${HOST_SENTINEL}`), { code: 'ENOTFOUND' })
    );
    h.req.emit('close');
    await sleep(0);

    expect(t.outcome()).toBe('rejected');
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.warn.mock.calls[0][1]).toMatchObject({ code: 'ENOTFOUND', count: 1 });
    expect(everyLoggedArgument()).not.toContain(HOST_SENTINEL);
  });

  it('contract 4 — the deadline destroys a silent request and rejects exactly once', async () => {
    const h = harness();
    const t = track(sendBatch(EVENTS, ENDPOINT, '0.0.0-test', { request: h.request, deadlineMs: 50 }));
    await sleep(120);

    expect(t.outcome()).toBe('rejected');
    expect((t.error() as Error).message).toBe('Request deadline exceeded');
    expect(h.req.destroy).toHaveBeenCalledTimes(1);
    expect(h.req.destroyedWith?.message).toBe('Request deadline exceeded');
    expect(spies.warn).toHaveBeenCalledTimes(1);

    // The socket's own reset arrives after the deadline, as the probe showed. It changes nothing.
    h.req.emit('error', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    await sleep(0);
    expect(spies.warn).toHaveBeenCalledTimes(1);
  });

  it('contract 5 — the deadline bounds the drain after the promise has resolved', async () => {
    const h = harness();
    const t = track(sendBatch(EVENTS, ENDPOINT, '0.0.0-test', { request: h.request, deadlineMs: 50 }));
    h.respond(200);
    await sleep(0);
    expect(t.outcome()).toBe('resolved');
    expect(h.req.destroy).not.toHaveBeenCalled();

    // The body trickles and never closes: the deadline cuts it.
    await sleep(120);
    expect(h.req.destroy).toHaveBeenCalledTimes(1);
    expect(t.outcome()).toBe('resolved');
    expect(spies.warn).not.toHaveBeenCalled();
  });

  it('contract 6 — the deadline timer holds the process while the request is live, and is cleared on close', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const h = harness();
    const t = track(sendBatch(EVENTS, ENDPOINT, '0.0.0-test', { request: h.request, deadlineMs: 60_000 }));

    const armed = setTimeoutSpy.mock.calls
      .map((call, i) => ({ ms: call[1], handle: setTimeoutSpy.mock.results[i].value as NodeJS.Timeout }))
      .filter((c) => c.ms === 60_000);
    try {
      expect(armed).toHaveLength(1);
      // Positive control: an unref'd timer in this environment reports false.
      const control = setTimeout(() => {}, 1e6).unref();
      try {
        expect(control.hasRef()).toBe(false);
      } finally {
        clearTimeout(control);
      }
      expect(armed[0].handle.hasRef()).toBe(true);

      h.req.emit('close');
      expect(clearTimeoutSpy).toHaveBeenCalledWith(armed[0].handle);
      await sleep(0);
      expect(t.outcome()).toBe('rejected');
    } finally {
      for (const a of armed) {
        clearTimeout(a.handle);
      }
    }
  });

  it('contract 7 — a close with neither a response nor an error rejects once', async () => {
    const h = harness();
    const t = track(sendBatch(EVENTS, ENDPOINT, '0.0.0-test', { request: h.request, deadlineMs: 1000 }));
    h.req.emit('close');
    await sleep(0);

    expect(t.outcome()).toBe('rejected');
    expect(spies.warn).toHaveBeenCalledTimes(1);
  });

  it('contract 8 — no inactivity timer is configured; the absolute deadline is the only bound', () => {
    const h = harness();
    const t = track(sendBatch(EVENTS, ENDPOINT, '0.0.0-test', { request: h.request, deadlineMs: 1000 }));
    expect(h.options()).not.toHaveProperty('timeout');
    expect(h.req.listenerCount('timeout')).toBe(0);
    h.req.emit('close');
    void t;
  });

  it('contract 9 — the defaults: REQUEST_DEADLINE_MS and the real https.request', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    // The real request meets no-network.ts's EUNITNET, which is an ordinary request error.
    await expect(sendBatch(EVENTS, ENDPOINT, '0.0.0-test')).rejects.toMatchObject({ code: 'EUNITNET' });

    expect(setTimeoutSpy.mock.calls.some((c) => c[1] === REQUEST_DEADLINE_MS)).toBe(true);
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(everyLoggedArgument()).not.toContain(HOST_SENTINEL);
  });

  it('an empty batch makes no request', async () => {
    const request = vi.fn() as unknown as typeof https.request;
    await sendBatch([], ENDPOINT, '0.0.0-test', { request });
    expect(request).not.toHaveBeenCalled();
  });
});
