/**
 * Unit tests for `MetnoService` (`src/services/metno.ts`), the keyless MET
 * Norway Locationforecast client reached only as an outage fallback when
 * Open-Meteo fails transiently on a non-US `get_forecast`.
 *
 * Mocking follows the `jma-service.test.ts` / `environment-agency-service.test.ts`
 * scaffold: a hoisted `mockGet`, and `vi.mock('axios', ...)` exposing only
 * `default.create`. Confirmed by reading `src/services/metno.ts` in full:
 * it installs no response interceptor (no `.interceptors` reference anywhere
 * in the file), so a bare `{ get }` double is sufficient — anything richer
 * would be mocking a seam the code never calls (G70).
 *
 * **No test in this file may reach the network.** The clock is injected via
 * `MetnoServiceConfig.now` rather than faked with `vi.useFakeTimers()` —
 * the service takes an injectable `now` for exactly this, and every test
 * below uses it instead of touching the real clock.
 *
 * **What this suite cannot see (G72).** Every assertion here runs against a
 * mocked transport: an upstream that answers 200 with correctly-shaped,
 * internally-consistent JSON it has simply stopped updating passes every
 * check in this file, because the mock never contacts api.met.no at all.
 * That failure mode — a frozen-but-well-formed feed — is out of scope for a
 * unit suite by construction; it is what the live-verification task (and a
 * positive-control sweep against a sibling met.no endpoint) is for, not this
 * file. A comment claiming coverage of it here would be a lie about what a
 * mocked-transport test can prove.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn()
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: (...args: unknown[]) => mockGet(...args)
    }))
  }
}));

import axios from 'axios';
import { MetnoService } from '../../src/services/metno.js';
import { ApiError } from '../../src/errors/ApiError.js';
import { Cache } from '../../src/utils/cache.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import type { MetnoForecastResponse, MetnoTimeseriesEntry } from '../../src/types/metno.js';

const HOUR_MS = 3_600_000;
const FRESHNESS_MS = CacheConfig.ttl.forecast; // 2h — the freshness clock this service reuses
const TZ = 'Europe/Oslo';

/** Reach the service's private in-flight map the way this repo's other service tests reach private state. */
function inFlightOf(service: MetnoService): Map<string, Promise<unknown>> {
  return (service as unknown as { inFlight: Map<string, Promise<unknown>> }).inFlight;
}

function isoAtOffset(startIso: string, hours: number): string {
  return new Date(Date.parse(startIso) + hours * HOUR_MS).toISOString().replace('.000Z', 'Z');
}

/**
 * A small met.no-shaped `timeseries`: hourly entries (carrying both
 * `next_1_hours` and `next_6_hours`, exactly as the live product does) up to
 * a seam, then a step onto the 6-hourly grid, then 6-hourly entries, then a
 * final entry with only an instant reading and no `next_*` block at all
 * (D3's degenerate-final-entry shape). Mirrors the `buildSeries` helper in
 * `tests/unit/metno-parse.test.ts` (not imported from it, per instructions).
 *
 * Four days (96h) is comfortably enough for `aggregateMetnoDaily` to return
 * at least one complete day after it drops the trailing partial one.
 */
function buildTimeseries(
  startIso: string,
  seamHours = 48,
  totalHours = 96,
  tempBase = 10
): MetnoTimeseriesEntry[] {
  const entries: MetnoTimeseriesEntry[] = [];

  const pushEntry = (offset: number, step: 1 | 6 | 0): void => {
    const hourOfDay = offset % 24;
    const entry: MetnoTimeseriesEntry = {
      time: isoAtOffset(startIso, offset),
      data: {
        instant: {
          details: {
            air_temperature: tempBase + hourOfDay,
            wind_speed: 3,
            wind_from_direction: 200
          }
        }
      }
    };
    if (step === 1) {
      entry.data!.next_1_hours = {
        summary: { symbol_code: 'clearsky_day' },
        details: { precipitation_amount: 0, probability_of_precipitation: 5, probability_of_thunder: 0 }
      };
      entry.data!.next_6_hours = {
        summary: { symbol_code: 'clearsky_day' },
        details: {
          air_temperature_max: tempBase + hourOfDay + 2,
          air_temperature_min: tempBase + hourOfDay - 2,
          precipitation_amount: 0.2,
          probability_of_precipitation: 10
        }
      };
    } else if (step === 6) {
      entry.data!.next_6_hours = {
        summary: { symbol_code: 'cloudy' },
        details: {
          air_temperature_max: tempBase + hourOfDay + 2,
          air_temperature_min: tempBase + hourOfDay - 2,
          precipitation_amount: 0.3,
          probability_of_precipitation: 20
        }
      };
    }
    // step === 0: the final entry — no aggregation window at all (D3).
    entries.push(entry);
  };

  let offset = 0;
  while (offset <= seamHours) {
    pushEntry(offset, 1);
    offset += 1;
  }
  // Align onto met.no's 6-hourly grid beyond the seam, as the live series does.
  while (offset % 6 !== 0) offset += 1;
  while (offset < totalHours) {
    pushEntry(offset, 6);
    offset += 6;
  }
  // The final entry: an instant reading and no `next_*` block at all (D3).
  pushEntry(offset, 0);

  return entries;
}

function buildBody(startIso = '2026-09-11T00:00:00Z', tempBase = 10): MetnoForecastResponse {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10.7522, 59.9139] },
    properties: {
      meta: { updated_at: startIso },
      timeseries: buildTimeseries(startIso, 48, 96, tempBase)
    }
  };
}

function okResponse(body: MetnoForecastResponse = buildBody(), lastModified = 'Fri, 11 Sep 2026 00:00:00 GMT') {
  return Promise.resolve({
    status: 200,
    data: body,
    headers: { 'last-modified': lastModified }
  });
}

function notModifiedResponse() {
  return Promise.resolve({ status: 304, data: '', headers: {} });
}

describe('MetnoService', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGet.mockReset();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  function makeService(now: () => number): MetnoService {
    return new MetnoService({ now });
  }

  // ------------------------------------------------------------------
  // 1: User-Agent — identifying, and not the bare shared helper's form
  // ------------------------------------------------------------------
  describe('User-Agent', () => {
    it('uses a descriptive User-Agent following the METAR/basemap precedent', () => {
      makeService(() => Date.now());

      const createMock = axios.create as unknown as { mock: { calls: unknown[][] } };
      const config = createMock.mock.calls[createMock.mock.calls.length - 1][0] as {
        headers?: Record<string, string>;
      };
      const userAgent = config.headers?.['User-Agent'];
      expect(userAgent).toMatch(
        /^weather-mcp\/.+\(\+https:\/\/github\.com\/weather-mcp\/weather-mcp\)$/
      );
      // The regression this pins: the shared getUserAgent() helper returns a
      // bare `weather-mcp/<version>` with no contact information at all,
      // which would silently breach met.no's ToS ("if we cannot contact you
      // in case of problems, you risk being blocked without warning").
      expect(userAgent).not.toMatch(/^weather-mcp\/[^ ]+$/);
    });
  });

  // ------------------------------------------------------------------
  // 2: coordinate truncation to 4 decimals, and shared cache/request
  // ------------------------------------------------------------------
  describe('coordinate truncation', () => {
    it('sends coordinates truncated to 4 decimals', async () => {
      mockGet.mockImplementation(() => okResponse());
      const service = makeService(() => Date.parse('2026-09-11T00:00:00Z'));

      await service.getForecast(59.913868, 10.752245, TZ);

      expect(mockGet).toHaveBeenCalledTimes(1);
      const [, config] = mockGet.mock.calls[0] as [string, { params?: Record<string, number> }];
      expect(config.params).toEqual({ lat: 59.9139, lon: 10.7522 });
    });

    it('two requests differing only in the 6th decimal make one upstream call and share one cache entry', async () => {
      mockGet.mockImplementation(() => okResponse());
      const service = makeService(() => Date.parse('2026-09-11T00:00:00Z'));

      const a = await service.getForecast(59.913868, 10.752245, TZ);
      const b = await service.getForecast(59.9138681, 10.7522451, TZ);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(b).toBe(a);
    });
  });

  // ------------------------------------------------------------------
  // 3: the two clocks — freshness (no request) vs revalidation (conditional)
  // ------------------------------------------------------------------
  describe('freshness and revalidation clocks', () => {
    it('serves from cache with zero requests inside the freshness window, then revalidates conditionally past it', async () => {
      let now = Date.parse('2026-09-11T00:00:00Z');
      mockGet.mockImplementation(() => okResponse(buildBody(), 'Fri, 11 Sep 2026 00:00:00 GMT'));
      const service = makeService(() => now);

      await service.getForecast(59.9139, 10.7522, TZ);
      expect(mockGet).toHaveBeenCalledTimes(1);

      // Inside the freshness window (2h): no new request at all.
      now += FRESHNESS_MS - 1;
      await service.getForecast(59.9139, 10.7522, TZ);
      expect(mockGet).toHaveBeenCalledTimes(1);

      // Past the freshness window: exactly one new request, carrying the
      // exact Last-Modified value from the first response as If-Modified-Since.
      mockGet.mockImplementation(() => notModifiedResponse());
      now += 2;
      await service.getForecast(59.9139, 10.7522, TZ);
      expect(mockGet).toHaveBeenCalledTimes(2);
      const [, config] = mockGet.mock.calls[1] as [string, { headers?: Record<string, string> }];
      expect(config.headers?.['If-Modified-Since']).toBe('Fri, 11 Sep 2026 00:00:00 GMT');
    });
  });

  // ------------------------------------------------------------------
  // 4: a 304 reuses the aggregate — object identity, aggregator ran once
  // ------------------------------------------------------------------
  describe('304 revalidation reuses the cached aggregate', () => {
    it('returns the identical aggregate object on a warm-cache 304, having called get twice and aggregated once', async () => {
      let now = Date.parse('2026-09-11T00:00:00Z');
      mockGet.mockImplementationOnce(() => okResponse());
      const service = makeService(() => now);

      const first = await service.getForecast(59.9139, 10.7522, TZ);

      mockGet.mockImplementationOnce(() => notModifiedResponse());
      now += FRESHNESS_MS + 1;
      const second = await service.getForecast(59.9139, 10.7522, TZ);

      expect(mockGet).toHaveBeenCalledTimes(2);
      // Object identity, not deep equality: the aggregator must not have run
      // a second time off an empty 304 body.
      expect(second).toBe(first);
    });
  });

  // ------------------------------------------------------------------
  // 5: a cold-cache 304 throws (v1.27.1 regression)
  // ------------------------------------------------------------------
  describe('cold-cache 304', () => {
    it('throws a fixed message rather than silently becoming an empty result — the v1.27.1 bug this line exists to prevent', async () => {
      mockGet.mockImplementation(() => notModifiedResponse());
      const service = makeService(() => Date.parse('2026-09-11T00:00:00Z'));

      await expect(service.getForecast(59.9139, 10.7522, TZ)).rejects.toThrow(
        'MET Norway forecast revalidation returned no content'
      );
    });
  });

  // ------------------------------------------------------------------
  // 6: 403 and 5xx map to the same fixed message, no retry
  // ------------------------------------------------------------------
  describe('403 and 5xx', () => {
    it('403 -> the fixed "not available" message, called once, no retry', async () => {
      mockGet.mockImplementation(() => Promise.reject({ response: { status: 403 } }));
      const service = makeService(() => Date.parse('2026-09-11T00:00:00Z'));

      await expect(service.getForecast(59.9139, 10.7522, TZ)).rejects.toThrow(
        'MET Norway forecast is not available'
      );
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('503 -> the same fixed "not available" message, called once, no retry', async () => {
      mockGet.mockImplementation(() => Promise.reject({ response: { status: 503 } }));
      const service = makeService(() => Date.parse('2026-09-11T00:00:00Z'));

      await expect(service.getForecast(59.9139, 10.7522, TZ)).rejects.toThrow(
        'MET Norway forecast is not available'
      );
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------------------------------
  // 7: no ApiError subclass, no leaked URL/coordinate/raw error text
  // ------------------------------------------------------------------
  describe('error hygiene', () => {
    it('never throws an ApiError subclass, and no thrown message or logger argument leaks the endpoint, a URL, raw axios text, or a coordinate', async () => {
      const cases: unknown[] = [
        { response: { status: 403 } },
        { response: { status: 429 } },
        { response: { status: 500 } },
        { response: { status: 404 } },
        { code: 'ECONNABORTED' },
        { code: 'ENOTFOUND' },
        {
          code: 'ERR_BAD_RESPONSE',
          message: 'maxContentLength size of 2000000 exceeded for https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=59.9139&lon=10.7522'
        }
      ];

      for (const rejection of cases) {
        warnSpy.mockClear();
        errorSpy.mockClear();
        mockGet.mockImplementation(() => Promise.reject(rejection));
        const service = makeService(() => Date.parse('2026-09-11T00:00:00Z'));

        let thrown: Error | undefined;
        try {
          await service.getForecast(59.9139, 10.7522, TZ);
        } catch (e) {
          thrown = e as Error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).not.toBeInstanceOf(ApiError);

        const forbidden = ['api.met.no', 'https://', '59.9139', '10.7522'];
        for (const needle of forbidden) {
          expect(thrown!.message).not.toContain(needle);
        }

        const allLoggerCalls = [...warnSpy.mock.calls, ...errorSpy.mock.calls];
        const serializedLogCalls = JSON.stringify(allLoggerCalls);
        for (const needle of forbidden) {
          expect(serializedLogCalls).not.toContain(needle);
        }
      }
    });
  });

  // ------------------------------------------------------------------
  // 8: concurrency (G43) — per-request results, distinct rejections
  // ------------------------------------------------------------------
  describe('concurrency (G43)', () => {
    it('two concurrent calls for different points, settled in the opposite order to their start, each return their own aggregate', async () => {
      let resolveFirst: ((value: unknown) => void) | undefined;
      let resolveSecond: ((value: unknown) => void) | undefined;

      mockGet.mockImplementationOnce(
        () => new Promise(resolve => { resolveFirst = resolve; })
      );
      mockGet.mockImplementationOnce(
        () => new Promise(resolve => { resolveSecond = resolve; })
      );

      const service = makeService(() => Date.parse('2026-09-11T00:00:00Z'));

      // Point A starts first, point B starts second.
      const pA = service.getForecast(59.9139, 10.7522, TZ); // Oslo
      const pB = service.getForecast(35.6762, 139.6503, TZ); // Tokyo

      // Settle in the OPPOSITE order to their start: B resolves before A.
      // Each body carries a distinctive temperature base so a swapped answer
      // is visible on the returned data, not just on object identity.
      const bodyB = buildBody('2026-09-11T00:00:00Z', 200); // Tokyo: tempBase 200
      bodyB.geometry = { type: 'Point', coordinates: [139.6503, 35.6762] };
      resolveSecond!({ status: 200, data: bodyB, headers: { 'last-modified': 'Fri, 11 Sep 2026 00:00:00 GMT' } });
      const resultB = await pB;

      const bodyA = buildBody('2026-09-11T00:00:00Z', 10); // Oslo: tempBase 10
      resolveFirst!({ status: 200, data: bodyA, headers: { 'last-modified': 'Fri, 11 Sep 2026 00:00:00 GMT' } });
      const resultA = await pA;

      // Each result's own data must trace back to its own request, not the
      // other's — a swapped answer (G43) would still pass a looser "both
      // resolved" check, so this compares the actual aggregated values.
      expect(resultA.days[0]?.temperatureMaxC).toBeLessThan(50);
      expect(resultB.days[0]?.temperatureMaxC).toBeGreaterThan(150);
      expect(resultA).not.toBe(resultB);
    });

    it('makes both fail and returns distinct rejection objects (G43 Verify line)', async () => {
      mockGet.mockImplementationOnce(() => Promise.reject({ response: { status: 500 } }));
      mockGet.mockImplementationOnce(() => Promise.reject({ response: { status: 500 } }));

      const service = makeService(() => Date.parse('2026-09-11T00:00:00Z'));

      const [a, b] = await Promise.allSettled([
        service.getForecast(59.9139, 10.7522, TZ),
        service.getForecast(35.6762, 139.6503, TZ)
      ]);

      expect(a.status).toBe('rejected');
      expect(b.status).toBe('rejected');
      const reasonA = (a as PromiseRejectedResult).reason;
      const reasonB = (b as PromiseRejectedResult).reason;
      // A shared degraded literal (e.g. one module-level Error instance)
      // would pass every earlier assertion and fail only this one.
      expect(reasonA).not.toBe(reasonB);
    });
  });

  // ------------------------------------------------------------------
  // 9: same-point dedupe — single-flight, and the `finally` cleanup runs
  // ------------------------------------------------------------------
  describe('same-point dedupe', () => {
    it('collapses two concurrent same-point calls into one upstream call', async () => {
      let resolveFn: ((value: unknown) => void) | undefined;
      mockGet.mockImplementation(
        () => new Promise(resolve => { resolveFn = resolve; })
      );
      const service = makeService(() => Date.parse('2026-09-11T00:00:00Z'));

      const p1 = service.getForecast(59.9139, 10.7522, TZ);
      const p2 = service.getForecast(59.9139, 10.7522, TZ);

      expect(mockGet).toHaveBeenCalledTimes(1);
      resolveFn!({ status: 200, data: buildBody(), headers: { 'last-modified': 'Fri, 11 Sep 2026 00:00:00 GMT' } });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(r2);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('a rejected pull leaves nothing in-flight, so a third call retries', async () => {
      mockGet.mockImplementationOnce(() => Promise.reject({ response: { status: 500 } }));
      const service = makeService(() => Date.parse('2026-09-11T00:00:00Z'));

      await expect(service.getForecast(59.9139, 10.7522, TZ)).rejects.toThrow(
        'MET Norway forecast is not available'
      );

      const cacheKey = Cache.generateKey('metno', 'forecast', 59.9139, 10.7522, TZ);
      expect(inFlightOf(service).has(cacheKey)).toBe(false);

      mockGet.mockImplementationOnce(() => okResponse());
      const third = await service.getForecast(59.9139, 10.7522, TZ);
      expect(third.days.length).toBeGreaterThan(0);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });
});
