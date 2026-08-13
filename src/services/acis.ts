/**
 * Service for interacting with the RCC ACIS (Applied Climate Information
 * System) API — https://data.rcc-acis.org
 *
 * ACIS provides US daily temperature records (record high/low for a given
 * calendar date, and the year each was set) for stations with a sufficiently
 * long period of record. Unlike NCEI, ACIS is **keyless** (no signup, no
 * published rate limits) and **POST-based** (JSON request bodies rather than
 * query strings).
 *
 * Retrieval works in two steps:
 *   1. `findRecordsStation` — find the nearby station with the longest
 *      period of record (preferring "threaded" stitched-record station IDs).
 *   2. `getDailyRecords` — fetch that station's full 366-slot daily
 *      high/low record table in a single call.
 *
 * Records are garnish, never load-bearing: this service throws on failure
 * (no station found, malformed response, network error) exactly like NCEI's
 * client, and it is the caller's job — `src/utils/records.ts` — to catch
 * those failures and omit the records line rather than fail the tool call.
 */

import axios, { AxiosInstance } from 'axios';
import type {
  AcisSmryEntry,
  AcisStation,
  AcisStnDataResponse,
  AcisStnMetaResponse,
  AcisStnMetaStation,
  DailyRecords,
  DailyRecordSlot,
  DailyRecordValue
} from '../types/acis.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { getUserAgent } from '../utils/version.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';

export interface AcisServiceConfig {
  baseURL?: string;
  timeout?: number;
}

/** Elements requested from ACIS: daily maximum and minimum temperature. */
const ELEMS = 'maxt,mint';
/** Station metadata fields requested from `/StnMeta`. */
const META_FIELDS = 'name,sids,ll,valid_daterange';

/** Initial station-search half-extent in degrees. */
const STATION_SEARCH_DEGREES = 0.25;
/** Expanded half-extent used if the initial bbox finds no stations. */
const STATION_SEARCH_DEGREES_WIDE = 0.5;

/** Number of leap-calendar day-of-year slots in a full daily records table. */
const DAYS_IN_LEAP_YEAR = 366;

/**
 * Cumulative day count before each month (0-indexed, Jan = index 0) in a
 * **leap** year. Used to index the 366-slot ACIS records table by
 * month/day position rather than by ordinal day, so Feb 29 is a real slot
 * and post-February dates never shift between leap and common years.
 */
const LEAP_YEAR_MONTH_START: readonly number[] = [
  0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335
];

/**
 * Compute the 0-based index of a month/day in the leap-calendar day-of-year
 * table used by `getDailyRecords`. Pure, deterministic, no I/O.
 *
 * Examples: Jan 1 → 0, Feb 29 → 59, Mar 1 → 60 (same index whether or not
 * the *current* year is a leap year — the table is always 366 slots wide),
 * Aug 12 → 224, Dec 31 → 365.
 */
export function dayOfYearIndex(month: number, day: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid month: ${month}`);
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError(`Invalid day: ${day}`);
  }
  return LEAP_YEAR_MONTH_START[month - 1] + (day - 1);
}

/**
 * RCC ACIS API client.
 *
 * Provides US daily temperature records (highs/lows by calendar date, with
 * the year each was set). No API key required.
 */
export class AcisService {
  private client: AxiosInstance;
  private cache: Cache<unknown>;

  constructor(config: AcisServiceConfig = {}) {
    const {
      baseURL = 'https://data.rcc-acis.org',
      timeout = CacheConfig.apiTimeoutMs
    } = config;

    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': getUserAgent()
      }
    });

    this.client.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );
  }

  /**
   * Find the best nearby station carrying daily maxt/mint records, preferring
   * the longest period of record and, among ties, a "threaded" (stitched)
   * station identifier. Widens the search bbox once if the initial extent
   * finds no stations.
   *
   * @throws {Error} If no station with a usable period of record is found.
   */
  async findRecordsStation(latitude: number, longitude: number): Promise<AcisStation> {
    const redacted = redactCoordinatesForLogging(latitude, longitude);

    // Station identity barely changes; cache hard (30 days, per D4).
    const cacheKey = Cache.generateKey(
      'acis-station',
      latitude.toFixed(2),
      longitude.toFixed(2)
    );
    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey) as AcisStation | undefined;
      if (cached) {
        logger.info('ACIS records station cache hit', redacted);
        return cached;
      }
    }

    for (const halfExtent of [STATION_SEARCH_DEGREES, STATION_SEARCH_DEGREES_WIDE]) {
      const bbox = buildBbox(latitude, longitude, halfExtent);

      const response = await this.client.post<AcisStnMetaResponse>('/StnMeta', {
        bbox,
        elems: ELEMS,
        meta: META_FIELDS
      });

      const stations = response.data?.meta ?? [];
      if (stations.length === 0) {
        continue;
      }

      const best = selectBestStation(stations);
      if (best) {
        logger.info('Resolved ACIS records station', {
          ...redacted,
          station: best.id,
          porStartYear: best.porStartYear
        });

        if (CacheConfig.enabled) {
          this.cache.set(cacheKey, best, CacheConfig.ttl.recordsStation);
        }
        return best;
      }
    }

    throw new Error('No ACIS station with a usable period of record found near this location');
  }

  /**
   * Fetch a station's full 366-slot daily high/low temperature record table
   * in a single call. Station name and period-of-record start year are
   * passed through from `findRecordsStation` (already known — no second
   * metadata request needed) and packaged into the returned `DailyRecords`.
   *
   * @throws {Error} If the response is missing or malformed.
   */
  async getDailyRecords(
    stationId: string,
    stationName: string,
    porStartYear: number
  ): Promise<DailyRecords> {
    // Records change at most when a record is broken; cache hard (7 days, per D4).
    const cacheKey = Cache.generateKey('acis-records', stationId);
    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey) as DailyRecords | undefined;
      if (cached) {
        logger.info('ACIS daily records cache hit', { station: stationId });
        return cached;
      }
    }

    const response = await this.client.post<AcisStnDataResponse>('/StnData', {
      sid: stationId,
      sdate: 'por',
      edate: 'por',
      elems: [
        {
          name: 'maxt',
          interval: 'dly',
          duration: 'dly',
          smry: { reduce: 'max', add: 'date' },
          smry_only: 1,
          groupby: 'year'
        },
        {
          name: 'mint',
          interval: 'dly',
          duration: 'dly',
          smry: { reduce: 'min', add: 'date' },
          smry_only: 1,
          groupby: 'year'
        }
      ]
    });

    const smry = response.data?.smry;
    if (
      !smry ||
      !Array.isArray(smry) ||
      smry.length < 2 ||
      !Array.isArray(smry[0]) ||
      !Array.isArray(smry[1]) ||
      smry[0].length !== DAYS_IN_LEAP_YEAR ||
      smry[1].length !== DAYS_IN_LEAP_YEAR
    ) {
      throw new Error(`Malformed ACIS StnData response for station ${stationId}`);
    }

    const days: DailyRecordSlot[] = [];
    for (let i = 0; i < DAYS_IN_LEAP_YEAR; i++) {
      days.push({
        high: parseSmryEntry(smry[0][i]),
        low: parseSmryEntry(smry[1][i])
      });
    }

    const records: DailyRecords = { stationName, porStartYear, days };

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, records, CacheConfig.ttl.records);
    }
    return records;
  }

  /**
   * Handle API errors. ACIS has no service literal in `ApiError` (it is not
   * one of the project's original data sources), so errors are surfaced as
   * plain `Error`s — this is fine because records are garnish: every caller
   * of this service catches failures and omits the records line rather than
   * propagating them (see `src/utils/records.ts`).
   * @private
   */
  private async handleError(error: unknown): Promise<never> {
    if (isAxiosLikeError(error)) {
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.message;
        throw new Error(message || `ACIS API returned status ${status}`);
      }

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new Error('ACIS request timed out');
      }

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error('Unable to connect to ACIS API');
      }

      if (error.message) {
        throw new Error(error.message);
      }
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred while contacting ACIS');
  }
}

/** Minimal structural shape of an axios-style error, checked without `any`. */
interface AxiosLikeError {
  response?: { status: number; data?: { message?: string } };
  code?: string;
  message?: string;
}

function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === 'object' && error !== null;
}

/** Build an ACIS `bbox` string ("west,south,east,north") around a coordinate. */
function buildBbox(latitude: number, longitude: number, halfExtent: number): string {
  const west = longitude - halfExtent;
  const south = latitude - halfExtent;
  const east = longitude + halfExtent;
  const north = latitude + halfExtent;
  return [west, south, east, north].join(',');
}

/** A station identifier is "threaded" (stitched, longest-continuous-record) if it contains "thr". */
function isThreadedSid(sid: string): boolean {
  return /thr/i.test(sid);
}

/** Pick the preferred sid to query `/StnData` with: a threaded id if present, else the first. */
function pickStationId(sids: string[] | undefined): string | undefined {
  if (!sids || sids.length === 0) {
    return undefined;
  }
  return sids.find(isThreadedSid) ?? sids[0];
}

function hasThreadedSid(sids: string[] | undefined): boolean {
  return sids !== undefined && sids.some(isThreadedSid);
}

/**
 * Compute a station's period-of-record start year and length (in days) from
 * its `valid_daterange` ranges (one pair per requested elem). Uses the
 * earliest start and latest end across all ranges.
 */
function computePeriodOfRecord(
  ranges: [string, string][] | undefined
): { startYear: number; lengthDays: number } | null {
  if (!ranges || ranges.length === 0) {
    return null;
  }

  let minStart: Date | null = null;
  let maxEnd: Date | null = null;

  for (const [startStr, endStr] of ranges) {
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      continue;
    }
    if (!minStart || start < minStart) {
      minStart = start;
    }
    if (!maxEnd || end > maxEnd) {
      maxEnd = end;
    }
  }

  if (!minStart || !maxEnd) {
    return null;
  }

  const lengthDays = (maxEnd.getTime() - minStart.getTime()) / (24 * 60 * 60 * 1000);
  return { startYear: minStart.getUTCFullYear(), lengthDays };
}

/**
 * Select the best station candidate from a `/StnMeta` result set: longest
 * period of record first, preferring a threaded station id as a tiebreaker.
 * Stations without a usable date range or station id are skipped.
 */
function selectBestStation(stations: AcisStnMetaStation[]): AcisStation | null {
  interface Candidate {
    id: string;
    name: string;
    porStartYear: number;
    porLengthDays: number;
    threaded: boolean;
  }

  const candidates: Candidate[] = [];
  for (const station of stations) {
    const id = pickStationId(station.sids);
    const record = computePeriodOfRecord(station.valid_daterange);
    if (!id || !record) {
      continue;
    }
    candidates.push({
      id,
      name: station.name,
      porStartYear: record.startYear,
      porLengthDays: record.lengthDays,
      threaded: hasThreadedSid(station.sids)
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (b.porLengthDays !== a.porLengthDays) {
      return b.porLengthDays - a.porLengthDays;
    }
    return Number(b.threaded) - Number(a.threaded);
  });

  const best = candidates[0];
  return { id: best.id, name: best.name, porStartYear: best.porStartYear };
}

/** Parse a single ACIS `[value, date]` smry entry into a record value, or `undefined` if unusable. */
function parseSmryEntry(entry: AcisSmryEntry | undefined): DailyRecordValue | undefined {
  if (!entry) {
    return undefined;
  }
  const [rawValue, rawDate] = entry;
  const value = parseAcisNumber(rawValue);
  if (value === undefined) {
    return undefined;
  }
  const year = parseAcisYear(rawDate);
  if (year === undefined) {
    return undefined;
  }
  return { value, year };
}

/** ACIS values arrive as strings: a plain number, "M" (missing), or "T" (trace). */
function parseAcisNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === 'M' || raw === 'T' || raw.trim() === '') {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Extract the 4-digit year from an ACIS date string ("1977-08-12"). */
function parseAcisYear(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const match = /^(\d{4})-/.exec(raw);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : undefined;
}
