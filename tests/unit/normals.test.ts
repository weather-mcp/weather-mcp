/**
 * Unit tests for climate normals utilities
 */

import { describe, it, expect } from 'vitest';
import {
  computeNormalsFrom30YearData,
  getNormalsCacheKey,
  calculateDeparture,
  formatNormals,
  getDateComponents,
  isLocationInUS
} from '../../src/utils/normals.js';
import type { OpenMeteoHistoricalResponse } from '../../src/types/openmeteo.js';

describe('Climate Normals Utilities', () => {
  describe('computeNormalsFrom30YearData', () => {
    it('should compute normals from 30 years of data', () => {
      // Mock 3 years of data for January 15 (simplified for testing)
      const mockData: OpenMeteoHistoricalResponse = {
        latitude: 40.7,
        longitude: -74.0,
        elevation: 10,
        timezone: 'America/New_York',
        timezone_abbreviation: 'EST',
        generationtime_ms: 0.5,
        utc_offset_seconds: -18000,
        daily: {
          time: [
            '2018-01-15', '2019-01-15', '2020-01-15', // Target dates
            '2018-01-16', '2019-01-16', '2020-01-16'  // Other dates
          ],
          temperature_2m_max: [5, 7, 6, 8, 9, 10],        // Celsius
          temperature_2m_min: [-2, 0, -1, 1, 2, 3],      // Celsius
          precipitation_sum: [2.54, 5.08, 0, 1, 2, 3]    // Millimeters
        }
      };

      const normals = computeNormalsFrom30YearData(mockData, 1, 15);

      // Average high: (5 + 7 + 6) / 3 = 6°C = 42.8°F ≈ 43°F
      // Average low: (-2 + 0 + -1) / 3 = -1°C = 30.2°F ≈ 30°F
      // Average precip: (2.54 + 5.08 + 0) / 3 = 2.54mm = 0.1"
      expect(normals.tempHigh).toBe(43);
      expect(normals.tempLow).toBe(30);
      expect(normals.precipitation).toBeCloseTo(0.1, 1);
      expect(normals.source).toBe('Open-Meteo');
      expect(normals.month).toBe(1);
      expect(normals.day).toBe(15);
    });

    it('should handle edge case with single day of data', () => {
      const mockData: OpenMeteoHistoricalResponse = {
        latitude: 40.7,
        longitude: -74.0,
        elevation: 10,
        timezone: 'America/New_York',
        timezone_abbreviation: 'EST',
        generationtime_ms: 0.5,
        utc_offset_seconds: -18000,
        daily: {
          time: ['2020-06-15'],
          temperature_2m_max: [25],  // 77°F
          temperature_2m_min: [15],  // 59°F
          precipitation_sum: [0]
        }
      };

      const normals = computeNormalsFrom30YearData(mockData, 6, 15);

      expect(normals.tempHigh).toBe(77);
      expect(normals.tempLow).toBe(59);
      expect(normals.precipitation).toBe(0);
    });

    it('should throw error when no matching dates found', () => {
      const mockData: OpenMeteoHistoricalResponse = {
        latitude: 40.7,
        longitude: -74.0,
        elevation: 10,
        timezone: 'America/New_York',
        timezone_abbreviation: 'EST',
        generationtime_ms: 0.5,
        utc_offset_seconds: -18000,
        daily: {
          time: ['2020-01-10', '2020-01-11'],
          temperature_2m_max: [5, 6],
          temperature_2m_min: [-2, -1],
          precipitation_sum: [0, 0]
        }
      };

      expect(() => {
        computeNormalsFrom30YearData(mockData, 6, 15);
      }).toThrow('No historical data found for 6/15');
    });

    it('should throw error when daily data is missing', () => {
      const mockData: OpenMeteoHistoricalResponse = {
        latitude: 40.7,
        longitude: -74.0,
        elevation: 10,
        timezone: 'America/New_York',
        timezone_abbreviation: 'EST',
        generationtime_ms: 0.5,
        utc_offset_seconds: -18000
      };

      expect(() => {
        computeNormalsFrom30YearData(mockData, 6, 15);
      }).toThrow('Historical data does not contain daily data');
    });
  });

  describe('getNormalsCacheKey', () => {
    it('should generate consistent cache keys', () => {
      const key1 = getNormalsCacheKey(40.7128, -74.0060, 1, 15);
      const key2 = getNormalsCacheKey(40.7128, -74.0060, 1, 15);

      expect(key1).toBe(key2);
      expect(key1).toBe('normals:40.71:-74.01:1:15');
    });

    it('should round coordinates to 2 decimals', () => {
      const key = getNormalsCacheKey(40.71283847, -74.00601234, 6, 30);

      expect(key).toBe('normals:40.71:-74.01:6:30');
    });

    it('should handle different dates', () => {
      const keyJan = getNormalsCacheKey(40.7, -74.0, 1, 1);
      const keyDec = getNormalsCacheKey(40.7, -74.0, 12, 31);

      expect(keyJan).toBe('normals:40.7:-74:1:1');
      expect(keyDec).toBe('normals:40.7:-74:12:31');
      expect(keyJan).not.toBe(keyDec);
    });

    it('should differentiate nearby locations', () => {
      const key1 = getNormalsCacheKey(40.7, -74.0, 1, 15);
      const key2 = getNormalsCacheKey(40.8, -74.0, 1, 15);

      expect(key1).not.toBe(key2);
    });
  });

  describe('calculateDeparture', () => {
    it('should calculate positive departure', () => {
      const departure = calculateDeparture(75, 65);

      expect(departure).toBe('+10');
    });

    it('should calculate negative departure', () => {
      const departure = calculateDeparture(55, 65);

      expect(departure).toBe('-10');
    });

    it('should handle zero departure', () => {
      const departure = calculateDeparture(65, 65);

      expect(departure).toBe('+0');
    });

    it('should round to nearest integer', () => {
      const departure1 = calculateDeparture(65.4, 60);
      const departure2 = calculateDeparture(65.6, 60);

      expect(departure1).toBe('+5');
      expect(departure2).toBe('+6');
    });
  });

  describe('formatNormals', () => {
    it('should format normals without current temps', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.12,
        source: 'Open-Meteo' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals);

      expect(output).toContain('## 📊 Climate Context');
      expect(output).toContain('**Normal High:** 65°F');
      expect(output).toContain('**Normal Low:** 45°F');
      expect(output).toContain('**Normal Precipitation:** 0.12"');
      expect(output).toContain('*Climate normals based on 1991-2020 data*');
      expect(output).toContain('*Source: Open-Meteo*');
      expect(output).not.toContain('Departure');
    });

    it('should format normals with current high temperature', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.12,
        source: 'Open-Meteo' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals, { high: 75 });

      expect(output).toContain('**High Departure:** +10°F (warmer than normal)');
      expect(output).not.toContain('**Low Departure:**');
    });

    it('should format normals with current low temperature', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.12,
        source: 'Open-Meteo' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals, { low: 40 });

      expect(output).toContain('**Low Departure:** -5°F (cooler than normal)');
      expect(output).not.toContain('**High Departure:**');
    });

    it('should format normals with both high and low', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.12,
        source: 'Open-Meteo' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals, { high: 70, low: 50 });

      expect(output).toContain('**High Departure:** +5°F (warmer than normal)');
      expect(output).toContain('**Low Departure:** +5°F (warmer than normal)');
    });

    it('should format NCEI source correctly', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.12,
        source: 'NCEI' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals);

      expect(output).toContain('*Source: NCEI*');
    });
  });

  describe('getDateComponents', () => {
    it('should extract date components from Date object', () => {
      const date = new Date('2025-06-15T12:00:00Z');
      const { month, day } = getDateComponents(date);

      expect(month).toBe(6);
      expect(day).toBe(15);
    });

    it('should extract date components from ISO string', () => {
      // Note: Uses local timezone, not UTC
      const testDate = '2025-06-15T12:00:00';  // Use local time, not UTC
      const { month, day } = getDateComponents(testDate);

      expect(month).toBe(6);
      expect(day).toBe(15);
    });

    it('should handle December 31st', () => {
      const { month, day } = getDateComponents('2025-12-31T23:59:59Z');

      expect(month).toBe(12);
      expect(day).toBe(31);
    });

    it('should handle leap day', () => {
      const { month, day } = getDateComponents('2024-02-29T12:00:00Z');

      expect(month).toBe(2);
      expect(day).toBe(29);
    });
  });

  describe('isLocationInUS', () => {
    it('should identify New York City as in US', () => {
      expect(isLocationInUS(40.7128, -74.0060)).toBe(true);
    });

    it('should identify Los Angeles as in US', () => {
      expect(isLocationInUS(34.0522, -118.2437)).toBe(true);
    });

    it('should identify Miami as in US', () => {
      expect(isLocationInUS(25.7617, -80.1918)).toBe(true);
    });

    it('should identify Seattle as in US', () => {
      expect(isLocationInUS(47.6062, -122.3321)).toBe(true);
    });

    it('should identify London as NOT in US', () => {
      expect(isLocationInUS(51.5074, -0.1278)).toBe(false);
    });

    it('should identify Paris as NOT in US', () => {
      expect(isLocationInUS(48.8566, 2.3522)).toBe(false);
    });

    it('should identify Tokyo as NOT in US', () => {
      expect(isLocationInUS(35.6762, 139.6503)).toBe(false);
    });

    it('should identify Mexico City as NOT in US', () => {
      expect(isLocationInUS(19.4326, -99.1332)).toBe(false);
    });

    it('should identify Toronto (edge case in bounding box)', () => {
      // Note: Toronto falls within the simple bounding box used for US detection
      // This is acceptable as the function is used only to decide whether to attempt NCEI
      expect(isLocationInUS(43.6532, -79.3832)).toBe(true);
    });

    it('should handle edge cases at US borders', () => {
      // Just inside southern border
      expect(isLocationInUS(24.5, -100)).toBe(true);

      // Just outside southern border
      expect(isLocationInUS(23.5, -100)).toBe(false);

      // Just inside northern border
      expect(isLocationInUS(49.5, -100)).toBe(true);

      // Just outside northern border
      expect(isLocationInUS(50.5, -100)).toBe(false);
    });
  });
});
