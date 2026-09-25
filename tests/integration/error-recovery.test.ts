import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';

/**
 * Error Recovery Integration Tests
 *
 * These tests verify that services handle various error scenarios correctly:
 * - Validation of empty/invalid responses
 * - Helpful error messages for common issues
 * - Proper error propagation
 *
 * Note: Full retry logic testing requires complex axios mocking and is better
 * suited for end-to-end tests. These tests focus on error validation and messaging.
 */

describe('Error Recovery - OpenMeteo Service', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
  });

  describe('Response Validation', () => {
    it('should validate hourly response data and throw on empty response', async () => {
      // Mock the internal makeRequest method to return empty data
      vi.spyOn(service as any, 'makeRequest').mockResolvedValue({
        hourly: {
          time: [], // Empty data
          temperature_2m: []
        }
      });

      await expect(
        service.getHistoricalWeather(37.7749, -122.4194, '2024-01-01', '2024-01-02', true)
      ).rejects.toThrow(/No historical weather data available/i);
    });

    it('should validate daily response data and throw on empty response', async () => {
      vi.spyOn(service as any, 'makeRequest').mockResolvedValue({
        daily: {
          time: [],
          temperature_2m_max: []
        }
      });

      await expect(
        service.getHistoricalWeather(37.7749, -122.4194, '2024-01-01', '2024-01-02', false)
      ).rejects.toThrow(/No historical weather data available/i);
    });

    it('should throw error when hourly data structure is missing', async () => {
      vi.spyOn(service as any, 'makeRequest').mockResolvedValue({
        // Missing hourly property entirely
      });

      await expect(
        service.getHistoricalWeather(37.7749, -122.4194, '2024-01-01', '2024-01-02', true)
      ).rejects.toThrow(/No historical weather data available/i);
    });

    it('should throw error when daily data structure is missing', async () => {
      vi.spyOn(service as any, 'makeRequest').mockResolvedValue({
        // Missing daily property entirely
      });

      await expect(
        service.getHistoricalWeather(37.7749, -122.4194, '2024-01-01', '2024-01-02', false)
      ).rejects.toThrow(/No historical weather data available/i);
    });
  });

  describe('Error Messages', () => {
    it('should provide helpful error message about date limitations', async () => {
      vi.spyOn(service as any, 'makeRequest').mockResolvedValue({
        hourly: {
          time: [],
          temperature_2m: []
        }
      });

      try {
        await service.getHistoricalWeather(37.7749, -122.4194, '1900-01-01', '1900-01-02');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const errorMessage = (error as Error).message;

        // Should mention data limitations
        expect(errorMessage).toMatch(/No historical weather data available/i);
        expect(errorMessage).toMatch(/1900-01-01.*1900-01-02/);

        // Should provide helpful context
        expect(errorMessage).toMatch(/before 1940/i);
        expect(errorMessage).toMatch(/date range/i);
      }
    });

    it('should include date range in error message for clarity', async () => {
      vi.spyOn(service as any, 'makeRequest').mockResolvedValue({
        hourly: {
          time: [],
          temperature_2m: []
        }
      });

      try {
        await service.getHistoricalWeather(37.7749, -122.4194, '2024-11-01', '2024-11-05');
        expect.fail('Should have thrown an error');
      } catch (error) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).toContain('2024-11-01');
        expect(errorMessage).toContain('2024-11-05');
      }
    });
  });

  describe('Coordinate Validation', () => {
    it('should reject invalid latitude (too high)', async () => {
      await expect(
        service.getHistoricalWeather(91, -122.4194, '2024-01-01', '2024-01-02')
      ).rejects.toThrow(/Invalid latitude.*91.*between -90 and 90/i);
    });

    it('should reject invalid latitude (too low)', async () => {
      await expect(
        service.getHistoricalWeather(-91, -122.4194, '2024-01-01', '2024-01-02')
      ).rejects.toThrow(/Invalid latitude.*-91.*between -90 and 90/i);
    });

    it('should reject invalid longitude (too high)', async () => {
      await expect(
        service.getHistoricalWeather(37.7749, 181, '2024-01-01', '2024-01-02')
      ).rejects.toThrow(/Invalid longitude.*181.*between -180 and 180/i);
    });

    it('should reject invalid longitude (too low)', async () => {
      await expect(
        service.getHistoricalWeather(37.7749, -181, '2024-01-01', '2024-01-02')
      ).rejects.toThrow(/Invalid longitude.*-181.*between -180 and 180/i);
    });

    it('should accept valid coordinates at boundaries', async () => {
      vi.spyOn(service as any, 'makeRequest').mockResolvedValue({
        hourly: {
          time: ['2024-01-01T00:00'],
          temperature_2m: [20]
        }
      });

      // Should not throw for boundary values
      await expect(
        service.getHistoricalWeather(90, 180, '2024-01-01', '2024-01-02')
      ).resolves.toBeDefined();

      await expect(
        service.getHistoricalWeather(-90, -180, '2024-01-01', '2024-01-02')
      ).resolves.toBeDefined();
    });
  });

  describe('Parameter Building', () => {
    it('should build correct parameters for hourly data', async () => {
      const makeRequestSpy = vi.spyOn(service as any, 'makeRequest').mockResolvedValue({
        hourly: {
          time: ['2024-01-01T00:00'],
          temperature_2m: [20]
        }
      });

      await service.getHistoricalWeather(37.7749, -122.4194, '2024-01-01', '2024-01-02', true);

      expect(makeRequestSpy).toHaveBeenCalledWith('/archive', expect.objectContaining({
        latitude: 37.7749,
        longitude: -122.4194,
        start_date: '2024-01-01',
        end_date: '2024-01-02',
        temperature_unit: 'fahrenheit',
        wind_speed_unit: 'mph',
        precipitation_unit: 'inch',
        timezone: 'auto'
      }));

      const params = makeRequestSpy.mock.calls[0][1];
      expect(params.hourly).toBeDefined();
      expect(params.hourly).toContain('temperature_2m');
      expect(params.hourly).toContain('wind_speed_10m');
    });

    it('should build correct parameters for daily data', async () => {
      const makeRequestSpy = vi.spyOn(service as any, 'makeRequest').mockResolvedValue({
        daily: {
          time: ['2024-01-01'],
          temperature_2m_max: [25]
        }
      });

      await service.getHistoricalWeather(37.7749, -122.4194, '2024-01-01', '2024-01-02', false);

      const params = makeRequestSpy.mock.calls[0][1];
      expect(params.daily).toBeDefined();
      expect(params.daily).toContain('temperature_2m_max');
      expect(params.daily).toContain('temperature_2m_min');
      expect(params.hourly).toBeUndefined();
    });
  });
});

/**
 * Documentation for actual retry behavior:
 *
 * The NOAA service implements retry logic with exponential backoff:
 * - Retries on: 429 (rate limit), 500+ (server errors), timeout errors
 * - Does NOT retry on: 400, 401, 403, 404 (client errors)
 * - Exponential backoff: 2^retry * 1000ms (1s, 2s, 4s, ...)
 * - Default max retries: 3
 *
 * This logic is tested indirectly through:
 * 1. Manual testing with real API calls
 * 2. The error handling code review in CODE_REVIEW.md
 * 3. These integration tests which verify error messaging and validation
 *
 * To manually test retry behavior:
 * 1. Use a tool like mitmproxy to intercept and modify API responses
 * 2. Trigger rate limits by making many rapid requests
 * 3. Monitor the logs to see retry attempts with exponential backoff
 */
