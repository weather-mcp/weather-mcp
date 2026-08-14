import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the axios instance used by NominatimService so no real network calls
// are made. Mirrors the aviationWeather/metar-service mocking template:
// `get` routes a rejection through the service's own registered error
// interceptor before it reaches the service's catch logic, exactly as real
// axios does internally.
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

import { NominatimService } from '../../src/services/nominatim.js';

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({ data, status });
}

/** Live-verified jsonv2 reverse shape for Munich (Verified API contract). */
const MUNICH_RESPONSE = {
  addresstype: 'country',
  address: {
    country: 'Germany',
    country_code: 'de'
  }
};

const OPEN_OCEAN_RESPONSE = {
  error: 'Unable to geocode'
};

describe('NominatimService.reverseCountry', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUse.mockClear();
  });

  it('parses a jsonv2 country response and returns the lowercased country_code', async () => {
    mockGet.mockImplementation(() => jsonResponse(MUNICH_RESPONSE));
    const service = new NominatimService();

    const result = await service.reverseCountry(48.1372, 11.5755);

    expect(result).toBe('de');
    expect(mockGet).toHaveBeenCalledWith(
      '/reverse',
      expect.objectContaining({
        params: expect.objectContaining({
          lat: 48.1372,
          lon: 11.5755,
          format: 'jsonv2',
          zoom: 3
        })
      })
    );
  });

  it('returns null for the open-ocean "Unable to geocode" result (a result, not a failure)', async () => {
    mockGet.mockImplementation(() => jsonResponse(OPEN_OCEAN_RESPONSE));
    const service = new NominatimService();

    const result = await service.reverseCountry(0, -140);

    expect(result).toBeNull();
  });

  it('normalizes an uppercase country_code to lowercase', async () => {
    mockGet.mockImplementation(() =>
      jsonResponse({ address: { country_code: 'DE' } })
    );
    const service = new NominatimService();

    const result = await service.reverseCountry(48.1372, 11.5755);

    expect(result).toBe('de');
  });

  it('returns null when address is present but country_code is missing', async () => {
    mockGet.mockImplementation(() => jsonResponse({ address: {} }));
    const service = new NominatimService();

    const result = await service.reverseCountry(48.1372, 11.5755);

    expect(result).toBeNull();
  });

  describe('caching', () => {
    it('serves a second call at the same rounded key from cache with exactly one HTTP request', async () => {
      mockGet.mockImplementation(() => jsonResponse(MUNICH_RESPONSE));
      const service = new NominatimService();

      const first = await service.reverseCountry(48.1372, 11.5755);
      const second = await service.reverseCountry(48.1372, 11.5755);

      expect(first).toBe('de');
      expect(second).toBe('de');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('shares one cache entry for coordinates differing only past 2 decimals', async () => {
      mockGet.mockImplementation(() => jsonResponse(MUNICH_RESPONSE));
      const service = new NominatimService();

      await service.reverseCountry(48.1372, 11.5755);
      await service.reverseCountry(48.13719999, 11.57550001);

      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('caches a null (open-ocean) result — the second call also makes no HTTP request', async () => {
      mockGet.mockImplementation(() => jsonResponse(OPEN_OCEAN_RESPONSE));
      const service = new NominatimService();

      const first = await service.reverseCountry(0, -140);
      const second = await service.reverseCountry(0, -140);

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('does not share cache entries across distinct rounded coordinates', async () => {
      mockGet.mockImplementation(() => jsonResponse(MUNICH_RESPONSE));
      const service = new NominatimService();

      await service.reverseCountry(48.1372, 11.5755);
      await service.reverseCountry(43.6532, -79.3832); // Toronto-ish

      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('rate limiting', () => {
    it('invokes the 1 req/s limiter (a delay) between two distinct-key requests', async () => {
      mockGet.mockImplementation(() => jsonResponse(MUNICH_RESPONSE));
      const setTimeoutSpy = vi
        .spyOn(global, 'setTimeout')
        // Resolve immediately so the test doesn't actually wait ~1s, while
        // still proving the rate-limit wait path executed.
        .mockImplementation(((fn: (...args: unknown[]) => void) => {
          fn();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout);

      const service = new NominatimService();

      // First call: lastRequestTime starts at 0, so no wait is scheduled.
      await service.reverseCountry(48.1372, 11.5755);
      expect(setTimeoutSpy).not.toHaveBeenCalled();

      // Second call, distinct key: within the 1s window, so enforceRateLimit
      // schedules a wait via setTimeout.
      await service.reverseCountry(43.6532, -79.3832);
      expect(setTimeoutSpy).toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
    });
  });
});
