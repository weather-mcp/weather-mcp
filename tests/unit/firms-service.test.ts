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
import { FIRMS_PRODUCTS } from '../../src/utils/firmsProducts.js';
import { logger } from '../../src/utils/logger.js';

const N20 = FIRMS_PRODUCTS[0];
const N21 = FIRMS_PRODUCTS[1];

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

      const detections = await service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20);

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
      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20)).rejects.toThrow(
        'FIRMS map key is not configured.'
      );
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('getDetectionsByRegion — flat-file parsing', () => {
    it('parses the 13-column flat-file CSV shape', async () => {
      mockGet.mockImplementation(() => textResponse(FLAT_FILE_CSV));
      const service = new FIRMSService();

      const { detections } = await service.getDetectionsByRegion('Europe', N20);

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

      await service.getDetectionsByRegion('Europe', N20);
      await service.getDetectionsByRegion('Europe', N20);

      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('keys the bbox cache by dayRange', async () => {
      mockGet.mockImplementation(() => textResponse(AREA_API_CSV));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20);
      expect(mockGet).toHaveBeenCalledTimes(1);

      await service.getDetectionsByBbox(-106, 39, -104, 41, 3, N20);
      expect(mockGet).toHaveBeenCalledTimes(2);

      // Repeat the first dayRange — still a cache hit, no new request.
      await service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('error mapping — Area API', () => {
    it('throws FIRMSKeyRejectedError on a 400 with "Invalid MAP_KEY" in the body', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 400, data: 'Invalid MAP_KEY.' }))
      );
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20)).rejects.toThrow(
        FIRMSKeyRejectedError
      );
    });

    it('maps a 400 with a different body to the generic invalid-params message', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject(axiosError({ status: 400, data: 'Some other error' }))
      );
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20)).rejects.toThrow(
        'Invalid query parameters for FIRMS service.'
      );
    });

    it('maps a timeout to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ECONNABORTED' })));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20)).rejects.toThrow(
        'FIRMS service request timed out. The service may be temporarily unavailable.'
      );
    });

    it('maps a 503 to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 503 })));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20)).rejects.toThrow(
        'FIRMS service is temporarily unavailable. Please try again later.'
      );
    });

    it('maps a network error (no response) to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ENOTFOUND' })));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await expect(service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20)).rejects.toThrow(
        'Failed to reach FIRMS service. Please check your network connection.'
      );
    });
  });

  describe('error mapping — flat file', () => {
    it('maps a timeout to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ECONNABORTED' })));
      const service = new FIRMSService();

      await expect(service.getDetectionsByRegion('Europe', N20)).rejects.toThrow(
        'FIRMS service request timed out. The service may be temporarily unavailable.'
      );
    });

    it('maps a 404 to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 404 })));
      const service = new FIRMSService();

      await expect(service.getDetectionsByRegion('Europe', N20)).rejects.toThrow(
        'FIRMS regional data file not found.'
      );
    });

    it('maps a 503 to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 503 })));
      const service = new FIRMSService();

      await expect(service.getDetectionsByRegion('Europe', N20)).rejects.toThrow(
        'FIRMS service is temporarily unavailable. Please try again later.'
      );
    });

    it('maps a network error (no response) to a fixed message', async () => {
      mockGet.mockImplementation(() => Promise.reject(axiosError({ code: 'ENOTFOUND' })));
      const service = new FIRMSService();

      await expect(service.getDetectionsByRegion('Europe', N20)).rejects.toThrow(
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
          await service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20);
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
        await service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20);
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(FIRMSKeyRejectedError);
        expect((error as Error).message).not.toContain(FAKE_KEY);
        expect((error as Error).message).toBe('FIRMS map key was rejected by the service');
      }
    });
  });

  describe('per-product fetch', () => {
    it('fetches one flat file per product, from each product\'s own directory', async () => {
      mockGet.mockImplementation(() => textResponse(FLAT_FILE_CSV));
      const service = new FIRMSService();

      await service.getDetectionsByRegion('Europe', N20);
      await service.getDetectionsByRegion('Europe', N21);

      expect(mockGet).toHaveBeenCalledTimes(2);
      const urls = mockGet.mock.calls.map(c => c[0] as string);
      expect(urls[0]).toBe(
        'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_24h.csv'
      );
      expect(urls[1]).toBe(
        'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Europe_24h.csv'
      );
    });

    it('puts the product id in the Area API URL and in the bbox cache key', async () => {
      mockGet.mockImplementation(() => textResponse(AREA_API_CSV));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20);
      await service.getDetectionsByBbox(-106, 39, -104, 41, 1, N21);

      // Same bbox and dayRange, different product → no cache collision.
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockGet.mock.calls[0][0]).toContain('/VIIRS_NOAA20_NRT/');
      expect(mockGet.mock.calls[1][0]).toContain('/VIIRS_NOAA21_NRT/');
    });
  });

  describe('Last-Modified', () => {
    it('returns the last-modified header with the rows', async () => {
      mockGet.mockImplementation(() =>
        Promise.resolve({
          data: FLAT_FILE_CSV,
          status: 200,
          headers: { 'last-modified': 'Tue, 24 Nov 2026 03:40:47 GMT' }
        })
      );
      const service = new FIRMSService();

      const result = await service.getDetectionsByRegion('Europe', N20);

      expect(result.lastModified).toBe('Tue, 24 Nov 2026 03:40:47 GMT');
      expect(result.detections).toHaveLength(1);
    });

    it('returns lastModified undefined when the response has no headers', async () => {
      mockGet.mockImplementation(() => textResponse(FLAT_FILE_CSV));
      const service = new FIRMSService();

      const result = await service.getDetectionsByRegion('Europe', N20);

      expect(result.lastModified).toBeUndefined();
    });

    it('returns lastModified undefined for an empty header', async () => {
      mockGet.mockImplementation(() =>
        Promise.resolve({ data: FLAT_FILE_CSV, status: 200, headers: { 'last-modified': '' } })
      );
      const service = new FIRMSService();

      const result = await service.getDetectionsByRegion('Europe', N20);

      expect(result.lastModified).toBeUndefined();
    });

    it('a cache hit returns the same lastModified without a new GET', async () => {
      mockGet.mockImplementation(() =>
        Promise.resolve({
          data: FLAT_FILE_CSV,
          status: 200,
          headers: { 'last-modified': 'Thu, 12 Nov 2026 15:49:36 GMT' }
        })
      );
      const service = new FIRMSService();

      await service.getDetectionsByRegion('Europe', N20);
      const second = await service.getDetectionsByRegion('Europe', N20);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second.lastModified).toBe('Thu, 12 Nov 2026 15:49:36 GMT');
    });
  });

  describe('getProductAvailability', () => {
    // The probed 2026-11-24 body shape: header names, no trailing newline.
    const AVAILABILITY_CSV = [
      'data_id,min_date,max_date',
      'MODIS_NRT,2026-08-01,2026-11-24',
      'VIIRS_NOAA20_NRT,2026-08-01,2026-11-24',
      'VIIRS_NOAA21_NRT,2026-08-01,2026-11-24',
      'VIIRS_SNPP_NRT,2026-08-01,2026-11-02'
    ].join('\n');

    it('parses the body into data_id → max_date', async () => {
      mockGet.mockImplementation(() => textResponse(AVAILABILITY_CSV));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      const map = await service.getProductAvailability();

      expect(map?.get('VIIRS_NOAA21_NRT')).toBe('2026-11-24');
      expect(map?.get('VIIRS_SNPP_NRT')).toBe('2026-11-02');
      expect(mockGet.mock.calls[0][0]).toContain('/api/data_availability/csv/');
    });

    it('makes one GET, then serves the cache', async () => {
      mockGet.mockImplementation(() => textResponse(AVAILABILITY_CSV));
      const service = new FIRMSService({ mapKey: FAKE_KEY });

      await service.getProductAvailability();
      const second = await service.getProductAvailability();

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second?.get('VIIRS_NOAA20_NRT')).toBe('2026-11-24');
    });

    it('makes no request and resolves undefined without a key', async () => {
      const service = new FIRMSService({ mapKey: undefined });

      await expect(service.getProductAvailability()).resolves.toBeUndefined();
      expect(mockGet).not.toHaveBeenCalled();
    });

    const failures: Array<[string, () => Promise<unknown>]> = [
      ['401 Invalid MAP_KEY', () => Promise.reject(axiosError({ status: 401, data: 'Invalid MAP_KEY.' }))],
      ['503', () => Promise.reject(axiosError({ status: 503 }))],
      ['timeout', () => Promise.reject(axiosError({ code: 'ECONNABORTED' }))],
      ['ECONNRESET', () => Promise.reject(axiosError({ code: 'ECONNRESET' }))],
      ["data: ''", () => textResponse('')],
      ['header-only body', () => textResponse('data_id,min_date,max_date')]
    ];

    for (const [name, impl] of failures) {
      it(`resolves undefined on ${name}, and does not cache it`, async () => {
        mockGet.mockImplementation(impl);
        const service = new FIRMSService({ mapKey: FAKE_KEY });

        await expect(service.getProductAvailability()).resolves.toBeUndefined();
        await expect(service.getProductAvailability()).resolves.toBeUndefined();

        expect(mockGet).toHaveBeenCalledTimes(2);
      });
    }

    it('marks a rejected key as a security event, and nothing else', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      try {
        mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 401, data: 'Invalid MAP_KEY.' })));
        await new FIRMSService({ mapKey: FAKE_KEY }).getProductAvailability();
        expect(warn).toHaveBeenLastCalledWith('FIRMS data availability check failed', {
          status: 401, code: undefined, securityEvent: true
        });

        mockGet.mockImplementation(() => Promise.reject(axiosError({ status: 503 })));
        await new FIRMSService({ mapKey: FAKE_KEY }).getProductAvailability();
        expect(warn).toHaveBeenLastCalledWith('FIRMS data availability check failed', {
          status: 503, code: undefined
        });
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('key hygiene — every method, every logger channel', () => {
    const failureModes = () => [
      axiosError({ status: 400, data: `Invalid MAP_KEY. ${FAKE_KEY}`, message: `GET /${FAKE_KEY}/x failed` }),
      axiosError({ status: 401, data: 'Invalid MAP_KEY.', message: `GET /${FAKE_KEY}/x failed` }),
      axiosError({ status: 403, message: `GET /${FAKE_KEY}/x failed` }),
      axiosError({ status: 503, message: `GET /${FAKE_KEY}/x failed` }),
      axiosError({ code: 'ECONNABORTED', message: `timeout ${FAKE_KEY}` }),
      axiosError({ code: 'ECONNRESET', message: `reset ${FAKE_KEY}` }),
      new Error(`unexpected non-axios failure ${FAKE_KEY}`)
    ];

    function spyAll() {
      return (['debug', 'info', 'warn', 'error'] as const).map(m =>
        vi.spyOn(logger, m).mockImplementation(() => undefined)
      );
    }

    function serialized(spies: ReturnType<typeof spyAll>): string {
      return spies
        .flatMap(spy => spy.mock.calls)
        .map(args => JSON.stringify(args, (_k, v: unknown) =>
          v instanceof Error ? { message: v.message, stack: v.stack } : v
        ))
        .join('\n');
    }

    it('getProductAvailability never puts the key in a log line, in success or failure', async () => {
      const spies = spyAll();
      try {
        const service = new FIRMSService({ mapKey: FAKE_KEY });
        mockGet.mockImplementation(() => textResponse('data_id,min_date,max_date\nVIIRS_NOAA20_NRT,2026-08-01,2026-11-24'));
        await service.getProductAvailability();
        for (const failure of failureModes()) {
          service.clearCache();
          mockGet.mockReset();
          mockGet.mockImplementation(() => Promise.reject(failure));
          await expect(service.getProductAvailability()).resolves.toBeUndefined();
        }
        expect(serialized(spies)).not.toContain(FAKE_KEY);
      } finally {
        spies.forEach(s => s.mockRestore());
      }
    });

    it('getDetectionsByBbox and getDetectionsByRegion never put the key in a log line or a throw', async () => {
      const spies = spyAll();
      try {
        const service = new FIRMSService({ mapKey: FAKE_KEY });
        mockGet.mockImplementation(() => textResponse(AREA_API_CSV));
        await service.getDetectionsByBbox(-106, 39, -104, 41, 1, N20);
        mockGet.mockImplementation(() => textResponse(FLAT_FILE_CSV));
        await service.getDetectionsByRegion('Europe', N20);

        for (const failure of failureModes()) {
          service.clearCache();
          mockGet.mockReset();
          mockGet.mockImplementation(() => Promise.reject(failure));
          for (const call of [
            () => service.getDetectionsByBbox(-106, 39, -104, 41, 1, N21),
            () => service.getDetectionsByRegion('Europe', N21)
          ]) {
            let thrown: Error | undefined;
            try {
              await call();
            } catch (error) {
              thrown = error as Error;
            }
            expect(thrown).toBeDefined();
            expect(thrown!.message).not.toContain(FAKE_KEY);
            expect(thrown!.stack ?? '').not.toContain(FAKE_KEY);
          }
        }
        expect(serialized(spies)).not.toContain(FAKE_KEY);
      } finally {
        spies.forEach(s => s.mockRestore());
      }
    });
  });
});
