/**
 * Unit tests for geohash utilities
 * Tests location-based geohash calculations for lightning strike filtering
 */

import { describe, it, expect } from 'vitest';
import {
  calculateBoundingBox,
  getGeohashNeighbors,
  computeGeohashTiles,
  calculateGeohashSubscriptions,
  isWithinRadius,
  BoundingBox
} from '../../src/utils/geohash.js';

describe('Geohash Utilities', () => {
  describe('calculateBoundingBox', () => {
    it('should calculate bounding box for a point with given radius', () => {
      const bbox = calculateBoundingBox(40.7128, -74.006, 100);

      expect(bbox.minLat).toBeLessThan(40.7128);
      expect(bbox.maxLat).toBeGreaterThan(40.7128);
      expect(bbox.minLon).toBeLessThan(-74.006);
      expect(bbox.maxLon).toBeGreaterThan(-74.006);

      // Verify approximate symmetry
      const latRange = bbox.maxLat - bbox.minLat;
      const expectedLatRange = (100 * 360) / 40000 * 2;
      expect(latRange).toBeCloseTo(expectedLatRange, 2);
    });

    it('should handle equator location (no cosine adjustment needed)', () => {
      const bbox = calculateBoundingBox(0, 0, 100);

      const latDelta = bbox.maxLat - 0;
      const lonDelta = bbox.maxLon - 0;

      // At equator, lat and lon deltas should be equal
      expect(Math.abs(latDelta - lonDelta)).toBeLessThan(0.1);
    });

    it('should handle polar regions (large longitude delta)', () => {
      const bbox = calculateBoundingBox(85, 0, 100);

      const latDelta = bbox.maxLat - 85;
      const lonDelta = bbox.maxLon - 0;

      // Near poles, longitude delta should be much larger
      expect(lonDelta).toBeGreaterThan(latDelta * 5);
    });

    it('should handle small radius', () => {
      const bbox = calculateBoundingBox(40.7128, -74.006, 1);

      const latRange = bbox.maxLat - bbox.minLat;
      const lonRange = bbox.maxLon - bbox.minLon;

      expect(latRange).toBeLessThan(0.02);
      expect(lonRange).toBeLessThan(0.025); // Slightly larger due to longitude correction at this latitude
    });

    it('should handle large radius', () => {
      const bbox = calculateBoundingBox(40.7128, -74.006, 500);

      const latRange = bbox.maxLat - bbox.minLat;
      const lonRange = bbox.maxLon - bbox.minLon;

      expect(latRange).toBeGreaterThan(4);
      expect(lonRange).toBeGreaterThan(4);
    });

    it('should handle negative coordinates', () => {
      const bbox = calculateBoundingBox(-33.8688, 151.2093, 100);

      expect(bbox.minLat).toBeLessThan(-33.8688);
      expect(bbox.maxLat).toBeGreaterThan(-33.8688);
      expect(bbox.minLon).toBeLessThan(151.2093);
      expect(bbox.maxLon).toBeGreaterThan(151.2093);
    });

    it('should handle date line crossing', () => {
      const bbox = calculateBoundingBox(0, 179, 200);

      // Should cross date line
      expect(bbox.minLon).toBeLessThan(179);
      expect(bbox.maxLon).toBeGreaterThan(179);
    });
  });

  describe('getGeohashNeighbors', () => {
    it('should return 8 neighbors for valid geohash', () => {
      const neighbors = getGeohashNeighbors('dr5r');

      expect(neighbors.length).toBe(8);
      expect(neighbors).toContain('dr5x'); // N
      expect(neighbors).toContain('dr5p'); // S
      expect(neighbors).toContain('dr5w'); // E
      expect(neighbors).toContain('dr5q'); // W
    });

    it('should return neighbors for short geohash', () => {
      const neighbors = getGeohashNeighbors('d');

      expect(neighbors.length).toBe(8);
      neighbors.forEach(neighbor => {
        expect(neighbor).toBeDefined();
        expect(neighbor.length).toBe(1);
      });
    });

    it('should return neighbors for long geohash', () => {
      const neighbors = getGeohashNeighbors('dr5ru7n2qq');

      expect(neighbors.length).toBe(8);
      neighbors.forEach(neighbor => {
        expect(neighbor).toBeDefined();
        expect(neighbor.length).toBe(10);
      });
    });

    it('should handle edge case geohashes gracefully', () => {
      // Edge case that might fail neighbor calculation
      const neighbors = getGeohashNeighbors('z');

      // Should return array (possibly empty if edge case fails)
      expect(Array.isArray(neighbors)).toBe(true);
      expect(neighbors.length).toBeLessThanOrEqual(8);
    });

    it('should handle potentially invalid geohash gracefully', () => {
      // Some invalid inputs might not throw errors in the underlying library
      const neighbors = getGeohashNeighbors('!@#$');

      expect(Array.isArray(neighbors)).toBe(true);
      // May return neighbors (if library doesn't validate) or empty array (if it throws)
      expect(neighbors.length).toBeGreaterThanOrEqual(0);
      expect(neighbors.length).toBeLessThanOrEqual(8);
    });
  });

  describe('computeGeohashTiles', () => {
    it('should compute tiles for small area', () => {
      const tiles = computeGeohashTiles(40.7128, -74.006, 10, 4);

      expect(tiles.size).toBeGreaterThan(0);
      expect(tiles.size).toBeLessThan(100);

      // All tiles should be length 4
      tiles.forEach(tile => {
        expect(tile.length).toBe(4);
      });
    });

    it('should include center point geohash', () => {
      const tiles = computeGeohashTiles(40.7128, -74.006, 50, 3);
      const centerHash = require('ngeohash').encode(40.7128, -74.006, 3);

      expect(tiles.has(centerHash)).toBe(true);
    });

    it('should increase tile count with larger radius', () => {
      const smallTiles = computeGeohashTiles(40.7128, -74.006, 10, 4);
      const largeTiles = computeGeohashTiles(40.7128, -74.006, 100, 4);

      expect(largeTiles.size).toBeGreaterThan(smallTiles.size);
    });

    it('should handle precision 1 (coarse)', () => {
      const tiles = computeGeohashTiles(40.7128, -74.006, 100, 1);

      expect(tiles.size).toBeGreaterThan(0);
      tiles.forEach(tile => {
        expect(tile.length).toBe(1);
      });
    });

    it('should handle precision 8 (fine)', () => {
      const tiles = computeGeohashTiles(40.7128, -74.006, 5, 8);

      expect(tiles.size).toBeGreaterThan(0);
      tiles.forEach(tile => {
        expect(tile.length).toBe(8);
      });
    });

    it('should handle equator location', () => {
      const tiles = computeGeohashTiles(0, 0, 100, 3);

      expect(tiles.size).toBeGreaterThan(0);
    });

    it('should handle polar location', () => {
      const tiles = computeGeohashTiles(80, 0, 100, 2);

      expect(tiles.size).toBeGreaterThan(0);
    });

    it('should handle negative coordinates', () => {
      const tiles = computeGeohashTiles(-33.8688, 151.2093, 50, 4);

      expect(tiles.size).toBeGreaterThan(0);
    });

    it('should not duplicate tiles', () => {
      const tiles = computeGeohashTiles(40.7128, -74.006, 100, 3);
      const tilesArray = Array.from(tiles);

      // Check for uniqueness
      const uniqueTiles = new Set(tilesArray);
      expect(uniqueTiles.size).toBe(tilesArray.length);
    });
  });

  describe('calculateGeohashSubscriptions', () => {
    it('should return optimal geohash set for default max tiles', () => {
      const geohashes = calculateGeohashSubscriptions(40.7128, -74.006, 100);

      expect(geohashes.size).toBeGreaterThan(0);
      expect(geohashes.size).toBeLessThanOrEqual(9); // Default maxTiles
    });

    it('should use coarser precision for larger radius', () => {
      const smallRadius = calculateGeohashSubscriptions(40.7128, -74.006, 10);
      const largeRadius = calculateGeohashSubscriptions(40.7128, -74.006, 200);

      // Get first geohash from each set
      const smallHash = Array.from(smallRadius)[0];
      const largeHash = Array.from(largeRadius)[0];

      // Larger radius should use shorter (coarser) geohash
      expect(largeHash.length).toBeLessThanOrEqual(smallHash.length);
    });

    it('should respect custom max tiles limit', () => {
      const geohashes = calculateGeohashSubscriptions(40.7128, -74.006, 100, 5);

      expect(geohashes.size).toBeLessThanOrEqual(5);
    });

    it('should handle very small radius', () => {
      const geohashes = calculateGeohashSubscriptions(40.7128, -74.006, 1, 9);

      expect(geohashes.size).toBeGreaterThan(0);
      expect(geohashes.size).toBeLessThanOrEqual(9);
    });

    it('should handle very large radius', () => {
      const geohashes = calculateGeohashSubscriptions(40.7128, -74.006, 500, 9);

      expect(geohashes.size).toBeGreaterThan(0);
      expect(geohashes.size).toBeLessThanOrEqual(9);
    });

    it('should fallback to center point if algorithm fails', () => {
      // Edge case: maxTiles = 0 should use fallback
      const geohashes = calculateGeohashSubscriptions(40.7128, -74.006, 100, 0);

      expect(geohashes.size).toBe(1);
      const hash = Array.from(geohashes)[0];
      expect(hash.length).toBe(4); // Fallback precision
    });

    it('should handle equator location', () => {
      const geohashes = calculateGeohashSubscriptions(0, 0, 100);

      expect(geohashes.size).toBeGreaterThan(0);
      expect(geohashes.size).toBeLessThanOrEqual(9);
    });

    it('should handle polar location', () => {
      const geohashes = calculateGeohashSubscriptions(85, 0, 100);

      expect(geohashes.size).toBeGreaterThan(0);
      expect(geohashes.size).toBeLessThanOrEqual(9);
    });

    it('should handle negative coordinates', () => {
      const geohashes = calculateGeohashSubscriptions(-33.8688, 151.2093, 100);

      expect(geohashes.size).toBeGreaterThan(0);
      expect(geohashes.size).toBeLessThanOrEqual(9);
    });

    it('should return consistent results for same input', () => {
      const result1 = calculateGeohashSubscriptions(40.7128, -74.006, 100);
      const result2 = calculateGeohashSubscriptions(40.7128, -74.006, 100);

      expect(result1.size).toBe(result2.size);
      expect(Array.from(result1).sort()).toEqual(Array.from(result2).sort());
    });
  });

  describe('isWithinRadius', () => {
    it('should return true for same point', () => {
      const result = isWithinRadius(40.7128, -74.006, 40.7128, -74.006, 1);

      expect(result).toBe(true);
    });

    it('should return false for distant point', () => {
      // New York to Los Angeles (~4000 km)
      const result = isWithinRadius(40.7128, -74.006, 34.0522, -118.2437, 1000);

      expect(result).toBe(false);
    });

    it('should return true for nearby point', () => {
      // Two points ~10km apart in NYC
      const result = isWithinRadius(40.7128, -74.006, 40.7589, -73.9851, 20);

      expect(result).toBe(true);
    });

    it('should handle exact boundary (just inside)', () => {
      // Calculate a point exactly ~100km away using approximate lat/lon math
      const lat2 = 40.7128 + (100 * 360) / 40000;
      const result = isWithinRadius(40.7128, -74.006, lat2, -74.006, 100.1);

      expect(result).toBe(true);
    });

    it('should handle exact boundary (just outside)', () => {
      const lat2 = 40.7128 + (100 * 360) / 40000;
      const result = isWithinRadius(40.7128, -74.006, lat2, -74.006, 99.9);

      expect(result).toBe(false);
    });

    it('should handle equator crossing', () => {
      const result = isWithinRadius(1, 0, -1, 0, 250);

      expect(result).toBe(true);
    });

    it('should handle date line crossing', () => {
      const result = isWithinRadius(0, 179, 0, -179, 250);

      expect(result).toBe(true);
    });

    it('should handle polar region', () => {
      // At 85° latitude, longitude lines converge significantly
      // 90° longitude difference at 85° lat ≈ 873 km apart
      // Using realistic radius for this distance
      const result = isWithinRadius(85, 0, 85, 90, 900);

      expect(result).toBe(true);
    });

    it('should handle negative coordinates', () => {
      // Sydney to Melbourne (~700km)
      const result = isWithinRadius(-33.8688, 151.2093, -37.8136, 144.9631, 800);

      expect(result).toBe(true);
    });

    it('should calculate accurate distance', () => {
      // Use Haversine formula to verify approximate distance
      // NYC to Boston is ~300km
      const result = isWithinRadius(40.7128, -74.006, 42.3601, -71.0589, 350);

      expect(result).toBe(true);
    });

    it('should handle zero radius', () => {
      const result = isWithinRadius(40.7128, -74.006, 40.7128, -74.006, 0);

      // Same point should be within 0 radius (distance = 0)
      expect(result).toBe(true);
    });

    it('should handle very large radius', () => {
      // Opposite sides of Earth
      const result = isWithinRadius(0, 0, 0, 180, 25000);

      expect(result).toBe(true);
    });

    it('should return false for antipodal points with small radius', () => {
      // Opposite sides of Earth (~20000km apart)
      const result = isWithinRadius(0, 0, 0, 180, 10000);

      expect(result).toBe(false);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle extreme latitude values', () => {
      const bbox = calculateBoundingBox(89.9, 0, 100);
      expect(bbox).toBeDefined();
      expect(bbox.maxLat).toBeLessThanOrEqual(90);
    });

    it('should handle extreme longitude values', () => {
      const bbox = calculateBoundingBox(0, 179.9, 100);
      expect(bbox).toBeDefined();
    });

    it('should handle very small precision in geohash computation', () => {
      const tiles = computeGeohashTiles(40.7128, -74.006, 100, 1);
      expect(tiles.size).toBeGreaterThan(0);
    });

    it('should handle very high precision in geohash computation', () => {
      const tiles = computeGeohashTiles(40.7128, -74.006, 1, 12);
      expect(tiles.size).toBeGreaterThan(0);
    });
  });

  describe('Performance and Boundary Conditions', () => {
    it('should complete geohash calculation in reasonable time', () => {
      const start = Date.now();
      const geohashes = calculateGeohashSubscriptions(40.7128, -74.006, 200);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should complete in < 1 second
      expect(geohashes.size).toBeGreaterThan(0);
    });

    it('should handle multiple calculations efficiently', () => {
      const locations = [
        { lat: 40.7128, lon: -74.006 },
        { lat: 51.5074, lon: -0.1278 },
        { lat: 35.6762, lon: 139.6503 },
        { lat: -33.8688, lon: 151.2093 },
        { lat: 25.7617, lon: -80.1918 }
      ];

      const start = Date.now();
      locations.forEach(loc => {
        calculateGeohashSubscriptions(loc.lat, loc.lon, 100);
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2000); // All 5 should complete in < 2 seconds
    });

    it('should limit tile count appropriately', () => {
      // Even with large radius, should respect max tiles
      const geohashes = calculateGeohashSubscriptions(40.7128, -74.006, 1000, 5);
      expect(geohashes.size).toBeLessThanOrEqual(5);
    });
  });
});
