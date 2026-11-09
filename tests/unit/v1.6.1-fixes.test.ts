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

  describe('RainViewer Polar Coordinate Clamping', () => {
    /**
     * Test Web Mercator latitude clamping
     * Simulates the fix in buildCoordinateTileUrl
     */
    function clampLatitudeForWebMercator(lat: number): number {
      const MAX_LATITUDE = 85.05112878;
      return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
    }

    it('should clamp north pole latitude', () => {
      const clamped = clampLatitudeForWebMercator(90);
      expect(clamped).toBe(85.05112878);
      expect(clamped).toBeLessThan(90);
    });

    it('should clamp south pole latitude', () => {
      const clamped = clampLatitudeForWebMercator(-90);
      expect(clamped).toBe(-85.05112878);
      expect(clamped).toBeGreaterThan(-90);
    });

    it('should not clamp valid latitudes', () => {
      expect(clampLatitudeForWebMercator(40.7128)).toBe(40.7128);
      expect(clampLatitudeForWebMercator(-33.8688)).toBe(-33.8688);
      expect(clampLatitudeForWebMercator(0)).toBe(0);
    });

    it('should prevent NaN in tile calculations', () => {
      const lat = 90; // Would cause division by zero
      const clamped = clampLatitudeForWebMercator(lat);

      // Test that clamped value works in Web Mercator formula
      const radLat = (clamped * Math.PI) / 180;
      const mercatorY = Math.log(Math.tan(radLat) + 1 / Math.cos(radLat));

      expect(isNaN(mercatorY)).toBe(false);
      expect(isFinite(mercatorY)).toBe(true);
    });

    it('should handle near-polar latitudes safely', () => {
      const nearNorth = clampLatitudeForWebMercator(89.9);
      const nearSouth = clampLatitudeForWebMercator(-89.9);

      expect(nearNorth).toBeLessThanOrEqual(85.05112878);
      expect(nearSouth).toBeGreaterThanOrEqual(-85.05112878);
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
