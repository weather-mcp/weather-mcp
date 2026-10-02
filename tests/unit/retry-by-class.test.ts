import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { NOAAService } from '../../src/services/noaa.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import { resolveCriticalAlertBanner } from '../../src/handlers/criticalAlertBanner.js';
import {
  ApiError,
  DataNotFoundError,
  InvalidLocationError,
  RateLimitError,
  ServiceUnavailableError,
  type ApiServiceName
} from '../../src/errors/ApiError.js';

/**
 * Retry by error class (branch feat/retry-predicate-by-class, T5).
 *
 * Spies sit at `client.get` — the seam under the retry ladder. A spy on
 * `makeRequest*` would replace the ladder itself and test nothing (G70). The
 * end-to-end block installs an adapter instead, so the real response
 * interceptor types the failure before the ladder reads it.
 */

const MICHIGAN = { lat: 43.8195, lon: -84.7686 }; // inside the nowcast boxes
const DENVER = { lat: 39.7392, lon: -104.9903 };
const GRAND_RAPIDS = { lat: 42.9634, lon: -85.6681 };

// 1 try + the default 3 retries.
const ATTEMPTS = 4;

// The ladder sleeps 1 s, 2 s, 4 s at most (jittered down). The services keep a
// cache-cleanup interval alive, so `runAllTimersAsync` would loop on it until
// vitest aborts; advance a fixed span that covers every backoff instead.
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

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function timeoutError(service: ApiServiceName): ServiceUnavailableError {
  return new ServiceUnavailableError(service, withCode('t', 'ECONNABORTED'));
}

/** Drive a promise to its rejection value with fake timers running the backoff. */
async function settleRejection(start: () => Promise<unknown>): Promise<unknown> {
  const pending = start().then(
    () => new Error('expected a rejection, got a resolution'),
    (e: unknown) => e
  );
  await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
  return pending;
}

const VALID_FORECAST = {
  latitude: DENVER.lat,
  longitude: DENVER.lon,
  elevation: 1609,
  timezone: 'America/Denver',
  timezone_abbreviation: 'MDT',
  utc_offset_seconds: -21600,
  daily: { time: ['2026-10-02'], temperature_2m_max: [60], temperature_2m_min: [40] }
};

const EMPTY_ALERTS = { type: 'FeatureCollection', features: [] };

/** An adapter that plays one scripted answer per call; the last answer repeats. */
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

describe('retry by error class', () => {
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

  // ---------------------------------------------------------------- 1
  describe('typed transient errors retry 1 + maxRetries times, then propagate the same instance', () => {
    const openMeteoErrors: Array<[string, () => Error]> = [
      ['RateLimitError', () => new RateLimitError('OpenMeteo')],
      ['ServiceUnavailableError', () => new ServiceUnavailableError('OpenMeteo', new Error('x'))],
      [
        'ServiceUnavailableError (ECONNREFUSED cause)',
        () => new ServiceUnavailableError('OpenMeteo', withCode('x', 'ECONNREFUSED'))
      ],
      ['ApiError(isRetryable: true)', () => new ApiError('m', 500, 'OpenMeteo', 'u', [], true)]
    ];
    const noaaErrors: Array<[string, () => Error]> = [
      ['RateLimitError', () => new RateLimitError('NOAA')],
      ['ServiceUnavailableError', () => new ServiceUnavailableError('NOAA', new Error('x'))],
      [
        'ServiceUnavailableError (ECONNREFUSED cause)',
        () => new ServiceUnavailableError('NOAA', withCode('x', 'ECONNREFUSED'))
      ],
      ['ApiError(isRetryable: true)', () => new ApiError('m', 500, 'NOAA', 'u', [], true)]
    ];

    it.each(openMeteoErrors)('Open-Meteo getForecast: %s', async (_name, make) => {
      const service = new OpenMeteoService();
      const err = make();
      const spy = vi.spyOn(omClient(service, 'forecastClient'), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getForecast(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(ATTEMPTS);
      expect(result).toBe(err);
    });

    it.each(openMeteoErrors)('Open-Meteo getNowcast: %s', async (_name, make) => {
      const service = new OpenMeteoService();
      const err = make();
      const spy = vi.spyOn(omClient(service, 'forecastClient'), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getNowcast(MICHIGAN.lat, MICHIGAN.lon));
      expect(spy).toHaveBeenCalledTimes(ATTEMPTS);
      expect(result).toBe(err);
    });

    it.each(noaaErrors)('NOAA getAlerts: %s', async (_name, make) => {
      const service = new NOAAService();
      const err = make();
      const spy = vi.spyOn(noaaClient(service), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getAlerts(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(ATTEMPTS);
      expect(result).toBe(err);
    });
  });

  // ---------------------------------------------------------------- 2
  describe('a timeout is not retried', () => {
    it('Open-Meteo getForecast: one call, same instance', async () => {
      const service = new OpenMeteoService();
      const err = timeoutError('OpenMeteo');
      const spy = vi.spyOn(omClient(service, 'forecastClient'), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getForecast(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).toBe(err);
    });

    it('Open-Meteo getNowcast: one call, same instance', async () => {
      const service = new OpenMeteoService();
      const err = timeoutError('OpenMeteo');
      const spy = vi.spyOn(omClient(service, 'forecastClient'), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getNowcast(MICHIGAN.lat, MICHIGAN.lon));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).toBe(err);
    });

    it('NOAA getAlerts: one call, same instance', async () => {
      const service = new NOAAService();
      const err = timeoutError('NOAA');
      const spy = vi.spyOn(noaaClient(service), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getAlerts(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).toBe(err);
    });
  });

  // ---------------------------------------------------------------- 3
  describe('the message no longer decides', () => {
    const messages = ['upstream server error', 'rate limit timed out'];

    it.each(messages)('Open-Meteo: plain Error "%s" is not retried', async (message) => {
      const service = new OpenMeteoService();
      const err = new Error(message);
      const spy = vi.spyOn(omClient(service, 'forecastClient'), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getForecast(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).toBe(err);
    });

    it.each(messages)('NOAA: plain Error "%s" is not retried', async (message) => {
      const service = new NOAAService();
      const err = new Error(message);
      const spy = vi.spyOn(noaaClient(service), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getAlerts(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).toBe(err);
    });
  });

  // ---------------------------------------------------------------- 4
  describe('non-transient errors are not retried', () => {
    const nonTransient = (svc: ApiServiceName): Array<[string, () => Error]> => [
      ['InvalidLocationError', () => new InvalidLocationError(svc, 'bad')],
      ['DataNotFoundError', () => new DataNotFoundError(svc, 'none')],
      ['ApiError(isRetryable: false)', () => new ApiError('m', 400, svc, 'u', [], false)]
    ];

    it.each(nonTransient('OpenMeteo'))('Open-Meteo: %s', async (_name, make) => {
      const service = new OpenMeteoService();
      const err = make();
      const spy = vi.spyOn(omClient(service, 'forecastClient'), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getForecast(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).toBe(err);
    });

    it.each(nonTransient('NOAA'))('NOAA: %s', async (_name, make) => {
      const service = new NOAAService();
      const err = make();
      const spy = vi.spyOn(noaaClient(service), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getAlerts(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).toBe(err);
    });
  });

  // ---------------------------------------------------------------- 5
  describe('maxRetries override', () => {
    it('Open-Meteo { maxRetries: 0 }: a RateLimitError makes one call', async () => {
      const service = new OpenMeteoService({ maxRetries: 0 });
      const err = new RateLimitError('OpenMeteo');
      const spy = vi.spyOn(omClient(service, 'forecastClient'), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getForecast(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).toBe(err);
    });

    it('NOAA { maxRetries: 0 }: a RateLimitError makes one call', async () => {
      const service = new NOAAService({ maxRetries: 0 });
      const err = new RateLimitError('NOAA');
      const spy = vi.spyOn(noaaClient(service), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getAlerts(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).toBe(err);
    });

    it('climate normals: sustained 429 makes exactly 2 archive pulls (its own single retry, no ladder)', async () => {
      const service = new OpenMeteoService();
      const err = new RateLimitError('OpenMeteo');
      const spy = vi.spyOn(omClient(service, 'client'), 'get').mockRejectedValue(err);
      const result = await settleRejection(() => service.getClimateNormals(39.0997, -94.5786, 1, 15));
      expect(spy).toHaveBeenCalledTimes(2);
      expect(result).toBe(err);
    });
  });

  // ---------------------------------------------------------------- 7
  describe('interceptor to ladder, end to end (no spy on get)', () => {
    it('Open-Meteo: 503 then 200 resolves after 2 calls', async () => {
      const service = new OpenMeteoService();
      const adapter = scriptAdapter(omClient(service, 'forecastClient'), [
        { status: 503, data: {} },
        { status: 200, data: VALID_FORECAST }
      ]);
      const pending = service.getForecast(DENVER.lat, DENVER.lon);
      await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
      await expect(pending).resolves.toMatchObject({ timezone: 'America/Denver' });
      expect(adapter.calls()).toBe(2);
    });

    it('Open-Meteo: a real ECONNABORTED AxiosError is one call, typed with causeCode', async () => {
      const service = new OpenMeteoService();
      const adapter = scriptAdapter(omClient(service, 'forecastClient'), [{ code: 'ECONNABORTED' }]);
      const result = await settleRejection(() => service.getForecast(DENVER.lat, DENVER.lon));
      expect(adapter.calls()).toBe(1);
      expect(result).toBeInstanceOf(ServiceUnavailableError);
      expect((result as ServiceUnavailableError).causeCode).toBe('ECONNABORTED');
    });

    it('NOAA: 503 then 200 resolves after 2 calls', async () => {
      const service = new NOAAService();
      const adapter = scriptAdapter(noaaClient(service), [
        { status: 503, data: {} },
        { status: 200, data: EMPTY_ALERTS }
      ]);
      const pending = service.getAlerts(DENVER.lat, DENVER.lon);
      await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
      await expect(pending).resolves.toEqual(EMPTY_ALERTS);
      expect(adapter.calls()).toBe(2);
    });

    it('NOAA: a real ECONNABORTED AxiosError is one call, typed with causeCode', async () => {
      const service = new NOAAService();
      const adapter = scriptAdapter(noaaClient(service), [{ code: 'ECONNABORTED' }]);
      const result = await settleRejection(() => service.getAlerts(DENVER.lat, DENVER.lon));
      expect(adapter.calls()).toBe(1);
      expect(result).toBeInstanceOf(ServiceUnavailableError);
      expect((result as ServiceUnavailableError).causeCode).toBe('ECONNABORTED');
    });
  });

  // ---------------------------------------------------------------- 10
  describe('garnish opt-outs on NOAA', () => {
    let service: NOAAService;
    let spy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      service = new NOAAService();
      spy = vi
        .spyOn(noaaClient(service), 'get')
        .mockRejectedValue(new ServiceUnavailableError('NOAA', new Error('x')));
    });

    it('getAlerts(…, 0) makes one call; without the argument it makes four', async () => {
      await settleRejection(() => service.getAlerts(DENVER.lat, DENVER.lon, true, 0));
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockClear();
      await settleRejection(() => service.getAlerts(DENVER.lat, DENVER.lon, true));
      expect(spy).toHaveBeenCalledTimes(ATTEMPTS);
    });

    it('getGridpointDataByCoordinates(…, 0) makes one call (getPointData fails first)', async () => {
      await settleRejection(() => service.getGridpointDataByCoordinates(DENVER.lat, DENVER.lon, 0));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('getStations(…, 0) makes one call; without the argument it makes four', async () => {
      await settleRejection(() => service.getStations(DENVER.lat, DENVER.lon, 0));
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockClear();
      await settleRejection(() => service.getStations(DENVER.lat, DENVER.lon));
      expect(spy).toHaveBeenCalledTimes(ATTEMPTS);
    });

    it('resolveCriticalAlertBanner returns "" after exactly one call', async () => {
      const pending = resolveCriticalAlertBanner(service, {
        latitude: GRAND_RAPIDS.lat,
        longitude: GRAND_RAPIDS.lon,
        source: 'coordinates'
      });
      await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
      expect(await pending).toBe('');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
