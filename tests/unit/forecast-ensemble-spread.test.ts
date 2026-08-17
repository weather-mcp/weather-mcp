/**
 * Single-model ensemble-spread tests for get_forecast's `ensemble_spread`
 * flag (T3 of docs/ensemble-spread-implementation-plan.md).
 *
 * Exercises the real handleGetForecast with plain fake services (no HTTP, no
 * live calls), following tests/unit/forecast-model-comparison.test.ts's
 * conventions.
 *
 * Covers design D1 (parameter interactions), D2 (routing short-circuit and the
 * US NWS disclosure), D5 (rendering), D6 (control run as reference only), and
 * D7 (spread-is-contract error handling).
 *
 * See docs/ensemble-spread-plan.md.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoEnsembleResponse } from '../../src/types/openmeteo.js';
import { DataNotFoundError } from '../../src/errors/ApiError.js';

/** Denver — inside the US routing box, so it exercises the D2 NWS disclosure. */
const DENVER = { latitude: 39.7392, longitude: -104.9903 };
/** Milan — outside the US, so the NWS sentence must NOT appear. */
const MILAN = { latitude: 45.4642, longitude: 9.19 };

/** One member's values for one day. `null` means that member did not report. */
interface MemberDay {
  high: number | null;
  low?: number | null;
  precip?: number | null;
  wind?: number | null;
  code?: number | null;
}

/**
 * Per-day spec for the fixture generator: how many members report, and the
 * shape of their values. Members are generated deterministically from a
 * seedable pattern rather than hand-typed — 50 members x 5 variables would
 * otherwise be 250 literal arrays (implementation plan, fixture ergonomics).
 */
interface DaySpec {
  /** Members reporting this day (the rest are null across every variable). */
  reporting?: number;
  /** Median-ish daily high; members spread symmetrically around it. */
  high?: number;
  /** Total width of the member spread for the daily high. */
  spread?: number;
  /** Members producing measurable precipitation (the rest report 0). */
  wet?: number;
  /** Amount for the wettest member; wet members ramp up to it. */
  wetMax?: number;
  /** Members reporting `codeA`; the rest report `codeB`. */
  codeASplit?: number;
  codeA?: number;
  codeB?: number;
  /** Control-run values. `high: null` omits the whole control entry. */
  control?: { high: number | null; low?: number | null; code?: number | null };
}

const MEMBERS = 50;

/**
 * Deterministic member value: spreads `count` members evenly across
 * `center ± width/2`, so p25/p75 and min/max are predictable from the spec.
 */
function memberValue(center: number, width: number, index: number, count: number): number {
  if (count <= 1) return center;
  return center - width / 2 + (width * index) / (count - 1);
}

/**
 * Build an ensemble response: one unsuffixed control series per variable plus
 * `_memberNN` series, matching the live upstream shape (verification b).
 */
function buildEnsembleResponse(dates: string[], specs: DaySpec[], members = MEMBERS): OpenMeteoEnsembleResponse {
  const daily: Record<string, unknown> = { time: dates };

  const controlHigh: (number | null)[] = [];
  const controlLow: (number | null)[] = [];
  const controlCode: (number | null)[] = [];

  const perMember: MemberDay[][] = Array.from({ length: members }, () => []);

  specs.forEach(spec => {
    const reporting = spec.reporting ?? members;
    const high = spec.high ?? 84;
    const spread = spec.spread ?? 3;
    const wet = spec.wet ?? 0;
    const wetMax = spec.wetMax ?? 0.3;
    const codeA = spec.codeA ?? 2;
    const codeB = spec.codeB ?? 61;
    const codeASplit = spec.codeASplit ?? reporting;

    controlHigh.push(spec.control === undefined ? high : spec.control.high);
    controlLow.push(spec.control === undefined ? high - 22 : (spec.control.low ?? null));
    controlCode.push(spec.control === undefined ? codeA : (spec.control.code ?? null));

    for (let m = 0; m < members; m++) {
      if (m >= reporting) {
        perMember[m].push({ high: null, low: null, precip: null, wind: null, code: null });
        continue;
      }
      perMember[m].push({
        high: memberValue(high, spread, m, reporting),
        low: memberValue(high - 22, spread, m, reporting),
        // Wet members ramp from a trace up to wetMax; dry members report 0.
        precip: m < wet ? 0.02 + ((wetMax - 0.02) * m) / Math.max(1, wet - 1) : 0,
        wind: memberValue(12, 6, m, reporting),
        code: m < codeASplit ? codeA : codeB,
      });
    }
  });

  daily.temperature_2m_max = controlHigh;
  daily.temperature_2m_min = controlLow;
  daily.weather_code = controlCode;

  perMember.forEach((series, i) => {
    const s = String(i + 1).padStart(2, '0');
    daily[`temperature_2m_max_member${s}`] = series.map(d => d.high);
    daily[`temperature_2m_min_member${s}`] = series.map(d => d.low ?? null);
    daily[`precipitation_sum_member${s}`] = series.map(d => d.precip ?? null);
    daily[`wind_speed_10m_max_member${s}`] = series.map(d => d.wind ?? null);
    daily[`weather_code_member${s}`] = series.map(d => d.code ?? null);
  });

  return {
    latitude: 39.75,
    longitude: -104.99,
    elevation: 1600,
    timezone: 'America/Denver',
    timezone_abbreviation: 'MDT',
    utc_offset_seconds: -21600,
    daily: daily as OpenMeteoEnsembleResponse['daily'],
  };
}

const DATES = ['2026-08-18', '2026-08-19', '2026-08-20'];

/** Three confident days: tight temperature spread, almost every member dry. */
function buildHappyResponse(): OpenMeteoEnsembleResponse {
  return buildEnsembleResponse(DATES, [
    { high: 84, spread: 3, wet: 4, codeASplit: 37 },
    { high: 85, spread: 3, wet: 4, codeASplit: 37 },
    { high: 83, spread: 3, wet: 4, codeASplit: 37 },
  ]);
}

function buildNoaaFake() {
  return {
    getPointData: vi.fn(),
    getForecast: vi.fn(),
    getHourlyForecast: vi.fn(),
    getGridpointData: vi.fn(),
    getGridpointDataByCoordinates: vi.fn(),
  };
}

function buildOpenMeteoFake(response: OpenMeteoEnsembleResponse = buildHappyResponse()) {
  return {
    getForecast: vi.fn(),
    getModelComparison: vi.fn(),
    getEnsembleSpread: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
}

interface Fakes {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  ncei: { isAvailable: ReturnType<typeof vi.fn> };
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
}

function buildFakes(response?: OpenMeteoEnsembleResponse): Fakes {
  return {
    noaa: buildNoaaFake(),
    openMeteo: buildOpenMeteoFake(response),
    ncei: { isAvailable: vi.fn().mockReturnValue(false) },
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

// ---------------------------------------------------------------------------
// 1. Happy path (D5)
// ---------------------------------------------------------------------------

describe('handleGetForecast — ensemble_spread happy path (D5)', () => {
  it('renders the spread header, per-day blocks, and honest-framing footer', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, fakes));

    expect(text).toContain('# Weather Forecast (Ensemble Spread)');
    expect(text).toContain('**Model:** ECMWF IFS 0.25° ensemble (ENS) — 50 perturbed members + control run');
    expect(text).toContain('**Forecast confidence:**');
    expect(text).toContain('**Control run:**');
    expect(text).toContain('**Confidence:**');
    expect(text).toContain('**Temperature (50 members):**');
    expect(text).toContain('likely (p25–p75)');
    expect(text).toContain('**Wind:** max typically');
    expect(text).toContain('**Conditions:**');

    // Honest framing — the whole point of the feature.
    expect(text).toContain('not calibrated probabilities');
    expect(text).toContain('a confident ensemble can still be wrong');
    expect(text).toContain('project heuristics');
    expect(text).toContain('not counted in spreads');
    expect(text).toContain('Open-Meteo (Ensemble API)');
  });

  it('reports the member count from the response rather than the constant', async () => {
    // 30 members, not the documented 50 — the header must follow the data.
    const response = buildEnsembleResponse(DATES, [{}, {}, {}], 30);
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, buildFakes(response)));

    expect(text).toContain('30 perturbed members + control run');
    expect(text).toContain('**Temperature (30 members):**');
    expect(text).not.toContain('50 perturbed members');
  });

  it('requests the spread from the ensemble service method with the resolved days and prefs', async () => {
    const fakes = buildFakes();
    await callForecast({ ...MILAN, ensemble_spread: true, days: 5 }, fakes);

    expect(fakes.openMeteo.getEnsembleSpread).toHaveBeenCalledTimes(1);
    const [lat, lon, days] = fakes.openMeteo.getEnsembleSpread.mock.calls[0];
    expect(lat).toBe(MILAN.latitude);
    expect(lon).toBe(MILAN.longitude);
    expect(days).toBe(5);
    // The spread replaces the forecast product — never both.
    expect(fakes.openMeteo.getForecast).not.toHaveBeenCalled();
    expect(fakes.openMeteo.getModelComparison).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Parameter interactions (D1) — thrown before any service call
// ---------------------------------------------------------------------------

describe('handleGetForecast — ensemble_spread interactions (D1)', () => {
  it('rejects ensemble_spread + compare_models as mutually exclusive', async () => {
    const fakes = buildFakes();
    await expect(
      callForecast({ ...MILAN, ensemble_spread: true, compare_models: true }, fakes)
    ).rejects.toThrow('ensemble_spread and compare_models are mutually exclusive; request one view at a time');

    // Validation, so no request is made for either view.
    expect(fakes.openMeteo.getEnsembleSpread).not.toHaveBeenCalled();
    expect(fakes.openMeteo.getModelComparison).not.toHaveBeenCalled();
  });

  it('rejects ensemble_spread with hourly granularity', async () => {
    const fakes = buildFakes();
    await expect(
      callForecast({ ...MILAN, ensemble_spread: true, granularity: 'hourly' }, fakes)
    ).rejects.toThrow('ensemble_spread requires daily granularity');
    expect(fakes.openMeteo.getEnsembleSpread).not.toHaveBeenCalled();
  });

  it('rejects ensemble_spread with source="noaa"', async () => {
    const fakes = buildFakes();
    await expect(
      callForecast({ ...MILAN, ensemble_spread: true, source: 'noaa' }, fakes)
    ).rejects.toThrow('ensemble_spread uses Open-Meteo ensemble data; use source "auto" or "openmeteo"');
    expect(fakes.openMeteo.getEnsembleSpread).not.toHaveBeenCalled();
    expect(fakes.noaa.getPointData).not.toHaveBeenCalled();
  });

  it('accepts source="openmeteo" explicitly', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true, source: 'openmeteo' }, fakes));
    expect(text).toContain('# Weather Forecast (Ensemble Spread)');
  });

  it('silently ignores the garnish flags rather than erroring', async () => {
    const fakes = buildFakes();
    const text = textOf(
      await callForecast(
        {
          ...MILAN,
          ensemble_spread: true,
          include_normals: true,
          include_astronomy: true,
          include_severe_weather: true,
          include_precipitation_probability: true,
        },
        fakes
      )
    );

    expect(text).toContain('# Weather Forecast (Ensemble Spread)');
    expect(text).not.toContain('Climate Context');
    expect(text).not.toContain('Moon Phase');
  });
});

// ---------------------------------------------------------------------------
// 3. Routing (D2) — NOAA is never contacted, US gets the disclosure
// ---------------------------------------------------------------------------

describe('handleGetForecast — ensemble_spread routing (D2)', () => {
  it('never contacts NOAA for a US point and adds the NWS disclosure', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...DENVER, ensemble_spread: true }, fakes));

    expect(text).toContain('# Weather Forecast (Ensemble Spread)');
    expect(text).toContain('The NOAA/NWS point forecast is not the model shown.');

    for (const method of Object.values(fakes.noaa)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('omits the NWS disclosure outside the US', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, fakes));
    expect(text).not.toContain('NOAA/NWS point forecast');
  });
});

// ---------------------------------------------------------------------------
// 4. Control run is reference only (D6)
// ---------------------------------------------------------------------------

describe('handleGetForecast — control run is reference only (D6)', () => {
  it('excludes a wildly outlying control run from the rendered spread', async () => {
    const response = buildEnsembleResponse(DATES, [
      { high: 84, spread: 4, control: { high: 9999, low: -9999, code: 2 } },
      {},
      {},
    ]);
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, buildFakes(response)));

    // The control renders as its own reference line...
    expect(text).toContain('**Control run:** High 9999°F');
    // ...but never widens the member band.
    expect(text).toContain('**Temperature (50 members):** high 83–85°F likely (p25–p75), median 84°F');
    expect(text).not.toContain('high 84–9999°F');
  });

  it('omits the control line on a day whose control high is null', async () => {
    const response = buildEnsembleResponse(DATES, [
      { high: 84, control: { high: null } },
      { high: 85 },
      { high: 83 },
    ]);
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, buildFakes(response)));

    // Day 1 has no control line, but its spread still renders...
    const firstBlock = text.split('## ')[1];
    expect(firstBlock).not.toContain('**Control run:**');
    expect(firstBlock).toContain('**Temperature (50 members):**');
    // ...and the later days keep theirs.
    expect(text).toContain('**Control run:**');
  });
});

// ---------------------------------------------------------------------------
// 5. Horizon trimming and interior gaps (D4/D5)
// ---------------------------------------------------------------------------

describe('handleGetForecast — horizon trimming (D4)', () => {
  it('trims trailing days past the model horizon and says how many', async () => {
    const response = buildEnsembleResponse(
      [...DATES, '2026-08-21', '2026-08-22'],
      [{}, {}, {}, { reporting: 0 }, { reporting: 0 }]
    );
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true, days: 5 }, buildFakes(response)));

    expect(text).toContain("*Note: 2 further days beyond the model's horizon were omitted*");
    expect(text).not.toContain('August 21');
    expect(text).not.toContain('August 22');
  });

  it('retains an interior gap day with its reduced member count', async () => {
    const response = buildEnsembleResponse(DATES, [{}, { reporting: 6 }, {}]);
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, buildFakes(response)));

    // The thin day renders rather than being dropped...
    expect(text).toContain('**Temperature (6 members):**');
    // ...and the surrounding full days are untouched.
    expect(text).toContain('**Temperature (50 members):**');
    expect(text).not.toContain("beyond the model's horizon");
  });

  it('states plainly when a day has too few members to be a spread', async () => {
    const response = buildEnsembleResponse(DATES, [{}, { reporting: 1 }, {}]);
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, buildFakes(response)));

    expect(text).toContain('*Only 1 member returned data for this day — no spread to summarize.*');
  });
});

// ---------------------------------------------------------------------------
// 6. Precipitation framing — wet members only (inherited compare_models gotcha)
// ---------------------------------------------------------------------------

describe('handleGetForecast — precipitation framing (D4)', () => {
  it('ranges the amount over wet members only, never pinning the minimum to 0.00', async () => {
    // 10 of 50 wet, ramping 0.02 -> 0.31; the other 40 report exactly 0.
    const response = buildEnsembleResponse(DATES, [{ wet: 10, wetMax: 0.31 }, {}, {}]);
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, buildFakes(response)));

    expect(text).toContain('**Precipitation:** 10 of 50 members (20%) produce measurable precipitation');
    expect(text).toContain('0.02–0.31 in among those');
    // The dry members must not drag the floor down.
    expect(text).not.toContain('0.00–0.31 in');
  });

  it('omits the amount range when no member is wet', async () => {
    const response = buildEnsembleResponse(DATES, [{ wet: 0 }, {}, {}]);
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, buildFakes(response)));

    expect(text).toContain('0 of 50 members (0%) produce measurable precipitation');
    expect(text).not.toContain('among those');
  });
});

// ---------------------------------------------------------------------------
// 7. Conditions line — the percentage must describe the words beside it
// ---------------------------------------------------------------------------

describe('handleGetForecast — conditions labelling', () => {
  it('does not attribute the modal percentage to a divergent control run', async () => {
    // 37 of 50 members cloudy (code 2), 13 rain (61) — but the control says rain.
    const response = buildEnsembleResponse(DATES, [
      { codeASplit: 37, codeA: 2, codeB: 61, control: { high: 84, low: 62, code: 61 } },
      {},
      {},
    ]);
    const text = textOf(
      await callForecast({ ...MILAN, ensemble_spread: true, detail: 'summary' }, buildFakes(response))
    );

    // The modal bucket is cloudy at 74%, so the 74% must be labelled "cloudy",
    // not with the control's rain description.
    expect(text).toContain('cloudy (74% of members)');
    expect(text).not.toContain('TESTWX-61 (74% of members)');
  });

  it('borrows the control run wording when it agrees with the modal bucket', async () => {
    const response = buildEnsembleResponse(DATES, [
      { codeASplit: 37, codeA: 2, codeB: 61, control: { high: 84, low: 62, code: 2 } },
      {},
      {},
    ]);
    const text = textOf(
      await callForecast({ ...MILAN, ensemble_spread: true, detail: 'summary' }, buildFakes(response))
    );

    expect(text).toContain('TESTWX-2 (74% of members)');
  });

  it('names a runner-up bucket at or above 25% of members', async () => {
    const response = buildEnsembleResponse(DATES, [{ codeASplit: 37, codeA: 2, codeB: 61 }, {}, {}]);
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, buildFakes(response)));

    expect(text).toContain('**Conditions:** 74% of members cloudy; 26% rain');
  });
});

// ---------------------------------------------------------------------------
// 8. detail levels (D1)
// ---------------------------------------------------------------------------

describe('handleGetForecast — ensemble_spread detail levels (D1)', () => {
  it('summary renders the overall line plus one compact line per day', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true, detail: 'summary' }, fakes));

    expect(text).toContain('**Forecast confidence:**');
    expect(text).toMatch(/- \*\*\w+:\*\* .+ high .+ — (High|Moderate|Low) confidence/);
    // No per-day blocks at this level.
    expect(text).not.toContain('**Control run:**');
    expect(text).not.toContain('**Temperature (50 members):**');
  });

  it('standard renders the per-day blocks without the absolute envelope', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true }, fakes));

    expect(text).toContain('**Temperature (50 members):**');
    expect(text).not.toContain('**Full range:**');
  });

  it('full appends one absolute-envelope line per day and never dumps members', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, ensemble_spread: true, detail: 'full' }, fakes));

    expect(text).toContain('**Full range:** high ');
    expect(text).toContain('wind up to ');
    // One envelope line per rendered day, not fifty member forecasts.
    expect(text.match(/\*\*Full range:\*\*/g)).toHaveLength(3);
    expect(text).not.toContain('member01');
  });
});

// ---------------------------------------------------------------------------
// 9. Spread is contract, not garnish (D7)
// ---------------------------------------------------------------------------

describe('handleGetForecast — ensemble_spread errors (D7)', () => {
  it('throws DataNotFoundError when fewer than 2 perturbed members are present', async () => {
    const response = buildEnsembleResponse(DATES, [{}, {}, {}], 1);
    await expect(
      callForecast({ ...MILAN, ensemble_spread: true }, buildFakes(response))
    ).rejects.toThrow(DataNotFoundError);
  });

  it('throws DataNotFoundError when every day is trimmed', async () => {
    const response = buildEnsembleResponse(DATES, [{ reporting: 0 }, { reporting: 0 }, { reporting: 0 }]);
    await expect(
      callForecast({ ...MILAN, ensemble_spread: true }, buildFakes(response))
    ).rejects.toThrow(DataNotFoundError);
  });

  it('propagates a service failure rather than degrading to a plain forecast', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getEnsembleSpread.mockRejectedValue(new Error('upstream exploded'));

    await expect(callForecast({ ...MILAN, ensemble_spread: true }, fakes)).rejects.toThrow('upstream exploded');
    // No degraded fallback — the spread IS the requested product.
    expect(fakes.openMeteo.getForecast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10. Flag off — the existing paths are untouched
// ---------------------------------------------------------------------------

describe('handleGetForecast — ensemble_spread off', () => {
  it('never calls the ensemble service when the flag is absent', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getForecast.mockResolvedValue({
      latitude: MILAN.latitude,
      longitude: MILAN.longitude,
      elevation: 120,
      timezone: 'Europe/Rome',
      timezone_abbreviation: 'CEST',
      utc_offset_seconds: 7200,
      daily: {
        time: DATES,
        weather_code: [2, 2, 2],
        temperature_2m_max: [84, 85, 83],
        temperature_2m_min: [62, 63, 61],
        precipitation_sum: [0, 0, 0],
        precipitation_probability_max: [5, 5, 5],
        wind_speed_10m_max: [10, 10, 10],
        sunrise: DATES.map(d => `${d}T06:00`),
        sunset: DATES.map(d => `${d}T20:00`),
      },
    });

    await callForecast({ ...MILAN }, fakes);
    expect(fakes.openMeteo.getEnsembleSpread).not.toHaveBeenCalled();
  });
});
