/**
 * Orchestrates the US daily temperature-records line appended to the
 * `include_normals` output of `get_forecast` and `get_current_conditions`
 * (see design plan D4).
 *
 * Records are garnish, never load-bearing: this module resolves a station,
 * fetches its daily record table, and formats one line — but any failure
 * anywhere in that chain (no station nearby, malformed response, network
 * error, both sides missing for the date) is caught here, logged as a
 * warning, and turned into `undefined`. Callers must never let a records
 * lookup fail the primary weather response.
 */

import { AcisService, dayOfYearIndex } from '../services/acis.js';
import { UnitPreferences, IMPERIAL_PREFERENCES } from '../config/units.js';
import { temperatureLabel } from './unitFormat.js';
import { logger, redactCoordinatesForLogging } from './logger.js';

/** Attribution line rendered immediately after the records line. */
const RECORDS_ATTRIBUTION = 'Records: NOAA Regional Climate Centers (ACIS)';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * Climate records are stored canonically in °F (ACIS's `maxt`/`mint` are
 * Fahrenheit). Convert to the caller's preferred units for display, mirroring
 * `formatNormals`'s `normalTempToPref` helper.
 */
function fahrenheitToPref(fahrenheit: number, prefs: UnitPreferences): number {
  return prefs.temperature === 'C'
    ? Math.round(((fahrenheit - 32) * 5) / 9)
    : Math.round(fahrenheit);
}

/**
 * Build the "**Records for <Month Day>:** ..." line plus its attribution
 * line for a US location and calendar date, or `undefined` if records are
 * unavailable for any reason.
 *
 * @param acisService - The ACIS client.
 * @param latitude - Latitude (should already be gated to US by the caller).
 * @param longitude - Longitude.
 * @param month - Month (1-12).
 * @param day - Day of month (1-31).
 * @param prefs - Unit preferences for temperature display (defaults to imperial).
 * @returns The formatted records + attribution lines, or `undefined` on failure.
 */
export async function getRecordsLine(
  acisService: AcisService,
  latitude: number,
  longitude: number,
  month: number,
  day: number,
  prefs: UnitPreferences = IMPERIAL_PREFERENCES
): Promise<string | undefined> {
  const redacted = redactCoordinatesForLogging(latitude, longitude);

  try {
    const station = await acisService.findRecordsStation(latitude, longitude);
    const records = await acisService.getDailyRecords(
      station.id,
      station.name,
      station.porStartYear
    );

    const index = dayOfYearIndex(month, day);
    const slot = records.days[index];

    if (!slot || (!slot.high && !slot.low)) {
      logger.warn('ACIS records slot has no usable high/low for this date', {
        ...redacted,
        month,
        day
      });
      return undefined;
    }

    const tempUnit = temperatureLabel(prefs);
    const parts: string[] = [];
    if (slot.high) {
      parts.push(`High ${fahrenheitToPref(slot.high.value, prefs)}${tempUnit} (${slot.high.year})`);
    }
    if (slot.low) {
      parts.push(`Low ${fahrenheitToPref(slot.low.value, prefs)}${tempUnit} (${slot.low.year})`);
    }

    const dateLabel = `${MONTH_NAMES[month - 1]} ${day}`;
    const recordsLine =
      `**Records for ${dateLabel}:** ${parts.join(' · ')} — records since ${records.porStartYear}`;

    return `${recordsLine}\n${RECORDS_ATTRIBUTION}`;
  } catch (error) {
    logger.warn('Failed to fetch US temperature records; omitting records line', {
      ...redacted,
      month,
      day,
      error: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}
