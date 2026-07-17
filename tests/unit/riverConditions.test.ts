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
import type { GaugeStatus, NWPSGauge, HistoricCrest, StageFlowDataPoint } from '../../src/types/noaa.js';

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
          value: 10 + c,
          date: `20${20 + c}-03-15T00:00:00Z`
        }));
        gauge.flood = {
          categories: { action: 8, minor: 10, moderate: 14, major: 18 },
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
      geocodingService
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
