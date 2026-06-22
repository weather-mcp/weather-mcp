import { describe, it, expect } from 'vitest';
import { GibsService } from '../../src/services/gibs.js';

describe('GibsService (satellite imagery)', () => {
  const service = new GibsService();

  describe('layer selection', () => {
    it('uses GOES-East for the eastern/central US', () => {
      const [frame] = service.getSatelliteImagery(40.7128, -74.006); // New York
      expect(frame.url).toContain('GOES-East_ABI_GeoColor');
    });

    it('uses GOES-West for far-western/Pacific longitudes', () => {
      const [frame] = service.getSatelliteImagery(21.3069, -157.8583); // Honolulu
      expect(frame.url).toContain('GOES-West_ABI_GeoColor');
    });
  });

  describe('latest frame (non-animated)', () => {
    it('returns exactly one frame with a valid GIBS WMTS tile URL', () => {
      const frames = service.getSatelliteImagery(39.7392, -104.9903); // Denver
      expect(frames).toHaveLength(1);
      const url = frames[0].url;
      expect(url).toContain('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/');
      expect(url).toContain('GoogleMapsCompatible_Level7');
      expect(url).toMatch(/\/\d+\/\d+\/\d+\.png$/); // /{z}/{y}/{x}.png
    });

    it('omits the time dimension for the latest frame', () => {
      const [frame] = service.getSatelliteImagery(39.7392, -104.9903);
      // No ISO timestamp segment in the latest-frame URL.
      expect(frame.url).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('tile coordinate safety', () => {
    it('clamps polar latitudes without producing NaN tile indices', () => {
      const [frame] = service.getSatelliteImagery(89.9, -100); // near North Pole
      const match = frame.url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
      expect(match).not.toBeNull();
      const [, z, y, x] = match!.map(Number);
      expect(Number.isInteger(z)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
      expect(Number.isInteger(x)).toBe(true);
    });
  });
});
