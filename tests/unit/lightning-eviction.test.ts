/**
 * Query-path LRU eviction in `src/services/blitzortung.ts` (L14):
 *
 *  - only the excess over the cap is evicted, never the count of new geohashes;
 *  - a geohash the current request needs is never a candidate, so the queried area keeps its
 *    first-subscribed stamp (its coverage start);
 *  - the capacity check, eviction and staging are one synchronous run, so two concurrent queries
 *    cannot jointly exceed the cap, and the UNSUBACK is never awaited (G20);
 *  - a synchronous throw from `unsubscribe` is logged with name and code only and the query goes on.
 *
 * Harness copied from `blitzortung-prune.test.ts` (SINGLES, runQuery, fillWithQueries,
 * holdUnsubscribes) and `lightning-prewarm-service.test.ts` (NINE_C, SHARED_OLD); never imported,
 * because importing a test file runs its suites. Fake timers go on before the fresh import (G133);
 * time moves only by `advanceTimersByTimeAsync` (G107).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { calculateGeohashSubscriptions } from '../../src/utils/geohash.js';

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

type FakeClient = ReturnType<typeof createFakeMqttClient>;

async function importFreshModulesKeepingTimers() {
  vi.resetModules();
  const blitzortungModule = await import('../../src/services/blitzortung.js');
  const loggerModule = await import('../../src/utils/logger.js');
  return { ...blitzortungModule, logger: loggerModule.logger };
}

type Fresh = Awaited<ReturnType<typeof importFreshModulesKeepingTimers>>;

function geohashesFor(latitude: number, longitude: number, radiusKm: number): string[] {
  return Array.from(calculateGeohashSubscriptions(latitude, longitude, radiusKm));
}

function topicOf(geohash: string): string {
  return `blitzortung/1.1/${geohash.split('').join('/')}/#`;
}

/** 60 one-geohash points at radius 100 km, mutually distinct and disjoint from NINE_C. */
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

/** Nine geohashes at radius 175 km, prefix 1p/1n; includes '1p5'. */
const NINE_C = { lat: -50, lon: -130, radius: 175 };
/** Exactly {'1p5'} at radius 40 km: the centre of NINE_C's '1p5' tile. */
const SHARED_OLD = { lat: -49.921875, lon: -130.078125, radius: 40 };
/** Nine geohashes at radius 175 km; shares six with NINE_C and adds '1pe', '1ps', '1pd'. */
const NINE_C_NORTH = { lat: -48.5, lon: -130, radius: 175 };

type Area = { lat: number; lon: number; radius: number };

const SENTINEL = 'SENTINEL-BROKER mqtt://sentinel.invalid:1883';

function sentinelError(): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(SENTINEL);
  e.code = 'ESENTINEL';
  return e;
}

function startQuery(fresh: Fresh, a: Area) {
  return fresh.blitzortungService.getLightningStrikes(a.lat, a.lon, a.radius, 60);
}

async function runQuery(fresh: Fresh, a: Area) {
  const pending = startQuery(fresh, a);
  await vi.advanceTimersByTimeAsync(10_000);
  return pending;
}

const single = (i: number): Area => ({ lat: SINGLES[i].lat, lon: SINGLES[i].lon, radius: 100 });

async function fillWithQueries(fresh: Fresh, count: number, from = 0): Promise<void> {
  for (let i = from; i < from + count; i++) {
    await runQuery(fresh, single(i));
  }
}

async function setup() {
  const client = createFakeMqttClient();
  vi.doMock('mqtt', () => ({ default: { connect: vi.fn(() => client) } }));
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

function holdUnsubscribes(client: FakeClient) {
  const held: Array<(error: Error | null) => void> = [];
  client.unsubscribe.mockImplementation((_topics: string[], cb: (error: Error | null) => void) => {
    held.push(cb);
  });
  return held;
}

function unsubscribedTopics(client: FakeClient, fromCall = 0): string[] {
  return client.unsubscribe.mock.calls.slice(fromCall).flatMap(c => c[0] as string[]);
}

/** Topics subscribed minus topics unsubscribed, over the whole call log. */
function liveTopicCount(client: FakeClient): number {
  const subscribed = client.subscribe.mock.calls.reduce((n, c) => n + (c[0] as string[]).length, 0);
  return subscribed - unsubscribedTopics(client).length;
}

/** The same count, sampled after every `subscribe` call, in call order across both mocks. */
function liveCountAtEachSubscribe(client: FakeClient): number[] {
  const events = [
    ...client.subscribe.mock.calls.map((c, i) => ({
      order: client.subscribe.mock.invocationCallOrder[i], delta: (c[0] as string[]).length, sub: true
    })),
    ...client.unsubscribe.mock.calls.map((c, i) => ({
      order: client.unsubscribe.mock.invocationCallOrder[i], delta: -(c[0] as string[]).length, sub: false
    }))
  ].sort((a, b) => a.order - b.order);
  const samples: number[] = [];
  let live = 0;
  for (const e of events) {
    live += e.delta;
    if (e.sub) {
      samples.push(live);
    }
  }
  return samples;
}

function subscribedGeohashes(fresh: Fresh): Map<string, number> {
  return (fresh.blitzortungService as unknown as { subscribedGeohashes: Map<string, number> }).subscribedGeohashes;
}

afterEach(() => {
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Query-path eviction', () => {
  it("never evicts the request's own geohashes, and keeps their coverage start", async () => {
    const { client, fresh } = await setup();
    await runQuery(fresh, SHARED_OLD); // '1p5' is now the oldest subscription
    const stamp = fresh.blitzortungService.getCoverageStart(SHARED_OLD.lat, SHARED_OLD.lon, SHARED_OLD.radius);
    expect(stamp).not.toBeNull();
    await fillWithQueries(fresh, 49);
    expect(liveTopicCount(client)).toBe(50);

    await runQuery(fresh, NINE_C); // 8 new: '1p5' is already subscribed

    const evicted = unsubscribedTopics(client);
    expect(evicted).toHaveLength(8);
    expect(evicted).not.toContain(topicOf('1p5'));
    expect(evicted).toEqual(Array.from({ length: 8 }, (_, i) => topicOf(geohashesFor(SINGLES[i].lat, SINGLES[i].lon, 100)[0])));
    expect(fresh.blitzortungService.getCoverageStart(SHARED_OLD.lat, SHARED_OLD.lon, SHARED_OLD.radius))
      .toEqual(stamp);
    expect(liveTopicCount(client)).toBe(50);
  });

  it('evicts exactly the excess over the cap, oldest first', async () => {
    const { client, fresh } = await setup();
    await fillWithQueries(fresh, 45);

    await runQuery(fresh, NINE_C); // 45 + 9 = 54: an excess of 4

    expect(unsubscribedTopics(client)).toEqual(
      [0, 1, 2, 3].map(i => topicOf(geohashesFor(SINGLES[i].lat, SINGLES[i].lon, 100)[0]))
    );
    expect(liveTopicCount(client)).toBe(50);
  });

  it('evicts nothing when the request fits under the cap', async () => {
    const { client, fresh } = await setup();
    await fillWithQueries(fresh, 41);

    await runQuery(fresh, NINE_C); // 41 + 9 = 50

    expect(client.unsubscribe).not.toHaveBeenCalled();
    expect(liveTopicCount(client)).toBe(50);
  });

  it('two overlapping concurrent queries at a full cap never exceed it together', async () => {
    const { client, fresh } = await setup();
    await fillWithQueries(fresh, 50);
    const subscribeCallsBefore = client.subscribe.mock.calls.length;
    const unsubscribeCallsBefore = client.unsubscribe.mock.calls.length;

    const a = startQuery(fresh, NINE_C);
    const b = startQuery(fresh, NINE_C_NORTH);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([a, b]);

    for (const live of liveCountAtEachSubscribe(client)) {
      expect(live).toBeLessThanOrEqual(50);
    }
    expect(liveTopicCount(client)).toBe(50);

    const concurrentSubscribed = new Set(client.subscribe.mock.calls.slice(subscribeCallsBefore).flatMap(c => c[0] as string[]));
    const concurrentUnsubscribed = unsubscribedTopics(client, unsubscribeCallsBefore);
    expect(concurrentUnsubscribed.length).toBeGreaterThan(0);
    for (const topic of concurrentUnsubscribed) {
      expect(concurrentSubscribed.has(topic)).toBe(false);
    }
  });

  it('does not wait on the UNSUBACK before subscribing the new area', async () => {
    const { client, fresh } = await setup();
    await fillWithQueries(fresh, 50);
    holdUnsubscribes(client); // never released
    const subscribeCallsBefore = client.subscribe.mock.calls.length;

    const pending = startQuery(fresh, NINE_C);
    await vi.advanceTimersByTimeAsync(100);

    const staged = client.subscribe.mock.calls.slice(subscribeCallsBefore).flatMap(c => c[0] as string[]);
    expect(staged.sort()).toEqual(geohashesFor(NINE_C.lat, NINE_C.lon, NINE_C.radius).map(topicOf).sort());

    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
  });

  it('a synchronous unsubscribe throw is logged with name and code, and the query continues', async () => {
    const { client, fresh, spies } = await setup();
    await fillWithQueries(fresh, 50);
    client.unsubscribe.mockImplementation(() => {
      throw sentinelError();
    });

    const strikes = await runQuery(fresh, NINE_C);

    expect(Array.isArray(strikes)).toBe(true);
    const failures = spies.warn.mock.calls.filter(c => c[0] === 'Failed to unsubscribe from topics');
    expect(failures).toHaveLength(1);
    expect(failures[0][1]).toMatchObject({ name: 'Error', code: 'ESENTINEL' });
    expect(JSON.stringify(failures)).not.toContain('SENTINEL-BROKER');

    const tracked = subscribedGeohashes(fresh);
    for (let i = 0; i < 9; i++) {
      expect(tracked.has(geohashesFor(SINGLES[i].lat, SINGLES[i].lon, 100)[0])).toBe(false);
    }
    expect(tracked.size).toBe(50);
  });
});
