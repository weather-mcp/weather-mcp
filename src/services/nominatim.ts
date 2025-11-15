/**
 * Service for interacting with the Nominatim Geocoding API
 * Documentation: https://nominatim.org/release-docs/latest/api/Search/
 *
 * Nominatim is the geocoding service powering OpenStreetMap.
 * It provides better coverage for small towns and villages compared to GeoNames.
 *
 * Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
 * - Maximum 1 request per second
 * - Requires User-Agent header
 * - No bulk geocoding
 */

import axios, { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import type {
  NominatimLocation,
  NominatimErrorResponse,
  MappedGeocodingResponse,
  MappedGeocodingLocation
} from '../types/nominatim.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { logger } from '../utils/logger.js';
import { getUserAgent } from '../utils/version.js';
import {
  RateLimitError,
  ServiceUnavailableError,
  InvalidLocationError,
  ApiError
} from '../errors/ApiError.js';

export interface NominatimServiceConfig {
  baseURL?: string;
  timeout?: number;
}

export class NominatimService {
  private client: AxiosInstance;
  private cache: Cache;
  private lastRequestTime: number = 0;
  private readonly MIN_REQUEST_INTERVAL_MS = 1000; // 1 request per second (Nominatim policy)

  constructor(config: NominatimServiceConfig = {}) {
    const {
      baseURL = 'https://nominatim.openstreetmap.org',
      timeout = CacheConfig.apiTimeoutMs
    } = config;

    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error: AxiosError) => this.handleError(error)
    );
  }

  /**
   * Handle API errors with helpful status information
   * @private
   */
  private async handleError(error: AxiosError): Promise<never> {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as NominatimErrorResponse;

      // Bad request
      if (status === 400) {
        logger.warn('Invalid request parameters', {
          service: 'Nominatim',
          error: data.error,
          securityEvent: true
        });
        throw new InvalidLocationError(
          'Nominatim',
          `${data.error || 'Invalid request parameters'}\n\n` +
          'Please verify:\n' +
          '- Search query is at least 2 characters\n' +
          '- Query contains valid location information'
        );
      }

      // Rate limit error
      if (status === 429) {
        logger.warn('Rate limit exceeded', {
          service: 'Nominatim',
          securityEvent: true
        });
        throw new RateLimitError('Nominatim');
      }

      // Forbidden - usually indicates missing User-Agent or abuse
      if (status === 403) {
        logger.error('Nominatim access forbidden', undefined, {
          service: 'Nominatim',
          status: 403
        });
        throw new ApiError(
          'Nominatim API access denied',
          403,
          'Nominatim',
          'Access forbidden. This may indicate a policy violation.',
          ['https://operations.osmfoundation.org/policies/nominatim/']
        );
      }

      // Server errors
      if (status >= 500) {
        throw new ServiceUnavailableError('Nominatim', error);
      }

      // Other errors
      throw new ApiError(
        `Nominatim API error (${status})`,
        status,
        'Nominatim',
        data.error || 'Request failed',
        [
          'https://nominatim.org/release-docs/latest/api/Search/',
          'https://wiki.openstreetmap.org/wiki/Nominatim'
        ]
      );
    }

    // Network errors
    if (error.code === 'ECONNABORTED') {
      throw new ServiceUnavailableError('Nominatim', error);
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new ServiceUnavailableError('Nominatim', error);
    }

    // Generic error
    throw new ApiError(
      `Nominatim API request failed: ${error.message}`,
      500,
      'Nominatim',
      `Request failed: ${error.message}`,
      [
        'https://nominatim.org/release-docs/latest/api/Search/',
        'https://wiki.openstreetmap.org/wiki/Nominatim'
      ],
      true
    );
  }

  /**
   * Enforce rate limiting (1 request per second as per Nominatim usage policy)
   * @private
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      const waitTime = this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
      logger.info('Rate limiting: waiting before next request', {
        service: 'Nominatim',
        waitTimeMs: waitTime
      });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Map Nominatim location to GeocodingLocation format for compatibility
   * @private
   */
  private mapLocation(location: NominatimLocation): MappedGeocodingLocation {
    // Determine the best "name" for the location
    let name = location.display_name.split(',')[0].trim();

    // If we have address details, use the most specific place name
    if (location.address) {
      name = location.address.village
        || location.address.town
        || location.address.city
        || location.address.municipality
        || location.address.suburb
        || name;
    }

    // Map Nominatim OSM type to GeoNames-style feature code
    const featureCode = this.mapFeatureCode(location.type);

    return {
      id: location.place_id,
      name,
      latitude: parseFloat(location.lat),
      longitude: parseFloat(location.lon),
      feature_code: featureCode,
      country_code: location.address?.country_code?.toUpperCase(),
      country: location.address?.country,
      admin1: location.address?.state,
      admin2: location.address?.county,
      admin3: location.address?.suburb,
      admin4: location.address?.village || location.address?.town
    };
  }

  /**
   * Map OSM place types to GeoNames-style feature codes
   * @private
   */
  private mapFeatureCode(osmType: string | undefined): string | undefined {
    if (!osmType) return undefined;

    const typeMap: { [key: string]: string } = {
      'city': 'PPLC',
      'town': 'PPL',
      'village': 'PPL',
      'hamlet': 'PPL',
      'suburb': 'PPLX',
      'administrative': 'ADM1',
      'island': 'ISL',
      'mountain': 'MT',
      'lake': 'LAKE',
      'airport': 'AIRP',
      'park': 'PRK'
    };

    return typeMap[osmType] || 'PPL'; // Default to populated place
  }

  /**
   * Search for locations by name using Nominatim
   *
   * @param query - Location name to search for (e.g., "Paris", "New York, NY", "Tokyo")
   * @param limit - Maximum number of results to return (default: 5, max: 50)
   * @param language - Language for results (default: 'en')
   * @returns Geocoding results with coordinates and metadata
   */
  async searchLocation(
    query: string,
    limit: number = 5,
    language: string = 'en'
  ): Promise<MappedGeocodingResponse> {
    if (!query || query.trim().length === 0) {
      throw new InvalidLocationError(
        'Nominatim',
        'Search query cannot be empty'
      );
    }

    if (query.trim().length === 1) {
      throw new InvalidLocationError(
        'Nominatim',
        'Search query must be at least 2 characters long'
      );
    }

    // Validate limit (Nominatim recommends max 50)
    if (limit < 1 || limit > 50) {
      throw new InvalidLocationError(
        'Nominatim',
        'Limit must be between 1 and 50'
      );
    }

    // Check cache first
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('nominatim-geocoding', query, limit, language);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.info('Nominatim cache hit', { query });
        return cached as MappedGeocodingResponse;
      }

      // Enforce rate limiting before making request
      await this.enforceRateLimit();

      const startTime = Date.now();
      const params = {
        q: query.trim(),
        format: 'json',
        limit,
        addressdetails: 1,
        'accept-language': language
      };

      logger.info('Nominatim API request', { query, limit });
      const response = await this.client.get<NominatimLocation[]>('/search', { params });
      const generationTime = Date.now() - startTime;

      // Map Nominatim results to GeocodingResponse format
      const mappedResults: MappedGeocodingLocation[] = response.data.map((loc: NominatimLocation) =>
        this.mapLocation(loc)
      );

      const result: MappedGeocodingResponse = {
        results: mappedResults,
        generationtime_ms: generationTime
      };

      // Cache for 30 days (locations don't change frequently)
      this.cache.set(cacheKey, result, 30 * 24 * 60 * 60 * 1000);

      logger.info('Nominatim search completed', {
        query,
        resultCount: mappedResults.length,
        generationTimeMs: generationTime
      });

      return result;
    }

    // No caching - still enforce rate limiting
    await this.enforceRateLimit();

    const startTime = Date.now();
    const params = {
      q: query.trim(),
      format: 'json',
      limit,
      addressdetails: 1,
      'accept-language': language
    };

    const response = await this.client.get<NominatimLocation[]>('/search', { params });
    const generationTime = Date.now() - startTime;

    const mappedResults: MappedGeocodingLocation[] = response.data.map((loc: NominatimLocation) =>
      this.mapLocation(loc)
    );

    return {
      results: mappedResults,
      generationtime_ms: generationTime
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
