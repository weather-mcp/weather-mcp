/**
 * Point-in-polygon geometry for CAP (Common Alerting Protocol) alert areas.
 *
 * Pure, zero-I/O module — no imports beyond types (design pattern 6 in
 * CLAUDE.md: service fetches -> pure util computes -> handler renders).
 *
 * Coordinate order: ring points are `[lat, lon]` pairs, matching CAP's
 * `<polygon>` coordinate order. Do not swap to lon/lat.
 *
 * **Precondition — no antimeridian handling.** Rings are assumed not to
 * cross +/-180 degrees longitude. This holds for the feeds this module was
 * built for (India, the Philippines, Indonesia), none of which have alert
 * polygons that straddle the antimeridian.
 *
 * **Revisit trigger:** adding a feed for a country whose alert polygons can
 * cross 180 degrees longitude (e.g. Fiji, New Zealand) — this module would
 * need antimeridian-aware longitude normalization before it could be reused
 * for that feed.
 */

/**
 * One polygon ring: an ordered list of `[lat, lon]` pairs.
 *
 * Declared `readonly` throughout so a caller may pass a frozen or generated
 * constant (e.g. `src/data/jmaAreas.ts`) without copying it. Nothing in this
 * module writes to a ring, so this is a type-level widening only — a mutable
 * `Array<[number, number]>` still satisfies it, and every existing caller is
 * unchanged.
 */
export type Ring = ReadonlyArray<readonly [number, number]>;

/**
 * Determine whether a point lies exactly on the closed segment [a, b],
 * inclusive of both endpoints (vertices).
 *
 * Boundary membership is decided explicitly here (collinearity via cross
 * product, then a segment bounding-box check) rather than left to whatever
 * the ray-casting loop happens to do with exact floating-point equality
 * (design decision D4: no tolerance band beyond float equality — boundary
 * points must be deterministic).
 */
function isOnSegment(
  lat: number,
  lon: number,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): boolean {
  const cross = (lon2 - lon1) * (lat - lat1) - (lat2 - lat1) * (lon - lon1);
  if (cross !== 0) {
    return false;
  }

  const minLat = Math.min(lat1, lat2);
  const maxLat = Math.max(lat1, lat2);
  const minLon = Math.min(lon1, lon2);
  const maxLon = Math.max(lon1, lon2);

  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

/**
 * Count of distinct `[lat, lon]` points in a ring, used to detect degenerate
 * rings (fewer than 3 distinct vertices can never enclose an area).
 */
function distinctPointCount(ring: Ring): number {
  const seen = new Set<string>();
  for (const point of ring) {
    seen.add(`${point[0]},${point[1]}`);
  }
  return seen.size;
}

/**
 * Test whether `(lat, lon)` lies inside (or exactly on the boundary of) a
 * single polygon ring.
 *
 * Algorithm: a cheap bounding-box rejection first, then an explicit
 * on-edge/on-vertex check (boundary points always count as inside), then
 * even-odd ray casting for the strict-interior case. The ray-casting
 * crossing test compares longitude against the test longitude, so an edge
 * with two consecutive points sharing a longitude (a vertical edge) is
 * always excluded from the intersect branch and never divides by zero —
 * this is the classic double-count/divide-by-zero trap for a naive
 * ray-casting implementation.
 *
 * A degenerate ring (fewer than 3 distinct points) returns `false`, as does
 * a `NaN` coordinate (every comparison against `NaN` is false), so malformed
 * geometry never throws. There is deliberately **no blanket `try/catch`**:
 * this is a matching predicate on safety data, and silently answering "not
 * inside" on an unexpected fault would drop a warning that does cover the
 * point — the fabricated-all-clear direction the project's contract posture
 * forbids. Malformed input is handled by the explicit guards above; a genuine
 * defect should surface loudly.
 */
export function pointInRing(lat: number, lon: number, ring: Ring): boolean {
  if (!ring || ring.length === 0) {
    return false;
  }
  if (distinctPointCount(ring) < 3) {
    return false;
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [pointLat, pointLon] of ring) {
    if (pointLat < minLat) minLat = pointLat;
    if (pointLat > maxLat) maxLat = pointLat;
    if (pointLon < minLon) minLon = pointLon;
    if (pointLon > maxLon) maxLon = pointLon;
  }
  if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) {
    return false;
  }

  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [lat1, lon1] = ring[i];
    const [lat2, lon2] = ring[(i + 1) % n];
    if (isOnSegment(lat, lon, lat1, lon1, lat2, lon2)) {
      return true;
    }
  }

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [latI, lonI] = ring[i];
    const [latJ, lonJ] = ring[j];
    const intersect =
      lonI > lon !== lonJ > lon &&
      lat < ((latJ - latI) * (lon - lonI)) / (lonJ - lonI) + latI;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Test whether `(lat, lon)` lies inside (or on the boundary of) any of the
 * given rings — used for a CAP `<area>` with multiple `<polygon>` elements.
 *
 * `rings` empty returns `false`. Never throws.
 */
export function pointInAnyRing(lat: number, lon: number, rings: readonly Ring[]): boolean {
  if (!rings || rings.length === 0) {
    return false;
  }
  for (const ring of rings) {
    if (pointInRing(lat, lon, ring)) {
      return true;
    }
  }
  return false;
}
