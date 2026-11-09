/**
 * Unit tests for the severe-weather probability window, cap and warn,
 * driven through `handleGetForecast` with `include_severe_weather: true` on
 * the NOAA path. `getMaxProbabilityFromSeries` is not exported, so the
 * rendered thunder line is the observable. Fixture builders are copied from
 * forecast-noaa-updated-line.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { logger } from '../../src/utils/logger.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ForecastPeriod } from '../../src/types/noaa.js';

const US_COORDS = { latitude: 38.8951, longitude: -77.0364 };
const TIMEZONE = 'America/Los_Angeles';
const NOW = Date.UTC(2026, 9, 1, 12, 0);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

function buildNoaaPoints() {
  return { properties: { gridId: 'TEST', gridX: 1, gridY: 1, timeZone: TIMEZONE } };
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
      validTimes: '2026-08-12T00:00:00-07:00/P7D',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      periods,
    },
  };
}

interface SeriesEntry { validTime: string; value: number | null }

function entry(offsetMs: number, value: number | null): SeriesEntry {
  return { validTime: `${new Date(NOW + offsetMs).toISOString()}/PT1H`, value };
}

function gridpointWith(series: { values: SeriesEntry[] } | undefined) {
  return {
    properties: {
      '@id': 'x',
      '@type': 'wx:Gridpoint',
      updateTime: '2026-10-01T12:00:00+00:00',
      validTimes: '2026-10-01T12:00:00+00:00/P7D',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      forecastOffice: 'TEST',
      gridId: 'TEST',
      gridX: 1,
      gridY: 1,
      ...(series ? { probabilityOfThunder: series } : {}),
    },
  };
}

function buildFake(gridpoint: unknown) {
  const response = buildNoaaForecastResponse([buildForecastPeriod({})]);
  return {
    getPointData: vi.fn().mockResolvedValue(buildNoaaPoints()),
    getForecast: vi.fn().mockResolvedValue(response),
    getHourlyForecast: vi.fn().mockResolvedValue(response),
    getGridpointData: vi.fn().mockResolvedValue(gridpoint),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
  };
}

async function callForecast(noaa: ReturnType<typeof buildFake>): Promise<string> {
  const result = await handleGetForecast(
    { ...US_COORDS, days: 1, include_severe_weather: true },
    noaa as unknown as NOAAService,
    {} as unknown as OpenMeteoService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    undefined,
    undefined
  );
  return textOf(result);
}

describe('get_forecast include_severe_weather — thunder probability', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('takes the maximum over entries starting in [now, now + 48 h] only', async () => {
    const values = [
      entry(-HOUR, 90),
      entry(0, 30),
      entry(2 * HOUR, null as unknown as number),
      entry(24 * HOUR, 45),
      entry(48 * HOUR, 40),
      entry(48 * HOUR + MIN, 95),
    ];
    const text = await callForecast(buildFake(gridpointWith({ values })));
    expect(text).toContain('## ⚠️ Severe Weather Probabilities (Next 48 Hours)');
    expect(text).toContain('⚡ **Thunderstorms:** 45% chance\n');
  });

  it('counts an entry starting exactly at now + 48 h (inclusive upper bound)', async () => {
    const values = [entry(0, 30), entry(24 * HOUR, 45), entry(48 * HOUR, 55)];
    const text = await callForecast(buildFake(gridpointWith({ values })));
    expect(text).toContain('🌩️ **Thunderstorms:** 55% chance\n');
  });

  it('renders no thunder line and no header for an empty series', async () => {
    const text = await callForecast(buildFake(gridpointWith({ values: [] })));
    expect(text).toContain('Sunny');
    expect(text).not.toContain('Thunderstorms');
    expect(text).not.toContain('Severe Weather Probabilities');
  });

  it('renders no thunder line and no header when the series is absent', async () => {
    const text = await callForecast(buildFake(gridpointWith(undefined)));
    expect(text).toContain('Sunny');
    expect(text).not.toContain('Thunderstorms');
    expect(text).not.toContain('Severe Weather Probabilities');
  });

  it('processes only the first 500 entries, warns, and leaves the fixture untouched', async () => {
    const values: SeriesEntry[] = [];
    for (let i = 0; i < 501; i++) values.push(entry(i * 5 * MIN, i === 500 ? 99 : 10));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const text = await callForecast(buildFake(gridpointWith({ values })));
    expect(text).toContain('🌤️ **Thunderstorms:** 10% chance\n');
    expect(warn).toHaveBeenCalledWith('Gridpoint series exceeds max entries', {
      length: 501,
      maxEntries: 500,
      securityEvent: true,
    });
    expect(values).toHaveLength(501);
  });
});
