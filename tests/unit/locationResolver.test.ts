/**
 * Unit tests for locationResolver
 *
 * Focuses on resolveLocationAsync, which resolves a location from direct
 * coordinates, a saved location name, or a free-text city name (geocoded).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveLocationAsync,
  clearCityGeocodeCache,
  formatLocationLine,
  prependLocationLine,
  prependCriticalAlertBanner,
} from '../../src/utils/locationResolver.js';
import type { ResolvedLocation } from '../../src/utils/locationResolver.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService, GeocodingResult } from '../../src/services/geocoding.js';
import type { SavedLocation } from '../../src/types/savedLocations.js';

/**
 * Build a minimal LocationStore stub with the two methods the resolver uses.
 */
function makeLocationStore(locations: Record<string, SavedLocation> = {}): LocationStore {
  return {
    get: (alias: string) => locations[alias.toLowerCase().trim()],
    getAll: () => locations,
  } as unknown as LocationStore;
}

/**
 * Build a GeocodingService stub whose geocode() returns the supplied results.
 */
function makeGeocodingService(results: GeocodingResult[]): {
  service: GeocodingService;
  geocode: ReturnType<typeof vi.fn>;
} {
  const geocode = vi.fn(async () => results);
  return {
    service: { geocode } as unknown as GeocodingService,
    geocode,
  };
}

function makeGeocodingResult(overrides: Partial<GeocodingResult> = {}): GeocodingResult {
  return {
    name: 'Paris',
    display_name: 'Paris, Île-de-France, France',
    latitude: 48.8566,
    longitude: 2.3522,
    confidence: 'high',
    source: 'openmeteo',
    ...overrides,
  };
}

function makeSavedLocation(overrides: Partial<SavedLocation> = {}): SavedLocation {
  return {
    name: 'Seattle, WA',
    latitude: 47.6062,
    longitude: -122.3321,
    saved_at: '2025-01-15T10:30:00.000Z',
    updated_at: '2025-01-15T10:30:00.000Z',
    ...overrides,
  } as SavedLocation;
}

describe('resolveLocationAsync', () => {
  beforeEach(() => {
    clearCityGeocodeCache();
  });

  describe('coordinates', () => {
    it('resolves direct coordinates', async () => {
      const store = makeLocationStore();
      const { service } = makeGeocodingService([]);

      const resolved = await resolveLocationAsync(
        { latitude: 40.7128, longitude: -74.006 },
        store,
        service
      );

      expect(resolved).toEqual({
        latitude: 40.7128,
        longitude: -74.006,
        source: 'coordinates',
      });
    });

    it('rejects invalid coordinates', async () => {
      const store = makeLocationStore();
      const { service } = makeGeocodingService([]);

      await expect(
        resolveLocationAsync({ latitude: 999, longitude: 0 }, store, service)
      ).rejects.toThrow();
    });
  });

  describe('precedence', () => {
    it('prefers coordinates over location_name and city_name', async () => {
      const store = makeLocationStore({ home: makeSavedLocation() });
      const { service, geocode } = makeGeocodingService([makeGeocodingResult()]);

      const resolved = await resolveLocationAsync(
        { latitude: 10, longitude: 20, location_name: 'home', city_name: 'Paris' },
        store,
        service
      );

      expect(resolved.source).toBe('coordinates');
      expect(resolved.latitude).toBe(10);
      expect(geocode).not.toHaveBeenCalled();
    });

    it('prefers a saved location_name over city_name', async () => {
      const store = makeLocationStore({ home: makeSavedLocation() });
      const { service, geocode } = makeGeocodingService([makeGeocodingResult()]);

      const resolved = await resolveLocationAsync(
        { location_name: 'home', city_name: 'Paris' },
        store,
        service
      );

      expect(resolved.source).toBe('saved_location');
      expect(resolved.latitude).toBe(47.6062);
      expect(geocode).not.toHaveBeenCalled();
    });
  });

  describe('location_name', () => {
    it('resolves a saved location', async () => {
      const store = makeLocationStore({ home: makeSavedLocation() });
      const { service } = makeGeocodingService([]);

      const resolved = await resolveLocationAsync({ location_name: 'home' }, store, service);

      expect(resolved).toEqual({
        latitude: 47.6062,
        longitude: -122.3321,
        source: 'saved_location',
        location_name: 'home',
      });
    });

    it('throws a helpful error for an unknown saved location', async () => {
      const store = makeLocationStore({ home: makeSavedLocation() });
      const { service } = makeGeocodingService([]);

      await expect(
        resolveLocationAsync({ location_name: 'nowhere' }, store, service)
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('city_name (geocoding)', () => {
    it('geocodes a free-text city name', async () => {
      const store = makeLocationStore();
      const { service, geocode } = makeGeocodingService([makeGeocodingResult()]);

      const resolved = await resolveLocationAsync({ city_name: 'Paris, France' }, store, service);

      expect(resolved).toEqual({
        latitude: 48.8566,
        longitude: 2.3522,
        source: 'geocoded',
        location_name: 'Paris, Île-de-France, France',
      });
      expect(geocode).toHaveBeenCalledWith('Paris, France', 1);
    });

    it('passes through the geocoder display_name as location_name', async () => {
      const store = makeLocationStore();
      const { service } = makeGeocodingService([
        makeGeocodingResult({ display_name: 'Bend, Deschutes County, Oregon, United States' }),
      ]);

      const resolved = await resolveLocationAsync({ city_name: 'Bend, Oregon' }, store, service);

      expect(resolved.location_name).toBe('Bend, Deschutes County, Oregon, United States');
    });

    it('caches results so a repeated lookup does not re-hit the geocoder', async () => {
      const store = makeLocationStore();
      const { service, geocode } = makeGeocodingService([makeGeocodingResult()]);

      const first = await resolveLocationAsync({ city_name: 'Paris' }, store, service);
      const second = await resolveLocationAsync({ city_name: 'Paris' }, store, service);

      expect(second).toEqual(first);
      expect(geocode).toHaveBeenCalledTimes(1);
    });

    it('treats the cache key case-insensitively', async () => {
      const store = makeLocationStore();
      const { service, geocode } = makeGeocodingService([makeGeocodingResult()]);

      await resolveLocationAsync({ city_name: 'Paris' }, store, service);
      await resolveLocationAsync({ city_name: '  PARIS  ' }, store, service);

      expect(geocode).toHaveBeenCalledTimes(1);
    });

    it('throws when the city name is empty', async () => {
      const store = makeLocationStore();
      const { service, geocode } = makeGeocodingService([]);

      await expect(
        resolveLocationAsync({ city_name: '   ' }, store, service)
      ).rejects.toThrow(/empty/i);
      expect(geocode).not.toHaveBeenCalled();
    });

    it('throws a helpful error when geocoding finds nothing', async () => {
      const store = makeLocationStore();
      const { service } = makeGeocodingService([]);

      await expect(
        resolveLocationAsync({ city_name: 'Nonexistentville' }, store, service)
      ).rejects.toThrow(/could not find/i);
    });
  });

  describe('no input', () => {
    it('throws when nothing usable is provided', async () => {
      const store = makeLocationStore();
      const { service } = makeGeocodingService([]);

      await expect(resolveLocationAsync({}, store, service)).rejects.toThrow(
        /coordinates|location_name|city_name/i
      );
    });
  });

  describe('default location fallback (WEATHER_DEFAULT_LOCATION)', () => {
    const ENV_KEY = 'WEATHER_DEFAULT_LOCATION';
    let savedEnv: string | undefined;

    beforeEach(() => {
      savedEnv = process.env[ENV_KEY];
      delete process.env[ENV_KEY];
    });

    afterEach(() => {
      if (savedEnv === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = savedEnv;
      }
    });

    it('resolves a "lat,lon" coordinate pair default', async () => {
      process.env[ENV_KEY] = '-43.5321, 172.6362';
      const store = makeLocationStore();
      const { service, geocode } = makeGeocodingService([]);

      const resolved = await resolveLocationAsync({}, store, service);

      expect(resolved).toEqual({
        latitude: -43.5321,
        longitude: 172.6362,
        source: 'default',
      });
      expect(geocode).not.toHaveBeenCalled();
    });

    it('resolves a saved location alias default', async () => {
      process.env[ENV_KEY] = 'home';
      const store = makeLocationStore({ home: makeSavedLocation() });
      const { service, geocode } = makeGeocodingService([]);

      const resolved = await resolveLocationAsync({}, store, service);

      expect(resolved).toEqual({
        latitude: 47.6062,
        longitude: -122.3321,
        source: 'default',
        location_name: 'home',
      });
      expect(geocode).not.toHaveBeenCalled();
    });

    it('resolves a saved location alternate-name default', async () => {
      process.env[ENV_KEY] = 'my house';
      const store = makeLocationStore({
        home: makeSavedLocation({ alternateNames: ['my house'] } as Partial<SavedLocation>),
      });
      const { service, geocode } = makeGeocodingService([]);

      const resolved = await resolveLocationAsync({}, store, service);

      expect(resolved.source).toBe('default');
      expect(resolved.location_name).toBe('home');
      expect(geocode).not.toHaveBeenCalled();
    });

    it('geocodes a free-text place name default', async () => {
      process.env[ENV_KEY] = 'Christchurch, New Zealand';
      const store = makeLocationStore();
      const { service, geocode } = makeGeocodingService([
        makeGeocodingResult({
          display_name: 'Christchurch, Canterbury, New Zealand',
          latitude: -43.531,
          longitude: 172.6365,
        }),
      ]);

      const resolved = await resolveLocationAsync({}, store, service);

      expect(resolved).toEqual({
        latitude: -43.531,
        longitude: 172.6365,
        source: 'default',
        location_name: 'Christchurch, Canterbury, New Zealand',
      });
      expect(geocode).toHaveBeenCalledWith('Christchurch, New Zealand', 1);
    });

    it('never applies the default when an explicit location is provided', async () => {
      process.env[ENV_KEY] = 'Christchurch, New Zealand';
      const store = makeLocationStore({ home: makeSavedLocation() });
      const { service, geocode } = makeGeocodingService([makeGeocodingResult()]);

      const byCoords = await resolveLocationAsync({ latitude: 10, longitude: 20 }, store, service);
      const bySaved = await resolveLocationAsync({ location_name: 'home' }, store, service);
      const byCity = await resolveLocationAsync({ city_name: 'Paris' }, store, service);

      expect(byCoords.source).toBe('coordinates');
      expect(bySaved.source).toBe('saved_location');
      expect(byCity.source).toBe('geocoded');
      expect(geocode).toHaveBeenCalledTimes(1); // only the explicit city_name lookup
      expect(geocode).toHaveBeenCalledWith('Paris', 1);
    });

    it('throws a WEATHER_DEFAULT_LOCATION-specific error for out-of-range coordinates', async () => {
      process.env[ENV_KEY] = '999, 0';
      const store = makeLocationStore();
      const { service } = makeGeocodingService([]);

      await expect(resolveLocationAsync({}, store, service)).rejects.toThrow(
        /WEATHER_DEFAULT_LOCATION/
      );
    });

    it('throws a WEATHER_DEFAULT_LOCATION-specific error when nothing matches', async () => {
      process.env[ENV_KEY] = 'Nonexistentville';
      const store = makeLocationStore();
      const { service } = makeGeocodingService([]);

      await expect(resolveLocationAsync({}, store, service)).rejects.toThrow(
        /WEATHER_DEFAULT_LOCATION/
      );
    });

    it('ignores a blank default and keeps the standard no-input error', async () => {
      process.env[ENV_KEY] = '   ';
      const store = makeLocationStore();
      const { service } = makeGeocodingService([]);

      await expect(resolveLocationAsync({}, store, service)).rejects.toThrow(
        /Provide one of/i
      );
    });
  });
});

describe('formatLocationLine', () => {
  it('returns an empty string for direct coordinate input', () => {
    const resolved: ResolvedLocation = {
      latitude: 40.7128,
      longitude: -74.006,
      source: 'coordinates',
    };
    expect(formatLocationLine(resolved)).toBe('');
  });

  it('discloses the matched name and coordinates for a saved location', () => {
    const resolved: ResolvedLocation = {
      latitude: 47.6062,
      longitude: -122.3321,
      source: 'saved_location',
      location_name: 'home',
    };
    expect(formatLocationLine(resolved)).toBe('**Location:** home (47.6062, -122.3321)\n\n');
  });

  it('discloses the geocoder display name for a city lookup', () => {
    const resolved: ResolvedLocation = {
      latitude: 48.8566,
      longitude: 2.3522,
      source: 'geocoded',
      location_name: 'Paris, Île-de-France, France',
    };
    expect(formatLocationLine(resolved)).toContain('Paris, Île-de-France, France');
    expect(formatLocationLine(resolved)).toContain('48.8566, 2.3522');
  });

  it('discloses a named server default with a "server default" marker', () => {
    const resolved: ResolvedLocation = {
      latitude: -43.531,
      longitude: 172.6365,
      source: 'default',
      location_name: 'Christchurch, Canterbury, New Zealand',
    };
    expect(formatLocationLine(resolved)).toBe(
      '**Location:** Christchurch, Canterbury, New Zealand (-43.5310, 172.6365) — server default\n\n'
    );
  });

  it('discloses a coordinate-only server default', () => {
    const resolved: ResolvedLocation = {
      latitude: -43.5321,
      longitude: 172.6362,
      source: 'default',
    };
    expect(formatLocationLine(resolved)).toBe(
      '**Location:** -43.5321, 172.6362 — server default\n\n'
    );
  });
});

describe('prependLocationLine', () => {
  it('prepends the location line to the first text block for a name lookup', () => {
    const resolved: ResolvedLocation = {
      latitude: 47.6062,
      longitude: -122.3321,
      source: 'saved_location',
      location_name: 'home',
    };
    const result = { content: [{ type: 'text', text: '# Forecast\n' }] };

    const out = prependLocationLine(result, resolved);

    expect(out.content[0].text).toBe('**Location:** home (47.6062, -122.3321)\n\n# Forecast\n');
  });

  it('is a no-op for direct coordinate input', () => {
    const resolved: ResolvedLocation = {
      latitude: 40.7128,
      longitude: -74.006,
      source: 'coordinates',
    };
    const result = { content: [{ type: 'text', text: '# Forecast\n' }] };

    prependLocationLine(result, resolved);

    expect(result.content[0].text).toBe('# Forecast\n');
  });
});

describe('prependCriticalAlertBanner', () => {
  it('prepends above an existing location line, preserving order (banner -> Location -> heading)', () => {
    const result = {
      content: [
        { type: 'text', text: '**Location:** home (47.6062, -122.3321)\n\n# Forecast\n' },
      ],
    };

    const out = prependCriticalAlertBanner(result, '🚨 BANNER 🚨\n\n');

    expect(out.content[0].text).toBe(
      '🚨 BANNER 🚨\n\n**Location:** home (47.6062, -122.3321)\n\n# Forecast\n'
    );
  });

  it('is a no-op for an empty banner', () => {
    const result = { content: [{ type: 'text', text: '# Forecast\n' }] };

    const out = prependCriticalAlertBanner(result, '');

    expect(out.content[0].text).toBe('# Forecast\n');
  });

  it('is a no-op for a non-text first content block', () => {
    const result = { content: [{ type: 'image', data: 'base64data' }] };

    expect(() => prependCriticalAlertBanner(result, '🚨 BANNER 🚨\n\n')).not.toThrow();
    expect(result.content[0]).toEqual({ type: 'image', data: 'base64data' });
  });

  it('is a no-op when the first block has no text', () => {
    const result = { content: [{ type: 'text' }] };

    prependCriticalAlertBanner(result, '🚨 BANNER 🚨\n\n');

    expect(result.content[0].text).toBeUndefined();
  });

  it('returns the same object reference', () => {
    const result = { content: [{ type: 'text', text: '# Forecast\n' }] };

    const out = prependCriticalAlertBanner(result, '🚨 BANNER 🚨\n\n');

    expect(out).toBe(result);
  });

  it('is a no-op for an empty content array', () => {
    const result = { content: [] };

    expect(() => prependCriticalAlertBanner(result, '🚨 BANNER 🚨\n\n')).not.toThrow();
    expect(result.content).toEqual([]);
  });
});
