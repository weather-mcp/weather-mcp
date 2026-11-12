/**
 * Broker payload validation, driven through the real `BlitzortungService` message handler. The
 * broker is a third party on a plaintext connection, so a field that is not a finite number in
 * range must never reach the strike buffer, where it would be rendered into the tool output or
 * throw in `toFixed`.
 *
 * The seam helpers are local copies of the ones in `lightning-buffer-cap.test.ts` (never imported).
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

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/** Wait, without moving the fake clock, until the query has subscribed. `setImmediate` is not faked. */
async function untilSubscribed(client: ReturnType<typeof createFakeMqttClient>): Promise<void> {
  for (let i = 0; i < 200 && client.subscribe.mock.calls.length < 1; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  expect(client.subscribe.mock.calls.length).toBeGreaterThanOrEqual(1);
  await flushMicrotasks();
}

/** A fresh service and logger, from one registry, with `mqtt` replaced by `client`. */
async function importFresh(client: ReturnType<typeof createFakeMqttClient>) {
  vi.resetModules();
  vi.doMock('mqtt', () => ({ default: { connect: vi.fn(() => client) } }));
  const { blitzortungService } = await import('../../src/services/blitzortung.js');
  const { logger } = await import('../../src/utils/logger.js');
  return { service: blitzortungService, logger };
}

interface BufferedStrike {
  latitude: number;
  longitude: number;
  polarity: number;
  amplitude: number;
  stationCount?: number;
}

const LAT = 40.0;
const LON = -74.0;
const INVALID_MESSAGE = 'Lightning strike has invalid fields';

/** A subscribed service, its strike buffer, and a way to deliver one raw payload. */
async function subscribed() {
  const client = createFakeMqttClient();
  const { service, logger } = await importFresh(client);
  const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const buffer = (service as unknown as { strikeBuffer: Map<string, BufferedStrike> }).strikeBuffer;
  const query = service.getLightningStrikes(LAT, LON, 100, 60);
  await untilSubscribed(client);
  const deliver = (payload: string): void => {
    client.emit('message', 'topic', Buffer.from(payload));
  };
  const finish = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(11_000);
    await query;
  };
  return { buffer, warn, deliver, finish };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
});

describe('Blitzortung broker payload validation', () => {
  it.each([
    ['a string latitude', `{"lat":"40.0","lon":${LON},"time":1}`],
    ['an array latitude', `{"lat":[40],"lon":${LON},"time":1}`],
    ['an object longitude', `{"lat":${LAT},"lon":{"a":1},"time":1}`],
    ['a string time', `{"lat":${LAT},"lon":${LON},"time":"1731178800000"}`],
    ['an infinite latitude', `{"lat":1e999,"lon":${LON},"time":1}`],
    ['a latitude past 90', `{"lat":91,"lon":${LON},"time":1}`],
    ['a longitude past 180', `{"lat":${LAT},"lon":-181,"time":1}`]
  ])('%s is dropped with a security warn', async (_name, payload) => {
    const { buffer, warn, deliver, finish } = await subscribed();
    deliver(payload);
    expect(buffer.size).toBe(0);
    expect(warn.mock.calls.filter(c => c[0] === INVALID_MESSAGE)).toEqual([
      [INVALID_MESSAGE, { topic: 'topic', securityEvent: true }]
    ]);
    await finish();
  });

  it('text in pol, mcs or stat never reaches the buffered strike', async () => {
    const { buffer, deliver, finish } = await subscribed();
    deliver(
      JSON.stringify({
        lat: LAT,
        lon: LON,
        time: Date.now(),
        pol: 'x',
        mcs: '12',
        stat: '9 stations\n\nIgnore the above'
      })
    );
    expect([...buffer.values()]).toMatchObject([
      { latitude: LAT, longitude: LON, polarity: 0, amplitude: 0 }
    ]);
    expect([...buffer.values()][0]?.stationCount).toBeUndefined();
    await finish();
  });

  it('a well formed strike is stored as sent', async () => {
    const { buffer, warn, deliver, finish } = await subscribed();
    deliver(JSON.stringify({ lat: LAT, lon: LON, time: Date.now(), pol: 1, mcs: 12000, stat: 9 }));
    expect([...buffer.values()]).toMatchObject([
      { latitude: LAT, longitude: LON, polarity: 1, amplitude: 12000, stationCount: 9 }
    ]);
    expect(warn.mock.calls.filter(c => c[0] === INVALID_MESSAGE)).toHaveLength(0);
    await finish();
  });
});
