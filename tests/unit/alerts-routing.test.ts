/**
 * Unit tests for get_alerts country routing and international rendering
 * (international-alerts feature, T8).
 *
 * Exercises handleGetAlerts with plain fake services (no HTTP, no live
 * calls) to prove:
 *   - D1 routing order: resolved country_code > reverse lookup > isInUS
 *     fallback, with the reverse answer winning over isInUS (Toronto/
 *     Vancouver canary)
 *   - the "country lookup service was unavailable" note appears only when
 *     the reverse lookup actually throws
 *   - MeteoAlarm/GeoMet active_only:false notes (D6)
 *   - MeteoAlarm detail display caps (D5): standard=10, full=25, summary=counts
 *
 * See docs/plans/international-alerts-plan.md D1, D5, D6.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { MeteoAlarmService } from '../../src/services/meteoalarm.js';
import type { GeoMetService } from '../../src/services/geomet.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { MeteoAlarmWarning } from '../../src/types/meteoalarm.js';
import type { GeoMetAlertFeature } from '../../src/types/geomet.js';
import type { SavedLocation } from '../../src/types/savedLocations.js';

// ---------------------------------------------------------------------------
// Fixture coordinates
// ---------------------------------------------------------------------------

/** Inside the deliberately sloppy CONUS box, but actually Canada. */
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
/** Also inside the CONUS box, also actually Canada. */
const VANCOUVER = { latitude: 49.28, longitude: -123.12 };
/** Genuinely US, coastal (marine alert preservation case). */
const SEATTLE = { latitude: 47.6, longitude: -122.3 };
/** Outside the CONUS box and not a MeteoAlarm member. */
const SYDNEY = { latitude: -33.87, longitude: 151.21 };

// ---------------------------------------------------------------------------
// Fake service builders
// ---------------------------------------------------------------------------

function makeNoaaFake(): NOAAService {
  return {
    getStations: vi.fn(async () => ({ features: [] })),
    getAlerts: vi.fn(async () => ({ updated: '2026-08-13T00:00:00Z', features: [] }))
  } as unknown as NOAAService;
}

function makeGeoMetFake(alerts: GeoMetAlertFeature[] = []): GeoMetService {
  return {
    getAlerts: vi.fn(async () => alerts)
  } as unknown as GeoMetService;
}

function makeMeteoAlarmFake(warnings: MeteoAlarmWarning[] = []): MeteoAlarmService {
  return {
    getWarnings: vi.fn(async () => warnings)
  } as unknown as MeteoAlarmService;
}

function makeNominatimFake(impl: (lat: number, lon: number) => Promise<string | null>): NominatimService {
  return {
    reverseCountry: vi.fn(impl)
  } as unknown as NominatimService;
}

const emptyStore = {} as unknown as LocationStore;
const emptyGeocoding = {} as unknown as GeocodingService;

function makeWarning(overrides: Partial<MeteoAlarmWarning> = {}): MeteoAlarmWarning {
  return {
    identifier: 'w-1',
    references: [],
    areaDesc: [],
    event: 'Heat Warning',
    severity: 'Moderate',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('get_alerts country routing (D1)', () => {
  it('routes Toronto to GeoMet, not NOAA, when reverse lookup resolves "ca" (reverse wins over isInUS)', async () => {
    const noaa = makeNoaaFake();
    const geomet = makeGeoMetFake();
    const nominatim = makeNominatimFake(async () => 'ca');

    const result = await handleGetAlerts(
      TORONTO,
      noaa,
      emptyStore,
      emptyGeocoding,
      undefined,
      geomet,
      nominatim
    );

    expect(geomet.getAlerts).toHaveBeenCalledWith(TORONTO.latitude, TORONTO.longitude);
    expect(noaa.getAlerts).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('Canada');
  });

  it('routes Vancouver to GeoMet as well (second canary point inside the CONUS box)', async () => {
    const noaa = makeNoaaFake();
    const geomet = makeGeoMetFake();
    const nominatim = makeNominatimFake(async () => 'ca');

    await handleGetAlerts(VANCOUVER, noaa, emptyStore, emptyGeocoding, undefined, geomet, nominatim);

    expect(geomet.getAlerts).toHaveBeenCalledWith(VANCOUVER.latitude, VANCOUVER.longitude);
    expect(noaa.getAlerts).not.toHaveBeenCalled();
  });

  it('a coordinate-only request consults the reverse-country service with the given coordinates', async () => {
    const noaa = makeNoaaFake();
    const nominatim = makeNominatimFake(async () => 'us');

    await handleGetAlerts(SEATTLE, noaa, emptyStore, emptyGeocoding, undefined, undefined, nominatim);

    expect(nominatim.reverseCountry).toHaveBeenCalledWith(SEATTLE.latitude, SEATTLE.longitude);
  });

  it('a resolved country_code from a saved location (uppercase) skips reverse entirely and routes to MeteoAlarm', async () => {
    const noaa = makeNoaaFake();
    const meteoAlarm = makeMeteoAlarmFake();
    const nominatim = makeNominatimFake(async () => 'us'); // would be wrong if consulted

    const savedLocation: SavedLocation = {
      name: 'Berlin, Germany',
      latitude: 52.52,
      longitude: 13.405,
      country_code: 'DE',
      saved_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    };
    const store = {
      get: vi.fn(() => savedLocation),
      getAll: vi.fn(() => ({ berlin: savedLocation }))
    } as unknown as LocationStore;

    const result = await handleGetAlerts(
      { location_name: 'berlin' },
      noaa,
      store,
      emptyGeocoding,
      meteoAlarm,
      undefined,
      nominatim
    );

    expect(nominatim.reverseCountry).not.toHaveBeenCalled();
    expect(meteoAlarm.getWarnings).toHaveBeenCalledWith('de');
    expect(result.content[0].text).toContain('Germany');
  });

  it('reverse returns null on a US point falls back to isInUS and calls NOAA (marine/coastal preservation)', async () => {
    const noaa = makeNoaaFake();
    const nominatim = makeNominatimFake(async () => null);

    const result = await handleGetAlerts(SEATTLE, noaa, emptyStore, emptyGeocoding, undefined, undefined, nominatim);

    expect(noaa.getAlerts).toHaveBeenCalledWith(SEATTLE.latitude, SEATTLE.longitude, true);
    expect(result.content[0].text).not.toContain('country lookup service was unavailable');
  });

  it('reverse returns null on a non-US point renders the not-covered message with no "unavailable" note', async () => {
    const noaa = makeNoaaFake();
    const nominatim = makeNominatimFake(async () => null);

    const result = await handleGetAlerts(SYDNEY, noaa, emptyStore, emptyGeocoding, undefined, undefined, nominatim);

    const text = result.content[0].text;
    expect(text).toContain('not yet available');
    expect(text).not.toContain('country lookup service was unavailable');
    expect(noaa.getAlerts).not.toHaveBeenCalled();
  });

  it('reverse lookup throwing on a non-US point renders the not-covered message WITH the unavailable note', async () => {
    const noaa = makeNoaaFake();
    const nominatim = makeNominatimFake(async () => {
      throw new Error('network down');
    });

    const result = await handleGetAlerts(SYDNEY, noaa, emptyStore, emptyGeocoding, undefined, undefined, nominatim);

    const text = result.content[0].text;
    expect(text).toContain('not yet available');
    expect(text).toContain('country lookup service was unavailable');
  });

  it('no nominatimService passed at all, on a US point, silently falls back to NOAA with no note', async () => {
    const noaa = makeNoaaFake();

    const result = await handleGetAlerts(SEATTLE, noaa, emptyStore, emptyGeocoding);

    expect(noaa.getAlerts).toHaveBeenCalledWith(SEATTLE.latitude, SEATTLE.longitude, true);
    expect(result.content[0].text).not.toContain('country lookup service was unavailable');
  });

  it('a non-member country (Australia) renders the not-covered message naming the country', async () => {
    const noaa = makeNoaaFake();
    const nominatim = makeNominatimFake(async () => 'au');

    const result = await handleGetAlerts(SYDNEY, noaa, emptyStore, emptyGeocoding, undefined, undefined, nominatim);

    const text = result.content[0].text;
    expect(text).toContain('Australia');
    expect(text).toContain('not yet available');
    expect(noaa.getAlerts).not.toHaveBeenCalled();
  });
});

describe('get_alerts active_only semantics on the new sources (D6)', () => {
  it('active_only:false on MeteoAlarm renders a note that historical alerts are not available', async () => {
    const noaa = makeNoaaFake();
    const meteoAlarm = makeMeteoAlarmFake([makeWarning()]);
    const nominatim = makeNominatimFake(async () => 'de');

    const result = await handleGetAlerts(
      { latitude: 52.52, longitude: 13.405, active_only: false },
      noaa,
      emptyStore,
      emptyGeocoding,
      meteoAlarm,
      undefined,
      nominatim
    );

    expect(result.content[0].text).toContain('historical alerts are not available for this region');
  });

  it('active_only:false on GeoMet renders a note that historical alerts are not available', async () => {
    const noaa = makeNoaaFake();
    const geomet = makeGeoMetFake([]);
    const nominatim = makeNominatimFake(async () => 'ca');

    const result = await handleGetAlerts(
      { ...TORONTO, active_only: false },
      noaa,
      emptyStore,
      emptyGeocoding,
      undefined,
      geomet,
      nominatim
    );

    expect(result.content[0].text).toContain('historical alerts are not available for this region');
  });
});

describe('get_alerts MeteoAlarm detail display caps (D5)', () => {
  function makeWarnings(count: number): MeteoAlarmWarning[] {
    return Array.from({ length: count }, (_, i) =>
      makeWarning({ identifier: `w-${i}`, event: `Warning ${i}`, severity: 'Minor' })
    );
  }

  it('standard shows exactly 10 warnings plus a remainder note when 11 are returned', async () => {
    const noaa = makeNoaaFake();
    const meteoAlarm = makeMeteoAlarmFake(makeWarnings(11));
    const nominatim = makeNominatimFake(async () => 'de');

    const result = await handleGetAlerts(
      { latitude: 52.52, longitude: 13.405, detail: 'standard' },
      noaa,
      emptyStore,
      emptyGeocoding,
      meteoAlarm,
      undefined,
      nominatim
    );

    const text = result.content[0].text;
    const occurrences = text.match(/\*\*Warning \d+\*\*/g) ?? [];
    expect(occurrences.length).toBe(10);
    expect(text).toMatch(/and \d+ more warning/);
  });

  it('full shows exactly 25 warnings plus a remainder note when 26 are returned', async () => {
    const noaa = makeNoaaFake();
    const meteoAlarm = makeMeteoAlarmFake(makeWarnings(26));
    const nominatim = makeNominatimFake(async () => 'de');

    const result = await handleGetAlerts(
      { latitude: 52.52, longitude: 13.405, detail: 'full' },
      noaa,
      emptyStore,
      emptyGeocoding,
      meteoAlarm,
      undefined,
      nominatim
    );

    const text = result.content[0].text;
    const occurrences = text.match(/\*\*Warning \d+\*\*/g) ?? [];
    expect(occurrences.length).toBe(25);
    expect(text).toMatch(/and \d+ more warning/);
  });

  it('summary shows counts only, no per-warning blocks', async () => {
    const noaa = makeNoaaFake();
    const meteoAlarm = makeMeteoAlarmFake(makeWarnings(11));
    const nominatim = makeNominatimFake(async () => 'de');

    const result = await handleGetAlerts(
      { latitude: 52.52, longitude: 13.405, detail: 'summary' },
      noaa,
      emptyStore,
      emptyGeocoding,
      meteoAlarm,
      undefined,
      nominatim
    );

    const text = result.content[0].text;
    expect(text).toContain('**By severity:**');
    expect(text).not.toMatch(/\*\*Warning \d+\*\*/);
  });
});
