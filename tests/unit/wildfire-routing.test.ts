/**
 * Unit tests for get_wildfire_info country routing (T4/T5, global-wildfire
 * feature).
 *
 * Exercises the real handleGetWildfireInfo with plain fake services (no
 * HTTP, no live calls) to prove:
 *   - country routing order matches get_alerts: a country_code already
 *     carried by the resolved location > a cached reverse lookup > isInUS
 *   - the reverse answer wins over isInUS (Toronto canary, inside the
 *     deliberately sloppy CONUS box)
 *   - no cross-fallback between NIFC and FIRMS in either direction
 *   - explicit source overrides bypass country routing entirely
 *   - graceful degradation when nominatimService/firmsService are absent,
 *     or the reverse lookup throws
 *   - the FIRMS renderer's key-rejection fallback, keyless multi-day note,
 *     row-cap truncation caveat, no-detections caveat, and detail="full"
 *     cluster display cap
 *
 * See src/handlers/wildfireHandler.ts and docs/plans/global-wildfire-plan.md D1/D2.
 * Negative-assertion discipline (asserting the wrong-branch service was
 * NEVER called) mirrors tests/unit/river-conditions-global.test.ts and
 * tests/unit/alerts-routing.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import { FIRMSKeyRejectedError } from '../../src/services/firms.js';
import type { FIRMSService } from '../../src/services/firms.js';
import type { NIFCService } from '../../src/services/nifc.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { FIRMSDetection } from '../../src/types/firms.js';
import type { NIFCQueryResponse } from '../../src/types/wildfire.js';
import type { SavedLocation } from '../../src/types/savedLocations.js';

// ---------------------------------------------------------------------------
// Fixture coordinates
// ---------------------------------------------------------------------------

/** Genuinely US, inland (Sacramento). */
const SACRAMENTO = { latitude: 38.5816, longitude: -121.4944 };
/** Genuinely non-US (Lisbon, Portugal — falls inside the FIRMS Europe region box). */
const LISBON = { latitude: 38.72, longitude: -9.14 };
/** Inside the deliberately sloppy CONUS box (isInUS true), but actually Canada. */
const TORONTO = { latitude: 43.65, longitude: -79.38 };

// ---------------------------------------------------------------------------
// Fake service builders — return both the injectable service object and the
// underlying vi.fn()s so tests can assert on calls without re-casting.
// ---------------------------------------------------------------------------

function makeNifcFake(response: NIFCQueryResponse = { features: [] }) {
  const queryFirePerimeters = vi.fn(async () => response);
  const service = { queryFirePerimeters } as unknown as NIFCService;
  return { service, queryFirePerimeters };
}

function makeFirmsFake(opts: {
  keyAvailable?: boolean;
  bboxImpl?: (...args: unknown[]) => Promise<FIRMSDetection[]>;
  regionImpl?: (...args: unknown[]) => Promise<FIRMSDetection[]>;
} = {}) {
  const isKeyAvailable = vi.fn(() => opts.keyAvailable ?? false);
  const getDetectionsByBbox = vi.fn(opts.bboxImpl ?? (async () => []));
  const getDetectionsByRegion = vi.fn(opts.regionImpl ?? (async () => []));
  const service = { isKeyAvailable, getDetectionsByBbox, getDetectionsByRegion } as unknown as FIRMSService;
  return { service, isKeyAvailable, getDetectionsByBbox, getDetectionsByRegion };
}

function makeNominatimFake(impl: (lat: number, lon: number) => Promise<string | null>) {
  const reverseCountry = vi.fn(impl);
  const service = { reverseCountry } as unknown as NominatimService;
  return { service, reverseCountry };
}

/** Coordinates short-circuit resolveLocationAsync, so these are never touched unless noted. */
const emptyStore = {} as unknown as LocationStore;
const emptyGeocoding = {} as unknown as GeocodingService;

function makeDetection(overrides: Partial<FIRMSDetection> = {}): FIRMSDetection {
  return {
    latitude: 0,
    longitude: 0,
    frp: 10,
    confidence: 'nominal',
    acquiredAt: new Date().toISOString(),
    daynight: 'N',
    satellite: 'N',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Country routing (D1)
// ---------------------------------------------------------------------------

describe('handleGetWildfireInfo — country routing (D1)', () => {
  it('routes auto at a US point to NIFC, never touching FIRMS', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake();
    const nominatim = makeNominatimFake(async () => 'us');

    const result = await handleGetWildfireInfo(
      { latitude: SACRAMENTO.latitude, longitude: SACRAMENTO.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(nifc.queryFirePerimeters).toHaveBeenCalledTimes(1);
    expect(firms.getDetectionsByBbox).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain('**Source:** NASA FIRMS');
  });

  it('routes auto at a non-US point to FIRMS, never touching NIFC', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({
      keyAvailable: false,
      regionImpl: async () => [makeDetection({ latitude: LISBON.latitude, longitude: LISBON.longitude })]
    });
    const nominatim = makeNominatimFake(async () => 'pt');

    const result = await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByRegion).toHaveBeenCalled();
    expect(nifc.queryFirePerimeters).not.toHaveBeenCalled();
    const text = result.content[0].text;
    expect(text).toContain('**Source:** NASA FIRMS satellite fire detections');
    expect(text).toContain('⚠️ Satellite heat detections');
  });

  it('honors explicit source: "firms" at a US point, bypassing country routing entirely', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false, regionImpl: async () => [] });
    const nominatim = makeNominatimFake(async () => 'us');

    await handleGetWildfireInfo(
      { latitude: SACRAMENTO.latitude, longitude: SACRAMENTO.longitude, source: 'firms' },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByRegion).toHaveBeenCalledTimes(1);
    expect(nifc.queryFirePerimeters).not.toHaveBeenCalled();
    expect(nominatim.reverseCountry).not.toHaveBeenCalled();
  });

  // F3/D3 updated this expectation: the override is still honoured with no
  // cross-fallback, but the forced branch now resolves the country (cached,
  // country-level) so an empty result discloses NIFC's coverage instead of
  // printing an all-clear over a place NIFC does not watch.
  it('honors explicit source: "nifc" at a non-US point, disclosing coverage rather than an all-clear', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake();
    const nominatim = makeNominatimFake(async () => 'pt');

    const result = await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude, source: 'nifc' },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(nifc.queryFirePerimeters).toHaveBeenCalledTimes(1);
    expect(firms.getDetectionsByBbox).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).not.toHaveBeenCalled();
    expect(nominatim.reverseCountry).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).not.toContain('No active wildfires found');
    expect(result.content[0].text).toContain('United States and its territories only');
  });

  it('does not cross-fall-back to FIRMS when NIFC returns zero features at a US point (auto)', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake();
    const nominatim = makeNominatimFake(async () => 'us');

    const result = await handleGetWildfireInfo(
      { latitude: SACRAMENTO.latitude, longitude: SACRAMENTO.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByBbox).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('No active wildfires found');
  });

  it('calls reverseCountry with the exact coordinates supplied', async () => {
    const nifc = makeNifcFake({ features: [] });
    const nominatim = makeNominatimFake(async () => 'us');

    await handleGetWildfireInfo(
      { latitude: SACRAMENTO.latitude, longitude: SACRAMENTO.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      undefined,
      nominatim.service
    );

    expect(nominatim.reverseCountry).toHaveBeenCalledWith(SACRAMENTO.latitude, SACRAMENTO.longitude);
  });

  it('skips reverseCountry when the resolved location already carries a country_code (saved location, uppercase normalized)', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false, regionImpl: async () => [] });
    const nominatim = makeNominatimFake(async () => 'us'); // would be wrong if consulted

    const savedLocation: SavedLocation = {
      name: 'Toronto, Canada',
      latitude: TORONTO.latitude,
      longitude: TORONTO.longitude,
      country_code: 'CA',
      saved_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    };
    const store = {
      get: vi.fn(() => savedLocation),
      getAll: vi.fn(() => ({ toronto: savedLocation }))
    } as unknown as LocationStore;

    await handleGetWildfireInfo(
      { location_name: 'toronto' },
      nifc.service,
      store,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(nominatim.reverseCountry).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).toHaveBeenCalledTimes(1);
    expect(nifc.queryFirePerimeters).not.toHaveBeenCalled();
  });

  it('routes Toronto (inside the CONUS overrun box) to FIRMS when reverse resolves "ca" (reverse wins over isInUS)', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false, regionImpl: async () => [] });
    const nominatim = makeNominatimFake(async () => 'ca');

    await handleGetWildfireInfo(
      { latitude: TORONTO.latitude, longitude: TORONTO.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByRegion).toHaveBeenCalledTimes(1);
    expect(nifc.queryFirePerimeters).not.toHaveBeenCalled();
  });

  it('falls back to isInUS routing (no note) when reverseCountry resolves null at a US point', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake();
    const nominatim = makeNominatimFake(async () => null);

    const result = await handleGetWildfireInfo(
      { latitude: SACRAMENTO.latitude, longitude: SACRAMENTO.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(nifc.queryFirePerimeters).toHaveBeenCalledTimes(1);
    expect(firms.getDetectionsByBbox).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain('country lookup service was unavailable');
  });

  it('falls back to isInUS routing and appends the fallback note when reverseCountry throws', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake();
    const nominatim = makeNominatimFake(async () => {
      throw new Error('network down');
    });

    const result = await handleGetWildfireInfo(
      { latitude: SACRAMENTO.latitude, longitude: SACRAMENTO.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(nifc.queryFirePerimeters).toHaveBeenCalledTimes(1);
    expect(firms.getDetectionsByBbox).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain(
      '*Note: the country lookup service was unavailable, so routing fell back to coordinate checks.*'
    );
  });

  it('silently falls back to isInUS routing when nominatimService is not provided (no note)', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false, regionImpl: async () => [] });

    const result = await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      undefined
    );

    expect(firms.getDetectionsByRegion).toHaveBeenCalledTimes(1);
    expect(nifc.queryFirePerimeters).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain('country lookup service was unavailable');
  });

  it('falls through to NIFC without crashing when firmsService is absent on a route that would use FIRMS', async () => {
    const nifc = makeNifcFake({ features: [] });
    const nominatim = makeNominatimFake(async () => 'pt');

    const result = await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      undefined,
      nominatim.service
    );

    expect(nifc.queryFirePerimeters).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain('No active wildfires found');
  });

  it('treats an unrecognized source value as auto', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake();
    const nominatim = makeNominatimFake(async () => 'us');

    await handleGetWildfireInfo(
      { latitude: SACRAMENTO.latitude, longitude: SACRAMENTO.longitude, source: 'bogus' },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(nominatim.reverseCountry).toHaveBeenCalledWith(SACRAMENTO.latitude, SACRAMENTO.longitude);
    expect(nifc.queryFirePerimeters).toHaveBeenCalledTimes(1);
    expect(firms.getDetectionsByBbox).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// US territory routing (F2/D2) — WFIGS coverage, not political status.
// Verified live 2026-08-14 against the all-years WFIGS layers: PR/VI/GU carry
// incidents, AS/MP carry none.
// ---------------------------------------------------------------------------

describe('handleGetWildfireInfo — NIFC-covered US territories (F2/D2)', () => {
  it.each([
    ['pr', 'Puerto Rico'],
    ['vi', 'US Virgin Islands'],
    ['gu', 'Guam']
  ])('routes a %s reverse-geocode answer (%s) to NIFC, never FIRMS', async (code) => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false });
    const nominatim = makeNominatimFake(async () => code);

    const result = await handleGetWildfireInfo(
      // San Juan PR — outside every isInUS box except Puerto Rico's, so the
      // reverse answer is what has to carry these cases.
      { latitude: 18.4655, longitude: -66.1057 },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(nifc.queryFirePerimeters).toHaveBeenCalledTimes(1);
    expect(firms.getDetectionsByBbox).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain('**Source:** NASA FIRMS');
    expect(result.content[0].text).toContain('NIFC (National Interagency Fire Center) WFIGS');
  });

  it.each([
    ['as', 'American Samoa'],
    ['mp', 'Northern Mariana Islands']
  ])('routes %s (%s) to FIRMS — WFIGS publishes no incidents there', async (code) => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false });
    const nominatim = makeNominatimFake(async () => code);

    const result = await handleGetWildfireInfo(
      { latitude: -14.28, longitude: -170.7 },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByRegion).toHaveBeenCalled();
    expect(nifc.queryFirePerimeters).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('**Source:** NASA FIRMS');
  });

  it('still routes a non-US country code (gr) to FIRMS', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false });
    const nominatim = makeNominatimFake(async () => 'gr');

    const result = await handleGetWildfireInfo(
      { latitude: 37.98, longitude: 23.73 },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByRegion).toHaveBeenCalled();
    expect(nifc.queryFirePerimeters).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('**Source:** NASA FIRMS');
  });

  it('leaves a bare us answer on the NIFC path, unchanged', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false });
    const nominatim = makeNominatimFake(async () => 'us');

    await handleGetWildfireInfo(
      { latitude: SACRAMENTO.latitude, longitude: SACRAMENTO.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(nifc.queryFirePerimeters).toHaveBeenCalledTimes(1);
    expect(firms.getDetectionsByBbox).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).not.toHaveBeenCalled();
  });

  it('honours an uppercase country_code carried by a saved location (PR)', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false });
    const nominatim = makeNominatimFake(async () => 'zz'); // would be wrong if consulted

    const savedLocation: SavedLocation = {
      name: 'San Juan, Puerto Rico',
      latitude: 18.4655,
      longitude: -66.1057,
      country_code: 'PR',
      saved_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    };
    const store = {
      get: vi.fn(() => savedLocation),
      getAll: vi.fn(() => ({ sanjuan: savedLocation }))
    } as unknown as LocationStore;

    await handleGetWildfireInfo(
      { location_name: 'sanjuan' },
      nifc.service,
      store,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(nominatim.reverseCountry).not.toHaveBeenCalled();
    expect(nifc.queryFirePerimeters).toHaveBeenCalledTimes(1);
    expect(firms.getDetectionsByRegion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Forced-NIFC coverage disclosure (F3/D3) — an empty result outside NIFC
// coverage must never render as an affirmative all-clear.
// ---------------------------------------------------------------------------

describe('handleGetWildfireInfo — forced NIFC outside coverage (F3/D3)', () => {
  /** Athens, Greece. */
  const ATHENS = { latitude: 37.9838, longitude: 23.7275 };

  it('discloses coverage instead of an all-clear for Athens with source: "nifc"', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false });
    const nominatim = makeNominatimFake(async () => 'gr');

    const result = await handleGetWildfireInfo(
      { ...ATHENS, source: 'nifc' },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );
    const text = result.content[0].text;

    // The override is honoured — no cross-fallback to FIRMS.
    expect(nifc.queryFirePerimeters).toHaveBeenCalledTimes(1);
    expect(firms.getDetectionsByBbox).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).not.toHaveBeenCalled();

    expect(text).not.toContain('✅');
    expect(text).not.toContain('currently clear of reported wildfire activity');
    expect(text).toContain('United States and its territories only');
    expect(text).toContain('not an all-clear');
    expect(text).toContain('source: "firms"');

    // Header and radius lines survive.
    expect(text).toContain('# Wildfire Information Report');
    expect(text).toContain('**Search Radius:**');
  });

  it('renders incidents normally if forced NIFC outside coverage somehow returns some', async () => {
    const nifc = makeNifcFake({
      features: [
        {
          attributes: {
            poly_IncidentName: 'Test Fire',
            poly_GISAcres: 100,
            attr_PercentContained: 0,
            attr_IncidentTypeCategory: 'WF',
            attr_InitialLatitude: ATHENS.latitude,
            attr_InitialLongitude: ATHENS.longitude,
            attr_FireDiscoveryDateTime: Date.now()
          }
        }
      ]
    } as unknown as NIFCQueryResponse);
    const firms = makeFirmsFake({ keyAvailable: false });
    const nominatim = makeNominatimFake(async () => 'gr');

    const result = await handleGetWildfireInfo(
      { ...ATHENS, source: 'nifc' },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );
    const text = result.content[0].text;

    expect(text).toContain('Test Fire');
    expect(text).not.toContain('United States and its territories only');
  });

  it('keeps the byte-identical all-clear for a US point with source: "nifc"', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false });
    const nominatim = makeNominatimFake(async () => 'us');

    const result = await handleGetWildfireInfo(
      { ...SACRAMENTO, source: 'nifc' },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );
    const text = result.content[0].text;

    expect(text).toContain('✅ **No active wildfires found within 100 km**');
    expect(text).toContain('The area is currently clear of reported wildfire activity.');
    expect(text).not.toContain('United States and its territories only');
  });

  it('falls back to isInUS when no nominatimService is injected (US coordinates → all-clear)', async () => {
    const nifc = makeNifcFake({ features: [] });

    const result = await handleGetWildfireInfo(
      { ...SACRAMENTO, source: 'nifc' },
      nifc.service,
      emptyStore,
      emptyGeocoding
    );
    const text = result.content[0].text;

    expect(text).toContain('✅ **No active wildfires found within 100 km**');
    expect(text).not.toContain('United States and its territories only');
  });

  it('falls back to isInUS when no nominatimService is injected (non-US coordinates → disclosure)', async () => {
    const nifc = makeNifcFake({ features: [] });

    const result = await handleGetWildfireInfo(
      { ...ATHENS, source: 'nifc' },
      nifc.service,
      emptyStore,
      emptyGeocoding
    );
    const text = result.content[0].text;

    expect(text).not.toContain('✅');
    expect(text).toContain('United States and its territories only');
  });

  it('adds the lookup-failed note and still discloses when the reverse lookup throws outside the US', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false });
    const nominatim = makeNominatimFake(async () => {
      throw new Error('nominatim down');
    });

    const result = await handleGetWildfireInfo(
      { ...ATHENS, source: 'nifc' },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );
    const text = result.content[0].text;

    expect(text).toContain('the country lookup service was unavailable');
    // isInUS(Athens) is false, so the disclosure still applies.
    expect(text).toContain('United States and its territories only');
  });

  it('treats a forced-NIFC US territory (pr) as inside coverage', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false });
    const nominatim = makeNominatimFake(async () => 'pr');

    const result = await handleGetWildfireInfo(
      { latitude: 18.4655, longitude: -66.1057, source: 'nifc' },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );
    const text = result.content[0].text;

    expect(text).toContain('✅ **No active wildfires found within 100 km**');
    expect(text).not.toContain('United States and its territories only');
  });
});

// ---------------------------------------------------------------------------
// FIRMS renderer behavior
// ---------------------------------------------------------------------------

describe('handleGetWildfireInfo — FIRMS renderer', () => {
  it('falls back to the keyless region file and discloses a rejected map key', async () => {
    const detection = makeDetection({ latitude: LISBON.latitude, longitude: LISBON.longitude });
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({
      keyAvailable: true,
      bboxImpl: async () => {
        throw new FIRMSKeyRejectedError();
      },
      regionImpl: async () => [detection]
    });
    const nominatim = makeNominatimFake(async () => 'pt');

    const result = await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByBbox).toHaveBeenCalledTimes(1);
    expect(firms.getDetectionsByRegion).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain(
      '*Note: FIRMS_MAP_KEY was rejected; showing keyless 24-hour data.*'
    );
  });

  it('shows a keyless multi-day note and never calls the bbox API when day_range > 1 without a key', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false, regionImpl: async () => [] });
    const nominatim = makeNominatimFake(async () => 'pt');

    const result = await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude, day_range: 3 },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByBbox).not.toHaveBeenCalled();
    expect(firms.getDetectionsByRegion).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain(
      '*Multi-day detection history requires a free FIRMS_MAP_KEY; showing the last 24 hours.*'
    );
  });

  it('requests day_range + 1 calendar days from getDetectionsByBbox when a key is available', async () => {
    // The Area API counts calendar UTC days including today, while the
    // rendered window is rolling — the handler requests one extra day
    // (capped at the API's max of 5) and filters to the rolling window.
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: true, bboxImpl: async () => [] });
    const nominatim = makeNominatimFake(async () => 'pt');

    await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude, day_range: 3 },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByBbox).toHaveBeenCalledTimes(1);
    const args = firms.getDetectionsByBbox.mock.calls[0];
    expect(args[4]).toBe(4);
  });

  it('caps the keyed fetch at 5 calendar days and filters detections to the rolling window', async () => {
    const nifc = makeNifcFake({ features: [] });
    // One detection inside the rolling 5-day window, one far outside it —
    // only the recent one should survive the window filter.
    const recent = makeDetection({
      latitude: LISBON.latitude,
      longitude: LISBON.longitude,
      acquiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    });
    const stale = makeDetection({
      latitude: LISBON.latitude,
      longitude: LISBON.longitude,
      acquiredAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    });
    const firms = makeFirmsFake({ keyAvailable: true, bboxImpl: async () => [recent, stale] });
    const nominatim = makeNominatimFake(async () => 'pt');

    const result = await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude, day_range: 5 },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    const args = firms.getDetectionsByBbox.mock.calls[0];
    expect(args[4]).toBe(5); // 5 + 1 capped at the API's max of 5
    expect(result.content[0].text).toContain('1 satellite fire detection in the last 5 days');
  });

  it('discloses the 5000-row truncation caveat when in-radius detections exceed the cap', async () => {
    const detections: FIRMSDetection[] = Array.from({ length: 5010 }, () =>
      makeDetection({ latitude: LISBON.latitude, longitude: LISBON.longitude })
    );
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false, regionImpl: async () => detections });
    const nominatim = makeNominatimFake(async () => 'pt');

    const result = await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(result.content[0].text).toContain(
      '*Results may be incomplete — detections were capped at 5000 rows within the search radius.*'
    );
  });

  it('shows the not-all-clear caveat when FIRMS returns zero detections', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: false, regionImpl: async () => [] });
    const nominatim = makeNominatimFake(async () => 'pt');

    const result = await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    const text = result.content[0].text;
    expect(text).toContain('**No satellite fire detections in the last 24 h within');
    expect(text).toContain('absence of detections is not an all-clear');
  });

  it('caps clusters at 5 by default (with a detail="full" pointer) and at 25 for detail="full" (with an accurate remainder note)', async () => {
    // 30 detections spaced 0.05 deg apart in latitude (~5.5 km, well past the
    // 2 km cluster radius), so each forms its own cluster; radius widened to
    // 200 km so all 30 stay within the search radius.
    const detections: FIRMSDetection[] = Array.from({ length: 30 }, (_, i) =>
      makeDetection({ latitude: LISBON.latitude + i * 0.05, longitude: LISBON.longitude })
    );
    const nifc = makeNifcFake({ features: [] });

    async function run(extraArgs: Record<string, unknown>) {
      const firms = makeFirmsFake({ keyAvailable: false, regionImpl: async () => detections });
      const nominatim = makeNominatimFake(async () => 'pt');
      return handleGetWildfireInfo(
        { latitude: LISBON.latitude, longitude: LISBON.longitude, radius: 200, ...extraArgs },
        nifc.service,
        emptyStore,
        emptyGeocoding,
        firms.service,
        nominatim.service
      );
    }

    const defaultResult = await run({});
    const defaultText = defaultResult.content[0].text;
    expect(defaultText).toContain('grouped into 30 clusters');
    expect(defaultText).toContain(
      '*Note: 25 additional clusters found within radius (showing nearest 5 only — use detail="full" for more)*'
    );

    const fullResult = await run({ detail: 'full' });
    const fullText = fullResult.content[0].text;
    expect(fullText).toContain(
      '*Note: 5 additional clusters found within radius (showing nearest 25)*'
    );
  });
});

// ---------------------------------------------------------------------------
// Keyed FIRMS bbox antimeridian splitting (T5/F6/D6)
// ---------------------------------------------------------------------------

describe('handleGetWildfireInfo — keyed FIRMS antimeridian bbox splitting (F6/D6)', () => {
  /** Fiji, near 178°E — a 500 km query's raw window crosses the antimeridian. */
  const FIJI = { latitude: -17.7, longitude: 178 };
  /** Near the north pole — cos(latitude) blows lonOffset well past 180. */
  const POLE_ADJACENT = { latitude: 89, longitude: 0 };

  it('splits a dateline-crossing keyed query into two bbox slices that meet at ±180', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: true, bboxImpl: async () => [] });
    const nominatim = makeNominatimFake(async () => 'fj');

    await handleGetWildfireInfo(
      { latitude: FIJI.latitude, longitude: FIJI.longitude, radius: 500 },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByBbox).toHaveBeenCalledTimes(2);
    const calls = firms.getDetectionsByBbox.mock.calls as unknown as Array<
      [number, number, number, number, number]
    >;

    for (const [west, , east] of calls) {
      expect(west).toBeLessThan(east);
      expect(west).toBeGreaterThanOrEqual(-180);
      expect(west).toBeLessThanOrEqual(180);
      expect(east).toBeGreaterThanOrEqual(-180);
      expect(east).toBeLessThanOrEqual(180);
    }

    // The two slices meet at the antimeridian: one ends at 180, the other
    // starts at -180.
    const easts = calls.map(([, , east]) => east);
    const wests = calls.map(([west]) => west);
    expect(easts).toContain(180);
    expect(wests).toContain(-180);
  });

  it('merges detections returned from both dateline slices before clustering', async () => {
    const nifc = makeNifcFake({ features: [] });
    let callCount = 0;
    const firms = makeFirmsFake({
      keyAvailable: true,
      bboxImpl: async () => {
        callCount += 1;
        // Same coordinates as the query point regardless of which slice
        // returned them — only merging behavior is under test here, not
        // real antimeridian geometry.
        return [
          makeDetection({
            latitude: FIJI.latitude,
            longitude: FIJI.longitude,
            frp: callCount === 1 ? 10 : 20
          })
        ];
      }
    });
    const nominatim = makeNominatimFake(async () => 'fj');

    const result = await handleGetWildfireInfo(
      { latitude: FIJI.latitude, longitude: FIJI.longitude, radius: 500 },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByBbox).toHaveBeenCalledTimes(2);
    expect(result.content[0].text).toContain('2 satellite fire detections');
  });

  it('issues exactly one bbox call, with the unwrapped bbox, for a non-dateline keyed point', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: true, bboxImpl: async () => [] });
    const nominatim = makeNominatimFake(async () => 'pt');

    await handleGetWildfireInfo(
      { latitude: LISBON.latitude, longitude: LISBON.longitude, radius: 500 },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByBbox).toHaveBeenCalledTimes(1);
    const [west, south, east, north] = firms.getDetectionsByBbox.mock.calls[0] as [
      number,
      number,
      number,
      number,
      number
    ];

    const latOffset = 500 / 111;
    const lonOffset = 500 / (111 * Math.cos((LISBON.latitude * Math.PI) / 180));
    expect(west).toBeCloseTo(LISBON.longitude - lonOffset, 6);
    expect(east).toBeCloseTo(LISBON.longitude + lonOffset, 6);
    expect(south).toBeCloseTo(LISBON.latitude - latOffset, 6);
    expect(north).toBeCloseTo(LISBON.latitude + latOffset, 6);
  });

  it('issues a single full-range [-180, 180] longitude span for a pole-adjacent keyed query', async () => {
    const nifc = makeNifcFake({ features: [] });
    const firms = makeFirmsFake({ keyAvailable: true, bboxImpl: async () => [] });
    const nominatim = makeNominatimFake(async () => 'ru');

    await handleGetWildfireInfo(
      { latitude: POLE_ADJACENT.latitude, longitude: POLE_ADJACENT.longitude, radius: 500 },
      nifc.service,
      emptyStore,
      emptyGeocoding,
      firms.service,
      nominatim.service
    );

    expect(firms.getDetectionsByBbox).toHaveBeenCalledTimes(1);
    const [west, , east] = firms.getDetectionsByBbox.mock.calls[0] as [
      number,
      number,
      number,
      number,
      number
    ];
    expect(west).toBe(-180);
    expect(east).toBe(180);
  });
});
