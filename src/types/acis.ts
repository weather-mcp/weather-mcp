/**
 * Type definitions for the RCC ACIS (Applied Climate Information System) API.
 *
 * Documentation: https://www.rcc-acis.org/docs_webservices.html
 *
 * ACIS is a free, keyless, POST-based JSON API. Every observed value is
 * returned as a **string** — a plain number ("96"), "M" for missing, or "T"
 * for trace — so numeric fields must always be parsed defensively rather than
 * trusted as numbers.
 */

/**
 * A single station entry from a `/StnMeta` response
 * (requested with `meta: "name,sids,ll,valid_daterange"`).
 */
export interface AcisStnMetaStation {
  name: string;
  /**
   * Station identifiers across contributing networks, e.g. "USW00024233 6".
   * A "threaded" (stitched, longest-continuous-record) identifier typically
   * contains "thr" (e.g. "BOSthr").
   */
  sids: string[];
  /** [longitude, latitude]. */
  ll: [number, number];
  /**
   * One [start, end] ISO date pair per requested elem (here: maxt, mint), in
   * the same order as the `elems` request parameter.
   */
  valid_daterange: [string, string][];
}

export interface AcisStnMetaResponse {
  meta: AcisStnMetaStation[];
}

/**
 * A single [value, date-of-record] pair from a `/StnData` `smry` summary.
 * `value` is a string: a plain number, "M" (missing), or "T" (trace).
 */
export type AcisSmryEntry = [string, string];

export interface AcisStnDataResponse {
  meta?: { name?: string; sids?: string[] };
  /**
   * [maxt 366-entry table, mint 366-entry table], each entry indexed by
   * leap-calendar day-of-year (see `dayOfYearIndex` in `../services/acis.js`)
   * and holding `[value, date-of-record]`.
   */
  smry: [AcisSmryEntry[], AcisSmryEntry[]];
}

/** One parsed record value: the extreme temperature (°F) and the year it was set. */
export interface DailyRecordValue {
  value: number;
  year: number;
}

/**
 * A single leap-calendar day-of-year slot. Either side may be absent when the
 * source value was "M" (missing) or otherwise unparseable.
 */
export interface DailyRecordSlot {
  high?: DailyRecordValue;
  low?: DailyRecordValue;
}

/** A parsed, ready-to-index 366-slot daily records table for one station. */
export interface DailyRecords {
  stationName: string;
  /** First year of the station's period of record (from StnMeta `valid_daterange`). */
  porStartYear: number;
  /** Indexed by leap-calendar day-of-year (see `dayOfYearIndex`); length 366. */
  days: DailyRecordSlot[];
}

/** A selected station candidate for records lookups. */
export interface AcisStation {
  id: string;
  name: string;
  porStartYear: number;
}
