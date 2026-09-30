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
