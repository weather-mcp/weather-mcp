/**
 * Unit tests for the pure PNG compositing utilities in src/utils/composite.ts.
 *
 * All fixture tiles are generated programmatically with pngjs here — no
 * binary fixture files — so the suite stays deterministic and self-contained.
 */

import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import {
  stitch512,
  flattenOpaque,
  blendOnto,
  drawMarker,
  latLonToTilePixel,
  parseRadarTileUrl,
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
  describe('stitch512', () => {
    it('places four 256px tiles into the correct corners of a 512px image', () => {
      const tl = makeSolidTileBuffer(256, [255, 0, 0, 255]); // red
      const tr = makeSolidTileBuffer(256, [0, 255, 0, 255]); // green
      const bl = makeSolidTileBuffer(256, [0, 0, 255, 255]); // blue
      const br = makeSolidTileBuffer(256, [255, 255, 0, 255]); // yellow

      const result = stitch512([tl, tr, bl, br]);

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

    it('preserves alpha through the stitch instead of forcing opacity', () => {
      const semiTransparent = makeSolidTileBuffer(256, [100, 150, 200, 64]);
      const opaque = makeSolidTileBuffer(256, [10, 20, 30, 255]);

      const result = stitch512([semiTransparent, opaque, opaque, opaque]);

      // TL quadrant keeps the source alpha of 64 — not forced to 255.
      expect(getPixel(result, 5, 5)).toEqual([100, 150, 200, 64]);
      // Other quadrants remain fully opaque as supplied.
      expect(getPixel(result, 400, 5)[3]).toBe(255);
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

  describe('latLonToTilePixel', () => {
    it('places Miami within the bounds of radar tile 6/17/27', () => {
      const { px, py } = latLonToTilePixel(25.7617, -80.1918, 6, 17, 27);

      expect(px).toBeGreaterThanOrEqual(0);
      expect(px).toBeLessThan(512);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThan(512);
      // Sanity-check against an independently computed value, not just bounds.
      expect(px).toBeCloseTo(380.76, 1);
      expect(py).toBeCloseTo(131.86, 1);
    });

    it('places a point outside the given tile outside the [0, size) range', () => {
      // Same location, wrong tile (one column east) — should land off the left edge.
      const { px } = latLonToTilePixel(25.7617, -80.1918, 6, 18, 27);

      expect(px).toBeLessThan(0);
    });

    it('respects a custom tile size', () => {
      const at512 = latLonToTilePixel(25.7617, -80.1918, 6, 17, 27, 512);
      const at256 = latLonToTilePixel(25.7617, -80.1918, 6, 17, 27, 256);

      expect(at256.px).toBeCloseTo(at512.px / 2, 5);
      expect(at256.py).toBeCloseTo(at512.py / 2, 5);
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
