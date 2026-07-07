/**
 * Unit tests for timezone utilities
 */

import { describe, it, expect } from 'vitest';
import {
  formatInTimezone,
  formatDateInTimezone,
  formatTimeInTimezone,
  getTimezoneAbbreviation,
  guessTimezoneFromCoords,
  formatTimeRangeInTimezone,
  isValidTimezone
} from '../../src/utils/timezone.js';

describe('Timezone Utilities', () => {
  describe('formatInTimezone', () => {
    it('should format datetime in specified timezone (medium format)', () => {
      const isoString = '2025-11-07T14:30:00+00:00';
      const result = formatInTimezone(isoString, 'America/New_York');

      // Should show local time in New York (EST/EDT)
      expect(result).toContain('Nov 7, 2025');
      expect(result).toMatch(/\d{1,2}:\d{2}/); // Contains time
    });

    it('should format datetime in short format', () => {
      const isoString = '2025-11-07T14:30:00+00:00';
      const result = formatInTimezone(isoString, 'America/New_York', 'short');

      expect(result).toContain('11/7/2025'); // Short date format
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should format datetime in long format', () => {
      const isoString = '2025-11-07T14:30:00+00:00';
      const result = formatInTimezone(isoString, 'America/New_York', 'long');

      expect(result).toContain('Nov 7, 2025');
      expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/); // Includes seconds
    });

    it('should format datetime in full format', () => {
      const isoString = '2025-11-07T14:30:00+00:00';
      const result = formatInTimezone(isoString, 'America/New_York', 'full');

      expect(result).toContain('November 7, 2025'); // Full month name
    });

    it('should handle different timezones correctly', () => {
      const isoString = '2025-11-07T00:00:00+00:00'; // Midnight UTC

      const nyResult = formatInTimezone(isoString, 'America/New_York');
      const tokyoResult = formatInTimezone(isoString, 'Asia/Tokyo');

      // New York is UTC-5, so should be Nov 6
      expect(nyResult).toContain('Nov 6, 2025');

      // Tokyo is UTC+9, so should be Nov 7
      expect(tokyoResult).toContain('Nov 7, 2025');
    });

    it('should handle invalid ISO strings gracefully', () => {
      const invalidString = 'not-a-valid-iso-string';
      const result = formatInTimezone(invalidString, 'America/New_York');

      // Should still return a string (fallback behavior)
      expect(typeof result).toBe('string');
    });

    it('should handle UTC timezone', () => {
      const isoString = '2025-11-07T14:30:00+00:00';
      const result = formatInTimezone(isoString, 'UTC');

      expect(result).toContain('Nov 7, 2025');
      expect(result).toMatch(/2:30\s*PM/); // Handle non-breaking space
    });

    // Open-Meteo returns timezone-naive strings that are already local to the
    // requested location. They must render verbatim in that timezone — not be
    // parsed in the server's zone and shifted (the v1.8.2 sunrise/sunset bug).
    it('should treat timezone-naive strings as location-local (no double shift)', () => {
      const tokyoSunrise = formatInTimezone('2026-07-07T04:32', 'Asia/Tokyo', 'short');
      expect(tokyoSunrise).toMatch(/4:32\s*AM/);
      expect(tokyoSunrise).toContain('7/7/2026');

      const fijiSunrise = formatInTimezone('2026-07-07T06:29', 'Pacific/Fiji', 'short');
      expect(fijiSunrise).toMatch(/6:29\s*AM/);

      const utcNoon = formatInTimezone('2026-07-07T12:00', 'Etc/GMT', 'short');
      expect(utcNoon).toMatch(/12:00\s*PM/);
    });

    it('should treat naive strings as location-local in date/time/range formatters', () => {
      expect(formatDateInTimezone('2026-07-07T01:00', 'Pacific/Honolulu')).toContain('Jul 7, 2026');
      expect(formatTimeInTimezone('2026-07-07T04:32', 'Asia/Tokyo')).toMatch(/4:32:00\s*AM/);
      expect(
        formatTimeRangeInTimezone('2026-07-07T14:00', '2026-07-07T17:00', 'Asia/Tokyo')
      ).toMatch(/2:00\s*PM.*5:00\s*PM/);
    });
  });

  describe('formatDateInTimezone', () => {
    it('should format date only in specified timezone', () => {
      const isoString = '2025-11-07T14:30:00+00:00';
      const result = formatDateInTimezone(isoString, 'America/New_York');

      expect(result).toContain('Nov');
      expect(result).toContain('2025');
      expect(result).not.toMatch(/\d{1,2}:\d{2}/); // Should not contain time
    });

    it('should handle date boundary correctly', () => {
      const isoString = '2025-11-07T02:00:00+00:00'; // 2 AM UTC = Nov 6 in New York

      const nyResult = formatDateInTimezone(isoString, 'America/New_York');
      const utcResult = formatDateInTimezone(isoString, 'UTC');

      expect(nyResult).toContain('Nov 6'); // Previous day
      expect(utcResult).toContain('Nov 7'); // Same day
    });

    it('should handle invalid ISO strings gracefully', () => {
      const result = formatDateInTimezone('invalid', 'America/New_York');

      expect(typeof result).toBe('string');
    });
  });

  describe('formatTimeInTimezone', () => {
    it('should format time only in specified timezone', () => {
      const isoString = '2025-11-07T14:30:00+00:00';
      const result = formatTimeInTimezone(isoString, 'America/New_York');

      expect(result).toMatch(/\d{1,2}:\d{2}/); // Contains time
      expect(result).not.toContain('Nov'); // Should not contain date
    });

    it('should include timezone abbreviation', () => {
      const isoString = '2025-11-07T14:30:00+00:00';
      const result = formatTimeInTimezone(isoString, 'America/New_York');

      // Should contain timezone info (EST, EDT, or offset)
      expect(result).toMatch(/(EST|EDT|GMT[-+]\d)/);
    });

    it('should handle different timezones', () => {
      const isoString = '2025-11-07T12:00:00+00:00'; // Noon UTC

      const nyTime = formatTimeInTimezone(isoString, 'America/New_York');
      const laTime = formatTimeInTimezone(isoString, 'America/Los_Angeles');

      // New York is UTC-5, LA is UTC-8, so times should differ
      expect(nyTime).not.toBe(laTime);
    });

    it('should handle invalid ISO strings gracefully', () => {
      const result = formatTimeInTimezone('invalid', 'America/New_York');

      expect(typeof result).toBe('string');
    });
  });

  describe('getTimezoneAbbreviation', () => {
    it('should get abbreviation for New York timezone', () => {
      const result = getTimezoneAbbreviation('America/New_York');

      // Should be EST or EDT depending on time of year
      expect(result).toMatch(/EST|EDT/);
    });

    it('should get abbreviation for Los Angeles timezone', () => {
      const result = getTimezoneAbbreviation('America/Los_Angeles');

      // Should be PST or PDT depending on time of year
      expect(result).toMatch(/PST|PDT/);
    });

    it('should get abbreviation for UTC', () => {
      const result = getTimezoneAbbreviation('UTC');

      expect(result).toMatch(/UTC|GMT/);
    });

    it('should handle specific datetime for DST determination', () => {
      // Summer date (EDT)
      const summerDate = new Date('2025-07-15T12:00:00Z');
      const summerResult = getTimezoneAbbreviation('America/New_York', summerDate);

      // Winter date (EST)
      const winterDate = new Date('2025-01-15T12:00:00Z');
      const winterResult = getTimezoneAbbreviation('America/New_York', winterDate);

      expect(summerResult).toMatch(/EDT/);
      expect(winterResult).toMatch(/EST/);
    });

    it('should handle invalid timezone gracefully', () => {
      const result = getTimezoneAbbreviation('Invalid/Timezone');

      // Luxon returns "Invalid DateTime" for invalid timezones
      expect(result).toMatch(/Invalid|Timezone/);
    });
  });

  describe('guessTimezoneFromCoords', () => {
    // Backed by tz-lookup for accurate global coordinate -> IANA resolution.
    it('should resolve New York timezone from East Coast coords', () => {
      expect(guessTimezoneFromCoords(40.7128, -74.006)).toBe('America/New_York');
    });

    it('should resolve Central US timezone precisely', () => {
      expect(guessTimezoneFromCoords(41.8781, -87.6298)).toBe('America/Chicago');
    });

    it('should resolve Mountain timezone precisely', () => {
      expect(guessTimezoneFromCoords(39.7392, -104.9903)).toBe('America/Denver');
    });

    it('should resolve Los Angeles timezone from West Coast coords', () => {
      expect(guessTimezoneFromCoords(34.0522, -118.2437)).toBe('America/Los_Angeles');
    });

    it('should resolve no-DST zones like Arizona', () => {
      expect(guessTimezoneFromCoords(33.4484, -112.074)).toBe('America/Phoenix');
    });

    it('should resolve international timezones (London, Sydney, Tokyo)', () => {
      expect(guessTimezoneFromCoords(51.5074, -0.1278)).toBe('Europe/London');
      expect(guessTimezoneFromCoords(-33.8688, 151.2093)).toBe('Australia/Sydney');
      expect(guessTimezoneFromCoords(35.6762, 139.6503)).toBe('Asia/Tokyo');
    });

    it('should resolve sub-regional US zones accurately', () => {
      // Central Indiana observes Eastern time, not Central.
      expect(guessTimezoneFromCoords(40.0, -86.0)).toBe('America/Indiana/Indianapolis');
    });

    it('should always return a valid IANA string, even at the poles', () => {
      const result = guessTimezoneFromCoords(-90, 0);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('formatTimeRangeInTimezone', () => {
    it('should format same-day time range', () => {
      const startTime = '2025-11-07T14:00:00+00:00';
      const endTime = '2025-11-07T17:00:00+00:00';

      const result = formatTimeRangeInTimezone(startTime, endTime, 'America/New_York');

      expect(result).toContain('Nov 7'); // Date
      expect(result).toMatch(/\d{1,2}:\d{2}/); // Start time
      expect(result).toContain('-'); // Range separator
      // Should be formatted as single day range
    });

    it('should format multi-day time range', () => {
      const startTime = '2025-11-07T14:00:00+00:00';
      const endTime = '2025-11-08T17:00:00+00:00'; // Next day

      const result = formatTimeRangeInTimezone(startTime, endTime, 'America/New_York');

      expect(result).toContain('Nov 7'); // Start date
      expect(result).toContain('Nov 8'); // End date
      expect(result).toContain('-'); // Range separator
    });

    it('should handle timezone correctly for range', () => {
      const startTime = '2025-11-07T04:00:00+00:00'; // 4 AM UTC
      const endTime = '2025-11-07T06:00:00+00:00';   // 6 AM UTC

      const result = formatTimeRangeInTimezone(startTime, endTime, 'America/New_York');

      // In New York (UTC-5), this should be Nov 6, 11 PM to Nov 7, 1 AM
      expect(result).toContain('Nov');
    });

    it('should handle invalid ISO strings gracefully', () => {
      const result = formatTimeRangeInTimezone('invalid1', 'invalid2', 'America/New_York');

      expect(typeof result).toBe('string');
      expect(result).toContain('-'); // Should still have separator
    });
  });

  describe('isValidTimezone', () => {
    it('should validate common IANA timezones', () => {
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('America/Los_Angeles')).toBe(true);
      expect(isValidTimezone('America/Chicago')).toBe(true);
      expect(isValidTimezone('America/Denver')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);
      expect(isValidTimezone('Asia/Tokyo')).toBe(true);
    });

    it('should reject invalid timezone strings', () => {
      expect(isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(isValidTimezone('Not_A_Timezone')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
      expect(isValidTimezone('America/FakeCity')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isValidTimezone('GMT')).toBe(true);
      expect(isValidTimezone('GMT+5')).toBe(false); // Not standard IANA format
    });
  });
});
