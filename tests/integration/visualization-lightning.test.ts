/**
 * Integration tests for v1.5.0 Visualization & Lightning Safety features
 * Tests get_weather_imagery and get_lightning_activity tools
 */

import { describe, it, expect } from 'vitest';
import { getWeatherImagery } from '../../src/handlers/weatherImageryHandler.js';
import { getLightningActivity } from '../../src/handlers/lightningHandler.js';

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
    }, 15000);

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
    }, 15000);

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
    }, 15000);
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

    it('should reject satellite imagery (not yet implemented)', async () => {
      await expect(
        getWeatherImagery({
          latitude: 40.7128,
          longitude: -74.006,
          type: 'satellite',
          animated: false
        })
      ).rejects.toThrow('not yet implemented');
    });
  });
});

describe('Lightning Activity (v1.5.0)', () => {
  describe('Lightning Detection', () => {
    it('should retrieve lightning activity for Miami (thunderstorm region)', async () => {
      const result = await getLightningActivity({
        latitude: 25.7617,
        longitude: -80.1918,
        radius: 100,
        timeWindow: 60
      });

      expect(result).toBeDefined();
      expect(result.location.latitude).toBe(25.7617);
      expect(result.location.longitude).toBe(-80.1918);
      expect(result.searchRadius).toBe(100);
      expect(result.timeWindow).toBe(60);
      expect(result.source).toBe('Blitzortung.org');
      expect(Array.isArray(result.strikes)).toBe(true);
      expect(result.statistics).toBeDefined();
      expect(result.safety).toBeDefined();

      console.log(`Miami lightning: ${result.strikes.length} strikes detected`);
      console.log(`Safety level: ${result.safety.level}`);
      console.log(`Active thunderstorm: ${result.safety.isActiveThunderstorm}`);
    }, 15000);

    it('should use default radius and time window', async () => {
      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.searchRadius).toBe(100); // Default radius
      expect(result.timeWindow).toBe(60); // Default time window
    }, 15000);

    it('should handle custom search parameters', async () => {
      const result = await getLightningActivity({
        latitude: 51.5074,
        longitude: -0.1278,
        radius: 50,
        timeWindow: 30
      });

      expect(result.searchRadius).toBe(50);
      expect(result.timeWindow).toBe(30);

      // Verify search period
      const durationMs = result.searchPeriod.end.getTime() - result.searchPeriod.start.getTime();
      const durationMinutes = durationMs / (1000 * 60);
      expect(durationMinutes).toBeCloseTo(30, 0);
    }, 15000);
  });

  describe('Safety Assessment', () => {
    it('should provide safety assessment', async () => {
      const result = await getLightningActivity({
        latitude: 35.6762,
        longitude: 139.6503,
        radius: 100,
        timeWindow: 60
      });

      expect(result.safety.level).toBeDefined();
      expect(['safe', 'elevated', 'high', 'extreme']).toContain(result.safety.level);
      expect(result.safety.message).toBeDefined();
      expect(Array.isArray(result.safety.recommendations)).toBe(true);
      expect(result.safety.recommendations.length).toBeGreaterThan(0);

      console.log(`Tokyo lightning safety: ${result.safety.level}`);
      console.log(`Recommendations: ${result.safety.recommendations[0]}`);
    }, 15000);

    it('should calculate statistics correctly', async () => {
      const result = await getLightningActivity({
        latitude: -33.8688,
        longitude: 151.2093,
        radius: 100,
        timeWindow: 60
      });

      expect(result.statistics).toBeDefined();
      expect(result.statistics.totalStrikes).toBeGreaterThanOrEqual(0);
      expect(result.statistics.cloudToGroundStrikes).toBeGreaterThanOrEqual(0);
      expect(result.statistics.intraCloudStrikes).toBeGreaterThanOrEqual(0);
      expect(result.statistics.strikesPerMinute).toBeGreaterThanOrEqual(0);
      expect(result.statistics.densityPerSqKm).toBeGreaterThanOrEqual(0);

      // If strikes detected, verify statistics make sense
      if (result.statistics.totalStrikes > 0) {
        expect(result.statistics.cloudToGroundStrikes + result.statistics.intraCloudStrikes)
          .toBeLessThanOrEqual(result.statistics.totalStrikes);
        expect(result.statistics.nearestDistance).toBeGreaterThan(0);
        expect(result.statistics.averageDistance).toBeGreaterThan(0);
      }

      console.log(`Sydney lightning statistics:`, result.statistics);
    }, 15000);
  });

  describe('Strike Details', () => {
    it('should provide strike details when strikes detected', async () => {
      const result = await getLightningActivity({
        latitude: 30.2672,
        longitude: -97.7431, // Austin, TX (thunderstorm prone)
        radius: 150,
        timeWindow: 90
      });

      if (result.strikes.length > 0) {
        const strike = result.strikes[0];
        expect(strike.timestamp).toBeInstanceOf(Date);
        expect(strike.latitude).toBeDefined();
        expect(strike.longitude).toBeDefined();
        expect(strike.polarity).toBeDefined();
        expect(strike.amplitude).toBeDefined();
        expect(strike.distance).toBeGreaterThanOrEqual(0);

        console.log(`Austin strike example:`, {
          distance: `${strike.distance?.toFixed(1)} km`,
          polarity: strike.polarity > 0 ? 'Positive' : 'Negative',
          amplitude: `${strike.amplitude.toFixed(1)} kA`,
          age: `${((Date.now() - strike.timestamp.getTime()) / 60000).toFixed(1)} min ago`
        });
      } else {
        console.log('Austin: No strikes detected (normal if no active thunderstorms)');
      }
    }, 15000);
  });

  describe('Validation', () => {
    it('should reject invalid radius', async () => {
      await expect(
        getLightningActivity({
          latitude: 40.7128,
          longitude: -74.006,
          radius: 600 // Exceeds max
        })
      ).rejects.toThrow();
    });

    it('should reject invalid time window', async () => {
      await expect(
        getLightningActivity({
          latitude: 40.7128,
          longitude: -74.006,
          timeWindow: 200 // Exceeds max
        })
      ).rejects.toThrow();
    });

    it('should reject invalid coordinates', async () => {
      await expect(
        getLightningActivity({
          latitude: -95, // Invalid
          longitude: -74.006
        })
      ).rejects.toThrow();
    });
  });
});
