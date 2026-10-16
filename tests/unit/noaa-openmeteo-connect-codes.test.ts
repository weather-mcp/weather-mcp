import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { NOAAService } from '../../src/services/noaa.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import { ApiError, ServiceUnavailableError, formatErrorForUser } from '../../src/errors/ApiError.js';

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
