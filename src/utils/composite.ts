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
 * `assembleTiles` intentionally does *not* force opacity the way the capture
 * script's single-purpose `fetchOsmBase` does: the outline layer
 * (`Reference_Features_15m`) is transparent by design, and that transparency
 * must survive stitching so `blendOnto` can composite it correctly.
 * Opacity-forcing is the separate, explicit `flattenOpaque`, applied only to
 * the opaque base layer.
 *
 * Composites are **centered on the requested coordinates**, not aligned to a
 * tile boundary. A tile-aligned composite puts the location wherever it
 * happens to fall inside its tile — live testing found a saved location
 * landing 36px from the edge of its own map. So the geometry helpers here
 * (`latLonToGlobalPixel`, `centeredWindowOrigin`, `planTileWindow`) work out
 * a window centered on the point, the covering tiles are assembled with
 * `assembleTiles`, and `cropTo` cuts the exact window out. Output size and
 * zoom are unchanged — only the framing moves.
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
 * Assemble a `cols`×`rows` grid of equally-sized square PNG tiles into one
 * image, preserving each source pixel's alpha unchanged.
 *
 * `tileBuffers` is in **row-major** order (left-to-right, then top-to-bottom).
 * Because every tile is placed at its native resolution there is no
 * resampling — the assembly is pixel-exact.
 */
export function assembleTiles(
  tileBuffers: Buffer[],
  cols: number,
  rows: number,
  tileSize: number
): PNG {
  if (tileBuffers.length !== cols * rows) {
    throw new Error(`Expected ${cols * rows} tiles for a ${cols}x${rows} grid, got ${tileBuffers.length}`);
  }

  const out = new PNG({ width: cols * tileSize, height: rows * tileSize });

  for (let i = 0; i < tileBuffers.length; i++) {
    const tile = PNG.sync.read(tileBuffers[i]);
    const ox = (i % cols) * tileSize;
    const oy = Math.floor(i / cols) * tileSize;

    for (let row = 0; row < tileSize; row++) {
      for (let col = 0; col < tileSize; col++) {
        const s = (row * tileSize + col) * 4;
        const d = ((row + oy) * out.width + (col + ox)) * 4;
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
 * Copy a `width`×`height` rectangle out of `src`, starting at `(x, y)`.
 *
 * This is what lets a composite be centered on a coordinate rather than
 * aligned to a tile boundary: the covering tiles are assembled into a grid
 * that is deliberately larger than the output, then the exact window around
 * the point of interest is cut out of it.
 */
export function cropTo(src: PNG, x: number, y: number, width: number, height: number): PNG {
  if (x < 0 || y < 0 || x + width > src.width || y + height > src.height) {
    throw new Error(
      `Crop ${width}x${height} at (${x}, ${y}) falls outside a ${src.width}x${src.height} image`
    );
  }

  const out = new PNG({ width, height });

  for (let row = 0; row < height; row++) {
    const srcStart = ((row + y) * src.width + x) * 4;
    src.data.copy(out.data, row * width * 4, srcStart, srcStart + width * 4);
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

/** Output pixels per zoom-`z` tile — RainViewer's native 512px radar tile. */
const PIXELS_PER_ZOOM_TILE = 512;

/**
 * Web Mercator pixel edge length of the world at zoom `z`, in the composite
 * path's shared pixel space.
 *
 * Every layer the composite touches lands in **one** pixel space, which is
 * what makes centering tractable: RainViewer serves 512px tiles addressed at
 * zoom `z`, and the GIBS layers serve 256px tiles addressed at zoom `z + 1`.
 * Those describe the identical grid — `2^z` tiles of 512px and `2^(z+1)`
 * tiles of 256px both come to `512 * 2^z` pixels across — so a single global
 * pixel coordinate indexes into both, and only the divisor differs.
 */
export function worldPixelSize(z: number): number {
  return PIXELS_PER_ZOOM_TILE * 2 ** z;
}

/**
 * Web Mercator position of `(lat, lon)` in the shared global pixel space at
 * zoom `z` (see `worldPixelSize`), as fractional pixels from the world's
 * top-left corner.
 *
 * Latitude is clamped to the Mercator-valid range, matching
 * `rainviewer.ts`'s own clamp — the projection is undefined at the poles.
 */
export function latLonToGlobalPixel(lat: number, lon: number, z: number): { gx: number; gy: number } {
  const MAX_LATITUDE = 85.05112878;
  const clampedLat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const world = worldPixelSize(z);

  return {
    gx: world * ((lon + 180) / 360),
    gy: (world * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2,
  };
}

/** A window of the world, in global pixels, and the tiles that cover it. */
export interface TileWindow {
  /** Tile column indices covering the window, west to east (wrapped at the antimeridian). */
  tileXs: number[];
  /** Tile row indices covering the window, north to south. */
  tileYs: number[];
  /** Where the window's top-left sits inside the assembled tile grid. */
  offsetX: number;
  offsetY: number;
}

/**
 * Work out which tiles of edge length `tileSize` cover the `size`×`size`
 * window whose top-left corner is at global pixel `(gx0, gy0)`, and where the
 * window sits within that assembled grid.
 *
 * Columns **wrap** at the antimeridian (the world is cyclic in longitude), so
 * a window straddling ±180° still resolves to real tiles. Rows are not
 * wrapped — the caller is expected to have clamped `gy0` into range already,
 * since there is nothing beyond a pole to show.
 */
export function planTileWindow(
  gx0: number,
  gy0: number,
  size: number,
  tileSize: number,
  z: number
): TileWindow {
  const tilesAcross = worldPixelSize(z) / tileSize;

  const firstCol = Math.floor(gx0 / tileSize);
  const lastCol = Math.floor((gx0 + size - 1) / tileSize);
  const firstRow = Math.floor(gy0 / tileSize);
  const lastRow = Math.floor((gy0 + size - 1) / tileSize);

  const tileXs: number[] = [];
  for (let col = firstCol; col <= lastCol; col++) {
    tileXs.push(((col % tilesAcross) + tilesAcross) % tilesAcross);
  }

  const tileYs: number[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    tileYs.push(row);
  }

  return {
    tileXs,
    tileYs,
    offsetX: gx0 - firstCol * tileSize,
    offsetY: gy0 - firstRow * tileSize,
  };
}

/**
 * Top-left corner of a `size`×`size` window centered on global pixel
 * `(gx, gy)`, with the vertical axis clamped so the window stays inside the
 * world.
 *
 * Horizontal position is left unclamped because longitude wraps
 * (`planTileWindow` handles it); vertical is clamped because a window
 * centered near a pole would otherwise run off the top or bottom of the
 * projection. Near a pole the point is therefore *not* perfectly centered —
 * which is correct: there is no imagery past the edge to center it against.
 */
export function centeredWindowOrigin(
  gx: number,
  gy: number,
  size: number,
  z: number
): { gx0: number; gy0: number } {
  const world = worldPixelSize(z);
  const half = size / 2;

  return {
    gx0: Math.round(gx - half),
    gy0: Math.round(Math.max(0, Math.min(world - size, gy - half))),
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

/**
 * Re-point a RainViewer frame URL at a different tile of the same frame.
 *
 * The frame's timestamp/hash path and its color/options suffix are preserved
 * verbatim — only the tile address is swapped — so a centered window can
 * gather the neighbouring tiles of the very same radar frame rather than
 * recomputing an upstream URL from scratch.
 */
export function buildRadarTileUrl(url: string, z: number, x: number, y: number): string {
  return url.replace(RADAR_TILE_URL_PATTERN, `/512/${z}/${x}/${y}/`);
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
