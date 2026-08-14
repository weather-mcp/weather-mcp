/**
 * Unit tests for the pure PNG compositing utilities in src/utils/composite.ts.
 *
 * All fixture tiles are generated programmatically with pngjs here — no
 * binary fixture files — so the suite stays deterministic and self-contained.
 */

import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import {
  assembleTiles,
  cropTo,
  flattenOpaque,
  blendOnto,
  drawMarker,
  worldPixelSize,
  latLonToGlobalPixel,
  centeredWindowOrigin,
  planTileWindow,
  parseRadarTileUrl,
  buildRadarTileUrl,
  encodePng,
  MAX_COMPOSITE_BYTES,
  type PNG as CompositePNG,
} from '../../src/utils/composite.js';

/** Build a solid-color size×size PNG tile buffer with the given RGBA value. */
function makeSolidTileBuffer(
  size: number,
  rgba: [number, number, number, number]
): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

/** Build a size×size PNG (composite.ts's PNG shape) filled with a solid RGBA value. */
function makeSolidPng(size: number, rgba: [number, number, number, number]): CompositePNG {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return png;
}

function getPixel(png: CompositePNG, x: number, y: number): [number, number, number, number] {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

describe('composite utilities', () => {
  describe('assembleTiles', () => {
    it('places a 2x2 grid of 256px tiles into the correct corners of a 512px image', () => {
      const tl = makeSolidTileBuffer(256, [255, 0, 0, 255]); // red
      const tr = makeSolidTileBuffer(256, [0, 255, 0, 255]); // green
      const bl = makeSolidTileBuffer(256, [0, 0, 255, 255]); // blue
      const br = makeSolidTileBuffer(256, [255, 255, 0, 255]); // yellow

      // Row-major: [TL, TR, BL, BR].
      const result = assembleTiles([tl, tr, bl, br], 2, 2, 256);

      expect(result.width).toBe(512);
      expect(result.height).toBe(512);

      // Sample well inside each quadrant, away from the seams.
      expect(getPixel(result, 10, 10)).toEqual([255, 0, 0, 255]); // TL
      expect(getPixel(result, 400, 10)).toEqual([0, 255, 0, 255]); // TR
      expect(getPixel(result, 10, 400)).toEqual([0, 0, 255, 255]); // BL
      expect(getPixel(result, 400, 400)).toEqual([255, 255, 0, 255]); // BR

      // Exact seam boundary: last TL column/row vs. first TR/BL/BR column/row.
      expect(getPixel(result, 255, 255)).toEqual([255, 0, 0, 255]);
      expect(getPixel(result, 256, 255)).toEqual([0, 255, 0, 255]);
      expect(getPixel(result, 255, 256)).toEqual([0, 0, 255, 255]);
      expect(getPixel(result, 256, 256)).toEqual([255, 255, 0, 255]);
    });

    it('places a non-square 3x2 grid correctly, exercising the cols/rows arithmetic', () => {
      // Row-major over a 3-wide, 2-tall grid, tileSize=100:
      //   [0,0]  [1,0]  [2,0]
      //   [0,1]  [1,1]  [2,1]
      const colors: Array<[number, number, number, number]> = [
        [10, 0, 0, 255], // col0 row0
        [20, 0, 0, 255], // col1 row0
        [30, 0, 0, 255], // col2 row0
        [40, 0, 0, 255], // col0 row1
        [50, 0, 0, 255], // col1 row1
        [60, 0, 0, 255], // col2 row1
      ];
      const tiles = colors.map((c) => makeSolidTileBuffer(100, c));

      const result = assembleTiles(tiles, 3, 2, 100);

      expect(result.width).toBe(300);
      expect(result.height).toBe(200);

      // Sample the center of each of the 6 cells.
      expect(getPixel(result, 50, 50)).toEqual(colors[0]);
      expect(getPixel(result, 150, 50)).toEqual(colors[1]);
      expect(getPixel(result, 250, 50)).toEqual(colors[2]);
      expect(getPixel(result, 50, 150)).toEqual(colors[3]);
      expect(getPixel(result, 150, 150)).toEqual(colors[4]);
      expect(getPixel(result, 250, 150)).toEqual(colors[5]);
    });

    it('preserves alpha through assembly instead of forcing opacity', () => {
      const semiTransparent = makeSolidTileBuffer(256, [100, 150, 200, 64]);
      const opaque = makeSolidTileBuffer(256, [10, 20, 30, 255]);

      const result = assembleTiles([semiTransparent, opaque, opaque, opaque], 2, 2, 256);

      // TL quadrant keeps the source alpha of 64 — not forced to 255.
      expect(getPixel(result, 5, 5)).toEqual([100, 150, 200, 64]);
      // Other quadrants remain fully opaque as supplied.
      expect(getPixel(result, 400, 5)[3]).toBe(255);
    });

    it('throws when the buffer count does not match cols x rows', () => {
      const tile = makeSolidTileBuffer(64, [1, 2, 3, 255]);

      expect(() => assembleTiles([tile, tile, tile], 2, 2, 64)).toThrow(
        /Expected 4 tiles for a 2x2 grid, got 3/
      );
    });
  });

  describe('cropTo', () => {
    it('extracts the right pixels at a non-zero offset', () => {
      // 8x8 source: fill with a distinctive per-pixel pattern so the crop's
      // exact placement can be verified, not just its size.
      const src = new PNG({ width: 8, height: 8 });
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const i = (y * 8 + x) * 4;
          src.data[i] = x * 10;
          src.data[i + 1] = y * 10;
          src.data[i + 2] = 0;
          src.data[i + 3] = 255;
        }
      }

      const cropped = cropTo(src, 2, 3, 4, 4);

      expect(cropped.width).toBe(4);
      expect(cropped.height).toBe(4);
      // cropped(0,0) === src(2,3); cropped(3,3) === src(5,6).
      expect(getPixel(cropped, 0, 0)).toEqual(getPixel(src, 2, 3));
      expect(getPixel(cropped, 3, 3)).toEqual(getPixel(src, 5, 6));
      expect(getPixel(cropped, 1, 2)).toEqual(getPixel(src, 3, 5));
    });

    it('throws when the rectangle exceeds the source bounds', () => {
      const src = makeSolidPng(8, [1, 2, 3, 255]);

      expect(() => cropTo(src, 5, 5, 4, 4)).toThrow(/falls outside/);
      expect(() => cropTo(src, -1, 0, 4, 4)).toThrow(/falls outside/);
    });
  });

  describe('flattenOpaque', () => {
    it('forces alpha to 255 while leaving RGB untouched', () => {
      const png = makeSolidPng(4, [12, 34, 56, 78]);
      // Vary alpha across pixels to confirm every pixel gets forced, not just one.
      png.data[3] = 0;
      png.data[7] = 200;

      flattenOpaque(png);

      for (let i = 0; i < png.data.length; i += 4) {
        expect(png.data[i]).toBe(12);
        expect(png.data[i + 1]).toBe(34);
        expect(png.data[i + 2]).toBe(56);
        expect(png.data[i + 3]).toBe(255);
      }
    });
  });

  describe('blendOnto', () => {
    it('short-circuits and leaves the base pixel untouched when overlay alpha is 0', () => {
      const base = makeSolidPng(1, [10, 20, 30, 255]);
      const overlay = makeSolidPng(1, [200, 200, 200, 0]);

      blendOnto(base, overlay);

      expect(getPixel(base, 0, 0)).toEqual([10, 20, 30, 255]);
    });

    it('replaces the base RGB outright when overlay alpha is 255, leaving base alpha untouched', () => {
      const base = makeSolidPng(1, [10, 20, 30, 200]);
      const overlay = makeSolidPng(1, [200, 150, 100, 255]);

      blendOnto(base, overlay);

      const [r, g, b, a] = getPixel(base, 0, 0);
      expect(r).toBe(200);
      expect(g).toBe(150);
      expect(b).toBe(100);
      expect(a).toBe(200); // base's own alpha is never modified
    });

    it('blends partial alpha using the source-over formula (hand-computed)', () => {
      const base = makeSolidPng(1, [10, 20, 30, 255]);
      const overlay = makeSolidPng(1, [200, 150, 100, 128]);

      blendOnto(base, overlay);

      // a = 128/255 ≈ 0.5019608
      // R = round(200*a + 10*(1-a)) = 105
      // G = round(150*a + 20*(1-a)) = 85
      // B = round(100*a + 30*(1-a)) = 65
      const [r, g, b] = getPixel(base, 0, 0);
      expect(r).toBe(105);
      expect(g).toBe(85);
      expect(b).toBe(65);
    });
  });

  describe('drawMarker', () => {
    it('draws a dark core pixel at the requested center with a light outline nearby', () => {
      const png = makeSolidPng(64, [128, 128, 128, 255]);

      drawMarker(png, 32, 32);

      expect(getPixel(png, 32, 32)).toEqual([10, 10, 10, 255]);
      // A pixel just off the end of one arm should be part of the light outline.
      expect(getPixel(png, 36, 32)).toEqual([255, 255, 255, 255]);
      // Untouched pixel far from the marker keeps the original fill.
      expect(getPixel(png, 0, 0)).toEqual([128, 128, 128, 255]);
    });

    it('clips cleanly at the top-left corner without throwing or wrapping', () => {
      const png = makeSolidPng(64, [0, 0, 0, 255]);

      expect(() => drawMarker(png, 0, 0)).not.toThrow();

      // The center pixel is drawn...
      expect(getPixel(png, 0, 0)).toEqual([10, 10, 10, 255]);
      // ...and nothing wrapped around onto the opposite edge.
      expect(getPixel(png, 63, 63)).toEqual([0, 0, 0, 255]);
      expect(getPixel(png, 63, 0)).toEqual([0, 0, 0, 255]);
      expect(getPixel(png, 0, 63)).toEqual([0, 0, 0, 255]);
    });

    it('clips cleanly at the bottom-right corner without throwing or wrapping', () => {
      const png = makeSolidPng(64, [0, 0, 0, 255]);

      expect(() => drawMarker(png, 63, 63)).not.toThrow();

      expect(getPixel(png, 63, 63)).toEqual([10, 10, 10, 255]);
      expect(getPixel(png, 0, 0)).toEqual([0, 0, 0, 255]);
      expect(getPixel(png, 0, 63)).toEqual([0, 0, 0, 255]);
      expect(getPixel(png, 63, 0)).toEqual([0, 0, 0, 255]);
    });
  });

  describe('worldPixelSize', () => {
    it('is 512 * 2^z', () => {
      expect(worldPixelSize(0)).toBe(512);
      expect(worldPixelSize(6)).toBe(32768);
      expect(worldPixelSize(8)).toBe(131072);
    });
  });

  describe('latLonToGlobalPixel', () => {
    it('places Miami within global pixel space so it falls inside radar tile 6/17/27', () => {
      const { gx, gy } = latLonToGlobalPixel(25.7617, -80.1918, 6);

      // Same underlying Web Mercator math as the tile-relative pixel it
      // replaces — tile index is just the global pixel divided by the tile size.
      expect(Math.floor(gx / 512)).toBe(17);
      expect(Math.floor(gy / 512)).toBe(27);
      expect(gx).toBeCloseTo(9084.76, 1);
      expect(gy).toBeCloseTo(13955.86, 1);
    });

    it('clamps latitude to the Mercator-valid range at the poles', () => {
      const north = latLonToGlobalPixel(90, 0, 6);
      const south = latLonToGlobalPixel(-90, 0, 6);
      const world = worldPixelSize(6);

      // North pole clamps to the top of the world; south pole to the bottom.
      expect(north.gy).toBeCloseTo(0, 3);
      expect(south.gy).toBeCloseTo(world, 3);

      // Beyond the clamp threshold, further latitude makes no difference.
      const furtherNorth = latLonToGlobalPixel(89.9999, 0, 6);
      expect(furtherNorth.gy).toBeCloseTo(north.gy, 6);
    });
  });

  describe('centeredWindowOrigin + latLonToGlobalPixel', () => {
    // The whole point of the rewrite: for an unclamped point, the marker
    // must land exactly at the center of a 512px window.
    const locations: Array<[string, number, number, number]> = [
      ['Miami', 25.7617, -80.1918, 6],
      ['Seattle', 47.6062, -122.3321, 8],
      ['London', 51.5074, -0.1278, 5],
      ['Sydney', -33.8688, 151.2093, 7],
    ];

    it.each(locations)('centers %s exactly at (256, 256) in a 512px window', (_name, lat, lon, z) => {
      const { gx, gy } = latLonToGlobalPixel(lat, lon, z);
      const { gx0, gy0 } = centeredWindowOrigin(gx, gy, 512, z);

      const px = Math.round(gx - gx0);
      const py = Math.round(gy - gy0);

      expect(px).toBe(256);
      expect(py).toBe(256);
    });

    it('pins the window to the top world edge near the north pole, keeping the marker in range', () => {
      const z = 6;
      const { gx, gy } = latLonToGlobalPixel(84.9, 0, z);
      const { gx0, gy0 } = centeredWindowOrigin(gx, gy, 512, z);

      expect(gy0).toBe(0); // pinned to the top, not centered
      const py = Math.round(gy - gy0);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThan(512);
      // Sanity: it's off-center (pulled toward the top), not accidentally centered.
      expect(py).not.toBe(256);

      // Horizontal axis is unaffected by the polar clamp.
      const px = Math.round(gx - gx0);
      expect(px).toBe(256);
    });

    it('pins the window to the bottom world edge near the south pole, keeping the marker in range', () => {
      const z = 6;
      const world = worldPixelSize(z);
      const { gx, gy } = latLonToGlobalPixel(-84.9, 0, z);
      const { gx0, gy0 } = centeredWindowOrigin(gx, gy, 512, z);

      expect(gy0).toBe(world - 512); // pinned to the bottom, not centered
      const py = Math.round(gy - gy0);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThan(512);
      expect(py).not.toBe(256);
    });
  });

  describe('planTileWindow', () => {
    it('resolves a single tile when the window is exactly tile-aligned', () => {
      const window = planTileWindow(1024, 1024, 512, 512, 6);

      expect(window.tileXs).toEqual([2]);
      expect(window.tileYs).toEqual([2]);
      expect(window.offsetX).toBe(0);
      expect(window.offsetY).toBe(0);
    });

    it('resolves a 2x2 tile spread when the window straddles a tile boundary', () => {
      const window = planTileWindow(1124, 1124, 512, 512, 6);

      expect(window.tileXs).toEqual([2, 3]);
      expect(window.tileYs).toEqual([2, 3]);
      expect(window.offsetX).toBe(100);
      expect(window.offsetY).toBe(100);
    });

    it('wraps tile columns at the antimeridian', () => {
      const z = 6;
      const world = worldPixelSize(z);
      // Window's right edge crosses the ±180° seam.
      const window = planTileWindow(world - 100, 0, 512, 512, z);

      expect(window.tileXs).toEqual([63, 0]);
      expect(window.tileYs).toEqual([0]);
      expect(window.offsetX).toBe(412);
    });

    it('does not wrap tile rows even when the window runs past the bottom edge', () => {
      const z = 6;
      const world = worldPixelSize(z);
      const window = planTileWindow(0, world - 100, 512, 512, z);

      // Row 64 is one past the last valid row (0-63) — left unwrapped, unlike columns.
      expect(window.tileYs).toEqual([63, 64]);
      expect(window.tileXs).toEqual([0]);
      expect(window.offsetY).toBe(412);
    });
  });

  describe('parseRadarTileUrl', () => {
    it('parses a valid RainViewer frame URL', () => {
      const url = 'https://tilecache.rainviewer.com/v2/radar/1734000000/512/6/17/27/2/1_1.png';

      expect(parseRadarTileUrl(url)).toEqual({ z: 6, x: 17, y: 27 });
    });

    it('returns null for a non-matching string', () => {
      expect(parseRadarTileUrl('not a url at all')).toBeNull();
      expect(
        parseRadarTileUrl('https://tilecache.rainviewer.com/v2/radar/1734000000/256/6/17/27/2/1_1.png')
      ).toBeNull();
    });

    it('parses the global zoom-4 URL shape', () => {
      const url = 'https://tilecache.rainviewer.com/v2/radar/1734000000/512/4/0/0/2/1_1.png';

      expect(parseRadarTileUrl(url)).toEqual({ z: 4, x: 0, y: 0 });
    });
  });

  describe('buildRadarTileUrl', () => {
    it('swaps the tile address while preserving the frame path and color/options suffix', () => {
      const url = 'https://tilecache.rainviewer.com/v2/radar/1734000000/512/6/17/27/2/1_1.png';

      const swapped = buildRadarTileUrl(url, 6, 18, 28);

      expect(swapped).toBe(
        'https://tilecache.rainviewer.com/v2/radar/1734000000/512/6/18/28/2/1_1.png'
      );
    });

    it('round-trips with parseRadarTileUrl', () => {
      const url = 'https://tilecache.rainviewer.com/v2/radar/1734000000/512/6/17/27/2/1_1.png';

      const swapped = buildRadarTileUrl(url, 7, 34, 55);

      expect(parseRadarTileUrl(swapped)).toEqual({ z: 7, x: 34, y: 55 });
    });
  });

  describe('encodePng', () => {
    it('round-trips through pngjs and stays under MAX_COMPOSITE_BYTES', () => {
      const png = makeSolidPng(512, [50, 100, 150, 255]);

      const encoded = encodePng(png);
      const decoded = PNG.sync.read(encoded);

      expect(decoded.width).toBe(512);
      expect(decoded.height).toBe(512);
      expect(encoded.length).toBeLessThan(MAX_COMPOSITE_BYTES);
    });
  });
});
