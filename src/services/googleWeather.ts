/**
 * Service for fetching Google Weather API (`weather.googleapis.com`)
 * public-alerts data — the **optional keyed global fallback** for the
 * "elsewhere" branch of `get_alerts`.
 *
 * `get_alerts` routes by country: US → NOAA, Canada → ECCC via MSC GeoMet,
 * 38 MeteoAlarm countries → MeteoAlarm. **This service is only ever reached
 * from the final "elsewhere" branch — the US, Canada, and MeteoAlarm
 * countries never contact Google, key or no key.** See
 * `docs/global-alerts-fallback-plan.md` D1/D2. Without a
 * `GOOGLE_WEATHER_API_KEY`, the elsewhere branch stays byte-identical to
 * today's not-covered message; this service never runs unkeyed.
 *
 * **Security: the key lives in the URL (query string).** Error mapping below
 * never logs or throws the request URL, and never interpolates the raw axios
 * error message/object into a thrown message or a log call — every thrown
 * error is a fixed, pre-written string (the `firms.ts`/`googlePollen.ts`
 * fixed-message-per-bucket style), so the key can never leak through a log
 * line or an error surfaced to a caller. Logs carry only `{ status, code }`;
 * coordinates in log metadata go through `redactCoordinatesForLogging`.
 */

import axios, { AxiosInstance } from 'axios';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { GOOGLE_WEATHER_API_KEY } from '../config/api.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { getUserAgent } from '../utils/version.js';
import type { GoogleWeatherAlert, GoogleWeatherAlertsResponse } from '../types/googleWeather.js';

/**
 * Thrown when the Google Weather API rejects the configured
 * `GOOGLE_WEATHER_API_KEY` (HTTP 400/403 with a key-rejection marker in the
 * response body — see `mapPublicAlertsError`). Deliberately carries a fixed,
 * sanitized message — never the key or the request URL — so callers (the
 * alerts handler) can catch this specific case and surface an actionable,
 * misconfiguration-only note without ever touching the rejected key again.
 *
 * Not `ApiError` — `ApiServiceName` (`src/errors/ApiError.ts`) is a closed
 * union and this service deliberately stays outside it, mirroring
 * `FIRMSKeyRejectedError` and `GooglePollenKeyRejectedError`.
 */
export class GoogleWeatherKeyRejectedError extends Error {
  constructor() {
    super(
      'Google Weather API key was rejected by the service. Check that the Weather API ' +
        'is enabled on the Google Cloud project for GOOGLE_WEATHER_API_KEY, and that the ' +
        'key is unrestricted or restricted to the Weather API — a key restricted to the ' +
        'Pollen API will not work here.'
    );
    this.name = 'GoogleWeatherKeyRejectedError';
  }
}

export interface GoogleWeatherServiceConfig {
  timeout?: number;
  /** Overrides the `GOOGLE_WEATHER_API_KEY` env var — primarily for tests. */
  apiKey?: string;
}

const PUBLIC_ALERTS_URL = 'https://weather.googleapis.com/v1/publicAlerts:lookup';

// Key-rejection markers are **web-verified only** (design plan upstream (g))
// — the same family observed live for the sibling Google Pollen service.
// To be confirmed/adjusted once T6 runs live verification against a real
// GOOGLE_WEATHER_API_KEY.
const KEY_REJECTION_MARKERS = ['API_KEY_INVALID', 'API key not valid', 'PERMISSION_DENIED'];

export class GoogleWeatherService {
  private client: AxiosInstance;
  private cache: Cache<GoogleWeatherAlert[]>;
  private readonly apiKey: string | undefined;

  constructor(config: GoogleWeatherServiceConfig = {}) {
    const {
      timeout = CacheConfig.apiTimeoutMs,
      apiKey = GOOGLE_WEATHER_API_KEY
    } = config;

    this.apiKey = apiKey;
    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      timeout,
      headers: {
        'User-Agent': getUserAgent()
      }
    });
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

  /**
   * True when a non-empty Google Weather API key is configured.
   */
  isKeyAvailable(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  /**
   * Active public weather alerts for a location.
   *
   * A `regionCode`-only response body (the documented no-data shape — no
   * active alerts, or a region Google does not cover; Google does not
   * distinguish the two) resolves to `[]`, and `[]` is cached so an
   * uncovered region isn't re-probed for the TTL. **No retries.**
   *
   * @throws {GoogleWeatherKeyRejectedError} the configured key was rejected
   * @throws {Error} no key configured, invalid coordinates, or any other failure
   */
  async getPublicAlerts(latitude: number, longitude: number): Promise<GoogleWeatherAlert[]> {
    validateLatitude(latitude);
    validateLongitude(longitude);

    if (!this.isKeyAvailable()) {
      throw new Error('Google Weather API key is not configured.');
    }

    // Rounded to 2 decimal places (~1.1km) — FIRMS/pollen precedent — plenty
    // precise for a cache key while keeping nearby repeat queries as hits.
    const cacheKey = Cache.generateKey('google-weather-alerts', latitude.toFixed(2), longitude.toFixed(2));

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        const redacted = redactCoordinatesForLogging(latitude, longitude);
        logger.info('Google Weather cache hit', { lat: redacted.lat, lon: redacted.lon });
        return cached;
      }
    }

    const alerts = await this.fetchPublicAlerts(latitude, longitude);

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, alerts, CacheConfig.ttl.alerts);
    }

    return alerts;
  }

  private async fetchPublicAlerts(latitude: number, longitude: number): Promise<GoogleWeatherAlert[]> {
    // The key rides in the request params, not the logged metadata below —
    // never log or throw this value (see module doc comment).
    const key = this.apiKey as string; // isKeyAvailable() already checked by the caller

    const redacted = redactCoordinatesForLogging(latitude, longitude);
    logger.info('Querying Google Weather public alerts', { lat: redacted.lat, lon: redacted.lon });

    try {
      const response = await this.client.get<GoogleWeatherAlertsResponse>(PUBLIC_ALERTS_URL, {
        params: {
          key,
          'location.latitude': latitude,
          'location.longitude': longitude,
          languageCode: 'en'
        }
      });

      const alerts = response.data?.alerts;
      if (!alerts || alerts.length === 0) {
        logger.info('Google Weather API returned no active alerts for this location');
        return [];
      }

      return alerts;
    } catch (error) {
      // Deliberately do not pass the raw axios error object to the logger —
      // it carries the request config (including the key in `params`). Only
      // fixed, sanitized fields are logged.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const code = axios.isAxiosError(error) ? error.code : undefined;
      logger.error('Google Weather API request failed', undefined, { status, code });

      throw mapPublicAlertsError(error);
    }
  }
}

/**
 * Stringify an axios error's response body for marker searching. The body may
 * arrive as a string, or as a JSON-parsed object shape like
 * `{ error: { status: 'PERMISSION_DENIED', message: '…' } }` — coerce both.
 * Never includes the request URL, so this is safe to search but must never be
 * logged or thrown.
 */
function responseBodyText(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return '';
  }

  const rawData = error.response?.data;
  if (typeof rawData === 'object' && rawData !== null) {
    try {
      return JSON.stringify(rawData);
    } catch {
      // JSON.stringify can throw on circular structures.
      return String(rawData);
    }
  }

  return String(rawData ?? '');
}

/**
 * Map a Google Weather API axios failure to a fixed, sanitized `Error` (or
 * `GoogleWeatherKeyRejectedError` for a confirmed key rejection). Copies the
 * `mapPollenApiError`/`mapAreaApiError` fixed-message-per-bucket style; never
 * interpolates `error.message` or the raw response body into a thrown
 * message.
 *
 * The key-rejection markers are **web-verified only** (design plan upstream
 * (g)) — to be confirmed/adjusted once T6 runs live verification against a
 * real key.
 */
function mapPublicAlertsError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') {
      return new Error(
        'Google Weather API request timed out. The service may be temporarily unavailable.'
      );
    }

    const status = error.response?.status;
    if (status === 400 || status === 403) {
      const bodyText = responseBodyText(error);

      if (KEY_REJECTION_MARKERS.some(marker => bodyText.includes(marker))) {
        return new GoogleWeatherKeyRejectedError();
      }
      return new Error('Invalid query parameters for Google Weather API.');
    }
    if (status === 429) {
      return new Error('Google Weather API quota exceeded. Please try again later.');
    }
    if (status !== undefined) {
      return new Error('Google Weather API returned an error response.');
    }

    return new Error('Failed to reach Google Weather API. Please check your network connection.');
  }

  return new Error('Failed to fetch weather alerts from Google Weather API.');
}
