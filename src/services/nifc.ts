/**
 * Service for interacting with NIFC (National Interagency Fire Center) ArcGIS REST API
 */

import axios, { AxiosInstance } from 'axios';
import type { NIFCQueryResponse } from '../types/wildfire.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';

export interface NIFCServiceConfig {
  baseURL?: string;
  timeout?: number;
}

export class NIFCService {
  private client: AxiosInstance;
  private cache: Cache;

  // NIFC WFIGS Feature Server URL for current fire perimeters
  private readonly featureServerUrl = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0';

  constructor(config: NIFCServiceConfig = {}) {
    const {
      timeout = CacheConfig.apiTimeoutMs
    } = config;

    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      timeout,
      headers: {
        'Accept': 'application/json'
      }
    });
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
   * Query fire perimeters within a bounding box
   * @param west Western longitude boundary
   * @param south Southern latitude boundary
   * @param east Eastern longitude boundary
   * @param north Northern latitude boundary
   * @returns Fire perimeter features within the bounding box
   */
  async queryFirePerimeters(
    west: number,
    south: number,
    east: number,
    north: number
  ): Promise<NIFCQueryResponse> {
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
    const bboxKey = `${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)}`;
    if (CacheConfig.enabled) {
      const cacheKey = Cache.generateKey('nifc-fire-perimeters', bboxKey);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        // Redact bounding box coordinates for privacy
        const sw = redactCoordinatesForLogging(south, west);
        const ne = redactCoordinatesForLogging(north, east);
        logger.info('NIFC cache hit', {
          bbox: `${sw.lon},${sw.lat},${ne.lon},${ne.lat}`
        });
        return cached as NIFCQueryResponse;
      }

      const result = await this.queryFeatureServer(west, south, east, north);

      // Cache for 30 minutes (fire data updates frequently)
      this.cache.set(cacheKey, result, 1800000);
      return result;
    }

    return this.queryFeatureServer(west, south, east, north);
  }

  /**
   * Query the NIFC ArcGIS Feature Server
   */
  private async queryFeatureServer(
    west: number,
    south: number,
    east: number,
    north: number
  ): Promise<NIFCQueryResponse> {
    try {
      // Build ArcGIS REST query
      const params = new URLSearchParams({
        f: 'json', // Response format
        geometry: `${west},${south},${east},${north}`, // Bounding box
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: '*', // Return all fields
        returnGeometry: 'true',
        returnCentroid: 'false',
        returnExceededLimitFeatures: 'false',
        maxAllowableOffset: '0.0001', // Simplify geometry slightly for performance
        where: '1=1' // No additional filters (query all active fires)
      });

      const url = `${this.featureServerUrl}/query?${params.toString()}`;

      // Redact bounding box coordinates for privacy
      const sw = redactCoordinatesForLogging(south, west);
      const ne = redactCoordinatesForLogging(north, east);
      logger.info('Querying NIFC fire perimeters', {
        bbox: `${sw.lon},${sw.lat},${ne.lon},${ne.lat}`,
        url: this.featureServerUrl
      });

      const response = await this.client.get<NIFCQueryResponse>(url);

      logger.info('NIFC query complete', {
        featureCount: response.data.features?.length || 0,
        exceeded: response.data.exceededTransferLimit || false
      });

      return response.data;
    } catch (error) {
      logger.error('NIFC query failed', error as Error);

      // Check for specific error types
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('NIFC service request timed out. The service may be temporarily unavailable.');
        }
        if (error.response?.status === 400) {
          throw new Error('Invalid query parameters for NIFC service.');
        }
        if (error.response?.status === 503) {
          throw new Error('NIFC service is temporarily unavailable. Please try again later.');
        }
      }

      throw new Error(`Failed to query NIFC fire perimeters: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if the NIFC service is operational
   */
  async checkServiceStatus(): Promise<{
    operational: boolean;
    message: string;
    timestamp: string;
  }> {
    try {
      // Query a small bounding box to test service availability
      const response = await this.client.get(`${this.featureServerUrl}?f=json`, {
        timeout: 10000
      });

      if (response.status === 200 && response.data) {
        return {
          operational: true,
          message: 'NIFC ArcGIS service is operational',
          timestamp: new Date().toISOString()
        };
      }

      return {
        operational: false,
        message: 'NIFC service returned unexpected response',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.warn('NIFC service check failed', { error: error instanceof Error ? error.message : String(error) });

      return {
        operational: false,
        message: `NIFC service is unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }
}
