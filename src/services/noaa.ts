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
  NOAAErrorResponse
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
  timeout?: number;
  maxRetries?: number;
}

export class NOAAService {
  private client: AxiosInstance;
  private maxRetries: number;
  private cache: Cache;

  constructor(config: NOAAServiceConfig = {}) {
    const {
      userAgent = '(weather-mcp, contact@example.com)',
      baseURL = 'https://api.weather.gov',
      timeout = CacheConfig.apiTimeoutMs,
      maxRetries = 3
    } = config;

    this.maxRetries = maxRetries;
    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/geo+json'
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
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
}
