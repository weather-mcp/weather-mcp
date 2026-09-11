/**
 * MET Norway fallback tests for get_forecast's optional trailing `metnoService`
 * parameter (T6 of .devdocs/plan-metno-fallback-impl.md).
 *
 * Exercises the real `handleGetForecast` with plain fake services — no HTTP,
 * no live network, no mocked axios. The seam under test is the injected
 * `metnoService`, faked here as a plain object whose `getForecast` resolves to
 * a hand-built `MetnoDailyAggregate` (`src/utils/metnoParse.ts`) — never a real
 * `MetnoService`. Mirrors `tests/unit/forecast-fallback.test.ts`'s approach
 * (fake services driving the real handler) and
 * `tests/unit/critical-alert-forecast.test.ts`'s approach to faking the
 * critical-alert banner.
 *
 * The fallback fires only on the Open-Meteo (non-NOAA) branch of an
 * `auto`-routed, non-US request: `useNOAA` is computed from `isInUS(lat, lon)`
 * directly (never from `resolved.country_code`), so a request must be
 * genuinely outside every US routing box to reach the branch where
 * `metnoService` is consulted at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { criticalAlertBannerFromError } from '../../src/handlers/criticalAlertBanner.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { MetnoService } from '../../src/services/metno.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import type { AlertCollectionResponse } from '../../src/types/noaa.js';
import type { SavedLocation } from '../../src/types/savedLocations.js';
import type { MetnoDailyAggregate, MetnoDailyForecast } from '../../src/utils/metnoParse.js';
import {
  ApiError,
  DataNotFoundError,
  InvalidLocationError,
  RateLimitError,
  ServiceUnavailableError,
} from '../../src/errors/ApiError.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Tokyo — outside every US routing box, so `auto` routes to Open-Meteo. */
const NON_US = { latitude: 35.6762, longitude: 139.6503 };

/** Grand Rapids, MI — inside the CONUS routing box, so `auto` routes to NOAA. */
const US_POINT = { latitude: 42.9634, longitude: -85.6681 };

/**
 * Oslo's real coordinates, saved with `country_code: "US"` — physically
 * outside every US routing box, so `isInUS` (which `useNOAA` reads directly)
 * still takes the Open-Meteo branch, while `resolveCriticalAlertBanner` reads
 * `resolved.country_code` first and treats it as a US point. The two checks
 * are genuinely independent in the handler, and this is the only way to
 * exercise the banner and the met.no fallback on the same request — a real
 * CONUS-box-overrun point (Toronto) routes to NOAA instead, the opposite
 * branch from the one under test.
 */
const QUIRKY_US_TAGGED = { latitude: 59.9139, longitude: 10.7522 };

const METNO_FALLBACK_NOTE =
  '*Open-Meteo is not responding; showing MET Norway model data instead.*';

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
      time: ['2026-09-11', '2026-09-12'],
      temperature_2m_max: [82, 80],
      temperature_2m_min: [70, 68],
    },
  };
}

function buildNoaaFake() {
  return {
    getPointData: vi.fn().mockResolvedValue({
      properties: { gridId: 'GRR', gridX: 1, gridY: 1, timeZone: 'America/Detroit' },
    }),
    getForecast: vi.fn().mockResolvedValue({
      properties: {
        units: 'us',
        forecastGenerator: 'test',
        generatedAt: '2026-09-11T00:00:00-04:00',
        updateTime: '2026-09-11T00:00:00-04:00',
        validTimes: '2026-09-11T00:00:00-04:00/P7D',
        elevation: { unitCode: 'wmoUnit:m', value: 10 },
        periods: [
          {
            number: 1,
            name: 'Today',
            startTime: '2026-09-11T06:00:00-04:00',
            endTime: '2026-09-11T18:00:00-04:00',
            isDaytime: true,
            temperature: 75,
            temperatureUnit: 'F',
            temperatureTrend: null,
            probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: null },
            windSpeed: '5 mph',
            windDirection: 'N',
            icon: '',
            shortForecast: 'Sunny',
            detailedForecast: 'Sunny throughout.',
          },
        ],
      },
    }),
    getHourlyForecast: vi.fn(),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getAlerts: vi.fn().mockResolvedValue(alertCollection()),
  };
}

function buildOpenMeteoFake(response: OpenMeteoForecastResponse = buildOpenMeteoForecastResponse()) {
  return {
    getForecast: vi.fn().mockResolvedValue(response),
    getModelComparison: vi.fn().mockRejectedValue(new Error('not exercised in this file')),
    getEnsembleSpread: vi.fn().mockRejectedValue(new Error('not exercised in this file')),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
}

function buildNceiFake() {
  return { isAvailable: vi.fn().mockReturnValue(false) };
}

/** One met.no aggregate day. Defaults give a day whose temperature the G69
 * lock test converts: 17°C -> 63°F, 10°C -> 50°F. */
function buildMetnoDay(dayOffset: number, overrides: Partial<MetnoDailyForecast> = {}): MetnoDailyForecast {
  const date = `2026-09-${String(11 + dayOffset).padStart(2, '0')}`;
  return {
    date,
    startsAt: `${date}T00:00:00.000+02:00`,
    hoursCovered: 24,
    complete: true,
    temperatureMaxC: 17,
    temperatureMinC: 10,
    temperatureBasis: 'window',
    precipitationMm: 0,
    precipitationProbabilityMaxPct: 10,
    windSpeedMaxMps: 4,
    windFromDirectionDeg: 180,
    symbolCode: 'partlycloudy_day',
    ...overrides,
  };
}

function buildMetnoAggregate(
  dayCount = 9,
  overrides: Partial<MetnoDailyAggregate> = {}
): MetnoDailyAggregate {
  const days = Array.from({ length: dayCount }, (_, i) => buildMetnoDay(i));
  return {
    timezone: 'Europe/Oslo',
    elevationM: 20,
    days,
    completeDayCount: days.length,
    entriesSeen: days.length * 4,
    entriesAggregated: days.length * 4,
    entriesTrimmed: false,
    ...overrides,
  };
}

function buildMetnoFake(aggregate: MetnoDailyAggregate = buildMetnoAggregate()) {
  return { getForecast: vi.fn().mockResolvedValue(aggregate) };
}

function makeLocationStore(locations: Record<string, SavedLocation> = {}): LocationStore {
  return {
    get: (alias: string) => locations[alias.toLowerCase().trim()],
    getAll: () => locations,
  } as unknown as LocationStore;
}

function makeQuirkyUsTaggedSavedLocation(): SavedLocation {
  return {
    name: 'Oslo (tagged US)',
    latitude: QUIRKY_US_TAGGED.latitude,
    longitude: QUIRKY_US_TAGGED.longitude,
    country_code: 'US',
    saved_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as SavedLocation;
}

interface Fakes {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  ncei: ReturnType<typeof buildNceiFake>;
  metno: ReturnType<typeof buildMetnoFake>;
  locationStore: LocationStore;
  geocoding: Record<string, never>;
}

function buildFakes(overrides: Partial<Fakes> = {}): Fakes {
  return {
    noaa: buildNoaaFake(),
    openMeteo: buildOpenMeteoFake(),
    ncei: buildNceiFake(),
    metno: buildMetnoFake(),
    locationStore: makeLocationStore(),
    geocoding: {},
    ...overrides,
  };
}

function callForecast(
  args: Record<string, unknown>,
  fakes: Fakes,
  options: { metno?: boolean; banner?: boolean } = {}
) {
  const { metno = true, banner } = options;
  return handleGetForecast(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.locationStore,
    fakes.geocoding as unknown as GeocodingService,
    fakes.ncei as unknown as NCEIService,
    undefined, // acisService
    banner,
    metno ? (fakes.metno as unknown as MetnoService) : undefined
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

// ---------------------------------------------------------------------------
// Fires — the fallback renders, and "Open-Meteo" appears nowhere in the body
// ---------------------------------------------------------------------------

describe('handleGetForecast — met.no fallback fires on a transient Open-Meteo failure', () => {
  const cases: Array<[string, () => Error]> = [
    ['RateLimitError', () => new RateLimitError('OpenMeteo', 'Rate limit exceeded')],
    ['ServiceUnavailableError', () => new ServiceUnavailableError('OpenMeteo', 'OpenMeteo API is currently unavailable')],
    ['a timeout-shaped ServiceUnavailableError', () => new ServiceUnavailableError('OpenMeteo', 'OpenMeteo request timed out')],
    // The single most important case: a plain ApiError with isRetryable=true
    // that is NOT an instanceof RateLimitError or ServiceUnavailableError. An
    // `instanceof ServiceUnavailableError || instanceof RateLimitError` guard
    // would miss this; the real guard keys on `isRetryableError`.
    [
      'the unclassified-network case (plain ApiError, isRetryable=true, not instanceof RateLimitError/ServiceUnavailableError)',
      () => new ApiError('OpenMeteo network failure', 500, 'OpenMeteo', 'OpenMeteo is not responding right now', [], true),
    ],
  ];

  it.each(cases)('fires on %s', async (_label, buildError) => {
    const fakes = buildFakes();
    fakes.openMeteo.getForecast.mockRejectedValue(buildError());

    const result = await callForecast({ ...NON_US, days: 5 }, fakes);
    const text = textOf(result);

    expect(fakes.metno.getForecast).toHaveBeenCalledTimes(1);
    expect(text).toContain(METNO_FALLBACK_NOTE);
    expect(text).toContain('*Forecast data by MET Norway (CC BY 4.0)*');
    // The note sits directly under the top heading.
    expect(text.startsWith('# Weather Forecast')).toBe(true);
    const headingEnd = text.indexOf('\n');
    const noteIndex = text.indexOf(METNO_FALLBACK_NOTE);
    expect(noteIndex).toBeGreaterThan(headingEnd);
    // "Open-Meteo" appears only in the fallback note itself (which names who
    // failed and who answered by design) — never in the met.no-rendered body
    // below it, which would otherwise misattribute the data source.
    const bodyAfterNote = text.slice(noteIndex + METNO_FALLBACK_NOTE.length);
    expect(bodyAfterNote).not.toContain('Open-Meteo');
  });
});

// ---------------------------------------------------------------------------
// Does not fire — the original error propagates unchanged
// ---------------------------------------------------------------------------

describe('handleGetForecast — met.no fallback does NOT fire', () => {
  it('on InvalidLocationError from Open-Meteo (our bug or a bad coordinate)', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getForecast.mockRejectedValue(
      new InvalidLocationError('OpenMeteo', 'Coordinates outside coverage')
    );

    await expect(callForecast({ ...NON_US }, fakes)).rejects.toThrow(InvalidLocationError);
    expect(fakes.metno.getForecast).not.toHaveBeenCalled();
  });

  it('on DataNotFoundError from Open-Meteo', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getForecast.mockRejectedValue(
      new DataNotFoundError('OpenMeteo', 'No data for requested point')
    );

    await expect(callForecast({ ...NON_US }, fakes)).rejects.toThrow(DataNotFoundError);
    expect(fakes.metno.getForecast).not.toHaveBeenCalled();
  });

  it('on an explicit source: "openmeteo" with a transient failure — the caller named that authority', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getForecast.mockRejectedValue(
      new ServiceUnavailableError('OpenMeteo', 'OpenMeteo API is currently unavailable')
    );

    await expect(
      callForecast({ ...NON_US, source: 'openmeteo' }, fakes)
    ).rejects.toThrow(ServiceUnavailableError);
    expect(fakes.metno.getForecast).not.toHaveBeenCalled();
  });

  it('for a US point on auto — the NOAA branch is taken, so met.no is never consulted', async () => {
    const fakes = buildFakes();

    const result = await callForecast({ ...US_POINT }, fakes);

    expect(textOf(result)).toContain('*Data source: NOAA National Weather Service (US)*');
    expect(fakes.metno.getForecast).not.toHaveBeenCalled();
  });

  it('when compare_models: true short-circuits routing before the branch', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getModelComparison = vi.fn().mockRejectedValue(new Error('comparison unavailable'));

    await expect(
      callForecast({ ...NON_US, compare_models: true, days: 3 }, fakes)
    ).rejects.toThrow();
    expect(fakes.metno.getForecast).not.toHaveBeenCalled();
  });

  it('when ensemble_spread: true short-circuits routing before the branch', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getEnsembleSpread = vi.fn().mockRejectedValue(new Error('spread unavailable'));

    await expect(
      callForecast({ ...NON_US, ensemble_spread: true, days: 3 }, fakes)
    ).rejects.toThrow();
    expect(fakes.metno.getForecast).not.toHaveBeenCalled();
  });

  it('with a transient failure and no met.no service injected — the arity-safety case', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getForecast.mockRejectedValue(
      new ServiceUnavailableError('OpenMeteo', 'OpenMeteo API is currently unavailable')
    );

    await expect(
      callForecast({ ...NON_US }, fakes, { metno: false })
    ).rejects.toThrow(ServiceUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// Both down — the Open-Meteo error propagates; met.no's message appears nowhere
// ---------------------------------------------------------------------------

describe('handleGetForecast — met.no fallback, both down', () => {
  it('propagates the original Open-Meteo error, with no trace of the met.no failure', async () => {
    const fakes = buildFakes();
    const openMeteoError = new ServiceUnavailableError(
      'OpenMeteo',
      'OpenMeteo API is currently unavailable'
    );
    fakes.openMeteo.getForecast.mockRejectedValue(openMeteoError);
    fakes.metno.getForecast.mockRejectedValue(new Error('MET Norway forecast is not available'));

    const error: unknown = await callForecast({ ...NON_US }, fakes).catch(e => e);

    expect(fakes.metno.getForecast).toHaveBeenCalledTimes(1);
    expect(error).toBe(openMeteoError);
    expect((error as Error).message).not.toContain('MET Norway');
  });
});

// ---------------------------------------------------------------------------
// Rendering assertions
// ---------------------------------------------------------------------------

describe('handleGetForecast — met.no fallback rendering', () => {
  function withFailedOpenMeteo(fakes: Fakes): Fakes {
    fakes.openMeteo.getForecast.mockRejectedValue(
      new ServiceUnavailableError('OpenMeteo', 'OpenMeteo API is currently unavailable')
    );
    return fakes;
  }

  it('renders the short-horizon disclosure naming the aggregate\'s actual day count when days exceeds it', async () => {
    const fakes = withFailedOpenMeteo(buildFakes({ metno: buildMetnoFake(buildMetnoAggregate(9)) }));

    const result = await callForecast({ ...NON_US, days: 14 }, fakes);
    const text = textOf(result);

    expect(text).toContain('MET Norway publishes a 9-day forecast');
    expect(text).toContain('showing all 9 of the 14 days requested');
  });

  it('renders no short-horizon disclosure when the requested days fit inside the aggregate', async () => {
    const fakes = withFailedOpenMeteo(buildFakes({ metno: buildMetnoFake(buildMetnoAggregate(9)) }));

    const result = await callForecast({ ...NON_US, days: 3 }, fakes);
    const text = textOf(result);

    expect(text).not.toContain('MET Norway publishes a');
  });

  it('renders the daily view and the downgrade sentence when granularity: "hourly" is requested', async () => {
    const fakes = withFailedOpenMeteo(buildFakes());

    const result = await callForecast({ ...NON_US, granularity: 'hourly', days: 2 }, fakes);
    const text = textOf(result);

    expect(text).toContain('# Weather Forecast (Daily)');
    expect(text).toContain(
      '*MET Norway publishes no hourly product through this fallback; showing the daily forecast instead.*'
    );
  });

  // G69: convert first, round second — assert a specific converted number in
  // each unit system, so a wrong conversion fails rather than merely differing.
  it('G69 lock: renders 63°F under imperial and 17°C under metric for the same 17°C reading', async () => {
    const fakesImperial = withFailedOpenMeteo(buildFakes());
    const resultImperial = await callForecast({ ...NON_US, days: 1 }, fakesImperial);
    expect(textOf(resultImperial)).toContain('High 63°F / Low 50°F');

    const fakesMetric = withFailedOpenMeteo(buildFakes());
    const resultMetric = await callForecast({ ...NON_US, days: 1, units: 'metric' }, fakesMetric);
    expect(textOf(resultMetric)).toContain('High 17°C / Low 10°C');
  });
});

// ---------------------------------------------------------------------------
// The banner lock
// ---------------------------------------------------------------------------

describe('handleGetForecast — met.no fallback and the critical-alert banner', () => {
  it('a successful fallback renders the banner above the metno output, with no error path taken', async () => {
    const fakes = buildFakes({
      locationStore: makeLocationStore({ quirky: makeQuirkyUsTaggedSavedLocation() }),
    });
    fakes.noaa.getAlerts = vi.fn().mockResolvedValue(alertCollection(TORNADO_WARNING));
    fakes.openMeteo.getForecast.mockRejectedValue(
      new ServiceUnavailableError('OpenMeteo', 'OpenMeteo API is currently unavailable')
    );

    const result = await callForecast({ location_name: 'quirky' }, fakes, { banner: true });
    const text = textOf(result);

    expect(fakes.metno.getForecast).toHaveBeenCalledTimes(1);

    const bannerIdx = text.indexOf(BANNER_FIRST_LINE);
    const locationIdx = text.indexOf('**Location:**');
    const noteIdx = text.indexOf(METNO_FALLBACK_NOTE);
    const footerIdx = text.indexOf('*Forecast data by MET Norway (CC BY 4.0)*');

    expect(bannerIdx).toBeGreaterThanOrEqual(0);
    expect(locationIdx).toBeGreaterThan(bannerIdx);
    expect(noteIdx).toBeGreaterThan(locationIdx);
    expect(footerIdx).toBeGreaterThan(noteIdx);
  });

  it('a both-down failure still carries the banner on the propagated error', async () => {
    const fakes = buildFakes({
      locationStore: makeLocationStore({ quirky: makeQuirkyUsTaggedSavedLocation() }),
    });
    fakes.noaa.getAlerts = vi.fn().mockResolvedValue(alertCollection(TORNADO_WARNING));
    const openMeteoError = new ServiceUnavailableError(
      'OpenMeteo',
      'OpenMeteo API is currently unavailable'
    );
    fakes.openMeteo.getForecast.mockRejectedValue(openMeteoError);
    fakes.metno.getForecast.mockRejectedValue(new Error('MET Norway forecast is not available'));

    const error: unknown = await callForecast(
      { location_name: 'quirky' },
      fakes,
      { banner: true }
    ).catch(e => e);

    expect(error).toBe(openMeteoError);
    expect(criticalAlertBannerFromError(error)).toContain(BANNER_FIRST_LINE);
  });
});
