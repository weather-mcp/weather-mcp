/**
 * NominatimService's request budget and single-flight (RF-11).
 *
 * Every drive injects the spacer's clock and sleep, so nothing waits in real
 * time and no fake timers are installed (G107). `client.get` is stubbed on the
 * instance, and every stub is asserted called before any "not called" claim
 * (G41), so a drive that reached the network would fail loudly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import { NominatimService, NOMINATIM_MIN_INTERVAL_MS } from '../../src/services/nominatim.js';
import { RequestSpacer } from '../../src/utils/requestSpacer.js';
import { CacheConfig } from '../../src/config/cache.js';
import { GeocodingService } from '../../src/services/geocoding.js';

const MUNICH = { lat: 48.1372, lon: 11.5755 };
const REVERSE_DE = { data: { address: { country_code: 'de' } } };
const SEARCH_ONE = {
  data: [
    {
      place_id: 1,
      licence: 'x',
      osm_type: 'node',
      osm_id: 1,
      lat: '47.3769',
      lon: '8.5417',
      display_name: 'Zqplace, Zqland'
    }
  ]
};

type Sleep = (ms: number) => Promise<void>;

function makeSpacer(): { spacer: RequestSpacer; sleep: ReturnType<typeof vi.fn<Sleep>>; clock: { t: number } } {
  const clock = { t: 10_000 };
  const sleep = vi.fn<Sleep>((ms) => {
    clock.t += ms;
    return Promise.resolve();
  });
  const spacer = new RequestSpacer(NOMINATIM_MIN_INTERVAL_MS, { now: () => clock.t, sleep });
  return { spacer, sleep, clock };
}

function stubGet(svc: NominatimService) {
  return vi.spyOn((svc as unknown as { client: AxiosInstance }).client, 'get');
}

const originalCacheEnabled = CacheConfig.enabled;
// CacheConfig is typed read-only; tests flip it the way national-cap-service.test.ts does.
const setCacheEnabled = (value: boolean): void => {
  (CacheConfig as unknown as { enabled: boolean }).enabled = value;
};

beforeEach(() => {
  setCacheEnabled(originalCacheEnabled);
});

afterEach(() => {
  setCacheEnabled(originalCacheEnabled);
  vi.restoreAllMocks();
});

describe('single-flight', () => {
  it('sends three concurrent same-key reverseCountry calls once', async () => {
    const { spacer, sleep } = makeSpacer();
    const svc = new NominatimService({ spacer });
    const get = stubGet(svc).mockResolvedValue(REVERSE_DE);

    const results = await Promise.all([
      svc.reverseCountry(MUNICH.lat, MUNICH.lon),
      svc.reverseCountry(MUNICH.lat, MUNICH.lon),
      svc.reverseCountry(MUNICH.lat, MUNICH.lon)
    ]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['de', 'de', 'de']);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('sends three concurrent same-key searchLocation calls once', async () => {
    const { spacer } = makeSpacer();
    const svc = new NominatimService({ spacer });
    const get = stubGet(svc).mockResolvedValue(SEARCH_ONE);

    const [a, b, c] = await Promise.all([
      svc.searchLocation('Zqquery Street 7731', 1),
      svc.searchLocation('Zqquery Street 7731', 1),
      svc.searchLocation('Zqquery Street 7731', 1)
    ]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(a.results).toHaveLength(1);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('dedupes with the cache disabled, and keeps nothing afterwards', async () => {
    setCacheEnabled(false);
    const { spacer } = makeSpacer();
    const svc = new NominatimService({ spacer });
    const get = stubGet(svc).mockResolvedValue(REVERSE_DE);

    await Promise.all([
      svc.reverseCountry(MUNICH.lat, MUNICH.lon),
      svc.reverseCountry(MUNICH.lat, MUNICH.lon),
      svc.reverseCountry(MUNICH.lat, MUNICH.lon)
    ]);
    expect(get).toHaveBeenCalledTimes(1);

    await expect(svc.reverseCountry(MUNICH.lat, MUNICH.lon)).resolves.toBe('de');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('shares a rejection, then sends the next call and caches its answer', async () => {
    const { spacer } = makeSpacer();
    const svc = new NominatimService({ spacer });
    const get = stubGet(svc)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(REVERSE_DE);

    const settled = await Promise.allSettled([
      svc.reverseCountry(MUNICH.lat, MUNICH.lon),
      svc.reverseCountry(MUNICH.lat, MUNICH.lon)
    ]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected']);

    await expect(svc.reverseCountry(MUNICH.lat, MUNICH.lon)).resolves.toBe('de');
    expect(get).toHaveBeenCalledTimes(2);

    await expect(svc.reverseCountry(MUNICH.lat, MUNICH.lon)).resolves.toBe('de');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('publishes the memo before the pull body runs (G113 first-step re-entry)', async () => {
    const { spacer } = makeSpacer();
    const svc = new NominatimService({ spacer });
    const get = stubGet(svc).mockResolvedValue(REVERSE_DE);
    let reentered: Promise<string | null> | undefined;
    vi.spyOn(svc as unknown as { enforceRateLimit: () => Promise<void> }, 'enforceRateLimit')
      .mockImplementationOnce(() => {
        reentered = svc.reverseCountry(MUNICH.lat, MUNICH.lon);
        return Promise.resolve();
      });

    const first = await svc.reverseCountry(MUNICH.lat, MUNICH.lon);

    expect(reentered).toBeDefined();
    await expect(reentered).resolves.toBe('de');
    expect(first).toBe('de');
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('enforceRateLimit', () => {
  it('is the path to the spacer on a miss, and a cache hit uses neither', async () => {
    const { spacer } = makeSpacer();
    const svc = new NominatimService({ spacer });
    const get = stubGet(svc).mockResolvedValue(REVERSE_DE);
    const enforce = vi.spyOn(svc as unknown as { enforceRateLimit: () => Promise<void> }, 'enforceRateLimit');
    const reserve = vi.spyOn(spacer, 'reserve');

    await svc.reverseCountry(MUNICH.lat, MUNICH.lon);
    expect(get).toHaveBeenCalledTimes(1);
    expect(enforce).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);

    await svc.reverseCountry(MUNICH.lat, MUNICH.lon);
    expect(enforce).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it('spaces two distinct-key requests one interval apart and keeps the INFO line', async () => {
    const { spacer, sleep } = makeSpacer();
    const svc = new NominatimService({ spacer });
    const get = stubGet(svc).mockResolvedValue(REVERSE_DE);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await svc.reverseCountry(MUNICH.lat, MUNICH.lon);
    await svc.reverseCountry(43.6532, -79.3832);

    expect(get).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000]);
    const waits = errorSpy.mock.calls
      .map((c) => JSON.parse(String(c[0])) as { message: string; metadata?: unknown })
      .filter((e) => e.message === 'Rate limiting: waiting before next request');
    expect(waits).toHaveLength(1);
    expect(waits[0].metadata).toEqual({ service: 'Nominatim', waitTimeMs: 1000 });
  });
});

describe('one budget across both Nominatim clients', () => {
  type ProviderView = {
    client: AxiosInstance;
    geocode(q: string, l: number): Promise<unknown[]>;
  };
  const providerOf = (geo: GeocodingService): ProviderView =>
    (geo as unknown as { nominatim: ProviderView }).nominatim;
  const stubProviderGet = (geo: GeocodingService) =>
    vi.spyOn(providerOf(geo).client, 'get');

  it('spaces a provider search one interval after a service lookup on the same spacer', async () => {
    const { spacer, sleep } = makeSpacer();
    const svc = new NominatimService({ spacer });
    const geo = new GeocodingService({ nominatimSpacer: spacer });
    const svcGet = stubGet(svc).mockResolvedValue(REVERSE_DE);
    const geoGet = stubProviderGet(geo).mockResolvedValue({ data: [] });

    await svc.reverseCountry(MUNICH.lat, MUNICH.lon);
    await providerOf(geo).geocode('Zqquery Street 7731', 5);

    expect(svcGet).toHaveBeenCalledTimes(1);
    expect(geoGet).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000]);
  });

  it('a failed service lookup does not stall the provider beyond one interval', async () => {
    const { spacer, sleep } = makeSpacer();
    const svc = new NominatimService({ spacer });
    const geo = new GeocodingService({ nominatimSpacer: spacer });
    const svcGet = stubGet(svc).mockRejectedValue(new Error('boom'));
    const geoGet = stubProviderGet(geo).mockResolvedValue({ data: [] });

    await expect(svc.reverseCountry(MUNICH.lat, MUNICH.lon)).rejects.toThrow();
    expect(svcGet).toHaveBeenCalledTimes(1);
    await providerOf(geo).geocode('Zqquery Street 7731', 5);

    expect(geoGet).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000]);
  });

  it('without a shared spacer the two clients keep separate budgets (control)', async () => {
    const a = makeSpacer();
    const b = makeSpacer();
    const svc = new NominatimService({ spacer: a.spacer });
    const geo = new GeocodingService({ nominatimSpacer: b.spacer });
    const svcGet = stubGet(svc).mockResolvedValue(REVERSE_DE);
    const geoGet = stubProviderGet(geo).mockResolvedValue({ data: [] });

    await svc.reverseCountry(MUNICH.lat, MUNICH.lon);
    await providerOf(geo).geocode('Zqquery Street 7731', 5);

    expect(svcGet).toHaveBeenCalledTimes(1);
    expect(geoGet).toHaveBeenCalledTimes(1);
    expect(a.sleep).not.toHaveBeenCalled();
    expect(b.sleep).not.toHaveBeenCalled();
  });

  it('gives Census its own 5 req/s spacer (driven through census.geocode directly)', async () => {
    const geo = new GeocodingService();
    const census = (geo as unknown as {
      census: { client: AxiosInstance; geocode(q: string, l: number): Promise<unknown[]> };
    }).census;
    const get = vi.spyOn(census.client, 'get').mockResolvedValue({ data: { result: { addressMatches: [] } } });
    let t = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const realSetTimeout = global.setTimeout;
    const scheduled: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (typeof ms === 'number' && ms > 0 && ms <= 1000) {
        scheduled.push(ms);
        t += ms;
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms, ...rest);
    }) as unknown as typeof setTimeout);

    await census.geocode('Seattle, WA', 5);
    await census.geocode('Seattle, WA', 5);

    expect(get).toHaveBeenCalledTimes(2);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toBeGreaterThan(0);
    expect(scheduled[0]).toBeLessThanOrEqual(200);
  });
});
