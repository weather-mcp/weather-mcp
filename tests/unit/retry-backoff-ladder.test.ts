import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { NOAAService } from '../../src/services/noaa.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import { ServiceUnavailableError, type ApiServiceName } from '../../src/errors/ApiError.js';

/**
 * Retry backoff ladder and jitter (branch feat/vacuous-unit-tests, T8).
 *
 * Both services sleep `2 ** retries * 1000 * (0.5 + Math.random() * 0.5)` ms
 * between attempts. `Math.random` is pinned to its two ends, so the delay is
 * known exactly, and the fake clock is advanced to 1 ms before each fire time
 * and then past it. The spy sits at `client.get`, under the ladder (G70).
 * `Math.random` is read nowhere else on these two paths.
 *
 * The sleep is a bare `setTimeout`, and fake timers truncate a fractional delay
 * to an integer, as Node does: the ceiling delays are 999, 1999 and 3999 ms.
 */

const DENVER = { lat: 39.7392, lon: -104.9903 };

// 1 try + the default 3 retries.
const ATTEMPTS = 4;

type Client = { get: (...args: unknown[]) => Promise<unknown> };

function retryable(service: ApiServiceName): ServiceUnavailableError {
  return new ServiceUnavailableError(service, new Error('x'));
}

/**
 * Start the call, then walk the clock. `fireTimes` are the cumulative ms at
 * which retry 1, 2, 3 must fire. Before each, the count must still be n + 1.
 */
async function walkLadder(
  start: () => Promise<unknown>,
  calls: () => number,
  fireTimes: number[]
): Promise<void> {
  const pending = start().then(
    () => new Error('expected a rejection, got a resolution'),
    (e: unknown) => e
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(calls()).toBe(1);
  let now = 0;
  for (let n = 0; n < fireTimes.length; n++) {
    await vi.advanceTimersByTimeAsync(fireTimes[n] - 1 - now);
    expect(calls()).toBe(n + 1);
    await vi.advanceTimersByTimeAsync(1);
    now = fireTimes[n];
    expect(calls()).toBe(n + 2);
  }
  await vi.advanceTimersByTimeAsync(0);
  await pending;
  expect(calls()).toBe(ATTEMPTS);
}

describe('retry backoff ladder', () => {
  const originalEnabled = CacheConfig.enabled;
  let noaa: NOAAService;
  let openMeteo: OpenMeteoService;

  beforeEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = false;
    // Construct before the fake clock: the cache-cleanup interval stays real (G133).
    noaa = new NOAAService();
    openMeteo = new OpenMeteoService();
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

  function noaaSpy() {
    const client = (noaa as unknown as { client: Client }).client;
    return vi.spyOn(client, 'get').mockRejectedValue(retryable('NOAA'));
  }

  function openMeteoSpy() {
    const client = (openMeteo as unknown as { forecastClient: Client }).forecastClient;
    return vi.spyOn(client, 'get').mockRejectedValue(retryable('OpenMeteo'));
  }

  it('NOAA getAlerts, jitter floor (random 0): retries fire at 500, 1500, 3500 ms', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const spy = noaaSpy();
    await walkLadder(() => noaa.getAlerts(DENVER.lat, DENVER.lon), () => spy.mock.calls.length, [500, 1500, 3500]);
  });

  it('NOAA getAlerts, jitter ceiling (random 0.999999): retries fire at 999, 2998, 6997 ms', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const spy = noaaSpy();
    await walkLadder(() => noaa.getAlerts(DENVER.lat, DENVER.lon), () => spy.mock.calls.length, [999, 2998, 6997]);
  });

  it('Open-Meteo getForecast, jitter floor (random 0): retries fire at 500, 1500, 3500 ms', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const spy = openMeteoSpy();
    await walkLadder(() => openMeteo.getForecast(DENVER.lat, DENVER.lon), () => spy.mock.calls.length, [500, 1500, 3500]);
  });

  it('Open-Meteo getForecast, jitter ceiling (random 0.999999): retries fire at 999, 2998, 6997 ms', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const spy = openMeteoSpy();
    await walkLadder(() => openMeteo.getForecast(DENVER.lat, DENVER.lon), () => spy.mock.calls.length, [999, 2998, 6997]);
  });
});
