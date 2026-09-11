/**
 * G19 pin for the met.no fallback threading through `get_weather_summary`
 * (T6 of .devdocs/plan-metno-fallback-impl.md).
 *
 * `get_weather_summary` is a second public path through `handleGetForecast`
 * (GOTCHAS G19): it renders its forecast section through the same handler as
 * the standalone `get_forecast` tool, but calls it with its own argument list,
 * dropping and forwarding a different set of trailing parameters. T5 threaded
 * `metnoService` into that forwarded list; this file proves the thread is
 * live rather than decorative by driving the REAL `handleGetWeatherSummary`,
 * which drives the REAL `handleGetForecast` underneath — no
 * `vi.mock('.../forecastHandler.js')`, unlike
 * `tests/unit/weather-summary-handler.test.ts`, which mocks every sub-handler
 * and therefore could not see this regression at all.
 *
 * No HTTP, no live network: every upstream service is a plain fake object,
 * following `tests/unit/forecast-metno-fallback.test.ts`'s pattern.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { MetnoService } from '../../src/services/metno.js';
import { ServiceUnavailableError } from '../../src/errors/ApiError.js';
import type { MetnoDailyAggregate, MetnoDailyForecast } from '../../src/utils/metnoParse.js';

/** Tokyo — outside every US routing box, so the forecast section's `auto`
 * routing reaches the Open-Meteo branch where the met.no fallback lives. */
const NON_US = { latitude: 35.6762, longitude: 139.6503 };

function buildNoaaFake() {
  return {
    getPointData: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getForecast: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getHourlyForecast: vi.fn(),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getAlerts: vi.fn(),
  };
}

function buildOpenMeteoFake() {
  return {
    getForecast: vi.fn().mockRejectedValue(
      new ServiceUnavailableError('OpenMeteo', 'OpenMeteo API is currently unavailable')
    ),
    getModelComparison: vi.fn(),
    getEnsembleSpread: vi.fn(),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
}

function buildNceiFake() {
  return { isAvailable: vi.fn().mockReturnValue(false) };
}

function buildMetnoDay(dayOffset: number, overrides: Partial<MetnoDailyForecast> = {}): MetnoDailyForecast {
  const date = `2026-09-${String(11 + dayOffset).padStart(2, '0')}`;
  return {
    date,
    startsAt: `${date}T00:00:00.000+09:00`,
    hoursCovered: 24,
    complete: true,
    temperatureMaxC: 17,
    temperatureMinC: 10,
    temperatureBasis: 'window',
    precipitationMm: 0,
    precipitationProbabilityMaxPct: 10,
    windSpeedMaxMps: 4,
    windFromDirectionDeg: 180,
    symbolCode: 'partlycloudy_day',
    ...overrides,
  };
}

function buildMetnoAggregate(dayCount = 5): MetnoDailyAggregate {
  const days = Array.from({ length: dayCount }, (_, i) => buildMetnoDay(i));
  return {
    timezone: 'Asia/Tokyo',
    elevationM: 40,
    days,
    completeDayCount: days.length,
    entriesSeen: days.length * 4,
    entriesAggregated: days.length * 4,
    entriesTrimmed: false,
  };
}

function buildMetnoFake() {
  return { getForecast: vi.fn().mockResolvedValue(buildMetnoAggregate()) };
}

interface Fakes {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  ncei: ReturnType<typeof buildNceiFake>;
  metno: ReturnType<typeof buildMetnoFake>;
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
}

function buildFakes(): Fakes {
  return {
    noaa: buildNoaaFake(),
    openMeteo: buildOpenMeteoFake(),
    ncei: buildNceiFake(),
    metno: buildMetnoFake(),
    // Coordinate-only args mean resolveLocationAsync never touches these.
    locationStore: {},
    geocoding: {},
  };
}

/**
 * Calls the real `handleGetWeatherSummary`, forwarding (or omitting) the
 * `metnoService` trailing parameter — the 14th positional argument, after
 * `meteoAlarmService` (7th) through `criticalAlertBanner` (13th), all left
 * `undefined` here since only the `forecast` section is exercised.
 */
function callSummary(args: Record<string, unknown>, fakes: Fakes, withMetno: boolean) {
  return handleGetWeatherSummary(
    { ...args, include: ['forecast'] },
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.ncei as unknown as NCEIService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService,
    undefined, // meteoAlarmService
    undefined, // geoMetService
    undefined, // nominatimService
    undefined, // googleWeatherService
    undefined, // nationalCapService
    undefined, // jmaService
    undefined, // criticalAlertBanner
    withMetno ? (fakes.metno as unknown as MetnoService) : undefined
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

describe('handleGetWeatherSummary — met.no fallback threading (G19)', () => {
  it('renders the met.no forecast in the forecast section when Open-Meteo fails transiently and metnoService is threaded through', async () => {
    const fakes = buildFakes();

    const result = await callSummary({ ...NON_US }, fakes, true);
    const text = textOf(result);

    expect(fakes.metno.getForecast).toHaveBeenCalledTimes(1);
    expect(text).toContain('*Forecast data by MET Norway (CC BY 4.0)*');
    expect(text).not.toContain('## forecast (unavailable)');
  });

  it('degrades to "## forecast (unavailable)" carrying the Open-Meteo message when no metnoService is injected', async () => {
    const fakes = buildFakes();

    const result = await callSummary({ ...NON_US }, fakes, false);
    const text = textOf(result);

    expect(fakes.metno.getForecast).not.toHaveBeenCalled();
    expect(text).toContain('## forecast (unavailable)');
    expect(text).toContain('OpenMeteo API is currently unavailable');
    expect(text).not.toContain('MET Norway');
  });
});
