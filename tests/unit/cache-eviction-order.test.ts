/**
 * Cache.set at capacity removes expired entries before it evicts a live one
 * (RF-36, plan-cache-config-eviction T4).
 *
 * Expiry is driven with fake timers and `vi.setSystemTime` / `advanceTimersByTime`.
 * Per G133, nothing here calls `vi.runAllTimersAsync()`: a live `Cache` owns a
 * cleanup `setInterval`, so that call would never settle. The interval is also
 * set far beyond any advance below, so the periodic sweep never runs and every
 * removal observed is the one `set` makes.
 *
 * The discriminating fixture (G32) makes the expired entry the MOST recently
 * accessed, so the old LRU-only pick would take a live entry instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Cache } from '../../src/utils/cache.js';

const NEVER = 2_147_483_647;
const LIVE = 60_000;

describe('Cache eviction order', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T00:00:00Z'));
    cache = new Cache<string>(3, NEVER);
  });

  afterEach(() => {
    cache.destroy();
    vi.useRealTimers();
  });

  it('a full cache holding one expired entry keeps every live entry on a new-key set', () => {
    cache.set('live1', 'a', LIVE);
    vi.advanceTimersByTime(10);
    cache.set('live2', 'b', LIVE);
    vi.advanceTimersByTime(10);
    cache.set('short', 'c', 1_000); // newest, so the most recently used
    vi.advanceTimersByTime(2_000); // 'short' is now expired; live1 is the LRU

    cache.set('new', 'd', LIVE);

    expect(cache.get('live1')).toBe('a');
    expect(cache.get('live2')).toBe('b');
    expect(cache.get('new')).toBe('d');
    expect(cache.get('short')).toBeUndefined();
    const stats = cache.getStats();
    expect(stats.size).toBe(3);
    expect(stats.evictions).toBe(0);
  });

  it('a full cache with no expired entry still evicts the least recently used one, counted', () => {
    cache.set('k1', 'a', LIVE);
    vi.advanceTimersByTime(10);
    cache.set('k2', 'b', LIVE);
    vi.advanceTimersByTime(10);
    cache.set('k3', 'c', LIVE);
    vi.advanceTimersByTime(10);
    cache.get('k1'); // touch k1 and k3, so k2 is the LRU
    vi.advanceTimersByTime(10);
    cache.get('k3');

    cache.set('k4', 'd', LIVE);

    expect(cache.get('k2')).toBeUndefined();
    expect(cache.get('k1')).toBe('a');
    expect(cache.get('k3')).toBe('c');
    expect(cache.get('k4')).toBe('d');
    expect(cache.getStats().evictions).toBe(1);
  });

  it('one set sweeps every expired entry, not just one', () => {
    cache.set('dead1', 'a', 1_000);
    cache.set('dead2', 'b', 1_000);
    cache.set('live', 'c', LIVE);
    vi.advanceTimersByTime(2_000);

    cache.set('new', 'd', LIVE);

    // Read the size before any get, which would itself drop an expired entry.
    expect((cache as unknown as { cache: Map<string, unknown> }).cache.size).toBe(2);
    expect(cache.get('live')).toBe('c');
    expect(cache.get('new')).toBe('d');
    expect(cache.getStats().evictions).toBe(0);
  });

  it("evicts the '' key when it is the least recently used, and never grows past maxSize", () => {
    cache.set('', 'empty-key', LIVE);
    vi.advanceTimersByTime(10);
    cache.set('k2', 'b', LIVE);
    vi.advanceTimersByTime(10);
    cache.set('k3', 'c', LIVE);

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(10);
      cache.set(`n${i}`, String(i), LIVE);
      expect((cache as unknown as { cache: Map<string, unknown> }).cache.size).toBeLessThanOrEqual(3);
    }
    expect(cache.get('')).toBeUndefined();
  });

  it('an Infinity-TTL entry is never swept', () => {
    cache.set('forever', 'x', Infinity);
    vi.advanceTimersByTime(10);
    cache.set('dead', 'y', 1_000);
    vi.advanceTimersByTime(10);
    cache.set('live', 'z', LIVE);
    vi.advanceTimersByTime(2 * 3_600_000); // 'live' and 'dead' both expire; 'forever' is the LRU

    cache.set('new', 'w', LIVE);

    expect(cache.get('forever')).toBe('x');
    expect(cache.get('new')).toBe('w');
    expect(cache.getStats().evictions).toBe(0);
  });
});
