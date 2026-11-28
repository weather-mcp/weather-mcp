/**
 * Unit tests for the `**Timezone:**` line in the NOAA forecast header
 * (get_forecast, both granularities, and the get_weather_summary forecast
 * section). The line names the zone that formats `**Updated:**` and every
 * period time, and renders unconditionally between `**Elevation:**` and
 * `**Updated:**`.
 *
 * Fixtures are copied from forecast-noaa-updated-line.test.ts and
 * weather-summary-source.test.ts (never imported). Offline: plain fakes only.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ForecastPeriod } from '../../src/types/noaa.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';

/** Denver — inside the US routing boxes, drives the NOAA path. */
const DENVER = { latitude: 39.74, longitude: -104.99 };
/** Memphis, TN — US point for the summary rows. */
const MEMPHIS = { latitude: 35.1495, longitude: -90.049 };
/** London — outside the US, drives the Open-Meteo path. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** The header block: from `**Location:**` to `**Showing:**`. Throws if either is missing. */
function headerBlock(text: string): string {
  const start = text.indexOf('**Location:**');
  const end = text.indexOf('**Showing:**');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`header block not found in:\n${text.slice(0, 600)}`);
  }
  return text.slice(start, end);
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

function buildDailyPeriods(days: number): ForecastPeriod[] {
  const periods: ForecastPeriod[] = [];
  for (let i = 0; i < days; i++) {
    periods.push(buildForecastPeriod({ number: periods.length + 1, name: `Day${i}`, isDaytime: true }));
    periods.push(buildForecastPeriod({ number: periods.length + 1, name: `Day${i} Night`, isDaytime: false }));
  }
  return periods;
}

/** `timeZone` omitted entirely when `undefined`; `''` is passed through. */
function buildNoaaPoints(timeZone: string | undefined) {
  return {
    properties: {
      gridId: 'TEST',
      gridX: 1,
      gridY: 1,
      ...(timeZone !== undefined ? { timeZone } : {}),
    },
  };
}

function buildNoaaForecastResponse(periods: ForecastPeriod[], updateTime: string | undefined) {
  return {
    properties: {
      units: 'us',
      forecastGenerator: 'test',
      generatedAt: '2026-08-12T00:00:00-07:00',
      ...(updateTime !== undefined ? { updateTime } : {}),
      validTimes: '2026-08-12T00:00:00-07:00/P7D',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      periods,
    },
  };
}

function buildNoaaFake(timeZone: string | undefined, updateTime: string | undefined) {
  const periods = buildDailyPeriods(7);
  const response = buildNoaaForecastResponse(periods, updateTime);
  return {
    getPointData: vi.fn().mockResolvedValue(buildNoaaPoints(timeZone)),
    getForecast: vi.fn().mockResolvedValue(response),
    getHourlyForecast: vi.fn().mockResolvedValue(response),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getAlerts: vi.fn().mockResolvedValue({ features: [] }),
  };
}

function callForecast(args: Record<string, unknown>, noaa: ReturnType<typeof buildNoaaFake>) {
  return handleGetForecast(
    args,
    noaa as unknown as NOAAService,
    {} as unknown as OpenMeteoService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    undefined,
    undefined
  );
}

const UPDATE_TIME = '2026-08-12T00:00:00-07:00';

describe('get_forecast — NOAA **Timezone:** placement', () => {
  const rows: Array<{ granularity: 'daily' | 'hourly'; detail: 'summary' | 'full' }> = [
    { granularity: 'daily', detail: 'summary' },
    { granularity: 'daily', detail: 'full' },
    { granularity: 'hourly', detail: 'summary' },
    { granularity: 'hourly', detail: 'full' },
  ];

  for (const { granularity, detail } of rows) {
    it(`sits between **Elevation:** and **Updated:** — ${granularity}, detail ${detail}`, async () => {
      const noaa = buildNoaaFake('America/Denver', UPDATE_TIME);
      const result = await callForecast({ ...DENVER, granularity, detail, days: 1 }, noaa);
      const text = textOf(result);
      const block = headerBlock(text);
      expect(block).toMatch(/\*\*Elevation:\*\* [^\n]*\n\*\*Timezone:\*\* America\/Denver\n\*\*Updated:\*\* /);
      expect(countOf(text, '**Timezone:**')).toBe(1);
    });
  }
});

describe('get_forecast — NOAA **Timezone:** agrees with **Updated:**', () => {
  const cases = [
    { zone: 'America/Denver', clock: '11:46' },
    { zone: 'America/New_York', clock: '1:46' },
  ];
  for (const { zone, clock } of cases) {
    it(`${zone}: the label names the zone that formatted the clock`, async () => {
      const noaa = buildNoaaFake(zone, '2026-11-27T18:46:00+00:00');
      const result = await callForecast({ ...DENVER, days: 1 }, noaa);
      const text = textOf(result).replace(/[  ]/g, ' ');
      const updated = text.split('\n').find(l => l.startsWith('**Updated:**'));
      const label = text.split('\n').find(l => l.startsWith('**Timezone:**'));
      expect(updated).toBeDefined();
      expect(updated).toContain(clock);
      expect(label).toBe(`**Timezone:** ${zone}`);
    });
  }
});

describe('get_forecast — NOAA **Timezone:** fallback', () => {
  it('guesses the zone from coordinates when point data has no timeZone key', async () => {
    const noaa = buildNoaaFake(undefined, UPDATE_TIME);
    const text = textOf(await callForecast({ ...DENVER, days: 1 }, noaa));
    expect(text).toContain('\n**Timezone:** America/Denver\n');
    expect(countOf(text, '**Timezone:**')).toBe(1);
  });

  it('guesses the zone from coordinates when timeZone is an empty string', async () => {
    const noaa = buildNoaaFake('', UPDATE_TIME);
    const text = textOf(await callForecast({ ...DENVER, days: 1 }, noaa));
    expect(text).toContain('\n**Timezone:** America/Denver\n');
    expect(countOf(text, '**Timezone:**')).toBe(1);
  });
});

describe('get_forecast — NOAA **Timezone:** without updateTime', () => {
  it('still renders the line, and **Updated:** is absent', async () => {
    const noaa = buildNoaaFake('America/Denver', undefined);
    const text = textOf(await callForecast({ ...DENVER, days: 1 }, noaa));
    expect(text).toContain('\n**Timezone:** America/Denver\n');
    expect(text).not.toContain('**Updated:**');
  });
});

// ---------------------------------------------------------------------------
// Summary — copied from weather-summary-source.test.ts
// ---------------------------------------------------------------------------

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

function buildOpenMeteoFake(response: OpenMeteoForecastResponse) {
  return {
    getForecast: vi.fn().mockResolvedValue(response),
    getCurrentConditions: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    getClimateNormals: vi.fn().mockRejectedValue(new Error('normals not configured for this fixture')),
  };
}

function buildSummaryNoaaFake() {
  return {
    ...buildNoaaFake('America/Chicago', '2026-08-12T00:00:00-07:00'),
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
  };
}

function callSummary(
  args: Record<string, unknown>,
  noaa: unknown,
  openMeteo: ReturnType<typeof buildOpenMeteoFake>
) {
  return handleGetWeatherSummary(
    args,
    noaa as NOAAService,
    openMeteo as unknown as OpenMeteoService,
    { isAvailable: vi.fn().mockReturnValue(false) } as unknown as NCEIService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService
  );
}

describe('get_weather_summary — NOAA **Timezone:** renders once', () => {
  const rows: Array<{ label: string; extra: Record<string, unknown> }> = [
    { label: 'default detail', extra: {} },
    { label: 'detail: full', extra: { detail: 'full' } },
  ];
  for (const { label, extra } of rows) {
    it(`exactly once, after the forecast heading — ${label}`, async () => {
      const noaa = buildSummaryNoaaFake();
      const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyForecastResponse(['2026-08-12']));
      const text = textOf(
        await callSummary({ ...MEMPHIS, include: ['current', 'forecast', 'alerts'], ...extra }, noaa, openMeteo)
      );
      const heading = text.indexOf('# Weather Forecast (Daily)');
      const line = text.indexOf('**Timezone:** America/Chicago');
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(line).toBeGreaterThan(heading);
      expect(countOf(text, '**Timezone:**')).toBe(1);
    });
  }
});

describe('get_forecast — non-US Open-Meteo header is unaffected', () => {
  it('has exactly one **Timezone:** line (London)', async () => {
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyForecastResponse(['2026-08-12']));
    const noaa = buildSummaryNoaaFake();
    const text = textOf(await callSummary({ ...LONDON, include: ['forecast'] }, noaa, openMeteo));
    expect(text).toContain('# Weather Forecast (Daily)');
    expect(countOf(text, '**Timezone:**')).toBe(1);
  });
});
