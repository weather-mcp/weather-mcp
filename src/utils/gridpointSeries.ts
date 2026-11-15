/**
 * NWS gridpoint series: validTime intervals, the value at an instant, and the
 * maximum over a window. Pure: reads no clock; callers pass the instants.
 */
import { logger } from './logger.js';

export interface GridpointInterval {
  startMs: number;
  endMs: number;
}

/** Defense-in-depth cap on the entries read from one gridpoint series. */
export const GRIDPOINT_MAX_ENTRIES = 500;

interface SeriesLike {
  values?: ReadonlyArray<{ validTime?: unknown; value?: unknown }>;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DURATION_RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/;
// A start must carry its own zone: a naive one would be read in the server's zone.
const ZONED_START_RE = /(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Parse an ISO 8601 `start/duration` validTime. Returns null for anything
 * that is not a zoned start plus a day/hour/minute duration of positive length.
 */
export function parseValidTime(validTime: unknown): GridpointInterval | null {
  if (typeof validTime !== 'string') {
    return null;
  }
  const parts = validTime.split('/');
  if (parts.length !== 2) {
    return null;
  }
  const [start, duration] = parts as [string, string];
  if (!ZONED_START_RE.test(start)) {
    return null;
  }
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs)) {
    return null;
  }
  const match = DURATION_RE.exec(duration);
  if (!match) {
    return null;
  }
  const [, d, h, m] = match;
  if (d === undefined && h === undefined && m === undefined) {
    return null;
  }
  // A T must introduce at least one time component (P1DT is malformed).
  if (duration.includes('T') && h === undefined && m === undefined) {
    return null;
  }
  const total = Number(d ?? 0) * DAY_MS + Number(h ?? 0) * HOUR_MS + Number(m ?? 0) * MINUTE_MS;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  return { startMs, endMs: startMs + total };
}

function boundedValues(series: SeriesLike | undefined, maxEntries: number): ReadonlyArray<{ validTime?: unknown; value?: unknown }> {
  const values = series?.values;
  if (!values || values.length === 0) {
    return [];
  }
  if (values.length > maxEntries) {
    logger.warn('Gridpoint series exceeds max entries', {
      length: values.length,
      maxEntries,
      securityEvent: true
    });
    return values.slice(0, maxEntries);
  }
  return values;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * The value of the interval containing nowMs (start inclusive, end exclusive).
 * The first containing interval decides; no containing interval gives null.
 */
export function valueAt(
  series: SeriesLike | undefined,
  nowMs: number,
  maxEntries: number = GRIDPOINT_MAX_ENTRIES
): number | null {
  for (const entry of boundedValues(series, maxEntries)) {
    const interval = parseValidTime(entry.validTime);
    if (interval && interval.startMs <= nowMs && nowMs < interval.endMs) {
      return finiteOrNull(entry.value);
    }
  }
  return null;
}

/**
 * The largest finite value among intervals overlapping [fromMs, toMs]
 * (an interval counts when endMs > fromMs and startMs <= toMs).
 */
export function maxOverlapping(
  series: SeriesLike | undefined,
  fromMs: number,
  toMs: number,
  maxEntries: number = GRIDPOINT_MAX_ENTRIES
): number | null {
  let max: number | null = null;
  for (const entry of boundedValues(series, maxEntries)) {
    const interval = parseValidTime(entry.validTime);
    if (!interval || !(interval.endMs > fromMs && interval.startMs <= toMs)) {
      continue;
    }
    const v = finiteOrNull(entry.value);
    if (v !== null && (max === null || v > max)) {
      max = v;
    }
  }
  return max;
}
