/**
 * Service for fetching Google Pollen API (`pollen.googleapis.com`) day-1
 * forecasts — the **optional keyed global fallback** for pollen data.
 *
 * Open-Meteo's air-quality endpoint carries pollen only from the CAMS
 * *European* model: real grains/m³ in Europe, all-null everywhere else. This
 * service exists purely to fill that gap for the rest of the world when the
 * caller has configured a `GOOGLE_POLLEN_API_KEY` — see
 * `docs/global-pollen-fallback-plan.md` D2/D3. **Europe keeps the richer
 * keyless CAMS grains/m³ data and never contacts this service** — the
 * air-quality handler only calls in when every CAMS species comes back null.
 *
 * **Security: the key lives in the URL (query string).** Error mapping below
 * never logs or throws the request URL, and never interpolates the raw axios
 * error message/object into a thrown message or a log call — every thrown
 * error is a fixed, pre-written string (the `firms.ts`/`nifc.ts`
 * fixed-message-per-bucket style), so the key can never leak through a log
 * line or an error surfaced to a caller. Logs carry only `{ status, code }`;
 * coordinates in log metadata go through `redactCoordinatesForLogging`.
 */

import axios, { AxiosInstance } from 'axios';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { GOOGLE_POLLEN_API_KEY } from '../config/api.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { getUserAgent } from '../utils/version.js';
import type { GooglePollenDailyInfo, GooglePollenResponse } from '../types/googlePollen.js';

/**
 * Thrown when the Google Pollen API rejects the configured
 * `GOOGLE_POLLEN_API_KEY` (HTTP 400/403 with a key-rejection marker in the
 * response body — see `mapPollenApiError`). Deliberately carries a fixed,
 * sanitized message — never the key or the request URL — so callers (the
 * air-quality handler) can catch this specific case and render a
 * misconfiguration note without ever touching the rejected key again.
 *
 * Not `ApiError` — `ApiServiceName` (`src/errors/ApiError.ts`) is a closed
 * union and this service deliberately stays outside it, mirroring
 * `FIRMSKeyRejectedError`.
 */
export class GooglePollenKeyRejectedError extends Error {
  constructor() {
    super('Google Pollen API key was rejected by the service');
    this.name = 'GooglePollenKeyRejectedError';
  }
}

export interface GooglePollenServiceConfig {
  timeout?: number;
  /** Overrides the `GOOGLE_POLLEN_API_KEY` env var — primarily for tests. */
  apiKey?: string;
}

const POLLEN_API_URL = 'https://pollen.googleapis.com/v1/forecast:lookup';

// **Live-verified 2026-08-18** (upstream (f) in the design plan): a rejected
// key returns HTTP 400 with a body carrying both `API key not valid` and
// `API_KEY_INVALID`. `PERMISSION_DENIED` was not observed (it belongs to an
// API-not-enabled / key-restricted-away project) and is kept as a defensive
// third marker.
const KEY_REJECTION_MARKERS = ['API_KEY_INVALID', 'API key not valid', 'PERMISSION_DENIED'];

// **Live-verified 2026-08-18:** a region Google does not cover (open ocean,
// Antarctica) answers HTTP 400 `INVALID_ARGUMENT` with this message — *not*
// the HTTP 200 with an empty `dailyInfo` the design anticipated. That is a
// "no data here" answer rather than a fault, so it resolves to `undefined`
// and caches the null sentinel instead of throwing; otherwise an uncovered
// location would re-query Google on every single call, burning quota the
// TTL was meant to protect.
//
// Deliberately matched on this specific message, not on the status: a
// genuinely malformed request is *also* 400 `INVALID_ARGUMENT`, and silently
// caching that as "no pollen here" would mask a real bug for the whole TTL.
// If Google rewords the message the match simply fails and the throwing path
// takes over, which still ends at a silent no-section — safe degradation.
const LOCATION_UNAVAILABLE_MARKER = 'Information is unavailable for this location';

export class GooglePollenService {
  private client: AxiosInstance;
  // Cached value distinguishes "not yet cached" (Cache.get -> undefined) from
  // a cached "no data for this location" result (Cache.get -> null) so an
  // uncovered region isn't re-probed for the TTL — see getCurrentPollen.
  private cache: Cache<GooglePollenDailyInfo | null>;
  private readonly apiKey: string | undefined;

  constructor(config: GooglePollenServiceConfig = {}) {
    const {
      timeout = CacheConfig.apiTimeoutMs,
      apiKey = GOOGLE_POLLEN_API_KEY
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
   * True when a non-empty Google Pollen API key is configured.
   */
  isKeyAvailable(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  /**
   * Day-1 ("current") pollen forecast for a location.
   *
   * Returns `undefined` when the region has no data (uncovered region, or an
   * empty/absent `dailyInfo`) — that outcome is cached as a null sentinel so
   * the same location isn't re-probed for the TTL. **No retries.**
   *
   * @throws {GooglePollenKeyRejectedError} the configured key was rejected
   * @throws {Error} no key configured, invalid coordinates, or any other failure
   */
  async getCurrentPollen(
    latitude: number,
    longitude: number
  ): Promise<GooglePollenDailyInfo | undefined> {
    validateLatitude(latitude);
    validateLongitude(longitude);

    if (!this.isKeyAvailable()) {
      throw new Error('Google Pollen API key is not configured.');
    }

    // Rounded to 2 decimal places (~1.1km) — FIRMS precedent — plenty
    // precise for a cache key while keeping nearby repeat queries as hits.
    const cacheKey = Cache.generateKey('google-pollen', latitude.toFixed(2), longitude.toFixed(2));

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        const redacted = redactCoordinatesForLogging(latitude, longitude);
        logger.info('Google Pollen cache hit', { lat: redacted.lat, lon: redacted.lon });
        return cached === null ? undefined : cached;
      }
    }

    const dailyInfo = await this.fetchCurrentPollen(latitude, longitude);

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, dailyInfo ?? null, CacheConfig.ttl.googlePollen);
    }

    return dailyInfo;
  }

  private async fetchCurrentPollen(
    latitude: number,
    longitude: number
  ): Promise<GooglePollenDailyInfo | undefined> {
    // The key rides in the request params, not the logged metadata below —
    // never log or throw this value (see module doc comment).
    const key = this.apiKey as string; // isKeyAvailable() already checked by the caller

    const redacted = redactCoordinatesForLogging(latitude, longitude);
    logger.info('Querying Google Pollen API', { lat: redacted.lat, lon: redacted.lon });

    try {
      const response = await this.client.get<GooglePollenResponse>(POLLEN_API_URL, {
        params: {
          key,
          'location.latitude': latitude,
          'location.longitude': longitude,
          days: 1,
          languageCode: 'en'
        }
      });

      const dailyInfo = response.data?.dailyInfo;
      if (!dailyInfo || dailyInfo.length === 0) {
        logger.info('Google Pollen API returned no daily data for this location');
        return undefined;
      }

      return dailyInfo[0];
    } catch (error) {
      // Deliberately do not pass the raw axios error object to the logger —
      // it carries the request config (including the key in `params`). Only
      // fixed, sanitized fields are logged.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const code = axios.isAxiosError(error) ? error.code : undefined;

      // An uncovered region is expected, not a fault — resolve to "no data"
      // so the caller caches the null sentinel and stops re-probing.
      if (isLocationUnavailable(error)) {
        logger.info('Google Pollen has no coverage for this location', { status });
        return undefined;
      }

      logger.error('Google Pollen API request failed', undefined, { status, code });

      throw mapPollenApiError(error);
    }
  }
}

/**
 * Stringify an axios error's response body for marker searching. The body may
 * arrive as a string, or as a JSON-parsed object shape like
 * `{ error: { status: 'INVALID_ARGUMENT', message: '…' } }` — coerce both.
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
 * True for the live-verified "this location has no pollen coverage" answer —
 * HTTP 400 whose body carries `LOCATION_UNAVAILABLE_MARKER` and *no*
 * key-rejection marker. See that constant for why the match is on the message
 * rather than the status.
 */
function isLocationUnavailable(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 400) {
    return false;
  }

  const bodyText = responseBodyText(error);
  if (KEY_REJECTION_MARKERS.some(marker => bodyText.includes(marker))) {
    return false;
  }

  return bodyText.includes(LOCATION_UNAVAILABLE_MARKER);
}

/**
 * Map a Google Pollen API axios failure to a fixed, sanitized `Error` (or
 * `GooglePollenKeyRejectedError` for a confirmed key rejection). Copies the
 * `firms.ts` `mapAreaApiError` fixed-message-per-bucket style; never
 * interpolates `error.message` or the raw response body into a thrown
 * message.
 *
 * The key-rejection markers below are **web-verified only** (design plan
 * upstream (f)) — to be confirmed/adjusted once T6 runs live verification
 * against a real key.
 */
function mapPollenApiError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') {
      return new Error(
        'Google Pollen API request timed out. The service may be temporarily unavailable.'
      );
    }

    const status = error.response?.status;
    if (status === 400 || status === 403) {
      const bodyText = responseBodyText(error);

      if (KEY_REJECTION_MARKERS.some(marker => bodyText.includes(marker))) {
        return new GooglePollenKeyRejectedError();
      }
      return new Error('Invalid query parameters for Google Pollen API.');
    }
    if (status === 429) {
      return new Error('Google Pollen API monthly quota exceeded. Please try again later.');
    }
    if (status !== undefined) {
      return new Error('Google Pollen API returned an error response.');
    }

    return new Error('Failed to reach Google Pollen API. Please check your network connection.');
  }

  return new Error('Failed to fetch pollen data from Google Pollen API.');
}
