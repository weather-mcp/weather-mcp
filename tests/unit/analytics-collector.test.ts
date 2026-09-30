import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalyticsCollector } from '../../src/analytics/collector.js';
import { logger } from '../../src/utils/logger.js';
import type { sendBatch } from '../../src/analytics/transport.js';
import type { AnalyticsConfig } from '../../src/analytics/types.js';

/**
 * The collector's half of the analytics deadline (design plan `plan-analytics-transport-deadline`
 * §3-§5): the per-flush deadline is passed down to the transport, a rejected send counts toward the
 * breaker, and the failure log never carries the rejection's message. The transport is injected,
 * so no socket is opened here and neither `config.ts` nor `index.ts` is imported.
 */

const HOST_SENTINEL = 'analytics.example';

const CONFIG: AnalyticsConfig = {
  enabled: true,
  level: 'minimal',
  endpoint: `https://${HOST_SENTINEL}/v1/events`,
  version: '0.0.0-test',
  salt: 'analytics-collector-test',
};

type SendBatch = typeof sendBatch;

/** The fourth argument of the nth `sendBatch` call, typed as the options object. */
function optionsOf(fake: ReturnType<typeof vi.fn>, call = 0): { deadlineMs?: number } {
  return fake.mock.calls[call][3] as { deadlineMs?: number };
}

describe('AnalyticsCollector transport seam', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    expect(consoleSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  function build(fake: SendBatch | ReturnType<typeof vi.fn>): AnalyticsCollector {
    return new AnalyticsCollector(CONFIG, { sendBatch: fake as SendBatch });
  }

  async function track(collector: AnalyticsCollector): Promise<void> {
    await collector.trackToolCall('get_forecast', 'success');
  }

  it('1. the deadline reaches the transport', async () => {
    const fake = vi.fn().mockResolvedValue(undefined);
    const collector = build(fake);
    try {
      await track(collector);
      await collector.shutdown({ deadlineMs: 321 });
      expect(fake).toHaveBeenCalledTimes(1);
      expect(optionsOf(fake).deadlineMs).toBe(321);
    } finally {
      await collector.shutdown();
    }
  });

  it('2. no option means no deadline override', async () => {
    const fake = vi.fn().mockResolvedValue(undefined);
    const collector = build(fake);
    try {
      await track(collector);
      await collector.flush();
      expect(fake).toHaveBeenCalledTimes(1);
      expect(optionsOf(fake).deadlineMs).toBeUndefined();
    } finally {
      await collector.shutdown();
    }
  });

  it('3. shutdown settles within its deadline against a transport that settles only on its own deadline', async () => {
    // Honours the contract T1 proved: never settles until it has seen its own deadline.
    const fake = vi.fn((_events: unknown, _endpoint: unknown, _version: unknown, options?: { deadlineMs?: number }) => {
      if (options?.deadlineMs === undefined) {
        return new Promise<void>(() => {});
      }
      return new Promise<void>((_resolve, reject) => {
        setTimeout(() => reject(new Error('deadline')), options.deadlineMs);
      });
    });
    const collector = build(fake);
    try {
      await track(collector);
      const outcome = await Promise.race([
        collector.shutdown({ deadlineMs: 50 }).then(() => 'settled'),
        new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 500)),
      ]);
      expect(outcome).toBe('settled');
    } finally {
      await collector.shutdown();
    }
  });

  it('4. a rejected send counts toward the breaker', async () => {
    const fake = vi.fn().mockRejectedValue(new Error('boom'));
    const collector = build(fake);
    try {
      for (let i = 0; i < 4; i++) {
        await track(collector);
        await collector.flush();
      }
      expect(errorSpy).not.toHaveBeenCalledWith(
        'Analytics circuit breaker opened',
        expect.anything(),
        expect.anything()
      );
      await track(collector);
      await collector.flush();
      expect(fake).toHaveBeenCalledTimes(5);
      expect(errorSpy.mock.calls.filter((c: unknown[]) => c[0] === 'Analytics circuit breaker opened')).toHaveLength(1);
    } finally {
      await collector.shutdown();
    }
  });

  it('5. shutdown is idempotent and flushes once', async () => {
    const fake = vi.fn().mockResolvedValue(undefined);
    const collector = build(fake);
    try {
      await track(collector);
      await collector.shutdown();
      await collector.shutdown();
      expect(fake).toHaveBeenCalledTimes(1);
    } finally {
      await collector.shutdown();
    }
  });

  it('6. a rejected send cannot re-log its endpoint', async () => {
    const rejection = Object.assign(new Error(`getaddrinfo ENOTFOUND ${HOST_SENTINEL}`), {
      code: 'ENOTFOUND',
    });
    const fake = vi.fn().mockRejectedValue(rejection);
    const collector = build(fake);
    try {
      // The scan covers construction too: no analytics log line carries the endpoint.
      await track(collector);
      await collector.flush();

      const failed = warnSpy.mock.calls.find((c: unknown[]) => c[0] === 'Analytics batch send failed');
      expect(failed).toBeDefined();
      expect(failed?.[1]).toMatchObject({ code: 'ENOTFOUND' });

      const everything = [warnSpy, errorSpy, infoSpy, debugSpy]
        .flatMap((spy) => spy.mock.calls)
        .map((c) => JSON.stringify(c))
        .join('\n');
      expect(everything).not.toContain(HOST_SENTINEL);
    } finally {
      await collector.shutdown();
    }
  });
});
