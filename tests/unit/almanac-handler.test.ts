/**
 * Handler unit tests for the almanac features (v1.16.0 / T5):
 *   - `include_astronomy` on `get_forecast` — validation, placement on both
 *     provider paths (Open-Meteo daily sun-line anchor, NOAA per-calendar-date
 *     anchor incl. a "Tonight"-first response), hourly-ignores-flag, flag-off
 *     byte-identical behavior.
 *   - US temperature records gating on `get_current_conditions`'
 *     `include_normals` path — renders only when normals + US + an
 *     `acisService` are all present, never calls ACIS for non-US locations,
 *     and stays independent of the normals fetch succeeding or failing (A5).
 *
 * Modeled on tests/unit/forecast-fallback.test.ts and
 * tests/unit/current-conditions-global.test.ts: the real handlers are
 * exercised end to end with plain fake services (vi.fn() spies returning
 * canned fixtures) — no HTTP, no live network calls, fully deterministic.
 *
 * See docs/plans/almanac-implementation-plan.md T5.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { dayOfYearIndex } from '../../src/services/acis.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { AcisService } from '../../src/services/acis.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import type { ForecastPeriod } from '../../src/types/noaa.js';
import type { DailyRecords, DailyRecordSlot } from '../../src/types/acis.js';

// ---------------------------------------------------------------------------
// Shared fixtures / fakes
// ---------------------------------------------------------------------------

/** Paris, France — outside the US routing boxes, drives the Open-Meteo path. */
const PARIS = { latitude: 48.8566, longitude: 2.3522 };
/** Washington, DC — inside the US routing boxes, drives the NOAA path. */
const US_COORDS = { latitude: 38.8951, longitude: -77.0364 };
/** London, UK — outside the US routing boxes; used for the non-US records gate. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

/** Count non-overlapping occurrences of a literal substring. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

interface ForecastFakes {
  noaa: ReturnType<typeof buildNoaaForecastFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoForecastFake>;
  ncei: { isAvailable: ReturnType<typeof vi.fn> };
  acis: ReturnType<typeof buildAcisFake> | undefined;
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
}

function buildNceiFake() {
  return { isAvailable: vi.fn().mockReturnValue(false) };
}

// --- Open-Meteo forecast fixtures -------------------------------------------------

function buildOpenMeteoDailyForecastResponse(days: string[], timezone = 'Europe/Paris'): OpenMeteoForecastResponse {
  return {
    latitude: 48.86,
    longitude: 2.35,
    generationtime_ms: 0.1,
    utc_offset_seconds: 3600,
    timezone,
    timezone_abbreviation: 'CET',
    elevation: 35,
    daily: {
      time: days,
      temperature_2m_max: days.map(() => 25),
      temperature_2m_min: days.map(() => 15),
      sunrise: days.map(d => `${d}T06:00`),
      sunset: days.map(d => `${d}T21:00`),
    },
  };
}

function buildOpenMeteoHourlyForecastResponse(timezone = 'Europe/Paris'): OpenMeteoForecastResponse {
  return {
    latitude: 48.86,
    longitude: 2.35,
    generationtime_ms: 0.1,
    utc_offset_seconds: 3600,
    timezone,
    timezone_abbreviation: 'CET',
    elevation: 35,
    hourly: {
      time: ['2026-08-12T00:00', '2026-08-12T01:00'],
      temperature_2m: [18, 17],
    },
  };
}

function buildOpenMeteoForecastFake(response: OpenMeteoForecastResponse) {
  return {
    getForecast: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    getClimateNormals: vi.fn().mockRejectedValue(new Error('normals not configured for this fixture')),
  };
}

// --- NOAA forecast fixtures -------------------------------------------------------

function buildNoaaPoints(timeZone = 'America/Los_Angeles') {
  return {
    properties: {
      gridId: 'TEST',
      gridX: 1,
      gridY: 1,
      timeZone,
    },
  };
}

function buildForecastPeriod(overrides: Partial<ForecastPeriod>): ForecastPeriod {
  return {
    number: 1,
    name: 'Day',
    startTime: '2026-08-12T06:00:00-07:00',
    endTime: '2026-08-12T18:00:00-07:00',
    isDaytime: true,
    temperature: 75,
    temperatureUnit: 'F',
    temperatureTrend: null,
    probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: null },
    dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
    relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    windSpeed: '5 mph',
    windDirection: 'N',
    icon: '',
    shortForecast: 'Sunny',
    detailedForecast: 'Sunny throughout.',
    ...overrides,
  } as ForecastPeriod;
}

function buildNoaaForecastResponse(periods: ForecastPeriod[]) {
  return {
    properties: {
      updated: '2026-08-12T00:00:00-07:00',
      units: 'us',
      forecastGenerator: 'test',
      generatedAt: '2026-08-12T00:00:00-07:00',
      updateTime: '2026-08-12T00:00:00-07:00',
      validTimes: '2026-08-12T00:00:00-07:00/P7D',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      periods,
    },
  };
}

function buildNoaaForecastFake(periods: ForecastPeriod[] = [buildForecastPeriod({})]) {
  return {
    getPointData: vi.fn().mockResolvedValue(buildNoaaPoints()),
    getForecast: vi.fn().mockResolvedValue(buildNoaaForecastResponse(periods)),
    getHourlyForecast: vi.fn().mockResolvedValue(buildNoaaForecastResponse(periods)),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
  };
}

function buildForecastFakes(overrides: Partial<ForecastFakes> = {}): ForecastFakes {
  return {
    noaa: buildNoaaForecastFake(),
    openMeteo: buildOpenMeteoForecastFake(buildOpenMeteoDailyForecastResponse(['2026-08-12'])),
    ncei: buildNceiFake(),
    acis: undefined,
    locationStore: {},
    geocoding: {},
    ...overrides,
  };
}

function callForecast(args: Record<string, unknown>, fakes: ForecastFakes) {
  return handleGetForecast(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService,
    fakes.ncei as unknown as NCEIService,
    fakes.acis as unknown as AcisService | undefined
  );
}

// --- Current-conditions (records gating) fixtures ---------------------------------

function buildNOAACurrentObservation(timestamp = '2024-01-01T12:00:00+00:00') {
  return {
    properties: {
      '@id': 'https://api.weather.gov/stations/KDCA/observations/2024-01-01T12:00:00+00:00',
      '@type': 'wx:ObservationStation',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      station: 'https://api.weather.gov/stations/KDCA',
      timestamp,
      textDescription: 'Sunny',
      temperature: { unitCode: 'wmoUnit:degC', value: 20 },
      dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
      windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 270 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 10 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    },
  };
}

function buildNOAAStations() {
  return {
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          '@id': 'https://api.weather.gov/stations/KDCA',
          '@type': 'wx:ObservationStation',
          elevation: { unitCode: 'wmoUnit:m', value: 10 },
          stationIdentifier: 'KDCA',
          name: 'Test Station',
          timeZone: 'America/New_York',
        },
      },
    ],
  };
}

function buildNoaaCurrentFake() {
  return {
    getCurrentConditions: vi.fn().mockResolvedValue(buildNOAACurrentObservation()),
    getStations: vi.fn().mockResolvedValue(buildNOAAStations()),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('fire weather not requested')),
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

/** Open-Meteo fake whose `getClimateNormals` succeeds — the NCEI-unavailable fallback. */
function buildOpenMeteoCurrentFake(response: OpenMeteoForecastResponse = buildOpenMeteoCurrentResponse()) {
  return {
    getCurrentConditions: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    getClimateNormals: vi.fn().mockResolvedValue({
      tempHigh: 40,
      tempLow: 25,
      precipitation: 0.1,
      source: 'Open-Meteo',
      month: 1,
      day: 1,
    }),
  };
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

function buildFailingAcisFake() {
  return {
    findRecordsStation: vi.fn().mockRejectedValue(new Error('No ACIS station found near this location')),
    getDailyRecords: vi.fn(),
  };
}

/** Spy that must never be invoked — used for the non-US negative assertion. */
function buildNeverCalledAcisFake() {
  return {
    findRecordsStation: vi.fn(),
    getDailyRecords: vi.fn(),
  };
}

interface CurrentFakes {
  noaa: ReturnType<typeof buildNoaaCurrentFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoCurrentFake>;
  ncei: { isAvailable: ReturnType<typeof vi.fn> };
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
}

function buildCurrentFakes(openMeteoResponse?: OpenMeteoForecastResponse): CurrentFakes {
  return {
    noaa: buildNoaaCurrentFake(),
    openMeteo: buildOpenMeteoCurrentFake(openMeteoResponse),
    ncei: buildNceiFake(),
    locationStore: {},
    geocoding: {},
  };
}

function callCurrentConditions(
  args: Record<string, unknown>,
  fakes: CurrentFakes,
  acisService?: { findRecordsStation: ReturnType<typeof vi.fn>; getDailyRecords: ReturnType<typeof vi.fn> }
) {
  return handleGetCurrentConditions(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.ncei as unknown as NCEIService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService,
    acisService as unknown as AcisService | undefined
  );
}

// ---------------------------------------------------------------------------
// 1. include_astronomy validation
// ---------------------------------------------------------------------------

describe('handleGetForecast — include_astronomy validation', () => {
  it('rejects a non-boolean include_astronomy, naming the parameter', async () => {
    const fakes = buildForecastFakes();

    await expect(
      callForecast({ ...PARIS, include_astronomy: 'yes' }, fakes)
    ).rejects.toThrow(/include_astronomy/);
  });

  it('rejects a numeric include_astronomy', async () => {
    const fakes = buildForecastFakes();

    await expect(
      callForecast({ ...PARIS, include_astronomy: 1 }, fakes)
    ).rejects.toThrow(/include_astronomy/);
  });
});

// ---------------------------------------------------------------------------
// 2. Open-Meteo daily path
// ---------------------------------------------------------------------------

describe('handleGetForecast — include_astronomy on the Open-Meteo daily path', () => {
  it('renders Moon/Twilight per day and exactly one Next full moon line before the footer', async () => {
    const days = ['2026-08-12', '2026-08-13', '2026-08-14'];
    const fakes = buildForecastFakes({
      openMeteo: buildOpenMeteoForecastFake(buildOpenMeteoDailyForecastResponse(days)),
    });

    const result = await callForecast({ ...PARIS, days: 3, include_astronomy: true }, fakes);
    const text = textOf(result);

    expect(countOccurrences(text, '**Moon:**')).toBe(3);
    expect(countOccurrences(text, '**Twilight:**')).toBe(3);
    expect(countOccurrences(text, '**Next full moon:**')).toBe(1);

    const nextFullMoonIndex = text.indexOf('**Next full moon:**');
    const footerIndex = text.indexOf('*Data source: Open-Meteo (Global)*');
    expect(nextFullMoonIndex).toBeGreaterThan(-1);
    expect(footerIndex).toBeGreaterThan(-1);
    expect(nextFullMoonIndex).toBeLessThan(footerIndex);

    // Placed after the Sunset line, ahead of Daylight Duration, on each day.
    const sunsetIndex = text.indexOf('**Sunset:**');
    const firstMoonIndex = text.indexOf('**Moon:**');
    expect(sunsetIndex).toBeGreaterThan(-1);
    expect(sunsetIndex).toBeLessThan(firstMoonIndex);
  });

  it('ignores the flag entirely for hourly granularity', async () => {
    const fakes = buildForecastFakes({
      openMeteo: buildOpenMeteoForecastFake(buildOpenMeteoHourlyForecastResponse()),
    });

    const result = await callForecast(
      { ...PARIS, granularity: 'hourly', include_astronomy: true },
      fakes
    );
    const text = textOf(result);

    expect(text).not.toContain('**Moon:**');
    expect(text).not.toContain('**Twilight:**');
    expect(text).not.toContain('**Next full moon:**');
  });

  it('emits no astronomy strings when the flag is off (default)', async () => {
    const fakes = buildForecastFakes({
      openMeteo: buildOpenMeteoForecastFake(buildOpenMeteoDailyForecastResponse(['2026-08-12', '2026-08-13'])),
    });

    const result = await callForecast({ ...PARIS, days: 2 }, fakes);
    const text = textOf(result);

    expect(text).not.toContain('**Moon:**');
    expect(text).not.toContain('**Twilight:**');
    expect(text).not.toContain('**Next full moon:**');
  });
});

// ---------------------------------------------------------------------------
// 3. NOAA daily path
// ---------------------------------------------------------------------------

describe('handleGetForecast — include_astronomy on the NOAA daily path', () => {
  it('renders the block once per calendar date, including a Tonight-first response', async () => {
    // "Tonight" is the first period and belongs to the same calendar date
    // (Aug 12) as the forecast's day one — the NOAA response shape that
    // motivated Assumption A2's "end of the date's first period" placement.
    const periods = [
      buildForecastPeriod({
        number: 1,
        name: 'Tonight',
        isDaytime: false,
        startTime: '2026-08-12T20:00:00-07:00',
        endTime: '2026-08-13T06:00:00-07:00',
      }),
      buildForecastPeriod({
        number: 2,
        name: 'Wednesday',
        isDaytime: true,
        startTime: '2026-08-13T06:00:00-07:00',
        endTime: '2026-08-13T18:00:00-07:00',
      }),
      buildForecastPeriod({
        number: 3,
        name: 'Wednesday Night',
        isDaytime: false,
        startTime: '2026-08-13T18:00:00-07:00',
        endTime: '2026-08-14T06:00:00-07:00',
      }),
      buildForecastPeriod({
        number: 4,
        name: 'Thursday',
        isDaytime: true,
        startTime: '2026-08-14T06:00:00-07:00',
        endTime: '2026-08-14T18:00:00-07:00',
      }),
    ];
    const fakes = buildForecastFakes({
      noaa: buildNoaaForecastFake(periods),
    });

    const result = await callForecast({ ...US_COORDS, days: 3, include_astronomy: true }, fakes);
    const text = textOf(result);

    // One block per calendar date (Aug 12, Aug 13, Aug 14) — NOT one per period
    // (there are 4 periods but only 3 distinct calendar dates).
    expect(countOccurrences(text, '**Moon:**')).toBe(3);
    expect(countOccurrences(text, '**Twilight:**')).toBe(3);
    expect(countOccurrences(text, '**Next full moon:**')).toBe(1);

    // The Aug 13 block renders at the end of "Wednesday" (the first period of
    // that date) — "Wednesday Night" (the second period of the same date)
    // gets no block of its own.
    const wednesdayNightIndex = text.indexOf('## Wednesday Night');
    const thursdayIndex = text.indexOf('## Thursday');
    expect(wednesdayNightIndex).toBeGreaterThan(-1);
    expect(thursdayIndex).toBeGreaterThan(wednesdayNightIndex);
    expect(text.slice(wednesdayNightIndex, thursdayIndex)).not.toContain('**Moon:**');

    // Next-quarters line renders once, before the NOAA footer.
    const nextFullMoonIndex = text.indexOf('**Next full moon:**');
    const footerIndex = text.indexOf('*Data source: NOAA National Weather Service (US)*');
    expect(nextFullMoonIndex).toBeGreaterThan(-1);
    expect(footerIndex).toBeGreaterThan(-1);
    expect(nextFullMoonIndex).toBeLessThan(footerIndex);
  });

  it('emits no astronomy strings when the flag is off (default)', async () => {
    const periods = [
      buildForecastPeriod({ number: 1, name: 'Today', startTime: '2026-08-12T06:00:00-07:00' }),
      buildForecastPeriod({ number: 2, name: 'Tonight', isDaytime: false, startTime: '2026-08-12T18:00:00-07:00' }),
    ];
    const fakes = buildForecastFakes({ noaa: buildNoaaForecastFake(periods) });

    const result = await callForecast({ ...US_COORDS, days: 1 }, fakes);
    const text = textOf(result);

    expect(text).not.toContain('**Moon:**');
    expect(text).not.toContain('**Twilight:**');
    expect(text).not.toContain('**Next full moon:**');
  });
});

// ---------------------------------------------------------------------------
// 4. US records gating on get_current_conditions' include_normals path
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — US records gating', () => {
  const RECORDS_ATTRIBUTION = 'Records: NOAA Regional Climate Centers (ACIS)';

  it('renders the records line + attribution when normals + US + acisService are all present', async () => {
    const fakes = buildCurrentFakes();
    const records = buildDailyRecords(1, 1, {
      high: { value: 96, year: 1977 },
      low: { value: 49, year: 1953 },
    });
    const acis = buildAcisFake(records);

    const result = await callCurrentConditions({ ...US_COORDS, include_normals: true }, fakes, acis);
    const text = textOf(result);

    expect(text).toContain('**Records for Jan 1:**');
    expect(text).toContain('High 96°F (1977)');
    expect(text).toContain('Low 49°F (1953)');
    expect(text).toContain(RECORDS_ATTRIBUTION);
    expect(acis.findRecordsStation).toHaveBeenCalledTimes(1);
  });

  it('renders no records line when include_normals is true but no acisService is passed', async () => {
    const fakes = buildCurrentFakes();

    const result = await callCurrentConditions({ ...US_COORDS, include_normals: true }, fakes, undefined);
    const text = textOf(result);

    expect(text).not.toContain('**Records for');
    expect(text).not.toContain(RECORDS_ATTRIBUTION);
  });

  it('renders no records line and makes no ACIS call when include_normals is false', async () => {
    const fakes = buildCurrentFakes();
    const records = buildDailyRecords(1, 1, { high: { value: 96, year: 1977 } });
    const acis = buildAcisFake(records);

    const result = await callCurrentConditions({ ...US_COORDS, include_normals: false }, fakes, acis);
    const text = textOf(result);

    expect(text).not.toContain('**Records for');
    expect(text).not.toContain(RECORDS_ATTRIBUTION);
    expect(acis.findRecordsStation).not.toHaveBeenCalled();
  });

  it('makes NO ACIS call for a non-US location, even with include_normals + acisService present', async () => {
    const fakes = buildCurrentFakes(buildOpenMeteoCurrentResponse('Europe/London'));
    const acis = buildNeverCalledAcisFake();

    const result = await callCurrentConditions({ ...LONDON, include_normals: true }, fakes, acis);
    const text = textOf(result);

    expect(acis.findRecordsStation).not.toHaveBeenCalled();
    expect(acis.getDailyRecords).not.toHaveBeenCalled();
    expect(text).not.toContain('**Records for');
    expect(text).not.toContain(RECORDS_ATTRIBUTION);
  });

  it('omits the records line without throwing when ACIS station lookup fails, but normals still render', async () => {
    const fakes = buildCurrentFakes();
    const acis = buildFailingAcisFake();

    const result = await callCurrentConditions({ ...US_COORDS, include_normals: true }, fakes, acis);
    const text = textOf(result);

    expect(text).not.toContain('**Records for');
    expect(text).not.toContain(RECORDS_ATTRIBUTION);
    // Normals themselves succeeded (openMeteo.getClimateNormals fake resolves).
    expect(text).toContain('Climate Context');
  });

  it('still renders the records line (A5) when the normals fetch itself fails', async () => {
    // NCEI unavailable (default fake) routes normals through Open-Meteo; make
    // that fail too so the normals section reports "not available" while the
    // ACIS fake succeeds independently.
    const failingNormalsOpenMeteo = buildOpenMeteoCurrentFake();
    failingNormalsOpenMeteo.getClimateNormals.mockRejectedValue(new Error('normals unavailable'));
    const fakes = buildCurrentFakes();
    fakes.openMeteo = failingNormalsOpenMeteo;

    const records = buildDailyRecords(1, 1, { low: { value: 49, year: 1953 } });
    const acis = buildAcisFake(records);

    const result = await callCurrentConditions({ ...US_COORDS, include_normals: true }, fakes, acis);
    const text = textOf(result);

    expect(text).toContain('Climate normals data not available for this location');
    expect(text).toContain('**Records for Jan 1:**');
    expect(text).toContain('Low 49°F (1953)');
    expect(text).toContain(RECORDS_ATTRIBUTION);
  });
});
