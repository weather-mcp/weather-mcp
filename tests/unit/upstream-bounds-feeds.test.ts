import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { GeoMetService } from '../../src/services/geomet.js';
import { MeteoAlarmService } from '../../src/services/meteoalarm.js';
import { NIFCService } from '../../src/services/nifc.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';

/**
 * upstream-response-bounds T3: GeoMet, MeteoAlarm and NIFC are contract paths (`get_alerts`,
 * `get_wildfire_info`). An oversize answer or a 3xx must throw fixed, non-retried text, and never
 * become an empty alert list or "no fires".
 *
 * Every row rejects through the real interceptor or catch block (G70) from a stub adapter on the
 * instance, and counts requests in the adapter. Each row builds its own service, so no cache or
 * factory carries an answer between rows (G158).
 */

const BACKOFF_BUDGET_MS = 30_000;
const OVERSIZE_MESSAGE = 'maxContentLength size of 4194304 exceeded';

type Client = { defaults: { adapter?: unknown } };

function clientOf(service: unknown): Client {
  return (service as { client: Client }).client;
}

type Step =
  | { oversize: true }
  | { code: string; message?: string }
  | { status: number; data?: unknown };

function scriptAdapter(client: Client, step: Step): { calls: () => number } {
  let n = 0;
  client.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    n += 1;
    if ('oversize' in step) {
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
  errorName: string | undefined;
  tooLarge: string;
  redirect: string;
  nearMiss: string;
  make: () => { client: Client; call: () => Promise<unknown> };
};

const TARGETS: Target[] = [
  {
    name: 'GeoMet',
    errorName: 'GeoMetRequestError',
    tooLarge: 'GeoMet response too large',
    redirect: 'GeoMet API returned status 301',
    nearMiss: 'GeoMet request failed',
    make: () => {
      const s = new GeoMetService();
      return { client: clientOf(s), call: () => s.getAlerts(43.65, -79.38) };
    }
  },
  {
    name: 'MeteoAlarm',
    errorName: 'MeteoAlarmRequestError',
    tooLarge: 'MeteoAlarm response too large',
    redirect: 'MeteoAlarm API returned status 301',
    nearMiss: 'MeteoAlarm request failed',
    make: () => {
      const s = new MeteoAlarmService();
      return { client: clientOf(s), call: () => s.getWarnings('de') };
    }
  },
  {
    name: 'NIFC',
    errorName: undefined,
    tooLarge: 'NIFC service response too large.',
    redirect: 'NIFC service returned HTTP 301.',
    nearMiss: 'Failed to query NIFC fire perimeters.',
    make: () => {
      const s = new NIFCService();
      return { client: clientOf(s), call: () => s.queryFirePerimeters(-106, 39, -104, 41) };
    }
  }
];

describe('upstream bounds: GeoMet, MeteoAlarm and NIFC failure mapping', () => {
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
    it('oversize: throws the fixed text after one request, never an empty answer', async () => {
      const { client, call } = target.make();
      const adapter = scriptAdapter(client, { oversize: true });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe(target.tooLarge);
      expect((result as Error).message).not.toContain('maxContentLength');
      expect(adapter.calls()).toBe(1);
      if (target.errorName) {
        expect((result as Error).name).toBe(target.errorName);
        expect((result as { transient?: boolean }).transient).toBe(false);
      }
    });

    it.each([
      ['null', null],
      ['empty string', ''],
      ['HTML', '<html>Moved</html>']
    ])('3xx with a %s body: the existing fixed status text, one request', async (_label, data) => {
      const { client, call } = target.make();
      const adapter = scriptAdapter(client, { status: 301, data });
      const result = await settleRejection(call);
      expect(result).toBeInstanceOf(Error);
      expect(result).not.toBeInstanceOf(TypeError);
      expect((result as Error).message).toBe(target.redirect);
      expect(adapter.calls()).toBe(1);
      if (target.errorName) {
        expect((result as { transient?: boolean }).transient).toBe(false);
      }
    });

    it('control: ENOTFOUND keeps its existing connection mapping', async () => {
      const { client, call } = target.make();
      scriptAdapter(client, { code: 'ENOTFOUND' });
      const result = await settleRejection(call);
      expect((result as Error).message).not.toBe(target.tooLarge);
      expect((result as Error).message).toMatch(/connect/i);
    });

    it('near-miss: ERR_BAD_RESPONSE without the maxContentLength message keeps the generic fixed text', async () => {
      const { client, call } = target.make();
      const adapter = scriptAdapter(client, { code: AxiosError.ERR_BAD_RESPONSE, message: 'stream aborted' });
      const result = await settleRejection(call);
      expect((result as Error).message).toBe(target.nearMiss);
      expect(adapter.calls()).toBe(1);
    });
  });

  it('get_weather_summary renders a MeteoAlarm oversize as an unavailable alerts section, never "no alerts" (G19)', async () => {
    const meteoAlarm = new MeteoAlarmService();
    scriptAdapter(clientOf(meteoAlarm), { oversize: true });
    const nominatim = { reverseCountry: vi.fn(async () => 'de') } as unknown as NominatimService;
    const pending = handleGetWeatherSummary(
      { latitude: 52.52, longitude: 13.405, include: ['alerts'] },
      {} as unknown as NOAAService,
      {} as unknown as OpenMeteoService,
      { isAvailable: () => false } as unknown as NCEIService,
      { get: () => undefined, getAll: () => ({}) } as unknown as LocationStore,
      {} as unknown as GeocodingService,
      meteoAlarm,
      undefined,
      nominatim
    );
    await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
    const result = await pending;
    const text = result.content.map((b) => b.text).join('\n');
    expect(text).toContain('## alerts (unavailable)');
    expect(text).toContain('MeteoAlarm response too large');
    expect(text).not.toMatch(/no active (weather )?(alerts|warnings)/i);
    expect(text).not.toContain('maxContentLength');
  });
});
