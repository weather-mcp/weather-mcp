/**
 * The climate-normals day is the location's calendar day, never the server's.
 *
 * Driven through the real handlers (G45). The requested (month, day) is read
 * from the Open-Meteo `getClimateNormals` spy's call arguments, so each row
 * proves which day the handler asked for, in every process zone.
 *
 *   (a) METAR, Seattle, observed 2024-07-15T03:00Z  → Jul 14 (Seattle evening)
 *   (b) NOAA current, station zone Los Angeles, same instant → Jul 14
 *   (c) NOAA forecast, first period 2024-07-14T18:00-07:00 → Jul 14
 *   (d) Open-Meteo forecast, daily.time[0] '2024-03-05' → Mar 5
 *
 * Before the fix the day came from `new Date(s)` read with local getters:
 * (a), (b), (c) gave Jul 15 under UTC and Auckland, and (d) gave Mar 4 under
 * New York. See plan-date-only-zone-shift (RF-25).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { dayOfYearIndex } from '../../src/services/acis.js';
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
import type { DailyRecords, DailyRecordSlot } from '../../src/types/acis.js';

const ZONES = ['UTC', 'America/New_York', 'Pacific/Auckland'] as const;

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
});

/** Switch the process zone, and prove the switch took (G41). */
function enterZone(zone: string): void {
  process.env.TZ = zone;
  if (zone === 'America/New_York') {
    expect(new Date('2024-03-05').getDate()).toBe(4);
  }
}

const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };
const PARIS = { latitude: 48.8566, longitude: 2.3522 };

/** 2024-07-15T03:00:00Z — 20:00 on Jul 14 in Seattle. */
const OBSERVED_ISO = '2024-07-15T03:00:00Z';
const OBSERVED_MS = Date.parse(OBSERVED_ISO);

function pinClock(): void {
  // Fake Date only (G133); 20 minutes after the observation, so it is fresh.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(OBSERVED_MS + 20 * 60000));
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

function buildOpenMeteoFake(extra: Record<string, unknown> = {}) {
  return {
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    getClimateNormals: vi.fn().mockResolvedValue({
      tempHigh: 70,
      tempLow: 50,
      precipitation: 0.1,
      source: 'Open-Meteo',
      month: 1,
      day: 1,
    }),
    ...extra,
  };
}

function requestedDay(openMeteo: { getClimateNormals: ReturnType<typeof vi.fn> }): [number, number] {
  expect(openMeteo.getClimateNormals).toHaveBeenCalledTimes(1);
  const call = openMeteo.getClimateNormals.mock.calls[0];
  return [call[2] as number, call[3] as number];
}

const nceiFake = { isAvailable: vi.fn().mockReturnValue(false) };

function buildDailyRecords(month: number, day: number, slot: DailyRecordSlot): DailyRecords {
  const days: DailyRecordSlot[] = Array.from({ length: 366 }, () => ({}));
  days[dayOfYearIndex(month, day)] = slot;
  return { stationName: 'Test Station', porStartYear: 1945, days };
}

function buildAcisFake(records: DailyRecords) {
  return {
    findRecordsStation: vi.fn().mockResolvedValue({ id: 'TESTthr', name: records.stationName, porStartYear: 1945 }),
    getDailyRecords: vi.fn().mockResolvedValue(records),
  };
}

// --- (a) METAR -------------------------------------------------------------

function buildMetarObservation(): MetarObservation {
  return {
    icaoId: 'KSEA',
    name: 'Seattle-Tacoma Intl',
    lat: SEATTLE.latitude + 0.01,
    lon: SEATTLE.longitude + 0.01,
    elev: 130,
    obsTime: Math.round(OBSERVED_MS / 1000),
    reportTime: OBSERVED_ISO,
    receiptTime: OBSERVED_ISO,
    rawOb: 'METAR KSEA 150300Z 19006KT 10SM FEW250 20/10 A3000',
    metarType: 'METAR',
    qcField: 0,
    temp: 20,
    dewp: 10,
    wdir: 190,
    wspd: 6,
    altim: 1015,
    visib: 10,
    clouds: [{ cover: 'FEW', base: 25000 }],
    fltCat: 'VFR',
  } as MetarObservation;
}

async function runMetar() {
  const openMeteo = buildOpenMeteoFake();
  const aviation = { getMetarsInBoundingBox: vi.fn().mockResolvedValue([buildMetarObservation()]) };
  const acis = buildAcisFake(buildDailyRecords(7, 14, { high: { value: 99, year: 1977 } }));
  const noaa = {
    getStations: vi.fn().mockRejectedValue(new Error('not expected')),
    getLatestObservation: vi.fn().mockRejectedValue(new Error('not expected')),
  };
  const result = await handleGetCurrentConditions(
    { ...SEATTLE, source: 'metar', include_normals: true },
    noaa as unknown as NOAAService,
    openMeteo as unknown as OpenMeteoService,
    nceiFake as unknown as NCEIService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    acis as unknown as AcisService,
    aviation as unknown as AviationWeatherService
  );
  return { openMeteo, text: textOf(result) };
}

// --- (b) NOAA current --------------------------------------------------------

async function runNoaaCurrent() {
  const openMeteo = buildOpenMeteoFake();
  const observation = {
    properties: {
      '@id': `https://api.weather.gov/stations/KSEA/observations/${OBSERVED_ISO}`,
      elevation: { unitCode: 'wmoUnit:m', value: 130 },
      station: 'https://api.weather.gov/stations/KSEA',
      timestamp: '2024-07-15T03:00:00+00:00',
      textDescription: 'Clear',
      temperature: { unitCode: 'wmoUnit:degC', value: 20 },
      dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
      windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 270 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 10 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    },
  };
  const noaa = {
    getStations: vi.fn().mockResolvedValue({
      type: 'FeatureCollection',
      features: [{
        properties: {
          '@id': 'https://api.weather.gov/stations/KSEA',
          elevation: { unitCode: 'wmoUnit:m', value: 130 },
          stationIdentifier: 'KSEA',
          name: 'Seattle',
          timeZone: 'America/Los_Angeles',
        },
      }],
    }),
    getLatestObservation: vi.fn().mockResolvedValue(observation),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not requested')),
  };
  const acis = buildAcisFake(buildDailyRecords(7, 14, { high: { value: 99, year: 1977 } }));
  const result = await handleGetCurrentConditions(
    { ...SEATTLE, include_normals: true },
    noaa as unknown as NOAAService,
    openMeteo as unknown as OpenMeteoService,
    nceiFake as unknown as NCEIService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    acis as unknown as AcisService
  );
  return { openMeteo, text: textOf(result) };
}

// --- (c) NOAA forecast -------------------------------------------------------

function buildPeriod(): ForecastPeriod {
  return {
    number: 1,
    name: 'Tonight',
    startTime: '2024-07-14T18:00:00-07:00',
    endTime: '2024-07-15T06:00:00-07:00',
    isDaytime: false,
    temperature: 58,
    temperatureUnit: 'F',
    temperatureTrend: null,
    probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: null },
    dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
    relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    windSpeed: '5 mph',
    windDirection: 'N',
    icon: '',
    shortForecast: 'Clear',
    detailedForecast: 'Clear.',
  } as ForecastPeriod;
}

async function runNoaaForecast() {
  const openMeteo = buildOpenMeteoFake();
  const forecast = {
    properties: {
      units: 'us',
      forecastGenerator: 'test',
      generatedAt: '2024-07-14T17:00:00-07:00',
      updateTime: '2024-07-14T17:00:00-07:00',
      validTimes: '2024-07-14T17:00:00-07:00/P7D',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      periods: [buildPeriod()],
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
  await handleGetForecast(
    { ...SEATTLE, include_normals: true },
    noaa as unknown as NOAAService,
    openMeteo as unknown as OpenMeteoService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    nceiFake as unknown as NCEIService,
    undefined
  );
  return { openMeteo };
}

// --- (d) Open-Meteo forecast -------------------------------------------------

async function runOpenMeteoForecast() {
  const response: OpenMeteoForecastResponse = {
    latitude: 48.86,
    longitude: 2.35,
    generationtime_ms: 0.1,
    utc_offset_seconds: -18000,
    timezone: 'America/New_York',
    timezone_abbreviation: 'EST',
    elevation: 35,
    daily: {
      time: ['2024-03-05', '2024-03-06'],
      temperature_2m_max: [10, 11],
      temperature_2m_min: [1, 2],
    },
  };
  const openMeteo = buildOpenMeteoFake({ getForecast: vi.fn().mockResolvedValue(response) });
  await handleGetForecast(
    { ...PARIS, include_normals: true },
    {} as unknown as NOAAService,
    openMeteo as unknown as OpenMeteoService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    nceiFake as unknown as NCEIService,
    undefined
  );
  return { openMeteo };
}

describe.each(ZONES)('climate-normals day under TZ=%s', (zone) => {
  it('(a) METAR: a Seattle evening observation asks for the Seattle day', async () => {
    enterZone(zone);
    pinClock();
    const { openMeteo, text } = await runMetar();
    expect(requestedDay(openMeteo)).toEqual([7, 14]);
    expect(text).toContain('**Records for Jul 14:**');
  });

  it('(b) NOAA current: a UTC-stamped observation asks for the station-zone day', async () => {
    enterZone(zone);
    pinClock();
    const { openMeteo, text } = await runNoaaCurrent();
    expect(requestedDay(openMeteo)).toEqual([7, 14]);
    expect(text).toContain('**Records for Jul 14:**');
  });

  it('(c) NOAA forecast: an evening first period asks for its local day', async () => {
    enterZone(zone);
    pinClock();
    const { openMeteo } = await runNoaaForecast();
    expect(requestedDay(openMeteo)).toEqual([7, 14]);
  });

  it('(d) Open-Meteo forecast: a date-only first day asks for that literal day', async () => {
    enterZone(zone);
    const { openMeteo } = await runOpenMeteoForecast();
    expect(requestedDay(openMeteo)).toEqual([3, 5]);
  });
});
