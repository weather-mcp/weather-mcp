/**
 * Thermal-stress (frostbite / WBGT) handler tests — NOAA path (T3).
 *
 * See docs/heat-cold-stress-plan.md D4 (which wind chill drives the band),
 * D5 (rendering), D6 (gates). Companion coverage for the Open-Meteo path
 * lives in tests/unit/current-conditions-global.test.ts.
 *
 * Fake/fixture pattern follows tests/unit/noaa-staleness.test.ts: plain fake
 * services (no HTTP), a pinned clock so observation age never triggers the
 * staleness path, and a single nearest station so the D2c retry loop never
 * engages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ObservationResponse, StationCollectionResponse } from '../../src/types/noaa.js';

/** Washington, DC — inside the US routing boxes, so auto routes to NOAA. */
const US_COORDS = { latitude: 38.8951, longitude: -77.0364 };

/** Pinned "now"; the fixture observation is dated 30 minutes earlier, well
 * inside staleAcceptanceMinutes, so the D2c retry loop never engages and the
 * D2b stale warning never fires. */
const NOW = new Date('2026-08-18T12:00:00Z');
const FRESH_TIMESTAMP = new Date(NOW.getTime() - 30 * 60_000).toISOString();

/**
 * Fixture builder. Unlike noaa-staleness.test.ts's fixed-value builder, this
 * one takes overrides for temperature/windChill/relativeHumidity/windSpeed so
 * each test can drive the thermal-stress inputs directly. Temperature/
 * windChill overrides use unitCode 'wmoUnit:degF' so the override value is
 * exactly the Fahrenheit figure the hand-computed expectations below use —
 * both convertToFahrenheit (temperatureConversion.ts) and qvToCelsius
 * (unitFormat.ts) treat a non-degC unitCode as already Fahrenheit/pass
 * through the F<->C round trip correctly.
 */
function buildObservation(overrides: Record<string, unknown> = {}): ObservationResponse {
  return {
    properties: {
      '@id': 'https://api.weather.gov/stations/KAAA/observations/2026-08-18T11:30:00+00:00',
      '@type': 'wx:ObservationStation',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      station: 'https://api.weather.gov/stations/KAAA',
      timestamp: FRESH_TIMESTAMP,
      textDescription: 'Clear',
      // Default fixture: a moderate 68°F / 10 km/h / 50% RH — used as the
      // "neither line renders" case.
      temperature: { unitCode: 'wmoUnit:degF', value: 68 },
      dewpoint: { unitCode: 'wmoUnit:degF', value: 50 },
      windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 270 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 10 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
      ...overrides,
    },
  } as unknown as ObservationResponse;
}

function buildStations(): StationCollectionResponse {
  return {
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          '@id': 'https://api.weather.gov/stations/KAAA',
          '@type': 'wx:ObservationStation',
          elevation: { unitCode: 'wmoUnit:m', value: 10 },
          stationIdentifier: 'KAAA',
          name: 'Alpha Field',
          timeZone: 'America/New_York',
        },
      },
    ] as unknown as StationCollectionResponse['features'],
  };
}

function buildNoaaFake(observation: ObservationResponse) {
  return {
    getStations: vi.fn().mockResolvedValue(buildStations()),
    getLatestObservation: vi.fn().mockResolvedValue(observation),
    getGridpointDataByCoordinates: vi.fn().mockResolvedValue({ properties: {} }),
  };
}

function buildSupportFakes() {
  return {
    openMeteo: {
      getCurrentConditions: vi.fn(),
      getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    },
    ncei: { isAvailable: vi.fn().mockReturnValue(false) },
    locationStore: {},
    geocoding: {},
  };
}

function callHandler(observation: ObservationResponse) {
  const noaa = buildNoaaFake(observation);
  const support = buildSupportFakes();
  return handleGetCurrentConditions(
    { ...US_COORDS },
    noaa as unknown as NOAAService,
    support.openMeteo as unknown as OpenMeteoService,
    support.ncei as unknown as NCEIService,
    support.locationStore as unknown as LocationStore,
    support.geocoding as unknown as GeocodingService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

describe('handleGetCurrentConditions — thermal stress (NOAA path)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the station-published windChill for both the band and the displayed value, non-echoing form', async () => {
    // 10°F air, -25°F published wind chill: the "Feels Like (Wind Chill)"
    // line renders (10 < 50 showWindChill gate, -25 < 10), so the frostbite
    // line must NOT restate its own basis (D4/D5) -- and the band comes from
    // the station's own -25°F, not a computed value.
    const obs = buildObservation({
      temperature: { unitCode: 'wmoUnit:degF', value: 10 },
      windChill: { unitCode: 'wmoUnit:degF', value: -25 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    });
    const text = textOf(await callHandler(obs));

    expect(text).toContain('**Feels Like (Wind Chill):** -25°F');
    expect(text).toContain(
      '🥶 **Frostbite risk (High):** exposed skin can freeze in 10–30 minutes at this wind chill. Cover all skin and limit time outdoors.'
    );
    // Non-echoing form must not restate "wind chill <value>".
    expect(text).not.toContain('wind chill -25°F');
  });

  it('computes the NA Wind Chill Index when windChill is absent, temp + wind present (echoing form)', async () => {
    // -21°F air, 25 mph wind (40.2336 km/h) -> NA WCI = -52.17°F -> rounds
    // -52°F, "Very High" band. No windChill field, so no "Feels Like (Wind
    // Chill)" line renders, and the frostbite line must echo its own basis.
    const obs = buildObservation({
      temperature: { unitCode: 'wmoUnit:degF', value: -21 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 40.2336 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    });
    const text = textOf(await callHandler(obs));

    expect(text).not.toContain('Feels Like (Wind Chill)');
    expect(text).toContain(
      '🥶 **Frostbite risk (Very High):** wind chill -52°F — exposed skin can freeze in 5–10 minutes. Cover all skin and limit time outdoors.'
    );
  });

  it('calm-air carve-out: wind below 3 mph substitutes air temperature, named as air temperature rather than as a wind chill', async () => {
    // -25°F air, 2 km/h wind (~1.24 mph, below the formula's 3 mph floor) ->
    // calculateWindChillF returns null, so the handler falls back to the air
    // temperature itself as the effective value.
    const obs = buildObservation({
      temperature: { unitCode: 'wmoUnit:degF', value: -25 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 2 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    });
    const text = textOf(await callHandler(obs));

    expect(text).toContain(
      '🥶 **Frostbite risk (High):** air temperature -25°F in calm air — exposed skin can freeze in 10–30 minutes. Cover all skin and limit time outdoors.'
    );
  });

  it('renders the WBGT heat line for a hot-humid fixture', async () => {
    // 90°F, 70% RH -> WBGT = 95.74°F -> rounds 96°F, "Extreme" band.
    const obs = buildObservation({
      temperature: { unitCode: 'wmoUnit:degF', value: 90 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 70 },
    });
    const text = textOf(await callHandler(obs));

    expect(text).toContain(
      '🥵 **Heat stress (Extreme):** estimated WBGT 96°F — outdoor exertion is dangerous; rest often, hydrate, and seek shade. *Estimated from temperature and humidity assuming full sun; thresholds vary with acclimatization.*'
    );
  });

  it('renders neither thermal-stress line for a moderate fixture', async () => {
    // Default fixture: 68°F, 10 km/h wind, 50% RH -- far from both gates.
    const obs = buildObservation();
    const text = textOf(await callHandler(obs));

    expect(text).not.toContain('🥶');
    expect(text).not.toContain('🥵');
  });
});
