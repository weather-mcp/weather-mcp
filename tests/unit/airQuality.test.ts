import { describe, it, expect } from 'vitest';
import {
  getUSAQICategory,
  getEuropeanAQICategory,
  getUVIndexCategory,
  getPollutantInfo,
  formatPollutantConcentration,
  shouldUseUSAQI,
} from '../../src/utils/airQuality.js';

describe('Air Quality Utilities', () => {
  describe('getUSAQICategory', () => {
    describe('Good category (0-50)', () => {
      it('should return Good for AQI 0', () => {
        const result = getUSAQICategory(0);
        expect(result.level).toBe('Good');
        expect(result.description).toBe('Air quality is satisfactory');
        expect(result.healthImplications).toContain('satisfactory');
        expect(result.cautionaryStatement).toBe('None');
        expect(result.color).toBe('Green');
      });

      it('should return Good for AQI 25', () => {
        const result = getUSAQICategory(25);
        expect(result.level).toBe('Good');
        expect(result.color).toBe('Green');
      });

      it('should return Good for AQI 50 (boundary)', () => {
        const result = getUSAQICategory(50);
        expect(result.level).toBe('Good');
        expect(result.color).toBe('Green');
      });
    });

    describe('Moderate category (51-100)', () => {
      it('should return Moderate for AQI 51 (boundary)', () => {
        const result = getUSAQICategory(51);
        expect(result.level).toBe('Moderate');
        expect(result.description).toBe('Air quality is acceptable');
        expect(result.healthImplications).toContain('acceptable');
        expect(result.cautionaryStatement).toContain('sensitive people');
        expect(result.color).toBe('Yellow');
      });

      it('should return Moderate for AQI 75', () => {
        const result = getUSAQICategory(75);
        expect(result.level).toBe('Moderate');
        expect(result.color).toBe('Yellow');
      });

      it('should return Moderate for AQI 100 (boundary)', () => {
        const result = getUSAQICategory(100);
        expect(result.level).toBe('Moderate');
        expect(result.color).toBe('Yellow');
      });
    });

    describe('Unhealthy for Sensitive Groups (101-150)', () => {
      it('should return Unhealthy for Sensitive Groups for AQI 101 (boundary)', () => {
        const result = getUSAQICategory(101);
        expect(result.level).toBe('Unhealthy for Sensitive Groups');
        expect(result.description).toBe('Sensitive groups may experience health effects');
        expect(result.healthImplications).toContain('sensitive groups');
        expect(result.cautionaryStatement).toContain('Children');
        expect(result.color).toBe('Orange');
      });

      it('should return Unhealthy for Sensitive Groups for AQI 125', () => {
        const result = getUSAQICategory(125);
        expect(result.level).toBe('Unhealthy for Sensitive Groups');
        expect(result.color).toBe('Orange');
      });

      it('should return Unhealthy for Sensitive Groups for AQI 150 (boundary)', () => {
        const result = getUSAQICategory(150);
        expect(result.level).toBe('Unhealthy for Sensitive Groups');
        expect(result.color).toBe('Orange');
      });
    });

    describe('Unhealthy category (151-200)', () => {
      it('should return Unhealthy for AQI 151 (boundary)', () => {
        const result = getUSAQICategory(151);
        expect(result.level).toBe('Unhealthy');
        expect(result.description).toBe('Everyone may begin to experience health effects');
        expect(result.healthImplications).toContain('Everyone');
        expect(result.cautionaryStatement).toContain('limit prolonged outdoor exertion');
        expect(result.color).toBe('Red');
      });

      it('should return Unhealthy for AQI 175', () => {
        const result = getUSAQICategory(175);
        expect(result.level).toBe('Unhealthy');
        expect(result.color).toBe('Red');
      });

      it('should return Unhealthy for AQI 200 (boundary)', () => {
        const result = getUSAQICategory(200);
        expect(result.level).toBe('Unhealthy');
        expect(result.color).toBe('Red');
      });
    });

    describe('Very Unhealthy category (201-300)', () => {
      it('should return Very Unhealthy for AQI 201 (boundary)', () => {
        const result = getUSAQICategory(201);
        expect(result.level).toBe('Very Unhealthy');
        expect(result.description).toBe('Health alert: everyone may experience serious effects');
        expect(result.healthImplications).toContain('Health alert');
        expect(result.cautionaryStatement).toContain('avoid prolonged outdoor exertion');
        expect(result.color).toBe('Purple');
      });

      it('should return Very Unhealthy for AQI 250', () => {
        const result = getUSAQICategory(250);
        expect(result.level).toBe('Very Unhealthy');
        expect(result.color).toBe('Purple');
      });

      it('should return Very Unhealthy for AQI 300 (boundary)', () => {
        const result = getUSAQICategory(300);
        expect(result.level).toBe('Very Unhealthy');
        expect(result.color).toBe('Purple');
      });
    });

    describe('Hazardous category (>300)', () => {
      it('should return Hazardous for AQI 301 (boundary)', () => {
        const result = getUSAQICategory(301);
        expect(result.level).toBe('Hazardous');
        expect(result.description).toBe('Health warnings of emergency conditions');
        expect(result.healthImplications).toContain('emergency conditions');
        expect(result.cautionaryStatement).toContain('avoid all outdoor exertion');
        expect(result.color).toBe('Maroon');
      });

      it('should return Hazardous for AQI 400', () => {
        const result = getUSAQICategory(400);
        expect(result.level).toBe('Hazardous');
        expect(result.color).toBe('Maroon');
      });

      it('should return Hazardous for AQI 500', () => {
        const result = getUSAQICategory(500);
        expect(result.level).toBe('Hazardous');
        expect(result.color).toBe('Maroon');
      });

      it('should return Hazardous for extreme AQI 1000', () => {
        const result = getUSAQICategory(1000);
        expect(result.level).toBe('Hazardous');
        expect(result.color).toBe('Maroon');
      });
    });

    describe('Edge cases', () => {
      it('should handle decimal values', () => {
        expect(getUSAQICategory(50.5).level).toBe('Moderate');
        expect(getUSAQICategory(100.9).level).toBe('Unhealthy for Sensitive Groups');
        expect(getUSAQICategory(150.1).level).toBe('Unhealthy');
      });

      it('should handle negative AQI (invalid but defensive)', () => {
        const result = getUSAQICategory(-10);
        expect(result.level).toBe('Good');
      });

      it('should handle NaN gracefully', () => {
        const result = getUSAQICategory(NaN);
        expect(result).toBeDefined();
        expect(result.level).toBeDefined();
      });
    });
  });

  describe('getEuropeanAQICategory', () => {
    describe('Good category (0-20)', () => {
      it('should return Good for EAQI 0', () => {
        const result = getEuropeanAQICategory(0);
        expect(result.level).toBe('Good');
        expect(result.description).toBe('Air quality is good');
        expect(result.healthImplications).toContain('good');
        expect(result.cautionaryStatement).toBe('None');
        expect(result.color).toBe('Blue');
      });

      it('should return Good for EAQI 10', () => {
        const result = getEuropeanAQICategory(10);
        expect(result.level).toBe('Good');
        expect(result.color).toBe('Blue');
      });

      it('should return Good for EAQI 20 (boundary)', () => {
        const result = getEuropeanAQICategory(20);
        expect(result.level).toBe('Good');
        expect(result.color).toBe('Blue');
      });
    });

    describe('Fair category (21-40)', () => {
      it('should return Fair for EAQI 21 (boundary)', () => {
        const result = getEuropeanAQICategory(21);
        expect(result.level).toBe('Fair');
        expect(result.description).toBe('Air quality is fair');
        expect(result.healthImplications).toContain('Enjoy');
        expect(result.cautionaryStatement).toBe('None');
        expect(result.color).toBe('Green');
      });

      it('should return Fair for EAQI 30', () => {
        const result = getEuropeanAQICategory(30);
        expect(result.level).toBe('Fair');
        expect(result.color).toBe('Green');
      });

      it('should return Fair for EAQI 40 (boundary)', () => {
        const result = getEuropeanAQICategory(40);
        expect(result.level).toBe('Fair');
        expect(result.color).toBe('Green');
      });
    });

    describe('Moderate category (41-60)', () => {
      it('should return Moderate for EAQI 41 (boundary)', () => {
        const result = getEuropeanAQICategory(41);
        expect(result.level).toBe('Moderate');
        expect(result.description).toBe('Air quality is moderate');
        expect(result.healthImplications).toContain('reducing intense');
        expect(result.cautionaryStatement).toContain('Sensitive individuals');
        expect(result.color).toBe('Yellow');
      });

      it('should return Moderate for EAQI 50', () => {
        const result = getEuropeanAQICategory(50);
        expect(result.level).toBe('Moderate');
        expect(result.color).toBe('Yellow');
      });

      it('should return Moderate for EAQI 60 (boundary)', () => {
        const result = getEuropeanAQICategory(60);
        expect(result.level).toBe('Moderate');
        expect(result.color).toBe('Yellow');
      });
    });

    describe('Poor category (61-80)', () => {
      it('should return Poor for EAQI 61 (boundary)', () => {
        const result = getEuropeanAQICategory(61);
        expect(result.level).toBe('Poor');
        expect(result.description).toBe('Air quality is poor');
        expect(result.healthImplications).toContain('sore eyes');
        expect(result.cautionaryStatement).toContain('reduce outdoor activities');
        expect(result.color).toBe('Orange');
      });

      it('should return Poor for EAQI 70', () => {
        const result = getEuropeanAQICategory(70);
        expect(result.level).toBe('Poor');
        expect(result.color).toBe('Orange');
      });

      it('should return Poor for EAQI 80 (boundary)', () => {
        const result = getEuropeanAQICategory(80);
        expect(result.level).toBe('Poor');
        expect(result.color).toBe('Orange');
      });
    });

    describe('Very Poor category (81-100)', () => {
      it('should return Very Poor for EAQI 81 (boundary)', () => {
        const result = getEuropeanAQICategory(81);
        expect(result.level).toBe('Very Poor');
        expect(result.description).toBe('Air quality is very poor');
        expect(result.healthImplications).toContain('reducing physical activities');
        expect(result.cautionaryStatement).toContain('avoid outdoor activities');
        expect(result.color).toBe('Red');
      });

      it('should return Very Poor for EAQI 90', () => {
        const result = getEuropeanAQICategory(90);
        expect(result.level).toBe('Very Poor');
        expect(result.color).toBe('Red');
      });

      it('should return Very Poor for EAQI 100 (boundary)', () => {
        const result = getEuropeanAQICategory(100);
        expect(result.level).toBe('Very Poor');
        expect(result.color).toBe('Red');
      });
    });

    describe('Extremely Poor category (>100)', () => {
      it('should return Extremely Poor for EAQI 101 (boundary)', () => {
        const result = getEuropeanAQICategory(101);
        expect(result.level).toBe('Extremely Poor');
        expect(result.description).toBe('Air quality is extremely poor');
        expect(result.healthImplications).toContain('remain indoors');
        expect(result.cautionaryStatement).toContain('avoid outdoor activities');
        expect(result.color).toBe('Purple');
      });

      it('should return Extremely Poor for EAQI 150', () => {
        const result = getEuropeanAQICategory(150);
        expect(result.level).toBe('Extremely Poor');
        expect(result.color).toBe('Purple');
      });

      it('should return Extremely Poor for EAQI 200', () => {
        const result = getEuropeanAQICategory(200);
        expect(result.level).toBe('Extremely Poor');
        expect(result.color).toBe('Purple');
      });
    });

    describe('Edge cases', () => {
      it('should handle decimal values', () => {
        expect(getEuropeanAQICategory(20.5).level).toBe('Fair');
        expect(getEuropeanAQICategory(40.9).level).toBe('Moderate');
        expect(getEuropeanAQICategory(60.1).level).toBe('Poor');
      });

      it('should handle negative EAQI', () => {
        const result = getEuropeanAQICategory(-5);
        expect(result.level).toBe('Good');
      });
    });
  });

  describe('getUVIndexCategory', () => {
    describe('Low category (0-2)', () => {
      it('should return Low for UV 0', () => {
        const result = getUVIndexCategory(0);
        expect(result.level).toBe('Low');
        expect(result.description).toBe('Minimal protection required');
        expect(result.recommendation).toContain('No protection required');
      });

      it('should return Low for UV 1.5', () => {
        const result = getUVIndexCategory(1.5);
        expect(result.level).toBe('Low');
      });

      it('should return Low for UV 2.99 (just below boundary)', () => {
        const result = getUVIndexCategory(2.99);
        expect(result.level).toBe('Low');
      });
    });

    describe('Moderate category (3-5)', () => {
      it('should return Moderate for UV 3 (boundary)', () => {
        const result = getUVIndexCategory(3);
        expect(result.level).toBe('Moderate');
        expect(result.description).toBe('Protection recommended');
        expect(result.recommendation).toContain('sunscreen');
        expect(result.recommendation).toContain('hat');
      });

      it('should return Moderate for UV 4', () => {
        const result = getUVIndexCategory(4);
        expect(result.level).toBe('Moderate');
      });

      it('should return Moderate for UV 5.99 (just below boundary)', () => {
        const result = getUVIndexCategory(5.99);
        expect(result.level).toBe('Moderate');
      });
    });

    describe('High category (6-7)', () => {
      it('should return High for UV 6 (boundary)', () => {
        const result = getUVIndexCategory(6);
        expect(result.level).toBe('High');
        expect(result.description).toBe('Protection essential');
        expect(result.recommendation).toContain('SPF 30+');
        expect(result.recommendation).toContain('protective clothing');
      });

      it('should return High for UV 7', () => {
        const result = getUVIndexCategory(7);
        expect(result.level).toBe('High');
      });

      it('should return High for UV 7.99 (just below boundary)', () => {
        const result = getUVIndexCategory(7.99);
        expect(result.level).toBe('High');
      });
    });

    describe('Very High category (8-10)', () => {
      it('should return Very High for UV 8 (boundary)', () => {
        const result = getUVIndexCategory(8);
        expect(result.level).toBe('Very High');
        expect(result.description).toBe('Extra protection required');
        expect(result.recommendation).toContain('Minimize sun exposure');
        expect(result.recommendation).toContain('10am-4pm');
      });

      it('should return Very High for UV 9', () => {
        const result = getUVIndexCategory(9);
        expect(result.level).toBe('Very High');
      });

      it('should return Very High for UV 10.99 (just below boundary)', () => {
        const result = getUVIndexCategory(10.99);
        expect(result.level).toBe('Very High');
      });
    });

    describe('Extreme category (>=11)', () => {
      it('should return Extreme for UV 11 (boundary)', () => {
        const result = getUVIndexCategory(11);
        expect(result.level).toBe('Extreme');
        expect(result.description).toBe('Maximum protection required');
        expect(result.recommendation).toContain('Avoid sun exposure');
        expect(result.recommendation).toContain('SPF 50+');
      });

      it('should return Extreme for UV 12', () => {
        const result = getUVIndexCategory(12);
        expect(result.level).toBe('Extreme');
      });

      it('should return Extreme for UV 15', () => {
        const result = getUVIndexCategory(15);
        expect(result.level).toBe('Extreme');
      });
    });

    describe('Edge cases', () => {
      it('should handle exact boundary values', () => {
        expect(getUVIndexCategory(3).level).toBe('Moderate');
        expect(getUVIndexCategory(6).level).toBe('High');
        expect(getUVIndexCategory(8).level).toBe('Very High');
        expect(getUVIndexCategory(11).level).toBe('Extreme');
      });

      it('should handle negative UV (nighttime)', () => {
        const result = getUVIndexCategory(-1);
        expect(result.level).toBe('Low');
      });
    });
  });

  describe('getPollutantInfo', () => {
    describe('Known pollutants', () => {
      it('should return info for pm2_5', () => {
        const result = getPollutantInfo('pm2_5');
        expect(result.name).toBe('PM2.5 (Fine Particulate Matter)');
        expect(result.description).toContain('2.5 micrometers');
        expect(result.sources).toContain('wildfires');
      });

      it('should return info for pm10', () => {
        const result = getPollutantInfo('pm10');
        expect(result.name).toBe('PM10 (Coarse Particulate Matter)');
        expect(result.description).toContain('10 micrometers');
        expect(result.sources).toContain('Dust'); // Note: capitalized in actual data
      });

      it('should return info for ozone', () => {
        const result = getPollutantInfo('ozone');
        expect(result.name).toBe('Ozone (O₃)');
        expect(result.description).toContain('ozone');
        expect(result.sources).toContain('sunlight');
      });

      it('should return info for nitrogen_dioxide', () => {
        const result = getPollutantInfo('nitrogen_dioxide');
        expect(result.name).toBe('Nitrogen Dioxide (NO₂)');
        expect(result.description).toContain('airways');
        expect(result.sources).toContain('Vehicle emissions');
      });

      it('should return info for sulphur_dioxide', () => {
        const result = getPollutantInfo('sulphur_dioxide');
        expect(result.name).toBe('Sulfur Dioxide (SO₂)');
        expect(result.description).toContain('breathing');
        expect(result.sources).toContain('Fossil fuel');
      });

      it('should return info for carbon_monoxide', () => {
        const result = getPollutantInfo('carbon_monoxide');
        expect(result.name).toBe('Carbon Monoxide (CO)');
        expect(result.description).toContain('oxygen');
        expect(result.sources).toContain('Vehicle emissions');
      });

      it('should return info for ammonia', () => {
        const result = getPollutantInfo('ammonia');
        expect(result.name).toBe('Ammonia (NH₃)');
        expect(result.description).toContain('irritate');
        expect(result.sources).toContain('Agricultural');
      });
    });

    describe('Unknown pollutants', () => {
      it('should return generic info for unknown pollutant', () => {
        const result = getPollutantInfo('unknown_pollutant');
        expect(result.name).toBe('UNKNOWN_POLLUTANT');
        expect(result.description).toBe('Air pollutant');
        expect(result.sources).toBe('Various sources');
      });

      it('should return generic info for empty string', () => {
        const result = getPollutantInfo('');
        expect(result.name).toBe('');
        expect(result.description).toBe('Air pollutant');
        expect(result.sources).toBe('Various sources');
      });
    });

    describe('Return structure validation', () => {
      it('should have all required fields', () => {
        const result = getPollutantInfo('pm2_5');
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('description');
        expect(result).toHaveProperty('sources');
        expect(typeof result.name).toBe('string');
        expect(typeof result.description).toBe('string');
        expect(typeof result.sources).toBe('string');
      });
    });
  });

  describe('formatPollutantConcentration', () => {
    describe('Valid concentrations', () => {
      it('should format value < 1 with 2 decimals', () => {
        const result = formatPollutantConcentration(0.567, 'µg/m³');
        expect(result).toBe('0.57 µg/m³');
      });

      it('should format value < 1 with units', () => {
        const result = formatPollutantConcentration(0.12, 'ppm');
        expect(result).toBe('0.12 ppm');
      });

      it('should format value between 1 and 10 with 1 decimal', () => {
        const result = formatPollutantConcentration(5.67, 'µg/m³');
        expect(result).toBe('5.7 µg/m³');
      });

      it('should format value between 1 and 10', () => {
        const result = formatPollutantConcentration(9.99, 'ppm');
        expect(result).toBe('10.0 ppm');
      });

      it('should format value >= 10 as integer', () => {
        const result = formatPollutantConcentration(123.456, 'µg/m³');
        expect(result).toBe('123 µg/m³');
      });

      it('should format large value as integer', () => {
        const result = formatPollutantConcentration(1234.56, 'µg/m³');
        expect(result).toBe('1235 µg/m³');
      });

      it('should handle zero value', () => {
        const result = formatPollutantConcentration(0, 'µg/m³');
        expect(result).toBe('0.00 µg/m³');
      });

      it('should handle value without units', () => {
        const result = formatPollutantConcentration(42.5, undefined);
        expect(result).toBe('43'); // Math.round(42.5) = 43
      });
    });

    describe('Invalid concentrations', () => {
      it('should return N/A for undefined value', () => {
        const result = formatPollutantConcentration(undefined, 'µg/m³');
        expect(result).toBe('N/A');
      });

      it('should return N/A for null value', () => {
        const result = formatPollutantConcentration(null as any, 'µg/m³');
        expect(result).toBe('N/A');
      });

      it('should return N/A for undefined value without units', () => {
        const result = formatPollutantConcentration(undefined, undefined);
        expect(result).toBe('N/A');
      });
    });

    describe('Precision boundaries', () => {
      it('should use 2 decimals at boundary 0.999', () => {
        const result = formatPollutantConcentration(0.999, 'µg/m³');
        expect(result).toBe('1.00 µg/m³');
      });

      it('should use 1 decimal at boundary 1.0', () => {
        const result = formatPollutantConcentration(1.0, 'µg/m³');
        expect(result).toBe('1.0 µg/m³');
      });

      it('should use 1 decimal at boundary 9.99', () => {
        const result = formatPollutantConcentration(9.99, 'µg/m³');
        expect(result).toBe('10.0 µg/m³');
      });

      it('should use integer at boundary 10.0', () => {
        const result = formatPollutantConcentration(10.0, 'µg/m³');
        expect(result).toBe('10 µg/m³');
      });
    });
  });

  describe('shouldUseUSAQI', () => {
    describe('Continental US', () => {
      it('should return true for Seattle (47.6°N, -122.3°W)', () => {
        expect(shouldUseUSAQI(47.6, -122.3)).toBe(true);
      });

      it('should return true for Miami (25.8°N, -80.2°W)', () => {
        expect(shouldUseUSAQI(25.8, -80.2)).toBe(true);
      });

      it('should return true for New York (40.7°N, -74.0°W)', () => {
        expect(shouldUseUSAQI(40.7, -74.0)).toBe(true);
      });

      it('should return true for Los Angeles (34.1°N, -118.2°W)', () => {
        expect(shouldUseUSAQI(34.1, -118.2)).toBe(true);
      });

      it('should return true for northern boundary (49°N)', () => {
        expect(shouldUseUSAQI(49.0, -95.0)).toBe(true);
      });

      it('should return true for southern boundary (24°N)', () => {
        expect(shouldUseUSAQI(24.0, -95.0)).toBe(true);
      });

      it('should return true for western boundary (-125°W)', () => {
        expect(shouldUseUSAQI(40.0, -125.0)).toBe(true);
      });

      it('should return true for eastern boundary (-66°W)', () => {
        expect(shouldUseUSAQI(40.0, -66.0)).toBe(true);
      });
    });

    describe('Alaska', () => {
      it('should return true for Anchorage (61.2°N, -150.0°W)', () => {
        expect(shouldUseUSAQI(61.2, -150.0)).toBe(true);
      });

      it('should return true for Fairbanks (64.8°N, -147.7°W)', () => {
        expect(shouldUseUSAQI(64.8, -147.7)).toBe(true);
      });

      it('should return true for Alaska southern boundary (51°N)', () => {
        expect(shouldUseUSAQI(51.0, -150.0)).toBe(true);
      });

      it('should return true for Alaska northern boundary (71°N)', () => {
        expect(shouldUseUSAQI(71.0, -150.0)).toBe(true);
      });
    });

    describe('Hawaii', () => {
      it('should return true for Honolulu (21.3°N, -157.8°W)', () => {
        expect(shouldUseUSAQI(21.3, -157.8)).toBe(true);
      });

      it('should return true for Hawaii southern boundary (18°N)', () => {
        expect(shouldUseUSAQI(18.0, -157.0)).toBe(true);
      });

      it('should return true for Hawaii northern boundary (28°N)', () => {
        expect(shouldUseUSAQI(28.0, -157.0)).toBe(true);
      });
    });

    describe('Puerto Rico', () => {
      it('should return true for San Juan (18.5°N, -66.1°W)', () => {
        expect(shouldUseUSAQI(18.5, -66.1)).toBe(true);
      });

      it('should return true for Puerto Rico boundaries', () => {
        expect(shouldUseUSAQI(18.0, -67.0)).toBe(true);
      });
    });

    describe('US Virgin Islands', () => {
      it('should return true for USVI (18.3°N, -64.9°W)', () => {
        expect(shouldUseUSAQI(18.3, -64.9)).toBe(true);
      });
    });

    describe('Guam', () => {
      it('should return true for Guam (13.4°N, 144.8°E)', () => {
        expect(shouldUseUSAQI(13.4, 144.8)).toBe(true);
      });
    });

    describe('Non-US locations', () => {
      it('should return false for London (51.5°N, -0.1°W)', () => {
        expect(shouldUseUSAQI(51.5, -0.1)).toBe(false);
      });

      it('should return false for Paris (48.9°N, 2.3°E)', () => {
        expect(shouldUseUSAQI(48.9, 2.3)).toBe(false);
      });

      it('should return false for Tokyo (35.7°N, 139.7°E)', () => {
        expect(shouldUseUSAQI(35.7, 139.7)).toBe(false);
      });

      it('should return false for Sydney (-33.9°S, 151.2°E)', () => {
        expect(shouldUseUSAQI(-33.9, 151.2)).toBe(false);
      });

      it('should return false for Mexico City (19.4°N, -99.1°W)', () => {
        expect(shouldUseUSAQI(19.4, -99.1)).toBe(false);
      });

      it('should return false for Canada (55°N, -100°W)', () => {
        expect(shouldUseUSAQI(55.0, -100.0)).toBe(false);
      });

      it('should return false for just outside US boundaries', () => {
        expect(shouldUseUSAQI(49.1, -95.0)).toBe(false); // North of US
        expect(shouldUseUSAQI(23.9, -95.0)).toBe(false); // South of US
        expect(shouldUseUSAQI(40.0, -125.1)).toBe(false); // West of US
        expect(shouldUseUSAQI(40.0, -65.9)).toBe(false); // East of US
      });
    });

    describe('Edge cases', () => {
      it('should handle boundary coordinates precisely', () => {
        expect(shouldUseUSAQI(24.0, -66.0)).toBe(true);
        expect(shouldUseUSAQI(23.9, -66.0)).toBe(false);
      });

      it('should handle decimal coordinates', () => {
        expect(shouldUseUSAQI(40.123456, -122.654321)).toBe(true);
      });
    });
  });

  describe('Return structure validation', () => {
    it('should validate AQICategory structure', () => {
      const result = getUSAQICategory(75);
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('healthImplications');
      expect(result).toHaveProperty('cautionaryStatement');
      expect(result).toHaveProperty('color');
    });

    it('should validate UVIndexCategory structure', () => {
      const result = getUVIndexCategory(7);
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('recommendation');
    });
  });
});
