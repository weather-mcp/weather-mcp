/**
 * Unit tests for lightning geohash subscriptions across the antimeridian
 * Six contracts: both sides covered, ±180 equivalence, never less than before,
 * the tile budget, the width cap, and lonInBox itself.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateBoundingBox,
  computeGeohashTiles,
  computeGeohashTilesBudgeted,
  calculateGeohashSubscriptions,
  lonInBox
} from '../../src/utils/geohash.js';
import { decode, encode } from '../../src/vendor/ngeohash.js';

const sorted = (s: Set<string>): string[] => [...s].sort();

// Hash lists the pre-antimeridian implementation (main) returned, as measured
const BASE: Record<string, string[]> = {
  'nz-45-180-250': ['pzw', 'pzx', 'pzy', 'pzz', 'rbn', 'rbp', 'rbq', 'rbr'],
  'fiji-250': ['ruw', 'rux', 'ruy', 'ruz', 'rvn', 'rvp', 'rvq', 'rvr'],
  'south-80-100': ['01']
};

// Every crossing point used by contracts 1-3
const SEAM_POINTS: Array<[number, number, number]> = [
  [-16.8, 179.9, 100],
  [64.7, -179.9, 100],
  [0, 180, 67],
  [0, -180, 67],
  [0, 180, 100],
  [0, -180, 100],
  [-16.8, 180, 67],
  [-16.8, -180, 67],
  [-16.8, 180, 100],
  [-16.8, -180, 100],
  [-45, 180, 250],
  [-16.8, 179.9, 250],
  [-80, -178, 100]
];

describe('Geohash antimeridian: the seam is covered on both sides', () => {
  it('Fiji (-16.8, 179.9) subscribes to cells on both sides', () => {
    const subs = calculateGeohashSubscriptions(-16.8, 179.9, 100);
    expect(sorted(subs)).toEqual(['2hb', '2j0', 'ruz', 'rvp']);
    const lons = [...subs].map(h => decode(h).longitude);
    expect(lons.some(l => l > 0)).toBe(true);
    expect(lons.some(l => l < 0)).toBe(true);
    expect(calculateBoundingBox(-16.8, 179.9, 100).maxLon).toBeGreaterThan(180);
  });

  it('Chukotka (64.7, -179.9) subscribes to cells on both sides', () => {
    const subs = calculateGeohashSubscriptions(64.7, -179.9, 100);
    expect(sorted(subs)).toEqual(['b52', 'b53', 'b58', 'b59', 'zgr', 'zgx']);
    const lons = [...subs].map(h => decode(h).longitude);
    expect(lons.some(l => l > 0)).toBe(true);
    expect(lons.some(l => l < 0)).toBe(true);
    expect(calculateBoundingBox(64.7, -179.9, 100).minLon).toBeLessThan(-180);
  });
});

describe('Geohash antimeridian: lon 180 and lon -180 are the same query', () => {
  for (const lat of [0, -16.8]) {
    for (const r of [67, 100]) {
      it(`lat ${lat}, ${r} km: +180 equals -180`, () => {
        const east = sorted(calculateGeohashSubscriptions(lat, 180, r));
        const west = sorted(calculateGeohashSubscriptions(lat, -180, r));
        expect(east).toEqual(west);
      });
    }
  }

  it('(0, +-180, 67 km) is exactly 2pb rzz, where the cell is wider than the box', () => {
    expect(sorted(calculateGeohashSubscriptions(0, 180, 67))).toEqual(['2pb', 'rzz']);
    expect(sorted(calculateGeohashSubscriptions(0, -180, 67))).toEqual(['2pb', 'rzz']);
  });

  it('(0, +-180, 100 km) is exactly 2pb 800 rzz xbp', () => {
    expect(sorted(calculateGeohashSubscriptions(0, 180, 100))).toEqual(['2pb', '800', 'rzz', 'xbp']);
    expect(sorted(calculateGeohashSubscriptions(0, -180, 100))).toEqual(['2pb', '800', 'rzz', 'xbp']);
  });
});

describe('Geohash antimeridian: never less than before', () => {
  it('(-45, 180, 250) is the base 8 plus 8 far-side cells, 16 whole', () => {
    const subs = calculateGeohashSubscriptions(-45, 180, 250);
    expect(sorted(subs)).toEqual([
      '0p8', '0p9', '0pb', '0pc', '200', '201', '202', '203',
      'pzw', 'pzx', 'pzy', 'pzz', 'rbn', 'rbp', 'rbq', 'rbr'
    ]);
  });

  it('(-16.8, 179.9, 250) is the base 8 plus 8 far-side cells, 16 whole', () => {
    const subs = calculateGeohashSubscriptions(-16.8, 179.9, 250);
    expect(sorted(subs)).toEqual([
      '2h8', '2h9', '2hb', '2hc', '2j0', '2j1', '2j2', '2j3',
      'ruw', 'rux', 'ruy', 'ruz', 'rvn', 'rvp', 'rvq', 'rvr'
    ]);
  });

  it('(-80, -178, 100) is exactly 01 pc', () => {
    expect(sorted(calculateGeohashSubscriptions(-80, -178, 100))).toEqual(['01', 'pc']);
  });

  const cases: Array<[string, number, number, number]> = [
    ['nz-45-180-250', -45, 180, 250],
    ['fiji-250', -16.8, 179.9, 250],
    ['south-80-100', -80, -178, 100]
  ];
  for (const [key, lat, lon, r] of cases) {
    it(`${key}: every base hash is present, precision unchanged`, () => {
      const subs = calculateGeohashSubscriptions(lat, lon, r);
      for (const h of BASE[key]) {
        expect(subs.has(h)).toBe(true);
      }
      for (const h of subs) {
        expect(h.length).toBe(BASE[key][0].length);
      }
    });
  }

  it('Tonga (-21.1, -175.2) does not cross and stays 2h5 2h7', () => {
    expect(sorted(calculateGeohashSubscriptions(-21.1, -175.2, 100))).toEqual(['2h5', '2h7']);
  });

  it('NYC (40.7128, -74.006) stays dr5 dr7', () => {
    expect(sorted(calculateGeohashSubscriptions(40.7128, -74.006, 100))).toEqual(['dr5', 'dr7']);
  });
});

describe('Geohash antimeridian: the budget', () => {
  for (const [lat, lon, r] of SEAM_POINTS) {
    it(`(${lat}, ${lon}, ${r} km): tiles are the subscription set, budgeted <= 9, recount matches`, () => {
      const subs = calculateGeohashSubscriptions(lat, lon, r);
      const p = [...subs][0].length;
      const { tiles, budgeted } = computeGeohashTilesBudgeted(lat, lon, r, p);

      expect(sorted(tiles)).toEqual(sorted(subs));
      expect(budgeted).toBeLessThanOrEqual(9);
      expect(tiles.size).toBeLessThanOrEqual(18);

      // Independent recount
      const box = calculateBoundingBox(lat, lon, r);
      const lo = Math.max(-180, box.minLon);
      const hi = Math.min(180, box.maxLon);
      const start = encode(lat, lon, p);
      let recount = 0;
      for (const h of tiles) {
        const c = decode(h);
        const inside = c.latitude >= box.minLat && c.latitude <= box.maxLat &&
          c.longitude >= lo && c.longitude <= hi;
        if (h === start || inside) {
          recount++;
        }
      }
      expect(recount).toBe(budgeted);
    });
  }

  it('terminates at the tile cap on the seam', () => {
    expect(computeGeohashTiles(0, 180, 5000, 6).size).toBeLessThanOrEqual(10000);
  });

  it('returns at lon -180 with a wide radius and fine precision', () => {
    const tiles = computeGeohashTiles(0, -180, 2000, 7);
    expect(tiles.size).toBeGreaterThan(0);
  });
});

describe('Geohash antimeridian: the width cap', () => {
  it('a 500 km box at 89.9 N is finite and at most 360 degrees wide', () => {
    const box = calculateBoundingBox(89.9, 0, 500);
    expect(Number.isFinite(box.minLon)).toBe(true);
    expect(Number.isFinite(box.maxLon)).toBe(true);
    expect(box.maxLon - box.minLon).toBeLessThanOrEqual(360);
    expect(lonInBox(-180, box)).toBe(true);
    expect(lonInBox(0, box)).toBe(true);
    expect(lonInBox(180, box)).toBe(true);
  });
});

describe('lonInBox', () => {
  const east = { minLat: -1, maxLat: 1, minLon: 178, maxLon: 182 };
  const west = { minLat: -1, maxLat: 1, minLon: -182, maxLon: -178 };
  const plain = { minLat: -1, maxLat: 1, minLon: -76, maxLon: -72 };

  it('east-crossing box', () => {
    expect(lonInBox(179, east)).toBe(true);
    expect(lonInBox(-179, east)).toBe(true);
    expect(lonInBox(0, east)).toBe(false);
  });

  it('west-crossing box', () => {
    expect(lonInBox(-179, west)).toBe(true);
    expect(lonInBox(179, west)).toBe(true);
    expect(lonInBox(0, west)).toBe(false);
  });

  it('non-crossing box', () => {
    expect(lonInBox(-74, plain)).toBe(true);
    // 284 - 360 = -76 is the box's own closed edge, so it is inside
    expect(lonInBox(284, plain)).toBe(true);
    expect(lonInBox(283, plain)).toBe(false);
    expect(lonInBox(290, plain)).toBe(false);
    // -434 + 360 = -74 is inside; a longitude two turns out (-794) is not reached by +-360
    expect(lonInBox(-434, plain)).toBe(true);
    expect(lonInBox(-794, plain)).toBe(false);
  });
});
