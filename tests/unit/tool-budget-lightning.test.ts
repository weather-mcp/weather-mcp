/**
 * The lightning query path under a tool call's budget (design plan `plan-tool-time-budget`,
 * impl-plan amendment for codex-R1). MQTT never passes the axios seam, so
 * `getLightningStrikes` reads the remaining budget once at entry and bounds its own waits: a spent
 * budget starts no broker work, the subscribe wait is raced against the remainder, and the
 * collection sleep is never longer than what is left. Only the caller's wait is bounded — the
 * shared connection keeps its own 30 s timer. Outside a tool call every wait is as before.
 *
 * The fake MQTT client is a local copy of the one in `lightning-feed-outage.test.ts` (never
 * imported from a lock file). The service and the budget module are imported fresh per test from
 * the same module registry, so the budget the test installs is the one the service reads. Both
 * read `performance.now`, spied here, so `t` is the one clock.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

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

function createPresentMqttModule(client: ReturnType<typeof createFakeMqttClient>) {
  const connect = vi.fn(() => client);
  return { esModule: { default: { connect } }, connect };
}

/** Observe a promise's state without awaiting it. */
function track<T>(p: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  p.then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    }
  );
  return state;
}

let t = 0;

async function tick(ms: number): Promise<void> {
  t += ms;
  await vi.advanceTimersByTimeAsync(ms);
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/**
 * Wait, without moving `t` or the fake clock, until the query has subscribed. The dynamic
 * `import('mqtt')` resolves over more than a few microtasks, and a tick taken before it lands
 * would move `t` under the collection sleep's arithmetic. `setImmediate` is not faked here.
 */
async function untilSubscribed(client: ReturnType<typeof createFakeMqttClient>, count = 1): Promise<void> {
  for (let i = 0; i < 200 && client.subscribe.mock.calls.length < count; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  expect(client.subscribe.mock.calls.length).toBeGreaterThanOrEqual(count);
  await flushMicrotasks();
}

/** A fresh service and budget module, from one registry, with `mqtt` replaced by `client`. */
async function importFresh(client: ReturnType<typeof createFakeMqttClient>) {
  const mqtt = createPresentMqttModule(client);
  vi.resetModules();
  vi.doMock('mqtt', () => mqtt.esModule);
  const { blitzortungService } = await import('../../src/services/blitzortung.js');
  const { runWithToolBudget } = await import('../../src/utils/toolBudget.js');
  return { service: blitzortungService, runWithToolBudget, connect: mqtt.connect };
}

const LAT = 40.0;
const LON = -74.0;

beforeEach(() => {
  t = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.spyOn(performance, 'now').mockImplementation(() => t);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
});

describe('getLightningStrikes under a tool budget', () => {
  it('(a) a budget spent at entry starts no broker work and reports the feed as degraded', async () => {
    const client = createFakeMqttClient();
    const { service, runWithToolBudget, connect } = await importFresh(client);

    const state = track(
      runWithToolBudget(55_000, async () => {
        t = 55_000;
        return service.getLightningStrikes(LAT, LON, 100, 60);
      })
    );
    await flushMicrotasks();

    expect(state.settled).toBe(true);
    expect(connect).toHaveBeenCalledTimes(0);
    expect(state.value).toEqual([]);
    expect(service.getFeedFailure(state.value!)?.reason).toBe('connect_timeout');
  });

  it('(a) with strikes already buffered, a spent budget returns them and subscribes nothing new', async () => {
    const client = createFakeMqttClient();
    const { service, runWithToolBudget, connect } = await importFresh(client);

    // Seed the buffer outside any budget: one ordinary query, a strike arriving mid-collection.
    const seeding = track(service.getLightningStrikes(LAT, LON, 100, 60));
    await untilSubscribed(client);
    client.emit('message', 'blitzortung/1.1/d/r/7', Buffer.from(JSON.stringify({
      lat: LAT + 0.05, lon: LON + 0.05, time: Date.now(), pol: 0, mcs: 0, stat: 5
    })));
    await tick(10_000);
    expect(seeding.settled).toBe(true);
    const subscribesBefore = client.subscribe.mock.calls.length;

    const state = track(
      runWithToolBudget(55_000, async () => {
        t += 55_000;
        return service.getLightningStrikes(LAT, LON, 100, 60);
      })
    );
    await flushMicrotasks();

    expect(state.settled).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.subscribe.mock.calls.length).toBe(subscribesBefore);
    expect(state.value).toHaveLength(1);
    expect(service.getFeedFailure(state.value!)?.reason).toBe('connect_timeout');
  });

  it('(b) a connect that never answers releases the caller at the remainder, not at 30 000', async () => {
    const client = createFakeMqttClient({ connect: 'never' });
    const { service, runWithToolBudget, connect } = await importFresh(client);

    const state = track(
      runWithToolBudget(55_000, async () => {
        t = 40_000;
        return service.getLightningStrikes(LAT, LON, 100, 60);
      })
    );

    await tick(14_999);
    expect(state.settled).toBe(false);
    await tick(1);
    expect(state.settled).toBe(true);
    expect(state.error).toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(service.getFeedFailure(state.value!)?.reason).toBe('connect_timeout');

    // The shared connect keeps its own 30 s timer; its later rejection must be handled.
    await tick(15_000);
    await flushMicrotasks();
  });

  it('(c) the collection wait is no longer than the remainder', async () => {
    const client = createFakeMqttClient();
    const { service, runWithToolBudget } = await importFresh(client);

    const state = track(
      runWithToolBudget(55_000, async () => {
        t = 50_000;
        return service.getLightningStrikes(LAT, LON, 100, 60);
      })
    );
    await untilSubscribed(client);

    await tick(4_999);
    expect(state.settled).toBe(false);
    await tick(1);
    expect(state.settled).toBe(true);
    expect(service.getFeedFailure(state.value!)).toBeNull();
  });

  describe('(d) control, outside any budget', () => {
    it('a connect that never answers resolves at 30 000 with connect_timeout', async () => {
      const client = createFakeMqttClient({ connect: 'never' });
      const { service } = await importFresh(client);

      const state = track(service.getLightningStrikes(LAT, LON, 100, 60));
      await tick(29_999);
      expect(state.settled).toBe(false);
      await tick(1);
      expect(state.settled).toBe(true);
      expect(service.getFeedFailure(state.value!)?.reason).toBe('connect_timeout');
    });

    it('a connected query collects for 10 000', async () => {
      const client = createFakeMqttClient();
      const { service } = await importFresh(client);

      const state = track(service.getLightningStrikes(LAT, LON, 100, 60));
      await untilSubscribed(client);
      await tick(9_999);
      expect(state.settled).toBe(false);
      await tick(1);
      expect(state.settled).toBe(true);
      expect(service.getFeedFailure(state.value!)).toBeNull();
    });
  });
});
