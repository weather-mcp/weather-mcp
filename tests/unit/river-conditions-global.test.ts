/**
 * Handler tests for global (Open-Meteo Flood API / GloFAS v4) river conditions.
 *
 * Exercises the real handleGetRiverConditions with plain fake services (no
 * HTTP, no live network calls) to prove:
 *   - source routing (auto/noaa/openmeteo) picks the right backend (D1)
 *   - neither backend's fake is touched on the other's path
 *   - the 9-point probe grid shape and center-index contract (D3)
 *   - channel snapping — the snap note appears/disappears correctly (D3)
 *   - the all-null "no river data" result, without throwing (D3)
 *   - the minor-drainage label below the 0.1 m³/s threshold (D3)
 *   - output framing/attribution strings (D6)
 *   - forecast_days default/pass-through/validation (D2)
 *   - detail level row caps and the full-only min/max range (D4)
 *   - the m³/s Unicode unit survives into rendered output
 *
 * See docs/global-rivers-plan.md.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetRiverConditions } from '../../src/handlers/riverConditionsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoFloodResponse } from '../../src/types/openmeteo.js';
import { buildProbeGrid, PROBE_GRID_CENTER_INDEX } from '../../src/utils/riverDischarge.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** St. Louis, MO — inside the US, near the Mississippi. */
const US_POINT = { latitude: 38.6270, longitude: -90.1994 };
/** London, UK — outside the US routing boxes. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

const FORECAST_DAYS_DEFAULT = 7;

/**
 * Build the daily `time` array the Flood API returns for a `past_days=31`
 * request: 31 days ending yesterday, then today, then `forecastDays - 1` more
 * days (today is forecast day 1). Computed relative to the real clock in UTC
 * — these fixtures always use `utc_offset_seconds: 0` — so `findTodayIndex`
 * resolves "today" to index 31 without any drift against the actual date.
 */
function buildTimeArray(forecastDays: number = FORECAST_DAYS_DEFAULT): string[] {
  const now = new Date();
  const time: string[] = [];
  for (let offset = -31; offset < forecastDays; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
    time.push(d.toISOString().slice(0, 10));
  }
  return time;
}

interface CellConfig {
  latitude: number;
  longitude: number;
  forecastDays?: number;
  /** Uniform value for all 31 past days (also the default forecast value). */
  pastValue?: number;
  /** Per-day river_discharge_median values, length = forecastDays, day 1 = today. Defaults to repeating pastValue. */
  median?: Array<number | null>;
  /** river_discharge's own forecast-window values; defaults to `median`. */
  riverDischargeForecast?: Array<number | null>;
  min?: Array<number | null>;
  max?: Array<number | null>;
}

/** One Flood API cell with a uniform 31-day past window and a controllable forecast. */
function buildCell(cfg: CellConfig): OpenMeteoFloodResponse {
  const forecastDays = cfg.forecastDays ?? FORECAST_DAYS_DEFAULT;
  const time = buildTimeArray(forecastDays);
  const pastSeries: Array<number | null> = Array(31).fill(cfg.pastValue ?? 0);
  const medianForecast: Array<number | null> = cfg.median ?? Array(forecastDays).fill(cfg.pastValue ?? 0);
  const dischargeForecast: Array<number | null> = cfg.riverDischargeForecast ?? medianForecast;

  const pad = (values: Array<number | null> | undefined): Array<number | null> | undefined =>
    values ? [...Array(31).fill(null), ...values] : undefined;

  return {
    latitude: cfg.latitude,
    longitude: cfg.longitude,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'UTC',
    timezone_abbreviation: 'UTC',
    daily_units: {
      time: 'iso8601',
      river_discharge: 'm³/s',
      river_discharge_median: 'm³/s',
      river_discharge_p25: 'm³/s',
      river_discharge_p75: 'm³/s',
      river_discharge_min: 'm³/s',
      river_discharge_max: 'm³/s'
    },
    daily: {
      time,
      river_discharge: [...pastSeries, ...dischargeForecast],
      river_discharge_median: pad(medianForecast),
      river_discharge_min: pad(cfg.min),
      river_discharge_max: pad(cfg.max)
    }
  };
}

/** A cell whose entire series is null — ocean, desert, no modeled channel. */
function buildAllNullCell(
  latitude: number,
  longitude: number,
  forecastDays: number = FORECAST_DAYS_DEFAULT
): OpenMeteoFloodResponse {
  const time = buildTimeArray(forecastDays);
  const nulls: Array<number | null> = Array(time.length).fill(null);
  return {
    latitude,
    longitude,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'UTC',
    timezone_abbreviation: 'UTC',
    daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
    daily: { time, river_discharge: nulls, river_discharge_median: nulls }
  };
}

/**
 * Build the 9-cell probe grid response using the real `buildProbeGrid`, so
 * probed coordinates in the fixture always match what the handler itself
 * requests. `pastValues[i]` sets cell i's uniform past-window (and default
 * forecast) discharge; `overrides[i]` replaces a cell wholesale.
 */
function buildGrid(
  centerLat: number,
  centerLon: number,
  pastValues: number[],
  overrides: Record<number, OpenMeteoFloodResponse> = {},
  forecastDays: number = FORECAST_DAYS_DEFAULT
): OpenMeteoFloodResponse[] {
  const grid = buildProbeGrid(centerLat, centerLon);
  return grid.map((point, i) => {
    if (overrides[i]) {
      return overrides[i];
    }
    return buildCell({
      latitude: point.latitude,
      longitude: point.longitude,
      forecastDays,
      pastValue: pastValues[i]
    });
  });
}

function buildNoaaFake() {
  return {
    getNWPSGaugesInBoundingBox: vi.fn().mockResolvedValue([]),
    getNWPSStageFlow: vi.fn()
  };
}

function buildOpenMeteoFake(cells: OpenMeteoFloodResponse[]) {
  return {
    getRiverDischarge: vi.fn().mockResolvedValue(cells)
  };
}

interface Fakes {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
}

function buildFakes(cells: OpenMeteoFloodResponse[]): Fakes {
  return {
    noaa: buildNoaaFake(),
    openMeteo: buildOpenMeteoFake(cells),
    // Coordinate-only args mean resolveLocationAsync never touches these.
    locationStore: {},
    geocoding: {}
  };
}

function callRiverConditions(args: Record<string, unknown>, fakes: Fakes) {
  return handleGetRiverConditions(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService,
    fakes.openMeteo as unknown as OpenMeteoService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

/** Forecast-day rows are the only lines that start with "- **". */
function countForecastRows(text: string): number {
  return (text.match(/^- \*\*/gm) || []).length;
}

// ---------------------------------------------------------------------------
// 1. Routing
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — source routing (D1)', () => {
  it('routes US coordinates to NOAA on auto', async () => {
    const fakes = buildFakes(buildGrid(US_POINT.latitude, US_POINT.longitude, Array(9).fill(500)));

    await callRiverConditions({ ...US_POINT }, fakes);

    expect(fakes.noaa.getNWPSGaugesInBoundingBox).toHaveBeenCalledTimes(1);
    expect(fakes.openMeteo.getRiverDischarge).not.toHaveBeenCalled();
  });

  it('routes non-US coordinates to Open-Meteo on auto', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    await callRiverConditions({ ...LONDON }, fakes);

    expect(fakes.openMeteo.getRiverDischarge).toHaveBeenCalledTimes(1);
    expect(fakes.noaa.getNWPSGaugesInBoundingBox).not.toHaveBeenCalled();
  });

  it('honors explicit source: "noaa" at non-US coordinates', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    await callRiverConditions({ ...LONDON, source: 'noaa' }, fakes);

    expect(fakes.noaa.getNWPSGaugesInBoundingBox).toHaveBeenCalledTimes(1);
    expect(fakes.openMeteo.getRiverDischarge).not.toHaveBeenCalled();
  });

  it('honors explicit source: "openmeteo" at US coordinates', async () => {
    const fakes = buildFakes(buildGrid(US_POINT.latitude, US_POINT.longitude, Array(9).fill(500)));

    await callRiverConditions({ ...US_POINT, source: 'openmeteo' }, fakes);

    expect(fakes.openMeteo.getRiverDischarge).toHaveBeenCalledTimes(1);
    expect(fakes.noaa.getNWPSGaugesInBoundingBox).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Negative assertion — no cross-talk between the two backends
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — no cross-talk between backends', () => {
  it('never touches the NOAA fake on the non-US auto path', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    await callRiverConditions({ ...LONDON }, fakes);

    expect(fakes.noaa.getNWPSGaugesInBoundingBox).not.toHaveBeenCalled();
    expect(fakes.noaa.getNWPSStageFlow).not.toHaveBeenCalled();
  });

  it('never touches the Open-Meteo fake on the US auto path', async () => {
    const fakes = buildFakes(buildGrid(US_POINT.latitude, US_POINT.longitude, Array(9).fill(500)));

    await callRiverConditions({ ...US_POINT }, fakes);

    expect(fakes.openMeteo.getRiverDischarge).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Probe grid shape
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — probe grid shape (D3)', () => {
  it('requests exactly 9 probe points with the requested point at index 4', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    await callRiverConditions({ ...LONDON }, fakes);

    expect(fakes.openMeteo.getRiverDischarge).toHaveBeenCalledTimes(1);
    const [latitudes, longitudes] = fakes.openMeteo.getRiverDischarge.mock.calls[0];
    expect(latitudes).toHaveLength(9);
    expect(longitudes).toHaveLength(9);
    expect(PROBE_GRID_CENTER_INDEX).toBe(4);
    expect(latitudes[PROBE_GRID_CENTER_INDEX]).toBeCloseTo(LONDON.latitude, 4);
    expect(longitudes[PROBE_GRID_CENTER_INDEX]).toBeCloseTo(LONDON.longitude, 4);
  });
});

// ---------------------------------------------------------------------------
// 4. Channel snapping
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — channel snapping (D3)', () => {
  it('emits a snap note when a neighboring cell wins', async () => {
    // buildProbeGrid emits latitude-major order (south row, then middle row,
    // then north row; west-to-east within each row) — index 3 is the west
    // neighbor of the center (index 4).
    const pastValues = Array(9).fill(0.5);
    pastValues[3] = 5000; // the west cell carries the "river"
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, pastValues));

    const result = await callRiverConditions({ ...LONDON, units: 'metric' }, fakes);
    const text = textOf(result);

    expect(text).toMatch(/Nearest modeled river channel: ~\d+ km [NSEW]+ of requested point/);
  });

  it('omits the snap note when the center cell wins', async () => {
    const pastValues = Array(9).fill(10);
    pastValues[PROBE_GRID_CENTER_INDEX] = 5000; // center wins outright
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, pastValues));

    const result = await callRiverConditions({ ...LONDON, units: 'metric' }, fakes);
    const text = textOf(result);

    expect(text).not.toMatch(/Nearest modeled river channel/);
  });
});

// ---------------------------------------------------------------------------
// 5. All-null response
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — all-null response', () => {
  it('renders a friendly "no river data" message without throwing, and still emits the footer', async () => {
    const grid = buildProbeGrid(LONDON.latitude, LONDON.longitude);
    const cells = grid.map(p => buildAllNullCell(p.latitude, p.longitude));
    const fakes = buildFakes(cells);

    const result = await callRiverConditions({ ...LONDON }, fakes);
    const text = textOf(result);

    expect(text).toContain('No river data for this location');
    expect(text).toContain('*River discharge data by Open-Meteo.com (CC-BY 4.0)*');
  });
});

// ---------------------------------------------------------------------------
// 6. Minor drainage threshold
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — minor drainage threshold', () => {
  it('labels a winning cell below 0.1 m³/s as minor local drainage', async () => {
    const pastValues = Array(9).fill(0.01);
    pastValues[PROBE_GRID_CENTER_INDEX] = 0.05; // wins, still below the 0.1 m³/s threshold
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, pastValues));

    const result = await callRiverConditions({ ...LONDON, units: 'metric' }, fakes);
    const text = textOf(result);

    expect(text).toContain('minor local drainage — no significant river within ~8 km');
  });
});

// ---------------------------------------------------------------------------
// 7. Output framing and attribution (D6)
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — output framing and attribution (D6)', () => {
  it('renders the Open-Meteo source line, the model caveat, and the CC-BY footer', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    const result = await callRiverConditions({ ...LONDON, units: 'metric' }, fakes);
    const text = textOf(result);

    expect(text).toContain('**Source:** Open-Meteo Flood API (GloFAS v4, ~5 km model grid)');
    expect(text).toContain(
      '⚠️ Model-estimated river discharge — not gauge observations. No official ' +
      'flood-stage thresholds exist for this data; levels are shown relative to ' +
      'recent history and the forecast ensemble.'
    );
    expect(text).toContain('*River discharge data by Open-Meteo.com (CC-BY 4.0)*');
  });

  it('does not render the NOAA Search Radius line or NWPS credit on the global path', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    const result = await callRiverConditions({ ...LONDON }, fakes);
    const text = textOf(result);

    expect(text).not.toContain('**Search Radius:**');
    expect(text).not.toContain('NOAA National Water Prediction Service');
  });

  it('shows both m³/s and ft³/s in the Current Discharge line under the default (imperial) unit preference', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    const result = await callRiverConditions({ ...LONDON }, fakes);
    const text = textOf(result);

    expect(text).toMatch(/\*\*Discharge:\*\* [\d,.]+ m³\/s \([\d,.]+ ft³\/s\)/);
  });
});

// ---------------------------------------------------------------------------
// 8. forecast_days (D2)
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — forecast_days (D2)', () => {
  it('defaults to 7 when not provided', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    await callRiverConditions({ ...LONDON }, fakes);

    const [, , forecastDays] = fakes.openMeteo.getRiverDischarge.mock.calls[0];
    expect(forecastDays).toBe(7);
  });

  it('passes an explicit forecast_days value through to the service', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500), {}, 45));

    await callRiverConditions({ ...LONDON, forecast_days: 45 }, fakes);

    const [, , forecastDays] = fakes.openMeteo.getRiverDischarge.mock.calls[0];
    expect(forecastDays).toBe(45);
  });

  it('rejects forecast_days of 0', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    await expect(
      callRiverConditions({ ...LONDON, forecast_days: 0 }, fakes)
    ).rejects.toThrow(/forecast_days/);
    expect(fakes.openMeteo.getRiverDischarge).not.toHaveBeenCalled();
  });

  it('rejects forecast_days of 211', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    await expect(
      callRiverConditions({ ...LONDON, forecast_days: 211 }, fakes)
    ).rejects.toThrow(/forecast_days/);
    expect(fakes.openMeteo.getRiverDischarge).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. detail levels (D4)
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — detail levels (D4)', () => {
  const FORECAST_DAYS = 10;

  /** Center cell carries a rich 10-day forecast with a real min/max envelope; every other cell is negligible so the center wins outright with no snap note. */
  function buildDetailGrid(): OpenMeteoFloodResponse[] {
    const grid = buildProbeGrid(LONDON.latitude, LONDON.longitude);
    const center = grid[PROBE_GRID_CENTER_INDEX];
    const median = Array.from({ length: FORECAST_DAYS }, (_, i) => 1000 + i * 10);
    const min = median.map(v => v - 100);
    const max = median.map(v => v + 100);

    return grid.map((point, i) => {
      if (i === PROBE_GRID_CENTER_INDEX) {
        return buildCell({
          latitude: center.latitude,
          longitude: center.longitude,
          forecastDays: FORECAST_DAYS,
          pastValue: 1000,
          median,
          min,
          max
        });
      }
      return buildCell({
        latitude: point.latitude,
        longitude: point.longitude,
        forecastDays: FORECAST_DAYS,
        pastValue: 10
      });
    });
  }

  it('caps the ensemble forecast at 7 rows and notes more are available at detail="standard"', async () => {
    const fakes = buildFakes(buildDetailGrid());

    const result = await callRiverConditions(
      { ...LONDON, forecast_days: FORECAST_DAYS, detail: 'standard', units: 'metric' },
      fakes
    );
    const text = textOf(result);

    expect(countForecastRows(text)).toBe(7);
    expect(text).toMatch(/3 more forecast days available/);
    expect(text).not.toContain('· range ');
  });

  it('renders every requested forecast day and adds a min/max range at detail="full"', async () => {
    const fakes = buildFakes(buildDetailGrid());

    const result = await callRiverConditions(
      { ...LONDON, forecast_days: FORECAST_DAYS, detail: 'full', units: 'metric' },
      fakes
    );
    const text = textOf(result);

    expect(countForecastRows(text)).toBe(FORECAST_DAYS);
    expect(text).toContain('· range ');
  });

  it('rejects an invalid detail value', async () => {
    const fakes = buildFakes(buildDetailGrid());

    await expect(
      callRiverConditions({ ...LONDON, detail: 'bogus' }, fakes)
    ).rejects.toThrow(/detail/i);
  });
});

// ---------------------------------------------------------------------------
// 10. Unicode
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — Unicode', () => {
  it('preserves the ³ character in discharge units', async () => {
    const fakes = buildFakes(buildGrid(LONDON.latitude, LONDON.longitude, Array(9).fill(500)));

    const result = await callRiverConditions({ ...LONDON, units: 'metric' }, fakes);
    const text = textOf(result);

    expect(text).toContain('m³/s');
  });
});
