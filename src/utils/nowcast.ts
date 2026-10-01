/**
 * Pure core of the 15-minute precipitation nowcast (`get_forecast`,
 * `granularity: "minutely"`): model selection boxes, three-state response
 * classification, quarter bands, hourly-probability pick and quarter timing.
 *
 * Zero I/O. The service imports from here, never the reverse.
 */

import { displayValue } from './displayBanding.js';

export type NowcastModel = 'gfs_hrrr' | 'icon_d2';

export const NOWCAST_MODELS: Record<NowcastModel, { label: string; cadence: string }> = {
  gfs_hrrr: { label: 'HRRR (NOAA)', cadence: 'updates hourly' },
  icon_d2: { label: 'ICON-D2 (DWD)', cadence: 'updates every 3 hours' },
};

interface Box {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

// These boxes are SUPERSETS of every observed 400 edge (design, "Measured"). They
// never decide "covered" -- only "worth asking". The upstream response decides
// (G53): a rendered coverage claim must not rest on a routing heuristic.
const HRRR_BOX: Box = { latMin: 21, latMax: 58, lonMin: -135, lonMax: -60 };
const ICON_D2_BOX: Box = { latMin: 43, latMax: 59, lonMin: -4, lonMax: 21 };

function inBox(lat: number, lon: number, box: Box): boolean {
  return lat >= box.latMin && lat <= box.latMax && lon >= box.lonMin && lon <= box.lonMax;
}

/** Pick the model worth asking for a point, or null when no box contains it. Inclusive bounds. */
export function selectNowcastModel(lat: number, lon: number): NowcastModel | null {
  if (inBox(lat, lon, HRRR_BOX)) {
    return 'gfs_hrrr';
  }
  if (inBox(lat, lon, ICON_D2_BOX)) {
    return 'icon_d2';
  }
  return null;
}

/** The exact `reason` Open-Meteo returns with a 400 for a point the model does not serve. */
export const NOWCAST_NO_DATA_REASON = 'No data is available for this location';

export type NowcastClassification = 'covered' | 'not-covered' | 'error';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Classify one Open-Meteo nowcast answer.
 *
 * - 200 with at least one finite `minutely_15.precipitation` value: covered.
 * - 200 without one (absent, not an array, all null -- the HRRR null band): not-covered.
 *   A populated `precipitation_probability` does not make it covered.
 * - 400 whose body is a plain object with exactly the no-data reason: not-covered.
 * - Anything else (other reason, '' or null body -- G111, non-object body, other status): error.
 */
export function classifyNowcastResponse(status: number, data: unknown): NowcastClassification {
  if (status === 200) {
    const minutely = isPlainObject(data) ? data['minutely_15'] : undefined;
    const precipitation = isPlainObject(minutely) ? minutely['precipitation'] : undefined;
    if (
      Array.isArray(precipitation) &&
      precipitation.some((v: unknown) => typeof v === 'number' && Number.isFinite(v))
    ) {
      return 'covered';
    }
    return 'not-covered';
  }
  if (status === 400) {
    if (isPlainObject(data) && data['reason'] === NOWCAST_NO_DATA_REASON) {
      return 'not-covered';
    }
    return 'error';
  }
  return 'error';
}

export type NowcastBand = 'none' | 'trace' | 'light' | 'moderate' | 'heavy';

/**
 * Band thresholds in mm per 15 minutes, applied to the value rounded to 2 dp.
 * A project heuristic, not an official rating. `trace`: > 0 and < trace-limit;
 * `light` < lightBelow; `moderate` < moderateBelow; `heavy` >= moderateBelow.
 */
export const NOWCAST_BAND_THRESHOLDS_MM = {
  traceBelow: 0.1,
  lightBelow: 0.7,
  moderateBelow: 2.0,
} as const;

/** Band one 15-minute amount (mm). null for null, non-finite or negative: never `none` (G56). */
export function bandForQuarter(mm: number | null | undefined): NowcastBand | null {
  if (mm === null || mm === undefined || !Number.isFinite(mm) || mm < 0) {
    return null;
  }
  const shown = displayValue(mm, 2);
  if (shown === 0) {
    return 'none';
  }
  if (shown < NOWCAST_BAND_THRESHOLDS_MM.traceBelow) {
    return 'trace';
  }
  if (shown < NOWCAST_BAND_THRESHOLDS_MM.lightBelow) {
    return 'light';
  }
  if (shown < NOWCAST_BAND_THRESHOLDS_MM.moderateBelow) {
    return 'moderate';
  }
  return 'heavy';
}

const QUARTER_MS = 15 * 60 * 1000;
const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/**
 * Epoch ms of a quarter start. `localIso` is Open-Meteo `timezone=auto` local time
 * with no offset ("2026-10-01T15:00"); `utcOffsetSeconds` is the response's
 * `utc_offset_seconds`. Parsed by hand: `new Date(localIso)` depends on the host zone.
 * Returns NaN for an unparseable string.
 */
export function quarterEpochMs(localIso: string, utcOffsetSeconds: number): number {
  const m = LOCAL_ISO.exec(localIso);
  if (!m) {
    return NaN;
  }
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - utcOffsetSeconds * 1000;
}

/** Indices of quarters whose end (start + 15 min) is after `nowMs`. */
export function liveQuarterIndices(
  times: readonly string[],
  utcOffsetSeconds: number,
  nowMs: number
): number[] {
  const out: number[] = [];
  times.forEach((t, i) => {
    const start = quarterEpochMs(t, utcOffsetSeconds);
    if (Number.isFinite(start) && start + QUARTER_MS > nowMs) {
      out.push(i);
    }
  });
  return out;
}

/**
 * One entry per on-the-hour (`:00`) quarter among `indices` with a finite probability.
 * Open-Meteo interpolates probability between hours, so only the on-the-hour value
 * is a model figure; interpolated quarters are never read.
 */
export function hourlyProbabilities(
  times: readonly string[],
  probabilities: ReadonlyArray<number | null | undefined>,
  indices: readonly number[]
): Array<{ index: number; percent: number }> {
  const out: Array<{ index: number; percent: number }> = [];
  for (const index of indices) {
    const time = times[index];
    const p = probabilities[index];
    if (typeof time === 'string' && time.endsWith(':00') && typeof p === 'number' && Number.isFinite(p)) {
      out.push({ index, percent: p });
    }
  }
  return out;
}

/** Ms until the next UTC quarter-hour boundary, clamped to [1000, 900000]. */
export function msUntilNextQuarter(nowMs: number): number {
  const remainder = QUARTER_MS - (((nowMs % QUARTER_MS) + QUARTER_MS) % QUARTER_MS);
  return Math.min(QUARTER_MS, Math.max(1000, remainder));
}
