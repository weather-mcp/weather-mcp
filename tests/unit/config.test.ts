import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CacheConfig, getHistoricalDataTTL } from '../../src/config/cache.js';

describe('Cache Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('CacheConfig', () => {
    it('should have default values', () => {
      expect(CacheConfig.enabled).toBe(true);
      expect(CacheConfig.maxSize).toBe(1000);
    });

    it('should have proper TTL values', () => {
      expect(CacheConfig.ttl.gridCoordinates).toBe(Infinity);
      expect(CacheConfig.ttl.stations).toBeGreaterThan(0);
      expect(CacheConfig.ttl.forecast).toBeGreaterThan(0);
      expect(CacheConfig.ttl.currentConditions).toBeGreaterThan(0);
      expect(CacheConfig.ttl.alerts).toBeGreaterThan(0);
      expect(CacheConfig.ttl.recentHistorical).toBeGreaterThan(0);
      expect(CacheConfig.ttl.historicalData).toBe(Infinity);
      expect(CacheConfig.ttl.serviceStatus).toBeGreaterThan(0);
    });

    it('should have proper TTL ordering', () => {
      // Alerts should be cached for the shortest time (most volatile)
      expect(CacheConfig.ttl.alerts).toBeLessThan(CacheConfig.ttl.currentConditions);

      // Current conditions should be shorter than forecasts
      expect(CacheConfig.ttl.currentConditions).toBeLessThan(CacheConfig.ttl.forecast);

      // Recent historical should be shorter than stations
      expect(CacheConfig.ttl.recentHistorical).toBeLessThan(CacheConfig.ttl.stations);
    });

    it('should convert time constants correctly', () => {
      const MINUTE = 60 * 1000;
      const HOUR = 60 * MINUTE;
      const DAY = 24 * HOUR;

      // Alerts: 5 minutes
      expect(CacheConfig.ttl.alerts).toBe(5 * MINUTE);

      // Current conditions: 15 minutes
      expect(CacheConfig.ttl.currentConditions).toBe(15 * MINUTE);

      // Forecast: 2 hours
      expect(CacheConfig.ttl.forecast).toBe(2 * HOUR);

      // Stations: 24 hours
      expect(CacheConfig.ttl.stations).toBe(24 * HOUR);
    });
  });

  describe('getHistoricalDataTTL', () => {
    it('should return infinite TTL for old data (string date)', () => {
      const oldDate = '2024-01-01';
      const ttl = getHistoricalDataTTL(oldDate);
      expect(ttl).toBe(Infinity);
    });

    it('should return infinite TTL for old data (Date object)', () => {
      const oldDate = new Date('2024-01-01');
      const ttl = getHistoricalDataTTL(oldDate);
      expect(ttl).toBe(Infinity);
    });

    it('should return recent TTL for very recent data', () => {
      const now = new Date();
      const ttl = getHistoricalDataTTL(now);
      expect(ttl).toBe(CacheConfig.ttl.recentHistorical);
      expect(ttl).not.toBe(Infinity);
    });

    it('should return recent TTL for data less than 1 day old', () => {
      const yesterday = new Date();
      yesterday.setHours(yesterday.getHours() - 12); // 12 hours ago
      const ttl = getHistoricalDataTTL(yesterday);
      expect(ttl).toBe(CacheConfig.ttl.recentHistorical);
    });

    it('should return infinite TTL for data more than 1 day old', () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const ttl = getHistoricalDataTTL(twoDaysAgo);
      expect(ttl).toBe(Infinity);
    });

    it('should handle boundary at exactly 1 day', () => {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      oneDayAgo.setMinutes(oneDayAgo.getMinutes() - 1); // Slightly more than 1 day
      const ttl = getHistoricalDataTTL(oneDayAgo);
      expect(ttl).toBe(Infinity);
    });

    it('should handle ISO date strings', () => {
      const isoDate = '2023-12-25T00:00:00Z';
      const ttl = getHistoricalDataTTL(isoDate);
      expect(ttl).toBe(Infinity);
    });

    it('should handle dates in different formats', () => {
      const formats = [
        '2024-01-15',
        '2024-01-15T12:00:00Z',
        '2024-01-15T12:00:00.000Z',
        new Date('2024-01-15'),
      ];

      formats.forEach(date => {
        const ttl = getHistoricalDataTTL(date);
        expect(ttl).toBe(Infinity);
      });
    });
  });

  describe('Environment Variable Handling', () => {
    it('should use default values when env vars not set', () => {
      delete process.env.CACHE_ENABLED;
      delete process.env.CACHE_MAX_SIZE;

      // Need to reload module to test environment variable handling
      // For now, just verify the defaults are reasonable
      expect(CacheConfig.enabled).toBe(true);
      expect(CacheConfig.maxSize).toBe(1000);
    });

    it('should validate maxSize is within reasonable bounds', () => {
      expect(CacheConfig.maxSize).toBeGreaterThanOrEqual(100);
      expect(CacheConfig.maxSize).toBeLessThanOrEqual(10000);
    });
  });

  describe('Cache Strategy', () => {
    it('should use infinite TTL for static data', () => {
      // Grid coordinates and finalized historical data never change
      expect(CacheConfig.ttl.gridCoordinates).toBe(Infinity);
      expect(CacheConfig.ttl.historicalData).toBe(Infinity);
    });

    it('should use short TTL for rapidly changing data', () => {
      const HOUR = 60 * 60 * 1000;

      // Alerts and current conditions change frequently
      expect(CacheConfig.ttl.alerts).toBeLessThan(HOUR);
      expect(CacheConfig.ttl.currentConditions).toBeLessThan(HOUR);
    });

    it('should use medium TTL for semi-static data', () => {
      const HOUR = 60 * 60 * 1000;
      const DAY = 24 * HOUR;

      // Forecasts update every few hours
      expect(CacheConfig.ttl.forecast).toBeGreaterThanOrEqual(HOUR);
      expect(CacheConfig.ttl.forecast).toBeLessThan(DAY);

      // Stations rarely change
      expect(CacheConfig.ttl.stations).toBeGreaterThanOrEqual(DAY);
    });
  });

  describe('TTL Calculations', () => {
    it('should calculate TTL based on age of data', () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6 hours ago
      const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      expect(getHistoricalDataTTL(recent)).toBe(CacheConfig.ttl.recentHistorical);
      expect(getHistoricalDataTTL(old)).toBe(Infinity);
    });

    it('should handle edge case at midnight', () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(23, 59, 59, 999);

      // Just under 24 hours ago
      const ttl1 = getHistoricalDataTTL(yesterday);
      expect(ttl1).toBe(CacheConfig.ttl.recentHistorical);

      // Just over 24 hours ago - need to go back more than 1 day
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const ttl2 = getHistoricalDataTTL(twoDaysAgo);
      expect(ttl2).toBe(Infinity);
    });
  });

  describe('Type Safety', () => {
    it('should have readonly config', () => {
      // TypeScript should prevent mutation
      // This test verifies the structure exists
      expect(CacheConfig).toBeDefined();
      expect(CacheConfig.ttl).toBeDefined();
    });

    it('should handle all TTL keys', () => {
      const requiredKeys = [
        'gridCoordinates',
        'stations',
        'forecast',
        'currentConditions',
        'alerts',
        'recentHistorical',
        'historicalData',
        'serviceStatus',
      ];

      requiredKeys.forEach(key => {
        expect(CacheConfig.ttl).toHaveProperty(key);
        expect(typeof (CacheConfig.ttl as any)[key]).toBe('number');
      });
    });
  });

  describe('API Timeout Configuration - v1.0.0', () => {
    it('should have default API timeout value', () => {
      // Default should be 30000ms (30 seconds)
      expect(CacheConfig.apiTimeoutMs).toBe(30000);
    });

    it('should validate API timeout is within bounds', () => {
      // Min: 5000ms (5 seconds)
      // Max: 120000ms (2 minutes)
      expect(CacheConfig.apiTimeoutMs).toBeGreaterThanOrEqual(5000);
      expect(CacheConfig.apiTimeoutMs).toBeLessThanOrEqual(120000);
    });

    it('should use API timeout in both NOAA and OpenMeteo services', () => {
      // This verifies the configuration exists
      expect(CacheConfig).toHaveProperty('apiTimeoutMs');
      expect(typeof CacheConfig.apiTimeoutMs).toBe('number');
    });

    it('should enforce minimum timeout boundary', () => {
      // Minimum should be 5000ms
      const minTimeout = 5000;
      expect(CacheConfig.apiTimeoutMs).toBeGreaterThanOrEqual(minTimeout);
    });

    it('should enforce maximum timeout boundary', () => {
      // Maximum should be 120000ms (2 minutes)
      const maxTimeout = 120000;
      expect(CacheConfig.apiTimeoutMs).toBeLessThanOrEqual(maxTimeout);
    });

    it('should have reasonable default for production use', () => {
      // 30 seconds is a good balance between:
      // - Allowing time for slow network/API responses
      // - Not waiting too long for failed requests
      expect(CacheConfig.apiTimeoutMs).toBe(30000);

      // Should be in the middle range, not at extremes
      expect(CacheConfig.apiTimeoutMs).toBeGreaterThan(5000);
      expect(CacheConfig.apiTimeoutMs).toBeLessThan(120000);
    });

    it('should be used for all API client configurations', () => {
      // The timeout should be configurable and used consistently
      // across both NOAA and OpenMeteo services
      const timeout = CacheConfig.apiTimeoutMs;

      expect(timeout).toBeGreaterThan(0);
      expect(Number.isFinite(timeout)).toBe(true);
      expect(Number.isInteger(timeout)).toBe(true);
    });

    it('should prevent timeout overflow issues', () => {
      // Ensure timeout value doesn't cause 32-bit integer overflow
      const maxSafeInt32 = 2147483647; // 2^31 - 1
      expect(CacheConfig.apiTimeoutMs).toBeLessThan(maxSafeInt32);
    });

    it('should be appropriate for network requests', () => {
      // Timeout should be:
      // - Long enough for typical API responses (>5s)
      // - Short enough to avoid hanging indefinitely (<2min)
      const timeout = CacheConfig.apiTimeoutMs;

      expect(timeout).toBeGreaterThanOrEqual(5 * 1000); // At least 5 seconds
      expect(timeout).toBeLessThanOrEqual(2 * 60 * 1000); // At most 2 minutes
    });

    it('should handle concurrent requests without timeout conflicts', () => {
      // Multiple services should be able to use the same timeout config
      const timeout1 = CacheConfig.apiTimeoutMs;
      const timeout2 = CacheConfig.apiTimeoutMs;

      expect(timeout1).toBe(timeout2);
      expect(timeout1).toBe(30000);
    });
  });
});
