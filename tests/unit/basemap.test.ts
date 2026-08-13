/**
 * Unit tests for BasemapService (src/services/basemap.ts).
 *
 * Mocks axios so no real network calls are made. Fixture tiles are tiny
 * solid-color 256px PNGs generated programmatically with pngjs (no binary
 * fixtures), following the pattern in tests/unit/composite.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PNG } from 'pngjs';

const { mockGet, mockCreate } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    create: (...args: unknown[]) => {
      mockCreate(...args);
      return {
        get: (...getArgs: unknown[]) => mockGet(...getArgs),
      };
    },
  },
}));

import { BasemapService } from '../../src/services/basemap.js';

/** Build a solid-color size×size PNG tile buffer with the given RGBA value. */
function makeSolidTileBuffer(size: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

function getPixel(png: PNG, x: number, y: number): [number, number, number, number] {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const BASE_LAYER_NAME = 'OSM_Land_Water_Map';
const BASE_MATRIX_SET = 'GoogleMapsCompatible_Level9';
const FEATURES_LAYER_NAME = 'Reference_Features_15m';
const FEATURES_MATRIX_SET = 'GoogleMapsCompatible_Level13';

/** Build the expected WMTS REST URL — path order is {z}/{row=y}/{col=x}. */
function tileUrl(layer: string, matrixSet: string, z: number, x: number, y: number): string {
  return `${GIBS_BASE}/${layer}/default/${matrixSet}/${z}/${y}/${x}.png`;
}

// Miami radar tile (6/17/27, per the plan's live fixtures) — z+1 = 7 children,
// TL/TR/BL/BR order.
const Z = 6;
const X = 17;
const Y = 27;
const CHILD_Z = 7;
const CHILDREN: Array<[number, number]> = [
  [34, 54], // TL
  [35, 54], // TR
  [34, 55], // BL
  [35, 55], // BR
];

const BLUE: [number, number, number, number] = [0, 0, 255, 255]; // base fill
const GREEN: [number, number, number, number] = [0, 200, 0, 255]; // opaque feature pixel
const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0]; // no feature here

/** Build the full 8-URL -> buffer map for the default happy-path fixture. */
function buildTileMap(): Map<string, Buffer> {
  const map = new Map<string, Buffer>();

  CHILDREN.forEach(([cx, cy], i) => {
    map.set(
      tileUrl(BASE_LAYER_NAME, BASE_MATRIX_SET, CHILD_Z, cx, cy),
      makeSolidTileBuffer(256, BLUE)
    );
    // Only the TL feature child is opaque; the rest are fully transparent.
    map.set(
      tileUrl(FEATURES_LAYER_NAME, FEATURES_MATRIX_SET, CHILD_Z, cx, cy),
      makeSolidTileBuffer(256, i === 0 ? GREEN : TRANSPARENT)
    );
  });

  return map;
}

function mockGetFromMap(map: Map<string, Buffer>): void {
  mockGet.mockImplementation((url: string) => {
    const buf = map.get(url);
    if (!buf) {
      return Promise.reject(new Error(`unexpected tile URL requested in test: ${url}`));
    }
    return Promise.resolve({ data: buf });
  });
}

describe('BasemapService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockCreate.mockClear();
  });

  describe('request shape', () => {
    it('requests both layers at their own matrix set, correct z/y/x path order, and correct z+1 child addresses', async () => {
      mockGetFromMap(buildTileMap());
      const service = new BasemapService();

      await service.getBaseComposite(Z, X, Y);

      const requestedUrls = mockGet.mock.calls.map(call => call[0] as string);
      expect(requestedUrls).toHaveLength(8);

      for (const [cx, cy] of CHILDREN) {
        expect(requestedUrls).toContain(tileUrl(BASE_LAYER_NAME, BASE_MATRIX_SET, CHILD_Z, cx, cy));
        expect(requestedUrls).toContain(
          tileUrl(FEATURES_LAYER_NAME, FEATURES_MATRIX_SET, CHILD_Z, cx, cy)
        );
      }

      // Path order is {z}/{row=y}/{col=x} — y appears before x in the path.
      for (const url of requestedUrls) {
        expect(url).toMatch(new RegExp(`/${CHILD_Z}/\\d+/\\d+\\.png$`));
      }

      // Every request used arraybuffer response type.
      for (const call of mockGet.mock.calls) {
        expect(call[1]).toEqual(expect.objectContaining({ responseType: 'arraybuffer' }));
      }
    });

    it('uses a descriptive User-Agent following the METAR precedent', () => {
      new BasemapService();

      const [config] = mockCreate.mock.calls[mockCreate.mock.calls.length - 1] as [
        { headers?: Record<string, string> }
      ];
      expect(config.headers?.['User-Agent']).toMatch(
        /^weather-mcp\/.+\(\+https:\/\/github\.com\/weather-mcp\/weather-mcp\)$/
      );
    });
  });

  describe('compositing', () => {
    it('returns a 512×512 PNG with the features layer visible over the base', async () => {
      mockGetFromMap(buildTileMap());
      const service = new BasemapService();

      const result = await service.getBaseComposite(Z, X, Y);

      expect(result.width).toBe(512);
      expect(result.height).toBe(512);

      // TL quadrant: feature layer was opaque green there — replaces the base.
      expect(getPixel(result, 10, 10)).toEqual(GREEN);

      // TR/BL/BR quadrants: feature layer was fully transparent — base blue shows through.
      expect(getPixel(result, 400, 10)).toEqual(BLUE); // TR
      expect(getPixel(result, 10, 400)).toEqual(BLUE); // BL
      expect(getPixel(result, 400, 400)).toEqual(BLUE); // BR
    });
  });

  describe('caching', () => {
    it('serves all 8 tiles from cache on a second call for the same tile', async () => {
      mockGetFromMap(buildTileMap());
      const service = new BasemapService();

      await service.getBaseComposite(Z, X, Y);
      expect(mockGet).toHaveBeenCalledTimes(8);

      await service.getBaseComposite(Z, X, Y);
      expect(mockGet).toHaveBeenCalledTimes(8); // no additional HTTP round
    });

    it('does not share cache entries across distinct tiles', async () => {
      const map = buildTileMap();
      // Also serve the neighboring tile's children with the same fixtures
      // (values don't matter for this test, only call counts).
      const otherChildren: Array<[number, number]> = [
        [36, 54],
        [37, 54],
        [36, 55],
        [37, 55],
      ];
      otherChildren.forEach(([cx, cy]) => {
        map.set(tileUrl(BASE_LAYER_NAME, BASE_MATRIX_SET, CHILD_Z, cx, cy), makeSolidTileBuffer(256, BLUE));
        map.set(
          tileUrl(FEATURES_LAYER_NAME, FEATURES_MATRIX_SET, CHILD_Z, cx, cy),
          makeSolidTileBuffer(256, TRANSPARENT)
        );
      });
      mockGetFromMap(map);
      const service = new BasemapService();

      await service.getBaseComposite(Z, X, Y);
      await service.getBaseComposite(Z, X + 1, Y);

      expect(mockGet).toHaveBeenCalledTimes(16);
    });
  });

  describe('failure handling', () => {
    it('rejects and returns no composite when one of the 8 tile fetches fails', async () => {
      const map = buildTileMap();
      mockGet.mockImplementation((url: string) => {
        if (url === tileUrl(BASE_LAYER_NAME, BASE_MATRIX_SET, CHILD_Z, CHILDREN[0][0], CHILDREN[0][1])) {
          return Promise.reject(new Error('simulated network failure'));
        }
        const buf = map.get(url);
        if (!buf) {
          return Promise.reject(new Error(`unexpected tile URL requested in test: ${url}`));
        }
        return Promise.resolve({ data: buf });
      });
      const service = new BasemapService();

      await expect(service.getBaseComposite(Z, X, Y)).rejects.toThrow();
    });

    it('throws a plain Error, not a custom ApiError subclass', async () => {
      mockGet.mockImplementation(() => Promise.reject(new Error('boom')));
      const service = new BasemapService();

      let caught: unknown;
      try {
        await service.getBaseComposite(Z, X, Y);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught?.constructor.name).toBe('Error');
    });
  });
});
