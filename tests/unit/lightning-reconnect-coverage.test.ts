/**
 * Unit tests for the reconnect-bounded lightning coverage contract
 * (plan-lightning-reconnect-coverage, T2): a coverage start is the later of the newest
 * subscription stamp and the newest broker `connect`, and a client that mqtt.js is
 * reconnecting is waited on, never replaced by a second one.
 *
 * Drives the REAL BlitzortungService through a fresh module re-import per test (G21), with
 * `mqtt` replaced by a local fake client. The service is built under fake timers by
 * `importFreshBlitzortung` and abandoned there, then each test body turns fake timers on
 * again and pins the system clock, so subscription and connect times differ by known amounts.
 *
 * Time arithmetic (G107): a query after a `close` parks until `connect` is emitted or the
 * 30 s connect timeout passes, and every query then waits a 10 s collection window.
 *
 * Determinism: nothing here opens a socket. Every case `vi.doMock`s 'mqtt'.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

const T0 = Date.parse('2026-03-01T12:00:00.000Z');
const MINUTE = 60_000;

/** Four areas far enough apart that none shares a geohash at a 10 km radius. */
const AREA_A = { lat: 40.0, lon: -74.0 };
const AREA_B = { lat: 34.0, lon: -118.0 };
const AREA_C = { lat: 48.0, lon: 2.0 };
const AREA_D = { lat: -33.0, lon: 151.0 };
const RADIUS_KM = 10;

/**
 * A fake `MqttClient`. `connect: 'immediate'` fires the 'connect' handler on a microtask when it
 * is registered; 'never' never fires it. `emit` replays an event to every registered handler.
 */
function createFakeMqttClient(opts: { connect?: 'immediate' | 'never' } = {}) {
  const { connect = 'immediate' } = opts;
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

  const client = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(cb);
      if (event === 'connect' && connect === 'immediate') {
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

type FakeClient = ReturnType<typeof createFakeMqttClient>;

/** A present `mqtt` module stub whose `connect()` returns the given fake client. */
function createPresentMqttModule(client: FakeClient) {
  const connect = vi.fn(() => client);
  return { esModule: { default: { connect } }, connect };
}

/**
 * Re-import blitzortung.js from a clean registry (G21). Wrapped in fake timers so the
 * constructor's two intervals land on a clock that is then abandoned; the test body turns fake
 * timers on again for its own clock.
 */
async function importFreshBlitzortung() {
  vi.useFakeTimers();
  vi.resetModules();
  try {
    return await import('../../src/services/blitzortung.js');
  } finally {
    vi.useRealTimers();
  }
}

type Service = Awaited<ReturnType<typeof importFreshBlitzortung>>['blitzortungService'];
type BoundOut = { boundedBy?: 'subscription' | 'connection' };

/** A service, its fake client and the `mqtt.connect` mock, with the clock pinned at T0. */
async function setup(opts: { connect?: 'immediate' | 'never' } = {}) {
  const client = createFakeMqttClient(opts);
  const mod = createPresentMqttModule(client);
  vi.doMock('mqtt', () => mod.esModule);
  const { blitzortungService } = await importFreshBlitzortung();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  return { service: blitzortungService, client, mqttConnect: mod.connect };
}

function start(service: Service, area: { lat: number; lon: number }, bound?: BoundOut) {
  return service.getCoverageStart(area.lat, area.lon, RADIUS_KM, bound);
}

function query(service: Service, area: { lat: number; lon: number }) {
  return service.getLightningStrikes(area.lat, area.lon, RADIUS_KM, 60);
}

/** Query an area on a connected client and let its 10 s collection window finish. */
async function queryAndSettle(service: Service, area: { lat: number; lon: number }) {
  const promise = query(service, area);
  await vi.advanceTimersByTimeAsync(10_000);
  return promise;
}

/** Emit one strike near AREA_A into the service buffer. */
function bufferStrike(client: FakeClient): void {
  client.emit(
    'message',
    'blitzortung/1.1/d/r/5/#',
    Buffer.from(JSON.stringify({ lat: 40.02, lon: -74.0, time: Date.now(), pol: 1, mcs: 12000, stat: 9 }))
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
});

describe('lightning reconnect coverage — service contracts (blitzortung.ts)', () => {
  it('C4: a first connection with no loss starts coverage at the subscription stamp', async () => {
    const { service } = await setup();

    await queryAndSettle(service, AREA_A);

    const bound: BoundOut = {};
    // The connect and the stamp land in the same fake millisecond: a tie reads as a subscription.
    expect(start(service, AREA_A, bound)?.getTime()).toBe(T0);
    expect(bound.boundedBy).toBe('subscription');
  });

  it('C1: after a close healed by a reconnect, coverage starts at the reconnect, not the subscription', async () => {
    const { service, client } = await setup();
    await queryAndSettle(service, AREA_A);

    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    client.emit('close');
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    const reconnectAt = Date.now();
    client.emit('connect');

    const bound: BoundOut = {};
    const got = start(service, AREA_A, bound);
    expect(reconnectAt).toBe(T0 + 10_000 + 12 * MINUTE);
    expect(got?.getTime()).toBe(reconnectAt);
    expect(got?.getTime()).toBeGreaterThan(T0);
    expect(bound.boundedBy).toBe('connection');
  });

  it('C1b: a close and reconnect in the same millisecond still report the connect as the bound', async () => {
    const { service, client } = await setup();
    await queryAndSettle(service, AREA_A);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    const reconnectAt = Date.now();
    client.emit('close');
    client.emit('connect');

    // Distinguishes "the stamp is older than the connect" from "the stamp was re-stamped on close":
    // a re-stamp at close time would tie the connect and read as a subscription.
    const bound: BoundOut = {};
    expect(start(service, AREA_A, bound)?.getTime()).toBe(reconnectAt);
    expect(bound.boundedBy).toBe('connection');
  });

  it('C3 (service half): an outage that ended before the window leaves the start older than the window', async () => {
    const { service, client } = await setup();
    await queryAndSettle(service, AREA_A);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    client.emit('close');
    await vi.advanceTimersByTimeAsync(MINUTE);
    const reconnectAt = Date.now();
    client.emit('connect');

    await vi.advanceTimersByTimeAsync(61 * MINUTE);

    const bound: BoundOut = {};
    const got = start(service, AREA_A, bound);
    expect(got?.getTime()).toBe(reconnectAt);
    expect(bound.boundedBy).toBe('connection');
    // The start is older than a 60-minute window, so a caller computes full coverage.
    expect(Date.now() - (got?.getTime() ?? Date.now())).toBe(61 * MINUTE);
    expect(Date.now() - (got?.getTime() ?? Date.now())).toBeGreaterThanOrEqual(60 * MINUTE);
  });

  it('C5: a stamp written while disconnected is clamped to the next connect', async () => {
    const { service, client, mqttConnect } = await setup({ connect: 'never' });
    type Internals = { geohashFirstSubscribed: Map<string, number> };
    const stamps = (service as unknown as Internals).geohashFirstSubscribed;

    // A's attempt is in flight; B arrives meanwhile and parks in the 100 ms poll.
    const queryA = query(service, AREA_A);
    await vi.advanceTimersByTimeAsync(1);
    const queryB = query(service, AREA_B);
    await vi.advanceTimersByTimeAsync(30_200); // A times out; B's poll wakes and stamps B
    expect(service.getFeedFailure(await queryA)?.reason).toBe('connect_timeout');
    await vi.advanceTimersByTimeAsync(10_000); // B's collection window
    const resultB = await queryB;
    expect(service.getFeedFailure(resultB)?.reason).toBe('connection_error');
    expect(mqttConnect).toHaveBeenCalledTimes(1);

    const stampedBefore = stamps.size;
    expect(stampedBefore).toBeGreaterThan(0);
    const stampB = Math.min(...stamps.values());
    expect(stampB).toBeGreaterThan(T0);

    // A caller arriving after the failed attempt takes the new wait and stamps nothing yet.
    const queryD = query(service, AREA_D);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stamps.size).toBe(stampedBefore);

    const connectAt = Date.now();
    expect(connectAt).toBeGreaterThan(stampB);
    client.emit('connect');

    const boundB: BoundOut = {};
    expect(start(service, AREA_B, boundB)?.getTime()).toBe(connectAt);
    expect(boundB.boundedBy).toBe('connection');

    await vi.advanceTimersByTimeAsync(10_000);
    await queryD;
    const boundD: BoundOut = {};
    // D stamped at the connect itself: a tie reads as a subscription.
    expect(start(service, AREA_D, boundD)?.getTime()).toBe(connectAt);
    expect(boundD.boundedBy).toBe('subscription');
    expect(mqttConnect).toHaveBeenCalledTimes(1);
  });

  it('C6: queries during a reconnect share the one client and all resolve after the connect', async () => {
    const { service, client, mqttConnect } = await setup();
    await queryAndSettle(service, AREA_A);
    client.emit('close');

    const pending = [query(service, AREA_B), query(service, AREA_C), query(service, AREA_D)];
    await vi.advanceTimersByTimeAsync(1_000);
    client.emit('connect');
    await vi.advanceTimersByTimeAsync(10_500);
    const results = await Promise.all(pending);

    for (const result of results) {
      expect(service.getFeedFailure(result)).toBeNull();
    }
    expect(mqttConnect).toHaveBeenCalledTimes(1);
  });

  it('C7 (new half): a close with no reconnect returns connect_timeout and the buffered strike, on one client', async () => {
    const { service, client, mqttConnect } = await setup();
    const first = query(service, AREA_A);
    await vi.advanceTimersByTimeAsync(1);
    bufferStrike(client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await first).toHaveLength(1);

    client.emit('close');
    const second = query(service, AREA_A);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await second;

    expect(service.getFeedFailure(result)?.reason).toBe('connect_timeout');
    expect(result).toHaveLength(1);
    expect(mqttConnect).toHaveBeenCalledTimes(1);
  });

  it('C8: disconnect() settles a waiting query at once, nulls coverage, and the next query reconnects', async () => {
    const { service, client, mqttConnect } = await setup();
    await queryAndSettle(service, AREA_A);
    client.emit('close');

    const waiting = query(service, AREA_B);
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);

    const disconnectedAt = Date.now();
    await service.disconnect();
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    expect(Date.now() - disconnectedAt).toBeLessThan(30_000);
    expect(service.getFeedFailure(await waiting)?.reason).toBe('connection_error');
    expect(start(service, AREA_A)).toBeNull();
    expect(mqttConnect).toHaveBeenCalledTimes(1);

    const next = query(service, AREA_C);
    await vi.advanceTimersByTimeAsync(10_500);
    await next;
    expect(mqttConnect).toHaveBeenCalledTimes(2);
  });

  it('C9: after a close with no reconnect the start is null and the bound stays unset', async () => {
    const { service, client } = await setup();
    await queryAndSettle(service, AREA_A);
    client.emit('close');

    const bound: BoundOut = {};
    expect(start(service, AREA_A, bound)).toBeNull();
    expect(bound.boundedBy).toBeUndefined();
  });

  it('Control: with no close, a second query in the same area keeps the first stamp on one client', async () => {
    const { service, mqttConnect } = await setup();
    await queryAndSettle(service, AREA_A);
    await vi.advanceTimersByTimeAsync(20_000);
    await queryAndSettle(service, AREA_A);

    const bound: BoundOut = {};
    expect(start(service, AREA_A, bound)?.getTime()).toBe(T0);
    expect(bound.boundedBy).toBe('subscription');
    expect(mqttConnect).toHaveBeenCalledTimes(1);
  });
});
