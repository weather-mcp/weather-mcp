/**
 * Live tests for get_weather_imagery (RainViewer, NASA GIBS).
 * Lightning is covered offline by tests/integration/lightning-fixture-broker.test.ts
 * and by the live broker smoke test in tests/live/lightning-broker-smoke.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { getWeatherImagery } from '../../src/handlers/weatherImageryHandler.js';

describe('Weather Imagery (v1.5.0)', () => {
  describe('Precipitation Radar', () => {
    it('should retrieve precipitation radar imagery for New York', async () => {
      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: false
      });

      expect(result).toBeDefined();
      expect(result.type).toBe('precipitation');
      expect(result.location.latitude).toBe(40.7128);
      expect(result.location.longitude).toBe(-74.006);
      expect(result.source).toBe('RainViewer');
      expect(result.coverage).toBe('Global');
      expect(result.animated).toBe(false);
      expect(Array.isArray(result.frames)).toBe(true);

      // Should have at least one frame (latest)
      if (result.frames.length > 0) {
        const frame = result.frames[0];
        expect(frame.url).toBeDefined();
        expect(frame.url).toContain('tilecache.rainviewer.com');
        expect(frame.timestamp).toBeInstanceOf(Date);
      }

      console.log(`New York precipitation radar: ${result.frames.length} frames available`);
    });

    it('should retrieve animated precipitation radar for London', async () => {
      const result = await getWeatherImagery({
        latitude: 51.5074,
        longitude: -0.1278,
        type: 'precipitation',
        animated: true
      });

      expect(result).toBeDefined();
      expect(result.animated).toBe(true);
      expect(Array.isArray(result.frames)).toBe(true);

      // Animated should have multiple frames
      console.log(`London animated radar: ${result.frames.length} frames`);

      // Verify frames are in chronological order
      if (result.frames.length > 1) {
        for (let i = 1; i < result.frames.length; i++) {
          expect(result.frames[i].timestamp.getTime()).toBeGreaterThanOrEqual(
            result.frames[i - 1].timestamp.getTime()
          );
        }
      }
    });

    it('should handle radar type (alias for precipitation)', async () => {
      const result = await getWeatherImagery({
        latitude: 35.6762,
        longitude: 139.6503,
        type: 'radar',
        animated: false
      });

      expect(result).toBeDefined();
      expect(result.type).toBe('radar');
      expect(result.source).toBe('RainViewer');
    });
  });

  describe('Validation', () => {
    it('should reject invalid imagery type', async () => {
      await expect(
        getWeatherImagery({
          latitude: 40.7128,
          longitude: -74.006,
          type: 'invalid' as any,
          animated: false
        })
      ).rejects.toThrow();
    });

    it('should reject invalid coordinates', async () => {
      await expect(
        getWeatherImagery({
          latitude: 95, // Invalid
          longitude: -74.006,
          type: 'precipitation',
          animated: false
        })
      ).rejects.toThrow();
    });

    it('should return GOES GeoColor satellite imagery via NASA GIBS', async () => {
      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'satellite',
        animated: false
      });

      expect(result.type).toBe('satellite');
      expect(result.source).toContain('GIBS');
      expect(result.frames.length).toBe(1);
      expect(result.frames[0].url).toContain('gibs.earthdata.nasa.gov');
      expect(result.frames[0].url).toContain('GOES-East_ABI_GeoColor');
    });

    it('should select GOES-West for far-western longitudes', async () => {
      const result = await getWeatherImagery({
        latitude: 21.3069, // Honolulu
        longitude: -157.8583,
        type: 'satellite',
        animated: false
      });

      expect(result.frames[0].url).toContain('GOES-West_ABI_GeoColor');
    });

    it('should return a single latest snapshot for satellite even if animated requested', async () => {
      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'satellite',
        animated: true
      });

      // Satellite does not animate (GIBS sub-daily timestamps are irregular).
      expect(result.animated).toBe(false);
      expect(result.frames.length).toBe(1);
    });
  });
});
