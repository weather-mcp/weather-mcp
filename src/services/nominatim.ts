/**
 * Reverse client for the Nominatim API, country level only.
 * Documentation: https://nominatim.org/release-docs/latest/api/Reverse/
 *
 * Nominatim is the geocoding service powering OpenStreetMap. This service
 * resolves a coordinate to a country code. Forward (name to coordinates)
 * search lives in `GeocodingService` (`geocoding.ts`), whose Nominatim
 * provider shares this service's request spacer.
 *
 * Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
 * - Maximum 1 request per second
 * - Requires User-Agent header
 * - No bulk geocoding
 *
 * This server enforces the one-per-second limit **per process**, across both
 * of its Nominatim clients (this service and `GeocodingService`'s provider),
 * when the composition root hands them one `RequestSpacer`. Several server
 * processes on one host each honour it separately and together do not.
 * Revisit if a Nominatim 429 or 403 appears on a host running more than one
 * instance.
 */

import axios, { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import type {
  NominatimErrorResponse,
  NominatimReverseResponse
} from '../types/nominatim.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { logger, redactCoordinatesForLogging, isPiiLoggingEnabled } from '../utils/logger.js';
import { getUserAgent } from '../utils/version.js';
import { RequestSpacer } from '../utils/requestSpacer.js';
import { withRequestDeadline } from '../utils/httpDeadline.js';
import {
  RateLimitError,
  ServiceUnavailableError,
  InvalidLocationError,
  ApiError
} from '../errors/ApiError.js';

/** 1 request per second (Nominatim usage policy). */
export const NOMINATIM_MIN_INTERVAL_MS = 1000;

/**
 * Response-size cap. Design sweep 2026-11-27: `/search?q=Springfield&limit=50` with address,
 * extra-tag and name details was 34,863 decoded bytes. ≥ 8× that gives the 2 MiB floor.
 */
const NOMINATIM_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** The fixed user-facing sentence of an oversize Nominatim answer. */
const NOMINATIM_TOO_LARGE_MESSAGE = 'Nominatim response too large';

const NOMINATIM_HELP_LINKS = [
  'https://nominatim.org/release-docs/latest/api/Search/',
  'https://wiki.openstreetmap.org/wiki/Nominatim'
];

export interface NominatimServiceConfig {
  baseURL?: string;
  timeout?: number;
  /** Request-start budget. Share one instance to share the budget; omitted ⇒ a private one. */
  spacer?: RequestSpacer;
}

export class NominatimService {
  private client: AxiosInstance;
  private cache: Cache;
  private readonly spacer: RequestSpacer;
  // Single-flight: concurrent lookups for one cache key share one request.
  // Entries are deleted in `finally`, so a rejected pull is never kept.
  private readonly reverseInFlight = new Map<string, Promise<string | null>>();

  constructor(config: NominatimServiceConfig = {}) {
    const {
      baseURL = 'https://nominatim.openstreetmap.org',
      timeout = CacheConfig.apiTimeoutMs
    } = config;

    this.cache = new Cache(CacheConfig.maxSize);
    this.spacer = config.spacer ?? new RequestSpacer(NOMINATIM_MIN_INTERVAL_MS);

    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      },
      // A 3xx is an error, never followed.
      maxRedirects: 0,
      maxContentLength: NOMINATIM_MAX_RESPONSE_BYTES,
      adapter: withRequestDeadline(),
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
    // An oversize answer, checked *before* the `response` branch: the rejection carries no `response`,
    // so it would otherwise reach the generic branch and forward the raw axios text. Gated on the code
    // *and* the message, so another ERR_BAD_RESPONSE keeps today's path.
    if (error.code === 'ERR_BAD_RESPONSE' && /maxContentLength/.test(error.message ?? '')) {
      throw new ApiError(
        NOMINATIM_TOO_LARGE_MESSAGE,
        502,
        'Nominatim',
        `${NOMINATIM_TOO_LARGE_MESSAGE}: the service answered with more data than this server accepts.`,
        NOMINATIM_HELP_LINKS,
        false
      );
    }

    if (error.response) {
      const status = error.response.status;

      // A 3xx is never followed (`maxRedirects: 0`), so it is a fixed error, decided before any read of
      // the body, which may be null or a string here.
      if (status >= 300 && status < 400) {
        throw new ApiError(
          `Nominatim returned status ${status}`,
          status,
          'Nominatim',
          `Nominatim returned status ${status}, a redirect this server does not follow.`,
          NOMINATIM_HELP_LINKS,
          false
        );
      }

      const data = error.response.data as NominatimErrorResponse;

      // Bad request
      if (status === 400) {
        // `data.error` is upstream text about the request and can quote what was sent (the
        // coordinates), so default logs carry only the fixed fields; LOG_PII adds it.
        logger.warn('Invalid request parameters', {
          service: 'Nominatim',
          ...(isPiiLoggingEnabled() ? { error: data.error } : {}),
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
   * Enforce rate limiting (1 request per second as per Nominatim usage policy).
   * The budget is shared with every holder of the same `RequestSpacer`; the
   * slot is reserved synchronously, so concurrent callers start one interval
   * apart.
   * @private
   */
  private async enforceRateLimit(): Promise<void> {
    await this.spacer.reserve((waitMs) => {
      logger.info('Rate limiting: waiting before next request', {
        service: 'Nominatim',
        // The spacer's monotonic clock reads fractional ms; log whole ms.
        waitTimeMs: Math.round(waitMs)
      });
    });
  }

  /**
   * Resolve the country at a coordinate via Nominatim reverse geocoding
   * (country-level only — `zoom=3`, the privacy-minimal request for this
   * purpose).
   *
   * Open ocean / unresolvable coordinates return HTTP 200 with
   * `{"error": "Unable to geocode"}` — that is a *result* (no country),
   * not a failure, and is cached like any other answer: countries don't
   * move, so a permanent cache applies even to "no country" answers.
   *
   * @param latitude - Latitude
   * @param longitude - Longitude
   * @returns Lowercased ISO 3166-1 alpha-2 country code, or `null` if the
   *   point has no resolvable country (e.g. open ocean).
   */
  async reverseCountry(latitude: number, longitude: number): Promise<string | null> {
    // Round to ~1.1km so nearby repeat queries share one cache entry.
    const cacheKey = Cache.generateKey(
      'reverse-country',
      latitude.toFixed(2),
      longitude.toFixed(2)
    );

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        logger.info('Nominatim reverse-country cache hit', redactCoordinatesForLogging(latitude, longitude));
        return cached as string | null;
      }
    }

    // No await between this check and the publish below (G20); memo published
    // before the body runs (G113).
    const pending = this.reverseInFlight.get(cacheKey);
    if (pending) return pending;
    const pull = Promise.resolve()
      .then(() => this.fetchReverseCountry(latitude, longitude, cacheKey))
      .finally(() => { this.reverseInFlight.delete(cacheKey); });
    this.reverseInFlight.set(cacheKey, pull);
    return pull;
  }

  /**
   * The network half of `reverseCountry`, run once per in-flight key.
   * @private
   */
  private async fetchReverseCountry(
    latitude: number,
    longitude: number,
    cacheKey: string
  ): Promise<string | null> {
    await this.enforceRateLimit();

    const params = {
      lat: latitude,
      lon: longitude,
      format: 'jsonv2',
      zoom: 3
    };

    logger.info('Nominatim reverse geocoding request', redactCoordinatesForLogging(latitude, longitude));
    const response = await this.client.get<NominatimReverseResponse>('/reverse', { params });
    const data = response.data;

    const countryCode: string | null =
      !data.error && data.address?.country_code
        ? data.address.country_code.toLowerCase()
        : null;

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, countryCode, CacheConfig.ttl.reverseCountry);
    }

    return countryCode;
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
