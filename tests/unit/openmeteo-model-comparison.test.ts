import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { OpenMeteoModelComparisonResponse, OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import { CacheConfig } from '../../src/config/cache.js';
import { IMPERIAL_PREFERENCES, METRIC_PREFERENCES } from '../../src/config/units.js';
import { DataNotFoundError, InvalidLocationError } from '../../src/errors/ApiError.js';

/**
 * OpenMeteoService.getModelComparison() — T2
 *
 * Mirrors the mocking approach used in tests/unit/openmeteo-fire-variables.test.ts:
 * spy on the private `makeRequestToForecast` method (per-instance) so no live
 * network calls are made and no module-level `vi.mock` is needed.
 */

const EXACT_MODELS_PARAM =
  'best_match,gfs_seamless,ecmwf_ifs025,icon_seamless,gem_seamless,ukmo_seamless';

const EXACT_DAILY_PARAM =
  'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,' +
  'precipitation_probability_max,wind_speed_10m_max';

function buildValidComparisonResponse(): OpenMeteoModelComparisonResponse {
  return {
    latitude: 39.7392,
    longitude: -104.9903,
    elevation: 1609,
    timezone: 'America/Denver',
    timezone_abbreviation: 'MDT',
    utc_offset_seconds: -21600,
    daily: {
      time: ['2026-08-16', '2026-08-17'],
      weather_code_best_match: [1, 2],
      temperature_2m_max_best_match: [84, 82],
      temperature_2m_min_best_match: [62, 60],
      precipitation_sum_best_match: [0, 0.1],
      precipitation_probability_max_best_match: [10, 30],
      wind_speed_10m_max_best_match: [8, 10],
      weather_code_gfs_seamless: [1, 3],
      temperature_2m_max_gfs_seamless: [85, 83],
      temperature_2m_min_gfs_seamless: [63, 61],
      precipitation_sum_gfs_seamless: [0, 0.05],
      precipitation_probability_max_gfs_seamless: [5, 25],
      wind_speed_10m_max_gfs_seamless: [9, 11]
    },
    daily_units: {
      time: 'iso8601',
      temperature_2m_max: '°F'
    }
  };
}

function buildEmptyTimeResponse(): OpenMeteoModelComparisonResponse {
  return {
    latitude: 39.7392,
    longitude: -104.9903,
    elevation: 1609,
    timezone: 'America/Denver',
    timezone_abbreviation: 'MDT',
    utc_offset_seconds: -21600,
    daily: {
      time: []
    }
  };
}

function buildUnsuffixedOnlyResponse(): OpenMeteoModelComparisonResponse {
  return {
    latitude: 39.7392,
    longitude: -104.9903,
    elevation: 1609,
    timezone: 'America/Denver',
    timezone_abbreviation: 'MDT',
    utc_offset_seconds: -21600,
    daily: {
      time: ['2026-08-16'],
      temperature_2m_max: [84]
    }
  };
}

describe('OpenMeteoService.getModelComparison() — request params', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  it('sends the exact models param string (D7 typo lock)', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.models).toBe(EXACT_MODELS_PARAM);
  });

  it('sends the exact six-variable daily list, in order', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.daily).toBe(EXACT_DAILY_PARAM);
  });

  it('sends imperial unit params by default', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903, 7, IMPERIAL_PREFERENCES);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.temperature_unit).toBe('fahrenheit');
    expect(params.wind_speed_unit).toBe('mph');
    expect(params.precipitation_unit).toBe('inch');
  });

  it('sends metric unit params when metric prefs are passed', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903, 7, METRIC_PREFERENCES);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.temperature_unit).toBe('celsius');
    expect(params.wind_speed_unit).toBe('kmh');
    expect(params.precipitation_unit).toBe('mm');
  });

  it('honours forecast_days', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903, 16);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.forecast_days).toBe(16);
  });

  it('sends timezone=auto', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.timezone).toBe('auto');
  });

  it('defaults to 7 days when days is omitted', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.forecast_days).toBe(7);
  });

  it('rejects a days value outside 1-16', async () => {
    await expect(service.getModelComparison(39.7392, -104.9903, 0)).rejects.toThrow(InvalidLocationError);
    await expect(service.getModelComparison(39.7392, -104.9903, 17)).rejects.toThrow(InvalidLocationError);
  });

  it('validates coordinates', async () => {
    await expect(service.getModelComparison(999, -104.9903)).rejects.toThrow();
    await expect(service.getModelComparison(39.7392, 999)).rejects.toThrow();
  });
});

describe('OpenMeteoService.getModelComparison() — cache', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  it('caches under the openmeteo-model-comparison namespace, distinct from openmeteo-forecast', async () => {
    const setSpy = vi.spyOn((service as any).cache, 'set');
    vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const cacheKey = setSpy.mock.calls[0][0] as string;
    expect(cacheKey).toContain('openmeteo-model-comparison');
    expect(cacheKey).not.toContain('openmeteo-forecast:');
  });

  it('uses TTL equal to CacheConfig.ttl.forecast', async () => {
    const setSpy = vi.spyOn((service as any).cache, 'set');
    vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const ttl = setSpy.mock.calls[0][2] as number;
    expect(ttl).toBe(CacheConfig.ttl.forecast);
  });

  it('produces different cache keys for different unit preferences', async () => {
    const setSpy = vi.spyOn((service as any).cache, 'set');
    vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903, 7, IMPERIAL_PREFERENCES);
    await service.getModelComparison(39.7392, -104.9903, 7, METRIC_PREFERENCES);

    expect(setSpy).toHaveBeenCalledTimes(2);
    const key1 = setSpy.mock.calls[0][0] as string;
    const key2 = setSpy.mock.calls[1][0] as string;
    expect(key1).not.toBe(key2);
  });

  it('serves a cached response on a repeat call for the same coordinates/days/prefs', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidComparisonResponse());

    await service.getModelComparison(39.7392, -104.9903);
    await service.getModelComparison(39.7392, -104.9903);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('OpenMeteoService.getModelComparison() — validation', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  it('throws DataNotFoundError on empty daily.time', async () => {
    vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue(buildEmptyTimeResponse());

    await expect(service.getModelComparison(39.7392, -104.9903)).rejects.toThrow(DataNotFoundError);
  });

  it('throws DataNotFoundError on a response carrying only unsuffixed keys', async () => {
    vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue(buildUnsuffixedOnlyResponse());

    await expect(service.getModelComparison(39.7392, -104.9903)).rejects.toThrow(DataNotFoundError);
  });

  it('accepts a valid multi-model response', async () => {
    vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue(buildValidComparisonResponse());

    const result = await service.getModelComparison(39.7392, -104.9903);
    expect(result.daily.time).toEqual(['2026-08-16', '2026-08-17']);
  });
});

describe('OpenMeteoService.getModelComparison() — no garnish retry on 400', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  it('propagates a 400 (InvalidLocationError) and calls the transport exactly once', async () => {
    const rejectedError = new InvalidLocationError('OpenMeteo', 'Invalid request parameters');
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockRejectedValueOnce(rejectedError);

    await expect(service.getModelComparison(39.7392, -104.9903)).rejects.toBe(rejectedError);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('OpenMeteoService.getForecast() — diff-lock (unaffected by T2)', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  function buildValidForecastResponse(): OpenMeteoForecastResponse {
    return {
      latitude: 39.7392,
      longitude: -104.9903,
      generationtime_ms: 0.1,
      utc_offset_seconds: -21600,
      timezone: 'America/Denver',
      timezone_abbreviation: 'MDT',
      elevation: 1609,
      daily: {
        time: ['2026-08-16'],
        temperature_2m_max: [84],
        temperature_2m_min: [62]
      }
    };
  }

  it('still requests exactly the original 19-variable daily list', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidForecastResponse());

    await service.getForecast(39.7392, -104.9903);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.daily).toBe(
      [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'apparent_temperature_max',
        'apparent_temperature_min',
        'sunrise',
        'sunset',
        'daylight_duration',
        'sunshine_duration',
        'uv_index_max',
        'precipitation_sum',
        'rain_sum',
        'showers_sum',
        'snowfall_sum',
        'precipitation_hours',
        'precipitation_probability_max',
        'wind_speed_10m_max',
        'wind_gusts_10m_max',
        'wind_direction_10m_dominant'
      ].join(',')
    );
    expect(params.models).toBeUndefined();
  });

  it('still caches under the openmeteo-forecast namespace with the unedited key shape', async () => {
    const setSpy = vi.spyOn((service as any).cache, 'set');
    vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue(buildValidForecastResponse());

    await service.getForecast(39.7392, -104.9903, 7, false, IMPERIAL_PREFERENCES);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const cacheKey = setSpy.mock.calls[0][0] as string;
    expect(cacheKey).toContain('openmeteo-forecast');
    expect(cacheKey).not.toContain('openmeteo-model-comparison');

    // getForecast's TTL is still the hardcoded 2h literal, not CacheConfig.ttl.forecast
    // by reference change — both happen to equal 2h today, so assert the literal value.
    const ttl = setSpy.mock.calls[0][2] as number;
    expect(ttl).toBe(2 * 60 * 60 * 1000);
  });
});
