/**
 * Distance from a point to a wildfire perimeter (NIFC / ArcGIS polygon rings).
 *
 * Returns exactly 0 when the point is inside the polygon, otherwise the
 * great-circle distance in km to the nearest point on any ring edge, or `null`
 * when the geometry carries no usable vertex.
 *
 * Input order: ArcGIS sends each vertex as `[lon, lat]` (WGS84). This is the
 * opposite of `pointInPolygon.ts`, which takes `[lat, lon]` and ORs over rings
 * (a point in a hole still counts as inside any other ring). Neither fits here:
 * a hole must read as outside, so inside is even-odd parity summed over all
 * rings, and that is why `pointInPolygon.ts` is not reused.
 *
 * Pure, zero I/O, no logging. No vertex cap: a trimmed ring set used for
 * "is it inside" would fabricate distance (GOTCHAS G8).
 *
 * Precondition: no ring crosses the antimeridian. NIFC covers the US, PR, USVI
 * and Guam; only the western Aleutians cross 180 deg. Revisit trigger: a WFIGS
 * perimeter with vertices on both sides of 180 deg.
 *
 * The edge foot is picked in a local equirectangular projection centred on the
 * query point; the reported distance is always haversine to that foot.
 */
import { calculateDistance } from './distance.js';

type Vertex = readonly [lon: number, lat: number];

function toVertex(raw: unknown): Vertex | null {
  if (!Array.isArray(raw)) return null;
  const lon: unknown = raw[0];
  const lat: unknown = raw[1];
  if (typeof lon !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

function usableRing(raw: unknown): Vertex[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Vertex[] = [];
  for (const v of raw) {
    const vertex = toVertex(v);
    if (vertex) out.push(vertex);
  }
  return out;
}

/** Distance in km from the query point to segment a-b (a !== b), via the projected foot. */
function edgeDistanceKm(
  latitude: number,
  longitude: number,
  cosLat: number,
  a: Vertex,
  b: Vertex
): number {
  const ax = (a[0] - longitude) * cosLat;
  const ay = a[1] - latitude;
  const bx = (b[0] - longitude) * cosLat;
  const by = b[1] - latitude;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return calculateDistance(latitude, longitude, a[1], a[0]);
  }
  const t = -(ax * dx + ay * dy) / lenSq;
  if (t <= 0) return calculateDistance(latitude, longitude, a[1], a[0]);
  if (t >= 1) return calculateDistance(latitude, longitude, b[1], b[0]);
  const footLon = a[0] + t * (b[0] - a[0]);
  const footLat = a[1] + t * (b[1] - a[1]);
  return calculateDistance(latitude, longitude, footLat, footLon);
}

export function distanceToPerimeterKm(
  latitude: number,
  longitude: number,
  rings: unknown
): number | null {
  if (!Array.isArray(rings)) return null;

  const usable: Vertex[][] = [];
  for (const raw of rings) {
    const ring = usableRing(raw);
    if (ring && ring.length > 0) usable.push(ring);
  }
  if (usable.length === 0) return null;

  // Inside: even-odd crossing parity over every ring with 3+ usable vertices.
  let crossings = 0;
  for (const ring of usable) {
    if (ring.length < 3) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as Vertex;
      const [xj, yj] = ring[j] as Vertex;
      if (yi > latitude !== yj > latitude) {
        const xCross = ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
        if (longitude < xCross) crossings++;
      }
    }
  }
  if (crossings % 2 === 1) return 0;

  const cosLat = Math.cos((latitude * Math.PI) / 180);
  let best = Infinity;
  for (const ring of usable) {
    if (ring.length === 1) {
      const v = ring[0] as Vertex;
      best = Math.min(best, calculateDistance(latitude, longitude, v[1], v[0]));
      continue;
    }
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      best = Math.min(
        best,
        edgeDistanceKm(latitude, longitude, cosLat, ring[j] as Vertex, ring[i] as Vertex)
      );
    }
  }
  return best;
}
