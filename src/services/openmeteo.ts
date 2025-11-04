/**
 * Service for interacting with the Open-Meteo Historical Weather API
 * Documentation: https://open-meteo.com/en/docs/historical-weather-api
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  OpenMeteoHistoricalResponse,
  OpenMeteoErrorResponse
} from '../types/openmeteo.js';

export interface OpenMeteoServiceConfig {
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export class OpenMeteoService {
  private client: AxiosInstance;
  private maxRetries: number;

  constructor(config: OpenMeteoServiceConfig = {}) {
    const {
      baseURL = 'https://archive-api.open-meteo.com/v1',
      timeout = 30000,
      maxRetries = 3
    } = config;

    this.maxRetries = maxRetries;

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
   * Handle API errors
   */
  private async handleError(error: AxiosError): Promise<never> {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as OpenMeteoErrorResponse;

      // Bad request
      if (status === 400) {
        const reason = data.reason || 'Invalid request parameters';
        throw new Error(`Open-Meteo API error: ${reason}`);
      }

      // Rate limit error
      if (status === 429) {
        throw new Error('Open-Meteo API rate limit exceeded. Please retry later.');
      }

      // Server errors
      if (status >= 500) {
        throw new Error('Open-Meteo API server error: Service temporarily unavailable');
      }

      // Other errors
      throw new Error(`Open-Meteo API error (${status}): ${data.reason || 'Request failed'}`);
    }

    // Network errors
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request to Open-Meteo API timed out. Please try again.');
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Unable to connect to Open-Meteo API. Please check your internet connection.');
    }

    // Generic error
    throw new Error(`Open-Meteo API request failed: ${error.message}`);
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
          const delay = Math.pow(2, retries) * 1000; // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.makeRequest<T>(url, params, retries + 1);
        }
      }
      throw error;
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
    // Validate coordinates
    if (latitude < -90 || latitude > 90) {
      throw new Error(`Invalid latitude: ${latitude}. Must be between -90 and 90.`);
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error(`Invalid longitude: ${longitude}. Must be between -180 and 180.`);
    }

    // Build request parameters
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

    const response = await this.makeRequest<OpenMeteoHistoricalResponse>(
      '/archive',
      params
    );

    // Validate response has data
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

    return response;
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
