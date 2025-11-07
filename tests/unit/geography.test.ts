/**
 * Unit tests for geography utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  getGreatLakeRegion,
  getMajorCoastalBayRegion,
  shouldUseNOAAMarine,
  getMarineRegionDescription,
  getGreatLakesRegions,
  getMajorCoastalBayRegions
} from '../../src/utils/geography.js';

describe('Geography Utilities', () => {
  describe('Great Lakes Detection', () => {
    it('should detect Lake Michigan for Traverse City, MI', () => {
      const region = getGreatLakeRegion(44.7631, -85.6206);
      expect(region).toBe('Lake Michigan');
    });

    it('should detect Lake Superior for Duluth, MN', () => {
      const region = getGreatLakeRegion(46.7867, -92.1005);
      expect(region).toBe('Lake Superior');
    });

    it('should detect Lake Huron for Port Huron, MI', () => {
      const region = getGreatLakeRegion(43.0, -82.4);
      expect(region).toBe('Lake Huron');
    });

    it('should detect Lake Erie for Cleveland, OH', () => {
      const region = getGreatLakeRegion(41.5, -81.7);
      expect(region).toBe('Lake Erie');
    });

    it('should detect Lake Ontario for Rochester, NY', () => {
      const region = getGreatLakeRegion(43.2, -77.6);
      expect(region).toBe('Lake Ontario');
    });

    it('should return null for non-Great Lakes location', () => {
      const region = getGreatLakeRegion(40.7128, -74.0060); // New York City
      expect(region).toBeNull();
    });

    it('should return null for ocean location', () => {
      const region = getGreatLakeRegion(36.0, -76.0); // Atlantic Ocean
      expect(region).toBeNull();
    });
  });

  describe('Coastal Bay Detection', () => {
    it('should detect Chesapeake Bay', () => {
      const region = getMajorCoastalBayRegion(37.5, -76.3);
      expect(region).toBe('Chesapeake Bay');
    });

    it('should detect San Francisco Bay', () => {
      const region = getMajorCoastalBayRegion(37.8, -122.4);
      expect(region).toBe('San Francisco Bay');
    });

    it('should detect Tampa Bay', () => {
      const region = getMajorCoastalBayRegion(27.8, -82.6);
      expect(region).toBe('Tampa Bay');
    });

    it('should detect Puget Sound', () => {
      const region = getMajorCoastalBayRegion(47.6, -122.3);
      expect(region).toBe('Puget Sound');
    });

    it('should detect Lake Okeechobee', () => {
      const region = getMajorCoastalBayRegion(26.9, -80.8);
      expect(region).toBe('Lake Okeechobee');
    });

    it('should return null for non-bay location', () => {
      const region = getMajorCoastalBayRegion(40.7128, -74.0060); // New York City
      expect(region).toBeNull();
    });
  });

  describe('NOAA Marine Source Detection', () => {
    it('should recommend NOAA for Great Lakes location', () => {
      const result = shouldUseNOAAMarine(44.7631, -85.6206); // Traverse City, MI
      expect(result.useNOAA).toBe(true);
      expect(result.region).toBe('Lake Michigan');
      expect(result.source).toBe('great-lakes');
    });

    it('should recommend NOAA for coastal bay location', () => {
      const result = shouldUseNOAAMarine(37.8, -122.4); // San Francisco Bay
      expect(result.useNOAA).toBe(true);
      expect(result.region).toBe('San Francisco Bay');
      expect(result.source).toBe('coastal-bay');
    });

    it('should recommend Open-Meteo for ocean location', () => {
      const result = shouldUseNOAAMarine(36.0, -76.0); // Atlantic Ocean
      expect(result.useNOAA).toBe(false);
      expect(result.region).toBeNull();
      expect(result.source).toBe('ocean');
    });

    it('should recommend Open-Meteo for international location', () => {
      const result = shouldUseNOAAMarine(51.5, -0.1); // London
      expect(result.useNOAA).toBe(false);
      expect(result.region).toBeNull();
      expect(result.source).toBe('ocean');
    });
  });

  describe('Marine Region Description', () => {
    it('should provide description for Great Lakes location', () => {
      const desc = getMarineRegionDescription(44.7631, -85.6206);
      expect(desc).toBe('Lake Michigan (Great Lakes)');
    });

    it('should provide description for coastal bay location', () => {
      const desc = getMarineRegionDescription(37.8, -122.4);
      expect(desc).toBe('San Francisco Bay (Coastal Bay)');
    });

    it('should provide description for ocean location', () => {
      const desc = getMarineRegionDescription(36.0, -76.0);
      expect(desc).toBe('Open ocean or coastal waters');
    });
  });

  describe('Region List Access', () => {
    it('should return all Great Lakes regions', () => {
      const regions = getGreatLakesRegions();
      expect(regions).toHaveLength(5);
      expect(regions.map(r => r.name)).toContain('Lake Superior');
      expect(regions.map(r => r.name)).toContain('Lake Michigan');
      expect(regions.map(r => r.name)).toContain('Lake Huron');
      expect(regions.map(r => r.name)).toContain('Lake Erie');
      expect(regions.map(r => r.name)).toContain('Lake Ontario');
    });

    it('should return all major coastal bay regions', () => {
      const regions = getMajorCoastalBayRegions();
      expect(regions.length).toBeGreaterThanOrEqual(5);
      expect(regions.map(r => r.name)).toContain('Chesapeake Bay');
      expect(regions.map(r => r.name)).toContain('San Francisco Bay');
    });

    it('should have valid bounding boxes for all regions', () => {
      const allRegions = [...getGreatLakesRegions(), ...getMajorCoastalBayRegions()];

      for (const region of allRegions) {
        expect(region.bbox.minLat).toBeLessThan(region.bbox.maxLat);
        expect(region.bbox.minLon).toBeLessThan(region.bbox.maxLon);
        expect(region.bbox.minLat).toBeGreaterThanOrEqual(-90);
        expect(region.bbox.maxLat).toBeLessThanOrEqual(90);
        expect(region.bbox.minLon).toBeGreaterThanOrEqual(-180);
        expect(region.bbox.maxLon).toBeLessThanOrEqual(180);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle coordinates at Great Lakes boundary', () => {
      // Test coordinates very close to Lake Michigan boundary
      const result1 = shouldUseNOAAMarine(41.6, -87.8); // SW corner
      const result2 = shouldUseNOAAMarine(46.0, -84.8); // NE corner

      // Both should be detected as Lake Michigan
      expect(result1.region).toBe('Lake Michigan');
      expect(result2.region).toBe('Lake Michigan');
    });

    it('should handle coordinates just outside Great Lakes', () => {
      // Just south of Lake Michigan
      const result = shouldUseNOAAMarine(41.5, -87.8);
      expect(result.useNOAA).toBe(false);
    });

    it('should not overlap Great Lakes and coastal bays', () => {
      // Test that no coordinate can match both
      const testPoints = [
        [44.7631, -85.6206], // Traverse City
        [37.8, -122.4], // San Francisco Bay
        [46.7867, -92.1005], // Duluth
        [27.8, -82.6] // Tampa Bay
      ];

      for (const [lat, lon] of testPoints) {
        const greatLake = getGreatLakeRegion(lat, lon);
        const coastalBay = getMajorCoastalBayRegion(lat, lon);

        // A point should not be in both a Great Lake and a coastal bay
        expect(!(greatLake && coastalBay)).toBe(true);
      }
    });
  });
});
