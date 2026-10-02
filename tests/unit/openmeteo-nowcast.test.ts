import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { OpenMeteoService, nowcastValidateStatus } from '../../src/services/openmeteo.js';
import type { OpenMeteoNowcastResponse } from '../../src/types/openmeteo.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import { DataNotFoundError, InvalidLocationError, ServiceUnavailableError } from '../../src/errors/ApiError.js';

/**
 * OpenMeteoService.getNowcast() — minutely-nowcast T2.
 *
 * Two seams, both offline:
 * - an axios **adapter** on the real `forecastClient`, so axios itself applies
 *   `validateStatus` and the response interceptor runs exactly as it does live
 *   (the 400 interception is only proven through this path);
 * - a spy on `forecastClient.get` for cases that do not depend on that wiring.
 *
 * Fixtures are the live captures of 2026-10-01 (coordinates rounded).
 */

const MICHIGAN = { lat: 43.8195, lon: -84.7686 };
const KRAKOW = { lat: 50.06, lon: 19.94 };
const EDMONTON = { lat: 53.5, lon: -113.5 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };

// 2026-10-01T23:35:00Z — inside the 23:30Z quarter.
const NOW = Date.UTC(2026, 9, 1, 23, 35);

const NO_DATA_BODY = { error: true, reason: 'No data is available for this location' };

function hrrrCovered(): OpenMeteoNowcastResponse {
  return {
    latitude: 43.81505,
    longitude: -84.7735,
    utc_offset_seconds: -14400,
    timezone: 'America/Detroit',
    timezone_abbreviation: 'GMT-4',
    minutely_15_units: { time: 'iso8601', precipitation: 'mm', precipitation_probability: '%' },
    minutely_15: {
      time: [
        '2026-10-01T19:30', '2026-10-01T19:45', '2026-10-01T20:00', '2026-10-01T20:15',
        '2026-10-01T20:30', '2026-10-01T20:45', '2026-10-01T21:00', '2026-10-01T21:15'
      ],
      precipitation: [0.1, 0.4, 0.4, 0.5, 0.8, 0.6, 0.3, 0.2],
      precipitation_probability: [60, 60, 59, 56, 52, 48, 46, 46]
    }
  };
}

function edmontonNullBand(): OpenMeteoNowcastResponse {
  return {
    latitude: 53.50608,
    longitude: -113.50065,
    utc_offset_seconds: -21600,
    timezone: 'America/Edmonton',
    timezone_abbreviation: 'GMT-6',
    minutely_15_units: { time: 'iso8601', precipitation: 'undefined', precipitation_probability: '%' },
    minutely_15: {
      time: [
        '2026-10-01T17:30', '2026-10-01T17:45', '2026-10-01T18:00', '2026-10-01T18:15',
        '2026-10-01T18:30', '2026-10-01T18:45', '2026-10-01T19:00', '2026-10-01T19:15'
      ],
      precipitation: [null, null, null, null, null, null, null, null],
      precipitation_probability: [0, 0, 0, 0, 0, 0, 0, 0]
    }
  };
}

type Client = { get: (...args: unknown[]) => Promise<unknown>; defaults: { adapter?: unknown } };

function client(service: OpenMeteoService): Client {
  return (service as unknown as { forecastClient: Client }).forecastClient;
}

/**
 * Install an adapter answering `status`/`data`. Like axios's built-in
 * adapters, it settles through `config.validateStatus`, so a request without
 * the nowcast's `validateStatus` rejects a 400 and the interceptor sees it.
 */
function answerWith(service: OpenMeteoService, status: number, data: unknown) {
  const calls: InternalAxiosRequestConfig[] = [];
  client(service).defaults.adapter = (config: InternalAxiosRequestConfig) => {
    calls.push(config);
    const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config };
    const ok = config.validateStatus ? config.validateStatus(status) : status >= 200 && status < 300;
    if (ok) {
      return Promise.resolve(response);
    }
    return Promise.reject(
      new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, {}, response)
    );
  };
  return calls;
}

function securityWarns(warnSpy: ReturnType<typeof vi.spyOn>): unknown[][] {
  return (warnSpy.mock.calls as unknown[][]).filter(
    (call: unknown[]) => typeof call[1] === 'object' && call[1] !== null && (call[1] as Record<string, unknown>).securityEvent === true
  );
}

describe('OpenMeteoService.getNowcast', () => {
  let service: OpenMeteoService;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  const originalEnabled = CacheConfig.enabled;

  beforeEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = true;
    service = new OpenMeteoService();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    (CacheConfig as { enabled: boolean }).enabled = originalEnabled;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('box-out points', () => {
    it('answers not-covered for Tokyo with no request and nothing cached', async () => {
      const getSpy = vi.spyOn(client(service), 'get');
      const result = await service.getNowcast(TOKYO.lat, TOKYO.lon, NOW);
      expect(result).toEqual({ status: 'not-covered', model: null });
      expect(getSpy).not.toHaveBeenCalled();
      expect(service.getCacheStats().size).toBe(0);
    });
  });

  describe('covered', () => {
    it('returns the series and the model through the real axios path', async () => {
      const calls = answerWith(service, 200, hrrrCovered());
      const result = await service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW);
      expect(result.status).toBe('covered');
      expect(result.model).toBe('gfs_hrrr');
      if (result.status === 'covered') {
        expect(result.response.minutely_15?.precipitation).toEqual([0.1, 0.4, 0.4, 0.5, 0.8, 0.6, 0.3, 0.2]);
      }
      expect(calls).toHaveLength(1);
    });

    it('sends exactly the six nowcast params, the selected model and no unit params', async () => {
      const calls = answerWith(service, 200, hrrrCovered());
      await service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW);
      expect(calls[0].params).toEqual({
        latitude: MICHIGAN.lat,
        longitude: MICHIGAN.lon,
        minutely_15: 'precipitation,precipitation_probability',
        forecast_minutely_15: 8,
        models: 'gfs_hrrr',
        timezone: 'auto'
      });
      expect(calls[0].url).toBe('/forecast');
    });

    it('selects icon_d2 for an ICON-D2 box point', async () => {
      const calls = answerWith(service, 200, hrrrCovered());
      const result = await service.getNowcast(52.52, 13.4, NOW);
      expect(result.model).toBe('icon_d2');
      expect((calls[0].params as Record<string, unknown>).models).toBe('icon_d2');
    });

    it('serves a repeat call inside the quarter from cache', async () => {
      const calls = answerWith(service, 200, hrrrCovered());
      await service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW);
      await service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW);
      expect(calls).toHaveLength(1);
    });

    it('is not served past the next quarter boundary', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const calls = answerWith(service, 200, hrrrCovered());
      await service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW);
      // 23:35Z -> the next boundary is 23:45Z, ten minutes on.
      vi.setSystemTime(NOW + 10 * 60 * 1000 + 1);
      await service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW + 10 * 60 * 1000 + 1);
      expect(calls).toHaveLength(2);
    });

    it('is still served one second before the boundary', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const calls = answerWith(service, 200, hrrrCovered());
      await service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW);
      vi.setSystemTime(NOW + 10 * 60 * 1000 - 1000);
      await service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW + 10 * 60 * 1000 - 1000);
      expect(calls).toHaveLength(1);
    });
  });

  describe('not covered', () => {
    it('reads the no-data 400 as not-covered, through the interceptor, with no securityEvent', async () => {
      const calls = answerWith(service, 400, NO_DATA_BODY);
      const result = await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW);
      expect(result).toEqual({ status: 'not-covered', model: 'icon_d2' });
      expect(calls).toHaveLength(1);
      expect(securityWarns(warnSpy)).toHaveLength(0);
    });

    it('caches the no-data 400 so the point is not re-probed', async () => {
      const calls = answerWith(service, 400, NO_DATA_BODY);
      await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW);
      const again = await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW);
      expect(again).toEqual({ status: 'not-covered', model: 'icon_d2' });
      expect(calls).toHaveLength(1);
    });

    it('reads a 200 with all-null precipitation and populated probability as not-covered, cached', async () => {
      const calls = answerWith(service, 200, edmontonNullBand());
      const first = await service.getNowcast(EDMONTON.lat, EDMONTON.lon, NOW);
      const second = await service.getNowcast(EDMONTON.lat, EDMONTON.lon, NOW);
      expect(first).toEqual({ status: 'not-covered', model: 'gfs_hrrr' });
      expect(second).toEqual({ status: 'not-covered', model: 'gfs_hrrr' });
      expect(calls).toHaveLength(1);
    });

    it('keeps the sentinel apart from the data key (G7): a covered answer elsewhere is unaffected', async () => {
      answerWith(service, 400, NO_DATA_BODY);
      await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW);
      const calls = answerWith(service, 200, hrrrCovered());
      const covered = await service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW);
      expect(covered.status).toBe('covered');
      expect(calls).toHaveLength(1);
    });

    it('logs the not-covered outcome at debug with no coordinates', async () => {
      answerWith(service, 400, NO_DATA_BODY);
      await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW);
      expect(debugSpy).toHaveBeenCalledWith('Nowcast model does not cover point', {
        service: 'OpenMeteo',
        model: 'icon_d2',
        outcome: 'not-covered'
      });
      const logged = JSON.stringify([...debugSpy.mock.calls, ...warnSpy.mock.calls]);
      expect(logged).not.toContain('50.06');
      expect(logged).not.toContain('19.94');
    });

    it('never logs a full-precision coordinate on a not-covered HRRR point', async () => {
      answerWith(service, 200, edmontonNullBand());
      await service.getNowcast(53.5061, -113.5007, NOW);
      const logged = JSON.stringify([...debugSpy.mock.calls, ...warnSpy.mock.calls]);
      expect(logged).not.toContain('53.5061');
      expect(logged).not.toContain('113.5007');
    });
  });

  describe('errors', () => {
    it("hands a 400 with another reason to handleError: today's class, message and securityEvent", async () => {
      answerWith(service, 400, { error: true, reason: 'Cannot initialize WeatherVariable from invalid String value foo' });
      const error = await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidLocationError);
      expect((error as Error).message).toContain(
        'Cannot initialize WeatherVariable from invalid String value foo\n\nPlease verify:\n' +
          '- Coordinates are valid (latitude: -90 to 90, longitude: -180 to 180)\n' +
          '- Date range is valid (1940 to 5 days ago)\n' +
          '- Parameters are correctly formatted'
      );
      expect(securityWarns(warnSpy)).toHaveLength(1);
    });

    it('does not cache another-reason 400 as not-covered', async () => {
      const calls = answerWith(service, 400, { error: true, reason: 'Something else' });
      await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW).catch(() => undefined);
      await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW).catch(() => undefined);
      expect(calls).toHaveLength(2);
    });

    it("does not read a reason that merely contains the no-data text as not-covered (G115)", async () => {
      answerWith(service, 400, { error: true, reason: 'No data is available for this location (model offline)' });
      await expect(service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW)).rejects.toBeInstanceOf(InvalidLocationError);
    });

    it("handles a 400 with data '' without a TypeError (G111)", async () => {
      answerWith(service, 400, '');
      const error = await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidLocationError);
      expect((error as Error).message).toContain('Invalid request parameters');
    });

    it('handles a 400 with data null without a TypeError (G111)', async () => {
      answerWith(service, 400, null);
      const error = await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidLocationError);
      expect((error as Error).message).toContain('Invalid request parameters');
    });

    it('throws DataNotFoundError for an unreadable 2xx', async () => {
      answerWith(service, 204, '');
      await expect(service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW)).rejects.toBeInstanceOf(DataNotFoundError);
    });

    // Retry parity with makeRequestToForecast: the same message-substring
    // predicate. It matches lowercase 'server error' / 'rate limit' /
    // 'timed out', which the typed errors handleError throws do not contain
    // ("OpenMeteo API is currently unavailable"), so a typed
    // ServiceUnavailableError is not retried there either. These two cases pin
    // the parity, not a policy this plan chose.
    it('propagates a typed ServiceUnavailableError and caches nothing (parity: no retry)', async () => {
      vi.useFakeTimers();
      const getSpy = vi
        .spyOn(client(service), 'get')
        .mockRejectedValue(new ServiceUnavailableError('OpenMeteo', new Error('boom')));
      const pending = service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const error = await pending;
      expect(error).toBeInstanceOf(ServiceUnavailableError);
      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(service.getCacheStats().size).toBe(0);
    });

    it('retries an error whose message matches the predicate, 1 + maxRetries times', async () => {
      vi.useFakeTimers();
      const getSpy = vi.spyOn(client(service), 'get').mockRejectedValue(new Error('upstream server error'));
      const pending = service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const error = await pending;
      expect((error as Error).message).toBe('upstream server error');
      expect(getSpy).toHaveBeenCalledTimes(4);
      expect(service.getCacheStats().size).toBe(0);
    });

    it('does not retry a no-data 400', async () => {
      const calls = answerWith(service, 400, NO_DATA_BODY);
      await service.getNowcast(KRAKOW.lat, KRAKOW.lon, NOW);
      expect(calls).toHaveLength(1);
    });
  });

  describe('nowcastValidateStatus', () => {
    it('resolves 2xx and 400, rejects every other status', () => {
      expect(nowcastValidateStatus(200)).toBe(true);
      expect(nowcastValidateStatus(400)).toBe(true);
      expect(nowcastValidateStatus(404)).toBe(false);
      expect(nowcastValidateStatus(429)).toBe(false);
      expect(nowcastValidateStatus(500)).toBe(false);
    });

    it('is the validateStatus the request passes to forecastClient.get', async () => {
      const getSpy = vi.spyOn(client(service), 'get').mockResolvedValue({ status: 200, data: hrrrCovered() });
      await service.getNowcast(MICHIGAN.lat, MICHIGAN.lon, NOW);
      const options = getSpy.mock.calls[0][1] as { validateStatus: unknown };
      expect(options.validateStatus).toBe(nowcastValidateStatus);
    });
  });
});
