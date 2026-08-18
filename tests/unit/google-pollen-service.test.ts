import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the axios instance used by GooglePollenService so no real network calls are made.
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

import { GooglePollenService, GooglePollenKeyRejectedError } from '../../src/services/googlePollen.js';
import type { GooglePollenResponse } from '../../src/types/googlePollen.js';

const FAKE_KEY = 'SUPERSECRET-TESTKEY-12345';

function jsonResponse(data: GooglePollenResponse) {
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

const SAMPLE_DAILY_INFO: GooglePollenResponse = {
  dailyInfo: [
    {
      date: { year: 2026, month: 8, day: 18 },
      pollenTypeInfo: [
        {
          code: 'GRASS',
          displayName: 'Grass',
          inSeason: true,
          indexInfo: { value: 2, category: 'Low' }
        }
      ],
      plantInfo: []
    }
  ]
};

describe('GooglePollenService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockCreate.mockClear();
    loggerSpies.debug.mockClear();
    loggerSpies.info.mockClear();
    loggerSpies.warn.mockClear();
    loggerSpies.error.mockClear();
  });

  describe('request shape', () => {
    it('sends the exact expected params and endpoint URL', async () => {
      mockGet.mockImplementation(() => jsonResponse(SAMPLE_DAILY_INFO));
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      await service.getCurrentPollen(39.0997, -94.5786);

      expect(mockGet).toHaveBeenCalledTimes(1);
      const [url, config] = mockGet.mock.calls[0];
      expect(url).toBe('https://pollen.googleapis.com/v1/forecast:lookup');
      expect(config).toMatchObject({
        params: {
          key: FAKE_KEY,
          'location.latitude': 39.0997,
          'location.longitude': -94.5786,
          days: 1,
          languageCode: 'en'
        }
      });
    });

    it('returns the first dailyInfo entry', async () => {
      mockGet.mockImplementation(() => jsonResponse(SAMPLE_DAILY_INFO));
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      const result = await service.getCurrentPollen(39.0997, -94.5786);

      expect(result).toEqual(SAMPLE_DAILY_INFO.dailyInfo![0]);
    });
  });

  describe('caching', () => {
    it('caches a successful result — two calls make one HTTP request', async () => {
      mockGet.mockImplementation(() => jsonResponse(SAMPLE_DAILY_INFO));
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      await service.getCurrentPollen(39.0997, -94.5786);
      await service.getCurrentPollen(39.0997, -94.5786);

      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('caches an empty/absent dailyInfo result as undefined and does not re-probe', async () => {
      mockGet.mockImplementation(() => jsonResponse({ dailyInfo: [] }));
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      const first = await service.getCurrentPollen(0, 0);
      const second = await service.getCurrentPollen(0, 0);

      expect(first).toBeUndefined();
      expect(second).toBeUndefined();
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('caches an absent dailyInfo field (no key at all) as undefined and does not re-probe', async () => {
      mockGet.mockImplementation(() => jsonResponse({}));
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      const first = await service.getCurrentPollen(10, 10);
      const second = await service.getCurrentPollen(10, 10);

      expect(first).toBeUndefined();
      expect(second).toBeUndefined();
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('error mapping', () => {
    it.each(['API_KEY_INVALID', 'API key not valid', 'PERMISSION_DENIED'])(
      'throws GooglePollenKeyRejectedError on a 400 with "%s" in the body',
      async marker => {
        mockGet.mockImplementation(() =>
          Promise.reject(axiosError({ status: 400, data: `Error: ${marker}` }))
        );
        const service = new GooglePollenService({ apiKey: FAKE_KEY });

        await expect(service.getCurrentPollen(0, 0)).rejects.toThrow(GooglePollenKeyRejectedError);
      }
    );

    it.each(['API_KEY_INVALID', 'API key not valid', 'PERMISSION_DENIED'])(
      'throws GooglePollenKeyRejectedError on a 403 with "%s" in the body',
      async marker => {
        mockGet.mockImplementation(() =>
          Promise.reject(axiosError({ status: 403, data: `Error: ${marker}` }))
        );
        const service = new GooglePollenService({ apiKey: FAKE_KEY });

        await expect(service.getCurrentPollen(0, 0)).rejects.toThrow(GooglePollenKeyRejectedError);
      }
    );

    it('matches a key-rejection marker inside a JSON object body', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(
          axiosError({ status: 403, data: { error: { status: 'PERMISSION_DENIED' } } })
        )
      );
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      await expect(service.getCurrentPollen(0, 0)).rejects.toThrow(GooglePollenKeyRejectedError);
    });

    it('maps a 400 with a different body to the generic invalid-params message', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 400, data: 'Some other error' }))
      );
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      await expect(service.getCurrentPollen(0, 0)).rejects.toThrow(
        'Invalid query parameters for Google Pollen API.'
      );
    });

    it('maps a 429 to the fixed quota message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 429 })));
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      await expect(service.getCurrentPollen(0, 0)).rejects.toThrow(
        'Google Pollen API monthly quota exceeded. Please try again later.'
      );
    });

    it('maps a timeout to the fixed timeout message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ECONNABORTED' })));
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      await expect(service.getCurrentPollen(0, 0)).rejects.toThrow(
        'Google Pollen API request timed out. The service may be temporarily unavailable.'
      );
    });

    it('maps a network error (no response) to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ENOTFOUND' })));
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      await expect(service.getCurrentPollen(0, 0)).rejects.toThrow(
        'Failed to reach Google Pollen API. Please check your network connection.'
      );
    });

    it('maps an unhandled status to a fixed generic message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 500 })));
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      await expect(service.getCurrentPollen(0, 0)).rejects.toThrow(
        'Google Pollen API returned an error response.'
      );
    });
  });

  describe('key configuration', () => {
    it('whitespace-only key -> isKeyAvailable() is false', () => {
      const service = new GooglePollenService({ apiKey: '   ' });
      expect(service.isKeyAvailable()).toBe(false);
    });

    it('no key configured -> getCurrentPollen rejects with a fixed message and never hits the transport', async () => {
      const service = new GooglePollenService({ apiKey: undefined });

      await expect(service.getCurrentPollen(0, 0)).rejects.toThrow(
        'Google Pollen API key is not configured.'
      );
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('key hygiene', () => {
    it('never includes the API key in any thrown error message across every failure mode', async () => {
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

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
          await service.getCurrentPollen(1, 1);
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

    it('the GooglePollenKeyRejectedError message never contains the rejected key', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 400, data: `API_KEY_INVALID. Key was: ${FAKE_KEY}` }))
      );
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      try {
        await service.getCurrentPollen(0, 0);
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GooglePollenKeyRejectedError);
        expect((error as Error).message).not.toContain(FAKE_KEY);
        expect((error as Error).message).toBe('Google Pollen API key was rejected by the service');
      }
    });

    it('a successful request never logs the key in any logger call argument', async () => {
      mockGet.mockImplementation(() => jsonResponse(SAMPLE_DAILY_INFO));
      const service = new GooglePollenService({ apiKey: FAKE_KEY });

      await service.getCurrentPollen(39.0997, -94.5786);

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
