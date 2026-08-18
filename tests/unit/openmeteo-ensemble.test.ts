import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import type {
  OpenMeteoEnsembleResponse,
  OpenMeteoForecastResponse,
  OpenMeteoModelComparisonResponse
} from '../../src/types/openmeteo.js';
import { CacheConfig } from '../../src/config/cache.js';
import { IMPERIAL_PREFERENCES, METRIC_PREFERENCES } from '../../src/config/units.js';
import { DataNotFoundError, InvalidLocationError } from '../../src/errors/ApiError.js';

/**
 * OpenMeteoService.getEnsembleSpread() — T2
 *
 * Mirrors the mocking approach used in tests/unit/openmeteo-model-comparison.test.ts:
 * spy on the private `makeRequestToEnsemble` method (per-instance) so no live
 * network calls are made and no module-level `vi.mock` is needed.
 */

const EXACT_MODELS_PARAM = 'ecmwf_ifs025';

const EXACT_DAILY_PARAM =
  'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max';

function buildValidEnsembleResponse(): OpenMeteoEnsembleResponse {
  return {
    latitude: 39.7392,
    longitude: -104.9903,
    elevation: 1609,
    timezone: 'America/Denver',
    timezone_abbreviation: 'MDT',
    utc_offset_seconds: -21600,
    daily: {
      time: ['2026-08-16', '2026-08-17'],
      weather_code: [1, 2],
      temperature_2m_max: [84, 82],
      temperature_2m_min: [62, 60],
      precipitation_sum: [0, 0.1],
      wind_speed_10m_max: [8, 10],
      weather_code_member01: [1, 2],
      temperature_2m_max_member01: [85, 83],
      temperature_2m_min_member01: [63, 61],
      precipitation_sum_member01: [0, 0.05],
      wind_speed_10m_max_member01: [9, 11]
    },
    daily_units: {
      time: 'iso8601',
      temperature_2m_max: '°F'
    }
  };
}

function buildEmptyTimeResponse(): OpenMeteoEnsembleResponse {
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

/** Shape 1 from the validator's doc comment: memberless plain-forecast shape — no `_memberNN` keys at all. */
function buildMemberlessResponse(): OpenMeteoEnsembleResponse {
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

/** Shape 2 from the validator's doc comment: multi-model renamed-suffix shape (verification h). */
function buildRenamedSuffixResponse(): OpenMeteoEnsembleResponse {
  return {
    latitude: 39.7392,
    longitude: -104.9903,
    elevation: 1609,
    timezone: 'America/Denver',
    timezone_abbreviation: 'MDT',
    utc_offset_seconds: -21600,
    daily: {
      time: ['2026-08-16'],
      temperature_2m_max_member01_ncep_gefs_seamless: [84]
    }
  };
}

describe('OpenMeteoService.getEnsembleSpread() — request params', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  it('sends the exact models param string (typo lock)', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToEnsemble')
      .mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.models).toBe(EXACT_MODELS_PARAM);
  });

  it('sends the exact five-variable daily list, in order, and never precipitation_probability_max', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToEnsemble')
      .mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.daily).toBe(EXACT_DAILY_PARAM);
    expect(String(params.daily)).not.toContain('precipitation_probability_max');
  });

  it('hits the ensemble host, not the forecast host', async () => {
    const spy = vi.spyOn((service as any).ensembleClient, 'get').mockResolvedValue({
      data: buildValidEnsembleResponse()
    });
    const forecastSpy = vi.spyOn((service as any).forecastClient, 'get');

    await service.getEnsembleSpread(39.7392, -104.9903);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/ensemble');
    expect(forecastSpy).not.toHaveBeenCalled();
    expect((service as any).ensembleClient.defaults.baseURL).toBe('https://ensemble-api.open-meteo.com/v1');
  });

  it('sends imperial unit params by default', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToEnsemble')
      .mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903, 7, IMPERIAL_PREFERENCES);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.temperature_unit).toBe('fahrenheit');
    expect(params.wind_speed_unit).toBe('mph');
    expect(params.precipitation_unit).toBe('inch');
  });

  it('sends metric unit params when metric prefs are passed', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToEnsemble')
      .mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903, 7, METRIC_PREFERENCES);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.temperature_unit).toBe('celsius');
    expect(params.wind_speed_unit).toBe('kmh');
    expect(params.precipitation_unit).toBe('mm');
  });

  it('honours forecast_days', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToEnsemble')
      .mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903, 16);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.forecast_days).toBe(16);
  });

  it('sends timezone=auto', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToEnsemble')
      .mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.timezone).toBe('auto');
  });

  it('defaults to 7 days when days is omitted', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToEnsemble')
      .mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.forecast_days).toBe(7);
  });

  it('rejects a days value outside 1-16', async () => {
    await expect(service.getEnsembleSpread(39.7392, -104.9903, 0)).rejects.toThrow(InvalidLocationError);
    await expect(service.getEnsembleSpread(39.7392, -104.9903, 17)).rejects.toThrow(InvalidLocationError);
  });

  it('validates coordinates', async () => {
    await expect(service.getEnsembleSpread(999, -104.9903)).rejects.toThrow();
    await expect(service.getEnsembleSpread(39.7392, 999)).rejects.toThrow();
  });
});

describe('OpenMeteoService.getEnsembleSpread() — cache', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  it('caches under the openmeteo-ensemble namespace, distinct from openmeteo-forecast and openmeteo-model-comparison', async () => {
    const setSpy = vi.spyOn((service as any).cache, 'set');
    vi.spyOn(service as any, 'makeRequestToEnsemble').mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const cacheKey = setSpy.mock.calls[0][0] as string;
    expect(cacheKey).toContain('openmeteo-ensemble');
    expect(cacheKey).not.toContain('openmeteo-forecast:');
    expect(cacheKey).not.toContain('openmeteo-model-comparison');
  });

  it('uses TTL equal to CacheConfig.ttl.forecast', async () => {
    const setSpy = vi.spyOn((service as any).cache, 'set');
    vi.spyOn(service as any, 'makeRequestToEnsemble').mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const ttl = setSpy.mock.calls[0][2] as number;
    expect(ttl).toBe(CacheConfig.ttl.forecast);
  });

  it('produces different cache keys for different unit preferences (unit signature participates in the key)', async () => {
    const setSpy = vi.spyOn((service as any).cache, 'set');
    vi.spyOn(service as any, 'makeRequestToEnsemble').mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903, 7, IMPERIAL_PREFERENCES);
    await service.getEnsembleSpread(39.7392, -104.9903, 7, METRIC_PREFERENCES);

    expect(setSpy).toHaveBeenCalledTimes(2);
    const key1 = setSpy.mock.calls[0][0] as string;
    const key2 = setSpy.mock.calls[1][0] as string;
    expect(key1).not.toBe(key2);
  });

  it('serves a cached response on a repeat call for the same coordinates/days/prefs', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToEnsemble')
      .mockResolvedValue(buildValidEnsembleResponse());

    await service.getEnsembleSpread(39.7392, -104.9903);
    await service.getEnsembleSpread(39.7392, -104.9903);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('OpenMeteoService.getEnsembleSpread() — validation', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  it('throws DataNotFoundError on empty daily.time', async () => {
    vi.spyOn(service as any, 'makeRequestToEnsemble').mockResolvedValue(buildEmptyTimeResponse());

    await expect(service.getEnsembleSpread(39.7392, -104.9903)).rejects.toThrow(DataNotFoundError);
  });

  it('throws DataNotFoundError on a memberless plain-forecast shape', async () => {
    vi.spyOn(service as any, 'makeRequestToEnsemble').mockResolvedValue(buildMemberlessResponse());

    await expect(service.getEnsembleSpread(39.7392, -104.9903)).rejects.toThrow(DataNotFoundError);
  });

  it('throws DataNotFoundError on the multi-model renamed-suffix shape', async () => {
    vi.spyOn(service as any, 'makeRequestToEnsemble').mockResolvedValue(buildRenamedSuffixResponse());

    await expect(service.getEnsembleSpread(39.7392, -104.9903)).rejects.toThrow(DataNotFoundError);
  });

  it('accepts a valid single-model ensemble response', async () => {
    vi.spyOn(service as any, 'makeRequestToEnsemble').mockResolvedValue(buildValidEnsembleResponse());

    const result = await service.getEnsembleSpread(39.7392, -104.9903);
    expect(result.daily.time).toEqual(['2026-08-16', '2026-08-17']);
  });
});

describe('OpenMeteoService.getEnsembleSpread() — no garnish retry on 400', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  it('propagates a 400 (InvalidLocationError) and calls the transport exactly once', async () => {
    const rejectedError = new InvalidLocationError('OpenMeteo', 'Invalid request parameters');
    const spy = vi
      .spyOn(service as any, 'makeRequestToEnsemble')
      .mockRejectedValueOnce(rejectedError);

    await expect(service.getEnsembleSpread(39.7392, -104.9903)).rejects.toBe(rejectedError);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('OpenMeteoService diff-lock — getForecast and getModelComparison unaffected by T2', () => {
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

  function buildValidComparisonResponse(): OpenMeteoModelComparisonResponse {
    return {
      latitude: 39.7392,
      longitude: -104.9903,
      elevation: 1609,
      timezone: 'America/Denver',
      timezone_abbreviation: 'MDT',
      utc_offset_seconds: -21600,
      daily: {
        time: ['2026-08-16'],
        weather_code_best_match: [1],
        temperature_2m_max_best_match: [84],
        temperature_2m_min_best_match: [62],
        precipitation_sum_best_match: [0],
        precipitation_probability_max_best_match: [10],
        wind_speed_10m_max_best_match: [8]
      }
    };
  }

  it('getForecast still requests exactly the original 19-variable daily list and the unedited cache key/TTL', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidForecastResponse());
    const setSpy = vi.spyOn((service as any).cache, 'set');

    await service.getForecast(39.7392, -104.9903, 7, false, IMPERIAL_PREFERENCES);

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

    expect(setSpy).toHaveBeenCalledTimes(1);
    const cacheKey = setSpy.mock.calls[0][0] as string;
    expect(cacheKey).toContain('openmeteo-forecast');
    expect(cacheKey).not.toContain('openmeteo-ensemble');
    const ttl = setSpy.mock.calls[0][2] as number;
    expect(ttl).toBe(2 * 60 * 60 * 1000);
  });

  it('getModelComparison still requests the exact six-model, six-variable params and the unedited cache key/TTL', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequestToForecast')
      .mockResolvedValue(buildValidComparisonResponse());
    const setSpy = vi.spyOn((service as any).cache, 'set');

    await service.getModelComparison(39.7392, -104.9903);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.models).toBe('best_match,gfs_seamless,ecmwf_ifs025,icon_seamless,gem_seamless,ukmo_seamless');
    expect(params.daily).toBe(
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max'
    );

    expect(setSpy).toHaveBeenCalledTimes(1);
    const cacheKey = setSpy.mock.calls[0][0] as string;
    expect(cacheKey).toContain('openmeteo-model-comparison');
    expect(cacheKey).not.toContain('openmeteo-ensemble');
    const ttl = setSpy.mock.calls[0][2] as number;
    expect(ttl).toBe(CacheConfig.ttl.forecast);
  });
});
