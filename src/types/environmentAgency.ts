/**
 * Type definitions for the UK Environment Agency (EA) flood-monitoring API
 * (https://environment.data.gov.uk/flood-monitoring/). Keyless, JSON.
 * Every field is optional — third-party response shapes are never trusted.
 *
 * Endpoints modelled here:
 *   1. GET /id/stations?lat&long&dist&parameter=level   — station list
 *   2. GET /id/stations/{ref}?_view=full                — single station detail
 *   3. GET /data/readings?latest&parameter=level         — national bulk latest readings
 */

/**
 * Flood-stage threshold fields, as returned on the per-station detail
 * endpoint (`/id/stations/{ref}?_view=full`). Not present on the station
 * list endpoint, where `stageScale` instead arrives as a URL string — see
 * `EAStation.stageScale`.
 */
export interface EAStageScale {
  '@id'?: string;
  datum?: number;
  highestRecent?: {
    '@id'?: string;
    dateTime?: string; // ISO 8601 datetime
    value?: number;
  };
  maxOnRecord?: {
    '@id'?: string;
    dateTime?: string; // ISO 8601 datetime
    value?: number;
  };
  minOnRecord?: {
    '@id'?: string;
    dateTime?: string; // ISO 8601 datetime
    value?: number;
  };
  scaleMax?: number;
  typicalRangeHigh?: number;
  typicalRangeLow?: number;
}

/**
 * A single reading, as returned inline on a measure's `latestReading` when
 * fetched via `/id/stations/{ref}?_view=full`. On the plain station-list
 * endpoint `latestReading` instead arrives as a URL string identifying this
 * resource, not the object itself — see `EAMeasure.latestReading`. This is
 * the same flat-typed-field trap as issue #84 on a second upstream: a field
 * typed flat but object on the wire, compared silently and never matching.
 * Consumers must narrow on `typeof === 'object'` before reading `value`.
 */
export interface EAReading {
  '@id'?: string;
  date?: string; // Calendar date, e.g. "2026-09-02"
  dateTime?: string; // ISO 8601 datetime
  measure?: string; // URL identifying the measure this reading belongs to
  value?: number;
}

/**
 * One measure (e.g. water level, or a specific sensor) published for a
 * station. `period` is the publication interval in seconds — every level
 * measure sampled live publishes `period: 900` (15 minutes).
 */
export interface EAMeasure {
  '@id'?: string;
  parameter?: string; // e.g. "level"
  parameterName?: string; // e.g. "Water Level"
  qualifier?: string; // e.g. "Stage", "Downstream Stage"
  unitName?: string; // Observed live on L2402: "m", "mAOD", and the placeholder "---"
  period?: number; // Publication interval, seconds (900 observed on every level measure)
  /**
   * A union, never the object shape alone. On the station list endpoint this
   * arrives as a URL string; only `/id/stations/{ref}?_view=full` inlines the
   * object with `dateTime`/`value`. Narrow on `typeof === 'object'`.
   */
  latestReading?: string | EAReading;
}

/**
 * A monitoring station. Fetched either as a member of the station-list
 * endpoint's `items` array, or singly (with more detail) via
 * `/id/stations/{ref}?_view=full`.
 */
export interface EAStation {
  '@id'?: string;
  notation?: string; // Station reference, e.g. "L2402"
  stationReference?: string; // Same identifier, alternate field name observed live
  label?: string | string[]; // Usually a string; some stations publish an array of names
  riverName?: string;
  catchmentName?: string;
  town?: string;
  lat?: number;
  long?: number;
  easting?: number;
  northing?: number;
  gridReference?: string;
  status?: string; // URL identifying operational status
  dateOpened?: string; // ISO 8601 date
  /**
   * A union, never the object shape alone. On the station-list endpoint this
   * arrives as a URL string; only `/id/stations/{ref}?_view=full` inlines the
   * object with `datum`/`typicalRangeHigh`/`typicalRangeLow`/etc. Narrow on
   * `typeof === 'object'`.
   */
  stageScale?: string | EAStageScale;
  measures?: EAMeasure | EAMeasure[];
}

/**
 * One item from the national bulk latest-readings pull
 * (`/data/readings?latest&parameter=level`). Unlike the inline reading on a
 * station-detail measure, this shape always carries `measure` as a URL
 * string identifying which measure the reading belongs to — there is no
 * object-vs-string ambiguity here, because this endpoint has no nested
 * station/measure context to inline into.
 */
export interface EABulkReadingItem {
  '@id'?: string;
  date?: string; // Calendar date, e.g. "2026-09-02"
  dateTime?: string; // ISO 8601 datetime
  measure?: string; // URL identifying the measure this reading belongs to
  value?: number;
}

/**
 * Envelope common to every flood-monitoring API response. `items` is the
 * payload; on a single-resource fetch (e.g. one station by reference) the
 * API has been observed to return a single object rather than a one-element
 * array, so callers must normalise (`Array.isArray` check) rather than
 * assume an array.
 */
export interface EAResponse<T> {
  '@context'?: string;
  meta?: {
    publisher?: string;
    licence?: string;
    documentation?: string;
    version?: string;
    comment?: string;
    hasFormat?: string[];
  };
  items?: T | T[];
}

/** Response from `/id/stations?lat&long&dist&parameter=level`. */
export type EAStationListResponse = EAResponse<EAStation>;

/** Response from `/id/stations/{ref}?_view=full`. */
export type EAStationDetailResponse = EAResponse<EAStation>;

/** Response from `/data/readings?latest&parameter=level`. */
export type EABulkReadingsResponse = EAResponse<EABulkReadingItem>;
