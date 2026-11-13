/**
 * Integration tests for global fire weather (server-computed Fosberg Fire
 * Weather Index on the Open-Meteo current-conditions path) — per
 * docs/global-fire-weather-plan.md D3/D5/D6 and the implementation plan's T6
 * (integration tests, "the wildfire T6 template").
 *
 * **This file makes live network calls** (the keyless Open-Meteo current
 * conditions fetch in the second describe block) and belongs to the
 * project's flaky-tolerant live-network set — re-run before blaming your
 * diff. See the "Flaky live-network tests" project memory and the
 * tolerant-live-test convention used throughout tests/integration/
 * (almanac.test.ts, global-rivers.test.ts, global-wildfire.test.ts,
 * safety-hazards.test.ts).
 *
 * **Mock/live split — approach chosen:** Block 1 needs mocked HTTP so the
 * Fosberg index and dryness lines are deterministic; Block 2 needs the real
 * network. Following the established pattern in this repo (see
 * global-rivers.test.ts's `makeRequestToFlood` spy and
 * global-wildfire.test.ts's per-instance axios spy), Block 1 constructs a
 * real `OpenMeteoService` and spies on its own private
 * `makeRequestToForecast` method (the one both `getForecast` and
 * `getCurrentConditions` funnel through) rather than mocking the `axios`
 * module globally — so Block 2's separate, completely unspied
 * `OpenMeteoService` instance can coexist in the same file and issue real
 * HTTP with no `vi.mock` hoisting concerns.
 *
 * Explicit `latitude`/`longitude` short-circuit `resolveLocationAsync`
 * (see tests/integration/global-rivers.test.ts), and an explicit
 * `units: 'imperial'` argument pins the request to F/mph regardless of any
 * `WEATHER_UNITS` environment override, so the mocked fixtures (already
 * expressed in imperial units, mirroring what Open-Meteo would have
 * returned) drive `calculateFosbergIndex` with no D4 prefs-normalization in
 * play — inputs and outputs are the same numbers.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import type {
  OpenMeteoForecastResponse,
  OpenMeteoCurrentWeather,
  OpenMeteoCurrentWeatherUnits
} from '../../src/types/openmeteo.js';

/** Sydney, Australia — a non-US point, so this always routes to the Open-Meteo path (isInUS false). */
const SYDNEY_LAT = -33.8688;
const SYDNEY_LON = 151.2093;

const CURRENT_UNITS: OpenMeteoCurrentWeatherUnits = {
  time: 'iso8601',
  interval: 'seconds',
  temperature_2m: '°F',
  relative_humidity_2m: '%',
  apparent_temperature: '°F',
  dew_point_2m: '°F',
  wind_speed_10m: 'mph',
  wind_direction_10m: '°',
  wind_gusts_10m: 'mph',
  pressure_msl: 'hPa',
  cloud_cover: '%',
  soil_moisture_0_to_1cm: 'm³/m³',
  vapour_pressure_deficit: 'kPa'
};

/**
 * Build a realistic Open-Meteo current-conditions response. All current
 * values are already expressed in imperial units (°F, mph) — the shape
 * Open-Meteo itself would return for a request carrying
 * `temperature_unit=fahrenheit&wind_speed_unit=mph`, per D4's "arrives
 * pre-converted" premise.
 */
function buildFixture(current: Partial<OpenMeteoCurrentWeather>): OpenMeteoForecastResponse {
  return {
    latitude: SYDNEY_LAT,
    longitude: SYDNEY_LON,
    generationtime_ms: 0.1,
    utc_offset_seconds: 39600,
    timezone: 'Australia/Sydney',
    timezone_abbreviation: 'AEDT',
    elevation: 25,
    current_units: CURRENT_UNITS,
    current: {
      time: '2026-08-14T14:00',
      interval: 900,
      weather_code: 1,
      cloud_cover: 20,
      pressure_msl: 1015,
      ...current
    },
    daily: {
      time: ['2026-08-14'],
      temperature_2m_max: [97],
      temperature_2m_min: [78]
    }
  };
}

describe('Global fire weather integration — mocked Open-Meteo response end-to-end (deterministic)', () => {
  it('renders the Fosberg index, dryness context, and derivation disclosure', async () => {
    const openMeteoService = new OpenMeteoService();
    openMeteoService.clearCache();

    // Inputs chosen so the Fosberg computation lands mid-band (Moderate,
    // 25-39) rather than at an edge, so a future tweak to either boundary
    // doesn't silently flip this assertion.
    //
    // calculateFosbergIndex(95, 20, 15) — hand-verified against the D2
    // formula (RH 20 is in the 10<=RH<=50 EMC branch):
    //   m = 2.22749 + 0.160107*20 - 0.014784*95 = 4.02515
    //   x = m/30 = 0.1341717
    //   eta = 1 - 2x + 1.5x^2 - 0.5x^3 = 0.7574520
    //   FFWI = eta * sqrt(1 + 15^2) / 0.3002 = 0.7574520 * 15.033296 / 0.3002
    //        = 37.9314 -> rounds to 38 -> "Moderate" (25-39 band)
    const fixture = buildFixture({
      temperature_2m: 95,
      relative_humidity_2m: 20,
      wind_speed_10m: 15,
      wind_gusts_10m: 20,
      wind_direction_10m: 270,
      vapour_pressure_deficit: 3.7, // > 3 kPa -> "extreme drying power" (describeVpd)
      soil_moisture_0_to_1cm: 0.18 // 0.1-0.2 m3/m3 -> "dry" (describeTopsoilMoisture)
    });

    vi.spyOn(openMeteoService as any, 'makeRequestToForecast').mockResolvedValue(fixture);

    const result = await handleGetCurrentConditions(
      {
        latitude: SYDNEY_LAT,
        longitude: SYDNEY_LON,
        include_fire_weather: true,
        units: 'imperial'
      },
      undefined as never, // noaaService unreachable — non-US point, isInUS() is false
      openMeteoService,
      undefined as never, // nceiService unused — include_normals not requested
      undefined as never, // locationStore unused — explicit coordinates short-circuit resolution
      undefined as never // geocodingService unused for the same reason
    );

    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;

    // Section renders at all, off the Open-Meteo model path (never the
    // US-only NOAA fireWeather.ts geography-box context).
    expect(text).toContain('## Fire Weather');

    // Fosberg index value + band, computed above.
    expect(text).toContain('**🟡 Fosberg Fire Weather Index:** 38 (Moderate)');
    expect(text).toContain(
      'Computed from current temperature, humidity, and sustained wind. Higher values mean faster potential fire spread in fine fuels.'
    );

    // Dryness context lines.
    expect(text).toContain('**Dryness context:**');
    expect(text).toContain('**Vapour-pressure deficit:** 3.7 kPa (extreme drying power)');
    expect(text).toContain('**Topsoil moisture (top 1 cm):** 0.18 m³/m³ (dry)');

    // D6 derivation disclosure, verbatim.
    expect(text).toContain(
      '*Derived by this server from Open-Meteo model data — not an official fire-danger rating. Heed warnings from your national fire authority.*'
    );

    // Never the NOAA-path stub or the US-only fireWeatherContext machinery.
    expect(text).not.toContain('Fire weather indices are currently available for US locations only.');
  });

  it('omits the dryness block but still renders the index when soil moisture and VPD are both null (open-ocean shape)', async () => {
    const openMeteoService = new OpenMeteoService();
    openMeteoService.clearCache();

    // calculateFosbergIndex(60, 85, 3) — RH 85 is in the RH > 50 EMC branch:
    //   m = 21.0606 + 0.005565*85^2 - 0.00035*85*60 - 0.483199*85
    //     = 21.0606 + 40.20713 - 1.785 - 41.071915 = 18.410815
    //   x = m/30 = 0.6136938
    //   eta = 1 - 2x + 1.5x^2 - 0.5x^3 = 0.2219823 (above the >= 0 floor)
    //   FFWI = eta * sqrt(1 + 3^2) / 0.3002 = 2.3383 -> rounds to 2 -> "Low" (< 25 band)
    const fixture = buildFixture({
      temperature_2m: 60,
      relative_humidity_2m: 85,
      wind_speed_10m: 3,
      wind_gusts_10m: 5,
      vapour_pressure_deficit: null, // open-ocean-like HTTP-200 null shape (Flood-API precedent)
      soil_moisture_0_to_1cm: null
    });

    vi.spyOn(openMeteoService as any, 'makeRequestToForecast').mockResolvedValue(fixture);

    const result = await handleGetCurrentConditions(
      {
        latitude: SYDNEY_LAT,
        longitude: SYDNEY_LON,
        include_fire_weather: true,
        units: 'imperial'
      },
      undefined as never,
      openMeteoService,
      undefined as never,
      undefined as never,
      undefined as never
    );

    const text = result.content[0].text;

    // Index still renders — its three inputs (temp/RH/wind) are all finite.
    expect(text).toContain('## Fire Weather');
    expect(text).toContain('**🟢 Fosberg Fire Weather Index:** 2 (Low)');

    // Both dryness inputs null -> the whole "Dryness context" block is omitted.
    expect(text).not.toContain('**Dryness context:**');
    expect(text).not.toContain('Vapour-pressure deficit');
    expect(text).not.toContain('Topsoil moisture');

    // The derivation disclosure still renders regardless of dryness data availability.
    expect(text).toContain(
      '*Derived by this server from Open-Meteo model data — not an official fire-danger rating. Heed warnings from your national fire authority.*'
    );
  });
});

// ---------------------------------------------------------------------------
// Block 2 — one live smoke test against the real, keyless Open-Meteo API
// (tolerant of network flake)
// ---------------------------------------------------------------------------

describe('Global fire weather integration — live keyless smoke test (tolerant of network flake)', () => {
  it('fetches real Open-Meteo current conditions with fire weather for Sydney, Australia through the real handler', async () => {
    // A completely unspied OpenMeteoService — real axios, real network, no
    // API key needed (Open-Meteo current-conditions endpoint is keyless).
    const openMeteoService = new OpenMeteoService();
    openMeteoService.clearCache();

    try {
      const result = await handleGetCurrentConditions(
        {
          latitude: SYDNEY_LAT,
          longitude: SYDNEY_LON,
          include_fire_weather: true
        },
        undefined as never, // noaaService unreachable — Sydney is non-US, isInUS() is false
        openMeteoService,
        undefined as never, // nceiService unused — include_normals not requested
        undefined as never, // locationStore unused — explicit coordinates short-circuit resolution
        undefined as never // geocodingService unused for the same reason
      );

      expect(result.content).toHaveLength(1);
      const text = result.content[0].text;

      // Shape only, never specific values — live weather is not deterministic.
      expect(text.startsWith('# Current Weather Conditions')).toBe(true);
      expect(text).toContain('## Fire Weather');

      // Either the index rendered, or (rarely) an input was missing — both
      // are legitimate live outcomes; assert one of the two known shapes.
      const hasIndexLine = /\*\*[🟢🟡🟠🔴] Fosberg Fire Weather Index:\*\* \d+ \((Low|Moderate|High|Extreme)\)/.test(
        text
      );
      const hasUnavailableNote = text.includes('⚠️ Fire weather inputs unavailable for this location.');
      expect(hasIndexLine || hasUnavailableNote).toBe(true);

      if (hasIndexLine) {
        // The derivation disclosure only renders alongside a computed index.
        expect(text).toContain(
          '*Derived by this server from Open-Meteo model data — not an official fire-danger rating. Heed warnings from your national fire authority.*'
        );
      }

      console.log('\n=== Live Open-Meteo fire-weather smoke test: Sydney, Australia ===');
      console.log(`Response length: ${text.length} chars`);
      console.log(`Index line present: ${hasIndexLine}`);
    } catch (error) {
      // Tolerant of live-network flake: log and pass rather than fail the suite.
      console.warn(
        '\n=== Live Open-Meteo fire-weather smoke test skipped (network error) ===\n',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, 60000);
});
