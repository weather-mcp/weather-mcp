/**
 * Unit tests for the lightning feed-outage contract (issue #76,
 * lightning-degradation-honesty T1/T2): a genuine Blitzortung transport
 * failure must render as an honest "feed unavailable" report, never as an
 * indistinguishable first-query cold start.
 *
 * Two describe blocks:
 *
 *   A. Service contracts — drives the REAL BlitzortungService class through a
 *      fresh module re-import per test (mirrors tests/unit/mqtt-optional.test.ts),
 *      with `mqtt` replaced by a locally-defined fake client. Proves the
 *      per-query WeakMap association (never a shared "last failure" field —
 *      the design this whole file exists to rule out) and the
 *      connectionLossGeneration counter that classifies a mid-window broker
 *      `close` as an outage rather than a cold start.
 *
 *   B. Render contracts — drives formatLightningActivityResponse directly
 *      with hand-built fixtures, plus getLightningActivity /
 *      handleGetLightningActivity / handleGetWeatherSummary through a
 *      SEPARATE re-import mechanism that mocks '../../src/services/blitzortung.js'
 *      itself. Kept apart from section A's re-import on purpose: both use
 *      `vi.doMock` (never the file-hoisted `vi.mock`), because a top-level
 *      `vi.mock` would permanently replace its target for every import in
 *      this file, including section A's dynamic import of the REAL class.
 *
 * Determinism: nothing here opens a socket. Every service-level case
 * `vi.doMock`s 'mqtt'; every render-handler case `vi.doMock`s
 * '../../src/services/blitzortung.js'.
 */

import { describe, it, expect, afterEach, vi, Mock } from 'vitest';
import { formatLightningActivityResponse } from '../../src/handlers/lightningHandler.js';
import type { LightningActivityResponse, LightningStrike } from '../../src/types/lightning.js';

// ---------------------------------------------------------------------------
// Section A helpers — local copies of the pattern in
// tests/unit/mqtt-optional.test.ts, trimmed to what this file needs (no
// absent-module / class-identity cases here — nothing in this file throws
// MqttUnavailableError/MqttLoadFailedError).
// ---------------------------------------------------------------------------

/**
 * A configurable fake `MqttClient`.
 *   - `connect`: 'immediate' fires the 'connect' handler on a microtask
 *     (mirrors a real handshake, works under fake or real clocks); 'never'
 *     never fires it (drives the 30s connectTimeout); 'error' fires the
 *     'error' handler instead of 'connect'.
 *   - `subscribeErrors`: a queue consumed one entry per `subscribe()` call,
 *     in call order; the last entry repeats once exhausted (default: every
 *     call succeeds).
 * `emit(event, ...)` lets a test fire a handler manually after construction —
 * used for the mid-window `close` (and reconnect) contracts.
 */
function createFakeMqttClient(
  opts: {
    connect?: 'immediate' | 'never' | 'error';
    subscribeErrors?: Array<Error | null>;
  } = {}
) {
  const { connect = 'immediate', subscribeErrors = [] } = opts;
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  let subscribeCallIndex = 0;

  const client = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(cb);
      if (event === 'connect' && connect === 'immediate') {
        queueMicrotask(() => cb());
      }
      if (event === 'error' && connect === 'error') {
        queueMicrotask(() => cb(new Error('broker error')));
      }
      return client;
    }),
    subscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => {
      const behavior =
        subscribeCallIndex < subscribeErrors.length
          ? subscribeErrors[subscribeCallIndex]
          : subscribeErrors[subscribeErrors.length - 1] ?? null;
      subscribeCallIndex += 1;
      cb(behavior);
    }),
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
 * Re-import blitzortung.js (and the logger singleton) from a clean module
 * registry, exactly as tests/unit/mqtt-optional.test.ts does, so the
 * per-query WeakMap and connectionLossGeneration state, and the module-level
 * mqtt memo, all start fresh. Wrapped in fake timers so the constructor's two
 * un-unref'd setInterval calls land on the fake clock and are abandoned
 * rather than leaking real timers (G21 rule 3) — the test body then switches
 * to its own fake timers for the 10s accumulation wait.
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
// Section B helpers — a SEPARATE re-import mechanism, mocking
// '../../src/services/blitzortung.js' itself (never 'mqtt'), so
// getLightningActivity / handleGetLightningActivity / handleGetWeatherSummary
// run against a stub service with no real MQTT client underneath at all.
// ---------------------------------------------------------------------------

interface ServiceStub {
  getLightningStrikes: Mock;
  getCoverageStart: Mock;
  getFeedFailure: Mock;
}

function buildServiceStub(overrides: Partial<ServiceStub> = {}): ServiceStub {
  return {
    getLightningStrikes: vi.fn().mockResolvedValue([]),
    getCoverageStart: vi.fn().mockReturnValue(null),
    getFeedFailure: vi.fn(() => null),
    ...overrides
  };
}

/** Fresh re-import of lightningHandler.js with blitzortung.js replaced by `stub`. */
async function importFreshLightningHandler(stub: ServiceStub) {
  vi.resetModules();
  vi.doMock('../../src/services/blitzortung.js', () => ({ blitzortungService: stub }));
  return import('../../src/handlers/lightningHandler.js');
}

/** Fresh re-import of weatherSummaryHandler.js with blitzortung.js replaced by `stub`. */
async function importFreshWeatherSummaryHandler(stub: ServiceStub) {
  vi.resetModules();
  vi.doMock('../../src/services/blitzortung.js', () => ({ blitzortungService: stub }));
  return import('../../src/handlers/weatherSummaryHandler.js');
}

afterEach(() => {
  vi.doUnmock('mqtt');
  vi.doUnmock('../../src/services/blitzortung.js');
  vi.restoreAllMocks();
});

describe('lightning feed-outage — service contracts (blitzortung.ts)', () => {
  it('contract 1: a subscribe callback error yields an empty array, and getFeedFailure reports subscribe_failed', async () => {
    const client = createFakeMqttClient({ subscribeErrors: [new Error('subscribe rejected')] });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const result = await blitzortungService.getLightningStrikes(40.0, -74.0, 100, 60);
      expect(result).toEqual([]);

      const failure = blitzortungService.getFeedFailure(result);
      expect(failure).not.toBeNull();
      expect(failure!.reason).toBe('subscribe_failed');
      expect(failure!.at).toBeInstanceOf(Date);
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 2a: a client whose connect never fires rejects after connectTimeout, reason connect_timeout', async () => {
    const client = createFakeMqttClient({ connect: 'never' });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const promise = blitzortungService.getLightningStrikes(41.0, -75.0, 100, 60);
      await vi.advanceTimersByTimeAsync(30000); // past the 30s connectTimeout
      const result = await promise;

      expect(result).toEqual([]);
      expect(blitzortungService.getFeedFailure(result)?.reason).toBe('connect_timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 2b: a broker error event rejects with reason connection_error', async () => {
    const client = createFakeMqttClient({ connect: 'error' });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const result = await blitzortungService.getLightningStrikes(42.0, -76.0, 100, 60);

      expect(result).toEqual([]);
      expect(blitzortungService.getFeedFailure(result)?.reason).toBe('connection_error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 3: a successful query after a failed one clears only its own array; the failed array still reports its failure', async () => {
    const client = createFakeMqttClient({
      subscribeErrors: [new Error('first subscribe rejected'), null]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const firstResult = await blitzortungService.getLightningStrikes(10, 10, 100, 60);
      expect(blitzortungService.getFeedFailure(firstResult)?.reason).toBe('subscribe_failed');

      const secondPromise = blitzortungService.getLightningStrikes(20, 20, 100, 60);
      await vi.advanceTimersByTimeAsync(10000);
      const secondResult = await secondPromise;

      expect(blitzortungService.getFeedFailure(secondResult)).toBeNull();
      // The association is per array, not a field the later call cleared (codex-R1).
      expect(blitzortungService.getFeedFailure(firstResult)?.reason).toBe('subscribe_failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 4: a failed pre-warm subscribe does not set feedUnavailable for a later successful query', async () => {
    const client = createFakeMqttClient({
      subscribeErrors: [new Error('prewarm subscribe rejected'), null]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      await blitzortungService.prewarmLocation(30, 30, 100); // fails, swallowed

      const promise = blitzortungService.getLightningStrikes(40, 40, 100, 60);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(blitzortungService.getFeedFailure(result)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('regression codex-B1: a failed subscribe leaves no stamp behind, so a same-area retry really re-subscribes', async () => {
    // The bug this pins: both maps are written BEFORE the subscribe callback runs, and the
    // error branch used to reject without undoing them. The second query for the same area then
    // computed an empty `potentialNewSubs`, never called `subscribe`, and returned a clean
    // (failure-free) empty array with a coverage stamp — `SAFE (LIMITED DATA)` plus "re-check
    // shortly" for a feed that is down. Same coordinates and radius on both calls, so the
    // geohash set is identical and the skip is reachable.
    const client = createFakeMqttClient({
      subscribeErrors: [new Error('first subscribe rejected'), new Error('retry subscribe rejected')]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const first = await blitzortungService.getLightningStrikes(40, -74, 100, 60);
      expect(blitzortungService.getFeedFailure(first)?.reason).toBe('subscribe_failed');
      expect(client.subscribe).toHaveBeenCalledTimes(1);

      // Nothing was subscribed, so nothing may claim coverage — the stamp is the half of the
      // bug that produced the dishonest render, and it must be gone too.
      expect(blitzortungService.getCoverageStart(40, -74, 100)).toBeNull();

      const second = await blitzortungService.getLightningStrikes(40, -74, 100, 60);
      expect(client.subscribe).toHaveBeenCalledTimes(2);
      expect(blitzortungService.getFeedFailure(second)?.reason).toBe('subscribe_failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('regression codex-B1: a failed pre-warm does not stop the first query for that area from re-subscribing', async () => {
    // The startup path into the same bug: `prewarmLocation` swallows its failure, so without a
    // rollback the very FIRST user query for a pre-warmed saved location inherited the poisoned
    // stamps and reported no failure at all.
    const client = createFakeMqttClient({
      subscribeErrors: [new Error('prewarm subscribe rejected'), new Error('query subscribe rejected')]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      await blitzortungService.prewarmLocation(35, -80, 100); // fails, swallowed
      expect(client.subscribe).toHaveBeenCalledTimes(1);
      expect(blitzortungService.getCoverageStart(35, -80, 100)).toBeNull();

      const result = await blitzortungService.getLightningStrikes(35, -80, 100, 60);
      expect(client.subscribe).toHaveBeenCalledTimes(2);
      expect(blitzortungService.getFeedFailure(result)?.reason).toBe('subscribe_failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 4b: overlapping queries never exchange outcomes — the contract a shared "last failure" field would fail', async () => {
    const client = createFakeMqttClient({
      // Call order: B's subscribe (index 0) succeeds; A's subscribe (index 1) fails.
      subscribeErrors: [null, new Error('A subscribe rejected')]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const bPromise = blitzortungService.getLightningStrikes(50, 50, 100, 60);
      // Get B through connect+subscribe and into the 10s wait, without completing it.
      await vi.advanceTimersByTimeAsync(100);

      const aResult = await blitzortungService.getLightningStrikes(60, 60, 100, 60);
      expect(blitzortungService.getFeedFailure(aResult)?.reason).toBe('subscribe_failed');

      await vi.advanceTimersByTimeAsync(10000);
      const bResult = await bPromise;

      expect(blitzortungService.getFeedFailure(bResult)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 4b: a concurrent pre-warm whose subscribe fails does not affect an in-flight query', async () => {
    const client = createFakeMqttClient({
      // Call order: the query's own subscribe (index 0) succeeds; the pre-warm's (index 1) fails.
      subscribeErrors: [null, new Error('prewarm subscribe rejected')]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const queryPromise = blitzortungService.getLightningStrikes(70, 70, 100, 60);
      await vi.advanceTimersByTimeAsync(100);

      await blitzortungService.prewarmLocation(80, 80, 100); // fails, swallowed

      await vi.advanceTimersByTimeAsync(10000);
      const queryResult = await queryPromise;

      expect(blitzortungService.getFeedFailure(queryResult)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 4b: two failed queries never share one degraded-array identity, so neither can silently inherit the other\'s reason', async () => {
    // Every subscribe call fails, so BOTH queries take the degraded-return path. A shared
    // module-level array reused across every degraded call would make firstResult and
    // secondResult the SAME object — collapsing the WeakMap lookup for both to whichever
    // failure was associated last. This is the one contract 3/4b's other cases cannot catch,
    // because in both of those only one side of the pair is ever degraded.
    const client = createFakeMqttClient({
      subscribeErrors: [new Error('first subscribe rejected'), new Error('second subscribe rejected')]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const firstResult = await blitzortungService.getLightningStrikes(90, 90, 100, 60);
      const secondResult = await blitzortungService.getLightningStrikes(91, 91, 100, 60);

      expect(firstResult).not.toBe(secondResult);
      expect(blitzortungService.getFeedFailure(firstResult)?.reason).toBe('subscribe_failed');
      expect(blitzortungService.getFeedFailure(secondResult)?.reason).toBe('subscribe_failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 4c: a close event during the accumulation window classifies as connection_error', async () => {
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const promise = blitzortungService.getLightningStrikes(11, 11, 100, 60);
      await vi.advanceTimersByTimeAsync(100); // past connect+subscribe, still mid-wait
      client.emit('close');
      await vi.advanceTimersByTimeAsync(9900);
      const result = await promise;

      expect(blitzortungService.getFeedFailure(result)?.reason).toBe('connection_error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 4c: a close then a reconnect before completion still classifies as connection_error (the generation moved)', async () => {
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const promise = blitzortungService.getLightningStrikes(12, 12, 100, 60);
      await vi.advanceTimersByTimeAsync(100);
      client.emit('close');
      client.emit('connect'); // isConnected is true again by the time the query returns
      await vi.advanceTimersByTimeAsync(9900);
      const result = await promise;

      expect(blitzortungService.getFeedFailure(result)?.reason).toBe('connection_error');
      // isConnected really is restored here — proving the classification came from the
      // generation counter, not from a bare final isConnected check.
      expect((blitzortungService as unknown as { isConnected: boolean }).isConnected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 4c control: no close event at all leaves getFeedFailure null', async () => {
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const promise = blitzortungService.getLightningStrikes(13, 13, 100, 60);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(blitzortungService.getFeedFailure(result)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------------
  // Contract 11 — the degraded return reads the buffer.
  //
  // Source: test-drive Observation 1. Contracts 1, 2a and 2b assert
  // `toEqual([])` on a failed query, which is true only because their buffers
  // were empty: every one of them fails on its FIRST query, so there was never
  // anything to lose. That left the catch free to return a hard-coded `[]`, and
  // it did - so a strike already detected and still inside the requested window
  // vanished from the report the moment the feed went down, under the sentence
  // "no strikes could be observed for this area". docs/TOOLS.md,
  // docs/ERROR_HANDLING.md and the CHANGELOG all promise the opposite. The
  // render side was never the problem (contracts 8 and 8b already prove it) -
  // it was simply never handed a non-empty array on these two legs.
  // -------------------------------------------------------------------------

  /** Emit one strike into the service's buffer through the fake client's message handler. */
  function bufferStrike(
    client: ReturnType<typeof createFakeMqttClient>,
    lat: number,
    lon: number
  ): void {
    client.emit(
      'message',
      'blitzortung/1.1/d/r/5/#',
      Buffer.from(JSON.stringify({ lat, lon, time: Date.now(), pol: 1, mcs: 12000, stat: 9 }))
    );
  }

  it('contract 11 (subscribe leg): a strike buffered before the failure survives it, still classified subscribe_failed', async () => {
    // First subscribe succeeds (buffers the strike); the second - the wider radius, which needs
    // eight new geohashes - is rejected.
    const client = createFakeMqttClient({
      subscribeErrors: [null, new Error('subscribe rejected')]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const firstPromise = blitzortungService.getLightningStrikes(40.0, -74.0, 100, 60);
      await vi.advanceTimersByTimeAsync(1); // connect + subscribe settle
      bufferStrike(client, 40.02, -74.0); // ~2 km from the query point
      await vi.advanceTimersByTimeAsync(10000);
      const firstResult = await firstPromise;
      expect(firstResult).toHaveLength(1);
      expect(blitzortungService.getFeedFailure(firstResult)).toBeNull();

      // radius 200 needs geohashes radius 100 never subscribed, so this call really re-subscribes.
      const secondResult = await blitzortungService.getLightningStrikes(40.0, -74.0, 200, 60);

      expect(blitzortungService.getFeedFailure(secondResult)?.reason).toBe('subscribe_failed');
      // The whole point: degraded, not empty.
      expect(secondResult).toHaveLength(1);
      expect(secondResult[0].latitude).toBeCloseTo(40.02, 4);
      // A fresh array per degraded return, so the WeakMap entries never collide.
      expect(secondResult).not.toBe(firstResult);
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 11 (connect leg): a connect timeout after an earlier success still returns the buffered strike', async () => {
    // Two different clients from one module: the first connects and buffers, the second never
    // fires 'connect', so the query after the connection drops hits the 30s connectTimeout.
    const connected = createFakeMqttClient();
    const dead = createFakeMqttClient({ connect: 'never' });
    const clients = [connected, dead];
    let handedOut = 0;
    vi.doMock('mqtt', () => ({
      default: { connect: vi.fn(() => clients[Math.min(handedOut++, clients.length - 1)]) }
    }));
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const firstPromise = blitzortungService.getLightningStrikes(40.0, -74.0, 100, 60);
      await vi.advanceTimersByTimeAsync(1);
      bufferStrike(connected, 40.02, -74.0);
      await vi.advanceTimersByTimeAsync(10000);
      expect(await firstPromise).toHaveLength(1);

      connected.emit('close'); // the broker goes away between queries

      const secondPromise = blitzortungService.getLightningStrikes(40.0, -74.0, 100, 60);
      await vi.advanceTimersByTimeAsync(30000); // past connectTimeout
      const secondResult = await secondPromise;

      expect(blitzortungService.getFeedFailure(secondResult)?.reason).toBe('connect_timeout');
      expect(secondResult).toHaveLength(1);
      expect(secondResult[0].latitude).toBeCloseTo(40.02, 4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 11b: the degraded return is filtered like any other query, not a dump of the whole buffer', async () => {
    const client = createFakeMqttClient({
      subscribeErrors: [null, new Error('subscribe rejected')]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();

    vi.useFakeTimers();
    try {
      const firstPromise = blitzortungService.getLightningStrikes(40.0, -74.0, 100, 60);
      await vi.advanceTimersByTimeAsync(1);
      bufferStrike(client, 40.02, -74.0); // ~2 km - inside every radius below
      bufferStrike(client, 47.6, -122.3); // Seattle - in the buffer, nowhere near the query
      await vi.advanceTimersByTimeAsync(10000);
      await firstPromise;

      const secondResult = await blitzortungService.getLightningStrikes(40.0, -74.0, 200, 60);

      expect(blitzortungService.getFeedFailure(secondResult)?.reason).toBe('subscribe_failed');
      // The far strike is in the buffer but outside the search radius: a degraded report must
      // apply the same distance filter a healthy one does, or an outage would widen the search.
      expect(secondResult).toHaveLength(1);
      expect(secondResult[0].latitude).toBeCloseTo(40.02, 4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 5: hygiene — the failure-classification log lines never carry the broker URL or mqtt://, and the failure object has exactly {at, reason}', async () => {
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService, logger } = await importFreshBlitzortung();
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const brokerUrl = (blitzortungService as unknown as { brokerUrl: string }).brokerUrl;

    vi.useFakeTimers();
    try {
      const promise = blitzortungService.getLightningStrikes(15, 15, 100, 60);
      await vi.advanceTimersByTimeAsync(100);
      // Fires the 'MQTT connection closed' warn AND the new 'Lightning feed connection lost
      // during collection' warn — both spied lines this contract is about.
      client.emit('close');
      await vi.advanceTimersByTimeAsync(9900);
      const result = await promise;

      const failure = blitzortungService.getFeedFailure(result);
      expect(failure).not.toBeNull();
      expect(Object.keys(failure!).sort()).toEqual(['at', 'reason']);

      // The one pre-existing line that IS allowed to name the broker fires on every
      // connect (blitzortung.ts:266-270), unrelated to this failure — excluded here;
      // everything else must be clean.
      const relevantCalls = [...errorSpy.mock.calls, ...warnSpy.mock.calls].filter(
        call => call[0] !== 'SECURITY: Using plaintext MQTT connection (unencrypted)'
      );
      expect(relevantCalls.length).toBeGreaterThan(0);
      for (const call of relevantCalls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(brokerUrl);
        expect(serialized).not.toContain('mqtt://');
      }
    } finally {
      vi.useRealTimers();
    }
  });
  it('contract 5 (subscribe leg): the emitted subscribe-failure and classification lines carry nothing from mqtt\'s own message', async () => {
    // Contract 5 above drives only the `close` path, which never reaches either `logger.error`.
    // This drives the subscribe leg, where mqtt's real errors read
    // `connect ECONNREFUSED <host>:<port>` — a broker address inside the error's own message and
    // stack. The sentinel stands in for that address.
    //
    // Asserted at `console.error`, NOT at a `logger.error` spy: an Error has no enumerable own
    // properties, so `JSON.stringify` of a spied call renders it `{}` and a spy-level assertion
    // passes against code that leaks. `logger.log` copies `error.message` and `error.stack` into
    // the entry it emits, so the emitted line is the only place the contract is real.
    const SENTINEL = 'mqtt://sentinel.invalid:1883';
    const client = createFakeMqttClient({
      subscribeErrors: [new Error(`connect ECONNREFUSED ${SENTINEL}`)]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.useFakeTimers();
    try {
      const result = await blitzortungService.getLightningStrikes(16, 16, 100, 60);
      expect(blitzortungService.getFeedFailure(result)?.reason).toBe('subscribe_failed');

      const emitted = consoleSpy.mock.calls.map(call => String(call[0]));
      // Both `logger.error` sites on this leg must have fired: the subscribe callback's and the
      // classification catch's. Without this the sentinel assertions could pass vacuously.
      expect(emitted.some(line => line.includes('Failed to subscribe to topics'))).toBe(true);
      expect(emitted.some(line => line.includes('Failed to fetch lightning data'))).toBe(true);
      // The classification still reaches the log — sanitizing must not cost the diagnostic.
      expect(emitted.some(line => line.includes('subscribe_failed'))).toBe(true);

      // Scoped to the failure lines themselves. `console.error` is the sink for EVERY log
      // level (stderr is the MCP requirement), so the stream also carries the pre-existing
      // connect lines that name the broker on purpose — the contract is about what a failure
      // discloses, not about the transport being unnameable anywhere.
      const failureLines = emitted.filter(line => {
        const message = (JSON.parse(line) as { message?: string }).message;
        return (
          message === 'Failed to subscribe to topics' ||
          message === 'Failed to fetch lightning data'
        );
      });
      expect(failureLines).toHaveLength(2);
      for (const line of failureLines) {
        expect(line).not.toContain(SENTINEL);
        expect(line).not.toContain('sentinel.invalid');
        expect(line).not.toContain('mqtt://');
        expect(line).not.toContain('ECONNREFUSED');
        // The whole leak was `message` + `stack` being copied into the entry by `logger.log`.
        expect(line).not.toContain('"stack"');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('contract 5 (pre-warm leg): the emitted pre-warm warning carries nothing from mqtt\'s own message either', async () => {
    const SENTINEL = 'mqtt://sentinel.invalid:1883';
    const client = createFakeMqttClient({
      subscribeErrors: [new Error(`connect ECONNREFUSED ${SENTINEL}`)]
    });
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService } = await importFreshBlitzortung();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.useFakeTimers();
    try {
      await blitzortungService.prewarmLocation(17, 17, 100); // fails, swallowed

      const emitted = consoleSpy.mock.calls.map(call => String(call[0]));
      expect(
        emitted.some(line => line.includes('Failed to pre-warm lightning monitoring for location'))
      ).toBe(true);

      const failureLines = emitted.filter(
        line =>
          (JSON.parse(line) as { message?: string }).message ===
          'Failed to pre-warm lightning monitoring for location'
      );
      expect(failureLines).toHaveLength(1);
      for (const line of failureLines) {
        expect(line).not.toContain(SENTINEL);
        expect(line).not.toContain('sentinel.invalid');
        expect(line).not.toContain('mqtt://');
        expect(line).not.toContain('ECONNREFUSED');
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('lightning feed-outage — render contracts (lightningHandler.ts)', () => {
  function baseResponse(overrides: Partial<LightningActivityResponse> = {}): LightningActivityResponse {
    const now = new Date('2026-08-28T15:30:00Z');
    return {
      location: { latitude: 43.8195, longitude: -84.7686 },
      searchRadius: 100,
      timeWindow: 60,
      searchPeriod: { start: new Date(now.getTime() - 60 * 60 * 1000), end: now },
      strikes: [],
      statistics: {
        totalStrikes: 0,
        cloudToGroundStrikes: 0,
        intraCloudStrikes: 0,
        averageDistance: 0,
        nearestDistance: 0,
        strikesPerMinute: 0,
        densityPerSqKm: 0
      },
      safety: {
        level: 'safe',
        message: 'No significant lightning activity detected in the area.',
        recommendations: ['Continue to monitor weather conditions.'],
        nearestStrikeDistance: null,
        nearestStrikeTime: null,
        isActiveThunderstorm: false
      },
      coverage: { monitoringSince: null, coverageMinutes: 0, isComplete: false, feedUnavailable: false },
      source: 'Blitzortung.org',
      generatedAt: now,
      disclaimer: 'test disclaimer',
      ...overrides
    };
  }

  it('contract 6: an outage with no strikes renders the UNKNOWN heading, the outage *Why:*, and no re-check text anywhere', async () => {
    // Driven through the REAL getLightningActivity (not a hand-built fixture): an outage
    // with no strikes always yields nearestStrikeDistance === null, which is exactly the
    // evaluation-order trap the design calls out — if the null-distance arm were checked
    // before feedUnavailable, this would silently fall through to the cold-start message.
    const stub = buildServiceStub({
      getLightningStrikes: vi.fn().mockResolvedValue([]),
      getCoverageStart: vi.fn().mockReturnValue(null),
      getFeedFailure: vi.fn(() => ({ at: new Date(), reason: 'connect_timeout' as const }))
    });
    const { getLightningActivity, formatLightningActivityResponse: format } =
      await importFreshLightningHandler(stub);

    const result = await getLightningActivity({ latitude: 40.7128, longitude: -74.006 });
    expect(result.safety.nearestStrikeDistance).toBeNull();
    expect(result.coverage.feedUnavailable).toBe(true);
    expect(result.safety.message).toContain('could not be reached');
    expect(result.safety.message).not.toContain('does NOT confirm');

    const out = format(result);

    expect(out).toContain('## ⚪ Safety Status: UNKNOWN (LIVE FEED UNAVAILABLE)');
    expect(out).toContain('Live feed unavailable');
    expect(out).toContain('Blitzortung.org feed');
    expect(out).toContain('reconnects automatically');
    expect(out).toContain('not an all-clear');
    expect(out).not.toMatch(/re-check/i);
    expect(out).not.toContain('only begins buffering');
    expect(out).not.toContain('mqtt://');
    expect(out).not.toContain('connect_timeout');
  });

  it('contract 7: cold start (feedUnavailable false) renders the exact pre-change strings, and a fixture with the field absent renders identically', () => {
    const coldStartSafety = {
      level: 'safe' as const,
      message:
        'No lightning strikes observed during the limited monitoring period. ' +
        'This does NOT confirm the absence of lightning activity.',
      recommendations: [
        'Live monitoring of this area covers only 2.0 of the requested 60 minutes — treat this ' +
          'result as inconclusive and re-check shortly.'
      ],
      nearestStrikeDistance: null,
      nearestStrikeTime: null,
      isActiveThunderstorm: false
    };
    const coldStartCoverage = { monitoringSince: null, coverageMinutes: 2, isComplete: false };

    const withField = formatLightningActivityResponse(
      baseResponse({
        safety: coldStartSafety,
        coverage: { ...coldStartCoverage, feedUnavailable: false }
      })
    );

    for (const text of [
      'SAFE (LIMITED DATA)',
      're-check shortly',
      'Re-check in a few minutes',
      'only begins buffering'
    ]) {
      expect(withField).toContain(text);
    }
    expect(withField).not.toContain('UNKNOWN');

    // Absent-field control (G13): a fixture that predates this field entirely — no key at
    // all, not merely `undefined` — must render byte-identically to the cold-start path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const absent = formatLightningActivityResponse(
      baseResponse({ safety: coldStartSafety, coverage: coldStartCoverage as any })
    );

    expect(absent).toBe(withField);
  });

  it('contract 7 (handler path): a bare getFeedFailure mock (no implementation, returns undefined) computes feedUnavailable as false, not an outage', async () => {
    // The absent-field control above proves the FORMATTER's `=== true` check. This proves
    // the HANDLER's own `!= null` computation (lightningHandler.ts) — a `!== null` mutation
    // would flip `undefined` (what a bare `vi.fn()` returns, exactly as an older test double
    // lacking this stub member would) into "outage", flipping every existing fixture.
    const stub = buildServiceStub({
      getLightningStrikes: vi.fn().mockResolvedValue([]),
      getCoverageStart: vi.fn().mockReturnValue(new Date(Date.now() - 2 * 60 * 1000)),
      getFeedFailure: vi.fn() // bare — returns undefined, never `null`
    });
    const { getLightningActivity } = await importFreshLightningHandler(stub);

    const result = await getLightningActivity({
      latitude: 40.7128,
      longitude: -74.006,
      timeWindow: 60
    });

    expect(result.coverage.feedUnavailable).toBe(false);
  });

  it('contract 7 (handler path): a reachable feed with partial coverage renders the cold-start message, recommendation, heading and *Why:*', async () => {
    // Contract 7 above drives the FORMATTER with a hand-built fixture, and the handler-path case
    // beside it asserts only the boolean — so mutating the selector at lightningHandler.ts to
    // `if (true)` stayed green in the very file written to pin it (codex-M2). This drives the
    // whole cold-start branch through `getLightningActivity`: a feed that answered (no failure)
    // with only part of the window covered must still say "does NOT confirm" and "re-check
    // shortly", which the outage arm replaces wholesale.
    const stub = buildServiceStub({
      getLightningStrikes: vi.fn().mockResolvedValue([]),
      getCoverageStart: vi.fn().mockReturnValue(new Date(Date.now() - 2 * 60 * 1000)),
      getFeedFailure: vi.fn(() => null)
    });
    const { getLightningActivity, formatLightningActivityResponse: format } =
      await importFreshLightningHandler(stub);

    const result = await getLightningActivity({
      latitude: 40.7128,
      longitude: -74.006,
      timeWindow: 60
    });

    expect(result.coverage.feedUnavailable).toBe(false);
    expect(result.coverage.isComplete).toBe(false);
    expect(result.safety.message).toContain('does NOT confirm the absence of lightning activity');
    expect(result.safety.message).not.toContain('could not be reached');
    expect(result.safety.recommendations[0]).toContain('treat this result as inconclusive');
    expect(result.safety.recommendations[0]).toContain('re-check shortly');
    expect(result.safety.recommendations[0]).not.toContain('unreachable');

    const out = format(result);

    expect(out).toContain('## 🟢 Safety Status: SAFE (LIMITED DATA)');
    expect(out).toContain('⚠️ **Limited monitoring coverage:**');
    expect(out).toContain('Re-check in a few minutes');
    expect(out).toContain('only begins buffering');
    expect(out).not.toContain('UNKNOWN');
    expect(out).not.toContain('Live feed unavailable');
    expect(out).not.toContain('not an all-clear');
  });

  it('contract 8: an outage with a buffered strike at 4 km keeps the EXTREME heading and verdict, with the outage caveat beneath it', async () => {
    const strike: LightningStrike = {
      timestamp: new Date(),
      latitude: 40.72,
      longitude: -74.0,
      polarity: -1,
      amplitude: 50,
      distance: 4
    };
    const stub = buildServiceStub({
      getLightningStrikes: vi.fn().mockResolvedValue([strike]),
      getCoverageStart: vi.fn().mockReturnValue(null),
      getFeedFailure: vi.fn(() => ({ at: new Date(), reason: 'connect_timeout' as const }))
    });
    const { getLightningActivity, formatLightningActivityResponse: format } =
      await importFreshLightningHandler(stub);

    const result = await getLightningActivity({ latitude: 40.7128, longitude: -74.006 });
    expect(result.safety.level).toBe('extreme');
    expect(result.coverage.feedUnavailable).toBe(true);

    const out = format(result);
    expect(out).toContain('🔴');
    expect(out).toContain('EXTREME');
    expect(out).not.toContain('UNKNOWN');
    expect(out).toContain('### Strike 1');
    expect(out).toContain('⚠️ **Live feed unavailable:**');
  });

  it('contract 8b: an outage with a buffered strike at 80 km (the safe band with a distance) reads UNKNOWN with the strike still listed, never the "no immediate lightning threat" all-clear', async () => {
    const strike: LightningStrike = {
      timestamp: new Date(),
      latitude: 41.5,
      longitude: -74.0,
      polarity: -1,
      amplitude: 30,
      distance: 80
    };

    // Formatter-only variant: build the fixture by hand, as getLightningActivity would
    // have produced it.
    const response = baseResponse({
      strikes: [strike],
      statistics: {
        totalStrikes: 1,
        cloudToGroundStrikes: 1,
        intraCloudStrikes: 0,
        averageDistance: 80,
        nearestDistance: 80,
        strikesPerMinute: 0.0167,
        densityPerSqKm: 0.0000318
      },
      safety: {
        level: 'safe',
        message:
          'Buffered strikes from earlier monitoring are shown below, but the live lightning ' +
          'feed could not be reached for this query, so current conditions are unknown. This is ' +
          'not an all-clear.',
        recommendations: [
          'The live lightning feed was unreachable for this query — consult official weather ' +
            'services (the NWS or your national authority) before making safety decisions.'
        ],
        nearestStrikeDistance: 80,
        nearestStrikeTime: strike.timestamp,
        isActiveThunderstorm: false
      },
      coverage: { monitoringSince: null, coverageMinutes: 0, isComplete: false, feedUnavailable: true }
    });

    const formatted = formatLightningActivityResponse(response);
    expect(formatted).toContain('## ⚪ Safety Status: UNKNOWN (LIVE FEED UNAVAILABLE)');
    expect(formatted).toContain('### Strike 1');
    expect(formatted).toContain('current conditions are unknown');
    expect(formatted).toContain('not an all-clear');
    expect(formatted).not.toContain('no immediate lightning threat');

    // Handler variant: the real assessSafety must also band this strike as `safe`.
    const stub = buildServiceStub({
      getLightningStrikes: vi.fn().mockResolvedValue([strike]),
      getCoverageStart: vi.fn().mockReturnValue(null),
      getFeedFailure: vi.fn(() => ({ at: new Date(), reason: 'subscribe_failed' as const }))
    });
    const { getLightningActivity, formatLightningActivityResponse: format } =
      await importFreshLightningHandler(stub);

    const result = await getLightningActivity({ latitude: 40.7128, longitude: -74.006 });
    expect(result.safety.level).toBe('safe');
    expect(result.coverage.feedUnavailable).toBe(true);

    const handlerFormatted = format(result);
    expect(handlerFormatted).toContain('## ⚪ Safety Status: UNKNOWN (LIVE FEED UNAVAILABLE)');
    expect(handlerFormatted).toContain('### Strike 1');
    expect(handlerFormatted).not.toContain('no immediate lightning threat');
  });

  it('contract 8b control: the same 80 km buffered strike with feedUnavailable false still produces the pre-change "no immediate lightning threat" sentence', async () => {
    const strike: LightningStrike = {
      timestamp: new Date(),
      latitude: 41.5,
      longitude: -74.0,
      polarity: -1,
      amplitude: 30,
      distance: 80
    };
    const stub = buildServiceStub({
      getLightningStrikes: vi.fn().mockResolvedValue([strike]),
      getCoverageStart: vi.fn().mockReturnValue(new Date(Date.now() - 3 * 60 * 60 * 1000)),
      getFeedFailure: vi.fn(() => null)
    });
    const { getLightningActivity, formatLightningActivityResponse: format } =
      await importFreshLightningHandler(stub);

    const result = await getLightningActivity({ latitude: 40.7128, longitude: -74.006 });
    expect(result.safety.level).toBe('safe');
    expect(result.coverage.feedUnavailable).toBe(false);

    const formatted = format(result);
    expect(formatted).not.toContain('UNKNOWN');
    expect(formatted).toContain('no immediate lightning threat');
  });

  it('contract 9: isComplete stays false during an outage even when getCoverageStart reports full historical coverage', async () => {
    const stub = buildServiceStub({
      getLightningStrikes: vi.fn().mockResolvedValue([]),
      // 3h ago — would normally be "complete" for any window up to 120 minutes.
      getCoverageStart: vi.fn().mockReturnValue(new Date(Date.now() - 3 * 60 * 60 * 1000)),
      getFeedFailure: vi.fn(() => ({ at: new Date(), reason: 'connection_error' as const }))
    });
    const { getLightningActivity } = await importFreshLightningHandler(stub);

    const result = await getLightningActivity({ latitude: 40.7128, longitude: -74.006, timeWindow: 60 });

    expect(result.coverage.feedUnavailable).toBe(true);
    expect(result.coverage.isComplete).toBe(false);
    // Honest about the earlier monitoring — the outage does not erase coverageMinutes.
    expect(result.coverage.coverageMinutes).toBeGreaterThan(0);
  });

  it('contract 10: handleGetLightningActivity resolves (isError unset) under an outage, and get_weather_summary renders it inline', async () => {
    const stub = buildServiceStub({
      getLightningStrikes: vi.fn().mockResolvedValue([]),
      getCoverageStart: vi.fn().mockReturnValue(null),
      getFeedFailure: vi.fn(() => ({ at: new Date(), reason: 'connect_timeout' as const }))
    });
    const { handleGetLightningActivity } = await importFreshLightningHandler(stub);

    const result = await handleGetLightningActivity(
      { latitude: 40.7128, longitude: -74.006 },
      {} as never,
      {} as never
    );

    expect((result as { isError?: boolean }).isError).toBeUndefined();
    expect(result.content[0].text).toContain('## ⚪ Safety Status: UNKNOWN (LIVE FEED UNAVAILABLE)');

    // Real handleGetWeatherSummary, include: ['lightning'] — proves the same outage renders
    // inline through the composite tool rather than under '## lightning (unavailable)'.
    // weatherSummaryHandler.ts's own catch only fires on a THROWN error, and D1 says this
    // path must never throw. locationStore/geocodingService/noaaService/openMeteoService/
    // nceiService are all inert stubs here: coordinates are passed directly, so
    // resolveLocationAsync short-circuits before touching them, and only the 'lightning'
    // section is included, so no other service is ever called (mirrors
    // tests/unit/lightning-handler.test.ts's locationStore/geocodingService stubs).
    const summaryStub = buildServiceStub({
      getLightningStrikes: vi.fn().mockResolvedValue([]),
      getCoverageStart: vi.fn().mockReturnValue(null),
      getFeedFailure: vi.fn(() => ({ at: new Date(), reason: 'connect_timeout' as const }))
    });
    const { handleGetWeatherSummary } = await importFreshWeatherSummaryHandler(summaryStub);

    const summaryResult = await handleGetWeatherSummary(
      { latitude: 40.7128, longitude: -74.006, include: ['lightning'] },
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const summaryText = summaryResult.content[0].text;

    expect(summaryText).toContain('## ⚪ Safety Status: UNKNOWN (LIVE FEED UNAVAILABLE)');
    expect(summaryText).not.toContain('## lightning (unavailable)');
  });
});
