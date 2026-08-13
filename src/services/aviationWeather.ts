/**
 * Service for interacting with the NOAA Aviation Weather Center's METAR API
 * — https://aviationweather.gov/api/data/metar
 *
 * Publishes decoded METAR (and SPECI) station observations worldwide as
 * keyless JSON, v4, no signup. Documented at 100 req/min with a descriptive
 * User-Agent advised.
 *
 * Three behaviours were verified live (2026-08-13, see the "Verified API
 * contract" section of `docs/metar-plan.md`) and are load-bearing here:
 *
 *   - Empty and invalid bbox queries return **HTTP 204 with an empty body**
 *     — not an empty JSON array. Calling `.json()`/`JSON.parse` on it
 *     throws, so it must be handled before any parsing is attempted.
 *   - A sustained burst produced **HTTP 502 with an HTML body** from the
 *     Azure gateway fronting the API. Non-2xx responses must never be
 *     parsed as JSON, and the raw body must never reach a thrown error
 *     message. The endpoint recovered on retry, so the existing
 *     retry/backoff pattern is required, not optional.
 *   - Results carry no distance field and are not usefully sorted; nearest-
 *     station selection is entirely client-side (see `src/utils/metarStation.ts`,
 *     a later task).
 */

import axios, { AxiosInstance } from 'axios';
import type { BoundingBox, MetarObservation } from '../types/aviationWeather.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { logger } from '../utils/logger.js';
import { VERSION } from '../utils/version.js';
import { ApiError, ServiceUnavailableError } from '../errors/ApiError.js';

export interface AviationWeatherServiceConfig {
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

/** Descriptive User-Agent for this service only — does not touch the shared `getUserAgent()`. */
const METAR_USER_AGENT = `weather-mcp/${VERSION} (+https://github.com/weather-mcp/weather-mcp)`;

/** HTTP statuses treated as transient (Azure gateway failures observed live) — the only statuses that trigger a retry. */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

/** Minimal structural shape of an axios-style error, checked without `any`. */
interface AxiosLikeError {
  response?: {
    status: number;
    data?: unknown;
    headers?: Record<string, string | undefined>;
  };
  code?: string;
  message?: string;
}

function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === 'object' && error !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamp a bounding box to valid lat/lon ranges (±90/±180) and guarantee the
 * result is never inverted (`minLon > maxLon`). Latitude never wraps, so an
 * inverted latitude pair after clamping can only mean the input was already
 * bogus and is corrected by swapping. Longitude can wrap at the
 * antimeridian; if independent clamping of `minLon`/`maxLon` would invert
 * the box, this narrows to the western edge rather than emit an inverted
 * bbox — the caller's tier-widening search (a later task) supplies
 * recovery, so no two-request antimeridian split is needed here.
 */
export function clampBoundingBox(bbox: BoundingBox): BoundingBox {
  let minLat = clamp(bbox.minLat, -90, 90);
  let maxLat = clamp(bbox.maxLat, -90, 90);
  if (minLat > maxLat) {
    [minLat, maxLat] = [maxLat, minLat];
  }

  const minLon = clamp(bbox.minLon, -180, 180);
  let maxLon = clamp(bbox.maxLon, -180, 180);
  if (minLon > maxLon) {
    logger.warn('Clamped METAR bbox would invert; narrowing to a single-longitude line', {
      original: bbox
    });
    maxLon = minLon;
  }

  return { minLat, minLon, maxLat, maxLon };
}

/** True if a response body looks like HTML (or otherwise clearly isn't JSON) rather than API data. */
function looksLikeNonJsonBody(data: unknown, contentType?: string): boolean {
  if (contentType && contentType.toLowerCase().includes('text/html')) {
    return true;
  }
  if (typeof data !== 'string') {
    return false;
  }
  const trimmed = data.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return trimmed.startsWith('<') || /<html/i.test(trimmed);
}

/**
 * Build a sanitized, bounded error detail message for a non-2xx response.
 * Never includes the raw response body when that body looks like HTML —
 * a gateway error page must not leak into a thrown error message.
 */
function sanitizedErrorDetail(status: number, data: unknown, contentType?: string): string {
  if (looksLikeNonJsonBody(data, contentType)) {
    return `AviationWeather API returned status ${status}`;
  }
  if (typeof data === 'string' && data.trim().length > 0 && data.length <= 200) {
    return data.trim();
  }
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0 && message.length <= 200) {
      return message;
    }
  }
  return `AviationWeather API returned status ${status}`;
}

/** Parse a METAR bbox response body into observations. Never throws on an empty/whitespace body — that's zero rows, not a parse error. */
function parseMetarResponseBody(data: unknown): MetarObservation[] {
  if (typeof data === 'string') {
    if (data.trim().length === 0) {
      // HTTP 204 (and any other empty-body success) — zero rows, never parsed.
      return [];
    }
    // Defensive: axios normally auto-parses JSON bodies, but fall back to
    // parsing manually if a string somehow reaches here.
    try {
      const parsed: unknown = JSON.parse(data);
      return Array.isArray(parsed) ? (parsed as MetarObservation[]) : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(data)) {
    return data as MetarObservation[];
  }
  return [];
}

/**
 * NOAA Aviation Weather Center METAR API client. No API key required.
 */
export class AviationWeatherService {
  private client: AxiosInstance;
  private cache: Cache<MetarObservation[]>;
  private maxRetries: number;

  constructor(config: AviationWeatherServiceConfig = {}) {
    const {
      baseURL = 'https://aviationweather.gov/api/data',
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
        'User-Agent': METAR_USER_AGENT
      }
    });

    this.client.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );
  }

  /**
   * Fetch decoded METAR observations for every station within a bounding
   * box. The box is clamped (never inverted) before the request and used
   * (rounded) as the cache key. Returns `[]` for an empty bbox result
   * (HTTP 204) rather than throwing.
   */
  async getMetarsInBoundingBox(bbox: BoundingBox): Promise<MetarObservation[]> {
    const clamped = clampBoundingBox(bbox);

    const cacheKey = Cache.generateKey(
      'metar-bbox',
      clamped.minLat.toFixed(2),
      clamped.minLon.toFixed(2),
      clamped.maxLat.toFixed(2),
      clamped.maxLon.toFixed(2)
    );

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.info('METAR bbox cache hit', { cacheKey });
        return cached;
      }
    }

    const data = await this.makeRequest(clamped);
    const observations = parseMetarResponseBody(data);

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, observations, CacheConfig.ttl.metarObservations);
    }

    return observations;
  }

  /**
   * Request with retry/backoff, mirroring `NOAAService.makeRequest`.
   * Retries only on the transient classes observed live — 502/503/504 and
   * network errors, both mapped to `ServiceUnavailableError` by
   * `handleError`. A 204 resolves normally (axios treats it as success) and
   * never reaches this catch block; other 4xx/5xx statuses are mapped to a
   * non-retryable `ApiError` and are not retried.
   * @private
   */
  private async makeRequest(bbox: BoundingBox, retries = 0): Promise<unknown> {
    try {
      const response = await this.client.get('/metar', {
        params: {
          bbox: `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`,
          format: 'json'
        }
      });
      return response.data;
    } catch (error) {
      if (retries < this.maxRetries && error instanceof ServiceUnavailableError) {
        const baseDelay = Math.pow(2, retries) * 1000;
        const delay = baseDelay * (0.5 + Math.random() * 0.5);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequest(bbox, retries + 1);
      }
      throw error;
    }
  }

  /**
   * Map API errors to sanitized, typed errors. Non-2xx bodies that look
   * like HTML (the observed Azure gateway failure page) or otherwise
   * aren't JSON are never included in a thrown message. Only 502/503/504
   * and network-level failures are mapped to `ServiceUnavailableError`
   * (the class `makeRequest` retries on); everything else maps to a
   * non-retryable `ApiError`.
   * @private
   */
  private async handleError(error: unknown): Promise<never> {
    if (isAxiosLikeError(error)) {
      if (error.response) {
        const { status, data, headers } = error.response;
        const contentType = headers?.['content-type'];
        const detail = sanitizedErrorDetail(status, data, contentType);

        if (TRANSIENT_STATUSES.has(status)) {
          logger.warn('AviationWeather API returned a transient error', {
            service: 'AviationWeather',
            status,
            securityEvent: true
          });
          throw new ServiceUnavailableError('AviationWeather', detail);
        }

        logger.warn('AviationWeather API returned a non-retryable error', {
          service: 'AviationWeather',
          status,
          securityEvent: true
        });
        throw new ApiError(
          `AviationWeather API request failed with status ${status}`,
          status,
          'AviationWeather',
          detail,
          [],
          false
        );
      }

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new ServiceUnavailableError('AviationWeather', 'AviationWeather API request timed out');
      }

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new ServiceUnavailableError('AviationWeather', 'Unable to connect to AviationWeather API');
      }

      if (error.message) {
        throw new ServiceUnavailableError('AviationWeather', error.message);
      }
    }

    throw new ServiceUnavailableError('AviationWeather', 'Unknown error occurred while contacting AviationWeather API');
  }
}
