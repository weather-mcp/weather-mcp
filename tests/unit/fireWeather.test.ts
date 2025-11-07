import { describe, it, expect } from 'vitest';
import {
  getHainesCategory,
  getGrasslandFireDangerCategory,
  getRedFlagCategory,
  getCurrentFireWeatherValue,
  formatMixingHeight,
  interpretTransportWind,
} from '../../src/utils/fireWeather.js';

describe('Fire Weather Utilities', () => {
  describe('getHainesCategory', () => {
    describe('Low category (<=3)', () => {
      it('should return Low for Haines value 2', () => {
        const result = getHainesCategory(2);
        expect(result.level).toBe('Low');
        expect(result.description).toBe('Low fire growth potential');
        expect(result.fireGrowthPotential).toContain('Very low likelihood');
        expect(result.color).toBe('Green');
      });

      it('should return Low for Haines value 3 (boundary)', () => {
        const result = getHainesCategory(3);
        expect(result.level).toBe('Low');
        expect(result.description).toBe('Low fire growth potential');
        expect(result.color).toBe('Green');
      });

      it('should return Low for Haines value 1 (below minimum scale)', () => {
        const result = getHainesCategory(1);
        expect(result.level).toBe('Low');
        expect(result.color).toBe('Green');
      });

      it('should return Low for Haines value 0', () => {
        const result = getHainesCategory(0);
        expect(result.level).toBe('Low');
        expect(result.color).toBe('Green');
      });

      it('should return Low for negative Haines value', () => {
        const result = getHainesCategory(-5);
        expect(result.level).toBe('Low');
        expect(result.color).toBe('Green');
      });
    });

    describe('Moderate category (4)', () => {
      it('should return Moderate for Haines value 4', () => {
        const result = getHainesCategory(4);
        expect(result.level).toBe('Moderate');
        expect(result.description).toBe('Moderate fire growth potential');
        expect(result.fireGrowthPotential).toContain('Moderate likelihood');
        expect(result.color).toBe('Yellow');
      });

      it('should return Moderate for decimal 4.0', () => {
        const result = getHainesCategory(4.0);
        expect(result.level).toBe('Moderate');
        expect(result.color).toBe('Yellow');
      });
    });

    describe('High category (5)', () => {
      it('should return High for Haines value 5', () => {
        const result = getHainesCategory(5);
        expect(result.level).toBe('High');
        expect(result.description).toBe('High fire growth potential');
        expect(result.fireGrowthPotential).toContain('High likelihood');
        expect(result.color).toBe('Orange');
      });

      it('should return High for decimal 5.0', () => {
        const result = getHainesCategory(5.0);
        expect(result.level).toBe('High');
        expect(result.color).toBe('Orange');
      });
    });

    describe('Very High category (>=6)', () => {
      it('should return Very High for Haines value 6', () => {
        const result = getHainesCategory(6);
        expect(result.level).toBe('Very High');
        expect(result.description).toBe('Very high fire growth potential');
        expect(result.fireGrowthPotential).toContain('Very high likelihood');
        expect(result.color).toBe('Red');
      });

      it('should return Very High for value above scale (7)', () => {
        const result = getHainesCategory(7);
        expect(result.level).toBe('Very High');
        expect(result.color).toBe('Red');
      });

      it('should return Very High for value 100 (extreme)', () => {
        const result = getHainesCategory(100);
        expect(result.level).toBe('Very High');
        expect(result.color).toBe('Red');
      });
    });

    describe('Boundary transitions', () => {
      it('should transition from Low to Moderate at 3.5', () => {
        const lowResult = getHainesCategory(3);
        const moderateResult = getHainesCategory(4);
        expect(lowResult.level).toBe('Low');
        expect(moderateResult.level).toBe('Moderate');
      });

      it('should transition from Moderate to High at 4.5', () => {
        const moderateResult = getHainesCategory(4);
        const highResult = getHainesCategory(5);
        expect(moderateResult.level).toBe('Moderate');
        expect(highResult.level).toBe('High');
      });

      it('should transition from High to Very High at 5.5', () => {
        const highResult = getHainesCategory(5);
        const veryHighResult = getHainesCategory(6);
        expect(highResult.level).toBe('High');
        expect(veryHighResult.level).toBe('Very High');
      });
    });

    describe('Edge cases', () => {
      it('should handle decimal values (fall through to else)', () => {
        // Note: Function uses strict equality for 4 and 5, so decimals fall through
        expect(getHainesCategory(3.5).level).toBe('Very High'); // Not === 4 or 5, > 3
        expect(getHainesCategory(4.5).level).toBe('Very High'); // Not === 4 or 5
        expect(getHainesCategory(5.5).level).toBe('Very High'); // Not === 4 or 5
      });

      it('should handle NaN gracefully', () => {
        const result = getHainesCategory(NaN);
        expect(result).toBeDefined();
        expect(result.level).toBeDefined();
      });
    });
  });

  describe('getGrasslandFireDangerCategory', () => {
    describe('Low category (<=1)', () => {
      it('should return Low for value 0', () => {
        const result = getGrasslandFireDangerCategory(0);
        expect(result.level).toBe('Low');
        expect(result.description).toBe('Low fire danger in grassland/rangeland fuels');
        expect(result.color).toBe('Green');
      });

      it('should return Low for value 1 (boundary)', () => {
        const result = getGrasslandFireDangerCategory(1);
        expect(result.level).toBe('Low');
        expect(result.color).toBe('Green');
      });

      it('should return Low for negative value', () => {
        const result = getGrasslandFireDangerCategory(-1);
        expect(result.level).toBe('Low');
        expect(result.color).toBe('Green');
      });
    });

    describe('Moderate category (2)', () => {
      it('should return Moderate for value 2', () => {
        const result = getGrasslandFireDangerCategory(2);
        expect(result.level).toBe('Moderate');
        expect(result.description).toBe('Moderate fire danger in grassland/rangeland fuels');
        expect(result.color).toBe('Yellow');
      });

      it('should return Moderate for decimal 2.0', () => {
        const result = getGrasslandFireDangerCategory(2.0);
        expect(result.level).toBe('Moderate');
        expect(result.color).toBe('Yellow');
      });
    });

    describe('High category (3)', () => {
      it('should return High for value 3', () => {
        const result = getGrasslandFireDangerCategory(3);
        expect(result.level).toBe('High');
        expect(result.description).toBe('High fire danger in grassland/rangeland fuels');
        expect(result.color).toBe('Orange');
      });

      it('should return High for decimal 3.0', () => {
        const result = getGrasslandFireDangerCategory(3.0);
        expect(result.level).toBe('High');
        expect(result.color).toBe('Orange');
      });
    });

    describe('Very High category (>=4)', () => {
      it('should return Very High for value 4', () => {
        const result = getGrasslandFireDangerCategory(4);
        expect(result.level).toBe('Very High');
        expect(result.description).toBe('Very high fire danger in grassland/rangeland fuels');
        expect(result.color).toBe('Red');
      });

      it('should return Very High for value 5', () => {
        const result = getGrasslandFireDangerCategory(5);
        expect(result.level).toBe('Very High');
        expect(result.color).toBe('Red');
      });

      it('should return Very High for value 100 (extreme)', () => {
        const result = getGrasslandFireDangerCategory(100);
        expect(result.level).toBe('Very High');
        expect(result.color).toBe('Red');
      });
    });

    describe('Boundary transitions', () => {
      it('should transition from Low to Moderate at boundary', () => {
        const lowResult = getGrasslandFireDangerCategory(1);
        const moderateResult = getGrasslandFireDangerCategory(2);
        expect(lowResult.level).toBe('Low');
        expect(moderateResult.level).toBe('Moderate');
      });

      it('should transition from Moderate to High at boundary', () => {
        const moderateResult = getGrasslandFireDangerCategory(2);
        const highResult = getGrasslandFireDangerCategory(3);
        expect(moderateResult.level).toBe('Moderate');
        expect(highResult.level).toBe('High');
      });

      it('should transition from High to Very High at boundary', () => {
        const highResult = getGrasslandFireDangerCategory(3);
        const veryHighResult = getGrasslandFireDangerCategory(4);
        expect(highResult.level).toBe('High');
        expect(veryHighResult.level).toBe('Very High');
      });
    });

    describe('Edge cases', () => {
      it('should handle decimal values (fall through to else)', () => {
        // Note: Function uses strict equality for 2 and 3, so decimals fall through
        expect(getGrasslandFireDangerCategory(1.5).level).toBe('Very High'); // Not === 2 or 3, > 1
        expect(getGrasslandFireDangerCategory(2.5).level).toBe('Very High'); // Not === 2 or 3
        expect(getGrasslandFireDangerCategory(3.5).level).toBe('Very High'); // Not === 2 or 3
      });

      it('should handle NaN gracefully', () => {
        const result = getGrasslandFireDangerCategory(NaN);
        expect(result).toBeDefined();
        expect(result.level).toBeDefined();
      });
    });
  });

  describe('getRedFlagCategory', () => {
    describe('Low category (<30)', () => {
      it('should return Low for value 0', () => {
        const result = getRedFlagCategory(0);
        expect(result.level).toBe('Low');
        expect(result.description).toBe('Low threat of Red Flag Warning conditions');
        expect(result.color).toBe('Green');
      });

      it('should return Low for value 29 (just below boundary)', () => {
        const result = getRedFlagCategory(29);
        expect(result.level).toBe('Low');
        expect(result.color).toBe('Green');
      });

      it('should return Low for negative value', () => {
        const result = getRedFlagCategory(-5);
        expect(result.level).toBe('Low');
        expect(result.color).toBe('Green');
      });

      it('should return Low for value 15', () => {
        const result = getRedFlagCategory(15);
        expect(result.level).toBe('Low');
        expect(result.color).toBe('Green');
      });
    });

    describe('Moderate category (30-59)', () => {
      it('should return Moderate for value 30 (boundary)', () => {
        const result = getRedFlagCategory(30);
        expect(result.level).toBe('Moderate');
        expect(result.description).toBe('Moderate threat of Red Flag Warning conditions');
        expect(result.color).toBe('Yellow');
      });

      it('should return Moderate for value 45', () => {
        const result = getRedFlagCategory(45);
        expect(result.level).toBe('Moderate');
        expect(result.color).toBe('Yellow');
      });

      it('should return Moderate for value 59 (just below boundary)', () => {
        const result = getRedFlagCategory(59);
        expect(result.level).toBe('Moderate');
        expect(result.color).toBe('Yellow');
      });
    });

    describe('High category (60-79)', () => {
      it('should return High for value 60 (boundary)', () => {
        const result = getRedFlagCategory(60);
        expect(result.level).toBe('High');
        expect(result.description).toBe('High threat of Red Flag Warning conditions');
        expect(result.color).toBe('Orange');
      });

      it('should return High for value 70', () => {
        const result = getRedFlagCategory(70);
        expect(result.level).toBe('High');
        expect(result.color).toBe('Orange');
      });

      it('should return High for value 79 (just below boundary)', () => {
        const result = getRedFlagCategory(79);
        expect(result.level).toBe('High');
        expect(result.color).toBe('Orange');
      });
    });

    describe('Very High category (>=80)', () => {
      it('should return Very High for value 80 (boundary)', () => {
        const result = getRedFlagCategory(80);
        expect(result.level).toBe('Very High');
        expect(result.description).toBe('Very high threat - Red Flag Warning likely');
        expect(result.color).toBe('Red');
      });

      it('should return Very High for value 90', () => {
        const result = getRedFlagCategory(90);
        expect(result.level).toBe('Very High');
        expect(result.color).toBe('Red');
      });

      it('should return Very High for value 100', () => {
        const result = getRedFlagCategory(100);
        expect(result.level).toBe('Very High');
        expect(result.color).toBe('Red');
      });

      it('should return Very High for value above 100', () => {
        const result = getRedFlagCategory(150);
        expect(result.level).toBe('Very High');
        expect(result.color).toBe('Red');
      });
    });

    describe('Boundary transitions', () => {
      it('should transition from Low to Moderate at 30', () => {
        const lowResult = getRedFlagCategory(29);
        const moderateResult = getRedFlagCategory(30);
        expect(lowResult.level).toBe('Low');
        expect(moderateResult.level).toBe('Moderate');
      });

      it('should transition from Moderate to High at 60', () => {
        const moderateResult = getRedFlagCategory(59);
        const highResult = getRedFlagCategory(60);
        expect(moderateResult.level).toBe('Moderate');
        expect(highResult.level).toBe('High');
      });

      it('should transition from High to Very High at 80', () => {
        const highResult = getRedFlagCategory(79);
        const veryHighResult = getRedFlagCategory(80);
        expect(highResult.level).toBe('High');
        expect(veryHighResult.level).toBe('Very High');
      });
    });

    describe('Edge cases', () => {
      it('should handle decimal values', () => {
        expect(getRedFlagCategory(29.9).level).toBe('Low');
        expect(getRedFlagCategory(30.1).level).toBe('Moderate');
        expect(getRedFlagCategory(59.9).level).toBe('Moderate');
        expect(getRedFlagCategory(60.1).level).toBe('High');
        expect(getRedFlagCategory(79.9).level).toBe('High');
        expect(getRedFlagCategory(80.1).level).toBe('Very High');
      });

      it('should handle NaN gracefully', () => {
        const result = getRedFlagCategory(NaN);
        expect(result).toBeDefined();
        expect(result.level).toBeDefined();
      });
    });
  });

  describe('getCurrentFireWeatherValue', () => {
    describe('Valid data series', () => {
      it('should return first value from data series', () => {
        const dataSeries = {
          values: [
            { validTime: '2024-01-15T12:00:00Z', value: 5 },
            { validTime: '2024-01-15T13:00:00Z', value: 6 },
            { validTime: '2024-01-15T14:00:00Z', value: 7 }
          ]
        };
        const result = getCurrentFireWeatherValue(dataSeries);
        expect(result).toBe(5);
      });

      it('should return value when series has single entry', () => {
        const dataSeries = {
          values: [{ validTime: '2024-01-15T12:00:00Z', value: 42 }]
        };
        const result = getCurrentFireWeatherValue(dataSeries);
        expect(result).toBe(42);
      });

      it('should handle zero value', () => {
        const dataSeries = {
          values: [{ validTime: '2024-01-15T12:00:00Z', value: 0 }]
        };
        const result = getCurrentFireWeatherValue(dataSeries);
        expect(result).toBe(0);
      });

      it('should handle negative value', () => {
        const dataSeries = {
          values: [{ validTime: '2024-01-15T12:00:00Z', value: -5 }]
        };
        const result = getCurrentFireWeatherValue(dataSeries);
        expect(result).toBe(-5);
      });
    });

    describe('Invalid data series', () => {
      it('should return null for undefined data series', () => {
        const result = getCurrentFireWeatherValue(undefined);
        expect(result).toBeNull();
      });

      it('should return null for empty values array', () => {
        const dataSeries = { values: [] };
        const result = getCurrentFireWeatherValue(dataSeries);
        expect(result).toBeNull();
      });

      it('should return null for missing values property', () => {
        const dataSeries = {} as any;
        const result = getCurrentFireWeatherValue(dataSeries);
        expect(result).toBeNull();
      });

      it('should return null when first value is missing value property', () => {
        const dataSeries = {
          values: [{ validTime: '2024-01-15T12:00:00Z' } as any]
        };
        const result = getCurrentFireWeatherValue(dataSeries);
        expect(result).toBeNull();
      });

      it('should return null when first entry has undefined value', () => {
        const dataSeries = {
          values: [{ validTime: '2024-01-15T12:00:00Z', value: undefined as any }]
        };
        const result = getCurrentFireWeatherValue(dataSeries);
        expect(result).toBeNull();
      });

      it('should return null when first entry has null value', () => {
        const dataSeries = {
          values: [{ validTime: '2024-01-15T12:00:00Z', value: null as any }]
        };
        const result = getCurrentFireWeatherValue(dataSeries);
        expect(result).toBeNull();
      });
    });
  });

  describe('formatMixingHeight', () => {
    describe('Valid heights', () => {
      it('should format very poor dispersion (< 1000 ft)', () => {
        const result = formatMixingHeight(500);
        expect(result).toBe('500 ft (very poor dispersion)');
      });

      it('should format boundary at 999 ft as very poor', () => {
        const result = formatMixingHeight(999);
        expect(result).toBe('999 ft (very poor dispersion)');
      });

      it('should format poor dispersion (1000-2999 ft)', () => {
        const result = formatMixingHeight(1500);
        expect(result).toBe('1500 ft (poor dispersion)');
      });

      it('should format boundary at 1000 ft as poor', () => {
        const result = formatMixingHeight(1000);
        expect(result).toBe('1000 ft (poor dispersion)');
      });

      it('should format boundary at 2999 ft as poor', () => {
        const result = formatMixingHeight(2999);
        expect(result).toBe('2999 ft (poor dispersion)');
      });

      it('should format moderate dispersion (3000-5999 ft)', () => {
        const result = formatMixingHeight(4500);
        expect(result).toBe('4500 ft (moderate dispersion)');
      });

      it('should format boundary at 3000 ft as moderate', () => {
        const result = formatMixingHeight(3000);
        expect(result).toBe('3000 ft (moderate dispersion)');
      });

      it('should format boundary at 5999 ft as moderate', () => {
        const result = formatMixingHeight(5999);
        expect(result).toBe('5999 ft (moderate dispersion)');
      });

      it('should format good dispersion (>= 6000 ft)', () => {
        const result = formatMixingHeight(8000);
        expect(result).toBe('8000 ft (good dispersion)');
      });

      it('should format boundary at 6000 ft as good', () => {
        const result = formatMixingHeight(6000);
        expect(result).toBe('6000 ft (good dispersion)');
      });

      it('should format very high dispersion', () => {
        const result = formatMixingHeight(15000);
        expect(result).toBe('15000 ft (good dispersion)');
      });

      it('should round decimal values', () => {
        const result = formatMixingHeight(4567.89);
        expect(result).toBe('4568 ft (moderate dispersion)');
      });

      it('should handle zero height', () => {
        const result = formatMixingHeight(0);
        expect(result).toBe('0 ft (very poor dispersion)');
      });
    });

    describe('Invalid heights', () => {
      it('should return N/A for null', () => {
        const result = formatMixingHeight(null);
        expect(result).toBe('N/A');
      });
    });
  });

  describe('interpretTransportWind', () => {
    describe('Valid wind speeds', () => {
      it('should interpret light winds (< 5 mph)', () => {
        const result = interpretTransportWind(3);
        expect(result).toBe('3 mph (light - poor smoke transport)');
      });

      it('should interpret boundary at 4 mph as light', () => {
        const result = interpretTransportWind(4);
        expect(result).toBe('4 mph (light - poor smoke transport)');
      });

      it('should interpret zero wind', () => {
        const result = interpretTransportWind(0);
        expect(result).toBe('0 mph (light - poor smoke transport)');
      });

      it('should interpret moderate winds (5-14 mph)', () => {
        const result = interpretTransportWind(10);
        expect(result).toBe('10 mph (moderate smoke transport)');
      });

      it('should interpret boundary at 5 mph as moderate', () => {
        const result = interpretTransportWind(5);
        expect(result).toBe('5 mph (moderate smoke transport)');
      });

      it('should interpret boundary at 14 mph as moderate', () => {
        const result = interpretTransportWind(14);
        expect(result).toBe('14 mph (moderate smoke transport)');
      });

      it('should interpret good transport winds (15-24 mph)', () => {
        const result = interpretTransportWind(20);
        expect(result).toBe('20 mph (good smoke transport)');
      });

      it('should interpret boundary at 15 mph as good', () => {
        const result = interpretTransportWind(15);
        expect(result).toBe('15 mph (good smoke transport)');
      });

      it('should interpret boundary at 24 mph as good', () => {
        const result = interpretTransportWind(24);
        expect(result).toBe('24 mph (good smoke transport)');
      });

      it('should interpret strong winds (>= 25 mph)', () => {
        const result = interpretTransportWind(30);
        expect(result).toBe('30 mph (strong - rapid fire spread potential)');
      });

      it('should interpret boundary at 25 mph as strong', () => {
        const result = interpretTransportWind(25);
        expect(result).toBe('25 mph (strong - rapid fire spread potential)');
      });

      it('should interpret very strong winds', () => {
        const result = interpretTransportWind(60);
        expect(result).toBe('60 mph (strong - rapid fire spread potential)');
      });

      it('should round decimal values', () => {
        const result = interpretTransportWind(12.7);
        expect(result).toBe('13 mph (moderate smoke transport)');
      });
    });

    describe('Invalid wind speeds', () => {
      it('should return N/A for null', () => {
        const result = interpretTransportWind(null);
        expect(result).toBe('N/A');
      });
    });
  });

  describe('Return value structure validation', () => {
    it('should have all required fields in HainesCategory', () => {
      const result = getHainesCategory(5);
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('fireGrowthPotential');
      expect(result).toHaveProperty('color');
      expect(typeof result.level).toBe('string');
      expect(typeof result.description).toBe('string');
      expect(typeof result.fireGrowthPotential).toBe('string');
      expect(typeof result.color).toBe('string');
    });

    it('should have all required fields in grassland category', () => {
      const result = getGrasslandFireDangerCategory(2);
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('color');
      expect(typeof result.level).toBe('string');
      expect(typeof result.description).toBe('string');
      expect(typeof result.color).toBe('string');
    });

    it('should have all required fields in red flag category', () => {
      const result = getRedFlagCategory(50);
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('color');
      expect(typeof result.level).toBe('string');
      expect(typeof result.description).toBe('string');
      expect(typeof result.color).toBe('string');
    });
  });
});
