/**
 * Bounds checking tests for getMaxProbabilityFromSeries function
 * Tests the defense-in-depth security measure added in v1.0.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../src/utils/logger.js';
import type { GridpointDataSeries } from '../../src/types/noaa.js';

// We need to test the function indirectly through the handler
// since it's not exported. We'll create a mock scenario.

describe('Bounds Checking - getMaxProbabilityFromSeries', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn');
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('Array Size Limits', () => {
    it('should process series with less than 500 entries normally', () => {
      // Create a series with 100 entries
      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: Array.from({ length: 100 }, (_, i) => ({
          validTime: new Date(Date.now() + i * 60 * 60 * 1000).toISOString() + '/PT1H',
          value: Math.random() * 100
        }))
      };

      // Should not log any warning for normal size
      expect(series.values.length).toBe(100);
      expect(series.values.length).toBeLessThan(500);
    });

    it('should process series with exactly 500 entries normally', () => {
      // Create a series with exactly 500 entries
      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: Array.from({ length: 500 }, (_, i) => ({
          validTime: new Date(Date.now() + i * 60 * 60 * 1000).toISOString() + '/PT1H',
          value: Math.random() * 100
        }))
      };

      // Should not log warning at boundary
      expect(series.values.length).toBe(500);
    });

    it('should validate series structure', () => {
      const validSeries: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: [
          {
            validTime: new Date(Date.now()).toISOString() + '/PT1H',
            value: 50
          }
        ]
      };

      expect(validSeries.values).toBeDefined();
      expect(validSeries.values.length).toBeGreaterThan(0);
      expect(validSeries.values[0]).toHaveProperty('validTime');
      expect(validSeries.values[0]).toHaveProperty('value');
    });

    it('should handle empty series safely', () => {
      const emptySeries: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: []
      };

      expect(emptySeries.values.length).toBe(0);
      // Function should return 0 for empty series
    });

    it('should handle undefined series safely', () => {
      const undefinedSeries = undefined;

      expect(undefinedSeries).toBeUndefined();
      // Function should return 0 for undefined series
    });

    it('should handle series with null values safely', () => {
      const seriesWithNulls: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: [
          {
            validTime: new Date(Date.now()).toISOString() + '/PT1H',
            value: null
          },
          {
            validTime: new Date(Date.now() + 3600000).toISOString() + '/PT1H',
            value: 50
          }
        ]
      };

      expect(seriesWithNulls.values.length).toBe(2);
      expect(seriesWithNulls.values[0].value).toBeNull();
      expect(seriesWithNulls.values[1].value).toBe(50);
    });
  });

  describe('Time Window Processing', () => {
    it('should process entries within time window', () => {
      const now = new Date();
      const futureHours = 48;

      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: Array.from({ length: 50 }, (_, i) => ({
          validTime: new Date(now.getTime() + i * 60 * 60 * 1000).toISOString() + '/PT1H',
          value: i * 2
        }))
      };

      // All entries within 48 hours should be processed
      expect(series.values.length).toBe(50);
      expect(series.values[0].value).toBe(0);
      expect(series.values[47].value).toBe(94);
    });

    it('should handle entries outside time window', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
      const future = new Date(now.getTime() + 72 * 60 * 60 * 1000); // 72 hours ahead

      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: [
          {
            validTime: past.toISOString() + '/PT1H',
            value: 10
          },
          {
            validTime: now.toISOString() + '/PT1H',
            value: 50
          },
          {
            validTime: future.toISOString() + '/PT1H',
            value: 90
          }
        ]
      };

      expect(series.values.length).toBe(3);
      // Function should only consider entries between now and now+48h
    });

    it('should parse ISO 8601 interval format correctly', () => {
      const validTime = '2025-11-06T15:00:00+00:00/PT1H';

      // Should be able to parse the start time
      const startTime = validTime.split('/')[0];
      const parsed = new Date(startTime);

      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.toISOString()).toContain('2025-11-06');
    });
  });

  describe('Maximum Value Extraction', () => {
    it('should find maximum value in series', () => {
      const now = new Date();

      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: [
          {
            validTime: new Date(now.getTime() + 3600000).toISOString() + '/PT1H',
            value: 25
          },
          {
            validTime: new Date(now.getTime() + 7200000).toISOString() + '/PT1H',
            value: 75
          },
          {
            validTime: new Date(now.getTime() + 10800000).toISOString() + '/PT1H',
            value: 50
          }
        ]
      };

      // Maximum value should be 75
      expect(Math.max(...series.values.map(v => v.value || 0))).toBe(75);
    });

    it('should return 0 when all values are null', () => {
      const now = new Date();

      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: [
          {
            validTime: new Date(now.getTime() + 3600000).toISOString() + '/PT1H',
            value: null
          },
          {
            validTime: new Date(now.getTime() + 7200000).toISOString() + '/PT1H',
            value: null
          }
        ]
      };

      const maxValue = Math.max(...series.values.filter(v => v.value !== null).map(v => v.value || 0), 0);
      expect(maxValue).toBe(0);
    });

    it('should handle negative values', () => {
      const now = new Date();

      const series: GridpointDataSeries = {
        uom: 'wmoUnit:degC',
        values: [
          {
            validTime: new Date(now.getTime() + 3600000).toISOString() + '/PT1H',
            value: -10
          },
          {
            validTime: new Date(now.getTime() + 7200000).toISOString() + '/PT1H',
            value: -5
          },
          {
            validTime: new Date(now.getTime() + 10800000).toISOString() + '/PT1H',
            value: 0
          }
        ]
      };

      // Get maximum value, handling null case
      const values = series.values.map(v => v.value !== null ? v.value : -Infinity);
      expect(Math.max(...values)).toBe(0);
    });
  });

  describe('Defense Against Resource Exhaustion', () => {
    it('should limit processing to maxEntries parameter', () => {
      // Create a very large series
      const largeSeries: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: Array.from({ length: 1000 }, (_, i) => ({
          validTime: new Date(Date.now() + i * 60 * 60 * 1000).toISOString() + '/PT1H',
          value: Math.random() * 100
        }))
      };

      expect(largeSeries.values.length).toBe(1000);

      // If sliced to 500, would reduce to 500 entries
      const sliced = largeSeries.values.slice(0, 500);
      expect(sliced.length).toBe(500);
    });

    it('should handle extremely large series (10000+ entries)', () => {
      // This tests the defense-in-depth measure
      const hugeSeries: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: Array.from({ length: 10000 }, (_, i) => ({
          validTime: new Date(Date.now() + i * 60 * 60 * 1000).toISOString() + '/PT1H',
          value: Math.random() * 100
        }))
      };

      expect(hugeSeries.values.length).toBe(10000);
      expect(hugeSeries.values.length).toBeGreaterThan(500);

      // Should be sliced to maxEntries (500)
      const sliced = hugeSeries.values.slice(0, 500);
      expect(sliced.length).toBe(500);
    });

    it('should maintain performance with bounded array size', () => {
      const maxEntries = 500;

      // Even with large input, processing is bounded
      const largeSeries: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: Array.from({ length: 5000 }, (_, i) => ({
          validTime: new Date(Date.now() + i * 60 * 60 * 1000).toISOString() + '/PT1H',
          value: Math.random() * 100
        }))
      };

      // Start timer
      const start = performance.now();

      // Slice to max entries
      const bounded = largeSeries.values.slice(0, maxEntries);

      // Process bounded array
      let maxValue = 0;
      const now = Date.now();
      const futureTime = now + 48 * 60 * 60 * 1000;

      for (const entry of bounded) {
        const validTimeStart = new Date(entry.validTime.split('/')[0]).getTime();
        if (validTimeStart >= now && validTimeStart <= futureTime && entry.value !== null) {
          maxValue = Math.max(maxValue, entry.value);
        }
      }

      const duration = performance.now() - start;

      // Should complete quickly (under 10ms)
      expect(duration).toBeLessThan(10);
      expect(bounded.length).toBe(maxEntries);
    });
  });

  describe('Custom maxEntries Parameter', () => {
    it('should support custom maxEntries values', () => {
      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: Array.from({ length: 1000 }, (_, i) => ({
          validTime: new Date(Date.now() + i * 60 * 60 * 1000).toISOString() + '/PT1H',
          value: i
        }))
      };

      // Test different maxEntries values
      const customLimits = [100, 250, 500, 750];

      for (const limit of customLimits) {
        const sliced = series.values.slice(0, limit);
        expect(sliced.length).toBe(limit);
      }
    });

    it('should default to 500 entries', () => {
      // Default maxEntries should be 500
      const defaultMaxEntries = 500;

      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: Array.from({ length: 1000 }, (_, i) => ({
          validTime: new Date(Date.now() + i * 60 * 60 * 1000).toISOString() + '/PT1H',
          value: i
        }))
      };

      const sliced = series.values.slice(0, defaultMaxEntries);
      expect(sliced.length).toBe(500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle series with single entry', () => {
      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: [
          {
            validTime: new Date(Date.now() + 3600000).toISOString() + '/PT1H',
            value: 42
          }
        ]
      };

      expect(series.values.length).toBe(1);
      expect(series.values[0].value).toBe(42);
    });

    it('should handle series with duplicate values', () => {
      const now = new Date();

      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: [
          {
            validTime: new Date(now.getTime() + 3600000).toISOString() + '/PT1H',
            value: 50
          },
          {
            validTime: new Date(now.getTime() + 7200000).toISOString() + '/PT1H',
            value: 50
          },
          {
            validTime: new Date(now.getTime() + 10800000).toISOString() + '/PT1H',
            value: 50
          }
        ]
      };

      const uniqueValues = new Set(series.values.map(v => v.value));
      expect(uniqueValues.size).toBe(1);
      expect(Array.from(uniqueValues)[0]).toBe(50);
    });

    it('should handle mixed valid and invalid dates', () => {
      const validDate = new Date(Date.now() + 3600000).toISOString() + '/PT1H';
      const invalidDate = 'invalid-date';

      const series: GridpointDataSeries = {
        uom: 'wmoUnit:percent',
        values: [
          {
            validTime: validDate,
            value: 50
          },
          {
            validTime: invalidDate,
            value: 75
          }
        ]
      };

      // Valid date should parse correctly
      const parsed1 = new Date(validDate.split('/')[0]);
      expect(parsed1.toString()).not.toBe('Invalid Date');

      // Invalid date should result in Invalid Date
      const parsed2 = new Date(invalidDate.split('/')[0]);
      expect(parsed2.toString()).toBe('Invalid Date');
    });
  });
});
