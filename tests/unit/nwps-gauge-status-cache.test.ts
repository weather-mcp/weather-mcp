import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { NOAAService } from '../../src/services/noaa.js';
import { logger } from '../../src/utils/logger.js';
import {
  InvalidLocationError,
  RateLimitError,
  ServiceUnavailableError
} from '../../src/errors/ApiError.js';
import { handleGetRiverConditions } from '../../src/handlers/riverConditionsHandler.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

/**
 * NWPS gauge status (RF-27, T1): the bounding-box list and the stage/flow series
 * are cached on CacheConfig.ttl.nwpsGaugeStatus (30 min), and a failed list fetch
 * propagates the error handleError mapped — after exactly one request, and never
 * an unparameterised /gauges request (the removed whole-catalogue fallback).
 *
 * The stub replaces the NWPS client's adapter, so the real response interceptor
 * and handleError run. Only Date is faked (G133): Cache expiry reads Date.now(),
 * and the cache-cleanup interval stays on the real clock.
 */

const T0 = new Date('2026-11-10T12:00:00Z').getTime();
const MINUTE = 60_000;
const MEMPHIS_BOX = { west: -90.6, south: 34.7, east: -89.5, north: 35.6 };

type Call = { url?: string; params?: Record<string, unknown> };
type Step = { status: number; data?: unknown } | { code: string };

type Client = { defaults: { adapter?: unknown } };

function nwpsClient(service: NOAAService): Client {
  return (service as unknown as { nwpsClient: Client }).nwpsClient;
}

function scriptAdapter(service: NOAAService, steps: Step[]): { calls: Call[] } {
  const calls: Call[] = [];
  nwpsClient(service).defaults.adapter = (config: InternalAxiosRequestConfig) => {
    const step = steps[Math.min(calls.length, steps.length - 1)];
    calls.push({ url: config.url, params: config.params as Record<string, unknown> | undefined });
    if ('code' in step) {
      return Promise.reject(new AxiosError(`timeout of 30000ms exceeded`, step.code, config));
    }
    const response = {
      data: step.data ?? {},
      status: step.status,
      statusText: String(step.status),
      headers: {},
      config,
      request: {}
    };
    if (step.status >= 200 && step.status < 300) {
      return Promise.resolve(response);
    }
    return Promise.reject(
      new AxiosError(`Request failed with status code ${step.status}`, AxiosError.ERR_BAD_RESPONSE, config, {}, response)
    );
  };
  return { calls };
}

const LIST_BODY = {
  gauges: [
    {
      lid: 'MEMT1',
      name: 'Mississippi River at Memphis',
      latitude: 35.1495,
      longitude: -90.049,
      status: {
        observed: { primary: 12.3, primaryUnit: 'ft', secondary: -999, secondaryUnit: 'kcfs', floodCategory: 'no_flooding', validTime: '2026-11-10T11:00:00Z' },
        forecast: { primary: -999, primaryUnit: 'ft', secondary: -999, secondaryUnit: 'kcfs', floodCategory: '', validTime: '' }
      }
    }
  ]
};

const SERIES_BODY = { observed: { data: [] }, forecast: { data: [] } };

function list(service: NOAAService): Promise<unknown> {
  return service.getNWPSGaugesInBoundingBox(MEMPHIS_BOX.west, MEMPHIS_BOX.south, MEMPHIS_BOX.east, MEMPHIS_BOX.north);
}

function assertEveryCallParameterised(calls: Call[]): void {
  for (const call of calls) {
    expect(call.url).toBe('/gauges');
    expect(call.params).toBeDefined();
    expect(call.params?.['bbox.xmin']).toBe(String(MEMPHIS_BOX.west));
    expect(call.params?.srid).toBe('EPSG_4326');
  }
}

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('NWPS gauge list — cached on the 30-minute status clock', () => {
  it('reuses the list at +20 min and re-fetches at +31 min', async () => {
    const service = new NOAAService();
    const { calls } = scriptAdapter(service, [{ status: 200, data: LIST_BODY }]);

    const first = await list(service);
    expect(first).toHaveLength(1);
    expect(calls).toHaveLength(1);

    vi.setSystemTime(T0 + 20 * MINUTE);
    await list(service);
    expect(calls).toHaveLength(1);

    vi.setSystemTime(T0 + 31 * MINUTE);
    await list(service);
    expect(calls).toHaveLength(2);
    assertEveryCallParameterised(calls);
  });
});

describe('NWPS stage/flow series — the same status clock', () => {
  it('reuses the series at +20 min and re-fetches at +31 min', async () => {
    const service = new NOAAService();
    const { calls } = scriptAdapter(service, [{ status: 200, data: SERIES_BODY }]);

    await service.getNWPSStageFlow('MEMT1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/gauges/MEMT1/stageflow');

    vi.setSystemTime(T0 + 20 * MINUTE);
    await service.getNWPSStageFlow('MEMT1');
    expect(calls).toHaveLength(1);

    vi.setSystemTime(T0 + 31 * MINUTE);
    await service.getNWPSStageFlow('MEMT1');
    expect(calls).toHaveLength(2);
  });
});

describe('NWPS gauge list — a failure propagates after one parameterised request', () => {
  it('429 → RateLimitError', async () => {
    const service = new NOAAService();
    const { calls } = scriptAdapter(service, [{ status: 429, data: {} }]);
    await expect(list(service)).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(1);
    assertEveryCallParameterised(calls);
  });

  it('400 with the live srid body → InvalidLocationError', async () => {
    const service = new NOAAService();
    const { calls } = scriptAdapter(service, [
      { status: 400, data: { code: 3, message: 'parsing field "srid": "EPSG_X" is not a valid value', details: [] } }
    ]);
    await expect(list(service)).rejects.toBeInstanceOf(InvalidLocationError);
    expect(calls).toHaveLength(1);
    assertEveryCallParameterised(calls);
  });

  it('503 → ServiceUnavailableError', async () => {
    const service = new NOAAService();
    const { calls } = scriptAdapter(service, [{ status: 503, data: {} }]);
    await expect(list(service)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(calls).toHaveLength(1);
    assertEveryCallParameterised(calls);
  });

  it('ECONNABORTED (timeout) → ServiceUnavailableError', async () => {
    const service = new NOAAService();
    const { calls } = scriptAdapter(service, [{ code: 'ECONNABORTED' }]);
    await expect(list(service)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(calls).toHaveLength(1);
    assertEveryCallParameterised(calls);
  });

  it('a failure is not cached: the next call issues a fresh request', async () => {
    const service = new NOAAService();
    const { calls } = scriptAdapter(service, [{ status: 503, data: {} }, { status: 200, data: LIST_BODY }]);
    await expect(list(service)).rejects.toBeInstanceOf(ServiceUnavailableError);
    const second = await list(service);
    expect(second).toHaveLength(1);
    expect(calls).toHaveLength(2);
    assertEveryCallParameterised(calls);
  });
});

describe('get_river_conditions — a rate-limited gauge list is an error result', () => {
  it('429 on the list → error block and isError true; detail and series never requested', async () => {
    const service = new NOAAService();
    const { calls } = scriptAdapter(service, [{ status: 429, data: {} }]);
    const result = await handleGetRiverConditions(
      { latitude: 35.1495, longitude: -90.049 },
      service,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService
    );
    expect(result.content[0].text).toContain('❌ **Error retrieving river gauge data**');
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/gauges');
    expect(calls[0].params?.srid).toBe('EPSG_4326');
  });
});
