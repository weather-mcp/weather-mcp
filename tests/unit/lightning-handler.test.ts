/**
 * Unit tests for lightning activity handler
 * Tests safety assessment, statistics calculation, and validation
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { getLightningActivity, formatLightningActivityResponse } from '../../src/handlers/lightningHandler.js';
import { LightningStrike, LightningActivityResponse } from '../../src/types/lightning.js';
import * as blitzortungModule from '../../src/services/blitzortung.js';

// Mock the blitzortung service
vi.mock('../../src/services/blitzortung.js', () => ({
  blitzortungService: {
    getLightningStrikes: vi.fn()
  }
}));

describe('Lightning Activity Handler', () => {
  let mockGetLightningStrikes: Mock;

  beforeEach(() => {
    mockGetLightningStrikes = blitzortungModule.blitzortungService.getLightningStrikes as Mock;
    mockGetLightningStrikes.mockReset();
  });

  describe('Parameter Validation', () => {
    it('should accept valid parameters', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006,
        radius: 100,
        timeWindow: 60
      });

      expect(result).toBeDefined();
      expect(result.location.latitude).toBe(40.7128);
      expect(result.location.longitude).toBe(-74.006);
    });

    it('should reject invalid latitude', async () => {
      await expect(
        getLightningActivity({
          latitude: 95,
          longitude: -74.006
        })
      ).rejects.toThrow();
    });

    it('should reject invalid longitude', async () => {
      await expect(
        getLightningActivity({
          latitude: 40.7128,
          longitude: 200
        })
      ).rejects.toThrow();
    });

    it('should reject radius below minimum', async () => {
      await expect(
        getLightningActivity({
          latitude: 40.7128,
          longitude: -74.006,
          radius: 0
        })
      ).rejects.toThrow('radius must be a number between 1 and 500 km');
    });

    it('should reject radius above maximum', async () => {
      await expect(
        getLightningActivity({
          latitude: 40.7128,
          longitude: -74.006,
          radius: 600
        })
      ).rejects.toThrow('radius must be a number between 1 and 500 km');
    });

    it('should reject time window below minimum', async () => {
      await expect(
        getLightningActivity({
          latitude: 40.7128,
          longitude: -74.006,
          timeWindow: 2
        })
      ).rejects.toThrow('timeWindow must be a number between 5 and 120 minutes');
    });

    it('should reject time window above maximum', async () => {
      await expect(
        getLightningActivity({
          latitude: 40.7128,
          longitude: -74.006,
          timeWindow: 200
        })
      ).rejects.toThrow('timeWindow must be a number between 5 and 120 minutes');
    });

    it('should use default radius when not provided', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.searchRadius).toBe(100);
      expect(mockGetLightningStrikes).toHaveBeenCalledWith(40.7128, -74.006, 100, 60);
    });

    it('should use default time window when not provided', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.timeWindow).toBe(60);
      expect(mockGetLightningStrikes).toHaveBeenCalledWith(40.7128, -74.006, 100, 60);
    });
  });

  describe('Safety Assessment', () => {
    it('should assess as safe when no strikes detected', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.safety.level).toBe('safe');
      expect(result.safety.message).toContain('No significant lightning');
      expect(result.safety.nearestStrikeDistance).toBeNull();
      expect(result.safety.nearestStrikeTime).toBeNull();
      expect(result.safety.isActiveThunderstorm).toBe(false);
    });

    it('should assess as safe when strikes are far away (>50km)', async () => {
      const strikes: LightningStrike[] = [
        {
          timestamp: new Date(Date.now() - 5 * 60 * 1000),
          latitude: 41.5,
          longitude: -74.0,
          polarity: -1,
          amplitude: 30,
          distance: 60
        }
      ];
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.safety.level).toBe('safe');
      expect(result.safety.nearestStrikeDistance).toBe(60);
    });

    it('should assess as elevated when strikes are 16-50km away', async () => {
      const strikes: LightningStrike[] = [
        {
          timestamp: new Date(Date.now() - 5 * 60 * 1000),
          latitude: 40.9,
          longitude: -74.0,
          polarity: -1,
          amplitude: 30,
          distance: 25
        }
      ];
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.safety.level).toBe('elevated');
      expect(result.safety.message).toContain('25.0 km away');
      expect(result.safety.message).toContain('vicinity');
      expect(result.safety.recommendations.length).toBeGreaterThan(0);
      expect(result.safety.recommendations.some(r => r.includes('Move activities indoors'))).toBe(true);
    });

    it('should assess as high when strikes are 8-16km away', async () => {
      const strikes: LightningStrike[] = [
        {
          timestamp: new Date(Date.now() - 3 * 60 * 1000),
          latitude: 40.78,
          longitude: -74.0,
          polarity: -1,
          amplitude: 40,
          distance: 10
        }
      ];
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.safety.level).toBe('high');
      expect(result.safety.message).toContain('10.0 km away');
      expect(result.safety.message).toContain('High risk');
      expect(result.safety.recommendations.some(r => r.includes('SEEK SHELTER IMMEDIATELY'))).toBe(true);
    });

    it('should assess as extreme when strikes are very close (<8km)', async () => {
      const strikes: LightningStrike[] = [
        {
          timestamp: new Date(Date.now() - 1 * 60 * 1000),
          latitude: 40.72,
          longitude: -74.0,
          polarity: -1,
          amplitude: 50,
          distance: 5
        }
      ];
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.safety.level).toBe('extreme');
      expect(result.safety.message).toContain('EXTREME DANGER');
      expect(result.safety.message).toContain('5.0 km');
      expect(result.safety.recommendations.some(r => r.includes('⚠️ TAKE IMMEDIATE SHELTER'))).toBe(true);
    });

    it('should detect active thunderstorm from recent strikes', async () => {
      const strikes: LightningStrike[] = [
        {
          timestamp: new Date(Date.now() - 3 * 60 * 1000), // 3 minutes ago
          latitude: 40.8,
          longitude: -74.0,
          polarity: -1,
          amplitude: 30,
          distance: 30
        }
      ];
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.safety.isActiveThunderstorm).toBe(true);
    });

    it('should detect active thunderstorm from high strike rate', async () => {
      // 40 strikes in 60 minutes = 0.67 strikes/min > 0.5 threshold
      const strikes: LightningStrike[] = Array.from({ length: 40 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 90 * 1000), // Every 1.5 minutes
        latitude: 40.8,
        longitude: -74.0,
        polarity: -1,
        amplitude: 30,
        distance: 30
      }));
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006,
        timeWindow: 60
      });

      expect(result.safety.isActiveThunderstorm).toBe(true);
    });

    it('should not detect active thunderstorm from old strikes', async () => {
      const strikes: LightningStrike[] = [
        {
          timestamp: new Date(Date.now() - 50 * 60 * 1000), // 50 minutes ago
          latitude: 40.8,
          longitude: -74.0,
          polarity: -1,
          amplitude: 30,
          distance: 30
        }
      ];
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.safety.isActiveThunderstorm).toBe(false);
    });
  });

  describe('Statistics Calculation', () => {
    it('should calculate zero statistics when no strikes', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.statistics.totalStrikes).toBe(0);
      expect(result.statistics.cloudToGroundStrikes).toBe(0);
      expect(result.statistics.intraCloudStrikes).toBe(0);
      expect(result.statistics.averageDistance).toBe(0);
      expect(result.statistics.nearestDistance).toBe(0);
      expect(result.statistics.strikesPerMinute).toBe(0);
      expect(result.statistics.densityPerSqKm).toBe(0);
    });

    it('should calculate total strikes correctly', async () => {
      const strikes: LightningStrike[] = Array.from({ length: 15 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 60 * 1000),
        latitude: 40.8,
        longitude: -74.0,
        polarity: -1,
        amplitude: 30,
        distance: 20
      }));
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.statistics.totalStrikes).toBe(15);
    });

    it('should classify cloud-to-ground strikes (amplitude > 20)', async () => {
      const strikes: LightningStrike[] = [
        { timestamp: new Date(), latitude: 40.8, longitude: -74.0, polarity: -1, amplitude: 50, distance: 20 },
        { timestamp: new Date(), latitude: 40.8, longitude: -74.0, polarity: -1, amplitude: 30, distance: 20 },
        { timestamp: new Date(), latitude: 40.8, longitude: -74.0, polarity: -1, amplitude: 10, distance: 20 }, // Intra-cloud
        { timestamp: new Date(), latitude: 40.8, longitude: -74.0, polarity: 1, amplitude: 40, distance: 20 }
      ];
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.statistics.cloudToGroundStrikes).toBe(3);
      expect(result.statistics.intraCloudStrikes).toBe(1);
      expect(result.statistics.totalStrikes).toBe(4);
    });

    it('should calculate average distance correctly', async () => {
      const strikes: LightningStrike[] = [
        { timestamp: new Date(), latitude: 40.8, longitude: -74.0, polarity: -1, amplitude: 30, distance: 10 },
        { timestamp: new Date(), latitude: 40.8, longitude: -74.0, polarity: -1, amplitude: 30, distance: 20 },
        { timestamp: new Date(), latitude: 40.8, longitude: -74.0, polarity: -1, amplitude: 30, distance: 30 }
      ];
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.statistics.averageDistance).toBe(20);
    });

    it('should calculate nearest distance from first strike', async () => {
      const strikes: LightningStrike[] = [
        { timestamp: new Date(), latitude: 40.8, longitude: -74.0, polarity: -1, amplitude: 30, distance: 5 },
        { timestamp: new Date(), latitude: 40.8, longitude: -74.0, polarity: -1, amplitude: 30, distance: 15 },
        { timestamp: new Date(), latitude: 40.8, longitude: -74.0, polarity: -1, amplitude: 30, distance: 25 }
      ];
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.statistics.nearestDistance).toBe(5);
    });

    it('should calculate strikes per minute', async () => {
      const strikes: LightningStrike[] = Array.from({ length: 30 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 120 * 1000), // Every 2 minutes
        latitude: 40.8,
        longitude: -74.0,
        polarity: -1,
        amplitude: 30,
        distance: 20
      }));
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006,
        timeWindow: 60
      });

      expect(result.statistics.strikesPerMinute).toBe(0.5); // 30 strikes / 60 minutes
    });

    it('should calculate density per square km', async () => {
      const strikes: LightningStrike[] = Array.from({ length: 100 }, (_, i) => ({
        timestamp: new Date(),
        latitude: 40.8,
        longitude: -74.0,
        polarity: -1,
        amplitude: 30,
        distance: 20
      }));
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006,
        radius: 100 // Area = π * 100^2 = 31,415.93 km²
      });

      const expectedArea = Math.PI * 100 * 100;
      const expectedDensity = 100 / expectedArea;
      expect(result.statistics.densityPerSqKm).toBeCloseTo(expectedDensity, 5);
    });
  });

  describe('Response Structure', () => {
    it('should include all required fields', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006,
        radius: 100,
        timeWindow: 60
      });

      expect(result.location).toBeDefined();
      expect(result.location.latitude).toBe(40.7128);
      expect(result.location.longitude).toBe(-74.006);
      expect(result.searchRadius).toBe(100);
      expect(result.timeWindow).toBe(60);
      expect(result.searchPeriod).toBeDefined();
      expect(result.searchPeriod.start).toBeInstanceOf(Date);
      expect(result.searchPeriod.end).toBeInstanceOf(Date);
      expect(result.strikes).toEqual([]);
      expect(result.statistics).toBeDefined();
      expect(result.safety).toBeDefined();
      expect(result.source).toBe('Blitzortung.org');
      expect(result.generatedAt).toBeInstanceOf(Date);
      expect(result.disclaimer).toBeDefined();
    });

    it('should calculate correct search period', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const beforeCall = Date.now();
      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006,
        timeWindow: 60
      });
      const afterCall = Date.now();

      const periodDuration = result.searchPeriod.end.getTime() - result.searchPeriod.start.getTime();
      const expectedDuration = 60 * 60 * 1000; // 60 minutes in ms

      expect(periodDuration).toBeCloseTo(expectedDuration, -2); // Within 100ms
      expect(result.searchPeriod.end.getTime()).toBeGreaterThanOrEqual(beforeCall);
      expect(result.searchPeriod.end.getTime()).toBeLessThanOrEqual(afterCall);
    });

    it('should include strikes in response', async () => {
      const strikes: LightningStrike[] = [
        {
          timestamp: new Date(),
          latitude: 40.8,
          longitude: -74.0,
          polarity: -1,
          amplitude: 30,
          distance: 20
        }
      ];
      mockGetLightningStrikes.mockResolvedValue(strikes);

      const result = await getLightningActivity({
        latitude: 40.7128,
        longitude: -74.006
      });

      expect(result.strikes).toEqual(strikes);
    });
  });

  describe('formatLightningActivityResponse', () => {
    it('should format response with no strikes', () => {
      const response: LightningActivityResponse = {
        location: { latitude: 40.7128, longitude: -74.006 },
        searchRadius: 100,
        timeWindow: 60,
        searchPeriod: {
          start: new Date('2024-01-01T12:00:00Z'),
          end: new Date('2024-01-01T13:00:00Z')
        },
        strikes: [],
        statistics: {
          totalStrikes: 0,
          cloudToGroundStrikes: 0,
          intraCloudStrikes: 0,
          averageDistance: 0,
          nearestDistance: 0,
          strikesPerMinute: 0,
          densityPerSqKm: 0
        },
        safety: {
          level: 'safe',
          message: 'No significant lightning activity detected.',
          recommendations: ['Continue to monitor weather conditions.'],
          nearestStrikeDistance: null,
          nearestStrikeTime: null,
          isActiveThunderstorm: false
        },
        source: 'Blitzortung.org',
        generatedAt: new Date('2024-01-01T13:00:00Z'),
        disclaimer: 'Lightning data from Blitzortung.org community network.'
      };

      const formatted = formatLightningActivityResponse(response);

      expect(formatted).toContain('# ⚡ Lightning Activity Report');
      expect(formatted).toContain('40.7128, -74.0060');
      expect(formatted).toContain('100 km');
      expect(formatted).toContain('60 minutes');
      expect(formatted).toContain('🟢');
      expect(formatted).toContain('SAFE');
      expect(formatted).toContain('**Total Strikes:** 0');
      expect(formatted).toContain('No lightning strikes detected');
    });

    it('should format response with strikes', () => {
      const response: LightningActivityResponse = {
        location: { latitude: 40.7128, longitude: -74.006 },
        searchRadius: 100,
        timeWindow: 60,
        searchPeriod: {
          start: new Date('2024-01-01T12:00:00Z'),
          end: new Date('2024-01-01T13:00:00Z')
        },
        strikes: [
          {
            timestamp: new Date('2024-01-01T12:45:00Z'),
            latitude: 40.8,
            longitude: -74.0,
            polarity: -1,
            amplitude: 35.5,
            stationCount: 8,
            distance: 12.3
          }
        ],
        statistics: {
          totalStrikes: 1,
          cloudToGroundStrikes: 1,
          intraCloudStrikes: 0,
          averageDistance: 12.3,
          nearestDistance: 12.3,
          strikesPerMinute: 0.0167,
          densityPerSqKm: 0.0000318
        },
        safety: {
          level: 'high',
          message: 'Lightning detected 12.3 km away.',
          recommendations: ['SEEK SHELTER IMMEDIATELY'],
          nearestStrikeDistance: 12.3,
          nearestStrikeTime: new Date('2024-01-01T12:45:00Z'),
          isActiveThunderstorm: true
        },
        source: 'Blitzortung.org',
        generatedAt: new Date('2024-01-01T13:00:00Z'),
        disclaimer: 'Lightning data from Blitzortung.org community network.'
      };

      const formatted = formatLightningActivityResponse(response);

      expect(formatted).toContain('🟠');
      expect(formatted).toContain('HIGH');
      expect(formatted).toContain('**Total Strikes:** 1');
      expect(formatted).toContain('**Cloud-to-Ground:** 1');
      expect(formatted).toContain('**Nearest Strike:** 12.3 km');
      expect(formatted).toContain('**Active Thunderstorm:** Yes');
      expect(formatted).toContain('## 🌩️ Recent Strikes');
      expect(formatted).toContain('**Distance:** 12.3 km');
      expect(formatted).toContain('**Polarity:** − (Negative)');
      expect(formatted).toContain('**Amplitude:** 35.5 kA');
      expect(formatted).toContain('**Detected by:** 8 stations');
    });

    it('should show correct safety icons for all levels', () => {
      const levels: Array<{ level: 'safe' | 'elevated' | 'high' | 'extreme'; icon: string }> = [
        { level: 'safe', icon: '🟢' },
        { level: 'elevated', icon: '🟡' },
        { level: 'high', icon: '🟠' },
        { level: 'extreme', icon: '🔴' }
      ];

      levels.forEach(({ level, icon }) => {
        const response: LightningActivityResponse = {
          location: { latitude: 40.7128, longitude: -74.006 },
          searchRadius: 100,
          timeWindow: 60,
          searchPeriod: {
            start: new Date(),
            end: new Date()
          },
          strikes: [],
          statistics: {
            totalStrikes: 0,
            cloudToGroundStrikes: 0,
            intraCloudStrikes: 0,
            averageDistance: 0,
            nearestDistance: 0,
            strikesPerMinute: 0,
            densityPerSqKm: 0
          },
          safety: {
            level,
            message: 'Test',
            recommendations: [],
            nearestStrikeDistance: null,
            nearestStrikeTime: null,
            isActiveThunderstorm: false
          },
          source: 'Blitzortung.org',
          generatedAt: new Date()
        };

        const formatted = formatLightningActivityResponse(response);
        expect(formatted).toContain(icon);
        expect(formatted).toContain(level.toUpperCase());
      });
    });

    it('should limit strike display to 10', () => {
      const strikes: LightningStrike[] = Array.from({ length: 25 }, (_, i) => ({
        timestamp: new Date(),
        latitude: 40.8,
        longitude: -74.0,
        polarity: -1,
        amplitude: 30,
        distance: i + 1
      }));

      const response: LightningActivityResponse = {
        location: { latitude: 40.7128, longitude: -74.006 },
        searchRadius: 100,
        timeWindow: 60,
        searchPeriod: {
          start: new Date(),
          end: new Date()
        },
        strikes,
        statistics: {
          totalStrikes: 25,
          cloudToGroundStrikes: 25,
          intraCloudStrikes: 0,
          averageDistance: 13,
          nearestDistance: 1,
          strikesPerMinute: 0.42,
          densityPerSqKm: 0.0008
        },
        safety: {
          level: 'safe',
          message: 'Test',
          recommendations: [],
          nearestStrikeDistance: 1,
          nearestStrikeTime: new Date(),
          isActiveThunderstorm: false
        },
        source: 'Blitzortung.org',
        generatedAt: new Date()
      };

      const formatted = formatLightningActivityResponse(response);

      expect(formatted).toContain('### Strike 1');
      expect(formatted).toContain('### Strike 10');
      expect(formatted).not.toContain('### Strike 11');
      expect(formatted).toContain('Showing 10 of 25 strikes');
    });
  });

  describe('Edge Cases', () => {
    it('should handle boundary coordinates', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const result = await getLightningActivity({
        latitude: 90,
        longitude: -180
      });

      expect(result).toBeDefined();
    });

    it('should handle minimum valid parameters', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const result = await getLightningActivity({
        latitude: 0,
        longitude: 0,
        radius: 1,
        timeWindow: 5
      });

      expect(result.searchRadius).toBe(1);
      expect(result.timeWindow).toBe(5);
    });

    it('should handle maximum valid parameters', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const result = await getLightningActivity({
        latitude: 0,
        longitude: 0,
        radius: 500,
        timeWindow: 120
      });

      expect(result.searchRadius).toBe(500);
      expect(result.timeWindow).toBe(120);
    });
  });
});
