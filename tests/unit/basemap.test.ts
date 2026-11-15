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
    // Mirrors real axios: the service uses this to tell an HTTP status
    // rejection from any other kind of failure.
    isAxiosError: (error: unknown) =>
      Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
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

// Radar zoom (the getBaseWindow `z` argument); GIBS tiles are fetched one
// zoom level in, at 256px, per the module doc comment.
const Z = 6;
const CHILD_Z = 7;

// A window whose top-left corner is exactly tile-aligned (offsetX/offsetY
// both 0) needs only a 2x2 grid of 256px tiles to cover a 512px window.
// gx0=8704 (=34*256), gy0=13824 (=54*256) — the same Miami-area tile
// neighborhood (6/17/27 radar tile) the previous whole-tile test used.
const WINDOW_2X2 = { gx0: 8704, gy0: 13824, size: 512 };
const CHILDREN_2X2: Array<[number, number]> = [
  [34, 54], // TL
  [35, 54], // TR
  [34, 55], // BL
  [35, 55], // BR
];

// A window offset by 100px from tile alignment in both axes straddles a
// third tile in each direction, needing a 3x3 grid.
const WINDOW_3X3 = { gx0: 8804, gy0: 13924, size: 512 };
const CHILDREN_3X3: Array<[number, number]> = [
  [34, 54], [35, 54], [36, 54],
  [34, 55], [35, 55], [36, 55],
  [34, 56], [35, 56], [36, 56],
];
// offsetX === offsetY === 100 for WINDOW_3X3 (derived from planTileWindow).

const BLUE: [number, number, number, number] = [0, 0, 255, 255]; // base fill
const GREEN: [number, number, number, number] = [0, 200, 0, 255]; // opaque feature pixel
const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0]; // no feature here

/**
 * Build the URL -> buffer map for a set of child tile addresses. The tile at
 * `greenIndex` gets an opaque green features layer; every other tile's
 * features layer is fully transparent. The base layer is solid blue
 * throughout.
 */
function buildTileMap(children: Array<[number, number]>, greenIndex: number): Map<string, Buffer> {
  const map = new Map<string, Buffer>();

  children.forEach(([cx, cy], i) => {
    map.set(
      tileUrl(BASE_LAYER_NAME, BASE_MATRIX_SET, CHILD_Z, cx, cy),
      makeSolidTileBuffer(256, BLUE)
    );
    map.set(
      tileUrl(FEATURES_LAYER_NAME, FEATURES_MATRIX_SET, CHILD_Z, cx, cy),
      makeSolidTileBuffer(256, i === greenIndex ? GREEN : TRANSPARENT)
    );
  });

  return map;
}

/** An axios-shaped rejection carrying an HTTP status, as the real client produces. */
function axiosStatusError(status: number): Error & { isAxiosError: true; response: { status: number } } {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true as const,
    response: { status },
  });
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
      mockGetFromMap(buildTileMap(CHILDREN_2X2, 0));
      const service = new BasemapService();

      await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);

      const requestedUrls = mockGet.mock.calls.map(call => call[0] as string);
      expect(requestedUrls).toHaveLength(8);

      for (const [cx, cy] of CHILDREN_2X2) {
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

    it('requests a 3x3 grid of tiles at zoom z+1 for a window straddling tile boundaries', async () => {
      mockGetFromMap(buildTileMap(CHILDREN_3X3, 0));
      const service = new BasemapService();

      await service.getBaseWindow(Z, WINDOW_3X3.gx0, WINDOW_3X3.gy0, WINDOW_3X3.size);

      const requestedUrls = mockGet.mock.calls.map(call => call[0] as string);
      expect(requestedUrls).toHaveLength(18); // 9 tiles x 2 layers

      for (const [cx, cy] of CHILDREN_3X3) {
        expect(requestedUrls).toContain(tileUrl(BASE_LAYER_NAME, BASE_MATRIX_SET, CHILD_Z, cx, cy));
        expect(requestedUrls).toContain(
          tileUrl(FEATURES_LAYER_NAME, FEATURES_MATRIX_SET, CHILD_Z, cx, cy)
        );
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
    it('returns a 512x512 PNG with the features layer visible over the base for a tile-aligned (2x2) window', async () => {
      mockGetFromMap(buildTileMap(CHILDREN_2X2, 0));
      const service = new BasemapService();

      const result = await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);

      expect(result.width).toBe(512);
      expect(result.height).toBe(512);

      // offsetX/offsetY are both 0 for this window, so the crop is a no-op:
      // the assembled grid maps directly onto the output.
      // TL quadrant: feature layer was opaque green there — replaces the base.
      expect(getPixel(result, 10, 10)).toEqual(GREEN);
      // TR/BL/BR quadrants: feature layer was fully transparent — base blue shows through.
      expect(getPixel(result, 400, 10)).toEqual(BLUE); // TR
      expect(getPixel(result, 10, 400)).toEqual(BLUE); // BL
      expect(getPixel(result, 400, 400)).toEqual(BLUE); // BR
    });

    it('crops correctly out of a larger assembled grid for a straddling (3x3) window', async () => {
      // Only the tile covering the window's top-left corner (index 0, tile
      // 34/54) is green; every other tile is transparent.
      mockGetFromMap(buildTileMap(CHILDREN_3X3, 0));
      const service = new BasemapService();

      const result = await service.getBaseWindow(Z, WINDOW_3X3.gx0, WINDOW_3X3.gy0, WINDOW_3X3.size);

      expect(result.width).toBe(512);
      expect(result.height).toBe(512);

      // Output (0,0) maps to assembled-grid pixel (offsetX, offsetY) = (100,
      // 100), which sits inside the green top-left tile (34,54).
      expect(getPixel(result, 0, 0)).toEqual(GREEN);
      // Output (511,511) maps to assembled-grid pixel (611, 611), which sits
      // inside the bottom-right tile (36,56) — transparent, so base blue
      // shows through. This is only possible because the crop actually cuts
      // the window out of the larger 768x768 assembled grid.
      expect(getPixel(result, 511, 511)).toEqual(BLUE);
    });
  });

  describe('caching', () => {
    it('serves all tiles from cache on a second call for the same window', async () => {
      mockGetFromMap(buildTileMap(CHILDREN_2X2, 0));
      const service = new BasemapService();

      await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);
      expect(mockGet).toHaveBeenCalledTimes(8);

      await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);
      expect(mockGet).toHaveBeenCalledTimes(8); // no additional HTTP round
    });

    it('does not share cache entries across windows covering distinct tiles', async () => {
      const map = buildTileMap(CHILDREN_2X2, 0);
      // A window shifted far enough that it needs entirely different tiles
      // (38/39 x 54/55 instead of 34/35 x 54/55).
      const shiftedChildren: Array<[number, number]> = [
        [38, 54], [39, 54], [38, 55], [39, 55],
      ];
      shiftedChildren.forEach(([cx, cy]) => {
        map.set(tileUrl(BASE_LAYER_NAME, BASE_MATRIX_SET, CHILD_Z, cx, cy), makeSolidTileBuffer(256, BLUE));
        map.set(
          tileUrl(FEATURES_LAYER_NAME, FEATURES_MATRIX_SET, CHILD_Z, cx, cy),
          makeSolidTileBuffer(256, TRANSPARENT)
        );
      });
      mockGetFromMap(map);
      const service = new BasemapService();

      await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);
      await service.getBaseWindow(Z, WINDOW_2X2.gx0 + 1024, WINDOW_2X2.gy0, WINDOW_2X2.size);

      expect(mockGet).toHaveBeenCalledTimes(16);
    });
  });

  describe('failure handling', () => {
    it('rejects and returns no partial base map when one tile fetch fails', async () => {
      const map = buildTileMap(CHILDREN_2X2, 0);
      mockGet.mockImplementation((url: string) => {
        if (url === tileUrl(BASE_LAYER_NAME, BASE_MATRIX_SET, CHILD_Z, CHILDREN_2X2[0][0], CHILDREN_2X2[0][1])) {
          return Promise.reject(new Error('simulated network failure'));
        }
        const buf = map.get(url);
        if (!buf) {
          return Promise.reject(new Error(`unexpected tile URL requested in test: ${url}`));
        }
        return Promise.resolve({ data: buf });
      });
      const service = new BasemapService();

      await expect(
        service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size)
      ).rejects.toThrow();
    });

    it('tolerates a 404 on the optional features layer, rendering the base map without outlines', async () => {
      // GIBS serves no Reference_Features_15m tile where there is nothing to
      // draw (observed live at extreme polar rows). Losing decorative
      // outlines must not cost the whole map.
      const map = buildTileMap(CHILDREN_2X2, 0);
      const missing = tileUrl(
        FEATURES_LAYER_NAME,
        FEATURES_MATRIX_SET,
        CHILD_Z,
        CHILDREN_2X2[0][0],
        CHILDREN_2X2[0][1]
      );
      mockGet.mockImplementation((url: string) => {
        if (url === missing) {
          return Promise.reject(axiosStatusError(404));
        }
        const buf = map.get(url);
        return buf
          ? Promise.resolve({ data: buf })
          : Promise.reject(new Error(`unexpected tile URL requested in test: ${url}`));
      });
      const service = new BasemapService();

      const result = await service.getBaseWindow(
        Z,
        WINDOW_2X2.gx0,
        WINDOW_2X2.gy0,
        WINDOW_2X2.size
      );

      expect(result.width).toBe(512);
      expect(result.height).toBe(512);
      // The absent features tile covers the top-left quadrant: base blue
      // shows through instead of the green feature pixel it would have had.
      expect(getPixel(result, 10, 10)).toEqual(BLUE);
    });

    it('still rejects when the REQUIRED base layer 404s', async () => {
      const map = buildTileMap(CHILDREN_2X2, 0);
      const missing = tileUrl(
        BASE_LAYER_NAME,
        BASE_MATRIX_SET,
        CHILD_Z,
        CHILDREN_2X2[0][0],
        CHILDREN_2X2[0][1]
      );
      mockGet.mockImplementation((url: string) => {
        if (url === missing) {
          return Promise.reject(axiosStatusError(404));
        }
        const buf = map.get(url);
        return buf
          ? Promise.resolve({ data: buf })
          : Promise.reject(new Error(`unexpected tile URL requested in test: ${url}`));
      });
      const service = new BasemapService();

      await expect(
        service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size)
      ).rejects.toThrow(/OSM_Land_Water_Map/);
    });

    it('still rejects on a non-404 features-layer failure, so a bad matrix set fails loudly', async () => {
      // A wrong tile matrix set returns 400 InvalidParameterValue, not 404 —
      // that must never be swallowed into a silently outline-less map.
      const map = buildTileMap(CHILDREN_2X2, 0);
      const badTile = tileUrl(
        FEATURES_LAYER_NAME,
        FEATURES_MATRIX_SET,
        CHILD_Z,
        CHILDREN_2X2[0][0],
        CHILDREN_2X2[0][1]
      );
      mockGet.mockImplementation((url: string) => {
        if (url === badTile) {
          return Promise.reject(axiosStatusError(400));
        }
        const buf = map.get(url);
        return buf
          ? Promise.resolve({ data: buf })
          : Promise.reject(new Error(`unexpected tile URL requested in test: ${url}`));
      });
      const service = new BasemapService();

      await expect(
        service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size)
      ).rejects.toThrow(/Reference_Features_15m/);
    });

    it('throws a plain Error, not a custom ApiError subclass', async () => {
      mockGet.mockImplementation(() => Promise.reject(new Error('boom')));
      const service = new BasemapService();

      let caught: unknown;
      try {
        await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught?.constructor.name).toBe('Error');
    });
  });
});

// ---------------------------------------------------------------------------
// fetchTile cache admission (appended; nothing above this line was changed).
// ---------------------------------------------------------------------------

import { BASEMAP_TILE_CACHE_MAX_BYTES } from '../../src/utils/composite.js';

const ADMISSION_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = ADMISSION_CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** length | type | data | crc */
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A valid 256 px tile of exactly `totalBytes`, padded by an ancillary pAdd chunk after IHDR (offset 33). */
function tileOfExactSize(totalBytes: number): Buffer {
  const base = makeSolidTileBuffer(256, BLUE);
  const padLength = totalBytes - base.length - 12;
  if (padLength < 0) throw new Error('target smaller than the base tile');
  const out = Buffer.concat([
    base.subarray(0, 33),
    chunk('pAdd', Buffer.alloc(padLength)),
    base.subarray(33),
  ]);
  expect(out.length).toBe(totalBytes);
  return out;
}

function tileWithSecondIhdr(): Buffer {
  const base = makeSolidTileBuffer(256, BLUE);
  const data = Buffer.alloc(13);
  data.writeUInt32BE(4096, 0);
  data.writeUInt32BE(4096, 4);
  data[8] = 8;
  data[9] = 6;
  return Buffer.concat([base.subarray(0, 33), chunk('IHDR', data), base.subarray(33)]);
}

/** Every address of the 2x2 window answers `buffer` (both layers). */
function uniformMap(buffer: Buffer): Map<string, Buffer> {
  const map = new Map<string, Buffer>();
  for (const [cx, cy] of CHILDREN_2X2) {
    map.set(tileUrl(BASE_LAYER_NAME, BASE_MATRIX_SET, CHILD_Z, cx, cy), buffer);
    map.set(tileUrl(FEATURES_LAYER_NAME, FEATURES_MATRIX_SET, CHILD_Z, cx, cy), buffer);
  }
  return map;
}

function requestCount(url: string): number {
  return mockGet.mock.calls.filter((call) => call[0] === url).length;
}

describe('fetchTile cache admission', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockCreate.mockClear();
  });

  const [tlX, tlY] = CHILDREN_2X2[0];
  const baseTl = tileUrl(BASE_LAYER_NAME, BASE_MATRIX_SET, CHILD_Z, tlX, tlY);
  const featuresTl = tileUrl(FEATURES_LAYER_NAME, FEATURES_MATRIX_SET, CHILD_Z, tlX, tlY);

  it('pins the cache-admission size at the literal 32,768 bytes', () => {
    expect(BASEMAP_TILE_CACHE_MAX_BYTES).toBe(32_768);
  });

  it('caches a tile of exactly 32,768 bytes: one request per address across two calls', async () => {
    mockGetFromMap(uniformMap(tileOfExactSize(32_768)));
    const service = new BasemapService();

    await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);
    await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);

    expect(mockGet).toHaveBeenCalledTimes(8);
    expect(requestCount(baseTl)).toBe(1);
    expect(requestCount(featuresTl)).toBe(1);
  });

  it('uses but does not cache a tile of 32,769 bytes: a second call requests every address again', async () => {
    mockGetFromMap(uniformMap(tileOfExactSize(32_769)));
    const service = new BasemapService();

    const first = await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);
    expect(first.width).toBe(512);
    const second = await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);
    expect(second.width).toBe(512);

    expect(mockGet).toHaveBeenCalledTimes(16);
    expect(requestCount(baseTl)).toBe(2);
    expect(requestCount(featuresTl)).toBe(2);
  });

  it('never caches a tile with a second IHDR: it is refused and requested again', async () => {
    const map = uniformMap(makeSolidTileBuffer(256, BLUE));
    map.set(baseTl, tileWithSecondIhdr());
    mockGetFromMap(map);
    const service = new BasemapService();

    await expect(
      service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size)
    ).rejects.toThrow('Tile is not a 256px non-interlaced PNG');
    await expect(
      service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size)
    ).rejects.toThrow('Tile is not a 256px non-interlaced PNG');

    expect(requestCount(baseTl)).toBe(2);
  });

  it('still caches the optional-layer 404 placeholder: no new request for that address', async () => {
    const map = uniformMap(makeSolidTileBuffer(256, BLUE));
    mockGet.mockImplementation((url: string) => {
      if (url === featuresTl) return Promise.reject(axiosStatusError(404));
      const buf = map.get(url);
      return buf
        ? Promise.resolve({ data: buf })
        : Promise.reject(new Error(`unexpected tile URL requested in test: ${url}`));
    });
    const service = new BasemapService();

    await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);
    await service.getBaseWindow(Z, WINDOW_2X2.gx0, WINDOW_2X2.gy0, WINDOW_2X2.size);

    expect(requestCount(featuresTl)).toBe(1);
    expect(mockGet).toHaveBeenCalledTimes(8);
  });
});
