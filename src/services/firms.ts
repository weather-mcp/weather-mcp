/**
 * Service for fetching NASA FIRMS (Fire Information for Resource Management
 * System) satellite fire-detection data — VIIRS near-real-time hotspots.
 *
 * Two ingestion paths (see `docs/plans/global-wildfire-plan.md` D3/D4):
 *
 * - **Keyed Area API** (`getDetectionsByBbox`): targeted bbox query,
 *   `day_range` 1-5, requires `FIRMS_MAP_KEY`. The map key is embedded in
 *   the request URL itself — see the security note below.
 * - **Keyless flat files** (`getDetectionsByRegion`): fixed 24 h regional
 *   CSV cuts, no key required, no key in the URL. Returns the file's
 *   `Last-Modified` header with the rows, for the handler's freshness check.
 * - **Keyed `data_availability`** (`getProductAvailability`): each product's
 *   latest data date. Garnish — it never throws, and a failure is not cached.
 *
 * Every data method takes one product from `FIRMS_PRODUCTS`
 * (`src/utils/firmsProducts.ts`); this module defines no product data.
 * Staleness is judged by the handler at read time, never here.
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
import { classifyFIRMSCsvEnvelope, parseFIRMSCsv } from '../utils/firmsHotspots.js';
import { parseDataAvailabilityCsv } from '../utils/firmsProducts.js';
import { withRequestDeadline } from '../utils/httpDeadline.js';
import type { FIRMSDetection, FIRMSProduct, FIRMSRegionFile } from '../types/firms.js';

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

/**
 * Response-size cap for every FIRMS request (Area API, regional flat files, data availability).
 * Design sweep 2026-11-27: `J1_VIIRS_C2_Global_24h.csv` was 7,371,195 decoded bytes, the largest
 * file the code can fetch, in late November; fire season can multiply it. ≥ 8×, rounded up to a
 * multiple of 4 MiB.
 */
const FIRMS_MAX_RESPONSE_BYTES = 60 * 1024 * 1024;

const AREA_API_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const FLAT_FILE_ROOT = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire';
const DATA_AVAILABILITY_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv';

/** Fixed message for an HTTP 200 whose body is not a FIRMS CSV answer (G4). */
const UNEXPECTED_RESPONSE_MESSAGE = 'FIRMS returned an unexpected response.';

/** A keyless region file's parsed rows and its `Last-Modified` header, cached together. */
export interface FIRMSRegionResult {
  detections: FIRMSDetection[];
  /** The raw `Last-Modified` header, or `undefined` when absent or empty. */
  lastModified: string | undefined;
}

// Both ingestion paths read the same products (every one VIIRS), so results
// are comparable across the keyed/keyless split (see D3).

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
      },
      // A 3xx is an error, never followed.
      maxRedirects: 0,
      maxContentLength: FIRMS_MAX_RESPONSE_BYTES,
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
   * True when a non-empty FIRMS map key is configured.
   */
  isKeyAvailable(): boolean {
    return !!this.mapKey && this.mapKey.trim().length > 0;
  }

  /**
   * Keyed Area API — targeted bbox query, `dayRange` days of detections.
   *
   * @throws {FIRMSKeyRejectedError} the configured key was rejected
   * @throws {Error} `FIRMS returned an unexpected response.` for an HTTP 200
   *   whose body is not a FIRMS CSV answer (never cached)
   * @throws {Error} no key configured, invalid bbox, or any other failure
   */
  async getDetectionsByBbox(
    west: number,
    south: number,
    east: number,
    north: number,
    dayRange: number,
    product: FIRMSProduct
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
    const cacheKey = Cache.generateKey('firms-area-query', product.id, bboxKey, dayRange);

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const sw = redactCoordinatesForLogging(south, west);
        const ne = redactCoordinatesForLogging(north, east);
        logger.info('FIRMS area query cache hit', {
          bbox: `${sw.lon},${sw.lat},${ne.lon},${ne.lat}`,
          dayRange,
          product: product.id
        });
        return cached as FIRMSDetection[];
      }
    }

    const detections = await this.queryAreaApi(west, south, east, north, dayRange, product);

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
    dayRange: number,
    product: FIRMSProduct
  ): Promise<FIRMSDetection[]> {
    // The map key is embedded in the URL path itself — never log or throw
    // this URL (see module doc comment).
    const key = this.mapKey as string; // isKeyAvailable() already checked by the caller
    const url = `${AREA_API_BASE}/${key}/${product.id}/${west},${south},${east},${north}/${dayRange}`;

    const sw = redactCoordinatesForLogging(south, west);
    const ne = redactCoordinatesForLogging(north, east);
    logger.info('Querying FIRMS area API', {
      bbox: `${sw.lon},${sw.lat},${ne.lon},${ne.lat}`,
      dayRange,
      product: product.id
    });

    const text = await this.requestAreaCsv(url, product);
    const detections = parseFIRMSCsv(text);

    // A 200 that is not a FIRMS answer is an error, never an empty list (G4).
    // Thrown outside the request `catch`, so it is never re-mapped to the
    // generic failure text, and before the caller's `cache.set`, so it is
    // never cached.
    const envelope = classifyFIRMSCsvEnvelope(text, detections.length);
    if (envelope !== 'usable') {
      logger.warn('FIRMS returned an unexpected response', {
        status: 200,
        code: envelope === 'no-header' ? 'NO_HEADER' : 'NO_USABLE_ROWS',
        product: product.id,
        securityEvent: true
      });
      throw new Error(UNEXPECTED_RESPONSE_MESSAGE);
    }

    logger.info('FIRMS area query complete', { detectionCount: detections.length, product: product.id });
    return detections;
  }

  /** The Area API request alone: raw body text, or the mapped fixed-message error. */
  private async requestAreaCsv(url: string, product: FIRMSProduct): Promise<string> {
    try {
      const response = await this.client.get<string>(url, { responseType: 'text' });
      return typeof response.data === 'string' ? response.data : String(response.data);
    } catch (error) {
      // Deliberately do not pass the raw axios error object to the logger —
      // it carries the request config (including the URL, and therefore the
      // key). Only fixed, sanitized fields are logged.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const code = axios.isAxiosError(error) ? error.code : undefined;
      logger.error('FIRMS area query failed', undefined, { status, code, product: product.id });

      throw mapAreaApiError(error);
    }
  }

  /**
   * Keyless flat-file path — one product's fixed 24 h regional cut (or
   * `Global`), parsed and cached whole together with its `Last-Modified`
   * header (G6). Staleness is not judged here: the header is cached raw and
   * the handler compares it with the clock on every read (G7).
   *
   * @throws {Error} `FIRMS returned an unexpected response.` for an HTTP 200
   *   whose body is not a FIRMS CSV answer (never cached)
   * @throws {Error} any other failure, as a fixed message
   */
  async getDetectionsByRegion(
    regionFile: FIRMSRegionFile,
    product: FIRMSProduct
  ): Promise<FIRMSRegionResult> {
    const cacheKey = Cache.generateKey('firms-regional-file', product.id, regionFile);

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.info('FIRMS regional file cache hit', { regionFile, product: product.id });
        return cached as FIRMSRegionResult;
      }
    }

    const result = await this.fetchRegionFile(regionFile, product);

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, result, CacheConfig.ttl.firmsRegionalFile);
    }

    return result;
  }

  private async fetchRegionFile(
    regionFile: FIRMSRegionFile,
    product: FIRMSProduct
  ): Promise<FIRMSRegionResult> {
    const url = `${FLAT_FILE_ROOT}/${product.flatFileDir}/csv/${product.flatFilePrefix}_${regionFile}_24h.csv`;

    logger.info('Fetching FIRMS regional flat file', { regionFile, product: product.id });

    const { text, lastModified } = await this.requestRegionFile(url, regionFile, product);
    const detections = parseFIRMSCsv(text);

    // A 200 that is not a FIRMS answer is an error, never an empty list (G4).
    // Thrown outside the request `catch`, so it is never re-mapped to the
    // generic failure text, and before the caller's `cache.set`, so it is
    // never cached.
    const envelope = classifyFIRMSCsvEnvelope(text, detections.length);
    if (envelope !== 'usable') {
      logger.warn('FIRMS returned an unexpected response', {
        status: 200,
        code: envelope === 'no-header' ? 'NO_HEADER' : 'NO_USABLE_ROWS',
        regionFile,
        product: product.id,
        securityEvent: true
      });
      throw new Error(UNEXPECTED_RESPONSE_MESSAGE);
    }

    logger.info('FIRMS regional file fetch complete', {
      regionFile,
      product: product.id,
      detectionCount: detections.length
    });
    return { detections, lastModified };
  }

  /** The flat-file request alone: raw body text and `Last-Modified`, or the mapped fixed-message error. */
  private async requestRegionFile(
    url: string,
    regionFile: FIRMSRegionFile,
    product: FIRMSProduct
  ): Promise<{ text: string; lastModified: string | undefined }> {
    try {
      const response = await this.client.get<string>(url, { responseType: 'text' });
      const text = typeof response.data === 'string' ? response.data : String(response.data);
      // axios lower-cases header names. Keep only a non-empty string.
      const header: unknown = response.headers?.['last-modified'];
      const lastModified = typeof header === 'string' && header.trim() !== '' ? header : undefined;
      return { text, lastModified };
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const code = axios.isAxiosError(error) ? error.code : undefined;
      logger.error('FIRMS regional file fetch failed', undefined, {
        regionFile,
        product: product.id,
        status,
        code
      });

      throw mapRegionFileError(error);
    }
  }

  /**
   * Keyed freshness signal: `data_availability`'s `data_id` → `max_date` map.
   *
   * **Garnish — never throws.** Resolves `undefined` when no key is configured
   * (no request), on any request failure, and on a body that yields no rows;
   * the handler then treats every product as current (fail open). Only a
   * non-empty map is cached, so a failure is retried on the next call (G7).
   * The key is in the URL path: nothing here logs or throws the URL or the
   * axios error — logs carry `{ status, code }` only.
   */
  async getProductAvailability(): Promise<Map<string, string> | undefined> {
    if (!this.isKeyAvailable()) {
      return undefined;
    }

    const cacheKey = Cache.generateKey('firms-data-availability');
    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as Map<string, string>;
      }
    }

    const key = this.mapKey as string;
    const url = `${DATA_AVAILABILITY_BASE}/${key}/all`;

    let body: string;
    try {
      const response = await this.client.get<string>(url, { responseType: 'text' });
      const data: unknown = response.data;
      body = data == null ? '' : typeof data === 'string' ? data : String(data);
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const code = axios.isAxiosError(error) ? error.code : undefined;
      if (status === 401 || status === 403) {
        logger.warn('FIRMS data availability check failed', { status, code, securityEvent: true });
      } else {
        logger.warn('FIRMS data availability check failed', { status, code });
      }
      return undefined;
    }

    const availability = parseDataAvailabilityCsv(body);
    if (availability.size === 0) {
      logger.warn('FIRMS data availability check failed', { status: 200, code: 'EMPTY_BODY' });
      return undefined;
    }

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, availability, CacheConfig.ttl.firmsDataAvailability);
    }
    return availability;
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
    // An oversize answer, first: it carries no `response`, so it would otherwise be reported as a
    // network failure. Gated on the code *and* the message. Fixed text: never the axios message, which
    // could name the request.
    if (error.code === 'ERR_BAD_RESPONSE' && /maxContentLength/.test(error.message ?? '')) {
      return new Error('FIRMS service response too large.');
    }
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
    // An oversize answer, first: it carries no `response`, so it would otherwise be reported as a
    // network failure. Gated on the code *and* the message. Fixed text: never the axios message, which
    // could name the request.
    if (error.code === 'ERR_BAD_RESPONSE' && /maxContentLength/.test(error.message ?? '')) {
      return new Error('FIRMS service response too large.');
    }
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
