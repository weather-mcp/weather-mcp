/**
 * Handler unit tests for `get_current_conditions`'s optional trailing
 * `criticalAlertBanner` flag (T4 of .devdocs/plan-critical-alert-banner-impl.md).
 *
 * Exercises the real `handleGetCurrentConditions` with plain fake services —
 * no HTTP, no live network — following the fake-service pattern in
 * tests/unit/critical-alert-banner.test.ts, tests/unit/current-conditions-global.test.ts
 * and tests/unit/metar-handler.test.ts.
 *
 * Pins:
 *   - Byte-identity on all three live paths — NOAA (US point), Open-Meteo
 *     (non-US point), METAR (`source: 'metar'`) — flag absent vs
 *     `criticalAlertBanner: false` render identically. The 29 pre-existing
 *     call sites all pass `undefined` and must be unaffected by construction.
 *   - The positive METAR case: a US METAR request with a critical alert
 *     active renders the banner. This handler has exactly one `return`
 *     (currentConditionsHandler.ts:235-ish), shared by all three source arms
 *     including the METAR arm that falls through to it — wrapping it there
 *     gives METAR the banner by construction, which is exactly why this test
 *     exists rather than being assumed.
 *   - Ordering, failure posture and not-US, as for the forecast handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { logger } from '../../src/utils/logger.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { AcisService } from '../../src/services/acis.js';
import type { AviationWeatherService } from '../../src/services/aviationWeather.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import type {
  ObservationResponse,
  StationCollectionResponse,
  AlertCollectionResponse,
} from '../../src/types/noaa.js';
import type { BoundingBox, MetarObservation } from '../../src/types/aviationWeather.js';
import type { SavedLocation } from '../../src/types/savedLocations.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Grand Rapids, MI — inside the CONUS routing box; the point critical-alert-banner.test.ts uses. */
const US_COORDS = { latitude: 42.9634, longitude: -85.6681 };

/** Tokyo — outside every US box and the critical-alert US pre-filter. */
const NON_US_COORDS = { latitude: 35.6762, longitude: 139.6503 };

const BANNER_FIRST_LINE = '🚨 **LIFE-THREATENING WEATHER ALERT IN EFFECT: Tornado Warning**';

const TORNADO_WARNING = {
  event: 'Tornado Warning',
  severity: 'Extreme',
  urgency: 'Immediate',
  certainty: 'Observed',
  response: 'Shelter',
  senderName: 'NWS Grand Rapids MI',
  expires: '2026-09-03T16:15:00-04:00',
};

function alertCollection(...features: Array<Record<string, unknown>>): AlertCollectionResponse {
  return {
    type: 'FeatureCollection',
    features: features.map(properties => ({ properties })) as unknown as AlertCollectionResponse['features'],
  };
}

// Fixed clock so NOAA observation age never triggers the staleness/retry path.
const NOW = new Date('2026-09-03T12:30:00Z');
const FRESH_TIMESTAMP = new Date(NOW.getTime() - 30 * 60_000).toISOString();

function buildNOAAObservation(overrides: Record<string, unknown> = {}): ObservationResponse {
  return {
    properties: {
      '@id': 'https://api.weather.gov/stations/KGRR/observations/2026-09-03T12:00:00+00:00',
      '@type': 'wx:ObservationStation',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      station: 'https://api.weather.gov/stations/KGRR',
      timestamp: FRESH_TIMESTAMP,
      textDescription: 'Clear',
      temperature: { unitCode: 'wmoUnit:degC', value: 20 },
      dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
      windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 270 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 10 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
      ...overrides,
    },
  } as unknown as ObservationResponse;
}

function buildNOAAStations(): StationCollectionResponse {
  return {
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          '@id': 'https://api.weather.gov/stations/KGRR',
          '@type': 'wx:ObservationStation',
          elevation: { unitCode: 'wmoUnit:m', value: 10 },
          stationIdentifier: 'KGRR',
          name: 'Test Station',
          timeZone: 'America/Detroit',
        },
      },
    ] as unknown as StationCollectionResponse['features'],
  };
}

/** getAlerts defaults to an empty collection (no banner) unless overridden. */
function buildNoaaFake(getAlerts: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(alertCollection())) {
  return {
    getCurrentConditions: vi.fn().mockResolvedValue(buildNOAAObservation()),
    getStations: vi.fn().mockResolvedValue(buildNOAAStations()),
    getLatestObservation: vi.fn().mockResolvedValue(buildNOAAObservation()),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getAlerts,
  };
}

function buildOpenMeteoCurrentResponse(timezone = 'Asia/Tokyo'): OpenMeteoForecastResponse {
  return {
    latitude: 35.68,
    longitude: 139.65,
    generationtime_ms: 0.1,
    utc_offset_seconds: 32400,
    timezone,
    timezone_abbreviation: 'JST',
    elevation: 40,
    current: {
      time: '2026-09-03T12:00',
      interval: 900,
      temperature_2m: 75,
      relative_humidity_2m: 55,
      apparent_temperature: 75,
      dew_point_2m: 60,
      is_day: 1,
      precipitation: 0,
      rain: 0,
      showers: 0,
      snowfall: 0,
      weather_code: 3,
      cloud_cover: 40,
      pressure_msl: 1012,
      wind_speed_10m: 10,
      wind_direction_10m: 200,
      wind_gusts_10m: 10,
    },
    daily: {
      time: ['2026-09-03'],
      temperature_2m_max: [80],
      temperature_2m_min: [65],
    },
  };
}

function buildOpenMeteoFake(response: OpenMeteoForecastResponse = buildOpenMeteoCurrentResponse()) {
  return {
    getCurrentConditions: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
}

function buildNceiFake() {
  return { isAvailable: vi.fn().mockReturnValue(false) };
}

/** obsTime relative to "now" so the fixture never rots into staleness by clock drift. */
function obsTimeMinutesAgo(ageMinutes: number): number {
  return Math.round((Date.now() - ageMinutes * 60000) / 1000);
}

function buildMetarObservation(overrides: Partial<MetarObservation> = {}): MetarObservation {
  const nowIso = new Date().toISOString();
  return {
    icaoId: 'KGRR',
    name: 'Gerald R. Ford Intl',
    lat: US_COORDS.latitude + 0.01,
    lon: US_COORDS.longitude + 0.01,
    elev: 245,
    obsTime: obsTimeMinutesAgo(20),
    reportTime: nowIso,
    receiptTime: nowIso,
    rawOb: 'METAR KGRR 031653Z 19006KT 10SM FEW250 24/10 A3000',
    metarType: 'METAR',
    qcField: 0,
    temp: 24,
    dewp: 10,
    wdir: 190,
    wspd: 6,
    altim: 1015,
    visib: 10,
    clouds: [{ cover: 'FEW', base: 25000 }],
    fltCat: 'VFR',
    ...overrides,
  };
}

function buildAviationFake(...tierResponses: MetarObservation[][]) {
  const fn = vi.fn<[BoundingBox], Promise<MetarObservation[]>>();
  for (const response of tierResponses) {
    fn.mockResolvedValueOnce(response);
  }
  fn.mockResolvedValue([]);
  return { getMetarsInBoundingBox: fn };
}

function makeLocationStore(locations: Record<string, SavedLocation> = {}): LocationStore {
  return {
    get: (alias: string) => locations[alias.toLowerCase().trim()],
    getAll: () => locations,
  } as unknown as LocationStore;
}

function makeSavedLocation(overrides: Partial<SavedLocation> = {}): SavedLocation {
  return {
    name: 'Grand Rapids, MI',
    latitude: US_COORDS.latitude,
    longitude: US_COORDS.longitude,
    country_code: 'US',
    saved_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as SavedLocation;
}

interface Fakes {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  ncei: ReturnType<typeof buildNceiFake>;
  locationStore: LocationStore;
  geocoding: Record<string, never>;
}

function buildFakes(overrides: Partial<Fakes> = {}): Fakes {
  return {
    noaa: buildNoaaFake(),
    openMeteo: buildOpenMeteoFake(),
    ncei: buildNceiFake(),
    locationStore: makeLocationStore(),
    geocoding: {},
    ...overrides,
  };
}

function call(
  args: Record<string, unknown>,
  fakes: Fakes,
  acisService: AcisService | undefined = undefined,
  aviationWeatherService: AviationWeatherService | undefined = undefined,
  criticalAlertBanner: boolean | undefined = undefined
) {
  return handleGetCurrentConditions(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.ncei as unknown as NCEIService,
    fakes.locationStore,
    fakes.geocoding as unknown as GeocodingService,
    acisService,
    aviationWeatherService,
    criticalAlertBanner
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

describe('handleGetCurrentConditions — criticalAlertBanner (T4)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  // Pinned "now", matching NOW/FRESH_TIMESTAMP above, so the NOAA path's
  // observation-age computation stays inside staleAcceptanceMinutes — the
  // D2c retry loop and its own "Stale NOAA observation" warn never engage
  // and cannot pollute the logger-call-count assertions below.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('byte-identity — flag absent === criticalAlertBanner: false', () => {
    it('renders identically on the NOAA branch (US point)', async () => {
      const fakesAbsent = buildFakes();
      const fakesFalse = buildFakes();

      const resultAbsent = await call({ ...US_COORDS }, fakesAbsent);
      const resultFalse = await call({ ...US_COORDS }, fakesFalse, undefined, undefined, false);

      // G10's inverse half, at unit level: two identical hashes prove nothing
      // until each side is known to have rendered. A fake that failed would make
      // both sides equal and equally empty.
      expect(textOf(resultAbsent)).toContain('# Current Weather Conditions');
      expect(textOf(resultFalse)).toContain('# Current Weather Conditions');

      expect(textOf(resultAbsent)).toBe(textOf(resultFalse));
      expect(fakesAbsent.noaa.getAlerts).not.toHaveBeenCalled();
      expect(fakesFalse.noaa.getAlerts).not.toHaveBeenCalled();
    });

    it('renders identically on the Open-Meteo branch (non-US point)', async () => {
      const fakesAbsent = buildFakes();
      const fakesFalse = buildFakes();

      const resultAbsent = await call({ ...NON_US_COORDS }, fakesAbsent);
      const resultFalse = await call({ ...NON_US_COORDS }, fakesFalse, undefined, undefined, false);

      // G10's inverse half, at unit level: two identical hashes prove nothing
      // until each side is known to have rendered. A fake that failed would make
      // both sides equal and equally empty.
      expect(textOf(resultAbsent)).toContain('# Current Weather Conditions');
      expect(textOf(resultFalse)).toContain('# Current Weather Conditions');

      expect(textOf(resultAbsent)).toBe(textOf(resultFalse));
      expect(fakesAbsent.noaa.getAlerts).not.toHaveBeenCalled();
      expect(fakesFalse.noaa.getAlerts).not.toHaveBeenCalled();
    });

    it('renders identically on the METAR branch (source: "metar")', async () => {
      const fakesAbsent = buildFakes();
      const fakesFalse = buildFakes();
      const aviationAbsent = buildAviationFake([buildMetarObservation()]);
      const aviationFalse = buildAviationFake([buildMetarObservation()]);

      const resultAbsent = await call(
        { ...US_COORDS, source: 'metar' },
        fakesAbsent,
        undefined,
        aviationAbsent as unknown as AviationWeatherService
      );
      const resultFalse = await call(
        { ...US_COORDS, source: 'metar' },
        fakesFalse,
        undefined,
        aviationFalse as unknown as AviationWeatherService,
        false
      );

      // G10's inverse half, at unit level: two identical hashes prove nothing
      // until each side is known to have rendered. A fake that failed would make
      // both sides equal and equally empty.
      expect(textOf(resultAbsent)).toContain('Current Conditions — Gerald R. Ford Intl');
      expect(textOf(resultFalse)).toContain('Current Conditions — Gerald R. Ford Intl');

      expect(textOf(resultAbsent)).toBe(textOf(resultFalse));
      expect(fakesAbsent.noaa.getAlerts).not.toHaveBeenCalled();
      expect(fakesFalse.noaa.getAlerts).not.toHaveBeenCalled();
    });
  });

  it('renders the banner on a US METAR request with a critical alert active (the positive case)', async () => {
    const noaa = buildNoaaFake(vi.fn().mockResolvedValue(alertCollection(TORNADO_WARNING)));
    const fakes = buildFakes({ noaa });
    const aviation = buildAviationFake([buildMetarObservation()]);

    const result = await call(
      { ...US_COORDS, source: 'metar' },
      fakes,
      undefined,
      aviation as unknown as AviationWeatherService,
      true
    );
    const text = textOf(result);

    expect(text).toContain(BANNER_FIRST_LINE);
    expect(text.startsWith('🚨')).toBe(true); // banner is outermost — the very first character
    expect(text).toContain('Current Conditions — Gerald R. Ford Intl');
  });

  it('orders banner before **Location:** before the current-conditions heading, with a critical alert active', async () => {
    const noaa = buildNoaaFake(vi.fn().mockResolvedValue(alertCollection(TORNADO_WARNING)));
    const fakes = buildFakes({
      noaa,
      locationStore: makeLocationStore({ home: makeSavedLocation() }),
    });

    const result = await call({ location_name: 'home' }, fakes, undefined, undefined, true);
    const text = textOf(result);

    const bannerIdx = text.indexOf(BANNER_FIRST_LINE);
    const locationIdx = text.indexOf('**Location:**');
    const headingIdx = text.indexOf('# Current Weather Conditions');

    expect(bannerIdx).toBeGreaterThanOrEqual(0);
    expect(locationIdx).toBeGreaterThan(bannerIdx);
    expect(headingIdx).toBeGreaterThan(locationIdx);
  });

  describe('failure posture', () => {
    it('renders complete current conditions, emits no banner, and logs exactly once when getAlerts rejects', async () => {
      const noaa = buildNoaaFake(vi.fn().mockRejectedValue(new Error('NOAA alerts unavailable')));
      const fakes = buildFakes({ noaa });

      const result = await call({ ...US_COORDS }, fakes, undefined, undefined, true);
      const text = textOf(result);

      expect(text).toContain('*Data source: NOAA National Weather Service*');
      expect(text).not.toContain('LIFE-THREATENING WEATHER ALERT IN EFFECT');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ service: 'NOAA', securityEvent: true })
      );
    });
  });

  describe('not-US', () => {
    it('renders no banner and never calls getAlerts for an Open-Meteo point with the flag on', async () => {
      const fakes = buildFakes();

      const result = await call({ ...NON_US_COORDS }, fakes, undefined, undefined, true);
      const text = textOf(result);

      expect(text).not.toContain('LIFE-THREATENING WEATHER ALERT IN EFFECT');
      expect(fakes.noaa.getAlerts).toHaveBeenCalledTimes(0);
    });
  });
});
