/**
 * Service for interacting with the NOAA Climate Data Online (CDO) API v2
 * Documentation: https://www.ncdc.noaa.gov/cdo-web/webservices/v2
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  CDOLocationCollectionResponse,
  CDOStationCollectionResponse,
  CDODataCollectionResponse,
  CDOErrorResponse
} from '../types/cdo.js';

export interface CDOServiceConfig {
  token?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export class CDOService {
  private client: AxiosInstance;
  private maxRetries: number;
  private token?: string;

  constructor(config: CDOServiceConfig = {}) {
    const {
      token,
      baseURL = 'https://www.ncei.noaa.gov/cdo-web/api/v2',
      timeout = 30000,
      maxRetries = 3
    } = config;

    this.token = token;
    this.maxRetries = maxRetries;

    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Accept': 'application/json'
      }
    });

    // Add token to headers if provided
    if (token) {
      this.client.defaults.headers.common['token'] = token;
    }

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
      const data = error.response.data as CDOErrorResponse;

      // Unauthorized - missing or invalid token
      if (status === 401) {
        throw new Error('CDO API authentication failed. Please check your API token. Get one at: https://www.ncdc.noaa.gov/cdo-web/token');
      }

      // Rate limit error
      if (status === 429) {
        throw new Error('CDO API rate limit exceeded (5 req/sec or 10k req/day). Please retry later.');
      }

      // Bad request
      if (status === 400) {
        throw new Error(`CDO API error: ${data.message || 'Invalid request parameters'}`);
      }

      // Not found
      if (status === 404) {
        throw new Error(`CDO API: Resource not found (${error.config?.url})`);
      }

      // Other client errors
      if (status >= 400 && status < 500) {
        throw new Error(`CDO API error: ${data.message || 'Request failed'}`);
      }

      // Server errors
      if (status >= 500) {
        throw new Error(`CDO API server error: Service temporarily unavailable`);
      }
    }

    // Network errors
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request to CDO API timed out. Please try again.');
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Unable to connect to CDO API. Please check your internet connection.');
    }

    // Generic error
    throw new Error(`CDO API request failed: ${error.message}`);
  }

  /**
   * Make request with retry logic
   */
  private async makeRequest<T>(
    url: string,
    params?: Record<string, string | number>,
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
   * Get US state FIPS code from coordinates (approximation)
   * This is a simplified lookup for major states
   */
  private getStateFIPSFromCoordinates(latitude: number, longitude: number): string[] {
    // Return array of likely state FIPS codes based on rough geographic regions
    // This helps with CDO API location-based queries

    const candidates: string[] = [];

    // West Coast
    if (longitude < -110) {
      if (latitude > 42) candidates.push('FIPS:53'); // Washington
      if (latitude > 39 && latitude < 46) candidates.push('FIPS:41'); // Oregon
      if (latitude < 42) candidates.push('FIPS:06'); // California
    }

    // Mountain states
    if (longitude >= -110 && longitude < -95) {
      if (latitude > 45) candidates.push('FIPS:30'); // Montana
      if (latitude > 41 && latitude < 49) candidates.push('FIPS:56'); // Wyoming
      if (latitude > 37 && latitude < 45) candidates.push('FIPS:08'); // Colorado
      if (latitude < 37) candidates.push('FIPS:35'); // New Mexico
    }

    // Midwest
    if (longitude >= -95 && longitude < -80) {
      if (latitude > 43) candidates.push('FIPS:27'); // Minnesota
      if (latitude > 40 && latitude < 47) candidates.push('FIPS:17'); // Illinois
      if (latitude > 38 && latitude < 43) candidates.push('FIPS:29'); // Missouri
      if (latitude < 40) candidates.push('FIPS:48'); // Texas
    }

    // East Coast
    if (longitude >= -80) {
      if (latitude > 42) candidates.push('FIPS:33'); // New Hampshire
      if (latitude > 40 && latitude < 45) candidates.push('FIPS:36'); // New York
      if (latitude > 37 && latitude < 42) candidates.push('FIPS:42'); // Pennsylvania
      if (latitude < 37) candidates.push('FIPS:12'); // Florida
    }

    // Always add some major state candidates if we don't have any
    if (candidates.length === 0) {
      candidates.push('FIPS:06', 'FIPS:36', 'FIPS:48', 'FIPS:12', 'FIPS:17');
    }

    return candidates;
  }

  /**
   * Find nearest stations to a location
   * Uses multiple strategies to work around CDO API extent-search limitations
   */
  async findStationsByLocation(
    latitude: number,
    longitude: number,
    startDate: string,
    endDate: string,
    limit: number = 5
  ): Promise<CDOStationCollectionResponse> {
    // Strategy 1: Try searching by state FIPS code (most reliable for CDO API)
    const stateFIPS = this.getStateFIPSFromCoordinates(latitude, longitude);

    for (const fips of stateFIPS) {
      try {
        const params = {
          locationid: fips,
          datasetid: 'GHCND',
          limit: '1000',
          sortfield: 'name'
        };

        const response = await this.makeRequest<CDOStationCollectionResponse>('/stations', params);

        if (response.results && response.results.length > 0) {
          // Sort by distance and filter
          let stations = response.results;

          // Filter to only stations with coordinates
          stations = stations.filter(s => s.latitude !== undefined && s.longitude !== undefined);

          // Sort by distance to the target coordinates
          stations.sort((a, b) => {
            const distA = this.calculateDistance(latitude, longitude, a.latitude, a.longitude);
            const distB = this.calculateDistance(latitude, longitude, b.latitude, b.longitude);
            return distA - distB;
          });

          // Filter out stations that are too far away (more than 150km)
          const maxDistance = 150; // km
          stations = stations.filter(s => {
            const dist = this.calculateDistance(latitude, longitude, s.latitude, s.longitude);
            return dist <= maxDistance;
          });

          if (stations.length > 0) {
            response.results = stations.slice(0, limit);
            return response;
          }
        }
      } catch (error) {
        // Try next FIPS code
        continue;
      }
    }

    // Strategy 2: Try a broader search without location filter but with careful limits
    // This is a fallback that works sometimes but has data quality issues
    try {
      const params = {
        limit: '1000',
        datasetid: 'GHCND',
        sortfield: 'name',
        sortorder: 'asc'
      };

      const response = await this.makeRequest<CDOStationCollectionResponse>('/stations', params);

      if (response.results && response.results.length > 0) {
        // Filter to only US stations with coordinates
        let usStations = response.results.filter(s =>
          s.id.startsWith('GHCND:US') &&
          s.latitude !== undefined &&
          s.longitude !== undefined
        );

        // Sort by distance to the target coordinates
        usStations.sort((a, b) => {
          const distA = this.calculateDistance(latitude, longitude, a.latitude, a.longitude);
          const distB = this.calculateDistance(latitude, longitude, b.latitude, b.longitude);
          return distA - distB;
        });

        // Filter out stations that are too far away
        const maxDistance = 150; // km
        usStations = usStations.filter(s => {
          const dist = this.calculateDistance(latitude, longitude, s.latitude, s.longitude);
          return dist <= maxDistance;
        });

        if (usStations.length > 0) {
          response.results = usStations.slice(0, limit);
          return response;
        }
      }
    } catch (error) {
      // Continue to fallback
    }

    // No stations found with any strategy
    return {
      metadata: { count: 0, offset: 1, limit: limit },
      results: []
    };
  }

  /**
   * Calculate distance between two coordinates using Haversine formula (in km)
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Get daily summary data from a station
   */
  async getDailySummaries(
    stationId: string,
    startDate: string,
    endDate: string,
    dataTypes?: string[],
    limit: number = 1000
  ): Promise<CDODataCollectionResponse> {
    const params: Record<string, string | number> = {
      datasetid: 'GHCND',
      stationid: stationId,
      startdate: startDate,
      enddate: endDate,
      limit: Math.min(limit, 1000), // API max is 1000
      units: 'standard' // Use Fahrenheit and inches
    };

    if (dataTypes && dataTypes.length > 0) {
      params.datatypeid = dataTypes.join(',');
    }

    return this.makeRequest<CDODataCollectionResponse>('/data', params);
  }

  /**
   * Get historical data for a location (convenience method)
   * Finds nearest station and retrieves daily summaries
   */
  async getHistoricalData(
    latitude: number,
    longitude: number,
    startDate: string,
    endDate: string,
    limit: number = 1000
  ): Promise<CDODataCollectionResponse> {
    // Check if token is available
    if (!this.token) {
      throw new Error(
        'CDO API token is required for archival historical data (older than 7 days).\n\n' +
        'To get historical data:\n' +
        '1. Request a free token at: https://www.ncdc.noaa.gov/cdo-web/token\n' +
        '2. Add NOAA_CDO_TOKEN to your MCP server environment variables\n' +
        '3. Restart Claude Code\n\n' +
        'Note: Recent historical data (last 7 days) works without a token using the real-time API.'
      );
    }

    // Find stations near the location
    const stations = await this.findStationsByLocation(
      latitude,
      longitude,
      startDate,
      endDate,
      10 // Try more stations to increase chances of finding data
    );

    if (!stations.results || stations.results.length === 0) {
      throw new Error(
        'No weather stations found near the specified location.\n\n' +
        'This may occur because:\n' +
        '- The location is outside the United States (CDO API only covers US locations)\n' +
        '- The area is remote with limited weather station coverage\n' +
        '- The CDO API is experiencing issues\n\n' +
        'Suggestions:\n' +
        '- Try a nearby major city instead\n' +
        '- For recent data (last 7 days), the request will automatically use the real-time API\n' +
        '- Check if your coordinates are correct (latitude: ' + latitude + ', longitude: ' + longitude + ')'
      );
    }

    // Try stations in order until we get data
    const stationErrors: string[] = [];
    for (const station of stations.results) {
      try {
        const data = await this.getDailySummaries(
          station.id,
          startDate,
          endDate,
          ['TMAX', 'TMIN', 'TAVG', 'PRCP', 'SNOW'], // Common data types
          limit
        );

        if (data.results && data.results.length > 0) {
          return data;
        }
        stationErrors.push(`${station.name || station.id}: No data for date range`);
      } catch (error) {
        stationErrors.push(`${station.name || station.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        continue;
      }
    }

    // Provide detailed error with context
    const distance = this.calculateDistance(
      latitude,
      longitude,
      stations.results[0].latitude,
      stations.results[0].longitude
    );

    throw new Error(
      `No historical data available from nearby stations for the requested date range (${startDate} to ${endDate}).\n\n` +
      `Checked ${stations.results.length} station(s). Nearest: ${stations.results[0].name || stations.results[0].id} (${distance.toFixed(1)}km away)\n\n` +
      'This may occur because:\n' +
      '- The dates are outside available data range for this location\n' +
      '- There are gaps in historical records\n' +
      '- The weather stations in this area may not have archived all data types\n\n' +
      'Suggestions:\n' +
      '- Try a shorter date range\n' +
      '- Try more recent dates (data coverage improves for recent years)\n' +
      '- Try coordinates for a larger nearby city\n' +
      '- For data within the last 7 days, use dates closer to today (automatically uses real-time API)'
    );
  }
}
