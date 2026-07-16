/**
 * Handler routing and formatter tests for global current conditions (v1.12.0).
 *
 * Exercises handleGetCurrentConditions with plain fake services (no HTTP, no
 * live calls) to prove:
 *   - source routing (auto/noaa/openmeteo) picks the right backend
 *   - the non-US path never touches the NOAA fake (station/gridpoint calls)
 *   - the Open-Meteo formatter's display rules (feels-like gap, gust
 *     significance, precipitation section, footer, no **Station:** line)
 *   - include_fire_weather and include_normals behave on the non-US path
 *   - the real handler composes correctly under get_weather_summary
 *
 * See docs/global-current-conditions-implementation-plan.md T5.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoForecastResponse, ClimateNormals } from '../../src/types/openmeteo.js';
import type { ObservationResponse, StationCollectionResponse, GridpointResponse } from '../../src/types/noaa.js';
import { DataNotFoundError, InvalidLocationError, ServiceUnavailableError } from '../../src/errors/ApiError.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Washington, DC — inside the US routing boxes. */
const US_COORDS = { latitude: 38.8951, longitude: -77.0364 };
/** London, UK — outside the US routing boxes. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };
/** Tokyo, Japan — outside the US routing boxes. */
const TOKYO = { latitude: 35.6762, longitude: 139.6503 };
/** Sydney, Australia — outside the US routing boxes. */
const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };
/** Toronto, Canada — falls INSIDE the continental-US routing box (the box
 * overruns the border), so auto-routes to NOAA and is the fixture used to
 * exercise the NOAA → Open-Meteo fallback (D2). */
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };

/** Note text the fallback prepends under the output's top heading. */
const NOAA_FALLBACK_NOTE =
  '*NOAA does not cover this location; showing Open-Meteo model data instead.*';

function buildNOAAObservation(overrides: Record<string, unknown> = {}): ObservationResponse {
  return {
    properties: {
      '@id': 'https://api.weather.gov/stations/KDCA/observations/2024-01-01T12:00:00+00:00',
      '@type': 'wx:ObservationStation',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      station: 'https://api.weather.gov/stations/KDCA',
      timestamp: '2024-01-01T12:00:00+00:00',
      textDescription: 'Sunny',
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
          '@id': 'https://api.weather.gov/stations/KDCA',
          '@type': 'wx:ObservationStation',
          elevation: { unitCode: 'wmoUnit:m', value: 10 },
          stationIdentifier: 'KDCA',
          name: 'Test Station',
          timeZone: 'America/New_York',
        },
      },
    ] as unknown as StationCollectionResponse['features'],
  };
}

function buildNOAAGridpoint(): GridpointResponse {
  return { properties: {} } as unknown as GridpointResponse;
}

/**
 * Fresh NOAA fake with vi.fn() spies so call counts/args can be asserted per test.
 */
function buildNoaaFake() {
  return {
    getCurrentConditions: vi.fn().mockResolvedValue(buildNOAAObservation()),
    getStations: vi.fn().mockResolvedValue(buildNOAAStations()),
    getGridpointDataByCoordinates: vi.fn().mockResolvedValue(buildNOAAGridpoint()),
  };
}

function buildOpenMeteoCurrentResponse(
  currentOverrides: Record<string, unknown> = {},
  timezone = 'Europe/London'
): OpenMeteoForecastResponse {
  return {
    latitude: 51.5,
    longitude: -0.13,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone,
    timezone_abbreviation: 'GMT',
    elevation: 11,
    current_units: {
      time: 'iso8601',
      interval: 'seconds',
      temperature_2m: '°F',
    },
    current: {
      time: '2024-01-01T12:00',
      interval: 900,
      temperature_2m: 60,
      relative_humidity_2m: 55,
      apparent_temperature: 60, // equal to actual: no feels-like gap by default
      dew_point_2m: 50,
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
      wind_gusts_10m: 10, // not > 10 * 1.2: not significant by default
      ...currentOverrides,
    },
    daily: {
      time: ['2024-01-01'],
      temperature_2m_max: [65],
      temperature_2m_min: [55],
    },
  };
}

/**
 * Fresh Open-Meteo fake. getWeatherDescription returns a distinctive marker
 * string (rather than duplicating the real WMO code table) so tests can assert
 * on it without coupling to the source's mapping.
 */
function buildOpenMeteoFake(response: OpenMeteoForecastResponse = buildOpenMeteoCurrentResponse()) {
  return {
    getCurrentConditions: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    getClimateNormals: vi.fn().mockResolvedValue({
      tempHigh: 65,
      tempLow: 45,
      precipitation: 0.1,
      source: 'Open-Meteo',
      month: 1,
      day: 1,
    } as ClimateNormals),
  };
}

/** NCEI fake: unavailable, so getClimateNormals always falls through to Open-Meteo. */
function buildNceiFake() {
  return {
    isAvailable: vi.fn().mockReturnValue(false),
  };
}

interface Fakes {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  ncei: ReturnType<typeof buildNceiFake>;
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
}

function buildFakes(openMeteoResponse?: OpenMeteoForecastResponse): Fakes {
  return {
    noaa: buildNoaaFake(),
    openMeteo: buildOpenMeteoFake(openMeteoResponse),
    ncei: buildNceiFake(),
    // Coordinate-only args mean resolveLocationAsync never touches these.
    locationStore: {},
    geocoding: {},
  };
}

function callCurrentConditions(args: Record<string, unknown>, fakes: Fakes) {
  return handleGetCurrentConditions(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.ncei as unknown as NCEIService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

// ---------------------------------------------------------------------------
// 1. Routing
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — source routing', () => {
  it('routes US coordinates to NOAA on auto', async () => {
    const fakes = buildFakes();
    await callCurrentConditions({ ...US_COORDS }, fakes);

    expect(fakes.noaa.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(fakes.openMeteo.getCurrentConditions).not.toHaveBeenCalled();
  });

  it('routes non-US coordinates to Open-Meteo on auto', async () => {
    const fakes = buildFakes();
    await callCurrentConditions({ ...LONDON }, fakes);

    expect(fakes.openMeteo.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(fakes.noaa.getCurrentConditions).not.toHaveBeenCalled();
  });

  it('honors explicit source: "noaa" at non-US coordinates', async () => {
    const fakes = buildFakes();
    await callCurrentConditions({ ...LONDON, source: 'noaa' }, fakes);

    expect(fakes.noaa.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(fakes.openMeteo.getCurrentConditions).not.toHaveBeenCalled();
  });

  it('honors explicit source: "openmeteo" at US coordinates', async () => {
    const fakes = buildFakes();
    await callCurrentConditions({ ...US_COORDS, source: 'openmeteo' }, fakes);

    expect(fakes.openMeteo.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(fakes.noaa.getCurrentConditions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Negative assertion — non-US path makes no NOAA calls of any kind
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — non-US path avoids NOAA entirely', () => {
  it('makes no station or gridpoint call on the NOAA fake', async () => {
    const fakes = buildFakes();
    await callCurrentConditions({ ...LONDON }, fakes);

    expect(fakes.noaa.getCurrentConditions).not.toHaveBeenCalled();
    expect(fakes.noaa.getStations).not.toHaveBeenCalled();
    expect(fakes.noaa.getGridpointDataByCoordinates).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Formatter behavior
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — Open-Meteo formatter', () => {
  it.each([
    ['London', LONDON],
    ['Tokyo', TOKYO],
    ['Sydney', SYDNEY],
  ])('produces the Open-Meteo footer for %s', async (_name, coords) => {
    const fakes = buildFakes();
    const result = await callCurrentConditions({ ...coords, units: 'imperial' }, fakes);
    const text = textOf(result);

    expect(text).toContain(
      '*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*'
    );
    expect(text).not.toContain('**Station:**');
  });

  it('shows weather-code text via getWeatherDescription', async () => {
    const response = buildOpenMeteoCurrentResponse({ weather_code: 61 });
    const fakes = buildFakes(response);

    const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
    const text = textOf(result);

    expect(fakes.openMeteo.getWeatherDescription).toHaveBeenCalledWith(61);
    expect(text).toContain('TESTWX-61');
  });

  describe('feels-like display rule (imperial, gap must be strictly > 3)', () => {
    it('does NOT show Feels Like when the gap is exactly 3', async () => {
      const response = buildOpenMeteoCurrentResponse({
        temperature_2m: 60,
        apparent_temperature: 63,
      });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      expect(textOf(result)).not.toContain('**Feels Like:**');
    });

    it('shows Feels Like when the gap is 4', async () => {
      const response = buildOpenMeteoCurrentResponse({
        temperature_2m: 60,
        apparent_temperature: 64,
      });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      expect(textOf(result)).toContain('**Feels Like:** 64°F');
    });

    it('also triggers on a negative gap beyond the threshold (abs value)', async () => {
      const response = buildOpenMeteoCurrentResponse({
        temperature_2m: 60,
        apparent_temperature: 55, // gap of -5, |gap| = 5 > 3
      });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      expect(textOf(result)).toContain('**Feels Like:** 55°F');
    });
  });

  describe('gust significance rule (ratio 1.2)', () => {
    it('does NOT show gusts when gust <= speed * 1.2', async () => {
      const response = buildOpenMeteoCurrentResponse({
        wind_speed_10m: 10,
        wind_gusts_10m: 12, // exactly 1.2x: not strictly greater
      });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      expect(textOf(result)).not.toContain('gusting to');
    });

    it('shows gusts when gust > speed * 1.2', async () => {
      const response = buildOpenMeteoCurrentResponse({
        wind_speed_10m: 10,
        wind_gusts_10m: 13, // > 12
      });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      expect(textOf(result)).toContain('gusting to 13 mph');
    });
  });

  describe('pressure conversion', () => {
    // Open-Meteo honours temperature/wind/precipitation unit params but NOT
    // pressure: pressure_msl always comes back in hPa (verified against the live
    // API, which reports "pressure_msl": "hPa" even under temperature_unit=
    // fahrenheit). The formatter must convert rather than relabel.
    it('converts hPa to inHg under imperial preferences', async () => {
      const response = buildOpenMeteoCurrentResponse({ pressure_msl: 1012 });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      const text = textOf(result);

      // 1012 hPa ~= 29.88 inHg — NOT "1012 inHg".
      expect(text).toContain('**Pressure:** 29.88 inHg');
      expect(text).not.toContain('1012 inHg');
    });

    it('reports hPa unchanged under metric preferences', async () => {
      const response = buildOpenMeteoCurrentResponse({ pressure_msl: 1012 });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'metric' }, fakes);
      expect(textOf(result)).toContain('**Pressure:** 1012 hPa');
    });
  });

  describe('Recent Precipitation section', () => {
    it('is present when precipitation > 0', async () => {
      const response = buildOpenMeteoCurrentResponse({ precipitation: 0.5, rain: 0.5 });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      expect(textOf(result)).toContain('## Recent Precipitation');
    });

    it('is absent when precipitation is 0', async () => {
      const response = buildOpenMeteoCurrentResponse({ precipitation: 0 });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      expect(textOf(result)).not.toContain('## Recent Precipitation');
    });
  });

  describe('snowfall cm-to-mm conversion (D1)', () => {
    it('converts metric snowfall from cm to mm on display', async () => {
      // API reports snowfall in cm even under precipitation_unit=mm — 0.14 cm
      // must render as 1.4 mm, not 0.14 mm.
      const response = buildOpenMeteoCurrentResponse({ precipitation: 0.5, snowfall: 0.14 });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'metric' }, fakes);
      expect(textOf(result)).toContain('**Snowfall:** 1.4 mm');
    });

    it('leaves imperial snowfall unchanged (passthrough)', async () => {
      const response = buildOpenMeteoCurrentResponse({ precipitation: 0.5, snowfall: 0.3 });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      expect(textOf(result)).toContain('**Snowfall:** 0.30 in');
    });
  });

  describe('trace-precipitation display floor (D3)', () => {
    it('omits the section when imperial precipitation is below the floor (0.005 in)', async () => {
      const response = buildOpenMeteoCurrentResponse({ precipitation: 0.004 });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      expect(textOf(result)).not.toContain('## Recent Precipitation');
    });

    it('omits the section when metric precipitation is below the floor (0.05 mm)', async () => {
      const response = buildOpenMeteoCurrentResponse({ precipitation: 0.04 });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'metric' }, fakes);
      expect(textOf(result)).not.toContain('## Recent Precipitation');
    });

    it('shows the section when precipitation is exactly at the floor', async () => {
      const response = buildOpenMeteoCurrentResponse({ precipitation: 0.005 });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      expect(textOf(result)).toContain('## Recent Precipitation');
    });

    it('omits a breakout line below the floor while the section itself still shows', async () => {
      // precipitation clears the floor so the section renders, but rain is
      // below it and must be individually suppressed.
      const response = buildOpenMeteoCurrentResponse({ precipitation: 0.5, rain: 0.001 });
      const fakes = buildFakes(response);

      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, fakes);
      const text = textOf(result);

      expect(text).toContain('## Recent Precipitation');
      expect(text).not.toContain('**Rain:**');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. include_fire_weather on the non-US path
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — include_fire_weather (non-US)', () => {
  it('emits the US-only note and makes no gridpoint call', async () => {
    const fakes = buildFakes();
    const result = await callCurrentConditions(
      { ...LONDON, include_fire_weather: true },
      fakes
    );
    const text = textOf(result);

    expect(text).toContain('Fire weather indices are currently available for US locations only.');
    expect(fakes.noaa.getGridpointDataByCoordinates).not.toHaveBeenCalled();
    expect(fakes.noaa.getCurrentConditions).not.toHaveBeenCalled();
    expect(fakes.noaa.getStations).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. include_normals for a non-US location
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — include_normals (non-US)', () => {
  it('resolves without throwing and includes normals output or a not-available note', async () => {
    const fakes = buildFakes();

    const result = await callCurrentConditions({ ...TOKYO, include_normals: true }, fakes);
    const text = textOf(result);

    const hasNormalsOutput = text.includes('Climate Context');
    const hasUnavailableNote = text.includes('Climate normals data not available for this location');
    expect(hasNormalsOutput || hasUnavailableNote).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Design-plan acceptance #3 — get_weather_summary composes the real handler
// ---------------------------------------------------------------------------

describe('handleGetWeatherSummary — drives the real currentConditionsHandler (non-US)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('succeeds with include: ["current"] at a non-US location', async () => {
    const fakes = buildFakes();

    const result = await handleGetWeatherSummary(
      { ...SYDNEY, include: ['current'] },
      fakes.noaa as unknown as NOAAService,
      fakes.openMeteo as unknown as OpenMeteoService,
      fakes.ncei as unknown as NCEIService,
      fakes.locationStore as unknown as LocationStore,
      fakes.geocoding as unknown as GeocodingService
    );

    const text = textOf(result);

    expect(text).toContain('# Weather Summary');
    expect(text).toContain('Current Weather Conditions');
    expect(text).toContain('Open-Meteo (Global)');
    // Routed through the real handler to Open-Meteo, not NOAA.
    expect(fakes.openMeteo.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(fakes.noaa.getCurrentConditions).not.toHaveBeenCalled();
    // No section failure note.
    expect(text).not.toContain('current (unavailable)');
  });
});

// ---------------------------------------------------------------------------
// 7. Auto-mode NOAA -> Open-Meteo fallback (D2 / T5)
// ---------------------------------------------------------------------------
//
// Live verification (see docs/global-conditions-hardening-implementation-plan.md
// T5) showed NOAA's coverage 404 ("Unable to provide data for requested point")
// actually surfaces as DataNotFoundError, not InvalidLocationError as the design
// plan originally assumed — InvalidLocationError is NOAA's generic non-coverage
// 4xx class. The handler catches BOTH (see currentConditionsHandler.ts), so both
// are covered here. Transient failures (ServiceUnavailableError, RateLimitError)
// must propagate rather than trigger a fallback.

describe('handleGetCurrentConditions — auto-mode NOAA -> Open-Meteo fallback (D2)', () => {
  it('falls back to Open-Meteo when NOAA throws DataNotFoundError on an auto-routed border city', async () => {
    const fakes = buildFakes();
    fakes.noaa.getCurrentConditions.mockRejectedValue(
      new DataNotFoundError('NOAA', 'Unable to provide data for requested point')
    );

    const result = await callCurrentConditions({ ...TORONTO }, fakes);
    const text = textOf(result);

    // Fallback actually happened: Open-Meteo was called, NOAA formatter output
    // (Station line) never made it into the response.
    expect(fakes.openMeteo.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(text).not.toContain('**Station:**');

    // Note is positioned directly under the top heading, before any other content.
    expect(text.startsWith('# Current Weather Conditions')).toBe(true);
    const headingEnd = '# Current Weather Conditions'.length;
    const noteIndex = text.indexOf(NOAA_FALLBACK_NOTE);
    expect(noteIndex).toBeGreaterThan(headingEnd);
    expect(text.slice(headingEnd, noteIndex).trim()).toBe('');

    // Open-Meteo-formatted output, including its data-source footer.
    expect(text).toContain(
      '*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*'
    );
  });

  it('falls back to Open-Meteo when NOAA throws InvalidLocationError on an auto-routed border city', async () => {
    const fakes = buildFakes();
    fakes.noaa.getCurrentConditions.mockRejectedValue(
      new InvalidLocationError('NOAA', 'Coordinates outside NOAA coverage')
    );

    const result = await callCurrentConditions({ ...TORONTO }, fakes);
    const text = textOf(result);

    expect(fakes.openMeteo.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(text).toContain(NOAA_FALLBACK_NOTE);
    expect(text).toContain(
      '*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*'
    );
  });

  it('does NOT fall back and rejects when NOAA throws ServiceUnavailableError', async () => {
    const fakes = buildFakes();
    fakes.noaa.getCurrentConditions.mockRejectedValue(
      new ServiceUnavailableError('NOAA', 'NOAA API is currently unavailable')
    );

    await expect(callCurrentConditions({ ...TORONTO }, fakes)).rejects.toThrow(ServiceUnavailableError);
    expect(fakes.openMeteo.getCurrentConditions).not.toHaveBeenCalled();
  });

  it('does NOT fall back when source is explicitly "noaa", even for DataNotFoundError', async () => {
    const fakes = buildFakes();
    fakes.noaa.getCurrentConditions.mockRejectedValue(
      new DataNotFoundError('NOAA', 'Unable to provide data for requested point')
    );

    await expect(
      callCurrentConditions({ ...TORONTO, source: 'noaa' }, fakes)
    ).rejects.toThrow(DataNotFoundError);
    expect(fakes.openMeteo.getCurrentConditions).not.toHaveBeenCalled();
  });

  it('does not show the fallback note for a normal non-US call (no NOAA error involved)', async () => {
    const fakes = buildFakes();

    const result = await callCurrentConditions({ ...LONDON }, fakes);
    const text = textOf(result);

    expect(text).not.toContain(NOAA_FALLBACK_NOTE);
    expect(fakes.noaa.getCurrentConditions).not.toHaveBeenCalled();
  });
});
