/**
 * Copyright (c) 2011, Sun Ning.
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy,
 * modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
 * BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
 * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

/*
 * Provenance: npm package `ngeohash` 0.6.4 (MIT), repository
 * https://github.com/sunng87/node-geohash, commit
 * 748bcd3446a9f57fe98384ef2ebec17fa3b326da (the package's npm gitHead).
 *
 * Derived work: transcribed from the package's main.js to TypeScript, keeping
 * only `encode`, `decode` and `neighbor` (plus the internal helpers they use).
 * The arithmetic is kept operation for operation; nothing is "improved".
 * Equivalence is proven by tests/unit/vendor-ngeohash.test.ts against the
 * upstream package, which stays a devDependency for that purpose only.
 */

const BASE32_CODES = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE32_CODES_DICT = new Map<string, number>();
for (let i = 0; i < BASE32_CODES.length; i++) {
  BASE32_CODES_DICT.set(BASE32_CODES.charAt(i), i);
}

const MIN_LAT = -90;
const MAX_LAT = 90;
const MIN_LON = -180;
const MAX_LON = 180;

export interface GeohashPoint {
  latitude: number;
  longitude: number;
  error: { latitude: number; longitude: number };
}

/**
 * Create a geohash of `numberOfChars` characters for a latitude and longitude.
 * Upstream's `ENCODE_AUTO` string mode and its default length are not carried:
 * every caller here passes a length.
 */
export function encode(latitude: number, longitude: number, numberOfChars: number): string {
  const chars: string[] = [];
  let bits = 0;
  let bitsTotal = 0;
  let hashValue = 0;
  let maxLat = MAX_LAT;
  let minLat = MIN_LAT;
  let maxLon = MAX_LON;
  let minLon = MIN_LON;
  let mid: number;
  while (chars.length < numberOfChars) {
    if (bitsTotal % 2 === 0) {
      mid = (maxLon + minLon) / 2;
      if (longitude > mid) {
        hashValue = (hashValue << 1) + 1;
        minLon = mid;
      } else {
        hashValue = (hashValue << 1) + 0;
        maxLon = mid;
      }
    } else {
      mid = (maxLat + minLat) / 2;
      if (latitude > mid) {
        hashValue = (hashValue << 1) + 1;
        minLat = mid;
      } else {
        hashValue = (hashValue << 1) + 0;
        maxLat = mid;
      }
    }

    bits++;
    bitsTotal++;
    if (bits === 5) {
      chars.push(BASE32_CODES.charAt(hashValue));
      bits = 0;
      hashValue = 0;
    }
  }
  return chars.join('');
}

/** [minLat, minLon, maxLat, maxLon] of the cell a geohash names. */
function decodeBbox(hashString: string): [number, number, number, number] {
  let isLon = true;
  let maxLat = MAX_LAT;
  let minLat = MIN_LAT;
  let maxLon = MAX_LON;
  let minLon = MIN_LON;
  let mid: number;

  for (let i = 0; i < hashString.length; i++) {
    const code = hashString.charAt(i).toLowerCase();
    // Upstream reads a plain-object dict, so an unknown character yields
    // `undefined`, and `undefined >> n` is 0. The `?? 0` states that outright.
    const hashValue = BASE32_CODES_DICT.get(code) ?? 0;

    for (let bits = 4; bits >= 0; bits--) {
      const bit = (hashValue >> bits) & 1;
      if (isLon) {
        mid = (maxLon + minLon) / 2;
        if (bit === 1) {
          minLon = mid;
        } else {
          maxLon = mid;
        }
      } else {
        mid = (maxLat + minLat) / 2;
        if (bit === 1) {
          minLat = mid;
        } else {
          maxLat = mid;
        }
      }
      isLon = !isLon;
    }
  }
  return [minLat, minLon, maxLat, maxLon];
}

/** The centre of a geohash cell, with the half-extent of the cell as `error`. */
export function decode(hashString: string): GeohashPoint {
  const bbox = decodeBbox(hashString);
  const lat = (bbox[0] + bbox[2]) / 2;
  const lon = (bbox[1] + bbox[3]) / 2;
  const latErr = bbox[2] - lat;
  const lonErr = bbox[3] - lon;
  return { latitude: lat, longitude: lon, error: { latitude: latErr, longitude: lonErr } };
}

/**
 * The adjacent geohash of the same length in `direction`, given as
 * **[lat, lon]**: `[1, 0]` is north, `[0, 1]` is east, `[-1, -1]` is south-west.
 */
export function neighbor(hashString: string, direction: readonly [number, number]): string {
  const lonLat = decode(hashString);
  let neighborLat = lonLat.latitude + direction[0] * lonLat.error.latitude * 2;
  let neighborLon = lonLat.longitude + direction[1] * lonLat.error.longitude * 2;
  neighborLon = ensureValidLon(neighborLon);
  neighborLat = ensureValidLat(neighborLat);
  return encode(neighborLat, neighborLon, hashString.length);
}

function ensureValidLon(lon: number): number {
  if (lon > MAX_LON) return MIN_LON + (lon % MAX_LON);
  if (lon < MIN_LON) return MAX_LON + (lon % MAX_LON);
  return lon;
}

function ensureValidLat(lat: number): number {
  if (lat > MAX_LAT) return MAX_LAT;
  if (lat < MIN_LAT) return MIN_LAT;
  return lat;
}
