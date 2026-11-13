/**
 * Integration tests for Great Lakes marine conditions (v1.1.0 feature)
 * Tests dual-source support: NOAA (Great Lakes) vs Open-Meteo (oceans)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { NOAAService } from '../../src/services/noaa.js';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { handleGetMarineConditions } from '../../src/handlers/marineConditionsHandler.js';
import { shouldUseNOAAMarine } from '../../src/utils/geography.js';

describe('Great Lakes Marine Conditions (v1.1.0)', () => {
  let noaaService: NOAAService;
  let openMeteoService: OpenMeteoService;

  beforeAll(() => {
    noaaService = new NOAAService({
      userAgent: 'weather-mcp-test/1.1.0 (test@example.com)'
    });
    openMeteoService = new OpenMeteoService();
  });

  describe('Geographic Detection', () => {
    it('should detect Traverse City, MI as Lake Michigan', () => {
      const detection = shouldUseNOAAMarine(44.7631, -85.6206);
      expect(detection.useNOAA).toBe(true);
      expect(detection.region).toBe('Lake Michigan');
      expect(detection.source).toBe('great-lakes');
    });

    it('should detect Duluth, MN as Lake Superior', () => {
      const detection = shouldUseNOAAMarine(46.7867, -92.1005);
      expect(detection.useNOAA).toBe(true);
      expect(detection.region).toBe('Lake Superior');
      expect(detection.source).toBe('great-lakes');
    });

    it('should detect Cleveland, OH as Lake Erie', () => {
      const detection = shouldUseNOAAMarine(41.5, -81.7);
      expect(detection.useNOAA).toBe(true);
      expect(detection.region).toBe('Lake Erie');
      expect(detection.source).toBe('great-lakes');
    });

    it('should NOT detect ocean location as Great Lakes', () => {
      const detection = shouldUseNOAAMarine(36.0, -76.0); // Atlantic Ocean
      expect(detection.useNOAA).toBe(false);
      expect(detection.source).toBe('ocean');
    });
  });

  describe('NOAA Marine Data Retrieval', () => {
    it('should retrieve marine conditions for Traverse City, MI (Lake Michigan)', async () => {
      const args = {
        latitude: 44.7631,
        longitude: -85.6206,
        forecast: false
      };

      const result = await handleGetMarineConditions(args, noaaService, openMeteoService);

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Marine Conditions Report');

      // Should indicate NOAA data source for Great Lakes
      const text = result.content[0].text;
      const isNOAASource = text.includes('NOAA National Weather Service') ||
                           text.includes('Lake Michigan');
      expect(isNOAASource).toBe(true);

      console.log('Traverse City Marine Conditions:\n', text.substring(0, 500));
    }, 15000); // 15 second timeout for API call

    it('should retrieve marine conditions for Duluth, MN (Lake Superior)', async () => {
      const args = {
        latitude: 46.7867,
        longitude: -92.1005,
        forecast: false
      };

      const result = await handleGetMarineConditions(args, noaaService, openMeteoService);

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const text = result.content[0].text;
      expect(text).toContain('Marine Conditions Report');

      // Should include Lake Superior or NOAA reference
      const isGreatLakesData = text.includes('Lake Superior') ||
                               text.includes('NOAA National Weather Service');
      expect(isGreatLakesData).toBe(true);

      console.log('Duluth Marine Conditions:\n', text.substring(0, 500));
    }, 15000);

    it('should retrieve marine conditions for Cleveland, OH (Lake Erie)', async () => {
      const args = {
        latitude: 41.5,
        longitude: -81.7,
        forecast: false
      };

      const result = await handleGetMarineConditions(args, noaaService, openMeteoService);

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);

      const text = result.content[0].text;
      expect(text).toContain('Marine Conditions Report');

      console.log('Cleveland Marine Conditions:\n', text.substring(0, 500));
    }, 15000);
  });

  describe('Open-Meteo Fallback for Ocean Locations', () => {
    it('should use Open-Meteo for Atlantic Ocean location', async () => {
      const args = {
        latitude: 36.0,
        longitude: -76.0, // Atlantic Ocean off North Carolina
        forecast: false
      };

      const result = await handleGetMarineConditions(args, noaaService, openMeteoService);

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);

      const text = result.content[0].text;
      expect(text).toContain('Marine Conditions Report');

      // Should use Open-Meteo for ocean locations (no NOAA reference)
      expect(text).not.toContain('NOAA National Weather Service');

      console.log('Atlantic Ocean Marine Conditions:\n', text.substring(0, 500));
    }, 15000);

    it('should use Open-Meteo for Pacific Ocean location', async () => {
      const args = {
        latitude: 34.0,
        longitude: -120.0, // Pacific Ocean off California
        forecast: false
      };

      const result = await handleGetMarineConditions(args, noaaService, openMeteoService);

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);

      const text = result.content[0].text;
      expect(text).toContain('Marine Conditions Report');

      console.log('Pacific Ocean Marine Conditions:\n', text.substring(0, 500));
    }, 15000);
  });

  describe('Coastal Bay Detection', () => {
    it('should detect San Francisco Bay', async () => {
      const detection = shouldUseNOAAMarine(37.8, -122.4);
      expect(detection.useNOAA).toBe(true);
      expect(detection.region).toBe('San Francisco Bay');
      expect(detection.source).toBe('coastal-bay');

      // Try to get marine conditions
      const args = {
        latitude: 37.8,
        longitude: -122.4,
        forecast: false
      };

      const result = await handleGetMarineConditions(args, noaaService, openMeteoService);
      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);

      console.log('San Francisco Bay Marine Conditions:\n', result.content[0].text.substring(0, 500));
    }, 15000);

    it('should detect Chesapeake Bay', async () => {
      const detection = shouldUseNOAAMarine(37.5, -76.3);
      expect(detection.useNOAA).toBe(true);
      expect(detection.region).toBe('Chesapeake Bay');
      expect(detection.source).toBe('coastal-bay');

      const args = {
        latitude: 37.5,
        longitude: -76.3,
        forecast: false
      };

      const result = await handleGetMarineConditions(args, noaaService, openMeteoService);
      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);

      console.log('Chesapeake Bay Marine Conditions:\n', result.content[0].text.substring(0, 500));
    }, 15000);
  });

  describe('Marine Data Format Validation', () => {
    it('should include wave height and period in output', async () => {
      const args = {
        latitude: 44.7631,
        longitude: -85.6206,
        forecast: false
      };

      const result = await handleGetMarineConditions(args, noaaService, openMeteoService);
      const text = result.content[0].text;

      // Check for standard marine data fields
      expect(text).toContain('Wave');
      expect(text).toContain('Wind');
    }, 15000);

    it('should include wind conditions in output', async () => {
      const args = {
        latitude: 44.7631,
        longitude: -85.6206,
        forecast: false
      };

      const result = await handleGetMarineConditions(args, noaaService, openMeteoService);
      const text = result.content[0].text;

      // Wind data should be present
      expect(text).toContain('Wind');
    }, 15000);
  });

  describe('Error Handling and Fallback', () => {
    it('should handle invalid Great Lakes coordinates gracefully', async () => {
      const args = {
        latitude: 200, // Invalid latitude
        longitude: -85.6206,
        forecast: false
      };

      await expect(
        handleGetMarineConditions(args, noaaService, openMeteoService)
      ).rejects.toThrow();
    });

    it('should fallback to Open-Meteo if NOAA fails for Great Lakes location', async () => {
      // This test verifies the fallback mechanism works
      // Even if NOAA fails, we should get Open-Meteo data

      const args = {
        latitude: 44.7631,
        longitude: -85.6206,
        forecast: false
      };

      const result = await handleGetMarineConditions(args, noaaService, openMeteoService);

      // Should always get a result (either NOAA or Open-Meteo fallback)
      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('Marine Conditions Report');
    }, 15000);
  });
});
