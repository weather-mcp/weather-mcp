/**
 * Handler unit tests for `source: 'metar'` on `get_current_conditions` (T6).
 *
 * Exercises the real `handleGetCurrentConditions` / `formatMetarCurrentConditions`
 * path with plain fake services — no HTTP, no live network, no timers. Pins:
 *
 *   - D1 no-change guarantee: `auto` never touches the aviation fake, for a
 *     US point and a non-US point alike.
 *   - Routing: `source: 'metar'` uses only the aviation fake.
 *   - Tier widening (SEARCH_TIERS) stops as soon as a tier yields a usable
 *     station.
 *   - The far/stale/SPECI caveat lines, each independently gated.
 *   - Sparse-report rendering: absent optional fields are omitted, not
 *     blanked (`undefined`/`NaN` must never appear).
 *   - `wdir: "VRB"` and `visib: "10+"` parsing edge cases.
 *   - The no-station message, with no fallback to Open-Meteo.
 *   - `include_normals` (renders on METAR path; no ACIS call for non-US) and
 *     `include_fire_weather` (not-available note).
 *   - Unit preferences (imperial vs metric labels).
 *   - Missing `aviationWeatherService` throws `ServiceUnavailableError`.
 *
 * Modeled on tests/unit/current-conditions-global.test.ts and
 * tests/unit/almanac-handler.test.ts: the real handler is exercised end to
 * end with plain fake services (vi.fn() spies returning canned fixtures).
 *
 * See docs/metar-plan.md D1 (surface), D5 (output), D7 (scope).
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { dayOfYearIndex } from '../../src/services/acis.js';
import { SEARCH_TIERS } from '../../src/utils/metarStation.js';
import { ServiceUnavailableError } from '../../src/errors/ApiError.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { AcisService } from '../../src/services/acis.js';
import type { AviationWeatherService } from '../../src/services/aviationWeather.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { BoundingBox, MetarObservation } from '../../src/types/aviationWeather.js';
import type { DailyRecords, DailyRecordSlot } from '../../src/types/acis.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Seattle, WA — a US point, well inside the NOAA routing box. */
const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };
/** London, UK — outside the US routing box. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

/** obsTime relative to "now" so fixtures never rot into staleness by clock drift. */
function obsTimeMinutesAgo(ageMinutes: number): number {
  return Math.round((Date.now() - ageMinutes * 60000) / 1000);
}

/**
 * A complete, "good" METAR observation near the requested point (~1 km
 * offset — comfortably inside the 100 km near band), fresh (20 minutes old).
 * Individual tests override just the fields under test.
 */
function buildMetarObservation(overrides: Partial<MetarObservation> = {}): MetarObservation {
  const nowIso = new Date().toISOString();
  return {
    icaoId: 'KSEA',
    name: 'Seattle-Tacoma Intl',
    lat: SEATTLE.latitude + 0.01,
    lon: SEATTLE.longitude + 0.01,
    elev: 130,
    obsTime: obsTimeMinutesAgo(20),
    reportTime: nowIso,
    receiptTime: nowIso,
    rawOb: 'METAR KSEA 131453Z 19006KT 10SM FEW250 20/10 A3000',
    metarType: 'METAR',
    qcField: 0,
    temp: 20,
    dewp: 10,
    wdir: 190,
    wspd: 6,
    wgst: 18,
    altim: 1015,
    slp: 1016,
    visib: 10,
    clouds: [{ cover: 'FEW', base: 25000 }],
    fltCat: 'VFR',
    wxString: 'BR',
    ...overrides,
  };
}

/**
 * Fake aviation service. `tierResponses[i]` is what the i-th call to
 * `getMetarsInBoundingBox` resolves to; any call beyond the supplied list
 * resolves to `[]` (defensive — should not happen if the ladder is short
 * enough for the test).
 */
function buildAviationFake(...tierResponses: MetarObservation[][]) {
  const fn = vi.fn<[BoundingBox], Promise<MetarObservation[]>>();
  for (const response of tierResponses) {
    fn.mockResolvedValueOnce(response);
  }
  fn.mockResolvedValue([]);
  return { getMetarsInBoundingBox: fn };
}

function buildNoaaFake() {
  return {
    getCurrentConditions: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
    getStations: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
    getLatestObservation: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
  };
}

function buildOpenMeteoCurrentResponse(timezone = 'Europe/London'): OpenMeteoForecastResponse {
  return {
    latitude: 51.5,
    longitude: -0.13,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone,
    timezone_abbreviation: 'GMT',
    elevation: 11,
    current: {
      time: '2024-01-01T12:00',
      interval: 900,
      temperature_2m: 50,
      relative_humidity_2m: 55,
      apparent_temperature: 50,
      dew_point_2m: 45,
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
    },
    daily: {
      time: ['2024-01-01'],
      temperature_2m_max: [55],
      temperature_2m_min: [45],
    },
  };
}

function buildOpenMeteoFake() {
  return {
    getCurrentConditions: vi.fn().mockResolvedValue(buildOpenMeteoCurrentResponse()),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    getClimateNormals: vi.fn().mockResolvedValue({
      tempHigh: 65,
      tempLow: 45,
      precipitation: 0.1,
      source: 'Open-Meteo',
      month: 1,
      day: 1,
    }),
  };
}

/** NCEI unavailable, so getClimateNormals always falls through to Open-Meteo. */
function buildNceiFake() {
  return { isAvailable: vi.fn().mockReturnValue(false) };
}

/** Build a 366-slot daily-records table with exactly one usable slot. */
function buildDailyRecords(month: number, day: number, slot: DailyRecordSlot, porStartYear = 1945): DailyRecords {
  const days: DailyRecordSlot[] = Array.from({ length: 366 }, () => ({}));
  days[dayOfYearIndex(month, day)] = slot;
  return { stationName: 'Test Station', porStartYear, days };
}

function buildAcisFake(records: DailyRecords) {
  return {
    findRecordsStation: vi.fn().mockResolvedValue({
      id: 'TESTthr',
      name: records.stationName,
      porStartYear: records.porStartYear,
    }),
    getDailyRecords: vi.fn().mockResolvedValue(records),
  };
}

/** Spy that must never be invoked — used for the non-US negative assertion. */
function buildNeverCalledAcisFake() {
  return {
    findRecordsStation: vi.fn(),
    getDailyRecords: vi.fn(),
  };
}

interface Fakes {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  ncei: ReturnType<typeof buildNceiFake>;
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
}

function buildFakes(): Fakes {
  return {
    noaa: buildNoaaFake(),
    openMeteo: buildOpenMeteoFake(),
    ncei: buildNceiFake(),
    locationStore: {},
    geocoding: {},
  };
}

function callCurrentConditions(
  args: Record<string, unknown>,
  fakes: Fakes,
  acisService?: { findRecordsStation: ReturnType<typeof vi.fn>; getDailyRecords: ReturnType<typeof vi.fn> },
  aviationWeatherService?: { getMetarsInBoundingBox: ReturnType<typeof vi.fn> }
) {
  return handleGetCurrentConditions(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.ncei as unknown as NCEIService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService,
    acisService as unknown as AcisService | undefined,
    aviationWeatherService as unknown as AviationWeatherService | undefined
  );
}

// ---------------------------------------------------------------------------
// 1. Routing — source: 'metar' uses only the aviation fake
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — source: "metar" routing', () => {
  it('makes no NOAA and no Open-Meteo call', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([buildMetarObservation()]);

    await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);

    expect(aviation.getMetarsInBoundingBox).toHaveBeenCalled();
    expect(fakes.noaa.getCurrentConditions).not.toHaveBeenCalled();
    expect(fakes.openMeteo.getCurrentConditions).not.toHaveBeenCalled();
  });

  it('produces the METAR data-source footer', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([buildMetarObservation()]);

    const result = await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);
    const text = textOf(result);

    expect(text).toContain(
      '*Data source: NOAA Aviation Weather Center (aviationweather.gov) — METAR station observation*'
    );
    expect(text).toContain('KSEA');
  });
});

// ---------------------------------------------------------------------------
// 2. D1 no-change guarantee — `auto` never touches the aviation fake
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — D1 no-change guarantee (auto never routes to METAR)', () => {
  it('makes zero aviation calls for a US point on auto', async () => {
    const fakes = buildFakes();
    // The NOAA path drives getStations + getLatestObservation directly
    // (F2/D2c retry loop) — the fake mirrors that call graph. The
    // getCurrentConditions wrapper is public API but no longer handler-called.
    fakes.noaa = {
      getCurrentConditions: vi.fn().mockRejectedValue(new Error('wrapper no longer called')),
      getStations: vi.fn().mockResolvedValue({
        features: [
          {
            properties: {
              stationIdentifier: 'KDCA',
              name: 'Test Station',
              timeZone: 'America/New_York',
            },
          },
        ],
      }),
      getLatestObservation: vi.fn().mockResolvedValue({
        properties: {
          station: 'https://api.weather.gov/stations/KDCA',
          timestamp: '2024-01-01T12:00:00+00:00',
          textDescription: 'Sunny',
          temperature: { unitCode: 'wmoUnit:degC', value: 20 },
          dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
          relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
        },
      }),
      getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not requested')),
    };
    const aviation = buildAviationFake([buildMetarObservation()]);

    await callCurrentConditions({ ...SEATTLE }, fakes, undefined, aviation);

    expect(aviation.getMetarsInBoundingBox).not.toHaveBeenCalled();
    expect(fakes.noaa.getLatestObservation).toHaveBeenCalledTimes(1);
  });

  it('makes zero aviation calls for a non-US point on auto', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([buildMetarObservation()]);

    await callCurrentConditions({ ...LONDON }, fakes, undefined, aviation);

    expect(aviation.getMetarsInBoundingBox).not.toHaveBeenCalled();
    expect(fakes.openMeteo.getCurrentConditions).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Tier widening
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — METAR search-tier widening', () => {
  it('stops at tier 1 when it yields a usable station', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([buildMetarObservation()]);

    await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);

    expect(aviation.getMetarsInBoundingBox).toHaveBeenCalledTimes(1);
    const bbox = aviation.getMetarsInBoundingBox.mock.calls[0][0] as BoundingBox;
    expect(bbox.maxLat - bbox.minLat).toBeCloseTo(2 * SEARCH_TIERS[0], 10);
  });

  it('widens to tier 2 when tier 1 is empty, and stops there', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([], [buildMetarObservation()]);

    await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);

    expect(aviation.getMetarsInBoundingBox).toHaveBeenCalledTimes(2);
    const firstBbox = aviation.getMetarsInBoundingBox.mock.calls[0][0] as BoundingBox;
    const secondBbox = aviation.getMetarsInBoundingBox.mock.calls[1][0] as BoundingBox;
    expect(firstBbox.maxLat - firstBbox.minLat).toBeCloseTo(2 * SEARCH_TIERS[0], 10);
    expect(secondBbox.maxLat - secondBbox.minLat).toBeCloseTo(2 * SEARCH_TIERS[1], 10);
  });

  it('widens through all three tiers before giving up', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([], [], []);

    const result = await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);
    const text = textOf(result);

    expect(aviation.getMetarsInBoundingBox).toHaveBeenCalledTimes(SEARCH_TIERS.length);
    expect(text).toContain('No Station Nearby');
  });
});

// ---------------------------------------------------------------------------
// 4. Caveat lines — each independently gated
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — METAR caveat lines', () => {
  it('shows the far-station caveat (100-250 km) and not the stale one', async () => {
    const fakes = buildFakes();
    // ~1.3 deg of latitude is ~144 km — inside the 100-250 km far band.
    const farStation = buildMetarObservation({
      lat: SEATTLE.latitude + 1.3,
      lon: SEATTLE.longitude,
      obsTime: obsTimeMinutesAgo(20), // fresh
    });
    const aviation = buildAviationFake([farStation]);

    const result = await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);
    const text = textOf(result);

    expect(text).toContain('**Nearest station is');
    expect(text).not.toContain('**Observation is');
  });

  it('shows the stale-observation caveat (90 min - 6 h) and not the far one', async () => {
    const fakes = buildFakes();
    const staleStation = buildMetarObservation({
      obsTime: obsTimeMinutesAgo(120), // stale but within 6h
    });
    const aviation = buildAviationFake([staleStation]);

    const result = await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);
    const text = textOf(result);

    expect(text).toContain('**Observation is');
    expect(text).not.toContain('**Nearest station is');
  });

  it('shows the SPECI caveat when metarType is SPECI', async () => {
    const fakes = buildFakes();
    const speciStation = buildMetarObservation({ metarType: 'SPECI' });
    const aviation = buildAviationFake([speciStation]);

    const result = await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);
    const text = textOf(result);

    expect(text).toContain('**Special report (SPECI):**');
  });

  it('shows none of the three caveats for a near, fresh, routine METAR', async () => {
    const fakes = buildFakes();
    const goodStation = buildMetarObservation({ metarType: 'METAR', obsTime: obsTimeMinutesAgo(20) });
    const aviation = buildAviationFake([goodStation]);

    const result = await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);
    const text = textOf(result);

    expect(text).not.toContain('**Nearest station is');
    expect(text).not.toContain('**Observation is');
    expect(text).not.toContain('**Special report (SPECI):**');
  });
});

// ---------------------------------------------------------------------------
// 5. Sparse rendering — absent optional fields are omitted, never blanked
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — METAR sparse-report rendering', () => {
  it('omits wgst/wxString/slp/visib/clouds/fltCat lines entirely when absent', async () => {
    const fakes = buildFakes();
    const sparse = buildMetarObservation({
      wgst: undefined,
      wxString: undefined,
      slp: undefined,
      visib: undefined,
      clouds: undefined,
      fltCat: undefined,
    });
    const aviation = buildAviationFake([sparse]);

    const result = await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);
    const text = textOf(result);

    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('gusting to');
    expect(text).not.toContain('**Weather:**');
    expect(text).not.toContain('(sea level');
    expect(text).not.toContain('**Visibility:**');
    expect(text).not.toContain('**Sky:**');
    expect(text).not.toContain('**Flight category:**');
    // Pressure still renders from altim alone.
    expect(text).toContain('**Pressure:**');
  });

  it('renders the rest of the report when temp is missing (falls back to Dew Point line)', async () => {
    const fakes = buildFakes();
    const noTemp = buildMetarObservation({ temp: undefined, dewp: 10 });
    const aviation = buildAviationFake([noTemp]);

    const result = await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);
    const text = textOf(result);

    expect(text).not.toContain('**Temperature:**');
    expect(text).toContain('**Dew Point:**');
    expect(text).toContain('**Wind:**');
    expect(text).toContain('**Pressure:**');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });
});

// ---------------------------------------------------------------------------
// 6. Wind direction edge case: "VRB"
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — METAR wdir: "VRB"', () => {
  it('renders "Variable" with no compass point and no degree parenthetical', async () => {
    const fakes = buildFakes();
    const variableWind = buildMetarObservation({ wdir: 'VRB', wspd: 6 });
    const aviation = buildAviationFake([variableWind]);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', units: 'imperial' },
      fakes,
      undefined,
      aviation
    );
    const text = textOf(result);

    expect(text).toContain('**Wind:** Variable at 7 mph');
    // No compass abbreviation and no "(NNN°)" — a real direction would render both.
    expect(text).not.toMatch(/\*\*Wind:\*\*[^\n]*\(\d+°\)/);
  });
});

// ---------------------------------------------------------------------------
// 7. Visibility edge case: "10+"
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — METAR visib: "10+"', () => {
  it('keeps the "+" qualifier rather than rendering a bare value', async () => {
    const fakes = buildFakes();
    const plusVis = buildMetarObservation({ visib: '10+' });
    const aviation = buildAviationFake([plusVis]);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', units: 'imperial' },
      fakes,
      undefined,
      aviation
    );
    const text = textOf(result);

    expect(text).toContain('**Visibility:** +10.0 mi');
    expect(text).not.toContain('**Visibility:** 10.0 mi');
  });
});

// ---------------------------------------------------------------------------
// 8. No station found
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — no METAR station within any tier', () => {
  it('returns the friendly no-station message without throwing, and never calls Open-Meteo', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([], [], []);

    const result = await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);
    const text = textOf(result);

    expect(text).toContain('No reporting station near this location');
    expect(fakes.openMeteo.getCurrentConditions).not.toHaveBeenCalled();
  });

  it('also returns the no-station message when every candidate is beyond 250 km', async () => {
    const fakes = buildFakes();
    // ~3 deg of latitude is ~333 km — beyond FAR_MAX_KM at every tier.
    const tooFar = buildMetarObservation({ lat: SEATTLE.latitude + 3.0, lon: SEATTLE.longitude });
    const aviation = buildAviationFake([tooFar], [tooFar], [tooFar]);

    const result = await callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, aviation);
    const text = textOf(result);

    expect(text).toContain('No reporting station near this location');
    expect(fakes.openMeteo.getCurrentConditions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. include_normals on the METAR path
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — include_normals on the METAR path', () => {
  it('renders normals + US records for a US point when an acisService is supplied', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([buildMetarObservation()]);
    // The observation's obsTime is relative to "now" (see obsTimeMinutesAgo),
    // so the records slot must be built for today's month/day, not a fixed date.
    const now = new Date();
    const records = buildDailyRecords(now.getMonth() + 1, now.getDate(), {
      high: { value: 96, year: 1977 },
      low: { value: 49, year: 1953 },
    });
    const acis = buildAcisFake(records);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', include_normals: true },
      fakes,
      acis,
      aviation
    );
    const text = textOf(result);

    expect(text).toContain('Climate Context');
    expect(text).toContain('Records: NOAA Regional Climate Centers (ACIS)');
    expect(acis.findRecordsStation).toHaveBeenCalledTimes(1);
  });

  it('makes no ACIS call for a non-US point even with include_normals + acisService present', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([
      buildMetarObservation({ icaoId: 'EGLL', name: 'London Heathrow', lat: LONDON.latitude + 0.01, lon: LONDON.longitude + 0.01 }),
    ]);
    const acis = buildNeverCalledAcisFake();

    const result = await callCurrentConditions(
      { ...LONDON, source: 'metar', include_normals: true },
      fakes,
      acis,
      aviation
    );
    const text = textOf(result);

    expect(acis.findRecordsStation).not.toHaveBeenCalled();
    expect(acis.getDailyRecords).not.toHaveBeenCalled();
    expect(text).not.toContain('Records: NOAA Regional Climate Centers (ACIS)');
  });
});

// ---------------------------------------------------------------------------
// 10. include_fire_weather on the METAR path
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — include_fire_weather on the METAR path', () => {
  it('renders the "not available on the METAR source" note', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([buildMetarObservation()]);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', include_fire_weather: true },
      fakes,
      undefined,
      aviation
    );
    const text = textOf(result);

    expect(text).toContain('Fire weather indices are not available on the METAR source');
    expect(text).toContain('source: "noaa"');
    expect(text).toContain('omit `source`');
    expect(text).toContain('server-computed Fosberg index');
  });
});

// ---------------------------------------------------------------------------
// 11. Unit preferences
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — METAR unit preferences', () => {
  it('renders imperial labels (°F, mph, inHg, ft)', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([buildMetarObservation()]);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', units: 'imperial' },
      fakes,
      undefined,
      aviation
    );
    const text = textOf(result);

    expect(text).toMatch(/°F/);
    expect(text).toMatch(/mph/);
    expect(text).toMatch(/inHg/);
    expect(text).toMatch(/ft/);
    expect(text).not.toContain('°C');
    expect(text).not.toContain('km/h');
    expect(text).not.toContain('hPa');
  });

  it('renders metric labels (°C, km/h, hPa, m)', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([buildMetarObservation()]);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', units: 'metric' },
      fakes,
      undefined,
      aviation
    );
    const text = textOf(result);

    expect(text).toMatch(/°C/);
    expect(text).toMatch(/km\/h/);
    expect(text).toMatch(/hPa/);
    expect(text).not.toContain('°F');
    expect(text).not.toContain('mph');
    expect(text).not.toContain('inHg');
  });
});

// ---------------------------------------------------------------------------
// 12. No aviation service injected
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — source: "metar" with no aviationWeatherService', () => {
  it('throws a clean ServiceUnavailableError, not a crash', async () => {
    const fakes = buildFakes();

    await expect(
      callCurrentConditions({ ...SEATTLE, source: 'metar' }, fakes, undefined, undefined)
    ).rejects.toThrow(ServiceUnavailableError);
  });
});
