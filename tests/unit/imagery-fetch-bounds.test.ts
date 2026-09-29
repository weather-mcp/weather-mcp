/**
 * Fetch-site contracts for composited imagery (imagery-fetch-bounds T6).
 *
 * Real singletons and the real handler run end to end; only the network is
 * faked, on the three seams the pipeline uses:
 *   - bare `axios.get`                       (handler `fetchRadarTile`)
 *   - `rainViewerService.client.get`         (RainViewer feed) or, for the
 *     origin contract, `getPrecipitationRadar` (below T1's ingestion layer)
 *   - `basemapService.client.get`            (GIBS tiles)
 * Every test stubs the basemap client, so no live GIBS call is ever made.
 *
 * Each test uses its own coordinate, hence its own GIBS tile addresses, so the
 * `basemapService` singleton's tile cache carries no state from one test into
 * the next (the contract-4 test relies on the cache being empty for its point).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import { PNG } from 'pngjs';
import {
  handleGetWeatherImagery,
  RADAR_TILE_REQUEST_CONFIG
} from '../../src/handlers/weatherImageryHandler.js';
import { rainViewerService } from '../../src/services/rainviewer.js';
import { basemapService } from '../../src/services/basemap.js';
import { logger } from '../../src/utils/logger.js';
import { RADAR_TILE_MAX_BYTES, BASEMAP_TILE_MAX_BYTES } from '../../src/utils/composite.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ImageryContentBlock, ImageryFrame } from '../../src/types/imagery.js';

const UNUSED = {} as never;

type TextBlock = Extract<ImageryContentBlock, { type: 'text' }>;

/** The fixed note the handler appends when compositing fails (not exported). */
const NOTE_TEXT = 'Composite map unavailable for this request';

function solidTile(size: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

const BASE_TILE = solidTile(256, [40, 90, 180, 255]);
const FEATURES_TILE = solidTile(256, [20, 20, 20, 120]);
const RADAR_TILE_512 = solidTile(512, [0, 200, 255, 160]);
const RADAR_TILE_256 = solidTile(256, [0, 200, 255, 160]);
const BAD_GIBS_TILE_128 = solidTile(128, [40, 90, 180, 255]);

// Distinct point per test (see file header).
const P_ORIGIN = { latitude: 25.7617, longitude: -80.1918 }; // Miami
const P_CONFIG = { latitude: 47.6062, longitude: -122.3321 }; // Seattle
const P_WRONG_SIZE = { latitude: 39.7392, longitude: -104.9903 }; // Denver
const P_NOT_CACHED = { latitude: 41.8781, longitude: -87.6298 }; // Chicago
const P_OPTIONAL_404 = { latitude: 33.4484, longitude: -112.074 }; // Phoenix

const TAIL = '/v2/radar/x/512/6/17/27/2/1_1.png';

function feedFrame(): { time: number; path: string } {
  return { time: Math.floor(Date.now() / 1000) - 300, path: '/v2/radar/1700000000' };
}

type Client = { get: (...a: unknown[]) => Promise<unknown>; defaults: Record<string, unknown> };

/** Valid one-frame RainViewer feed on the real singleton's client. */
function stubFeed(): void {
  const f = feedFrame();
  vi.spyOn((rainViewerService as unknown as { client: Client }).client, 'get')
    .mockResolvedValue({
      data: {
        version: '2.0',
        generated: f.time,
        host: 'https://tilecache.rainviewer.com',
        radar: { past: [f] }
      },
      status: 200
    });
}

const basemapClient = (): Client =>
  (basemapService as unknown as { client: Client }).client;
const basemapCache = (): { get: (k: string) => unknown } =>
  (basemapService as unknown as { cache: { get: (k: string) => unknown } }).cache;

function notFound(): Error {
  return Object.assign(new Error('Request failed with status code 404'), {
    isAxiosError: true,
    response: { status: 404, data: '' }
  });
}

/** Stub GIBS: valid tiles, optionally a hook that may override the answer. */
function stubBasemap(
  override?: (url: string, layer: 'base' | 'features') => Buffer | Error | undefined
): ReturnType<typeof vi.fn> {
  const spy = vi.spyOn(basemapClient(), 'get').mockImplementation(async (...args: unknown[]) => {
    const url = args[0] as string;
    const layer = url.includes('OSM_Land_Water_Map')
      ? 'base'
      : url.includes('Reference_Features_15m')
        ? 'features'
        : undefined;
    if (!layer) throw new Error(`Unexpected GIBS URL in stub: ${url}`);
    const o = override?.(url, layer);
    if (o instanceof Error) throw o;
    return { data: o ?? (layer === 'base' ? BASE_TILE : FEATURES_TILE), status: 200 };
  });
  return spy as unknown as ReturnType<typeof vi.fn>;
}

async function run(point: { latitude: number; longitude: number }): Promise<{ content: ImageryContentBlock[] }> {
  const result = await handleGetWeatherImagery(
    { ...point, type: 'precipitation', composite: true },
    UNUSED as LocationStore,
    UNUSED as GeocodingService
  );
  return result as never;
}

const textOf = (r: { content: ImageryContentBlock[] }): string => (r.content[0] as TextBlock).text;
const hasImage = (r: { content: ImageryContentBlock[] }): boolean =>
  r.content.some((b) => b.type === 'image');

describe('imagery fetch-site contracts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. radar tile origin is refused and never requested', () => {
    const hostile = [
      `https://tilecache.rainviewer.com@127.0.0.1${TAIL}`,
      `http://tilecache.rainviewer.com${TAIL}`,
      `https://tilecache.rainviewer.com:8443${TAIL}`,
      `https://evil.example${TAIL}`,
      `https://tilecache.rainviewer.com.evil.example${TAIL}`
    ];

    it.each(hostile)('%s', async (hostileUrl) => {
      const frame: ImageryFrame = { url: hostileUrl, timestamp: new Date(Date.now() - 300_000) };
      vi.spyOn(rainViewerService, 'getPrecipitationRadar').mockResolvedValue([frame]);
      stubBasemap();
      const axiosGet = vi.spyOn(axios, 'get').mockResolvedValue({ data: RADAR_TILE_512, status: 200 });
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = await run(P_ORIGIN);

      expect(axiosGet).not.toHaveBeenCalled();
      expect(textOf(result).endsWith(`*${NOTE_TEXT} — the tile URLs and interactive-map link above still apply.*\n`)).toBe(true);
      expect(hasImage(result)).toBe(false);

      const security = warn.mock.calls.filter(
        (c) => (c[1] as { securityEvent?: boolean } | undefined)?.securityEvent === true
      );
      // One per covering radar tile of the window (1-4), all the origin refusal.
      expect(security.length).toBeGreaterThanOrEqual(1);
      for (const c of security) {
        expect((c[1] as { reason?: string }).reason).toBe('origin');
      }
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain('127.0.0.1');
      expect(logged).not.toContain('evil');
    });
  });

  it('2. every radar tile fetch passes RADAR_TILE_REQUEST_CONFIG itself (positive control: the composite succeeds)', async () => {
    stubFeed();
    stubBasemap();
    const axiosGet = vi.spyOn(axios, 'get').mockResolvedValue({ data: RADAR_TILE_512, status: 200 });

    const result = await run(P_CONFIG);

    expect(hasImage(result)).toBe(true);
    expect(textOf(result)).toContain('**Composited map attached:**');
    expect(axiosGet.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of axiosGet.mock.calls) {
      expect(call[1]).toBe(RADAR_TILE_REQUEST_CONFIG);
    }
    expect(RADAR_TILE_REQUEST_CONFIG.maxRedirects).toBe(0);
    expect(RADAR_TILE_REQUEST_CONFIG.maxContentLength).toBe(RADAR_TILE_MAX_BYTES);
  });

  it('3. a wrong-size radar tile degrades to the note with no image', async () => {
    stubFeed();
    stubBasemap();
    vi.spyOn(axios, 'get').mockResolvedValue({ data: RADAR_TILE_256, status: 200 });
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const result = await run(P_WRONG_SIZE);

    expect(textOf(result)).toContain(NOTE_TEXT);
    expect(hasImage(result)).toBe(false);
  });

  it('4. a refused GIBS tile is never cached and is fetched again', async () => {
    stubFeed();
    vi.spyOn(axios, 'get').mockResolvedValue({ data: RADAR_TILE_512, status: 200 });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    // First call: the first base-layer address requested answers a 128 px PNG.
    let badUrl: string | undefined;
    stubBasemap((url, layer) => {
      if (layer !== 'base') return undefined;
      badUrl ??= url;
      return url === badUrl ? BAD_GIBS_TILE_128 : undefined;
    });

    const first = await run(P_NOT_CACHED);
    expect(badUrl).toBeDefined();
    expect(textOf(first)).toContain(NOTE_TEXT);
    expect(hasImage(first)).toBe(false);

    // The refusal surfaces as the header error itself, not a wrapped fetch failure.
    const errors = warn.mock.calls.map((c) => (c[1] as { error?: string } | undefined)?.error ?? '');
    expect(errors.some((e) => e.includes('is not a 256px non-interlaced PNG'))).toBe(true);
    expect(errors.some((e) => e.includes('fetch failed'))).toBe(false);

    const [, z, y, x] = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(badUrl!)!;
    const key = `OSM_Land_Water_Map/${z}/${y}/${x}`;
    expect(basemapCache().get(key)).toBeUndefined();

    // Second call at the same point: the address is requested again and now succeeds.
    vi.restoreAllMocks();
    stubFeed();
    vi.spyOn(axios, 'get').mockResolvedValue({ data: RADAR_TILE_512, status: 200 });
    const client = stubBasemap();

    const second = await run(P_NOT_CACHED);

    const requested = client.mock.calls.filter((c) => c[0] === badUrl).length;
    expect(requested).toBe(1);
    expect(hasImage(second)).toBe(true);
  });

  it('5. a 404 on the optional features layer still composites', async () => {
    stubFeed();
    vi.spyOn(axios, 'get').mockResolvedValue({ data: RADAR_TILE_512, status: 200 });
    stubBasemap((_url, layer) => (layer === 'features' ? notFound() : undefined));

    const result = await run(P_OPTIONAL_404);

    expect(hasImage(result)).toBe(true);
    expect(textOf(result)).toContain('**Composited map attached:**');
  });

  it('6. the basemap client refuses redirects and caps the body', () => {
    const defaults = basemapClient().defaults;
    expect(defaults.maxRedirects).toBe(0);
    expect(defaults.maxContentLength).toBe(BASEMAP_TILE_MAX_BYTES);
  });
});
