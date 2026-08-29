/**
 * Utility functions for computing climate normals from historical data
 *
 * Climate normals are 30-year averages (1991-2020) used to provide
 * context for current weather conditions.
 *
 * Hybrid Strategy:
 * 1. Try NCEI (US only, requires token) for official normals
 * 2. Fall back to Open-Meteo (global, no token) computed normals
 */

import type { OpenMeteoHistoricalResponse, ClimateNormals } from '../types/openmeteo.js';
import { celsiusToFahrenheit } from './units.js';
import { UnitPreferences, IMPERIAL_PREFERENCES } from '../config/units.js';
import { temperatureLabel, precipitationLabel } from './unitFormat.js';
import type { OpenMeteoService } from '../services/openmeteo.js';
import type { NCEIService } from '../services/ncei.js';
import { logger } from './logger.js';
import { isInUS } from './geography.js';
/**
 * The daily series are declared `(number | null)[]`, as Open-Meteo sends them.
 * `finiteSampleAt` turns a published `null` — and a missing or short array —
 * into "no sample", mirroring `modelComparison.ts`'s `extractModelSeries`
 * guard. This is the D2 fix: the prior compute
 * (`computeNormalsFrom30YearData`) filtered on `!== undefined` only, so a JSON
 * `null` reached `reduce` and `sum + null` coerced to `+ 0`, dragging every
 * mean down.
 */
import { finiteSampleAt } from './finiteSample.js';

/**
 * Climate normals are stored canonically in imperial units (°F, inches).
 * These helpers convert them to the caller's preferred units for display.
 */
function normalTempToPref(fahrenheit: number, prefs: UnitPreferences): number {
  return prefs.temperature === 'C' ? Math.round(((fahrenheit - 32) * 5) / 9) : Math.round(fahrenheit);
}

function normalPrecipToPref(inches: number, prefs: UnitPreferences): number {
  return prefs.precipitation === 'mm'
    ? Math.round(inches * 25.4 * 10) / 10
    : Math.round(inches * 100) / 100;
}

/**
 * Convert millimeters to inches
 */
function millimetersToInches(mm: number): number {
  return mm / 25.4;
}

// ---------------------------------------------------------------------------
// Full-year normals table (D1/D2/D5) — one archive pull per location,
// computing all 366 MM-DD slots in one pass. Types live here (not
// `src/types/`), mirroring the `modelComparison.ts` exported-result
// precedent for a pure util module (A3).
// ---------------------------------------------------------------------------

/**
 * One slot of the 366-slot climate-normals table. Values are **unrounded**,
 * canonical imperial (°F, inches) — D5 moves all rounding to render time, so
 * these are the raw converted means, not the display-ready numbers
 * `formatNormals`/`normalTempToPref`/`normalPrecipToPref` produce.
 *
 * `sampleCount` is the number of samples the slot's mean was computed from —
 * specifically the minimum count across the three variables, since a slot is
 * available only when *every* variable clears its minimum (A1, all-or-nothing:
 * `ClimateNormals` has no partial-data shape), so the minimum is the binding
 * constraint.
 */
export interface NormalsTableSlot {
  tempHigh: number;
  tempLow: number;
  precipitation: number;
  sampleCount: number;
}

/**
 * A full climate-normals table, keyed `"MM-DD"` (zero-padded, e.g. `"01-05"`,
 * `"02-29"`). `computeNormalsTable` always populates all 366 keys (using a
 * leap-year calendar so `"02-29"` exists), so a valid key's value is always
 * one of `NormalsTableSlot | null` — `null` marks an explicitly unavailable
 * slot (too few qualifying samples), distinguishable from an absent/mistyped
 * key, which would read `undefined` and never occurs for a real `"MM-DD"`.
 */
export type NormalsTable = Record<string, NormalsTableSlot | null>;

/** Minimum non-null samples required for a slot to be available (D2, half of 30 years). */
const NORMALS_MIN_SAMPLES = 15;

/**
 * Feb 29 carve-out (D2): only 8 leap days exist in 1991-2020, so the
 * default 15-sample rule would make this slot permanently unavailable.
 */
const NORMALS_MIN_SAMPLES_FEB29 = 6;

const FEB_29_KEY = '02-29';

/** Reference leap year used only to enumerate every calendar MM-DD, including Feb 29. */
const LEAP_YEAR_FOR_CALENDAR = 2020;

/** Sum of a numeric array; only ever called with a non-empty array in this module. */
function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Build an empty table with all 366 `"MM-DD"` keys present and unavailable (`null`). */
function buildEmptyNormalsTable(): NormalsTable {
  const table: NormalsTable = {};
  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(LEAP_YEAR_FOR_CALENDAR, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      table[key] = null;
    }
  }
  return table;
}

interface NormalsSampleBucket {
  tempHighC: number[];
  tempLowC: number[];
  precipitationMm: number[];
}

/**
 * Compute a full 366-slot climate-normals table from one full-year
 * (1991-01-01…2020-12-31) archive response, per D1/D2/D5.
 *
 * A single pass buckets each day's samples by its `"MM-DD"` key; each
 * variable's mean uses only its own non-null, non-undefined samples (a day
 * with a null precipitation reading still contributes its temperature
 * samples). A slot is unavailable (`null`) when *any* of the three
 * variables has fewer than `NORMALS_MIN_SAMPLES` (15) qualifying samples —
 * except `"02-29"`, whose minimum is `NORMALS_MIN_SAMPLES_FEB29` (6).
 * Available slots store unrounded canonical-imperial floats (°F/inches);
 * rounding happens only at render time (D5).
 *
 * A response with no `daily`/`daily.time` returns the all-unavailable table
 * defensively (the open-ocean HTTP-200-with-nulls precedent extended to a
 * missing/malformed payload) rather than throwing — the table is garnish
 * data indexed per-date downstream, and an all-null table degrades the same
 * way a partially-null one does.
 */
export function computeNormalsTable(response: OpenMeteoHistoricalResponse): NormalsTable {
  const table = buildEmptyNormalsTable();

  const daily = response.daily;
  if (!daily || !daily.time) {
    return table;
  }

  const buckets = new Map<string, NormalsSampleBucket>();

  for (let i = 0; i < daily.time.length; i++) {
    const isoDate: string = daily.time[i]; // "YYYY-MM-DD"
    const monthDay = isoDate.substring(5);

    // Only real calendar MM-DD keys were pre-populated in the table; skip
    // anything else defensively (malformed date strings).
    if (table[monthDay] === undefined) {
      continue;
    }

    let bucket = buckets.get(monthDay);
    if (!bucket) {
      bucket = { tempHighC: [], tempLowC: [], precipitationMm: [] };
      buckets.set(monthDay, bucket);
    }

    const tempHighC = finiteSampleAt(daily.temperature_2m_max, i);
    if (tempHighC !== undefined) bucket.tempHighC.push(tempHighC);

    const tempLowC = finiteSampleAt(daily.temperature_2m_min, i);
    if (tempLowC !== undefined) bucket.tempLowC.push(tempLowC);

    const precipitationMm = finiteSampleAt(daily.precipitation_sum, i);
    if (precipitationMm !== undefined) bucket.precipitationMm.push(precipitationMm);
  }

  for (const [monthDay, bucket] of buckets) {
    const minSamples = monthDay === FEB_29_KEY ? NORMALS_MIN_SAMPLES_FEB29 : NORMALS_MIN_SAMPLES;
    const sampleCount = Math.min(bucket.tempHighC.length, bucket.tempLowC.length, bucket.precipitationMm.length);

    if (
      bucket.tempHighC.length < minSamples ||
      bucket.tempLowC.length < minSamples ||
      bucket.precipitationMm.length < minSamples
    ) {
      // Already `null` from buildEmptyNormalsTable(); explicit for clarity.
      table[monthDay] = null;
      continue;
    }

    const avgTempHighC = sum(bucket.tempHighC) / bucket.tempHighC.length;
    const avgTempLowC = sum(bucket.tempLowC) / bucket.tempLowC.length;
    const avgPrecipitationMm = sum(bucket.precipitationMm) / bucket.precipitationMm.length;

    table[monthDay] = {
      tempHigh: celsiusToFahrenheit(avgTempHighC),
      tempLow: celsiusToFahrenheit(avgTempLowC),
      precipitation: millimetersToInches(avgPrecipitationMm),
      sampleCount
    };
  }

  return table;
}

/**
 * Generate the per-location cache key for a full normals table (D1) — one
 * entry per location instead of up to 366 per-date keys.
 *
 * @param latitude - Latitude (rounded to 2 decimals)
 * @param longitude - Longitude (rounded to 2 decimals)
 * @returns Cache key string
 */
export function getNormalsTableCacheKey(latitude: number, longitude: number): string {
  const lat = Math.round(latitude * 100) / 100;
  const lon = Math.round(longitude * 100) / 100;
  return `normals-table:${lat}:${lon}`;
}

/**
 * Calculate departure from normal
 *
 * @param actual - Actual temperature value
 * @param normal - Normal (average) temperature value
 * @returns Departure with sign (e.g., +10, -5)
 */
export function calculateDeparture(actual: number, normal: number): string {
  const departure = Math.round(actual - normal);
  return departure >= 0 ? `+${departure}` : `${departure}`;
}

/**
 * The section heading used for climate normals — success and failure alike.
 *
 * Before D6 the success path rendered `## 📊 Climate Context` while all five
 * failure blocks rendered `## Climate Normals`, so the same section changed
 * name depending on whether the data arrived. One constant, one heading.
 */
const CLIMATE_SECTION_HEADING = '## 📊 Climate Context';

/**
 * Format climate normals for display
 *
 * @param normals - Climate normals data
 * @param currentTemp - Optional current temperature for comparison
 * @returns Formatted markdown string
 */
export function formatNormals(
  normals: ClimateNormals,
  currentTemp?: { high?: number; low?: number },
  prefs: UnitPreferences = IMPERIAL_PREFERENCES
): string {
  // currentTemp values arrive already in the caller's units; convert the
  // stored (imperial) normals into the same units for a like-for-like display.
  const tempU = temperatureLabel(prefs);
  const normalHigh = normalTempToPref(normals.tempHigh, prefs);
  const normalLow = normalTempToPref(normals.tempLow, prefs);

  let output = `\n${CLIMATE_SECTION_HEADING}\n\n`;
  output += `**Normal High:** ${normalHigh}${tempU}\n`;
  output += `**Normal Low:** ${normalLow}${tempU}\n`;
  output += `**Normal Precipitation:** ${normalPrecipToPref(normals.precipitation, prefs)} ${precipitationLabel(prefs)}\n`;

  if (currentTemp) {
    if (currentTemp.high !== undefined) {
      const departure = calculateDeparture(currentTemp.high, normalHigh);
      output += `**High Departure:** ${departure}${tempU}`;
      if (departure.startsWith('+')) {
        output += ` (warmer than normal)`;
      } else if (departure.startsWith('-')) {
        output += ` (cooler than normal)`;
      }
      output += `\n`;
    }

    if (currentTemp.low !== undefined) {
      const departure = calculateDeparture(currentTemp.low, normalLow);
      output += `**Low Departure:** ${departure}${tempU}`;
      if (departure.startsWith('+')) {
        output += ` (warmer than normal)`;
      } else if (departure.startsWith('-')) {
        output += ` (cooler than normal)`;
      }
      output += `\n`;
    }
  }

  output += `\n*Climate normals based on 1991-2020 data*\n`;
  output += `*Source: ${normals.source}*\n`;

  return output;
}

/**
 * Render the climate-normals section for a location and date, or the
 * unavailable note if the normals can't be had (D6).
 *
 * This owns the try/catch, the `getClimateNormals` call, and both outcomes —
 * the five handler blocks that used to duplicate it (two in
 * `forecastHandler`, three in `currentConditionsHandler`) differ only in how
 * they derive `month`/`day` and `currentTemps`, so that derivation stays with
 * them and everything downstream of it lives here.
 *
 * Normals are garnish: this function never throws, so a failure renders the
 * note and leaves the parent forecast/current response intact.
 *
 * @param currentTemps - Actual/forecast high and low **already in the
 *   caller's units**, for the departure lines. Pass `{}` where no comparable
 *   temperatures exist (the METAR path).
 * @returns The section markdown, ready to append to the handler's output
 */
export async function renderNormalsSection(
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService | undefined,
  latitude: number,
  longitude: number,
  month: number,
  day: number,
  currentTemps: { high?: number; low?: number },
  prefs: UnitPreferences = IMPERIAL_PREFERENCES
): Promise<string> {
  try {
    const normals = await getClimateNormals(
      openMeteoService,
      nceiService,
      latitude,
      longitude,
      month,
      day
    );

    return formatNormals(normals, currentTemps, prefs);
  } catch (error) {
    // Normals failing must never fail the request that asked for them.
    return `\n${CLIMATE_SECTION_HEADING}\n\n⚠️ Climate normals data not available for this location.\n`;
  }
}

/**
 * Get date components from Date object or ISO string
 *
 * @param date - Date object or ISO string
 * @returns Object with month (1-12) and day (1-31)
 */
export function getDateComponents(date: Date | string): { month: number; day: number } {
  const d = typeof date === 'string' ? new Date(date) : date;
  return {
    month: d.getMonth() + 1, // JavaScript months are 0-indexed
    day: d.getDate()
  };
}

/**
 * Get climate normals using hybrid strategy
 *
 * Strategy:
 * 1. If location is in US and NCEI token available, try NCEI first
 * 2. Fall back to Open-Meteo computed normals (always works)
 *
 * @param openMeteoService - Open-Meteo service instance
 * @param nceiService - NCEI service instance (optional)
 * @param latitude - Latitude
 * @param longitude - Longitude
 * @param month - Month (1-12)
 * @param day - Day of month (1-31)
 * @returns Climate normals with source indication
 */
export async function getClimateNormals(
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService | undefined,
  latitude: number,
  longitude: number,
  month: number,
  day: number
): Promise<ClimateNormals> {
  // Try NCEI if available and location is in US
  if (nceiService && nceiService.isAvailable() && isInUS(latitude, longitude)) {
    try {
      logger.info('Attempting to fetch climate normals from NCEI', {
        latitude,
        longitude,
        month,
        day
      });

      const normals = await nceiService.getClimateNormals(latitude, longitude, month, day);
      logger.info('Successfully retrieved climate normals from NCEI', {
        latitude,
        longitude,
        month,
        day
      });

      return normals;
    } catch (error) {
      // NCEI failed, fall back to Open-Meteo
      logger.warn('NCEI climate normals failed, falling back to Open-Meteo', {
        latitude,
        longitude,
        month,
        day,
        error: (error as Error).message
      });
    }
  }

  // Use Open-Meteo (default, always works)
  logger.info('Using Open-Meteo for climate normals', {
    latitude,
    longitude,
    month,
    day,
    reason: nceiService && nceiService.isAvailable()
      ? 'NCEI fallback'
      : !isInUS(latitude, longitude)
        ? 'Location outside US'
        : 'NCEI token not configured'
  });

  return await openMeteoService.getClimateNormals(latitude, longitude, month, day);
}
