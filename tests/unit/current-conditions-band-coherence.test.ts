/**
 * Display-band coherence tests (issue #82, T6) — the category printed beside
 * a number must key on the number *as displayed*, in the unit it is
 * displayed in.
 *
 * Covers the two sites T3/T2 fixed on `get_current_conditions`:
 *   - Visibility descriptor (NOAA path): banded on `visibilityDisplayValue`
 *     (src/utils/unitFormat.ts), not on a raw miles/km figure.
 *   - Fire-weather (NOAA path: Red Flag Threat, Haines, Grassland; Open-Meteo
 *     path: VPD, topsoil moisture) — all banded on the rounded/displayed
 *     figure the line prints.
 *
 * Plus two "must stay untouched" pins (METAR fire-weather note, Fosberg
 * rendering) and one composite-path check (get_weather_summary forwards the
 * caller's args through its own `subArgs`, per weatherSummaryHandler.ts).
 *
 * Fake/fixture pattern follows tests/unit/thermal-stress-handler.test.ts and
 * tests/unit/noaa-staleness.test.ts (NOAA path — plain fake services, pinned
 * clock, single nearest station), tests/unit/current-conditions-global.test.ts
 * and tests/unit/openmeteo-fire-variables.test.ts (Open-Meteo path fixture
 * shape), and tests/unit/metar-handler.test.ts (METAR fixture shape). The
 * get_weather_summary section drives the real handler with service fakes
 * (not handler mocks) — see the G19 note below.
 *
 * All expected strings in the visibility table were hand-verified against
 * the built dist by the plan author, base vs branch; the fire-weather rows
 * and the mutation behavior below were independently recomputed here with a
 * one-off Node script mirroring src/utils/fireWeather.ts and
 * src/utils/displayBanding.ts before being written into assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { AviationWeatherService } from '../../src/services/aviationWeather.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ObservationResponse, StationCollectionResponse, GridpointResponse } from '../../src/types/noaa.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import type { BoundingBox, MetarObservation } from '../../src/types/aviationWeather.js';

// ---------------------------------------------------------------------------
// Shared fixtures — NOAA path
// ---------------------------------------------------------------------------

/** Washington, DC — inside the US routing boxes, so auto routes to NOAA. */
const US_COORDS = { latitude: 38.8951, longitude: -77.0364 };
/** London, UK — outside the US routing boxes, so auto routes to Open-Meteo. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };
/** Seattle, WA — a US point, used for the METAR fixture (near-field station). */
const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };

/** Pinned "now"; fixture observations are dated 30 minutes earlier — well
 * inside staleAcceptanceMinutes, so the retry loop never engages and the
 * stale warning never fires. */
const NOW = new Date('2026-08-18T12:00:00Z');
const FRESH_TIMESTAMP = new Date(NOW.getTime() - 30 * 60_000).toISOString();

/**
 * Moderate-fixture observation builder (68°F, 10 km/h wind, 50% RH — no
 * thermal-stress line, per thermal-stress-handler.test.ts), with an
 * overridable visibility in metres so each test can drive the banding input
 * directly.
 */
function buildObservation(visibilityMeters: number | null): ObservationResponse {
  return {
    properties: {
      '@id': 'https://api.weather.gov/stations/KAAA/observations/2026-08-18T11:30:00+00:00',
      '@type': 'wx:ObservationStation',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      station: 'https://api.weather.gov/stations/KAAA',
      timestamp: FRESH_TIMESTAMP,
      textDescription: 'Clear',
      temperature: { unitCode: 'wmoUnit:degF', value: 68 },
      dewpoint: { unitCode: 'wmoUnit:degF', value: 50 },
      windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 270 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 10 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
      visibility: { unitCode: 'wmoUnit:m', value: visibilityMeters },
    },
  } as unknown as ObservationResponse;
}

function buildStations(): StationCollectionResponse {
  return {
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          '@id': 'https://api.weather.gov/stations/KAAA',
          '@type': 'wx:ObservationStation',
          elevation: { unitCode: 'wmoUnit:m', value: 10 },
          stationIdentifier: 'KAAA',
          name: 'Alpha Field',
          timeZone: 'America/New_York',
        },
      },
    ] as unknown as StationCollectionResponse['features'],
  };
}

/** Gridpoint fixture carrying the three NOAA fire-weather indices under test. */
function buildGridpoint(overrides: {
  redFlagThreatIndex?: number;
  hainesIndex?: number;
  grasslandFireDangerIndex?: number;
}): GridpointResponse {
  const series = (value: number | undefined) =>
    value === undefined ? undefined : { values: [{ validTime: '2026-08-18T12:00:00+00:00/PT1H', value }] };
  return {
    properties: {
      redFlagThreatIndex: series(overrides.redFlagThreatIndex),
      hainesIndex: series(overrides.hainesIndex),
      grasslandFireDangerIndex: series(overrides.grasslandFireDangerIndex),
    },
  } as unknown as GridpointResponse;
}

function buildNoaaFake(observation: ObservationResponse, gridpoint: GridpointResponse = { properties: {} } as unknown as GridpointResponse) {
  return {
    getStations: vi.fn().mockResolvedValue(buildStations()),
    getLatestObservation: vi.fn().mockResolvedValue(observation),
    getGridpointDataByCoordinates: vi.fn().mockResolvedValue(gridpoint),
  };
}

function buildSupportFakes() {
  return {
    openMeteo: {
      getCurrentConditions: vi.fn(),
      getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    },
    ncei: { isAvailable: vi.fn().mockReturnValue(false) },
    locationStore: {},
    geocoding: {},
  };
}

function callNoaa(
  observation: ObservationResponse,
  args: Record<string, unknown> = {},
  gridpoint?: GridpointResponse
) {
  const noaa = buildNoaaFake(observation, gridpoint);
  const support = buildSupportFakes();
  return handleGetCurrentConditions(
    { ...US_COORDS, ...args },
    noaa as unknown as NOAAService,
    support.openMeteo as unknown as OpenMeteoService,
    support.ncei as unknown as NCEIService,
    support.locationStore as unknown as LocationStore,
    support.geocoding as unknown as GeocodingService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

// ---------------------------------------------------------------------------
// Shared fixtures — Open-Meteo path
// ---------------------------------------------------------------------------

function buildOpenMeteoCurrentResponse(currentOverrides: Record<string, unknown> = {}): OpenMeteoForecastResponse {
  return {
    latitude: 51.5,
    longitude: -0.13,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'Europe/London',
    timezone_abbreviation: 'GMT',
    elevation: 11,
    current_units: {
      time: 'iso8601',
      interval: 'seconds',
      temperature_2m: '°F',
    },
    current: {
      time: '2024-01-01T12:00',
      interval: 900,
      temperature_2m: 60,
      relative_humidity_2m: 55,
      apparent_temperature: 60,
      dew_point_2m: 50,
      is_day: 1,
      precipitation: 0,
      rain: 0,
      showers: 0,
      snowfall: 0,
      weather_code: 3,
      cloud_cover: 40,
      pressure_msl: 1012,
      wind_speed_10m: 10,
      wind_direction_10m: 200,
      wind_gusts_10m: 10,
      ...currentOverrides,
    },
    daily: {
      time: ['2024-01-01'],
      temperature_2m_max: [65],
      temperature_2m_min: [55],
    },
  };
}

function callOpenMeteo(response: OpenMeteoForecastResponse, args: Record<string, unknown> = {}) {
  const noaa = {
    getCurrentConditions: vi.fn().mockRejectedValue(new Error('NOAA not expected on this path')),
    getStations: vi.fn().mockRejectedValue(new Error('NOAA not expected on this path')),
    getLatestObservation: vi.fn().mockRejectedValue(new Error('NOAA not expected on this path')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('NOAA not expected on this path')),
  };
  const openMeteo = {
    getCurrentConditions: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
  const ncei = { isAvailable: vi.fn().mockReturnValue(false) };
  const locationStore = {};
  const geocoding = {};

  return handleGetCurrentConditions(
    { ...LONDON, include_fire_weather: true, ...args },
    noaa as unknown as NOAAService,
    openMeteo as unknown as OpenMeteoService,
    ncei as unknown as NCEIService,
    locationStore as unknown as LocationStore,
    geocoding as unknown as GeocodingService
  );
}

// ---------------------------------------------------------------------------
// Shared fixtures — METAR path
// ---------------------------------------------------------------------------

function buildMetarObservation(overrides: Partial<MetarObservation> = {}): MetarObservation {
  const nowIso = new Date().toISOString();
  return {
    icaoId: 'KSEA',
    name: 'Seattle-Tacoma Intl',
    lat: SEATTLE.latitude + 0.01,
    lon: SEATTLE.longitude + 0.01,
    elev: 130,
    obsTime: Math.round((Date.now() - 20 * 60_000) / 1000),
    reportTime: nowIso,
    receiptTime: nowIso,
    rawOb: 'METAR KSEA 131453Z 19006KT 10SM FEW250 20/10 A3000',
    metarType: 'METAR',
    qcField: 0,
    temp: 20,
    dewp: 10,
    wdir: 190,
    wspd: 6,
    altim: 1015,
    visib: 10,
    clouds: [{ cover: 'FEW', base: 25000 }],
    fltCat: 'VFR',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Visibility descriptor (NOAA path) — banded on the displayed figure
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — visibility descriptor keys on the displayed figure (NOAA path)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Measured against the built dist (base vs branch) by the plan author.
  // Each row also states what moved (or didn't) pre-fix -> post-fix.
  it.each([
    [16090, 'imperial', '**Visibility:** 10.0 miles (clear)'], // moved: no descriptor -> (clear)
    [16090, 'metric', '**Visibility:** 16.1 km (clear)'], // moved: no descriptor -> (clear)
    [4827, 'imperial', '**Visibility:** 3.0 miles'], // moved: (haze/mist) -> none
    [4827, 'metric', '**Visibility:** 4.8 km (haze/mist)'], // control: unchanged
    [1609, 'imperial', '**Visibility:** 1.0 miles (haze/mist)'], // moved: (fog) -> (haze/mist)
    [1609, 'metric', '**Visibility:** 1.6 km (fog)'], // control: unchanged
    [402, 'imperial', '**Visibility:** 0.2 miles (dense fog)'], // control: unchanged
    [402, 'metric', '**Visibility:** 0.4 km (dense fog)'], // control: unchanged
    [16093.44, 'imperial', '**Visibility:** 10.0 miles (clear)'], // moved: no descriptor -> (clear)
    [16093.44, 'metric', '**Visibility:** 16.1 km (clear)'], // moved: no descriptor -> (clear)
  ] as const)('meters=%s units=%s -> %s', async (meters, units, expectedLine) => {
    const text = textOf(await callNoaa(buildObservation(meters), { units }));
    const line = text.split('\n').find(l => l.startsWith('**Visibility:**'));
    expect(line).toBe(expectedLine);
  });

  // 4827 imperial specifically must have NO trailing descriptor at all — the
  // it.each row above checks a prefix match via startsWith+full-line equality,
  // but pin the negative explicitly too so a future descriptor addition here
  // cannot slip past unnoticed.
  it('4827 m imperial has no parenthetical descriptor at all', async () => {
    const text = textOf(await callNoaa(buildObservation(4827), { units: 'imperial' }));
    expect(text).toContain('**Visibility:** 3.0 miles\n');
    expect(text).not.toMatch(/\*\*Visibility:\*\* 3\.0 miles \(/);
  });

  // Window sweep: 1500 <= m <= 1700 at 1/4 m (division-indexed, not scaled
  // multiplication — G36), both unit systems. For each *printed* number, the
  // descriptor set attached to it must be a single value (coherence), and the
  // parse must actually find every rendered line (G28 — a parse finding
  // nothing must fail, not silently pass).
  it('window sweep 1500-1700m @ 0.25m: one printed figure never carries two descriptors, in either unit', async () => {
    const LINE_RE = /^\*\*Visibility:\*\* (\S+) (miles|km)(?: \((.+)\))?$/;
    const seenImperial = new Map<string, Set<string>>();
    const seenMetric = new Map<string, Set<string>>();
    let renderCount = 0;
    let parseCount = 0;

    const STEPS = 800; // (1700 - 1500) / 0.25
    for (let i = 0; i <= STEPS; i++) {
      const meters = 1500 + i / 4;
      for (const [units, bucket] of [
        ['imperial', seenImperial],
        ['metric', seenMetric],
      ] as const) {
        const text = textOf(await callNoaa(buildObservation(meters), { units }));
        const line = text.split('\n').find(l => l.startsWith('**Visibility:**'));
        renderCount++;
        expect(line).toBeDefined();
        const match = line!.match(LINE_RE);
        expect(match).not.toBeNull(); // G28: a parse that finds nothing must fail
        parseCount++;
        const [, printed, , descriptor] = match!;
        const key = printed;
        if (!bucket.has(key)) bucket.set(key, new Set());
        bucket.get(key)!.add(descriptor ?? '(none)');
      }
    }

    expect(parseCount).toBe(renderCount);
    expect(renderCount).toBe((STEPS + 1) * 2);

    for (const [printed, descriptors] of seenImperial) {
      expect(descriptors.size, `imperial ${printed} miles had descriptors ${[...descriptors].join(', ')}`).toBe(1);
    }
    for (const [printed, descriptors] of seenMetric) {
      expect(descriptors.size, `metric ${printed} km had descriptors ${[...descriptors].join(', ')}`).toBe(1);
    }
    // Sanity: the sweep actually crosses at least one seam in each unit
    // system, or this test would trivially pass with a single bucket.
    expect(seenImperial.size).toBeGreaterThan(1);
    expect(seenMetric.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Fire weather — NOAA path (Red Flag, Haines, Grassland)
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — fire-weather NOAA path keys on the printed figure', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Red Flag 59.6 rounds to 60 and crosses into High (moved row)', async () => {
    const gridpoint = buildGridpoint({ redFlagThreatIndex: 59.6 });
    const text = textOf(
      await callNoaa(buildObservation(16090), { include_fire_weather: true }, gridpoint)
    );
    expect(text).toContain('**🟠 Red Flag Threat:** 60 (High)');
  });

  it('Red Flag 59.4 rounds to 59 and stays Moderate (control — does not move)', async () => {
    const gridpoint = buildGridpoint({ redFlagThreatIndex: 59.4 });
    const text = textOf(
      await callNoaa(buildObservation(16090), { include_fire_weather: true }, gridpoint)
    );
    expect(text).toContain('**🟡 Red Flag Threat:** 59 (Moderate)');
  });

  it('Haines 4.5 renders raw (not rounded) and bands High via the contiguous ladder', async () => {
    const gridpoint = buildGridpoint({ hainesIndex: 4.5 });
    const text = textOf(
      await callNoaa(buildObservation(16090), { include_fire_weather: true }, gridpoint)
    );
    expect(text).toContain('**🟠 Haines Index:** 4.5 (High)');
  });

  it('Grassland Fire Danger 2.5 renders raw (not rounded) and bands High via the contiguous ladder', async () => {
    const gridpoint = buildGridpoint({ grasslandFireDangerIndex: 2.5 });
    const text = textOf(
      await callNoaa(buildObservation(16090), { include_fire_weather: true }, gridpoint)
    );
    expect(text).toContain('**🟠 Grassland Fire Danger:** 2.5 (High)');
  });
});

// ---------------------------------------------------------------------------
// 3. Fire weather — Open-Meteo path (VPD, topsoil moisture)
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — fire-weather Open-Meteo dryness context keys on the printed figure', () => {
  it('VPD 0.96 kPa displays as 1.0 and bands moderate (moved row)', async () => {
    const response = buildOpenMeteoCurrentResponse({ vapour_pressure_deficit: 0.96, soil_moisture_0_to_1cm: null });
    const text = textOf(await callOpenMeteo(response));
    expect(text).toContain('**Vapour-pressure deficit:** 1.0 kPa (moderate drying power)');
  });

  it('VPD 0.94 kPa displays as 0.9 and stays low (control — does not move)', async () => {
    const response = buildOpenMeteoCurrentResponse({ vapour_pressure_deficit: 0.94, soil_moisture_0_to_1cm: null });
    const text = textOf(await callOpenMeteo(response));
    expect(text).toContain('**Vapour-pressure deficit:** 0.9 kPa (low drying power)');
  });

  it('topsoil moisture 0.0996 displays as 0.10 and bands dry (moved row)', async () => {
    const response = buildOpenMeteoCurrentResponse({ vapour_pressure_deficit: null, soil_moisture_0_to_1cm: 0.0996 });
    const text = textOf(await callOpenMeteo(response));
    expect(text).toContain('**Topsoil moisture (top 1 cm):** 0.10 m³/m³ (dry)');
  });

  it('topsoil moisture 0.094 displays as 0.09 and stays very dry (control — does not move)', async () => {
    // Not 0.0994: (0.0994).toFixed(2) is ALSO "0.10", so it would not
    // discriminate the fix from the bug. 0.094 -> 0.09 is a genuine control.
    const response = buildOpenMeteoCurrentResponse({ vapour_pressure_deficit: null, soil_moisture_0_to_1cm: 0.094 });
    const text = textOf(await callOpenMeteo(response));
    expect(text).toContain('**Topsoil moisture (top 1 cm):** 0.09 m³/m³ (very dry)');
  });
});

// ---------------------------------------------------------------------------
// 4. Untouched paths, pinned
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — untouched fire-weather sites stay as they are', () => {
  it('METAR source renders the not-available note verbatim and no Red Flag / Vapour-pressure line', async () => {
    const noaa = {
      getCurrentConditions: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
      getStations: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
      getLatestObservation: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
      getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
    };
    const openMeteo = {
      getCurrentConditions: vi.fn().mockRejectedValue(new Error('Open-Meteo not expected on the METAR path')),
      getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    };
    const ncei = { isAvailable: vi.fn().mockReturnValue(false) };
    const aviation = {
      getMetarsInBoundingBox: vi.fn<[BoundingBox], Promise<MetarObservation[]>>().mockResolvedValueOnce([buildMetarObservation()]),
    };

    const result = await handleGetCurrentConditions(
      { ...SEATTLE, source: 'metar', include_fire_weather: true },
      noaa as unknown as NOAAService,
      openMeteo as unknown as OpenMeteoService,
      ncei as unknown as NCEIService,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService,
      undefined,
      aviation as unknown as AviationWeatherService
    );
    const text = textOf(result);

    expect(text).toContain('## Fire Weather');
    expect(text).toContain(
      'Fire weather indices are not available on the METAR source — they require NOAA gridpoint data. ' +
        'Use `source: "noaa"` for a US location, or omit `source` to get a server-computed Fosberg index from model data elsewhere.'
    );
    expect(text).not.toContain('Red Flag');
    expect(text).not.toContain('Vapour-pressure');
  });

  it('Fosberg index still renders Math.round(index) with its category, unchanged by this plan', async () => {
    // 60°F, 55% RH, 10 mph (default fixture) -> FFWI ~= 15.906 -> rounds 16, Low.
    const response = buildOpenMeteoCurrentResponse({
      vapour_pressure_deficit: null,
      soil_moisture_0_to_1cm: null,
    });
    const text = textOf(await callOpenMeteo(response, { units: 'imperial' }));
    expect(text).toContain('**🟢 Fosberg Fire Weather Index:** 16 (Low)');
  });
});

// ---------------------------------------------------------------------------
// 5. get_weather_summary — G19: subArgs is the summary's OWN object, not the
// caller's. Driving the real handleGetWeatherSummary with service fakes
// (not handler mocks — see tests/unit/weather-summary-handler.test.ts for
// the handler-mock pattern this deliberately does NOT copy) proves what
// actually reaches the sub-handler, rather than assuming.
//
// Reading weatherSummaryHandler.ts: `subArgs = { ...args, latitude,
// longitude, location_name: undefined, city_name: undefined,
// compare_models: undefined, ensemble_spread: undefined, detail }`. Only
// location fields and the two forecast-only flags are stripped/overridden;
// `units`/`units_*`/`include_fire_weather`/`source` all pass through
// unchanged from the caller's own args because the spread runs first. `detail`
// is always overridden to the computed value (default 'summary', not
// 'standard'), but currentConditionsHandler.ts never reads `detail` at all,
// so the current-conditions section is identical at either level.
// ---------------------------------------------------------------------------

describe('handleGetWeatherSummary — forwards units to the current-conditions section via its own subArgs (G19)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function callSummary(args: Record<string, unknown>) {
    const noaa = buildNoaaFake(buildObservation(16090));
    const support = buildSupportFakes();
    return handleGetWeatherSummary(
      { ...US_COORDS, include: ['current'], ...args },
      noaa as unknown as NOAAService,
      support.openMeteo as unknown as OpenMeteoService,
      support.ncei as unknown as NCEIService,
      support.locationStore as unknown as LocationStore,
      support.geocoding as unknown as GeocodingService
    );
  }

  it('carries the fixed visibility line at an explicit detail: "standard"', async () => {
    const text = textOf(await callSummary({ detail: 'standard' }));
    expect(text).toContain('# Weather Summary');
    expect(text).toContain('Current Weather Conditions');
    expect(text).toContain('**Visibility:** 10.0 miles (clear)');
  });

  it('carries the fixed visibility line at the summary\'s default detail ("summary", not "standard")', async () => {
    const text = textOf(await callSummary({}));
    expect(text).toContain('# Weather Summary');
    expect(text).toContain('**Visibility:** 10.0 miles (clear)');
  });

  it('forwards the caller\'s units preference (metric) through to the current-conditions section', async () => {
    const text = textOf(await callSummary({ units: 'metric' }));
    expect(text).toContain('**Visibility:** 16.1 km (clear)');
  });
});
