/**
 * Multi-model comparison tests for get_forecast's `compare_models` flag
 * (T3 of docs/multi-model-comparison-implementation-plan.md).
 *
 * Exercises the real handleGetForecast with plain fake services (no HTTP, no
 * live calls), following tests/unit/forecast-fallback.test.ts's conventions.
 *
 * Covers design D1 (parameter interactions), D2 (routing short-circuit and the
 * US NWS disclosure), D5 (rendering), D6 (best_match as reference only), and
 * D7 (comparison-is-contract error handling).
 *
 * See docs/multi-model-comparison-plan.md.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoModelComparisonResponse } from '../../src/types/openmeteo.js';
import { DataNotFoundError } from '../../src/errors/ApiError.js';

/** Denver — inside the US routing box, so it exercises the D2 NWS disclosure. */
const DENVER = { latitude: 39.7392, longitude: -104.9903 };
/** Milan — outside the US, so the NWS sentence must NOT appear. */
const MILAN = { latitude: 45.4642, longitude: 9.19 };

const COMPARISON_ONLY = ['gfs_seamless', 'ecmwf_ifs025', 'icon_seamless', 'gem_seamless', 'ukmo_seamless'];

interface ModelDay {
  high: number | null;
  low?: number | null;
  precip?: number | null;
  prob?: number | null;
  wind?: number | null;
  code?: number | null;
}

/**
 * Build a suffixed multi-model daily response. `models` maps each model id to
 * its per-day series; `best_match` is supplied separately so tests can null it
 * independently (D6).
 */
function buildComparisonResponse(
  dates: string[],
  models: Record<string, ModelDay[]>,
  bestMatch?: ModelDay[]
): OpenMeteoModelComparisonResponse {
  const daily: Record<string, unknown> = { time: dates };

  const put = (model: string, series: ModelDay[]): void => {
    daily[`temperature_2m_max_${model}`] = series.map(d => d.high);
    daily[`temperature_2m_min_${model}`] = series.map(d => d.low ?? null);
    daily[`precipitation_sum_${model}`] = series.map(d => d.precip ?? null);
    daily[`precipitation_probability_max_${model}`] = series.map(d => d.prob ?? null);
    daily[`wind_speed_10m_max_${model}`] = series.map(d => d.wind ?? null);
    daily[`weather_code_${model}`] = series.map(d => d.code ?? null);
  };

  for (const [model, series] of Object.entries(models)) {
    put(model, series);
  }
  if (bestMatch) {
    put('best_match', bestMatch);
  }

  return {
    latitude: 39.75,
    longitude: -104.99,
    elevation: 1600,
    timezone: 'America/Denver',
    timezone_abbreviation: 'MDT',
    utc_offset_seconds: -21600,
    daily: daily as OpenMeteoModelComparisonResponse['daily'],
  };
}

/** A day's worth of values for one model, with tight agreement by default. */
function day(high: number, extras: Partial<ModelDay> = {}): ModelDay {
  return { high, low: high - 20, precip: 0, prob: 5, wind: 10, code: 2, ...extras };
}

/**
 * Five comparison models agreeing tightly across three days, plus a
 * best_match reference. The baseline every scenario below perturbs.
 */
function buildHappyResponse(): OpenMeteoModelComparisonResponse {
  const dates = ['2026-08-18', '2026-08-19', '2026-08-20'];
  const highs: Record<string, number[]> = {
    gfs_seamless: [84, 85, 83],
    ecmwf_ifs025: [82, 84, 82],
    icon_seamless: [86, 86, 84],
    gem_seamless: [83, 85, 83],
    ukmo_seamless: [85, 85, 84],
  };
  const models: Record<string, ModelDay[]> = {};
  for (const [model, series] of Object.entries(highs)) {
    models[model] = series.map(h => day(h));
  }
  return buildComparisonResponse(dates, models, [84, 85, 83].map(h => day(h)));
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

function buildOpenMeteoFake(response: OpenMeteoModelComparisonResponse = buildHappyResponse()) {
  return {
    getForecast: vi.fn(),
    getModelComparison: vi.fn().mockResolvedValue(response),
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

function buildFakes(response?: OpenMeteoModelComparisonResponse): Fakes {
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
// 1. Happy path
// ---------------------------------------------------------------------------

describe('handleGetForecast — compare_models happy path (D5)', () => {
  it('renders the comparison header, per-day blocks, and honest-framing footer', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));

    expect(text).toContain('# Weather Forecast (Model Comparison)');
    expect(text).toContain('**Models compared:** GFS (NOAA), ECMWF IFS, ICON (DWD), GEM (Canada), UKMO (UK Met Office)');
    expect(text).toContain('**Reference:** Open-Meteo best_match blend');
    expect(text).toContain('**Model agreement:**');
    expect(text).toContain('**Best match:**');
    expect(text).toContain('**Agreement:**');
    expect(text).toContain('**Temperature (5 models):**');
    expect(text).toContain('**Wind:** max');
    expect(text).toContain('**Conditions:**');
    // Honest framing — the whole point of the feature.
    expect(text).toContain('proxy for uncertainty, not a guarantee');
    expect(text).toContain('not counted in spreads');
    expect(text).toContain('Model run times differ and are not shown');
  });

  it('passes the requested days and unit preferences through to the service', async () => {
    const fakes = buildFakes();
    await callForecast({ ...MILAN, compare_models: true, days: 3, units: 'metric' }, fakes);

    expect(fakes.openMeteo.getModelComparison).toHaveBeenCalledTimes(1);
    const [lat, lon, days, prefs] = fakes.openMeteo.getModelComparison.mock.calls[0];
    expect(lat).toBe(MILAN.latitude);
    expect(lon).toBe(MILAN.longitude);
    expect(days).toBe(3);
    expect(prefs).toMatchObject({ temperature: 'C' });
  });

  it('never calls the plain single-model getForecast', async () => {
    const fakes = buildFakes();
    await callForecast({ ...MILAN, compare_models: true }, fakes);
    expect(fakes.openMeteo.getForecast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Model participation (D4 levels 1-3)
// ---------------------------------------------------------------------------

describe('handleGetForecast — compare_models model participation (D4)', () => {
  it('drops an all-null model and discloses the exclusion', async () => {
    const dates = ['2026-08-18', '2026-08-19'];
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(84), day(85)],
      ecmwf_ifs025: [day(82), day(84)],
      icon_seamless: [day(86), day(86)],
      gem_seamless: [day(83), day(85)],
      // The live-verified all-null-200 mode: HTTP 200, every array null.
      ukmo_seamless: [
        { high: null, low: null, precip: null, prob: null, wind: null, code: null },
        { high: null, low: null, precip: null, prob: null, wind: null, code: null },
      ],
    };
    const fakes = buildFakes(buildComparisonResponse(dates, models, [day(84), day(85)]));
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));

    expect(text).toContain('UKMO returned no data for this location and was excluded.');
    // The dropped model is gone from the header list and the footer alike.
    expect(text).toContain('**Models compared:** GFS (NOAA), ECMWF IFS, ICON (DWD), GEM (Canada)');
    expect(text).not.toContain('UKMO (UK Met Office)');
    // Four models remain, and the counts say so rather than claiming five.
    expect(text).toContain('**Temperature (4 models):**');
  });

  it('shows a short probability count when a model publishes no probability (UKMO mode)', async () => {
    const dates = ['2026-08-18'];
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(84, { prob: 40 })],
      ecmwf_ifs025: [day(82, { prob: 50 })],
      icon_seamless: [day(86, { prob: 60 })],
      gem_seamless: [day(83, { prob: 70 })],
      // Good temps and codes, but no probability product at all (fact f).
      ukmo_seamless: [day(85, { prob: null })],
    };
    const fakes = buildFakes(buildComparisonResponse(dates, models, [day(84)]));
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));

    // Participates fully in temperature...
    expect(text).toContain('**Temperature (5 models):**');
    // ...but the probability fragment carries its own, shorter count.
    expect(text).toContain('probability 40–70% (4 models)');
    expect(text).toContain('Not every model publishes a precipitation probability');
  });

  it('renders per-day counts and a trim note for ragged model horizons', async () => {
    const dates = ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
    const gone: ModelDay = { high: null, low: null, precip: null, prob: null, wind: null, code: null };
    const models: Record<string, ModelDay[]> = {
      // Day 2 has only 4 models; days 3-4 have fewer than 2 and are trimmed.
      gfs_seamless: [day(84), day(85), day(83), gone],
      ecmwf_ifs025: [day(82), day(84), gone, gone],
      icon_seamless: [day(86), day(86), gone, gone],
      gem_seamless: [day(83), day(85), gone, gone],
      ukmo_seamless: [day(85), gone, gone, gone],
    };
    const fakes = buildFakes(buildComparisonResponse(dates, models, [day(84), day(85), day(83), day(82)]));
    const text = textOf(await callForecast({ ...MILAN, compare_models: true, days: 4 }, fakes));

    expect(text).toContain('(4 of 5 models)');
    expect(text).toContain('**Temperature (4 models):**');
    // Days 3 and 4 fall below 2 participating models and are trimmed.
    expect(text).toContain("2 further days beyond most models' horizon were omitted");
  });

  it('throws DataNotFoundError when fewer than 2 comparison models survive (D7)', async () => {
    const dates = ['2026-08-18'];
    const gone: ModelDay = { high: null, low: null, precip: null, prob: null, wind: null, code: null };
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(84)],
      ecmwf_ifs025: [gone],
      icon_seamless: [gone],
      gem_seamless: [gone],
      ukmo_seamless: [gone],
    };
    const fakes = buildFakes(buildComparisonResponse(dates, models, [day(84)]));

    await expect(callForecast({ ...MILAN, compare_models: true }, fakes)).rejects.toThrow(DataNotFoundError);
    await expect(callForecast({ ...MILAN, compare_models: true }, fakes)).rejects.toThrow(
      'Model comparison data is unavailable for this location'
    );
  });
});

// ---------------------------------------------------------------------------
// 3. best_match is reference only (D6)
// ---------------------------------------------------------------------------

describe('handleGetForecast — compare_models best_match handling (D6)', () => {
  it('omits the Best-match line for a day where best_match is null, and still compares', async () => {
    const dates = ['2026-08-18'];
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(84)],
      ecmwf_ifs025: [day(82)],
      icon_seamless: [day(86)],
      gem_seamless: [day(83)],
      ukmo_seamless: [day(85)],
    };
    const nulled: ModelDay[] = [{ high: null, low: null, precip: null, prob: null, wind: null, code: null }];
    const fakes = buildFakes(buildComparisonResponse(dates, models, nulled));
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));

    expect(text).not.toContain('**Best match:**');
    // The comparison itself is unaffected — best_match was never in the stats.
    expect(text).toContain('**Temperature (5 models):**');
  });

  it('excludes best_match from the spread even when it sits outside every model', async () => {
    const dates = ['2026-08-18'];
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(84)],
      ecmwf_ifs025: [day(82)],
      icon_seamless: [day(86)],
      gem_seamless: [day(83)],
      ukmo_seamless: [day(85)],
    };
    // A wild best_match value would blow the spread open if it were counted.
    const fakes = buildFakes(buildComparisonResponse(dates, models, [day(140)]));
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));

    expect(text).toContain('high 82–86');
    expect(text).toContain('spread 4');
    expect(text).toContain('tight');
  });
});

// ---------------------------------------------------------------------------
// 4. Parameter interactions (D1)
// ---------------------------------------------------------------------------

describe('handleGetForecast — compare_models parameter interactions (D1)', () => {
  it('rejects hourly granularity before any service call', async () => {
    const fakes = buildFakes();
    await expect(
      callForecast({ ...MILAN, compare_models: true, granularity: 'hourly' }, fakes)
    ).rejects.toThrow('compare_models requires daily granularity');

    expect(fakes.openMeteo.getModelComparison).not.toHaveBeenCalled();
    expect(fakes.openMeteo.getForecast).not.toHaveBeenCalled();
  });

  it('rejects source: "noaa" before any service call', async () => {
    const fakes = buildFakes();
    await expect(
      callForecast({ ...DENVER, compare_models: true, source: 'noaa' }, fakes)
    ).rejects.toThrow('compare_models uses Open-Meteo model data; use source "auto" or "openmeteo"');

    expect(fakes.openMeteo.getModelComparison).not.toHaveBeenCalled();
    expect(fakes.noaa.getPointData).not.toHaveBeenCalled();
  });

  it('accepts source: "openmeteo" alongside the flag', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, compare_models: true, source: 'openmeteo' }, fakes));
    expect(text).toContain('# Weather Forecast (Model Comparison)');
  });

  it('drops the probability fragment when include_precipitation_probability is false', async () => {
    const dates = ['2026-08-18'];
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(84, { prob: 40 })],
      ecmwf_ifs025: [day(82, { prob: 50 })],
      icon_seamless: [day(86, { prob: 60 })],
      gem_seamless: [day(83, { prob: 70 })],
      ukmo_seamless: [day(85, { prob: 80 })],
    };
    const response = buildComparisonResponse(dates, models, [day(84)]);

    const withProb = buildFakes(response);
    expect(textOf(await callForecast({ ...MILAN, compare_models: true }, withProb))).toContain('probability 40–80%');

    const withoutProb = buildFakes(response);
    const text = textOf(
      await callForecast({ ...MILAN, compare_models: true, include_precipitation_probability: false }, withoutProb)
    );
    expect(text).not.toContain('probability 40–80%');
    // The rest of the precipitation line survives.
    expect(text).toContain('models predict measurable precipitation');
  });

  it('silently ignores include_normals and include_astronomy on the comparison path', async () => {
    const fakes = buildFakes();
    const text = textOf(
      await callForecast(
        { ...MILAN, compare_models: true, include_normals: true, include_astronomy: true },
        fakes
      )
    );

    expect(text).toContain('# Weather Forecast (Model Comparison)');
    expect(text).not.toContain('Climate Normals');
    expect(text).not.toContain('Moon Phase');
  });
});

// ---------------------------------------------------------------------------
// 5. Routing and the US disclosure (D2)
// ---------------------------------------------------------------------------

describe('handleGetForecast — compare_models routing (D2)', () => {
  it('never calls NOAA for a US point and renders the NWS-not-compared disclosure', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...DENVER, compare_models: true }, fakes));

    // The comparison short-circuits routing entirely — NOAA is untouched.
    expect(fakes.noaa.getPointData).not.toHaveBeenCalled();
    expect(fakes.noaa.getForecast).not.toHaveBeenCalled();
    expect(fakes.noaa.getGridpointData).not.toHaveBeenCalled();
    expect(fakes.openMeteo.getModelComparison).toHaveBeenCalledTimes(1);

    expect(text).toContain('The NOAA/NWS point forecast is not among the compared models.');
  });

  it('omits the NWS disclosure outside the US', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));
    expect(text).not.toContain('NOAA/NWS point forecast is not among');
  });

  it('propagates a service failure rather than degrading to a plain forecast (D7)', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getModelComparison.mockRejectedValue(new DataNotFoundError('OpenMeteo', 'upstream said no'));

    await expect(callForecast({ ...DENVER, compare_models: true }, fakes)).rejects.toThrow(DataNotFoundError);
    // No silent fallback to a single-model forecast, from either provider.
    expect(fakes.openMeteo.getForecast).not.toHaveBeenCalled();
    expect(fakes.noaa.getPointData).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. detail levels (D1)
// ---------------------------------------------------------------------------

describe('handleGetForecast — compare_models detail levels (D1)', () => {
  it('detail="summary" gives the overall line plus one compact line per day', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, compare_models: true, detail: 'summary' }, fakes));

    expect(text).toContain('**Model agreement:**');
    expect(text).toMatch(/- \*\*\w{3}:\*\* .*high .* — \w+ agreement/);
    // The per-day blocks are not rendered at this level.
    expect(text).not.toContain('## ');
    expect(text).not.toContain('**Temperature (');
  });

  it('detail="standard" gives the per-day blocks without per-model values', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, compare_models: true, detail: 'standard' }, fakes));

    expect(text).toContain('**Temperature (5 models):**');
    expect(text).not.toContain('**Per-model highs:**');
  });

  it('detail="full" appends compact per-model value lines, never six full forecasts', async () => {
    const fakes = buildFakes();
    const text = textOf(await callForecast({ ...MILAN, compare_models: true, detail: 'full' }, fakes));

    expect(text).toContain('**Per-model highs:** GFS 84, ECMWF 82, ICON 86, GEM 83, UKMO 85');
    expect(text).toContain('**Per-model wind:**');
    // Still the comparison shape — not repeated forecast documents.
    expect(text.match(/# Weather Forecast/g)?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Divergence rendering (D4/D5)
// ---------------------------------------------------------------------------

describe('handleGetForecast — compare_models divergence rendering (D5)', () => {
  it('names the outlier when removing it drops the agreement band', async () => {
    const dates = ['2026-08-18'];
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(80)],
      ecmwf_ifs025: [day(81)],
      icon_seamless: [day(92)], // the outlier: removing it leaves a tight 80-83 spread
      gem_seamless: [day(82)],
      ukmo_seamless: [day(83)],
    };
    const fakes = buildFakes(buildComparisonResponse(dates, models, [day(84)]));
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));

    expect(text).toContain('divergent');
    expect(text).toContain('driven by ICON');
  });

  it('says "broadly split" without naming when no single model explains the spread', async () => {
    const dates = ['2026-08-18'];
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(70)],
      ecmwf_ifs025: [day(75)],
      icon_seamless: [day(80)],
      gem_seamless: [day(85)],
      ukmo_seamless: [day(90)], // evenly spread: dropping any one still diverges
    };
    const fakes = buildFakes(buildComparisonResponse(dates, models, [day(80)]));
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));

    expect(text).toContain('models broadly split');
    expect(text).not.toContain('driven by');
  });

  it('ranges the precipitation amount over the wet models only, not the dry ones', async () => {
    const dates = ['2026-08-18'];
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(71, { precip: 0.31 })],
      ecmwf_ifs025: [day(80, { precip: 0.05 })],
      icon_seamless: [day(72, { precip: 0 })],
      gem_seamless: [day(74, { precip: 0.2 })],
      ukmo_seamless: [day(73, { precip: 0 })],
    };
    const fakes = buildFakes(buildComparisonResponse(dates, models, [day(78)]));
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));

    // Including the two dry models would pin the minimum to 0.00 and make a
    // confident forecast read as "anywhere from nothing".
    expect(text).toContain('3 of 5 models predict measurable precipitation (0.05–0.31 in)');
    expect(text).not.toContain('(0.00–0.31 in)');
  });

  it('uses a singular verb and a single figure when exactly one model is wet', async () => {
    const dates = ['2026-08-18'];
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(84, { precip: 0 })],
      ecmwf_ifs025: [day(82, { precip: 0 })],
      icon_seamless: [day(86, { precip: 0 })],
      gem_seamless: [day(83, { precip: 0.02 })],
      ukmo_seamless: [day(85, { precip: 0 })],
    };
    const fakes = buildFakes(buildComparisonResponse(dates, models, [day(84)]));
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));

    expect(text).toContain('1 of 5 models predicts measurable precipitation (0.02 in)');
  });

  it('names dissenting conditions models using the shared weather-code descriptions', async () => {
    const dates = ['2026-08-18'];
    const models: Record<string, ModelDay[]> = {
      gfs_seamless: [day(84, { code: 2 })],
      ecmwf_ifs025: [day(82, { code: 3 })],
      icon_seamless: [day(86, { code: 2 })],
      gem_seamless: [day(83, { code: 80 })], // rain showers — the dissenter
      ukmo_seamless: [day(85, { code: 3 })],
    };
    const fakes = buildFakes(buildComparisonResponse(dates, models, [day(84, { code: 2 })]));
    const text = textOf(await callForecast({ ...MILAN, compare_models: true }, fakes));

    expect(text).toContain('4 of 5 models cloudy');
    expect(text).toContain('GEM: TESTWX-80');
    expect(fakes.openMeteo.getWeatherDescription).toHaveBeenCalledWith(80);
  });
});

// ---------------------------------------------------------------------------
// 8. Flag off — the standard paths are untouched
// ---------------------------------------------------------------------------

describe('handleGetForecast — compare_models absent or false', () => {
  it('does not call getModelComparison when the flag is absent', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getForecast.mockResolvedValue({
      latitude: 45.46,
      longitude: 9.19,
      generationtime_ms: 0.1,
      utc_offset_seconds: 7200,
      timezone: 'Europe/Rome',
      timezone_abbreviation: 'CEST',
      elevation: 120,
      daily: { time: ['2026-08-18'], temperature_2m_max: [84], temperature_2m_min: [64] },
    });

    const text = textOf(await callForecast({ ...MILAN }, fakes));

    expect(fakes.openMeteo.getModelComparison).not.toHaveBeenCalled();
    expect(fakes.openMeteo.getForecast).toHaveBeenCalledTimes(1);
    expect(text).toContain('# Weather Forecast (Daily)');
    expect(text).not.toContain('Model Comparison');
  });

  it('does not call getModelComparison when the flag is explicitly false', async () => {
    const fakes = buildFakes();
    fakes.openMeteo.getForecast.mockResolvedValue({
      latitude: 45.46,
      longitude: 9.19,
      generationtime_ms: 0.1,
      utc_offset_seconds: 7200,
      timezone: 'Europe/Rome',
      timezone_abbreviation: 'CEST',
      elevation: 120,
      daily: { time: ['2026-08-18'], temperature_2m_max: [84], temperature_2m_min: [64] },
    });

    await callForecast({ ...MILAN, compare_models: false }, fakes);
    expect(fakes.openMeteo.getModelComparison).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean compare_models', async () => {
    const fakes = buildFakes();
    await expect(callForecast({ ...MILAN, compare_models: 'yes' }, fakes)).rejects.toThrow(
      'Invalid compare_models'
    );
  });
});
