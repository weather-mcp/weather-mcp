/**
 * The severe-weather window counts the interval in progress, and the
 * lightning line covers only the next 48 h. Driven through handleGetForecast
 * with include_severe_weather on the NOAA path. Fakes copied from
 * forecast-severe-weather-probability.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
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
type Series = { values: SeriesEntry[] };

const DAY = 24 * HOUR;

function span(startOffsetMs: number, duration: string, value: number | null): SeriesEntry {
  return { validTime: `${new Date(NOW + startOffsetMs).toISOString()}/${duration}`, value };
}

function gridpointWith(extra: Record<string, Series>) {
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
      ...extra,
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

async function callForecast(extra: Record<string, Series>): Promise<string> {
  const noaa = buildFake(gridpointWith(extra));
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

describe('get_forecast include_severe_weather — window and lightning', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('counts a thunder interval that started yesterday and is still running', async () => {
    const text = await callForecast({ probabilityOfThunder: { values: [span(-DAY, 'PT39H', 70)] } });
    expect(text).toContain('🌩️ **Thunderstorms:** 70% chance\n');
  });

  it('counts a 60 mph gust interval already in progress', async () => {
    const text = await callForecast({ potentialOf60mphWindGusts: { values: [span(-2 * HOUR, 'PT4H', 10)] } });
    expect(text).toContain('💨 **Very High Wind Gusts (60+ mph):** 10% chance\n');
  });

  it('counts a tropical-storm interval of P2DT8H that started yesterday', async () => {
    const text = await callForecast({ probabilityOfTropicalStormWinds: { values: [span(-DAY, 'P2DT8H', 35)] } });
    expect(text).toContain('🌀 **Tropical Storm Winds (39-73 mph):** 35% chance\n');
  });

  it('drops an interval that ended before now', async () => {
    const text = await callForecast({ probabilityOfThunder: { values: [span(-3 * HOUR, 'PT2H', 80)] } });
    expect(text).not.toContain('Severe Weather Probabilities');
  });

  it('omits lightning that starts beyond 48 h, and the section with it', async () => {
    const text = await callForecast({
      lightningActivityLevel: { values: [span(49 * HOUR, 'PT3H', 4)] }
    });
    expect(text).not.toContain('Lightning Activity');
    expect(text).not.toContain('Severe Weather Probabilities');
  });

  it('reports the in-window lightning level, not the whole-series maximum', async () => {
    const text = await callForecast({
      lightningActivityLevel: { values: [span(-HOUR, 'PT4H', 2), span(60 * HOUR, 'PT3H', 4)] }
    });
    expect(text).toContain('⚡ **Lightning Activity:** Moderate (Level 2)\n');
    expect(text).not.toContain('Level 4');
  });
});
