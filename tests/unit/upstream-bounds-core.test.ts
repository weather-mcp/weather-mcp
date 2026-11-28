import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { NOAAService } from '../../src/services/noaa.js';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { NominatimService } from '../../src/services/nominatim.js';
import { RequestSpacer } from '../../src/utils/requestSpacer.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import { ApiError, ServiceUnavailableError, formatErrorForUser } from '../../src/errors/ApiError.js';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { MetnoService } from '../../src/services/metno.js';

/**
 * upstream-response-bounds T1: NOAA (both clients), Open-Meteo (archive and forecast) and Nominatim map
 * an oversize answer and a 3xx to fixed, non-retried text.
 *
 * Every row rejects through the real response interceptor (G70) from a stub adapter on the instance,
 * and counts requests in the adapter, never with a spy on `get`. Services are built with the default
 * `maxRetries` (3), so a branch left retryable shows 4 requests.
 */

const DENVER = { lat: 39.7392, lon: -104.9903 };
const TOKYO = { latitude: 35.6762, longitude: 139.6503 };
const BACKOFF_BUDGET_MS = 30_000;
const OVERSIZE_MESSAGE = 'maxContentLength size of 2097152 exceeded';

type Client = { defaults: { adapter?: unknown } };

function clientOf(service: unknown, which: string): Client {
  return (service as Record<string, Client>)[which];
}

type Step =
  | { oversize: true }
  | { code: string; message?: string }
  | { status: number; data?: unknown };

/** One adapter for every row; counts requests and rejects in the real axios shapes. */
function scriptAdapter(client: Client, step: Step): { calls: () => number } {
  let n = 0;
  client.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    n += 1;
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

type Target = {
  name: string;
  tooLarge: string;
  redirect: string;
  make: () => { client: Client; call: () => Promise<unknown> };
};

const TARGETS: Target[] = [
  {
    name: 'NOAA client',
    tooLarge: 'NOAA response too large',
    redirect: 'NOAA returned status 301',
    make: () => {
      const s = new NOAAService();
      return { client: clientOf(s, 'client'), call: () => s.getPointData(DENVER.lat, DENVER.lon) };
    }
  },
  {
    name: 'NOAA nwpsClient',
    tooLarge: 'NOAA response too large',
    redirect: 'NOAA returned status 301',
    make: () => {
      const s = new NOAAService();
      return { client: clientOf(s, 'nwpsClient'), call: () => s.getNWPSGauge('TOPK1') };
    }
  },
  {
    name: 'Open-Meteo archive client',
    tooLarge: 'Open-Meteo response too large',
    redirect: 'Open-Meteo returned status 301',
    make: () => {
      const s = new OpenMeteoService();
      return {
        client: clientOf(s, 'client'),
        call: () => s.getHistoricalWeather(DENVER.lat, DENVER.lon, '2020-01-01', '2020-01-10')
      };
    }
  },
  {
    name: 'Open-Meteo forecast client',
    tooLarge: 'Open-Meteo response too large',
    redirect: 'Open-Meteo returned status 301',
    make: () => {
      const s = new OpenMeteoService();
      return { client: clientOf(s, 'forecastClient'), call: () => s.getForecast(DENVER.lat, DENVER.lon) };
    }
  },
  {
    name: 'Nominatim',
    tooLarge: 'Nominatim response too large',
    redirect: 'Nominatim returned status 301',
    make: () => {
      const s = new NominatimService({ spacer: new RequestSpacer(0) });
      return { client: clientOf(s, 'client'), call: () => s.reverseCountry(DENVER.lat, DENVER.lon) };
    }
  }
];

describe('upstream bounds: NOAA, Open-Meteo and Nominatim failure mapping', () => {
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
    it('oversize: fixed text, one request, no raw axios text', async () => {
      const { client, call } = target.make();
      const adapter = scriptAdapter(client, { oversize: true });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ApiError);
      expect(result).not.toBeInstanceOf(ServiceUnavailableError);
      expect((result as ApiError).message).toBe(target.tooLarge);
      expect((result as ApiError).isRetryable).toBe(false);
      expect(adapter.calls()).toBe(1);
      const text = formatErrorForUser(result as Error);
      expect(text).toContain(target.tooLarge);
      expect(text).not.toContain('maxContentLength');
      expect(text).not.toContain('2097152');
    });

    it.each([
      ['null', null],
      ['empty string', ''],
      ['HTML', '<html>Moved</html>']
    ])('3xx with a %s body: fixed status text, one request, no TypeError', async (_label, data) => {
      const { client, call } = target.make();
      const adapter = scriptAdapter(client, { status: 301, data });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ApiError);
      expect(result).not.toBeInstanceOf(TypeError);
      expect((result as ApiError).message).toBe(target.redirect);
      expect((result as ApiError).isRetryable).toBe(false);
      expect(adapter.calls()).toBe(1);
      expect(formatErrorForUser(result as Error)).not.toContain('<html>');
    });

    it('control: ENOTFOUND keeps its existing outage mapping', async () => {
      const { client, call } = target.make();
      scriptAdapter(client, { code: 'ENOTFOUND' });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ServiceUnavailableError);
      expect((result as ApiError).message).not.toBe(target.tooLarge);
    });

    it('near-miss: ERR_BAD_RESPONSE without the maxContentLength message keeps the generic path', async () => {
      const { client, call } = target.make();
      scriptAdapter(client, { code: AxiosError.ERR_BAD_RESPONSE, message: 'stream aborted' });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(ApiError);
      expect((result as ApiError).message).not.toBe(target.tooLarge);
      expect((result as ApiError).message).toContain('stream aborted');
      expect((result as ApiError).isRetryable).toBe(true);
    });
  });

  it('NOAA near-miss is still retried by the ladder (the regex half of the gate is load-bearing)', async () => {
    const s = new NOAAService();
    const adapter = scriptAdapter(clientOf(s, 'client'), {
      code: AxiosError.ERR_BAD_RESPONSE,
      message: 'stream aborted'
    });
    await settleRejection(() => s.getPointData(DENVER.lat, DENVER.lon));
    expect(adapter.calls()).toBe(4);
  });
});

describe('upstream bounds: an Open-Meteo oversize does not fall back to MET Norway (triage codex-R1a)', () => {
  const originalEnabled = CacheConfig.enabled;
  const locationStore = { get: () => undefined, getAll: () => ({}) } as unknown as LocationStore;

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

  it('get_forecast auto at a non-US point: the fixed text surfaces and met.no is never asked', async () => {
    const openMeteo = new OpenMeteoService();
    const adapter = scriptAdapter(clientOf(openMeteo, 'forecastClient'), { oversize: true });
    const metno = { getForecast: vi.fn() };
    const result = await settleRejection(() =>
      handleGetForecast(
        { ...TOKYO, days: 5 },
        {} as unknown as NOAAService,
        openMeteo,
        locationStore,
        {} as unknown as GeocodingService,
        { isAvailable: () => false } as unknown as NCEIService,
        undefined,
        undefined,
        metno as unknown as MetnoService
      )
    );
    expect(result).toBeInstanceOf(ApiError);
    expect((result as ApiError).message).toBe('Open-Meteo response too large');
    expect(metno.getForecast).not.toHaveBeenCalled();
    expect(adapter.calls()).toBe(1);
  });

  it('get_weather_summary renders the forecast section unavailable with the fixed text (G19)', async () => {
    const openMeteo = new OpenMeteoService();
    scriptAdapter(clientOf(openMeteo, 'forecastClient'), { oversize: true });
    const metno = { getForecast: vi.fn() };
    const pending = handleGetWeatherSummary(
      { ...TOKYO, include: ['forecast'] },
      {} as unknown as NOAAService,
      openMeteo,
      { isAvailable: () => false } as unknown as NCEIService,
      locationStore,
      {} as unknown as GeocodingService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      metno as unknown as MetnoService
    );
    await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
    const result = await pending;
    const text = result.content.map((b) => b.text).join('\n');
    expect(text).toContain('## forecast (unavailable)');
    expect(text).toContain('Open-Meteo response too large');
    expect(text).not.toContain('maxContentLength');
    expect(metno.getForecast).not.toHaveBeenCalled();
  });
});

describe('upstream bounds: NOAA getStations asks the canonical gridpoint URL (T8 live finding)', () => {
  const originalEnabled = CacheConfig.enabled;

  beforeEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = false;
  });

  afterEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = originalEnabled;
    vi.restoreAllMocks();
  });

  it('requests /points then /gridpoints/{wfo}/{x},{y}/stations, never the /points/…/stations shorthand NWS 301s', async () => {
    const s = new NOAAService();
    const urls: string[] = [];
    clientOf(s, 'client').defaults.adapter = (config: InternalAxiosRequestConfig) => {
      urls.push(String(config.url));
      const data = String(config.url).startsWith('/points/')
        ? { properties: { gridId: 'BOU', gridX: 63, gridY: 62 } }
        : { features: [{ properties: { stationIdentifier: 'KBJC' } }] };
      return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config, request: {} });
    };
    const result = await s.getStations(39.74, -104.99);
    expect(urls).toEqual(['/points/39.7400,-104.9900', '/gridpoints/BOU/63,62/stations']);
    expect(urls.some((u) => /^\/points\/[^/]+\/stations/.test(u))).toBe(false);
    expect(result.features).toHaveLength(1);
  });

  it('a 301 on the stations request is still the fixed, non-retried error', async () => {
    vi.useFakeTimers();
    try {
      const s = new NOAAService();
      let n = 0;
      clientOf(s, 'client').defaults.adapter = (config: InternalAxiosRequestConfig) => {
        n += 1;
        if (String(config.url).startsWith('/points/')) {
          return Promise.resolve({
            data: { properties: { gridId: 'BOU', gridX: 63, gridY: 62 } },
            status: 200, statusText: 'OK', headers: {}, config, request: {}
          });
        }
        const response = { data: null, status: 301, statusText: '301', headers: {}, config, request: {} };
        return Promise.reject(new AxiosError('Request failed with status code 301', undefined, config, {}, response));
      };
      const result = await settleRejection(() => s.getStations(39.74, -104.99));
      expect((result as ApiError).message).toBe('NOAA returned status 301');
      expect(n).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
