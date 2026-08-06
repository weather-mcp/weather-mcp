/**
 * Utilities for locating the nearest grid point in a GRIB2 message's spatial grid.
 *
 * NOMADS models use two fundamentally different grid layouts:
 *
 * - Separable / rectilinear grids (e.g. GFS's global 1-degree lat/lon grid): latitude
 *   and longitude are independent axes. The `latitude` array has one entry per row and
 *   the `longitude` array has one entry per column, so a point's flat index is
 *   `row * cols + col`.
 * - Curvilinear / projected grids (e.g. NAM's Lambert Conformal Conic grid): every grid
 *   point has its own unique (lat, lon) pair. Both `latitude` and `longitude` are flat
 *   arrays of length `rows * cols`, one entry per point. Row/column indices found by
 *   searching latitude and longitude independently cannot be recombined with
 *   `row * cols + col` — the two axes are not separable, and doing so produces a
 *   meaningless (often out-of-bounds) index.
 *
 * `findNearestGridIndex` detects which layout a message uses from the array lengths and
 * searches accordingly.
 */

import { calculateDistance } from './distance.js';

export interface GridShape {
  rows: number;
  cols: number;
}

export interface GridLatLng {
  latitude: number[];
  longitude: number[];
}

/**
 * Find the flat data-array index of the grid point nearest to the target coordinates.
 * Returns undefined if the grid data is missing or malformed.
 */
export function findNearestGridIndex(
  latlng: GridLatLng | undefined,
  gridShape: GridShape | undefined,
  targetLatitude: number,
  targetLongitude: number
): number | undefined {
  const latitudes = latlng?.latitude;
  const longitudes = latlng?.longitude;
  const rows = gridShape?.rows;
  const cols = gridShape?.cols;

  if (!latitudes?.length || !longitudes?.length || !rows || !cols || rows < 1 || cols < 1) {
    return undefined;
  }

  const normalizedLon = normalizeLongitude(targetLongitude, longitudes);
  const isSeparableGrid = latitudes.length === rows && longitudes.length === cols;

  if (isSeparableGrid) {
    const latIndex = findNearest1DIndex(latitudes, targetLatitude);
    const lonIndex = findNearest1DIndex(longitudes, normalizedLon);
    return latIndex * cols + lonIndex;
  }

  if (latitudes.length !== longitudes.length || latitudes.length !== rows * cols) {
    // Neither a clean separable grid nor a fully-populated per-point grid; bail out
    // rather than guess at an index.
    return undefined;
  }

  return findNearestPointIndex(latitudes, longitudes, targetLatitude, normalizedLon);
}

/**
 * NOMADS grids mix longitude conventions: GFS's global grid runs 0-360, while NAM's
 * regional subregion is returned in -180/180. Detect the message's convention from its
 * own values and normalize the target to match, rather than assuming one or the other.
 */
function normalizeLongitude(longitude: number, referenceLongitudes: number[]): number {
  const usesZeroTo360 = referenceLongitudes.some((lon) => lon > 180);

  if (usesZeroTo360 && longitude < 0) {
    return longitude + 360;
  }

  if (!usesZeroTo360 && longitude > 180) {
    return longitude - 360;
  }

  return longitude;
}

function findNearest1DIndex(values: number[], target: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < values.length; i++) {
    const distance = Math.abs(values[i] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function findNearestPointIndex(
  latitudes: number[],
  longitudes: number[],
  targetLatitude: number,
  targetLongitude: number
): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < latitudes.length; i++) {
    const distance = calculateDistance(latitudes[i], longitudes[i], targetLatitude, targetLongitude);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}
