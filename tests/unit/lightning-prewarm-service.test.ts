/**
 * Unit tests for the pre-warm capacity/coverage contract added in commit 5c3e22f
 * (issue #81, T1): `prewarmLocation` must never evict an existing subscription to make
 * room for itself, must skip a location whole (stamping nothing) when it does not fully
 * fit, must never open a second MQTT client while mqtt.js is already reconnecting one,
 * must be a silent no-op network call when everything it needs is already subscribed,
 * and two concurrent pre-warms must not jointly push the subscription count past the cap.
 * The query path (prewarm undefined) is explicitly NOT changed by that commit, and
 * contract 2 here pins that it still evicts.
 *
 * Mechanism: `vi.doMock('mqtt', ...)` + `vi.resetModules()` + a fresh dynamic
 * `import('../../src/services/blitzortung.js')` per test (the pattern in
 * tests/unit/mqtt-optional.test.ts and tests/unit/lightning-feed-outage.test.ts), so the
 * subscription maps, the mqtt module memo, and the constructor's two setIntervals all
 * start fresh. Nothing here reaches a real broker or the real `mqtt` package.
 *
 * Geometry: `calculateGeohashSubscriptions` (src/utils/geohash.ts) was probed empirically
 * (never assumed) to find:
 *   - 60 points (`SINGLES` below) that each resolve to exactly ONE geohash at radius
 *     100 km, all mutually distinct and none colliding with the reserved areas below —
 *     used to fill the subscription cap to an exact, known count one geohash at a time.
 *   - Two 9-geohash areas at radius 175 km, `NINE_A` and `NINE_B`, whose geohash sets are
 *     disjoint from each other and from every SINGLES tile — used for the "whole location"
 *     pre-warm contracts and the concurrent-overflow contract.
 *   - A third 9-geohash area, `NINE_C`, one of whose nine tiles ('1p5') is *also* produced,
 *     alone, by `SHARED_OLD` at a much smaller radius (40 km, same geohash string, exact
 *     precision match) — used for contract 3's overlap case.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Fake mqtt client — local copy of the pattern in tests/unit/mqtt-optional.test.ts and
// tests/unit/lightning-feed-outage.test.ts, trimmed to what this file needs. `subscribe`
// and `unsubscribe` invoke their callback synchronously (mirrors both source files this
// pattern is copied from); `emit` lets a test fire a handler manually after construction —
// used here for the mid-window `close` that puts the client into "reconnecting" state.
// ---------------------------------------------------------------------------

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
      (handlers[event] ?? []).forEach(h => h(...args));
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
 * Re-import blitzortung.js (and the logger singleton, for spies to observe the same
 * instance — G21) from a clean module registry. Wrapped in fake timers so the
 * constructor's two un-unref'd setIntervals land on the fake clock and are abandoned
 * rather than leaking real timers (G21 rule 3); the test body then switches to its own
 * fake timers for the 10s accumulation wait and the LRU-ordering advances.
 */
async function importFreshBlitzortung() {
  vi.useFakeTimers();
  vi.resetModules();
  try {
    const blitzortungModule = await import('../../src/services/blitzortung.js');
    const loggerModule = await import('../../src/utils/logger.js');
    return {
      ...blitzortungModule,
      logger: loggerModule.logger
    };
  } finally {
    vi.useRealTimers();
  }
}

// ---------------------------------------------------------------------------
// Geometry fixtures — see file header. Verified empirically with a standalone script
// against the real calculateGeohashSubscriptions, not assumed.
// ---------------------------------------------------------------------------

/** Nine disjoint geohashes at radius 175km, prefix 0x/0w. */
const NINE_A = { lat: -50, lon: -150, radius: 175 };
/** Nine disjoint geohashes at radius 175km, prefix 0z/0y — disjoint from NINE_A. */
const NINE_B = { lat: -50, lon: -140, radius: 175 };
/** Nine geohashes at radius 175km, prefix 1p/1n — includes '1p5', shared with SHARED_OLD. */
const NINE_C = { lat: -50, lon: -130, radius: 175 };
/** Resolves to exactly {'1p5'} at radius 40km — the center of NINE_C's '1p5' tile. */
const SHARED_OLD = { lat: -49.921875, lon: -130.078125, radius: 40 };

/**
 * 60 points, each resolving to exactly ONE geohash at radius 100km, all mutually distinct
 * and disjoint from NINE_A/NINE_B/NINE_C's tiles. Used to fill the subscription cap to an
 * exact, known count one geohash at a time.
 */
const SINGLES: Array<{ lat: number; lon: number }> = [
  { lat: -80, lon: -178 }, { lat: -80, lon: -168 }, { lat: -80, lon: -156 }, { lat: -80, lon: -146 },
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

type Outcome = { status?: 'subscribed' | 'refreshed' | 'skipped-capacity' | 'skipped-reconnecting' };

/**
 * Sequential QUERY fill: each call fully completes (including its 10s accumulation wait)
 * before the next starts, so each point's subscription timestamp is strictly later than
 * the previous one's — required for the LRU-ordering proof in contract 3.
 */
async function fillWithQueries(
  service: { getLightningStrikes: (lat: number, lon: number, radiusKm: number, timeWindow: number) => Promise<unknown> },
  points: Array<{ lat: number; lon: number }>,
  count: number
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const { lat, lon } = points[i];
    const pending = service.getLightningStrikes(lat, lon, 100, 60);
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
  }
}

/** Sequential PRE-WARM fill: no 10s accumulation wait, so this is much cheaper than a query fill. */
async function fillWithPrewarm(
  service: { prewarmLocation: (lat: number, lon: number, radiusKm: number) => Promise<void> },
  points: Array<{ lat: number; lon: number }>,
  count: number
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const { lat, lon } = points[i];
    await service.prewarmLocation(lat, lon, 100);
    await vi.advanceTimersByTimeAsync(1000); // strictly increasing timestamps between fills
  }
}

afterEach(() => {
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
});

describe('lightning pre-warm capacity & coverage contracts (blitzortung.ts)', () => {
  it('contract 1: prewarm never evicts to make room — it skips the whole location and leaves earlier coverage untouched', async () => {
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      await fillWithQueries(blitzortungService, SINGLES, 50);
      expect(client.subscribe).toHaveBeenCalledTimes(50);
      expect(client.unsubscribe).not.toHaveBeenCalled();

      const coverageBefore = blitzortungService.getCoverageStart(SINGLES[0].lat, SINGLES[0].lon, 100);
      expect(coverageBefore).not.toBeNull();

      const outcome: Outcome = {};
      await blitzortungService.prewarmLocation(NINE_A.lat, NINE_A.lon, NINE_A.radius, outcome);

      expect(outcome.status).toBe('skipped-capacity');
      // Never evicts: no new subscribe call, and never touches unsubscribe at all.
      expect(client.subscribe).toHaveBeenCalledTimes(50);
      expect(client.unsubscribe).not.toHaveBeenCalled();
      // Nothing of NINE_A got stamped.
      expect(blitzortungService.getCoverageStart(NINE_A.lat, NINE_A.lon, NINE_A.radius)).toBeNull();

      const coverageAfter = blitzortungService.getCoverageStart(SINGLES[0].lat, SINGLES[0].lon, 100);
      expect(coverageAfter).not.toBeNull();
      expect(coverageAfter!.getTime()).toBe(coverageBefore!.getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it("contract 2: a query at a new point still evicts (today's behaviour, pinned)", async () => {
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      await fillWithQueries(blitzortungService, SINGLES, 50);
      expect(client.unsubscribe).not.toHaveBeenCalled();

      const newPoint = SINGLES[50]; // distinct from the 50 fillers above
      const pending = blitzortungService.getLightningStrikes(newPoint.lat, newPoint.lon, 100, 60);
      await vi.advanceTimersByTimeAsync(10000);
      await pending;

      expect(client.unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 3: a partial-fit prewarm stamps none of its geohashes, including one shared with an existing subscription — the shared one stays LRU-oldest', async () => {
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      // The OLD subscription: resolves to exactly geohash '1p5', one of NINE_C's nine tiles,
      // and is the very first thing subscribed — so it is the oldest by construction.
      const oldPending = blitzortungService.getLightningStrikes(SHARED_OLD.lat, SHARED_OLD.lon, SHARED_OLD.radius, 60);
      await vi.advanceTimersByTimeAsync(10000);
      await oldPending;

      // 49 fillers, each strictly newer than '1p5' and than each other (fillWithQueries
      // serializes with a 10s gap per call).
      await fillWithQueries(blitzortungService, SINGLES, 49);

      expect(client.subscribe).toHaveBeenCalledTimes(50); // 1 old + 49 fillers
      expect(client.unsubscribe).not.toHaveBeenCalled();

      // NINE_C needs 8 NEW geohashes ('1p5' is already subscribed): 50 + 8 = 58 > 50 cap.
      const outcome: Outcome = {};
      await blitzortungService.prewarmLocation(NINE_C.lat, NINE_C.lon, NINE_C.radius, outcome);
      expect(outcome.status).toBe('skipped-capacity');
      expect(client.subscribe).toHaveBeenCalledTimes(50); // no new subscribe call at all

      // A subsequent query-driven eviction must still pick '1p5' first. If the skipped
      // prewarm had restamped '1p5' (even though it changed nothing else), '1p5' would no
      // longer be the oldest and this would evict a filler instead.
      const newPoint = SINGLES[49]; // unused by the 49-filler fill above
      const evictPending = blitzortungService.getLightningStrikes(newPoint.lat, newPoint.lon, 100, 60);
      await vi.advanceTimersByTimeAsync(10000);
      await evictPending;

      expect(client.unsubscribe).toHaveBeenCalledTimes(1);
      const evictedTopics = client.unsubscribe.mock.calls[0][0] as string[];
      expect(evictedTopics).toEqual(['blitzortung/1.1/1/p/5/#']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 4: a second prewarm at the same location is a silent, network-free refresh', async () => {
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService, logger } = await importFreshBlitzortung();
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

    vi.useFakeTimers();
    try {
      const first: Outcome = {};
      await blitzortungService.prewarmLocation(NINE_A.lat, NINE_A.lon, NINE_A.radius, first);
      expect(first.status).toBe('subscribed');
      expect(client.subscribe).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalled();

      const coverageBefore = blitzortungService.getCoverageStart(NINE_A.lat, NINE_A.lon, NINE_A.radius);
      expect(coverageBefore).not.toBeNull();

      infoSpy.mockClear();
      const second: Outcome = {};
      await blitzortungService.prewarmLocation(NINE_A.lat, NINE_A.lon, NINE_A.radius, second);

      expect(second.status).toBe('refreshed');
      expect(client.subscribe).toHaveBeenCalledTimes(1); // no new network call
      expect(infoSpy).not.toHaveBeenCalled(); // silent

      const coverageAfter = blitzortungService.getCoverageStart(NINE_A.lat, NINE_A.lon, NINE_A.radius);
      expect(coverageAfter).not.toBeNull();
      expect(coverageAfter!.getTime()).toBe(coverageBefore!.getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 5: prewarm never opens a second client while mqtt.js is reconnecting; a query in the same state still does', async () => {
    const client = createFakeMqttClient();
    const { esModule, connect } = createPresentMqttModule(client);
    vi.doMock('mqtt', () => esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      // Establish a connection.
      await blitzortungService.prewarmLocation(SINGLES[0].lat, SINGLES[0].lon, 100);
      expect(connect).toHaveBeenCalledTimes(1);

      // The broker drops: isConnected -> false, but `client` remains (mqtt.js reconnects it).
      client.emit('close');

      const outcome: Outcome = {};
      await blitzortungService.prewarmLocation(SINGLES[1].lat, SINGLES[1].lon, 100, outcome);
      expect(outcome.status).toBe('skipped-reconnecting');
      expect(connect).toHaveBeenCalledTimes(1); // no second client opened

      // A query in the same state is NOT guarded — this only asserts it reaches
      // ensureConnected (and therefore mqtt.connect) again, not that the result is
      // desirable; today's behaviour can orphan a client here (see mqtt-optional.test.ts
      // contract 8's regression note for the general hazard this guard does not cover).
      const pending = blitzortungService.getLightningStrikes(SINGLES[2].lat, SINGLES[2].lon, 100, 60);
      await vi.advanceTimersByTimeAsync(10000);
      await pending;
      expect(connect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 6: two concurrent prewarms for disjoint 9-geohash areas cannot jointly overflow the cap', async () => {
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      // Baseline: 41 distinct single-geohash subscriptions. Cap is 50, so there is room for
      // exactly one more 9-geohash area (41 + 9 = 50) but not two (41 + 18 = 59). Built with
      // prewarm rather than queries: only the eventual concurrency matters here, and prewarm
      // skips the 10s accumulation wait.
      await fillWithPrewarm(blitzortungService, SINGLES, 41);
      expect(client.subscribe).toHaveBeenCalledTimes(41);

      const outcomeA: Outcome = {};
      const outcomeB: Outcome = {};
      await Promise.all([
        blitzortungService.prewarmLocation(NINE_A.lat, NINE_A.lon, NINE_A.radius, outcomeA),
        blitzortungService.prewarmLocation(NINE_B.lat, NINE_B.lon, NINE_B.radius, outcomeB)
      ]);

      const statuses = [outcomeA.status, outcomeB.status].sort();
      expect(statuses).toEqual(['skipped-capacity', 'subscribed']);

      // Total topics ever subscribed minus ever unsubscribed must never exceed the cap —
      // computed from the mock's own call log, not from a private field.
      const subscribedTopics = client.subscribe.mock.calls.reduce(
        (total, call) => total + (call[0] as string[]).length,
        0
      );
      const unsubscribedTopics = client.unsubscribe.mock.calls.reduce(
        (total, call) => total + (call[0] as string[]).length,
        0
      );
      expect(subscribedTopics - unsubscribedTopics).toBeLessThanOrEqual(50);
      expect(subscribedTopics - unsubscribedTopics).toBe(50); // exactly: 41 baseline + one 9-tile area
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 7: the refresh interval derives from, and stays below, the idle threshold', async () => {
    // No mqtt mock needed — the constructor never touches mqtt, and this test never calls a
    // method that would.
    const { PREWARM_REFRESH_INTERVAL_MS, SUBSCRIPTION_IDLE_THRESHOLD_MS } = await importFreshBlitzortung();

    expect(PREWARM_REFRESH_INTERVAL_MS).toBeLessThan(SUBSCRIPTION_IDLE_THRESHOLD_MS);
    expect(PREWARM_REFRESH_INTERVAL_MS).toBe(SUBSCRIPTION_IDLE_THRESHOLD_MS / 2);
  });
});
