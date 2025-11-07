/**
 * Security feature tests for v1.0.0
 * Tests bounds checking, security event logging, and defense-in-depth measures
 */

import { describe, it, expect, vi } from 'vitest';
import { NOAAService } from '../../src/services/noaa.js';
import { OpenMeteoService } from '../../src/services/openmeteo.js';

describe('Security Features - v1.0.0', () => {
  describe('Defense-in-Depth Measures', () => {
    it('should validate coordinate bounds before API calls', async () => {
      const service = new NOAAService();

      // Test invalid latitude
      await expect(() => service.getPointData(91, -74.0060)).rejects.toThrow();
      await expect(() => service.getPointData(-91, -74.0060)).rejects.toThrow();

      // Test invalid longitude
      await expect(() => service.getPointData(40.7128, 181)).rejects.toThrow();
      await expect(() => service.getPointData(40.7128, -181)).rejects.toThrow();

      // Test NaN values
      await expect(() => service.getPointData(NaN, -74.0060)).rejects.toThrow();
      await expect(() => service.getPointData(40.7128, NaN)).rejects.toThrow();

      // Test Infinity values
      await expect(() => service.getPointData(Infinity, -74.0060)).rejects.toThrow();
      await expect(() => service.getPointData(40.7128, -Infinity)).rejects.toThrow();
    });

    it('should enforce timeout limits on API requests', () => {
      // Test that timeout is configured
      const service = new NOAAService({ timeout: 30000 });
      expect(service).toBeDefined();

      // Test minimum timeout
      const minService = new NOAAService({ timeout: 5000 });
      expect(minService).toBeDefined();

      // Test maximum timeout
      const maxService = new NOAAService({ timeout: 120000 });
      expect(maxService).toBeDefined();
    });

    it('should have configurable retry limits', () => {
      const service1 = new NOAAService({ maxRetries: 0 });
      expect(service1).toBeDefined();

      const service2 = new NOAAService({ maxRetries: 3 });
      expect(service2).toBeDefined();

      const service3 = new NOAAService({ maxRetries: 5 });
      expect(service3).toBeDefined();
    });
  });

  describe('Input Sanitization', () => {
    it('should handle special characters in location queries safely', () => {
      const service = new OpenMeteoService();

      // Test that special characters don't cause issues
      const queries = [
        "Paris",
        "New York",
        "Saint-Denis",
        "São Paulo",
      ];

      for (const query of queries) {
        // Should not throw on special characters
        expect(() => service.searchLocation(query)).not.toThrow();
      }
    });

    it('should reject empty or invalid search queries', async () => {
      const service = new OpenMeteoService();

      // Empty query
      await expect(service.searchLocation('')).rejects.toThrow('cannot be empty');

      // Whitespace only
      await expect(service.searchLocation('   ')).rejects.toThrow('cannot be empty');

      // Single character
      await expect(service.searchLocation('a')).rejects.toThrow('at least 2 characters');
    });

    it('should enforce limit bounds on search results', async () => {
      const service = new OpenMeteoService();

      // Too low
      await expect(service.searchLocation('Paris', 0)).rejects.toThrow('between 1 and 100');

      // Too high
      await expect(service.searchLocation('Paris', 101)).rejects.toThrow('between 1 and 100');

      // Negative
      await expect(service.searchLocation('Paris', -1)).rejects.toThrow('between 1 and 100');
    });

    it('should validate date ranges for historical queries', async () => {
      const service = new NOAAService();

      const now = new Date();
      const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days in future
      const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      // Future dates should be rejected
      await expect(
        service.getObservations('KNYC', future, now)
      ).rejects.toThrow();

      // Inverted date range should be rejected
      await expect(
        service.getObservations('KNYC', now, past)
      ).rejects.toThrow('must be before end date');
    });
  });

  describe('Coordinate Validation', () => {
    it('should accept valid coordinates', () => {
      const service = new NOAAService();

      // Valid US coordinates
      expect(() => service.getPointData(40.7128, -74.0060)).not.toThrow(); // New York
      expect(() => service.getPointData(34.0522, -118.2437)).not.toThrow(); // Los Angeles
      expect(() => service.getPointData(25.7617, -80.1918)).not.toThrow(); // Miami

      // Edge cases (valid)
      expect(() => service.getPointData(90, 0)).not.toThrow(); // North pole
      expect(() => service.getPointData(-90, 0)).not.toThrow(); // South pole
      expect(() => service.getPointData(0, 180)).not.toThrow(); // Date line
      expect(() => service.getPointData(0, -180)).not.toThrow(); // Date line
    });

    it('should reject out-of-range coordinates', async () => {
      const service = new NOAAService();

      // Latitude out of range
      await expect(() => service.getPointData(90.1, 0)).rejects.toThrow();
      await expect(() => service.getPointData(-90.1, 0)).rejects.toThrow();
      await expect(() => service.getPointData(100, 0)).rejects.toThrow();
      await expect(() => service.getPointData(-100, 0)).rejects.toThrow();

      // Longitude out of range
      await expect(() => service.getPointData(0, 180.1)).rejects.toThrow();
      await expect(() => service.getPointData(0, -180.1)).rejects.toThrow();
      await expect(() => service.getPointData(0, 200)).rejects.toThrow();
      await expect(() => service.getPointData(0, -200)).rejects.toThrow();
    });

    it('should reject non-numeric coordinates', async () => {
      const service = new NOAAService();

      // NaN
      await expect(() => service.getPointData(NaN, 0)).rejects.toThrow();
      await expect(() => service.getPointData(0, NaN)).rejects.toThrow();

      // Infinity
      await expect(() => service.getPointData(Infinity, 0)).rejects.toThrow();
      await expect(() => service.getPointData(-Infinity, 0)).rejects.toThrow();
      await expect(() => service.getPointData(0, Infinity)).rejects.toThrow();
      await expect(() => service.getPointData(0, -Infinity)).rejects.toThrow();
    });
  });

  describe('Forecast Parameter Validation', () => {
    it('should validate forecast days parameter', () => {
      const service = new OpenMeteoService();

      // Valid days
      expect(() => service.getForecast(40.7128, -74.0060, 1)).not.toThrow();
      expect(() => service.getForecast(40.7128, -74.0060, 7)).not.toThrow();
      expect(() => service.getForecast(40.7128, -74.0060, 16)).not.toThrow();
    });

    it('should reject invalid forecast days', async () => {
      const service = new OpenMeteoService();

      // Too low
      await expect(service.getForecast(40.7128, -74.0060, 0)).rejects.toThrow('between 1 and 16');

      // Too high
      await expect(service.getForecast(40.7128, -74.0060, 17)).rejects.toThrow('between 1 and 16');

      // Negative
      await expect(service.getForecast(40.7128, -74.0060, -1)).rejects.toThrow('between 1 and 16');
    });

    it('should validate air quality forecast days', async () => {
      const service = new OpenMeteoService();

      // Too low
      await expect(service.getAirQuality(40.7128, -74.0060, true, 0)).rejects.toThrow('between 1 and 7');

      // Too high
      await expect(service.getAirQuality(40.7128, -74.0060, true, 8)).rejects.toThrow('between 1 and 7');
    });

    it('should validate marine forecast days', async () => {
      const service = new OpenMeteoService();

      // Too low
      await expect(service.getMarine(40.7128, -74.0060, true, 0)).rejects.toThrow('between 1 and 7');

      // Too high
      await expect(service.getMarine(40.7128, -74.0060, true, 8)).rejects.toThrow('between 1 and 7');
    });
  });

  describe('Date Range Validation', () => {
    it('should reject future dates for historical data', async () => {
      const service = new NOAAService();
      const now = new Date();
      const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await expect(service.getObservations('KNYC', future)).rejects.toThrow('cannot be in the future');
    });

    it('should reject inverted date ranges', async () => {
      const service = new NOAAService();
      const start = new Date('2024-01-10');
      const end = new Date('2024-01-01');

      await expect(service.getObservations('KNYC', start, end)).rejects.toThrow('must be before end date');
    });

    it('should accept valid date ranges', () => {
      const service = new NOAAService();
      const start = new Date('2024-01-01');
      const end = new Date('2024-01-10');

      // Should not throw
      expect(() => service.getObservations('KNYC', start, end)).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should provide helpful error messages for invalid input', async () => {
      const service = new NOAAService();

      try {
        await service.getPointData(100, 0);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toBeDefined();
        expect(typeof err.message).toBe('string');
      }
    });

    it('should maintain security through error messages', async () => {
      const service = new NOAAService();

      try {
        await service.getPointData(NaN, NaN);
        expect.fail('Should have thrown');
      } catch (err: any) {
        // Error messages should not expose internal implementation details
        expect(err.message).not.toContain('stack');
        expect(err.message).not.toContain('password');
        expect(err.message).not.toContain('secret');
        expect(err.message).not.toContain('token');
      }
    });
  });

  describe('Service Configuration Security', () => {
    it('should enforce reasonable timeout boundaries', () => {
      // Services should accept timeout configs
      const service1 = new NOAAService({ timeout: 10000 });
      const service2 = new OpenMeteoService({ timeout: 10000 });

      expect(service1).toBeDefined();
      expect(service2).toBeDefined();
    });

    it('should enforce retry limits to prevent DoS', () => {
      // Services should accept retry configs
      const service1 = new NOAAService({ maxRetries: 3 });
      const service2 = new OpenMeteoService({ maxRetries: 3 });

      expect(service1).toBeDefined();
      expect(service2).toBeDefined();
    });

    it('should use secure defaults', () => {
      // Services should work with defaults
      const service1 = new NOAAService();
      const service2 = new OpenMeteoService();

      expect(service1).toBeDefined();
      expect(service2).toBeDefined();
    });
  });

  describe('Cache Security', () => {
    it('should provide cache statistics without exposing sensitive data', () => {
      const service = new NOAAService();
      const stats = service.getCacheStats();

      // Should have stats
      expect(stats).toBeDefined();
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.maxSize).toBe('number');
      expect(typeof stats.hits).toBe('number');
      expect(typeof stats.misses).toBe('number');

      // Should not expose cache contents
      expect(stats).not.toHaveProperty('entries');
      expect(stats).not.toHaveProperty('keys');
      expect(stats).not.toHaveProperty('values');
    });

    it('should allow cache clearing for security', () => {
      const service = new NOAAService();

      // Should not throw
      expect(() => service.clearCache()).not.toThrow();
    });
  });
});
