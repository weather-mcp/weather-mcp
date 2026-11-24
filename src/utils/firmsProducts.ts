/**
 * FIRMS product table and freshness classifiers (pure, zero I/O).
 *
 * Two VIIRS NRT products are queried: NOAA-20 and NOAA-21. Suomi NPP is not a
 * row — its feed stopped updating, and its legacy code `N` survives only in
 * `satelliteDisplayName` for old cached or keyed rows.
 *
 * Dates are compared through parsed components and `Date.UTC`, never through
 * `new Date('YYYY-MM-DD')`, which reads in UTC and misprints west of it (G162).
 */

import type { FIRMSProduct, FIRMSProductFreshness } from '../types/firms.js';

const DAY_MS = 86_400_000;

/** A keyless flat file last modified more than this long ago is stale (24 h). */
export const FIRMS_LAST_MODIFIED_STALE_MS = 86_400_000;

/** A keyed `max_date` this many UTC calendar days behind today (or more) is stale. */
export const FIRMS_MAX_DATE_STALE_DAYS = 2;

/** The queried products, NOAA-20 first. Header lines and notes follow this order. */
export const FIRMS_PRODUCTS: readonly FIRMSProduct[] = [
  {
    id: 'VIIRS_NOAA20_NRT',
    flatFileDir: 'noaa-20-viirs-c2',
    flatFilePrefix: 'J1_VIIRS_C2',
    displayName: 'NOAA-20',
    satelliteCodes: ['N20', '1'],
  },
  {
    id: 'VIIRS_NOAA21_NRT',
    flatFileDir: 'noaa-21-viirs-c2',
    flatFilePrefix: 'J2_VIIRS_C2',
    displayName: 'NOAA-21',
    satelliteCodes: ['N21', '2'],
  },
];

const LEGACY_SATELLITE_NAMES: Readonly<Record<string, string>> = {
  N: 'Suomi NPP (VIIRS)',
};

/** Human-readable satellite name from a FIRMS satellite code. */
export function satelliteDisplayName(code: string): string {
  const product = FIRMS_PRODUCTS.find((p) => p.satelliteCodes.includes(code));
  if (product) {
    return `${product.displayName} (VIIRS)`;
  }
  const legacy = Object.prototype.hasOwnProperty.call(LEGACY_SATELLITE_NAMES, code)
    ? LEGACY_SATELLITE_NAMES[code]
    : undefined;
  return legacy ?? (code || 'Unknown');
}

/**
 * Classify a flat file's `Last-Modified` header. A missing, empty or
 * unparseable header, and a date in the future, fail open to `current`.
 */
export function classifyLastModified(
  header: string | undefined,
  nowMs: number,
): FIRMSProductFreshness {
  if (header === undefined || header.trim() === '') {
    return { state: 'current' };
  }
  const modifiedMs = Date.parse(header);
  if (!Number.isFinite(modifiedMs)) {
    return { state: 'current' };
  }
  if (nowMs - modifiedMs > FIRMS_LAST_MODIFIED_STALE_MS) {
    return { state: 'stale', lastDataDate: new Date(modifiedMs).toISOString().slice(0, 10) };
  }
  return { state: 'current' };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** UTC midnight of a `YYYY-MM-DD` string, from its components; `undefined` when malformed. */
function utcDayFromString(date: string): number | undefined {
  if (!DATE_PATTERN.test(date)) {
    return undefined;
  }
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    return undefined;
  }
  const ms = Date.UTC(y, m - 1, d);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Parse a `data_availability` CSV body into `data_id` → `max_date`, by header
 * name. A body whose header lacks either column yields an empty map. A row whose
 * `max_date` is not `YYYY-MM-DD` is skipped.
 */
export function parseDataAvailabilityCsv(csv: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '');
  const headerLine = lines[0];
  if (headerLine === undefined) {
    return result;
  }
  const header = headerLine.split(',').map((h) => h.trim());
  const idCol = header.indexOf('data_id');
  const maxCol = header.indexOf('max_date');
  if (idCol < 0 || maxCol < 0) {
    return result;
  }
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((c) => c.trim());
    const id = cells[idCol];
    const maxDate = cells[maxCol];
    if (id === undefined || id === '' || maxDate === undefined || !DATE_PATTERN.test(maxDate)) {
      continue;
    }
    result.set(id, maxDate);
  }
  return result;
}

/**
 * Classify a keyed product by its `max_date`. Absent or malformed fails open to
 * `current`. Stale when it is `FIRMS_MAX_DATE_STALE_DAYS` or more UTC calendar
 * days before today's UTC date; `lastDataDate` is `maxDate` verbatim.
 */
export function classifyMaxDate(
  maxDate: string | undefined,
  nowMs: number,
): FIRMSProductFreshness {
  if (maxDate === undefined) {
    return { state: 'current' };
  }
  const maxDay = utcDayFromString(maxDate);
  if (maxDay === undefined) {
    return { state: 'current' };
  }
  const now = new Date(nowMs);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysBehind = Math.round((today - maxDay) / DAY_MS);
  if (daysBehind >= FIRMS_MAX_DATE_STALE_DAYS) {
    return { state: 'stale', lastDataDate: maxDate };
  }
  return { state: 'current' };
}
