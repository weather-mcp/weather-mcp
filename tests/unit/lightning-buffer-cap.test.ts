/**
 * The Blitzortung strike-buffer cap, driven through the real `BlitzortungService` message handler.
 * A fake MQTT client delivers 10,001 strikes with unique keys; the buffer must hold 10,000, then
 * evict the oldest tenth by insertion order and warn once with a security event.
 *
 * The seam helpers are local copies of the ones in `tool-budget-lightning.test.ts` (never imported).
 * `importFresh` runs `vi.resetModules()`, so the logger is re-imported inside the same epoch and
 * that instance is the one spied (G21).
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

function createPresentMqttModule(client: ReturnType<typeof createFakeMqttClient>) {
  const connect = vi.fn(() => client);
  return { esModule: { default: { connect } }, connect };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/** Wait, without moving the fake clock, until the query has subscribed. `setImmediate` is not faked. */
async function untilSubscribed(client: ReturnType<typeof createFakeMqttClient>, count = 1): Promise<void> {
  for (let i = 0; i < 200 && client.subscribe.mock.calls.length < count; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  expect(client.subscribe.mock.calls.length).toBeGreaterThanOrEqual(count);
  await flushMicrotasks();
}

/** A fresh service and logger, from one registry, with `mqtt` replaced by `client`. */
async function importFresh(client: ReturnType<typeof createFakeMqttClient>) {
  const mqtt = createPresentMqttModule(client);
  vi.resetModules();
  vi.doMock('mqtt', () => mqtt.esModule);
  const { blitzortungService } = await import('../../src/services/blitzortung.js');
  const { logger } = await import('../../src/utils/logger.js');
  return { service: blitzortungService, logger };
}

const LAT = 40.0;
const LON = -74.0;
const CAP = 10000;
const CAPACITY_MESSAGE = 'Lightning strike buffer at capacity, removing oldest entries';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
});

describe('Blitzortung strike buffer cap', () => {
  it('holds 10,000 strikes, then evicts the oldest tenth and warns once', async () => {
    const client = createFakeMqttClient();
    const { service, logger } = await importFresh(client);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const buffer = (service as unknown as { strikeBuffer: Map<string, unknown> }).strikeBuffer;
    const capacityWarns = () => warn.mock.calls.filter(c => c[0] === CAPACITY_MESSAGE);

    const time = Date.now();
    const lonOf = (i: number) => LON + i * 1e-6;
    const keyOf = (i: number) => `${time}_${LAT}_${lonOf(i)}`;
    const emit = (i: number) =>
      client.emit('message', 'topic', Buffer.from(JSON.stringify({ lat: LAT, lon: lonOf(i), time })));

    const query = service.getLightningStrikes(LAT, LON, 100, 60);
    await untilSubscribed(client);

    let maxSize = 0;
    for (let i = 0; i < CAP; i++) {
      emit(i);
      maxSize = Math.max(maxSize, buffer.size);
    }
    // Assertion 1: full, and no capacity warn yet.
    expect(buffer.size).toBe(CAP);
    expect(capacityWarns()).toHaveLength(0);

    // The 10,001st strike triggers the eviction.
    emit(CAP);
    maxSize = Math.max(maxSize, buffer.size);

    // Assertion 2: exactly one capacity warn, with the security event flag.
    expect(capacityWarns()).toEqual([
      [CAPACITY_MESSAGE, { currentSize: CAP, maxSize: CAP, securityEvent: true }]
    ]);

    // Assertion 3: oldest tenth gone (insertion order), the rest and the new strike kept.
    expect(buffer.size).toBe(CAP - 1000 + 1);
    for (let i = 0; i < 1000; i++) {
      expect(buffer.has(keyOf(i))).toBe(false);
    }
    expect(buffer.has(keyOf(1000))).toBe(true);
    expect(buffer.has(keyOf(CAP))).toBe(true);

    // Assertion 4: the size never exceeded the cap (sampled after every emit).
    expect(maxSize).toBeLessThanOrEqual(CAP);

    await vi.advanceTimersByTimeAsync(11_000);
    await query;
  });
});
