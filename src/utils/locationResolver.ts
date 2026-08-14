/**
 * Utility for resolving location coordinates from various input formats
 */

import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { validateLatitude, validateLongitude } from './validation.js';
import { Cache } from './cache.js';
import { CacheConfig } from '../config/cache.js';
import { getDefaultLocation } from '../config/defaultLocation.js';

export interface LocationInput {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
}

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  source: 'coordinates' | 'saved_location' | 'geocoded' | 'default';
  location_name?: string;
}

/**
 * Build a header line describing how a location name was resolved.
 *
 * Returns an empty string for direct-coordinate requests (nothing to disclose),
 * otherwise a Markdown line showing the matched name and coordinates so an
 * ambiguous saved/geocoded lookup is transparent to the user. Shared across all
 * weather handlers so location disclosure is consistent.
 *
 * @param resolved - Result from resolveLocation/resolveLocationAsync
 * @returns Markdown line (with trailing blank line) or '' for coordinate input
 */
export function formatLocationLine(resolved: ResolvedLocation): string {
  const coords = `${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)}`;

  // A server-default location is always disclosed — the caller supplied no
  // location at all, so the reader must be able to see what was assumed.
  if (resolved.source === 'default') {
    const label = resolved.location_name ? `${resolved.location_name} (${coords})` : coords;
    return `**Location:** ${label} — server default\n\n`;
  }

  if (resolved.source === 'coordinates' || !resolved.location_name) {
    return '';
  }

  return `**Location:** ${resolved.location_name} (${coords})\n\n`;
}

/**
 * Prepend the resolved-location header to a handler's text content, if any.
 *
 * Mutates the first text block of a standard `{ content: [...] }` handler result
 * so name-based lookups (saved location or geocoded city) surface what matched.
 * A no-op for direct-coordinate requests.
 *
 * `text` is optional in the constraint because a handler may return mixed
 * content — get_weather_imagery's composite branch returns `[text, image]`,
 * and an image block carries no `text`. The runtime guard below already
 * checks for a leading text block, so behaviour is unchanged.
 *
 * @param result - Handler result whose first text block will be prefixed
 * @param resolved - Result from resolveLocationAsync
 * @returns The same result object (for convenient chaining)
 */
export function prependLocationLine<
  T extends { content: Array<{ type: string; text?: string }> }
>(result: T, resolved: ResolvedLocation): T {
  const locationLine = formatLocationLine(resolved);
  const first = result.content[0];
  if (locationLine && first?.type === 'text' && typeof first.text === 'string') {
    first.text = locationLine + first.text;
  }
  return result;
}

/**
 * Cached geocode result for a free-text city name.
 * City coordinates are effectively static, so these are cached with an
 * Infinity TTL (see CacheConfig.ttl.geocoding).
 */
interface CachedCityGeocode {
  latitude: number;
  longitude: number;
  display_name: string;
}

// Module-level cache for city_name -> coordinates lookups.
const cityGeocodeCache = new Cache<CachedCityGeocode>(CacheConfig.maxSize);

/**
 * Build the cache key for a city geocode lookup.
 */
function cityGeocodeKey(cityName: string): string {
  return `city-geocode:${cityName.toLowerCase().trim()}`;
}

/**
 * Clear the module-level city geocode cache.
 * Exposed primarily for tests to guarantee a clean slate.
 */
export function clearCityGeocodeCache(): void {
  cityGeocodeCache.clear();
}

/**
 * Resolve location coordinates from either direct coordinates or a saved location name
 *
 * @param args - Arguments containing either (latitude + longitude) OR location_name
 * @param locationStore - Location store instance
 * @returns Resolved coordinates and metadata
 * @throws Error if neither coordinates nor location_name provided, or if validation fails
 */
export function resolveLocation(
  args: LocationInput,
  locationStore: LocationStore
): ResolvedLocation {
  // Check if location_name is provided
  if (args.location_name && typeof args.location_name === 'string') {
    const locationName = args.location_name.toLowerCase().trim();

    if (locationName.length === 0) {
      throw new Error('location_name cannot be empty');
    }

    // Try exact alias match first
    let savedLocation = locationStore.get(locationName);
    let matchedAlias = locationName;

    // If not found, try matching against alternate names
    if (!savedLocation) {
      const allLocations = locationStore.getAll();

      for (const [alias, location] of Object.entries(allLocations)) {
        // Check if query matches any alternate names
        if (location.alternateNames && location.alternateNames.length > 0) {
          const normalizedAlternates = location.alternateNames.map(name =>
            name.toLowerCase().trim()
          );

          if (normalizedAlternates.includes(locationName)) {
            savedLocation = location;
            matchedAlias = alias;
            break;
          }
        }
      }
    }

    if (!savedLocation) {
      const available = Object.keys(locationStore.getAll());
      throw new Error(
        `Saved location "${locationName}" not found.\n\n` +
        (available.length > 0
          ? `Available locations: ${available.join(', ')}\n\n`
          : 'No saved locations yet. Use save_location to create one.\n\n') +
        `Use list_saved_locations to see all saved locations.`
      );
    }

    return {
      latitude: savedLocation.latitude,
      longitude: savedLocation.longitude,
      source: 'saved_location',
      location_name: matchedAlias
    };
  }

  // Check if direct coordinates are provided
  if (typeof args.latitude === 'number' && typeof args.longitude === 'number') {
    validateLatitude(args.latitude);
    validateLongitude(args.longitude);

    return {
      latitude: args.latitude,
      longitude: args.longitude,
      source: 'coordinates'
    };
  }

  // Neither location_name nor coordinates provided
  throw new Error(
    'Either location_name OR (latitude + longitude) must be provided.\n\n' +
    'Examples:\n' +
    '  - Using coordinates: latitude=47.6062, longitude=-122.3321\n' +
    '  - Using saved location: location_name="home"\n\n' +
    'Use save_location to save frequently used locations.'
  );
}

/**
 * Resolve location coordinates from direct coordinates, a saved location name,
 * or a free-text city name that is geocoded on demand.
 *
 * Resolution precedence: coordinates > location_name (saved) > city_name (geocoded)
 * > server default (WEATHER_DEFAULT_LOCATION, when configured). Geocoded city
 * lookups are cached (see cityGeocodeCache) so repeated requests for the same
 * place do not re-hit the geocoding providers.
 *
 * @param args - Arguments containing coordinates, a saved location_name, or a city_name
 * @param locationStore - Location store instance (for saved locations)
 * @param geocodingService - Geocoding service (for city_name lookups)
 * @returns Resolved coordinates and metadata
 * @throws Error if nothing usable is provided (and no default is configured),
 *   validation fails, or geocoding finds no match
 */
export async function resolveLocationAsync(
  args: LocationInput,
  locationStore: LocationStore,
  geocodingService: GeocodingService
): Promise<ResolvedLocation> {
  // 1. Explicit coordinates take precedence
  if (typeof args.latitude === 'number' && typeof args.longitude === 'number') {
    validateLatitude(args.latitude);
    validateLongitude(args.longitude);

    return {
      latitude: args.latitude,
      longitude: args.longitude,
      source: 'coordinates'
    };
  }

  // 2. Saved location by name (reuse the synchronous resolver's matching logic)
  if (args.location_name && typeof args.location_name === 'string') {
    return resolveLocation({ location_name: args.location_name }, locationStore);
  }

  // 3. Free-text city name -> geocode on demand
  if (args.city_name && typeof args.city_name === 'string') {
    const cityName = args.city_name.trim();

    if (cityName.length === 0) {
      throw new Error('city_name cannot be empty');
    }

    const cacheKey = cityGeocodeKey(cityName);

    if (CacheConfig.enabled) {
      const cached = cityGeocodeCache.get(cacheKey);
      if (cached) {
        return {
          latitude: cached.latitude,
          longitude: cached.longitude,
          source: 'geocoded',
          location_name: cached.display_name
        };
      }
    }

    const results = await geocodingService.geocode(cityName, 1);

    if (!results || results.length === 0) {
      throw new Error(
        `Could not find a location matching "${cityName}".\n\n` +
        'Try a more specific name (e.g. "Paris, France" or "Bend, Oregon"), ' +
        'or use search_location to look up coordinates.'
      );
    }

    const best = results[0];

    if (CacheConfig.enabled) {
      cityGeocodeCache.set(
        cacheKey,
        {
          latitude: best.latitude,
          longitude: best.longitude,
          display_name: best.display_name
        },
        CacheConfig.ttl.geocoding
      );
    }

    return {
      latitude: best.latitude,
      longitude: best.longitude,
      source: 'geocoded',
      location_name: best.display_name
    };
  }

  // 4. Nothing provided -> configured server default, if any
  const defaultLocation = getDefaultLocation();
  if (defaultLocation) {
    return resolveDefaultLocation(defaultLocation, locationStore, geocodingService);
  }

  // Nothing usable provided
  throw new Error(
    'Provide one of: coordinates (latitude + longitude), a saved location_name, or a city_name.\n\n' +
    'Examples:\n' +
    '  - Using coordinates: latitude=47.6062, longitude=-122.3321\n' +
    '  - Using saved location: location_name="home"\n' +
    '  - Using a city name: city_name="Paris, France"\n\n' +
    'Use save_location to save frequently used locations. The server operator can ' +
    'also set the WEATHER_DEFAULT_LOCATION environment variable to supply a ' +
    'fallback location for calls like this one.'
  );
}

/**
 * Resolve the WEATHER_DEFAULT_LOCATION value to coordinates.
 *
 * The value may be a "lat,lon" coordinate pair, a saved location alias (or
 * alternate name), or a free-text place name — tried in that order. Free-text
 * lookups reuse the city geocode path, so they hit the same cache and only
 * geocode once per process. Whatever matches is reported with
 * source: 'default' so output always discloses that the location was assumed.
 *
 * @throws Error naming WEATHER_DEFAULT_LOCATION when the value cannot be resolved
 */
async function resolveDefaultLocation(
  raw: string,
  locationStore: LocationStore,
  geocodingService: GeocodingService
): Promise<ResolvedLocation> {
  // "lat,lon" coordinate pair
  const coordMatch = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordMatch) {
    const latitude = Number(coordMatch[1]);
    const longitude = Number(coordMatch[2]);
    try {
      validateLatitude(latitude);
      validateLongitude(longitude);
    } catch (error) {
      throw new Error(
        `Invalid WEATHER_DEFAULT_LOCATION coordinates "${raw}": ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
    }
    return { latitude, longitude, source: 'default' };
  }

  // Saved location alias (including alternate names)
  try {
    const saved = resolveLocation({ location_name: raw }, locationStore);
    return { ...saved, source: 'default' };
  } catch {
    // Not a saved alias — treat it as a free-text place name below.
  }

  // Free-text place name -> geocode (shares the city_name cache)
  try {
    const geocoded = await resolveLocationAsync({ city_name: raw }, locationStore, geocodingService);
    return { ...geocoded, source: 'default' };
  } catch (error) {
    throw new Error(
      `Could not resolve WEATHER_DEFAULT_LOCATION="${raw}" — it is not a saved ` +
      `location alias, a "lat,lon" pair, or a geocodable place name.\n\n` +
      `${error instanceof Error ? error.message : String(error)}`
    );
  }
}
