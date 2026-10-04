/**
 * Service for interacting with the MSC GeoMet weather-alerts API
 * (Environment and Climate Change Canada) —
 * https://api.weather.gc.ca/collections/weather-alerts
 *
 * A keyless OGC API Features endpoint. Queried with a small bbox (±0.25°)
 * around a point, `f=json`. Live-verified (2026-08-13, see "MSC GeoMet
 * (Canada)" in `docs/plans/international-alerts-plan.md`): a zero-result bbox
 * returns HTTP 200 with `numberMatched: 0` — the happy empty path, not an
 * error — and `status_en: "ended"` items **remain in the collection**, so
 * expiry filtering is always required at read time (both on a fresh fetch
 * and on a cache hit, since a cached feature can cross its own expiry
 * between fetch and a later read).
 *
 * Like `acis.ts`, this is not one of the project's original data sources —
 * errors surface as plain, sanitized `Error`s (no `ApiError` union changes).
 */

import axios, { AxiosInstance } from 'axios';
import type { GeoMetAlertFeature, GeoMetFeatureCollection } from '../types/geomet.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { getUserAgent } from '../utils/version.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';

export interface GeoMetServiceConfig {
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

/** Half-extent (degrees) of the bbox built around a requested point. */
const BBOX_HALF_EXTENT = 0.25;

/** Values of `status_en` (case-insensitive) that mean the alert record itself is over and must be filtered out. */
const ENDED_STATUS_VALUES = new Set(['ended', 'expired']);

/**
 * Minimal structural shape of an axios-style error, checked without `any`.
 * Deliberately carries no `message` fields: `handleError` never forwards
 * upstream body text or the HTTP client's own text.
 */
interface AxiosLikeError {
  response?: { status: number };
  code?: string;
}

function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === 'object' && error !== null;
}

/**
 * A GeoMet failure already classified by `handleError`. `transient` is the
 * retry decision — read by `makeRequest`, decided in exactly one place.
 * A plain `Error` subclass on purpose: GeoMet is outside `ApiServiceName`
 * (CLAUDE.md, Error Handling), so `formatErrorForUser` takes its generic
 * branch and renders `Error: <message>` unchanged.
 */
class GeoMetRequestError extends Error {
  constructor(message: string, public readonly transient: boolean) {
    super(message);
    this.name = 'GeoMetRequestError';
  }
}

/** Build a GeoMet `bbox` string ("minLon,minLat,maxLon,maxLat") around a coordinate. */
function buildBbox(latitude: number, longitude: number, halfExtent: number): string {
  const minLon = longitude - halfExtent;
  const minLat = latitude - halfExtent;
  const maxLon = longitude + halfExtent;
  const maxLat = latitude + halfExtent;
  return [minLon, minLat, maxLon, maxLat].join(',');
}

/**
 * True if a feature's `status_en` means the alert record has ended
 * (case-insensitive; observed value is `"ended"`).
 */
function isEndedStatus(statusEn: string | undefined): boolean {
  if (!statusEn) {
    return false;
  }
  return ENDED_STATUS_VALUES.has(statusEn.trim().toLowerCase());
}

/** True if a feature's `expiration_datetime` is a parseable timestamp in the past relative to `now`. */
function isExpired(expirationDatetime: string | undefined, now: Date): boolean {
  if (!expirationDatetime) {
    return false;
  }
  const expiry = new Date(expirationDatetime);
  if (isNaN(expiry.getTime())) {
    return false;
  }
  return expiry.getTime() <= now.getTime();
}

/**
 * Filter a raw feature list down to alerts that are still active: drops
 * features whose `status_en` means ended/expired, and features whose
 * `expiration_datetime` is in the past. Pure function, no I/O — applied on
 * every `getAlerts` return (fresh fetch or cache hit) so a cached entry
 * never serves a just-expired alert.
 */
export function filterActiveGeoMetAlerts(
  features: GeoMetAlertFeature[],
  now: Date = new Date()
): GeoMetAlertFeature[] {
  return features.filter(feature => {
    const props = feature.properties;
    if (isEndedStatus(props.status_en)) {
      return false;
    }
    if (isExpired(props.expiration_datetime, now)) {
      return false;
    }
    return true;
  });
}

/**
 * MSC GeoMet (Environment and Climate Change Canada) weather-alerts API
 * client. No API key required.
 */
export class GeoMetService {
  private client: AxiosInstance;
  private cache: Cache<GeoMetAlertFeature[]>;
  private maxRetries: number;

  constructor(config: GeoMetServiceConfig = {}) {
    const {
      baseURL = 'https://api.weather.gc.ca',
      timeout = CacheConfig.apiTimeoutMs,
      maxRetries = 3
    } = config;

    this.maxRetries = maxRetries;
    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      }
    });

    this.client.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );
  }

  /**
   * Fetch currently active weather alerts near a point from MSC GeoMet.
   * Queries a small bbox (±0.25°) around the coordinates and returns only
   * unexpired, non-ended features — expiry filtering is applied both to a
   * fresh fetch and to a cache hit, since raw (unfiltered) results are what
   * gets cached.
   */
  async getAlerts(latitude: number, longitude: number): Promise<GeoMetAlertFeature[]> {
    const redacted = redactCoordinatesForLogging(latitude, longitude);

    const cacheKey = Cache.generateKey(
      'geomet-alerts',
      latitude.toFixed(2),
      longitude.toFixed(2)
    );

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.info('GeoMet alerts cache hit', redacted);
        return filterActiveGeoMetAlerts(cached);
      }
    }

    const bbox = buildBbox(latitude, longitude, BBOX_HALF_EXTENT);
    const data = await this.makeRequest(bbox);
    const features = data.features ?? [];

    logger.info('Fetched GeoMet alerts', {
      ...redacted,
      numberMatched: data.numberMatched ?? features.length
    });

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, features, CacheConfig.ttl.alerts);
    }

    return filterActiveGeoMetAlerts(features);
  }

  /**
   * Request with retry/backoff: a 429, a 5xx or a failed connection is
   * retried up to `maxRetries` times with exponential backoff and jitter; a
   * timeout and any other status are not. The decision is
   * `GeoMetRequestError.transient`, set once in `handleError` — the thrown
   * message is never read.
   * @private
   */
  private async makeRequest(bbox: string, retries = 0): Promise<GeoMetFeatureCollection> {
    try {
      const response = await this.client.get<GeoMetFeatureCollection>('/collections/weather-alerts/items', {
        params: { bbox, f: 'json' }
      });
      return response.data;
    } catch (error) {
      if (retries < this.maxRetries && error instanceof GeoMetRequestError && error.transient) {
        const baseDelay = Math.pow(2, retries) * 1000;
        const delay = baseDelay * (0.5 + Math.random() * 0.5);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequest(bbox, retries + 1);
      }
      throw error;
    }
  }

  /**
   * Handle API errors. GeoMet has no service literal in `ApiError` (it is
   * not one of the project's original data sources), so errors are
   * surfaced as plain, sanitized `Error`s with fixed, pre-written messages —
   * upstream body text and axios text are never forwarded. Follows
   * `AcisService`'s precedent (`src/services/acis.ts`).
   * @private
   */
  private async handleError(error: unknown): Promise<never> {
    if (isAxiosLikeError(error)) {
      if (error.response) {
        const status = error.response.status;

        if (status === 429) {
          throw new GeoMetRequestError(`GeoMet API returned status ${status} (rate limit)`, true);
        }
        if (status >= 500) {
          throw new GeoMetRequestError(`GeoMet API returned status ${status} (server error)`, true);
        }
        throw new GeoMetRequestError(`GeoMet API returned status ${status}`, false);
      }

      // Not retried: a timeout has already spent API_TIMEOUT_MS (30 s by
      // default) and the MCP SDK's request budget is 60 s, so a retry would
      // answer after the client has given up — the v1.34.2 rule for NOAA and
      // Open-Meteo (`isTransientFailure`).
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new GeoMetRequestError('GeoMet request timed out', false);
      }

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new GeoMetRequestError('Unable to connect to GeoMet API', true);
      }

      if ((error as { message?: unknown }).message) {
        throw new GeoMetRequestError('GeoMet request failed', false);
      }
    }

    // `isAxiosLikeError` accepts any object, so this rethrow is reached only
    // by an `Error` whose message is empty — there is no text to forward.
    if (error instanceof Error) {
      throw error;
    }

    throw new GeoMetRequestError('Unknown error occurred while contacting GeoMet API', false);
  }
}
