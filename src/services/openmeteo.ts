/**
 * Service for interacting with the Open-Meteo Historical Weather API
 * Documentation: https://open-meteo.com/en/docs/historical-weather-api
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  OpenMeteoHistoricalResponse,
  OpenMeteoErrorResponse
} from '../types/openmeteo.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig, getHistoricalDataTTL } from '../config/cache.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import {
  RateLimitError,
  ServiceUnavailableError,
  InvalidLocationError,
  DataNotFoundError,
  ApiError
} from '../errors/ApiError.js';

export interface OpenMeteoServiceConfig {
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export class OpenMeteoService {
  private client: AxiosInstance;
  private maxRetries: number;
  private cache: Cache;

  constructor(config: OpenMeteoServiceConfig = {}) {
    const {
      baseURL = 'https://archive-api.open-meteo.com/v1',
      timeout = 30000,
      maxRetries = 3
    } = config;

    this.maxRetries = maxRetries;
    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'weather-mcp/0.1.0'
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );
  }

  /**
   * Handle API errors with helpful status information
   */
  private async handleError(error: AxiosError): Promise<never> {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as OpenMeteoErrorResponse;

      // Bad request
      if (status === 400) {
        const reason = data.reason || 'Invalid request parameters';
        throw new InvalidLocationError(
          'OpenMeteo',
          `${reason}\n\nPlease verify:\n` +
          `- Coordinates are valid (latitude: -90 to 90, longitude: -180 to 180)\n` +
          `- Date range is valid (1940 to 5 days ago)\n` +
          `- Parameters are correctly formatted`
        );
      }

      // Rate limit error
      if (status === 429) {
        throw new RateLimitError('OpenMeteo');
      }

      // Server errors
      if (status >= 500) {
        throw new ServiceUnavailableError('OpenMeteo', error);
      }

      // Other errors
      throw new ApiError(
        `Open-Meteo API error (${status})`,
        status,
        'OpenMeteo',
        data.reason || 'Request failed',
        [
          'https://open-meteo.com/en/docs',
          'https://github.com/open-meteo/open-meteo/issues'
        ]
      );
    }

    // Network errors
    if (error.code === 'ECONNABORTED') {
      throw new ServiceUnavailableError('OpenMeteo', error);
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new ServiceUnavailableError('OpenMeteo', error);
    }

    // Generic error
    throw new ApiError(
      `Open-Meteo API request failed: ${error.message}`,
      500,
      'OpenMeteo',
      `Request failed: ${error.message}`,
      [
        'https://github.com/open-meteo/open-meteo/issues',
        'https://open-meteo.com/en/docs'
      ],
      true
    );
  }

  /**
   * Make request with retry logic
   */
  private async makeRequest<T>(
    url: string,
    params: Record<string, string | number>,
    retries = 0
  ): Promise<T> {
    try {
      const response = await this.client.get<T>(url, { params });
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
          return this.makeRequest<T>(url, params, retries + 1);
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
   * Check if the Open-Meteo API is operational
   * Performs a lightweight health check by requesting a simple query
   * @returns Object with status information
   */
  async checkServiceStatus(): Promise<{
    operational: boolean;
    message: string;
    statusPage: string;
    timestamp: string;
  }> {
    try {
      // Use a simple request for a recent date at a known location (London, UK)
      // Using a 1-day range from 30 days ago to avoid the 5-day delay issue
      const testDate = new Date();
      testDate.setDate(testDate.getDate() - 30);
      const dateStr = testDate.toISOString().split('T')[0];

      const response = await this.client.get('/archive', {
        params: {
          latitude: 51.5074,
          longitude: -0.1278,
          start_date: dateStr,
          end_date: dateStr,
          daily: 'temperature_2m_max',
          timezone: 'UTC'
        },
        timeout: 10000 // Shorter timeout for health check
      });

      if (response.status === 200 && response.data) {
        return {
          operational: true,
          message: 'Open-Meteo API is operational',
          statusPage: 'https://open-meteo.com/en/docs/model-updates',
          timestamp: new Date().toISOString()
        };
      }

      return {
        operational: false,
        message: `Open-Meteo API returned unexpected status: ${response.status}`,
        statusPage: 'https://open-meteo.com/en/docs/model-updates',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      let message = 'Open-Meteo API may be experiencing issues';
      let operational = false;

      if (axiosError.response) {
        const status = axiosError.response.status;
        if (status === 429) {
          operational = true; // API is up, just rate limited
          message = 'Open-Meteo API is operational but rate limited';
        } else if (status >= 500) {
          message = 'Open-Meteo API is experiencing server errors (possible outage)';
        } else if (status === 400) {
          operational = true; // Bad request might indicate API is up but our test is wrong
          message = 'Open-Meteo API is responding (health check may need adjustment)';
        }
      } else if (axiosError.code === 'ECONNABORTED') {
        message = 'Open-Meteo API is not responding (timeout)';
      } else if (axiosError.code === 'ENOTFOUND' || axiosError.code === 'ECONNREFUSED') {
        message = 'Cannot connect to Open-Meteo API (DNS or connection failure)';
      }

      return {
        operational,
        message,
        statusPage: 'https://open-meteo.com/en/docs/model-updates',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get historical weather data for a location
   *
   * @param latitude - Latitude coordinate (-90 to 90)
   * @param longitude - Longitude coordinate (-180 to 180)
   * @param startDate - Start date in ISO format (YYYY-MM-DD)
   * @param endDate - End date in ISO format (YYYY-MM-DD)
   * @param useHourly - Whether to request hourly data (default: true)
   * @returns Historical weather data
   */
  async getHistoricalWeather(
    latitude: number,
    longitude: number,
    startDate: string,
    endDate: string,
    useHourly: boolean = true
  ): Promise<OpenMeteoHistoricalResponse> {
    // Validate coordinates (checks for NaN, Infinity, and range)
    validateLatitude(latitude);
    validateLongitude(longitude);

    // Build parameters once
    const params = this.buildHistoricalParams(latitude, longitude, startDate, endDate, useHourly);

    // Check cache first (if enabled)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('openmeteo-historical', latitude, longitude, startDate, endDate, useHourly);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as OpenMeteoHistoricalResponse;
      }

      const response = await this.makeRequest<OpenMeteoHistoricalResponse>('/archive', params);
      this.validateResponse(response, startDate, endDate, useHourly);

      // Use smart TTL based on date range
      const ttl = getHistoricalDataTTL(startDate);
      this.cache.set(cacheKey, response, ttl);

      return response;
    }

    // No caching
    const response = await this.makeRequest<OpenMeteoHistoricalResponse>('/archive', params);
    this.validateResponse(response, startDate, endDate, useHourly);
    return response;
  }

  /**
   * Build request parameters for historical weather data
   * @private
   */
  private buildHistoricalParams(
    latitude: number,
    longitude: number,
    startDate: string,
    endDate: string,
    useHourly: boolean
  ): Record<string, string | number> {
    const params: Record<string, string | number> = {
      latitude,
      longitude,
      start_date: startDate,
      end_date: endDate,
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
      timezone: 'auto'
    };

    // Request appropriate data granularity
    if (useHourly) {
      // Hourly data for detailed observations
      params.hourly = [
        'temperature_2m',
        'relative_humidity_2m',
        'dewpoint_2m',
        'apparent_temperature',
        'precipitation',
        'rain',
        'snowfall',
        'weather_code',
        'pressure_msl',
        'cloud_cover',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m'
      ].join(',');
    } else {
      // Daily summaries for longer time periods
      params.daily = [
        'temperature_2m_max',
        'temperature_2m_min',
        'temperature_2m_mean',
        'apparent_temperature_max',
        'apparent_temperature_min',
        'precipitation_sum',
        'rain_sum',
        'snowfall_sum',
        'precipitation_hours',
        'weather_code',
        'wind_speed_10m_max',
        'wind_gusts_10m_max',
        'wind_direction_10m_dominant'
      ].join(',');
    }

    return params;
  }

  /**
   * Validate that the response contains the expected data
   * @private
   */
  private validateResponse(
    response: OpenMeteoHistoricalResponse,
    startDate: string,
    endDate: string,
    useHourly: boolean
  ): void {
    if (useHourly && (!response.hourly || !response.hourly.time || response.hourly.time.length === 0)) {
      throw new Error(
        `No historical weather data available for the specified date range (${startDate} to ${endDate}).\n\n` +
        'This may occur because:\n' +
        '- The dates are too recent (data has a 5-day delay for most models)\n' +
        '- The dates are before 1940 (earliest available data)\n\n' +
        'Please try adjusting your date range.'
      );
    }

    if (!useHourly && (!response.daily || !response.daily.time || response.daily.time.length === 0)) {
      throw new Error(
        `No historical weather data available for the specified date range (${startDate} to ${endDate}).\n\n` +
        'Please try adjusting your date range.'
      );
    }
  }

  /**
   * Get weather description from WMO weather code
   * WMO Weather interpretation codes (WW): https://open-meteo.com/en/docs
   */
  getWeatherDescription(code: number): string {
    const weatherCodes: { [key: number]: string } = {
      0: 'Clear sky',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Foggy',
      48: 'Depositing rime fog',
      51: 'Light drizzle',
      53: 'Moderate drizzle',
      55: 'Dense drizzle',
      56: 'Light freezing drizzle',
      57: 'Dense freezing drizzle',
      61: 'Slight rain',
      63: 'Moderate rain',
      65: 'Heavy rain',
      66: 'Light freezing rain',
      67: 'Heavy freezing rain',
      71: 'Slight snow',
      73: 'Moderate snow',
      75: 'Heavy snow',
      77: 'Snow grains',
      80: 'Slight rain showers',
      81: 'Moderate rain showers',
      82: 'Violent rain showers',
      85: 'Slight snow showers',
      86: 'Heavy snow showers',
      95: 'Thunderstorm',
      96: 'Thunderstorm with slight hail',
      99: 'Thunderstorm with heavy hail'
    };

    return weatherCodes[code] || `Unknown (code: ${code})`;
  }
}
