/**
 * The summary forwards bare coordinates, so its alerts section used to lose a
 * saved location's `country_code`. A failed reverse lookup at a covered country
 * (Jakarta, BMKG) then rendered the not-covered sentence. Found by the
 * tool-time-budget test drive: once the earlier sections spend the budget, the
 * lookup fails at once, so a slow network reaches this path.
 *
 * `handleGetAlerts` now reads the summary's known country only after the lookup
 * has failed, and only outside the `isInUS` box. These rows pin the fix and both
 * guards. Drives the real summary and alerts handlers; only services are faked.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { NationalCapService } from '../../src/services/nationalCap.js';
import type { NationalCapResult } from '../../src/types/cap.js';
import { ServiceUnavailableError } from '../../src/errors/ApiError.js';

const JAKARTA = { latitude: -6.2088, longitude: 106.8456 };
const SAN_JUAN = { latitude: 18.4655, longitude: -66.1057 };

function storeWith(record: Record<string, unknown>): LocationStore {
  return {
    get: vi.fn(() => record),
    getAll: vi.fn(() => ({ place: record }))
  } as unknown as LocationStore;
}

const savedJakarta = storeWith({ name: 'Jakarta', ...JAKARTA, country_code: 'ID' });
const emptyGeocoding = { search: vi.fn(async () => []) } as unknown as GeocodingService;

function failingNominatim(): NominatimService {
  return {
    reverseCountry: vi.fn(async () => {
      throw new ServiceUnavailableError('Nominatim', 'Nominatim is currently unavailable');
    })
  } as unknown as NominatimService;
}

function nominatimAnswering(country: string | null): NominatimService {
  return { reverseCountry: vi.fn(async () => country) } as unknown as NominatimService;
}

function nationalFake(): NationalCapService {
  return {
    getWarnings: vi.fn(async () => ({
      warnings: [],
      unavailableCount: 0,
      polygonUnavailableCount: 0,
      indexTrimmed: false
    } satisfies NationalCapResult))
  } as unknown as NationalCapService;
}

async function summaryAlerts(
  args: Record<string, unknown>,
  store: LocationStore,
  nominatim: NominatimService,
  national: NationalCapService,
  noaa: NOAAService = {} as unknown as NOAAService
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
    national
  );
  return result.content[0].text;
}

describe('handleGetWeatherSummary — saved country survives a failed reverse lookup', () => {
  it('routes a saved Jakarta to BMKG when the lookup fails, not to the not-covered sentence', async () => {
    const national = nationalFake();
    const text = await summaryAlerts({ location_name: 'place' }, savedJakarta, failingNominatim(), national);

    expect(national.getWarnings).toHaveBeenCalledWith('id');
    expect(text).toContain('Weather Alerts — Indonesia');
    expect(text).not.toContain('not yet available');
    expect(text).not.toContain('routing fell back to coordinate checks');
  });

  it('keeps the reverse answer when the lookup succeeds, so a working lookup is unchanged', async () => {
    const national = nationalFake();
    const nominatim = nominatimAnswering('id');
    await summaryAlerts({ location_name: 'place' }, savedJakarta, nominatim, national);

    expect(nominatim.reverseCountry).toHaveBeenCalledOnce();
    expect(national.getWarnings).toHaveBeenCalledWith('id');
  });

  it('does not override a successful "no country" answer (open water) with the saved code', async () => {
    const national = nationalFake();
    const text = await summaryAlerts({ location_name: 'place' }, savedJakarta, nominatimAnswering(null), national);

    expect(national.getWarnings).not.toHaveBeenCalled();
    expect(text).toContain('not yet available');
  });

  it('leaves coordinates-only input on the old path: no known country, not-covered with the note', async () => {
    const national = nationalFake();
    const emptyStore = { get: vi.fn(() => undefined) } as unknown as LocationStore;
    const text = await summaryAlerts({ ...JAKARTA }, emptyStore, failingNominatim(), national);

    expect(national.getWarnings).not.toHaveBeenCalled();
    expect(text).toContain('routing fell back to coordinate checks');
  });

  it('keeps a US-box point on NOAA after a failed lookup, even with a territory code saved', async () => {
    const getAlerts = vi.fn(async () => ({ features: [] }));
    const noaa = { getAlerts, getStations: vi.fn(async () => ({ features: [] })) } as unknown as NOAAService;
    const national = nationalFake();
    const savedSanJuan = storeWith({ name: 'San Juan', ...SAN_JUAN, country_code: 'PR' });

    await summaryAlerts({ location_name: 'place' }, savedSanJuan, failingNominatim(), national, noaa);

    expect(getAlerts).toHaveBeenCalled();
    expect(national.getWarnings).not.toHaveBeenCalled();
  });
});
