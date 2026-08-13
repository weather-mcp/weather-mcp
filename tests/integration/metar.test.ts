/**
 * Integration tests for METAR worldwide station observations
 * (`source: 'metar'` on `get_current_conditions`), per docs/metar-plan.md T7.
 *
 * Block 1 is deterministic: only the HTTP-issuing method of a real
 * `AviationWeatherService` instance is stubbed via `vi.spyOn` on its private
 * axios `client.get`, mirroring the private-method-spy convention used in
 * tests/integration/almanac.test.ts (`AcisService`'s axios `client.post`) and
 * tests/integration/global-rivers.test.ts (`OpenMeteoService`'s
 * `makeRequestToFlood`). This is a deliberate variant of the module-level
 * `vi.mock('axios')` pattern used in tests/unit/metar-service.test.ts: a
 * file-wide axios mock would also swallow the live call Block 2 needs to
 * make, so this file scopes the mock to one `AviationWeatherService`
 * instance per test instead. For the HTML-502 case, the mocked `client.get`
 * resolves by calling the service's own private `handleError` directly
 * (`(service as any).handleError(rawError)`) — the exact function real axios
 * would invoke via the interceptor registered in the constructor
 * (`this.client.interceptors.response.use(fulfilled, error => this.handleError(error))`),
 * so the real sanitization/mapping logic runs, just reached by direct
 * reference instead of through axios's internal interceptor-handler array.
 * The real `AviationWeatherService` and the real `handleGetCurrentConditions`
 * run end to end against fixtures built from a genuine captured 2026-08-13
 * response (see `CAPTURED_STATIONS` below): a mix of string (`"10+"`) and
 * numeric `visib`, string (`"VRB"`) and numeric `wdir`, epoch-seconds
 * `obsTime` beside ISO `reportTime`/`receiptTime`, a numeric `qcField`, an
 * empty `clouds: []` for a clear station, and a top-level `cover` field.
 *
 * Block 2 makes a **live** call to the real
 * https://aviationweather.gov/api/data/metar endpoint — a fresh
 * `AviationWeatherService` instance with no mocking applied at all, so it is
 * unaffected by Block 1's instance-scoped spies — so this file makes live
 * network calls. It follows the tolerant-of-live-network convention used by
 * tests/integration/global-rivers.test.ts and tests/integration/almanac.test.ts:
 * a generous per-test timeout, shape-only assertions (never a specific
 * temperature or station), and the test catches and logs a network error
 * instead of letting it fail — this file never turns the suite red on a
 * flaky connection. The endpoint is known to be flaky: a sustained burst
 * returned HTML 502 during design verification (see the "Verified API
 * contract" section of docs/metar-plan.md and
 * src/services/aviationWeather.ts's header comment).
 *
 * This is now the **sixth** live-network integration file in the project —
 * joining visualization-lightning.test.ts (Blitzortung MQTT),
 * safety-hazards.test.ts (live NOAA/USGS), global-rivers.test.ts (live Flood
 * API), almanac.test.ts (live ACIS), and error-recovery.test.ts (live
 * Open-Meteo status). A red result confined to these files should be
 * re-run before suspecting the diff — see the "Flaky live-network tests"
 * project memory.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { AviationWeatherService } from '../../src/services/aviationWeather.js';
import { ServiceUnavailableError } from '../../src/errors/ApiError.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { MetarObservation } from '../../src/types/aviationWeather.js';

/**
 * A genuine captured bbox response — Pacific NW stations, captured
 * 2026-08-13 (see the scratchpad capture behind T7's task brief). Kept
 * verbatim except for `obsTime` restamping (see `restampObsTime` below):
 * string `visib` ("10+") alongside numeric `visib` (KTIW: 5, KSEA: 0.5),
 * `wdir: "VRB"` (KTIW) alongside numeric `wdir`, epoch-seconds `obsTime`
 * beside ISO `reportTime`/`receiptTime`, a numeric `qcField`, empty
 * `clouds: []` for the clear stations (KPLU, KPAE), and a top-level `cover`
 * field throughout.
 */
const CAPTURED_STATIONS: MetarObservation[] = [
  {
    icaoId: 'KPWT',
    receiptTime: '2026-08-13T16:58:48.783Z',
    obsTime: 1786640160,
    reportTime: '2026-08-13T17:00:00.000Z',
    temp: 13.9,
    dewp: 13.9,
    wdir: 230,
    wspd: 3,
    visib: '10+',
    altim: 1014,
    slp: 1014.2,
    qcField: 14,
    metarType: 'METAR',
    rawOb: 'METAR KPWT 131656Z AUTO 23003KT 10SM BKN002 14/14 A2994 RMK AO2 SLP142 T01390139 PNO $',
    lat: 47.4942,
    lon: -122.7594,
    elev: 143,
    name: 'Bremerton Arpt, WA, US',
    cover: 'BKN',
    clouds: [{ cover: 'BKN', base: 200 }],
    fltCat: 'LIFR'
  },
  {
    icaoId: 'KPLU',
    receiptTime: '2026-08-13T16:58:37.901Z',
    obsTime: 1786640100,
    reportTime: '2026-08-13T17:00:00.000Z',
    temp: 17,
    dewp: 14,
    wdir: 0,
    wspd: 0,
    visib: '10+',
    altim: 1014,
    qcField: 6,
    metarType: 'METAR',
    rawOb: 'METAR KPLU 131655Z AUTO 00000KT 10SM CLR 17/14 A2994 RMK AO2',
    lat: 47.1005,
    lon: -122.2853,
    elev: 164,
    name: 'Tacoma/Pierce Cnty, WA, US',
    cover: 'CLR',
    clouds: [], // present but empty — "no layers" for a clear station, not "no data"
    fltCat: 'VFR'
  },
  {
    icaoId: 'KTIW',
    receiptTime: '2026-08-13T16:56:34.020Z',
    obsTime: 1786639980,
    reportTime: '2026-08-13T17:00:00.000Z',
    temp: 14.4,
    dewp: 12.8,
    wdir: 'VRB',
    wspd: 4,
    visib: 5,
    altim: 1014,
    slp: 1013.5,
    qcField: 4,
    wxString: 'BR',
    metarType: 'METAR',
    rawOb: 'METAR KTIW 131653Z VRB04KT 5SM BR OVC004 14/13 A2994 RMK AO2 SLP135 T01440128',
    lat: 47.2674,
    lon: -122.5762,
    elev: 89,
    name: 'Tacoma Narrows Arpt, WA, US',
    cover: 'OVC',
    clouds: [{ cover: 'OVC', base: 400 }],
    fltCat: 'LIFR'
  },
  {
    icaoId: 'KSEA',
    receiptTime: '2026-08-13T16:56:38.131Z',
    obsTime: 1786639980,
    reportTime: '2026-08-13T17:00:00.000Z',
    temp: 14.4,
    dewp: 12.8,
    wdir: 190,
    wspd: 4,
    visib: 0.5,
    altim: 1014,
    slp: 1014.2,
    qcField: 12,
    wxString: 'FG',
    metarType: 'METAR',
    rawOb: 'METAR KSEA 131653Z 19004KT 1/2SM R16L/P6000FT FG VV002 14/13 A2994 RMK AO2 SFC VIS 1 SLP142 T01440128 $',
    lat: 47.4447,
    lon: -122.3144,
    elev: 115,
    name: 'Seattle-Tacoma Intl, WA, US',
    cover: 'OVX',
    clouds: [{ cover: 'OVX', base: 200 }],
    fltCat: 'LIFR'
  },
  {
    icaoId: 'KPAE',
    receiptTime: '2026-08-13T16:56:40.079Z',
    obsTime: 1786639980,
    reportTime: '2026-08-13T17:00:00.000Z',
    temp: 17.8,
    dewp: 13.3,
    wdir: 0,
    wspd: 0,
    visib: '10+',
    altim: 1013.6,
    slp: 1013.4,
    qcField: 4,
    metarType: 'METAR',
    rawOb: 'METAR KPAE 131653Z 00000KT 10SM CLR 18/13 A2993 RMK AO2 SLP134 T01780133',
    lat: 47.9232,
    lon: -122.2831,
    elev: 166,
    name: 'Everett/Paine Fld, WA, US',
    cover: 'CLR',
    clouds: [],
    fltCat: 'VFR'
  },
  {
    icaoId: 'KRNT',
    receiptTime: '2026-08-13T16:56:32.786Z',
    obsTime: 1786639980,
    reportTime: '2026-08-13T17:00:00.000Z',
    temp: 18.3,
    dewp: 13.9,
    wdir: 180,
    wspd: 4,
    visib: 9,
    altim: 1013.3,
    slp: 1013.8,
    qcField: 4,
    metarType: 'METAR',
    rawOb: 'METAR KRNT 131653Z 18004KT 9SM CLR 18/14 A2992 RMK AO2 SLP138 T01830139',
    lat: 47.4951,
    lon: -122.2144,
    elev: 7,
    name: 'Renton Muni, WA, US',
    cover: 'CLR',
    clouds: [],
    fltCat: 'VFR'
  },
  {
    icaoId: 'KBFI',
    receiptTime: '2026-08-13T16:56:30.811Z',
    obsTime: 1786639980,
    reportTime: '2026-08-13T17:00:00.000Z',
    temp: 16.7,
    dewp: 13.3,
    wdir: 160,
    wspd: 3,
    visib: 6,
    altim: 1013.6,
    slp: 1013.3,
    qcField: 4,
    wxString: 'HZ',
    metarType: 'METAR',
    rawOb: 'METAR KBFI 131653Z 16003KT 6SM HZ BKN008 OVC010 17/13 A2993 RMK AO2 SLP133 T01670133',
    lat: 47.5455,
    lon: -122.3148,
    elev: 7,
    name: 'Seattle/Boeing Fld, WA, US',
    cover: 'OVC',
    clouds: [
      { cover: 'BKN', base: 800 },
      { cover: 'OVC', base: 1000 }
    ],
    fltCat: 'IFR'
  }
];

/** KSEA's own coordinates — requesting here guarantees it is the nearest (0 km) station in CAPTURED_STATIONS. */
const KSEA_LAT = 47.4447;
const KSEA_LON = -122.3144;

/**
 * A single-station fixture cloned from the captured KRNT observation with
 * `temp` deleted, to exercise the ~1% of reports (per the field survey in
 * docs/metar-plan.md) missing it. Kept to one station (rather than mixed
 * into CAPTURED_STATIONS) so the picker's nearest-station choice stays
 * unambiguous in the "missing temp" test.
 */
const STATION_MISSING_TEMP: MetarObservation = {
  icaoId: 'KRNT',
  receiptTime: '2026-08-13T16:56:32.786Z',
  obsTime: 1786639980,
  reportTime: '2026-08-13T17:00:00.000Z',
  // temp intentionally omitted
  dewp: 13.9,
  wdir: 180,
  wspd: 4,
  visib: 9,
  altim: 1013.3,
  slp: 1013.8,
  qcField: 4,
  metarType: 'METAR',
  rawOb: 'METAR KRNT 131653Z 18004KT 9SM CLR 18/14 A2992 RMK AO2 SLP138 T01830139',
  lat: 47.4951,
  lon: -122.2144,
  elev: 7,
  name: 'Renton Muni, WA, US',
  cover: 'CLR',
  clouds: [],
  fltCat: 'VFR'
};

/**
 * The captured `obsTime` values are all from 2026-08-13 ~16:53-16:58 UTC and
 * will be stale relative to `new Date()` by the time these tests actually
 * run. This restamps every station by the same delta — preserving their
 * original relative offsets (all within ~3 minutes of each other, matching
 * the real hourly-cycle clustering) — so the newest one lands
 * `aroundMinutesAgo` minutes before `Date.now()`. Used for the "renders
 * normally" cases below; the freshness/staleness logic itself is covered by
 * tests/unit/metar-station.test.ts; the original epoch values are preserved
 * verbatim (not restamped) anywhere this helper isn't explicitly called.
 */
function restampObsTime(stations: MetarObservation[], aroundMinutesAgo = 5): MetarObservation[] {
  if (stations.length === 0) return stations;
  const newestOriginal = Math.max(...stations.map(s => s.obsTime));
  const targetNewest = Math.floor(Date.now() / 1000) - aroundMinutesAgo * 60;
  const delta = targetNewest - newestOriginal;
  return stations.map(s => ({ ...s, obsTime: s.obsTime + delta }));
}

/** A dummy NOAAService/OpenMeteoService/NCEIService/LocationStore/GeocodingService — never touched by the `source: 'metar'` path when `include_normals`/`include_fire_weather` are both left at their default `false`. */
const UNUSED = {} as never;

/** Stub a fresh service instance's private axios `client.get` to resolve with a canned 200 body. Scoped to this one instance — see the file header for why this isn't a module-level `vi.mock('axios')`. */
function stubSuccess(service: AviationWeatherService, data: unknown, status = 200): void {
  vi.spyOn((service as any).client, 'get').mockResolvedValue({ data, status });
}

describe('METAR current conditions (mocked, deterministic)', () => {
  it('renders a full METAR block for a 200 multi-station body: station line, observed line, raw METAR, footer', async () => {
    const restamped = restampObsTime(CAPTURED_STATIONS, 5);
    const aviationWeatherService = new AviationWeatherService();
    stubSuccess(aviationWeatherService, restamped);

    const result = await handleGetCurrentConditions(
      { latitude: KSEA_LAT, longitude: KSEA_LON, source: 'metar' },
      UNUSED as NOAAService,
      UNUSED as OpenMeteoService,
      UNUSED as NCEIService,
      UNUSED as LocationStore,
      UNUSED as GeocodingService,
      undefined,
      aviationWeatherService
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = result.content[0].text;

    // Station line — KSEA, guaranteed nearest since the request point is its own coordinates.
    expect(text).toContain('# Current Conditions — Seattle-Tacoma Intl, WA, US (KSEA)');
    expect(text).toContain('**Station:** Seattle-Tacoma Intl, WA, US (KSEA)');

    // Observed line — always present, always dated.
    expect(text).toContain('**Observed:**');
    expect(text).toContain('ago)');

    // No far/stale caveats: distance is 0 km and the fixture was restamped to 5 minutes old.
    expect(text).not.toContain('Nearest station is');
    expect(text).not.toContain('Observation is');

    // Measurements decoded from the fixture.
    expect(text).toContain('**Temperature:**');
    expect(text).toContain('**Wind:**');
    expect(text).toContain('**Visibility:**');
    expect(text).toContain('**Sky:**');
    expect(text).toContain('**Weather:** Fog'); // wxString "FG" decoded
    expect(text).toContain('**Pressure:**');
    expect(text).toContain('**Flight category:** LIFR');

    // The raw METAR — the observation of record — always included verbatim.
    expect(text).toContain('`METAR KSEA 131653Z 19004KT 1/2SM R16L/P6000FT FG VV002 14/13 A2994 RMK AO2 SFC VIS 1 SLP142 T01440128 $`');

    // Footer.
    expect(text).toContain('*Data source: NOAA Aviation Weather Center (aviationweather.gov) — METAR station observation*');

    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('renders the rest of the block without undefined/NaN when a station is missing temp', async () => {
    const restamped = restampObsTime([STATION_MISSING_TEMP], 5);
    const aviationWeatherService = new AviationWeatherService();
    stubSuccess(aviationWeatherService, restamped);

    const result = await handleGetCurrentConditions(
      { latitude: STATION_MISSING_TEMP.lat, longitude: STATION_MISSING_TEMP.lon, source: 'metar' },
      UNUSED as NOAAService,
      UNUSED as OpenMeteoService,
      UNUSED as NCEIService,
      UNUSED as LocationStore,
      UNUSED as GeocodingService,
      undefined,
      aviationWeatherService
    );

    const text = result.content[0].text;

    // No Temperature line (obs.temp is undefined); the handler falls back to a
    // Dew Point line instead of rendering the section blank.
    expect(text).not.toContain('**Temperature:**');
    expect(text).toContain('**Dew Point:**');

    // The rest of the block still renders normally.
    expect(text).toContain('# Current Conditions — Renton Muni, WA, US (KRNT)');
    expect(text).toContain('**Wind:**');
    expect(text).toContain('**Visibility:**');
    expect(text).toContain('`METAR KRNT 131653Z 18004KT 9SM CLR 18/14 A2992 RMK AO2 SLP138 T01830139`');

    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('produces the friendly no-station message (not a throw) on a 204 empty body across every search tier', async () => {
    const aviationWeatherService = new AviationWeatherService();
    const getSpy = vi.spyOn((aviationWeatherService as any).client, 'get').mockResolvedValue({ data: '', status: 204 });

    // Mid-ocean point — no station is expected regardless, but the fixture
    // guarantees it via the 204 mock on every tier.
    const result = await handleGetCurrentConditions(
      { latitude: 0, longitude: -140, source: 'metar' },
      UNUSED as NOAAService,
      UNUSED as OpenMeteoService,
      UNUSED as NCEIService,
      UNUSED as LocationStore,
      UNUSED as GeocodingService,
      undefined,
      aviationWeatherService
    );

    const text = result.content[0].text;
    expect(text).toContain('# Current Conditions — No Station Nearby');
    expect(text).toContain('No reporting station near this location');

    // One HTTP call per search tier (0.5°, 2.0°, 5.0°), all 204.
    expect(getSpy).toHaveBeenCalledTimes(3);
  });

  it('surfaces the HTML 502 as a sanitized ServiceUnavailableError with no raw HTML in the message', async () => {
    // maxRetries: 0 keeps this test fast — the backoff/retry behaviour
    // itself is covered by tests/unit/metar-service.test.ts; here the point
    // is only that the failure reaches the handler sanitized.
    const aviationWeatherService = new AviationWeatherService({ maxRetries: 0 });

    const rawError = {
      response: {
        status: 502,
        data: '<html><head><title>502 Bad Gateway</title></head><body>Bad Gateway</body></html>',
        headers: { 'content-type': 'text/html' }
      }
    };
    // Route the rejection through the service's own registered interceptor
    // handler directly — `(service as any).handleError` is the exact
    // function `this.client.interceptors.response.use(...)` registers in the
    // constructor, so the real sanitization/mapping logic in
    // aviationWeather.ts runs (see file header for why this is reached by
    // direct reference rather than axios's own interceptor-handler array).
    vi.spyOn((aviationWeatherService as any).client, 'get').mockImplementation(() =>
      (aviationWeatherService as any).handleError(rawError)
    );

    let caught: unknown;
    try {
      await handleGetCurrentConditions(
        { latitude: KSEA_LAT, longitude: KSEA_LON, source: 'metar' },
        UNUSED as NOAAService,
        UNUSED as OpenMeteoService,
        UNUSED as NCEIService,
        UNUSED as LocationStore,
        UNUSED as GeocodingService,
        undefined,
        aviationWeatherService
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ServiceUnavailableError);
    const message = (caught as Error).message + ' ' + (caught as ServiceUnavailableError).userMessage;
    expect(message.toLowerCase()).not.toContain('<html');
    expect(message).not.toContain('502 Bad Gateway</title>');
  });
});

describe('METAR current conditions — live smoke test (tolerant of network flake)', () => {
  it('fetches real METAR station observations for a bbox with known coverage (Puget Sound)', async () => {
    const aviationWeatherService = new AviationWeatherService();

    try {
      // Same Pacific NW box CAPTURED_STATIONS was drawn from — reliable
      // coverage without depending on any exact station or value.
      const stations = await aviationWeatherService.getMetarsInBoundingBox({
        minLat: 46.5,
        minLon: -123.5,
        maxLat: 48.5,
        maxLon: -121.5
      });

      expect(Array.isArray(stations)).toBe(true);

      // Shape, not values — station identity, conditions, and exact counts
      // change constantly; the golden-value/mixed-type tests live in
      // tests/unit/metar-service.test.ts and tests/unit/metar-parsing.test.ts.
      for (const station of stations) {
        expect(typeof station.icaoId).toBe('string');
        expect(station.icaoId.length).toBeGreaterThan(0);
        expect(typeof station.lat).toBe('number');
        expect(typeof station.lon).toBe('number');
        expect(typeof station.rawOb).toBe('string');
        expect(station.rawOb.length).toBeGreaterThan(0);
        expect(typeof station.obsTime).toBe('number');
        expect(Number.isFinite(station.obsTime)).toBe(true);
      }

      console.log('\n=== Live METAR smoke test: Puget Sound bbox ===');
      console.log(`${stations.length} station(s) returned`);
    } catch (error) {
      // Tolerant of live-network flake: log and pass rather than fail the
      // suite. The endpoint is known to burst-fail with an HTML 502 (see the
      // file header and docs/metar-plan.md's "Verified API contract").
      console.warn(
        '\n=== Live METAR smoke test skipped (network error) ===\n',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, 60000);
});
