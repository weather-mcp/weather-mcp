import { describe, it, expect, vi } from 'vitest';
import { RequestSpacer } from '../../src/utils/requestSpacer.js';

const I = 1000;

/** A recording sleep that never resolves, so callers stay in flight. */
function makeNeverSleep() {
  return vi.fn((_ms: number): Promise<void> => new Promise<void>(() => {}));
}

describe('RequestSpacer', () => {
  it('hands three synchronous reservations distinct slots', () => {
    const sleep = makeNeverSleep();
    const spacer = new RequestSpacer(I, { now: () => 10_000, sleep });

    void spacer.reserve();
    void spacer.reserve();
    void spacer.reserve();

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('starts an idle first reservation with no sleep and an already-settled promise', async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const spacer = new RequestSpacer(I, { now: () => 10_000, sleep });

    const winner = await Promise.race([
      spacer.reserve().then(() => 'reserve'),
      Promise.resolve().then(() => 'late'),
    ]);

    // Positive control: the reserve promise did resolve, and first.
    expect(winner).toBe('reserve');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('resets after idleness', () => {
    let t = 10_000;
    const sleep = makeNeverSleep();
    const spacer = new RequestSpacer(I, { now: () => t, sleep });

    void spacer.reserve();
    void spacer.reserve();
    void spacer.reserve();
    // Positive control: the three reservations did sleep twice.
    expect(sleep).toHaveBeenCalledTimes(2);

    t += 3 * I + 1;
    void spacer.reserve();

    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('moves no slot when an earlier caller fails', async () => {
    const sleep = makeNeverSleep();
    const spacer = new RequestSpacer(I, { now: () => 10_000, sleep });

    await spacer
      .reserve()
      .then(() => {
        throw new Error('x');
      })
      .catch(() => {});
    void spacer.reserve();
    void spacer.reserve();

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('calls onWait once with the wait, and not on an idle first reservation', () => {
    const sleep = makeNeverSleep();
    const onWait = vi.fn();
    const spacer = new RequestSpacer(I, { now: () => 10_000, sleep });

    void spacer.reserve(onWait);
    expect(onWait).not.toHaveBeenCalled();

    void spacer.reserve(onWait);
    // Positive control: the second reservation slept.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(onWait).toHaveBeenCalledWith(1000);
  });

  it('the default sleep looks up the global setTimeout at call time', async () => {
    let t = 10_000;
    const spy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: () => void, ms?: number) => {
        t += ms as number;
        fn();
        return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout);
    try {
      const spacer = new RequestSpacer(I, { now: () => t });

      await spacer.reserve();
      expect(spy).not.toHaveBeenCalled();

      await spacer.reserve();
      expect(spy).toHaveBeenCalledTimes(1);
      const delay = spy.mock.calls[0]?.[1] as number;
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(I);
    } finally {
      spy.mockRestore();
    }
  });

  describe('wake re-check (G122)', () => {
    /** A sleep the test resolves by hand, recording each requested wait. */
    function makeHandSleep() {
      const pending: Array<{ ms: number; resolve: () => void }> = [];
      const sleep = vi.fn(
        (ms: number) => new Promise<void>((resolve) => pending.push({ ms, resolve }))
      );
      return { pending, sleep };
    }

    /** Let every queued continuation run. */
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    function track(p: Promise<void>): { done: boolean } {
      const state = { done: false };
      void p.then(() => {
        state.done = true;
      });
      return state;
    }

    it('re-spaces two waiters whose overdue sleeps wake in the same turn', async () => {
      let t = 10_000;
      const { pending, sleep } = makeHandSleep();
      const spacer = new RequestSpacer(I, { now: () => t, sleep });

      await spacer.reserve();
      const b = track(spacer.reserve());
      const c = track(spacer.reserve());
      expect(pending.map((p) => p.ms)).toEqual([1000, 2000]);

      // A stall past both deadlines: both timers are delivered together.
      t = 12_600;
      pending[0]?.resolve();
      pending[1]?.resolve();
      await flush();

      expect(b.done).toBe(true);
      expect(c.done).toBe(false);
      expect(pending.map((p) => p.ms)).toEqual([1000, 2000, 1000]);

      t = 13_600;
      pending[2]?.resolve();
      await flush();
      expect(c.done).toBe(true);
    });

    it('re-checks again when a re-sleeping waiter wakes behind a newer one', async () => {
      let t = 10_000;
      const { pending, sleep } = makeHandSleep();
      const spacer = new RequestSpacer(I, { now: () => t, sleep });

      await spacer.reserve();
      const b = track(spacer.reserve());
      const c = track(spacer.reserve());
      t = 12_600;
      pending[0]?.resolve();
      pending[1]?.resolve();
      await flush();
      // Positive control: B started at 12_600 and C is on its re-sleep.
      expect(b.done).toBe(true);
      expect(c.done).toBe(false);

      // D reserves behind B's actual start, not behind the stale nominal slot.
      const d = track(spacer.reserve());
      expect(pending.map((p) => p.ms)).toEqual([1000, 2000, 1000, 1000]);

      // D's first sleep and C's re-sleep share a deadline; D wakes first.
      t = 13_600;
      pending[3]?.resolve();
      pending[2]?.resolve();
      await flush();

      expect(d.done).toBe(true);
      expect(c.done).toBe(false);
      expect(pending[4]?.ms).toBe(1000);
    });

    it('rejects a sleep that resolves without moving the clock, instead of spinning', async () => {
      const sleep = vi.fn((_ms: number) => Promise.resolve());
      const spacer = new RequestSpacer(I, { now: () => 10_000, sleep });

      await spacer.reserve();
      await expect(spacer.reserve()).rejects.toThrow('without advancing');
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it('defaults to the monotonic clock, not wall time', () => {
      const perf = vi.spyOn(performance, 'now');
      const wall = vi.spyOn(Date, 'now');
      try {
        const spacer = new RequestSpacer(I);
        void spacer.reserve();

        expect(perf).toHaveBeenCalled();
        expect(wall).not.toHaveBeenCalled();
      } finally {
        perf.mockRestore();
        wall.mockRestore();
      }
    });

    it('calls onWait once with the first wait, never for a re-check sleep', async () => {
      let t = 10_000;
      const { pending, sleep } = makeHandSleep();
      const onWait = vi.fn();
      const spacer = new RequestSpacer(I, { now: () => t, sleep });

      await spacer.reserve();
      void spacer.reserve();
      void spacer.reserve(onWait);
      t = 12_600;
      pending[0]?.resolve();
      pending[1]?.resolve();
      await flush();

      // Positive control: the waiter did make a re-check sleep.
      expect(pending).toHaveLength(3);
      expect(onWait).toHaveBeenCalledTimes(1);
      expect(onWait).toHaveBeenCalledWith(2000);
    });
  });

  describe('constructor', () => {
    it.each([NaN, -1, Infinity])('throws RangeError for %s', (bad) => {
      expect(() => new RequestSpacer(bad)).toThrow(RangeError);
    });

    it('accepts 0 and never sleeps at a zero interval', () => {
      const sleep = makeNeverSleep();
      const spacer = new RequestSpacer(0, { now: () => 10_000, sleep });

      const a = spacer.reserve();
      const b = spacer.reserve();

      expect(a).toBeInstanceOf(Promise);
      expect(b).toBeInstanceOf(Promise);
      expect(sleep).not.toHaveBeenCalled();
    });
  });
});
