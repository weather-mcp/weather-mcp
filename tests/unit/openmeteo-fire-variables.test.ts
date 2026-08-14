import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';

/**
 * OpenMeteoService.getCurrentConditions() — fire-weather variable tests
 *
 * Mirrors the mocking approach used in tests/unit/openmeteo-current.test.ts:
 * spy on the private `makeRequestToForecast` method (per-instance) so no live
 * network calls are made and no module-level `vi.mock` is needed.
 */

const NO_FIRE_CURRENT_PARAMS =
  'temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,is_day,' +
  'precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,' +
  'wind_speed_10m,wind_direction_10m,wind_gusts_10m';

const FIRE_CURRENT_PARAMS = `${NO_FIRE_CURRENT_PARAMS},soil_moisture_0_to_1cm,vapour_pressure_deficit`;

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

describe('OpenMeteoService.getCurrentConditions() — fire-weather variables', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  it('sends exactly today\'s current variable list when includeFireWeather is omitted', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidResponse());

    await service.getCurrentConditions(37.7749, -122.4194);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.current).toBe(NO_FIRE_CURRENT_PARAMS);
  });

  it('appends exactly the two fire-weather variables when includeFireWeather is true', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidResponse());

    await service.getCurrentConditions(37.7749, -122.4194, undefined, true);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.current).toBe(FIRE_CURRENT_PARAMS);
  });

  it('does not add unit params for the fire-weather variables', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidResponse());

    await service.getCurrentConditions(37.7749, -122.4194, undefined, true);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params).not.toHaveProperty('soil_moisture_0_to_1cm_unit');
    expect(params).not.toHaveProperty('vapour_pressure_deficit_unit');
  });

  it('produces two distinct HTTP requests for calls that differ only in the flag', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidResponse());

    await service.getCurrentConditions(37.7749, -122.4194, undefined, false);
    await service.getCurrentConditions(37.7749, -122.4194, undefined, true);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('still fetches for a flag call when a no-flag entry is already cached', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidResponse());

    // Prime the cache with a no-flag (non-fire) response.
    await service.getCurrentConditions(37.7749, -122.4194);
    expect(spy).toHaveBeenCalledTimes(1);

    // A repeat no-flag call should hit the cache, not the network.
    await service.getCurrentConditions(37.7749, -122.4194);
    expect(spy).toHaveBeenCalledTimes(1);

    // A fire-weather call for the same coordinates/prefs must still fetch.
    await service.getCurrentConditions(37.7749, -122.4194, undefined, true);
    expect(spy).toHaveBeenCalledTimes(2);

    const secondCallParams = spy.mock.calls[1][1] as Record<string, string | number>;
    expect(secondCallParams.current).toBe(FIRE_CURRENT_PARAMS);
  });
});
