import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the axios instance used by GeoMetService so no real network calls are
// made. Routes a rejection through the service's own registered error
// interceptor before it reaches makeRequest's retry/catch logic, exactly as
// real axios does internally (mirrors tests/unit/metar-service.test.ts).
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

import { afterEach } from 'vitest';
import { GeoMetService, filterActiveGeoMetAlerts } from '../../src/services/geomet.js';
import type { GeoMetAlertFeature, GeoMetFeatureCollection } from '../../src/types/geomet.js';

/** A small polygon stub — coordinate detail is never consumed by the service. */
const STUB_GEOMETRY = {
  type: 'Polygon',
  coordinates: [[[-79.5, 43.5], [-79.4, 43.5], [-79.4, 43.6], [-79.5, 43.6], [-79.5, 43.5]]]
};

/** A trimmed, hand-edited feature modeled on a live GeoMet capture (2026-08-13). */
function buildFeature(overrides: Partial<GeoMetAlertFeature['properties']> = {}): GeoMetAlertFeature {
  return {
    type: 'Feature',
    id: '1622087161879808596202608130501_fea1-1813',
    geometry: STUB_GEOMETRY,
    properties: {
      alert_code: 'WA',
      alert_type: 'warning',
      alert_name_en: 'heat warning',
      alert_short_name_en: 'Heat',
      alert_text_en: 'A heat warning is in effect. Short trimmed body for tests.',
      feature_name_en: 'City of Toronto',
      province: 'ON',
      status_en: 'active',
      risk_colour_en: 'Orange',
      confidence_en: 'High',
      impact_en: null,
      publication_datetime: '2026-08-13T09:00:00.000Z',
      validity_datetime: '2026-08-13T09:00:00.000Z',
      event_end_datetime: '2026-08-14T03:00:00.000Z',
      expiration_datetime: '2099-01-01T00:00:00.000Z', // far future, never expires in tests
      feature_id: 'fea1-1813',
      ...overrides
    }
  };
}

function jsonResponse(data: GeoMetFeatureCollection) {
  return Promise.resolve({ data, status: 200 });
}

function collection(features: GeoMetAlertFeature[], numberMatched?: number): GeoMetFeatureCollection {
  return {
    type: 'FeatureCollection',
    features,
    numberMatched: numberMatched ?? features.length
  };
}

describe('filterActiveGeoMetAlerts', () => {
  const NOW = new Date('2026-08-13T12:00:00.000Z');

  it('should keep an active, unexpired feature', () => {
    const feature = buildFeature();
    expect(filterActiveGeoMetAlerts([feature], NOW)).toHaveLength(1);
  });

  it('should filter out status_en: "ended" (case-insensitive)', () => {
    const ended = buildFeature({ status_en: 'ended' });
    const endedCaps = buildFeature({ status_en: 'Ended' });
    expect(filterActiveGeoMetAlerts([ended], NOW)).toHaveLength(0);
    expect(filterActiveGeoMetAlerts([endedCaps], NOW)).toHaveLength(0);
  });

  it('should filter out a feature past its expiration_datetime', () => {
    const expired = buildFeature({ expiration_datetime: '2026-08-13T00:00:00.000Z' });
    expect(filterActiveGeoMetAlerts([expired], NOW)).toHaveLength(0);
  });

  it('should keep a feature missing status_en/expiration_datetime entirely', () => {
    const feature = buildFeature({ status_en: undefined, expiration_datetime: undefined });
    expect(filterActiveGeoMetAlerts([feature], NOW)).toHaveLength(1);
  });
});

describe('GeoMetService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUse.mockClear();
  });

  describe('getAlerts', () => {
    it('should map a normal active feature through with its properties', async () => {
      const feature = buildFeature();
      mockGet.mockImplementation(() => jsonResponse(collection([feature])));

      const service = new GeoMetService();
      const alerts = await service.getAlerts(43.6532, -79.3832);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].properties.alert_type).toBe('warning');
      expect(alerts[0].properties.alert_name_en).toBe('heat warning');
      expect(alerts[0].properties.feature_name_en).toBe('City of Toronto');
      expect(alerts[0].properties.province).toBe('ON');
      expect(alerts[0].properties.alert_text_en).toContain('heat warning is in effect');
    });

    it('should send the bbox as ±0.25° around the point with f=json', async () => {
      mockGet.mockImplementation(() => jsonResponse(collection([])));
      const service = new GeoMetService();
      await service.getAlerts(43.6532, -79.3832);

      expect(mockGet).toHaveBeenCalledWith(
        '/collections/weather-alerts/items',
        expect.objectContaining({
          params: {
            bbox: '-79.6332,43.4032,-79.1332,43.9032',
            f: 'json'
          }
        })
      );
    });

    it('should filter out a status_en: "ended" feature (and "Ended")', async () => {
      const ended = buildFeature({ status_en: 'ended', feature_id: 'ended-1' });
      const endedCaps = buildFeature({ status_en: 'Ended', feature_id: 'ended-2' });
      const active = buildFeature({ feature_id: 'active-1' });
      mockGet.mockImplementation(() => jsonResponse(collection([ended, endedCaps, active])));

      const service = new GeoMetService();
      const alerts = await service.getAlerts(43.6532, -79.3832);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].properties.feature_id).toBe('active-1');
    });

    it('should filter out a feature past its expiration_datetime', async () => {
      const expired = buildFeature({
        expiration_datetime: '2000-01-01T00:00:00.000Z',
        feature_id: 'expired-1'
      });
      const active = buildFeature({ feature_id: 'active-1' });
      mockGet.mockImplementation(() => jsonResponse(collection([expired, active])));

      const service = new GeoMetService();
      const alerts = await service.getAlerts(43.6532, -79.3832);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].properties.feature_id).toBe('active-1');
    });

    it('should return [] for a numberMatched: 0 body (happy empty path)', async () => {
      mockGet.mockImplementation(() => jsonResponse(collection([], 0)));

      const service = new GeoMetService();
      const alerts = await service.getAlerts(0, 0);

      expect(alerts).toEqual([]);
    });

    it('should map a feature with missing optional fields without crashing', async () => {
      const sparse: GeoMetAlertFeature = {
        type: 'Feature',
        properties: {}
      };
      mockGet.mockImplementation(() => jsonResponse(collection([sparse])));

      const service = new GeoMetService();
      const alerts = await service.getAlerts(43.6532, -79.3832);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].properties.alert_type).toBeUndefined();
      expect(alerts[0].properties.status_en).toBeUndefined();
    });

    it('should serve a second call with the same rounded coordinates from cache (one HTTP request)', async () => {
      const feature = buildFeature();
      mockGet.mockImplementation(() => jsonResponse(collection([feature])));

      const service = new GeoMetService();
      await service.getAlerts(43.6532, -79.3832);
      const callsAfterFirst = mockGet.mock.calls.length;
      const second = await service.getAlerts(43.6532, -79.3832);

      expect(mockGet.mock.calls.length).toBe(callsAfterFirst);
      expect(second).toHaveLength(1);
    });

    it('should not serve a cached feature past its expiry even without a fresh fetch', async () => {
      // Fetch a feature whose expiration_datetime is already in the past
      // relative to "now" at read time, but was still in the raw cached
      // payload (the cache stores the raw list; filtering is applied on
      // every read, not baked in at fetch time).
      const almostExpired = buildFeature({
        expiration_datetime: new Date(Date.now() + 50).toISOString() // expires in 50ms
      });
      mockGet.mockImplementation(() => jsonResponse(collection([almostExpired])));

      const service = new GeoMetService();
      const first = await service.getAlerts(43.6532, -79.3832);
      expect(first).toHaveLength(1);

      await new Promise(resolve => setTimeout(resolve, 100));

      const second = await service.getAlerts(43.6532, -79.3832);
      expect(second).toHaveLength(0);
      // Still only one HTTP request — served from cache, filtered at read time.
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    function getErrorInterceptor() {
      new GeoMetService();
      const lastCall = mockUse.mock.calls[mockUse.mock.calls.length - 1];
      return lastCall[1] as (error: unknown) => Promise<never>;
    }

    it('should surface a 429 with a retryable "rate limit" message', async () => {
      const onRejected = getErrorInterceptor();
      await expect(
        onRejected({ response: { status: 429, data: {} } })
      ).rejects.toThrow(/rate limit/);
    });

    it('should surface a 5xx with a retryable "server error" message', async () => {
      const onRejected = getErrorInterceptor();
      await expect(
        onRejected({ response: { status: 503, data: {} } })
      ).rejects.toThrow(/server error/);
    });

    it('should map a timeout to a "timed out" message', async () => {
      const onRejected = getErrorInterceptor();
      await expect(onRejected({ code: 'ETIMEDOUT' })).rejects.toThrow(/timed out/);
    });

    it('should map connection errors to a clear message', async () => {
      const onRejected = getErrorInterceptor();
      await expect(onRejected({ code: 'ENOTFOUND' })).rejects.toThrow(/Unable to connect/);
    });

    it('should fall back to a generic message for unrecognized errors', async () => {
      const onRejected = getErrorInterceptor();
      await expect(onRejected('not an object')).rejects.toThrow(/Unknown error/);
    });

    it('should retry a transient 503 and succeed on the second attempt', async () => {
      const feature = buildFeature();
      let call = 0;
      mockGet.mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.reject({ response: { status: 503, data: {} } });
        }
        return jsonResponse(collection([feature]));
      });

      const service = new GeoMetService();
      const alerts = await service.getAlerts(43.6532, -79.3832);

      expect(alerts).toHaveLength(1);
      expect(mockGet).toHaveBeenCalledTimes(2);
    }, 10000);
  });

  describe('retry by class', () => {
    // Fake timers go on AFTER construction (the Cache owns a setInterval) and
    // are driven by advanceTimersByTimeAsync alone (G133).
    const BACKOFF_BUDGET_MS = 30_000;
    const LAT = 43.6532;
    const LON = -79.3832;

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Drive a call to its rejection value (or a sentinel Error on resolution) with fake timers running the backoff. */
    async function settleRejection(start: () => Promise<unknown>): Promise<unknown> {
      vi.useFakeTimers();
      const pending = start().then(
        () => new Error('expected a rejection, got a resolution'),
        (e: unknown) => e
      );
      await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
      return pending;
    }

    /** Sustained failure: every call rejects with the same axios-shaped object. */
    async function failWith(rejection: unknown, config?: { maxRetries?: number }): Promise<Error> {
      mockGet.mockImplementation(() => Promise.reject(rejection));
      const service = new GeoMetService(config);
      const err = await settleRejection(() => service.getAlerts(LAT, LON));
      expect(err).toBeInstanceOf(Error);
      return err as Error;
    }

    // 1. A 503/429 once, then success: retried by status class.
    it.each([
      [503, 'Service Unavailable'],
      [429, 'Too Many Requests']
    ])('should retry a %i once and then resolve with the alert', async (status, message) => {
      let call = 0;
      mockGet.mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.reject({ response: { status, data: { message } } });
        }
        return jsonResponse(collection([buildFeature()]));
      });

      const service = new GeoMetService();
      vi.useFakeTimers();
      const pending = service.getAlerts(LAT, LON);
      await vi.advanceTimersByTimeAsync(BACKOFF_BUDGET_MS);
      const alerts = await pending;

      expect(alerts).toHaveLength(1);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    // 2. Upstream body text is never forwarded.
    it.each([429, 503, 404])(
      'should throw a fixed message for a %i and never forward upstream body text',
      async (status) => {
        const err = await failWith(
          { response: { status, data: { message: 'UPSTREAM-SENTINEL-TEXT' } } },
          { maxRetries: 0 }
        );

        const fixed: Record<number, string> = {
          429: 'GeoMet API returned status 429 (rate limit)',
          503: 'GeoMet API returned status 503 (server error)',
          404: 'GeoMet API returned status 404'
        };
        expect(err.message).toBe(fixed[status]);
        expect(err.message).not.toContain('UPSTREAM-SENTINEL-TEXT');
        expect(err).toMatchObject({ name: 'GeoMetRequestError' });
      }
    );

    // 3. Sustained 5xx exhausts the retry budget.
    it('should retry a sustained 503 maxRetries times and then throw the fixed message', async () => {
      const err = await failWith({ response: { status: 503, data: {} } });

      expect(err.message).toBe('GeoMet API returned status 503 (server error)');
      expect(mockGet).toHaveBeenCalledTimes(4);
    });

    // 4. A timeout is never retried.
    it.each(['ECONNABORTED', 'ETIMEDOUT'])(
      'should not retry a %s timeout',
      async (code) => {
        const err = await failWith({ code });

        expect(err.message).toBe('GeoMet request timed out');
        expect(mockGet).toHaveBeenCalledTimes(1);
      }
    );

    // 5. A bare client-side message is neither retried nor forwarded.
    it('should not retry an object that carries only a message, and must not forward it', async () => {
      const err = await failWith({ message: 'socket hang up at https://api.weather.gc.ca/secret?x=1' });

      expect(err.message).toBe('GeoMet request failed');
      expect(err.message).not.toContain('api.weather.gc.ca');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    // 6. A non-retryable status is not retried.
    it('should not retry a 404', async () => {
      const err = await failWith({
        response: { status: 404, data: { code: 'NotFound', description: 'Collection not found' } }
      });

      expect(err.message).toBe('GeoMet API returned status 404');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    // 8. A failed connection is retried.
    // Every Node/axios transport code for a connection that failed before any
    // answer — not just the two a local dead-port or bad-host probe produces.
    it.each(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH'])(
      'should retry a sustained %s maxRetries times',
      async (code) => {
        const err = await failWith({ code });

        expect(err.message).toBe('Unable to connect to GeoMet API');
        expect(mockGet).toHaveBeenCalledTimes(4);
      }
    );

    it('should not retry an unrecognised transport code', async () => {
      const err = await failWith({ code: 'ERR_SOMETHING_NEW', message: 'boom' });

      expect(err.message).toBe('GeoMet request failed');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    // 9. maxRetries: 0 means one attempt.
    it('should make a single attempt with maxRetries: 0 on a sustained 503', async () => {
      const err = await failWith({ response: { status: 503, data: {} } }, { maxRetries: 0 });

      expect(err.message).toBe('GeoMet API returned status 503 (server error)');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });
});
