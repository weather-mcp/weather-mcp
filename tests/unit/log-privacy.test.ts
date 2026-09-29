import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logger,
  LogLevel,
  isPiiLoggingEnabled,
  describeErrorForLogging,
  redactCoordinatesForLogging
} from '../../src/utils/logger.js';
import { DataNotFoundError, ServiceUnavailableError } from '../../src/errors/ApiError.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AxiosInstance } from 'axios';
import { LocationStore } from '../../src/services/locationStore.js';
import { NominatimService } from '../../src/services/nominatim.js';
import { GeocodingService } from '../../src/services/geocoding.js';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { handleGetHistoricalWeather } from '../../src/handlers/historicalWeatherHandler.js';
import { RainViewerService } from '../../src/services/rainviewer.js';
import { clampBoundingBox } from '../../src/services/aviationWeather.js';
import { getClimateNormals } from '../../src/utils/normals.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { MetnoService } from '../../src/services/metno.js';

// One distinct sentinel per field, so a hit names its channel (G62).
const ALIAS = 'zqalias7731';
const NAME = 'Zqname Lane 7731';
const NOTES = 'zqnotes7731';
const ALT = 'zqalt7731';
const DESC = 'zqdesc7731';
const QUERY = 'Zqquery Street 7731';

// Coordinate sentinels (G36), away from any .xx5 rounding seam.
const SEATTLE = { latitude: 47.618273, longitude: -122.351946 };
// Inside the US routing box, so auto-routes to NOAA (forecast-fallback.test.ts:30-33).
const TORONTO = { latitude: 43.653217, longitude: -79.383241 };
// Outside every US routing box, so auto routes to Open-Meteo.
const TOKYO = { latitude: 35.676213, longitude: 139.650312 };

// Fakes copied from tests/unit/forecast-fallback.test.ts:30-80 (forecast),
// tests/unit/current-conditions-global.test.ts:105-160 (current) and
// tests/unit/historical-routing.test.ts:44-92 (historical). Those files are
// locks and are not edited.
const noaaRejection = () =>
  new DataNotFoundError('NOAA', 'Unable to provide data for requested point');

const forecastFakes = () => {
  const noaa = { getPointData: vi.fn().mockRejectedValue(noaaRejection()) };
  const openMeteo = {
    getForecast: vi.fn().mockResolvedValue({
      latitude: 43.65,
      longitude: -79.38,
      generationtime_ms: 0.1,
      utc_offset_seconds: -18000,
      timezone: 'America/Toronto',
      timezone_abbreviation: 'EST',
      elevation: 76,
      daily: {
        time: ['2024-01-01', '2024-01-02'],
        temperature_2m_max: [32, 30],
        temperature_2m_min: [20, 18]
      }
    }),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`)
  };
  return { noaa, openMeteo };
};

const currentFakes = () => {
  const noaa = { getStations: vi.fn().mockRejectedValue(noaaRejection()) };
  const openMeteo = {
    getCurrentConditions: vi.fn().mockResolvedValue({
      latitude: 43.65,
      longitude: -79.38,
      generationtime_ms: 0.1,
      utc_offset_seconds: 0,
      timezone: 'America/Toronto',
      timezone_abbreviation: 'EST',
      elevation: 76,
      current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°F' },
      current: {
        time: '2024-01-01T12:00',
        interval: 900,
        temperature_2m: 60,
        relative_humidity_2m: 55,
        apparent_temperature: 60,
        dew_point_2m: 50,
        is_day: 1,
        precipitation: 0,
        weather_code: 3,
        cloud_cover: 40,
        pressure_msl: 1012,
        wind_speed_10m: 10,
        wind_direction_10m: 200,
        wind_gusts_10m: 10
      },
      daily: { time: ['2024-01-01'], temperature_2m_max: [65], temperature_2m_min: [55] }
    }),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`)
  };
  return { noaa, openMeteo, ncei: { isAvailable: vi.fn().mockReturnValue(false) } };
};

const historicalFakes = () => {
  const noaa = { getHistoricalObservations: vi.fn().mockRejectedValue(noaaRejection()) };
  const openMeteo = {
    getHistoricalWeather: vi.fn().mockResolvedValue({
      latitude: 43.65,
      longitude: -79.38,
      generationtime_ms: 0.1,
      utc_offset_seconds: 0,
      timezone: 'Etc/UTC',
      timezone_abbreviation: 'UTC',
      elevation: 11,
      hourly: { time: ['2026-07-14T00:00'], temperature_2m: [15] }
    }),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`)
  };
  return { noaa, openMeteo };
};

const recentDate = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

// Coordinate-only args: the store and geocoder are never touched.
const noStore = {} as unknown as LocationStore;
const noGeocoder = {} as unknown as GeocodingService;

describe('log-privacy helpers', () => {
  let savedLevel: LogLevel;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    savedLevel = logger.getLevel();
    logger.setLevel(LogLevel.DEBUG);
    vi.stubEnv('LOG_PII', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logger.setLevel(savedLevel);
    errorSpy.mockRestore();
  });

  const typed = () =>
    Object.assign(new Error('zqquery Street 7731 not found'), { code: 'ENOENT' });

  describe('isPiiLoggingEnabled', () => {
    it('is false when unset', () => {
      vi.unstubAllEnvs();
      delete process.env.LOG_PII;
      expect(isPiiLoggingEnabled()).toBe(false);
    });

    it.each(['1', 'TRUE', ''])('is false for %j', (value) => {
      vi.stubEnv('LOG_PII', value);
      expect(isPiiLoggingEnabled()).toBe(false);
    });

    it("is true only for 'true'", () => {
      vi.stubEnv('LOG_PII', 'true');
      expect(isPiiLoggingEnabled()).toBe(true);
    });
  });

  describe('describeErrorForLogging', () => {
    it('reports only class and code by default', () => {
      expect(describeErrorForLogging(typed())).toEqual({ name: 'Error', code: 'ENOENT' });
    });

    it('reports the class of a typed error with no code', () => {
      expect(describeErrorForLogging(new DataNotFoundError('NOAA', 'zqquery Street 7731 missing')))
        .toEqual({ name: 'DataNotFoundError' });
    });

    it('stringifies a numeric code', () => {
      expect(describeErrorForLogging(Object.assign(new Error('x'), { code: 503 })))
        .toEqual({ name: 'Error', code: '503' });
    });

    it('omits a non-finite numeric code', () => {
      const result = describeErrorForLogging(Object.assign(new Error('x'), { code: NaN }));
      expect(result).toEqual({ name: 'Error' });
      expect('code' in result).toBe(false);
    });

    it('omits an object code, with no code key', () => {
      const result = describeErrorForLogging(Object.assign(new Error('x'), { code: { a: 1 } }));
      expect(result).toEqual({ name: 'Error' });
      expect(Object.keys(result)).toEqual(['name']);
    });

    it('reports a thrown string as its type', () => {
      expect(describeErrorForLogging('zqquery Street 7731')).toEqual({ name: 'string' });
    });

    it('reports undefined as its type', () => {
      expect(describeErrorForLogging(undefined)).toEqual({ name: 'undefined' });
    });

    it('reports null as object', () => {
      expect(describeErrorForLogging(null)).toEqual({ name: 'object' });
    });

    it('never throws on a hostile getter', () => {
      const hostile = new Proxy({}, {
        get() {
          throw new Error('boom');
        }
      });
      let result: unknown;
      expect(() => {
        result = describeErrorForLogging(hostile);
      }).not.toThrow();
      expect(result).toEqual({ name: 'unknown' });
    });

    it('adds message and stack under LOG_PII', () => {
      vi.stubEnv('LOG_PII', 'true');
      const result = describeErrorForLogging(typed());
      expect(result.name).toBe('Error');
      expect(result.code).toBe('ENOENT');
      expect(result.message).toBe('zqquery Street 7731 not found');
      expect(typeof result.stack).toBe('string');
    });

    it('adds a stringified message but no stack for a non-Error under LOG_PII', () => {
      vi.stubEnv('LOG_PII', 'true');
      expect(describeErrorForLogging('zqraw7731')).toEqual({ name: 'string', message: 'zqraw7731' });
    });
  });

  describe('redactCoordinatesForLogging', () => {
    it('rounds to 2 dp when LOG_PII is off', () => {
      expect(redactCoordinatesForLogging(47.618273, -122.351946)).toEqual({ lat: 47.62, lon: -122.35 });
    });

    it('passes full precision under LOG_PII', () => {
      vi.stubEnv('LOG_PII', 'true');
      expect(redactCoordinatesForLogging(47.618273, -122.351946)).toEqual({ lat: 47.618273, lon: -122.351946 });
    });
  });
});

type LogRecord = { message: string; metadata?: Record<string, unknown> };

describe('success-path log privacy', () => {
  let savedLevel: LogLevel;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let dir: string;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    savedLevel = logger.getLevel();
    logger.setLevel(LogLevel.DEBUG);
    vi.stubEnv('LOG_PII', '');
    dir = mkdtempSync(join(tmpdir(), 'log-privacy-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logger.setLevel(savedLevel);
    errorSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const records = (): LogRecord[] =>
    errorSpy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])) as LogRecord);
  const find = (message: string): LogRecord[] => records().filter((r) => r.message === message);
  const whole = (): string => JSON.stringify(records());

  const driveStore = (): void => {
    const store = new LocationStore(join(dir, 'locations.json'));
    const input = {
      name: NAME,
      latitude: 47.618273,
      longitude: -122.351946,
      notes: NOTES,
      alternateNames: [ALT],
      description: DESC
    };
    store.set('ZqAlias7731', input);
    store.set('ZqAlias7731', { ...input, notes: NOTES + ' changed' });
    store.remove(ALIAS);
  };

  const driveNominatim = async (): Promise<{ get: ReturnType<typeof vi.spyOn> }> => {
    const svc = new NominatimService();
    const get = vi
      .spyOn((svc as unknown as { client: AxiosInstance }).client, 'get')
      .mockResolvedValue({
        data: [
          {
            place_id: 1,
            licence: 'x',
            osm_type: 'node',
            osm_id: 1,
            lat: '47.618273',
            lon: '-122.351946',
            display_name: NAME
          }
        ]
      });
    vi.spyOn(svc as unknown as { enforceRateLimit: () => Promise<void> }, 'enforceRateLimit')
      .mockResolvedValue();
    await svc.searchLocation(QUERY, 1);
    await svc.searchLocation(QUERY, 1);
    expect(get).toHaveBeenCalledTimes(1);
    return { get };
  };

  const driveGeocoding = async (): Promise<void> => {
    const svc = new GeocodingService();
    const providers = svc as unknown as Record<'census' | 'nominatim' | 'openmeteo', { client: AxiosInstance }>;
    const gets = (['census', 'nominatim', 'openmeteo'] as const).map((k) =>
      vi.spyOn(providers[k].client, 'get').mockResolvedValue({ data: {} })
    );
    await expect(svc.geocode(QUERY, 1)).rejects.toThrow();
    expect(gets.some((g) => g.mock.calls.length > 0)).toBe(true);
  };

  const driveForecastFallback = async (): Promise<void> => {
    const f = forecastFakes();
    await handleGetForecast(
      { ...TORONTO },
      f.noaa as unknown as NOAAService,
      f.openMeteo as unknown as OpenMeteoService,
      noStore,
      noGeocoder,
      { isAvailable: () => false } as unknown as NCEIService
    );
    expect(f.noaa.getPointData).toHaveBeenCalled();
    expect(f.openMeteo.getForecast).toHaveBeenCalledTimes(1);
  };

  const driveCurrentFallback = async (): Promise<void> => {
    const f = currentFakes();
    await handleGetCurrentConditions(
      { ...TORONTO },
      f.noaa as unknown as NOAAService,
      f.openMeteo as unknown as OpenMeteoService,
      f.ncei as unknown as NCEIService,
      noStore,
      noGeocoder
    );
    expect(f.noaa.getStations).toHaveBeenCalled();
    expect(f.openMeteo.getCurrentConditions).toHaveBeenCalledTimes(1);
  };

  const driveHistoricalFallback = async (): Promise<void> => {
    const f = historicalFakes();
    await handleGetHistoricalWeather(
      { ...TORONTO, start_date: recentDate(2), end_date: recentDate(1) },
      f.noaa as unknown as NOAAService,
      f.openMeteo as unknown as OpenMeteoService,
      noStore,
      noGeocoder
    );
    expect(f.noaa.getHistoricalObservations).toHaveBeenCalledTimes(1);
    expect(f.openMeteo.getHistoricalWeather).toHaveBeenCalledTimes(1);
  };

  const FALLBACK_DRIVES: Array<[string, string, () => Promise<void>]> = [
    ['get_forecast', 'NOAA rejected auto-routed location; falling back to Open-Meteo', driveForecastFallback],
    ['get_current_conditions', 'NOAA rejected auto-routed location; falling back to Open-Meteo', driveCurrentFallback],
    ['get_historical_weather', 'NOAA rejected recent-date historical location; falling back to Open-Meteo', driveHistoricalFallback]
  ];

  const driveRainViewerClamp = (): void => {
    new RainViewerService().buildCoordinateTileUrl(
      { time: 1699999999, path: '/v2/radar/1699999999' },
      89.123456,
      10.123456
    );
  };

  // minLon > maxLon before clamping, so it still inverts afterwards.
  const BBOX = { minLat: 10.123456, maxLat: 11.123456, minLon: 20.123456, maxLon: 10.987654 };
  const driveBboxClamp = (): void => {
    const result = clampBoundingBox({ ...BBOX });
    expect(result.maxLon).toBe(result.minLon); // the invert branch really ran
  };

  const driveNormals = async (): Promise<void> => {
    const openMeteo = {
      getClimateNormals: vi.fn().mockResolvedValue({
        tempHigh: 65, tempLow: 45, precipitation: 0.1, source: 'Open-Meteo', month: 1, day: 1
      })
    };
    await getClimateNormals(
      openMeteo as unknown as OpenMeteoService,
      undefined,
      SEATTLE.latitude,
      SEATTLE.longitude,
      1,
      1
    );
    expect(openMeteo.getClimateNormals).toHaveBeenCalledTimes(1);
  };

  // Minimal met.no fake copied from tests/unit/forecast-metno-fallback.test.ts
  // (buildMetnoFake / buildMetnoAggregate / buildMetnoDay, ~:145-195). That file
  // is a lock and is not edited.
  const metnoAggregate = () => {
    const days = Array.from({ length: 2 }, (_, i) => {
      const date = `2026-09-${String(11 + i).padStart(2, '0')}`;
      return {
        date,
        startsAt: `${date}T00:00:00.000+02:00`,
        hoursCovered: 24,
        complete: true,
        temperatureMaxC: 17,
        temperatureMinC: 10,
        temperatureBasis: 'window',
        precipitationMm: 0,
        precipitationProbabilityMaxPct: 10,
        windSpeedMaxMps: 4,
        windFromDirectionDeg: 180,
        symbolCode: 'partlycloudy_day'
      };
    });
    return {
      timezone: 'Europe/Oslo',
      elevationM: 20,
      days,
      completeDayCount: days.length,
      entriesSeen: 8,
      entriesAggregated: 8,
      entriesTrimmed: false
    };
  };

  const driveMetnoFallback = async (): Promise<void> => {
    const noaa = {};
    const openMeteo = {
      getForecast: vi
        .fn()
        .mockRejectedValue(new ServiceUnavailableError('OpenMeteo', 'OpenMeteo API is currently unavailable')),
      getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`)
    };
    const metno = { getForecast: vi.fn().mockResolvedValue(metnoAggregate()) };
    await handleGetForecast(
      { ...TOKYO, days: 5 },
      noaa as unknown as NOAAService,
      openMeteo as unknown as OpenMeteoService,
      noStore,
      noGeocoder,
      { isAvailable: () => false } as unknown as NCEIService,
      undefined,
      undefined,
      metno as unknown as MetnoService
    );
    expect(openMeteo.getForecast).toHaveBeenCalledTimes(1);
    expect(metno.getForecast).toHaveBeenCalledTimes(1);
  };

  // 65 members > the 64-member parse ceiling (MAX_MEMBER_SERIES, ensembleSpread.ts:58).
  // Only temperature_2m_max carries members: the ceiling is per variable.
  const driveEnsembleCeiling = async (): Promise<void> => {
    const daily: Record<string, unknown> = {
      time: ['2026-09-11', '2026-09-12'],
      temperature_2m_max: [80, 81]
    };
    for (let m = 1; m <= 65; m++) {
      daily[`temperature_2m_max_member${String(m).padStart(2, '0')}`] = [78 + (m % 5), 79 + (m % 5)];
    }
    const openMeteo = {
      getEnsembleSpread: vi.fn().mockResolvedValue({
        latitude: 35.68,
        longitude: 139.65,
        generationtime_ms: 0.1,
        utc_offset_seconds: 32400,
        timezone: 'Asia/Tokyo',
        timezone_abbreviation: 'JST',
        elevation: 40,
        daily
      }),
      getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`)
    };
    await handleGetForecast(
      { ...TOKYO, ensemble_spread: true },
      {} as unknown as NOAAService,
      openMeteo as unknown as OpenMeteoService,
      noStore,
      noGeocoder,
      { isAvailable: () => false } as unknown as NCEIService
    );
    expect(openMeteo.getEnsembleSpread).toHaveBeenCalledTimes(1);
  };

  describe('default logs — success path', () => {
    it('saved-location lines carry no alias, name, notes, alternate name, description or coordinates', () => {
      driveStore();
      expect(find('Created new saved location')).toHaveLength(1);
      const updated = find('Updated saved location');
      expect(updated).toHaveLength(1);
      expect(updated[0].metadata?.isUpdate).toBe(true);
      expect(find('Removed saved location')).toHaveLength(1);
      const all = whole().toLowerCase();
      for (const needle of [ALIAS, NAME, NOTES, ALT, DESC, '47.618', '122.351']) {
        expect(all).not.toContain(needle.toLowerCase());
      }
    });

    it('nominatim lines carry no query, name or coordinates', async () => {
      await driveNominatim();
      const req = find('Nominatim API request');
      expect(req).toHaveLength(1);
      expect(req[0].metadata).toEqual({ limit: 1 });
      expect(find('Nominatim search completed')[0].metadata).toMatchObject({ resultCount: 1 });
      const hit = find('Nominatim cache hit');
      expect(hit).toHaveLength(1);
      expect('metadata' in hit[0]).toBe(false);
      const all = whole();
      for (const needle of [QUERY, NAME, '47.618', '122.351']) {
        expect(all).not.toContain(needle);
      }
    });

    it('geocoding debug lines carry no query', async () => {
      await driveGeocoding();
      const lines = records().filter((r) => /^(Census\.gov|Nominatim|Open-Meteo) geocode/.test(r.message));
      expect(lines.length).toBeGreaterThan(0);
      expect(whole()).not.toContain(QUERY);
    });

    it.each(FALLBACK_DRIVES)('%s NOAA-fallback line rounds the coordinates', async (_tool, message, drive) => {
      await drive();
      const lines = find(message);
      expect(lines).toHaveLength(1);
      expect(lines[0].metadata?.lat).toBe(43.65);
      expect(lines[0].metadata?.lon).toBe(-79.38);
      expect(lines[0].metadata?.fallback).toBe(true);
      expect(whole()).not.toContain('43.653');
      expect(whole()).not.toContain('79.383');
    });

    it('rainviewer clamp line rounds the original latitude', () => {
      driveRainViewerClamp();
      const lines = find('Latitude clamped to Web Mercator safe range');
      expect(lines).toHaveLength(1);
      expect(lines[0].metadata?.original).toBe(89.12);
      expect(whole()).not.toContain('89.123');
    });

    it('METAR bbox clamp line rounds every corner', () => {
      driveBboxClamp();
      const lines = find('Clamped METAR bbox would invert; narrowing to a single-longitude line');
      expect(lines).toHaveLength(1);
      expect(lines[0].metadata?.original).toEqual({
        sw: { lat: 10.12, lon: 20.12 },
        ne: { lat: 11.12, lon: 10.99 }
      });
      for (const raw of ['10.123', '11.123', '20.123', '10.987']) {
        expect(whole()).not.toContain(raw);
      }
    });

    it('climate normals line rounds the coordinates', async () => {
      await driveNormals();
      const lines = find('Using Open-Meteo for climate normals');
      expect(lines).toHaveLength(1);
      expect(lines[0].metadata?.lat).toBe(47.62);
      expect(lines[0].metadata?.lon).toBe(-122.35);
      expect(whole()).not.toContain('47.618');
      expect(whole()).not.toContain('122.351');
    });

    it('MET Norway fallback line rounds the coordinates', async () => {
      await driveMetnoFallback();
      const lines = find('Open-Meteo failed transiently; fell back to MET Norway');
      expect(lines).toHaveLength(1);
      expect(lines[0].metadata?.lat).toBe(35.68);
      expect(lines[0].metadata?.lon).toBe(139.65);
      expect(whole()).not.toContain('35.676');
      expect(whole()).not.toContain('139.650');
    });

    it('ensemble ceiling line rounds the coordinates', async () => {
      await driveEnsembleCeiling();
      const lines = find('Ensemble member series exceeded the parse ceiling');
      expect(lines).toHaveLength(1);
      expect(lines[0].metadata?.lat).toBe(35.68);
      expect(lines[0].metadata?.lon).toBe(139.65);
      expect(whole()).not.toContain('35.676');
      expect(whole()).not.toContain('139.650');
    });
  });

  describe('LOG_PII opt-in — success path', () => {
    beforeEach(() => {
      vi.stubEnv('LOG_PII', 'true');
    });

    it('saved-location lines carry the alias but never the name', () => {
      driveStore();
      const created = find('Created new saved location');
      expect(created).toHaveLength(1);
      expect(created[0].metadata).toEqual({ isUpdate: false, alias: ALIAS });
      expect(find('Removed saved location')[0].metadata).toEqual({ alias: ALIAS });
      expect(whole()).not.toContain(NAME);
    });

    it('nominatim lines carry the query but never the name', async () => {
      await driveNominatim();
      expect(find('Nominatim API request')[0].metadata).toEqual({ query: QUERY, limit: 1 });
      expect(find('Nominatim search completed')[0].metadata?.query).toBe(QUERY);
      expect(find('Nominatim cache hit')[0].metadata).toEqual({ query: QUERY });
      expect(whole()).not.toContain(NAME);
    });

    it('geocoding debug lines carry the query', async () => {
      await driveGeocoding();
      const withQuery = records().filter(
        (r) => /geocode$/.test(r.message) && r.metadata?.query === QUERY
      );
      expect(withQuery.length).toBeGreaterThan(0);
    });

    it('a fallback line carries the full coordinates', async () => {
      await driveForecastFallback();
      const lines = find('NOAA rejected auto-routed location; falling back to Open-Meteo');
      expect(lines).toHaveLength(1);
      expect(lines[0].metadata?.lat).toBe(43.653217);
      expect(lines[0].metadata?.lon).toBe(-79.383241);
    });

    it('the climate normals line carries the full coordinates', async () => {
      await driveNormals();
      const lines = find('Using Open-Meteo for climate normals');
      expect(lines).toHaveLength(1);
      expect(lines[0].metadata?.lat).toBe(47.618273);
      expect(lines[0].metadata?.lon).toBe(-122.351946);
    });

    it('the MET Norway fallback line carries the full coordinates', async () => {
      await driveMetnoFallback();
      const lines = find('Open-Meteo failed transiently; fell back to MET Norway');
      expect(lines).toHaveLength(1);
      expect(lines[0].metadata?.lat).toBe(35.676213);
      expect(lines[0].metadata?.lon).toBe(139.650312);
    });

    it('the ensemble ceiling line carries the full coordinates', async () => {
      await driveEnsembleCeiling();
      const lines = find('Ensemble member series exceeded the parse ceiling');
      expect(lines).toHaveLength(1);
      expect(lines[0].metadata?.lat).toBe(35.676213);
      expect(lines[0].metadata?.lon).toBe(139.650312);
    });
  });
});
