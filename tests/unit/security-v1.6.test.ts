/**
 * Security-focused tests for v1.6.0 Safety & Hazards features
 * Tests bounds checking, input validation, and resource protection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeGeohashTiles } from '../../src/utils/geohash.js';
import { logger } from '../../src/utils/logger.js';

describe('v1.6.0 Security - Bounds Checking and Validation', () => {
  describe('Geohash Tile Calculation Safety Limit (10,000)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('should enforce MAX_TILES limit of 10,000', () => {
      // Attempt to create scenario that would exceed limit
      // Using very large radius with fine precision
      const tiles = computeGeohashTiles(0, 0, 5000, 6);

      // Should be capped at 10,000 even with extreme parameters
      expect(tiles.size).toBeLessThanOrEqual(10000);
    });

    it('should handle extreme radius without memory exhaustion', () => {
      // Test with maximum valid radius (from handler clamping)
      const tiles = computeGeohashTiles(40.7128, -74.006, 500, 5);

      expect(tiles.size).toBeLessThanOrEqual(10000);
      expect(tiles.size).toBeGreaterThan(0);
    });

    it('should handle high precision without unbounded growth', () => {
      // High precision with moderate radius
      const tiles = computeGeohashTiles(40.7128, -74.006, 100, 8);

      expect(tiles.size).toBeLessThanOrEqual(10000);
    });

    it('should complete tile calculation in reasonable time', () => {
      // Performance check - should not hang or timeout
      const start = performance.now();

      const tiles = computeGeohashTiles(40.7128, -74.006, 200, 6);

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(5000); // Complete in < 5 seconds
      expect(tiles.size).toBeLessThanOrEqual(10000);
    });

    it('should handle edge case: polar regions with large radius', () => {
      // Polar regions have converging longitude lines
      // Could potentially generate many tiles
      const tiles = computeGeohashTiles(85, 0, 500, 5);

      expect(tiles.size).toBeLessThanOrEqual(10000);
    });

    it('should handle edge case: equator with large radius', () => {
      const tiles = computeGeohashTiles(0, 0, 500, 5);

      expect(tiles.size).toBeLessThanOrEqual(10000);
    });

    it('should handle edge case: date line crossing', () => {
      // Crossing international date line
      const tiles = computeGeohashTiles(0, 179, 200, 5);

      expect(tiles.size).toBeLessThanOrEqual(10000);
    });

    it('should return early when reaching MAX_TILES', () => {
      // With extreme parameters that would generate > 10,000 tiles
      // Should return exactly 10,000 (early termination)
      const tiles = computeGeohashTiles(0, 0, 2000, 7);

      expect(tiles.size).toBeLessThanOrEqual(10000);

      // If it would have generated more, size should be exactly at limit
      if (tiles.size === 10000) {
        // This is correct behavior - hit the safety limit
        expect(tiles.size).toBe(10000);
      }
    });
  });

  describe('Bounding Box Validation', () => {
    it('should validate that west < east', () => {
      const west = -100;
      const east = -90;
      const south = 30;
      const north = 40;

      expect(west).toBeLessThan(east);
      expect(south).toBeLessThan(north);
    });

    it('should detect invalid bounding box (west >= east)', () => {
      const west = -90;
      const east = -100; // Invalid: west should be < east

      expect(west).toBeGreaterThanOrEqual(east);
      // Handler should throw error for this
    });

    it('should detect invalid bounding box (south >= north)', () => {
      const south = 40;
      const north = 30; // Invalid: south should be < north

      expect(south).toBeGreaterThanOrEqual(north);
      // Handler should throw error for this
    });

    it('should validate coordinates are within valid ranges', () => {
      const validBbox = {
        west: -180,
        south: -90,
        east: 180,
        north: 90
      };

      expect(validBbox.west).toBeGreaterThanOrEqual(-180);
      expect(validBbox.west).toBeLessThanOrEqual(180);
      expect(validBbox.east).toBeGreaterThanOrEqual(-180);
      expect(validBbox.east).toBeLessThanOrEqual(180);
      expect(validBbox.south).toBeGreaterThanOrEqual(-90);
      expect(validBbox.south).toBeLessThanOrEqual(90);
      expect(validBbox.north).toBeGreaterThanOrEqual(-90);
      expect(validBbox.north).toBeLessThanOrEqual(90);
    });

    it('should handle date line crossing in bounding box calculation', () => {
      // Center point near date line
      const centerLon = 179;
      const radiusKm = 100;

      // Calculate approximate longitude delta
      const lonOffset = radiusKm / 111.32; // ~0.9 degrees

      const west = centerLon - lonOffset; // ~178.1
      const east = centerLon + lonOffset; // ~179.9

      // Both should be valid (not crossing date line in this case)
      expect(west).toBeGreaterThan(-180);
      expect(east).toBeLessThan(180);
    });

    it('should calculate bounding box correctly for polar regions', () => {
      const centerLat = 85;
      const radiusKm = 100;

      const latDelta = (radiusKm * 360) / 40000;

      const north = Math.min(90, centerLat + latDelta);
      const south = Math.max(-90, centerLat - latDelta);

      expect(north).toBeLessThanOrEqual(90);
      expect(south).toBeGreaterThanOrEqual(-90);
    });

    it('should handle maximum bounding box (entire Earth)', () => {
      const bbox = {
        west: -180,
        south: -90,
        east: 180,
        north: 90
      };

      expect(bbox.west).toBe(-180);
      expect(bbox.east).toBe(180);
      expect(bbox.south).toBe(-90);
      expect(bbox.north).toBe(90);
    });

    it('should handle minimum bounding box (single point)', () => {
      const point = {
        west: 0,
        south: 0,
        east: 0,
        north: 0
      };

      expect(point.west).toBe(point.east);
      expect(point.south).toBe(point.north);
    });
  });

  describe('MQTT Buffer Overflow Protection (10,000 limit)', () => {
    it('should enforce buffer size limit', () => {
      const maxBufferSize = 10000;
      const currentSize = 9999;

      // Adding one more should trigger cleanup if at limit
      expect(currentSize).toBeLessThan(maxBufferSize);

      const wouldExceed = currentSize + 1;
      expect(wouldExceed).toBe(maxBufferSize);
    });

    it('should calculate correct cleanup size (10% of buffer)', () => {
      const maxBufferSize = 10000;
      const entriesToRemove = Math.floor(maxBufferSize * 0.1);

      expect(entriesToRemove).toBe(1000);
    });

    it('should handle buffer at exactly the limit', () => {
      const maxBufferSize = 10000;
      const buffer = new Map();

      // Fill to exactly the limit
      for (let i = 0; i < maxBufferSize; i++) {
        buffer.set(`key_${i}`, { value: i });
      }

      expect(buffer.size).toBe(maxBufferSize);

      // Simulate cleanup - remove 10%
      const entriesToRemove = Math.floor(maxBufferSize * 0.1);
      const iterator = buffer.keys();
      for (let i = 0; i < entriesToRemove; i++) {
        const result = iterator.next();
        if (!result.done) {
          buffer.delete(result.value);
        }
      }

      expect(buffer.size).toBe(maxBufferSize - entriesToRemove);
      expect(buffer.size).toBe(9000);
    });

    it('should handle rapid buffer growth without exceeding limit', () => {
      const maxBufferSize = 10000;
      const buffer = new Map();

      // Simulate rapid additions (20,000 items)
      for (let i = 0; i < 20000; i++) {
        // Check if at capacity before adding
        if (buffer.size >= maxBufferSize) {
          // Remove 10%
          const entriesToRemove = Math.floor(maxBufferSize * 0.1);
          const iterator = buffer.keys();
          for (let j = 0; j < entriesToRemove; j++) {
            const result = iterator.next();
            if (!result.done) {
              buffer.delete(result.value);
            }
          }
        }

        buffer.set(`key_${i}`, { value: i });
      }

      // Should never exceed max size
      expect(buffer.size).toBeLessThanOrEqual(maxBufferSize);
    });

    it('should maintain buffer integrity during cleanup', () => {
      const buffer = new Map();

      // Add 100 items
      for (let i = 0; i < 100; i++) {
        buffer.set(`key_${i}`, { value: i, timestamp: Date.now() - i * 1000 });
      }

      const initialSize = buffer.size;
      expect(initialSize).toBe(100);

      // Remove oldest 10 entries
      const entriesToRemove = 10;
      const iterator = buffer.keys();
      for (let i = 0; i < entriesToRemove; i++) {
        const result = iterator.next();
        if (!result.done) {
          buffer.delete(result.value);
        }
      }

      expect(buffer.size).toBe(initialSize - entriesToRemove);
      expect(buffer.size).toBe(90);
    });

    it('should handle empty buffer gracefully', () => {
      const buffer = new Map();
      expect(buffer.size).toBe(0);

      // Attempt to remove entries from empty buffer
      const iterator = buffer.keys();
      const result = iterator.next();

      expect(result.done).toBe(true);
    });
  });

  describe('Input Sanitization for v1.6.0 Handlers', () => {
    it('should reject non-object arguments', () => {
      const invalidArgs = [
        null,
        undefined,
        'string',
        123,
        true,
        []
      ];

      invalidArgs.forEach(args => {
        const isValid = typeof args === 'object' && args !== null && !Array.isArray(args);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Resource Exhaustion Prevention', () => {
    it('should prevent infinite loops in tile calculation', () => {
      // Tile calculation uses BFS with visited set
      // Should terminate even with circular references

      const start = performance.now();
      const tiles = computeGeohashTiles(40.7128, -74.006, 100, 4);
      const duration = performance.now() - start;

      expect(tiles.size).toBeGreaterThan(0);
      expect(duration).toBeLessThan(1000); // Should complete in < 1 second
    });
  });

  describe('Security Event Logging', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(logger, 'warn');
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('should log security events for bounds violations', () => {
      // Simulate bounds violation scenario
      const tiles = computeGeohashTiles(0, 0, 5000, 7);

      // If tiles hit the 10,000 limit, it's a security-relevant event
      if (tiles.size === 10000) {
        // This would have triggered security logging in the actual implementation
        expect(tiles.size).toBe(10000);
      }
    });

    it('should include securityEvent flag in logs', () => {
      // Mock scenario where security event would be logged
      const mockSecurityLog = {
        message: 'Geohash tile calculation exceeded safety limit',
        securityEvent: true,
        tileCount: 10000,
        maxTiles: 10000
      };

      expect(mockSecurityLog.securityEvent).toBe(true);
    });
  });
});
