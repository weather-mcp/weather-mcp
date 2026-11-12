/**
 * Blitzortung feed messages are validated before they reach the strike buffer, driven through the
 * real `BlitzortungService` message handler and the real lightning render (M4 through the public
 * seam). Rejects are counted and warned about at most once a minute, with no topic or payload text.
 *
 * Reject rows ported from weather-mcp/weather-mcp#132 by MagicCactus42, as contracts; the PR's
 * per-message warn is replaced by the bounded one, so its warn assertions are not ported.
 *
 * The seam helpers are local copies of the ones in `lightning-buffer-cap.test.ts` (never imported).
 * Fake timers go on before the import (G133); time moves only by `advanceTimersByTimeAsync` (G107).
 * Every fixture `time` derives from the faked `Date.now()` (G67).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

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

type FakeClient = ReturnType<typeof createFakeMqttClient>;

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/** Wait, without moving the fake clock, until the query has subscribed. `setImmediate` is not faked. */
async function untilSubscribed(client: FakeClient, count = 1): Promise<void> {
  for (let i = 0; i < 200 && client.subscribe.mock.calls.length < count; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  expect(client.subscribe.mock.calls.length).toBeGreaterThanOrEqual(count);
  await flushMicrotasks();
}

/** A fresh service, handler and logger, from one registry, with `mqtt` replaced by `client`. */
async function importFresh(client: FakeClient) {
  const connect = vi.fn(() => client);
  vi.resetModules();
  vi.doMock('mqtt', () => ({ default: { connect } }));
  const { blitzortungService } = await import('../../src/services/blitzortung.js');
  const { handleGetLightningActivity } = await import('../../src/handlers/lightningHandler.js');
  const { logger } = await import('../../src/utils/logger.js');
  return { service: blitzortungService, handleGetLightningActivity, logger };
}

const TOPIC = 'TOPIC-SENTINEL';
const PAYLOAD_SENTINEL = 'secret-token-abc';
const REJECT_MESSAGE = 'Lightning feed messages rejected';
const OLD_MESSAGES = [
  'Lightning strike missing required fields',
  'Invalid timestamp in lightning strike',
  'Failed to parse lightning strike message'
];
const LAT = 40.0;
const LON = -74.0;

type Env = Awaited<ReturnType<typeof importFresh>> & {
  client: FakeClient;
  warn: ReturnType<typeof vi.spyOn>;
  allLogArgs: () => unknown[][];
  buffer: { size: number };
};

/** Fresh service, logger spies, and one query started so the client is connected and subscribed. */
async function connected(): Promise<Env & { firstQuery: Promise<unknown> }> {
  const client = createFakeMqttClient();
  const env = await importFresh(client);
  const warn = vi.spyOn(env.logger, 'warn').mockImplementation(() => undefined);
  const info = vi.spyOn(env.logger, 'info').mockImplementation(() => undefined);
  const debug = vi.spyOn(env.logger, 'debug').mockImplementation(() => undefined);
  const error = vi.spyOn(env.logger, 'error').mockImplementation(() => undefined);
  const allLogArgs = () => [...warn.mock.calls, ...info.mock.calls, ...debug.mock.calls, ...error.mock.calls];
  const buffer = (env.service as unknown as { strikeBuffer: { size: number } }).strikeBuffer;
  const firstQuery = env.service.getLightningStrikes(LAT, LON, 100, 60);
  await untilSubscribed(client);
  return { ...env, client, warn, allLogArgs, buffer, firstQuery };
}

function emitJson(client: FakeClient, value: unknown): void {
  client.emit('message', TOPIC, Buffer.from(JSON.stringify(value)));
}

/** Let the pending query's 10 s collection window close, and return what it read. */
async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(11_000);
  return p;
}

/** A query at (lat, lon) started now, its collection window advanced through. */
async function queryAt(service: Env['service'], lat: number, lon: number) {
  return settle(service.getLightningStrikes(lat, lon, 50, 60));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-06-15T18:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
});

describe('Blitzortung message validation (M4 through the public seam)', () => {
  /** The seven #132 reject rows, with `time` from the test's own clock. */
  const portedRejects = (now: number): Array<[string, Record<string, unknown>]> => [
    ['string latitude', { lat: '40.01', lon: LON, time: now }],
    ['array latitude', { lat: [40.01], lon: LON, time: now }],
    ['object longitude', { lat: 40.01, lon: { v: -74 }, time: now }],
    ['string time', { lat: 40.01, lon: LON, time: String(now) }],
    ['latitude 91', { lat: 91, lon: LON, time: now }],
    ['longitude -181', { lat: 40.01, lon: -181, time: now }]
  ];

  it('never buffers a #132 reject row, and the report renders without throwing', async () => {
    const env = await connected();
    const now = Date.now();
    for (const [, msg] of portedRejects(now)) {
      emitJson(env.client, msg);
    }
    // `1e999` parses to Infinity: written as raw text, because JSON.stringify would emit null.
    env.client.emit('message', TOPIC, Buffer.from(`{"lat":1e999,"lon":${LON},"time":${now}}`));
    expect(env.buffer.size).toBe(0);

    await settle(env.firstQuery);
    expect(await queryAt(env.service, LAT, LON)).toEqual([]);

    const rendered = env.handleGetLightningActivity({ latitude: LAT, longitude: LON, radius: 50, timeWindow: 60 });
    await vi.advanceTimersByTimeAsync(11_000);
    const result = await rendered;
    const text = result.content.map(c => ('text' in c ? c.text : '')).join('\n');
    expect(text).toContain('**Total Strikes:** 0');
  });

  it('buffers and returns strikes at latitude 0 and at longitude 0', async () => {
    const env = await connected();
    const now = Date.now();
    emitJson(env.client, { lat: 0, lon: 10, time: now });
    emitJson(env.client, { lat: 10, lon: 0, time: now });
    expect(env.buffer.size).toBe(2);
    await settle(env.firstQuery);

    const onEquator = await queryAt(env.service, 0.01, 10);
    expect(onEquator.map(s => [s.latitude, s.longitude])).toEqual([[0, 10]]);
    const onMeridian = await queryAt(env.service, 10, 0.01);
    expect(onMeridian.map(s => [s.latitude, s.longitude])).toEqual([[10, 0]]);
  });

  it('drops a strike dated beyond the skew, and buffers one dated 2 minutes ahead', async () => {
    const env = await connected();
    const now = Date.now();
    emitJson(env.client, { lat: 40.01, lon: LON, time: now + 5 * 60_000 + 1 });
    expect(env.buffer.size).toBe(0);
    emitJson(env.client, { lat: 40.02, lon: LON, time: now + 2 * 60_000 });
    expect(env.buffer.size).toBe(1);
    await settle(env.firstQuery);

    const strikes = await queryAt(env.service, LAT, LON);
    expect(strikes.map(s => s.timestamp.getTime())).toEqual([now + 2 * 60_000]);
  });

  it('keeps a strike whose optional fields are wrong-typed, with the absent values', async () => {
    const env = await connected();
    const now = Date.now();
    emitJson(env.client, { lat: 40.01, lon: LON, time: now, pol: 'x', mcs: '12', stat: '9' });
    expect(env.buffer.size).toBe(1);
    await settle(env.firstQuery);

    const [strike] = await queryAt(env.service, LAT, LON);
    expect(strike.polarity).toBe(0);
    expect(strike.amplitude).toBe(0);
    expect(strike.stationCount).toBeUndefined();
  });

  it('drops an oversize payload', async () => {
    const env = await connected();
    const now = Date.now();
    const padded = JSON.stringify({ lat: 40.01, lon: LON, time: now, pad: 'p'.repeat(5000) });
    env.client.emit('message', TOPIC, Buffer.from(padded));
    expect(env.buffer.size).toBe(0);
    await settle(env.firstQuery);
  });
});

describe('Bounded reject warn', () => {
  it('warns once for 100 rejects in a minute, then carries the counts since', async () => {
    const env = await connected();
    const rejectWarns = () => env.warn.mock.calls.filter(c => c[0] === REJECT_MESSAGE);
    const now = Date.now();

    // First reject: not JSON, and the bytes carry the payload sentinel.
    env.client.emit('message', TOPIC, Buffer.from(`${PAYLOAD_SENTINEL} {`));
    // 99 more, mixed reasons.
    for (let i = 0; i < 33; i++) {
      emitJson(env.client, { lat: 'x', lon: LON, time: now });         // bad_coordinate
      emitJson(env.client, { lat: 40.01, lon: LON, time: 0 });        // bad_time
      emitJson(env.client, { lat: 40.01, lon: LON, time: now + 3_600_000 }); // future
    }
    expect(rejectWarns()).toEqual([[REJECT_MESSAGE, { rejected: { not_json: 1 }, securityEvent: true }]]);

    await vi.advanceTimersByTimeAsync(60_000);
    await env.firstQuery;
    env.client.emit('message', TOPIC, Buffer.from(`${PAYLOAD_SENTINEL} {`));

    expect(rejectWarns()).toEqual([
      [REJECT_MESSAGE, { rejected: { not_json: 1 }, securityEvent: true }],
      [REJECT_MESSAGE, { rejected: { bad_coordinate: 33, bad_time: 33, future: 33, not_json: 1 }, securityEvent: true }]
    ]);

    for (const args of rejectWarns()) {
      const serialised = JSON.stringify(args);
      expect(serialised).not.toContain(TOPIC);
      expect(serialised).not.toContain(PAYLOAD_SENTINEL);
    }
    // The payload sentinel reaches no log line at all, and none of the three old warns is ever logged.
    expect(JSON.stringify(env.allLogArgs())).not.toContain(PAYLOAD_SENTINEL);
    for (const old of OLD_MESSAGES) {
      expect(env.allLogArgs().some(c => c[0] === old)).toBe(false);
    }
  });

  it('a valid message produces no reject warn', async () => {
    const env = await connected();
    emitJson(env.client, { lat: 40.01, lon: LON, time: Date.now() * 1e6, pol: 1, mcs: 12000, stat: 9 });
    expect(env.buffer.size).toBe(1);
    expect(env.warn.mock.calls.filter(c => c[0] === REJECT_MESSAGE)).toHaveLength(0);
    await settle(env.firstQuery);
  });
});
