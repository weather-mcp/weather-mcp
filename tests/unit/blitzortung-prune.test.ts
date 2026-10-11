/**
 * Unit tests for the subscription prune and LRU eviction in `src/services/blitzortung.ts`:
 *
 *  1. a prune pass that throws does not escape `setInterval` (no `unhandledRejection`), warns once
 *     with name and code only, and the service keeps answering;
 *  2. the prune deletes its tracking BEFORE it unsubscribes, so a query that lands during the
 *     UNSUBACK round trip re-subscribes (and re-stamps coverage) instead of re-stamping a topic the
 *     broker is dropping;
 *  3. the same ordering holds on the LRU eviction path;
 *  4. a second prune tick while the first UNSUBACK is outstanding does not unsubscribe twice;
 *  5. no logger call on either unsubscribe-callback path, or on the catch, carries broker text,
 *     with `LOG_PII` unset and set.
 *
 * Mechanism: `vi.useFakeTimers()` BEFORE a fresh import of `blitzortung.js` and `logger.js` in one
 * `vi.resetModules()` epoch (G21, G133), so the constructor's prune `setInterval` lands on the fake
 * clock and fires. Time is driven only by `advanceTimersByTimeAsync` (never the run-all-timers variant:
 * the service's own intervals would re-queue it forever). Logger spies are installed before the
 * first query and never cleared (G123). The mocked `mqtt` module keeps the real package from
 * loading, because tests/setup/no-network.ts refuses every socket.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { setImmediate as nodeSetImmediate } from 'node:timers/promises';
import { calculateGeohashSubscriptions } from '../../src/utils/geohash.js';

// Local copy of the fake mqtt client in tests/unit/lightning-prewarm.test.ts (`createFakeMqttClient`).
function createFakeMqttClient() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const client = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(cb);
      if (event === 'connect') {
        queueMicrotask(() => cb());
      }
      return client;
    }),
    subscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => cb(null)),
    unsubscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => cb(null)),
    end: vi.fn((_force: boolean, _opts: unknown, cb: () => void) => cb()),
    emit(event: string, ...args: unknown[]) {
      (handlers[event] ?? []).forEach((h) => h(...args));
    }
  };
  return client;
}

/** A present `mqtt` module stub whose `connect()` returns the given fake client. */
function createPresentMqttModule(client: ReturnType<typeof createFakeMqttClient>) {
  const connect = vi.fn(() => client);
  return { esModule: { default: { connect } }, connect };
}

/**
 * Reset the registry and re-import blitzortung.js and logger.js in one epoch, WITHOUT touching
 * timer state: callers have already called `vi.useFakeTimers()`, so the constructor's prune
 * interval is on the fake clock, and they keep it on (lightning-prewarm.test.ts, same helper name).
 */
async function importFreshModulesKeepingTimers() {
  vi.resetModules();
  const blitzortungModule = await import('../../src/services/blitzortung.js');
  const loggerModule = await import('../../src/utils/logger.js');
  return { ...blitzortungModule, logger: loggerModule.logger };
}

// Exported by the service (blitzortung.ts:37 and :40); imported via the fresh module in each test.
type Fresh = Awaited<ReturnType<typeof importFreshModulesKeepingTimers>>;

/** Topics `subscribeToLocation` uses for one point at the given radius. */
function topicsFor(latitude: number, longitude: number, radiusKm: number): string[] {
  const geohashes = calculateGeohashSubscriptions(latitude, longitude, radiusKm);
  return Array.from(geohashes).map((g) => `blitzortung/1.1/${g.split('').join('/')}/#`);
}

/** One-geohash points at radius 100 km (lightning-prewarm.test.ts:438-439). */
const LOC_A = { latitude: -80, longitude: -174 };
const LOC_B = { latitude: -80, longitude: -168 };

/**
 * 60 points, each resolving to exactly ONE geohash at radius 100km, all mutually distinct
 * and disjoint from NINE_A/NINE_B/NINE_C's tiles. Used to fill the subscription cap to an
 * exact, known count one geohash at a time. The first point was moved off the antimeridian
 * (was lon -178): its 100km box crossed +/-180, so once subscriptions cross the seam it resolves to two
 * tiles (`01 pc`), and `pc` would have collided with the (-80, 170) fixture. The one-tile property was
 * an artefact of the old clamp.
 *
 * (Copied verbatim from lightning-prewarm-service.test.ts, where NINE_A/B/C are defined; importing
 * a test file would run its suites.)
 */
const SINGLES: Array<{ lat: number; lon: number }> = [
  { lat: -80, lon: -174 }, { lat: -80, lon: -168 }, { lat: -80, lon: -156 }, { lat: -80, lon: -146 },
  { lat: -80, lon: -134 }, { lat: -80, lon: -122 }, { lat: -80, lon: -112 }, { lat: -80, lon: -100 },
  { lat: -80, lon: -88 }, { lat: -80, lon: -78 }, { lat: -80, lon: -66 }, { lat: -80, lon: -56 },
  { lat: -80, lon: -44 }, { lat: -80, lon: -32 }, { lat: -80, lon: -22 }, { lat: -80, lon: -10 },
  { lat: -80, lon: 2 }, { lat: -80, lon: 12 }, { lat: -80, lon: 24 }, { lat: -80, lon: 34 },
  { lat: -80, lon: 46 }, { lat: -80, lon: 58 }, { lat: -80, lon: 68 }, { lat: -80, lon: 80 },
  { lat: -80, lon: 92 }, { lat: -80, lon: 102 }, { lat: -80, lon: 114 }, { lat: -80, lon: 124 },
  { lat: -80, lon: 136 }, { lat: -80, lon: 148 }, { lat: -80, lon: 158 }, { lat: -80, lon: 170 },
  { lat: -76, lon: -176 }, { lat: -76, lon: -168 }, { lat: -76, lon: -156 }, { lat: -76, lon: -146 },
  { lat: -76, lon: -134 }, { lat: -76, lon: -122 }, { lat: -76, lon: -112 }, { lat: -76, lon: -100 },
  { lat: -76, lon: -88 }, { lat: -76, lon: -78 }, { lat: -76, lon: -66 }, { lat: -76, lon: -56 },
  { lat: -76, lon: -44 }, { lat: -76, lon: -32 }, { lat: -76, lon: -22 }, { lat: -76, lon: -10 },
  { lat: -76, lon: 2 }, { lat: -76, lon: 12 }, { lat: -76, lon: 24 }, { lat: -76, lon: 34 },
  { lat: -76, lon: 46 }, { lat: -76, lon: 58 }, { lat: -76, lon: 68 }, { lat: -76, lon: 80 },
  { lat: -76, lon: 92 }, { lat: -76, lon: 102 }, { lat: -76, lon: 114 }, { lat: -76, lon: 124 }
];

const SENTINEL = 'SENTINEL-BROKER mqtt://sentinel.invalid:1883';

function sentinelError(): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(SENTINEL);
  e.code = 'ESENTINEL';
  return e;
}

type Query = { latitude: number; longitude: number };

function at(point: { lat: number; lon: number }): Query {
  return { latitude: point.lat, longitude: point.lon };
}

function startQuery(fresh: Fresh, p: Query) {
  return fresh.blitzortungService.getLightningStrikes(p.latitude, p.longitude, 100, 60);
}

/** A query, run to completion: start, cross the 10 s collection window, await. */
async function runQuery(fresh: Fresh, p: Query) {
  const pending = startQuery(fresh, p);
  await vi.advanceTimersByTimeAsync(10_000);
  return pending;
}

/** Sequential QUERY fill (shape of `fillWithQueries` in lightning-prewarm-service.test.ts): each
 *  call completes before the next starts, so stamps are strictly increasing. */
async function fillWithQueries(fresh: Fresh, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await runQuery(fresh, at(SINGLES[i]));
  }
}

/** Install the mqtt mock and fake timers, import fresh, and spy on every logger method before
 *  the first query (G123). Fake timers go on BEFORE the import (G133). */
async function setup() {
  const client = createFakeMqttClient();
  vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
  vi.useFakeTimers();
  const fresh = await importFreshModulesKeepingTimers();
  const spies = {
    debug: vi.spyOn(fresh.logger, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(fresh.logger, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(fresh.logger, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(fresh.logger, 'error').mockImplementation(() => {})
  };
  return { client, fresh, spies };
}

/** Hold every unsubscribe callback; release with `held.forEach(cb => cb(null))`. */
function holdUnsubscribes(client: ReturnType<typeof createFakeMqttClient>) {
  const held: Array<(error: Error | null) => void> = [];
  client.unsubscribe.mockImplementation((_topics: string[], cb: (error: Error | null) => void) => {
    held.push(cb);
  });
  return held;
}

/** Everything any logger method was called with, as one string. */
function allLogged(spies: Record<string, { mock: { calls: unknown[][] } }>): string {
  return JSON.stringify(
    Object.values(spies).flatMap((s) => s.mock.calls),
    (_key, value: unknown) =>
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value
  );
}

/** Let the rejection machinery run: a few nextTick hops. Mutation M1 showed any of microtasks,
 *  nextTick or setImmediate alone already exposes the unhandled rejection, because
 *  `advanceTimersByTimeAsync` yields; the hops are belt and braces for the not-called assertion. */
async function settleRejections(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => process.nextTick(resolve));
  }
}

const PRUNE_FAILED = 'Subscription prune pass failed';
const originalLogPii = process.env.LOG_PII;

afterEach(() => {
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalLogPii === undefined) {
    delete process.env.LOG_PII;
  } else {
    process.env.LOG_PII = originalLogPii;
  }
});

/** Idle threshold + one prune interval: the first tick at which a just-queried geohash is stale. */
function firstStaleTick(fresh: Fresh): number {
  return fresh.SUBSCRIPTION_IDLE_THRESHOLD_MS + fresh.SUBSCRIPTION_PRUNE_INTERVAL_MS;
}

describe('subscription prune and eviction (blitzortung.ts)', () => {
  it('contract 1: a throwing prune pass does not escape, warns once with name and code only, and the service keeps answering', async () => {
    const { client, fresh, spies } = await setup();
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      await runQuery(fresh, LOC_A);
      client.unsubscribe.mockImplementationOnce(() => {
        throw sentinelError();
      });

      await vi.advanceTimersByTimeAsync(firstStaleTick(fresh));
      await settleRejections();
      // A real-timer hop on top of the nextTick hops, from the real node:timers clock.
      await nodeSetImmediate();

      expect(client.unsubscribe).toHaveBeenCalledTimes(1);
      expect(onUnhandled).not.toHaveBeenCalled();

      // The plaintext-broker warn (blitzortung.ts:292) also lands on warnSpy: filter by message.
      const failed = spies.warn.mock.calls.filter((c) => c[0] === PRUNE_FAILED);
      expect(failed).toHaveLength(1);
      expect(failed[0][1]).toEqual({ name: 'Error', code: 'ESENTINEL', securityEvent: true });
      expect(failed[0][1]).not.toHaveProperty('message');
      expect(allLogged(spies)).not.toContain('SENTINEL-BROKER');

      // Still answering. The follow-up waits a 10 s collection window: start, advance, await.
      const strikes = await runQuery(fresh, LOC_B);
      expect(Array.isArray(strikes)).toBe(true);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('contract 2: a query during the prune UNSUBACK re-subscribes and its coverage starts at its own stamp', async () => {
    const { client, fresh } = await setup();
    const held = holdUnsubscribes(client);
    const topicA = topicsFor(LOC_A.latitude, LOC_A.longitude, 100);

    await runQuery(fresh, LOC_A);
    expect(client.subscribe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(firstStaleTick(fresh));
    expect(client.unsubscribe).toHaveBeenCalledTimes(1);
    expect(client.unsubscribe.mock.calls[0][0]).toEqual(topicA);
    expect(held).toHaveLength(1);

    // While the UNSUBACK is outstanding.
    const queryStamp = Date.now();
    const pending = startQuery(fresh, LOC_A);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(client.subscribe).toHaveBeenCalledTimes(2);
    expect(client.subscribe.mock.calls[1][0]).toEqual(topicA);
    expect(client.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      client.subscribe.mock.invocationCallOrder.at(-1)!
    );

    held.forEach((cb) => cb(null));
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    const coverage = fresh.blitzortungService.getCoverageStart(LOC_A.latitude, LOC_A.longitude, 100);
    expect(coverage).not.toBeNull();
    expect(coverage!.getTime()).toBe(queryStamp);
  });

  it('contract 3: a query during the eviction UNSUBACK re-subscribes the evicted geohash and its coverage starts at its own stamp', async () => {
    const { client, fresh } = await setup();
    await fillWithQueries(fresh, 50);
    expect(client.subscribe).toHaveBeenCalledTimes(50);
    expect(client.unsubscribe).not.toHaveBeenCalled();

    const held = holdUnsubscribes(client);
    const topicOldest = topicsFor(SINGLES[0].lat, SINGLES[0].lon, 100);

    // Query A: a new geohash at a full cap evicts SINGLES[0] and parks on the held UNSUBACK.
    const pendingA = startQuery(fresh, at(SINGLES[50]));
    await vi.advanceTimersByTimeAsync(100);
    expect(client.unsubscribe).toHaveBeenCalledTimes(1);
    expect(client.unsubscribe.mock.calls[0][0]).toEqual(topicOldest);

    // Query B for the evicted geohash, during the round trip. The subscription count is
    // deliberately NOT asserted against the cap: a concurrent query may claim the freed slot
    // (accepted soft-cap behaviour, plan "Recon notes").
    const queryStamp = Date.now();
    const pendingB = startQuery(fresh, at(SINGLES[0]));
    await vi.advanceTimersByTimeAsync(1_000);

    const subscribedTopics = client.subscribe.mock.calls.slice(50).flatMap((c) => c[0] as string[]);
    expect(subscribedTopics).toEqual(expect.arrayContaining(topicOldest));
    const bSubscribeIndex = client.subscribe.mock.calls.findIndex(
      (c, i) => i >= 50 && (c[0] as string[]).some((t) => topicOldest.includes(t))
    );
    expect(bSubscribeIndex).toBeGreaterThanOrEqual(50);
    expect(client.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      client.subscribe.mock.invocationCallOrder[bSubscribeIndex]
    );

    held.forEach((cb) => cb(null));
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([pendingA, pendingB]);

    const coverage = fresh.blitzortungService.getCoverageStart(SINGLES[0].lat, SINGLES[0].lon, 100);
    expect(coverage).not.toBeNull();
    expect(coverage!.getTime()).toBe(queryStamp);
  });

  it('contract 4: a second prune tick while the first UNSUBACK is outstanding does not unsubscribe twice', async () => {
    const { client, fresh } = await setup();
    await runQuery(fresh, LOC_A);
    await runQuery(fresh, LOC_B);
    holdUnsubscribes(client); // never released

    await vi.advanceTimersByTimeAsync(
      fresh.SUBSCRIPTION_IDLE_THRESHOLD_MS + 2 * fresh.SUBSCRIPTION_PRUNE_INTERVAL_MS
    );

    const unsubscribed = client.unsubscribe.mock.calls.flatMap((c) => c[0] as string[]);
    for (const topic of [
      ...topicsFor(LOC_A.latitude, LOC_A.longitude, 100),
      ...topicsFor(LOC_B.latitude, LOC_B.longitude, 100)
    ]) {
      expect(unsubscribed.filter((t) => t === topic)).toHaveLength(1);
    }
  });

  describe.each([
    { label: 'LOG_PII unset', pii: undefined },
    { label: 'LOG_PII=true', pii: 'true' }
  ])('contract 5: logs carry no broker text ($label)', ({ pii }) => {
    function applyPii(): void {
      if (pii === undefined) {
        delete process.env.LOG_PII;
      } else {
        process.env.LOG_PII = pii;
      }
    }

    it('(a) the prune unsubscribe callback error', async () => {
      applyPii();
      const { client, fresh, spies } = await setup();
      await runQuery(fresh, LOC_A);
      client.unsubscribe.mockImplementation((_t: string[], cb: (error: Error | null) => void) => cb(sentinelError()));

      await vi.advanceTimersByTimeAsync(firstStaleTick(fresh));

      const warns = spies.warn.mock.calls.filter((c) => c[0] === 'Failed to unsubscribe from stale topics');
      expect(warns).toHaveLength(1);
      const meta = warns[0][1] as Record<string, unknown>;
      expect(meta).toMatchObject({ name: 'Error', code: 'ESENTINEL' });
      expect(meta).not.toHaveProperty('error');
      expect(meta).not.toHaveProperty('message');
      expect(allLogged(spies)).not.toContain('SENTINEL-BROKER');
    });

    it('(b) the eviction unsubscribe callback error', async () => {
      applyPii();
      const { client, fresh, spies } = await setup();
      await fillWithQueries(fresh, 50);
      client.unsubscribe.mockImplementation((_t: string[], cb: (error: Error | null) => void) => cb(sentinelError()));

      await runQuery(fresh, at(SINGLES[50]));

      const warns = spies.warn.mock.calls.filter((c) => c[0] === 'Failed to unsubscribe from topics');
      expect(warns).toHaveLength(1);
      const meta = warns[0][1] as Record<string, unknown>;
      expect(meta).toMatchObject({ name: 'Error', code: 'ESENTINEL' });
      expect(meta).not.toHaveProperty('error');
      expect(meta).not.toHaveProperty('message');
      expect(allLogged(spies)).not.toContain('SENTINEL-BROKER');
    });

    it('(c) the synchronous throw from unsubscribe', async () => {
      applyPii();
      const { client, fresh, spies } = await setup();
      const onUnhandled = vi.fn();
      process.on('unhandledRejection', onUnhandled);
      try {
        await runQuery(fresh, LOC_A);
        client.unsubscribe.mockImplementationOnce(() => {
          throw sentinelError();
        });

        await vi.advanceTimersByTimeAsync(firstStaleTick(fresh));
        await settleRejections();
        await nodeSetImmediate();

        expect(onUnhandled).not.toHaveBeenCalled();
        expect(spies.warn.mock.calls.filter((c) => c[0] === PRUNE_FAILED)).toHaveLength(1);
        expect(allLogged(spies)).not.toContain('SENTINEL-BROKER');
      } finally {
        process.removeListener('unhandledRejection', onUnhandled);
      }
    });
  });
});
