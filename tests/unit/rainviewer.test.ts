/**
 * Unit tests for RainViewer service
 * Tests precipitation radar imagery retrieval and URL generation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RainViewerService } from '../../src/services/rainviewer.js';
import { RainViewerFrame } from '../../src/types/imagery.js';

describe('RainViewer Service', () => {
  let service: RainViewerService;

  beforeEach(() => {
    service = new RainViewerService();
  });

  describe('buildTileUrl', () => {
    it('should build valid tile URL with default parameters', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildTileUrl(frame);

      expect(url).toContain('tilecache.rainviewer.com');
      expect(url).toContain('/v2/radar/1699999999');
      expect(url).toContain('/512/4/'); // Default size and zoom
      expect(url).toContain('4/1_1.png'); // Color scheme and format
    });

    it('should build tile URL with custom size', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildTileUrl(frame, 256);

      expect(url).toContain('/256/');
    });

    it('should build tile URL with custom zoom', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildTileUrl(frame, 512, 6);

      expect(url).toContain('/512/6/');
      // Tile coordinates should change with zoom
      const centerX = Math.floor(2 ** (6 - 1));
      const centerY = Math.floor(2 ** (6 - 1));
      expect(url).toContain(`/${centerX}/${centerY}/`);
    });

    it('should calculate center tile coordinates correctly for zoom 4', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildTileUrl(frame, 512, 4);

      // For zoom 4, center should be 2^(4-1) = 8
      expect(url).toContain('/8/8/');
    });

    it('should calculate center tile coordinates correctly for zoom 1', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildTileUrl(frame, 512, 1);

      // For zoom 1, center should be 2^(1-1) = 1
      expect(url).toContain('/1/1/');
    });

    it('should handle different frame paths', () => {
      const frame: RainViewerFrame = {
        time: 1234567890,
        path: '/v2/radar/1234567890'
      };

      const url = service.buildTileUrl(frame);

      expect(url).toContain('/v2/radar/1234567890');
    });
  });

  describe('buildCoordinateTileUrl', () => {
    it('should build tile URL for New York coordinates', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildCoordinateTileUrl(frame, 40.7128, -74.006);

      expect(url).toContain('tilecache.rainviewer.com');
      expect(url).toContain('/v2/radar/1699999999');
      expect(url).toContain('/512/6/'); // Default zoom 6
    });

    it('should calculate correct tile coordinates for equator', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildCoordinateTileUrl(frame, 0, 0, 6);

      // At equator (0,0), tile coordinates should be at center
      // x = ((0 + 180) / 360) * 2^6 = (180/360) * 64 = 32
      // y should also be 32 at equator
      expect(url).toContain('/32/32/');
    });

    it('should handle positive longitude (East)', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildCoordinateTileUrl(frame, 0, 90, 6);

      // At lon=90, x = ((90 + 180) / 360) * 64 = 48
      expect(url).toContain('/48/');
    });

    it('should handle negative longitude (West)', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildCoordinateTileUrl(frame, 0, -90, 6);

      // At lon=-90, x = ((-90 + 180) / 360) * 64 = 16
      expect(url).toContain('/16/');
    });

    it('should handle northern latitude', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildCoordinateTileUrl(frame, 60, 0, 6);

      // Northern latitude should have smaller y coordinate
      const parts = url.split('/');
      const yIndex = parts.findIndex(p => p === '6') + 2; // After zoom and x
      const y = parseInt(parts[yIndex]);
      expect(y).toBeLessThan(32); // Less than equator y=32
    });

    it('should handle southern latitude', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildCoordinateTileUrl(frame, -60, 0, 6);

      // Southern latitude should have larger y coordinate
      const parts = url.split('/');
      const yIndex = parts.findIndex(p => p === '6') + 2;
      const y = parseInt(parts[yIndex]);
      expect(y).toBeGreaterThan(32); // Greater than equator y=32
    });

    it('should handle different zoom levels', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url4 = service.buildCoordinateTileUrl(frame, 40.7128, -74.006, 4);
      const url8 = service.buildCoordinateTileUrl(frame, 40.7128, -74.006, 8);

      expect(url4).toContain('/4/');
      expect(url8).toContain('/8/');

      // Extract tile coordinates
      const extract = (url: string) => {
        const parts = url.split('/');
        const zoomIdx = parts.findIndex(p => p === '4' || p === '8');
        return {
          x: parseInt(parts[zoomIdx + 1]),
          y: parseInt(parts[zoomIdx + 2])
        };
      };

      const coords4 = extract(url4);
      const coords8 = extract(url8);

      // Higher zoom should have larger coordinates
      expect(coords8.x).toBeGreaterThan(coords4.x);
      expect(coords8.y).toBeGreaterThan(coords4.y);
    });

    it('should handle extreme coordinates', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      // North pole
      const urlNorth = service.buildCoordinateTileUrl(frame, 85, 0, 6);
      expect(urlNorth).toBeDefined();
      expect(urlNorth).toContain('tilecache.rainviewer.com');

      // South pole
      const urlSouth = service.buildCoordinateTileUrl(frame, -85, 0, 6);
      expect(urlSouth).toBeDefined();
      expect(urlSouth).toContain('tilecache.rainviewer.com');

      // Date line
      const urlEast = service.buildCoordinateTileUrl(frame, 0, 179, 6);
      expect(urlEast).toBeDefined();
      expect(urlEast).toContain('tilecache.rainviewer.com');

      const urlWest = service.buildCoordinateTileUrl(frame, 0, -179, 6);
      expect(urlWest).toBeDefined();
      expect(urlWest).toContain('tilecache.rainviewer.com');
    });
  });

  describe('convertFrames', () => {
    it('should convert RainViewer frames to ImageryFrame format', () => {
      const frames: RainViewerFrame[] = [
        { time: 1699999999, path: '/v2/radar/1699999999' },
        { time: 1699999899, path: '/v2/radar/1699999899' }
      ];

      const converted = service.convertFrames(frames, 40.7128, -74.006);

      expect(converted.length).toBe(2);
      expect(converted[0].url).toContain('tilecache.rainviewer.com');
      expect(converted[0].timestamp).toBeInstanceOf(Date);
      expect(converted[0].description).toContain('Precipitation radar');
      expect(converted[0].description).toContain(new Date(1699999999 * 1000).toISOString());
    });

    it('should convert timestamps from Unix to Date objects', () => {
      const frames: RainViewerFrame[] = [
        { time: 1699999999, path: '/v2/radar/1699999999' }
      ];

      const converted = service.convertFrames(frames, 40.7128, -74.006);

      expect(converted[0].timestamp.getTime()).toBe(1699999999 * 1000);
    });

    it('should handle empty frame array', () => {
      const frames: RainViewerFrame[] = [];

      const converted = service.convertFrames(frames, 40.7128, -74.006);

      expect(converted).toEqual([]);
    });

    it('should handle single frame', () => {
      const frames: RainViewerFrame[] = [
        { time: 1699999999, path: '/v2/radar/1699999999' }
      ];

      const converted = service.convertFrames(frames, 40.7128, -74.006);

      expect(converted.length).toBe(1);
    });

    it('should handle multiple frames', () => {
      const frames: RainViewerFrame[] = Array.from({ length: 10 }, (_, i) => ({
        time: 1699999999 - i * 300,
        path: `/v2/radar/${1699999999 - i * 300}`
      }));

      const converted = service.convertFrames(frames, 40.7128, -74.006);

      expect(converted.length).toBe(10);
      converted.forEach((frame, i) => {
        expect(frame.url).toContain(frames[i].path);
        expect(frame.timestamp.getTime()).toBe(frames[i].time * 1000);
      });
    });

    it('should use coordinate-based tile URLs', () => {
      const frames: RainViewerFrame[] = [
        { time: 1699999999, path: '/v2/radar/1699999999' }
      ];

      const converted = service.convertFrames(frames, 51.5074, -0.1278);

      // Should contain coordinate-specific tile coordinates (not default center)
      expect(converted[0].url).toContain('tilecache.rainviewer.com');
      expect(converted[0].url).not.toContain('/8/8/'); // Not default center tiles
    });
  });

  describe('Tile Coordinate Calculations', () => {
    it('should produce consistent coordinates for same location', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url1 = service.buildCoordinateTileUrl(frame, 40.7128, -74.006, 6);
      const url2 = service.buildCoordinateTileUrl(frame, 40.7128, -74.006, 6);

      expect(url1).toBe(url2);
    });

    it('should produce different coordinates for different locations', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const urlNY = service.buildCoordinateTileUrl(frame, 40.7128, -74.006, 6);
      const urlLA = service.buildCoordinateTileUrl(frame, 34.0522, -118.2437, 6);

      expect(urlNY).not.toBe(urlLA);
    });

    it('should handle mercator projection edge cases', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      // Near poles where Mercator projection distorts
      const url = service.buildCoordinateTileUrl(frame, 85, 0, 6);

      // Should still produce valid URL
      expect(url).toContain('tilecache.rainviewer.com');
      expect(url).toMatch(/\/\d+\/\d+\//); // Should have numeric tile coordinates
    });

    it('should produce valid tile coordinates at zoom boundaries', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      // Test zoom levels from 1 to 10
      for (let zoom = 1; zoom <= 10; zoom++) {
        const url = service.buildCoordinateTileUrl(frame, 40.7128, -74.006, zoom);

        // Extract coordinates
        const parts = url.split('/');
        const zoomIdx = parts.findIndex(p => p === zoom.toString());
        const x = parseInt(parts[zoomIdx + 1]);
        const y = parseInt(parts[zoomIdx + 2]);

        // Coordinates should be within valid range for zoom level
        const maxTile = 2 ** zoom;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(maxTile);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(maxTile);
      }
    });
  });

  describe('URL Format Validation', () => {
    it('should produce URLs with correct structure', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildTileUrl(frame, 512, 4);

      // Should match pattern: host + path + size + zoom + x + y + scheme + format
      expect(url).toMatch(
        /^https:\/\/tilecache\.rainviewer\.com\/v2\/radar\/\d+\/\d+\/\d+\/\d+\/\d+\/4\/1_1\.png$/
      );
    });

    it('should include all required URL components', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildCoordinateTileUrl(frame, 40.7128, -74.006, 6);

      expect(url).toContain('https://');
      expect(url).toContain('tilecache.rainviewer.com');
      expect(url).toContain('/512/'); // Size
      expect(url).toContain('/6/'); // Zoom
      expect(url).toContain('/4/1_1.png'); // Color scheme and format
    });

    it('should handle frame paths with different formats', () => {
      const frames = [
        { time: 1699999999, path: '/v2/radar/1699999999' },
        { time: 1699999999, path: '/radar/1699999999' },
        { time: 1699999999, path: '/v3/radar/1699999999' }
      ];

      frames.forEach(frame => {
        const url = service.buildTileUrl(frame);
        expect(url).toContain(frame.path);
      });
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle large number of frame conversions efficiently', () => {
      const frames: RainViewerFrame[] = Array.from({ length: 100 }, (_, i) => ({
        time: 1699999999 - i * 300,
        path: `/v2/radar/${1699999999 - i * 300}`
      }));

      const start = Date.now();
      const converted = service.convertFrames(frames, 40.7128, -74.006);
      const duration = Date.now() - start;

      expect(converted.length).toBe(100);
      expect(duration).toBeLessThan(100); // Should be very fast
    });

    it('should handle rapid URL generation', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        service.buildCoordinateTileUrl(frame, 40.7128, -74.006, 6);
      }
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100); // 1000 URLs in < 100ms
    });

    it('should handle fractional coordinates', () => {
      const frame: RainViewerFrame = {
        time: 1699999999,
        path: '/v2/radar/1699999999'
      };

      const url = service.buildCoordinateTileUrl(frame, 40.7128456, -74.0060123, 6);

      expect(url).toBeDefined();
      expect(url).toContain('tilecache.rainviewer.com');
    });

    it('should handle very old timestamps', () => {
      const frame: RainViewerFrame = {
        time: 946684800, // Year 2000
        path: '/v2/radar/946684800'
      };

      const converted = service.convertFrames([frame], 40.7128, -74.006);

      expect(converted[0].timestamp.getUTCFullYear()).toBe(2000);
    });

    it('should handle very recent timestamps', () => {
      const now = Math.floor(Date.now() / 1000);
      const frame: RainViewerFrame = {
        time: now,
        path: `/v2/radar/${now}`
      };

      const converted = service.convertFrames([frame], 40.7128, -74.006);

      expect(converted[0].timestamp.getTime()).toBe(now * 1000);
    });
  });
});
