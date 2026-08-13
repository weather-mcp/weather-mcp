/**
 * Integration tests for composited weather imagery (`composite: true` on
 * `get_weather_imagery`), per docs/composited-imagery-implementation-plan.md
 * T6.
 *
 * *** THIS FILE MAKES LIVE NETWORK CALLS in its second `describe` block
 * (real RainViewer + real NASA GIBS fetches) and can flake independently of
 * any code change — see the "Gate caveat (standing)" note in
 * docs/composited-imagery-implementation-plan.md and the project's "Flaky
 * live-network tests" memory. If the gate goes red only in this file's live
 * block, re-run once before suspecting the diff. This is now the **seventh**
 * live-network integration file — joining visualization-lightning.test.ts,
 * safety-hazards.test.ts, global-rivers.test.ts, almanac.test.ts,
 * error-recovery.test.ts, and metar.test.ts. ***
 *
 * Block 1 (mocked, deterministic) stubs only the HTTP layer — the three
 * axios call sites the composite pipeline touches: the bare `axios.get` the
 * handler's own `fetchRadarTile` uses for the radar overlay tile,
 * `rainViewerService`'s private axios client (the `/public/weather-maps.json`
 * feed), and `basemapService`'s private axios client (the 8 GIBS tile
 * fetches) — via `vi.spyOn`, following the instance/method-scoped spy
 * convention in tests/integration/metar.test.ts and
 * tests/integration/global-rivers.test.ts rather than a module-level
 * `vi.mock('axios')`. A file-wide axios mock would also swallow the live
 * calls Block 2 needs to make, so this file scopes each spy to one
 * client/method instead, and restores all three (`afterEach`) before Block 2
 * runs. The result: the *real* `BasemapService` singleton, the *real*
 * `RainViewerService` singleton, and the real handler run fully end to end —
 * only the network is faked.
 *
 * Fixture PNG tiles are generated programmatically with pngjs (no binary
 * fixtures), matching the pattern in tests/unit/basemap.test.ts and
 * tests/unit/composite.test.ts. Block 1's two tests use different locations
 * (Miami vs. Seattle — different z/x/y tile addresses) so their GIBS tile
 * fetches never collide with `basemapService`'s own internal tile cache,
 * which is a module singleton and therefore persists across tests within
 * this file.
 *
 * Block 2 (live smoke) makes real calls to RainViewer and NASA GIBS for one
 * location and only asserts the returned image block decodes to a
 * structurally valid 512×512 PNG. Per the tolerant-of-flake convention used
 * throughout this project's live integration tests: the network call itself
 * is wrapped so a connectivity/upstream failure (a thrown error, or the
 * handler's own graceful degrade-to-text-only path when compositing fails
 * live) is logged and the test passes without asserting anything. Only a
 * *successful* image response that is structurally wrong — the wrong
 * dimensions, an undecodable PNG — is allowed to fail the test, since that
 * indicates a real bug rather than network flake.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import { PNG } from 'pngjs';
import { handleGetWeatherImagery } from '../../src/handlers/weatherImageryHandler.js';
import { rainViewerService } from '../../src/services/rainviewer.js';
import { basemapService } from '../../src/services/basemap.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { RainViewerResponse, ImageryContentBlock } from '../../src/types/imagery.js';

/**
 * Dummy LocationStore/GeocodingService — never touched when latitude and
 * longitude are supplied directly, since `resolveLocationAsync`'s
 * coordinate branch short-circuits before either is used (mirrors the
 * `UNUSED` convention in tests/integration/metar.test.ts and
 * tests/integration/global-rivers.test.ts).
 */
const UNUSED = {} as never;

type TextBlock = Extract<ImageryContentBlock, { type: 'text' }>;
type ImageBlock = Extract<ImageryContentBlock, { type: 'image' }>;

/** Build a solid-color size×size RGBA PNG buffer — same generator shape used across the composite test suites. */
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

/** Opaque land/water base tile fill — the 256px children `stitch512` assembles for `BASE_LAYER`. */
const BASE_TILE = makeSolidTileBuffer(256, [40, 90, 180, 255]);
/** Semi-transparent features/outline tile fill — alpha must survive `stitch512` + `blendOnto` (see composite.ts). */
const FEATURES_TILE = makeSolidTileBuffer(256, [20, 20, 20, 120]);
/** Radar overlay tile — fetched directly as a single 512px tile, no stitching. */
const RADAR_TILE = makeSolidTileBuffer(512, [0, 200, 255, 160]);

/** A single-frame RainViewer feed timestamped a few minutes ago, so it is always the "latest observed frame" (see latestObservedFrame in the handler). */
function buildRainViewerFeed(): RainViewerResponse {
  const time = Math.floor(Date.now() / 1000) - 300; // 5 minutes ago
  return {
    version: '2.0',
    generated: time,
    host: 'https://tilecache.rainviewer.com',
    radar: {
      past: [{ time, path: '/v2/radar/1700000000' }]
    }
  };
}

/** Stub the RainViewer feed fetch on the real singleton's private axios client. */
function stubRainViewerFeed(): void {
  vi.spyOn((rainViewerService as any).client, 'get').mockResolvedValue({
    data: buildRainViewerFeed(),
    status: 200
  });
}

/**
 * Stub the GIBS tile fetches on the real `basemapService` singleton's
 * private axios client — routes each request to the base or features fixture
 * by layer name in the URL. When `failUrlSubstring` is given, any request
 * whose URL contains it rejects with an axios-shaped 400
 * `InvalidParameterValue` error (the real failure mode documented in the
 * plan's Findings for a wrong tile matrix set), so `Promise.all` in
 * `getBaseComposite` rejects and the whole composite degrades.
 */
function stubBasemapTiles(failUrlSubstring?: string): void {
  vi.spyOn((basemapService as any).client, 'get').mockImplementation(async (...args: unknown[]) => {
    const url = args[0] as string;

    if (failUrlSubstring && url.includes(failUrlSubstring)) {
      const error = Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: { status: 400, data: 'InvalidParameterValue' }
      });
      throw error;
    }

    if (url.includes('OSM_Land_Water_Map')) {
      return { data: BASE_TILE, status: 200 };
    }
    if (url.includes('Reference_Features_15m')) {
      return { data: FEATURES_TILE, status: 200 };
    }
    throw new Error(`Unexpected GIBS tile URL in test stub: ${url}`);
  });
}

/** Stub the radar overlay tile fetch — the handler's own bare `axios.get` call in `fetchRadarTile`. */
function stubRadarTileFetch(): void {
  vi.spyOn(axios, 'get').mockResolvedValue({ data: RADAR_TILE, status: 200 });
}

// Miami — the plan's own live fixture (zoom-6 radar tile 6/17/27).
const MIAMI_LAT = 25.7617;
const MIAMI_LON = -80.1918;

// Seattle — deliberately a different zoom-6 tile (6/10/22) than Miami's, so
// this test's GIBS fetches can never be served from basemapService's own
// tile cache left over from the Miami test above.
const SEATTLE_LAT = 47.6062;
const SEATTLE_LON = -122.3321;

describe('Composited weather imagery — mocked end-to-end (deterministic)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces a full [text, image] composite: real BasemapService + real handler, decodes to a 512×512 PNG', async () => {
    stubRainViewerFeed();
    stubBasemapTiles();
    stubRadarTileFetch();

    const result = await handleGetWeatherImagery(
      { latitude: MIAMI_LAT, longitude: MIAMI_LON, type: 'precipitation', composite: true },
      UNUSED as LocationStore,
      UNUSED as GeocodingService
    );

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1].type).toBe('image');

    const imageBlock = result.content[1] as ImageBlock;
    expect(imageBlock.mimeType).toBe('image/png');
    expect(typeof imageBlock.data).toBe('string');
    expect(imageBlock.data.length).toBeGreaterThan(0);

    const decoded = PNG.sync.read(Buffer.from(imageBlock.data, 'base64'));
    expect(decoded.width).toBe(512);
    expect(decoded.height).toBe(512);

    const text = (result.content[0] as TextBlock).text;
    expect(text).toContain('**Composited map attached:**');
    expect(text).toContain('© RainViewer');
    expect(text).toContain("NASA's Global Imagery Browse Services (GIBS)");
    expect(text).not.toContain('composite unavailable');
  });

  it('degrades to text-only with the "composite unavailable" note when one GIBS tile returns HTTP 400 InvalidParameterValue, without throwing', async () => {
    stubRainViewerFeed();
    stubBasemapTiles('OSM_Land_Water_Map'); // fail every base-layer child tile
    stubRadarTileFetch();

    const result = await handleGetWeatherImagery(
      { latitude: SEATTLE_LAT, longitude: SEATTLE_LON, type: 'precipitation', composite: true },
      UNUSED as LocationStore,
      UNUSED as GeocodingService
    );

    // The call itself never fails because compositing failed — it returns
    // the normal single-text-block output with a degradation note instead.
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const text = (result.content[0] as TextBlock).text;
    expect(text).toContain('# Weather Imagery');
    expect(text).toContain('Composite map unavailable for this request');
    expect(text).not.toContain('**Composited map attached:**');
  });
});

describe('Composited weather imagery — live smoke test (tolerant of network flake)', () => {
  it('composites a real RainViewer frame over real GIBS tiles and decodes a 512×512 PNG', async () => {
    let result: Awaited<ReturnType<typeof handleGetWeatherImagery>> | undefined;

    try {
      result = await handleGetWeatherImagery(
        { latitude: MIAMI_LAT, longitude: MIAMI_LON, type: 'precipitation', composite: true },
        UNUSED as LocationStore,
        UNUSED as GeocodingService
      );
    } catch (error) {
      // Tolerant of live-network flake: log and pass rather than fail the
      // suite, matching tests/integration/metar.test.ts and
      // tests/integration/global-rivers.test.ts.
      console.warn(
        '\n=== Live composite smoke test skipped (network error) ===\n',
        error instanceof Error ? error.message : String(error)
      );
      return;
    }

    const imageBlock = result.content.find((block) => block.type === 'image') as
      | ImageBlock
      | undefined;

    if (!imageBlock) {
      // The handler itself degrades gracefully to text-only on any composite
      // failure (a live GIBS/RainViewer hiccup, a transient timeout, etc.) —
      // that is the designed behavior for exactly this situation, so treat it
      // the same as a caught network error rather than a test failure.
      console.warn(
        '\n=== Live composite smoke test skipped (no image block — composite pipeline degraded to text-only) ===\n',
        (result.content[0] as TextBlock | undefined)?.text?.slice(-300)
      );
      return;
    }

    // A real image block was returned — from here on, a structural problem
    // (wrong dimensions, an undecodable PNG) is a genuine bug, not flake, and
    // is allowed to fail the test.
    expect(imageBlock.mimeType).toBe('image/png');
    const decoded = PNG.sync.read(Buffer.from(imageBlock.data, 'base64'));
    expect(decoded.width).toBe(512);
    expect(decoded.height).toBe(512);

    console.log('\n=== Live composite smoke test: Miami ===');
    console.log(`base64 image bytes: ${imageBlock.data.length}`);
  }, 90000);
});
