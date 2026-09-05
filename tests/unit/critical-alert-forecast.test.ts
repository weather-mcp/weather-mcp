/**
 * Handler unit tests for `get_forecast`'s optional trailing `criticalAlertBanner`
 * flag (T4 of .devdocs/plan-critical-alert-banner-impl.md).
 *
 * Exercises the real `handleGetForecast` with plain fake services — no HTTP,
 * no live network — following the fake-service pattern in
 * tests/unit/critical-alert-banner.test.ts and tests/unit/forecast-fallback.test.ts.
 *
 * Pins:
 *   - Byte-identity: flag absent === `criticalAlertBanner: false`, on both the
 *     NOAA branch (US point) and the Open-Meteo branch (non-US point) — the
 *     23 pre-existing call sites all pass `undefined` and must render exactly
 *     as before (CLAUDE.md "existing output must stay byte-identical").
 *   - Ordering: banner, then `**Location:**`, then the `# Weather Forecast`
 *     heading — the banner is prepended last (outermost).
 *   - Failure posture: a rejected `getAlerts` still renders a complete
 *     forecast, emits no banner, and logs exactly once with
 *     `securityEvent: true` (the failure is swallowed inside
 *     `resolveCriticalAlertBanner`, not re-thrown into the forecast path).
 *   - Not-US: the flag being on at a non-US point renders no banner and never
 *     calls `getAlerts` at all — the US pre-filter in
 *     `resolveCriticalAlertBanner` short-circuits before any request.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { criticalAlertBannerFromError } from '../../src/handlers/criticalAlertBanner.js';
import { logger } from '../../src/utils/logger.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import type { ForecastPeriod, AlertCollectionResponse } from '../../src/types/noaa.js';
import type { SavedLocation } from '../../src/types/savedLocations.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Grand Rapids, MI — inside the CONUS routing box, so auto-routes to NOAA.
 * Same point critical-alert-banner.test.ts uses for its US fixture. */
const US_COORDS = { latitude: 42.9634, longitude: -85.6681 };

/** Tokyo — outside every US box, so auto-routes to Open-Meteo and is outside
 * the critical-alert US pre-filter too. */
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

function buildNoaaPoints(timeZone = 'America/Detroit') {
  return {
    properties: {
      gridId: 'GRR',
      gridX: 1,
      gridY: 1,
      timeZone,
    },
  };
}

function buildForecastPeriod(overrides: Partial<ForecastPeriod> = {}): ForecastPeriod {
  return {
    number: 1,
    name: 'Today',
    startTime: '2026-09-03T06:00:00-04:00',
    endTime: '2026-09-03T18:00:00-04:00',
    isDaytime: true,
    temperature: 75,
    temperatureUnit: 'F',
    temperatureTrend: null,
    probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: null },
    dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
    relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    windSpeed: '5 mph',
    windDirection: 'N',
    icon: '',
    shortForecast: 'Sunny',
    detailedForecast: 'Sunny throughout.',
    ...overrides,
  } as ForecastPeriod;
}

function buildNoaaForecastResponse(periods: ForecastPeriod[]) {
  return {
    properties: {
      updated: '2026-09-03T00:00:00-04:00',
      units: 'us',
      forecastGenerator: 'test',
      generatedAt: '2026-09-03T00:00:00-04:00',
      updateTime: '2026-09-03T00:00:00-04:00',
      validTimes: '2026-09-03T00:00:00-04:00/P7D',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      periods,
    },
  };
}

/** getAlerts defaults to an empty collection (no banner) unless overridden. */
function buildNoaaFake(getAlerts: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(alertCollection())) {
  return {
    getPointData: vi.fn().mockResolvedValue(buildNoaaPoints()),
    getForecast: vi.fn().mockResolvedValue(buildNoaaForecastResponse([buildForecastPeriod()])),
    getHourlyForecast: vi.fn().mockResolvedValue(buildNoaaForecastResponse([buildForecastPeriod()])),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getAlerts,
  };
}

function buildOpenMeteoForecastResponse(): OpenMeteoForecastResponse {
  return {
    latitude: 35.68,
    longitude: 139.65,
    generationtime_ms: 0.1,
    utc_offset_seconds: 32400,
    timezone: 'Asia/Tokyo',
    timezone_abbreviation: 'JST',
    elevation: 40,
    daily: {
      time: ['2026-09-03', '2026-09-04'],
      temperature_2m_max: [82, 80],
      temperature_2m_min: [70, 68],
    },
  };
}

function buildOpenMeteoFake(response: OpenMeteoForecastResponse = buildOpenMeteoForecastResponse()) {
  return {
    getForecast: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
}

function buildNceiFake() {
  return { isAvailable: vi.fn().mockReturnValue(false) };
}

/** A minimal LocationStore stub, mirroring tests/unit/locationResolver.test.ts. */
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

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

describe('handleGetForecast — criticalAlertBanner (T4)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('byte-identity — flag absent === criticalAlertBanner: false', () => {
    it('renders identically on the NOAA branch (US point)', async () => {
      const fakesAbsent = buildFakes();
      const fakesFalse = buildFakes();

      const resultAbsent = await handleGetForecast(
        { ...US_COORDS },
        fakesAbsent.noaa as unknown as NOAAService,
        fakesAbsent.openMeteo as unknown as OpenMeteoService,
        fakesAbsent.locationStore,
        fakesAbsent.geocoding as unknown as GeocodingService,
        fakesAbsent.ncei as unknown as NCEIService,
        undefined
        // criticalAlertBanner omitted entirely
      );

      const resultFalse = await handleGetForecast(
        { ...US_COORDS },
        fakesFalse.noaa as unknown as NOAAService,
        fakesFalse.openMeteo as unknown as OpenMeteoService,
        fakesFalse.locationStore,
        fakesFalse.geocoding as unknown as GeocodingService,
        fakesFalse.ncei as unknown as NCEIService,
        undefined,
        false
      );

      // G10's inverse half, at unit level: two identical hashes prove nothing
      // until each side is known to have rendered. A fake that failed would make
      // both sides equal and equally empty.
      expect(textOf(resultAbsent)).toContain('# Weather Forecast');
      expect(textOf(resultFalse)).toContain('# Weather Forecast');

      expect(textOf(resultAbsent)).toBe(textOf(resultFalse));
      // The short-circuit must fire before any await — no fetch either way.
      expect(fakesAbsent.noaa.getAlerts).not.toHaveBeenCalled();
      expect(fakesFalse.noaa.getAlerts).not.toHaveBeenCalled();
    });

    it('renders identically on the Open-Meteo branch (non-US point)', async () => {
      const fakesAbsent = buildFakes();
      const fakesFalse = buildFakes();

      const resultAbsent = await handleGetForecast(
        { ...NON_US_COORDS },
        fakesAbsent.noaa as unknown as NOAAService,
        fakesAbsent.openMeteo as unknown as OpenMeteoService,
        fakesAbsent.locationStore,
        fakesAbsent.geocoding as unknown as GeocodingService,
        fakesAbsent.ncei as unknown as NCEIService,
        undefined
      );

      const resultFalse = await handleGetForecast(
        { ...NON_US_COORDS },
        fakesFalse.noaa as unknown as NOAAService,
        fakesFalse.openMeteo as unknown as OpenMeteoService,
        fakesFalse.locationStore,
        fakesFalse.geocoding as unknown as GeocodingService,
        fakesFalse.ncei as unknown as NCEIService,
        undefined,
        false
      );

      // G10's inverse half, at unit level: two identical hashes prove nothing
      // until each side is known to have rendered. A fake that failed would make
      // both sides equal and equally empty.
      expect(textOf(resultAbsent)).toContain('# Weather Forecast');
      expect(textOf(resultFalse)).toContain('# Weather Forecast');

      expect(textOf(resultAbsent)).toBe(textOf(resultFalse));
      expect(fakesAbsent.noaa.getAlerts).not.toHaveBeenCalled();
      expect(fakesFalse.noaa.getAlerts).not.toHaveBeenCalled();
    });
  });

  it('orders banner before **Location:** before the forecast heading, with a critical alert active', async () => {
    const noaa = buildNoaaFake(vi.fn().mockResolvedValue(alertCollection(TORNADO_WARNING)));
    const fakes = buildFakes({
      noaa,
      locationStore: makeLocationStore({ home: makeSavedLocation() }),
    });

    const result = await handleGetForecast(
      { location_name: 'home', criticalAlertBanner: true } as unknown as Record<string, unknown>,
      fakes.noaa as unknown as NOAAService,
      fakes.openMeteo as unknown as OpenMeteoService,
      fakes.locationStore,
      fakes.geocoding as unknown as GeocodingService,
      fakes.ncei as unknown as NCEIService,
      undefined,
      true
    );
    const text = textOf(result);

    const bannerIdx = text.indexOf(BANNER_FIRST_LINE);
    const locationIdx = text.indexOf('**Location:**');
    const headingIdx = text.indexOf('# Weather Forecast');

    expect(bannerIdx).toBeGreaterThanOrEqual(0);
    expect(locationIdx).toBeGreaterThan(bannerIdx);
    expect(headingIdx).toBeGreaterThan(locationIdx);

    // G11 — read the whole rendered string, not just the assertions above.
    // eslint-disable-next-line no-console
    console.log('--- forecast with banner (read for G11) ---\n' + text);
  });

  describe('failure posture', () => {
    it('renders a complete forecast, emits no banner, and logs exactly once when getAlerts rejects', async () => {
      const noaa = buildNoaaFake(vi.fn().mockRejectedValue(new Error('NOAA alerts unavailable')));
      const fakes = buildFakes({ noaa });

      const result = await handleGetForecast(
        { ...US_COORDS },
        fakes.noaa as unknown as NOAAService,
        fakes.openMeteo as unknown as OpenMeteoService,
        fakes.locationStore,
        fakes.geocoding as unknown as GeocodingService,
        fakes.ncei as unknown as NCEIService,
        undefined,
        true
      );
      const text = textOf(result);

      // A known body marker — proof the forecast rendered completely, not
      // merely that nothing threw.
      expect(text).toContain('*Data source: NOAA National Weather Service (US)*');
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

      const result = await handleGetForecast(
        { ...NON_US_COORDS },
        fakes.noaa as unknown as NOAAService,
        fakes.openMeteo as unknown as OpenMeteoService,
        fakes.locationStore,
        fakes.geocoding as unknown as GeocodingService,
        fakes.ncei as unknown as NCEIService,
        undefined,
        true
      );
      const text = textOf(result);

      expect(text).not.toContain('LIFE-THREATENING WEATHER ALERT IN EFFECT');
      expect(fakes.noaa.getAlerts).toHaveBeenCalledTimes(0);
    });
  });
});

/**
 * BLOCKER-1 (diff review, 2026-09-03): the banner used to be resolved only
 * after the forecast body completed, so any provider throw suppressed a live
 * warning — `getAlerts` was never called at all. The banner is now started
 * before the forecast and awaited on both paths.
 *
 * The assertion that actually pins the regression is `getAlerts` having been
 * called: a test that only checks the thrown error would still pass against the
 * old ordering if the error happened to carry nothing.
 */
describe('handleGetForecast — a failed forecast must not suppress the banner (BLOCKER-1)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A NOAA fake whose forecast fails with an error the auto-fallback does not
   * swallow (a plain Error is neither DataNotFoundError nor InvalidLocationError). */
  function buildFailingNoaaFake(getAlerts: ReturnType<typeof vi.fn>) {
    const fake = buildNoaaFake(getAlerts);
    fake.getForecast = vi.fn().mockRejectedValue(new Error('upstream gridpoint failure'));
    return fake;
  }

  async function catchError(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('expected the forecast to reject, but it resolved');
  }

  it('still fetches alerts when the forecast throws, and carries the banner on the error', async () => {
    const getAlerts = vi.fn().mockResolvedValue(alertCollection(TORNADO_WARNING));
    const fakes = buildFakes({ noaa: buildFailingNoaaFake(getAlerts) });

    const error = await catchError(
      handleGetForecast(
        { ...US_COORDS },
        fakes.noaa as unknown as NOAAService,
        fakes.openMeteo as unknown as OpenMeteoService,
        fakes.locationStore,
        fakes.geocoding as unknown as GeocodingService,
        fakes.ncei as unknown as NCEIService,
        undefined,
        true
      )
    );

    // The regression itself: the old ordering never reached this call.
    expect(getAlerts).toHaveBeenCalledTimes(1);
    expect(criticalAlertBannerFromError(error)).toContain(BANNER_FIRST_LINE);
  });

  it('rethrows the original error untouched when no critical alert is active', async () => {
    const getAlerts = vi.fn().mockResolvedValue(alertCollection());
    const fakes = buildFakes({ noaa: buildFailingNoaaFake(getAlerts) });

    const error = await catchError(
      handleGetForecast(
        { ...US_COORDS },
        fakes.noaa as unknown as NOAAService,
        fakes.openMeteo as unknown as OpenMeteoService,
        fakes.locationStore,
        fakes.geocoding as unknown as GeocodingService,
        fakes.ncei as unknown as NCEIService,
        undefined,
        true
      )
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('upstream gridpoint failure');
    expect(criticalAlertBannerFromError(error)).toBe('');
  });

  it('carries nothing when the flag is absent, so the error contract is unchanged', async () => {
    const getAlerts = vi.fn().mockResolvedValue(alertCollection(TORNADO_WARNING));
    const fakes = buildFakes({ noaa: buildFailingNoaaFake(getAlerts) });

    const error = await catchError(
      handleGetForecast(
        { ...US_COORDS },
        fakes.noaa as unknown as NOAAService,
        fakes.openMeteo as unknown as OpenMeteoService,
        fakes.locationStore,
        fakes.geocoding as unknown as GeocodingService,
        fakes.ncei as unknown as NCEIService,
        undefined
        // criticalAlertBanner omitted entirely
      )
    );

    // No flag means no fetch at all, exactly as before — the failure path adds
    // no request to the 23 pre-existing call sites.
    expect(getAlerts).not.toHaveBeenCalled();
    expect(criticalAlertBannerFromError(error)).toBe('');
    expect((error as Error).message).toBe('upstream gridpoint failure');
  });

  it('omits the banner silently when the forecast fails and the alert fetch fails too', async () => {
    const getAlerts = vi.fn().mockRejectedValue(new Error('alerts upstream down'));
    const fakes = buildFakes({ noaa: buildFailingNoaaFake(getAlerts) });

    const error = await catchError(
      handleGetForecast(
        { ...US_COORDS },
        fakes.noaa as unknown as NOAAService,
        fakes.openMeteo as unknown as OpenMeteoService,
        fakes.locationStore,
        fakes.geocoding as unknown as GeocodingService,
        fakes.ncei as unknown as NCEIService,
        undefined,
        true
      )
    );

    // Silent-omit survives: the forecast's own error is what surfaces, and the
    // banner failure is one warn, never a second thrown error.
    expect((error as Error).message).toBe('upstream gridpoint failure');
    expect(criticalAlertBannerFromError(error)).toBe('');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
