/**
 * get_alerts routes the US territories to NOAA (RF-28 M1,
 * plan-alert-territory-trim-cancel §1).
 *
 * Two arms, both pinned here through the public handler:
 *   - **Code arm.** A resolved `country_code` in either NWS set
 *     (`src/utils/nwsJurisdiction.ts`) routes to NOAA. The router applies **no**
 *     coordinate box to it, unlike the critical-alert banner: NOAA is the
 *     authority on what NOAA serves, and NWS answered 200 at Pagan on
 *     2026-11-11, outside `isInNwsTerritory`. The Pagan pair proves the code
 *     admitted the point, not the geography.
 *   - **No-country arm.** A point with no country (failed or absent reverse
 *     lookup) routes to NOAA inside `isInUS` **or** `isInNwsTerritory`.
 *
 * Plus the second public path, `get_weather_summary` (G19), and a
 * byte-identity control on the `us` branch.
 *
 * Every fixture states its coordinates and code inline; no helper defaults a
 * country or a point (G95).
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import { ServiceUnavailableError } from '../../src/errors/ApiError.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { GoogleWeatherService } from '../../src/services/googleWeather.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { NationalCapService } from '../../src/services/nationalCap.js';

// ---------------------------------------------------------------------------
// Fakes — every one takes its value explicitly
// ---------------------------------------------------------------------------

function makeNoaaFake(): NOAAService {
  return {
    getStations: vi.fn(async () => ({ features: [] })),
    getAlerts: vi.fn(async () => ({ updated: '2026-11-11T00:00:00Z', features: [] }))
  } as unknown as NOAAService;
}

/** A keyed Google fake: a territory request must never reach it. */
function makeKeyedGoogleFake(): GoogleWeatherService {
  return {
    isKeyAvailable: vi.fn(() => true),
    getPublicAlerts: vi.fn(async () => ({ alerts: [], covered: true }))
  } as unknown as GoogleWeatherService;
}

function nominatimAnswering(country: string | null): NominatimService {
  return { reverseCountry: vi.fn(async () => country) } as unknown as NominatimService;
}

function nominatimFailing(): NominatimService {
  return {
    reverseCountry: vi.fn(async () => {
      throw new ServiceUnavailableError('Nominatim', 'Nominatim is currently unavailable');
    })
  } as unknown as NominatimService;
}

function storeWith(record: Record<string, unknown>): LocationStore {
  return {
    get: vi.fn(() => record),
    getAll: vi.fn(() => ({ place: record }))
  } as unknown as LocationStore;
}

const emptyStore = { get: vi.fn(() => undefined) } as unknown as LocationStore;
const emptyGeocoding = { search: vi.fn(async () => []) } as unknown as GeocodingService;

async function alertsText(
  args: Record<string, unknown>,
  store: LocationStore,
  noaa: NOAAService,
  nominatim: NominatimService | undefined,
  google: GoogleWeatherService | undefined
): Promise<string> {
  const result = await handleGetAlerts(
    args,
    noaa,
    store,
    emptyGeocoding,
    undefined,
    undefined,
    nominatim,
    google
  );
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// Code arm — each territory code, upper and lower case, at its capital
// ---------------------------------------------------------------------------

const TERRITORY_CAPITALS: ReadonlyArray<{ code: string; place: string; latitude: number; longitude: number }> = [
  { code: 'PR', place: 'San Juan', latitude: 18.47, longitude: -66.11 },
  { code: 'GU', place: 'Hagåtña', latitude: 13.47, longitude: 144.75 },
  { code: 'VI', place: 'Charlotte Amalie', latitude: 18.34, longitude: -64.93 },
  { code: 'AS', place: 'Pago Pago', latitude: -14.28, longitude: -170.7 },
  { code: 'MP', place: 'Saipan', latitude: 15.21, longitude: 145.75 }
];

describe('get_alerts — a US-territory country code routes to NOAA', () => {
  for (const t of TERRITORY_CAPITALS) {
    for (const code of [t.code, t.code.toLowerCase()]) {
      it(`routes saved code ${code} at ${t.place} to NOAA, never Google, with a key available`, async () => {
        const noaa = makeNoaaFake();
        const google = makeKeyedGoogleFake();
        const store = storeWith({ name: t.place, latitude: t.latitude, longitude: t.longitude, country_code: code });

        const text = await alertsText({ location_name: 'place' }, store, noaa, undefined, google);

        expect(noaa.getAlerts).toHaveBeenCalledOnce();
        expect(noaa.getAlerts).toHaveBeenCalledWith(t.latitude, t.longitude, true);
        expect(google.getPublicAlerts).not.toHaveBeenCalled();
        expect(text).not.toContain('not yet available');
        expect(text).toContain('*Data source: NOAA National Weather Service*');
      });
    }
  }
});

// ---------------------------------------------------------------------------
// No box on the code arm — the Pagan pair
// ---------------------------------------------------------------------------

/** Northern Marianas, outside `isInNwsTerritory`'s southern arc; NWS answered 200 here on 2026-11-11. */
const PAGAN = { latitude: 18.12, longitude: 145.76 };

describe('get_alerts — the router applies no coordinate box to a territory code', () => {
  it('routes code MP at Pagan (outside isInNwsTerritory) to NOAA', async () => {
    const noaa = makeNoaaFake();
    const google = makeKeyedGoogleFake();
    const store = storeWith({ name: 'Pagan', ...PAGAN, country_code: 'MP' });

    const text = await alertsText({ location_name: 'place' }, store, noaa, undefined, google);

    expect(noaa.getAlerts).toHaveBeenCalledOnce();
    expect(noaa.getAlerts).toHaveBeenCalledWith(PAGAN.latitude, PAGAN.longitude, true);
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
    expect(text).not.toContain('not yet available');
  });

  it('pair: the same Pagan point with no code and no reverse answer is not NOAA (the code admitted it, not the box)', async () => {
    const noaa = makeNoaaFake();

    const text = await alertsText({ ...PAGAN }, emptyStore, noaa, nominatimAnswering(null), undefined);

    expect(noaa.getAlerts).not.toHaveBeenCalled();
    expect(text).toContain('not yet available');
  });

  it('pair, keyed: the same Pagan point with no code goes to Google, not NOAA', async () => {
    const noaa = makeNoaaFake();
    const google = makeKeyedGoogleFake();

    await alertsText({ ...PAGAN }, emptyStore, noaa, nominatimAnswering(null), google);

    expect(noaa.getAlerts).not.toHaveBeenCalled();
    expect(google.getPublicAlerts).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// No-country arm — isInUS || isInNwsTerritory
// ---------------------------------------------------------------------------

const HAGATNA = { latitude: 13.47, longitude: 144.75 };
const PAGO_PAGO = { latitude: -14.28, longitude: -170.7 };
const SYDNEY = { latitude: -33.87, longitude: 151.21 };

describe('get_alerts — a point with no country inside a territory box routes to NOAA', () => {
  for (const [name, point] of [['Hagåtña', HAGATNA], ['Pago Pago', PAGO_PAGO]] as const) {
    it(`routes ${name} to NOAA when the reverse lookup answers no country`, async () => {
      const noaa = makeNoaaFake();
      const google = makeKeyedGoogleFake();

      const text = await alertsText({ ...point }, emptyStore, noaa, nominatimAnswering(null), google);

      expect(noaa.getAlerts).toHaveBeenCalledOnce();
      expect(google.getPublicAlerts).not.toHaveBeenCalled();
      expect(text).not.toContain('not yet available');
    });

    it(`routes ${name} to NOAA with no reverse-lookup service at all`, async () => {
      const noaa = makeNoaaFake();

      const text = await alertsText({ ...point }, emptyStore, noaa, undefined, undefined);

      expect(noaa.getAlerts).toHaveBeenCalledOnce();
      expect(text).not.toContain('not yet available');
    });

    it(`routes ${name} to NOAA when the reverse lookup fails`, async () => {
      const noaa = makeNoaaFake();

      await alertsText({ ...point }, emptyStore, noaa, nominatimFailing(), undefined);

      expect(noaa.getAlerts).toHaveBeenCalledOnce();
    });
  }

  it('control: Sydney with no country is not NOAA, with or without a lookup service', async () => {
    const noaaA = makeNoaaFake();
    const textA = await alertsText({ ...SYDNEY }, emptyStore, noaaA, nominatimAnswering(null), undefined);
    expect(noaaA.getAlerts).not.toHaveBeenCalled();
    expect(textA).toContain('not yet available');

    const noaaB = makeNoaaFake();
    const textB = await alertsText({ ...SYDNEY }, emptyStore, noaaB, undefined, undefined);
    expect(noaaB.getAlerts).not.toHaveBeenCalled();
    expect(textB).toContain('not yet available');
  });
});

// ---------------------------------------------------------------------------
// Second public path: get_weather_summary (G19)
// ---------------------------------------------------------------------------

function nationalFake(): NationalCapService {
  return {
    getWarnings: vi.fn(async () => ({
      warnings: [],
      unavailableCount: 0,
      polygonUnavailableCount: 0,
      indexTrimmed: false
    }))
  } as unknown as NationalCapService;
}

async function summaryAlerts(
  args: Record<string, unknown>,
  store: LocationStore,
  nominatim: NominatimService,
  noaa: NOAAService
): Promise<string> {
  const result = await handleGetWeatherSummary(
    { ...args, include: ['alerts'] },
    noaa,
    {} as unknown as OpenMeteoService,
    {} as unknown as NCEIService,
    store,
    emptyGeocoding,
    undefined,
    undefined,
    nominatim,
    undefined,
    nationalFake()
  );
  return result.content[0].text;
}

describe('get_weather_summary — a saved territory code survives a failed reverse lookup', () => {
  it('renders NOAA alerts at a saved GU Hagåtña when the lookup fails, not the not-covered sentence', async () => {
    const noaa = makeNoaaFake();
    const store = storeWith({ name: 'Hagåtña', ...HAGATNA, country_code: 'GU' });

    const text = await summaryAlerts({ location_name: 'place' }, store, nominatimFailing(), noaa);

    expect(noaa.getAlerts).toHaveBeenCalledOnce();
    expect(noaa.getAlerts).toHaveBeenCalledWith(HAGATNA.latitude, HAGATNA.longitude, true);
    expect(text).not.toContain('not yet available');
  });

  it('renders NOAA alerts at a saved MP Pagan when the lookup fails (code arm, no box)', async () => {
    const noaa = makeNoaaFake();
    const store = storeWith({ name: 'Pagan', ...PAGAN, country_code: 'MP' });

    const text = await summaryAlerts({ location_name: 'place' }, store, nominatimFailing(), noaa);

    expect(noaa.getAlerts).toHaveBeenCalledOnce();
    expect(text).not.toContain('not yet available');
  });
});

// ---------------------------------------------------------------------------
// Byte-identity control on the `us` branch
// ---------------------------------------------------------------------------

/** Captured from `main` @ 01f1810 for exactly this fixture, before the router edit. */
const SEATTLE_US_LITERAL = 
  '**Location:** place (47.6000, -122.3000)\n\n# Weather Alerts\n\n**Location:** 47.6000, -122.3000\n**Status:** Active alerts only\n**Updated:** Nov 10, 2026, 4:00 PM\n\n✅ **No active weather alerts for this location.**\n\nThe area is currently clear of weather warnings, watches, and advisories.\n---\n*Data source: NOAA National Weather Service*\n';

describe('get_alerts — the us branch is byte-identical', () => {
  it('a saved us code at Seattle renders the pre-change text exactly', async () => {
    const noaa = makeNoaaFake();
    const store = storeWith({ name: 'Seattle', latitude: 47.6, longitude: -122.3, country_code: 'us' });

    const text = await alertsText({ location_name: 'place' }, store, noaa, undefined, undefined);

    expect(text).toBe(SEATTLE_US_LITERAL);
  });
});
