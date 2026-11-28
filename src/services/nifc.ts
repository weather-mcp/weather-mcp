/**
 * Service for interacting with NIFC (National Interagency Fire Center) ArcGIS REST API
 */

import axios, { AxiosInstance } from 'axios';
import type { NIFCQueryResponse } from '../types/wildfire.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging, describeErrorForLogging } from '../utils/logger.js';
import { withRequestDeadline } from '../utils/httpDeadline.js';
import { isConnectionFailureCode } from '../utils/connectionFailure.js';

/** Fixed message for an HTTP 200 whose body is not a fire-perimeter feature list (G4). */
const UNEXPECTED_RESPONSE_MESSAGE = 'NIFC service returned an unexpected response.';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Is a FeatureServer 200 body a feature list? A plain object, no ArcGIS
 * `error` key, and `features` an array of plain objects (the handler reads
 * `feature.attributes` on each one). `{ features: [] }` is the honest empty.
 */
function isFeatureListEnvelope(body: unknown): body is NIFCQueryResponse {
  return isPlainObject(body)
    && body.error === undefined
    && Array.isArray(body.features)
    && body.features.every(isPlainObject);
}

/**
 * Response-size cap. Design sweep 2026-11-27: the perimeter query with no bounding box (every current
 * US perimeter) was 1,070,545 decoded bytes. ≥ 8×, rounded up to a multiple of 4 MiB.
 */
const NIFC_MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

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
      },
      // A 3xx is an error, never followed.
      maxRedirects: 0,
      maxContentLength: NIFC_MAX_RESPONSE_BYTES,
      adapter: withRequestDeadline(),
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
   * @throws {Error} `NIFC service returned an unexpected response.` for an
   *   HTTP 200 whose body is not a feature list (never cached)
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

      // Cached for CacheConfig.ttl.firePerimeters (WFIGS refresh cadence)
      this.cache.set(cacheKey, result, CacheConfig.ttl.firePerimeters);
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
    const body = await this.requestFeatureServer(west, south, east, north);

    // ArcGIS reports a query error as HTTP 200 with an `error` object and no
    // `features` (measured live 2026-11-25). That is an error, never an empty
    // list (G4). Thrown outside the request `catch`, so it is never mapped to
    // `Failed to query NIFC fire perimeters.`, and before
    // `queryFirePerimeters`'s `cache.set` (`ttl.firePerimeters`), so it is never cached.
    // Nothing from the body is logged.
    if (!isFeatureListEnvelope(body)) {
      logger.warn('NIFC returned an unexpected response', { status: 200, securityEvent: true });
      throw new Error(UNEXPECTED_RESPONSE_MESSAGE);
    }

    logger.info('NIFC query complete', {
      featureCount: body.features?.length || 0,
      exceeded: body.exceededTransferLimit || false
    });

    return body;
  }

  /**
   * The FeatureServer request alone: the raw response body, or a fixed-message error.
   */
  private async requestFeatureServer(
    west: number,
    south: number,
    east: number,
    north: number
  ): Promise<unknown> {
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

      const response = await this.client.get<unknown>(url);
      return response.data;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      logger.error('NIFC query failed', undefined, { ...describeErrorForLogging(error), status });

      // Every message is fixed text: transport and upstream wording never reach
      // the user. Timeouts first, then the shared connection-failure set (G138).
      if (axios.isAxiosError(error)) {
        // An oversize answer carries no `response`. Gated on the code *and* the message: another
        // ERR_BAD_RESPONSE keeps the generic fixed text at the end. Contract path: it throws, never "no fires".
        if (error.code === 'ERR_BAD_RESPONSE' && /maxContentLength/.test(error.message ?? '')) {
          throw new Error('NIFC service response too large.');
        }
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          throw new Error('NIFC service request timed out. The service may be temporarily unavailable.');
        }
        if (isConnectionFailureCode(error.code)) {
          throw new Error('Unable to connect to the NIFC service. The service may be unreachable from this network.');
        }
        if (status === 400) {
          throw new Error('Invalid query parameters for NIFC service.');
        }
        if (status === 503) {
          throw new Error('NIFC service is temporarily unavailable. Please try again later.');
        }
        if (typeof status === 'number') {
          throw new Error(`NIFC service returned HTTP ${status}.`);
        }
      }

      throw new Error('Failed to query NIFC fire perimeters.');
    }
  }
}
