/**
 * Unit tests for the `composite` branch of get_weather_imagery
 * (`handleGetWeatherImagery` in src/handlers/weatherImageryHandler.ts).
 *
 * `tests/unit/imagery-handler.test.ts` covers `getWeatherImagery` and
 * `formatWeatherImageryResponse` in isolation and is the no-change guarantee
 * for requests that don't ask for a composite — it stays untouched. This
 * file exercises the handler's composite wrapping specifically: the
 * `[text, image]` content-block shape, the degradation paths (no frame,
 * basemap failure, oversize encode), the animated/satellite special cases,
 * the marker draw, the attribution text, and the module-level composite
 * cache.
 *
 * Everything is mocked — the rainviewer service, the basemap service, and
 * the overlay-tile fetch (axios) — with fixture PNG tiles generated
 * programmatically via pngjs (no binary fixtures, no live network calls).
 *
 * Composites are now **centered on the requested coordinates** rather than
 * aligned to a whole map tile (`src/utils/composite.ts`, `centeredWindowOrigin`),
 * so the handler fetches the 1-4 radar tiles of the *same frame* that cover a
 * 512x512 window around the point (`fetchRadarWindow` / `buildRadarTileUrl`)
 * instead of a single fetch of `frame.url`, and the basemap service exposes
 * `getBaseWindow(z, gx0, gy0, size)` instead of a tile-addressed
 * `getBaseComposite(z, x, y)`. The mocks below reflect that: `mockAxiosGet`
 * answers any radar tile URL (URL-agnostic by default), and call counts are
 * asserted against the real covering-tile count computed from the same pure
 * geometry helpers the handler itself calls, rather than a hardcoded "1".
 *
 * `compositeCache` (src/handlers/weatherImageryHandler.ts) is module-level
 * and persists for the lifetime of this file's module registry, so every
 * test other than the deliberate cache-hit test uses a distinct radar frame
 * URL (via `radarUrl(id)`) to keep its cache key unique.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PNG } from 'pngjs';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ImageryFrame } from '../../src/types/imagery.js';

// ---------------------------------------------------------------------------
// Mocks (hoisted so they're referenceable from both vi.mock factories and
// individual tests)
// ---------------------------------------------------------------------------

const { mockAxiosGet } = vi.hoisted(() => ({ mockAxiosGet: vi.fn() }));
vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
  },
}));

const { mockGetPrecipitationRadar } = vi.hoisted(() => ({
  mockGetPrecipitationRadar: vi.fn(),
}));
vi.mock('../../src/services/rainviewer.js', () => ({
  rainViewerService: {
    getPrecipitationRadar: (...args: unknown[]) => mockGetPrecipitationRadar(...args),
  },
}));

const { mockGetBaseWindow } = vi.hoisted(() => ({ mockGetBaseWindow: vi.fn() }));
vi.mock('../../src/services/basemap.js', () => ({
  basemapService: {
    getBaseWindow: (...args: unknown[]) => mockGetBaseWindow(...args),
  },
}));

// Partial mock: everything from composite.ts is real (pure math, drawing,
// stitching) except `encodePng`, which is wrapped so the oversize-encode
// degradation path can be exercised deterministically without needing an
// actually-huge fixture image.
const { mockEncodePng } = vi.hoisted(() => ({ mockEncodePng: vi.fn() }));
vi.mock('../../src/utils/composite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/composite.js')>();
  mockEncodePng.mockImplementation(actual.encodePng);
  return {
    ...actual,
    encodePng: (png: PNG) => mockEncodePng(png),
  };
});

import {
  handleGetWeatherImagery,
  getWeatherImagery,
  formatWeatherImageryResponse,
} from '../../src/handlers/weatherImageryHandler.js';
import {
  MAX_COMPOSITE_BYTES,
  parseRadarTileUrl,
  latLonToGlobalPixel,
  centeredWindowOrigin,
  planTileWindow,
} from '../../src/utils/composite.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fake stores — every test supplies coordinates directly, so resolveLocationAsync never touches these. */
const locationStore = {} as unknown as LocationStore;
const geocodingService = {} as unknown as GeocodingService;

/** Frozen "now" so latestObservedFrame's observed/future split and generatedAt are deterministic. */
const NOW = new Date('2024-06-01T12:00:00Z');

/** Miami — the tile/coords combination spot-checked live in T4 (progress tracker). */
const MIAMI = { latitude: 25.7617, longitude: -80.1918 };
const TILE = { z: 6, x: 17, y: 27 };

/** Build a RainViewer-shaped frame URL carrying the fixed TILE address, distinguished by `id` for cache-key uniqueness across tests. */
function radarUrl(id: string): string {
  return `https://tilecache.rainviewer.com/v2/radar/${id}/512/${TILE.z}/${TILE.x}/${TILE.y}/2/1_1.png`;
}

function makeFrame(id: string, offsetMinutesFromNow: number, description = 'Test frame'): ImageryFrame {
  return {
    url: radarUrl(id),
    timestamp: new Date(NOW.getTime() + offsetMinutesFromNow * 60_000),
    description,
  };
}

/** Solid-color size×size PNG, generated in-memory (no binary fixtures). */
function makeSolidPng(width: number, height: number, rgba: [number, number, number, number]): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return png;
}

/** Opaque base-map fill so the marker overwrite is unambiguous against it. */
const BASE_COLOR: [number, number, number, number] = [40, 120, 180, 255];
/** Fully transparent overlay — most of a real radar tile is transparent sky, and leaves the base color untouched wherever there's no marker. */
const TRANSPARENT_OVERLAY: [number, number, number, number] = [0, 0, 0, 0];

/** Edge length of a composited map / RainViewer's native radar tile, in pixels — mirrors the handler's own private `COMPOSITE_SIZE` / `RADAR_TILE_PIXELS` constants (both 512). */
const COMPOSITE_SIZE = 512;
const RADAR_TILE_PIXELS = 512;

/**
 * The exact radar-tile window the handler computes for MIAMI at the frame's
 * zoom — derived from the same pure geometry functions the handler itself
 * calls (`latLonToGlobalPixel` → `centeredWindowOrigin` → `planTileWindow`),
 * so these tests assert against the real math rather than a hardcoded guess.
 * A centered window rarely lines up with the tile grid, so MIAMI's window
 * covers more than one tile — that's the common case post-centering, not a
 * special one.
 */
const MIAMI_RADAR_WINDOW = (() => {
  const parsed = parseRadarTileUrl(radarUrl('geometry-probe'));
  if (!parsed) throw new Error('geometry probe URL failed to parse — fixture regressed');
  const { z } = parsed;
  const { gx, gy } = latLonToGlobalPixel(MIAMI.latitude, MIAMI.longitude, z);
  const { gx0, gy0 } = centeredWindowOrigin(gx, gy, COMPOSITE_SIZE, z);
  const window = planTileWindow(gx0, gy0, COMPOSITE_SIZE, RADAR_TILE_PIXELS, z);
  return { z, gx0, gy0, ...window };
})();

/** Number of distinct radar tiles the handler must fetch to cover MIAMI's centered window. */
const RADAR_TILE_COUNT = MIAMI_RADAR_WINDOW.tileXs.length * MIAMI_RADAR_WINDOW.tileYs.length;

function defaultOverlayBuffer(): Buffer {
  return PNG.sync.write(makeSolidPng(RADAR_TILE_PIXELS, RADAR_TILE_PIXELS, TRANSPARENT_OVERLAY));
}

function decodeImageBlock(data: string): PNG {
  return PNG.sync.read(Buffer.from(data, 'base64'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  mockAxiosGet.mockReset();
  // URL-agnostic by default: the handler now issues 1-4 distinct radar-tile
  // requests per composite (the covering tiles of a centered window), not
  // one fetch of the exact frame URL — every one of them gets this fixture.
  mockAxiosGet.mockResolvedValue({ data: defaultOverlayBuffer() });

  mockGetPrecipitationRadar.mockReset();

  mockGetBaseWindow.mockReset();
  mockGetBaseWindow.mockImplementation(() => Promise.resolve(makeSolidPng(COMPOSITE_SIZE, COMPOSITE_SIZE, BASE_COLOR)));

  mockEncodePng.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get_weather_imagery composite branch', () => {
  it('composite: true on precipitation returns exactly [text, image] with a 512×512 PNG, centered on the requested window', async () => {
    const frame = makeFrame('basic-1', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);

    const result = await handleGetWeatherImagery(
      { latitude: MIAMI.latitude, longitude: MIAMI.longitude, type: 'precipitation', composite: true },
      locationStore,
      geocodingService
    );

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });

    const imageBlock = result.content[1] as { type: 'image'; data: string; mimeType: string };
    const decoded = decodeImageBlock(imageBlock.data);
    expect(decoded.width).toBe(512);
    expect(decoded.height).toBe(512);

    // The basemap window is centered on the same global pixel as the radar
    // window — both derive from one `centeredWindowOrigin` call in the handler.
    expect(mockGetBaseWindow).toHaveBeenCalledWith(
      MIAMI_RADAR_WINDOW.z,
      MIAMI_RADAR_WINDOW.gx0,
      MIAMI_RADAR_WINDOW.gy0,
      COMPOSITE_SIZE
    );
  });

  it('omitted composite returns a byte-identical text-only response to the pre-branch formatter', async () => {
    const frame = makeFrame('nochange-1', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);

    const params = {
      latitude: MIAMI.latitude,
      longitude: MIAMI.longitude,
      type: 'precipitation' as const,
      animated: false,
    };
    const expectedResponse = await getWeatherImagery(params);
    const expectedText = formatWeatherImageryResponse(expectedResponse, 'standard');

    const result = await handleGetWeatherImagery(
      { latitude: MIAMI.latitude, longitude: MIAMI.longitude, type: 'precipitation' },
      locationStore,
      geocodingService
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: 'text', text: expectedText });
    // No composite side effects on the omitted path.
    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(mockGetBaseWindow).not.toHaveBeenCalled();
  });

  it('composite: false returns the same byte-identical text-only response as omitted', async () => {
    const frame = makeFrame('nochange-2', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);

    const params = {
      latitude: MIAMI.latitude,
      longitude: MIAMI.longitude,
      type: 'precipitation' as const,
      animated: false,
    };
    const expectedResponse = await getWeatherImagery(params);
    const expectedText = formatWeatherImageryResponse(expectedResponse, 'standard');

    const result = await handleGetWeatherImagery(
      { latitude: MIAMI.latitude, longitude: MIAMI.longitude, type: 'precipitation', composite: false },
      locationStore,
      geocodingService
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: 'text', text: expectedText });
  });

  it('animated + composite composites only the latest observed frame and notes the animation stays URL-based', async () => {
    const frames: ImageryFrame[] = [
      makeFrame('anim-1', -30, 'Frame 1'),
      makeFrame('anim-2', -20, 'Frame 2'),
      makeFrame('anim-3', -10, 'Frame 3'), // latest observed (<= now)
      makeFrame('anim-4', 10, 'Nowcast 1'), // future — must be ignored
      makeFrame('anim-5', 20, 'Nowcast 2'), // future — must be ignored
    ];
    mockGetPrecipitationRadar.mockResolvedValue(frames);

    const result = await handleGetWeatherImagery(
      {
        latitude: MIAMI.latitude,
        longitude: MIAMI.longitude,
        type: 'precipitation',
        animated: true,
        composite: true,
      },
      locationStore,
      geocodingService
    );

    expect(result.content).toHaveLength(2);
    const text = (result.content[0] as { type: 'text'; text: string }).text;

    // Only one composite round: the covering radar tiles of the latest
    // observed frame's window (1-4, MIAMI's straddles more than one), and one
    // basemap window fetch — not one per animation frame.
    expect(mockAxiosGet).toHaveBeenCalledTimes(RADAR_TILE_COUNT);
    for (const [url] of mockAxiosGet.mock.calls) {
      expect(url as string).toMatch(/\/512\/\d+\/\d+\/\d+\//);
    }
    expect(mockGetBaseWindow).toHaveBeenCalledTimes(1);

    // The attached-composite line names the latest *observed* frame specifically
    // (the animation-frames list above it legitimately lists all 5 frames,
    // including the future nowcast ones, so this checks the composite note's
    // own line rather than the text as a whole).
    expect(text).toContain(
      `**Composited map attached:** radar frame ${frames[2].timestamp.toISOString()} at zoom`
    );

    expect(text).toContain(
      'The animation frames above stay URL-based — only the latest frame is composited.'
    );
  });

  it('satellite + composite adds a note, no image block, and never calls the basemap service', async () => {
    const result = await handleGetWeatherImagery(
      { latitude: MIAMI.latitude, longitude: MIAMI.longitude, type: 'satellite', composite: true },
      locationStore,
      geocodingService
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('composite rendering is available for radar/precipitation only');

    expect(mockGetBaseWindow).not.toHaveBeenCalled();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('basemap failure degrades to text-only output with the unavailable note, without throwing', async () => {
    const frame = makeFrame('basemap-fail-1', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);
    mockGetBaseWindow.mockRejectedValueOnce(new Error('simulated basemap failure'));

    const result = await handleGetWeatherImagery(
      { latitude: MIAMI.latitude, longitude: MIAMI.longitude, type: 'precipitation', composite: true },
      locationStore,
      geocodingService
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Composite map unavailable for this request');
  });

  it('an over-cap encode degrades to text-only output with the unavailable note', async () => {
    const frame = makeFrame('oversize-1', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);
    mockEncodePng.mockReturnValueOnce(Buffer.alloc(MAX_COMPOSITE_BYTES + 1));

    const result = await handleGetWeatherImagery(
      { latitude: MIAMI.latitude, longitude: MIAMI.longitude, type: 'precipitation', composite: true },
      locationStore,
      geocodingService
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Composite map unavailable for this request');
  });

  it('centers the marker at the image center (256, 256): near-black core, near-white outline', async () => {
    const frame = makeFrame('marker-1', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);

    const result = await handleGetWeatherImagery(
      { latitude: MIAMI.latitude, longitude: MIAMI.longitude, type: 'precipitation', composite: true },
      locationStore,
      geocodingService
    );

    const imageBlock = result.content[1] as { type: 'image'; data: string; mimeType: string };
    const decoded = decodeImageBlock(imageBlock.data);

    // Headline assertion of the centering change: a composite centered on the
    // requested coordinates always places the marker at the image's exact
    // center for a non-polar point, replacing the old tile-relative
    // `latLonToTilePixel` math (removed — see src/utils/composite.ts).
    const CENTER = 256;

    const pixelAt = (x: number, y: number): [number, number, number] => {
      const i = (y * decoded.width + x) * 4;
      return [decoded.data[i], decoded.data[i + 1], decoded.data[i + 2]];
    };

    // Marker core: dead center of the composite — near-black.
    const [cr, cg, cb] = pixelAt(CENTER, CENTER);
    expect(cr).toBeLessThan(30);
    expect(cg).toBeLessThan(30);
    expect(cb).toBeLessThan(30);

    // Marker outline: just past the 3px core arm — near-white, not the base-map fill.
    const [or_, og, ob] = pixelAt(CENTER + 4, CENTER);
    expect(or_).toBeGreaterThan(225);
    expect(og).toBeGreaterThan(225);
    expect(ob).toBeGreaterThan(225);
  });

  it('includes both the RainViewer and NASA GIBS/ESDIS attribution lines', async () => {
    const frame = makeFrame('attrib-1', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);

    const result = await handleGetWeatherImagery(
      { latitude: MIAMI.latitude, longitude: MIAMI.longitude, type: 'precipitation', composite: true },
      locationStore,
      geocodingService
    );

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Radar imagery © RainViewer.');
    expect(text).toContain(
      "Imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)."
    );
  });

  it('a repeated identical composite request hits the cache: one fetch/basemap round total', async () => {
    const frame = makeFrame('cache-1', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);

    const args = {
      latitude: MIAMI.latitude,
      longitude: MIAMI.longitude,
      type: 'precipitation' as const,
      composite: true,
    };

    const first = await handleGetWeatherImagery(args, locationStore, geocodingService);
    const second = await handleGetWeatherImagery(args, locationStore, geocodingService);

    // Radar-tile fetches happen only on the first (uncached) call.
    expect(mockAxiosGet).toHaveBeenCalledTimes(RADAR_TILE_COUNT);
    expect(mockGetBaseWindow).toHaveBeenCalledTimes(1);

    const firstImage = first.content[1] as { type: 'image'; data: string };
    const secondImage = second.content[1] as { type: 'image'; data: string };
    expect(secondImage.data).toBe(firstImage.data);
  });

  it('a centered window straddling a radar tile boundary is correctly assembled and cropped from multiple tiles', async () => {
    const frame = makeFrame('straddle-1', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);

    // Sanity: this test only exercises the multi-tile path if MIAMI's
    // centered window genuinely straddles the radar tile grid — which is the
    // common case post-centering, but assert it explicitly so a future
    // geometry change that happens to land MIAMI back on a tile boundary
    // fails loudly here instead of silently testing nothing.
    expect(RADAR_TILE_COUNT).toBeGreaterThan(1);

    /** Deterministic, fully opaque per-tile color so assembly + crop position is directly visible in the output pixels. */
    const colorForTile = (tx: number, ty: number): [number, number, number, number] => [
      (tx * 37) % 256,
      (ty * 61) % 256,
      90,
      255,
    ];

    mockAxiosGet.mockImplementation((url: unknown) => {
      const match = (url as string).match(/\/512\/(\d+)\/(\d+)\/(\d+)\//);
      if (!match) {
        return Promise.reject(new Error(`unexpected radar tile URL in straddle test: ${String(url)}`));
      }
      const [, , x, y] = match;
      const png = makeSolidPng(RADAR_TILE_PIXELS, RADAR_TILE_PIXELS, colorForTile(Number(x), Number(y)));
      return Promise.resolve({ data: PNG.sync.write(png) });
    });

    const result = await handleGetWeatherImagery(
      { latitude: MIAMI.latitude, longitude: MIAMI.longitude, type: 'precipitation', composite: true },
      locationStore,
      geocodingService
    );

    const imageBlock = result.content[1] as { type: 'image'; data: string; mimeType: string };
    const decoded = decodeImageBlock(imageBlock.data);
    expect(decoded.width).toBe(512);
    expect(decoded.height).toBe(512);

    const pixelAt = (x: number, y: number): [number, number, number, number] => {
      const i = (y * decoded.width + x) * 4;
      return [decoded.data[i], decoded.data[i + 1], decoded.data[i + 2], decoded.data[i + 3]];
    };

    // The crop's top-left corner sits inside the first covering tile, and its
    // bottom-right corner sits inside the last covering tile (opaque radar
    // pixels fully replace the base map, per `blendOnto`'s alpha===255
    // shortcut) — so these corners are a direct readout of `assembleTiles` +
    // `cropTo` having placed each tile at the right offset.
    const firstTile = { x: MIAMI_RADAR_WINDOW.tileXs[0], y: MIAMI_RADAR_WINDOW.tileYs[0] };
    const lastTile = {
      x: MIAMI_RADAR_WINDOW.tileXs[MIAMI_RADAR_WINDOW.tileXs.length - 1],
      y: MIAMI_RADAR_WINDOW.tileYs[MIAMI_RADAR_WINDOW.tileYs.length - 1],
    };

    expect(pixelAt(0, 0)).toEqual(colorForTile(firstTile.x, firstTile.y));
    expect(pixelAt(511, 511)).toEqual(colorForTile(lastTile.x, lastTile.y));

    // And it really did take multiple distinct tile fetches to build this.
    const urls = mockAxiosGet.mock.calls.map(([url]) => url as string);
    expect(new Set(urls).size).toBe(RADAR_TILE_COUNT);
  });
});
