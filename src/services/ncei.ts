/**
 * Service for interacting with NOAA NCEI (National Centers for Environmental Information)
 * Climate Data Online (CDO) API.
 *
 * Documentation: https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation
 *
 * Provides official NOAA 1991–2020 climate normals for US locations. The CDO API is
 * station-based (not coordinate-based), so retrieval works in three steps:
 *   1. Find nearby stations that carry daily normals (`NORMAL_DLY`) for the coordinate.
 *   2. For the nearest qualifying station, read the daily high/low temperature normals
 *      (`DLY-TMAX-NORMAL`, `DLY-TMIN-NORMAL`) for the requested month/day.
 *   3. Read the monthly precipitation normal (`MLY-PRCP-NORMAL` from `NORMAL_MLY`) and
 *      divide by the number of days in the month to express an average daily value.
 *
 * Normals are keyed to a fixed reference year (2010) in the CDO dataset. Values are
 * requested with `units=standard` so temperatures come back in °F and precipitation in
 * inches. If no nearby station has complete normals, a DataNotFoundError is thrown so the
 * caller can fall back to Open-Meteo computed normals.
 */

import axios, { AxiosInstance } from 'axios';
import type { ClimateNormals } from '../types/openmeteo.js';
import type {
  NCEIDataResponse,
  NCEIStationsResponse,
  NCEIStationWithDistance
} from '../types/ncei.js';
import { NCEI_API_TOKEN } from '../config/api.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { DataNotFoundError, RateLimitError, ServiceUnavailableError } from '../errors/ApiError.js';
import { getUserAgent } from '../utils/version.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { calculateDistance } from '../utils/distance.js';

export interface NCEIServiceConfig {
  baseURL?: string;
  timeout?: number;
  token?: string;
}

/** CDO dataset identifiers. */
const DATASET_DAILY_NORMALS = 'NORMAL_DLY';
const DATASET_MONTHLY_NORMALS = 'NORMAL_MLY';

/** Reference year used by the CDO normals datasets (non-leap). */
const NORMALS_REFERENCE_YEAR = 2010;

/** Initial station-search half-extent in degrees (~80 km of latitude). */
const STATION_SEARCH_DEGREES = 0.75;
/** Expanded half-extent used if the initial search finds no stations. */
const STATION_SEARCH_DEGREES_WIDE = 1.5;

/** Maximum number of nearest stations to probe for complete normals. */
const MAX_STATION_ATTEMPTS = 4;

/**
 * CDO uses large negative sentinels (e.g. -7777, -9999) for special/missing values.
 * Any genuine °F temperature or inches-precipitation normal is far above this.
 */
const MISSING_VALUE_THRESHOLD = -100;

/**
 * NCEI Climate Data Online (CDO) Service
 *
 * Provides access to official NOAA climate normals for US locations.
 * Requires API token (free from https://www.ncdc.noaa.gov/cdo-web/token)
 */
export class NCEIService {
  private client: AxiosInstance;
  private token: string | undefined;
  private cache: Cache<unknown>;

  constructor(config: NCEIServiceConfig = {}) {
    const {
      baseURL = 'https://www.ncei.noaa.gov/cdo-web/api/v2',
      timeout = 30000,
      token = NCEI_API_TOKEN
    } = config;

    this.token = token;
    this.cache = new Cache(CacheConfig.maxSize);

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
   * Get official NOAA climate normals for a US location.
   *
   * @param latitude - Latitude (US only)
   * @param longitude - Longitude (US only)
   * @param month - Month (1-12)
   * @param day - Day of month (1-31)
   * @returns Climate normals sourced from NCEI
   * @throws {DataNotFoundError} - No token, or no nearby station with complete normals
   * @throws {RateLimitError} - CDO rate limit exceeded
   * @throws {ServiceUnavailableError} - CDO unavailable or invalid token
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

    const redacted = redactCoordinatesForLogging(latitude, longitude);

    // Normals are immutable, so cache indefinitely.
    const cacheKey = Cache.generateKey(
      'ncei-normals',
      latitude.toFixed(2),
      longitude.toFixed(2),
      month,
      day
    );
    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey) as ClimateNormals | undefined;
      if (cached) {
        logger.info('NCEI climate normals cache hit', { ...redacted, month, day });
        return cached;
      }
    }

    // The reference year (2010) is not a leap year, so Feb 29 has no normal.
    const normalsDay = month === 2 && day === 29 ? 28 : day;
    const dailyDate = `${NORMALS_REFERENCE_YEAR}-${pad2(month)}-${pad2(normalsDay)}`;
    const monthlyDate = `${NORMALS_REFERENCE_YEAR}-${pad2(month)}-01`;

    logger.info('Fetching climate normals from NCEI', { ...redacted, month, day });

    const stations = await this.findNearbyStations(latitude, longitude);
    if (stations.length === 0) {
      throw new DataNotFoundError(
        'NCEI',
        'No NCEI normals stations found near this location'
      );
    }

    const daysInMonth = getDaysInMonth(month);

    // Probe nearest stations until one has both daily temperature normals and a
    // monthly precipitation normal, so the result is fully sourced from NCEI.
    for (const station of stations.slice(0, MAX_STATION_ATTEMPTS)) {
      const temps = await this.fetchDailyTemperatureNormals(station.id, dailyDate);
      if (!temps) {
        continue;
      }

      const monthlyPrecip = await this.fetchMonthlyPrecipitationNormal(station.id, monthlyDate);
      if (monthlyPrecip === null) {
        continue;
      }

      const normals: ClimateNormals = {
        tempHigh: round1(temps.tmax),
        tempLow: round1(temps.tmin),
        precipitation: round2(monthlyPrecip / daysInMonth),
        source: 'NCEI',
        month,
        day
      };

      logger.info('Resolved NCEI climate normals', {
        ...redacted,
        month,
        day,
        station: station.id,
        distanceKm: Math.round(station.distanceKm)
      });

      if (CacheConfig.enabled) {
        this.cache.set(cacheKey, normals, Infinity);
      }
      return normals;
    }

    throw new DataNotFoundError(
      'NCEI',
      'No NCEI station with complete normals found near this location'
    );
  }

  /**
   * Find stations carrying daily normals near a coordinate, sorted by distance.
   * Expands the search extent once if the initial bounding box is empty.
   */
  private async findNearbyStations(
    latitude: number,
    longitude: number
  ): Promise<NCEIStationWithDistance[]> {
    for (const halfExtent of [STATION_SEARCH_DEGREES, STATION_SEARCH_DEGREES_WIDE]) {
      // CDO extent format is "minlat,minlng,maxlat,maxlng" (south,west,north,east).
      const extent = [
        latitude - halfExtent,
        longitude - halfExtent,
        latitude + halfExtent,
        longitude + halfExtent
      ].join(',');

      const response = await this.client.get<NCEIStationsResponse>('/stations', {
        params: {
          datasetid: DATASET_DAILY_NORMALS,
          extent,
          limit: 50
        }
      });

      const results = response.data?.results ?? [];
      if (results.length > 0) {
        return results
          .map(station => ({
            ...station,
            distanceKm: calculateDistance(latitude, longitude, station.latitude, station.longitude)
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm);
      }
    }

    return [];
  }

  /**
   * Read daily high/low temperature normals (°F) for a station on a given date.
   * Returns null if either value is missing.
   */
  private async fetchDailyTemperatureNormals(
    stationId: string,
    date: string
  ): Promise<{ tmax: number; tmin: number } | null> {
    const response = await this.client.get<NCEIDataResponse>('/data', {
      params: {
        datasetid: DATASET_DAILY_NORMALS,
        stationid: stationId,
        startdate: date,
        enddate: date,
        datatypeid: ['DLY-TMAX-NORMAL', 'DLY-TMIN-NORMAL'],
        units: 'standard',
        limit: 10
      }
    });

    const results = response.data?.results ?? [];
    const tmax = results.find(r => r.datatype === 'DLY-TMAX-NORMAL')?.value;
    const tmin = results.find(r => r.datatype === 'DLY-TMIN-NORMAL')?.value;

    if (!isValidValue(tmax) || !isValidValue(tmin)) {
      return null;
    }
    return { tmax, tmin };
  }

  /**
   * Read the monthly precipitation normal (inches) for a station's month.
   * Returns null if the value is missing.
   */
  private async fetchMonthlyPrecipitationNormal(
    stationId: string,
    monthDate: string
  ): Promise<number | null> {
    const response = await this.client.get<NCEIDataResponse>('/data', {
      params: {
        datasetid: DATASET_MONTHLY_NORMALS,
        stationid: stationId,
        startdate: monthDate,
        enddate: monthDate,
        datatypeid: ['MLY-PRCP-NORMAL'],
        units: 'standard',
        limit: 10
      }
    });

    const value = response.data?.results?.find(r => r.datatype === 'MLY-PRCP-NORMAL')?.value;
    return isValidValue(value) ? value : null;
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

/** Zero-pad a 1-2 digit number to two characters. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Days in a given month, using the (non-leap) normals reference year. */
function getDaysInMonth(month: number): number {
  return new Date(NORMALS_REFERENCE_YEAR, month, 0).getDate();
}

/** A CDO value is valid if present and above the missing-value sentinel range. */
function isValidValue(value: number | undefined): value is number {
  return typeof value === 'number' && value > MISSING_VALUE_THRESHOLD;
}

/** Round to one decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Round to two decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
