/**
 * Sentinel test: proves the national CAP service is threaded from
 * `handleGetWeatherSummary` all the way through to `handleGetAlerts`'s
 * routing (T7). Drives the real `handleGetWeatherSummary` and the real
 * `handleGetAlerts` (neither is mocked) with an `include: ['alerts']`
 * summary for a New Delhi point, so a keyed Google fake and a national CAP
 * fake compete for the same request — the national CAP branch must win.
 *
 * See tests/unit/alerts-national-cap.test.ts for the full routing/rendering
 * coverage of `handleGetAlerts` itself; this file only proves the summary
 * handler's pass-through wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { GoogleWeatherService } from '../../src/services/googleWeather.js';
import type { NationalCapService } from '../../src/services/nationalCap.js';
import type { NationalCapResult } from '../../src/types/cap.js';

const NEW_DELHI = { latitude: 28.61, longitude: 77.21 };

const emptyStore = { get: vi.fn(() => undefined) } as unknown as LocationStore;
const emptyGeocoding = { search: vi.fn(async () => []) } as unknown as GeocodingService;

function makeNominatimFake(country: string | null): NominatimService {
  return { reverseCountry: vi.fn(async () => country) } as unknown as NominatimService;
}

function makeGoogleFake(keyAvailable: boolean): GoogleWeatherService {
  return {
    isKeyAvailable: vi.fn(() => keyAvailable),
    getPublicAlerts: vi.fn(async () => ({ alerts: [], covered: true }))
  } as unknown as GoogleWeatherService;
}

function makeNationalFake(): NationalCapService {
  return {
    getWarnings: vi.fn(async () => {
      return {
        warnings: [],
        unavailableCount: 0,
        polygonUnavailableCount: 0,
        indexTrimmed: false
      } satisfies NationalCapResult;
    })
  } as unknown as NationalCapService;
}

describe('handleGetWeatherSummary — national CAP pass-through', () => {
  it('threads nationalCapService through to alerts routing, ahead of a keyed Google fallback', async () => {
    const nominatim = makeNominatimFake('in');
    const google = makeGoogleFake(true);
    const national = makeNationalFake();

    const result = await handleGetWeatherSummary(
      { ...NEW_DELHI, include: ['alerts'] },
      {} as unknown as NOAAService,
      {} as unknown as OpenMeteoService,
      {} as unknown as NCEIService,
      emptyStore,
      emptyGeocoding,
      undefined, // meteoAlarmService — not reached for an 'in' point
      undefined, // geoMetService — not reached for an 'in' point
      nominatim,
      google,
      national
    );

    const text = result.content[0].text;

    expect(national.getWarnings).toHaveBeenCalledWith('in');
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
    expect(text).toContain('Weather Alerts — India');
  });
});
