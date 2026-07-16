import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { DataNotFoundError } from '../../src/errors/ApiError.js';
import { IMPERIAL_PREFERENCES, METRIC_PREFERENCES } from '../../src/config/units.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';

/**
 * OpenMeteoService.getCurrentConditions() Tests
 *
 * Mirrors the mocking approach used in tests/integration/error-recovery.test.ts:
 * spy on the private `makeRequestToForecast` method so no live network calls are made.
 */

function buildValidResponse(): OpenMeteoForecastResponse {
  return {
    latitude: 37.7749,
    longitude: -122.4194,
    generationtime_ms: 0.1,
    utc_offset_seconds: -25200,
    timezone: 'America/Los_Angeles',
    timezone_abbreviation: 'PDT',
    elevation: 16,
    current_units: {
      time: 'iso8601',
      interval: 'seconds',
      temperature_2m: '°F'
    },
    current: {
      time: '2024-01-01T12:00',
      interval: 900,
      temperature_2m: 58.3,
      relative_humidity_2m: 62,
      apparent_temperature: 56.1,
      dew_point_2m: 45.2,
      is_day: 1,
      precipitation: 0,
      rain: 0,
      showers: 0,
      snowfall: 0,
      weather_code: 1,
      cloud_cover: 20,
      pressure_msl: 1015.2,
      wind_speed_10m: 8.5,
      wind_direction_10m: 270,
      wind_gusts_10m: 14.2
    },
    daily: {
      time: ['2024-01-01'],
      temperature_2m_max: [62],
      temperature_2m_min: [48]
    }
  };
}

describe('OpenMeteoService.getCurrentConditions()', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  describe('Parameter Building', () => {
    it('should build the correct current param list', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToForecast')
        .mockResolvedValue(buildValidResponse());

      await service.getCurrentConditions(37.7749, -122.4194);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.current).toBe(
        'temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,is_day,' +
        'precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,' +
        'wind_speed_10m,wind_direction_10m,wind_gusts_10m'
      );
    });

    it('should build the correct daily param list', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToForecast')
        .mockResolvedValue(buildValidResponse());

      await service.getCurrentConditions(37.7749, -122.4194);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.daily).toBe('temperature_2m_max,temperature_2m_min');
    });

    it('should set forecast_days to 1', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToForecast')
        .mockResolvedValue(buildValidResponse());

      await service.getCurrentConditions(37.7749, -122.4194);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.forecast_days).toBe(1);
    });

    it('should set timezone to auto', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToForecast')
        .mockResolvedValue(buildValidResponse());

      await service.getCurrentConditions(37.7749, -122.4194);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.timezone).toBe('auto');
    });

    it('should include latitude and longitude', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToForecast')
        .mockResolvedValue(buildValidResponse());

      await service.getCurrentConditions(37.7749, -122.4194);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.latitude).toBe(37.7749);
      expect(params.longitude).toBe(-122.4194);
    });

    it('should include imperial unit params by default', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToForecast')
        .mockResolvedValue(buildValidResponse());

      await service.getCurrentConditions(37.7749, -122.4194);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.temperature_unit).toBe('fahrenheit');
      expect(params.wind_speed_unit).toBe('mph');
      expect(params.precipitation_unit).toBe('inch');
    });

    it('should include metric unit params when metric preferences are passed', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToForecast')
        .mockResolvedValue(buildValidResponse());

      await service.getCurrentConditions(37.7749, -122.4194, METRIC_PREFERENCES);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.temperature_unit).toBe('celsius');
      expect(params.wind_speed_unit).toBe('kmh');
      expect(params.precipitation_unit).toBe('mm');
    });
  });

  describe('Coordinate Validation', () => {
    it('should reject invalid latitude', async () => {
      await expect(
        service.getCurrentConditions(91, -122.4194)
      ).rejects.toThrow(/Invalid latitude/i);
    });

    it('should reject invalid longitude', async () => {
      await expect(
        service.getCurrentConditions(37.7749, 181)
      ).rejects.toThrow(/Invalid longitude/i);
    });
  });

  describe('Cache Behavior', () => {
    it('should cache the response and avoid a second network call on cache hit', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToForecast')
        .mockResolvedValue(buildValidResponse());

      const first = await service.getCurrentConditions(37.7749, -122.4194);
      const second = await service.getCurrentConditions(37.7749, -122.4194);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('should keep imperial and metric cache entries distinct', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToForecast')
        .mockResolvedValue(buildValidResponse());

      await service.getCurrentConditions(37.7749, -122.4194, IMPERIAL_PREFERENCES);
      await service.getCurrentConditions(37.7749, -122.4194, METRIC_PREFERENCES);

      // Distinct unit signatures mean both requests should hit the network.
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should keep entries for distinct coordinates separate', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToForecast')
        .mockResolvedValue(buildValidResponse());

      await service.getCurrentConditions(37.7749, -122.4194);
      await service.getCurrentConditions(40.7128, -74.006);

      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Response Validation', () => {
    it('should throw DataNotFoundError when current block is missing', async () => {
      const response = buildValidResponse();
      delete (response as any).current;

      vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue(response);

      await expect(
        service.getCurrentConditions(37.7749, -122.4194)
      ).rejects.toThrow(DataNotFoundError);
    });

    it('should throw DataNotFoundError when current_units block is missing', async () => {
      const response = buildValidResponse();
      delete (response as any).current_units;

      vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue(response);

      await expect(
        service.getCurrentConditions(37.7749, -122.4194)
      ).rejects.toThrow(DataNotFoundError);
    });

    it('should resolve successfully for a well-formed response', async () => {
      const response = buildValidResponse();
      vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue(response);

      const result = await service.getCurrentConditions(37.7749, -122.4194);

      expect(result.current).toBeDefined();
      expect(result.current_units).toBeDefined();
      expect(result.current?.temperature_2m).toBe(58.3);
    });
  });
});
