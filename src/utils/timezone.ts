/**
 * Utility functions for timezone-aware time formatting
 * Uses Luxon for timezone support with native Intl API
 */

import { DateTime } from 'luxon';
import tzLookup from 'tz-lookup';
import { logger } from './logger.js';

/**
 * Format an ISO 8601 datetime string in the specified timezone
 * @param isoString - ISO 8601 datetime string (e.g., "2025-11-07T14:30:00+00:00")
 * @param timezone - IANA timezone identifier (e.g., "America/New_York", "Asia/Tokyo")
 * @param format - Optional format style ('full', 'long', 'medium', 'short')
 * @returns Formatted datetime string in local timezone
 */
export function formatInTimezone(
  isoString: string,
  timezone: string,
  format: 'full' | 'long' | 'medium' | 'short' = 'medium',
  timeFormat: '12h' | '24h' = '12h'
): string {
  try {
    // Timezone-naive strings (e.g. Open-Meteo's "2026-07-07T04:32") are already
    // location-local, so they must be interpreted in the target zone — parsing them
    // in the server's zone and converting would apply the offset twice. Strings with
    // an explicit offset keep their instant and are converted for display.
    const zonedDt = DateTime.fromISO(isoString, { zone: timezone });

    if (!zonedDt.isValid) {
      // Fallback to JavaScript Date if Luxon can't parse
      return new Date(isoString).toLocaleString('en-US', { timeZone: timezone });
    }

    // hour12 override lets callers honor a 24-hour preference; undefined keeps
    // the locale default (12-hour for en-US).
    const hourOpt = timeFormat === '24h' ? { hour12: false } : {};

    // Format based on requested style
    switch (format) {
      case 'full':
        return zonedDt.toLocaleString({ ...DateTime.DATETIME_FULL, ...hourOpt });
      case 'long':
        return zonedDt.toLocaleString({ ...DateTime.DATETIME_MED_WITH_SECONDS, ...hourOpt });
      case 'short':
        return zonedDt.toLocaleString({ ...DateTime.DATETIME_SHORT, ...hourOpt });
      case 'medium':
      default:
        return zonedDt.toLocaleString({ ...DateTime.DATETIME_MED, ...hourOpt });
    }
  } catch (error) {
    // Fallback to standard Date formatting if anything goes wrong
    return new Date(isoString).toLocaleString('en-US', { timeZone: timezone });
  }
}

/**
 * Format a date-only ISO string in the specified timezone
 * @param isoString - ISO 8601 datetime string
 * @param timezone - IANA timezone identifier
 * @returns Formatted date string (e.g., "Nov 7, 2025")
 */
export function formatDateInTimezone(isoString: string, timezone: string): string {
  try {
    // See formatInTimezone: naive strings are location-local, parse in target zone
    const zonedDt = DateTime.fromISO(isoString, { zone: timezone });

    if (!zonedDt.isValid) {
      return new Date(isoString).toLocaleDateString('en-US', { timeZone: timezone });
    }

    return zonedDt.toLocaleString(DateTime.DATE_MED);
  } catch (error) {
    return new Date(isoString).toLocaleDateString('en-US', { timeZone: timezone });
  }
}

/**
 * Format a time-only ISO string in the specified timezone
 * @param isoString - ISO 8601 datetime string
 * @param timezone - IANA timezone identifier
 * @returns Formatted time string (e.g., "2:30 PM EST")
 */
export function formatTimeInTimezone(isoString: string, timezone: string): string {
  try {
    // See formatInTimezone: naive strings are location-local, parse in target zone
    const zonedDt = DateTime.fromISO(isoString, { zone: timezone });

    if (!zonedDt.isValid) {
      return new Date(isoString).toLocaleTimeString('en-US', {
        timeZone: timezone,
        timeZoneName: 'short'
      });
    }

    return zonedDt.toLocaleString(DateTime.TIME_WITH_SHORT_OFFSET);
  } catch (error) {
    return new Date(isoString).toLocaleTimeString('en-US', {
      timeZone: timezone,
      timeZoneName: 'short'
    });
  }
}

/**
 * Get timezone abbreviation from IANA timezone identifier
 * @param timezone - IANA timezone identifier (e.g., "America/New_York")
 * @param datetime - Optional datetime to determine DST status
 * @returns Timezone abbreviation (e.g., "EST" or "EDT")
 */
export function getTimezoneAbbreviation(timezone: string, datetime?: Date): string {
  try {
    const dt = datetime
      ? DateTime.fromJSDate(datetime).setZone(timezone)
      : DateTime.now().setZone(timezone);

    return dt.offsetNameShort || dt.toFormat('ZZZZ');
  } catch (error) {
    return timezone;
  }
}

/**
 * Detect the IANA timezone for a coordinate.
 *
 * Uses `tz-lookup` for accurate global coordinate→timezone resolution (handles
 * international locations, US territories, and no-DST zones like Arizona). Falls
 * back to a coarse US longitude heuristic and finally UTC if the lookup fails
 * (e.g. invalid coordinates).
 *
 * @param latitude - Latitude
 * @param longitude - Longitude
 * @returns IANA timezone identifier
 */
export function guessTimezoneFromCoords(latitude: number, longitude: number): string {
  try {
    return tzLookup(latitude, longitude);
  } catch (error) {
    logger.warn('tz-lookup failed; falling back to coarse timezone heuristic', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Fallback: coarse US longitude bands, then UTC for everything else.
  // The Central zone is geographically wide (Great Lakes to roughly the
  // Kansas/Colorado border), so its band is much wider than Eastern's —
  // boundaries are tuned against known city coordinates (see
  // timezone-fallback.test.ts), not an even four-way split of the continent.
  if (latitude >= 24 && latitude <= 50 && longitude >= -125 && longitude <= -66) {
    if (longitude >= -85) return 'America/New_York';
    if (longitude >= -101) return 'America/Chicago';
    if (longitude >= -115) return 'America/Denver';
    return 'America/Los_Angeles';
  }

  return 'UTC';
}

/**
 * Format a time range with timezone context
 * @param startTime - Start time ISO string
 * @param endTime - End time ISO string
 * @param timezone - IANA timezone identifier
 * @returns Formatted range (e.g., "Nov 7, 2:00 PM - 5:00 PM EST")
 */
export function formatTimeRangeInTimezone(
  startTime: string,
  endTime: string,
  timezone: string
): string {
  try {
    const start = DateTime.fromISO(startTime, { zone: timezone });
    const end = DateTime.fromISO(endTime, { zone: timezone });

    if (!start.isValid || !end.isValid) {
      return `${formatInTimezone(startTime, timezone, 'short')} - ${formatInTimezone(endTime, timezone, 'short')}`;
    }

    // If same day, show: "Nov 7, 2:00 PM - 5:00 PM EST"
    if (start.hasSame(end, 'day')) {
      return `${start.toLocaleString(DateTime.DATE_MED)}, ${start.toLocaleString(DateTime.TIME_SIMPLE)} - ${end.toLocaleString(DateTime.TIME_SIMPLE)} ${start.offsetNameShort}`;
    }

    // Different days: "Nov 7, 2:00 PM - Nov 8, 5:00 PM EST"
    return `${start.toLocaleString(DateTime.DATETIME_MED)} - ${end.toLocaleString(DateTime.DATETIME_MED)}`;
  } catch (error) {
    return `${formatInTimezone(startTime, timezone, 'short')} - ${formatInTimezone(endTime, timezone, 'short')}`;
  }
}

/**
 * Format an observation age (in minutes) as a human-readable "N ago" string.
 *
 * Bands: 'just now' at 0, whole minutes under an hour, one-decimal hours
 * under 48 h, and whole days beyond that. The first three bands match the
 * expression this replaced verbatim (METAR's picker rejects anything over
 * 6 h, so the days band is unreachable from that call site).
 *
 * @param ageMinutes - Observation age in minutes (non-negative)
 * @returns Human-readable age string (e.g., "just now", "5 minutes ago", "2.5 hours ago", "3 days ago")
 */
export function formatObservationAge(ageMinutes: number): string {
  if (ageMinutes === 0) {
    return 'just now';
  }

  if (ageMinutes < 60) {
    return `${ageMinutes} minute${ageMinutes === 1 ? '' : 's'} ago`;
  }

  if (ageMinutes < 48 * 60) {
    const hours = Math.round((ageMinutes / 60) * 10) / 10;
    return `${hours} hours ago`;
  }

  const days = Math.round(ageMinutes / 1440);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Check if a timezone is valid IANA timezone identifier
 * @param timezone - Timezone string to validate
 * @returns true if valid, false otherwise
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    DateTime.now().setZone(timezone);
    return DateTime.now().setZone(timezone).isValid;
  } catch {
    return false;
  }
}
