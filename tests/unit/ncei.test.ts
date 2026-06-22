import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the axios instance used by NCEIService so no real network calls are made.
const { mockGet, mockUse } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUse: vi.fn()
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: mockGet,
      defaults: { headers: { common: {} as Record<string, string> } },
      interceptors: { response: { use: mockUse } }
    }))
  }
}));

import { NCEIService } from '../../src/services/ncei.js';
import { DataNotFoundError, RateLimitError, ServiceUnavailableError } from '../../src/errors/ApiError.js';

const SEATAC = {
  id: 'GHCND:USW00024233',
  name: 'SEATTLE TACOMA AIRPORT, WA US',
  latitude: 47.4502,
  longitude: -122.3088,
  datacoverage: 1
};

/**
 * Configure the mocked client to return a healthy station + daily temps + monthly precip.
 * Optional overrides let individual tests simulate missing data.
 */
function setupHappyPath(opts: {
  stations?: unknown[];
  tmax?: number | null;
  tmin?: number | null;
  monthlyPrecip?: number | null;
} = {}) {
  const {
    stations = [SEATAC],
    tmax = 76,
    tmin = 55.7,
    monthlyPrecip = 0.7
  } = opts;

  mockGet.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    const params = config?.params ?? {};
    if (url === '/stations') {
      return Promise.resolve({ data: { results: stations } });
    }
    if (url === '/data' && params.datasetid === 'NORMAL_DLY') {
      const results: unknown[] = [];
      if (tmax !== null) results.push({ datatype: 'DLY-TMAX-NORMAL', value: tmax });
      if (tmin !== null) results.push({ datatype: 'DLY-TMIN-NORMAL', value: tmin });
      return Promise.resolve({ data: { results } });
    }
    if (url === '/data' && params.datasetid === 'NORMAL_MLY') {
      const results: unknown[] = [];
      if (monthlyPrecip !== null) results.push({ datatype: 'MLY-PRCP-NORMAL', value: monthlyPrecip });
      return Promise.resolve({ data: { results } });
    }
    return Promise.resolve({ data: { results: [] } });
  });
}

describe('NCEI Service', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUse.mockClear();
  });

  describe('Service initialization', () => {
    it('should create service with default configuration', () => {
      expect(new NCEIService()).toBeInstanceOf(NCEIService);
    });

    it('should create service with custom baseURL', () => {
      expect(new NCEIService({ baseURL: 'https://custom.api.com' })).toBeInstanceOf(NCEIService);
    });

    it('should create service with custom timeout', () => {
      expect(new NCEIService({ timeout: 15000 })).toBeInstanceOf(NCEIService);
    });

    it('should create service with custom token', () => {
      expect(new NCEIService({ token: 'test-token-123' })).toBeInstanceOf(NCEIService);
    });

    it('should create service without token', () => {
      const originalToken = process.env.NCEI_API_TOKEN;
      delete process.env.NCEI_API_TOKEN;
      expect(new NCEIService()).toBeInstanceOf(NCEIService);
      process.env.NCEI_API_TOKEN = originalToken;
    });
  });

  describe('isAvailable', () => {
    it('should return true when token is provided', () => {
      expect(new NCEIService({ token: 'valid-token' }).isAvailable()).toBe(true);
    });

    it('should return false when token is undefined', () => {
      expect(new NCEIService({ token: undefined }).isAvailable()).toBe(false);
    });

    it('should return false when token is empty string', () => {
      expect(new NCEIService({ token: '' }).isAvailable()).toBe(false);
    });

    it('should return false when token is whitespace only', () => {
      expect(new NCEIService({ token: '   ' }).isAvailable()).toBe(false);
    });

    it('should return false when token is null', () => {
      expect(new NCEIService({ token: null as any }).isAvailable()).toBe(false);
    });
  });

  describe('getClimateNormals - without token', () => {
    it('should throw DataNotFoundError when token not configured', async () => {
      const service = new NCEIService({ token: undefined });
      await expect(service.getClimateNormals(40.7128, -74.006, 1, 15)).rejects.toThrow(DataNotFoundError);
    });

    it('should not make any network call when token is missing', async () => {
      const service = new NCEIService({ token: '' });
      await expect(service.getClimateNormals(40.7128, -74.006, 6, 1)).rejects.toThrow(
        'NCEI API token not configured'
      );
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should include environment variable name in error', async () => {
      const service = new NCEIService({ token: undefined });
      try {
        await service.getClimateNormals(37.7749, -122.4194, 12, 25);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(DataNotFoundError);
        if (error instanceof DataNotFoundError) {
          expect(error.userMessage).toContain('NCEI_API_TOKEN');
        }
      }
    });
  });

  describe('getClimateNormals - successful retrieval', () => {
    it('should return NCEI-sourced normals from the nearest station', async () => {
      setupHappyPath();
      const service = new NCEIService({ token: 'valid-token' });

      const normals = await service.getClimateNormals(47.6062, -122.3321, 7, 15);

      expect(normals).toEqual({
        tempHigh: 76,
        tempLow: 55.7,
        precipitation: round2(0.7 / 31), // monthly normal divided by days in July
        source: 'NCEI',
        month: 7,
        day: 15
      });
    });

    it('should request daily temperatures in standard (°F) units', async () => {
      setupHappyPath();
      const service = new NCEIService({ token: 'valid-token' });
      await service.getClimateNormals(47.6062, -122.3321, 7, 15);

      const dailyCall = mockGet.mock.calls.find(
        ([url, cfg]) => url === '/data' && cfg?.params?.datasetid === 'NORMAL_DLY'
      );
      expect(dailyCall).toBeDefined();
      expect(dailyCall![1].params.units).toBe('standard');
      expect(dailyCall![1].params.datatypeid).toEqual(['DLY-TMAX-NORMAL', 'DLY-TMIN-NORMAL']);
      expect(dailyCall![1].params.startdate).toBe('2010-07-15');
    });

    it('should clamp Feb 29 to Feb 28 (reference year is non-leap)', async () => {
      setupHappyPath();
      const service = new NCEIService({ token: 'valid-token' });
      await service.getClimateNormals(47.6062, -122.3321, 2, 29);

      const dailyCall = mockGet.mock.calls.find(
        ([url, cfg]) => url === '/data' && cfg?.params?.datasetid === 'NORMAL_DLY'
      );
      expect(dailyCall![1].params.startdate).toBe('2010-02-28');
    });

    it('should cache results and not re-query on a second identical call', async () => {
      setupHappyPath();
      const service = new NCEIService({ token: 'valid-token' });

      await service.getClimateNormals(47.6062, -122.3321, 7, 15);
      const callsAfterFirst = mockGet.mock.calls.length;
      const second = await service.getClimateNormals(47.6062, -122.3321, 7, 15);

      expect(second.source).toBe('NCEI');
      expect(mockGet.mock.calls.length).toBe(callsAfterFirst); // served from cache
    });
  });

  describe('getClimateNormals - missing data', () => {
    it('should throw DataNotFoundError when no stations are found', async () => {
      setupHappyPath({ stations: [] });
      const service = new NCEIService({ token: 'valid-token' });
      await expect(service.getClimateNormals(40.0, -100.0, 6, 15)).rejects.toThrow(
        /No NCEI normals stations found/
      );
    });

    it('should throw DataNotFoundError when the station lacks temperature normals', async () => {
      setupHappyPath({ tmax: null });
      const service = new NCEIService({ token: 'valid-token' });
      await expect(service.getClimateNormals(47.6062, -122.3321, 7, 15)).rejects.toThrow(
        /No NCEI station with complete normals/
      );
    });

    it('should throw DataNotFoundError when the station lacks precipitation normals', async () => {
      setupHappyPath({ monthlyPrecip: null });
      const service = new NCEIService({ token: 'valid-token' });
      await expect(service.getClimateNormals(47.6062, -122.3321, 7, 15)).rejects.toThrow(
        /No NCEI station with complete normals/
      );
    });

    it('should treat missing-value sentinels (e.g. -7777) as missing', async () => {
      setupHappyPath({ tmax: -7777 });
      const service = new NCEIService({ token: 'valid-token' });
      await expect(service.getClimateNormals(47.6062, -122.3321, 7, 15)).rejects.toThrow(
        DataNotFoundError
      );
    });

    it('should fall through to a second station when the first is incomplete', async () => {
      const near = { ...SEATAC, id: 'GHCND:NEAR', latitude: 47.61, longitude: -122.33 };
      const far = { ...SEATAC, id: 'GHCND:FAR', latitude: 47.7, longitude: -122.4 };
      mockGet.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
        const params = config?.params ?? {};
        if (url === '/stations') return Promise.resolve({ data: { results: [near, far] } });
        if (url === '/data' && params.datasetid === 'NORMAL_DLY') {
          // Nearest station has no temps; far station does.
          if (params.stationid === 'GHCND:NEAR') return Promise.resolve({ data: { results: [] } });
          return Promise.resolve({
            data: { results: [
              { datatype: 'DLY-TMAX-NORMAL', value: 70 },
              { datatype: 'DLY-TMIN-NORMAL', value: 50 }
            ] }
          });
        }
        if (url === '/data' && params.datasetid === 'NORMAL_MLY') {
          return Promise.resolve({ data: { results: [{ datatype: 'MLY-PRCP-NORMAL', value: 1.0 }] } });
        }
        return Promise.resolve({ data: { results: [] } });
      });

      const service = new NCEIService({ token: 'valid-token' });
      const normals = await service.getClimateNormals(47.6062, -122.3321, 6, 15);
      expect(normals.tempHigh).toBe(70);
      expect(normals.tempLow).toBe(50);
      expect(normals.source).toBe('NCEI');
    });
  });

  describe('Error handling interceptor', () => {
    // The service registers an error interceptor; grab it to test error mapping.
    function getErrorInterceptor() {
      new NCEIService({ token: 'token' });
      const lastCall = mockUse.mock.calls[mockUse.mock.calls.length - 1];
      return lastCall[1] as (error: any) => Promise<never>;
    }

    it('should map 429 to RateLimitError', async () => {
      const onRejected = getErrorInterceptor();
      await expect(onRejected({ response: { status: 429, data: {} } })).rejects.toThrow(RateLimitError);
    });

    it('should map 401/403 to ServiceUnavailableError (invalid token)', async () => {
      const onRejected = getErrorInterceptor();
      await expect(onRejected({ response: { status: 401, data: {} } })).rejects.toThrow(
        ServiceUnavailableError
      );
      await expect(onRejected({ response: { status: 403, data: {} } })).rejects.toThrow(
        ServiceUnavailableError
      );
    });

    it('should map 404 to DataNotFoundError', async () => {
      const onRejected = getErrorInterceptor();
      await expect(
        onRejected({ response: { status: 404, data: { message: 'nope' } } })
      ).rejects.toThrow(DataNotFoundError);
    });

    it('should map 5xx to ServiceUnavailableError', async () => {
      const onRejected = getErrorInterceptor();
      await expect(onRejected({ response: { status: 503, data: {} } })).rejects.toThrow(
        ServiceUnavailableError
      );
    });

    it('should map network timeouts to ServiceUnavailableError', async () => {
      const onRejected = getErrorInterceptor();
      await expect(onRejected({ code: 'ETIMEDOUT' })).rejects.toThrow(ServiceUnavailableError);
    });
  });

  describe('Error class metadata', () => {
    it('should tag errors with the NCEI service name', () => {
      expect(new DataNotFoundError('NCEI', 'x').service).toBe('NCEI');
      expect(new RateLimitError('NCEI').service).toBe('NCEI');
      expect(new ServiceUnavailableError('NCEI').service).toBe('NCEI');
    });

    it('should be distinguishable from other services', () => {
      expect(new DataNotFoundError('NCEI', 'x').service).not.toBe(
        new DataNotFoundError('NOAA', 'x').service
      );
    });
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
