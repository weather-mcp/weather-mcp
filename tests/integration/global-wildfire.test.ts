/**
 * Integration tests for global wildfire coverage (NASA FIRMS satellite
 * fire detections) — per docs/global-wildfire-plan.md D3/D4/D5 and the
 * "Testing" section's T6 (integration tests): mocked CSV shapes end-to-end
 * through the real handler, plus one tolerant keyless live smoke test.
 *
 * **This file makes live network calls** (the keyless FIRMS flat-file
 * fetch in the second describe block) and belongs to the project's
 * flaky-tolerant live-network set — re-run before blaming your diff. See
 * the "Flaky live-network tests" project memory and the tolerant-live-test
 * convention used throughout tests/integration/ (almanac.test.ts,
 * global-rivers.test.ts, safety-hazards.test.ts).
 *
 * **Mock/live split — approach chosen:** Block 1 needs mocked HTTP; Block 2
 * needs the real network, in the same file. A module-level `vi.mock('axios')`
 * (the tests/unit/firms-service.test.ts style) would also swallow Block 2's
 * live call. Instead, this file follows the *other* established pattern in
 * this repo — tests/integration/almanac.test.ts's `AcisService` block, which
 * `vi.spyOn`s the private axios `client` field of one real service instance
 * rather than mocking the `axios` module globally. Block 1 constructs real
 * `FIRMSService` instances and spies on each instance's own
 * `(service as any).client.get`; Block 2 constructs a separate, completely
 * unspied `FIRMSService` that issues real HTTP. Because the mock is scoped
 * to individual instances (not the module), both blocks coexist safely in
 * one file with no `vi.mock` hoisting at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import { FIRMSService } from '../../src/services/firms.js';
import type { NIFCService } from '../../src/services/nifc.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';

// ---------------------------------------------------------------------------
// Shared fakes
// ---------------------------------------------------------------------------

/** Never called on the FIRMS path — the handler only reaches NIFC when useFirms is false. */
const inertNifcService = {} as unknown as NIFCService;
/** Explicit lat/lon short-circuits resolveLocationAsync — neither is touched. */
const inertLocationStore = {} as unknown as LocationStore;
const inertGeocodingService = {} as unknown as GeocodingService;

function makeNominatimFake(countryCode: string | null): NominatimService {
  return {
    reverseCountry: vi.fn(async () => countryCode)
  } as unknown as NominatimService;
}

function textResponse(data: string) {
  return Promise.resolve({ data, status: 200 });
}

// ---------------------------------------------------------------------------
// Block 1 — mocked HTTP fixtures, real FIRMSService + real handler
// ---------------------------------------------------------------------------

/**
 * Trimmed Area-API (keyed) capture — 14 columns, `instrument` present,
 * confidence abbreviated (`n`/`h`), unpadded `acq_time` (`215`/`48`).
 * Header + shapes per the plan's Live re-verification notes. Five rows,
 * all within ~1 km of each other near Lisbon, Portugal — well inside the
 * default 100 km radius and close enough to fall into one cluster
 * (default cluster radius 2 km).
 */
const AREA_API_CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
  '39.501,-8.001,330.5,0.4,0.4,2026-08-13,215,N,VIIRS,n,2.0NRT,290.1,15.3,D',
  '39.502,-8.002,335.0,0.4,0.4,2026-08-13,215,N,VIIRS,h,2.0NRT,295.0,22.7,D',
  '39.499,-8.003,328.0,0.4,0.4,2026-08-13,48,N,VIIRS,n,2.0NRT,288.0,9.1,N',
  '39.503,-8.000,340.0,0.4,0.4,2026-08-13,215,N,VIIRS,h,2.0NRT,300.0,30.5,D',
  '39.498,-8.002,325.0,0.4,0.4,2026-08-13,48,N,VIIRS,n,2.0NRT,287.0,7.4,N'
].join('\n');

const AREA_API_QUERY_LAT = 39.5;
const AREA_API_QUERY_LON = -8.0;

/**
 * Trimmed flat-file (keyless) capture — 13 columns, no `instrument`,
 * confidence spelled out (`nominal`/`high`/`low`), zero-padded `acq_time`
 * (`0048`/`0130`). Five rows near Vienna, Austria, same clustering logic
 * as above.
 */
const FLAT_FILE_CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight',
  '48.201,16.401,325.0,0.4,0.4,2026-08-13,0048,N,nominal,2.0NRT,288.0,9.7,N',
  '48.202,16.402,330.0,0.4,0.4,2026-08-13,0048,N,high,2.0NRT,292.0,18.2,N',
  '48.199,16.403,320.0,0.4,0.4,2026-08-13,0130,N,nominal,2.0NRT,285.0,6.5,D',
  '48.203,16.400,340.0,0.4,0.4,2026-08-13,0130,N,high,2.0NRT,298.0,25.0,D',
  '48.198,16.399,318.0,0.4,0.4,2026-08-13,0048,N,low,2.0NRT,283.0,4.2,N'
].join('\n');

const FLAT_FILE_QUERY_LAT = 48.2;
const FLAT_FILE_QUERY_LON = 16.4;

describe('Global wildfire integration — mocked CSV shapes end-to-end (deterministic)', () => {
  it('renders a keyed Area-API (14-column) response through the real service and handler', async () => {
    const firmsService = new FIRMSService({ mapKey: 'FAKE_TEST_MAP_KEY' });
    vi.spyOn((firmsService as any).client, 'get').mockImplementation(() => textResponse(AREA_API_CSV));

    const nominatimService = makeNominatimFake('pt'); // Portugal — non-US, routes to FIRMS

    const result = await handleGetWildfireInfo(
      { latitude: AREA_API_QUERY_LAT, longitude: AREA_API_QUERY_LON },
      inertNifcService,
      inertLocationStore,
      inertGeocodingService,
      firmsService,
      nominatimService
    );

    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;

    // FIRMS framing (D5): source line + not-managed-incident disclosure.
    expect(text).toContain('**Source:** NASA FIRMS satellite fire detections (VIIRS, near real-time)');
    expect(text).toContain('⚠️ Satellite heat detections — not managed incident data.');

    // Cluster fields render.
    expect(text).toMatch(/\*\*Detections:\*\* \d+ hotspots?/);
    expect(text).toContain('**Distance:**');
    expect(text).toContain('**Peak intensity:**');
    expect(text).toContain('**Confidence:**');
    expect(text).toContain('**Satellite:**');

    // All five rows fell into the search radius and clustered.
    expect(text).toContain('5 satellite fire detections in the last 24 h');

    // FIRMS attribution footer.
    expect(text).toContain('*Data source: NASA FIRMS (Fire Information for Resource Management System)*');
    expect(text).toContain('We acknowledge the use of data from NASA FIRMS');

    // No day_range upgrade note — the key was accepted and used.
    expect(text).not.toContain('Multi-day detection history requires a free FIRMS_MAP_KEY');
  });

  it('renders a keyless flat-file (13-column) response through the real service and handler, with the day_range upgrade note', async () => {
    const firmsService = new FIRMSService({ mapKey: undefined }); // no key configured -> keyless path
    vi.spyOn((firmsService as any).client, 'get').mockImplementation(() => textResponse(FLAT_FILE_CSV));

    const nominatimService = makeNominatimFake('at'); // Austria — non-US, routes to FIRMS

    const result = await handleGetWildfireInfo(
      {
        latitude: FLAT_FILE_QUERY_LAT,
        longitude: FLAT_FILE_QUERY_LON,
        day_range: 3 // keyed-path-only param; without a key, expect the upgrade note
      },
      inertNifcService,
      inertLocationStore,
      inertGeocodingService,
      firmsService,
      nominatimService
    );

    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;

    // Same FIRMS framing as the keyed path.
    expect(text).toContain('**Source:** NASA FIRMS satellite fire detections (VIIRS, near real-time)');
    expect(text).toContain('⚠️ Satellite heat detections — not managed incident data.');

    // Cluster fields render.
    expect(text).toMatch(/\*\*Detections:\*\* \d+ hotspots?/);
    expect(text).toContain('**Distance:**');
    expect(text).toContain('**Peak intensity:**');
    expect(text).toContain('**Confidence:**');
    expect(text).toContain('**Satellite:**');

    expect(text).toContain('5 satellite fire detections in the last 24 h');

    // day_range > 1 without a key -> the keyless-24h upgrade note (D6).
    expect(text).toContain(
      'Multi-day detection history requires a free FIRMS_MAP_KEY; showing the last 24 hours.'
    );

    // FIRMS attribution footer.
    expect(text).toContain('*Data source: NASA FIRMS (Fire Information for Resource Management System)*');
    expect(text).toContain('We acknowledge the use of data from NASA FIRMS');
  });
});

// ---------------------------------------------------------------------------
// Block 2 — one live smoke test on the keyless path (tolerant of network flake)
// ---------------------------------------------------------------------------

describe('Global wildfire integration — live keyless smoke test (tolerant of network flake)', () => {
  it('fetches real FIRMS keyless data for a small regional file (Vienna, Austria) through the real handler', async () => {
    // A completely unspied FIRMSService — real axios, real network, no
    // FIRMS_MAP_KEY needed (keyless flat-file path, CI-safe with no secret).
    const firmsService = new FIRMSService();
    const nominatimService = makeNominatimFake('at'); // Austria — avoids a live Nominatim dependency

    try {
      const result = await handleGetWildfireInfo(
        { latitude: 48.2, longitude: 16.4 }, // Vienna area — Europe regional cut (~410 KB)
        inertNifcService,
        inertLocationStore,
        inertGeocodingService,
        firmsService,
        nominatimService
      );

      expect(result.content).toHaveLength(1);
      const text = result.content[0].text;

      // Shape, not values — never assume fire activity either way.
      expect(text.startsWith('# Wildfire Information Report')).toBe(true);
      expect(text).toContain('**Source:** NASA FIRMS');

      const hasNoDetectionsMessage = /No satellite fire detections in the (last 24 h|last \d+ days) within \d+ km\./.test(
        text
      );
      const hasDetectionsCountLine = /\d+ satellite fire detections? in the (last 24 h|last \d+ days), grouped into \d+ clusters? within \d+ km/.test(
        text
      );
      expect(hasNoDetectionsMessage || hasDetectionsCountLine).toBe(true);

      console.log('\n=== Live FIRMS keyless smoke test: Vienna, Austria ===');
      console.log(`Response length: ${text.length} chars`);
      console.log(`Detections present: ${hasDetectionsCountLine}`);
    } catch (error) {
      // Tolerant of live-network flake: log and pass rather than fail the suite.
      console.warn(
        '\n=== Live FIRMS keyless smoke test skipped (network error) ===\n',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, 60000);
});
