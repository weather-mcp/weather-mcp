import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { GooglePollenService } from '../../src/services/googlePollen.js';
import { GoogleWeatherService } from '../../src/services/googleWeather.js';
import { FIRMSService } from '../../src/services/firms.js';
import { FIRMS_PRODUCTS } from '../../src/utils/firmsProducts.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';

/**
 * upstream-response-bounds T4: the keyed services (F8) report an oversize answer as "response too
 * large" rather than as a network fault, and a 3xx with the existing fixed text. No message, stack or
 * logger argument carries the key or the axios text (G112, G152). Google Weather and FIRMS are contract
 * paths: both throw, never an empty answer.
 *
 * Every row rejects through the real catch block (G70) from a stub adapter on the instance, and
 * counts requests in the adapter. None of these services retries.
 */

const FAKE = 'SECRET-BOUNDS-KEY-24680';
const OVERSIZE_MESSAGE = 'maxContentLength size of 2097152 exceeded';
const N20 = FIRMS_PRODUCTS[0];

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
    return Promise.reject(
      new AxiosError(`Request failed with status code ${step.status}`, undefined, config, {}, response)
    );
  };
  return { calls: () => n };
}

async function rejectionOf(start: () => Promise<unknown>): Promise<unknown> {
  return start().then(
    () => new Error('expected a rejection, got a resolution'),
    (e: unknown) => e
  );
}

type Target = {
  name: string;
  keyed: boolean;
  tooLarge: string;
  redirect: string;
  make: () => { client: Client; call: () => Promise<unknown> };
};

const TARGETS: Target[] = [
  {
    name: 'Google Pollen',
    keyed: true,
    tooLarge: 'Google Pollen API response too large.',
    redirect: 'Google Pollen API returned an error response.',
    make: () => {
      const s = new GooglePollenService({ apiKey: FAKE });
      return { client: clientOf(s), call: () => s.getCurrentPollen(35.68, 139.69) };
    }
  },
  {
    name: 'Google Weather',
    keyed: true,
    tooLarge: 'Google Weather API response too large.',
    redirect: 'Google Weather API returned an error response.',
    make: () => {
      const s = new GoogleWeatherService({ apiKey: FAKE });
      return { client: clientOf(s), call: () => s.getPublicAlerts(-23.55, -46.63) };
    }
  },
  {
    name: 'FIRMS Area API',
    keyed: true,
    tooLarge: 'FIRMS service response too large.',
    redirect: 'FIRMS service returned an error response.',
    make: () => {
      const s = new FIRMSService({ mapKey: FAKE });
      return { client: clientOf(s), call: () => s.getDetectionsByBbox(20, 0, 25, 5, 1, N20) };
    }
  },
  {
    name: 'FIRMS flat file',
    keyed: false,
    tooLarge: 'FIRMS service response too large.',
    redirect: 'FIRMS service returned an error response.',
    make: () => {
      const s = new FIRMSService({ mapKey: undefined });
      return { client: clientOf(s), call: () => s.getDetectionsByRegion('Global', N20) };
    }
  }
];

describe('upstream bounds: Google and FIRMS failure mapping', () => {
  const originalEnabled = CacheConfig.enabled;
  let spies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = false;
    spies = (['warn', 'info', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(logger, level).mockImplementation(() => {})
    );
  });

  afterEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = originalEnabled;
    vi.restoreAllMocks();
  });

  function expectNoLeak(result: unknown): void {
    const err = result as Error;
    expect(err.message).not.toContain(FAKE);
    expect(err.message).not.toContain('maxContentLength');
    expect(err.message).not.toContain('http');
    expect(String(err.stack)).not.toContain(FAKE);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(FAKE);
      expect(JSON.stringify(spy.mock.calls)).not.toContain('maxContentLength');
    }
  }

  describe.each(TARGETS)('$name', (target) => {
    it('oversize: "response too large", one request, no key and no axios text anywhere', async () => {
      const { client, call } = target.make();
      const adapter = scriptAdapter(client, { oversize: true });
      const result = await rejectionOf(call);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe(target.tooLarge);
      expect((result as Error).message).not.toContain('network connection');
      expect(adapter.calls()).toBe(1);
      expectNoLeak(result);
    });

    it.each([
      ['null', null],
      ['empty string', ''],
      ['HTML', '<html>Moved</html>']
    ])('3xx with a %s body: the existing fixed text, one request', async (_label, data) => {
      const { client, call } = target.make();
      const adapter = scriptAdapter(client, { status: 301, data });
      const result = await rejectionOf(call);
      expect((result as Error).message).toBe(target.redirect);
      expect(adapter.calls()).toBe(1);
      expectNoLeak(result);
    });

    it('control: ENOTFOUND still reports a network fault', async () => {
      const { client, call } = target.make();
      scriptAdapter(client, { code: 'ENOTFOUND' });
      const result = await rejectionOf(call);
      expect((result as Error).message).toContain('Please check your network connection');
      expectNoLeak(result);
    });

    it('near-miss: ERR_BAD_RESPONSE without the maxContentLength message keeps the network text', async () => {
      const { client, call } = target.make();
      scriptAdapter(client, { code: AxiosError.ERR_BAD_RESPONSE, message: 'stream aborted' });
      const result = await rejectionOf(call);
      expect((result as Error).message).not.toBe(target.tooLarge);
      expect((result as Error).message).toContain('Please check your network connection');
    });
  });

  it('FIRMS data_availability fails open on an oversize after one request', async () => {
    const s = new FIRMSService({ mapKey: FAKE });
    const adapter = scriptAdapter(clientOf(s), { oversize: true });
    await expect(s.getProductAvailability()).resolves.toBeUndefined();
    expect(adapter.calls()).toBe(1);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(FAKE);
    }
  });
});
