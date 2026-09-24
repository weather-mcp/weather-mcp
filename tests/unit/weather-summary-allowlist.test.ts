/**
 * Locks get_weather_summary's subArgs allowlist (G85): the summary forwards
 * only the keys it declares on its own schema, never a raw spread of the
 * caller's whole args. Expected key sets are *derived* from
 * TOOL_DEFINITIONS.get_weather_summary.inputSchema.properties rather than
 * restated by hand, so a key added to the schema without a forwarding
 * decision — or removed from forwarding without also being removed from the
 * schema — shows up here as a failing (or newly-passing) assertion rather
 * than staying invisible.
 *
 * Mock pattern (all five sub-handlers mocked at the module seam) copied from
 * tests/unit/weather-summary-handler.test.ts. The TOOL_DEFINITIONS import
 * follows tests/unit/search-location-fractional-limit.test.ts (G61/G21
 * residue): the two ANALYTICS_* env vars are hoisted so they land before the
 * static src/server/weatherServer.js import evaluates, and that import
 * happens exactly once, never re-imported under vi.resetModules() (which
 * would re-construct every service and its Cache timers). This file never
 * imports src/index.ts (G61).
 *
 * Real handlers + fake services, with no module mocks, live in the sibling
 * file tests/unit/weather-summary-source.test.ts instead — deliberately not
 * mixed with this file's mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';

const currentMock = vi.fn();
const forecastMock = vi.fn();
const alertsMock = vi.fn();
const airQualityMock = vi.fn();
const lightningMock = vi.fn();

vi.mock('../../src/handlers/currentConditionsHandler.js', () => ({
  handleGetCurrentConditions: (...args: unknown[]) => currentMock(...args),
}));
vi.mock('../../src/handlers/forecastHandler.js', () => ({
  handleGetForecast: (...args: unknown[]) => forecastMock(...args),
}));
vi.mock('../../src/handlers/alertsHandler.js', () => ({
  handleGetAlerts: (...args: unknown[]) => alertsMock(...args),
}));
vi.mock('../../src/handlers/airQualityHandler.js', () => ({
  handleGetAirQuality: (...args: unknown[]) => airQualityMock(...args),
}));
vi.mock('../../src/handlers/lightningHandler.js', () => ({
  handleGetLightningActivity: (...args: unknown[]) => lightningMock(...args),
}));

// Both must be set before the static weatherServer.js import below evaluates.
vi.hoisted(() => {
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'weather-summary-allowlist-test';
});

// Import src/server/weatherServer.js once, statically (G61/G21 residue).
import { TOOL_DEFINITIONS } from '../../src/server/weatherServer.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';

function textResult(text: string) {
  return { content: [{ type: 'text', text }] };
}

type SummaryDefinition = {
  inputSchema: { properties: Record<string, unknown> };
};

const summaryDef = (
  TOOL_DEFINITIONS as unknown as { get_weather_summary: SummaryDefinition }
).get_weather_summary;

// ---------------------------------------------------------------------------
// Derive, do not restate.
// ---------------------------------------------------------------------------

const declared = Object.keys(summaryDef.inputSchema.properties);

// Consumed by the summary itself rather than forwarded to a section — each
// for a distinct reason, not "whatever a spread happened to strip":
//   - location_name / city_name: resolved to latitude/longitude once up
//     front, so no sub-handler re-geocodes.
//   - include: selects which sections run; it is not a sub-handler argument.
//   - days: goes to the forecast section only (only a forecast has a
//     horizon).
const CONSUMED_NOT_FORWARDED = ['location_name', 'city_name', 'include', 'days'];

const nonForecastExpected = declared
  .filter(key => !CONSUMED_NOT_FORWARDED.includes(key))
  .sort();
const forecastExpected = [...nonForecastExpected, 'days'].sort();

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Coordinates always win in resolveLocationAsync, so a store that throws on
 * any read proves the store was never touched. */
function throwingStore(): LocationStore {
  return {
    get: vi.fn(() => {
      throw new Error('locationStore.get should not be called when coordinates are provided');
    }),
    getAll: vi.fn(() => {
      throw new Error('locationStore.getAll should not be called when coordinates are provided');
    }),
  } as unknown as LocationStore;
}

function throwingGeocoding(): GeocodingService {
  return {
    geocode: vi.fn(() => {
      throw new Error('geocodingService.geocode should not be called when coordinates are provided');
    }),
  } as unknown as GeocodingService;
}

function callSummary(args: Record<string, unknown>) {
  return handleGetWeatherSummary(
    args,
    {} as unknown as NOAAService,
    {} as unknown as OpenMeteoService,
    {} as unknown as NCEIService,
    throwingStore(),
    throwingGeocoding()
  );
}

const MEMPHIS = { latitude: 35.1495, longitude: -90.049 };

// ---------------------------------------------------------------------------
// Positive controls — prove `declared` really came from the schema, and that
// the consumed-not-forwarded list and the sub-handler-only list are the sets
// this file assumes them to be. Without these, a renamed or restructured
// schema makes every comparison below pass vacuously.
// ---------------------------------------------------------------------------

describe('get_weather_summary schema (positive controls)', () => {
  it('declares source and all seven unit keys', () => {
    expect(declared).toContain('source');
    for (const key of [
      'units',
      'temperature_unit',
      'wind_speed_unit',
      'precipitation_unit',
      'pressure_unit',
      'distance_unit',
      'time_format',
    ]) {
      expect(declared).toContain(key);
    }
  });

  it('the consumed-not-forwarded set is a subset of the declared schema', () => {
    for (const key of CONSUMED_NOT_FORWARDED) {
      expect(declared).toContain(key);
    }
  });

  it('never declares a sub-handler-only parameter', () => {
    const subHandlerOnly = [
      'granularity',
      'include_fire_weather',
      'include_normals',
      'include_astronomy',
      'include_precipitation_probability',
      'include_severe_weather',
      'compare_models',
      'ensemble_spread',
      'active_only',
      'forecast',
      'forecast_days',
      'radius',
      'timeWindow',
    ];
    for (const key of subHandlerOnly) {
      expect(declared).not.toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

describe('get_weather_summary subArgs allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMock.mockResolvedValue(textResult('# Current Weather Conditions\nSunny'));
    forecastMock.mockResolvedValue(textResult('# Weather Forecast (Daily)\nWarm'));
    alertsMock.mockResolvedValue(textResult('# Weather Alerts\nNone'));
    airQualityMock.mockResolvedValue(textResult('# Air Quality Report\nGood'));
    lightningMock.mockResolvedValue(textResult('# Lightning Activity Report\nSafe'));
  });

  it('forwards exactly the allowlisted keys to every section — every undeclared sub-handler key is sent by the caller and reaches none of them', async () => {
    const everyUndeclaredSubHandlerKey = {
      granularity: 'hourly',
      include_normals: true,
      include_astronomy: true,
      include_precipitation_probability: true,
      include_severe_weather: true,
      include_fire_weather: true,
      active_only: false,
      forecast: true,
      forecast_days: 3,
      radius: 25,
      timeWindow: 30,
      compare_models: true,
      ensemble_spread: true,
    };

    await callSummary({
      ...MEMPHIS,
      // Coordinates win in resolveLocationAsync, so this is never read — the
      // throwing store proves it.
      location_name: 'should-be-ignored-coordinates-win',
      include: ['current', 'forecast', 'alerts', 'air_quality', 'lightning'],
      days: 5,
      source: 'openmeteo',
      detail: 'standard',
      units: 'metric',
      temperature_unit: 'C',
      wind_speed_unit: 'kmh',
      precipitation_unit: 'mm',
      pressure_unit: 'hPa',
      distance_unit: 'km',
      time_format: '24h',
      ...everyUndeclaredSubHandlerKey,
    });

    for (const mock of [currentMock, alertsMock, airQualityMock, lightningMock]) {
      expect(mock).toHaveBeenCalledTimes(1);
      const forwarded = mock.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.keys(forwarded).sort()).toEqual(nonForecastExpected);
    }

    expect(forecastMock).toHaveBeenCalledTimes(1);
    const forwardedForecast = forecastMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(forwardedForecast).sort()).toEqual(forecastExpected);
    expect(forwardedForecast.source).toBe('openmeteo');
    expect(forwardedForecast.days).toBe(5);
    expect(forwardedForecast.latitude).toBe(MEMPHIS.latitude);
    expect(forwardedForecast.longitude).toBe(MEMPHIS.longitude);
  });

  it('forwards exactly latitude, longitude and detail (plus days to the forecast) when nothing else is sent, with no forwarded key undefined', async () => {
    await callSummary({ ...MEMPHIS, include: ['current', 'forecast'] });

    expect(currentMock).toHaveBeenCalledTimes(1);
    const forwardedCurrent = currentMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(forwardedCurrent).sort()).toEqual(['detail', 'latitude', 'longitude']);
    for (const value of Object.values(forwardedCurrent)) {
      expect(value).not.toBeUndefined();
    }

    expect(forecastMock).toHaveBeenCalledTimes(1);
    const forwardedForecast = forecastMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(forwardedForecast).sort()).toEqual(['days', 'detail', 'latitude', 'longitude']);
    for (const value of Object.values(forwardedForecast)) {
      expect(value).not.toBeUndefined();
    }
  });
});

describe('get_weather_summary source refusals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function expectZeroSubHandlerCalls() {
    for (const mock of [currentMock, forecastMock, alertsMock, airQualityMock, lightningMock]) {
      expect(mock).not.toHaveBeenCalled();
    }
  }

  it('rejects source: "metar" before calling any sub-handler', async () => {
    await expect(callSummary({ ...MEMPHIS, source: 'metar' })).rejects.toThrow(/Invalid source/);
    expectZeroSubHandlerCalls();
  });

  it('rejects an arbitrary invalid string source before calling any sub-handler', async () => {
    await expect(callSummary({ ...MEMPHIS, source: 'x' })).rejects.toThrow(/Invalid source/);
    expectZeroSubHandlerCalls();
  });

  it('rejects a numeric source before calling any sub-handler', async () => {
    await expect(callSummary({ ...MEMPHIS, source: 42 })).rejects.toThrow(/Invalid source/);
    expectZeroSubHandlerCalls();
  });

  it('the refusal message names auto, noaa and openmeteo', async () => {
    await expect(callSummary({ ...MEMPHIS, source: 'metar' })).rejects.toThrow(
      /auto.*noaa.*openmeteo/
    );
  });
});
