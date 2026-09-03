/**
 * Service for the keyless UK Environment Agency flood-monitoring API
 * (https://environment.data.gov.uk/flood-monitoring/), which publishes
 * observed 15-minute river levels from a dense real gauge network in England
 * and across the English border, under the Open Government Licence v3.
 *
 * **Routing position.** `get_river_conditions` routes US points to NOAA NWPS
 * and everything else to Open-Meteo Flood (GloFAS). This service is the third
 * arm: `auto` selects it inside the Great Britain routing box once the country
 * code resolves to `gb`, and `source: "ea"` forces it anywhere. There is no
 * cross-fallback — an observed level in metres and a modeled discharge in m³/s
 * are different claims about different quantities.
 *
 * **Contract, not garnish.** This is river-safety output. A failed EA fetch
 * **propagates** with a fixed sanitized message; it must never degrade to an
 * empty gauge list, because an empty gauge list reads as "no flooding here".
 * The *typical range* alone is garnish **within** that contract: a station
 * whose detail fetch fails renders its level without a range and says nothing
 * more, with no retry and no added latency on failure.
 *
 * **G7 — the threshold projection, and why it is the sharpest rule here.**
 * `/id/stations/{ref}?_view=full` returns the 24-hour-stable `stageScale`
 * **and** each measure's 15-minute-volatile `latestReading` in the same
 * response body. Caching that response whole at 24 h would serve a day-old
 * river level as current on a safety-critical surface. So `getStationDetail`
 * caches a **projected object carrying the threshold numbers only** — never
 * the raw response and never a spread of it. Nothing this method returns can
 * carry a reading, by construction rather than by discipline.
 *
 * The station *list* endpoint is safe to cache at 24 h for the same reason
 * inverted: its `measures` carry `@id`, `qualifier`, `unitName` and `period`
 * but **no** `latestReading` at all (verified live 2026-09-02). Levels come
 * from the separately-cached 15-minute bulk pull, joined on the measure URL.
 *
 * **One national bulk pull, never one request per station.** Measured
 * 2026-09-02: `/data/readings?latest&parameter=level` returns every latest
 * level reading in the network — 4,106 items, 1,305,560 bytes — in a single
 * request costing about the same as the station-list request it accompanies,
 * and one cached copy serves every British query. The geographic filters do
 * not exist: `/id/measures?lat&long&dist` and `/data/readings?latest&lat&long&dist`
 * both answer HTTP 400, "Did not recognize request parameters [dist, lat, long]
 * as valid for this endpoint".
 *
 * **G6 — cache unfiltered, filter at read.** Both the station list and the
 * bulk readings map are cached complete; the `riverName` filter and the
 * per-query selection run at read time in `src/utils/eaGauges.ts`.
 *
 * **Errors.** Plain fixed-message `Error`s, never `ApiError`: `ApiServiceName`
 * is a closed union and this is a peripheral service. No message or log
 * argument ever carries a URL or a raw axios error; logs carry `{ status, code }`
 * only. The API is keyless, so there is no secret to leak — the house pattern
 * is uniform and cheap to keep.
 */

import axios, { AxiosInstance } from 'axios';
import type {
  EABulkReadingItem,
  EABulkReadingsResponse,
  EAStageScale,
  EAStation,
  EAStationDetailResponse,
  EAStationListResponse
} from '../types/environmentAgency.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { logger } from '../utils/logger.js';
import { getUserAgent } from '../utils/version.js';

/** Base URL for every flood-monitoring endpoint this service reads. */
const EA_BASE_URL = 'https://environment.data.gov.uk/flood-monitoring';

/**
 * Transport-level body bound. Set **deliberately above** the measured
 * 1,305,560-byte bulk readings payload (2026-09-02) rather than left at a
 * default that would truncate it — a silently truncated bulk pull is a map
 * missing river levels, which renders as gauges with no reading.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Defence-in-depth caps on the parsed arrays. Both are set well above the
 * measured live sizes (80 stations at a 25 km radius; 4,106 bulk readings), so
 * a trim means the upstream shape changed, not that a normal query is large.
 * A trim is disclosed to the caller rather than swallowed — see G8: a cap that
 * trims a set must never quietly change what the user is told.
 */
const MAX_STATIONS = 1000;
const MAX_READINGS = 25000;

/** One latest reading, reduced to the two fields the render path uses. */
export interface EALatestReading {
  /** ISO 8601 observation time, as published. */
  dateTime: string;
  /** Level in the measure's own `unitName`. */
  value: number;
}

/**
 * The **only** thing `getStationDetail` returns, and therefore the only thing
 * that reaches the 24-hour `eaStationDetail` cache entry. It is a projection,
 * not a subset view of the response: there is no reading field on this type to
 * populate, so a future edit cannot accidentally cache one (G7).
 */
export interface EAStationThresholds {
  /** Datum the stage is measured against, metres. */
  datum?: number;
  /** Top of the gauge's published typical range, metres. */
  typicalRangeHigh?: number;
  /** Bottom of the gauge's published typical range, metres. */
  typicalRangeLow?: number;
  /** Top of the gauge's published scale, metres. */
  scaleMax?: number;
}

/** Station list plus whether the defensive cap trimmed it. */
export interface EAStationsResult {
  stations: EAStation[];
  /** True when `MAX_STATIONS` trimmed the parsed list; the caller must disclose it. */
  truncated: boolean;
}

/** Latest-readings map (keyed by measure URL) plus whether the cap trimmed it. */
export interface EALatestReadingsResult {
  readings: Map<string, EALatestReading>;
  /** True when `MAX_READINGS` trimmed the parsed list; the caller must disclose it. */
  truncated: boolean;
}

/** Minimal structural shape of an axios-style error, checked without `any`. */
interface AxiosLikeError {
  response?: { status: number };
  code?: string;
  message?: string;
}

/**
 * Structural guard rather than `axios.isAxiosError`: unit tests mock the axios
 * module down to `default.create`, so an imported helper or an `AxiosError`
 * class reference would be undefined there.
 */
function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === 'object' && error !== null;
}

/**
 * Normalise the API's `items`, which is an array on collection endpoints and a
 * bare object on a single-resource fetch.
 */
function toItemArray<T>(items: T | T[] | undefined): T[] {
  if (items === undefined || items === null) {
    return [];
  }
  return Array.isArray(items) ? items : [items];
}

export interface EnvironmentAgencyServiceConfig {
  timeout?: number;
  /** Base URL override, so tests can point at a fixture host. */
  baseUrl?: string;
}

export class EnvironmentAgencyService {
  private client: AxiosInstance;
  private cache: Cache<unknown>;
  private baseUrl: string;
  /**
   * Concurrent same-key pulls collapse onto one promise, deleted in `finally`
   * so a rejected pull is neither cached nor left behind for the next caller.
   */
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(config: EnvironmentAgencyServiceConfig = {}) {
    const { timeout = CacheConfig.apiTimeoutMs, baseUrl = EA_BASE_URL } = config;

    this.baseUrl = baseUrl;
    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      },
      // A 3xx is an error, never followed.
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES
    });
  }

  /**
   * Map a request failure to a fixed message. Never includes a URL, a response
   * body, or a raw axios error.
   */
  private toEAError(error: unknown): Error {
    if (isAxiosLikeError(error)) {
      // Checked *before* the `response` branch: an oversize-body rejection
      // carries no `response` at all, so testing `error.response` first would
      // misclassify it as a connection failure.
      if (error.code === 'ERR_BAD_RESPONSE' && /maxContentLength/.test(error.message ?? '')) {
        return new Error('Environment Agency flood-monitoring response too large');
      }

      if (error.response) {
        const status = error.response.status;
        if (status === 429) {
          return new Error('Environment Agency flood-monitoring rate limit exceeded');
        }
        if (status >= 500) {
          return new Error(
            `Environment Agency flood-monitoring server error (status ${status})`
          );
        }
        return new Error(`Environment Agency flood-monitoring returned status ${status}`);
      }

      if (
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ERR_CANCELED'
      ) {
        return new Error('Environment Agency flood-monitoring request timed out');
      }

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return new Error('Unable to connect to the Environment Agency flood-monitoring API');
      }
    }

    return new Error(
      'Unknown error occurred while contacting the Environment Agency flood-monitoring API'
    );
  }

  /** Log a failure with status/code only — never a URL, a body, or a message. */
  private logFailure(operation: string, error: unknown): void {
    const status = isAxiosLikeError(error) ? error.response?.status : undefined;
    const code = isAxiosLikeError(error) ? error.code : undefined;
    // The second argument is deliberately `undefined`. `logger.error` renders the
    // `Error` it is given, and an axios error carries the request URL and the
    // response body — exactly what this service must never log.
    logger.error('Environment Agency request failed', undefined, {
      service: 'EnvironmentAgency',
      operation,
      status,
      code
    });
  }

  /**
   * Cache-then-in-flight-then-fetch. The single-flight map is keyed by the same
   * cache key, so N concurrent callers make one request; the entry is removed in
   * `finally`, so a rejection is retried rather than remembered.
   */
  private async pull<T>(cacheKey: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached as T;
    }

    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      return existing as Promise<T>;
    }

    const pull = (async () => {
      const value = await fetcher();
      this.cache.set(cacheKey, value, ttlMs);
      return value;
    })().finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, pull);
    return pull;
  }

  /**
   * Every level-monitoring station within `distKm` of a point, **unfiltered**.
   * The `riverName` filter that establishes the tool's coverage claim runs at
   * read time, not here (G6).
   *
   * Cached at the 24-hour `stations` TTL, which is safe because this endpoint's
   * `measures` carry no `latestReading` — levels come from the 15-minute bulk
   * pull instead.
   */
  async getStationsNear(
    latitude: number,
    longitude: number,
    distKm: number
  ): Promise<EAStationsResult> {
    const cacheKey = Cache.generateKey('ea', 'stations', latitude, longitude, distKm);

    return this.pull(cacheKey, CacheConfig.ttl.stations, async () => {
      let response;
      try {
        response = await this.client.get<EAStationListResponse>(`${this.baseUrl}/id/stations`, {
          params: {
            lat: latitude,
            long: longitude,
            dist: distKm,
            parameter: 'level'
          }
        });
      } catch (error) {
        this.logFailure('getStationsNear', error);
        throw this.toEAError(error);
      }

      const parsed = toItemArray<EAStation>(response.data?.items);
      const truncated = parsed.length > MAX_STATIONS;
      if (truncated) {
        logger.warn('Environment Agency station list exceeds max entries', {
          service: 'EnvironmentAgency',
          length: parsed.length,
          maxEntries: MAX_STATIONS,
          securityEvent: true
        });
      }

      return {
        stations: truncated ? parsed.slice(0, MAX_STATIONS) : parsed,
        truncated
      };
    });
  }

  /**
   * The national bulk latest-level pull, cached whole and keyed by measure URL.
   *
   * One request serves every British query for the life of the 15-minute entry.
   * The map's key is the measure `@id`, which is exactly the value a station's
   * `measures[].@id` carries — verified live 2026-09-02, so the join is an
   * equality on a published identifier rather than a parsed convention.
   */
  async getLatestLevelReadings(): Promise<EALatestReadingsResult> {
    const cacheKey = Cache.generateKey('ea', 'readings-latest');

    return this.pull(cacheKey, CacheConfig.ttl.eaLatestReadings, async () => {
      let response;
      try {
        response = await this.client.get<EABulkReadingsResponse>(`${this.baseUrl}/data/readings`, {
          params: {
            latest: '',
            parameter: 'level'
          }
        });
      } catch (error) {
        this.logFailure('getLatestLevelReadings', error);
        throw this.toEAError(error);
      }

      const parsed = toItemArray<EABulkReadingItem>(response.data?.items);
      const truncated = parsed.length > MAX_READINGS;
      if (truncated) {
        logger.warn('Environment Agency bulk readings exceed max entries', {
          service: 'EnvironmentAgency',
          length: parsed.length,
          maxEntries: MAX_READINGS,
          securityEvent: true
        });
      }

      const bounded = truncated ? parsed.slice(0, MAX_READINGS) : parsed;
      const readings = new Map<string, EALatestReading>();
      for (const item of bounded) {
        // Guard on `!= null`, not `!== undefined`: JSON null survives the
        // stricter check and then coerces to 0 in arithmetic, which here would
        // be a fabricated river level of zero.
        if (
          typeof item.measure === 'string' &&
          typeof item.dateTime === 'string' &&
          item.value != null &&
          typeof item.value === 'number' &&
          Number.isFinite(item.value)
        ) {
          readings.set(item.measure, { dateTime: item.dateTime, value: item.value });
        }
      }

      return { readings, truncated };
    });
  }

  /**
   * The published typical range for one station, and **nothing else**.
   *
   * The upstream response also carries every measure's `latestReading`. That is
   * deliberately dropped here rather than returned and ignored by the caller:
   * this method's return type has no field a reading could occupy, so the
   * 24-hour cache entry cannot hold one (G7).
   *
   * `stageScale` is `string | object` across the two endpoints — a URL on the
   * station list, an object here. It is narrowed on `typeof === 'object'`; a
   * string yields no range rather than throwing.
   *
   * Returns `null` when the station publishes no usable `stageScale`. That is a
   * legitimate answer, not a failure: the caller renders the level without a
   * range.
   */
  async getStationDetail(stationReference: string): Promise<EAStationThresholds | null> {
    const cacheKey = Cache.generateKey('ea', 'station', stationReference);

    return this.pull(cacheKey, CacheConfig.ttl.eaStationDetail, async () => {
      let response;
      try {
        response = await this.client.get<EAStationDetailResponse>(
          `${this.baseUrl}/id/stations/${encodeURIComponent(stationReference)}`,
          { params: { _view: 'full' } }
        );
      } catch (error) {
        this.logFailure('getStationDetail', error);
        throw this.toEAError(error);
      }

      const station = toItemArray<EAStation>(response.data?.items)[0];
      const stageScale = station?.stageScale;

      // The list endpoint sends a URL string here; only `?_view=full` inlines
      // the object. A string is not a range and must not throw.
      if (typeof stageScale !== 'object' || stageScale === null) {
        return null;
      }

      const scale = stageScale as EAStageScale;
      const thresholds: EAStationThresholds = {
        datum: numberOrUndefined(scale.datum),
        typicalRangeHigh: numberOrUndefined(scale.typicalRangeHigh),
        typicalRangeLow: numberOrUndefined(scale.typicalRangeLow),
        scaleMax: numberOrUndefined(scale.scaleMax)
      };

      // Nothing usable published — say so, rather than caching an empty shell
      // that reads as "a range exists and is blank".
      if (
        thresholds.typicalRangeHigh === undefined &&
        thresholds.typicalRangeLow === undefined
      ) {
        return null;
      }

      return thresholds;
    });
  }
}

/**
 * A finite number, or `undefined`. JSON `null` survives `!== undefined` and
 * then coerces to 0 in arithmetic and conversion, so it is rejected here
 * rather than at each of the four call sites above.
 */
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
