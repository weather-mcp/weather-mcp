/**
 * Unit tests locking the NOAA-hourly source-character note (T2 of
 * .devdocs/plan-forecast-auto-source-contract-impl.md) to exactly the path it
 * is meant to describe.
 *
 * `formatNOAAForecast` in `src/handlers/forecastHandler.ts` (~:558-560) emits:
 *
 *   if (granularity === 'hourly') {
 *     output += `*NOAA's hourly forecast is a human-adjusted grid product: ...`;
 *   }
 *
 * only inside the NOAA render path, only when `granularity === 'hourly'`. This
 * file pins:
 *
 *   1. present  — NOAA path, granularity: "hourly"
 *   2. absent   — NOAA path, granularity: "daily"
 *   3. absent   — Open-Meteo path (non-US point), both granularities
 *   4. absent   — auto-fallback path (NOAA rejects, routes to Open-Meteo)
 *   5. present, unconditionally on `detail` — "summary" | "standard" | "full"
 *      (the actual DetailLevel union, src/utils/validation.ts:165 — not
 *      "concise")
 *
 * GOTCHAS G62: every absence assertion below anchors on the distinctive
 * substring `human-adjusted grid product`, which appears exactly once in the
 * codebase (the T2 line). `source: "openmeteo"` is deliberately NOT used as
 * an anchor — the horizon-disclosure lines a few lines below in the same
 * function (~:566-571) already contain that exact substring, so a lock on it
 * would redden the moment a fixture also renders a horizon line, independent
 * of whether the hourly note itself ever rendered.
 *
 * GOTCHAS G10 (unit-level twin): every absence assertion is preceded by a
 * positive control proving the report actually rendered — a `not.toContain`
 * on its own is satisfied vacuously by a handler that threw or by an error
 * block.
 *
 * Modeled on tests/unit/forecast-noaa-updated-line.test.ts (NOAA fixture
 * shape) and tests/unit/forecast-fallback.test.ts (Open-Meteo fixture shape
 * and the DataNotFoundError fallback trigger). None of the helpers below is
 * exported from production code; several other unit files already duplicate
 * the same shapes.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ForecastPeriod } from '../../src/types/noaa.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import { DataNotFoundError } from '../../src/errors/ApiError.js';

/** Washington, DC — inside the US routing boxes, drives the NOAA path. */
const US_COORDS = { latitude: 38.8951, longitude: -77.0364 };

/** London — outside every US routing box, drives the Open-Meteo path directly
 * (no NOAA call at all, so a fake that is never invoked is deliberate). Same
 * fixture point used by tests/unit/current-conditions-global.test.ts. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

/** Toronto — sits INSIDE the continental-US routing box (the box overruns the
 * border), so auto-routes to NOAA first and is the fixture used elsewhere
 * (tests/unit/forecast-fallback.test.ts) to exercise the NOAA -> Open-Meteo
 * fallback. Reused here for the same reason (GOTCHAS G53). */
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };

const TIMEZONE = 'America/Los_Angeles';

/** The one substring the T2 note is guaranteed to contain and nothing else in
 * the codebase renders (GOTCHAS G62). Used for the `not.toContain` absence
 * assertions, where the cheapest unique probe is the right instrument. */
const NOTE_ANCHOR = 'human-adjusted grid product';

/** The note, verbatim. The presence assertions lock THIS, not `NOTE_ANCHOR`.
 *
 * Locking only the anchor is what let a wrong sentence ship green: the note
 * once read "each value is a probability over the whole grid box" while
 * rendering directly above a temperature and a wind speed, and every test
 * here passed because the anchor was still in it. A diff-review leg proved
 * the gap by reducing the production line to the anchor alone with all eight
 * tests still green. The whole sentence is the contract — its scope, its
 * cadence clause and its escape hatch are each load-bearing (see
 * NOTE_CLAIMS) — so the whole sentence is what gets asserted. */
const NOTE_SENTENCE =
  `*NOAA's hourly forecast is a human-adjusted grid product: its precipitation ` +
  `probability is a chance over the whole grid box, republished on the ` +
  `forecaster's cadence rather than the model's. For a faster-cadence model ` +
  `view use source: "openmeteo".*`;

/** The individually load-bearing claims, so a reword that silently drops one
 * fails on that claim rather than on an opaque whole-string mismatch. */
const NOTE_CLAIMS: ReadonlyArray<readonly [string, string]> = [
  ['names the product as human-adjusted', 'human-adjusted grid product'],
  ['scopes the probability to precipitation', 'precipitation probability'],
  ['keeps the grid-box scope', 'over the whole grid box'],
  ["names the forecaster's cadence", "republished on the forecaster's cadence"],
  ['offers the openmeteo alternative', 'use source: "openmeteo"'],
];

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

function buildNoaaForecastFake(periods: ForecastPeriod[]) {
  const response = buildNoaaForecastResponse(periods);
  return {
    getPointData: vi.fn().mockResolvedValue(buildNoaaPoints()),
    getForecast: vi.fn().mockResolvedValue(response),
    getHourlyForecast: vi.fn().mockResolvedValue(response),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
  };
}

/** NOAA fake that is never expected to be called (direct Open-Meteo path). */
function buildUnusedNoaaFake() {
  return {
    getPointData: vi.fn().mockRejectedValue(new Error('should not be called')),
    getForecast: vi.fn().mockRejectedValue(new Error('should not be called')),
    getHourlyForecast: vi.fn().mockRejectedValue(new Error('should not be called')),
    getGridpointData: vi.fn().mockRejectedValue(new Error('should not be called')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('should not be called')),
  };
}

/** NOAA fake that rejects getPointData with DataNotFoundError, driving the
 * auto-fallback branch (mirrors tests/unit/forecast-fallback.test.ts). */
function buildFallbackNoaaFake() {
  return {
    getPointData: vi.fn().mockRejectedValue(
      new DataNotFoundError('NOAA', 'Unable to provide data for requested point')
    ),
    getForecast: vi.fn(),
    getHourlyForecast: vi.fn(),
    getGridpointData: vi.fn(),
    getGridpointDataByCoordinates: vi.fn(),
  };
}

function buildOpenMeteoDailyResponse(): OpenMeteoForecastResponse {
  return {
    latitude: 51.5,
    longitude: -0.13,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'Europe/London',
    timezone_abbreviation: 'GMT',
    elevation: 11,
    daily: {
      time: ['2024-01-01', '2024-01-02'],
      temperature_2m_max: [10, 9],
      temperature_2m_min: [4, 3],
    },
  };
}

function buildOpenMeteoHourlyResponse(): OpenMeteoForecastResponse {
  return {
    latitude: 51.5,
    longitude: -0.13,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'Europe/London',
    timezone_abbreviation: 'GMT',
    elevation: 11,
    hourly: {
      time: ['2024-01-01T00:00', '2024-01-01T01:00'],
      temperature_2m: [8, 7],
    },
  };
}

function buildOpenMeteoFake(response: OpenMeteoForecastResponse) {
  return {
    getForecast: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
}

type NoaaFake =
  | ReturnType<typeof buildNoaaForecastFake>
  | ReturnType<typeof buildUnusedNoaaFake>
  | ReturnType<typeof buildFallbackNoaaFake>;

function callForecast(
  args: Record<string, unknown>,
  noaa: NoaaFake,
  openMeteo: ReturnType<typeof buildOpenMeteoFake>
) {
  return handleGetForecast(
    args,
    noaa as unknown as NOAAService,
    openMeteo as unknown as OpenMeteoService,
    {} as unknown as LocationStore, // unused — explicit coordinates short-circuit resolution
    {} as unknown as GeocodingService, // unused for the same reason
    undefined, // nceiService — not exercised (no include_normals)
    undefined // acisService — not exercised (no include_normals)
  );
}

describe('get_forecast — NOAA hourly source-character note (T4)', () => {
  it('is present on the NOAA path at granularity: "hourly"', async () => {
    const periods = [buildForecastPeriod({})];
    const noaa = buildNoaaForecastFake(periods);
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyResponse());
    const result = await callForecast({ ...US_COORDS, granularity: 'hourly' }, noaa, openMeteo);
    const text = textOf(result);
    expect(text).toContain('# Weather Forecast (Hourly)');
    expect(text).toContain(NOTE_SENTENCE);
  });

  it('is absent on the NOAA path at granularity: "daily"', async () => {
    const periods = [buildForecastPeriod({})];
    const noaa = buildNoaaForecastFake(periods);
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyResponse());
    const result = await callForecast({ ...US_COORDS, days: 1 }, noaa, openMeteo);
    const text = textOf(result);
    // Positive control first (GOTCHAS G10): prove the report actually
    // rendered before trusting the absence assertion below.
    expect(text).toContain('# Weather Forecast (Daily)');
    expect(text).not.toContain(NOTE_ANCHOR);
  });

  it('is absent on the Open-Meteo path (non-US point) at granularity: "daily"', async () => {
    const noaa = buildUnusedNoaaFake();
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyResponse());
    const result = await callForecast({ ...LONDON, days: 1 }, noaa, openMeteo);
    const text = textOf(result);
    expect(text).toContain('*Data source: Open-Meteo (Global)*');
    expect(noaa.getPointData).not.toHaveBeenCalled();
    expect(text).not.toContain(NOTE_ANCHOR);
  });

  it('is absent on the Open-Meteo path (non-US point) at granularity: "hourly"', async () => {
    const noaa = buildUnusedNoaaFake();
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoHourlyResponse());
    const result = await callForecast({ ...LONDON, granularity: 'hourly' }, noaa, openMeteo);
    const text = textOf(result);
    expect(text).toContain('*Data source: Open-Meteo (Global)*');
    expect(noaa.getPointData).not.toHaveBeenCalled();
    expect(text).not.toContain(NOTE_ANCHOR);
  });

  it('is absent on the auto-fallback path (NOAA rejects, routes to Open-Meteo) — GOTCHAS G53', async () => {
    const noaa = buildFallbackNoaaFake();
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyResponse());
    const result = await callForecast({ ...TORONTO }, noaa, openMeteo);
    const text = textOf(result);
    // Positive control: prove the fallback actually took, not just that the
    // handler returned something.
    expect(text).toContain('*NOAA does not cover this location; showing Open-Meteo model data instead.*');
    expect(text).toContain('*Data source: Open-Meteo (Global)*');
    expect(text).not.toContain(NOTE_ANCHOR);
  });

  it.each(['summary', 'standard', 'full'] as const)(
    'is present on the NOAA hourly path regardless of detail (%s)',
    async (detail) => {
      const periods = [buildForecastPeriod({})];
      const noaa = buildNoaaForecastFake(periods);
      const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyResponse());
      const result = await callForecast(
        { ...US_COORDS, granularity: 'hourly', detail },
        noaa,
        openMeteo
      );
      const text = textOf(result);
      expect(text).toContain('# Weather Forecast (Hourly)');
      expect(text).toContain(NOTE_SENTENCE);
    }
  );

  it.each(NOTE_CLAIMS)('%s', async (_label, claim) => {
    const periods = [buildForecastPeriod({})];
    const noaa = buildNoaaForecastFake(periods);
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyResponse());
    const result = await callForecast({ ...US_COORDS, granularity: 'hourly' }, noaa, openMeteo);
    const text = textOf(result);
    expect(text).toContain('# Weather Forecast (Hourly)');
    expect(text).toContain(claim);
  });

  it('does not generalise the probability claim beyond precipitation', async () => {
    // The regression this file failed to catch once. The note renders above a
    // temperature and a wind speed, neither of which is a probability, so an
    // unscoped claim is false of the lines under it.
    const periods = [buildForecastPeriod({})];
    const noaa = buildNoaaForecastFake(periods);
    const openMeteo = buildOpenMeteoFake(buildOpenMeteoDailyResponse());
    const result = await callForecast({ ...US_COORDS, granularity: 'hourly' }, noaa, openMeteo);
    const text = textOf(result);
    expect(text).toContain(NOTE_ANCHOR);
    expect(text).not.toContain('each value is a probability');
  });
});
