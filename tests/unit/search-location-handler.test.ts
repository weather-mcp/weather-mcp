/**
 * Unit tests for `search_location` (handleSearchLocation,
 * src/handlers/locationHandler.ts) pinning that a null `elevation`/
 * `population` on a `GeocodingResult` omits its own line rather than
 * rendering "nullm" or throwing, now that both fields are declared
 * `number | null` (T4, openmeteo-nullable-scalar-types).
 *
 * No existing test file in tests/unit/ covers handleSearchLocation directly
 * (grep for "handleSearchLocation" and "search_location" in tests/unit/
 * before this file returns nothing) — this is new coverage, not an appended
 * lock.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleSearchLocation } from '../../src/handlers/locationHandler.js';
import type { GeocodingService, GeocodingResult } from '../../src/services/geocoding.js';

function buildResult(overrides: Partial<GeocodingResult> = {}): GeocodingResult {
  return {
    name: 'Springfield',
    display_name: 'Springfield, Test County, Testland',
    latitude: 39.78,
    longitude: -89.65,
    country: 'Testland',
    country_code: 'tl',
    admin1: 'Test County',
    timezone: 'America/Chicago',
    confidence: 'high',
    source: 'nominatim',
    ...overrides
  };
}

function buildFakeGeocodingService(result: GeocodingResult): GeocodingService {
  return { geocode: vi.fn().mockResolvedValue([result]) } as unknown as GeocodingService;
}

describe('handleSearchLocation — null elevation/population omit their own line (T6)', () => {
  it('omits Elevation and Population when both are null, and never renders "nullm"', async () => {
    const geocodingService = buildFakeGeocodingService(
      buildResult({ elevation: null, population: null })
    );

    const result = await handleSearchLocation({ query: 'Springfield' }, geocodingService);
    const text = result.content[0].text;

    expect(text).not.toContain('**Elevation:**');
    expect(text).not.toContain('**Population:**');
    expect(text).not.toContain('nullm');
  });

  it('renders both lines, correctly converted, when elevation and population are present', async () => {
    // Population kept under 1,000 so toLocaleString() cannot introduce a
    // locale-dependent thousands separator.
    const geocodingService = buildFakeGeocodingService(
      buildResult({ elevation: 100, population: 42 })
    );

    const result = await handleSearchLocation({ query: 'Springfield' }, geocodingService);
    const text = result.content[0].text;

    expect(text).toContain('**Elevation:** 100m (328ft)');
    expect(text).toContain('**Population:** 42');
  });
});
