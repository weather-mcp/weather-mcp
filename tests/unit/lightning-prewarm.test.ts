/**
 * Unit tests for `src/server/lightningPrewarm.ts` (issue #81, T3, commit 32e07f3):
 * `startLightningPrewarm` gates on tool-enablement and the `WEATHER_LIGHTNING_PREWARM`
 * opt-out, runs once synchronously at start, then re-warms saved locations on an
 * interval so their Blitzortung subscriptions never age past the service's idle-prune
 * threshold (`SUBSCRIPTION_IDLE_THRESHOLD_MS`, `src/services/blitzortung.ts`).
 *
 * Two describe blocks:
 *
 * - Block A drives the module against fully stubbed dependencies (a fake scheduler, a
 *   `vi.fn()` `prewarmLocation`, a mutable in-memory saved-location list, and a spy on
 *   the real `logger` singleton). All of `startLightningPrewarm`'s per-call state
 *   (`unreadable`, `lastSkipped`, `stopped`) lives in closures created fresh by each
 *   call, so — unlike the service tests below — these tests need no `vi.resetModules()`
 *   and can share one static top-level import, matching the plain-import precedent in
 *   tests/unit/lightning-safe-message.test.ts and friends (this module transitively
 *   imports src/services/blitzortung.ts, which constructs the real `blitzortungService`
 *   singleton and starts its two un-`unref`'d `setInterval`s at import time; those are
 *   accepted as leaked, inert real timers for the life of this test worker, same as
 *   every other test file that imports the service — the file never advances real time
 *   far enough for them to matter).
 *
 * - Block B drives `startLightningPrewarm` against the REAL `BlitzortungService`, to
 *   prove the pre-warm interval actually keeps a saved location's subscription alive
 *   across the service's own idle-prune sweep. This needs `vi.resetModules()` plus a
 *   fresh dynamic re-import of both `blitzortung.js` and `lightningPrewarm.js` in the
 *   same epoch (G21), and — unlike tests/unit/lightning-prewarm-service.test.ts's
 *   `importFreshBlitzortung()` helper, which switches back to REAL timers immediately
 *   after the import — fake timers must stay active THROUGH the import, because the
 *   service constructor's subscription-pruning `setInterval` is registered at that
 *   moment: if timers were real then and fake now, that interval is orphaned on the old
 *   (uninstalled) fake-timer session and never fires under `vi.advanceTimersByTimeAsync`.
 *   `importFreshModulesKeepingTimers()` below is a separate, non-timer-touching helper
 *   for exactly that reason; do not swap in the other file's helper here.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { calculateGeohashSubscriptions } from '../../src/utils/geohash.js';
import type { LightningPrewarmDeps, LightningPrewarmHandle } from '../../src/server/lightningPrewarm.js';
import type { PrewarmOutcome } from '../../src/services/blitzortung.js';

// ---------------------------------------------------------------------------
// Block A: stubbed deps
// ---------------------------------------------------------------------------

type StartLightningPrewarm = (deps: LightningPrewarmDeps) => LightningPrewarmHandle;

let startLightningPrewarm: StartLightningPrewarm;
let PREWARM_REFRESH_INTERVAL_MS: number;
let logger: typeof import('../../src/utils/logger.js')['logger'];

beforeAll(async () => {
  const prewarmModule = await import('../../src/server/lightningPrewarm.js');
  const blitzModule = await import('../../src/services/blitzortung.js');
  const loggerModule = await import('../../src/utils/logger.js');
  startLightningPrewarm = prewarmModule.startLightningPrewarm;
  PREWARM_REFRESH_INTERVAL_MS = blitzModule.PREWARM_REFRESH_INTERVAL_MS;
  logger = loggerModule.logger;
});

/** A fake scheduler that records its one registered tick callback and lets a test fire it. */
function createFakeScheduler() {
  let tickFn: (() => void) | undefined;
  let nextHandle = 1;
  const handles: number[] = [];
  const setInterval = vi.fn((fn: () => void) => {
    tickFn = fn;
    const handle = nextHandle++;
    handles.push(handle);
    return handle as unknown as ReturnType<typeof globalThis.setInterval>;
  });
  const clearInterval = vi.fn();
  return {
    setInterval,
    clearInterval,
    handles,
    tick(): void {
      if (!tickFn) {
        throw new Error('createFakeScheduler: no interval was ever registered');
      }
      tickFn();
    }
  };
}

/** Flush a bounded number of microtask turns — enough for this module's shallow await chains. */
async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

const WARN_UNREADABLE = 'Skipping lightning pre-warm: saved locations could not be read';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startLightningPrewarm — stubbed deps', () => {
  it('contract 1a: toolEnabled false never starts the timer and never reads the store', () => {
    const scheduler = createFakeScheduler();
    const readSavedLocations = vi.fn(() => []);
    startLightningPrewarm({
      toolEnabled: false,
      optOutValue: undefined,
      readSavedLocations,
      prewarmLocation: vi.fn().mockResolvedValue(undefined),
      scheduler
    });

    expect(scheduler.setInterval).not.toHaveBeenCalled();
    expect(readSavedLocations).not.toHaveBeenCalled();
  });

  it("contract 1b: optOutValue 'false' never starts the timer and never reads the store", () => {
    const scheduler = createFakeScheduler();
    const readSavedLocations = vi.fn(() => []);
    startLightningPrewarm({
      toolEnabled: true,
      optOutValue: 'false',
      readSavedLocations,
      prewarmLocation: vi.fn().mockResolvedValue(undefined),
      scheduler
    });

    expect(scheduler.setInterval).not.toHaveBeenCalled();
    expect(readSavedLocations).not.toHaveBeenCalled();
  });

  it('contract 1c: gate passing with an empty store still starts the timer exactly once', () => {
    const scheduler = createFakeScheduler();
    startLightningPrewarm({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => [],
      prewarmLocation: vi.fn().mockResolvedValue(undefined),
      scheduler
    });

    expect(scheduler.setInterval).toHaveBeenCalledTimes(1);
  });

  it('contract 1d: gate passing with a store read that throws still starts the timer exactly once', () => {
    const scheduler = createFakeScheduler();
    startLightningPrewarm({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => {
        throw new Error('disk error');
      },
      prewarmLocation: vi.fn().mockResolvedValue(undefined),
      scheduler
    });

    expect(scheduler.setInterval).toHaveBeenCalledTimes(1);
  });

  it('contract 2: the guarded catch covers only the store read — a synchronous prewarmLocation throw propagates out, unlogged as "unreadable"', () => {
    const scheduler = createFakeScheduler();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const prewarmLocation = vi.fn(() => {
      throw new Error('boom from prewarmLocation');
    });

    expect(() =>
      startLightningPrewarm({
        toolEnabled: true,
        optOutValue: undefined,
        readSavedLocations: () => [{ latitude: 1, longitude: 2 }],
        prewarmLocation,
        scheduler
      })
    ).toThrow('boom from prewarmLocation');

    const unreadableWarns = warnSpy.mock.calls.filter((call) => call[0] === WARN_UNREADABLE);
    expect(unreadableWarns).toHaveLength(0);
  });

  it('contract 3: an unreadable store warns once per consecutive streak, recovers silently, and prewarms nothing on a throwing tick', async () => {
    const scheduler = createFakeScheduler();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    const prewarmLocation = vi.fn().mockResolvedValue(undefined);
    const OK_LOCATION = { latitude: 10, longitude: 20 };

    // index 0 = startup call; indices 1-5 = five manually fired ticks.
    const behaviors: Array<'ok' | 'throw'> = ['ok', 'throw', 'throw', 'throw', 'ok', 'throw'];
    let callIndex = 0;
    const readSavedLocations = vi.fn(() => {
      const behavior = behaviors[callIndex++];
      if (behavior === 'throw') {
        throw new Error('unreadable');
      }
      return [OK_LOCATION];
    });

    startLightningPrewarm({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations,
      prewarmLocation,
      scheduler
    });
    await flushMicrotasks(); // startup (index 0, 'ok') settles

    scheduler.tick(); // index 1, throw
    scheduler.tick(); // index 2, throw
    scheduler.tick(); // index 3, throw
    await flushMicrotasks();

    const unreadableWarnsAfterThreeThrows = warnSpy.mock.calls.filter((call) => call[0] === WARN_UNREADABLE);
    expect(unreadableWarnsAfterThreeThrows).toHaveLength(1);
    // Only the two 'ok' calls (startup + the recovery tick, below) ever prewarm anything.
    expect(prewarmLocation).toHaveBeenCalledTimes(1);

    scheduler.tick(); // index 4, ok — recovers silently
    await flushMicrotasks();
    expect(warnSpy.mock.calls.filter((call) => call[0] === WARN_UNREADABLE)).toHaveLength(1);
    expect(prewarmLocation).toHaveBeenCalledTimes(2);

    scheduler.tick(); // index 5, throw — a new streak starts
    await flushMicrotasks();
    expect(warnSpy.mock.calls.filter((call) => call[0] === WARN_UNREADABLE)).toHaveLength(2);
    expect(prewarmLocation).toHaveBeenCalledTimes(2); // unchanged — the throwing tick prewarmed nothing
  });

  it('contract 4: a location added between ticks is prewarmed on the next tick, and a removed one is not', async () => {
    const scheduler = createFakeScheduler();
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    const prewarmLocation = vi.fn().mockResolvedValue(undefined);
    const LOC_A = { latitude: 1, longitude: 1 };
    const LOC_B = { latitude: 2, longitude: 2 };
    let locations: Array<{ latitude: number; longitude: number }> = [LOC_A];

    startLightningPrewarm({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => [...locations],
      prewarmLocation,
      scheduler
    });
    await flushMicrotasks(); // startup: prewarms A
    expect(prewarmLocation).toHaveBeenCalledTimes(1);
    expect(prewarmLocation).toHaveBeenLastCalledWith(LOC_A.latitude, LOC_A.longitude, undefined, expect.any(Object));

    prewarmLocation.mockClear();
    locations = [LOC_A, LOC_B];
    scheduler.tick();
    await flushMicrotasks();
    expect(prewarmLocation).toHaveBeenCalledTimes(2);
    const calledWith = prewarmLocation.mock.calls.map((call) => [call[0], call[1]]);
    expect(calledWith).toContainEqual([LOC_A.latitude, LOC_A.longitude]);
    expect(calledWith).toContainEqual([LOC_B.latitude, LOC_B.longitude]);

    prewarmLocation.mockClear();
    locations = [LOC_B]; // A removed
    scheduler.tick();
    await flushMicrotasks();
    expect(prewarmLocation).toHaveBeenCalledTimes(1);
    expect(prewarmLocation).toHaveBeenCalledWith(LOC_B.latitude, LOC_B.longitude, undefined, expect.any(Object));
  });

  it('contract 5: a tick over an unchanged set (outcome "refreshed") logs no logger.info', async () => {
    const scheduler = createFakeScheduler();
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    const LOC = { latitude: 5, longitude: 5 };
    const prewarmLocation = vi.fn((_lat: number, _lon: number, _radius: number | undefined, outcome?: PrewarmOutcome) => {
      if (outcome) {
        outcome.status = 'refreshed';
      }
      return Promise.resolve();
    });

    startLightningPrewarm({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => [LOC],
      prewarmLocation,
      scheduler
    });
    await flushMicrotasks();

    infoSpy.mockClear();
    scheduler.tick();
    await flushMicrotasks();

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('contract 6: the skipped-capacity warning fires only when the skipped count changes (2, 2, 3 → exactly two warnings)', async () => {
    const scheduler = createFakeScheduler();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    const locations = [
      { latitude: 1, longitude: 1 },
      { latitude: 2, longitude: 2 },
      { latitude: 3, longitude: 3 }
    ];

    let currentSkip = 0;
    let callsThisRun = 0;
    const prewarmLocation = vi.fn((_lat: number, _lon: number, _radius: number | undefined, outcome?: PrewarmOutcome) => {
      callsThisRun += 1;
      if (outcome) {
        outcome.status = callsThisRun <= currentSkip ? 'skipped-capacity' : 'subscribed';
      }
      return Promise.resolve();
    });

    currentSkip = 2;
    callsThisRun = 0;
    startLightningPrewarm({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => locations,
      prewarmLocation,
      scheduler
    });
    await flushMicrotasks();

    const limitWarns = () =>
      warnSpy.mock.calls.filter((call) => call[0] === 'Lightning pre-warm skipped saved locations: subscription limit reached');
    expect(limitWarns()).toHaveLength(1); // 0 -> 2

    callsThisRun = 0; // still currentSkip = 2
    scheduler.tick();
    await flushMicrotasks();
    expect(limitWarns()).toHaveLength(1); // 2 -> 2, unchanged, no new warning

    currentSkip = 3;
    callsThisRun = 0;
    scheduler.tick();
    await flushMicrotasks();
    expect(limitWarns()).toHaveLength(2); // 2 -> 3
  });

  it('contract 7: stop() clears the interval, and a second stop() is harmless', () => {
    const scheduler = createFakeScheduler();
    const handle = startLightningPrewarm({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => [],
      prewarmLocation: vi.fn().mockResolvedValue(undefined),
      scheduler
    });

    handle.stop();
    expect(scheduler.clearInterval).toHaveBeenCalledTimes(1);
    expect(scheduler.clearInterval).toHaveBeenCalledWith(scheduler.handles[0]);

    expect(() => handle.stop()).not.toThrow();
    expect(scheduler.clearInterval).toHaveBeenCalledTimes(1); // not called again
  });

  it('contract 8: the default interval is PREWARM_REFRESH_INTERVAL_MS, not a restated literal', () => {
    const scheduler = createFakeScheduler();
    startLightningPrewarm({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => [],
      prewarmLocation: vi.fn().mockResolvedValue(undefined),
      scheduler
      // intervalMs omitted deliberately
    });

    expect(scheduler.setInterval).toHaveBeenCalledWith(expect.any(Function), PREWARM_REFRESH_INTERVAL_MS);
  });
});

// ---------------------------------------------------------------------------
// Block B: the real BlitzortungService, idle-prune survival
// ---------------------------------------------------------------------------

/** Local copy of the fake mqtt client pattern from tests/unit/lightning-prewarm-service.test.ts. */
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
 * Reset the module registry and re-import blitzortung.js, lightningPrewarm.js and
 * logger.js in one epoch — WITHOUT touching fake/real timer state either side. Callers
 * must already have `vi.useFakeTimers()` active before calling this (so the service
 * constructor's subscription-pruning `setInterval` registers on the fake clock) and must
 * keep fake timers active until they are done advancing that clock. This is deliberately
 * NOT the `importFreshBlitzortung()` helper in lightning-prewarm-service.test.ts, which
 * switches back to real timers as soon as the import settles — fine for that file's
 * contracts (none of them advance real time past a few seconds), wrong for this one.
 */
async function importFreshModulesKeepingTimers() {
  vi.resetModules();
  const blitzortungModule = await import('../../src/services/blitzortung.js');
  const prewarmModule = await import('../../src/server/lightningPrewarm.js');
  const loggerModule = await import('../../src/utils/logger.js');
  return {
    ...blitzortungModule,
    startLightningPrewarm: prewarmModule.startLightningPrewarm,
    logger: loggerModule.logger
  };
}

/** Topics `subscribeToLocation` would use for one point at the given radius. */
function topicsFor(latitude: number, longitude: number, radiusKm: number): string[] {
  const geohashes = calculateGeohashSubscriptions(latitude, longitude, radiusKm);
  return Array.from(geohashes).map((g) => `blitzortung/1.1/${g.split('').join('/')}/#`);
}

/** Two points empirically verified (tests/unit/lightning-prewarm-service.test.ts header) to
 *  each resolve to exactly one geohash at radius 100km, mutually disjoint. */
const LOC_A = { latitude: -80, longitude: -178 };
const LOC_B = { latitude: -80, longitude: -168 };

/**
 * Let the startup pre-warm settle. Concurrent pre-warms for more than one location race
 * on `ensureConnected`: the second caller to see `isConnecting === true` falls into a
 * 100ms-interval poll waiting for the first to finish connecting (`blitzortung.ts`'s
 * `ensureConnected`, the `isConnecting` branch). That poll is a real `setInterval` under
 * fake timers, so a plain microtask flush (`await Promise.resolve()` in a loop) can settle
 * the FIRST location's chain but leaves any later one parked forever. Advancing fake time
 * is what unblocks it — 1000ms is comfortably more than one 100ms poll tick and far below
 * every threshold this file cares about (15min prune interval, 60min idle threshold).
 */
async function settleStartup(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1000);
}

describe('startLightningPrewarm — idle-prune survival against the real BlitzortungService', () => {
  afterEach(() => {
    vi.doUnmock('mqtt');
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('re-warmed saved locations never age past the idle threshold: no unsubscribe, and one subscribe per location, not per tick', async () => {
    vi.useFakeTimers();
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService, startLightningPrewarm: start, SUBSCRIPTION_IDLE_THRESHOLD_MS } =
      await importFreshModulesKeepingTimers();

    const locations = [LOC_A, LOC_B];
    const handle: LightningPrewarmHandle = start({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => [...locations],
      prewarmLocation: (lat, lon, radius, outcome) => blitzortungService.prewarmLocation(lat, lon, radius, outcome)
    });

    try {
      await settleStartup();
      const startA = blitzortungService.getCoverageStart(LOC_A.latitude, LOC_A.longitude, 100);
      const startB = blitzortungService.getCoverageStart(LOC_B.latitude, LOC_B.longitude, 100);
      expect(startA).not.toBeNull();
      expect(startB).not.toBeNull();

      await vi.advanceTimersByTimeAsync(4 * SUBSCRIPTION_IDLE_THRESHOLD_MS);

      expect(blitzortungService.getCoverageStart(LOC_A.latitude, LOC_A.longitude, 100)!.getTime()).toBe(startA!.getTime());
      expect(blitzortungService.getCoverageStart(LOC_B.latitude, LOC_B.longitude, 100)!.getTime()).toBe(startB!.getTime());
      expect(client.unsubscribe).not.toHaveBeenCalled();
      expect(client.subscribe).toHaveBeenCalledTimes(2); // once per location, not once per tick
    } finally {
      handle.stop();
    }
  });

  it('a location removed from the store is not re-warmed and is pruned on the ordinary schedule; the other location is untouched', async () => {
    vi.useFakeTimers();
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService, startLightningPrewarm: start, SUBSCRIPTION_IDLE_THRESHOLD_MS, SUBSCRIPTION_PRUNE_INTERVAL_MS } =
      await importFreshModulesKeepingTimers();

    let locations: Array<{ latitude: number; longitude: number }> = [LOC_A, LOC_B];
    const handle: LightningPrewarmHandle = start({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => [...locations],
      prewarmLocation: (lat, lon, radius, outcome) => blitzortungService.prewarmLocation(lat, lon, radius, outcome)
    });

    try {
      await settleStartup();
      expect(blitzortungService.getCoverageStart(LOC_A.latitude, LOC_A.longitude, 100)).not.toBeNull();
      expect(blitzortungService.getCoverageStart(LOC_B.latitude, LOC_B.longitude, 100)).not.toBeNull();

      locations = [LOC_B]; // LOC_A removed from the store

      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_IDLE_THRESHOLD_MS + SUBSCRIPTION_PRUNE_INTERVAL_MS);

      expect(blitzortungService.getCoverageStart(LOC_A.latitude, LOC_A.longitude, 100)).toBeNull();
      const unsubscribedTopics = client.unsubscribe.mock.calls.flatMap((call) => call[0] as string[]);
      for (const topic of topicsFor(LOC_A.latitude, LOC_A.longitude, 100)) {
        expect(unsubscribedTopics).toContain(topic);
      }

      // The still-saved location is untouched: not pruned, not re-subscribed unnecessarily.
      expect(blitzortungService.getCoverageStart(LOC_B.latitude, LOC_B.longitude, 100)).not.toBeNull();
      for (const topic of topicsFor(LOC_B.latitude, LOC_B.longitude, 100)) {
        expect(unsubscribedTopics).not.toContain(topic);
      }
    } finally {
      handle.stop();
    }
  });

  it('control (G41): stop() right after startup means the saved location IS pruned like any other idle subscription — survival above is not vacuous', async () => {
    vi.useFakeTimers();
    const client = createFakeMqttClient();
    vi.doMock('mqtt', () => createPresentMqttModule(client).esModule);
    const { blitzortungService, startLightningPrewarm: start, SUBSCRIPTION_IDLE_THRESHOLD_MS } =
      await importFreshModulesKeepingTimers();

    const locations = [LOC_A, LOC_B];
    const handle: LightningPrewarmHandle = start({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => [...locations],
      prewarmLocation: (lat, lon, radius, outcome) => blitzortungService.prewarmLocation(lat, lon, radius, outcome)
    });

    await settleStartup();
    expect(blitzortungService.getCoverageStart(LOC_A.latitude, LOC_A.longitude, 100)).not.toBeNull();

    handle.stop(); // no further re-warming

    await vi.advanceTimersByTimeAsync(4 * SUBSCRIPTION_IDLE_THRESHOLD_MS);

    expect(blitzortungService.getCoverageStart(LOC_A.latitude, LOC_A.longitude, 100)).toBeNull();
    expect(blitzortungService.getCoverageStart(LOC_B.latitude, LOC_B.longitude, 100)).toBeNull();
    const unsubscribedTopics = client.unsubscribe.mock.calls.flatMap((call) => call[0] as string[]);
    for (const topic of [...topicsFor(LOC_A.latitude, LOC_A.longitude, 100), ...topicsFor(LOC_B.latitude, LOC_B.longitude, 100)]) {
      expect(unsubscribedTopics).toContain(topic);
    }
  });
});
