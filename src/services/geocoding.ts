/**
 * Multi-Service Geocoding Service
 * Implements automatic fallback strategy across multiple geocoding providers
 * for maximum reliability and coverage
 */

import axios, { AxiosInstance } from 'axios';
import { logger, isPiiLoggingEnabled, describeErrorForLogging } from '../utils/logger.js';
import { RequestSpacer } from '../utils/requestSpacer.js';
import { NOMINATIM_MIN_INTERVAL_MS } from './nominatim.js';

/**
 * Serialize query parameters using RFC 3986 percent-encoding (spaces -> %20).
 *
 * Axios's default serializer encodes spaces as "+" (application/x-www-form-urlencoded
 * style). Nominatim treats such "+"-encoded queries inconsistently — notably it can
 * return ZERO matches at limit=1 for a query that returns matches with %20 encoding
 * (e.g. "Clare, MI"). Forcing %20 keeps geocoding results stable across providers and
 * result limits. Shared by every provider client below.
 */
export function rfc3986ParamsSerializer(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

/**
 * Minimum number of results requested from an upstream provider, regardless of the
 * caller's requested limit. Some providers (Nominatim in particular) rank or de-duplicate
 * unreliably when asked for a single result, so we always request a small floor and then
 * slice down to the caller's limit. Prevents fragile limit=1 lookups (e.g. the on-demand
 * city_name resolver) from spuriously returning "no results".
 */
const PROVIDER_RESULT_FLOOR = 5;

/**
 * Geocoding result with standardized format across all providers
 */
export interface GeocodingResult {
  name: string;
  display_name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;  // State/region
  admin2?: string;  // County/district
  timezone?: string;
  elevation?: number | null;
  population?: number | null;
  feature_code?: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'census' | 'nominatim' | 'openmeteo';
}

/**
 * No provider matched the query, and at least one of them answered (empty, or
 * declined the input with a 4xx other than 429). The query is the likely problem.
 */
export class GeocodingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeocodingNotFoundError';
  }
}

/**
 * Every provider tried failed to answer (timeout, 429, 5xx, no response, or a body
 * that could not be parsed). Nothing looked at the query, so it says nothing about it.
 */
export class GeocodingServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeocodingServiceUnavailableError';
  }
}

/**
 * A provider did not answer. The message is one of three fixed forms naming the
 * provider — `<Name> timed out`, `<Name> rate-limited the request`,
 * `<Name> is unavailable` — and never carries the query, a URL or upstream text.
 * Exported for tests only.
 */
export class GeocodingProviderFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeocodingProviderFailure';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Classify a provider's caught error. Returns `null` when the upstream answered by
 * declining the input (a 4xx other than 429, e.g. Census's 400 for an address over
 * 100 characters); the provider then reports an empty answer. Anything else is a
 * failure. An existing `GeocodingProviderFailure` (a shape failure thrown inside the
 * provider's `try`) passes through unchanged.
 */
function failureFor(name: string, error: unknown): GeocodingProviderFailure | null {
  if (error instanceof GeocodingProviderFailure) {
    return error;
  }
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new GeocodingProviderFailure(`${name} timed out`);
    }
    const status = error.response?.status;
    if (status === 429) {
      return new GeocodingProviderFailure(`${name} rate-limited the request`);
    }
    if (status !== undefined && status >= 400 && status < 500) {
      return null;
    }
  }
  return new GeocodingProviderFailure(`${name} is unavailable`);
}

/**
 * Geocoding provider interface
 */
interface GeocodingProvider {
  name: string;
  geocode(query: string, limit: number): Promise<GeocodingResult[]>;
}

/**
 * Census.gov Geocoding Provider
 * Best for: US locations (cities, states, addresses)
 * Coverage: United States only
 * Rate limit: No strict limit (but we throttle to be respectful)
 */
class CensusGovProvider implements GeocodingProvider {
  name = 'Census.gov';
  private client: AxiosInstance;
  private spacer: RequestSpacer;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://geocoding.geo.census.gov/geocoder',
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      },
      paramsSerializer: { serialize: rfc3986ParamsSerializer }
    });

    // Rate limit to 5 requests/second to be respectful
    this.spacer = new RequestSpacer(1000 / 5);
  }

  async geocode(query: string, limit: number): Promise<GeocodingResult[]> {
    await this.spacer.reserve();

    try {
      logger.debug('Census.gov geocode', isPiiLoggingEnabled() ? { query } : undefined);

      const response = await this.client.get('/locations/onelineaddress', {
        params: {
          address: query,
          benchmark: 'Public_AR_Current',
          format: 'json'
        }
      });

      const body: unknown = response.data;
      if (!isRecord(body)) {
        throw new GeocodingProviderFailure(`${this.name} is unavailable`);
      }
      const matches = isRecord(body.result) ? body.result.addressMatches : undefined;
      if (matches != null && !Array.isArray(matches)) {
        throw new GeocodingProviderFailure(`${this.name} is unavailable`);
      }
      if (!Array.isArray(matches) || matches.length === 0) {
        logger.debug('Census.gov: No results found');
        return [];
      }

      const results: GeocodingResult[] = [];

      for (let i = 0; i < Math.min(matches.length, limit); i++) {
        const match = matches[i];
        const coords = match.coordinates;

        if (!coords || coords.x === undefined || coords.y === undefined) {
          continue;
        }

        // Census.gov uses longitude, latitude (x, y) order
        const result: GeocodingResult = {
          name: match.matchedAddress || query,
          display_name: match.matchedAddress || query,
          latitude: coords.y,
          longitude: coords.x,
          country: 'United States',
          country_code: 'US',
          admin1: match.addressComponents?.state,
          admin2: match.addressComponents?.county,
          confidence: 'high', // Census.gov is authoritative for US locations
          source: 'census'
        };

        results.push(result);
      }

      logger.debug(`Census.gov: Found ${results.length} result(s)`);
      return results;

    } catch (error) {
      logger.debug('Census.gov error', describeErrorForLogging(error));
      const failure = failureFor(this.name, error);
      if (failure) throw failure;
      return []; // Declined (4xx other than 429): an answer, not a failure
    }
  }
}

/**
 * Nominatim (OpenStreetMap) Provider
 * Best for: Worldwide locations, landmarks, natural language queries
 * Coverage: Global
 * Rate limit: 1 request/second (strictly enforced)
 */
class NominatimProvider implements GeocodingProvider {
  name = 'Nominatim';
  private client: AxiosInstance;
  private spacer: RequestSpacer;

  constructor(spacer?: RequestSpacer) {
    this.client = axios.create({
      baseURL: 'https://nominatim.openstreetmap.org',
      timeout: 10000,
      headers: {
        'User-Agent': '(weather-mcp, github.com/weather-mcp/weather-mcp)',
        'Accept': 'application/json'
      },
      paramsSerializer: { serialize: rfc3986ParamsSerializer }
    });

    // Strict 1 request/second rate limit as per Nominatim usage policy
    this.spacer = spacer ?? new RequestSpacer(NOMINATIM_MIN_INTERVAL_MS);
  }

  async geocode(query: string, limit: number): Promise<GeocodingResult[]> {
    await this.spacer.reserve();

    try {
      logger.debug('Nominatim geocode', isPiiLoggingEnabled() ? { query } : undefined);

      const response = await this.client.get('/search', {
        params: {
          q: query,
          format: 'json',
          addressdetails: 1,
          limit: Math.min(limit, 50), // Nominatim max is 50
          'accept-language': 'en'
        }
      });

      if (!Array.isArray(response.data)) {
        throw new GeocodingProviderFailure(`${this.name} is unavailable`);
      }
      if (response.data.length === 0) {
        logger.debug('Nominatim: No results found');
        return [];
      }

      const results: GeocodingResult[] = response.data.map((item: any) => {
        const address = item.address || {};

        // Determine confidence based on importance and type
        let confidence: 'high' | 'medium' | 'low' = 'medium';
        if (item.importance > 0.6) confidence = 'high';
        else if (item.importance < 0.3) confidence = 'low';

        return {
          name: item.name || item.display_name,
          display_name: item.display_name,
          latitude: parseFloat(item.lat),
          longitude: parseFloat(item.lon),
          country: address.country,
          country_code: address.country_code?.toUpperCase(),
          admin1: address.state || address.region,
          admin2: address.county,
          feature_code: this.mapTypeToFeatureCode(item.type),
          confidence,
          source: 'nominatim'
        };
      });

      logger.debug(`Nominatim: Found ${results.length} result(s)`);
      return results;

    } catch (error) {
      logger.debug('Nominatim error', describeErrorForLogging(error));
      const failure = failureFor(this.name, error);
      if (failure) throw failure;
      return []; // Declined (4xx other than 429): an answer, not a failure
    }
  }

  /**
   * Map Nominatim type to GeoNames-style feature code
   */
  private mapTypeToFeatureCode(type: string): string {
    const typeMap: { [key: string]: string } = {
      'city': 'PPL',
      'town': 'PPL',
      'village': 'PPL',
      'administrative': 'ADM1',
      'country': 'PCLI',
      'state': 'ADM1',
      'county': 'ADM2',
      'island': 'ISL',
      'airport': 'AIRP',
      'park': 'PRK',
      'lake': 'LAKE'
    };

    return typeMap[type.toLowerCase()] || type.toUpperCase();
  }
}

/**
 * Open-Meteo Geocoding Provider (existing implementation as fallback)
 * Best for: Reliable global coverage with detailed metadata
 * Coverage: Global
 * Rate limit: Part of 10,000 requests/day shared limit
 */
class OpenMeteoProvider implements GeocodingProvider {
  name = 'Open-Meteo';
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://geocoding-api.open-meteo.com/v1',
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      },
      paramsSerializer: { serialize: rfc3986ParamsSerializer }
    });
  }

  async geocode(query: string, limit: number): Promise<GeocodingResult[]> {
    try {
      logger.debug('Open-Meteo geocode', isPiiLoggingEnabled() ? { query } : undefined);

      const response = await this.client.get('/search', {
        params: {
          name: query,
          count: Math.min(limit, 100),
          language: 'en',
          format: 'json'
        }
      });

      const body: unknown = response.data;
      if (!isRecord(body)) {
        throw new GeocodingProviderFailure(`${this.name} is unavailable`);
      }
      const found = body.results;
      if (found != null && !Array.isArray(found)) {
        throw new GeocodingProviderFailure(`${this.name} is unavailable`);
      }
      if (!Array.isArray(found) || found.length === 0) {
        logger.debug('Open-Meteo: No results found');
        return [];
      }

      const results: GeocodingResult[] = found.map((item: any) => ({
        name: item.name,
        display_name: [item.name, item.admin1, item.admin2, item.country]
          .filter(Boolean)
          .join(', '),
        latitude: item.latitude,
        longitude: item.longitude,
        country: item.country,
        country_code: item.country_code,
        admin1: item.admin1,
        admin2: item.admin2,
        timezone: item.timezone,
        elevation: item.elevation,
        population: item.population,
        feature_code: item.feature_code,
        confidence: 'medium', // Open-Meteo is reliable but not authoritative
        source: 'openmeteo'
      }));

      logger.debug(`Open-Meteo: Found ${results.length} result(s)`);
      return results;

    } catch (error) {
      logger.debug('Open-Meteo error', describeErrorForLogging(error));
      const failure = failureFor(this.name, error);
      if (failure) throw failure;
      return []; // Declined (4xx other than 429): an answer, not a failure
    }
  }
}

/**
 * Multi-Service Geocoding Service
 * Automatically tries multiple providers in order with intelligent fallback
 */
export class GeocodingService {
  private census: CensusGovProvider;
  private nominatim: NominatimProvider;
  private openmeteo: OpenMeteoProvider;

  constructor(options: { nominatimSpacer?: RequestSpacer } = {}) {
    this.census = new CensusGovProvider();
    this.nominatim = new NominatimProvider(options.nominatimSpacer);
    this.openmeteo = new OpenMeteoProvider();
  }

  /**
   * Detect if query is likely a US location
   * Helps optimize provider selection
   */
  private isLikelyUSLocation(query: string): boolean {
    const lowerQuery = query.toLowerCase();

    // State abbreviations
    const stateAbbreviations = [
      'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga',
      'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md',
      'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj',
      'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc',
      'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy'
    ];

    // Check for state abbreviations (e.g., "Seattle, WA")
    for (const state of stateAbbreviations) {
      if (lowerQuery.includes(`, ${state}`) || lowerQuery.endsWith(` ${state}`)) {
        return true;
      }
    }

    // Check for explicit country mentions (US or USA)
    if (lowerQuery.includes('usa') ||
        lowerQuery.includes('u.s.a') ||
        lowerQuery.includes('united states')) {
      return true;
    }

    // Check for explicit non-US country mentions
    const nonUSKeywords = [
      'france', 'germany', 'japan', 'china', 'uk', 'england',
      'canada', 'mexico', 'australia', 'india', 'brazil'
    ];

    for (const keyword of nonUSKeywords) {
      if (lowerQuery.includes(keyword)) {
        return false;
      }
    }

    // Default: Assume might be US (we'll try Census.gov first, then fallback)
    return null as any; // null means "uncertain"
  }

  /**
   * Geocode a location query with automatic multi-service fallback
   *
   * Strategy:
   * 1. If likely US: Try Census.gov first (fast, authoritative)
   * 2. Try Nominatim (worldwide, good natural language support)
   * 3. Fallback to Open-Meteo (reliable, detailed metadata)
   *
   * @param query - Location search query (e.g., "Seattle, WA", "Paris, France")
   * @param limit - Maximum number of results to return
   * @returns Array of geocoding results from the first provider that found a match
   * @throws {GeocodingNotFoundError} No provider matched, and at least one answered
   *   (empty or declined) — the query is the likely problem
   * @throws {GeocodingServiceUnavailableError} Every provider tried failed to answer —
   *   nothing looked at the query
   */
  async geocode(query: string, limit: number = 5): Promise<GeocodingResult[]> {
    const isLikelyUS = this.isLikelyUSLocation(query);
    const providers: GeocodingProvider[] = [];

    // Build provider order based on query characteristics
    if (isLikelyUS === true) {
      // Definitely US - try Census.gov first
      providers.push(this.census, this.nominatim, this.openmeteo);
      logger.debug('Provider strategy: US-optimized (Census → Nominatim → Open-Meteo)');
    } else if (isLikelyUS === false) {
      // Definitely non-US - skip Census.gov
      providers.push(this.nominatim, this.openmeteo);
      logger.debug('Provider strategy: International (Nominatim → Open-Meteo)');
    } else {
      // Uncertain - try all providers
      providers.push(this.census, this.nominatim, this.openmeteo);
      logger.debug('Provider strategy: Uncertain (Census → Nominatim → Open-Meteo)');
    }

    // One fixed-text outcome per provider tried, and whether any of them answered.
    const outcomes: string[] = [];
    let answered = false;

    // Always request at least PROVIDER_RESULT_FLOOR from upstream (providers rank
    // unreliably at limit=1), then slice to the caller's requested limit.
    const providerLimit = Math.max(limit, PROVIDER_RESULT_FLOOR);

    // Try each provider in order
    for (const provider of providers) {
      try {
        logger.debug(`Trying provider: ${provider.name}`);
        const results = await provider.geocode(query, providerLimit);

        if (results.length > 0) {
          logger.info(`Geocoding successful via ${provider.name}: ${results.length} result(s)`);
          return results.slice(0, limit);
        }

        logger.debug(`${provider.name}: No results found`);
        answered = true;
        outcomes.push(`${provider.name} found no match`);

      } catch (error) {
        // A provider throws only GeocodingProviderFailure; anything else (a spacer
        // rejection from reserve(), outside the provider's try) gets the same fixed
        // text, so raw error text never reaches the message.
        const outcome = error instanceof GeocodingProviderFailure
          ? error.message
          : `${provider.name} is unavailable`;
        logger.debug(`${provider.name} failed: ${outcome}`);
        outcomes.push(outcome);

        // Continue to next provider
        continue;
      }
    }

    const tried = `Tried ${providers.length} provider(s): ${outcomes.join('; ')}`;

    // Every provider failed: nothing looked at the query, so give no spelling advice.
    if (!answered) {
      throw new GeocodingServiceUnavailableError(
        `Location lookup is unavailable right now, so "${query}" could not be resolved.\n\n` +
        `${tried}\n\n` +
        `Suggestions:\n` +
        `- Retry in a minute or two\n` +
        `- Pass latitude and longitude directly; that skips location lookup`
      );
    }

    // At least one provider answered with no match (any failures stay listed).
    throw new GeocodingNotFoundError(
      `No locations found matching "${query}".\n\n` +
      `${tried}\n\n` +
      `Suggestions:\n` +
      `- Add more detail (e.g., "Paris, France" instead of "Paris")\n` +
      `- Check spelling\n` +
      `- Use a nearby major city\n` +
      `- Try providing coordinates directly (latitude, longitude)`
    );
  }

  /**
   * Get service information for debugging
   */
  getServiceInfo(): string {
    return `Multi-Service Geocoding:\n` +
           `- Census.gov (US locations, high accuracy)\n` +
           `- Nominatim/OpenStreetMap (worldwide, 1 req/sec limit)\n` +
           `- Open-Meteo (worldwide fallback)\n` +
           `Automatic fallback strategy based on query characteristics`;
  }
}
