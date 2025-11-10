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
  NWPSStageFlowResponse,
  USGSIVResponse
} from '../types/noaa.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig, getHistoricalDataTTL } from '../config/cache.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { logger } from '../utils/logger.js';
import {
  RateLimitError,
  ServiceUnavailableError,
  InvalidLocationError,
  DataNotFoundError,
  ApiError
} from '../errors/ApiError.js';

export interface NOAAServiceConfig {
  userAgent?: string;
  baseURL?: string;
  nwpsBaseURL?: string;
  usgsBaseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export class NOAAService {
  private client: AxiosInstance;
  private nwpsClient: AxiosInstance; // For NOAA water/river data
  private usgsClient: AxiosInstance; // For USGS streamflow data
  private maxRetries: number;
  private cache: Cache;

  constructor(config: NOAAServiceConfig = {}) {
    const {
      userAgent = '(weather-mcp, contact@example.com)',
      baseURL = 'https://api.weather.gov',
      nwpsBaseURL = 'https://api.water.noaa.gov/nwps/v1',
      usgsBaseURL = 'https://waterservices.usgs.gov',
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
      }
    });

    // NWPS (National Water Prediction Service) client for river gauges
    this.nwpsClient = axios.create({
      baseURL: nwpsBaseURL,
      timeout,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json'
      }
    });

    // USGS Water Services client for streamflow data
    this.usgsClient = axios.create({
      baseURL: usgsBaseURL,
      timeout,
      headers: {
        'User-Agent': userAgent
      }
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

    this.usgsClient.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );
  }

  /**
   * Handle API errors with retry logic and helpful status information
   */
  private async handleError(error: AxiosError): Promise<never> {
    if (error.response) {
      const status = error.response.status;
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

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
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
   * Make request with retry logic
   */
  private async makeRequest<T>(
    url: string,
    retries = 0
  ): Promise<T> {
    try {
      const response = await this.client.get<T>(url);
      return response.data;
    } catch (error) {
      // Retry on rate limit or server errors
      if (retries < this.maxRetries) {
        const shouldRetry =
          (error as Error).message.includes('rate limit') ||
          (error as Error).message.includes('server error') ||
          (error as Error).message.includes('timed out');

        if (shouldRetry) {
          // Exponential backoff with jitter to prevent thundering herd
          const baseDelay = Math.pow(2, retries) * 1000;
          const delay = baseDelay * (0.5 + Math.random() * 0.5);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.makeRequest<T>(url, retries + 1);
        }
      }
      throw error;
    }
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
   * Check if the NOAA API is operational
   * Performs a lightweight health check by requesting a well-known endpoint
   * @returns Object with status information
   */
  async checkServiceStatus(): Promise<{
    operational: boolean;
    message: string;
    statusPage: string;
    timestamp: string;
  }> {
    try {
      // Use a simple, well-known location (US mainland center) for health check
      const response = await this.client.get('/points/39.8283,-98.5795', {
        timeout: 10000 // Shorter timeout for health check
      });

      if (response.status === 200) {
        return {
          operational: true,
          message: 'NOAA Weather API is operational',
          statusPage: 'https://weather-gov.github.io/api/planned-outages',
          timestamp: new Date().toISOString()
        };
      }

      return {
        operational: false,
        message: `NOAA API returned unexpected status: ${response.status}`,
        statusPage: 'https://weather-gov.github.io/api/planned-outages',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      let message = 'NOAA Weather API may be experiencing issues';
      let operational = false;

      if (axiosError.response) {
        const status = axiosError.response.status;
        if (status === 429) {
          operational = true; // API is up, just rate limited
          message = 'NOAA API is operational but rate limited';
        } else if (status >= 500) {
          message = 'NOAA API is experiencing server errors (possible outage)';
        } else if (status === 404) {
          operational = true; // 404 on this endpoint might just mean API change
          message = 'NOAA API is responding (health check endpoint may have changed)';
        }
      } else if (axiosError.code === 'ECONNABORTED') {
        message = 'NOAA API is not responding (timeout)';
      } else if (axiosError.code === 'ENOTFOUND' || axiosError.code === 'ECONNREFUSED') {
        message = 'Cannot connect to NOAA API (DNS or connection failure)';
      }

      return {
        operational,
        message,
        statusPage: 'https://weather-gov.github.io/api/planned-outages',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Convert lat/lon coordinates to NWS grid information
   * This is the first step for getting forecast or observation data
   */
  async getPointData(latitude: number, longitude: number): Promise<PointsResponse> {
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
      const result = await this.makeRequest<PointsResponse>(url);

      // Cache with infinite TTL (grid coordinates never change)
      this.cache.set(cacheKey, result, CacheConfig.ttl.gridCoordinates);
      return result;
    }

    const url = `/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    return this.makeRequest<PointsResponse>(url);
  }

  /**
   * Get forecast for a location using grid coordinates
   */
  async getForecast(office: string, gridX: number, gridY: number): Promise<ForecastResponse> {
    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('forecast', office, gridX, gridY);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as ForecastResponse;
      }

      const url = `/gridpoints/${office}/${gridX},${gridY}/forecast`;
      const result = await this.makeRequest<ForecastResponse>(url);

      // Cache with forecast TTL (2 hours)
      this.cache.set(cacheKey, result, CacheConfig.ttl.forecast);
      return result;
    }

    const url = `/gridpoints/${office}/${gridX},${gridY}/forecast`;
    return this.makeRequest<ForecastResponse>(url);
  }

  /**
   * Get hourly forecast for a location using grid coordinates
   */
  async getHourlyForecast(office: string, gridX: number, gridY: number): Promise<ForecastResponse> {
    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('hourly-forecast', office, gridX, gridY);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as ForecastResponse;
      }

      const url = `/gridpoints/${office}/${gridX},${gridY}/forecast/hourly`;
      const result = await this.makeRequest<ForecastResponse>(url);

      // Cache with forecast TTL (2 hours) - hourly forecasts update at same rate as daily
      this.cache.set(cacheKey, result, CacheConfig.ttl.forecast);
      return result;
    }

    const url = `/gridpoints/${office}/${gridX},${gridY}/forecast/hourly`;
    return this.makeRequest<ForecastResponse>(url);
  }

  /**
   * Get forecast for a location using lat/lon (convenience method)
   * This combines getPointData and getForecast
   */
  async getForecastByCoordinates(latitude: number, longitude: number): Promise<ForecastResponse> {
    const pointData = await this.getPointData(latitude, longitude);
    const { gridId, gridX, gridY } = pointData.properties;
    return this.getForecast(gridId, gridX, gridY);
  }

  /**
   * Get hourly forecast for a location using lat/lon (convenience method)
   * This combines getPointData and getHourlyForecast
   */
  async getHourlyForecastByCoordinates(latitude: number, longitude: number): Promise<ForecastResponse> {
    const pointData = await this.getPointData(latitude, longitude);
    const { gridId, gridX, gridY } = pointData.properties;
    return this.getHourlyForecast(gridId, gridX, gridY);
  }

  /**
   * Get gridpoint data for a location using grid coordinates
   * Contains detailed forecast data including fire weather indices
   */
  async getGridpointData(office: string, gridX: number, gridY: number): Promise<import('../types/noaa.js').GridpointResponse> {
    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('gridpoint', office, gridX, gridY);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as import('../types/noaa.js').GridpointResponse;
      }

      const url = `/gridpoints/${office}/${gridX},${gridY}`;
      const result = await this.makeRequest<import('../types/noaa.js').GridpointResponse>(url);

      // Cache with forecast TTL (2 hours)
      this.cache.set(cacheKey, result, CacheConfig.ttl.forecast);
      return result;
    }

    const url = `/gridpoints/${office}/${gridX},${gridY}`;
    return this.makeRequest<import('../types/noaa.js').GridpointResponse>(url);
  }

  /**
   * Get gridpoint data for a location using lat/lon (convenience method)
   * This combines getPointData and getGridpointData
   */
  async getGridpointDataByCoordinates(latitude: number, longitude: number): Promise<import('../types/noaa.js').GridpointResponse> {
    const pointData = await this.getPointData(latitude, longitude);
    const { gridId, gridX, gridY } = pointData.properties;
    return this.getGridpointData(gridId, gridX, gridY);
  }

  /**
   * Get nearest observation stations for a location
   */
  async getStations(latitude: number, longitude: number): Promise<StationCollectionResponse> {
    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('stations', latitude.toFixed(4), longitude.toFixed(4));
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as StationCollectionResponse;
      }

      const url = `/points/${latitude.toFixed(4)},${longitude.toFixed(4)}/stations`;
      const result = await this.makeRequest<StationCollectionResponse>(url);

      // Cache with stations TTL (24 hours - stations rarely change)
      this.cache.set(cacheKey, result, CacheConfig.ttl.stations);
      return result;
    }

    const url = `/points/${latitude.toFixed(4)},${longitude.toFixed(4)}/stations`;
    return this.makeRequest<StationCollectionResponse>(url);
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

      // Use smart TTL based on date range
      const ttl = startTime ? getHistoricalDataTTL(startTime) : CacheConfig.ttl.recentHistorical;
      this.cache.set(cacheKey, result, ttl);
      return result;
    }

    return this.makeRequest<ObservationCollectionResponse>(url);
  }

  /**
   * Get current conditions for a location (convenience method)
   * This combines getStations and getLatestObservation
   */
  async getCurrentConditions(latitude: number, longitude: number): Promise<ObservationResponse> {
    const stations = await this.getStations(latitude, longitude);

    if (!stations.features || stations.features.length === 0) {
      throw new Error('No weather stations found near the specified location.');
    }

    // Try the first station, fallback to others if it fails
    for (const station of stations.features) {
      try {
        const stationId = station.properties.stationIdentifier;
        return await this.getLatestObservation(stationId);
      } catch (error) {
        // Try next station
        continue;
      }
    }

    throw new Error('Unable to retrieve current conditions from nearby stations.');
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
   * @returns Collection of weather alerts
   */
  async getAlerts(
    latitude: number,
    longitude: number,
    activeOnly: boolean = true
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

      const result = await this.makeRequest<AlertCollectionResponse>(url);

      // Cache with alerts TTL (5 minutes - alerts can change rapidly)
      this.cache.set(cacheKey, result, CacheConfig.ttl.alerts);
      return result;
    }

    // Query alerts using point parameter
    const url = activeOnly
      ? `/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`
      : `/alerts?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`;

    return this.makeRequest<AlertCollectionResponse>(url);
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

      // Cache for 1 hour (river conditions update hourly)
      this.cache.set(cacheKey, result, 3600000);
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

      // Cache for 30 minutes (frequently updated)
      this.cache.set(cacheKey, result, 1800000);
      return result;
    }

    const response = await this.nwpsClient.get<NWPSStageFlowResponse>(`/gauges/${lid}/stageflow`);
    return response.data;
  }

  /**
   * Get all NWPS gauges (warning: large response, should be filtered)
   * Note: This endpoint returns all gauges across the US. Consider using
   * geographic filtering or querying by specific gauge IDs instead.
   * @returns Array of all river gauges
   * @deprecated Use getNWPSGaugesInBoundingBox instead to avoid downloading entire catalog
   */
  async getAllNWPSGauges(): Promise<NWPSGauge[]> {
    // Check cache first (if enabled) - cache for 24 hours (gauges rarely change)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('nwps-all-gauges');
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as NWPSGauge[];
      }

      const response = await this.nwpsClient.get<NWPSGauge[]>('/gauges');
      const result = response.data;

      // Cache for 24 hours (gauge locations don't change often)
      this.cache.set(cacheKey, result, 86400000);
      return result;
    }

    const response = await this.nwpsClient.get<NWPSGauge[]>('/gauges');
    return response.data;
  }

  /**
   * Get NWPS river gauges within a bounding box
   * More efficient than getAllNWPSGauges() for location-specific queries
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

    // NWPS API supports bounding box queries via query parameters
    const params = {
      west: west.toString(),
      south: south.toString(),
      east: east.toString(),
      north: north.toString()
    };

    try {
      const response = await this.nwpsClient.get<NWPSGauge[]>('/gauges', { params });
      const result = response.data;

      // Cache for 24 hours
      if (CacheConfig.enabled) {
        const cacheKey = Cache.generateKey('nwps-gauges-bbox', bboxKey);
        this.cache.set(cacheKey, result, 86400000);
      }

      return result;
    } catch (error) {
      // If bounding box query fails, fall back to client-side filtering
      // This provides compatibility if the API doesn't support bbox queries
      logger.warn('NWPS bounding box query failed, falling back to client-side filtering', {
        error: error instanceof Error ? error.message : String(error)
      });

      const allGauges = await this.getAllNWPSGauges();
      const filtered = allGauges.filter(gauge =>
        gauge.longitude >= west &&
        gauge.longitude <= east &&
        gauge.latitude >= south &&
        gauge.latitude <= north
      );

      // Cache the filtered result
      if (CacheConfig.enabled) {
        const cacheKey = Cache.generateKey('nwps-gauges-bbox', bboxKey);
        this.cache.set(cacheKey, filtered, 86400000);
      }

      return filtered;
    }
  }

  /**
   * USGS Water Services Methods for Streamflow Data
   */

  /**
   * Get real-time streamflow data for sites within a bounding box
   * @param west Western longitude boundary
   * @param south Southern latitude boundary
   * @param east Eastern longitude boundary
   * @param north Northern latitude boundary
   * @returns USGS instantaneous values response with streamflow data
   */
  async getUSGSStreamflow(
    west: number,
    south: number,
    east: number,
    north: number
  ): Promise<USGSIVResponse> {
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

    // USGS API limits: product of lat/lon range cannot exceed 25 degrees
    const latRange = north - south;
    const lonRange = east - west;
    if (latRange * lonRange > 25) {
      throw new Error('Bounding box too large: product of latitude and longitude ranges cannot exceed 25 degrees');
    }

    // Check cache first (if enabled)
    const bboxKey = `${west},${south},${east},${north}`;
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('usgs-streamflow', bboxKey);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as USGSIVResponse;
      }

      const url = `/nwis/iv/?format=json&bBox=${bboxKey}&parameterCd=00060&siteStatus=active`;
      const response = await this.usgsClient.get<USGSIVResponse>(url);
      const result = response.data;

      // Cache for 15 minutes (current data)
      this.cache.set(cacheKey, result, 900000);
      return result;
    }

    const url = `/nwis/iv/?format=json&bBox=${bboxKey}&parameterCd=00060&siteStatus=active`;
    const response = await this.usgsClient.get<USGSIVResponse>(url);
    return response.data;
  }

  /**
   * Get real-time streamflow data for a specific USGS site
   * @param siteNumber USGS site number (e.g., "01646500")
   * @returns USGS instantaneous values response with streamflow data
   */
  async getUSGSStreamflowForSite(siteNumber: string): Promise<USGSIVResponse> {
    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('usgs-site-streamflow', siteNumber);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as USGSIVResponse;
      }

      const url = `/nwis/iv/?format=json&sites=${siteNumber}&parameterCd=00060&siteStatus=active`;
      const response = await this.usgsClient.get<USGSIVResponse>(url);
      const result = response.data;

      // Cache for 15 minutes (current data)
      this.cache.set(cacheKey, result, 900000);
      return result;
    }

    const url = `/nwis/iv/?format=json&sites=${siteNumber}&parameterCd=00060&siteStatus=active`;
    const response = await this.usgsClient.get<USGSIVResponse>(url);
    return response.data;
  }
}
