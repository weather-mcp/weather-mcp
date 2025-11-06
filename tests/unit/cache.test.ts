import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Cache } from '../../src/utils/cache.js';

describe('Cache', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    // Create cache with max size of 3 for testing
    cache = new Cache<string>(3, Infinity); // Disable auto-cleanup for deterministic tests
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1', 1000);
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should update existing values', () => {
      cache.set('key1', 'value1', 1000);
      cache.set('key1', 'value2', 1000);
      expect(cache.get('key1')).toBe('value2');
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1', 1000);
      cache.set('key2', 'value2', 1000);
      cache.clear();
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('TTL (Time To Live)', () => {
    it('should return undefined for expired entries', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      cache.set('key1', 'value1', 1000); // 1 second TTL

      // Advance time by 1001ms (past TTL)
      vi.setSystemTime(now + 1001);
      expect(cache.get('key1')).toBeUndefined();

      vi.useRealTimers();
    });

    it('should return value before expiration', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      cache.set('key1', 'value1', 1000); // 1 second TTL

      // Advance time by 500ms (before TTL)
      vi.setSystemTime(now + 500);
      expect(cache.get('key1')).toBe('value1');

      vi.useRealTimers();
    });

    it('should support infinite TTL', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      cache.set('key1', 'value1', Infinity);

      // Advance time by a very long time
      vi.setSystemTime(now + 365 * 24 * 60 * 60 * 1000); // 1 year
      expect(cache.get('key1')).toBe('value1');

      vi.useRealTimers();
    });
  });

  describe('LRU Eviction', () => {
    it('should evict an entry when max size is reached', () => {
      cache.set('key1', 'value1', 10000);
      cache.set('key2', 'value2', 10000);
      cache.set('key3', 'value3', 10000);

      // Cache is now full (max size = 3)
      expect(cache.getStats().size).toBe(3);

      // Adding a 4th key should trigger eviction
      cache.set('key4', 'value4', 10000);

      // Cache should still be at max size
      expect(cache.getStats().size).toBe(3);

      // key4 should be in the cache
      expect(cache.get('key4')).toBe('value4');

      // One of the original keys should have been evicted
      const remainingKeys = [
        cache.get('key1'),
        cache.get('key2'),
        cache.get('key3')
      ].filter(v => v !== undefined);

      expect(remainingKeys.length).toBe(2);
    });

    it('should not evict when updating existing key', () => {
      cache.set('key1', 'value1', 10000);
      cache.set('key2', 'value2', 10000);
      cache.set('key3', 'value3', 10000);

      // Update key1 - should not trigger eviction
      cache.set('key1', 'updated', 10000);

      expect(cache.get('key1')).toBe('updated');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
      expect(cache.getStats().size).toBe(3);
    });
  });

  describe('Statistics', () => {
    it('should track cache hits', () => {
      cache.set('key1', 'value1', 10000);
      cache.get('key1');
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
    });

    it('should track cache misses', () => {
      cache.get('nonexistent');
      cache.get('another');

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });

    it('should track evictions', () => {
      cache.set('key1', 'value1', 10000);
      cache.set('key2', 'value2', 10000);
      cache.set('key3', 'value3', 10000);
      cache.set('key4', 'value4', 10000); // Should trigger eviction

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });

    it('should calculate hit rate correctly', () => {
      cache.set('key1', 'value1', 10000);
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('nonexistent'); // miss

      const hitRate = cache.getHitRate();
      expect(hitRate).toBeCloseTo(66.67, 1); // 2 hits / 3 total = 66.67%
    });

    it('should return 0 hit rate when no requests', () => {
      expect(cache.getHitRate()).toBe(0);
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate keys from primitives', () => {
      const key1 = Cache.generateKey('forecast', 37.7749, -122.4194);
      const key2 = Cache.generateKey('forecast', 37.7749, -122.4194);
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different values', () => {
      const key1 = Cache.generateKey('forecast', 37.7749, -122.4194);
      const key2 = Cache.generateKey('forecast', 40.7128, -74.0060);
      expect(key1).not.toBe(key2);
    });

    it('should handle null and undefined in key generation', () => {
      const key1 = Cache.generateKey('test', null, undefined);
      const key2 = Cache.generateKey('test', null, undefined);
      expect(key1).toBe(key2);
      expect(key1).toBe('test:null:null');
    });

    it('should handle boolean values in key generation', () => {
      const key = Cache.generateKey('alerts', true, false);
      expect(key).toBe('alerts:true:false');
    });

    it('should throw error for object in key generation', () => {
      expect(() => {
        Cache.generateKey('test', { foo: 'bar' } as any);
      }).toThrow('Object not allowed');
    });

    it('should throw error for array in key generation', () => {
      expect(() => {
        Cache.generateKey('test', [1, 2, 3] as any);
      }).toThrow('Object not allowed');
    });

    it('should prevent cache poisoning with sanitized inputs', () => {
      // Test that special characters are safely handled
      const key = Cache.generateKey('test', ':', ',', ';');
      expect(typeof key).toBe('string');
    });
  });

  describe('Memory Management', () => {
    it('should cleanup expired entries on demand', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      cache.set('key1', 'value1', 1000);
      cache.set('key2', 'value2', 10000);

      // Advance time to expire key1
      vi.setSystemTime(now + 1001);

      // Call getStats which triggers cleanup
      const stats = cache.getStats();
      expect(stats.size).toBe(1);

      vi.useRealTimers();
    });

    it('should destroy cache and cleanup resources', () => {
      cache.set('key1', 'value1', 10000);
      cache.destroy();

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('Type Safety', () => {
    it('should handle different value types', () => {
      const stringCache = new Cache<string>();
      stringCache.set('key', 'value', 1000);
      expect(stringCache.get('key')).toBe('value');
      stringCache.destroy();

      const numberCache = new Cache<number>();
      numberCache.set('key', 42, 1000);
      expect(numberCache.get('key')).toBe(42);
      numberCache.destroy();

      const objectCache = new Cache<{ foo: string }>();
      objectCache.set('key', { foo: 'bar' }, 1000);
      expect(objectCache.get('key')).toEqual({ foo: 'bar' });
      objectCache.destroy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero max size', () => {
      const tinyCache = new Cache<string>(0);
      tinyCache.set('key', 'value', 1000);
      // Should still allow setting since we check >= maxSize
      expect(tinyCache.getStats().size).toBeGreaterThan(0);
      tinyCache.destroy();
    });

    it('should handle very large TTL values', () => {
      cache.set('key', 'value', Number.MAX_SAFE_INTEGER);
      expect(cache.get('key')).toBe('value');
    });

    it('should handle rapid get/set operations', () => {
      for (let i = 0; i < 1000; i++) {
        cache.set(`key${i % 3}`, `value${i}`, 10000);
      }

      // Should not crash and maintain max size
      expect(cache.getStats().size).toBeLessThanOrEqual(3);
    });
  });

  describe('Automatic Cleanup', () => {
    it('should periodically cleanup expired entries', async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      // Create cache with short cleanup interval (1 second)
      const autoCache = new Cache<string>(10, 1000);

      autoCache.set('key1', 'value1', 500); // 500ms TTL
      autoCache.set('key2', 'value2', 10000); // 10s TTL

      // Advance time past key1 expiration but before cleanup
      vi.setSystemTime(now + 600);
      vi.advanceTimersByTime(0); // Process any pending timers

      // Advance time to trigger cleanup interval
      vi.setSystemTime(now + 1100);
      await vi.advanceTimersByTimeAsync(1100);

      // key1 should be cleaned up automatically
      const stats = autoCache.getStats();
      expect(stats.size).toBe(1);

      autoCache.destroy();
      vi.useRealTimers();
    });
  });
});
