/**
 * Unit tests for weather imagery handler
 * Tests parameter validation and response formatting
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { getWeatherImagery, formatWeatherImageryResponse } from '../../src/handlers/weatherImageryHandler.js';
import { WeatherImageryResponse, ImageryFrame } from '../../src/types/imagery.js';
import * as rainViewerModule from '../../src/services/rainviewer.js';

// Mock the rainviewer service
vi.mock('../../src/services/rainviewer.js', () => ({
  rainViewerService: {
    getPrecipitationRadar: vi.fn()
  }
}));

describe('Weather Imagery Handler', () => {
  let mockGetPrecipitationRadar: Mock;

  beforeEach(() => {
    mockGetPrecipitationRadar = rainViewerModule.rainViewerService.getPrecipitationRadar as Mock;
    mockGetPrecipitationRadar.mockReset();
  });

  describe('Parameter Validation', () => {
    it('should accept valid precipitation request', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: false
      });

      expect(result).toBeDefined();
      expect(result.type).toBe('precipitation');
    });

    it('should accept valid radar request', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'radar',
        animated: true
      });

      expect(result).toBeDefined();
      expect(result.type).toBe('radar');
    });

    it('should reject invalid latitude', async () => {
      await expect(
        getWeatherImagery({
          latitude: 95,
          longitude: -74.006,
          type: 'precipitation',
          animated: false
        })
      ).rejects.toThrow();
    });

    it('should reject invalid longitude', async () => {
      await expect(
        getWeatherImagery({
          latitude: 40.7128,
          longitude: 200,
          type: 'precipitation',
          animated: false
        })
      ).rejects.toThrow();
    });

    it('should reject invalid imagery type', async () => {
      await expect(
        getWeatherImagery({
          latitude: 40.7128,
          longitude: -74.006,
          type: 'invalid' as any,
          animated: false
        })
      ).rejects.toThrow('Invalid imagery type');
    });

    it('should reject satellite type (not yet implemented)', async () => {
      await expect(
        getWeatherImagery({
          latitude: 40.7128,
          longitude: -74.006,
          type: 'satellite',
          animated: false
        })
      ).rejects.toThrow('not yet implemented');
    });

    it('should reject non-boolean animated parameter', async () => {
      await expect(
        getWeatherImagery({
          latitude: 40.7128,
          longitude: -74.006,
          type: 'precipitation',
          animated: 'yes' as any
        })
      ).rejects.toThrow('animated parameter must be a boolean');
    });

    it('should reject non-array layers parameter', async () => {
      await expect(
        getWeatherImagery({
          latitude: 40.7128,
          longitude: -74.006,
          type: 'precipitation',
          animated: false,
          layers: 'layer1' as any
        })
      ).rejects.toThrow('layers parameter must be an array');
    });

    it('should reject too many layers', async () => {
      const tooManyLayers = Array.from({ length: 11 }, (_, i) => `layer${i}`);

      await expect(
        getWeatherImagery({
          latitude: 40.7128,
          longitude: -74.006,
          type: 'precipitation',
          animated: false,
          layers: tooManyLayers
        })
      ).rejects.toThrow('Maximum 10 layers allowed');
    });

    it('should accept valid layers parameter', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: false,
        layers: ['base', 'overlay']
      });

      expect(result).toBeDefined();
    });

    it('should default animated to false when not provided', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation'
      });

      expect(result.animated).toBe(false);
      expect(mockGetPrecipitationRadar).toHaveBeenCalledWith(40.7128, -74.006, false);
    });

    it('should accept animated: true', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: true
      });

      expect(result.animated).toBe(true);
      expect(mockGetPrecipitationRadar).toHaveBeenCalledWith(40.7128, -74.006, true);
    });
  });

  describe('Response Structure', () => {
    it('should return properly structured response for precipitation', async () => {
      const mockFrames: ImageryFrame[] = [
        {
          url: 'https://example.com/frame1.png',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          description: 'Test frame'
        }
      ];
      mockGetPrecipitationRadar.mockResolvedValue(mockFrames);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: false
      });

      expect(result.type).toBe('precipitation');
      expect(result.location.latitude).toBe(40.7128);
      expect(result.location.longitude).toBe(-74.006);
      expect(result.coverage).toBe('Global');
      expect(result.source).toBe('RainViewer');
      expect(result.animated).toBe(false);
      expect(result.frames).toEqual(mockFrames);
      expect(result.generatedAt).toBeInstanceOf(Date);
      expect(result.disclaimer).toContain('RainViewer');
    });

    it('should set correct resolution for static imagery', async () => {
      const mockFrames: ImageryFrame[] = [
        {
          url: 'https://example.com/frame1.png',
          timestamp: new Date(),
          description: 'Test'
        }
      ];
      mockGetPrecipitationRadar.mockResolvedValue(mockFrames);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: false
      });

      expect(result.resolution).toBe('Latest snapshot');
    });

    it('should set correct resolution for animated imagery', async () => {
      const mockFrames: ImageryFrame[] = Array.from({ length: 12 }, (_, i) => ({
        url: `https://example.com/frame${i}.png`,
        timestamp: new Date(),
        description: 'Test'
      }));
      mockGetPrecipitationRadar.mockResolvedValue(mockFrames);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: true
      });

      expect(result.resolution).toBe('12 frames');
    });

    it('should handle empty frames array', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: false
      });

      expect(result.frames).toEqual([]);
      expect(result.resolution).toBe('Latest snapshot');
    });

    it('should work with radar type (alias)', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'radar',
        animated: false
      });

      expect(result.type).toBe('radar');
      expect(result.source).toBe('RainViewer');
    });
  });

  describe('formatWeatherImageryResponse', () => {
    it('should format response with no frames', () => {
      const response: WeatherImageryResponse = {
        type: 'precipitation',
        location: { latitude: 40.7128, longitude: -74.006 },
        coverage: 'Global',
        resolution: 'Latest snapshot',
        source: 'RainViewer',
        animated: false,
        frames: [],
        generatedAt: new Date('2024-01-01T12:00:00Z'),
        disclaimer: 'Test disclaimer'
      };

      const formatted = formatWeatherImageryResponse(response);

      expect(formatted).toContain('# Weather Imagery');
      expect(formatted).toContain('**Location:** 40.7128, -74.0060');
      expect(formatted).toContain('**Type:** Precipitation');
      expect(formatted).toContain('**Coverage:** Global');
      expect(formatted).toContain('**Source:** RainViewer');
      expect(formatted).toContain('**Animated:** No');
      expect(formatted).toContain('## ⚠️ No Imagery Available');
    });

    it('should format response with single frame', () => {
      const response: WeatherImageryResponse = {
        type: 'precipitation',
        location: { latitude: 40.7128, longitude: -74.006 },
        coverage: 'Global',
        resolution: 'Latest snapshot',
        source: 'RainViewer',
        animated: false,
        frames: [
          {
            url: 'https://example.com/frame.png',
            timestamp: new Date('2024-01-01T12:00:00Z'),
            description: 'Precipitation radar'
          }
        ],
        generatedAt: new Date('2024-01-01T12:00:00Z')
      };

      const formatted = formatWeatherImageryResponse(response);

      expect(formatted).toContain('## 📸 Current Imagery');
      expect(formatted).toContain('**Timestamp:** 2024-01-01T12:00:00.000Z');
      expect(formatted).toContain('![Precipitation radar](https://example.com/frame.png)');
    });

    it('should format response with multiple frames (animated)', () => {
      const frames: ImageryFrame[] = Array.from({ length: 12 }, (_, i) => ({
        url: `https://example.com/frame${i}.png`,
        timestamp: new Date(`2024-01-01T${12 + i}:00:00Z`),
        description: `Frame ${i + 1}`
      }));

      const response: WeatherImageryResponse = {
        type: 'precipitation',
        location: { latitude: 40.7128, longitude: -74.006 },
        coverage: 'Global',
        resolution: '12 frames',
        source: 'RainViewer',
        animated: true,
        frames,
        generatedAt: new Date('2024-01-01T12:00:00Z')
      };

      const formatted = formatWeatherImageryResponse(response);

      expect(formatted).toContain('## 🎬 Animation Frames (12 frames)');
      expect(formatted).toContain('### Frame 1');
      expect(formatted).toContain('### Frame 7'); // Middle frame
      expect(formatted).toContain('### Frame 12'); // Last frame
      expect(formatted).toContain('*Showing 3 of 12 frames for brevity*');
    });

    it('should show all frames when 5 or fewer', () => {
      const frames: ImageryFrame[] = Array.from({ length: 5 }, (_, i) => ({
        url: `https://example.com/frame${i}.png`,
        timestamp: new Date(`2024-01-01T${12 + i}:00:00Z`),
        description: `Frame ${i + 1}`
      }));

      const response: WeatherImageryResponse = {
        type: 'precipitation',
        location: { latitude: 40.7128, longitude: -74.006 },
        coverage: 'Global',
        resolution: '5 frames',
        source: 'RainViewer',
        animated: true,
        frames,
        generatedAt: new Date('2024-01-01T12:00:00Z')
      };

      const formatted = formatWeatherImageryResponse(response);

      expect(formatted).toContain('### Frame 1');
      expect(formatted).toContain('### Frame 2');
      expect(formatted).toContain('### Frame 3');
      expect(formatted).toContain('### Frame 4');
      expect(formatted).toContain('### Frame 5');
      expect(formatted).not.toContain('Showing 3 of 5 frames');
    });

    it('should include disclaimer when present', () => {
      const response: WeatherImageryResponse = {
        type: 'precipitation',
        location: { latitude: 40.7128, longitude: -74.006 },
        coverage: 'Global',
        source: 'RainViewer',
        animated: false,
        frames: [],
        generatedAt: new Date(),
        disclaimer: 'This is a test disclaimer'
      };

      const formatted = formatWeatherImageryResponse(response);

      expect(formatted).toContain('⚠️ **DISCLAIMER:** This is a test disclaimer');
    });

    it('should not include disclaimer section when not present', () => {
      const response: WeatherImageryResponse = {
        type: 'precipitation',
        location: { latitude: 40.7128, longitude: -74.006 },
        coverage: 'Global',
        source: 'RainViewer',
        animated: false,
        frames: [],
        generatedAt: new Date()
      };

      const formatted = formatWeatherImageryResponse(response);

      expect(formatted).not.toContain('DISCLAIMER');
    });

    it('should capitalize imagery type', () => {
      const response: WeatherImageryResponse = {
        type: 'radar',
        location: { latitude: 40.7128, longitude: -74.006 },
        coverage: 'Global',
        source: 'RainViewer',
        animated: false,
        frames: [],
        generatedAt: new Date()
      };

      const formatted = formatWeatherImageryResponse(response);

      expect(formatted).toContain('**Type:** Radar');
    });

    it('should include generation timestamp', () => {
      const timestamp = new Date('2024-01-01T12:00:00Z');
      const response: WeatherImageryResponse = {
        type: 'precipitation',
        location: { latitude: 40.7128, longitude: -74.006 },
        coverage: 'Global',
        source: 'RainViewer',
        animated: false,
        frames: [],
        generatedAt: timestamp
      };

      const formatted = formatWeatherImageryResponse(response);

      expect(formatted).toContain('*Generated: 2024-01-01T12:00:00.000Z*');
      expect(formatted).toContain('*Data source: RainViewer*');
    });

    it('should include resolution when present', () => {
      const response: WeatherImageryResponse = {
        type: 'precipitation',
        location: { latitude: 40.7128, longitude: -74.006 },
        coverage: 'Global',
        resolution: '1024x768',
        source: 'RainViewer',
        animated: false,
        frames: [],
        generatedAt: new Date()
      };

      const formatted = formatWeatherImageryResponse(response);

      expect(formatted).toContain('**Resolution:** 1024x768');
    });

    it('should not include resolution when not present', () => {
      const response: WeatherImageryResponse = {
        type: 'precipitation',
        location: { latitude: 40.7128, longitude: -74.006 },
        coverage: 'Global',
        source: 'RainViewer',
        animated: false,
        frames: [],
        generatedAt: new Date()
      };

      const formatted = formatWeatherImageryResponse(response);

      // Check that Resolution line is not present (but other fields are)
      const lines = formatted.split('\n');
      const hasResolutionLine = lines.some(line => line.includes('**Resolution:**'));
      expect(hasResolutionLine).toBe(false);
    });
  });

  describe('Service Integration', () => {
    it('should pass coordinates to RainViewer service', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      await getWeatherImagery({
        latitude: 51.5074,
        longitude: -0.1278,
        type: 'precipitation',
        animated: false
      });

      expect(mockGetPrecipitationRadar).toHaveBeenCalledWith(51.5074, -0.1278, false);
    });

    it('should pass animated flag to RainViewer service', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: true
      });

      expect(mockGetPrecipitationRadar).toHaveBeenCalledWith(40.7128, -74.006, true);
    });

    it('should handle service returning frames', async () => {
      const frames: ImageryFrame[] = [
        {
          url: 'https://example.com/1.png',
          timestamp: new Date(),
          description: 'Frame 1'
        },
        {
          url: 'https://example.com/2.png',
          timestamp: new Date(),
          description: 'Frame 2'
        }
      ];
      mockGetPrecipitationRadar.mockResolvedValue(frames);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: true
      });

      expect(result.frames).toEqual(frames);
    });
  });

  describe('Edge Cases', () => {
    it('should handle boundary coordinates', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const result = await getWeatherImagery({
        latitude: 90,
        longitude: -180,
        type: 'precipitation',
        animated: false
      });

      expect(result).toBeDefined();
      expect(result.location.latitude).toBe(90);
      expect(result.location.longitude).toBe(-180);
    });

    it('should handle negative coordinates', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const result = await getWeatherImagery({
        latitude: -33.8688,
        longitude: 151.2093,
        type: 'precipitation',
        animated: false
      });

      expect(result).toBeDefined();
      expect(result.location.latitude).toBe(-33.8688);
      expect(result.location.longitude).toBe(151.2093);
    });

    it('should handle empty layers array', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: false,
        layers: []
      });

      expect(result).toBeDefined();
    });

    it('should handle exactly 10 layers', async () => {
      mockGetPrecipitationRadar.mockResolvedValue([]);

      const layers = Array.from({ length: 10 }, (_, i) => `layer${i}`);

      const result = await getWeatherImagery({
        latitude: 40.7128,
        longitude: -74.006,
        type: 'precipitation',
        animated: false,
        layers
      });

      expect(result).toBeDefined();
    });
  });
});
