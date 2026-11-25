import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocationStore } from '../../src/services/locationStore.js';
import { handleSaveLocation } from '../../src/handlers/savedLocationsHandler.js';
import { resolveLocationAsync, clearCityGeocodeCache } from '../../src/utils/locationResolver.js';
import {
  GeocodingNotFoundError,
  GeocodingServiceUnavailableError,
  type GeocodingResult,
  type GeocodingService,
} from '../../src/services/geocoding.js';

/**
 * save_location's location_query is looked up the same way as city_name:
 * the same service call, so one text names one place on every tool.
 * Real temp-dir store; the geocoder is a stub, so the file stays offline.
 */

const CENSUS_RESULT: GeocodingResult = {
  name: '350 5TH AVE, NEW YORK, NY, 10118',
  display_name: '350 5TH AVE, NEW YORK, NY, 10118',
  latitude: 40.7479,
  longitude: -73.9851,
  country: 'United States',
  country_code: 'US',
  admin1: 'NY',
  confidence: 'high',
  source: 'census',
};

const NOMINATIM_ADDRESS_RESULT: GeocodingResult = {
  name: '10 Downing Street',
  display_name:
    '10 Downing Street, 10, Downing Street, Westminster, Covent Garden, City of Westminster, Greater London, England, SW1A 2AA, United Kingdom',
  latitude: 51.5035,
  longitude: -0.1277,
  country: 'United Kingdom',
  country_code: 'GB',
  admin1: 'England',
  confidence: 'medium',
  source: 'nominatim',
};

function stubReturning(result: GeocodingResult) {
  const geocode = vi.fn(async () => [result]);
  return { geocode, service: { geocode } as unknown as GeocodingService };
}

function stubRejecting(error: Error) {
  const geocode = vi.fn(async () => {
    throw error;
  });
  return { geocode, service: { geocode } as unknown as GeocodingService };
}

describe('save_location geocode parity with city_name', () => {
  let tempDir: string;
  let storePath: string;
  let store: LocationStore;

  beforeEach(() => {
    clearCityGeocodeCache();
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-parity-'));
    storePath = join(tempDir, 'locations.json');
    store = new LocationStore(storePath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('calls geocode once with the trimmed query and a limit of 1', async () => {
    const { geocode, service } = stubReturning(CENSUS_RESULT);

    await handleSaveLocation({ alias: 'hq', location_query: '  Seattle, WA  ' }, store, service);

    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode).toHaveBeenCalledWith('Seattle, WA', 1);
  });

  it('saves the same place that city_name resolves to', async () => {
    const { service } = stubReturning(NOMINATIM_ADDRESS_RESULT);
    const text = '10 Downing Street, London';

    await handleSaveLocation({ alias: 'pm', location_query: text }, store, service);
    const resolved = await resolveLocationAsync({ city_name: text }, store, service);

    const saved = store.get('pm');
    expect(saved).toBeDefined();
    expect(saved?.latitude).toBe(resolved.latitude);
    expect(saved?.longitude).toBe(resolved.longitude);
    expect(saved?.country_code).toBe(resolved.country_code);
  });

  describe.each([
    ['Census-shaped', CENSUS_RESULT, ['admin2', 'timezone']],
    ['Nominatim-address-shaped', NOMINATIM_ADDRESS_RESULT, ['admin2', 'timezone']],
  ] as const)('saved fields for a %s result', (_label, result, absent) => {
    it('stores result.name (never display_name) and the other fields by name', async () => {
      const { service } = stubReturning(result);

      await handleSaveLocation({ alias: 'spot', location_query: 'anything' }, store, service);

      const saved = store.get('spot');
      expect(saved).toBeDefined();
      expect(saved?.name).toBe(result.name);
      expect(saved?.latitude).toBe(result.latitude);
      expect(saved?.longitude).toBe(result.longitude);
      expect(saved?.country_code).toBe(result.country_code);
      expect(saved?.admin1).toBe(result.admin1);
      for (const field of absent) {
        expect(saved).not.toHaveProperty(field);
      }
    });
  });

  it.each([
    ['GeocodingNotFoundError', new GeocodingNotFoundError('x')],
    ['GeocodingServiceUnavailableError', new GeocodingServiceUnavailableError('y')],
  ])('propagates %s unchanged and writes nothing', async (_label, error) => {
    await handleSaveLocation(
      { alias: 'seed', name: 'Seed', latitude: 1, longitude: 2 },
      store,
      stubReturning(CENSUS_RESULT).service
    );
    const before = readFileSync(storePath);
    const { service } = stubRejecting(error);

    const caught = await handleSaveLocation(
      { alias: 'new', location_query: 'nowhere' },
      store,
      service
    ).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(error.constructor);
    expect((caught as Error).message).toBe(error.message);
    expect(readFileSync(storePath).equals(before)).toBe(true);
  });

  it('refuses a blank location_query without calling geocode', async () => {
    const { geocode, service } = stubReturning(CENSUS_RESULT);

    await expect(
      handleSaveLocation({ alias: 'blank', location_query: '   ' }, store, service)
    ).rejects.toThrow('location_query cannot be empty');
    expect(geocode).toHaveBeenCalledTimes(0);
  });
});
