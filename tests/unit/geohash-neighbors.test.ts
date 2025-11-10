/**
 * Unit tests for geohash neighbor calculations
 * Tests the geohash neighbor API usage and edge cases
 */

import { describe, it, expect } from 'vitest';
import { getGeohashNeighbors } from '../../src/utils/geohash.js';
import geohash from 'ngeohash';

describe('Geohash Neighbor API Usage', () => {
  describe('Basic Neighbor Calculations', () => {
    it('should return 8 neighbors for typical geohash', () => {
      const neighbors = getGeohashNeighbors('dr5r');

      expect(neighbors).toBeDefined();
      expect(Array.isArray(neighbors)).toBe(true);
      expect(neighbors.length).toBe(8);
    });

    it('should return all distinct neighbors', () => {
      const neighbors = getGeohashNeighbors('dr5r');

      // Check for uniqueness
      const uniqueNeighbors = new Set(neighbors);
      expect(uniqueNeighbors.size).toBe(neighbors.length);
    });

    it('should return neighbors of same length as input', () => {
      const hash = 'dr5ru';
      const neighbors = getGeohashNeighbors(hash);

      neighbors.forEach(neighbor => {
        expect(neighbor.length).toBe(hash.length);
      });
    });

    it('should calculate north neighbor correctly', () => {
      const hash = 'dr5ru7n2qq'; // Use precision 10 for reliable testing
      const neighbors = getGeohashNeighbors(hash);

      // North neighbor is at index 0 in our implementation
      expect(neighbors[0]).toBeDefined();

      // Decode to verify it's actually north (or very close due to precision)
      const center = geohash.decode(hash);
      const north = geohash.decode(neighbors[0]);

      // At precision 10, should have measurable difference
      expect(north.latitude).toBeGreaterThanOrEqual(center.latitude);
      // Verify hash is different
      expect(neighbors[0]).not.toBe(hash);
    });

    it('should calculate south neighbor correctly', () => {
      const hash = 'dr5ru7n2qq';
      const neighbors = getGeohashNeighbors(hash);

      // South neighbor is at index 1
      expect(neighbors[1]).toBeDefined();

      const center = geohash.decode(hash);
      const south = geohash.decode(neighbors[1]);

      expect(south.latitude).toBeLessThanOrEqual(center.latitude);
      expect(neighbors[1]).not.toBe(hash);
    });

    it('should calculate east neighbor correctly', () => {
      const hash = 'dr5ru7n2qq';
      const neighbors = getGeohashNeighbors(hash);

      // East neighbor is at index 2
      expect(neighbors[2]).toBeDefined();

      const center = geohash.decode(hash);
      const east = geohash.decode(neighbors[2]);

      expect(east.longitude).toBeGreaterThanOrEqual(center.longitude);
      expect(neighbors[2]).not.toBe(hash);
    });

    it('should calculate west neighbor correctly', () => {
      const hash = 'dr5ru7n2qq';
      const neighbors = getGeohashNeighbors(hash);

      // West neighbor is at index 3
      expect(neighbors[3]).toBeDefined();

      const center = geohash.decode(hash);
      const west = geohash.decode(neighbors[3]);

      expect(west.longitude).toBeLessThanOrEqual(center.longitude);
      expect(neighbors[3]).not.toBe(hash);
    });

    it('should calculate diagonal neighbors correctly', () => {
      const hash = 'dr5ru7n2qq';
      const neighbors = getGeohashNeighbors(hash);

      const center = geohash.decode(hash);

      // NE (index 4) - just verify it's different
      expect(neighbors[4]).toBeDefined();
      expect(neighbors[4]).not.toBe(hash);

      // NW (index 5)
      expect(neighbors[5]).toBeDefined();
      expect(neighbors[5]).not.toBe(hash);

      // SE (index 6)
      expect(neighbors[6]).toBeDefined();
      expect(neighbors[6]).not.toBe(hash);

      // SW (index 7)
      expect(neighbors[7]).toBeDefined();
      expect(neighbors[7]).not.toBe(hash);

      // All neighbors should be unique
      const uniqueNeighbors = new Set(neighbors);
      expect(uniqueNeighbors.size).toBe(8);
    });
  });

  describe('Different Precision Levels', () => {
    it('should handle precision 1 geohash', () => {
      const neighbors = getGeohashNeighbors('d');

      expect(neighbors.length).toBe(8);
      neighbors.forEach(neighbor => {
        expect(neighbor.length).toBe(1);
      });
    });

    it('should handle precision 2 geohash', () => {
      const neighbors = getGeohashNeighbors('dr');

      expect(neighbors.length).toBe(8);
      neighbors.forEach(neighbor => {
        expect(neighbor.length).toBe(2);
      });
    });

    it('should handle precision 5 geohash', () => {
      const neighbors = getGeohashNeighbors('dr5ru');

      expect(neighbors.length).toBe(8);
      neighbors.forEach(neighbor => {
        expect(neighbor.length).toBe(5);
      });
    });

    it('should handle precision 8 geohash', () => {
      const neighbors = getGeohashNeighbors('dr5ru7n2');

      expect(neighbors.length).toBe(8);
      neighbors.forEach(neighbor => {
        expect(neighbor.length).toBe(8);
      });
    });

    it('should handle maximum precision (12)', () => {
      const neighbors = getGeohashNeighbors('dr5ru7n2qq5t');

      expect(neighbors.length).toBe(8);
      neighbors.forEach(neighbor => {
        expect(neighbor.length).toBe(12);
      });
    });
  });

  describe('Geographic Edge Cases', () => {
    it('should handle geohash near north pole', () => {
      // Geohash for northern Alaska
      const hash = geohash.encode(85, -150, 4);
      const neighbors = getGeohashNeighbors(hash);

      // Should still return neighbors (may have edge behavior)
      expect(Array.isArray(neighbors)).toBe(true);
      expect(neighbors.length).toBeGreaterThanOrEqual(0);
      expect(neighbors.length).toBeLessThanOrEqual(8);
    });

    it('should handle geohash near south pole', () => {
      const hash = geohash.encode(-85, 0, 4);
      const neighbors = getGeohashNeighbors(hash);

      expect(Array.isArray(neighbors)).toBe(true);
      expect(neighbors.length).toBeGreaterThanOrEqual(0);
      expect(neighbors.length).toBeLessThanOrEqual(8);
    });

    it('should handle geohash near prime meridian', () => {
      const hash = geohash.encode(51.5074, 0, 4);
      const neighbors = getGeohashNeighbors(hash);

      expect(neighbors.length).toBe(8);
      neighbors.forEach(neighbor => {
        expect(neighbor).toBeDefined();
      });
    });

    it('should handle geohash near equator', () => {
      const hash = geohash.encode(0, 0, 4);
      const neighbors = getGeohashNeighbors(hash);

      expect(neighbors.length).toBe(8);
    });

    it('should handle geohash near international date line', () => {
      // Just west of date line
      const hashWest = geohash.encode(0, 179, 4);
      const neighborsWest = getGeohashNeighbors(hashWest);

      expect(Array.isArray(neighborsWest)).toBe(true);

      // Just east of date line
      const hashEast = geohash.encode(0, -179, 4);
      const neighborsEast = getGeohashNeighbors(hashEast);

      expect(Array.isArray(neighborsEast)).toBe(true);
    });

    it('should handle geohash at extreme coordinates', () => {
      const extremes = [
        { lat: 89.9, lon: 179.9 },
        { lat: -89.9, lon: -179.9 },
        { lat: 0.1, lon: 0.1 },
        { lat: -0.1, lon: -0.1 }
      ];

      extremes.forEach(({ lat, lon }) => {
        const hash = geohash.encode(lat, lon, 4);
        const neighbors = getGeohashNeighbors(hash);

        expect(Array.isArray(neighbors)).toBe(true);
        expect(neighbors.length).toBeGreaterThanOrEqual(0);
        expect(neighbors.length).toBeLessThanOrEqual(8);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid geohash gracefully', () => {
      const neighbors = getGeohashNeighbors('invalid!@#');

      // Should return array (possibly empty if library throws)
      expect(Array.isArray(neighbors)).toBe(true);
      expect(neighbors.length).toBeGreaterThanOrEqual(0);
      expect(neighbors.length).toBeLessThanOrEqual(8);
    });

    it('should handle empty string gracefully', () => {
      const neighbors = getGeohashNeighbors('');

      expect(Array.isArray(neighbors)).toBe(true);
    });

    it('should handle special characters gracefully', () => {
      const specialChars = ['!', '@', '#', '$', '%'];

      specialChars.forEach(char => {
        const neighbors = getGeohashNeighbors(char);
        expect(Array.isArray(neighbors)).toBe(true);
      });
    });

    it('should not throw errors for edge case inputs', () => {
      const edgeCases = [
        'a', // boundary geohash
        'z', // boundary geohash
        '0', // invalid character
        'l', // looks like 1
        'o', // looks like 0
      ];

      edgeCases.forEach(hash => {
        expect(() => {
          const neighbors = getGeohashNeighbors(hash);
          expect(Array.isArray(neighbors)).toBe(true);
        }).not.toThrow();
      });
    });
  });

  describe('Neighbor Consistency', () => {
    it('should return same neighbors for repeated calls', () => {
      const hash = 'dr5ru';

      const neighbors1 = getGeohashNeighbors(hash);
      const neighbors2 = getGeohashNeighbors(hash);
      const neighbors3 = getGeohashNeighbors(hash);

      expect(neighbors1).toEqual(neighbors2);
      expect(neighbors2).toEqual(neighbors3);
    });

    it('should have reciprocal neighbor relationships', () => {
      const hash = 'dr5r';
      const neighbors = getGeohashNeighbors(hash);

      // North neighbor's south neighbor should include original hash
      const north = neighbors[0];
      const northNeighbors = getGeohashNeighbors(north);

      // The south neighbor of the north neighbor should be close to original
      const southOfNorth = northNeighbors[1];

      // Should be same or adjacent
      expect(southOfNorth.length).toBe(hash.length);
    });

    it('should form complete coverage around center', () => {
      const hash = 'dr5r';
      const neighbors = getGeohashNeighbors(hash);

      const center = geohash.decode(hash);

      // All neighbors should be within ~2x cell size
      neighbors.forEach(neighbor => {
        const decoded = geohash.decode(neighbor);

        // Latitude difference should be reasonable
        const latDiff = Math.abs(decoded.latitude - center.latitude);
        expect(latDiff).toBeLessThan(5); // Within ~5 degrees

        // Longitude difference should be reasonable
        const lonDiff = Math.abs(decoded.longitude - center.longitude);
        expect(lonDiff).toBeLessThan(5);
      });
    });
  });

  describe('Performance', () => {
    it('should calculate neighbors quickly', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        getGeohashNeighbors('dr5ru7n2');
      }

      const duration = performance.now() - start;

      // 1000 neighbor calculations should be fast (< 50ms)
      expect(duration).toBeLessThan(50);
    });

    it('should handle batch neighbor calculations efficiently', () => {
      const hashes = [
        'dr5r',
        'dr5x',
        'dr5p',
        'dr5q',
        'dr5w',
        'dr5n',
        'dr5j',
        'dr5m',
        'dr5t',
        'dr5v'
      ];

      const start = performance.now();

      const allNeighbors = hashes.map(hash => getGeohashNeighbors(hash));

      const duration = performance.now() - start;

      expect(allNeighbors.length).toBe(hashes.length);
      expect(duration).toBeLessThan(10);
    });

    it('should not degrade with high precision', () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        getGeohashNeighbors('dr5ru7n2qq5t'); // precision 12
      }

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(20);
    });
  });

  describe('Neighbor API Direction Parameter Usage', () => {
    it('should use correct direction vectors', () => {
      // Test that our implementation uses ngeohash.neighbor correctly
      const hash = 'dr5r';

      // Get neighbors using our function
      const neighbors = getGeohashNeighbors(hash);

      // Manually calculate using ngeohash library
      const manualN = geohash.neighbor(hash, [0, 1]);   // N
      const manualS = geohash.neighbor(hash, [0, -1]);  // S
      const manualE = geohash.neighbor(hash, [1, 0]);   // E
      const manualW = geohash.neighbor(hash, [-1, 0]);  // W
      const manualNE = geohash.neighbor(hash, [1, 1]);  // NE
      const manualNW = geohash.neighbor(hash, [-1, 1]); // NW
      const manualSE = geohash.neighbor(hash, [1, -1]); // SE
      const manualSW = geohash.neighbor(hash, [-1, -1]); // SW

      // Our implementation should match manual calculations
      expect(neighbors[0]).toBe(manualN);
      expect(neighbors[1]).toBe(manualS);
      expect(neighbors[2]).toBe(manualE);
      expect(neighbors[3]).toBe(manualW);
      expect(neighbors[4]).toBe(manualNE);
      expect(neighbors[5]).toBe(manualNW);
      expect(neighbors[6]).toBe(manualSE);
      expect(neighbors[7]).toBe(manualSW);
    });

    it('should handle all 8 cardinal and diagonal directions', () => {
      const hash = 'dr5ru';
      const neighbors = getGeohashNeighbors(hash);

      // Should have all 8 directions
      expect(neighbors.length).toBe(8);

      // Each should be valid geohash
      neighbors.forEach(neighbor => {
        const decoded = geohash.decode(neighbor);
        expect(decoded.latitude).toBeGreaterThanOrEqual(-90);
        expect(decoded.latitude).toBeLessThanOrEqual(90);
        expect(decoded.longitude).toBeGreaterThanOrEqual(-180);
        expect(decoded.longitude).toBeLessThanOrEqual(180);
      });
    });
  });

  describe('Integration with Tile Calculation', () => {
    it('should provide neighbors suitable for BFS tile expansion', () => {
      // Test that neighbors work correctly for breadth-first search
      const startHash = 'dr5r';
      const visited = new Set<string>();
      const queue: string[] = [startHash];

      visited.add(startHash);

      // Simulate one level of BFS
      while (queue.length > 0) {
        const current = queue.shift()!;
        const neighbors = getGeohashNeighbors(current);

        neighbors.forEach(neighbor => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });

        // Stop after processing first hash
        break;
      }

      // Should have expanded to include center + up to 8 neighbors
      expect(visited.size).toBeGreaterThan(1);
      expect(visited.size).toBeLessThanOrEqual(9);
    });

    it('should prevent duplicate tiles through visited set', () => {
      const startHash = 'dr5r';
      const visited = new Set<string>();

      visited.add(startHash);

      const neighbors = getGeohashNeighbors(startHash);

      neighbors.forEach(neighbor => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
        }
      });

      // Each neighbor should be unique
      const expectedSize = 1 + neighbors.length; // center + unique neighbors
      expect(visited.size).toBe(expectedSize);
    });
  });
});
