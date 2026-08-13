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

const { mockGetBaseComposite } = vi.hoisted(() => ({ mockGetBaseComposite: vi.fn() }));
vi.mock('../../src/services/basemap.js', () => ({
  basemapService: {
    getBaseComposite: (...args: unknown[]) => mockGetBaseComposite(...args),
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
import { latLonToTilePixel, MAX_COMPOSITE_BYTES } from '../../src/utils/composite.js';

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

function defaultOverlayBuffer(): Buffer {
  return PNG.sync.write(makeSolidPng(512, 512, TRANSPARENT_OVERLAY));
}

function decodeImageBlock(data: string): PNG {
  return PNG.sync.read(Buffer.from(data, 'base64'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  mockAxiosGet.mockReset();
  mockAxiosGet.mockResolvedValue({ data: defaultOverlayBuffer() });

  mockGetPrecipitationRadar.mockReset();

  mockGetBaseComposite.mockReset();
  mockGetBaseComposite.mockImplementation(() => Promise.resolve(makeSolidPng(512, 512, BASE_COLOR)));

  mockEncodePng.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get_weather_imagery composite branch', () => {
  it('composite: true on precipitation returns exactly [text, image] with a 512×512 PNG', async () => {
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
    expect(mockGetBaseComposite).not.toHaveBeenCalled();
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

    // Only one composite round — one overlay fetch, one basemap call.
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockAxiosGet).toHaveBeenCalledWith(
      frames[2].url,
      expect.objectContaining({ responseType: 'arraybuffer' })
    );
    expect(mockGetBaseComposite).toHaveBeenCalledTimes(1);

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

    expect(mockGetBaseComposite).not.toHaveBeenCalled();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('basemap failure degrades to text-only output with the unavailable note, without throwing', async () => {
    const frame = makeFrame('basemap-fail-1', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);
    mockGetBaseComposite.mockRejectedValueOnce(new Error('simulated basemap failure'));

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

  it('draws the marker at the requested coordinates: near-black core, near-white outline', async () => {
    const frame = makeFrame('marker-1', -5);
    mockGetPrecipitationRadar.mockResolvedValue([frame]);

    const result = await handleGetWeatherImagery(
      { latitude: MIAMI.latitude, longitude: MIAMI.longitude, type: 'precipitation', composite: true },
      locationStore,
      geocodingService
    );

    const imageBlock = result.content[1] as { type: 'image'; data: string; mimeType: string };
    const decoded = decodeImageBlock(imageBlock.data);

    const { px, py } = latLonToTilePixel(MIAMI.latitude, MIAMI.longitude, TILE.z, TILE.x, TILE.y);
    const cx = Math.round(px);
    const cy = Math.round(py);

    const pixelAt = (x: number, y: number): [number, number, number] => {
      const i = (y * decoded.width + x) * 4;
      return [decoded.data[i], decoded.data[i + 1], decoded.data[i + 2]];
    };

    // Marker core: the requested coordinates themselves — near-black.
    const [cr, cg, cb] = pixelAt(cx, cy);
    expect(cr).toBeLessThan(30);
    expect(cg).toBeLessThan(30);
    expect(cb).toBeLessThan(30);

    // Marker outline: just past the 3px core arm — near-white, not the base-map fill.
    const [or_, og, ob] = pixelAt(cx + 4, cy);
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

    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockGetBaseComposite).toHaveBeenCalledTimes(1);

    const firstImage = first.content[1] as { type: 'image'; data: string };
    const secondImage = second.content[1] as { type: 'image'; data: string };
    expect(secondImage.data).toBe(firstImage.data);
  });
});
