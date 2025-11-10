/**
 * Geohash utilities for lightning strike location filtering
 * Based on the homeassistant-blitzortung implementation
 */

import geohash from 'ngeohash';

/**
 * Bounding box for geographic area
 */
export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/**
 * Calculate bounding box around a point given a radius in kilometers
 * @param lat Latitude
 * @param lon Longitude
 * @param radiusKm Radius in kilometers
 * @returns Bounding box
 */
export function calculateBoundingBox(lat: number, lon: number, radiusKm: number): BoundingBox {
  // Earth's circumference at equator: ~40,000 km
  const latDelta = (radiusKm * 360) / 40000;
  const lonDelta = latDelta / Math.cos((lat * Math.PI) / 180);

  return {
    minLat: Math.max(-90, lat - latDelta),
    minLon: Math.max(-180, lon - lonDelta),
    maxLat: Math.min(90, lat + latDelta),
    maxLon: Math.min(180, lon + lonDelta)
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
    // If neighbor calculation fails, return empty array
    // This can happen at edge cases (poles, date line)
  }

  return neighbors;
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
  const bbox = calculateBoundingBox(lat, lon, radiusKm);
  const tiles = new Set<string>();
  const queue: string[] = [];
  const MAX_TILES = 10000; // Safety limit to prevent memory exhaustion

  // Start with the center point's geohash
  const centerHash = geohash.encode(lat, lon, precision);
  queue.push(centerHash);
  tiles.add(centerHash);

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
        return tiles;
      }

      // Decode neighbor to check if it's within bounding box
      const decoded = geohash.decode(neighbor);

      if (
        decoded.latitude >= bbox.minLat &&
        decoded.latitude <= bbox.maxLat &&
        decoded.longitude >= bbox.minLon &&
        decoded.longitude <= bbox.maxLon
      ) {
        tiles.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return tiles;
}

/**
 * Calculate optimal geohash tiles for MQTT subscription
 * Selects the coarsest precision that keeps the tile count at or below maxTiles
 * This balances spatial granularity against subscription overhead
 *
 * @param lat Center latitude
 * @param lon Center longitude
 * @param radiusKm Search radius in kilometers
 * @param maxTiles Maximum number of tiles (default 9, as used by homeassistant-blitzortung)
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
    const tiles = computeGeohashTiles(lat, lon, radiusKm, precision);

    if (tiles.size <= maxTiles) {
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
