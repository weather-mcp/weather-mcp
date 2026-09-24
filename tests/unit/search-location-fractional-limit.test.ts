/**
 * Locks search_location's handling of a *fractional* `limit` — the schema
 * declares `limit` as `type: 'integer'` (src/server/weatherServer.ts,
 * TOOL_DEFINITIONS.search_location), but nothing stops a caller from sending
 * a float (2.5, 0.5, …). Before this file, a fractional value reached the
 * clamp in handleSearchLocation (src/handlers/locationHandler.ts) unfloored
 * and was forwarded to the geocoders as-is; Nominatim and Open-Meteo reject a
 * non-integer `limit` with an HTTP 400, and the caller saw "No locations
 * found" instead of results. The fix: a fractional value is truncated with
 * Math.floor and then clamped, never rejected — see
 * tests/unit/search-location-limit.test.ts for the sibling lock on the
 * integer-clamp bound this file assumes (that file is not edited here).
 *
 * --- G61 / G21: why this imports weatherServer.js, once, statically ---
 *
 * TOOL_DEFINITIONS now lives in src/server/weatherServer.ts, whose import is
 * inert but for the analytics singleton (loadAnalyticsConfig() builds it at
 * module load and calls getOrGenerateAnalyticsSalt() regardless of
 * ANALYTICS_ENABLED). The two ANALYTICS_* env vars below are hoisted so they
 * land before the static import evaluates, and the import happens exactly
 * once — never re-imported under vi.resetModules(), which would re-construct
 * every service and its Cache timers.
 *
 * --- G70: the seam under test ---
 *
 * handleSearchLocation's only call into geocodingService is `geocode(query,
 * limit)` — this file fakes that one method and reads the forwarded `limit`
 * from geocode.mock.calls[0][1]. No client, no network path exists through
 * the fake.
 */

import { describe, it, expect, vi } from 'vitest';
import type { GeocodingService, GeocodingResult } from '../../src/services/geocoding.js';

// Both must be set before the static import below evaluates — see header.
vi.hoisted(() => {
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'search-location-fractional-limit-test';
});

// Import src/server/weatherServer.js once, statically (G61/G21 residue).
import { TOOL_DEFINITIONS } from '../../src/server/weatherServer.js';
import { handleSearchLocation } from '../../src/handlers/locationHandler.js';

type LimitSchema = {
  type: string;
  minimum: number;
  maximum: number;
};

type SearchLocationDefinition = {
  inputSchema: {
    properties: {
      limit: LimitSchema;
    };
  };
};

const searchLocationDef = (
  TOOL_DEFINITIONS as unknown as { search_location: SearchLocationDefinition }
).search_location;

const { type: limitType, minimum, maximum } = searchLocationDef.inputSchema.properties.limit;

// -----------------------------------------------------------------------
// Positive control — proves minimum/maximum/type above actually came from
// the schema. Without this, a renamed or restructured `limit` property makes
// every comparison below `undefined === undefined` and the whole file passes
// vacuously.
// -----------------------------------------------------------------------

describe('search_location fractional limit (positive control)', () => {
  it('declares limit as an integer schema with integer bounds', () => {
    expect(limitType).toBe('integer');
    expect(Number.isInteger(minimum)).toBe(true);
    expect(Number.isInteger(maximum)).toBe(true);
  });
});

// -----------------------------------------------------------------------
// The fake — the only seam handleSearchLocation calls.
// -----------------------------------------------------------------------

function buildResult(): GeocodingResult {
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
    source: 'nominatim'
  };
}

function makeFake(): { service: GeocodingService; geocode: ReturnType<typeof vi.fn> } {
  const geocode = vi.fn().mockResolvedValue([buildResult()]);
  return { service: { geocode } as unknown as GeocodingService, geocode };
}

// -----------------------------------------------------------------------
// Contracts
// -----------------------------------------------------------------------

describe('search_location fractional limit — truncated with Math.floor, then clamped', () => {
  it('a mid-range fraction truncates toward zero: 2.5 forwards 2', async () => {
    const { service, geocode } = makeFake();

    await handleSearchLocation({ query: 'Springfield', limit: 2.5 }, service);

    expect(geocode.mock.calls[0][1]).toBe(2);
  });

  it('a fraction below the declared minimum still clamps up: 0.5 forwards the declared minimum', async () => {
    const { service, geocode } = makeFake();

    await handleSearchLocation({ query: 'Springfield', limit: 0.5 }, service);

    expect(geocode.mock.calls[0][1]).toBe(minimum);
  });

  it('a fraction above the declared maximum still clamps down: maximum + 0.7 forwards the declared maximum', async () => {
    const { service, geocode } = makeFake();

    await handleSearchLocation({ query: 'Springfield', limit: maximum + 0.7 }, service);

    expect(geocode.mock.calls[0][1]).toBe(maximum);
  });

  it('a fraction just above the declared minimum floors before clamping: minimum + 0.999 forwards the declared minimum', async () => {
    const { service, geocode } = makeFake();

    await handleSearchLocation({ query: 'Springfield', limit: minimum + 0.999 }, service);

    expect(geocode.mock.calls[0][1]).toBe(minimum);
  });

  it('every fractional call resolves rather than rejects, with one location found', async () => {
    for (const candidate of [2.5, 0.5, maximum + 0.7, minimum + 0.999]) {
      const { service } = makeFake();

      await expect(
        handleSearchLocation({ query: 'Springfield', limit: candidate }, service)
      ).resolves.toMatchObject({
        content: [{ text: expect.stringContaining('**Found:** 1 location') }]
      });
    }
  });

  it('the forwarded value is always an integer for fractional input', async () => {
    for (const candidate of [2.5, 0.5, maximum + 0.7, minimum + 0.999]) {
      const { service, geocode } = makeFake();

      await handleSearchLocation({ query: 'Springfield', limit: candidate }, service);

      expect(Number.isInteger(geocode.mock.calls[0][1])).toBe(true);
    }
  });
});
