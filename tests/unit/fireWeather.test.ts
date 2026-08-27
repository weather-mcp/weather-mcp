import { describe, it, expect } from 'vitest';
import {
  getHainesCategory,
  getGrasslandFireDangerCategory,
  getRedFlagCategory,
  getCurrentFireWeatherValue,
  formatMixingHeight,
  interpretTransportWind,
  calculateFosbergIndex,
  getFosbergCategory,
  describeVpd,
  describeTopsoilMoisture,
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
      it('bands decimal values on the contiguous ladder', () => {
        // The ladder is contiguous (<=3 / <=4 / <=5 / else), so a decimal
        // bands into the rung it falls within rather than the top rung.
        expect(getHainesCategory(3.5).level).toBe('Moderate');
        expect(getHainesCategory(4.5).level).toBe('High');
        expect(getHainesCategory(5.5).level).toBe('Very High');
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
      it('bands decimal values on the contiguous ladder', () => {
        // The ladder is contiguous (<=1 / <=2 / <=3 / else), so a decimal
        // bands into the rung it falls within rather than the top rung.
        expect(getGrasslandFireDangerCategory(1.5).level).toBe('Moderate');
        expect(getGrasslandFireDangerCategory(2.5).level).toBe('High');
        expect(getGrasslandFireDangerCategory(3.5).level).toBe('Very High');
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

  describe('calculateFosbergIndex', () => {
    describe('Hand-verified vectors (one per EMC branch)', () => {
      it('RH < 10 branch: T=90F, RH=5%, U=10mph', () => {
        // EMC (RH < 10 branch):
        //   m = 0.03229 + 0.281073*5 - 0.000578*5*90
        //     = 0.03229 + 1.405365 - 0.2601
        //     = 1.177555
        // x = m/30 = 0.03925183...
        // eta = 1 - 2x + 1.5x^2 - 0.5x^3
        //     = 1 - 0.07850367 + 0.00231106 - 0.00003024
        //     ~= 0.9237772 (well clear of the >=0 floor)
        // FFWI = eta * sqrt(1 + 10^2) / 0.3002
        //      = 0.9237772 * sqrt(101) / 0.3002
        //      = 0.9237772 * 10.0498756 / 0.3002
        //      ~= 30.9255
        const result = calculateFosbergIndex(90, 5, 10);
        expect(result).toBeCloseTo(30.9255, 2);
      });

      it('10 <= RH <= 50 branch: T=70F, RH=30%, U=15mph', () => {
        // EMC (middle branch):
        //   m = 2.22749 + 0.160107*30 - 0.014784*70
        //     = 2.22749 + 4.80321 - 1.03488
        //     = 5.99582
        // x = m/30 = 0.19986067
        // eta = 1 - 2x + 1.5x^2 - 0.5x^3
        //     = 1 - 0.39972133 + 0.05991653 - 0.00399253
        //     ~= 0.6562027
        // FFWI = eta * sqrt(1 + 15^2) / 0.3002
        //      = 0.6562027 * sqrt(226) / 0.3002
        //      = 0.6562027 * 15.0332964 / 0.3002
        //      ~= 32.8611
        const result = calculateFosbergIndex(70, 30, 15);
        expect(result).toBeCloseTo(32.8611, 2);
      });

      it('RH > 50 branch: T=60F, RH=70%, U=5mph', () => {
        // EMC (RH > 50 branch):
        //   m = 21.0606 + 0.005565*70^2 - 0.00035*70*60 - 0.483199*70
        //     = 21.0606 + 27.2685 - 1.47 - 33.82393
        //     = 13.03517
        // x = m/30 = 0.43450567
        // eta = 1 - 2x + 1.5x^2 - 0.5x^3
        //     = 1 - 0.86901133 + 0.28316485 - 0.04099783
        //     ~= 0.3731557
        // FFWI = eta * sqrt(1 + 5^2) / 0.3002
        //      = 0.3731557 * sqrt(26) / 0.3002
        //      = 0.3731557 * 5.0990195 / 0.3002
        //      ~= 6.3384
        // Low FFWI in cool/humid/light-wind conditions -> Low category.
        const result = calculateFosbergIndex(60, 70, 5);
        expect(result).toBeCloseTo(6.3384, 2);
        expect(getFosbergCategory(result).level).toBe('Low');
      });
    });

    describe('Clamping', () => {
      it('clamps to 100 at extreme dryness + very high wind', () => {
        // EMC (RH < 10 branch, RH=0): m = 0.03229 + 0 - 0 = 0.03229
        // x = 0.03229/30 = 0.00107633, eta ~= 0.99785 (near the eta=1 ceiling)
        // FFWI = eta * sqrt(1 + 100^2) / 0.3002
        //      = 0.99785 * sqrt(10001) / 0.3002
        //      = 0.99785 * 100.005 / 0.3002
        //      ~= 332.4 (raw) -> clamped to the published 0-100 ceiling
        const result = calculateFosbergIndex(100, 0, 100);
        expect(result).toBe(100);
      });

      it('clamps to 0 when eta goes negative for out-of-range EMC inputs', () => {
        // This exercises the eta >= 0 floor directly. Realistic weather
        // (RH capped at 100) never quite drives eta negative on its own
        // (m maxes out near 30 at RH=100), so this uses an out-of-range RH
        // (120) with a very cold temperature to push EMC past the m=30
        // point where the cubic damping term turns negative. The function
        // performs no input-range validation (pure math transcription), so
        // this input is accepted and demonstrates the clamp path.
        // EMC (RH > 50 branch, RH=120, T=-40):
        //   m = 21.0606 + 0.005565*120^2 - 0.00035*120*(-40) - 0.483199*120
        //     = 21.0606 + 80.136 + 1.68 - 57.98388
        //     = 44.89272
        // x = 44.89272/30 = 1.496424
        // eta = 1 - 2.992848 + 1.5*2.239... - 0.5*3.3506...
        //     ~= -0.3094 -> floored to 0
        // FFWI = 0 * sqrt(1 + 20^2) / 0.3002 = 0
        const result = calculateFosbergIndex(-40, 120, 20);
        expect(result).toBe(0);
      });

      it('the eta floor at high (but physically plausible) EMC renders ~0, not a failure', () => {
        // High humidity + cool temp + light wind: legitimately near-zero
        // fire weather, not a bug. T=20F, RH=95%, U=2mph.
        // EMC (RH > 50 branch):
        //   m = 21.0606 + 0.005565*95^2 - 0.00035*95*20 - 0.483199*95
        //     = 21.0606 + 50.230125 - 0.665 - 45.903905
        //     = 24.71582
        // x = 24.71582/30 = 0.82386067, eta ~= 0.0908 (small, but still
        //   above the floor for this realistic input -- no clamp needed)
        // FFWI = 0.0908 * sqrt(1 + 2^2) / 0.3002
        //      = 0.0908 * sqrt(5) / 0.3002
        //      = 0.0908 * 2.236068 / 0.3002
        //      ~= 0.6763
        const result = calculateFosbergIndex(20, 95, 2);
        expect(result).toBeCloseTo(0.6763, 2);
        expect(getFosbergCategory(result).level).toBe('Low');
      });
    });

    describe('Non-finite inputs', () => {
      it('returns NaN when temperature is NaN', () => {
        expect(Number.isNaN(calculateFosbergIndex(NaN, 50, 10))).toBe(true);
      });

      it('returns NaN when humidity is Infinity', () => {
        expect(Number.isNaN(calculateFosbergIndex(90, Infinity, 10))).toBe(true);
      });

      it('returns NaN when wind is -Infinity', () => {
        expect(Number.isNaN(calculateFosbergIndex(90, 50, -Infinity))).toBe(true);
      });

      it('returns NaN when all inputs are non-finite', () => {
        expect(Number.isNaN(calculateFosbergIndex(NaN, NaN, NaN))).toBe(true);
      });
    });
  });

  describe('getFosbergCategory', () => {
    describe('Band boundaries', () => {
      it('24 is Low, 25 is Moderate', () => {
        expect(getFosbergCategory(24).level).toBe('Low');
        expect(getFosbergCategory(24).color).toBe('Green');
        expect(getFosbergCategory(25).level).toBe('Moderate');
        expect(getFosbergCategory(25).color).toBe('Yellow');
      });

      it('39 is Moderate, 40 is High', () => {
        expect(getFosbergCategory(39).level).toBe('Moderate');
        expect(getFosbergCategory(39).color).toBe('Yellow');
        expect(getFosbergCategory(40).level).toBe('High');
        expect(getFosbergCategory(40).color).toBe('Orange');
      });

      it('49 is High, 50 is Extreme', () => {
        expect(getFosbergCategory(49).level).toBe('High');
        expect(getFosbergCategory(49).color).toBe('Orange');
        expect(getFosbergCategory(50).level).toBe('Extreme');
        expect(getFosbergCategory(50).color).toBe('Red');
      });
    });

    describe('Return value structure', () => {
      it('has all required fields', () => {
        const result = getFosbergCategory(45);
        expect(result).toHaveProperty('level');
        expect(result).toHaveProperty('description');
        expect(result).toHaveProperty('color');
        expect(typeof result.level).toBe('string');
        expect(typeof result.description).toBe('string');
        expect(typeof result.color).toBe('string');
      });

      it('handles 0 and 100 without throwing', () => {
        expect(getFosbergCategory(0).level).toBe('Low');
        expect(getFosbergCategory(100).level).toBe('Extreme');
      });
    });
  });

  describe('describeVpd', () => {
    it('below 1 kPa is low drying power', () => {
      expect(describeVpd(0)).toBe('low drying power');
      expect(describeVpd(0.99)).toBe('low drying power');
    });

    it('boundary at 1 kPa is moderate', () => {
      expect(describeVpd(1)).toBe('moderate drying power');
    });

    it('boundary at 1.99 is moderate, 2 is high', () => {
      expect(describeVpd(1.99)).toBe('moderate drying power');
      expect(describeVpd(2)).toBe('high drying power');
    });

    it('boundary at 2.99 is high, 3 is extreme', () => {
      expect(describeVpd(2.99)).toBe('high drying power');
      expect(describeVpd(3)).toBe('extreme drying power');
    });

    it('well above 3 kPa is extreme (matches the D5 sample: 3.7 kPa)', () => {
      expect(describeVpd(3.7)).toBe('extreme drying power');
    });
  });

  describe('describeTopsoilMoisture', () => {
    it('below 0.1 m3/m3 is very dry', () => {
      expect(describeTopsoilMoisture(0)).toBe('very dry');
      expect(describeTopsoilMoisture(0.099)).toBe('very dry');
    });

    it('boundary at 0.1 is dry', () => {
      expect(describeTopsoilMoisture(0.1)).toBe('dry');
    });

    it('boundary at 0.199 is dry, 0.2 is moist', () => {
      expect(describeTopsoilMoisture(0.199)).toBe('dry');
      expect(describeTopsoilMoisture(0.2)).toBe('moist');
    });

    it('boundary at 0.299 is moist, 0.3 is wet', () => {
      expect(describeTopsoilMoisture(0.299)).toBe('moist');
      expect(describeTopsoilMoisture(0.3)).toBe('wet');
    });

    it('well above 0.3 is wet (matches the D5 sample: 0.18 is dry, not wet)', () => {
      expect(describeTopsoilMoisture(0.5)).toBe('wet');
      expect(describeTopsoilMoisture(0.18)).toBe('dry');
    });
  });
});
