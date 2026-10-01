/**
 * Differential test: the vendored geohash codec (src/vendor/ngeohash.ts) against
 * the upstream `ngeohash` package it was transcribed from.
 *
 * `ngeohash` stays a devDependency so this comparison can run. Every case
 * compares the two implementations directly; nothing here encodes an expected
 * hash by hand. The non-vacuity counts make sure the sweep actually reaches the
 * edges where geohash implementations differ (G13): the antimeridian wrap, the
 * pole clamp, and a neighbour that changes the leading character.
 */

import { describe, it, expect } from 'vitest';
import upstream from 'ngeohash';
import * as vendored from '../../src/vendor/ngeohash.js';

/** Deterministic PRNG (mulberry32) so the scatter is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0x73;
const PRECISIONS = Array.from({ length: 12 }, (_, i) => i + 1);

function steps(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max; v += step) out.push(v);
  return out;
}

const LATITUDES = [...steps(-90, 90, 7.5), 89.999999, -89.999999, 1e-9, -1e-9, 0];
const LONGITUDES = [...steps(-180, 180, 7.5), 179.999999, -179.999999, 1e-9, -1e-9, 0];

const GRID: Array<[number, number]> = LATITUDES.flatMap((lat) =>
  LONGITUDES.map((lon): [number, number] => [lat, lon])
);

const random = mulberry32(SEED);
const SCATTER: Array<[number, number]> = Array.from({ length: 2000 }, (): [number, number] => [
  random() * 180 - 90,
  random() * 360 - 180,
]);

const DIRECTIONS: Array<[number, number]> = [-1, 0, 1]
  .flatMap((dLat) => [-1, 0, 1].map((dLon): [number, number] => [dLat, dLon]))
  .filter(([dLat, dLon]) => dLat !== 0 || dLon !== 0);

/** Every distinct hash the grid produces, at every precision. */
const GRID_HASHES: string[] = [
  ...new Set(GRID.flatMap(([lat, lon]) => PRECISIONS.map((p) => upstream.encode(lat, lon, p)))),
];

describe('vendored ngeohash matches upstream ngeohash@0.6.4', () => {
  it('encode agrees across the coordinate grid at every precision', () => {
    let compared = 0;
    for (const [lat, lon] of GRID) {
      for (const p of PRECISIONS) {
        expect(vendored.encode(lat, lon, p)).toBe(upstream.encode(lat, lon, p));
        compared++;
      }
    }
    expect(compared).toBe(GRID.length * PRECISIONS.length);
  });

  it('encode agrees across a fixed-seed scatter over the whole sphere', () => {
    for (const [lat, lon] of SCATTER) {
      for (const p of PRECISIONS) {
        expect(vendored.encode(lat, lon, p)).toBe(upstream.encode(lat, lon, p));
      }
    }
  });

  it('decode agrees exactly, including uppercase and out-of-alphabet characters', () => {
    const scatterHashes = SCATTER.map(([lat, lon], i) => upstream.encode(lat, lon, (i % 12) + 1));
    const inputs = [
      ...GRID_HASHES,
      ...scatterHashes,
      ...GRID_HASHES.filter((_, i) => i % 7 === 0).map((h) => h.toUpperCase()),
      // a, i, l and o are not in the geohash alphabet; upstream decodes them as 0.
      'a', 'i', 'l', 'o', 'dra', 'u4pruydqqvj', 'oooo', '9q8yyk8ail', 'AIlo',
    ];
    for (const hash of inputs) {
      expect(vendored.decode(hash)).toStrictEqual(upstream.decode(hash));
    }
  });

  it('neighbor agrees in all eight directions, and the sweep reaches every edge', () => {
    let antimeridianWraps = 0;
    let poleClamps = 0;
    let leadingCharCrossings = 0;

    for (const hash of GRID_HASHES) {
      const source = upstream.decode(hash);
      const touchesNorthPole = source.latitude + source.error.latitude === 90;
      const touchesSouthPole = source.latitude - source.error.latitude === -90;

      for (const direction of DIRECTIONS) {
        const expected = upstream.neighbor(hash, direction);
        expect(vendored.neighbor(hash, direction)).toBe(expected);

        const target = upstream.decode(expected);
        if (Math.abs(target.longitude - source.longitude) > 180) antimeridianWraps++;
        if ((touchesNorthPole && direction[0] === 1) || (touchesSouthPole && direction[0] === -1)) {
          poleClamps++;
        }
        if (hash.length >= 2 && expected.charAt(0) !== hash.charAt(0)) leadingCharCrossings++;
      }
    }

    expect(antimeridianWraps).toBeGreaterThan(0);
    expect(poleClamps).toBeGreaterThan(0);
    expect(leadingCharCrossings).toBeGreaterThan(0);
  });
});
