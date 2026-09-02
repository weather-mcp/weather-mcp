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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// The NOAA observation fixtures below are dated 2024-01-01. The handler now
// computes observation age against the real clock (F2/D2a), so the clock is
// pinned 30 minutes past the fixture timestamp to keep the NOAA path fresh
// (no stale warning, no station retry) in every pre-existing scenario.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-01-01T12:30:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

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
    // The handler's NOAA path now drives getStations + getLatestObservation
    // directly (F2/D2c retry loop); the getCurrentConditions wrapper remains
    // public API in noaa.ts but is no longer called by this handler.
    getCurrentConditions: vi.fn().mockResolvedValue(buildNOAAObservation()),
    getStations: vi.fn().mockResolvedValue(buildNOAAStations()),
    getLatestObservation: vi.fn().mockResolvedValue(buildNOAAObservation()),
    getGridpointDataByCoordinates: vi.fn().mockResolvedValue(buildNOAAGridpoint()),
  };
}

function buildOpenMeteoCurrentResponse(
  currentOverrides: Record<string, unknown> = {},
  timezone = 'Europe/London',
  dailyOverrides: Record<string, unknown> = {}
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
      ...dailyOverrides,
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

    expect(fakes.noaa.getStations).toHaveBeenCalledTimes(1);
    expect(fakes.noaa.getLatestObservation).toHaveBeenCalledTimes(1);
    expect(fakes.openMeteo.getCurrentConditions).not.toHaveBeenCalled();
  });

  it('routes non-US coordinates to Open-Meteo on auto', async () => {
    const fakes = buildFakes();
    await callCurrentConditions({ ...LONDON }, fakes);

    expect(fakes.openMeteo.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(fakes.noaa.getStations).not.toHaveBeenCalled();
    expect(fakes.noaa.getLatestObservation).not.toHaveBeenCalled();
  });

  it('honors explicit source: "noaa" at non-US coordinates', async () => {
    const fakes = buildFakes();
    await callCurrentConditions({ ...LONDON, source: 'noaa' }, fakes);

    expect(fakes.noaa.getStations).toHaveBeenCalledTimes(1);
    expect(fakes.noaa.getLatestObservation).toHaveBeenCalledTimes(1);
    expect(fakes.openMeteo.getCurrentConditions).not.toHaveBeenCalled();
  });

  it('honors explicit source: "openmeteo" at US coordinates', async () => {
    const fakes = buildFakes();
    await callCurrentConditions({ ...US_COORDS, source: 'openmeteo' }, fakes);

    expect(fakes.openMeteo.getCurrentConditions).toHaveBeenCalledTimes(1);
    expect(fakes.noaa.getStations).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Negative assertion — non-US path makes no NOAA calls of any kind
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — non-US path avoids NOAA entirely', () => {
  it('makes no station or gridpoint call on the NOAA fake', async () => {
    const fakes = buildFakes();
    await callCurrentConditions({ ...LONDON }, fakes);

    expect(fakes.noaa.getStations).not.toHaveBeenCalled();
    expect(fakes.noaa.getLatestObservation).not.toHaveBeenCalled();
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
  it('renders the computed Fosberg section and makes no NOAA call', async () => {
    // Default builder: 60°F, 55% RH, 10 mph — a mid-range index.
    const response = buildOpenMeteoCurrentResponse({
      vapour_pressure_deficit: 3.7,
      soil_moisture_0_to_1cm: 0.18,
    });
    const fakes = buildFakes(response);
    const result = await callCurrentConditions(
      { ...LONDON, include_fire_weather: true },
      fakes
    );
    const text = textOf(result);

    expect(text).toContain('## Fire Weather');
    expect(text).toMatch(/\*\*.. Fosberg Fire Weather Index:\*\* \d+ \(/);
    expect(text).toContain(
      'Computed from current temperature, humidity, and sustained wind.'
    );
    expect(text).toContain('**Dryness context:**');
    expect(text).toContain('**Vapour-pressure deficit:** 3.7 kPa (extreme drying power)');
    expect(text).toContain('**Topsoil moisture (top 1 cm):** 0.18 m³/m³ (dry)');
    expect(text).toContain(
      '*Derived by this server from Open-Meteo model data — not an official fire-danger rating. Heed warnings from your national fire authority.*'
    );
    // The US-only stub is gone.
    expect(text).not.toContain('Fire weather indices are currently available for US locations only.');

    // The non-US path still makes no NOAA call of any kind.
    expect(fakes.noaa.getGridpointDataByCoordinates).not.toHaveBeenCalled();
    expect(fakes.noaa.getCurrentConditions).not.toHaveBeenCalled();
    expect(fakes.noaa.getStations).not.toHaveBeenCalled();
  });

  it('omits a single dryness line whose value is null and keeps the block', async () => {
    const response = buildOpenMeteoCurrentResponse({
      vapour_pressure_deficit: 2.4,
      soil_moisture_0_to_1cm: null,
    });
    const result = await callCurrentConditions(
      { ...LONDON, include_fire_weather: true },
      buildFakes(response)
    );
    const text = textOf(result);

    expect(text).toContain('**Dryness context:**');
    expect(text).toContain('**Vapour-pressure deficit:** 2.4 kPa (high drying power)');
    expect(text).not.toContain('Topsoil moisture');
    expect(text).toContain('Fosberg Fire Weather Index:');
  });

  it('omits the whole dryness block when both values are null, index still renders', async () => {
    const response = buildOpenMeteoCurrentResponse({
      vapour_pressure_deficit: null,
      soil_moisture_0_to_1cm: null,
    });
    const result = await callCurrentConditions(
      { ...LONDON, include_fire_weather: true },
      buildFakes(response)
    );
    const text = textOf(result);

    expect(text).not.toContain('**Dryness context:**');
    expect(text).toContain('Fosberg Fire Weather Index:');
    expect(text).toContain('*Derived by this server from Open-Meteo model data');
  });

  it('renders the unavailable note when a core input is missing', async () => {
    const response = buildOpenMeteoCurrentResponse({
      relative_humidity_2m: undefined,
    });
    const result = await callCurrentConditions(
      { ...LONDON, include_fire_weather: true },
      buildFakes(response)
    );
    const text = textOf(result);

    expect(text).toContain('## Fire Weather');
    expect(text).toContain('⚠️ Fire weather inputs unavailable for this location.');
    expect(text).not.toContain('Fosberg Fire Weather Index:');
    expect(text).not.toContain('NaN');
  });

  it('renders Low rather than suppressing it for cool, humid, light-wind conditions', async () => {
    const response = buildOpenMeteoCurrentResponse({
      temperature_2m: 45,
      relative_humidity_2m: 92,
      wind_speed_10m: 2,
    });
    const result = await callCurrentConditions(
      { ...LONDON, include_fire_weather: true },
      buildFakes(response)
    );
    const text = textOf(result);

    expect(text).toMatch(/Fosberg Fire Weather Index:\*\* \d+ \(Low\)/);
  });

  it('produces the same index from metric prefs as from imperial (normalization is pure)', async () => {
    // 15.5 °C ≡ 59.9 °F, 16.09 km/h ≡ 10.0 mph — the same weather, expressed
    // in the units Open-Meteo would return for each preference set.
    const imperial = await callCurrentConditions(
      { ...LONDON, include_fire_weather: true, units: 'imperial' },
      buildFakes(
        buildOpenMeteoCurrentResponse({
          temperature_2m: 59.9,
          relative_humidity_2m: 40,
          wind_speed_10m: 10,
        })
      )
    );
    const metric = await callCurrentConditions(
      { ...LONDON, include_fire_weather: true, units: 'metric' },
      buildFakes(
        buildOpenMeteoCurrentResponse({
          temperature_2m: 15.5,
          relative_humidity_2m: 40,
          wind_speed_10m: 16.09,
        })
      )
    );

    const indexOf = (text: string): string => {
      const match = text.match(/Fosberg Fire Weather Index:\*\* (\d+) \((\w+)\)/);
      expect(match).not.toBeNull();
      return `${match![1]} ${match![2]}`;
    };

    expect(indexOf(textOf(metric))).toBe(indexOf(textOf(imperial)));
  });

  it('passes the fire-weather flag through to the Open-Meteo service', async () => {
    const fakes = buildFakes();
    await callCurrentConditions({ ...LONDON, include_fire_weather: true }, fakes);

    expect(fakes.openMeteo.getCurrentConditions).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.anything(),
      true
    );
  });
});

// ---------------------------------------------------------------------------
// 4b. F1 — null (not just undefined) core fire-weather inputs, both unit
// systems. Open-Meteo returns `null` for absent values; under metric prefs a
// null temperature/wind used to survive unit conversion
// (celsiusToFahrenheit(null) -> 32, kphToMph(null) -> 0) and render a
// fabricated index instead of the unavailable note. See docs/
// release-review-hardening-plan.md F1/D1.
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — include_fire_weather null core inputs (F1)', () => {
  it.each([
    ['temperature_2m', 'imperial'],
    ['temperature_2m', 'metric'],
    ['relative_humidity_2m', 'imperial'],
    ['relative_humidity_2m', 'metric'],
    ['wind_speed_10m', 'imperial'],
    ['wind_speed_10m', 'metric'],
  ] as const)(
    'renders the unavailable note, never an index, when %s is null under %s prefs',
    async (field, units) => {
      const response = buildOpenMeteoCurrentResponse({ [field]: null });
      const result = await callCurrentConditions(
        { ...LONDON, include_fire_weather: true, units },
        buildFakes(response)
      );
      const text = textOf(result);

      expect(text).toContain('## Fire Weather');
      expect(text).toContain('⚠️ Fire weather inputs unavailable for this location.');
      expect(text).not.toContain('Fosberg Fire Weather Index:');
      expect(text).not.toContain('NaN');
    }
  );

  it('renders the index with dryness omitted when all three core inputs are present but dryness fields are null (imperial)', async () => {
    const response = buildOpenMeteoCurrentResponse({
      vapour_pressure_deficit: null,
      soil_moisture_0_to_1cm: null,
    });
    const result = await callCurrentConditions(
      { ...LONDON, include_fire_weather: true, units: 'imperial' },
      buildFakes(response)
    );
    const text = textOf(result);

    expect(text).toContain('Fosberg Fire Weather Index:');
    expect(text).not.toContain('**Dryness context:**');
  });

  it('renders the index with dryness omitted when all three core inputs are present but dryness fields are null (metric)', async () => {
    const response = buildOpenMeteoCurrentResponse({
      vapour_pressure_deficit: null,
      soil_moisture_0_to_1cm: null,
    });
    const result = await callCurrentConditions(
      { ...LONDON, include_fire_weather: true, units: 'metric' },
      buildFakes(response)
    );
    const text = textOf(result);

    expect(text).toContain('Fosberg Fire Weather Index:');
    expect(text).not.toContain('**Dryness context:**');
  });
});

// ---------------------------------------------------------------------------
// 5. include_normals for a non-US location
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — include_normals (non-US)', () => {
  it('renders the Climate Context section with the fetched normal high/low when getClimateNormals resolves', async () => {
    const fakes = buildFakes();
    // The shared Open-Meteo fake already resolves getClimateNormals to
    // { tempHigh: 65, tempLow: 45, precipitation: 0.1, source: 'Open-Meteo',
    // month: 1, day: 1 } — assert the render is real, not just "didn't throw".

    const result = await callCurrentConditions(
      { ...TOKYO, include_normals: true, units: 'imperial' },
      fakes
    );
    const text = textOf(result);

    expect(text).toContain('## 📊 Climate Context');
    expect(text).toContain('**Normal High:** 65°F');
    expect(text).toContain('**Normal Low:** 45°F');
    expect(text).not.toContain('Climate normals data not available for this location');
  });

  it('soft-fails to the aligned heading and unavailable note when getClimateNormals rejects, without failing the response', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getClimateNormals.mockRejectedValue(new Error('no data'));

    const result = await callCurrentConditions(
      { ...TOKYO, include_normals: true, units: 'imperial' },
      fakes
    );
    const text = textOf(result);

    // Normals are garnish: the parent response still resolves successfully.
    expect(text).toContain('## 📊 Climate Context');
    expect(text).toContain('⚠️ Climate normals data not available for this location.');
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
    expect(fakes.noaa.getStations).not.toHaveBeenCalled();
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
    fakes.noaa.getStations.mockRejectedValue(
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
    fakes.noaa.getStations.mockRejectedValue(
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
    fakes.noaa.getStations.mockRejectedValue(
      new ServiceUnavailableError('NOAA', 'NOAA API is currently unavailable')
    );

    await expect(callCurrentConditions({ ...TORONTO }, fakes)).rejects.toThrow(ServiceUnavailableError);
    expect(fakes.openMeteo.getCurrentConditions).not.toHaveBeenCalled();
  });

  it('does NOT fall back when source is explicitly "noaa", even for DataNotFoundError', async () => {
    const fakes = buildFakes();
    fakes.noaa.getStations.mockRejectedValue(
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
    expect(fakes.noaa.getStations).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. Thermal stress — frostbite / WBGT (Open-Meteo path) (T3)
//
// See docs/heat-cold-stress-plan.md D4 (which wind chill drives the band),
// D5 (rendering), D6 (gates). On this path the computed wind chill is always
// echoed in the frostbite line (there is no "Feels Like (Wind Chill)" line
// on this formatter to avoid duplicating). Bands are computed on the
// *rounded* effective wind chill / WBGT so the number shown and the band
// naming it never disagree at an edge. All fixtures below are hand-computed
// against the formulas in src/utils/thermalStress.ts (see the doc comments
// there for the NWS wind chill and ABM WBGT formulas).
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — thermal stress (Open-Meteo path)', () => {
  it('renders the frostbite line, echoing form, for a cold + windy fixture', async () => {
    // -21°F @ 25 mph -> NA WCI = -52.17°F -> rounds -52°F, "Very High" band.
    const response = buildOpenMeteoCurrentResponse({
      temperature_2m: -21,
      apparent_temperature: -21,
      relative_humidity_2m: 50,
      wind_speed_10m: 25,
    });
    const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
    const text = textOf(result);

    expect(text).toContain('🥶 **Frostbite risk (Very High):** wind chill -52°F — exposed skin can freeze in 5–10 minutes. Cover all skin and limit time outdoors.');
  });

  it('calm-air carve-out: wind below 3 mph with air temp <= -18°F still renders the line, using air temp as the effective value', async () => {
    // 2 mph is below the formula's validity floor, so calculateWindChillF
    // returns null and the handler substitutes the air temperature itself.
    const response = buildOpenMeteoCurrentResponse({
      temperature_2m: -25,
      apparent_temperature: -25,
      relative_humidity_2m: 50,
      wind_speed_10m: 2,
    });
    const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
    const text = textOf(result);

    expect(text).toContain('🥶 **Frostbite risk (High):** air temperature -25°F in calm air — exposed skin can freeze in 10–30 minutes. Cover all skin and limit time outdoors.');
  });

  it('distinguishes wind never reported from measured calm air', async () => {
    // No wind_speed_10m at all: the substituted air temperature must not be
    // described as "calm air", and the line flags that wind would shorten it.
    const response = buildOpenMeteoCurrentResponse({
      temperature_2m: -25,
      apparent_temperature: -25,
      relative_humidity_2m: 50,
      wind_speed_10m: null,
    });
    const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
    const text = textOf(result);

    expect(text).toContain('🥶 **Frostbite risk (High):** air temperature -25°F, wind not reported — exposed skin can freeze in 10–30 minutes, sooner if it is windy. Cover all skin and limit time outdoors.');
    expect(text).not.toContain('in calm air');
  });

  it('renders no frostbite line when the effective wind chill is above -18°F', async () => {
    // 0°F @ 10 mph -> NA WCI = -15.93°F -> rounds -16°F, above the -18°F gate.
    const response = buildOpenMeteoCurrentResponse({
      temperature_2m: 0,
      apparent_temperature: 0,
      relative_humidity_2m: 50,
      wind_speed_10m: 10,
    });
    const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
    const text = textOf(result);

    expect(text).not.toContain('🥶');
  });

  it('renders the WBGT heat line, including the italic derivation caveat, for a hot-humid fixture', async () => {
    // 90°F @ 70% RH -> WBGT = 95.74°F -> rounds 96°F, "Extreme" band.
    const response = buildOpenMeteoCurrentResponse({
      temperature_2m: 90,
      apparent_temperature: 90,
      relative_humidity_2m: 70,
      wind_speed_10m: 5,
    });
    const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
    const text = textOf(result);

    expect(text).toContain(
      '🥵 **Heat stress (Extreme):** estimated WBGT 96°F — outdoor exertion is dangerous; rest often, hydrate, and seek shade. *Estimated from temperature and humidity assuming full sun; thresholds vary with acclimatization.*'
    );
  });

  it('renders no heat line for a hot-dry fixture whose WBGT rounds below 80', async () => {
    // 90°F @ 10% RH -> WBGT = 75.37°F -> rounds 75°F, below the 80°F gate.
    const response = buildOpenMeteoCurrentResponse({
      temperature_2m: 90,
      apparent_temperature: 90,
      relative_humidity_2m: 10,
      wind_speed_10m: 5,
    });
    const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
    const text = textOf(result);

    expect(text).not.toContain('🥵');
  });

  it('renders no heat line and no warning note when RH is missing on a hot fixture (garnish, not contract)', async () => {
    const response = buildOpenMeteoCurrentResponse({
      temperature_2m: 90,
      apparent_temperature: 90,
      relative_humidity_2m: null,
      wind_speed_10m: 5,
    });
    const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
    const text = textOf(result);

    expect(text).not.toContain('🥵');
    expect(text).not.toContain('⚠️');
  });

  it('produces the same frostbite band from metric prefs as from the imperial equivalent, displayed in °C', async () => {
    // Same weather as the first test (-21°F / 25 mph), expressed in the units
    // Open-Meteo would return for metric preferences (-29.44°C / 40.23 km/h).
    // The band is computed on fixed °F, so it must match; only the displayed
    // number changes unit.
    const imperial = await callCurrentConditions(
      { ...LONDON, units: 'imperial' },
      buildFakes(buildOpenMeteoCurrentResponse({
        temperature_2m: -21,
        apparent_temperature: -21,
        relative_humidity_2m: 50,
        wind_speed_10m: 25,
      }))
    );
    const metric = await callCurrentConditions(
      { ...LONDON, units: 'metric' },
      buildFakes(buildOpenMeteoCurrentResponse({
        temperature_2m: -29.44,
        apparent_temperature: -29.44,
        relative_humidity_2m: 50,
        wind_speed_10m: 40.23,
      }))
    );

    const imperialText = textOf(imperial);
    const metricText = textOf(metric);

    expect(imperialText).toContain('🥶 **Frostbite risk (Very High):** wind chill -52°F');
    expect(metricText).toContain('🥶 **Frostbite risk (Very High):** wind chill -47°C');
    expect(metricText).toContain('exposed skin can freeze in 5–10 minutes. Cover all skin and limit time outdoors.');
  });

  describe('frostbite gate boundary (-18°F)', () => {
    it('renders the line when the effective wind chill rounds to exactly -18°F', async () => {
      // -10°F @ 3 mph -> NA WCI = -18.19°F -> rounds -18°F (at the gate).
      const response = buildOpenMeteoCurrentResponse({
        temperature_2m: -10,
        apparent_temperature: -10,
        relative_humidity_2m: 50,
        wind_speed_10m: 3,
      });
      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
      const text = textOf(result);

      expect(text).toContain('🥶 **Frostbite risk (High):** wind chill -18°F — exposed skin can freeze in 10–30 minutes. Cover all skin and limit time outdoors.');
    });

    it('renders no line when the effective wind chill rounds to -17°F, just above the gate', async () => {
      // -9°F @ 3 mph -> NA WCI = -17.06°F -> rounds -17°F (one above the gate).
      const response = buildOpenMeteoCurrentResponse({
        temperature_2m: -9,
        apparent_temperature: -9,
        relative_humidity_2m: 50,
        wind_speed_10m: 3,
      });
      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
      const text = textOf(result);

      expect(text).not.toContain('🥶');
    });
  });

  describe('WBGT gate boundary (80°F)', () => {
    it('renders the line when WBGT rounds to exactly 80°F', async () => {
      // 80°F @ 55% RH -> WBGT = 79.87°F -> rounds 80°F (at the gate).
      const response = buildOpenMeteoCurrentResponse({
        temperature_2m: 80,
        apparent_temperature: 80,
        relative_humidity_2m: 55,
        wind_speed_10m: 5,
      });
      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
      const text = textOf(result);

      expect(text).toContain('🥵 **Heat stress (Elevated):** estimated WBGT 80°F — use caution during prolonged outdoor exertion; take breaks and hydrate. *Estimated from temperature and humidity assuming full sun; thresholds vary with acclimatization.*');
    });

    it('renders no line when WBGT rounds to 79°F, just below the gate', async () => {
      // 80°F @ 50% RH -> WBGT = 78.64°F -> rounds 79°F (one below the gate).
      const response = buildOpenMeteoCurrentResponse({
        temperature_2m: 80,
        apparent_temperature: 80,
        relative_humidity_2m: 50,
        wind_speed_10m: 5,
      });
      const result = await callCurrentConditions({ ...LONDON, units: 'imperial' }, buildFakes(response));
      const text = textOf(result);

      expect(text).not.toContain('🥵');
    });
  });
});

// ---------------------------------------------------------------------------
// 9. T6 — Pin the **Today's Range:** compound-line omission behaviour now
// that OpenMeteoForecastDailyData declares temperature_2m_max/_min
// `(number | null)[]`. These fixtures inject nulls to exercise the guard, not
// because a default getCurrentConditions() call was observed to produce one:
// probed live on 2026-08-28, the default Open-Meteo forecast request (no
// `models=` parameter) returned no null daily-temperature samples. A green
// test here proves the guard exists, not that a caller hits it by default.
// ---------------------------------------------------------------------------

describe("handleGetCurrentConditions — Today's Range null-guard behaviour (T6)", () => {
  it('shows only the high when temperature_2m_min is null', async () => {
    const response = buildOpenMeteoCurrentResponse({}, 'Europe/London', {
      temperature_2m_max: [65],
      temperature_2m_min: [null],
    });
    const result = await callCurrentConditions(
      { ...LONDON, units: 'imperial' },
      buildFakes(response)
    );
    const text = textOf(result);

    const line = text.split('\n').find(l => l.startsWith("**Today's Range:**"));
    expect(line).toBe("**Today's Range:** High 65°F");
  });

  it('shows only the low when temperature_2m_max is null', async () => {
    const response = buildOpenMeteoCurrentResponse({}, 'Europe/London', {
      temperature_2m_max: [null],
      temperature_2m_min: [55],
    });
    const result = await callCurrentConditions(
      { ...LONDON, units: 'imperial' },
      buildFakes(response)
    );
    const text = textOf(result);

    const line = text.split('\n').find(l => l.startsWith("**Today's Range:**"));
    expect(line).toBe("**Today's Range:** Low 55°F");
  });

  it('omits the line entirely when both halves are null', async () => {
    const response = buildOpenMeteoCurrentResponse({}, 'Europe/London', {
      temperature_2m_max: [null],
      temperature_2m_min: [null],
    });
    const result = await callCurrentConditions(
      { ...LONDON, units: 'imperial' },
      buildFakes(response)
    );
    const text = textOf(result);

    expect(text).not.toContain("Today's Range");
  });
});

// ---------------------------------------------------------------------------
// 10. T6 (openmeteo-nullable-scalar-types) — a null Open-Meteo current-block
// scalar omits its own line rather than rendering a false zero or throwing,
// now that OpenMeteoForecastCurrentData declares these fields `number | null`
// (T5). Every field mutated below is wire-possible under Open-Meteo's
// documented null-for-absent contract; none was observed null live at a
// default (no extra params) current-conditions request on 2026-09-01 — this
// pins the guard, not an observed production shape.
// ---------------------------------------------------------------------------

describe('handleGetCurrentConditions — null current-block scalars omit their own line (T6)', () => {
  it('omits Dewpoint/Cloud Cover/Pressure/Conditions/Feels Like/Recent Precipitation when their fields are null, keeping Temperature and Wind', async () => {
    const response = buildOpenMeteoCurrentResponse({
      dew_point_2m: null,
      cloud_cover: null,
      pressure_msl: null,
      weather_code: null,
      apparent_temperature: null,
      precipitation: null,
    });
    const result = await callCurrentConditions(
      { ...LONDON, units: 'imperial' },
      buildFakes(response)
    );
    const text = textOf(result);

    expect(text).not.toContain('**Dewpoint:**');
    expect(text).not.toContain('**Cloud Cover:**');
    expect(text).not.toContain('**Pressure:**');
    expect(text).not.toContain('**Conditions:**');
    expect(text).not.toContain('**Feels Like:**');
    expect(text).not.toContain('## Recent Precipitation');
    expect(text).toContain('**Temperature:**');
    expect(text).toContain('**Wind:**');
    expect(text).not.toMatch(/\bnull\b/);
    expect(text).not.toContain('NaN');
  });

  // G59 pair: the gust clause reads both wind_gusts_10m and wind_speed_10m.
  it('shows the Wind line without a gust clause when wind_gusts_10m is null but wind_speed_10m is present', async () => {
    const response = buildOpenMeteoCurrentResponse({ wind_gusts_10m: null });
    const result = await callCurrentConditions(
      { ...LONDON, units: 'imperial' },
      buildFakes(response)
    );
    const text = textOf(result);

    expect(text).toContain('**Wind:**');
    expect(text).not.toContain('gusting to');
  });

  it('shows the Wind line without a direction clause when wind_direction_10m is null', async () => {
    const response = buildOpenMeteoCurrentResponse({ wind_direction_10m: null });
    const result = await callCurrentConditions(
      { ...LONDON, units: 'imperial' },
      buildFakes(response)
    );
    const text = textOf(result);
    const windLine = text.split('\n').find(l => l.startsWith('**Wind:**'));

    expect(windLine).toBeDefined();
    expect(windLine).not.toContain(' from ');
  });
});
