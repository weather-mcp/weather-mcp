/**
 * Unit tests for `EnvironmentAgencyService` (`src/services/environmentAgency.ts`),
 * the UK Environment Agency flood-monitoring client.
 *
 * Mocking follows the `national-cap-service.test.ts` scaffold: a hoisted
 * `mockGet`, and `vi.mock('axios', ...)` exposing only `default.create`. The
 * service under test never installs a response interceptor (unlike
 * `NationalCapService`), so the mocked client here only needs `get`.
 *
 * No network: every request is served from `mockGet`.
 */

import { readFileSync } from 'node:fs';
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
import {
  EnvironmentAgencyService,
  type EAStationThresholds
} from '../../src/services/environmentAgency.js';
import { Cache } from '../../src/utils/cache.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import type { EAStation, EAStationListResponse } from '../../src/types/environmentAgency.js';

function loadFixture<T>(name: string): T {
  const text = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
  return JSON.parse(text) as T;
}

const L2402_DETAIL = loadFixture<{ items: EAStation }>('ea-station-L2402.json');
const YORK_STATIONS = loadFixture<EAStationListResponse>('ea-stations-york.json');

/** Reach the service's private cache the way this repo's other service tests reach private state. */
function cacheOf(service: EnvironmentAgencyService): Cache<unknown> {
  return (service as unknown as { cache: Cache<unknown> }).cache;
}

function jsonResponse<T>(data: T, status = 200) {
  return Promise.resolve({ data, status });
}

describe('EnvironmentAgencyService', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGet.mockReset();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  function makeService(): EnvironmentAgencyService {
    return new EnvironmentAgencyService();
  }

  // ------------------------------------------------------------------
  // getStationsNear — G6, unfiltered
  // ------------------------------------------------------------------
  describe('getStationsNear', () => {
    it('returns the unfiltered list — the riverName filter is read-time, not fetch-time (G6)', async () => {
      mockGet.mockImplementation(() => jsonResponse(YORK_STATIONS));
      const service = makeService();

      const result = await service.getStationsNear(53.96, -1.08, 25);

      // The fixture carries a mix of stations with and without riverName.
      const withRiver = YORK_STATIONS.items.filter(
        s => typeof (s as EAStation).riverName === 'string'
      ).length;
      const withoutRiver = (YORK_STATIONS.items as EAStation[]).length - withRiver;
      expect(withRiver).toBeGreaterThan(0);
      expect(withoutRiver).toBeGreaterThan(0);

      // Nothing is filtered out — every fixture station comes back.
      expect(result.stations).toHaveLength((YORK_STATIONS.items as EAStation[]).length);
      expect(result.stations.some(s => s.riverName === undefined)).toBe(true);
      expect(result.truncated).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // getLatestLevelReadings — cached whole, keyed by measure URL
  // ------------------------------------------------------------------
  describe('getLatestLevelReadings', () => {
    it('caches the bulk readings map whole, keyed by measure @id', async () => {
      const measureId = 'http://environment.data.gov.uk/flood-monitoring/id/measures/L2402-level-stage-i-15_min-m';
      mockGet.mockImplementation(() =>
        jsonResponse({
          items: [{ measure: measureId, dateTime: '2026-09-02T19:15:00Z', value: 0.562 }]
        })
      );
      const service = makeService();

      const result = await service.getLatestLevelReadings();
      expect(result.readings.get(measureId)).toEqual({ dateTime: '2026-09-02T19:15:00Z', value: 0.562 });
      expect(result.truncated).toBe(false);

      // Cached whole: a second call within TTL makes no new request.
      mockGet.mockClear();
      const second = await service.getLatestLevelReadings();
      expect(mockGet).not.toHaveBeenCalled();
      expect(second.readings.get(measureId)?.value).toBe(0.562);
    });

    it('drops an item with a null value rather than coercing it to 0', async () => {
      const measureId = 'http://environment.data.gov.uk/flood-monitoring/id/measures/some-measure';
      mockGet.mockImplementation(() =>
        jsonResponse({
          items: [{ measure: measureId, dateTime: '2026-09-02T19:15:00Z', value: null }]
        })
      );
      const service = makeService();
      const result = await service.getLatestLevelReadings();
      expect(result.readings.has(measureId)).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // Cache key shape — G5
  // ------------------------------------------------------------------
  describe('cache key shape (G5)', () => {
    it('getStationsNear keys on the generateKey tuple, distinct per component', async () => {
      mockGet.mockImplementation(() => jsonResponse({ items: [] }));
      const service = makeService();
      await service.getStationsNear(53.96, -1.08, 25);

      const expectedKey = Cache.generateKey('ea', 'stations', 53.96, -1.08, 25);
      expect(cacheOf(service).get(expectedKey)).toBeDefined();
    });

    it('getLatestLevelReadings keys on a fixed no-argument tuple', async () => {
      mockGet.mockImplementation(() => jsonResponse({ items: [] }));
      const service = makeService();
      await service.getLatestLevelReadings();

      const expectedKey = Cache.generateKey('ea', 'readings-latest');
      expect(cacheOf(service).get(expectedKey)).toBeDefined();
    });

    it('getStationDetail keys on the station reference, alphanumeric identifiers kept distinct', async () => {
      mockGet.mockImplementation(() => jsonResponse(L2402_DETAIL));
      const service = makeService();
      await service.getStationDetail('L2402');

      const expectedKey = Cache.generateKey('ea', 'station', 'L2402');
      expect(cacheOf(service).get(expectedKey)).toBeDefined();

      // A different reference must not collide with L2402's entry.
      const otherKey = Cache.generateKey('ea', 'station', 'E70824');
      expect(cacheOf(service).get(otherKey)).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // Single-flight / rejection hygiene
  // ------------------------------------------------------------------
  describe('single-flight and rejection hygiene', () => {
    it('collapses concurrent same-key calls into one request', async () => {
      let resolveFn: ((value: unknown) => void) | undefined;
      mockGet.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveFn = resolve;
          })
      );
      const service = makeService();

      const p1 = service.getStationsNear(53.96, -1.08, 25);
      const p2 = service.getStationsNear(53.96, -1.08, 25);

      expect(mockGet).toHaveBeenCalledTimes(1);
      resolveFn!({ data: { items: [] }, status: 200 });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual(r2);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('a rejected pull is neither cached nor left in the in-flight map — a later call issues a new request', async () => {
      mockGet.mockImplementationOnce(() => Promise.reject({ response: { status: 500 } }));
      const service = makeService();

      await expect(service.getStationsNear(53.96, -1.08, 25)).rejects.toThrow(
        'Environment Agency flood-monitoring server error (status 500)'
      );

      const key = Cache.generateKey('ea', 'stations', 53.96, -1.08, 25);
      expect(cacheOf(service).get(key)).toBeUndefined();
      expect(
        (service as unknown as { inFlight: Map<string, Promise<unknown>> }).inFlight.has(key)
      ).toBe(false);

      mockGet.mockImplementationOnce(() => jsonResponse({ items: [] }));
      const second = await service.getStationsNear(53.96, -1.08, 25);
      expect(second.stations).toEqual([]);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ------------------------------------------------------------------
  // Fixed error messages — no URL ever leaks
  // ------------------------------------------------------------------
  describe('fixed error messages', () => {
    it('429 -> rate limit exceeded', async () => {
      mockGet.mockImplementation(() => Promise.reject({ response: { status: 429 } }));
      const service = makeService();
      await expect(service.getStationsNear(1, 1, 1)).rejects.toThrow(
        'Environment Agency flood-monitoring rate limit exceeded'
      );
    });

    it('5xx -> server error, naming the status', async () => {
      mockGet.mockImplementation(() => Promise.reject({ response: { status: 503 } }));
      const service = makeService();
      await expect(service.getStationsNear(1, 1, 1)).rejects.toThrow(
        'Environment Agency flood-monitoring server error (status 503)'
      );
    });

    it('other non-2xx -> generic status message', async () => {
      mockGet.mockImplementation(() => Promise.reject({ response: { status: 404 } }));
      const service = makeService();
      await expect(service.getStationsNear(1, 1, 1)).rejects.toThrow(
        'Environment Agency flood-monitoring returned status 404'
      );
    });

    it('timeout -> fixed timeout message', async () => {
      mockGet.mockImplementation(() => Promise.reject({ code: 'ECONNABORTED' }));
      const service = makeService();
      await expect(service.getStationsNear(1, 1, 1)).rejects.toThrow(
        'Environment Agency flood-monitoring request timed out'
      );
    });

    it('connection failure -> fixed connection message', async () => {
      mockGet.mockImplementation(() => Promise.reject({ code: 'ENOTFOUND' }));
      const service = makeService();
      await expect(service.getStationsNear(1, 1, 1)).rejects.toThrow(
        'Unable to connect to the Environment Agency flood-monitoring API'
      );
    });

    it('oversize body -> fixed too-large message', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject({ code: 'ERR_BAD_RESPONSE', message: 'maxContentLength size of 4194304 exceeded' })
      );
      const service = makeService();
      await expect(service.getStationsNear(1, 1, 1)).rejects.toThrow(
        'Environment Agency flood-monitoring response too large'
      );
    });

    it('no thrown message and no logger argument contains a URL', async () => {
      const cases: unknown[] = [
        { response: { status: 429 } },
        { response: { status: 503 } },
        { response: { status: 404 } },
        { code: 'ECONNABORTED' },
        { code: 'ENOTFOUND' },
        { code: 'ERR_BAD_RESPONSE', message: 'maxContentLength size of 4194304 exceeded https://environment.data.gov.uk/leak' }
      ];

      for (const rejection of cases) {
        warnSpy.mockClear();
        errorSpy.mockClear();
        mockGet.mockImplementation(() => Promise.reject(rejection));
        const service = makeService();
        let thrown: Error | undefined;
        try {
          await service.getStationsNear(1, 1, 1);
        } catch (e) {
          thrown = e as Error;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown!.message).not.toContain('environment.data.gov.uk');

        const allLoggerCalls = [...warnSpy.mock.calls, ...errorSpy.mock.calls];
        expect(JSON.stringify(allLoggerCalls)).not.toContain('environment.data.gov.uk');
      }
    });
  });

  // ------------------------------------------------------------------
  // G7 — the centrepiece: what is actually stored in the cache
  // ------------------------------------------------------------------
  describe('getStationDetail — G7, the threshold projection', () => {
    it('caches an object carrying typicalRangeHigh/typicalRangeLow and NO latestReading or reading value anywhere', async () => {
      mockGet.mockImplementation(() => jsonResponse(L2402_DETAIL));
      const service = makeService();

      const returned = await service.getStationDetail('L2402');
      expect(returned).not.toBeNull();
      expect(returned!.typicalRangeHigh).toBe(2.247);
      expect(returned!.typicalRangeLow).toBe(0.417);

      // The proof: read the cache value back directly, not the return value.
      const cacheKey = Cache.generateKey('ea', 'station', 'L2402');
      const cached = cacheOf(service).get(cacheKey) as EAStationThresholds;
      expect(cached).toBeDefined();
      expect(cached.typicalRangeHigh).toBe(2.247);
      expect(cached.typicalRangeLow).toBe(0.417);

      // No reading field anywhere in the cached object — by construction,
      // not by scanning for a specific key name.
      expect(cached).not.toHaveProperty('latestReading');
      expect(cached).not.toHaveProperty('measures');
      const serializedCached = JSON.stringify(cached);
      // The two live reading values on the L2402 fixture (0.562 m Stage,
      // 2.438 mAOD Downstream Stage) must not appear in what was stored.
      expect(serializedCached).not.toContain('0.562');
      expect(serializedCached).not.toContain('2.438');
      // And the exact fields a raw response/measure would carry are absent.
      expect(Object.keys(cached).sort()).toEqual(['datum', 'scaleMax', 'typicalRangeHigh', 'typicalRangeLow']);
    });

    it('a second call within TTL is served from cache — no new request, still no reading field', async () => {
      mockGet.mockImplementation(() => jsonResponse(L2402_DETAIL));
      const service = makeService();

      await service.getStationDetail('L2402');
      mockGet.mockClear();
      const second = await service.getStationDetail('L2402');

      expect(mockGet).not.toHaveBeenCalled();
      expect(second).not.toHaveProperty('latestReading');
      expect(second!.typicalRangeHigh).toBe(2.247);
    });

    it('a stageScale arriving as a URL string yields null, not a throw', async () => {
      const listShapedDetail = {
        items: {
          ...L2402_DETAIL.items,
          stageScale: 'http://environment.data.gov.uk/flood-monitoring/id/stations/L2402/stageScale'
        }
      };
      mockGet.mockImplementation(() => jsonResponse(listShapedDetail));
      const service = makeService();

      await expect(service.getStationDetail('L2402')).resolves.toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // Bounds
  // ------------------------------------------------------------------
  describe('bounds', () => {
    it('a station list over MAX_STATIONS sets truncated: true and emits a securityEvent warn', async () => {
      const items: EAStation[] = Array.from({ length: 1001 }, (_unused, i) => ({
        notation: `S${i}`,
        riverName: 'Test River'
      }));
      mockGet.mockImplementation(() => jsonResponse({ items }));
      const service = makeService();

      const result = await service.getStationsNear(1, 1, 1);
      expect(result.truncated).toBe(true);
      expect(result.stations).toHaveLength(1000);

      const securityWarnings = (warnSpy.mock.calls as Array<[string, Record<string, unknown>?]>).filter(
        c => c[1]?.securityEvent === true
      );
      expect(securityWarnings.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------
  // Transport config
  // ------------------------------------------------------------------
  describe('transport config', () => {
    it('creates the axios client with maxRedirects: 0 and a bounded content length', () => {
      makeService();
      const createMock = axios.create as unknown as { mock: { calls: unknown[][] } };
      const config = createMock.mock.calls[createMock.mock.calls.length - 1][0] as Record<string, unknown>;
      expect(config.maxRedirects).toBe(0);
      expect(typeof config.maxContentLength).toBe('number');
      expect(config.timeout).toBe(CacheConfig.apiTimeoutMs);
    });
  });
});
