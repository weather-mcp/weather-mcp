import { describe, it, expect } from 'vitest';
import { distanceToPerimeterKm } from '../../src/utils/firePerimeter.js';
import { calculateDistance } from '../../src/utils/distance.js';
import { pointInRing } from '../../src/utils/pointInPolygon.js';

// Query point used throughout: lat 40, lon -120. Ring vertices are [lon, lat].
const LAT = 40;
const LON = -120;

describe('distanceToPerimeterKm', () => {
  describe('inside', () => {
    it('returns exactly 0 inside a multi-vertex ring', () => {
      const ring = [
        [-120.2, 39.8],
        [-119.7, 39.9],
        [-119.8, 40.3],
        [-120.3, 40.2],
      ];
      expect(distanceToPerimeterKm(LAT, LON, [ring])).toBe(0);
    });
  });

  describe('edge, not vertex', () => {
    it('measures to the foot on a 2.7 km edge, not to either end vertex', () => {
      // Edge A-B runs along lat 40.0027 (0.3 km north of the query), 2.7 km long,
      // with the query's longitude at its midpoint. C is far to the north, so the
      // query is outside. The nearest edge (A-B) is the third edge, not the first.
      const c = [-120.0, 40.05];
      const a = [-120.0158, 40.0027];
      const b = [-119.9842, 40.0027];
      const d = distanceToPerimeterKm(LAT, LON, [[c, a, b]]);
      // Foot computed independently: same longitude as the query, edge latitude.
      const expected = calculateDistance(LAT, LON, 40.0027, -120.0);
      const toA = calculateDistance(LAT, LON, a[1], a[0]);
      const toB = calculateDistance(LAT, LON, b[1], b[0]);
      expect(d).not.toBeNull();
      expect(d as number).toBeCloseTo(expected, 3);
      expect(toA - (d as number)).toBeGreaterThan(1);
      expect(toB - (d as number)).toBeGreaterThan(1);
    });
  });

  describe('holes and multiple rings', () => {
    const outer = [
      [-120.1, 39.9],
      [-120.1, 40.1],
      [-119.9, 40.1],
      [-119.9, 39.9],
    ];
    // East edge of the hole (lon -119.995) is the nearest, and it is the fourth edge.
    const hole = [
      [-120.03, 39.98],
      [-120.03, 40.02],
      [-119.995, 40.02],
      [-119.995, 39.98],
    ];

    it('treats a point in a hole as outside, at the hole nearest edge', () => {
      const d = distanceToPerimeterKm(LAT, LON, [outer, hole]);
      expect(d).not.toBe(0);
      expect(d as number).toBeCloseTo(calculateDistance(LAT, LON, 40, -119.995), 3);
    });

    it('returns 0 for a point inside a second outer ring', () => {
      const first = [
        [-121.2, 38.8],
        [-121.2, 38.9],
        [-121.0, 38.9],
        [-121.0, 38.8],
      ];
      const second = [
        [-120.2, 39.8],
        [-120.2, 40.2],
        [-119.8, 40.2],
        [-119.8, 39.8],
      ];
      expect(distanceToPerimeterKm(LAT, LON, [first, second])).toBe(0);
    });

    it('picks the nearer ring when outside both, and that ring is not the first', () => {
      const far = [
        [-121.0, 40.0],
        [-121.0, 40.1],
        [-120.9, 40.1],
        [-120.9, 40.0],
      ];
      const near = [
        [-119.95, 39.95],
        [-119.95, 40.05],
        [-119.9, 40.05],
        [-119.9, 39.95],
      ];
      const d = distanceToPerimeterKm(LAT, LON, [far, near]);
      expect(d as number).toBeCloseTo(calculateDistance(LAT, LON, 40, -119.95), 3);
    });
  });

  describe('one-vertex ring is a point, bit-identical to the origin path', () => {
    it.each([5.049, 5.051, 25.049, 25.051, 50.049, 50.051])(
      'offset %s km: strictly equals calculateDistance',
      (km) => {
        const vLat = LAT + km / 111.195;
        const d = distanceToPerimeterKm(LAT, LON, [[[LON, vLat]]]);
        expect(d).toBe(calculateDistance(LAT, LON, vLat, LON));
      }
    );

    it('a zero-length edge takes the same direct path', () => {
      const vLat = 40.0371;
      const vLon = -119.9123;
      const d = distanceToPerimeterKm(LAT, LON, [
        [
          [vLon, vLat],
          [vLon, vLat],
        ],
      ]);
      expect(d).toBe(calculateDistance(LAT, LON, vLat, vLon));
    });
  });

  describe('null results', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty array', []],
      ['one empty ring', [[]]],
      ['NaN pairs only', [[[NaN, NaN], [NaN, 10]]]],
      ['out-of-range pairs only', [[[200, 10], [10, 95], [-181, 0]]]],
      ['a string', 'ring'],
      ['an object', { 0: [[1, 2]] }],
      ['rings that are not arrays', [1, 'x', null]],
    ])('%s', (_name, rings) => {
      expect(distanceToPerimeterKm(LAT, LON, rings)).toBeNull();
    });
  });

  describe('bad vertices', () => {
    it('are skipped and the rest are used', () => {
      const clean = [
        [-119.95, 39.95],
        [-119.95, 40.05],
        [-119.9, 40.05],
        [-119.9, 39.95],
      ];
      const dirty = [
        [-119.95, 39.95],
        [NaN, 40],
        [-119.95, 40.05],
        ['x', 'y'],
        [-119.9, 40.05],
        [500, 0],
        [7],
        null,
        [-119.9, 39.95],
      ];
      const expected = distanceToPerimeterKm(LAT, LON, [clean]);
      expect(expected).not.toBeNull();
      expect(distanceToPerimeterKm(LAT, LON, [dirty])).toBe(expected);
    });
  });

  describe('coordinate order', () => {
    it('reads pairs as [lon, lat]', () => {
      // Both readings of each pair are valid coordinates here (|lon| and |lat| <= 90).
      const q = { lat: 40.5, lon: -80 };
      const lonLat = [
        [-80.05, 40.45],
        [-80.05, 40.55],
        [-79.95, 40.55],
        [-79.95, 40.45],
      ];
      const latLon = lonLat.map(([lo, la]) => [la, lo]);
      const right = distanceToPerimeterKm(q.lat, q.lon, [lonLat]);
      const swapped = distanceToPerimeterKm(q.lat, q.lon, [latLon]);
      expect(right).toBe(0);
      expect(swapped as number).toBeGreaterThan(100);
    });

    it('measures an outside point against [lon, lat] pairs', () => {
      const lonLat = [
        [-80.2, 40.5],
        [-80.2, 40.6],
        [-80.1, 40.6],
        [-80.1, 40.5],
      ];
      const d = distanceToPerimeterKm(40.55, -80, [lonLat]);
      expect(d as number).toBeCloseTo(calculateDistance(40.55, -80, 40.55, -80.1), 3);
    });
  });

  describe('oracle: zero exactly when pointInRing says inside', () => {
    const convex = [
      [-120.2, 39.8],
      [-119.7, 39.9],
      [-119.8, 40.3],
      [-120.3, 40.2],
    ];
    const lShape = [
      [-120.4, 39.6],
      [-119.6, 39.6],
      [-119.6, 39.9],
      [-120.0, 39.9],
      [-120.0, 40.4],
      [-120.4, 40.4],
    ];
    const triangle = [
      [-120.5, 39.5],
      [-119.5, 39.7],
      [-120.1, 40.5],
    ];
    const polygons = [convex, lShape, triangle];

    it('agrees on a grid of points off every edge', () => {
      let inside = 0;
      let outside = 0;
      for (const ring of polygons) {
        const asLatLon = ring.map(([lo, la]) => [la, lo] as [number, number]);
        for (let i = 0; i < 30; i++) {
          for (let j = 0; j < 30; j++) {
            const lon = -120.7 + i * 0.0397;
            const lat = 39.4 + j * 0.0371;
            const d = distanceToPerimeterKm(lat, lon, [ring]);
            const expected = pointInRing(lat, lon, asLatLon);
            expect(d === 0).toBe(expected);
            if (expected) inside++;
            else outside++;
          }
        }
      }
      // The grid must exercise both outcomes.
      expect(inside).toBeGreaterThan(50);
      expect(outside).toBeGreaterThan(50);
    });
  });
});
