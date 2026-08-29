/**
 * Auto-mode NOAA -> Open-Meteo fallback routing tests for get_forecast (D2 / T5).
 *
 * Exercises the real handleGetForecast with plain fake services (no HTTP, no
 * live calls). Mirrors tests/unit/current-conditions-global.test.ts's
 * fallback describe block, but for the forecast handler.
 *
 * Live verification (see docs/global-conditions-hardening-implementation-plan.md
 * T5) showed NOAA's coverage 404 ("Unable to provide data for requested point")
 * actually surfaces as DataNotFoundError, not InvalidLocationError as the design
 * plan originally assumed — InvalidLocationError is NOAA's generic non-coverage
 * 4xx class. forecastHandler.ts catches BOTH when source resolved to NOAA via
 * "auto"; transient failures (ServiceUnavailableError, RateLimitError) and an
 * explicit source: "noaa" still propagate the error.
 *
 * See docs/global-conditions-hardening-plan.md D2 and
 * docs/global-conditions-hardening-implementation-plan.md T5.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import { DataNotFoundError, InvalidLocationError, ServiceUnavailableError } from '../../src/errors/ApiError.js';

/** Toronto, Canada — falls INSIDE the continental-US routing box (the box
 * overruns the border), so auto-routes to NOAA and is the fixture used to
 * exercise the NOAA -> Open-Meteo fallback. */
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };

/** Note text the fallback prepends under the output's top heading. */
const NOAA_FALLBACK_NOTE =
  '*NOAA does not cover this location; showing Open-Meteo model data instead.*';

/**
 * Minimal Open-Meteo daily forecast response. formatOpenMeteoForecast only
 * dereferences fields that are present (all daily.* arrays are optional), so
 * a bare `time` array is enough to drive the daily branch end-to-end.
 *
 * `dailyOverrides` merges onto the default `daily` block (last write wins per
 * key) so callers can inject null-bearing series without disturbing the
 * defaults every pre-existing test relies on.
 */
function buildOpenMeteoForecastResponse(
  dailyOverrides: Partial<NonNullable<OpenMeteoForecastResponse['daily']>> = {}
): OpenMeteoForecastResponse {
  return {
    latitude: 43.65,
    longitude: -79.38,
    generationtime_ms: 0.1,
    utc_offset_seconds: -18000,
    timezone: 'America/Toronto',
    timezone_abbreviation: 'EST',
    elevation: 76,
    daily: {
      time: ['2024-01-01', '2024-01-02'],
      temperature_2m_max: [32, 30],
      temperature_2m_min: [20, 18],
      ...dailyOverrides,
    },
  };
}

/**
 * Fresh NOAA fake with vi.fn() spies. getPointData is the first call
 * formatNOAAForecast makes, so rejecting it is enough to drive every routing
 * scenario here without needing to fake the rest of the NOAA surface.
 */
function buildNoaaFake() {
  return {
    getPointData: vi.fn(),
    getForecast: vi.fn(),
    getHourlyForecast: vi.fn(),
    getGridpointData: vi.fn(),
    getGridpointDataByCoordinates: vi.fn(),
  };
}

function buildOpenMeteoFake(response: OpenMeteoForecastResponse = buildOpenMeteoForecastResponse()) {
  return {
    getForecast: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
}

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

function buildFakes(): Fakes {
  return {
    noaa: buildNoaaFake(),
    openMeteo: buildOpenMeteoFake(),
    ncei: buildNceiFake(),
    // Coordinate-only args mean resolveLocationAsync never touches these.
    locationStore: {},
    geocoding: {},
  };
}

function callForecast(args: Record<string, unknown>, fakes: Fakes) {
  return handleGetForecast(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService,
    fakes.ncei as unknown as NCEIService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

describe('handleGetForecast — auto-mode NOAA -> Open-Meteo fallback (D2)', () => {
  it('falls back to Open-Meteo when NOAA throws DataNotFoundError on an auto-routed border city', async () => {
    const fakes = buildFakes();
    fakes.noaa.getPointData.mockRejectedValue(
      new DataNotFoundError('NOAA', 'Unable to provide data for requested point')
    );

    const result = await callForecast({ ...TORONTO }, fakes);
    const text = textOf(result);

    expect(fakes.openMeteo.getForecast).toHaveBeenCalledTimes(1);
    expect(fakes.noaa.getForecast).not.toHaveBeenCalled();

    // Note is positioned directly under the top heading, before any other content.
    expect(text.startsWith('# Weather Forecast')).toBe(true);
    const headingEnd = text.indexOf('\n');
    const noteIndex = text.indexOf(NOAA_FALLBACK_NOTE);
    expect(noteIndex).toBeGreaterThan(headingEnd);
    expect(text.slice(headingEnd, noteIndex).trim()).toBe('');

    // Open-Meteo-formatted output, including its data-source footer.
    expect(text).toContain('*Data source: Open-Meteo (Global)*');
  });

  it('falls back to Open-Meteo when NOAA throws InvalidLocationError on an auto-routed border city', async () => {
    const fakes = buildFakes();
    fakes.noaa.getPointData.mockRejectedValue(
      new InvalidLocationError('NOAA', 'Coordinates outside NOAA coverage')
    );

    const result = await callForecast({ ...TORONTO }, fakes);
    const text = textOf(result);

    expect(fakes.openMeteo.getForecast).toHaveBeenCalledTimes(1);
    expect(text).toContain(NOAA_FALLBACK_NOTE);
    expect(text).toContain('*Data source: Open-Meteo (Global)*');
  });

  it('does NOT fall back and rejects when NOAA throws ServiceUnavailableError', async () => {
    const fakes = buildFakes();
    fakes.noaa.getPointData.mockRejectedValue(
      new ServiceUnavailableError('NOAA', 'NOAA API is currently unavailable')
    );

    await expect(callForecast({ ...TORONTO }, fakes)).rejects.toThrow(ServiceUnavailableError);
    expect(fakes.openMeteo.getForecast).not.toHaveBeenCalled();
  });

  it('does NOT fall back when source is explicitly "noaa", even for DataNotFoundError', async () => {
    const fakes = buildFakes();
    fakes.noaa.getPointData.mockRejectedValue(
      new DataNotFoundError('NOAA', 'Unable to provide data for requested point')
    );

    await expect(
      callForecast({ ...TORONTO, source: 'noaa' }, fakes)
    ).rejects.toThrow(DataNotFoundError);
    expect(fakes.openMeteo.getForecast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T6 — Pin the omission behaviour of the daily series' null-guarded sites now
// that OpenMeteoForecastDailyData declares every series `(number | null)[]`.
// These fixtures inject nulls to exercise a guard, not because a default
// getForecast() call was observed to produce one: probed live on 2026-08-28,
// the default Open-Meteo forecast request (no `models=` parameter) returned
// no null samples across the fields exercised below. `uv_index_max` is
// provably nullable under `models=ecmwf_ifs025`, but `getForecast` never sets
// `models=`, so a green test here proves the guard exists, not that a caller
// hits it under default settings.
// ---------------------------------------------------------------------------

describe('handleGetForecast — daily series null-guard behaviour (T6)', () => {
  it('renders UV Index only for the day it is present, and does not throw on a null sample', async () => {
    const fakes = buildFakes();
    fakes.openMeteo = buildOpenMeteoFake(
      buildOpenMeteoForecastResponse({ uv_index_max: [4.2, null] })
    );
    fakes.noaa.getPointData.mockRejectedValue(
      new DataNotFoundError('NOAA', 'Unable to provide data for requested point')
    );

    const result = await callForecast({ ...TORONTO }, fakes);
    const text = textOf(result);

    expect(text).toContain('**UV Index:** 4.2');
    const uvLines = text.split('\n').filter(l => l.startsWith('**UV Index:**'));
    expect(uvLines).toEqual(['**UV Index:** 4.2']);
  });

  it('pins all four outcomes of the **Temperature:** compound line under null halves', async () => {
    const fakes = buildFakes();
    fakes.openMeteo = buildOpenMeteoFake(
      buildOpenMeteoForecastResponse({
        time: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'],
        temperature_2m_max: [32, 30, null, null],
        temperature_2m_min: [20, null, 18, null],
      })
    );
    fakes.noaa.getPointData.mockRejectedValue(
      new DataNotFoundError('NOAA', 'Unable to provide data for requested point')
    );

    const result = await callForecast({ ...TORONTO }, fakes);
    const text = textOf(result);

    const tempLines = text.split('\n').filter(l => l.startsWith('**Temperature:**'));
    expect(tempLines).toEqual([
      '**Temperature:** High 32°F / Low 20°F', // both halves present
      '**Temperature:** High 30°F',            // high only
      '**Temperature:** Low 18°F',             // low only
      // day 4 (neither) contributes no line at all
    ]);

    // Explicit shape assertions beyond the array equality above.
    for (const line of tempLines) {
      expect(line).not.toBe('**Temperature:**');
      expect(line.endsWith(' /')).toBe(false);
    }
  });

  it('pins all four outcomes of the **Feels Like:** compound line under null halves', async () => {
    const fakes = buildFakes();
    fakes.openMeteo = buildOpenMeteoFake(
      buildOpenMeteoForecastResponse({
        time: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'],
        temperature_2m_max: [32, 30, 28, 26],
        temperature_2m_min: [20, 18, 16, 14],
        apparent_temperature_max: [35, 33, null, null],
        apparent_temperature_min: [22, null, 19, null],
      })
    );
    fakes.noaa.getPointData.mockRejectedValue(
      new DataNotFoundError('NOAA', 'Unable to provide data for requested point')
    );

    const result = await callForecast({ ...TORONTO }, fakes);
    const text = textOf(result);

    const feelsLines = text.split('\n').filter(l => l.startsWith('**Feels Like:**'));
    expect(feelsLines).toEqual([
      '**Feels Like:** High 35°F / Low 22°F', // both halves present
      '**Feels Like:** High 33°F',            // high only
      '**Feels Like:** Low 19°F',             // low only
      // day 4 (neither) contributes no line at all
    ]);

    // Explicit shape assertions beyond the array equality above.
    for (const line of feelsLines) {
      expect(line).not.toBe('**Feels Like:**');
      expect(line.endsWith(' /')).toBe(false);
    }
  });
});
