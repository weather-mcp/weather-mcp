/**
 * Unit tests pinning that a null Open-Meteo marine current-block scalar
 * omits its own line/section rather than rendering "N/A" or a stale header,
 * now that OpenMeteoMarineCurrentData declares these fields `number | null`
 * (T1/T5, openmeteo-nullable-scalar-types).
 *
 * Builder and handler-driving pattern modeled on
 * tests/unit/marine-sea-state-taxonomy.test.ts:244-260 (not imported from —
 * that file's own header comment says its helpers are module-local, not
 * exported).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetMarineConditions } from '../../src/handlers/marineConditionsHandler.js';
import { NO_DATA_LEVEL } from '../../src/utils/marine.js';
import type { OpenMeteoMarineResponse } from '../../src/types/openmeteo.js';

const getMarineMock = vi.fn();
const getStationsMock = vi.fn();
const getGridpointDataMock = vi.fn();

const noaaService = {
  getStations: getStationsMock,
  getGridpointDataByCoordinates: getGridpointDataMock
} as never;
const openMeteoService = { getMarine: getMarineMock } as never;
const locationStore = {} as never;
const geocodingService = {} as never;

// Mid-Atlantic open ocean — outside every Great Lakes/coastal-bay bounding
// box, so shouldUseNOAAMarine routes straight to Open-Meteo.
const COORDS = { latitude: 30.0, longitude: -60.0 };

function buildResponse(currentOverrides: Record<string, unknown> = {}): OpenMeteoMarineResponse {
  return {
    latitude: 30.0,
    longitude: -60.0,
    generationtime_ms: 0.5,
    utc_offset_seconds: 0,
    timezone: 'Atlantic/Bermuda',
    timezone_abbreviation: 'AST',
    elevation: 0,
    current: {
      time: '2026-07-16T11:00',
      interval: 3600,
      wave_height: 1.5,
      wave_direction: 200,
      wave_period: 9.0,
      ...currentOverrides
    }
  } as OpenMeteoMarineResponse;
}

function callHandler(args: Record<string, unknown>) {
  return handleGetMarineConditions(args, noaaService, openMeteoService, locationStore, geocodingService);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Handler falls back to a guessed timezone when getStations rejects.
  getStationsMock.mockRejectedValue(new Error('no station coverage'));
});

describe('get_marine_conditions — null current-block scalars omit their own line (T6)', () => {
  it('renders the Unknown header/description and omits the Significant Wave Height line when wave_height is null', async () => {
    getMarineMock.mockResolvedValue(buildResponse({ wave_height: null }));

    const result = await callHandler({ ...COORDS });
    const text = result.content[0].text;

    expect(text).toContain(`Current Conditions: ${NO_DATA_LEVEL}`);
    expect(text).toContain('Marine conditions data not available');
    // The static "Interpreting Marine Conditions" legend further down also
    // contains the bold label "**Significant Wave Height:**" (as a glossary
    // entry), so scope the assertion to the Wave Conditions section itself
    // rather than the whole report.
    const waveSection = text.slice(
      text.indexOf('## 🌊 Wave Conditions'),
      text.indexOf('### Interpreting Marine Conditions')
    );
    expect(waveSection).not.toContain('**Significant Wave Height:**');
  });

  // Live-observed 2026-09-01: examples/boating-and-marine.md:59 renders
  // "**Peak Period:** N/A" for wind_wave_peak_period null at Sydney Heads
  // -33.85,151.35 — this pins the fixed guard against that live shape.
  it('renders the Wind Waves block without a Peak Period line when wind_wave_peak_period is null', async () => {
    getMarineMock.mockResolvedValue(
      buildResponse({
        wind_wave_height: 1.0,
        wind_wave_direction: 200,
        wind_wave_period: 5.0,
        wind_wave_peak_period: null
      })
    );

    const result = await callHandler({ ...COORDS });
    const text = result.content[0].text;

    expect(text).toContain('### Wind Waves');
    expect(text).not.toContain('**Peak Period:**');
  });

  // Twin of the wind-wave case above (G40) — same live capture,
  // examples/boating-and-marine.md:66, renders "**Peak Period:** N/A" for
  // swell_wave_peak_period null at the same Sydney Heads point. The guard is
  // a separate `if` in the handler (a distinct site from wind_wave's), so it
  // needs its own fixture to be reachable under mutation.
  it('renders the Swell block without a Peak Period line when swell_wave_peak_period is null', async () => {
    getMarineMock.mockResolvedValue(
      buildResponse({
        swell_wave_height: 0.8,
        swell_wave_direction: 161,
        swell_wave_period: 9.7,
        swell_wave_peak_period: null
      })
    );

    const result = await callHandler({ ...COORDS });
    const text = result.content[0].text;

    expect(text).toContain('### Swell');
    expect(text).not.toContain('**Peak Period:**');
  });

  // G59 pair on the ocean-currents OR-guard. Wire-possible under
  // Open-Meteo's documented null-for-absent contract but not observed live in
  // this exact one-null/one-present combination on 2026-09-01.
  it('shows the Ocean Currents section with only Direction when ocean_current_velocity is null', async () => {
    getMarineMock.mockResolvedValue(
      buildResponse({ ocean_current_velocity: null, ocean_current_direction: 90 })
    );

    const result = await callHandler({ ...COORDS });
    const text = result.content[0].text;

    expect(text).toContain('## 🌀 Ocean Currents');
    expect(text).toContain('**Direction:**');
    expect(text).not.toContain('**Velocity:**');
  });

  it('omits the Ocean Currents section entirely when both fields are null', async () => {
    getMarineMock.mockResolvedValue(
      buildResponse({ ocean_current_velocity: null, ocean_current_direction: null })
    );

    const result = await callHandler({ ...COORDS });
    const text = result.content[0].text;

    expect(text).not.toContain('Ocean Currents');
  });

  it('never renders N/A or the literal null across every null-scalar case above, combined', async () => {
    getMarineMock.mockResolvedValue(
      buildResponse({
        wave_height: null,
        wind_wave_height: 1.0,
        wind_wave_direction: 200,
        wind_wave_period: 5.0,
        wind_wave_peak_period: null,
        ocean_current_velocity: null,
        ocean_current_direction: null
      })
    );

    const result = await callHandler({ ...COORDS });
    const text = result.content[0].text;

    expect(text).not.toContain('N/A');
    expect(text).not.toMatch(/\bnull\b/);
  });
});
