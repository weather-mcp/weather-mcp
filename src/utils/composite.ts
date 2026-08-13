/**
 * Pure PNG compositing utilities — no I/O, no caching, no logging.
 *
 * Ports and generalizes the tile-stitching / alpha-blend logic proven working
 * offline in `scripts/capture-examples.mjs` (`fetchOsmBase` / `blendOnto`,
 * ~lines 314-358) for server-side use: stitching four 256px WMTS tiles into a
 * 512px image, blending a semi-transparent overlay onto a base, and drawing a
 * location marker. See `docs/plans/composited-imagery-plan.md` (D2, D3) and
 * `docs/plans/composited-imagery-implementation-plan.md` ("Findings that shape the
 * graph") for why this shape: the base map is two GIBS layers (an opaque
 * land/water layer and a transparent coastline/border outline layer) blended
 * together, then the radar overlay is blended on top, then a marker is drawn
 * — each step a small, independently testable pure function.
 *
 * `stitch512` intentionally does *not* force opacity the way the capture
 * script's single-purpose `fetchOsmBase` does: the outline layer
 * (`Reference_Features_15m`) is transparent by design, and that transparency
 * must survive stitching so `blendOnto` can composite it correctly.
 * Opacity-forcing is the separate, explicit `flattenOpaque`, applied only to
 * the opaque base layer.
 *
 * `pngjs` is a runtime dependency (pure JS, zero transitive deps — see D5 in
 * the design plan); its types come from the `@types/pngjs` devDependency,
 * since the package itself ships no declarations. `PNG` is re-exported here so
 * the rest of the composite path (`src/services/basemap.ts`, the imagery
 * handler) has a single import site for the image type.
 */

import { PNG } from 'pngjs';

export { PNG };

// ---------------------------------------------------------------------------
// Stitching and blending
// ---------------------------------------------------------------------------

/**
 * Stitch four 256px PNG tile buffers — in **TL, TR, BL, BR** order — into one
 * 512×512 RGBA image, preserving each source pixel's alpha unchanged.
 *
 * The four tiles are expected to be the z+1 web-mercator children of a single
 * parent tile (`(2x, 2y)`, `(2x+1, 2y)`, `(2x, 2y+1)`, `(2x+1, 2y+1)`), so the
 * stitch is pixel-exact with no resampling — the same trick the capture
 * script uses, generalized to any 256px source (opaque or transparent).
 */
export function stitch512(tileBuffers: [Buffer, Buffer, Buffer, Buffer]): PNG {
  const out = new PNG({ width: 512, height: 512 });
  const offsets: Array<[number, number]> = [
    [0, 0], // TL
    [256, 0], // TR
    [0, 256], // BL
    [256, 256], // BR
  ];

  for (let i = 0; i < 4; i++) {
    const tile = PNG.sync.read(tileBuffers[i]);
    const [ox, oy] = offsets[i];
    for (let row = 0; row < 256; row++) {
      for (let col = 0; col < 256; col++) {
        const s = (row * 256 + col) * 4;
        const d = ((row + oy) * 512 + (col + ox)) * 4;
        out.data[d] = tile.data[s];
        out.data[d + 1] = tile.data[s + 1];
        out.data[d + 2] = tile.data[s + 2];
        out.data[d + 3] = tile.data[s + 3];
      }
    }
  }

  return out;
}

/**
 * Force every pixel's alpha channel to 255, in place.
 *
 * Applied only to the opaque land/water base layer after stitching (see
 * module doc comment) — never to the transparent features/outline layer,
 * whose alpha must survive to be blended.
 */
export function flattenOpaque(png: PNG): void {
  for (let i = 3; i < png.data.length; i += 4) {
    png.data[i] = 255;
  }
}

/**
 * Source-over alpha blend of `overlay` onto `base`, in place — verbatim
 * blending arithmetic from `scripts/capture-examples.mjs`'s `blendOnto`
 * (RGB channels only; `base`'s own alpha is never modified, matching the
 * capture script, since every caller blends onto an already-opaque base).
 *
 * Two short-circuits over the plain weighted-average formula, both producing
 * the identical numeric result: a fully transparent overlay pixel (`a === 0`,
 * the common case — most of a radar tile over dry sky, or most of the
 * features layer away from a coastline) is skipped entirely, and a fully
 * opaque overlay pixel (`a === 255`) replaces the base pixel outright.
 */
export function blendOnto(base: PNG, overlay: PNG): void {
  for (let i = 0; i < base.data.length; i += 4) {
    const a = overlay.data[i + 3];
    if (a === 0) continue;

    if (a === 255) {
      base.data[i] = overlay.data[i];
      base.data[i + 1] = overlay.data[i + 1];
      base.data[i + 2] = overlay.data[i + 2];
      continue;
    }

    const alpha = a / 255;
    base.data[i] = Math.round(overlay.data[i] * alpha + base.data[i] * (1 - alpha));
    base.data[i + 1] = Math.round(overlay.data[i + 1] * alpha + base.data[i + 1] * (1 - alpha));
    base.data[i + 2] = Math.round(overlay.data[i + 2] * alpha + base.data[i + 2] * (1 - alpha));
  }
}

// ---------------------------------------------------------------------------
// Location marker
// ---------------------------------------------------------------------------

/** Arm length, in pixels, of the crosshair core in each of the 4 directions. */
const MARKER_ARM_PX = 3;

/** Core pixel color — near-black, reads clearly over both light and dark imagery. */
const MARKER_CORE_RGB: readonly [number, number, number] = [10, 10, 10];

/** Outline pixel color — near-white, keeps the dark core legible over dark radar/base pixels. */
const MARKER_OUTLINE_RGB: readonly [number, number, number] = [255, 255, 255];

/** Center pixel plus one arm of `MARKER_ARM_PX` pixels in each cardinal direction, relative to the marker's center. */
function markerCoreOffsets(): Array<[number, number]> {
  const offsets: Array<[number, number]> = [[0, 0]];
  for (let d = 1; d <= MARKER_ARM_PX; d++) {
    offsets.push([d, 0], [-d, 0], [0, d], [0, -d]);
  }
  return offsets;
}

/**
 * A 1px halo surrounding `core` — every 8-neighbor of a core offset that is
 * not itself a core offset — so the crosshair keeps a light border on every
 * side regardless of what's underneath.
 */
function markerOutlineOffsets(core: Array<[number, number]>): Array<[number, number]> {
  const coreSet = new Set(core.map(([dx, dy]) => `${dx},${dy}`));
  const outline = new Map<string, [number, number]>();
  const deltas = [-1, 0, 1];

  for (const [dx, dy] of core) {
    for (const ddx of deltas) {
      for (const ddy of deltas) {
        if (ddx === 0 && ddy === 0) continue;
        const nx = dx + ddx;
        const ny = dy + ddy;
        const key = `${nx},${ny}`;
        if (!coreSet.has(key)) outline.set(key, [nx, ny]);
      }
    }
  }

  return [...outline.values()];
}

const MARKER_CORE_OFFSETS = markerCoreOffsets();
const MARKER_OUTLINE_OFFSETS = markerOutlineOffsets(MARKER_CORE_OFFSETS);

/**
 * Draw a small high-contrast crosshair — a dark plus-shaped core with a 1px
 * light outline — centered at pixel `(px, py)`, in place.
 *
 * The outline exists so the marker reads over both light base-map pixels and
 * dark radar-echo pixels; drawing the outline first and the core second means
 * the two never visually conflict at their shared boundary. Offsets that fall
 * outside `png`'s bounds are skipped individually (not the whole marker) —
 * clipped cleanly at an image edge, never wrapped onto the opposite edge.
 */
export function drawMarker(png: PNG, px: number, py: number): void {
  const setPixel = (x: number, y: number, rgb: readonly [number, number, number]): void => {
    if (x < 0 || x >= png.width || y < 0 || y >= png.height) return;
    const i = (y * png.width + x) * 4;
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  };

  for (const [dx, dy] of MARKER_OUTLINE_OFFSETS) setPixel(px + dx, py + dy, MARKER_OUTLINE_RGB);
  for (const [dx, dy] of MARKER_CORE_OFFSETS) setPixel(px + dx, py + dy, MARKER_CORE_RGB);
}

// ---------------------------------------------------------------------------
// Tile geometry
// ---------------------------------------------------------------------------

/**
 * Web Mercator position of `(lat, lon)` within the tile at `(z, x, y)`, in
 * pixels from the tile's top-left corner.
 *
 * `size` is the pixel edge length of the tile *addressing scheme* being used
 * — the RainViewer/GIBS composite path addresses tiles as 512px (see
 * `parseRadarTileUrl`), where `z, x, y` is the same web-mercator tile grid as
 * standard 256px slippy-map tiles one zoom level higher (a "512px tile at
 * zoom z" covers exactly the area of the four 256px children at zoom z+1
 * that `stitch512` assembles it from), just addressed with `size` pixels
 * instead of 256. The caller is expected to have already resolved `(z, x,
 * y)` from the tile that actually contains the point (e.g. via
 * `parseRadarTileUrl` on the frame the point was requested against); this
 * function does no bounds validation of its own and simply projects — a
 * point outside the given tile returns coordinates outside `[0, size)`.
 */
export function latLonToTilePixel(
  lat: number,
  lon: number,
  z: number,
  x: number,
  y: number,
  size = 512
): { px: number; py: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;

  const xTile = n * ((lon + 180) / 360);
  const yTile = (n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2;

  return {
    px: (xTile - x) * size,
    py: (yTile - y) * size,
  };
}

/** `/512/{z}/{x}/{y}/` — the tile address RainViewer embeds in its frame URLs. */
const RADAR_TILE_URL_PATTERN = /\/512\/(\d+)\/(\d+)\/(\d+)\//;

/**
 * Parse the `z/x/y` web-mercator tile address out of a RainViewer frame tile
 * URL (`…/512/{z}/{x}/{y}/{color}/{options}.png`) — the same regex proven in
 * `scripts/capture-examples.mjs`. Returns `null` on any URL that doesn't
 * carry this shape (a malformed or unexpected upstream URL), so the caller
 * can degrade to text-only output instead of throwing.
 */
export function parseRadarTileUrl(url: string): { z: number; x: number; y: number } | null {
  const match = url.match(RADAR_TILE_URL_PATTERN);
  if (!match) return null;
  return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** Synchronously encode a `PNG` image back to its binary representation. */
export function encodePng(png: PNG): Buffer {
  return PNG.sync.write(png);
}

/**
 * Defense-in-depth cap on an encoded composite's size, in bytes. Live-measured
 * real-world composites (base + features + radar, 512×512) run 24-91 KB
 * (`docs/plans/composited-imagery-plan.md`); this cap sits roughly an order of
 * magnitude above that measured maximum, so it never constrains normal
 * output but still catches a pathological encode before it's base64'd and
 * returned as an MCP image content block.
 */
export const MAX_COMPOSITE_BYTES = 1_000_000;
