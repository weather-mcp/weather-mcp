/**
 * Locks search_location's declared `limit` bound
 * (src/server/weatherServer.ts, TOOL_DEFINITIONS.search_location) to the
 * clamp handleSearchLocation (src/handlers/locationHandler.ts) actually
 * honours.
 *
 * Before this file, the schema declared a maximum the handler could not
 * honour (the handler's clamp ceiling was lower than the schema's declared
 * maximum) with no error and no note to the caller — see
 * .devdocs/plan-search-location-limit-bound-impl.md.
 * T1 fixed the schema's `maximum` and its description to match the handler's
 * clamp. T2 (this file) is the lock: every number this file asserts on is
 * read live from TOOL_DEFINITIONS.search_location.inputSchema.properties.limit
 * — never restated as a literal — so a test that hard-codes the bound twice
 * cannot catch the class of defect this plan exists to close. The declared
 * maximum itself never appears as a numeric literal in this file; see the
 * positive control below for why that matters.
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
  process.env.ANALYTICS_SALT = 'search-location-limit-test';
});

// Import src/server/weatherServer.js once, statically (G61/G21 residue).
import { TOOL_DEFINITIONS } from '../../src/server/weatherServer.js';
import { handleSearchLocation } from '../../src/handlers/locationHandler.js';

type LimitSchema = {
  minimum: number;
  maximum: number;
  default: number;
  description: string;
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

const {
  minimum,
  maximum,
  default: declaredDefault,
  description: limitDescription
} = searchLocationDef.inputSchema.properties.limit;

// -----------------------------------------------------------------------
// Positive control — proves the three numbers above actually came from the
// schema. Without this, a renamed or restructured `limit` property makes
// every comparison below `undefined === undefined` and the whole file
// passes vacuously.
// -----------------------------------------------------------------------

describe('search_location limit schema (positive control)', () => {
  it('exposes three finite integers with minimum < default < maximum', () => {
    expect(Number.isInteger(minimum)).toBe(true);
    expect(Number.isInteger(maximum)).toBe(true);
    expect(Number.isInteger(declaredDefault)).toBe(true);
    expect(Number.isFinite(minimum)).toBe(true);
    expect(Number.isFinite(maximum)).toBe(true);
    expect(Number.isFinite(declaredDefault)).toBe(true);
    expect(minimum).toBeLessThan(declaredDefault);
    expect(declaredDefault).toBeLessThan(maximum);
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

describe('search_location limit — declared bound and handler clamp locked together', () => {
  it('the declared maximum is reachable', async () => {
    const { service, geocode } = makeFake();

    await handleSearchLocation({ query: 'Springfield', limit: maximum }, service);

    expect(geocode.mock.calls[0][1]).toBe(maximum);
  });

  it('a limit above the declared maximum clamps to the declared maximum', async () => {
    for (const candidate of [maximum + 1, maximum * 2, 1000, Number.MAX_SAFE_INTEGER]) {
      const { service, geocode } = makeFake();

      await handleSearchLocation({ query: 'Springfield', limit: candidate }, service);

      expect(geocode.mock.calls[0][1]).toBe(maximum);
    }
  });

  it('a limit above the declared maximum resolves rather than rejects', async () => {
    const { service } = makeFake();

    await expect(
      handleSearchLocation({ query: 'Springfield', limit: maximum + 1 }, service)
    ).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('**Found:** 1 location') }]
    });
  });

  it('a limit below the declared minimum clamps up to the declared minimum', async () => {
    for (const candidate of [0, -5]) {
      const { service, geocode } = makeFake();

      await handleSearchLocation({ query: 'Springfield', limit: candidate }, service);

      expect(geocode.mock.calls[0][1]).toBe(minimum);
    }
  });

  it('every declared-legal integer passes through unchanged', async () => {
    for (let candidate = minimum; candidate <= maximum; candidate++) {
      const { service, geocode } = makeFake();

      await handleSearchLocation({ query: 'Springfield', limit: candidate }, service);

      expect(geocode.mock.calls[0][1]).toBe(candidate);
    }
  });

  it('an absent limit resolves to the declared default', async () => {
    const { service: serviceMissing, geocode: geocodeMissing } = makeFake();
    await handleSearchLocation({ query: 'x' }, serviceMissing);
    expect(geocodeMissing.mock.calls[0][1]).toBe(declaredDefault);

    const { service: serviceUndefined, geocode: geocodeUndefined } = makeFake();
    await handleSearchLocation({ query: 'x', limit: undefined }, serviceUndefined);
    expect(geocodeUndefined.mock.calls[0][1]).toBe(declaredDefault);
  });

  it('the description states the same three numbers as the schema declares', () => {
    expect(limitDescription).toBe(
      `Maximum number of results to return (${minimum}-${maximum}, default: ${declaredDefault})`
    );
  });
});
