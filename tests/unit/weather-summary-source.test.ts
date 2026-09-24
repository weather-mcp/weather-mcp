/**
 * Handler-level tests for get_weather_summary's `source` parameter and for
 * the removal of `granularity` from the summary's reachable surface (T4 of
 * .devdocs/plan-tool-schema-truth-impl.md).
 *
 * Unlike weather-summary-allowlist.test.ts, this file drives the REAL
 * handleGetForecast and handleGetCurrentConditions through the real
 * handleGetWeatherSummary — no vi.mock at all. Fakes model only the services
 * (NOAA, Open-Meteo), following tests/unit/forecast-noaa-horizon.test.ts
 * (buildForecastFakes / callSummary). Mixing this file's real handlers with
 * the other file's module mocks would shadow one or the other, which is why
 * the two files stay separate.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import type { ForecastPeriod } from '../../src/types/noaa.js';

/** London — outside the US routing boxes, drives the Open-Meteo path. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };
/** Memphis, TN — inside the US routing boxes, drives the NOAA path. */
const MEMPHIS = { latitude: 35.1495, longitude: -90.049 };

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

// ---------------------------------------------------------------------------
// Fixtures — modeled on tests/unit/forecast-noaa-horizon.test.ts.
// ---------------------------------------------------------------------------

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

function buildNoaaPoints(timeZone = 'America/Chicago') {
  return {
    properties: {
      gridId: 'TEST',
      gridX: 1,
      gridY: 1,
      timeZone,
    },
  };
}

function buildNoaaForecastResponse(periods: ForecastPeriod[]) {
  return {
    properties: {
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

function buildDailyPeriods(days: number): ForecastPeriod[] {
  const periods: ForecastPeriod[] = [];
  for (let i = 0; i < days; i++) {
    periods.push(buildForecastPeriod({ number: periods.length + 1, name: `Day${i}`, isDaytime: true }));
    periods.push(buildForecastPeriod({ number: periods.length + 1, name: `Day${i} Night`, isDaytime: false }));
  }
  return periods;
}

/** A healthy NOAA forecast + observation fake — reachable only when routing
 * actually lands on NOAA. */
function buildNoaaFake(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getPointData: vi.fn().mockResolvedValue(buildNoaaPoints()),
    getForecast: vi.fn().mockResolvedValue(buildNoaaForecastResponse(buildDailyPeriods(7))),
    getHourlyForecast: vi.fn().mockResolvedValue(buildNoaaForecastResponse(buildDailyPeriods(7))),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getStations: vi.fn().mockResolvedValue({
      features: [{ properties: { stationIdentifier: 'TEST1' } }],
    }),
    getLatestObservation: vi.fn().mockResolvedValue({
      properties: {
        timestamp: '2026-08-12T12:00:00+00:00',
        temperature: { unitCode: 'wmoUnit:degC', value: 20 },
        textDescription: 'Clear',
      },
    }),
    ...overrides,
  };
}

/** A NOAA fake that cannot serve any request — models the real behaviour at a
 * non-US point (a 404 from /points, mapped upstream to a rejection). Any
 * rejection works here: a forced `source: "noaa"` never takes the
 * auto-only fallback path (forecastHandler.ts / currentConditionsHandler.ts
 * both gate the fallback on `requestedSource === 'auto'`), so the error type
 * is not load-bearing — only that getPointData/getStations reject. */
function buildNoCoverageNoaaFake() {
  return {
    getPointData: vi.fn().mockRejectedValue(new Error('simulated: NOAA has no coverage at this point')),
    getForecast: vi.fn().mockRejectedValue(new Error('not reached')),
    getHourlyForecast: vi.fn().mockRejectedValue(new Error('not reached')),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not reached')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not reached')),
    getStations: vi.fn().mockRejectedValue(new Error('simulated: NOAA has no coverage at this point')),
    getLatestObservation: vi.fn().mockRejectedValue(new Error('not reached')),
  };
}

function buildOpenMeteoDailyForecastResponse(days: string[], timezone = 'Europe/London'): OpenMeteoForecastResponse {
  return {
    latitude: 51.5,
    longitude: -0.13,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone,
    timezone_abbreviation: 'GMT',
    elevation: 11,
    daily: {
      time: days,
      temperature_2m_max: days.map(() => 20),
      temperature_2m_min: days.map(() => 12),
      sunrise: days.map(d => `${d}T06:00`),
      sunset: days.map(d => `${d}T20:00`),
    },
  };
}

function buildOpenMeteoCurrentResponse(): OpenMeteoForecastResponse {
  return {
    latitude: MEMPHIS.latitude,
    longitude: MEMPHIS.longitude,
    generationtime_ms: 0.1,
    utc_offset_seconds: -18000,
    timezone: 'America/Chicago',
    timezone_abbreviation: 'CDT',
    elevation: 80,
    current: {
      time: '2026-08-12T12:00',
      interval: 900,
      temperature_2m: 28,
      weather_code: 0,
    },
  };
}

function buildOpenMeteoFake(response: OpenMeteoForecastResponse) {
  return {
    getForecast: vi.fn().mockResolvedValue(response),
    getCurrentConditions: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    getClimateNormals: vi.fn().mockRejectedValue(new Error('normals not configured for this fixture')),
  };
}

function buildNceiFake() {
  return { isAvailable: vi.fn().mockReturnValue(false) };
}

interface SummaryFakes {
  noaa: ReturnType<typeof buildNoaaFake> | ReturnType<typeof buildNoCoverageNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  ncei: ReturnType<typeof buildNceiFake>;
  locationStore: Record<string, never>;
  geocoding: { geocode: ReturnType<typeof vi.fn> } | Record<string, never>;
}

function callSummary(args: Record<string, unknown>, fakes: SummaryFakes) {
  return handleGetWeatherSummary(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.ncei as unknown as NCEIService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService
  );
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

describe('get_weather_summary — hourly is gone from the reachable surface', () => {
  it('renders the daily forecast, not hourly, when granularity: "hourly" is sent (London, non-US)', async () => {
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyForecastResponse(['2026-08-12']));
    const fakes: SummaryFakes = {
      noaa: buildNoaaFake(),
      openMeteo,
      ncei: buildNceiFake(),
      locationStore: {},
      geocoding: {},
    };

    const result = await callSummary(
      { ...LONDON, include: ['forecast'], granularity: 'hourly' },
      fakes
    );
    const text = textOf(result);

    expect(text).toContain('# Weather Forecast (Daily)');
    expect(text).not.toContain('# Weather Forecast (Hourly)');

    // The real forecastHandler.ts calls openMeteoService.getForecast(lat, lon,
    // days, hourly, prefs) — the 4th positional argument requests hourly
    // series. It must be false: no hourly series was requested.
    expect(openMeteo.getForecast).toHaveBeenCalledTimes(1);
    expect(openMeteo.getForecast.mock.calls[0][3]).toBe(false);
  });
});

describe('get_weather_summary — source reaches the forecast section', () => {
  it('source: "openmeteo" at a US point renders via Open-Meteo, daily, at the requested day count, with no NOAA horizon disclosure', async () => {
    const days = 10;
    const openMeteoDays = Array.from({ length: days }, (_, i) => `2026-08-${12 + i}`);
    const noaa = buildNoaaFake();
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyForecastResponse(openMeteoDays, 'America/Chicago'));
    const fakes: SummaryFakes = { noaa, openMeteo, ncei: buildNceiFake(), locationStore: {}, geocoding: {} };

    const result = await callSummary(
      { ...MEMPHIS, source: 'openmeteo', days, include: ['forecast'] },
      fakes
    );
    const text = textOf(result);

    expect(text).toContain('# Weather Forecast (Daily)');
    expect(text).toContain(`**Forecast Days:** ${days}`);
    expect((text.match(/## /g) ?? []).length).toBe(days);
    expect(text).not.toContain('*NOAA publishes ');

    expect(openMeteo.getForecast).toHaveBeenCalledTimes(1);
    expect(noaa.getPointData).not.toHaveBeenCalled();
    expect(noaa.getForecast).not.toHaveBeenCalled();
  });

  it('control: the same request without source goes to NOAA instead', async () => {
    const days = 10;
    const noaa = buildNoaaFake();
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyForecastResponse(['2026-08-12']));
    const fakes: SummaryFakes = { noaa, openMeteo, ncei: buildNceiFake(), locationStore: {}, geocoding: {} };

    const result = await callSummary({ ...MEMPHIS, days, include: ['forecast'] }, fakes);
    const text = textOf(result);

    expect(text).toContain('# Weather Forecast (Daily)');
    expect(noaa.getPointData).toHaveBeenCalledTimes(1);
    expect(noaa.getForecast).toHaveBeenCalledTimes(1);
    expect(openMeteo.getForecast).not.toHaveBeenCalled();
  });
});

describe('get_weather_summary — source reaches the current-conditions section', () => {
  it('source: "openmeteo" at a US point renders via Open-Meteo and never calls NOAA', async () => {
    const noaa = buildNoaaFake();
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoCurrentResponse());
    const fakes: SummaryFakes = { noaa, openMeteo, ncei: buildNceiFake(), locationStore: {}, geocoding: {} };

    const result = await callSummary({ ...MEMPHIS, source: 'openmeteo', include: ['current'] }, fakes);
    const text = textOf(result);

    expect(text).toContain('# Current Weather Conditions');
    expect(openMeteo.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(noaa.getStations).not.toHaveBeenCalled();
    expect(noaa.getLatestObservation).not.toHaveBeenCalled();
  });
});

describe('get_weather_summary — zero upstream calls on a source refusal', () => {
  it('source: "metar" rejects before geocoding city_name, and before any NOAA/Open-Meteo call', async () => {
    const noaa = buildNoaaFake();
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoCurrentResponse());
    const geocode = vi.fn();
    const fakes: SummaryFakes = {
      noaa,
      openMeteo,
      ncei: buildNceiFake(),
      locationStore: {},
      geocoding: { geocode },
    };

    await expect(
      callSummary({ source: 'metar', city_name: 'Memphis, TN', include: ['current'] }, fakes)
    ).rejects.toThrow(/Invalid source/);

    expect(geocode).not.toHaveBeenCalled();
    for (const method of Object.values(noaa)) {
      expect(method).not.toHaveBeenCalled();
    }
    for (const key of ['getForecast', 'getCurrentConditions'] as const) {
      expect(openMeteo[key]).not.toHaveBeenCalled();
    }
  });
});

describe('get_weather_summary — a forced "noaa" source at a non-US point degrades per section, not for the whole summary', () => {
  it('resolves, with current and forecast both rendered as unavailable (London)', async () => {
    const noaa = buildNoCoverageNoaaFake();
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyForecastResponse(['2026-08-12']));
    const fakes: SummaryFakes = { noaa, openMeteo, ncei: buildNceiFake(), locationStore: {}, geocoding: {} };

    const result = await callSummary(
      { ...LONDON, source: 'noaa', include: ['current', 'forecast'] },
      fakes
    );
    const text = textOf(result);

    expect(text).toContain('## current (unavailable)');
    expect(text).toContain('## forecast (unavailable)');
  });
});
