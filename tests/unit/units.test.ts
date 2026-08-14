import { describe, it, expect } from 'vitest';
import {
  celsiusToFahrenheit,
  metersToFeet,
  kphToMph,
  knotsToMph,
  pascalsToInHg,
  pascalsToMb,
  metersToMiles,
  mpsToMph,
  cubicMetersPerSecondToCubicFeetPerSecond,
  extractValue,
  formatTemperature,
  formatWindSpeed,
  formatVisibility,
  formatPressure,
  formatPercentage,
  formatWindDirection,
  formatDateTime,
  formatDate,
  windDirectionFromDegrees,
  relativeHumidityFromDewpoint,
} from '../../src/utils/units.js';

describe('Unit Conversions', () => {
  describe('Temperature Conversions', () => {
    describe('celsiusToFahrenheit', () => {
      it('should convert 0°C to 32°F', () => {
        expect(celsiusToFahrenheit(0)).toBe(32);
      });

      it('should convert 100°C to 212°F', () => {
        expect(celsiusToFahrenheit(100)).toBe(212);
      });

      it('should convert -40°C to -40°F', () => {
        expect(celsiusToFahrenheit(-40)).toBe(-40);
      });

      it('should handle decimal values', () => {
        expect(celsiusToFahrenheit(25)).toBe(77);
      });

      it('should handle negative values', () => {
        expect(celsiusToFahrenheit(-10)).toBe(14);
      });
    });
  });

  describe('Distance Conversions', () => {
    describe('metersToFeet', () => {
      it('should convert 1 meter to approximately 3.28084 feet', () => {
        expect(metersToFeet(1)).toBeCloseTo(3.28084, 4);
      });

      it('should convert 0 meters to 0 feet', () => {
        expect(metersToFeet(0)).toBe(0);
      });

      it('should handle large values', () => {
        expect(metersToFeet(1000)).toBeCloseTo(3280.84, 1);
      });
    });


    describe('metersToMiles', () => {
      it('should convert 1609.34 meters to 1 mile', () => {
        expect(metersToMiles(1609.34)).toBeCloseTo(1, 4);
      });

      it('should convert 0 meters to 0 miles', () => {
        expect(metersToMiles(0)).toBe(0);
      });

      it('should handle large values', () => {
        expect(metersToMiles(10000)).toBeCloseTo(6.2137, 3);
      });
    });

  });

  describe('Flow Rate Conversions', () => {
    describe('cubicMetersPerSecondToCubicFeetPerSecond', () => {
      it('should convert 0 m³/s to 0 ft³/s', () => {
        expect(cubicMetersPerSecondToCubicFeetPerSecond(0)).toBe(0);
      });

      it('should convert 1 m³/s to approximately 35.31 ft³/s', () => {
        expect(cubicMetersPerSecondToCubicFeetPerSecond(1)).toBeCloseTo(35.3147, 4);
      });

      it('should handle large values', () => {
        expect(cubicMetersPerSecondToCubicFeetPerSecond(11640)).toBeCloseTo(411063.1, 0);
      });
    });
  });

  describe('Speed Conversions', () => {
    describe('kphToMph', () => {
      it('should convert 100 km/h to approximately 62.1371 mph', () => {
        expect(kphToMph(100)).toBeCloseTo(62.1371, 4);
      });

      it('should convert 0 km/h to 0 mph', () => {
        expect(kphToMph(0)).toBe(0);
      });

      it('should handle decimal values', () => {
        expect(kphToMph(50.5)).toBeCloseTo(31.3792, 3);
      });
    });

    describe('mpsToMph', () => {
      it('should convert meters/second to mph correctly', () => {
        expect(mpsToMph(10)).toBeCloseTo(22.3694, 3);
      });

      it('should convert 0 m/s to 0 mph', () => {
        expect(mpsToMph(0)).toBe(0);
      });
    });

    describe('knotsToMph', () => {
      it('should convert 10 knots to approximately 11.5078 mph', () => {
        expect(knotsToMph(10)).toBeCloseTo(11.5078, 4);
      });

      it('should convert 0 knots to 0 mph', () => {
        expect(knotsToMph(0)).toBe(0);
      });

      it('should handle negative values', () => {
        expect(knotsToMph(-10)).toBeCloseTo(-11.5078, 4);
      });
    });
  });

  describe('Pressure Conversions', () => {
    describe('pascalsToInHg', () => {
      it('should convert 101325 Pa (1 atm) to approximately 29.92 inHg', () => {
        expect(pascalsToInHg(101325)).toBeCloseTo(29.92, 2);
      });

      it('should convert 0 Pa to 0 inHg', () => {
        expect(pascalsToInHg(0)).toBe(0);
      });

      it('should handle typical atmospheric pressure', () => {
        expect(pascalsToInHg(100000)).toBeCloseTo(29.53, 2);
      });
    });

    describe('pascalsToMb', () => {
      it('should convert 100000 Pa to 1000 mb', () => {
        expect(pascalsToMb(100000)).toBe(1000);
      });

      it('should convert 101325 Pa to 1013.25 mb', () => {
        expect(pascalsToMb(101325)).toBe(1013.25);
      });

      it('should convert 0 Pa to 0 mb', () => {
        expect(pascalsToMb(0)).toBe(0);
      });
    });
  });

  describe('Value Extraction', () => {
    describe('extractValue', () => {
      it('should extract value from QuantitativeValue', () => {
        expect(extractValue({ value: 42, unitCode: 'test' })).toBe(42);
      });

      it('should return null for undefined', () => {
        expect(extractValue(undefined)).toBe(null);
      });

      it('should return null for null value', () => {
        expect(extractValue({ value: null, unitCode: 'test' })).toBe(null);
      });

      it('should return null for undefined value', () => {
        expect(extractValue({ value: undefined, unitCode: 'test' } as any)).toBe(null);
      });
    });
  });

  describe('Formatting Functions', () => {
    describe('formatTemperature', () => {
      it('should format Celsius to Fahrenheit', () => {
        const qv = { value: 20, unitCode: 'wmoUnit:degC' };
        expect(formatTemperature(qv)).toBe('68°F');
      });

      it('should keep Celsius when preferFahrenheit is false', () => {
        const qv = { value: 20, unitCode: 'wmoUnit:degC' };
        expect(formatTemperature(qv, false)).toBe('20°C');
      });

      it('should handle Fahrenheit values', () => {
        const qv = { value: 68, unitCode: 'wmoUnit:degF' };
        expect(formatTemperature(qv)).toBe('68°F');
      });

      it('should return N/A for null values', () => {
        expect(formatTemperature(undefined)).toBe('N/A');
        expect(formatTemperature({ value: null, unitCode: 'wmoUnit:degC' })).toBe('N/A');
      });

      it('should round to nearest degree', () => {
        const qv = { value: 20.6, unitCode: 'wmoUnit:degC' };
        expect(formatTemperature(qv)).toBe('69°F');
      });
    });

    describe('formatWindSpeed', () => {
      it('should format m/s to mph', () => {
        const qv = { value: 10, unitCode: 'wmoUnit:m_s-1' };
        expect(formatWindSpeed(qv)).toContain('mph');
        expect(formatWindSpeed(qv)).toContain('22');
      });

      it('should format km/h to mph', () => {
        const qv = { value: 100, unitCode: 'wmoUnit:km_h-1' };
        expect(formatWindSpeed(qv)).toContain('mph');
        expect(formatWindSpeed(qv)).toContain('62');
      });

      it('should handle mph values directly', () => {
        const qv = { value: 50, unitCode: 'wmoUnit:mph' };
        expect(formatWindSpeed(qv)).toBe('50 mph');
      });

      it('should return Calm for null values', () => {
        expect(formatWindSpeed(undefined)).toBe('Calm');
        expect(formatWindSpeed({ value: null, unitCode: 'wmoUnit:m_s-1' })).toBe('Calm');
      });
    });

    describe('formatVisibility', () => {
      it('should format meters to miles', () => {
        const qv = { value: 16093.4, unitCode: 'wmoUnit:m' };
        expect(formatVisibility(qv)).toContain('10.0 miles');
      });

      it('should return N/A for null values', () => {
        expect(formatVisibility(undefined)).toBe('N/A');
      });

      it('should format to one decimal place', () => {
        const qv = { value: 8046.7, unitCode: 'wmoUnit:m' };
        const result = formatVisibility(qv);
        expect(result).toMatch(/\d+\.\d miles/);
      });
    });

    describe('formatPressure', () => {
      it('should format Pascals to inHg', () => {
        const qv = { value: 101325, unitCode: 'wmoUnit:Pa' };
        const result = formatPressure(qv);
        expect(result).toContain('inHg');
        expect(result).toMatch(/29\.\d{2}/);
      });

      it('should return N/A for null values', () => {
        expect(formatPressure(undefined)).toBe('N/A');
      });

      it('should format to two decimal places', () => {
        const qv = { value: 100000, unitCode: 'wmoUnit:Pa' };
        const result = formatPressure(qv);
        expect(result).toMatch(/\d+\.\d{2} inHg/);
      });
    });

    describe('formatPercentage', () => {
      it('should format percentage values', () => {
        const qv = { value: 75.5, unitCode: 'wmoUnit:percent' };
        expect(formatPercentage(qv)).toBe('76%');
      });

      it('should return N/A for null values', () => {
        expect(formatPercentage(undefined)).toBe('N/A');
      });

      it('should round to nearest whole number', () => {
        expect(formatPercentage({ value: 33.3, unitCode: 'wmoUnit:percent' })).toBe('33%');
        expect(formatPercentage({ value: 66.7, unitCode: 'wmoUnit:percent' })).toBe('67%');
      });
    });

    describe('formatWindDirection', () => {
      it('should convert 0 degrees to N', () => {
        const qv = { value: 0, unitCode: 'wmoUnit:degree_(angle)' };
        expect(formatWindDirection(qv)).toBe('N');
      });

      it('should convert 90 degrees to E', () => {
        const qv = { value: 90, unitCode: 'wmoUnit:degree_(angle)' };
        expect(formatWindDirection(qv)).toBe('E');
      });

      it('should convert 180 degrees to S', () => {
        const qv = { value: 180, unitCode: 'wmoUnit:degree_(angle)' };
        expect(formatWindDirection(qv)).toBe('S');
      });

      it('should convert 270 degrees to W', () => {
        const qv = { value: 270, unitCode: 'wmoUnit:degree_(angle)' };
        expect(formatWindDirection(qv)).toBe('W');
      });

      it('should handle intermediate directions', () => {
        expect(formatWindDirection({ value: 45, unitCode: 'wmoUnit:degree_(angle)' })).toBe('NE');
        expect(formatWindDirection({ value: 135, unitCode: 'wmoUnit:degree_(angle)' })).toBe('SE');
        expect(formatWindDirection({ value: 225, unitCode: 'wmoUnit:degree_(angle)' })).toBe('SW');
        expect(formatWindDirection({ value: 315, unitCode: 'wmoUnit:degree_(angle)' })).toBe('NW');
      });

      it('should return Variable for null values', () => {
        expect(formatWindDirection(undefined)).toBe('Variable');
        expect(formatWindDirection({ value: null, unitCode: 'wmoUnit:degree_(angle)' })).toBe('Variable');
      });

      it('should handle 360 degrees (wraps to N)', () => {
        const qv = { value: 360, unitCode: 'wmoUnit:degree_(angle)' };
        expect(formatWindDirection(qv)).toBe('N');
      });
    });

    describe('windDirectionFromDegrees', () => {
      it('should sit at N for 0 degrees', () => {
        expect(windDirectionFromDegrees(0)).toBe('N');
      });

      it('should stay at N just below the NNE boundary', () => {
        expect(windDirectionFromDegrees(11.24)).toBe('N');
      });

      it('should cross into NNE just above the boundary', () => {
        expect(windDirectionFromDegrees(11.26)).toBe('NNE');
      });

      it('should stay at N just below the wraparound boundary', () => {
        expect(windDirectionFromDegrees(348.75)).toBe('N');
      });

      it('should wrap 360 degrees back to N', () => {
        expect(windDirectionFromDegrees(360)).toBe('N');
      });
    });

    describe('relativeHumidityFromDewpoint', () => {
      it('should return 100% when temperature equals dew point', () => {
        expect(relativeHumidityFromDewpoint(20, 20)).toBe(100);
        expect(relativeHumidityFromDewpoint(13, 13)).toBe(100);
      });

      it('should return roughly 53% for a 10-degree spread at 20C', () => {
        const rh = relativeHumidityFromDewpoint(20, 10);
        expect(rh).toBeGreaterThanOrEqual(52);
        expect(rh).toBeLessThanOrEqual(54);
      });

      it('should clamp to 100 when dew point exceeds temperature', () => {
        expect(relativeHumidityFromDewpoint(10, 20)).toBeLessThanOrEqual(100);
        expect(relativeHumidityFromDewpoint(10, 20)).toBe(100);
      });
    });

    describe('formatDateTime', () => {
      it('should format ISO string to readable date/time', () => {
        const result = formatDateTime('2024-01-15T12:00:00Z');
        expect(result).toContain('Jan');
        expect(result).toContain('15');
      });

      it('should include time components', () => {
        const result = formatDateTime('2024-06-20T14:30:00Z');
        expect(result).toMatch(/\d{1,2}:\d{2}/); // Contains time
      });

      it('should handle different ISO formats', () => {
        expect(() => formatDateTime('2024-01-15T12:00:00.000Z')).not.toThrow();
        expect(() => formatDateTime('2024-01-15T12:00:00+00:00')).not.toThrow();
      });
    });

    describe('formatDate', () => {
      it('should format ISO string to readable date only', () => {
        const result = formatDate('2024-01-15T12:00:00Z');
        expect(result).toContain('January');
        expect(result).toContain('15');
        expect(result).toContain('2024');
      });

      it('should include day of week', () => {
        const result = formatDate('2024-01-15T00:00:00Z');
        expect(result).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
      });

      it('should not include time components', () => {
        const result = formatDate('2024-06-20T14:30:00Z');
        expect(result).not.toMatch(/\d{1,2}:\d{2}/);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small decimal values', () => {
      expect(celsiusToFahrenheit(0.01)).toBeCloseTo(32.018, 2);
    });

    it('should handle very large values', () => {
      expect(metersToFeet(10000)).toBeCloseTo(32808.4, 0);
    });

    it('should handle negative values in all conversions', () => {
      expect(celsiusToFahrenheit(-273.15)).toBeCloseTo(-459.67, 1); // Absolute zero
      expect(metersToFeet(-10)).toBeCloseTo(-32.8084, 3);
    });

    it('should handle zero in formatters', () => {
      expect(formatTemperature({ value: 0, unitCode: 'wmoUnit:degC' })).toBe('32°F');
      expect(formatWindSpeed({ value: 0, unitCode: 'wmoUnit:m_s-1' })).toBe('0 mph');
      expect(formatPercentage({ value: 0, unitCode: 'wmoUnit:percent' })).toBe('0%');
    });

    it('should handle undefined unitCode in formatters', () => {
      expect(formatTemperature({ value: 68, unitCode: undefined })).toBe('68°F');
      expect(formatWindSpeed({ value: 10, unitCode: undefined })).toBe('10 mph');
    });
  });

  describe('Boundary Values', () => {
    it('should handle zero correctly in all conversions', () => {
      expect(metersToFeet(0)).toBe(0);
      expect(kphToMph(0)).toBe(0);
      expect(pascalsToInHg(0)).toBe(0);
      expect(pascalsToMb(0)).toBe(0);
    });

    it('should handle typical weather values', () => {
      // Typical temperature range
      expect(celsiusToFahrenheit(-30)).toBe(-22);
      expect(celsiusToFahrenheit(40)).toBe(104);

      // Typical wind speeds
      expect(kphToMph(50)).toBeCloseTo(31.07, 1);
      expect(kphToMph(150)).toBeCloseTo(93.21, 1);

      // Typical atmospheric pressure
      expect(pascalsToInHg(98000)).toBeCloseTo(28.94, 1);
      expect(pascalsToInHg(104000)).toBeCloseTo(30.71, 1);
    });
  });
});
