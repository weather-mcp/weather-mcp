import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logger,
  LogLevel,
  isPiiLoggingEnabled,
  describeErrorForLogging,
  redactCoordinatesForLogging
} from '../../src/utils/logger.js';
import { DataNotFoundError } from '../../src/errors/ApiError.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AxiosInstance } from 'axios';
import { LocationStore } from '../../src/services/locationStore.js';
import { NominatimService } from '../../src/services/nominatim.js';
import { GeocodingService } from '../../src/services/geocoding.js';

// One distinct sentinel per field, so a hit names its channel (G62).
const ALIAS = 'zqalias7731';
const NAME = 'Zqname Lane 7731';
const NOTES = 'zqnotes7731';
const ALT = 'zqalt7731';
const DESC = 'zqdesc7731';
const QUERY = 'Zqquery Street 7731';

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
  });
});
