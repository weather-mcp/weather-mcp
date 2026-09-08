/**
 * Unit tests for the `**Updated:**` line on the NOAA forecast path
 * (get_forecast, both granularities).
 *
 * `ForecastProperties.updated`/`.updateTime` are both optional (T1 of this
 * plan), and `formatNOAAForecast` in `src/handlers/forecastHandler.ts` reads
 * only `forecast.properties.updateTime`, guarded so the line is omitted
 * entirely when that field is absent:
 *
 *   if (forecast.properties.updateTime) {
 *     output += `**Updated:** ${formatInTimezone(...)}\n`;
 *   }
 *
 * This file exists because all pre-existing NOAA forecast fixtures set
 * `updated` (the field the live wire has never sent) rather than
 * `updateTime` (the field it actually sends), so no test ever observed the
 * line actually rendering from the field that matters — see GOTCHAS G48.
 * T3 of .devdocs/plan-forecast-auto-source-contract-impl.md corrects those
 * fixtures; this file adds the dedicated coverage:
 *
 *   1. the line renders from `updateTime`, with the expected formatted value;
 *   2. the line is absent when `updateTime` is absent (the shape the live
 *      API sends today);
 *   3. both of the above hold on the daily and the hourly path.
 *
 * Modeled on tests/unit/forecast-noaa-horizon.test.ts: the real handler is
 * exercised end to end with plain fake services (vi.fn() spies returning
 * canned fixtures) — no HTTP, no live network calls, fully deterministic.
 * The fixture helpers below (US_COORDS, buildForecastPeriod, buildNoaaPoints,
 * buildNoaaForecastResponse, buildNoaaForecastFake, callForecast) are the
 * same shape as that file's — none of them is exported from production
 * code, and several other unit files already duplicate the same set.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ForecastPeriod } from '../../src/types/noaa.js';

/** Washington, DC — inside the US routing boxes, drives the NOAA path. */
const US_COORDS = { latitude: 38.8951, longitude: -77.0364 };

/** Fixed timezone for every fixture below, so the expected formatted string
 * is deterministic regardless of the machine's local zone. */
const TIMEZONE = 'America/Los_Angeles';

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

function buildNoaaPoints() {
  return {
    properties: {
      gridId: 'TEST',
      gridX: 1,
      gridY: 1,
      timeZone: TIMEZONE,
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

/**
 * Builds a NOAA forecast response whose `properties.updateTime` is either
 * the given ISO string or omitted entirely (never `updated` — that key is
 * the one the live wire has never sent; see file header). `elevation` and
 * `periods` are the only other fields `formatNOAAForecast` reads before it
 * reaches the `**Updated:**` line.
 */
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

function buildNoaaForecastFake(periods: ForecastPeriod[], updateTime: string | undefined) {
  const response = buildNoaaForecastResponse(periods, updateTime);
  return {
    getPointData: vi.fn().mockResolvedValue(buildNoaaPoints()),
    getForecast: vi.fn().mockResolvedValue(response),
    getHourlyForecast: vi.fn().mockResolvedValue(response),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
  };
}

function callForecast(args: Record<string, unknown>, noaa: ReturnType<typeof buildNoaaForecastFake>) {
  return handleGetForecast(
    args,
    noaa as unknown as NOAAService,
    {} as unknown as OpenMeteoService, // unused — US_COORDS routes to the NOAA path
    {} as unknown as LocationStore, // unused — explicit coordinates short-circuit resolution
    {} as unknown as GeocodingService, // unused for the same reason
    undefined, // nceiService — not exercised (no include_normals)
    undefined // acisService — not exercised (no include_normals)
  );
}

describe('get_forecast — NOAA **Updated:** line', () => {
  it('renders **Updated:** from updateTime on the daily path', async () => {
    const periods = [buildForecastPeriod({})];
    const noaa = buildNoaaForecastFake(periods, '2026-08-12T00:00:00-07:00');
    const result = await callForecast({ ...US_COORDS, days: 1 }, noaa);
    const text = textOf(result);
    expect(text).toContain('**Updated:** Aug 12, 2026, 12:00 AM');
  });

  it('renders **Updated:** from updateTime on the hourly path', async () => {
    const periods = [buildForecastPeriod({})];
    const noaa = buildNoaaForecastFake(periods, '2026-08-12T00:00:00-07:00');
    const result = await callForecast({ ...US_COORDS, granularity: 'hourly' }, noaa);
    const text = textOf(result);
    expect(text).toContain('**Updated:** Aug 12, 2026, 12:00 AM');
  });

  it('omits **Updated:** entirely when updateTime is absent, on the daily path', async () => {
    const periods = [buildForecastPeriod({})];
    const noaa = buildNoaaForecastFake(periods, undefined);
    const result = await callForecast({ ...US_COORDS, days: 1 }, noaa);
    const text = textOf(result);
    // Positive control first: `not.toContain` is a claim about a string's
    // contents, never a claim that the render happened at all. A handler that
    // threw would satisfy the absence assertion vacuously (GOTCHAS G10, the
    // unit-level twin).
    expect(text).toContain('# Weather Forecast (Daily)');
    expect(text).not.toContain('**Updated:**');
  });

  it('omits **Updated:** entirely when updateTime is absent, on the hourly path', async () => {
    const periods = [buildForecastPeriod({})];
    const noaa = buildNoaaForecastFake(periods, undefined);
    const result = await callForecast({ ...US_COORDS, granularity: 'hourly' }, noaa);
    const text = textOf(result);
    // Positive control, as above (GOTCHAS G10).
    expect(text).toContain('# Weather Forecast (Hourly)');
    expect(text).not.toContain('**Updated:**');
  });
});
