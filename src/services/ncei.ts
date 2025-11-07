/**
 * Service for interacting with NOAA NCEI (National Centers for Environmental Information)
 * Climate Data Online (CDO) API
 *
 * Documentation: https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation
 *
 * NOTE: This is a simplified implementation. The NCEI API is station-based (not coordinate-based),
 * which adds complexity:
 * 1. Must find nearby weather stations from coordinates
 * 2. Stations may not have all climate normals data
 * 3. Need to handle multiple stations and aggregate data
 *
 * For v1.2.0, we implement a basic structure that falls back to Open-Meteo.
 * Future enhancement: Full NCEI climate normals integration.
 */

import axios, { AxiosInstance } from 'axios';
import type { ClimateNormals } from '../types/openmeteo.js';
import { NCEI_API_TOKEN } from '../config/api.js';
import { logger } from '../utils/logger.js';
import { DataNotFoundError, RateLimitError, ServiceUnavailableError } from '../errors/ApiError.js';
import { getUserAgent } from '../utils/version.js';

export interface NCEIServiceConfig {
  baseURL?: string;
  timeout?: number;
  token?: string;
}

/**
 * NCEI Climate Data Online (CDO) Service
 *
 * Provides access to official NOAA climate normals for US locations.
 * Requires API token (free from https://www.ncdc.noaa.gov/cdo-web/token)
 */
export class NCEIService {
  private client: AxiosInstance;
  private token: string | undefined;

  constructor(config: NCEIServiceConfig = {}) {
    const {
      baseURL = 'https://www.ncei.noaa.gov/cdo-web/api/v2',
      timeout = 30000,
      token = NCEI_API_TOKEN
    } = config;

    this.token = token;

    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      }
    });

    // Add token to requests if available
    if (this.token) {
      this.client.defaults.headers.common['token'] = this.token;
    }

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );
  }

  /**
   * Check if NCEI service is available (token configured)
   */
  isAvailable(): boolean {
    return !!this.token && this.token.trim().length > 0;
  }

  /**
   * Get climate normals for a US location
   *
   * NOTE: This is a placeholder implementation. The NCEI API requires:
   * 1. Station lookup from coordinates
   * 2. Querying climate normals datasets by station
   * 3. Data transformation to our format
   *
   * For v1.2.0, this throws DataNotFoundError to trigger fallback to Open-Meteo.
   * Future enhancement: Implement full NCEI normals retrieval.
   *
   * @param latitude - Latitude (US only)
   * @param longitude - Longitude (US only)
   * @param month - Month (1-12)
   * @param day - Day of month (1-31)
   * @returns Climate normals
   * @throws {DataNotFoundError} - NCEI integration not yet complete
   */
  async getClimateNormals(
    latitude: number,
    longitude: number,
    month: number,
    day: number
  ): Promise<ClimateNormals> {
    if (!this.isAvailable()) {
      throw new DataNotFoundError(
        'NCEI',
        'NCEI API token not configured. Set NCEI_API_TOKEN environment variable.'
      );
    }

    logger.info('NCEI climate normals requested (not yet implemented)', {
      latitude,
      longitude,
      month,
      day
    });

    // TODO: Implement NCEI climate normals retrieval
    // Steps needed:
    // 1. Find nearby weather stations using /stations endpoint
    // 2. Query climate normals datasets (NORMAL_DLY, NORMAL_MLY) for station
    // 3. Extract and transform data to ClimateNormals format
    // 4. Handle missing data and station selection logic
    //
    // Complexity: High - requires multiple API calls and data processing
    // Estimated implementation: 1-2 days
    //
    // For now, throw DataNotFoundError to trigger fallback to Open-Meteo

    throw new DataNotFoundError(
      'NCEI',
      'NCEI climate normals integration is planned for a future release. Using Open-Meteo fallback.'
    );
  }

  /**
   * Handle API errors
   * @private
   */
  private async handleError(error: any): Promise<never> {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.message;

      if (status === 429) {
        throw new RateLimitError(
          'NCEI',
          'Rate limit exceeded (5 requests/second or 10,000/day)',
          60
        );
      }

      if (status === 401 || status === 403) {
        throw new ServiceUnavailableError(
          'NCEI',
          'Invalid or missing API token. Get a free token at https://www.ncdc.noaa.gov/cdo-web/token'
        );
      }

      if (status === 404) {
        throw new DataNotFoundError('NCEI', message || 'Data not found');
      }

      if (status >= 500) {
        throw new ServiceUnavailableError('NCEI', message || 'Service temporarily unavailable');
      }

      throw new ServiceUnavailableError('NCEI', message);
    }

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new ServiceUnavailableError('NCEI', 'Request timed out');
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new ServiceUnavailableError('NCEI', 'Unable to connect to NCEI API');
    }

    throw new ServiceUnavailableError('NCEI', error.message || 'Unknown error occurred');
  }
}
