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
 * See docs/plans/global-rivers-plan.md.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetRiverConditions } from '../../src/handlers/riverConditionsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { OpenMeteoFloodResponse } from '../../src/types/openmeteo.js';
import type { NWPSGauge } from '../../src/types/noaa.js';
import { buildProbeGrid, PROBE_GRID_CENTER_INDEX } from '../../src/utils/riverDischarge.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** St. Louis, MO — inside the US, near the Mississippi. */
const US_POINT = { latitude: 38.6270, longitude: -90.1994 };
/** London, UK — outside the US routing boxes. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };
/** Rotterdam, NL — outside the US routing boxes and outside NWPS coverage. */
const ROTTERDAM = { latitude: 51.92, longitude: 4.48 };
/** Memphis, TN — genuinely US, inside NWPS coverage. */
const MEMPHIS = { latitude: 35.15, longitude: -90.05 };
/** Toronto, Canada — inside the deliberately sloppy CONUS box (isInUS true), but actually Canada. */
const TORONTO = { latitude: 43.65, longitude: -79.38 };
/** San Juan, Puerto Rico — NWPS-covered territory. */
const PUERTO_RICO_POINT = { latitude: 18.4655, longitude: -66.1057 };
/** St. Croix, US Virgin Islands — NIFC-covered but NOT NWPS-covered (D4). */
const VIRGIN_ISLANDS_POINT = { latitude: 17.7333, longitude: -64.7833 };
/** Hagåtña, Guam — NIFC-covered but NOT NWPS-covered (D4). */
const GUAM_POINT = { latitude: 13.4443, longitude: 144.7937 };

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

/**
 * One NWPS gauge fixture, offset a tiny amount from the probe point so it
 * survives the default 50 km radius filter (shape copied from
 * tests/unit/riverConditions.test.ts:101-131).
 */
function buildGauge(latitude: number, longitude: number): NWPSGauge {
  return {
    lid: 'TEST1',
    name: 'Test Gauge',
    latitude: latitude + 0.001,
    longitude,
    state: { abbreviation: 'XX', name: 'Test' },
    status: {
      observed: {
        primary: 4.2,
        secondary: 0.05,
        floodCategory: null,
        validTime: '2026-07-16T14:00:00Z'
      }
    }
  };
}

function buildOpenMeteoFake(cells: OpenMeteoFloodResponse[]) {
  return {
    getRiverDischarge: vi.fn().mockResolvedValue(cells)
  };
}

/**
 * Copied from tests/unit/wildfire-routing.test.ts:71-75 — same shape, same
 * one-method fake, used the same way to drive `resolveCountryCode`.
 */
function makeNominatimFake(impl: (lat: number, lon: number) => Promise<string | null>) {
  const reverseCountry = vi.fn(impl);
  return { service: { reverseCountry } as unknown as NominatimService, reverseCountry };
}

interface Fakes {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
  /** Optional and trailing — every existing call site omits it and is unaffected. */
  nominatim?: ReturnType<typeof makeNominatimFake>;
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
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.nominatim?.service
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

// ---------------------------------------------------------------------------
// 11. NOAA-path coverage disclosure (T3, issue-85) — driven through the
// handler, never the (unexported) formatter, per G45: NWPS_COVERED_COUNTRIES
// and the outsideCoverage computation live in the handler's selection logic,
// so a formatter-level fixture would never execute the mutated lines.
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — NWPS coverage disclosure on a forced/empty noaa query (T3)', () => {
  it('discloses NWPS coverage at Rotterdam (nl) instead of the in-coverage advice', async () => {
    const fakes = buildFakes([]);
    fakes.nominatim = makeNominatimFake(async () => 'nl');

    const result = await callRiverConditions({ ...ROTTERDAM, source: 'noaa' }, fakes);
    const text = textOf(result);

    expect(text).toContain('United States and Puerto Rico only');
    expect(text).toContain('not an all-clear');
    expect(text).toContain('source: "openmeteo"');
    expect(text).not.toContain('ℹ️');
    expect(text).not.toContain('Try expanding the search radius');
    expect(text).not.toContain('River gauges are typically');
    expect(text).toContain('# River Conditions Report');
    expect(text).toContain('**Search Radius:**');
    expect(text).toContain('National Water Prediction Service (NWPS)');
  });

  it('renders a returned gauge instead of the disclosure — the flag can never suppress data', async () => {
    const fakes = buildFakes([]);
    fakes.nominatim = makeNominatimFake(async () => 'nl');
    fakes.noaa.getNWPSGaugesInBoundingBox.mockResolvedValue([
      buildGauge(ROTTERDAM.latitude, ROTTERDAM.longitude)
    ]);

    const result = await callRiverConditions({ ...ROTTERDAM, source: 'noaa' }, fakes);
    const text = textOf(result);

    expect(text).toContain('Test Gauge');
    expect(text).not.toContain('United States and Puerto Rico only');
  });
});

describe('handleGetRiverConditions — in-coverage empty result stays byte-identical (T3)', () => {
  it('renders the three today-standard lines verbatim at Memphis (us)', async () => {
    const fakes = buildFakes([]);
    fakes.nominatim = makeNominatimFake(async () => 'us');

    const result = await callRiverConditions({ ...MEMPHIS }, fakes);
    const text = textOf(result);

    expect(text).toContain(
      'ℹ️ **No river gauges found within 50 km**\n\n' +
        'Try expanding the search radius or choosing a location closer to rivers or streams.\n\n' +
        '**Tip:** River gauges are typically located along major rivers and waterways.\n'
    );
    expect(text).not.toContain('not an all-clear');
  });
});

describe('handleGetRiverConditions — the NWPS coverage seam: pr/vi/gu (T3, G32)', () => {
  it('covers Puerto Rico (pr): renders the in-coverage advice, not the disclosure', async () => {
    const fakes = buildFakes([]);
    fakes.nominatim = makeNominatimFake(async () => 'pr');

    const result = await callRiverConditions({ ...PUERTO_RICO_POINT, source: 'noaa' }, fakes);
    const text = textOf(result);

    expect(text).toContain('ℹ️ **No river gauges found within 50 km**');
    expect(text).not.toContain('United States and Puerto Rico only');
  });

  it('discloses for the US Virgin Islands (vi) — NIFC-covered but not NWPS-covered', async () => {
    const fakes = buildFakes([]);
    fakes.nominatim = makeNominatimFake(async () => 'vi');

    const result = await callRiverConditions({ ...VIRGIN_ISLANDS_POINT, source: 'noaa' }, fakes);
    const text = textOf(result);

    expect(text).toContain('United States and Puerto Rico only');
    expect(text).not.toContain('ℹ️ **No river gauges found');
  });

  it('discloses for Guam (gu) — NIFC-covered but not NWPS-covered', async () => {
    const fakes = buildFakes([]);
    fakes.nominatim = makeNominatimFake(async () => 'gu');

    const result = await callRiverConditions({ ...GUAM_POINT, source: 'noaa' }, fakes);
    const text = textOf(result);

    expect(text).toContain('United States and Puerto Rico only');
    expect(text).not.toContain('ℹ️ **No river gauges found');
  });
});

describe('handleGetRiverConditions — country lookup reached while isInUS is true (T3)', () => {
  it('discloses at Toronto (ca) via the reverse-country lookup, though isInUS(Toronto) is true, and never touches Open-Meteo', async () => {
    const fakes = buildFakes([]);
    fakes.nominatim = makeNominatimFake(async () => 'ca');

    const result = await callRiverConditions({ ...TORONTO }, fakes);
    const text = textOf(result);

    expect(text).toContain('United States and Puerto Rico only');
    // The disclosure must not advise omitting `source`: this caller already did,
    // and the CONUS box routed them here. The advice would loop.
    expect(text).not.toContain('or omit');
    expect(fakes.noaa.getNWPSGaugesInBoundingBox).toHaveBeenCalledTimes(1);
    expect(fakes.openMeteo.getRiverDischarge).not.toHaveBeenCalled();
  });
});

describe('handleGetRiverConditions — a rejected country lookup still renders a result (T3)', () => {
  it('falls back to isInUS (false at Rotterdam) and still discloses, never the generic error branch', async () => {
    const fakes = buildFakes([]);
    fakes.nominatim = makeNominatimFake(async () => {
      throw new Error('nominatim unreachable');
    });

    const result = await callRiverConditions({ ...ROTTERDAM, source: 'noaa' }, fakes);
    const text = textOf(result);

    expect(text).toContain('United States and Puerto Rico only');
    expect(text).not.toContain('❌ Error retrieving river gauge data');
  });
});

describe('handleGetRiverConditions — no Nominatim service wired (T3, existing-harness shape)', () => {
  it('falls back to isInUS: Memphis (true) renders today\'s advice, Rotterdam (false) renders the disclosure, and reverseCountry is never constructed', async () => {
    const memphisFakes = buildFakes([]);
    const memphisResult = await callRiverConditions({ ...MEMPHIS }, memphisFakes);
    expect(textOf(memphisResult)).toContain('ℹ️ **No river gauges found within 50 km**');

    const rotterdamFakes = buildFakes([]);
    const rotterdamResult = await callRiverConditions({ ...ROTTERDAM, source: 'noaa' }, rotterdamFakes);
    expect(textOf(rotterdamResult)).toContain('United States and Puerto Rico only');

    expect(memphisFakes.nominatim).toBeUndefined();
    expect(rotterdamFakes.nominatim).toBeUndefined();
  });
});
