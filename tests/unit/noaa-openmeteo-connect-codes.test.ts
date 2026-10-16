import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { NOAAService } from '../../src/services/noaa.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import { ApiError, ServiceUnavailableError, formatErrorForUser } from '../../src/errors/ApiError.js';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { MetnoService } from '../../src/services/metno.js';
import type { MetnoDailyAggregate, MetnoDailyForecast } from '../../src/utils/metnoParse.js';

/**
 * NOAA and Open-Meteo map every connection-failure code to the outage error.
 * Harness copied from retry-by-class.test.ts (a lock; it exports nothing).
 * The adapter rejects with a real AxiosError through the real response
 * interceptor (G70).
 */

const DENVER = { lat: 39.7392, lon: -104.9903 };
const ATTEMPTS = 4;
const BACKOFF_BUDGET_MS = 30_000;

type Client = {
  get: (...args: unknown[]) => Promise<unknown>;
  defaults: { adapter?: unknown };
};

function omClient(service: OpenMeteoService, which: 'client' | 'forecastClient'): Client {
  return (service as unknown as Record<string, Client>)[which];
}

function noaaClient(service: NOAAService): Client {
  return (service as unknown as { client: Client }).client;
}

async function settleRejection(start: () => Promise<unknown>): Promise<unknown> {
  const pending = start().then(
    () => new Error('expected a rejection, got a resolution'),
    (e: unknown) => e
  );
  await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
  return pending;
}

type Step = { status: number; data?: unknown } | { code: string };
function scriptAdapter(client: Client, steps: Step[]): { calls: () => number } {
  let n = 0;
  client.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    const step = steps[Math.min(n, steps.length - 1)];
    n += 1;
    if ('code' in step) {
      return Promise.reject(new AxiosError(`connect ${step.code}`, step.code, config));
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
  return { calls: () => n };
}

const CODES = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH'];

type Target = {
  name: string;
  api: string;
  make: (opts?: { maxRetries: number }) => { service: unknown; client: Client; call: () => Promise<unknown> };
  prefix: string;
};

const TARGETS: Target[] = [
  {
    name: 'NOAA',
    api: 'NOAA',
    prefix:
      'NOAA API Error: The NOAA weather service is temporarily unavailable. Please try again in a few minutes.',
    make: (opts) => {
      const service = new NOAAService(opts);
      return { service, client: noaaClient(service), call: () => service.getAlerts(DENVER.lat, DENVER.lon) };
    }
  },
  {
    name: 'Open-Meteo',
    api: 'OpenMeteo',
    prefix:
      'OpenMeteo API Error: The OpenMeteo weather service is temporarily unavailable. Please try again in a few minutes.',
    make: (opts) => {
      const service = new OpenMeteoService(opts);
      return {
        service,
        client: omClient(service, 'forecastClient'),
        call: () => service.getForecast(DENVER.lat, DENVER.lon)
      };
    }
  }
];

describe('NOAA and Open-Meteo connection-failure codes', () => {
  const originalEnabled = CacheConfig.enabled;

  beforeEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = false;
    vi.useFakeTimers();
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = originalEnabled;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe.each(TARGETS)('$name', (target) => {
    it.each(CODES)('%s -> ServiceUnavailableError after the full ladder', async (code) => {
      const { client, call } = target.make();
      const adapter = scriptAdapter(client, [{ code }]);
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ServiceUnavailableError);
      expect((result as ServiceUnavailableError).causeCode).toBe(code);
      expect(adapter.calls()).toBe(ATTEMPTS);
      const text = formatErrorForUser(result);
      expect(text.startsWith(target.prefix)).toBe(true);
      expect(text).not.toContain('Request failed');
      expect(text).not.toContain(code);
    });

    it('control: ECONNABORTED makes one call and is an outage error', async () => {
      const { client, call } = target.make();
      const adapter = scriptAdapter(client, [{ code: 'ECONNABORTED' }]);
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ServiceUnavailableError);
      expect((result as ServiceUnavailableError).causeCode).toBe('ECONNABORTED');
      expect(adapter.calls()).toBe(1);
    });

    it('control: CERT_HAS_EXPIRED stays a plain retryable ApiError', async () => {
      const { client, call } = target.make();
      const adapter = scriptAdapter(client, [{ code: 'CERT_HAS_EXPIRED' }]);
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ApiError);
      expect(result).not.toBeInstanceOf(ServiceUnavailableError);
      expect((result as ApiError).isRetryable).toBe(true);
      expect(adapter.calls()).toBe(ATTEMPTS);
      expect((result as ApiError).userMessage).toBe('Request failed: connect CERT_HAS_EXPIRED');
    });

    it('maxRetries: 0 makes one call on ECONNRESET', async () => {
      const { client, call } = target.make({ maxRetries: 0 });
      const adapter = scriptAdapter(client, [{ code: 'ECONNRESET' }]);
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ServiceUnavailableError);
      expect(adapter.calls()).toBe(1);
    });
  });

  it('NOAA per-call maxRetries 0 on getAlerts makes one call', async () => {
    const service = new NOAAService();
    const adapter = scriptAdapter(noaaClient(service), [{ code: 'ECONNRESET' }]);
    const result = await settleRejection(() => service.getAlerts(DENVER.lat, DENVER.lon, true, 0));
    expect(result).toBeInstanceOf(ServiceUnavailableError);
    expect(adapter.calls()).toBe(1);
  });
});

describe('get_forecast auto falls back to met.no on an Open-Meteo connection failure', () => {
  const originalEnabled = CacheConfig.enabled;
  const TOKYO = { latitude: 35.6762, longitude: 139.6503, days: 5 };

  beforeEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = false;
    vi.useFakeTimers();
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = originalEnabled;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function metnoAggregate(): MetnoDailyAggregate {
    const days: MetnoDailyForecast[] = Array.from({ length: 6 }, (_, i) => {
      const date = `2026-09-${String(11 + i).padStart(2, '0')}`;
      return {
        date,
        startsAt: `${date}T00:00:00.000+09:00`,
        hoursCovered: 24,
        complete: true,
        temperatureMaxC: 17,
        temperatureMinC: 10,
        temperatureBasis: 'window',
        precipitationMm: 0,
        precipitationProbabilityMaxPct: 10,
        windSpeedMaxMps: 4,
        windFromDirectionDeg: 180,
        symbolCode: 'partlycloudy_day'
      };
    });
    return {
      timezone: 'Asia/Tokyo',
      elevationM: 20,
      days,
      completeDayCount: days.length,
      entriesSeen: days.length * 4,
      entriesAggregated: days.length * 4,
      entriesTrimmed: false
    };
  }

  function setup() {
    const openMeteo = new OpenMeteoService();
    const adapter = scriptAdapter(omClient(openMeteo, 'forecastClient'), [{ code: 'ECONNRESET' }]);
    const metno = { getForecast: vi.fn().mockResolvedValue(metnoAggregate()) };
    const call = (extra: Record<string, unknown> = {}) =>
      handleGetForecast(
        { ...TOKYO, ...extra },
        {} as unknown as NOAAService,
        openMeteo,
        { get: () => undefined, getAll: () => ({}) } as unknown as LocationStore,
        {} as unknown as GeocodingService,
        { isAvailable: () => false } as unknown as NCEIService,
        undefined,
        undefined,
        metno as unknown as MetnoService
      );
    return { adapter, metno, call };
  }

  it('auto: runs the Open-Meteo ladder, then serves met.no with both attributions', async () => {
    const { adapter, metno, call } = setup();
    const pending = call();
    await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
    const result = await pending;
    const text = result.content.map((b) => b.text).join('\n');
    expect(adapter.calls()).toBe(ATTEMPTS);
    expect(metno.getForecast).toHaveBeenCalledTimes(1);
    expect(text).toContain('*Open-Meteo is not responding; showing MET Norway model data instead.*');
    expect(text).toContain('*Forecast data by MET Norway (CC BY 4.0)*');
  });

  it("source 'openmeteo': keeps the error contract and never asks met.no", async () => {
    const { metno, call } = setup();
    const result = await settleRejection(() => call({ source: 'openmeteo' }));
    expect(result).toBeInstanceOf(ServiceUnavailableError);
    expect(metno.getForecast).not.toHaveBeenCalled();
  });
});
