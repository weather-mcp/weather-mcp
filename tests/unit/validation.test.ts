import { describe, it, expect } from 'vitest';
import {
  validateLatitude,
  validateLongitude,
  validateCoordinates,
  validatePositiveInteger,
  validateBoolean,
  validateDateString,
  validateForecastDays,
  validateGranularity,
  validateOptionalBoolean,
  validateHistoricalWeatherParams,
} from '../../src/utils/validation.js';

describe('Validation Utilities', () => {
  describe('validateLatitude', () => {
    it('should accept valid latitude values', () => {
      expect(() => validateLatitude(0)).not.toThrow();
      expect(() => validateLatitude(45.5)).not.toThrow();
      expect(() => validateLatitude(-45.5)).not.toThrow();
      expect(() => validateLatitude(90)).not.toThrow();
      expect(() => validateLatitude(-90)).not.toThrow();
    });

    it('should reject latitude > 90', () => {
      expect(() => validateLatitude(90.1)).toThrow('Invalid latitude');
      expect(() => validateLatitude(100)).toThrow('Invalid latitude');
    });

    it('should reject latitude < -90', () => {
      expect(() => validateLatitude(-90.1)).toThrow('Invalid latitude');
      expect(() => validateLatitude(-100)).toThrow('Invalid latitude');
    });

    it('should reject non-numeric values', () => {
      expect(() => validateLatitude('45' as any)).toThrow('must be a finite number');
      expect(() => validateLatitude(null as any)).toThrow('must be a finite number');
      expect(() => validateLatitude(undefined as any)).toThrow('must be a finite number');
    });

    it('should reject NaN', () => {
      expect(() => validateLatitude(NaN)).toThrow('must be a finite number');
    });

    it('should reject Infinity', () => {
      expect(() => validateLatitude(Infinity)).toThrow('must be a finite number');
      expect(() => validateLatitude(-Infinity)).toThrow('must be a finite number');
    });
  });

  describe('validateLongitude', () => {
    it('should accept valid longitude values', () => {
      expect(() => validateLongitude(0)).not.toThrow();
      expect(() => validateLongitude(122.4)).not.toThrow();
      expect(() => validateLongitude(-122.4)).not.toThrow();
      expect(() => validateLongitude(180)).not.toThrow();
      expect(() => validateLongitude(-180)).not.toThrow();
    });

    it('should reject longitude > 180', () => {
      expect(() => validateLongitude(180.1)).toThrow('Invalid longitude');
      expect(() => validateLongitude(200)).toThrow('Invalid longitude');
    });

    it('should reject longitude < -180', () => {
      expect(() => validateLongitude(-180.1)).toThrow('Invalid longitude');
      expect(() => validateLongitude(-200)).toThrow('Invalid longitude');
    });

    it('should reject non-numeric values', () => {
      expect(() => validateLongitude('122' as any)).toThrow('must be a finite number');
      expect(() => validateLongitude(null as any)).toThrow('must be a finite number');
    });

    it('should reject NaN and Infinity', () => {
      expect(() => validateLongitude(NaN)).toThrow('must be a finite number');
      expect(() => validateLongitude(Infinity)).toThrow('must be a finite number');
    });
  });

  describe('validateCoordinates', () => {
    it('should accept valid coordinate pairs', () => {
      const result = validateCoordinates({ latitude: 37.7749, longitude: -122.4194 });
      expect(result).toEqual({ latitude: 37.7749, longitude: -122.4194 });
    });

    it('should reject invalid latitude', () => {
      expect(() => validateCoordinates({ latitude: 100, longitude: -122 }))
        .toThrow('Invalid latitude');
    });

    it('should reject invalid longitude', () => {
      expect(() => validateCoordinates({ latitude: 37, longitude: 200 }))
        .toThrow('Invalid longitude');
    });

    it('should reject non-object args', () => {
      expect(() => validateCoordinates(null)).toThrow('expected object');
      expect(() => validateCoordinates('string' as any)).toThrow('expected object');
      expect(() => validateCoordinates(123 as any)).toThrow('expected object');
    });

    it('should reject missing latitude', () => {
      expect(() => validateCoordinates({ longitude: -122 }))
        .toThrow('Invalid latitude');
    });

    it('should reject missing longitude', () => {
      expect(() => validateCoordinates({ latitude: 37 }))
        .toThrow('Invalid longitude');
    });
  });

  describe('validatePositiveInteger', () => {
    it('should accept positive integers', () => {
      expect(validatePositiveInteger(1, 'test')).toBe(1);
      expect(validatePositiveInteger(100, 'test')).toBe(100);
      expect(validatePositiveInteger(7, 'days', 1, 7)).toBe(7);
    });

    it('should reject non-integers', () => {
      expect(() => validatePositiveInteger(1.5, 'test')).toThrow('must be an integer');
      expect(() => validatePositiveInteger(3.14, 'test')).toThrow('must be an integer');
    });

    it('should reject negative numbers', () => {
      expect(() => validatePositiveInteger(-1, 'test', 1, 10)).toThrow('Must be between');
    });

    it('should reject zero when min is 1', () => {
      expect(() => validatePositiveInteger(0, 'test', 1, 10)).toThrow('Must be between');
    });

    it('should enforce max value', () => {
      expect(() => validatePositiveInteger(8, 'days', 1, 7)).toThrow('Must be between 1 and 7');
    });

    it('should enforce min value', () => {
      expect(() => validatePositiveInteger(0, 'days', 1, 7)).toThrow('Must be between 1 and 7');
    });

    it('should reject non-numeric values', () => {
      expect(() => validatePositiveInteger('5' as any, 'test')).toThrow('must be a finite number');
    });

    it('should reject NaN and Infinity', () => {
      expect(() => validatePositiveInteger(NaN, 'test')).toThrow('must be a finite number');
      expect(() => validatePositiveInteger(Infinity, 'test')).toThrow('must be a finite number');
    });
  });

  describe('validateBoolean', () => {
    it('should accept boolean values', () => {
      expect(validateBoolean(true, 'test')).toBe(true);
      expect(validateBoolean(false, 'test')).toBe(false);
    });

    it('should reject non-boolean values', () => {
      expect(() => validateBoolean('true' as any, 'test')).toThrow('must be a boolean');
      expect(() => validateBoolean(1 as any, 'test')).toThrow('must be a boolean');
      expect(() => validateBoolean(null as any, 'test')).toThrow('must be a boolean');
      expect(() => validateBoolean(undefined as any, 'test')).toThrow('must be a boolean');
    });
  });

  describe('validateDateString', () => {
    it('should accept valid ISO date strings', () => {
      expect(validateDateString('2024-01-15', 'test')).toBe('2024-01-15');
      expect(validateDateString('2024-12-31', 'test')).toBe('2024-12-31');
    });

    it('should accept ISO 8601 datetime strings', () => {
      expect(validateDateString('2024-01-15T12:00:00Z', 'test')).toBe('2024-01-15T12:00:00Z');
      expect(validateDateString('2024-01-15T12:00:00.000Z', 'test')).toBe('2024-01-15T12:00:00.000Z');
    });

    it('should reject invalid date strings', () => {
      expect(() => validateDateString('not-a-date', 'test')).toThrow('not a valid date format');
      expect(() => validateDateString('2024-13-01', 'test')).toThrow('not a valid date format');
      expect(() => validateDateString('2024-01-32', 'test')).toThrow('not a valid date format');
    });

    it('should reject non-string values', () => {
      expect(() => validateDateString(123 as any, 'test')).toThrow('must be a string');
      expect(() => validateDateString(null as any, 'test')).toThrow('must be a string');
    });
  });

  describe('validateForecastDays', () => {
    it('should return 7 as default when args is not an object', () => {
      expect(validateForecastDays(null)).toBe(7);
      expect(validateForecastDays(undefined)).toBe(7);
    });

    it('should return 7 as default when days is undefined', () => {
      expect(validateForecastDays({})).toBe(7);
      expect(validateForecastDays({ latitude: 37 })).toBe(7);
    });

    it('should accept valid days values', () => {
      expect(validateForecastDays({ days: 1 })).toBe(1);
      expect(validateForecastDays({ days: 7 })).toBe(7);
      expect(validateForecastDays({ days: 3 })).toBe(3);
    });

    it('should reject days < 1', () => {
      expect(() => validateForecastDays({ days: 0 })).toThrow('Must be between 1 and 7');
      expect(() => validateForecastDays({ days: -1 })).toThrow('Must be between 1 and 7');
    });

    it('should reject days > 7', () => {
      expect(() => validateForecastDays({ days: 8 })).toThrow('Must be between 1 and 7');
      expect(() => validateForecastDays({ days: 14 })).toThrow('Must be between 1 and 7');
    });
  });

  describe('validateGranularity', () => {
    it('should return "daily" as default when undefined', () => {
      expect(validateGranularity(undefined)).toBe('daily');
    });

    it('should accept "daily"', () => {
      expect(validateGranularity('daily')).toBe('daily');
    });

    it('should accept "hourly"', () => {
      expect(validateGranularity('hourly')).toBe('hourly');
    });

    it('should reject invalid granularity values', () => {
      expect(() => validateGranularity('weekly')).toThrow('Must be either "daily" or "hourly"');
      expect(() => validateGranularity('monthly')).toThrow('Must be either "daily" or "hourly"');
    });

    it('should reject non-string values', () => {
      expect(() => validateGranularity(123 as any)).toThrow('must be a string');
    });
  });

  describe('validateOptionalBoolean', () => {
    it('should return default value when undefined', () => {
      expect(validateOptionalBoolean(undefined, 'test', true)).toBe(true);
      expect(validateOptionalBoolean(undefined, 'test', false)).toBe(false);
    });

    it('should accept boolean values', () => {
      expect(validateOptionalBoolean(true, 'test', false)).toBe(true);
      expect(validateOptionalBoolean(false, 'test', true)).toBe(false);
    });

    it('should reject non-boolean non-undefined values', () => {
      expect(() => validateOptionalBoolean('true' as any, 'test', true))
        .toThrow('must be a boolean');
      expect(() => validateOptionalBoolean(1 as any, 'test', true))
        .toThrow('must be a boolean');
    });
  });

  describe('validateHistoricalWeatherParams', () => {
    it('should accept valid parameters', () => {
      const result = validateHistoricalWeatherParams({
        latitude: 37.7749,
        longitude: -122.4194,
        start_date: '2024-01-01',
        end_date: '2024-01-31',
      });

      expect(result).toEqual({
        latitude: 37.7749,
        longitude: -122.4194,
        start_date: '2024-01-01',
        end_date: '2024-01-31',
      });
    });

    it('should include optional limit parameter', () => {
      const result = validateHistoricalWeatherParams({
        latitude: 37.7749,
        longitude: -122.4194,
        start_date: '2024-01-01',
        end_date: '2024-01-31',
        limit: 100,
      });

      expect(result.limit).toBe(100);
    });

    it('should reject invalid coordinates', () => {
      expect(() => validateHistoricalWeatherParams({
        latitude: 100,
        longitude: -122,
        start_date: '2024-01-01',
        end_date: '2024-01-31',
      })).toThrow('Invalid latitude');
    });

    it('should reject invalid dates', () => {
      expect(() => validateHistoricalWeatherParams({
        latitude: 37,
        longitude: -122,
        start_date: 'invalid',
        end_date: '2024-01-31',
      })).toThrow('not a valid date format');
    });

    it('should reject start_date after end_date', () => {
      expect(() => validateHistoricalWeatherParams({
        latitude: 37,
        longitude: -122,
        start_date: '2024-02-01',
        end_date: '2024-01-01',
      })).toThrow('start_date must be before or equal to end_date');
    });

    it('should accept equal start and end dates', () => {
      const result = validateHistoricalWeatherParams({
        latitude: 37,
        longitude: -122,
        start_date: '2024-01-15',
        end_date: '2024-01-15',
      });

      expect(result.start_date).toBe('2024-01-15');
      expect(result.end_date).toBe('2024-01-15');
    });

    it('should reject limit < 1', () => {
      expect(() => validateHistoricalWeatherParams({
        latitude: 37,
        longitude: -122,
        start_date: '2024-01-01',
        end_date: '2024-01-31',
        limit: 0,
      })).toThrow('Must be between 1 and 500');
    });

    it('should reject limit > 500', () => {
      expect(() => validateHistoricalWeatherParams({
        latitude: 37,
        longitude: -122,
        start_date: '2024-01-01',
        end_date: '2024-01-31',
        limit: 501,
      })).toThrow('Must be between 1 and 500');
    });

    it('should reject non-object args', () => {
      expect(() => validateHistoricalWeatherParams(null))
        .toThrow('expected object with coordinates and date range');
    });
  });

  describe('Security Tests', () => {
    it('should prevent injection attacks in coordinates', () => {
      expect(() => validateCoordinates({ latitude: '37; DROP TABLE' as any, longitude: -122 }))
        .toThrow();
      expect(() => validateCoordinates({ latitude: 37, longitude: '<script>alert("xss")</script>' as any }))
        .toThrow();
    });

    it('should prevent prototype pollution attempts', () => {
      expect(() => validateCoordinates({
        latitude: 37,
        longitude: -122,
        __proto__: { polluted: true }
      } as any)).not.toThrow();

      // Verify the prototype wasn't actually polluted
      expect((({} as any).polluted)).toBeUndefined();
    });

    it('should handle edge case numeric values safely', () => {
      expect(() => validateLatitude(Number.MAX_VALUE)).toThrow();
      expect(() => validateLatitude(Number.MIN_VALUE)).not.toThrow();
      expect(() => validateLatitude(-0)).not.toThrow();
    });
  });
});
