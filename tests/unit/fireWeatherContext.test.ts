import { describe, it, expect } from 'vitest';
import { getFireWeatherContext } from '../../src/utils/fireWeather.js';

describe('getFireWeatherContext', () => {
  describe('Geographic Detection', () => {
    it('should identify Western US location', () => {
      const context = getFireWeatherContext(
        40.0, -105.0, // Colorado
        '2025-11-07T12:00:00Z',
        'UTC',
        null, null, null
      );
      expect(context.seasonalRisk).toBe('Low');
      expect(context.reason).toBe('Winter/low fire season');
    });

    it('should identify California location', () => {
      const context = getFireWeatherContext(
        34.05, -118.24, // Los Angeles
        '2025-11-07T12:00:00Z',
        'UTC',
        null, null, null
      );
      expect(context.seasonalRisk).toBe('Low');
      expect(context.explanatoryText).toContain('Santa Ana');
    });

    it('should identify Southern state location', () => {
      const context = getFireWeatherContext(
        25.76, -80.19, // Miami
        '2025-11-07T12:00:00Z',
        'UTC',
        null, null, null
      );
      expect(context.seasonalRisk).toBe('Low');
      expect(context.reason).toBe('Winter/low fire season');
      expect(context.explanatoryText).toContain('Winter season');
    });

    it('should identify Eastern US location', () => {
      const context = getFireWeatherContext(
        43.82, -84.77, // Clare, MI
        '2025-11-07T12:00:00Z',
        'UTC',
        null, null, null,
        72 // high humidity
      );
      expect(context.seasonalRisk).toBe('Low');
      expect(context.explanatoryText).toContain('cold temperatures, snow cover');
    });
  });

  describe('Seasonal Detection', () => {
    it('should identify winter season (November)', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-11-07T12:00:00Z', // November
        'UTC',
        null, null, null
      );
      expect(context.reason).toBe('Winter/low fire season');
      expect(context.seasonalRisk).toBe('Low');
    });

    it('should identify winter season (December)', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-12-15T12:00:00Z', // December
        'UTC',
        null, null, null
      );
      expect(context.reason).toBe('Winter/low fire season');
    });

    it('should identify winter season (January)', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-01-15T12:00:00Z', // January
        'UTC',
        null, null, null
      );
      expect(context.reason).toBe('Winter/low fire season');
    });

    it('should identify fire season (July)', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-07-15T12:00:00Z', // July
        'UTC',
        null, null, null,
        45 // moderate humidity
      );
      expect(context.reason).toBe('Regional/seasonal factors');
      expect(context.seasonalRisk).toBe('Low');
    });

    it('should handle fire season with high humidity', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-07-15T12:00:00Z', // July
        'UTC',
        null, null, null,
        85 // high humidity
      );
      expect(context.reason).toBe('High humidity/recent precipitation');
      expect(context.explanatoryText).toContain('high humidity');
    });
  });

  describe('Fire Indices Present', () => {
    it('should indicate elevated risk when Haines Index present', () => {
      const context = getFireWeatherContext(
        34.05, -118.24,
        '2025-11-07T12:00:00Z',
        'UTC',
        3, // Haines Index
        null, null
      );
      expect(context.hasIndices).toBe(true);
      expect(context.seasonalRisk).toBe('Elevated');
      expect(context.reason).toBe('Fire conditions warrant monitoring');
    });

    it('should indicate elevated risk when Grassland Fire Danger present', () => {
      const context = getFireWeatherContext(
        34.05, -118.24,
        '2025-07-15T12:00:00Z',
        'UTC',
        null,
        2, // Grassland Fire Danger
        null
      );
      expect(context.hasIndices).toBe(true);
      expect(context.seasonalRisk).toBe('Elevated');
    });

    it('should indicate elevated risk when Red Flag Threat present', () => {
      const context = getFireWeatherContext(
        34.05, -118.24,
        '2025-07-15T12:00:00Z',
        'UTC',
        null, null,
        45 // Red Flag Threat
      );
      expect(context.hasIndices).toBe(true);
      expect(context.seasonalRisk).toBe('Elevated');
    });

    it('should indicate elevated risk when any index present', () => {
      const context = getFireWeatherContext(
        34.05, -118.24,
        '2025-07-15T12:00:00Z',
        'UTC',
        4, 2, 50 // All indices
      );
      expect(context.hasIndices).toBe(true);
      expect(context.seasonalRisk).toBe('Elevated');
      expect(context.explanatoryText).toContain('atmospheric conditions');
    });
  });

  describe('Western US Fire Season Logic', () => {
    it('should show moderate risk for Western US in fire season without indices', () => {
      const context = getFireWeatherContext(
        33.45, -112.07, // Phoenix
        '2025-07-15T12:00:00Z',
        'UTC',
        null, null, null,
        25 // low humidity
      );
      expect(context.seasonalRisk).toBe('Moderate');
      expect(context.reason).toBe('Favorable conditions');
      expect(context.explanatoryText).toContain('do not meet thresholds');
    });

    it('should show low risk for Eastern US in fire season without indices', () => {
      const context = getFireWeatherContext(
        40.71, -74.01, // New York
        '2025-07-15T12:00:00Z',
        'UTC',
        null, null, null,
        55
      );
      expect(context.seasonalRisk).toBe('Low');
      expect(context.reason).toBe('Regional/seasonal factors');
    });
  });

  describe('Humidity Effects', () => {
    it('should recognize high humidity prevents fire indices', () => {
      const context = getFireWeatherContext(
        33.45, -112.07,
        '2025-07-15T12:00:00Z',
        'UTC',
        null, null, null,
        75 // high humidity
      );
      expect(context.reason).toBe('High humidity/recent precipitation');
      expect(context.explanatoryText).toContain('high humidity');
    });

    it('should handle null humidity gracefully', () => {
      const context = getFireWeatherContext(
        33.45, -112.07,
        '2025-07-15T12:00:00Z',
        'UTC',
        null, null, null,
        null // no humidity data
      );
      expect(context.seasonalRisk).toBe('Moderate');
    });

    it('should handle undefined humidity gracefully', () => {
      const context = getFireWeatherContext(
        33.45, -112.07,
        '2025-07-15T12:00:00Z',
        'UTC',
        null, null, null
        // humidity not provided
      );
      expect(context.seasonalRisk).toBe('Moderate');
    });
  });

  describe('Edge Cases', () => {
    it('should handle boundary month (March - end of winter)', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-03-31T12:00:00Z',
        'UTC',
        null, null, null
      );
      expect(context.reason).toBe('Winter/low fire season');
    });

    it('should handle boundary month (April - start of fire season)', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-04-01T12:00:00Z',
        'UTC',
        null, null, null,
        60
      );
      expect(context.reason).toBe('Regional/seasonal factors');
    });

    it('should handle boundary month (October - end of fire season)', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-10-31T12:00:00Z',
        'UTC',
        null, null, null,
        65
      );
      expect(context.reason).toBe('Regional/seasonal factors');
    });

    it('should handle shoulder season (early spring)', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-03-15T12:00:00Z',
        'UTC',
        null, null, null
      );
      expect(context.seasonalRisk).toBe('Low');
    });
  });

  describe('California Special Cases', () => {
    it('should mention Santa Ana winds for California in winter', () => {
      const context = getFireWeatherContext(
        34.05, -118.24, // LA
        '2025-11-15T12:00:00Z',
        'UTC',
        null, null, null
      );
      expect(context.explanatoryText).toContain('Santa Ana');
    });

    it('should handle California in summer without indices', () => {
      const context = getFireWeatherContext(
        34.05, -118.24,
        '2025-08-15T12:00:00Z',
        'UTC',
        null, null, null,
        30
      );
      expect(context.seasonalRisk).toBe('Moderate');
    });
  });

  describe('Explanatory Text Quality', () => {
    it('should provide helpful explanation for winter/Eastern US', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-11-07T12:00:00Z',
        'UTC',
        null, null, null
      );
      expect(context.explanatoryText).toContain('Fire danger indices are calculated');
      expect(context.explanatoryText.length).toBeGreaterThan(50);
    });

    it('should provide helpful explanation when indices present', () => {
      const context = getFireWeatherContext(
        34.05, -118.24,
        '2025-11-07T12:00:00Z',
        'UTC',
        3, null, null
      );
      expect(context.explanatoryText).toContain('atmospheric conditions');
      expect(context.explanatoryText.length).toBeGreaterThan(30);
    });
  });

  describe('hasIndices Flag', () => {
    it('should be false when all indices are null', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-11-07T12:00:00Z',
        'UTC',
        null, null, null
      );
      expect(context.hasIndices).toBe(false);
    });

    it('should be true when any index is present', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-11-07T12:00:00Z',
        'UTC',
        3, null, null
      );
      expect(context.hasIndices).toBe(true);
    });

    it('should handle zero values as present indices', () => {
      const context = getFireWeatherContext(
        43.82, -84.77,
        '2025-11-07T12:00:00Z',
        'UTC',
        0, null, null // Zero is a valid index value
      );
      expect(context.hasIndices).toBe(true);
    });
  });
});
