import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the axios instance used by FIRMSService so no real network calls are made.
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

import { FIRMSService, FIRMSKeyRejectedError } from '../../src/services/firms.js';

const FAKE_KEY = 'SECRET_TEST_MAP_KEY_98765';

// --- CSV fixtures -----------------------------------------------------------

// Area API shape (keyed): 14 columns, `instrument` present, confidence
// abbreviated (`n`), unpadded acq_time (`215`).
const AREA_API_CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
  '40.1,-105.2,330.5,0.4,0.4,2026-08-13,215,N,VIIRS,n,2.0NRT,290.1,15.3,D'
].join('\n');

// Flat-file shape (keyless): 13 columns, no `instrument`, confidence spelled
// out (`nominal`), zero-padded acq_time (`0048`).
const FLAT_FILE_CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight',
  '48.2,11.5,325.0,0.4,0.4,2026-08-13,0048,N,nominal,2.0NRT,288.0,9.7,N'
].join('\n');

function textResponse(data: string) {
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

describe('FIRMSService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockCreate.mockClear();
  });

  describe('getDetectionsByBbox — Area API parsing', () => {
    it('parses the 14-column Area API CSV shape', async () => {
      mockGet.mockImplementation(() => textResponse(AREA_API_CSV));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      const detections = await service.getDetectionsByBbox(-106, 39, -104, 41, 1);

      expect(detections).toHaveLength(1);
      expect(detections[0]).toMatchObject({
        latitude: 40.1,
        longitude: -105.2,
        frp: 15.3,
        confidence: 'nominal',
        daynight: 'D',
        satellite: 'N',
        instrument: 'VIIRS',
        acquiredAt: '2026-08-13T02:15:00.000Z'
      });
    });

    it('throws when no map key is configured', async () => {
      const service = new FIRMSService({ mapKey: undefined });
      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1)).rejects.toThrow(
        'FIRMS map key is not configured.'
      );
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('getDetectionsByRegion — flat-file parsing', () => {
    it('parses the 13-column flat-file CSV shape', async () => {
      mockGet.mockImplementation(() => textResponse(FLAT_FILE_CSV));
      const service = new FIRMSService();

      const detections = await service.getDetectionsByRegion('Europe');

      expect(detections).toHaveLength(1);
      expect(detections[0]).toMatchObject({
        latitude: 48.2,
        longitude: 11.5,
        frp: 9.7,
        confidence: 'nominal',
        daynight: 'N',
        satellite: 'N',
        acquiredAt: '2026-08-13T00:48:00.000Z'
      });
      expect(detections[0].instrument).toBeUndefined();
    });
  });

  describe('caching', () => {
    it('caches parsed rows per region file — two calls make one HTTP request', async () => {
      mockGet.mockImplementation(() => textResponse(FLAT_FILE_CSV));
      const service = new FIRMSService();

      await service.getDetectionsByRegion('Europe');
      await service.getDetectionsByRegion('Europe');

      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('keys the bbox cache by dayRange', async () => {
      mockGet.mockImplementation(() => textResponse(AREA_API_CSV));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await service.getDetectionsByBbox(-106, 39, -104, 41, 1);
      expect(mockGet).toHaveBeenCalledTimes(1);

      await service.getDetectionsByBbox(-106, 39, -104, 41, 3);
      expect(mockGet).toHaveBeenCalledTimes(2);

      // Repeat the first dayRange — still a cache hit, no new request.
      await service.getDetectionsByBbox(-106, 39, -104, 41, 1);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('error mapping — Area API', () => {
    it('throws FIRMSKeyRejectedError on a 400 with "Invalid MAP_KEY" in the body', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 400, data: 'Invalid MAP_KEY.' }))
      );
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1)).rejects.toThrow(
        FIRMSKeyRejectedError
      );
    });

    it('maps a 400 with a different body to the generic invalid-params message', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 400, data: 'Some other error' }))
      );
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1)).rejects.toThrow(
        'Invalid query parameters for FIRMS service.'
      );
    });

    it('maps a timeout to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ECONNABORTED' })));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1)).rejects.toThrow(
        'FIRMS service request timed out. The service may be temporarily unavailable.'
      );
    });

    it('maps a 503 to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 503 })));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1)).rejects.toThrow(
        'FIRMS service is temporarily unavailable. Please try again later.'
      );
    });

    it('maps a network error (no response) to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ENOTFOUND' })));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1)).rejects.toThrow(
        'Failed to reach FIRMS service. Please check your network connection.'
      );
    });
  });

  describe('error mapping — flat file', () => {
    it('maps a timeout to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ECONNABORTED' })));
      const service = new FIRMSService();

      await expect(service.getDetectionsByRegion('Europe')).rejects.toThrow(
        'FIRMS service request timed out. The service may be temporarily unavailable.'
      );
    });

    it('maps a 404 to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 404 })));
      const service = new FIRMSService();

      await expect(service.getDetectionsByRegion('Europe')).rejects.toThrow(
        'FIRMS regional data file not found.'
      );
    });

    it('maps a 503 to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 503 })));
      const service = new FIRMSService();

      await expect(service.getDetectionsByRegion('Europe')).rejects.toThrow(
        'FIRMS service is temporarily unavailable. Please try again later.'
      );
    });

    it('maps a network error (no response) to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ENOTFOUND' })));
      const service = new FIRMSService();

      await expect(service.getDetectionsByRegion('Europe')).rejects.toThrow(
        'Failed to reach FIRMS service. Please check your network connection.'
      );
    });
  });

  describe('key hygiene', () => {
    it('never includes the map key in any thrown error message across every failure mode', async () => {
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      const failureModes = [
        axiosError({ status: 400, data: 'Invalid MAP_KEY.' }),
        axiosError({ status: 400, data: 'Some other error' }),
        axiosError({ status: 401, data: 'Invalid MAP_KEY.' }),
        axiosError({ status: 401, data: 'unauthorized' }),
        axiosError({ status: 503 }),
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
          await service.getDetectionsByBbox(-106, 39, -104, 41, 1);
        } catch (error) {
          thrown = error as Error;
        }

        expect(thrown).toBeDefined();
        expect(thrown!.message).not.toContain(FAKE_KEY);
        expect(thrown!.stack ?? '').not.toContain(FAKE_KEY);
      }
    });

    it('the FIRMSKeyRejectedError message never contains the rejected key', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 400, data: `Invalid MAP_KEY. Key was: ${FAKE_KEY}` }))
      );
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      try {
        await service.getDetectionsByBbox(-106, 39, -104, 41, 1);
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(FIRMSKeyRejectedError);
        expect((error as Error).message).not.toContain(FAKE_KEY);
        expect((error as Error).message).toBe('FIRMS map key was rejected by the service');
      }
    });
  });
});
