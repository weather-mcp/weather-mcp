/**
 * Service for fetching NASA FIRMS (Fire Information for Resource Management
 * System) satellite fire-detection data — VIIRS near-real-time hotspots.
 *
 * Two ingestion paths (see `docs/global-wildfire-plan.md` D3/D4):
 *
 * - **Keyed Area API** (`getDetectionsByBbox`): targeted bbox query,
 *   `day_range` 1-5, requires `FIRMS_MAP_KEY`. The map key is embedded in
 *   the request URL itself — see the security note below.
 * - **Keyless flat files** (`getDetectionsByRegion`): fixed 24 h regional
 *   CSV cuts, no key required, no key in the URL.
 *
 * Both paths return the same normalized `FIRMSDetection[]` via
 * `parseFIRMSCsv` (`src/utils/firmsHotspots.ts`) — CSV parsing, region
 * selection, and clustering are pure functions that live there; this module
 * is purely I/O (fetch + cache + error mapping), mirroring the
 * `nifc.ts`/`metarStation.ts` split.
 *
 * **Security: the MAP_KEY lives in the URL.** Error mapping below never
 * logs or throws the request URL, and never interpolates the raw axios
 * error message/object into a thrown message — every thrown error is a
 * fixed, pre-written string (the `nifc.ts` `queryFeatureServer` mapping
 * style), so the key can never leak through a log line or an error surfaced
 * to a caller. Coordinates in log metadata go through
 * `redactCoordinatesForLogging`.
 */

import axios, { AxiosInstance } from 'axios';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { FIRMS_MAP_KEY } from '../config/api.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { parseFIRMSCsv } from '../utils/firmsHotspots.js';
import type { FIRMSDetection, FIRMSRegionFile } from '../types/firms.js';

/**
 * Thrown when the FIRMS Area API rejects the configured `FIRMS_MAP_KEY`
 * (HTTP 400/401 with `Invalid MAP_KEY` in the response body). Deliberately
 * carries a fixed, sanitized message — never the key or the request URL —
 * so callers (the wildfire handler) can catch this specific case and fall
 * back to the keyless path with a disclosure note (D3), without ever
 * touching the rejected key again.
 */
export class FIRMSKeyRejectedError extends Error {
  constructor() {
    super('FIRMS map key was rejected by the service');
    this.name = 'FIRMSKeyRejectedError';
  }
}

export interface FIRMSServiceConfig {
  timeout?: number;
  /** Overrides the `FIRMS_MAP_KEY` env var — primarily for tests. */
  mapKey?: string;
}

const AREA_API_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const FLAT_FILE_BASE = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv';

// Both ingestion paths use the same VIIRS instrument family so results are
// comparable across the keyed/keyless split (see D3).
const AREA_API_SATELLITE = 'VIIRS_SNPP_NRT';

export class FIRMSService {
  private client: AxiosInstance;
  private cache: Cache;
  private readonly mapKey: string | undefined;

  constructor(config: FIRMSServiceConfig = {}) {
    const {
      timeout = CacheConfig.apiTimeoutMs,
      mapKey = FIRMS_MAP_KEY
    } = config;

    this.mapKey = mapKey;
    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      timeout,
      headers: {
        'Accept': 'text/csv'
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
   * True when a non-empty FIRMS map key is configured.
   */
  isKeyAvailable(): boolean {
    return !!this.mapKey && this.mapKey.trim().length > 0;
  }

  /**
   * Keyed Area API — targeted bbox query, `dayRange` days of detections.
   *
   * @throws {FIRMSKeyRejectedError} the configured key was rejected
   * @throws {Error} no key configured, invalid bbox, or any other failure
   */
  async getDetectionsByBbox(
    west: number,
    south: number,
    east: number,
    north: number,
    dayRange: number
  ): Promise<FIRMSDetection[]> {
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

    if (!this.isKeyAvailable()) {
      throw new Error('FIRMS map key is not configured.');
    }

    // Rounded to 2 decimal places (~1.1km) — plenty precise for a cache key
    // while keeping nearby repeat queries as cache hits.
    const bboxKey = `${west.toFixed(2)},${south.toFixed(2)},${east.toFixed(2)},${north.toFixed(2)}`;
    const cacheKey = Cache.generateKey('firms-area-query', bboxKey, dayRange);

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const sw = redactCoordinatesForLogging(south, west);
        const ne = redactCoordinatesForLogging(north, east);
        logger.info('FIRMS area query cache hit', {
          bbox: `${sw.lon},${sw.lat},${ne.lon},${ne.lat}`,
          dayRange
        });
        return cached as FIRMSDetection[];
      }
    }

    const detections = await this.queryAreaApi(west, south, east, north, dayRange);

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, detections, CacheConfig.ttl.firmsAreaQuery);
    }

    return detections;
  }

  private async queryAreaApi(
    west: number,
    south: number,
    east: number,
    north: number,
    dayRange: number
  ): Promise<FIRMSDetection[]> {
    // The map key is embedded in the URL path itself — never log or throw
    // this URL (see module doc comment).
    const key = this.mapKey as string; // isKeyAvailable() already checked by the caller
    const url = `${AREA_API_BASE}/${key}/${AREA_API_SATELLITE}/${west},${south},${east},${north}/${dayRange}`;

    const sw = redactCoordinatesForLogging(south, west);
    const ne = redactCoordinatesForLogging(north, east);
    logger.info('Querying FIRMS area API', {
      bbox: `${sw.lon},${sw.lat},${ne.lon},${ne.lat}`,
      dayRange
    });

    try {
      const response = await this.client.get<string>(url, { responseType: 'text' });
      const detections = parseFIRMSCsv(
        typeof response.data === 'string' ? response.data : String(response.data)
      );
      logger.info('FIRMS area query complete', { detectionCount: detections.length });
      return detections;
    } catch (error) {
      // Deliberately do not pass the raw axios error object to the logger —
      // it carries the request config (including the URL, and therefore the
      // key). Only fixed, sanitized fields are logged.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const code = axios.isAxiosError(error) ? error.code : undefined;
      logger.error('FIRMS area query failed', undefined, { status, code });

      throw mapAreaApiError(error);
    }
  }

  /**
   * Keyless flat-file path — the fixed 24 h regional cut (or `Global`),
   * parsed and cached whole.
   */
  async getDetectionsByRegion(regionFile: FIRMSRegionFile): Promise<FIRMSDetection[]> {
    const cacheKey = Cache.generateKey('firms-regional-file', regionFile);

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.info('FIRMS regional file cache hit', { regionFile });
        return cached as FIRMSDetection[];
      }
    }

    const detections = await this.fetchRegionFile(regionFile);

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, detections, CacheConfig.ttl.firmsRegionalFile);
    }

    return detections;
  }

  private async fetchRegionFile(regionFile: FIRMSRegionFile): Promise<FIRMSDetection[]> {
    const url = `${FLAT_FILE_BASE}/SUOMI_VIIRS_C2_${regionFile}_24h.csv`;

    logger.info('Fetching FIRMS regional flat file', { regionFile });

    try {
      const response = await this.client.get<string>(url, { responseType: 'text' });
      const detections = parseFIRMSCsv(
        typeof response.data === 'string' ? response.data : String(response.data)
      );
      logger.info('FIRMS regional file fetch complete', {
        regionFile,
        detectionCount: detections.length
      });
      return detections;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const code = axios.isAxiosError(error) ? error.code : undefined;
      logger.error('FIRMS regional file fetch failed', undefined, { regionFile, status, code });

      throw mapRegionFileError(error);
    }
  }
}

/**
 * Map an Area API axios failure to a fixed, sanitized `Error` (or
 * `FIRMSKeyRejectedError` for a confirmed key rejection). Copies the
 * `nifc.ts` `queryFeatureServer` fixed-message-per-bucket style; never
 * interpolates `error.message` (which, for a failing request against a URL
 * that embeds the key, is not a risk we need to take).
 */
function mapAreaApiError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') {
      return new Error('FIRMS service request timed out. The service may be temporarily unavailable.');
    }

    const status = error.response?.status;
    if (status === 400 || status === 401) {
      // The rejection body may arrive as a string or (defensively) as some
      // other JSON-parsed shape — coerce before searching it.
      const bodyText = String(error.response?.data ?? '');
      if (bodyText.includes('Invalid MAP_KEY')) {
        return new FIRMSKeyRejectedError();
      }
      return new Error('Invalid query parameters for FIRMS service.');
    }
    if (status === 503) {
      return new Error('FIRMS service is temporarily unavailable. Please try again later.');
    }
    if (status !== undefined) {
      return new Error('FIRMS service returned an error response.');
    }

    return new Error('Failed to reach FIRMS service. Please check your network connection.');
  }

  return new Error('Failed to query FIRMS fire detections.');
}

/**
 * Same fixed-message discipline as `mapAreaApiError` for the keyless
 * flat-file path. No key is present in these URLs, but the messages stay
 * fixed/sanitized anyway for consistency.
 */
function mapRegionFileError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') {
      return new Error('FIRMS service request timed out. The service may be temporarily unavailable.');
    }

    const status = error.response?.status;
    if (status === 404) {
      return new Error('FIRMS regional data file not found.');
    }
    if (status === 503) {
      return new Error('FIRMS service is temporarily unavailable. Please try again later.');
    }
    if (status !== undefined) {
      return new Error('FIRMS service returned an error response.');
    }

    return new Error('Failed to reach FIRMS service. Please check your network connection.');
  }

  return new Error('Failed to query FIRMS fire detections.');
}
