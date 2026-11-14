/**
 * Unit tests for v1.6.1 security and quality fixes
 * Tests for audit findings from CODE_QUALITY_REPORT_V1.6.md and SECURITY_AUDIT_V1.6.md
 */

import { describe, it, expect } from 'vitest';
import { redactCoordinatesForLogging } from '../../src/utils/logger.js';
import { guessTimezoneFromCoords } from '../../src/utils/timezone.js';

describe('v1.6.1 Security & Quality Fixes', () => {
  describe('Coordinate Redaction (Privacy Fix)', () => {
    it('should round coordinates to 2 decimal places by default', () => {
      const coords = redactCoordinatesForLogging(37.7749123, -122.4194987);
      expect(coords.lat).toBe(37.77);
      expect(coords.lon).toBe(-122.42);
    });

    it('should handle negative coordinates correctly', () => {
      const coords = redactCoordinatesForLogging(-33.8688, 151.2093);
      expect(coords.lat).toBe(-33.87);
      expect(coords.lon).toBe(151.21);
    });

    it('should handle polar coordinates', () => {
      const north = redactCoordinatesForLogging(89.9999, 0);
      expect(north.lat).toBe(90.00);
      expect(north.lon).toBe(0.00);

      const south = redactCoordinatesForLogging(-89.9999, 180);
      expect(south.lat).toBe(-90.00);
      expect(south.lon).toBe(180.00);
    });

    it('should return full precision when LOG_PII=true', () => {
      const originalEnv = process.env.LOG_PII;
      process.env.LOG_PII = 'true';

      const coords = redactCoordinatesForLogging(37.7749123, -122.4194987);
      expect(coords.lat).toBe(37.7749123);
      expect(coords.lon).toBe(-122.4194987);

      // Restore original
      if (originalEnv === undefined) {
        delete process.env.LOG_PII;
      } else {
        process.env.LOG_PII = originalEnv;
      }
    });

    it('should not log full precision by default (privacy test)', () => {
      const originalEnv = process.env.LOG_PII;
      delete process.env.LOG_PII;

      const coords = redactCoordinatesForLogging(37.7749123, -122.4194987);
      expect(coords.lat).not.toBe(37.7749123);
      expect(coords.lon).not.toBe(-122.4194987);

      // Restore original
      if (originalEnv !== undefined) {
        process.env.LOG_PII = originalEnv;
      }
    });
  });

  describe('Timezone resolution (international accuracy)', () => {
    // The original v1.6.1 fix avoided returning the *server* timezone for
    // international queries (it fell back to UTC). That guarantee still holds,
    // and resolution is now accurate via tz-lookup (see v1.8 work).

    it('should resolve correct (non-server) timezones for international locations', () => {
      expect(guessTimezoneFromCoords(51.5074, -0.1278)).toBe('Europe/London');
      expect(guessTimezoneFromCoords(48.8566, 2.3522)).toBe('Europe/Paris');
      expect(guessTimezoneFromCoords(-33.8688, 151.2093)).toBe('Australia/Sydney');
      expect(guessTimezoneFromCoords(35.6762, 139.6503)).toBe('Asia/Tokyo');
    });

    it('should still handle US timezones correctly', () => {
      expect(guessTimezoneFromCoords(40.7128, -74.006)).toBe('America/New_York');
      expect(guessTimezoneFromCoords(41.8781, -87.6298)).toBe('America/Chicago');
      expect(guessTimezoneFromCoords(39.7392, -104.9903)).toBe('America/Denver');
      expect(guessTimezoneFromCoords(34.0522, -118.2437)).toBe('America/Los_Angeles');
    });

    it('should never return an America/* zone for a European location', () => {
      expect(guessTimezoneFromCoords(51.5074, -0.1278)).not.toContain('America/');
    });
  });
});
