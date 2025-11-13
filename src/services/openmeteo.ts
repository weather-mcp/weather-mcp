/**
 * Service for interacting with the Open-Meteo APIs
 * Documentation:
 * - Historical Weather: https://open-meteo.com/en/docs/historical-weather-api
 * - Forecast: https://open-meteo.com/en/docs
 * - Geocoding: https://open-meteo.com/en/docs/geocoding-api
 * - Air Quality: https://open-meteo.com/en/docs/air-quality-api
 * - Marine: https://open-meteo.com/en/docs/marine-weather-api
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  OpenMeteoHistoricalResponse,
  OpenMeteoErrorResponse,
  GeocodingResponse,
  OpenMeteoForecastResponse,
  OpenMeteoAirQualityResponse,
  OpenMeteoMarineResponse,
  ClimateNormals
} from '../types/openmeteo.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig, getHistoricalDataTTL } from '../config/cache.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { computeNormalsFrom30YearData, getNormalsCacheKey } from '../utils/normals.js';
import { getUserAgent } from '../utils/version.js';
import {
  RateLimitError,
  ServiceUnavailableError,
  InvalidLocationError,
  DataNotFoundError,
  ApiError
} from '../errors/ApiError.js';

export interface OpenMeteoServiceConfig {
  baseURL?: string;
  geocodingURL?: string;
  forecastURL?: string;
  airQualityURL?: string;
  marineURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export class OpenMeteoService {
  private client: AxiosInstance;
  private geocodingClient: AxiosInstance;
  private forecastClient: AxiosInstance;
  private airQualityClient: AxiosInstance;
  private marineClient: AxiosInstance;
  private maxRetries: number;
  private cache: Cache;

  constructor(config: OpenMeteoServiceConfig = {}) {
    const {
      baseURL = 'https://archive-api.open-meteo.com/v1',
      geocodingURL = 'https://geocoding-api.open-meteo.com/v1',
      forecastURL = 'https://api.open-meteo.com/v1',
      airQualityURL = 'https://air-quality-api.open-meteo.com/v1',
      marineURL = 'https://marine-api.open-meteo.com/v1',
      timeout = CacheConfig.apiTimeoutMs,
      maxRetries = 3
    } = config;

    this.maxRetries = maxRetries;
    this.cache = new Cache(CacheConfig.maxSize);

    // Historical weather client
    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      }
    });

    // Geocoding client
    this.geocodingClient = axios.create({
      baseURL: geocodingURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      }
    });

    // Forecast client
    this.forecastClient = axios.create({
      baseURL: forecastURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      }
    });

    // Air quality client
    this.airQualityClient = axios.create({
      baseURL: airQualityURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      }
    });

    // Marine client
    this.marineClient = axios.create({
      baseURL: marineURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );

    this.geocodingClient.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );

    this.forecastClient.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );

    this.airQualityClient.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );

    this.marineClient.interceptors.response.use(
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
        logger.warn('Invalid request parameters', {
          service: 'OpenMeteo',
          reason,
          securityEvent: true
        });
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
        logger.warn('Rate limit exceeded', {
          service: 'OpenMeteo',
          securityEvent: true
        });
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

  /**
   * Search for locations by name using the Open-Meteo Geocoding API
   *
   * @param query - Location name to search for (e.g., "Paris", "New York, NY", "Tokyo")
   * @param limit - Maximum number of results to return (default: 5, max: 100)
   * @param language - Language for results (default: 'en')
   * @returns Geocoding results with coordinates and metadata
   */
  async searchLocation(
    query: string,
    limit: number = 5,
    language: string = 'en'
  ): Promise<GeocodingResponse> {
    if (!query || query.trim().length === 0) {
      throw new InvalidLocationError(
        'OpenMeteo',
        'Search query cannot be empty'
      );
    }

    if (query.trim().length === 1) {
      throw new InvalidLocationError(
        'OpenMeteo',
        'Search query must be at least 2 characters long'
      );
    }

    // Validate limit
    if (limit < 1 || limit > 100) {
      throw new InvalidLocationError(
        'OpenMeteo',
        'Limit must be between 1 and 100'
      );
    }

    // Check cache first (locations don't move, so cache indefinitely)
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('openmeteo-geocoding', query, limit, language);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as GeocodingResponse;
      }

      const params = {
        name: query.trim(),
        count: limit,
        language,
        format: 'json'
      };

      const response = await this.geocodingClient.get<GeocodingResponse>('/search', { params });

      // Cache indefinitely (locations don't change)
      // Using 30 days as TTL to keep cache from growing unbounded
      this.cache.set(cacheKey, response.data, 30 * 24 * 60 * 60 * 1000);

      return response.data;
    }

    // No caching
    const params = {
      name: query.trim(),
      count: limit,
      language,
      format: 'json'
    };

    const response = await this.geocodingClient.get<GeocodingResponse>('/search', { params });
    return response.data;
  }

  /**
   * Get weather forecast from Open-Meteo Forecast API
   *
   * @param latitude - Latitude coordinate (-90 to 90)
   * @param longitude - Longitude coordinate (-180 to 180)
   * @param days - Number of forecast days (1-16, default: 7)
   * @param hourly - Whether to include hourly data (default: false)
   * @returns Weather forecast data
   */
  async getForecast(
    latitude: number,
    longitude: number,
    days: number = 7,
    hourly: boolean = false
  ): Promise<OpenMeteoForecastResponse> {
    // Validate coordinates
    validateLatitude(latitude);
    validateLongitude(longitude);

    // Validate days
    if (days < 1 || days > 16) {
      throw new InvalidLocationError(
        'OpenMeteo',
        'Forecast days must be between 1 and 16'
      );
    }

    // Build parameters
    const params = this.buildForecastParams(latitude, longitude, days, hourly);

    // Check cache first
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('openmeteo-forecast', latitude, longitude, days, hourly);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as OpenMeteoForecastResponse;
      }

      const response = await this.makeRequestToForecast<OpenMeteoForecastResponse>('/forecast', params);
      this.validateForecastResponse(response, hourly);

      // Cache for 2 hours (forecasts update regularly)
      this.cache.set(cacheKey, response, 2 * 60 * 60 * 1000);

      return response;
    }

    // No caching
    const response = await this.makeRequestToForecast<OpenMeteoForecastResponse>('/forecast', params);
    this.validateForecastResponse(response, hourly);
    return response;
  }

  /**
   * Build request parameters for forecast data
   * @private
   */
  private buildForecastParams(
    latitude: number,
    longitude: number,
    days: number,
    hourly: boolean
  ): Record<string, string | number> {
    const params: Record<string, string | number> = {
      latitude,
      longitude,
      forecast_days: days,
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
      timezone: 'auto'
    };

    // Always include daily data with sunrise/sunset
    params.daily = [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'apparent_temperature_max',
      'apparent_temperature_min',
      'sunrise',
      'sunset',
      'daylight_duration',
      'sunshine_duration',
      'uv_index_max',
      'precipitation_sum',
      'rain_sum',
      'showers_sum',
      'snowfall_sum',
      'precipitation_hours',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'wind_direction_10m_dominant'
    ].join(',');

    // Optionally include hourly data
    if (hourly) {
      params.hourly = [
        'temperature_2m',
        'relative_humidity_2m',
        'dewpoint_2m',
        'apparent_temperature',
        'precipitation_probability',
        'precipitation',
        'rain',
        'showers',
        'snowfall',
        'snow_depth',
        'weather_code',
        'pressure_msl',
        'cloud_cover',
        'visibility',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m',
        'uv_index',
        'is_day'
      ].join(',');
    }

    return params;
  }

  /**
   * Make request to forecast API with retry logic
   * @private
   */
  private async makeRequestToForecast<T>(
    url: string,
    params: Record<string, string | number>,
    retries = 0
  ): Promise<T> {
    try {
      const response = await this.forecastClient.get<T>(url, { params });
      return response.data;
    } catch (error) {
      // Retry on rate limit or server errors
      if (retries < this.maxRetries) {
        const shouldRetry =
          (error as Error).message.includes('rate limit') ||
          (error as Error).message.includes('server error') ||
          (error as Error).message.includes('timed out');

        if (shouldRetry) {
          const baseDelay = Math.pow(2, retries) * 1000;
          const delay = baseDelay * (0.5 + Math.random() * 0.5);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.makeRequestToForecast<T>(url, params, retries + 1);
        }
      }
      throw error;
    }
  }

  /**
   * Validate that the forecast response contains the expected data
   * @private
   */
  private validateForecastResponse(
    response: OpenMeteoForecastResponse,
    hourly: boolean
  ): void {
    if (hourly && (!response.hourly || !response.hourly.time || response.hourly.time.length === 0)) {
      throw new DataNotFoundError(
        'OpenMeteo',
        'No hourly forecast data available for the specified location'
      );
    }

    if (!response.daily || !response.daily.time || response.daily.time.length === 0) {
      throw new DataNotFoundError(
        'OpenMeteo',
        'No daily forecast data available for the specified location'
      );
    }
  }

  /**
   * Get air quality data from Open-Meteo Air Quality API
   *
   * @param latitude - Latitude coordinate (-90 to 90)
   * @param longitude - Longitude coordinate (-180 to 180)
   * @param forecast - Whether to include hourly forecast (default: false, returns current only)
   * @param forecastDays - Number of forecast days (1-7, default: 5)
   * @returns Air quality data including AQI, pollutants, and UV index
   */
  async getAirQuality(
    latitude: number,
    longitude: number,
    forecast: boolean = false,
    forecastDays: number = 5
  ): Promise<OpenMeteoAirQualityResponse> {
    // Validate coordinates
    validateLatitude(latitude);
    validateLongitude(longitude);

    // Validate forecast days
    if (forecastDays < 1 || forecastDays > 7) {
      throw new InvalidLocationError(
        'OpenMeteo',
        'Air quality forecast days must be between 1 and 7'
      );
    }

    // Build parameters
    const params = this.buildAirQualityParams(latitude, longitude, forecast, forecastDays);

    // Check cache first
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('openmeteo-airquality', latitude, longitude, forecast, forecastDays);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as OpenMeteoAirQualityResponse;
      }

      const response = await this.makeRequestToAirQuality<OpenMeteoAirQualityResponse>('/air-quality', params);
      this.validateAirQualityResponse(response, forecast);

      // Cache for 1 hour (air quality updates hourly)
      this.cache.set(cacheKey, response, 60 * 60 * 1000);

      return response;
    }

    // No caching
    const response = await this.makeRequestToAirQuality<OpenMeteoAirQualityResponse>('/air-quality', params);
    this.validateAirQualityResponse(response, forecast);
    return response;
  }

  /**
   * Build request parameters for air quality data
   * @private
   */
  private buildAirQualityParams(
    latitude: number,
    longitude: number,
    forecast: boolean,
    forecastDays: number
  ): Record<string, string | number> {
    const params: Record<string, string | number> = {
      latitude,
      longitude,
      timezone: 'auto'
    };

    // Always include current data
    params.current = [
      'pm10',
      'pm2_5',
      'carbon_monoxide',
      'nitrogen_dioxide',
      'sulphur_dioxide',
      'ozone',
      'aerosol_optical_depth',
      'dust',
      'uv_index',
      'uv_index_clear_sky',
      'ammonia',
      'european_aqi',
      'european_aqi_pm2_5',
      'european_aqi_pm10',
      'european_aqi_nitrogen_dioxide',
      'european_aqi_ozone',
      'european_aqi_sulphur_dioxide',
      'us_aqi',
      'us_aqi_pm2_5',
      'us_aqi_pm10',
      'us_aqi_nitrogen_dioxide',
      'us_aqi_ozone',
      'us_aqi_sulphur_dioxide',
      'us_aqi_carbon_monoxide'
    ].join(',');

    // Optionally include hourly forecast data
    if (forecast) {
      params.forecast_days = forecastDays;
      params.hourly = [
        'pm10',
        'pm2_5',
        'carbon_monoxide',
        'nitrogen_dioxide',
        'sulphur_dioxide',
        'ozone',
        'aerosol_optical_depth',
        'dust',
        'uv_index',
        'uv_index_clear_sky',
        'ammonia',
        'european_aqi',
        'european_aqi_pm2_5',
        'european_aqi_pm10',
        'european_aqi_nitrogen_dioxide',
        'european_aqi_ozone',
        'european_aqi_sulphur_dioxide',
        'us_aqi',
        'us_aqi_pm2_5',
        'us_aqi_pm10',
        'us_aqi_nitrogen_dioxide',
        'us_aqi_ozone',
        'us_aqi_sulphur_dioxide',
        'us_aqi_carbon_monoxide'
      ].join(',');
    }

    return params;
  }

  /**
   * Make request to air quality API with retry logic
   * @private
   */
  private async makeRequestToAirQuality<T>(
    url: string,
    params: Record<string, string | number>,
    retries = 0
  ): Promise<T> {
    try {
      const response = await this.airQualityClient.get<T>(url, { params });
      return response.data;
    } catch (error) {
      // Retry on rate limit or server errors
      if (retries < this.maxRetries) {
        const shouldRetry =
          (error as Error).message.includes('rate limit') ||
          (error as Error).message.includes('server error') ||
          (error as Error).message.includes('timed out');

        if (shouldRetry) {
          const baseDelay = Math.pow(2, retries) * 1000;
          const delay = baseDelay * (0.5 + Math.random() * 0.5);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.makeRequestToAirQuality<T>(url, params, retries + 1);
        }
      }
      throw error;
    }
  }

  /**
   * Validate that the air quality response contains the expected data
   * @private
   */
  private validateAirQualityResponse(
    response: OpenMeteoAirQualityResponse,
    forecast: boolean
  ): void {
    if (!response.current || !response.current.time) {
      throw new DataNotFoundError(
        'OpenMeteo',
        'No current air quality data available for the specified location'
      );
    }

    if (forecast && (!response.hourly || !response.hourly.time || response.hourly.time.length === 0)) {
      throw new DataNotFoundError(
        'OpenMeteo',
        'No hourly air quality forecast data available for the specified location'
      );
    }
  }

  /**
   * Get marine conditions data from Open-Meteo Marine API
   *
   * @param latitude - Latitude coordinate (-90 to 90)
   * @param longitude - Longitude coordinate (-180 to 180)
   * @param forecast - Whether to include hourly forecast (default: false, returns current only)
   * @param forecastDays - Number of forecast days (1-7, default: 5)
   * @returns Marine conditions including waves, swell, and currents
   */
  async getMarine(
    latitude: number,
    longitude: number,
    forecast: boolean = false,
    forecastDays: number = 5
  ): Promise<OpenMeteoMarineResponse> {
    // Validate coordinates
    validateLatitude(latitude);
    validateLongitude(longitude);

    // Validate forecast days
    if (forecastDays < 1 || forecastDays > 7) {
      throw new InvalidLocationError(
        'OpenMeteo',
        'Marine forecast days must be between 1 and 7'
      );
    }

    // Build parameters
    const params = this.buildMarineParams(latitude, longitude, forecast, forecastDays);

    // Check cache first
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('openmeteo-marine', latitude, longitude, forecast, forecastDays);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as OpenMeteoMarineResponse;
      }

      const response = await this.makeRequestToMarine<OpenMeteoMarineResponse>('/marine', params);
      this.validateMarineResponse(response, forecast);

      // Cache for 1 hour (marine conditions update hourly)
      this.cache.set(cacheKey, response, 60 * 60 * 1000);

      return response;
    }

    // No caching
    const response = await this.makeRequestToMarine<OpenMeteoMarineResponse>('/marine', params);
    this.validateMarineResponse(response, forecast);
    return response;
  }

  /**
   * Build request parameters for marine data
   * @private
   */
  private buildMarineParams(
    latitude: number,
    longitude: number,
    forecast: boolean,
    forecastDays: number
  ): Record<string, string | number> {
    const params: Record<string, string | number> = {
      latitude,
      longitude,
      timezone: 'auto'
    };

    // Always include current data
    params.current = [
      'wave_height',
      'wave_direction',
      'wave_period',
      'wind_wave_height',
      'wind_wave_direction',
      'wind_wave_period',
      'wind_wave_peak_period',
      'swell_wave_height',
      'swell_wave_direction',
      'swell_wave_period',
      'swell_wave_peak_period',
      'ocean_current_velocity',
      'ocean_current_direction'
    ].join(',');

    // Optionally include hourly forecast data
    if (forecast) {
      params.forecast_days = forecastDays;
      params.hourly = [
        'wave_height',
        'wave_direction',
        'wave_period',
        'wind_wave_height',
        'wind_wave_direction',
        'wind_wave_period',
        'wind_wave_peak_period',
        'swell_wave_height',
        'swell_wave_direction',
        'swell_wave_period',
        'swell_wave_peak_period',
        'ocean_current_velocity',
        'ocean_current_direction'
      ].join(',');

      // Also include daily aggregates
      params.daily = [
        'wave_height_max',
        'wave_direction_dominant',
        'wave_period_max',
        'wind_wave_height_max',
        'wind_wave_direction_dominant',
        'wind_wave_period_max',
        'wind_wave_peak_period_max',
        'swell_wave_height_max',
        'swell_wave_direction_dominant',
        'swell_wave_period_max',
        'swell_wave_peak_period_max'
      ].join(',');
    }

    return params;
  }

  /**
   * Make request to marine API with retry logic
   * @private
   */
  private async makeRequestToMarine<T>(
    url: string,
    params: Record<string, string | number>,
    retries = 0
  ): Promise<T> {
    try {
      const response = await this.marineClient.get<T>(url, { params });
      return response.data;
    } catch (error) {
      // Retry on rate limit or server errors
      if (retries < this.maxRetries) {
        const shouldRetry =
          (error as Error).message.includes('rate limit') ||
          (error as Error).message.includes('server error') ||
          (error as Error).message.includes('timed out');

        if (shouldRetry) {
          const baseDelay = Math.pow(2, retries) * 1000;
          const delay = baseDelay * (0.5 + Math.random() * 0.5);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.makeRequestToMarine<T>(url, params, retries + 1);
        }
      }
      throw error;
    }
  }

  /**
   * Validate that the marine response contains the expected data
   * @private
   */
  private validateMarineResponse(
    response: OpenMeteoMarineResponse,
    forecast: boolean
  ): void {
    if (!response.current || !response.current.time) {
      throw new DataNotFoundError(
        'OpenMeteo',
        'No current marine conditions data available for the specified location'
      );
    }

    if (forecast && (!response.hourly || !response.hourly.time || response.hourly.time.length === 0)) {
      throw new DataNotFoundError(
        'OpenMeteo',
        'No hourly marine forecast data available for the specified location'
      );
    }
  }

  /**
   * Compute climate normals (30-year averages) for a specific date
   *
   * Fetches 30 years of historical data (1991-2020) and computes averages
   * for the specified month/day. Results are cached indefinitely since
   * climate normals don't change.
   *
   * @param latitude - Latitude (-90 to 90)
   * @param longitude - Longitude (-180 to 180)
   * @param month - Month (1-12)
   * @param day - Day of month (1-31)
   * @returns Climate normals (30-year averages) in Fahrenheit and inches
   * @throws {InvalidLocationError} If coordinates are invalid
   * @throws {DataNotFoundError} If no historical data available
   * @throws {ServiceUnavailableError} If Open-Meteo API is unavailable
   */
  async getClimateNormals(
    latitude: number,
    longitude: number,
    month: number,
    day: number
  ): Promise<ClimateNormals> {
    validateLatitude(latitude);
    validateLongitude(longitude);

    // Check cache first (normals don't change, so cache forever)
    const cacheKey = getNormalsCacheKey(latitude, longitude, month, day);
    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey) as ClimateNormals | undefined;
      if (cached) {
        const redacted = redactCoordinatesForLogging(latitude, longitude);
        logger.info('Climate normals cache hit', { ...redacted, month, day });
        return cached;
      }
    }

    const redacted = redactCoordinatesForLogging(latitude, longitude);
    logger.info('Computing climate normals from 30-year historical data', {
      ...redacted,
      month,
      day
    });

    // Fetch 30 years of historical data (1991-2020 climate normals period)
    // Optimization: Fetch only the target month ±1 month across 30 years
    // to reduce data transfer while ensuring we capture all occurrences
    const startYear = 1991;
    const endYear = 2020;

    // Determine month range to fetch (target month ±1 to handle edge cases)
    const startMonth = month === 1 ? 12 : month - 1;
    const endMonth = month === 12 ? 1 : month + 1;

    const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${this.getLastDayOfMonth(endYear, endMonth)}`;

    // Build request parameters
    const params: Record<string, string | number> = {
      latitude,
      longitude,
      start_date: startDate,
      end_date: endDate,
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      timezone: 'UTC' // Use UTC for consistency
    };

    try {
      // Make request to historical API
      const response = await this.makeRequest<OpenMeteoHistoricalResponse>('/archive', params);

      // Compute normals from 30-year data
      const normals = computeNormalsFrom30YearData(response, month, day);

      // Cache indefinitely (normals don't change) if caching is enabled
      if (CacheConfig.enabled) {
        this.cache.set(cacheKey, normals, Infinity);
      }

      const successRedacted = redactCoordinatesForLogging(latitude, longitude);
      logger.info('Climate normals computed successfully', {
        ...successRedacted,
        month,
        day,
        tempHigh: normals.tempHigh,
        tempLow: normals.tempLow,
        precipitation: normals.precipitation
      });

      return normals;
    } catch (error) {
      logger.error('Failed to compute climate normals', error as Error);
      throw error;
    }
  }

  /**
   * Get the last day of a given month
   * @private
   */
  private getLastDayOfMonth(year: number, month: number): string {
    // Create date at start of next month, then go back 1 day
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const lastDay = new Date(nextYear, nextMonth - 1, 0).getDate();
    return String(lastDay).padStart(2, '0');
  }
}
