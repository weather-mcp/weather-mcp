import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the axios instance used by GoogleWeatherService so no real network calls are made.
const { mockGet, mockCreate } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockCreate: vi.fn()
}));

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  mockCreate.mockImplementation(() => ({
    get: mockGet
  }));
  return {
    default: {
      ...actual.default,
      create: mockCreate,
      isAxiosError: actual.default.isAxiosError
    }
  };
});

// Spy on the logger so key-hygiene tests can assert no call argument ever
// carries the test key.
const loggerSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}));

vi.mock('../../src/utils/logger.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/logger.js')>(
    '../../src/utils/logger.js'
  );
  return {
    ...actual,
    logger: {
      ...actual.logger,
      debug: loggerSpies.debug,
      info: loggerSpies.info,
      warn: loggerSpies.warn,
      error: loggerSpies.error
    }
  };
});

import { GoogleWeatherService, GoogleWeatherKeyRejectedError } from '../../src/services/googleWeather.js';
import type { GoogleWeatherAlertsResponse } from '../../src/types/googleWeather.js';

const FAKE_KEY = 'SUPER-SECRET-TEST-KEY-abc123';

function jsonResponse(data: GoogleWeatherAlertsResponse) {
  return Promise.resolve({ data, status: 200 });
}

function axiosError(opts: { status?: number; data?: unknown; code?: string; message?: string }) {
  const error: any = new Error(opts.message ?? 'request failed');
  error.isAxiosError = true;
  error.code = opts.code;
  if (opts.status !== undefined) {
    error.response = { status: opts.status, data: opts.data };
  }
  return error;
}

const SAMPLE_ALERTS_RESPONSE: GoogleWeatherAlertsResponse = {
  weatherAlerts: [
    {
      alertId: 'abc-123',
      alertTitle: 'Severe Thunderstorm Warning',
      eventType: 'SEVERE_THUNDERSTORM',
      areaName: 'Greater Sydney',
      description: 'A severe thunderstorm is affecting the area.',
      severity: 'Severe',
      urgency: 'Immediate',
      certainty: 'Observed',
      instruction: ['Seek shelter immediately'],
      safetyRecommendations: ['Stay indoors'],
      startTime: '2026-08-18T00:00:00Z',
      expirationTime: '2026-08-18T06:00:00Z',
      timezoneOffset: '+10:00',
      dataSource: {
        name: 'BOM',
        fullName: 'Australian Bureau of Meteorology',
        authorityUri: 'http://www.bom.gov.au'
      }
    }
  ]
};

describe('GoogleWeatherService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockCreate.mockClear();
    loggerSpies.debug.mockClear();
    loggerSpies.info.mockClear();
    loggerSpies.warn.mockClear();
    loggerSpies.error.mockClear();
  });

  describe('request shape', () => {
    it('sends the exact expected params and endpoint URL, with no days param', async () => {
      mockGet.mockImplementation(() => jsonResponse(SAMPLE_ALERTS_RESPONSE));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await service.getPublicAlerts(-33.8688, 151.2093);

      expect(mockGet).toHaveBeenCalledTimes(1);
      const [url, config] = mockGet.mock.calls[0];
      expect(url).toBe('https://weather.googleapis.com/v1/publicAlerts:lookup');
      expect(config).toMatchObject({
        params: {
          key: FAKE_KEY,
          'location.latitude': -33.8688,
          'location.longitude': 151.2093,
          languageCode: 'en'
        }
      });
      expect(config.params).not.toHaveProperty('days');
    });

    it('returns the alerts array from a non-empty response', async () => {
      mockGet.mockImplementation(() => jsonResponse(SAMPLE_ALERTS_RESPONSE));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      const result = await service.getPublicAlerts(-33.8688, 151.2093);

      expect(result).toEqual(SAMPLE_ALERTS_RESPONSE.weatherAlerts);
    });
  });

  describe('caching', () => {
    it('caches a successful result — two calls make one HTTP request', async () => {
      mockGet.mockImplementation(() => jsonResponse(SAMPLE_ALERTS_RESPONSE));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await service.getPublicAlerts(-33.8688, 151.2093);
      await service.getPublicAlerts(-33.8688, 151.2093);

      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('regionCode-only body resolves to [] and is cached', async () => {
      mockGet.mockImplementation(() => jsonResponse({ regionCode: 'AU' }));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      const first = await service.getPublicAlerts(0, -160);
      const second = await service.getPublicAlerts(0, -160);

      expect(first).toEqual([]);
      expect(second).toEqual([]);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('caches an absent weatherAlerts field (empty body) as [] and does not re-probe', async () => {
      mockGet.mockImplementation(() => jsonResponse({}));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      const first = await service.getPublicAlerts(10, 10);
      const second = await service.getPublicAlerts(10, 10);

      expect(first).toEqual([]);
      expect(second).toEqual([]);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('caches an empty weatherAlerts array as [] and does not re-probe', async () => {
      mockGet.mockImplementation(() => jsonResponse({ weatherAlerts: [], regionCode: 'AU' }));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      const first = await service.getPublicAlerts(10, 10);
      const second = await service.getPublicAlerts(10, 10);

      expect(first).toEqual([]);
      expect(second).toEqual([]);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('live-verified shapes (T6)', () => {
    it('reads weatherAlerts, not the documented alerts field', async () => {
      // Regression lock: the design plan's web-verified shape said `alerts`.
      // Reading that name returned [] for every location on Earth.
      mockGet.mockImplementation(() =>
        jsonResponse({
          alerts: [{ alertId: 'wrong-field' }],
          weatherAlerts: [{ alertId: 'right-field' }],
          regionCode: 'PH'
        })
      );
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      const result = await service.getPublicAlerts(14.6, 121.0);

      expect(result).toEqual([{ alertId: 'right-field' }]);
    });

    it('treats the 404 uncovered-region answer as no data, and caches it', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(
          axiosError({
            status: 404,
            data: {
              error: {
                code: 404,
                message: 'Information is not supported for this location. Please try a different location.',
                status: 'NOT_FOUND'
              }
            }
          })
        )
      );
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      const first = await service.getPublicAlerts(-30, -140);
      const second = await service.getPublicAlerts(-30, -140);

      expect(first).toEqual([]);
      expect(second).toEqual([]);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('a 404 without the coverage marker still throws', async () => {
      // A genuinely malformed request must not be silently cached as
      // "no alerts here" for the whole TTL.
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 404, data: { error: { message: 'Not found' } } }))
      );
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await expect(service.getPublicAlerts(1, 1)).rejects.toThrow(
        'Google Weather API returned an error response.'
      );
    });

    it('a 404 carrying a key-rejection marker is a rejected key, not a coverage gap', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 404, data: 'API_KEY_INVALID' }))
      );
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await expect(service.getPublicAlerts(1, 1)).rejects.toThrow(
        'Google Weather API returned an error response.'
      );
    });
  });

  describe('error mapping', () => {
    it.each(['API_KEY_INVALID', 'API key not valid', 'PERMISSION_DENIED'])(
      'throws GoogleWeatherKeyRejectedError on a 400 with "%s" in the body',
      async marker => {
        mockGet.mockImplementation(() =>
          Promise.reject(axiosError({ status: 400, data: `Error: ${marker}` }))
        );
        const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

        await expect(service.getPublicAlerts(0, 0)).rejects.toThrow(GoogleWeatherKeyRejectedError);
      }
    );

    it.each(['API_KEY_INVALID', 'API key not valid', 'PERMISSION_DENIED'])(
      'throws GoogleWeatherKeyRejectedError on a 403 with "%s" in the body',
      async marker => {
        mockGet.mockImplementation(() =>
          Promise.reject(axiosError({ status: 403, data: `Error: ${marker}` }))
        );
        const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

        await expect(service.getPublicAlerts(0, 0)).rejects.toThrow(GoogleWeatherKeyRejectedError);
      }
    );

    it('matches a key-rejection marker inside a JSON object body', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(
          axiosError({ status: 403, data: { error: { status: 'PERMISSION_DENIED' } } })
        )
      );
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await expect(service.getPublicAlerts(0, 0)).rejects.toThrow(GoogleWeatherKeyRejectedError);
    });

    it('maps a 400 with a different body to the generic invalid-params message', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 400, data: 'Some other error' }))
      );
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await expect(service.getPublicAlerts(0, 0)).rejects.toThrow(
        'Invalid query parameters for Google Weather API.'
      );
    });

    it('maps a 429 to the fixed quota message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 429 })));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await expect(service.getPublicAlerts(0, 0)).rejects.toThrow(
        'Google Weather API quota exceeded. Please try again later.'
      );
    });

    it('maps a timeout to the fixed timeout message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ECONNABORTED' })));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await expect(service.getPublicAlerts(0, 0)).rejects.toThrow(
        'Google Weather API request timed out. The service may be temporarily unavailable.'
      );
    });

    it('maps a network error (no response) to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ENOTFOUND' })));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await expect(service.getPublicAlerts(0, 0)).rejects.toThrow(
        'Failed to reach Google Weather API. Please check your network connection.'
      );
    });

    it('maps an unhandled status to a fixed generic message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 500 })));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await expect(service.getPublicAlerts(0, 0)).rejects.toThrow(
        'Google Weather API returned an error response.'
      );
    });
  });

  describe('key configuration', () => {
    it('whitespace-only key -> isKeyAvailable() is false', () => {
      const service = new GoogleWeatherService({ apiKey: '   ' });
      expect(service.isKeyAvailable()).toBe(false);
    });

    it('no key configured -> getPublicAlerts rejects with a fixed message and never hits the transport', async () => {
      const service = new GoogleWeatherService({ apiKey: undefined });

      await expect(service.getPublicAlerts(0, 0)).rejects.toThrow(
        'Google Weather API key is not configured.'
      );
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('input validation', () => {
    it('invalid latitude throws a validation error and never hits the transport', async () => {
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await expect(service.getPublicAlerts(999, 0)).rejects.toThrow();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('invalid longitude throws a validation error and never hits the transport', async () => {
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await expect(service.getPublicAlerts(0, 999)).rejects.toThrow();
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('key hygiene', () => {
    it('never includes the API key in any thrown error message across every failure mode', async () => {
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      const failureModes = [
        axiosError({ status: 400, data: `API_KEY_INVALID: ${FAKE_KEY}` }),
        axiosError({ status: 400, data: 'Some other error' }),
        axiosError({ status: 403, data: `PERMISSION_DENIED for key ${FAKE_KEY}` }),
        axiosError({ status: 403, data: 'unrelated forbidden' }),
        axiosError({ status: 429 }),
        axiosError({ status: 500 }),
        axiosError({ code: 'ECONNABORTED' }),
        axiosError({ code: 'ENOTFOUND' }),
        new Error('unexpected non-axios failure')
      ];

      for (const failure of failureModes) {
        mockGet.mockReset();
        mockGet.mockImplementation(() => Promise.reject(failure));

        let thrown: Error | undefined;
        try {
          await service.getPublicAlerts(1, 1);
        } catch (error) {
          thrown = error as Error;
        }

        expect(thrown).toBeDefined();
        expect(thrown!.message).not.toContain(FAKE_KEY);
        expect(thrown!.stack ?? '').not.toContain(FAKE_KEY);
      }

      // Every spied logger call, across every failure mode above, must never
      // carry the key in any argument.
      const allLoggerCalls = [
        ...loggerSpies.debug.mock.calls,
        ...loggerSpies.info.mock.calls,
        ...loggerSpies.warn.mock.calls,
        ...loggerSpies.error.mock.calls
      ];
      for (const args of allLoggerCalls) {
        const serialized = JSON.stringify(args);
        expect(serialized).not.toContain(FAKE_KEY);
      }
    });

    it('the GoogleWeatherKeyRejectedError message never contains the rejected key', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 400, data: `API_KEY_INVALID. Key was: ${FAKE_KEY}` }))
      );
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      try {
        await service.getPublicAlerts(0, 0);
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GoogleWeatherKeyRejectedError);
        expect((error as Error).message).not.toContain(FAKE_KEY);
        expect((error as Error).message).toContain('GOOGLE_WEATHER_API_KEY');
      }
    });

    it('a successful request never logs the key in any logger call argument', async () => {
      mockGet.mockImplementation(() => jsonResponse(SAMPLE_ALERTS_RESPONSE));
      const service = new GoogleWeatherService({ apiKey: FAKE_KEY });

      await service.getPublicAlerts(-33.8688, 151.2093);

      const allLoggerCalls = [
        ...loggerSpies.debug.mock.calls,
        ...loggerSpies.info.mock.calls,
        ...loggerSpies.warn.mock.calls,
        ...loggerSpies.error.mock.calls
      ];
      for (const args of allLoggerCalls) {
        const serialized = JSON.stringify(args);
        expect(serialized).not.toContain(FAKE_KEY);
      }
    });
  });
});
