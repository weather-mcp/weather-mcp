import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { AviationWeatherService } from '../../src/services/aviationWeather.js';
import { AcisService } from '../../src/services/acis.js';
import { GeocodingService, GeocodingNotFoundError } from '../../src/services/geocoding.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import { ApiError, ServiceUnavailableError, formatErrorForUser } from '../../src/errors/ApiError.js';

/**
 * upstream-response-bounds T2: the METAR, ACIS and geocoding clients map an oversize answer and a 3xx
 * to fixed text, and METAR does not retry either.
 *
 * Every row rejects through the real response interceptor (or the provider's own catch) from a stub
 * adapter on the instance (G70), and counts requests in the adapter, never with a spy on `get`.
 * AviationWeather is built with the default `maxRetries` (3), so a branch left retryable shows 4.
 */

const BACKOFF_BUDGET_MS = 30_000;
const OVERSIZE_MESSAGE = 'maxContentLength size of 2097152 exceeded';

type Client = { defaults: { adapter?: unknown } };

type Step =
  | { oversize: true }
  | { code: string; message?: string }
  | { status: number; data?: unknown }
  | { ok: unknown };

function scriptAdapter(client: Client, step: Step): { calls: () => number } {
  let n = 0;
  client.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    n += 1;
    if ('ok' in step) {
      return Promise.resolve({ data: step.ok, status: 200, statusText: 'OK', headers: {}, config, request: {} });
    }
    if ('oversize' in step) {
      // The shape axios's http adapter produces: ERR_BAD_RESPONSE and no `response`.
      return Promise.reject(new AxiosError(OVERSIZE_MESSAGE, AxiosError.ERR_BAD_RESPONSE, config));
    }
    if ('code' in step) {
      return Promise.reject(new AxiosError(step.message ?? `connect ${step.code}`, step.code, config));
    }
    const response = {
      data: step.data,
      status: step.status,
      statusText: String(step.status),
      headers: {},
      config,
      request: {}
    };
    // axios's `settle` indexes its code table by status / 100 - 4, so a 3xx carries no code.
    return Promise.reject(
      new AxiosError(`Request failed with status code ${step.status}`, undefined, config, {}, response)
    );
  };
  return { calls: () => n };
}

async function settleRejection(start: () => Promise<unknown>): Promise<unknown> {
  const pending = start().then(
    () => new Error('expected a rejection, got a resolution'),
    (e: unknown) => e
  );
  await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
  return pending;
}

const BBOX = { minLat: 39, minLon: -105, maxLat: 40, maxLon: -104 };

function clientOf(service: unknown): Client {
  return (service as { client: Client }).client;
}

describe('upstream bounds: METAR, ACIS and geocoding failure mapping', () => {
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

  describe('AviationWeather', () => {
    const make = () => {
      const s = new AviationWeatherService();
      return { client: clientOf(s), call: () => s.getMetarsInBoundingBox(BBOX) };
    };

    it('oversize: fixed text, one request (not retried), not a ServiceUnavailableError', async () => {
      const { client, call } = make();
      const adapter = scriptAdapter(client, { oversize: true });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ApiError);
      expect(result).not.toBeInstanceOf(ServiceUnavailableError);
      expect((result as ApiError).message).toBe('AviationWeather API response too large');
      expect((result as ApiError).isRetryable).toBe(false);
      expect(adapter.calls()).toBe(1);
      const text = formatErrorForUser(result as Error);
      expect(text).toContain('AviationWeather API response too large');
      expect(text).not.toContain('maxContentLength');
      expect(text).not.toContain('http');
    });

    it.each([
      ['null', null],
      ['empty string', ''],
      ['HTML', '<html>Moved</html>']
    ])('3xx with a %s body: fixed status text, one request, no body forwarded', async (_label, data) => {
      const { client, call } = make();
      const adapter = scriptAdapter(client, { status: 301, data });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ApiError);
      expect(result).not.toBeInstanceOf(ServiceUnavailableError);
      expect(result).not.toBeInstanceOf(TypeError);
      expect((result as ApiError).message).toBe('AviationWeather API returned status 301');
      expect((result as ApiError).isRetryable).toBe(false);
      expect(adapter.calls()).toBe(1);
      expect(formatErrorForUser(result as Error)).not.toContain('<html>');
    });

    it('3xx with a short plain-text body does not forward it as detail', async () => {
      const { client, call } = make();
      scriptAdapter(client, { status: 302, data: 'Moved to elsewhere' });
      const result = await settleRejection(call);
      expect(formatErrorForUser(result as Error)).not.toContain('elsewhere');
    });

    it('control: ENOTFOUND keeps its existing outage mapping and retries', async () => {
      const { client, call } = make();
      const adapter = scriptAdapter(client, { code: 'ENOTFOUND' });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ServiceUnavailableError);
      expect(adapter.calls()).toBe(4);
    });

    it('near-miss: ERR_BAD_RESPONSE without the maxContentLength message keeps the generic path', async () => {
      const { client, call } = make();
      const adapter = scriptAdapter(client, { code: AxiosError.ERR_BAD_RESPONSE, message: 'stream aborted' });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ServiceUnavailableError);
      expect((result as ApiError).message).not.toBe('AviationWeather API response too large');
      expect(adapter.calls()).toBe(4);
    });
  });

  describe('ACIS', () => {
    const make = () => {
      const s = new AcisService();
      return { client: clientOf(s), call: () => s.findRecordsStation(39.74, -104.99) };
    };

    it('oversize: fixed text, one request, no raw axios text', async () => {
      const { client, call } = make();
      const adapter = scriptAdapter(client, { oversize: true });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('ACIS response too large');
      expect(adapter.calls()).toBe(1);
    });

    it.each([
      ['null', null],
      ['empty string', ''],
      ['HTML', '<html>Moved</html>'],
      ['a message object', { message: 'moved' }]
    ])('3xx with a %s body: fixed status text, one request', async (_label, data) => {
      const { client, call } = make();
      const adapter = scriptAdapter(client, { status: 301, data });
      const result = await settleRejection(call);
      expect(result).not.toBeInstanceOf(TypeError);
      expect((result as Error).message).toBe('ACIS API returned status 301');
      expect(adapter.calls()).toBe(1);
    });

    it('control: a 500 with a message body still forwards that message', async () => {
      const { client, call } = make();
      scriptAdapter(client, { status: 500, data: { message: 'backend down' } });
      const result = await settleRejection(call);
      expect((result as Error).message).toBe('backend down');
    });

    it('control: ENOTFOUND keeps its existing mapping', async () => {
      const { client, call } = make();
      scriptAdapter(client, { code: 'ENOTFOUND' });
      const result = await settleRejection(call);
      expect((result as Error).message).toBe('Unable to connect to ACIS API');
    });

    it('near-miss: ERR_BAD_RESPONSE without the maxContentLength message keeps the generic path', async () => {
      const { client, call } = make();
      scriptAdapter(client, { code: AxiosError.ERR_BAD_RESPONSE, message: 'stream aborted' });
      const result = await settleRejection(call);
      expect((result as Error).message).toBe('stream aborted');
    });
  });

  describe('Geocoding providers', () => {
    type Key = 'census' | 'nominatim' | 'openmeteo';
    type Provider = { client: AxiosInstance; spacer?: { reserve: () => Promise<void> } };
    const EMPTY: Record<Key, unknown> = {
      census: { result: { addressMatches: [] } },
      nominatim: [],
      openmeteo: {}
    };
    const US_QUERY = 'Springfield, IL';
    const INTL_QUERY = 'Paris, France';

    function build(): { svc: GeocodingService; providers: Record<Key, Provider> } {
      const svc = new GeocodingService();
      const providers = svc as unknown as Record<Key, Provider>;
      for (const k of ['census', 'nominatim'] as const) {
        vi.spyOn(providers[k].spacer as { reserve: () => Promise<void> }, 'reserve').mockResolvedValue();
      }
      return { svc, providers };
    }

    async function run(
      failing: Key,
      step: Step,
      query: string
    ): Promise<{ message: string; calls: Record<Key, number> }> {
      const { svc, providers } = build();
      const adapters = {} as Record<Key, { calls: () => number }>;
      for (const k of ['census', 'nominatim', 'openmeteo'] as const) {
        adapters[k] = scriptAdapter(providers[k].client, k === failing ? step : { ok: EMPTY[k] });
      }
      let err: unknown;
      try {
        await svc.geocode(query, 1);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(GeocodingNotFoundError);
      return {
        message: (err as Error).message,
        calls: {
          census: adapters.census.calls(),
          nominatim: adapters.nominatim.calls(),
          openmeteo: adapters.openmeteo.calls()
        }
      };
    }

    const CASES: { key: Key; name: string; query: string; next: Key | null }[] = [
      { key: 'census', name: 'Census.gov', query: US_QUERY, next: 'nominatim' },
      { key: 'nominatim', name: 'Nominatim', query: INTL_QUERY, next: 'openmeteo' },
      { key: 'openmeteo', name: 'Open-Meteo', query: INTL_QUERY, next: null }
    ];

    describe.each(CASES)('$name', ({ key, name, query, next }) => {
      it('oversize: fixed text, one request, the cascade moves on', async () => {
        const { message, calls } = await run(key, { oversize: true }, query);
        expect(message).toContain(`${name} response too large`);
        expect(message).not.toContain('maxContentLength');
        expect(calls[key]).toBe(1);
        if (next) expect(calls[next]).toBe(1);
      });

      it.each([
        ['null', null],
        ['empty string', ''],
        ['HTML', '<html>Moved</html>']
      ])('3xx with a %s body stays "is unavailable"', async (_label, data) => {
        const { message, calls } = await run(key, { status: 301, data }, query);
        expect(message).toContain(`${name} is unavailable`);
        expect(message).not.toContain('response too large');
        expect(message).not.toContain('<html>');
        expect(calls[key]).toBe(1);
      });

      it('control: ENOTFOUND stays "is unavailable"', async () => {
        const { message } = await run(key, { code: 'ENOTFOUND' }, query);
        expect(message).toContain(`${name} is unavailable`);
      });

      it('near-miss: ERR_BAD_RESPONSE without the maxContentLength message stays "is unavailable"', async () => {
        const { message } = await run(
          key,
          { code: AxiosError.ERR_BAD_RESPONSE, message: 'stream aborted' },
          query
        );
        expect(message).toContain(`${name} is unavailable`);
        expect(message).not.toContain('response too large');
      });
    });
  });
});
