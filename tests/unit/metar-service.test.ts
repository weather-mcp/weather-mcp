import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the axios instance used by AviationWeatherService so no real network calls are made.
//
// Unlike a bare pass-through mock, `get` here routes a rejection through the
// service's own registered error interceptor before it reaches the
// service's retry/catch logic — exactly as real axios does internally. This
// matters because AviationWeatherService's retry decision is based on the
// *mapped* error type (ServiceUnavailableError vs ApiError), not the raw
// axios rejection shape.
const { mockGet, mockUse } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUse: vi.fn()
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => {
      let errorInterceptor: ((error: unknown) => Promise<never>) | undefined;
      return {
        get: (...args: unknown[]) =>
          mockGet(...args).catch((error: unknown) => {
            if (errorInterceptor) {
              return errorInterceptor(error);
            }
            throw error;
          }),
        defaults: { headers: { common: {} as Record<string, string> } },
        interceptors: {
          response: {
            use: (onFulfilled: unknown, onRejected: (error: unknown) => Promise<never>) => {
              errorInterceptor = onRejected;
              mockUse(onFulfilled, onRejected);
            }
          }
        }
      };
    })
  }
}));

import { AviationWeatherService, clampBoundingBox } from '../../src/services/aviationWeather.js';
import { ApiError, ServiceUnavailableError } from '../../src/errors/ApiError.js';
import type { BoundingBox, MetarObservation } from '../../src/types/aviationWeather.js';

const US_BBOX: BoundingBox = { minLat: 40, minLon: -100, maxLat: 45, maxLon: -95 };

/** A multi-station capture, mirroring the field survey's mixed-shape reality. */
const CAPTURED_STATIONS: MetarObservation[] = [
  {
    icaoId: 'KSEA',
    name: 'Seattle-Tacoma Intl',
    lat: 47.4502,
    lon: -122.3088,
    elev: 130,
    obsTime: 1755100380, // epoch seconds
    reportTime: '2026-08-13T14:53:00Z', // ISO 8601, same observation
    receiptTime: '2026-08-13T14:54:12Z',
    rawOb: 'METAR KSEA 131453Z 19006KT 10SM FEW250 18/12 A2994 RMK AO2',
    metarType: 'METAR',
    qcField: '0',
    temp: 18,
    dewp: 12,
    wdir: 190,
    wspd: 6,
    altim: 1013.9,
    visib: '10+',
    clouds: [{ cover: 'FEW', base: 25000 }],
    fltCat: 'VFR'
  },
  {
    icaoId: 'KBOI',
    name: 'Boise Air Terminal',
    lat: 43.5644,
    lon: -116.2228,
    elev: 874,
    obsTime: 1755100200,
    reportTime: '2026-08-13T14:50:00Z',
    receiptTime: '2026-08-13T14:51:03Z',
    rawOb: 'METAR KBOI 131450Z VRB03KT 1/2SM FG VV002 13/13 A2994 RMK AO2',
    metarType: 'METAR',
    qcField: '0',
    dewp: 13, // temp intentionally missing (1% case)
    wdir: 'VRB',
    wspd: 3,
    altim: 1013.9,
    visib: '1/2',
    fltCat: 'LIFR'
  }
];

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({ data, status });
}

function htmlErrorRejection(status = 502) {
  return Promise.reject({
    response: {
      status,
      data: '<html><head><title>502 Bad Gateway</title></head><body>Bad Gateway</body></html>',
      headers: { 'content-type': 'text/html' }
    }
  });
}

describe('AviationWeatherService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUse.mockClear();
  });

  describe('successful bbox fetch', () => {
    it('should return a captured multi-station shape with mixed types intact', async () => {
      mockGet.mockImplementation(() => jsonResponse(CAPTURED_STATIONS));
      const service = new AviationWeatherService();

      const stations = await service.getMetarsInBoundingBox(US_BBOX);

      expect(stations).toHaveLength(2);

      const [sea, boi] = stations;
      expect(sea.visib).toBe('10+');
      expect(typeof sea.obsTime).toBe('number');
      expect(sea.obsTime).toBe(1755100380);
      expect(sea.reportTime).toBe('2026-08-13T14:53:00Z');

      expect(boi.wdir).toBe('VRB');
      expect(boi.temp).toBeUndefined();
      expect(boi.dewp).toBe(13);
    });

    it('should request the documented endpoint, bbox, and format params', async () => {
      mockGet.mockImplementation(() => jsonResponse(CAPTURED_STATIONS));
      const service = new AviationWeatherService();
      await service.getMetarsInBoundingBox(US_BBOX);

      expect(mockGet).toHaveBeenCalledWith(
        '/metar',
        expect.objectContaining({
          params: expect.objectContaining({
            bbox: '40,-100,45,-95',
            format: 'json'
          })
        })
      );
    });
  });

  describe('HTTP 204 (empty/invalid bbox)', () => {
    it('should return [] without attempting to parse the body', async () => {
      const parseSpy = vi.spyOn(JSON, 'parse');
      mockGet.mockImplementation(() => jsonResponse('', 204));
      const service = new AviationWeatherService();

      const stations = await service.getMetarsInBoundingBox({
        minLat: 10, minLon: 10, maxLat: 10.5, maxLon: 10.5
      });

      expect(stations).toEqual([]);
      expect(parseSpy).not.toHaveBeenCalled();
      parseSpy.mockRestore();
    });

    it('should treat a whitespace-only body the same as empty, regardless of status', async () => {
      mockGet.mockImplementation(() => jsonResponse('   \n', 200));
      const service = new AviationWeatherService();

      await expect(service.getMetarsInBoundingBox(US_BBOX)).resolves.toEqual([]);
    });

    it('should not retry on 204', async () => {
      mockGet.mockImplementation(() => jsonResponse('', 204));
      const service = new AviationWeatherService();
      await service.getMetarsInBoundingBox(US_BBOX);

      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('HTML 502 error body', () => {
    function getErrorInterceptor() {
      new AviationWeatherService();
      const lastCall = mockUse.mock.calls[mockUse.mock.calls.length - 1];
      return lastCall[1] as (error: unknown) => Promise<never>;
    }

    it('should map to ServiceUnavailableError with no raw HTML in the message', async () => {
      const onRejected = getErrorInterceptor();

      let caught: unknown;
      try {
        await onRejected({
          response: {
            status: 502,
            data: '<html><head><title>502 Bad Gateway</title></head><body>Bad Gateway</body></html>',
            headers: { 'content-type': 'text/html' }
          }
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ServiceUnavailableError);
      const message = (caught as Error).message + ' ' + (caught as ServiceUnavailableError).userMessage;
      expect(message.toLowerCase()).not.toContain('<html');
      expect(message).not.toContain('502 Bad Gateway</title>');
    });
  });

  describe('retry behaviour', () => {
    it('should retry a 503 and succeed on the next attempt', async () => {
      let call = 0;
      mockGet.mockImplementation(() => {
        call += 1;
        if (call === 1) {
          return htmlErrorRejection(503);
        }
        return jsonResponse(CAPTURED_STATIONS);
      });

      const service = new AviationWeatherService();
      const stations = await service.getMetarsInBoundingBox(US_BBOX);

      expect(stations).toHaveLength(2);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('should exhaust retries and throw a sanitized ServiceUnavailableError on a sustained 502', async () => {
      mockGet.mockImplementation(() => htmlErrorRejection(502));
      const service = new AviationWeatherService({ maxRetries: 2 });

      await expect(service.getMetarsInBoundingBox(US_BBOX)).rejects.toThrow(ServiceUnavailableError);
      // Initial attempt + 2 retries = 3 calls.
      expect(mockGet).toHaveBeenCalledTimes(3);
    });

    it('should not retry on a 4xx client error', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject({
          response: { status: 400, data: { message: 'bad bbox' }, headers: {} }
        })
      );
      const service = new AviationWeatherService();

      await expect(service.getMetarsInBoundingBox(US_BBOX)).rejects.toThrow(ApiError);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('caching', () => {
    it('should serve a second identical bbox call from cache with exactly one HTTP call', async () => {
      mockGet.mockImplementation(() => jsonResponse(CAPTURED_STATIONS));
      const service = new AviationWeatherService();

      await service.getMetarsInBoundingBox(US_BBOX);
      await service.getMetarsInBoundingBox(US_BBOX);

      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('should not share cache entries across distinct bboxes', async () => {
      mockGet.mockImplementation(() => jsonResponse(CAPTURED_STATIONS));
      const service = new AviationWeatherService();

      await service.getMetarsInBoundingBox(US_BBOX);
      await service.getMetarsInBoundingBox({ minLat: 0, minLon: 0, maxLat: 1, maxLon: 1 });

      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('bbox clamping', () => {
    it('should clamp latitude to ±90 at the poles', () => {
      const clamped = clampBoundingBox({ minLat: -95, minLon: 10, maxLat: 95, maxLon: 20 });
      expect(clamped.minLat).toBe(-90);
      expect(clamped.maxLat).toBe(90);
      expect(clamped.minLat).toBeLessThanOrEqual(clamped.maxLat);
    });

    it('should clamp longitude to ±180 and never invert at the antimeridian', () => {
      const clamped = clampBoundingBox({ minLat: 40, minLon: 175, maxLat: 45, maxLon: -175 });
      expect(clamped.minLon).toBeGreaterThanOrEqual(-180);
      expect(clamped.maxLon).toBeLessThanOrEqual(180);
      expect(clamped.minLon).toBeLessThanOrEqual(clamped.maxLon);
    });

    it('should narrow rather than invert when clamping alone would flip min/max', () => {
      // minLon > maxLon even before clamping — an already-inverted caller input.
      const clamped = clampBoundingBox({ minLat: 0, minLon: 179, maxLat: 1, maxLon: -179 });
      expect(clamped.minLon).toBeLessThanOrEqual(clamped.maxLon);
    });

    it('should emit the clamped bbox in the outgoing query string', async () => {
      mockGet.mockImplementation(() => jsonResponse([]));
      const service = new AviationWeatherService();

      await service.getMetarsInBoundingBox({ minLat: -95, minLon: 170, maxLat: 95, maxLon: 190 });

      const call = mockGet.mock.calls[0];
      const bboxParam = call[1].params.bbox as string;
      const [minLat, minLon, maxLat, maxLon] = bboxParam.split(',').map(Number);
      expect(minLat).toBe(-90);
      expect(maxLat).toBe(90);
      expect(minLon).toBeGreaterThanOrEqual(-180);
      expect(maxLon).toBeLessThanOrEqual(180);
      expect(minLon).toBeLessThanOrEqual(maxLon);
    });
  });

  describe('service initialization', () => {
    it('should create a service with default configuration', () => {
      expect(new AviationWeatherService()).toBeInstanceOf(AviationWeatherService);
    });

    it('should create a service with custom baseURL/timeout/maxRetries', () => {
      expect(
        new AviationWeatherService({ baseURL: 'https://custom.example.com', timeout: 5000, maxRetries: 1 })
      ).toBeInstanceOf(AviationWeatherService);
    });
  });
});
