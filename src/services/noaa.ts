/**
 * Service for interacting with the NOAA Weather API
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  PointsResponse,
  ForecastResponse,
  ObservationResponse,
  ObservationCollectionResponse,
  StationCollectionResponse,
  AlertCollectionResponse,
  NOAAErrorResponse,
  NWPSGauge,
  NWPSGaugesResponse,
  NWPSStageFlowResponse
} from '../types/noaa.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig, getHistoricalDataTTL } from '../config/cache.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { isConnectionFailureCode } from '../utils/connectionFailure.js';
import { logger } from '../utils/logger.js';
import { classifyProbeAnswer, type ServiceProbeResult } from '../utils/serviceStatusProbe.js';
import { withRequestDeadline } from '../utils/httpDeadline.js';
import {
  RateLimitError,
  ServiceUnavailableError,
  InvalidLocationError,
  DataNotFoundError,
  ApiError,
  isRetryableError
} from '../errors/ApiError.js';

/** A JSON object — not `null`, not an array, not a string (G4: `''` is the real empty body). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A list member carrying every field the river handler reads without a guard. */
function isUsableNWPSGauge(value: unknown): value is NWPSGauge {
  return (
    isPlainObject(value) &&
    typeof value.lid === 'string' &&
    typeof value.name === 'string' &&
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude) &&
    isPlainObject(value.status)
  );
}

/**
 * The gauges of an NWPS bounding-box answer, or a throw when the body is not that
 * answer (G4). `{ gauges: [] }` is the honest empty list. A body with no array
 * `gauges` (an HTML page, `''`, a gateway's `{ error }`, `gauges: null`) is an
 * upstream failure, and so is a non-empty list with no usable member. An unusable
 * member beside usable ones is dropped with a warning, so that one bad gauge
 * cannot blank the rest.
 */
function usableNWPSGauges(data: unknown): NWPSGauge[] {
  if (!isPlainObject(data) || !Array.isArray(data.gauges)) {
    logger.warn('NWPS gauge list has no usable envelope', {
      service: 'NOAA',
      bodyType: Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data,
      securityEvent: true
    });
    throw new ServiceUnavailableError('NOAA');
  }
  const members: unknown[] = data.gauges;
  const usable = members.filter(isUsableNWPSGauge);
  if (usable.length < members.length) {
    logger.warn('NWPS gauge list has unusable members', {
      service: 'NOAA',
      total: members.length,
      dropped: members.length - usable.length,
      securityEvent: true
    });
    if (usable.length === 0) {
      throw new ServiceUnavailableError('NOAA');
    }
  }
  return usable;
}

/**
 * Response-size cap for the main `api.weather.gov` client. Design sweep 2026-11-27: the largest decoded
 * body the code can request was `/stations/<id>/observations?limit=500` at 1,955,559 bytes (the code
 * clamps `limit` to 500). The cap is ≥ 8× that, rounded up to a multiple of 4 MiB (2 MiB floor).
 * An answer over it fails as "NOAA response too large" and is not retried.
 */
const NOAA_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * Response-size cap for the NWPS client. Design sweep 2026-11-27: a 6°×6° `/gauges` bbox list was
 * 490,251 bytes and one gauge's `/stageflow` 473,297. ≥ 8×, rounded up to a multiple of 4 MiB.
 */
const NWPS_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** The fixed user-facing sentence of an oversize answer from either NOAA client. */
const NOAA_TOO_LARGE_MESSAGE = 'NOAA response too large';

export interface NOAAServiceConfig {
  userAgent?: string;
  baseURL?: string;
  nwpsBaseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Whether a failure the response interceptor already typed is worth another
 * attempt. `handleError` has classified every axios failure by the time the
 * ladder sees it, so this reads the class, never `error.message` — the typed
 * messages match no substring the old test looked for, so nothing was ever
 * retried (G129). A timeout is not retried: it has already spent
 * `API_TIMEOUT_MS`, so a second attempt ends past the MCP SDK's 60 s budget.
 * Twin of `isTransientFailure` in `openmeteo.ts`, deliberately not shared.
 */
function isTransientFailure(error: unknown): boolean {
  if (error instanceof ServiceUnavailableError) {
    return error.causeCode !== 'ECONNABORTED';
  }
  return error instanceof Error && isRetryableError(error);
}

export class NOAAService {
  private client: AxiosInstance;
  private nwpsClient: AxiosInstance; // For NOAA water/river data
  private maxRetries: number;
  private cache: Cache;

  constructor(config: NOAAServiceConfig = {}) {
    const {
      userAgent = '(weather-mcp, contact@example.com)',
      baseURL = 'https://api.weather.gov',
      nwpsBaseURL = 'https://api.water.noaa.gov/nwps/v1',
      timeout = CacheConfig.apiTimeoutMs,
      maxRetries = 3
    } = config;

    this.maxRetries = maxRetries;
    this.cache = new Cache(CacheConfig.maxSize);

    // Main NOAA Weather API client
    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/geo+json'
      },
      // A 3xx is an error, never followed.
      maxRedirects: 0,
      maxContentLength: NOAA_MAX_RESPONSE_BYTES,
      adapter: withRequestDeadline(),
    });

    // NWPS (National Water Prediction Service) client for river gauges
    this.nwpsClient = axios.create({
      baseURL: nwpsBaseURL,
      timeout,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json'
      },
      // A 3xx is an error, never followed.
      maxRedirects: 0,
      maxContentLength: NWPS_MAX_RESPONSE_BYTES,
      adapter: withRequestDeadline(),
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );

    this.nwpsClient.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );
  }

  /**
   * Handle API errors with retry logic and helpful status information
   */
  private async handleError(error: AxiosError): Promise<never> {
    // An oversize answer, checked *before* the `response` branch: the rejection carries no `response`
    // at all, so it would otherwise fall to the generic branch, which is retryable and forwards the raw
    // axios text. Gated on the code *and* the message, so another ERR_BAD_RESPONSE keeps today's path.
    if (error.code === 'ERR_BAD_RESPONSE' && /maxContentLength/.test(error.message ?? '')) {
      throw new ApiError(
        NOAA_TOO_LARGE_MESSAGE,
        502,
        'NOAA',
        `${NOAA_TOO_LARGE_MESSAGE}: the service answered with more data than this server accepts.`,
        ['https://weather-gov.github.io/api/reporting-issues'],
        false
      );
    }

    if (error.response) {
      const status = error.response.status;

      // A 3xx is never followed (`maxRedirects: 0`), so it is a fixed, non-retried error. It is
      // decided before any read of the body.
      if (status >= 300 && status < 400) {
        throw new ApiError(
          `NOAA returned status ${status}`,
          status,
          'NOAA',
          `NOAA returned status ${status}, a redirect this server does not follow.`,
          ['https://weather-gov.github.io/api/reporting-issues'],
          false
        );
      }

      const data = error.response.data as NOAAErrorResponse;

      // Rate limit error - suggest retry
      if (status === 429) {
        logger.warn('Rate limit exceeded', {
          service: 'NOAA',
          securityEvent: true
        });
        throw new RateLimitError('NOAA');
      }

      // 404 errors - location not found
      if (status === 404) {
        throw new DataNotFoundError(
          'NOAA',
          `${data.detail || data.title || 'Location not found'}\n\n` +
          `This location may be outside NOAA's coverage area (US only).`
        );
      }

      // Other client errors
      if (status >= 400 && status < 500) {
        logger.warn('Invalid request parameters', {
          service: 'NOAA',
          status,
          detail: data.detail || data.title,
          securityEvent: true
        });
        throw new InvalidLocationError(
          'NOAA',
          data.detail || data.title || 'Invalid request'
        );
      }

      // Server errors
      if (status >= 500) {
        throw new ServiceUnavailableError('NOAA', error);
      }
    }

    // Network errors
    if (error.code === 'ECONNABORTED') {
      throw new ServiceUnavailableError('NOAA', error);
    }

    // The shared set names "connection failed before any answer"; retry stays this service's own decision
    // (isTransientFailure), and every code in the set is retried because none is ECONNABORTED.
    if (isConnectionFailureCode(error.code)) {
      throw new ServiceUnavailableError('NOAA', error);
    }

    // Generic error
    throw new ApiError(
      `NOAA API request failed: ${error.message}`,
      500,
      'NOAA',
      `Request failed: ${error.message}`,
      ['https://weather-gov.github.io/api/reporting-issues'],
      true
    );
  }

  /**
   * Run one request attempt, retrying a transient failure (`isTransientFailure`)
   * up to `maxRetries` times with exponential backoff. The error that ends the
   * ladder propagates as the same instance — never wrapped or re-typed.
   */
  private async withRetry<T>(
    attempt: () => Promise<T>,
    maxRetries: number = this.maxRetries
  ): Promise<T> {
    for (let retries = 0; ; retries++) {
      try {
        return await attempt();
      } catch (error) {
        if (retries >= maxRetries || !isTransientFailure(error)) {
          throw error;
        }
        // Exponential backoff with jitter to prevent thundering herd
        const baseDelay = Math.pow(2, retries) * 1000;
        const delay = baseDelay * (0.5 + Math.random() * 0.5);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Make request through `withRetry`
   */
  private async makeRequest<T>(
    url: string,
    maxRetries?: number
  ): Promise<T> {
    return this.withRetry(() => this.client.get<T>(url).then(r => r.data), maxRetries);
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
   * Check whether the NOAA API answers, and how
   * Performs a lightweight health check by requesting a well-known endpoint.
   * Every HTTP status resolves (validateStatus) so the probe reads it itself; the
   * interceptor rewrites rejections, so the catch only records that no answer came.
   * @returns What the probe observed; never rejects
   */
  async checkServiceStatus(): Promise<ServiceProbeResult> {
    const statusPage = 'https://weather-gov.github.io/api/planned-outages';
    try {
      // Use a simple, well-known location (US mainland center) for health check
      const response = await this.client.get('/points/39.8283,-98.5795', {
        timeout: 10000, // Shorter timeout for health check
        validateStatus: () => true
      });

      const httpStatus = response.status;
      const outcome = classifyProbeAnswer(httpStatus, response.data);
      let message: string;
      if (outcome === 'empty_body') {
        message = 'NOAA Weather API answered HTTP 200 with an empty body';
      } else if (outcome === 'ok') {
        message = 'NOAA Weather API answered normally (HTTP 200)';
      } else if (outcome === 'rate_limited') {
        logger.warn('Rate limit exceeded', {
          service: 'NOAA',
          securityEvent: true
        });
        message = 'NOAA Weather API answered HTTP 429: it is rate limiting this caller';
      } else {
        message = `NOAA Weather API answered with HTTP ${httpStatus}`;
      }

      return {
        operational: outcome === 'ok',
        outcome,
        httpStatus,
        message,
        statusPage,
        timestamp: new Date().toISOString()
      };
    } catch {
      return {
        operational: false,
        outcome: 'no_response',
        message: 'No HTTP response from the NOAA Weather API',
        statusPage,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Convert lat/lon coordinates to NWS grid information
   * This is the first step for getting forecast or observation data
   */
  async getPointData(latitude: number, longitude: number, maxRetries?: number): Promise<PointsResponse> {
    // Validate coordinates (checks for NaN, Infinity, and range)
    validateLatitude(latitude);
    validateLongitude(longitude);

    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('points', latitude.toFixed(4), longitude.toFixed(4));
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as PointsResponse;
      }

      const url = `/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
      const result = await this.makeRequest<PointsResponse>(url, maxRetries);

      // Cache with infinite TTL (grid coordinates never change)
      this.cache.set(cacheKey, result, CacheConfig.ttl.gridCoordinates);
      return result;
    }

    const url = `/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    return this.makeRequest<PointsResponse>(url, maxRetries);
  }

  /**
   * Get forecast for a location using grid coordinates
   */
  async getForecast(office: string, gridX: number, gridY: number, units: 'us' | 'si' = 'us'): Promise<ForecastResponse> {
    const url = `/gridpoints/${office}/${gridX},${gridY}/forecast?units=${units}`;

    // Check cache first (if enabled; units in the key keeps us/si distinct)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('forecast', office, gridX, gridY, units);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as ForecastResponse;
      }

      const result = await this.makeRequest<ForecastResponse>(url);

      // Cache with forecast TTL (2 hours)
      this.cache.set(cacheKey, result, CacheConfig.ttl.forecast);
      return result;
    }

    return this.makeRequest<ForecastResponse>(url);
  }

  /**
   * Get hourly forecast for a location using grid coordinates
   */
  async getHourlyForecast(office: string, gridX: number, gridY: number, units: 'us' | 'si' = 'us'): Promise<ForecastResponse> {
    const url = `/gridpoints/${office}/${gridX},${gridY}/forecast/hourly?units=${units}`;

    // Check cache first (if enabled; units in the key keeps us/si distinct)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('hourly-forecast', office, gridX, gridY, units);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as ForecastResponse;
      }

      const result = await this.makeRequest<ForecastResponse>(url);

      // Cache with forecast TTL (2 hours) - hourly forecasts update at same rate as daily
      this.cache.set(cacheKey, result, CacheConfig.ttl.forecast);
      return result;
    }

    return this.makeRequest<ForecastResponse>(url);
  }

  /**
   * Get gridpoint data for a location using grid coordinates
   * Contains detailed forecast data including fire weather indices
   */
  async getGridpointData(office: string, gridX: number, gridY: number, maxRetries?: number): Promise<import('../types/noaa.js').GridpointResponse> {
    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('gridpoint', office, gridX, gridY);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as import('../types/noaa.js').GridpointResponse;
      }

      const url = `/gridpoints/${office}/${gridX},${gridY}`;
      const result = await this.makeRequest<import('../types/noaa.js').GridpointResponse>(url, maxRetries);

      // Cache with forecast TTL (2 hours)
      this.cache.set(cacheKey, result, CacheConfig.ttl.forecast);
      return result;
    }

    const url = `/gridpoints/${office}/${gridX},${gridY}`;
    return this.makeRequest<import('../types/noaa.js').GridpointResponse>(url, maxRetries);
  }

  /**
   * Get gridpoint data for a location using lat/lon (convenience method)
   * This combines getPointData and getGridpointData
   */
  async getGridpointDataByCoordinates(latitude: number, longitude: number, maxRetries?: number): Promise<import('../types/noaa.js').GridpointResponse> {
    const pointData = await this.getPointData(latitude, longitude, maxRetries);
    const { gridId, gridX, gridY } = pointData.properties;
    return this.getGridpointData(gridId, gridX, gridY, maxRetries);
  }

  /**
   * Get nearest observation stations for a location
   */
  async getStations(latitude: number, longitude: number, maxRetries?: number): Promise<StationCollectionResponse> {
    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('stations', latitude.toFixed(4), longitude.toFixed(4));
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as StationCollectionResponse;
      }

      const url = `/points/${latitude.toFixed(4)},${longitude.toFixed(4)}/stations`;
      const result = await this.makeRequest<StationCollectionResponse>(url, maxRetries);

      // Cache with stations TTL (24 hours - stations rarely change)
      this.cache.set(cacheKey, result, CacheConfig.ttl.stations);
      return result;
    }

    const url = `/points/${latitude.toFixed(4)},${longitude.toFixed(4)}/stations`;
    return this.makeRequest<StationCollectionResponse>(url, maxRetries);
  }

  /**
   * Get the latest observation from a station
   */
  async getLatestObservation(stationId: string): Promise<ObservationResponse> {
    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('latest-observation', stationId);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as ObservationResponse;
      }

      const url = `/stations/${stationId}/observations/latest`;
      const result = await this.makeRequest<ObservationResponse>(url);

      // Cache with current conditions TTL (15 minutes)
      this.cache.set(cacheKey, result, CacheConfig.ttl.currentConditions);
      return result;
    }

    const url = `/stations/${stationId}/observations/latest`;
    return this.makeRequest<ObservationResponse>(url);
  }

  /**
   * Get observations from a station within a time range
   */
  async getObservations(
    stationId: string,
    startTime?: Date,
    endTime?: Date,
    limit?: number
  ): Promise<ObservationCollectionResponse> {
    // Validate date range if both dates are provided
    if (startTime && endTime) {
      if (startTime > endTime) {
        throw new Error(`Invalid date range: start date (${startTime.toISOString()}) must be before end date (${endTime.toISOString()})`);
      }
    }

    // Validate dates are not in the future
    const now = new Date();
    if (startTime && startTime > now) {
      throw new Error(`Start date (${startTime.toISOString()}) cannot be in the future`);
    }
    if (endTime && endTime > now) {
      throw new Error(`End date (${endTime.toISOString()}) cannot be in the future`);
    }

    let url = `/stations/${stationId}/observations`;

    const params = new URLSearchParams();
    if (startTime) {
      params.append('start', startTime.toISOString());
    }
    if (endTime) {
      params.append('end', endTime.toISOString());
    }
    if (limit) {
      // Ensure limit is between 1 and 500
      const validLimit = Math.max(1, Math.min(limit, 500));
      params.append('limit', validLimit.toString());
    }

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('observations', stationId, startTime?.toISOString(), endTime?.toISOString(), limit);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as ObservationCollectionResponse;
      }

      const result = await this.makeRequest<ObservationCollectionResponse>(url);

      // Smart TTL from the END of the range; a query with no end is open-ended
      // to now and never final
      const ttl = endTime ? getHistoricalDataTTL(endTime) : CacheConfig.ttl.recentHistorical;
      this.cache.set(cacheKey, result, ttl);
      return result;
    }

    return this.makeRequest<ObservationCollectionResponse>(url);
  }

  /**
   * Get historical observations for a location (convenience method)
   */
  async getHistoricalObservations(
    latitude: number,
    longitude: number,
    startTime: Date,
    endTime: Date,
    limit?: number
  ): Promise<ObservationCollectionResponse> {
    // Validate date range
    if (startTime > endTime) {
      throw new Error(`Invalid date range: start date (${startTime.toISOString()}) must be before end date (${endTime.toISOString()})`);
    }

    // Validate dates are not in the future
    const now = new Date();
    if (startTime > now) {
      throw new Error(`Start date (${startTime.toISOString()}) cannot be in the future`);
    }
    if (endTime > now) {
      throw new Error(`End date (${endTime.toISOString()}) cannot be in the future`);
    }

    const stations = await this.getStations(latitude, longitude);

    if (!stations.features || stations.features.length === 0) {
      throw new Error('No weather stations found near the specified location.');
    }

    // Get observations from the nearest station
    const stationId = stations.features[0].properties.stationIdentifier;
    return this.getObservations(stationId, startTime, endTime, limit);
  }

  /**
   * Get active weather alerts for a location
   * @param latitude Latitude coordinate
   * @param longitude Longitude coordinate
   * @param activeOnly Whether to filter to only active alerts (default: true)
   * @param maxRetries Overrides the service's retry count; garnish callers pass 0
   * @returns Collection of weather alerts
   */
  async getAlerts(
    latitude: number,
    longitude: number,
    activeOnly: boolean = true,
    maxRetries?: number
  ): Promise<AlertCollectionResponse> {
    // Validate coordinates (checks for NaN, Infinity, and range)
    validateLatitude(latitude);
    validateLongitude(longitude);

    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey(
        'alerts',
        latitude.toFixed(4),
        longitude.toFixed(4),
        activeOnly ? 'active' : 'all'
      );
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as AlertCollectionResponse;
      }

      // Query alerts using point parameter
      const url = activeOnly
        ? `/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`
        : `/alerts?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`;

      const result = await this.makeRequest<AlertCollectionResponse>(url, maxRetries);

      // Cache with alerts TTL (5 minutes - alerts can change rapidly)
      this.cache.set(cacheKey, result, CacheConfig.ttl.alerts);
      return result;
    }

    // Query alerts using point parameter
    const url = activeOnly
      ? `/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`
      : `/alerts?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`;

    return this.makeRequest<AlertCollectionResponse>(url, maxRetries);
  }

  /**
   * NWPS (National Water Prediction Service) Methods for River Gauges
   */

  /**
   * Get a specific river gauge by its NWSLI identifier
   * @param lid 5-character NWSLI identifier (e.g., "LOLT2")
   * @returns River gauge data with current conditions and flood stages
   */
  async getNWPSGauge(lid: string): Promise<NWPSGauge> {
    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('nwps-gauge', lid);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as NWPSGauge;
      }

      const response = await this.nwpsClient.get<NWPSGauge>(`/gauges/${lid}`);
      const result = response.data;

      // Flood-stage thresholds and crests are gauge metadata, revised ~annually.
      this.cache.set(cacheKey, result, CacheConfig.ttl.nwpsGaugeDetail);
      return result;
    }

    const response = await this.nwpsClient.get<NWPSGauge>(`/gauges/${lid}`);
    return response.data;
  }

  /**
   * Get stage/flow time series data for a specific gauge
   * @param lid 5-character NWSLI identifier
   * @returns Time series of stage and flow data
   */
  async getNWPSStageFlow(lid: string): Promise<NWPSStageFlowResponse> {
    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('nwps-stageflow', lid);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as NWPSStageFlowResponse;
      }

      const response = await this.nwpsClient.get<NWPSStageFlowResponse>(`/gauges/${lid}/stageflow`);
      const result = response.data;

      // Per-refresh readings: the same status clock as the bounding-box list.
      this.cache.set(cacheKey, result, CacheConfig.ttl.nwpsGaugeStatus);
      return result;
    }

    const response = await this.nwpsClient.get<NWPSStageFlowResponse>(`/gauges/${lid}/stageflow`);
    return response.data;
  }

  /**
   * Get NWPS river gauges within a bounding box
   * The list carries each gauge's live observed and forecast status, so it is
   * cached on the status clock. A failure propagates with the error handleError
   * mapped; there is no fallback (the whole-catalogue pull was removed, RF-27).
   * @param west Western longitude boundary
   * @param south Southern latitude boundary
   * @param east Eastern longitude boundary
   * @param north Northern latitude boundary
   * @returns Array of gauges within the bounding box
   */
  async getNWPSGaugesInBoundingBox(
    west: number,
    south: number,
    east: number,
    north: number
  ): Promise<NWPSGauge[]> {
    // Validate bounding box
    validateLongitude(west);
    validateLongitude(east);
    validateLatitude(south);
    validateLatitude(north);

    if (west >= east) {
      throw new Error('Invalid bounding box: west longitude must be less than east longitude');
    }
    if (south >= north) {
      throw new Error('Invalid bounding box: south latitude must be less than north latitude');
    }

    // Check cache first (if enabled)
    const bboxKey = `${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}`;
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('nwps-gauges-bbox', bboxKey);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as NWPSGauge[];
      }
    }

    // NWPS API supports bounding box queries via query parameters.
    // The endpoint requires bbox.{xmin,ymin,xmax,ymax} plus an srid; without
    // them it ignores the filter and returns the entire ~13MB gauge catalog.
    const params = {
      'bbox.xmin': west.toString(),
      'bbox.ymin': south.toString(),
      'bbox.xmax': east.toString(),
      'bbox.ymax': north.toString(),
      srid: 'EPSG_4326'
    };

    const response = await this.nwpsClient.get<NWPSGaugesResponse>('/gauges', { params });
    const result = usableNWPSGauges(response.data);

    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('nwps-gauges-bbox', bboxKey);
      this.cache.set(cacheKey, result, CacheConfig.ttl.nwpsGaugeStatus);
    }

    return result;
  }
}
