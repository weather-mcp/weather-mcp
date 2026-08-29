import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { OpenMeteoHistoricalResponse } from '../../src/types/openmeteo.js';
import { CacheConfig } from '../../src/config/cache.js';
import { DataNotFoundError, RateLimitError, ServiceUnavailableError } from '../../src/errors/ApiError.js';

/**
 * OpenMeteoService.getClimateNormals() — full-year normals table (D1)
 *
 * Mirrors the mocking approach used in tests/unit/openmeteo-fire-variables.test.ts:
 * spy on the private `makeRequest` method (per-instance) so no live network
 * calls are made and no module-level `vi.mock` is needed.
 */

const NORMALS_DAILY_PARAMS = 'temperature_2m_max,temperature_2m_min,precipitation_sum';

/**
 * Build a synthetic full-year(ish) archive response. `entries` maps a
 * `"MM-DD"` key to the per-year samples for that calendar date (temp high/low
 * in °C, precipitation in mm). Each entry produces one `daily.time` row per
 * array element, dated against a distinct fabricated year so no date repeats.
 */
function buildArchiveFixture(
  entries: Record<string, { high: number[]; low: number[]; precip: number[] }>
): OpenMeteoHistoricalResponse {
  const time: string[] = [];
  const temperature_2m_max: number[] = [];
  const temperature_2m_min: number[] = [];
  const precipitation_sum: number[] = [];

  let year = 1991;
  for (const [monthDay, samples] of Object.entries(entries)) {
    const count = samples.high.length;
    for (let i = 0; i < count; i++) {
      time.push(`${year}-${monthDay}`);
      temperature_2m_max.push(samples.high[i]);
      temperature_2m_min.push(samples.low[i]);
      precipitation_sum.push(samples.precip[i]);
      year++;
    }
  }

  return {
    latitude: 39.0997,
    longitude: -94.5786,
    elevation: 268,
    timezone: 'UTC',
    timezone_abbreviation: 'UTC',
    generationtime_ms: 0.5,
    utc_offset_seconds: 0,
    daily: {
      time,
      temperature_2m_max,
      temperature_2m_min,
      precipitation_sum
    }
  };
}

/** 20 identical samples for "01-15" — comfortably clears the 15-sample minimum. */
function buildAvailableFixture(): OpenMeteoHistoricalResponse {
  const count = 20;
  return buildArchiveFixture({
    '01-15': {
      high: Array(count).fill(10), // 10°C
      low: Array(count).fill(0), // 0°C
      precip: Array(count).fill(5) // 5mm
    }
  });
}

/** All-null archive response — no `daily` arrays populated with real samples. */
function buildAllNullFixture(): OpenMeteoHistoricalResponse {
  return {
    latitude: 0,
    longitude: -160,
    elevation: 0,
    timezone: 'UTC',
    timezone_abbreviation: 'UTC',
    generationtime_ms: 0.5,
    utc_offset_seconds: 0,
    daily: {
      time: ['1991-01-15'],
      temperature_2m_max: [null],
      temperature_2m_min: [null],
      precipitation_sum: [null]
    }
  };
}

describe('OpenMeteoService.getClimateNormals() — full-year normals table (D1)', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  it('fetches the full 1991-2020 year with the three daily variables and UTC timezone', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequest')
      .mockResolvedValue(buildAvailableFixture());

    await service.getClimateNormals(39.0997, -94.5786, 1, 15);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, params] = spy.mock.calls[0] as [string, Record<string, string | number>];
    expect(url).toBe('/archive');
    expect(params.start_date).toBe('1991-01-01');
    expect(params.end_date).toBe('2020-12-31');
    expect(params.daily).toBe(NORMALS_DAILY_PARAMS);
    expect(params.timezone).toBe('UTC');
  });

  it('caches the table under getNormalsTableCacheKey with TTL from CacheConfig.ttl.normals', async () => {
    vi.spyOn(service as any, 'makeRequest').mockResolvedValue(buildAvailableFixture());
    const setSpy = vi.spyOn((service as any).cache, 'set');

    await service.getClimateNormals(39.0997, -94.5786, 1, 15);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const [key, , ttl] = setSpy.mock.calls[0];
    expect(key).toBe('normals-table:39.1:-94.58');
    expect(ttl).toBe(CacheConfig.ttl.normals);
  });

  it('makes zero additional transport calls for a second date at the same location', async () => {
    const spy = vi.spyOn(service as any, 'makeRequest').mockResolvedValue(buildAvailableFixture());

    const first = await service.getClimateNormals(39.0997, -94.5786, 1, 15);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.tempHigh).toBeCloseTo(50, 0); // 10°C -> 50°F
    expect(first.tempLow).toBeCloseTo(32, 0); // 0°C -> 32°F
    expect(first.source).toBe('Open-Meteo');
    expect(first.month).toBe(1);
    expect(first.day).toBe(15);

    // A different date, same location: table cache hit, no refetch.
    await expect(service.getClimateNormals(39.0997, -94.5786, 6, 30)).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);

    // Same date again: also a cache hit.
    const again = await service.getClimateNormals(39.0997, -94.5786, 1, 15);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(again).toEqual(first);
  });

  it('triggers a new fetch for a different location', async () => {
    const spy = vi.spyOn(service as any, 'makeRequest').mockResolvedValue(buildAvailableFixture());

    await service.getClimateNormals(39.0997, -94.5786, 1, 15);
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await service.getClimateNormals(35.6762, 139.6503, 1, 15);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(second.tempHigh).toBeCloseTo(50, 0);

    const secondParams = spy.mock.calls[1][1] as Record<string, string | number>;
    expect(secondParams.latitude).toBe(35.6762);
    expect(secondParams.longitude).toBe(139.6503);
  });

  it('throws DataNotFoundError when the requested slot is unavailable', async () => {
    // Fixture only populates 01-15; 07-04 has zero samples -> unavailable slot.
    vi.spyOn(service as any, 'makeRequest').mockResolvedValue(buildAvailableFixture());

    await expect(service.getClimateNormals(39.0997, -94.5786, 7, 4)).rejects.toThrow(
      DataNotFoundError
    );
  });

  it('caches the table on an all-null response and never refetches a second date there', async () => {
    const spy = vi.spyOn(service as any, 'makeRequest').mockResolvedValue(buildAllNullFixture());

    // Every slot is unavailable for an all-null response (open ocean).
    await expect(service.getClimateNormals(0, -160, 1, 15)).rejects.toThrow(DataNotFoundError);
    expect(spy).toHaveBeenCalledTimes(1);

    await expect(service.getClimateNormals(0, -160, 6, 30)).rejects.toThrow(DataNotFoundError);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

/**
 * In-flight dedupe + bounded 429 retry (D3).
 *
 * The dedupe scenario is real: `weatherSummaryHandler` spreads the caller's
 * args into every sub-handler, so `include_normals: true` fans out to the
 * forecast and current-conditions handlers concurrently for one location.
 *
 * The retry uses fake timers throughout — the suite stays deterministic and
 * fast, with no real 2s sleeps.
 */
describe('OpenMeteoService.getClimateNormals() — dedupe and 429 retry (D3)', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Two available slots, so concurrent callers can request different dates. */
  function buildTwoDateFixture(): OpenMeteoHistoricalResponse {
    return buildArchiveFixture({
      '01-15': {
        high: Array(20).fill(10), // 10°C -> 50°F
        low: Array(20).fill(0), // 0°C -> 32°F
        precip: Array(20).fill(5)
      },
      '06-30': {
        high: Array(20).fill(30), // 30°C -> 86°F
        low: Array(20).fill(20), // 20°C -> 68°F
        precip: Array(20).fill(1)
      }
    });
  }

  it('shares one archive pull between concurrent calls for the same location', async () => {
    const spy = vi.spyOn(service as any, 'makeRequest').mockResolvedValue(buildTwoDateFixture());

    // Started without awaiting in between — the second call must join the
    // first's in-flight pull rather than miss the not-yet-populated cache.
    const [winter, summer] = await Promise.all([
      service.getClimateNormals(39.0997, -94.5786, 1, 15),
      service.getClimateNormals(39.0997, -94.5786, 6, 30)
    ]);

    expect(spy).toHaveBeenCalledTimes(1);

    // Both resolve with their own date's values, not a shared one.
    expect(winter.tempHigh).toBeCloseTo(50, 0);
    expect(winter.day).toBe(15);
    expect(summer.tempHigh).toBeCloseTo(86, 0);
    expect(summer.day).toBe(30);
  });

  it('does not poison the in-flight map when a pull rejects', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequest')
      .mockRejectedValueOnce(new ServiceUnavailableError('OpenMeteo'))
      .mockResolvedValue(buildTwoDateFixture());

    await expect(service.getClimateNormals(39.0997, -94.5786, 1, 15)).rejects.toThrow(
      ServiceUnavailableError
    );
    expect(spy).toHaveBeenCalledTimes(1);

    // The rejected pull was never cached and left no map entry behind, so a
    // follow-up call fetches afresh rather than joining a dead promise.
    const retried = await service.getClimateNormals(39.0997, -94.5786, 1, 15);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(retried.tempHigh).toBeCloseTo(50, 0);
  });

  it('retries once after a 429 and resolves, with exactly two transport calls', async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(service as any, 'makeRequest')
      .mockRejectedValueOnce(new RateLimitError('OpenMeteo'))
      .mockResolvedValue(buildTwoDateFixture());

    const pending = service.getClimateNormals(39.0997, -94.5786, 1, 15);

    // Covers the 2s base plus the full jitter range.
    await vi.advanceTimersByTimeAsync(3000);

    const normals = await pending;
    expect(normals.tempHigh).toBeCloseTo(50, 0);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('propagates a second 429 after exactly two transport calls', async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(service as any, 'makeRequest')
      .mockRejectedValue(new RateLimitError('OpenMeteo'));

    const pending = service.getClimateNormals(39.0997, -94.5786, 1, 15);
    const assertion = expect(pending).rejects.toThrow(RateLimitError);

    await vi.advanceTimersByTimeAsync(3000);
    await assertion;

    // One retry is the whole budget — no third attempt.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-rate-limit error', async () => {
    const spy = vi
      .spyOn(service as any, 'makeRequest')
      .mockRejectedValue(new ServiceUnavailableError('OpenMeteo'));

    await expect(service.getClimateNormals(39.0997, -94.5786, 1, 15)).rejects.toThrow(
      ServiceUnavailableError
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
