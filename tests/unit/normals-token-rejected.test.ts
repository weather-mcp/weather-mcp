/**
 * A rejected NCEI_API_TOKEN is the one garnish failure that must surface.
 * The normals still come from Open-Meteo; a note names the rejected token.
 * With no rejection the rendered string is byte-identical to before.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderNormalsSection } from '../../src/utils/normals.js';
import { NceiTokenRejectedError } from '../../src/services/ncei.js';
import { logger } from '../../src/utils/logger.js';
import { DataNotFoundError, ServiceUnavailableError } from '../../src/errors/ApiError.js';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { AcisService } from '../../src/services/acis.js';
import type { AviationWeatherService } from '../../src/services/aviationWeather.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import type { ForecastPeriod } from '../../src/types/noaa.js';
import type { MetarObservation } from '../../src/types/aviationWeather.js';

const FIXTURE_TOKEN = 'tk-ncei-hyg-7731';
const LONG_NOTE = '*Note: NCEI_API_TOKEN was rejected; these are Open-Meteo normals.*\n';
const SHORT_NOTE = '*Note: NCEI_API_TOKEN was rejected.*\n';
const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

const OM_NORMALS = { tempHigh: 70, tempLow: 50, precipitation: 0.1, source: 'Open-Meteo', month: 7, day: 14 };

function omFake(impl?: () => Promise<unknown>) {
  return {
    getClimateNormals: vi.fn(impl ?? (() => Promise.resolve(OM_NORMALS))),
    getWeatherDescription: vi.fn((c: number) => `TESTWX-${c}`),
  };
}
function nceiFake(impl: () => Promise<unknown>, available = true) {
  return { isAvailable: () => available, getClimateNormals: vi.fn(impl) };
}
const rejecting = () => nceiFake(() => Promise.reject(new NceiTokenRejectedError()));

async function render(om: ReturnType<typeof omFake>, ncei: unknown, pt = SEATTLE) {
  return renderNormalsSection(
    om as unknown as OpenMeteoService,
    ncei as NCEIService | undefined,
    pt.latitude, pt.longitude, 7, 14, {}
  );
}

let spies: Record<'info' | 'warn' | 'error' | 'debug', ReturnType<typeof vi.spyOn>>;
beforeEach(() => {
  spies = {
    info: vi.spyOn(logger, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(logger, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(logger, 'error').mockImplementation(() => {}),
    debug: vi.spyOn(logger, 'debug').mockImplementation(() => {}),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('renderNormalsSection with a rejected NCEI token', () => {
  it('renders Open-Meteo normals, then the long note after the Source line', async () => {
    const text = await render(omFake(), rejecting());
    expect(text).toContain('*Source: Open-Meteo*\n');
    expect(text.endsWith(`*Source: Open-Meteo*\n${LONG_NOTE}`)).toBe(true);
    expect(text.indexOf(LONG_NOTE)).toBeGreaterThan(text.indexOf('*Source: Open-Meteo*'));
    expect(text.split('NCEI_API_TOKEN').length - 1).toBe(1);
  });

  it('follows the not-found note with the short note', async () => {
    const om = omFake(() => Promise.reject(new DataNotFoundError('Open-Meteo', 'no samples')));
    const plain = await render(om, nceiFake(() => Promise.reject(new ServiceUnavailableError('NCEI', 'down'))));
    const text = await render(om, rejecting());
    expect(text).toBe(`${plain}${SHORT_NOTE}`);
    expect(text.endsWith(`\n${SHORT_NOTE}`)).toBe(true);
    expect(text).not.toContain('Open-Meteo normals');
  });

  it('follows the retrieval-failure note with the short note', async () => {
    const om = omFake(() => Promise.reject(new Error('boom')));
    const plain = await render(om, nceiFake(() => Promise.reject(new ServiceUnavailableError('NCEI', 'down'))));
    const text = await render(om, rejecting());
    expect(plain).toContain('could not be retrieved');
    expect(text).toBe(`${plain}${SHORT_NOTE}`);
  });

  it('logs a securityEvent warn without the error object or the token', async () => {
    await render(omFake(), nceiFake(() => Promise.reject(new NceiTokenRejectedError())));
    const call = spies.warn.mock.calls.find(c => c[0] === 'NCEI token rejected; using Open-Meteo normals');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ reason: 'token-rejected', securityEvent: true, month: 7, day: 14 });
    expect(call![1]).not.toHaveProperty('error');
    expect(spies.warn.mock.calls.some(c => c[0] === 'NCEI climate normals failed, falling back to Open-Meteo')).toBe(false);
    const all = JSON.stringify([
      ...spies.info.mock.calls, ...spies.warn.mock.calls, ...spies.error.mock.calls, ...spies.debug.mock.calls,
    ]);
    expect(all).not.toContain(FIXTURE_TOKEN);
  });
});

describe('byte-identity controls (no note)', () => {
  it('(a) NCEI success carries no note', async () => {
    const text = await render(omFake(), nceiFake(() => Promise.resolve({ ...OM_NORMALS, source: 'NCEI' })));
    expect(text).toContain('*Source: NCEI*');
    expect(text).not.toContain('NCEI_API_TOKEN');
  });

  it('(b) NCEI unavailable equals the no-NCEI output', async () => {
    const rej = rejecting();
    const text = await render(omFake(), { ...rej, isAvailable: () => false });
    expect(text).toBe(await render(omFake(), undefined));
    expect(text).not.toContain('NCEI_API_TOKEN');
    expect(rej.getClimateNormals).not.toHaveBeenCalled();
  });

  it('(c) NCEI service undefined carries no note', async () => {
    const text = await render(omFake(), undefined);
    expect(text).toBe(await render(omFake(), nceiFake(() => Promise.reject(new Error('x')), false)));
    expect(text).not.toContain('NCEI_API_TOKEN');
  });

  it('(d) non-US point never consults the rejecting service', async () => {
    const rej = rejecting();
    const text = await render(omFake(), rej, LONDON);
    expect(rej.getClimateNormals).not.toHaveBeenCalled();
    expect(text).not.toContain('NCEI_API_TOKEN');
  });

  it('a non-token NCEI failure falls back with no note and the old warn', async () => {
    const text = await render(omFake(), nceiFake(() => Promise.reject(new ServiceUnavailableError('NCEI', 'down'))));
    expect(text).toContain('*Source: Open-Meteo*');
    expect(text).not.toContain('NCEI_API_TOKEN');
    expect(spies.warn.mock.calls.some(c => c[0] === 'NCEI climate normals failed, falling back to Open-Meteo')).toBe(true);
    expect(spies.warn.mock.calls.some(c => c[0] === 'NCEI token rejected; using Open-Meteo normals')).toBe(false);
  });
});

// --- handler level -----------------------------------------------------------

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

describe('handlers surface the note', () => {
  it('get_forecast, NOAA path', async () => {
    const period = {
      number: 1, name: 'Tonight',
      startTime: '2024-07-14T18:00:00-07:00', endTime: '2024-07-15T06:00:00-07:00',
      isDaytime: false, temperature: 58, temperatureUnit: 'F', temperatureTrend: null,
      probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: null },
      dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
      windSpeed: '5 mph', windDirection: 'N', icon: '', shortForecast: 'Clear', detailedForecast: 'Clear.',
    } as ForecastPeriod;
    const forecast = {
      properties: {
        units: 'us', forecastGenerator: 'test',
        generatedAt: '2024-07-14T17:00:00-07:00', updateTime: '2024-07-14T17:00:00-07:00',
        validTimes: '2024-07-14T17:00:00-07:00/P7D',
        elevation: { unitCode: 'wmoUnit:m', value: 10 }, periods: [period],
      },
    };
    const noaa = {
      getPointData: vi.fn().mockResolvedValue({
        properties: { gridId: 'SEW', gridX: 1, gridY: 1, timeZone: 'America/Los_Angeles' },
      }),
      getForecast: vi.fn().mockResolvedValue(forecast),
      getHourlyForecast: vi.fn().mockResolvedValue(forecast),
      getGridpointData: vi.fn().mockRejectedValue(new Error('not needed')),
      getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed')),
    };
    const result = await handleGetForecast(
      { ...SEATTLE, include_normals: true },
      noaa as unknown as NOAAService,
      omFake() as unknown as OpenMeteoService,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService,
      rejecting() as unknown as NCEIService,
      undefined
    );
    const text = textOf(result);
    expect(text).toContain('*Source: Open-Meteo*');
    expect(text).toContain(LONG_NOTE);
  });

  it('get_forecast, Open-Meteo path', async () => {
    const response: OpenMeteoForecastResponse = {
      latitude: 47.6, longitude: -122.33, generationtime_ms: 0.1, utc_offset_seconds: -25200,
      timezone: 'America/Los_Angeles', timezone_abbreviation: 'PDT', elevation: 35,
      daily: { time: ['2024-07-14', '2024-07-15'], temperature_2m_max: [24, 25], temperature_2m_min: [14, 15] },
    };
    const om = { ...omFake(), getForecast: vi.fn().mockResolvedValue(response) };
    const result = await handleGetForecast(
      { ...SEATTLE, source: 'openmeteo', include_normals: true },
      {} as unknown as NOAAService,
      om as unknown as OpenMeteoService,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService,
      rejecting() as unknown as NCEIService,
      undefined
    );
    const text = textOf(result);
    expect(text).toContain('*Source: Open-Meteo*');
    expect(text).toContain(LONG_NOTE);
  });

  it('get_current_conditions, METAR path', async () => {
    const observedMs = Date.parse('2024-07-15T03:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(observedMs + 20 * 60000));
    const obs = {
      icaoId: 'KSEA', name: 'Seattle-Tacoma Intl',
      lat: SEATTLE.latitude + 0.01, lon: SEATTLE.longitude + 0.01, elev: 130,
      obsTime: Math.round(observedMs / 1000),
      reportTime: '2024-07-15T03:00:00Z', receiptTime: '2024-07-15T03:00:00Z',
      rawOb: 'METAR KSEA 150300Z 19006KT 10SM FEW250 20/10 A3000', metarType: 'METAR', qcField: 0,
      temp: 20, dewp: 10, wdir: 190, wspd: 6, altim: 1015, visib: 10,
      clouds: [{ cover: 'FEW', base: 25000 }], fltCat: 'VFR',
    } as MetarObservation;
    const aviation = { getMetarsInBoundingBox: vi.fn().mockResolvedValue([obs]) };
    const noaa = {
      getStations: vi.fn().mockRejectedValue(new Error('not expected')),
      getLatestObservation: vi.fn().mockRejectedValue(new Error('not expected')),
    };
    const acis = {
      findRecordsStation: vi.fn().mockRejectedValue(new Error('no records')),
      getDailyRecords: vi.fn().mockRejectedValue(new Error('no records')),
    };
    const result = await handleGetCurrentConditions(
      { ...SEATTLE, source: 'metar', include_normals: true },
      noaa as unknown as NOAAService,
      omFake() as unknown as OpenMeteoService,
      rejecting() as unknown as NCEIService,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService,
      acis as unknown as AcisService,
      aviation as unknown as AviationWeatherService
    );
    const text = textOf(result);
    expect(text).toContain('*Source: Open-Meteo*');
    expect(text).toContain(LONG_NOTE);
  });
});
