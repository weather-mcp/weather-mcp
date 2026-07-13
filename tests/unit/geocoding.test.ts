/**
 * Unit tests for the multi-service GeocodingService.
 *
 * Regression coverage for the limit=1 geocoding failure: axios encoded spaces as
 * "+", and Nominatim returned zero matches for such "+"-encoded queries at limit=1
 * (e.g. "Clare, MI"). Every city_name lookup (which requests limit=1) therefore
 * failed. The fix forces RFC 3986 (%20) encoding AND requests a result floor from
 * upstream providers before slicing to the caller's limit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the vi.mock factory can reference it safely.
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('axios', () => {
  // Each created client routes .get() through the shared mock, tagged with its
  // baseURL so a test can tell the three providers apart.
  const create = vi.fn((config: { baseURL?: string }) => ({
    get: (path: string, opts: unknown) => getMock(config?.baseURL, path, opts),
  }));
  return {
    default: { create, isAxiosError: () => false },
    isAxiosError: () => false,
  };
});

import { GeocodingService, rfc3986ParamsSerializer } from '../../src/services/geocoding.js';

/** Build N Nominatim-shaped rows. */
function nominatimRows(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    place_id: i,
    lat: `43.${i}`,
    lon: `-84.${i}`,
    name: `Result ${i}`,
    display_name: `Result ${i}, Michigan, United States`,
    importance: 0.5,
    type: 'administrative',
    address: {},
  }));
}

/**
 * Route provider requests by baseURL: Census returns empty, Nominatim returns
 * `nominatimCount` rows, Open-Meteo returns empty. Mirrors a US query where
 * Nominatim is the winning provider.
 */
function routeProviders(nominatimCount: number): void {
  getMock.mockImplementation(async (baseURL: string, _path: string) => {
    if (baseURL.includes('census')) return { data: { result: { addressMatches: [] } } };
    if (baseURL.includes('nominatim')) return { data: nominatimRows(nominatimCount) };
    if (baseURL.includes('open-meteo')) return { data: { results: [] } };
    return { data: [] };
  });
}

describe('rfc3986ParamsSerializer', () => {
  it('encodes spaces as %20 (not +) and commas as %2C', () => {
    // The exact bug: axios default "+" encoding made Nominatim drop limit=1 matches.
    expect(rfc3986ParamsSerializer({ q: 'Clare, MI' })).toBe('q=Clare%2C%20MI');
  });

  it('serializes multiple params and omits undefined/null values', () => {
    const out = rfc3986ParamsSerializer({ q: 'Bend, OR', limit: 5, extra: undefined, other: null });
    expect(out).toBe('q=Bend%2C%20OR&limit=5');
  });
});

describe('GeocodingService.geocode', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('returns a result for a limit=1 US query (regression: city_name lookups)', async () => {
    routeProviders(2);
    const service = new GeocodingService();

    const results = await service.geocode('Clare, MI', 1);

    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe('nominatim');
  });

  it('requests a result floor of 5 from providers even when the caller asks for 1', async () => {
    routeProviders(2);
    const service = new GeocodingService();

    await service.geocode('Clare, MI', 1);

    const nominatimCall = getMock.mock.calls.find((c) => String(c[0]).includes('nominatim'));
    expect(nominatimCall).toBeDefined();
    expect((nominatimCall?.[2] as { params: { limit: number } }).params.limit).toBe(5);
  });

  it('slices provider results down to the caller-requested limit', async () => {
    routeProviders(5);
    const service = new GeocodingService();

    const results = await service.geocode('Clare, MI', 2);

    expect(results).toHaveLength(2);
  });

  it('honors a caller limit larger than the floor', async () => {
    routeProviders(9);
    const service = new GeocodingService();

    const results = await service.geocode('Clare, MI', 8);

    const nominatimCall = getMock.mock.calls.find((c) => String(c[0]).includes('nominatim'));
    expect((nominatimCall?.[2] as { params: { limit: number } }).params.limit).toBe(8);
    expect(results).toHaveLength(8);
  });
});
