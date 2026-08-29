/**
 * Unit tests for river-conditions sentinel handling.
 *
 * Regression coverage for BUG-2 (2026-07-13): NWPS returns placeholder forecast rows
 * with -999 stage/flow values and a year-0001 validTime (rendered as "Dec 31, 1"),
 * and a "fcst_not_current" category. These must be suppressed, not printed raw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isRealValue,
  isUsableForecast,
  handleGetRiverConditions,
  computeStageTrend,
  formatStageTrend
} from '../../src/handlers/riverConditionsHandler.js';
import { RateLimitError } from '../../src/errors/ApiError.js';
import type { GaugeStatus, NWPSGauge, HistoricCrest, StageFlowDataPoint, FloodCategories } from '../../src/types/noaa.js';

function status(overrides: Partial<GaugeStatus> = {}): GaugeStatus {
  return {
    primary: 4.2,
    secondary: 0.05,
    floodCategory: 'no_flooding',
    validTime: '2026-07-13T14:15:00Z',
    ...overrides,
  };
}

describe('isRealValue', () => {
  it('accepts real numeric readings', () => {
    expect(isRealValue(4.2)).toBe(true);
    expect(isRealValue(0)).toBe(true);
    expect(isRealValue(-5)).toBe(true); // plausible low stage, not a sentinel
  });

  it('rejects null/undefined and NWPS missing-data sentinels', () => {
    expect(isRealValue(null)).toBe(false);
    expect(isRealValue(undefined)).toBe(false);
    expect(isRealValue(-999)).toBe(false);
    expect(isRealValue(-999999)).toBe(false);
    expect(isRealValue(NaN)).toBe(false);
    expect(isRealValue(Infinity)).toBe(false);
  });
});

describe('isUsableForecast', () => {
  it('accepts a forecast with real values and a current timestamp', () => {
    expect(isUsableForecast(status())).toBe(true);
  });

  it('rejects the NWPS placeholder forecast (-999 values + year-0001 time)', () => {
    expect(
      isUsableForecast(status({ primary: -999, secondary: -999, validTime: '0001-12-31T18:27:00Z' })),
    ).toBe(false);
  });

  it('rejects a forecast whose values are real but timestamp is a year-0001 placeholder', () => {
    expect(isUsableForecast(status({ validTime: '0001-12-31T18:27:00Z' }))).toBe(false);
  });

  it('rejects a forecast with a valid time but only sentinel values', () => {
    expect(isUsableForecast(status({ primary: -999, secondary: -999 }))).toBe(false);
  });

  it('rejects an unparseable validTime', () => {
    expect(isUsableForecast(status({ validTime: 'not-a-date' }))).toBe(false);
  });

  it('accepts when at least one of stage/flow is real', () => {
    expect(isUsableForecast(status({ primary: -999, secondary: 0.17 }))).toBe(true);
  });
});

/**
 * Handler-level tests for the detail="full" cap lift (D2). Coordinates are passed
 * directly so resolveLocationAsync short-circuits on the coordinate branch and never
 * touches locationStore/geocodingService — both are inert stubs here, mirroring
 * tests/unit/air-quality-forecast.test.ts.
 */
describe('handleGetRiverConditions', () => {
  const BASE_LAT = 42.3601;
  const BASE_LON = -71.0589;

  const getNWPSGaugesInBoundingBoxMock = vi.fn();
  const noaaService = { getNWPSGaugesInBoundingBox: getNWPSGaugesInBoundingBoxMock } as never;
  const locationStore = {} as never;
  const geocodingService = {} as never;
  // US coordinates route to NOAA, so the Open-Meteo service is never consulted here.
  const openMeteoService = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Build `n` gauges with strictly increasing distance from BASE_LAT/BASE_LON
   * (small increasing latitude offsets), so sort-by-nearest ordering is
   * deterministic: gauge index 0 is nearest, index n-1 is farthest.
   */
  function buildGauges(n: number, crestsPerGauge = 0): NWPSGauge[] {
    return Array.from({ length: n }, (_, i) => {
      const gauge: NWPSGauge = {
        lid: `LID${i}`,
        name: `Gauge ${i}`,
        latitude: BASE_LAT + i * 0.001,
        longitude: BASE_LON,
        state: { abbreviation: 'MA', name: 'Massachusetts' },
        status: {
          observed: {
            primary: 4.2,
            secondary: 0.05,
            floodCategory: null,
            validTime: '2026-07-16T14:00:00Z'
          }
        }
      };

      if (crestsPerGauge > 0) {
        const recent: HistoricCrest[] = Array.from({ length: crestsPerGauge }, (_, c) => ({
          stage: 10 + c,
          occurredTime: `20${20 + c}-03-15T00:00:00Z`
        }));
        gauge.flood = {
          categories: { action: { stage: 8 }, minor: { stage: 10 }, moderate: { stage: 14 }, major: { stage: 18 } },
          crests: { recent }
        };
      }

      return gauge;
    });
  }

  function callHandler(args: Record<string, unknown>) {
    return handleGetRiverConditions(
      { latitude: BASE_LAT, longitude: BASE_LON, ...args },
      noaaService,
      locationStore,
      geocodingService,
      openMeteoService
    );
  }

  it('defaults to showing the nearest 5 of 30 gauges with a detail="full" pointer', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue(buildGauges(30));

    const result = await callHandler({});
    const text = result.content[0].text;

    for (let i = 0; i < 5; i++) {
      expect(text).toContain(`Gauge ${i}`);
    }
    expect(text).not.toContain('Gauge 5\n');
    expect(text).toContain(
      '*Note: 25 additional gauges found within radius (showing nearest 5 only — use detail="full" for more)*'
    );
  });

  it('shows the nearest 25 of 30 gauges at detail="full" with an accurate, pointer-free note', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue(buildGauges(30));

    const result = await callHandler({ detail: 'full' });
    const text = result.content[0].text;

    for (let i = 0; i < 25; i++) {
      expect(text).toContain(`Gauge ${i}`);
    }
    expect(text).not.toContain('Gauge 25\n');
    expect(text).toContain('*Note: 5 additional gauges found within radius (showing nearest 25)*');
    expect(text).not.toContain('use detail="full" for more');
  });

  it('omits the remainder note at any detail level when gauge count is at or below the cap', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue(buildGauges(5));

    const summaryResult = await callHandler({ detail: 'summary' });
    const fullResult = await callHandler({ detail: 'full' });

    expect(summaryResult.content[0].text).not.toContain('additional gauge');
    expect(fullResult.content[0].text).not.toContain('additional gauge');
  });

  it('shows 3 of 5 recent crests at default detail and all 5 at detail="full"', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue(buildGauges(1, 5));

    const defaultResult = await callHandler({});
    const defaultText = defaultResult.content[0].text;
    expect(defaultText).toContain('**2020:**');
    expect(defaultText).toContain('**2021:**');
    expect(defaultText).toContain('**2022:**');
    expect(defaultText).not.toContain('**2023:**');
    expect(defaultText).not.toContain('**2024:**');

    const fullResult = await callHandler({ detail: 'full' });
    const fullText = fullResult.content[0].text;
    expect(fullText).toContain('**2020:**');
    expect(fullText).toContain('**2021:**');
    expect(fullText).toContain('**2022:**');
    expect(fullText).toContain('**2023:**');
    expect(fullText).toContain('**2024:**');
  });

  it('rejects an invalid detail value', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue(buildGauges(1));

    await expect(callHandler({ detail: 'bogus' })).rejects.toThrow(
      'Invalid detail: "bogus". Must be one of "summary", "standard", or "full".'
    );
  });

  it('suppresses a placeholder observed status instead of rendering the year-0001 row', async () => {
    // Live SCTM3 shape (2026-07-17): observed exists but is the NWPS "obs not
    // current" placeholder — year-0001 validTime, sentinel/absent values.
    const [gauge] = buildGauges(1);
    gauge.status.observed = {
      primary: -999,
      secondary: -999,
      floodCategory: 'obs_not_current',
      validTime: '0001-12-31T19:03:00Z'
    };
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([gauge]);

    const result = await callHandler({});
    const text = result.content[0].text;

    expect(text).toContain('*No current observations available*');
    expect(text).not.toContain('Dec 31, 1');
    expect(text).not.toContain('OBS NOT CURRENT');
    expect(text).not.toContain('-999');
  });
});

/**
 * Build an observed stage series at a 30-minute cadence ending at `end`,
 * walking linearly from `startStage` to `endStage` over `hours`.
 */
function buildSeries(
  hours: number,
  startStage: number,
  endStage: number,
  end = Date.parse('2026-07-17T15:00:00Z')
): StageFlowDataPoint[] {
  const steps = hours * 2;
  return Array.from({ length: steps + 1 }, (_, i) => ({
    validTime: new Date(end - (steps - i) * 1800_000).toISOString(),
    generatedTime: new Date(end).toISOString(),
    primary: startStage + ((endStage - startStage) * i) / steps,
    secondary: null
  }));
}

describe('computeStageTrend', () => {
  it('detects a rise over the 6-hour window', () => {
    const trend = computeStageTrend(buildSeries(6, 3.0, 3.5));
    expect(trend).toEqual({ direction: 'rising', delta: expect.closeTo(0.5, 5), windowHours: 6 });
  });

  it('detects a fall over the 6-hour window', () => {
    const trend = computeStageTrend(buildSeries(6, 4.0, 3.6));
    expect(trend?.direction).toBe('falling');
    expect(trend?.delta).toBeCloseTo(-0.4, 5);
    expect(trend?.windowHours).toBe(6);
  });

  it('uses only the last 6 hours of a longer series', () => {
    // 30 days of history rising slowly, but flat over the final 6 hours
    const old = buildSeries(720, 0.0, 3.0, Date.parse('2026-07-17T09:00:00Z'));
    const recent = buildSeries(6, 3.0, 3.0);
    const trend = computeStageTrend([...old, ...recent]);
    expect(trend?.direction).toBe('steady');
    expect(trend?.windowHours).toBe(6);
  });

  it('reads changes below the steady threshold as steady, above it as a trend', () => {
    expect(computeStageTrend(buildSeries(6, 3.0, 3.04))?.direction).toBe('steady');
    expect(computeStageTrend(buildSeries(6, 3.0, 3.06))?.direction).toBe('rising');
    expect(computeStageTrend(buildSeries(6, 3.06, 3.0))?.direction).toBe('falling');
  });

  it('excludes sentinel points anywhere in the series', () => {
    const series = buildSeries(6, 3.0, 3.5);
    // Corrupt the latest point and one mid-series point with NWPS sentinels
    series[series.length - 1].primary = -999;
    series[4].primary = -999999;
    const trend = computeStageTrend(series);
    expect(trend?.direction).toBe('rising');
    // Latest real point is the second-to-last (3.5 - one 30-min step)
    expect(trend!.delta).toBeLessThan(0.5);
    expect(trend!.delta).toBeGreaterThan(0.4);
  });

  it('excludes points with implausible timestamps', () => {
    const series = buildSeries(6, 3.0, 3.5);
    series[series.length - 1].validTime = '0001-12-31T18:27:00Z';
    const trend = computeStageTrend(series);
    expect(trend?.direction).toBe('rising');
  });

  it('returns undefined for missing, empty, all-sentinel, or single-point series', () => {
    expect(computeStageTrend(undefined)).toBeUndefined();
    expect(computeStageTrend([])).toBeUndefined();
    expect(
      computeStageTrend(buildSeries(6, 3.0, 3.5).map(p => ({ ...p, primary: -999 })))
    ).toBeUndefined();
    expect(computeStageTrend(buildSeries(6, 3.0, 3.5).slice(-1))).toBeUndefined();
  });

  it('falls back to the nearest predecessor for sparse series, labeling the actual window', () => {
    const end = Date.parse('2026-07-17T15:00:00Z');
    const sparse: StageFlowDataPoint[] = [
      { validTime: new Date(end - 12 * 3600_000).toISOString(), generatedTime: '', primary: 2.0, secondary: null },
      { validTime: new Date(end).toISOString(), generatedTime: '', primary: 2.6, secondary: null }
    ];
    const trend = computeStageTrend(sparse);
    expect(trend).toEqual({ direction: 'rising', delta: expect.closeTo(0.6, 5), windowHours: 12 });
  });

  it('tolerates unsorted input', () => {
    const series = buildSeries(6, 3.0, 3.5).reverse();
    expect(computeStageTrend(series)?.direction).toBe('rising');
  });
});

describe('formatStageTrend', () => {
  it('renders rising, falling, and steady clauses', () => {
    expect(formatStageTrend({ direction: 'rising', delta: 0.5, windowHours: 6 })).toBe(
      '↗ rising (+0.5 ft / 6h)'
    );
    expect(formatStageTrend({ direction: 'falling', delta: -0.42, windowHours: 6 })).toBe(
      '↘ falling (-0.4 ft / 6h)'
    );
    expect(formatStageTrend({ direction: 'steady', delta: 0.01, windowHours: 6 })).toBe(
      '→ steady (last 6h)'
    );
  });
});

/**
 * Handler-level trend tests (D4): the observed stageflow series drives an inline
 * trend on each shown gauge; stageflow failures degrade to no-trend and a
 * rate-limit rejection stops further stageflow fetches.
 */
describe('handleGetRiverConditions observed trend', () => {
  const BASE_LAT = 42.3601;
  const BASE_LON = -71.0589;

  const getNWPSGaugesInBoundingBoxMock = vi.fn();
  const getNWPSStageFlowMock = vi.fn();
  const noaaService = {
    getNWPSGaugesInBoundingBox: getNWPSGaugesInBoundingBoxMock,
    getNWPSStageFlow: getNWPSStageFlowMock
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildGauge(i: number): NWPSGauge {
    return {
      lid: `LID${i}`,
      name: `Gauge ${i}`,
      latitude: BASE_LAT + i * 0.001,
      longitude: BASE_LON,
      state: { abbreviation: 'MA', name: 'Massachusetts' },
      status: {
        observed: {
          primary: 4.2,
          secondary: 0.05,
          floodCategory: null,
          validTime: '2026-07-17T14:00:00Z'
        }
      }
    };
  }

  function callHandler(args: Record<string, unknown> = {}) {
    return handleGetRiverConditions(
      { latitude: BASE_LAT, longitude: BASE_LON, ...args },
      noaaService,
      {} as never,
      {} as never,
      {} as never
    );
  }

  it('appends the observed trend to the stage line for gauges with a series', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([buildGauge(0)]);
    getNWPSStageFlowMock.mockResolvedValue({ observed: { data: buildSeries(6, 3.7, 4.2) } });

    const result = await callHandler();
    const text = result.content[0].text;

    expect(getNWPSStageFlowMock).toHaveBeenCalledWith('LID0');
    expect(text).toContain('**River Stage:** 4.20 ft  ↗ rising (+0.5 ft / 6h)');
  });

  it('omits the trend silently when the stageflow fetch fails', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([buildGauge(0)]);
    getNWPSStageFlowMock.mockRejectedValue(new Error('boom'));

    const result = await callHandler();
    const text = result.content[0].text;

    expect(text).toContain('**River Stage:** 4.20 ft\n');
    expect(text).not.toContain('rising');
    expect(text).not.toContain('falling');
    expect(text).not.toContain('Error retrieving river gauge data');
  });

  it('omits the trend when the observed series is all sentinels', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([buildGauge(0)]);
    getNWPSStageFlowMock.mockResolvedValue({
      observed: { data: buildSeries(6, 3.7, 4.2).map(p => ({ ...p, primary: -999 })) }
    });

    const result = await callHandler();
    expect(result.content[0].text).toContain('**River Stage:** 4.20 ft\n');
  });

  it('stops fetching stageflow after a rate-limit rejection', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => buildGauge(i))
    );
    getNWPSStageFlowMock.mockRejectedValue(new RateLimitError('NOAA'));

    const result = await callHandler({ detail: 'full' });
    const text = result.content[0].text;

    // First batch of 5 attempted, rate-limited, no further batches for the
    // remaining 20 shown gauges
    expect(getNWPSStageFlowMock).toHaveBeenCalledTimes(5);
    expect(text).toContain('Gauge 24'); // all 25 gauges still render
    expect(text).not.toContain('rising');
  });
});

/**
 * Handler-level forecast-series tests (T7 / D4): detail="full" renders the multi-point
 * NWPS forecast series for gauges that have one, with per-point sentinel filtering and
 * flood-category derivation. Gauges without a forecast series (the ~4/5 majority per the
 * live probe) must render nothing — no header, no empty section — and lower detail
 * levels must never show the series at all.
 */
describe('handleGetRiverConditions forecast series (detail="full")', () => {
  const BASE_LAT = 42.3601;
  const BASE_LON = -71.0589;

  const getNWPSGaugesInBoundingBoxMock = vi.fn();
  const getNWPSStageFlowMock = vi.fn();
  const noaaService = {
    getNWPSGaugesInBoundingBox: getNWPSGaugesInBoundingBoxMock,
    getNWPSStageFlow: getNWPSStageFlowMock
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildGaugeWithFlood(i: number): NWPSGauge {
    return {
      lid: `LID${i}`,
      name: `Gauge ${i}`,
      latitude: BASE_LAT + i * 0.001,
      longitude: BASE_LON,
      state: { abbreviation: 'MA', name: 'Massachusetts' },
      status: {
        observed: {
          primary: 4.2,
          secondary: 0.05,
          floodCategory: null,
          validTime: '2026-07-17T14:00:00Z'
        }
      },
      flood: {
        categories: { action: { stage: 8 }, minor: { stage: 10 }, moderate: { stage: 14 }, major: { stage: 18 } }
      }
    };
  }

  function forecastPoint(validTime: string, primary: number | null): StageFlowDataPoint {
    return { validTime, generatedTime: '2026-07-17T14:00:00Z', primary, secondary: null };
  }

  function callHandler(args: Record<string, unknown> = {}) {
    return handleGetRiverConditions(
      { latitude: BASE_LAT, longitude: BASE_LON, ...args },
      noaaService,
      {} as never,
      {} as never,
      {} as never
    );
  }

  it('(a) renders one line per real forecast point with correct per-point flood category, at detail="full"', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([buildGaugeWithFlood(0)]);
    getNWPSStageFlowMock.mockResolvedValue({
      forecast: {
        data: [
          forecastPoint('2026-07-17T18:00:00Z', 6.0), // below action -> no category clause
          forecastPoint('2026-07-18T00:00:00Z', 9.0), // action
          forecastPoint('2026-07-18T06:00:00Z', 12.0), // minor
          forecastPoint('2026-07-18T12:00:00Z', 15.0), // moderate
          forecastPoint('2026-07-18T18:00:00Z', 20.0) // major
        ]
      }
    });

    const result = await callHandler({ detail: 'full' });
    const text = result.content[0].text;

    expect(text).toContain('### Forecast Series');
    expect(text).toContain('9.00 ft 🟡 ACTION');
    expect(text).toContain('12.00 ft 🟠 MINOR');
    expect(text).toContain('15.00 ft 🔴 MODERATE');
    expect(text).toContain('20.00 ft 🔴🔴 MAJOR');
    expect(text).toMatch(/6\.00 ft\n/); // below action: stage only, no category clause

    const seriesLines = text.split('\n').filter(l => l.startsWith('- **') && l.includes('ft'));
    expect(seriesLines.length).toBe(5);
  });

  it('(b) renders no Forecast Series header for a gauge with no forecast series, or an empty one', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([buildGaugeWithFlood(0), buildGaugeWithFlood(1)]);
    getNWPSStageFlowMock.mockImplementation((lid: string) => {
      if (lid === 'LID0') return Promise.resolve({}); // no forecast key at all
      return Promise.resolve({ forecast: { data: [] } }); // present but empty
    });

    const result = await callHandler({ detail: 'full' });
    expect(result.content[0].text).not.toContain('### Forecast Series');
  });

  it('(c) drops -999/year-0001 sentinel points from the series, keeping the real ones', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([buildGaugeWithFlood(0)]);
    getNWPSStageFlowMock.mockResolvedValue({
      forecast: {
        data: [
          forecastPoint('2026-07-17T18:00:00Z', -999),
          forecastPoint('0001-12-31T18:27:00Z', 12.0),
          forecastPoint('2026-07-18T06:00:00Z', 9.5)
        ]
      }
    });

    const result = await callHandler({ detail: 'full' });
    const text = result.content[0].text;

    expect(text).toContain('### Forecast Series');
    expect(text).toContain('9.50 ft 🟡 ACTION');
    expect(text).not.toContain('-999');
    expect(text).not.toContain('12.00 ft');
  });

  it('(d) renders no header at all when every point in the series is a sentinel', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([buildGaugeWithFlood(0)]);
    getNWPSStageFlowMock.mockResolvedValue({
      forecast: {
        data: [
          forecastPoint('2026-07-17T18:00:00Z', -999),
          forecastPoint('0001-12-31T18:27:00Z', -999999)
        ]
      }
    });

    const result = await callHandler({ detail: 'full' });
    expect(result.content[0].text).not.toContain('### Forecast Series');
  });

  it('(e) omits the Forecast Series block at default detail even when a forecast series exists', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([buildGaugeWithFlood(0)]);
    getNWPSStageFlowMock.mockResolvedValue({
      forecast: {
        data: [
          forecastPoint('2026-07-17T18:00:00Z', 9.0),
          forecastPoint('2026-07-18T00:00:00Z', 12.0)
        ]
      }
    });

    const result = await callHandler();
    expect(result.content[0].text).not.toContain('### Forecast Series');
    // Stageflow is still fetched at every detail level (the trend needs it) —
    // only the series rendering is full-only.
    expect(getNWPSStageFlowMock).toHaveBeenCalledWith('LID0');
  });

  it('(f) leaves the existing single-point Forecast block untouched alongside the new series', async () => {
    const gauge = buildGaugeWithFlood(0);
    gauge.status.forecast = {
      primary: 5.1,
      secondary: 0.02,
      floodCategory: 'no_flooding',
      validTime: '2026-07-17T20:00:00Z'
    };
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([gauge]);
    getNWPSStageFlowMock.mockResolvedValue({
      forecast: {
        data: [forecastPoint('2026-07-18T00:00:00Z', 9.0)]
      }
    });

    const result = await callHandler({ detail: 'full' });
    const text = result.content[0].text;

    expect(text).toContain('### Forecast\n');
    expect(text).toContain('**Forecasted Stage:** 5.10 ft');
    expect(text).toContain('### Forecast Series');
    expect(text).toContain('9.00 ft 🟡 ACTION');
    expect(text.indexOf('### Forecast\n')).toBeLessThan(text.indexOf('### Forecast Series'));
  });
});

/**
 * Handler-level tests for `### Flood Stages` and `### Recent Historic Crests` against
 * the live NWPS shape landed by T1 (commit ad388fd): `flood.categories.<level>` is a
 * `{ stage?, flow? }` object using -9999 as the "not published" sentinel, and crests
 * carry `occurredTime`/`stage`/`flow` — not the old flat-number / `{ value, date,
 * description }` shapes. See tests/unit/nwps-gauge-shape.test.ts for the same
 * assertions driven off real captured bytes rather than these builders.
 */
describe('handleGetRiverConditions flood stages and crests (T2)', () => {
  const BASE_LAT = 42.3601;
  const BASE_LON = -71.0589;

  const getNWPSGaugesInBoundingBoxMock = vi.fn();
  const noaaService = { getNWPSGaugesInBoundingBox: getNWPSGaugesInBoundingBoxMock } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildGauge(overrides: Partial<NWPSGauge> = {}): NWPSGauge {
    return {
      lid: 'LID0',
      name: 'Gauge 0',
      latitude: BASE_LAT,
      longitude: BASE_LON,
      state: { abbreviation: 'MA', name: 'Massachusetts' },
      status: {
        observed: {
          primary: 4.2,
          secondary: 0.05,
          floodCategory: null,
          validTime: '2026-07-17T14:00:00Z'
        }
      },
      ...overrides
    };
  }

  function forecastPoint(validTime: string, primary: number | null): StageFlowDataPoint {
    return { validTime, generatedTime: '2026-07-17T14:00:00Z', primary, secondary: null };
  }

  function callHandler(args: Record<string, unknown> = {}) {
    return handleGetRiverConditions(
      { latitude: BASE_LAT, longitude: BASE_LON, ...args },
      noaaService,
      {} as never,
      {} as never,
      {} as never
    );
  }

  it('renders four rows in ascending severity, unrounded, when all four stages are real', async () => {
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([
      buildGauge({
        flood: {
          stageUnits: 'ft',
          categories: {
            action: { stage: 7.5 },
            minor: { stage: 10.2 },
            moderate: { stage: 14.3 },
            major: { stage: 18.7 }
          }
        }
      })
    ]);

    const result = await callHandler({});
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('### Flood Stages');
    expect(text).toContain('**Action Stage:** 7.5 ft');
    expect(text).toContain('**Minor Flood:** 10.2 ft');
    expect(text).toContain('**Moderate Flood:** 14.3 ft');
    expect(text).toContain('**Major Flood:** 18.7 ft');

    const iAction = text.indexOf('**Action Stage:**');
    const iMinor = text.indexOf('**Minor Flood:**');
    const iModerate = text.indexOf('**Moderate Flood:**');
    const iMajor = text.indexOf('**Major Flood:**');
    expect(iAction).toBeLessThan(iMinor);
    expect(iMinor).toBeLessThan(iModerate);
    expect(iModerate).toBeLessThan(iMajor);
  });

  it('renders exactly two rows for an action+minor-only gauge, and labels a forecast point above minor MINOR (deriveFloodCategory skip)', async () => {
    // G13: moderate/major are the genuine -9999 "not published" sentinel, not
    // absent keys and not duplicates of action/minor — a fixture where every
    // level shared a value could not exercise the skip.
    const categories: FloodCategories = {
      action: { stage: 8 },
      minor: { stage: 10 },
      moderate: { stage: -9999 },
      major: { stage: -9999 }
    };
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([
      buildGauge({ flood: { stageUnits: 'ft', categories } })
    ]);

    const stagesResult = await callHandler({});
    const stagesText = (stagesResult.content[0] as { text: string }).text;
    expect(stagesText).toContain('**Action Stage:** 8.0 ft');
    expect(stagesText).toContain('**Minor Flood:** 10.0 ft');
    expect(stagesText).not.toContain('**Moderate Flood:**');
    expect(stagesText).not.toContain('**Major Flood:**');

    // Now drive the same categories through the forecast-series path (the
    // only call site of deriveFloodCategory) with a point above minor but
    // nowhere near a real moderate/major threshold. Without the skip this
    // falls through every unreal level and reads as no category at all.
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([
      buildGauge({ flood: { stageUnits: 'ft', categories } })
    ]);
    const getNWPSStageFlowMock = vi.fn().mockResolvedValue({
      forecast: { data: [forecastPoint('2026-07-18T00:00:00Z', 12.0)] }
    });
    const noaaServiceWithStageFlow = {
      getNWPSGaugesInBoundingBox: getNWPSGaugesInBoundingBoxMock,
      getNWPSStageFlow: getNWPSStageFlowMock
    } as never;

    const seriesResult = await handleGetRiverConditions(
      { latitude: BASE_LAT, longitude: BASE_LON, detail: 'full' },
      noaaServiceWithStageFlow,
      {} as never,
      {} as never,
      {} as never
    );
    const seriesText = (seriesResult.content[0] as { text: string }).text;
    expect(seriesText).toContain('12.00 ft 🟠 MINOR');
    expect(seriesText).not.toMatch(/12\.00 ft\n/); // must not fall through to "no category"
  });

  it('renders the no-thresholds line and no rows at both detail="standard" and detail="full" when all four stages are sentinel', async () => {
    const categories: FloodCategories = {
      action: { stage: -9999 },
      minor: { stage: -9999 },
      moderate: { stage: -9999 },
      major: { stage: -9999 }
    };
    const gauge = buildGauge({ flood: { stageUnits: 'ft', categories } });

    for (const detail of ['standard', 'full'] as const) {
      getNWPSGaugesInBoundingBoxMock.mockResolvedValue([gauge]);
      const result = await callHandler({ detail });
      const text = (result.content[0] as { text: string }).text;

      expect(text).toContain('### Flood Stages');
      expect(text).toContain(
        '*NOAA publishes no flood-stage thresholds for this gauge. That is an absence of published ' +
          'thresholds, not an absence of flood risk — the **Flood Category:** line above comes from ' +
          "NOAA's own status.*"
      );
      expect(text).not.toContain('**Action Stage:**');
      expect(text).not.toContain('**Minor Flood:**');
      expect(text).not.toContain('**Moderate Flood:**');
      expect(text).not.toContain('**Major Flood:**');
    }
  });

  it('renders no flow clause for a -9999 or 0 crest flow, and a clause for a real one — never printing NaN, undefined, or -9999', async () => {
    // NWPS uses BOTH -9999 and 0 for an unrecorded crest flow (20 of PRTO3's 26
    // recent crests are `flow: 0`). A crest is a peak, so zero flow is never a real
    // measurement. `isRealValue` alone treats 0 as real, so the renderer excludes it
    // explicitly rather than relying on the pre-fix truthy check that hid it by luck.
    const recent: HistoricCrest[] = [
      { stage: 12.5, occurredTime: '2020-03-15T00:00:00Z', flow: -9999 },
      { stage: 13.1, occurredTime: '2021-03-15T00:00:00Z', flow: 4200 },
      { stage: 11.9, occurredTime: '2022-03-15T00:00:00Z', flow: 0 }
    ];
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([
      buildGauge({ flood: { stageUnits: 'ft', flowUnits: 'cfs', crests: { recent } } })
    ]);

    const result = await callHandler({});
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('### Recent Historic Crests');
    expect(text).toContain('**2020:** 12.50 ft');
    expect(text).not.toMatch(/\*\*2020:\*\* 12\.50 ft \(/); // no flow clause on the sentinel
    expect(text).toContain('**2021:** 13.10 ft (4200 cfs)');
    expect(text).toContain('**2022:** 11.90 ft');
    expect(text).not.toMatch(/\*\*2022:\*\* 11\.90 ft \(/); // zero flow is unrecorded, not a measurement
    expect(text).not.toContain('(0 cfs)');

    expect(text).not.toContain('NaN');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('-9999');
  });

  it('skips a crest whose stage is -9999 entirely, rendering only the real ones', async () => {
    const recent: HistoricCrest[] = [
      { stage: -9999, occurredTime: '2019-03-15T00:00:00Z', flow: 500 },
      { stage: 10.4, occurredTime: '2020-03-15T00:00:00Z', flow: 900 }
    ];
    getNWPSGaugesInBoundingBoxMock.mockResolvedValue([
      buildGauge({ flood: { stageUnits: 'ft', flowUnits: 'cfs', crests: { recent } } })
    ]);

    const result = await callHandler({});
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('### Recent Historic Crests');
    expect(text).not.toContain('**2019:**');
    expect(text).toContain('**2020:** 10.40 ft (900 cfs)');
  });
});
