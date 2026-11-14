/**
 * Web-Mercator (EPSG:3857) tile index for a coordinate.
 *
 * Two callers: `services/rainviewer.ts` (radar tile URLs) and `services/gibs.ts`
 * (satellite tile URLs). There is one copy because two copies drifted: only the
 * GIBS one clamped the computed index to the grid, so RainViewer built URLs that
 * pointed off the tile grid at the clamp latitude.
 */

/** Web Mercator projection latitude limit (degrees). */
export const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;

/**
 * Convert lat/lon to the tile column (`x`) and row (`y`) at a zoom level.
 *
 * Inputs are validated upstream (`validateLatitude` / `validateLongitude`); this
 * function does not validate and does not clamp `zoom` (zoom limits belong to
 * each service). Latitude is clamped to the Mercator-valid range and both
 * indices are clamped to `[0, 2 ** zoom - 1]`.
 *
 * Longitude 180 clamps to column `n - 1` rather than wrapping to column 0:
 * both tiles touch the antimeridian, this matches prior GIBS behaviour, and a
 * wrap would put +180 and 179.99 on opposite sides of the map.
 */
export function webMercatorTileIndex(
  latitude: number,
  longitude: number,
  zoom: number
): { x: number; y: number } {
  const lat = Math.max(-WEB_MERCATOR_MAX_LATITUDE, Math.min(WEB_MERCATOR_MAX_LATITUDE, latitude));
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const xRaw = Math.floor(((longitude + 180) / 360) * n);
  const yRaw = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
  return { x: clamp(xRaw), y: clamp(yRaw) };
}
