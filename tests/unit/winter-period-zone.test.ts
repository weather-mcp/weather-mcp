/**
 * The snowfall / ice accumulation period prints its two dates in the
 * location's zone (the NWS point's timeZone), not the server's. Rows:
 * (a) the pure extractors, (b) no zone => the old expression in the process
 * zone, (c) through handleGetForecast on the NOAA path, (d) through
 * handleGetWeatherSummary (G19). References are computed under the
 * location's own zone with the old expression, never pasted (G75), with
 * U+202F / U+00A0 normalised on both sides. Only Date is faked (G133).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractSnowfallForecast, extractIceAccumulation } from '../../src/utils/snow.js';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import { FormatConstants } from '../../src/config/displayThresholds.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ForecastPeriod } from '../../src/types/noaa.js';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
});

const ZONES = ['UTC', 'America/New_York', 'Pacific/Auckland'];
const LOCATION_ZONE = 'America/Los_Angeles';
const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };
const START = '2025-11-08T03:00:00Z'; // 7 PM Nov 7 in Los Angeles
const DAY_MS = 24 * 60 * 60 * 1000;

const norm = (s: string): string => s.replace(/[  ]/g, ' ');

/** The old expression, evaluated with the process zone set to `zone`. */
function oldPeriod(zone: string, start: Date, end: Date): string {
  process.env.TZ = zone;
  return norm(`${start.toLocaleDateString()} - ${end.toLocaleDateString()}`);
}

function sentinel(zone: string): void {
  process.env.TZ = zone;
  if (zone === 'America/New_York') {
    expect(new Date('2024-03-05').getDate()).toBe(4); // G41, G162
  }
}

function gridpoint(startIso: string) {
  const validTime = `${new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString()}/PT6H`;
  return {
    properties: {
      snowfallAmount: { uom: 'wmoUnit:mm', values: [{ validTime, value: 25.4 }] },
      iceAccumulation: { uom: 'wmoUnit:mm', values: [{ validTime, value: 5.08 }] },
    },
  };
}

describe('winter period: fixture non-vacuity', () => {
  it('the zones disagree on the period', () => {
    const s = new Date(START);
    const e = new Date(s.getTime() + 7 * DAY_MS);
    const la = oldPeriod(LOCATION_ZONE, s, e);
    expect(oldPeriod('UTC', s, e)).not.toBe(la);
    expect(oldPeriod('Pacific/Auckland', s, e)).not.toBe(la);
  });
});

describe.each(ZONES)('(a) extractors, process zone %s', zone => {
  it('print the period in the given zone', () => {
    const s = new Date(START);
    const e = new Date('2025-11-15T03:00:00Z');
    const ref = oldPeriod(LOCATION_ZONE, s, e);
    sentinel(zone);
    const gp = gridpoint(START).properties as never;
    const snow = extractSnowfallForecast(gp, s, e, LOCATION_ZONE);
    const ice = extractIceAccumulation(gp, s, e, LOCATION_ZONE);
    expect(snow?.period && norm(snow.period)).toBe(ref);
    expect(ice?.period && norm(ice.period)).toBe(ref);
  });
});

describe.each(['America/New_York', 'Pacific/Auckland'])('(b) no zone, process zone %s', zone => {
  it('keeps the old expression in the process zone', () => {
    const s = new Date(START);
    const e = new Date('2025-11-15T03:00:00Z');
    const ref = oldPeriod(zone, s, e);
    sentinel(zone);
    const gp = gridpoint(START).properties as never;
    for (const fn of [extractSnowfallForecast, extractIceAccumulation]) {
      const omitted = fn(gp, s, e);
      const explicit = fn(gp, s, e, undefined);
      expect(omitted?.period && norm(omitted.period)).toBe(ref);
      expect(explicit?.period && norm(explicit.period)).toBe(ref);
    }
  });
});

// ---- handler fakes (modeled on forecast-noaa-source-note / weather-summary-source) ----

function forecastPeriod(): ForecastPeriod {
  return {
    number: 1, name: 'Day',
    startTime: '2025-11-08T06:00:00-08:00', endTime: '2025-11-08T18:00:00-08:00',
    isDaytime: true, temperature: 40, temperatureUnit: 'F', temperatureTrend: null,
    probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: null },
    dewpoint: { unitCode: 'wmoUnit:degC', value: 1 },
    relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    windSpeed: '5 mph', windDirection: 'N', icon: '',
    shortForecast: 'Snow', detailedForecast: 'Snow.',
  } as ForecastPeriod;
}

function noaaFake() {
  const response = {
    properties: {
      units: 'us', forecastGenerator: 'test',
      generatedAt: '2025-11-08T00:00:00-08:00', updateTime: '2025-11-08T00:00:00-08:00',
      validTimes: '2025-11-08T00:00:00-08:00/P7D',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      periods: [forecastPeriod()],
    },
  };
  return {
    getPointData: vi.fn().mockResolvedValue({
      properties: { gridId: 'TEST', gridX: 1, gridY: 1, timeZone: LOCATION_ZONE },
    }),
    getForecast: vi.fn().mockResolvedValue(response),
    getHourlyForecast: vi.fn().mockResolvedValue(response),
    getGridpointData: vi.fn().mockResolvedValue(gridpoint(START)),
    getGridpointDataByCoordinates: vi.fn().mockResolvedValue(gridpoint(START)),
  };
}

const openMeteoFake = () => ({ getForecast: vi.fn(), getWeatherDescription: vi.fn() });
const textOf = (r: { content: Array<{ type: string; text: string }> }): string =>
  norm(r.content.map(b => b.text).join('\n'));

/** The days the handlers really use: validateForecastDays default. */
const DAYS = FormatConstants.defaultForecastDays;

function expectedLine(label: string, value: string, period: string): string {
  return `**${label}:** ${value} (${period})`;
}

function periodsFor(): string {
  const now = new Date(START);
  const end = new Date(now.getTime() + DAYS * DAY_MS);
  return oldPeriod(LOCATION_ZONE, now, end);
}

describe.each(ZONES)('(c) get_forecast on the NOAA path, process zone %s', zone => {
  it('prints snowfall and ice periods in the NWS point zone', async () => {
    const ref = periodsFor();
    sentinel(zone);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(START));
    const result = await handleGetForecast(
      { ...SEATTLE },
      noaaFake() as unknown as NOAAService,
      openMeteoFake() as unknown as OpenMeteoService,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService
    );
    const text = textOf(result);
    expect(text).toContain(expectedLine('Snowfall Forecast', '1in', ref));
    expect(text).toContain(expectedLine('Ice Accumulation', '0.2in', ref));
  });
});

describe.each(ZONES)('(d) get_weather_summary, process zone %s', zone => {
  it('carries the same period through the summary forecast section', async () => {
    const ref = periodsFor();
    sentinel(zone);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(START));
    const result = await handleGetWeatherSummary(
      { ...SEATTLE, include: ['forecast'] },
      noaaFake() as unknown as NOAAService,
      openMeteoFake() as unknown as OpenMeteoService,
      { isAvailable: vi.fn().mockReturnValue(false) } as unknown as NCEIService,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService
    );
    const text = textOf(result);
    expect(text).toContain(expectedLine('Snowfall Forecast', '1in', ref));
    expect(text).toContain(expectedLine('Ice Accumulation', '0.2in', ref));
  });
});
