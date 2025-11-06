import { describe, it, expect } from 'vitest';
import {
  celsiusToFahrenheit,
  metersToFeet,
  kphToMph,
  pascalsToInHg,
  pascalsToMb,
  metersToMiles,
  mpsToMph,
  extractValue,
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
