/**
 * Geohash utilities for lightning strike location filtering
 * Based on the homeassistant-blitzortung implementation
 */

import * as geohash from '../vendor/ngeohash.js';

/**
 * Bounding box for geographic area
 *
 * Latitude is clamped to [-90, 90]. Longitude is an interval on the unwrapped line and is
 * never clamped: `minLon < -180` or `maxLon > 180` means the box crosses the antimeridian.
 * The interval is never wider than 360°.
 */
export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/**
 * True when `lon` lies in the box's longitude interval, read on the unwrapped line:
 * a box that crosses ±180° admits a longitude that lands inside it after a ±360° shift.
 */
export function lonInBox(lon: number, box: BoundingBox): boolean {
  return (lon >= box.minLon && lon <= box.maxLon)
    || (lon + 360 >= box.minLon && lon + 360 <= box.maxLon)
    || (lon - 360 >= box.minLon && lon - 360 <= box.maxLon);
}

/**
 * Calculate bounding box around a point given a radius in kilometers
 *
 * The longitude interval is `lon ± lonDelta` on the unwrapped line, so a box near ±180°
 * extends past it (see `BoundingBox`). The half-width is capped at 180°: toward the poles
 * `cos(lat) → 0` and `lonDelta` grows without bound, and a 360°-wide interval is already the
 * full circle.
 * @param lat Latitude
 * @param lon Longitude
 * @param radiusKm Radius in kilometers
 * @returns Bounding box
 */
export function calculateBoundingBox(lat: number, lon: number, radiusKm: number): BoundingBox {
  // Earth's circumference at equator: ~40,000 km
  const latDelta = (radiusKm * 360) / 40000;
  const lonDelta = latDelta / Math.cos((lat * Math.PI) / 180);
  const d = Math.min(180, lonDelta);

  return {
    minLat: Math.max(-90, lat - latDelta),
    minLon: lon - d,
    maxLat: Math.min(90, lat + latDelta),
    maxLon: lon + d
  };
}

/**
 * Get all geohash neighbors for a given geohash
 * @param hash Geohash string
 * @returns Array of neighbor geohashes (up to 8 neighbors)
 */
export function getGeohashNeighbors(hash: string): string[] {
  const neighbors: string[] = [];

  try {
    // Get all 8 neighbors (N, S, E, W, NE, NW, SE, SW)
    neighbors.push(geohash.neighbor(hash, [0, 1]));  // N
    neighbors.push(geohash.neighbor(hash, [0, -1])); // S
    neighbors.push(geohash.neighbor(hash, [1, 0]));  // E
    neighbors.push(geohash.neighbor(hash, [-1, 0])); // W
    neighbors.push(geohash.neighbor(hash, [1, 1]));  // NE
    neighbors.push(geohash.neighbor(hash, [-1, 1])); // NW
    neighbors.push(geohash.neighbor(hash, [1, -1])); // SE
    neighbors.push(geohash.neighbor(hash, [-1, -1])); // SW
  } catch (error) {
    // Defensive guard only: the vendored neighbor clamps latitude, wraps longitude
    // across the antimeridian and does not throw
  }

  return neighbors;
}

/**
 * Geohash tiles for a search area, with the count the precision budget is charged
 */
export interface GeohashTileSet {
  /** Every tile admitted, on both sides of the antimeridian when the box crosses it */
  tiles: Set<string>;
  /** How many of `tiles` the budget counts: the start tile, plus every tile whose centre lies
   *  inside the box with its longitude interval clamped to [-180, 180] */
  budgeted: number;
}

/**
 * Compute geohash tiles that overlap a search area, and the budgeted count
 * Uses breadth-first search to find all geohashes whose centre lies within the bounding box
 *
 * The budgeted count is the start tile plus every tile whose centre lies inside the box
 * with its longitude interval clamped to [-180, 180]: exactly the tiles this function
 * returned before subscriptions crossed the antimeridian. Tiles that enter only through the
 * wrap or the far-side seed are subscribed but not counted.
 * @param lat Center latitude
 * @param lon Center longitude
 * @param radiusKm Search radius in kilometers
 * @param precision Geohash precision (1-12)
 * @returns The tile set and its budgeted count
 */
export function computeGeohashTilesBudgeted(
  lat: number,
  lon: number,
  radiusKm: number,
  precision: number
): GeohashTileSet {
  const bbox = calculateBoundingBox(lat, lon, radiusKm);
  const crosses = bbox.minLon < -180 || bbox.maxLon > 180;
  const clampedMinLon = Math.max(-180, bbox.minLon);
  const clampedMaxLon = Math.min(180, bbox.maxLon);
  const tiles = new Set<string>();
  const queue: string[] = [];
  const MAX_TILES = 10000; // Safety limit to prevent memory exhaustion
  let budgeted = 0;

  const inClampedBox = (centre: { latitude: number; longitude: number }): boolean =>
    centre.latitude >= bbox.minLat &&
    centre.latitude <= bbox.maxLat &&
    centre.longitude >= clampedMinLon &&
    centre.longitude <= clampedMaxLon;

  const admit = (hash: string, counted: boolean): void => {
    tiles.add(hash);
    queue.push(hash);
    if (counted) {
      budgeted++;
    }
  };

  // Start with the center point's geohash. It is always counted, as it always was
  const centerHash = geohash.encode(lat, lon, precision);
  admit(centerHash, true);

  // A box that crosses the antimeridian also starts from the far side's edge cell at the
  // point's latitude. Like the start cell, that cell always overlaps the box, and the
  // centre test below can reject both for the same reason. encode places 180 in the
  // easternmost cell and -180 in the westernmost, so this is the far edge by construction.
  if (crosses) {
    const farHash = geohash.encode(lat, lon >= 0 ? -180 : 180, precision);
    if (!tiles.has(farHash)) {
      admit(farHash, inClampedBox(geohash.decode(farHash)));
    }
  }

  // Breadth-first search to find all tiles within bounding box
  while (queue.length > 0) {
    const currentHash = queue.shift()!;
    const neighbors = getGeohashNeighbors(currentHash);

    for (const neighbor of neighbors) {
      if (tiles.has(neighbor)) {
        continue; // Already visited
      }

      // Safety check: prevent unbounded growth
      if (tiles.size >= MAX_TILES) {
        return { tiles, budgeted };
      }

      // Decode neighbor to check if it's within bounding box
      const decoded = geohash.decode(neighbor);

      if (
        decoded.latitude >= bbox.minLat &&
        decoded.latitude <= bbox.maxLat &&
        lonInBox(decoded.longitude, bbox)
      ) {
        admit(neighbor, inClampedBox(decoded));
      }
    }
  }

  return { tiles, budgeted };
}

/**
 * Compute geohash tiles that overlap a circular search area
 * Uses breadth-first search to find all geohashes within the bounding box
 * @param lat Center latitude
 * @param lon Center longitude
 * @param radiusKm Search radius in kilometers
 * @param precision Geohash precision (1-12)
 * @returns Set of geohash strings that overlap the search area
 */
export function computeGeohashTiles(
  lat: number,
  lon: number,
  radiusKm: number,
  precision: number
): Set<string> {
  return computeGeohashTilesBudgeted(lat, lon, radiusKm, precision).tiles;
}

/**
 * Calculate optimal geohash tiles for MQTT subscription
 * Selects the finest (highest) precision whose budgeted tile count is at or below maxTiles:
 * precisions run from 1 to 12 and the last one that fits is kept. The budgeted count is the
 * tile set as it was before subscriptions crossed the antimeridian (see
 * computeGeohashTilesBudgeted), so the precision chosen is the same as before, on every input. A box that crosses the
 * antimeridian may return more than maxTiles tiles (observed maximum 2 × maxTiles), because
 * tiles that enter only through the wrap or the far-side seed do not count against the budget.
 * This balances spatial granularity against subscription overhead
 *
 * @param lat Center latitude
 * @param lon Center longitude
 * @param radiusKm Search radius in kilometers
 * @param maxTiles Maximum budgeted tiles (default 9, as used by homeassistant-blitzortung)
 * @returns Set of geohash strings to subscribe to
 */
export function calculateGeohashSubscriptions(
  lat: number,
  lon: number,
  radiusKm: number,
  maxTiles: number = 9
): Set<string> {
  let result = new Set<string>();

  // Iterate through precision levels 1-12
  // Start with coarse precision and increase until we exceed maxTiles
  for (let precision = 1; precision <= 12; precision++) {
    const { tiles, budgeted } = computeGeohashTilesBudgeted(lat, lon, radiusKm, precision);

    if (budgeted <= maxTiles) {
      result = tiles;
    } else {
      // Exceeded maxTiles, use previous precision
      break;
    }
  }

  // If result is empty (shouldn't happen), fall back to center point at precision 4
  if (result.size === 0) {
    result.add(geohash.encode(lat, lon, 4));
  }

  return result;
}

/**
 * Check if a point is within a radius of a center point
 * Uses Haversine formula for great-circle distance
 *
 * @param centerLat Center latitude
 * @param centerLon Center longitude
 * @param pointLat Point latitude
 * @param pointLon Point longitude
 * @param radiusKm Radius in kilometers
 * @returns true if point is within radius
 */
export function isWithinRadius(
  centerLat: number,
  centerLon: number,
  pointLat: number,
  pointLon: number,
  radiusKm: number
): boolean {
  const R = 6371; // Earth's radius in km
  const dLat = ((pointLat - centerLat) * Math.PI) / 180;
  const dLon = ((pointLon - centerLon) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((centerLat * Math.PI) / 180) *
      Math.cos((pointLat * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance <= radiusKm;
}
