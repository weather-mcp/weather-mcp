/**
 * Tests for the pure multi-model forecast comparison module
 * (src/utils/modelComparison.ts). Pure, deterministic, no I/O and no mocks —
 * fixtures are small inline `RawModelComparisonDaily` objects shaped like
 * the suffixed multi-model Open-Meteo response
 * (`${variable}_${model}` keys), per docs/multi-model-comparison-plan.md D4.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPARISON_MODELS,
  extractModelSeries,
  classifyTempSpread,
  weatherCodeBucket,
  computeStatSummary,
  buildModelComparison,
  type RawModelComparisonDaily
} from '../../src/utils/modelComparison.js';

/** Build a `RawModelComparisonDaily` fixture from a flat `${variable}_${model}` key map. */
function daily(time: string[], values: Record<string, (number | null)[]>): RawModelComparisonDaily {
  return { time, ...values };
}

describe('COMPARISON_MODELS', () => {
  it('is the fixed six-model curated set, best_match first (single source of truth)', () => {
    expect(COMPARISON_MODELS).toEqual([
      'best_match',
      'gfs_seamless',
      'ecmwf_ifs025',
      'icon_seamless',
      'gem_seamless',
      'ukmo_seamless'
    ]);
  });
});

describe('extractModelSeries', () => {
  it('builds the `${variable}_${model}` key and returns the array', () => {
    const d = daily(['d1'], { temperature_2m_max_gfs_seamless: [80] });
    expect(extractModelSeries(d, 'temperature_2m_max', 'gfs_seamless')).toEqual([80]);
  });

  it('returns undefined when the key is absent', () => {
    const d = daily(['d1'], {});
    expect(extractModelSeries(d, 'temperature_2m_max', 'gfs_seamless')).toBeUndefined();
  });

  it('returns undefined when the value is not an array (defensive Array.isArray guard)', () => {
    const d = { time: ['d1'], temperature_2m_max_gfs_seamless: undefined } as unknown as RawModelComparisonDaily;
    expect(extractModelSeries(d, 'temperature_2m_max', 'gfs_seamless')).toBeUndefined();
  });

  it('coerces non-finite entries (NaN, Infinity) to null', () => {
    const d = daily(['d1', 'd2', 'd3'], { weather_code_gfs_seamless: [1, NaN, Infinity] });
    expect(extractModelSeries(d, 'weather_code', 'gfs_seamless')).toEqual([1, null, null]);
  });
});

describe('computeStatSummary', () => {
  it('computes min/max/range/median for an odd-length set', () => {
    expect(computeStatSummary([84, 82, 86])).toEqual({ min: 82, max: 86, range: 4, median: 84, count: 3 });
  });

  it('computes median as the average of the two middle values for an even-length set', () => {
    expect(computeStatSummary([82, 84, 86, 88])).toEqual({ min: 82, max: 88, range: 6, median: 85, count: 4 });
  });

  it('returns a zeroed, count:0 summary for an empty set', () => {
    expect(computeStatSummary([])).toEqual({ min: 0, max: 0, range: 0, median: 0, count: 0 });
  });
});

describe('classifyTempSpread', () => {
  it('classifies exactly 4 F as tight (boundary inclusive)', () => {
    expect(classifyTempSpread(4, 'F')).toBe('tight');
  });
  it('classifies just above 4 F as moderate', () => {
    expect(classifyTempSpread(4.01, 'F')).toBe('moderate');
  });
  it('classifies exactly 8 F as moderate (boundary inclusive)', () => {
    expect(classifyTempSpread(8, 'F')).toBe('moderate');
  });
  it('classifies just above 8 F as divergent', () => {
    expect(classifyTempSpread(8.01, 'F')).toBe('divergent');
  });
  it('classifies exactly 2.2 C as tight (scaled boundary inclusive)', () => {
    expect(classifyTempSpread(2.2, 'C')).toBe('tight');
  });
  it('classifies just above 2.2 C as moderate', () => {
    expect(classifyTempSpread(2.21, 'C')).toBe('moderate');
  });
  it('classifies exactly 4.4 C as moderate (scaled boundary inclusive)', () => {
    expect(classifyTempSpread(4.4, 'C')).toBe('moderate');
  });
  it('classifies just above 4.4 C as divergent', () => {
    expect(classifyTempSpread(4.41, 'C')).toBe('divergent');
  });
});

describe('weatherCodeBucket', () => {
  const cases: [number, string][] = [
    [0, 'clear'],
    [1, 'clear'],
    [2, 'cloudy'],
    [3, 'cloudy'],
    [45, 'fog'],
    [48, 'fog'],
    [51, 'rain'],
    [67, 'rain'],
    [80, 'rain'],
    [82, 'rain'],
    [71, 'snow'],
    [77, 'snow'],
    [85, 'snow'],
    [86, 'snow'],
    [95, 'thunderstorm'],
    [99, 'thunderstorm'],
    [4, 'other'],
    [50, 'other'],
    [68, 'other']
  ];

  for (const [code, bucket] of cases) {
    it(`buckets code ${code} as ${bucket}`, () => {
      expect(weatherCodeBucket(code)).toBe(bucket);
    });
  }
});

describe('buildModelComparison', () => {
  it('excludes best_match from every stat while carrying it as a reference value', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_best_match: [200],
      temperature_2m_max_gfs_seamless: [80],
      temperature_2m_max_ecmwf_ifs025: [82],
      temperature_2m_max_icon_seamless: [84],
      temperature_2m_max_gem_seamless: [81],
      temperature_2m_max_ukmo_seamless: [83],
      temperature_2m_min_best_match: [100],
      temperature_2m_min_gfs_seamless: [60],
      temperature_2m_min_ecmwf_ifs025: [61],
      temperature_2m_min_icon_seamless: [62],
      temperature_2m_min_gem_seamless: [60],
      temperature_2m_min_ukmo_seamless: [61],
      weather_code_best_match: [1],
      weather_code_gfs_seamless: [1],
      weather_code_ecmwf_ifs025: [1],
      weather_code_icon_seamless: [1],
      weather_code_gem_seamless: [1],
      weather_code_ukmo_seamless: [1],
      precipitation_sum_gfs_seamless: [0],
      precipitation_sum_ecmwf_ifs025: [0],
      precipitation_sum_icon_seamless: [0],
      precipitation_sum_gem_seamless: [0],
      precipitation_sum_ukmo_seamless: [0]
    });

    const result = buildModelComparison(d, 'F', 'inch');

    expect(result.trimmedDays).toBe(0);
    expect(result.droppedModels).toEqual([]);
    expect(result.days).toHaveLength(1);

    const day = result.days[0];
    expect(day.participantCount).toBe(5);
    expect(day.temperature.high).toEqual({ min: 80, max: 84, range: 4, median: 82, count: 5 });
    expect(day.temperature.low).toEqual({ min: 60, max: 62, range: 2, median: 61, count: 5 });
    expect(day.bestMatch).toEqual({ high: 200, low: 100, code: 1 });
  });

  it('omits the Best-match line (bestMatch: null) when best_match high is null that day', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_gfs_seamless: [80],
      temperature_2m_max_ecmwf_ifs025: [81]
      // no best_match keys at all -> undefined series -> null-filled -> bestMatch omitted
    });

    const result = buildModelComparison(d, 'F', 'inch');
    expect(result.days[0].bestMatch).toBeNull();
  });

  it('lets a model participate per-variable even with an all-null probability series (UKMO mode)', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_gfs_seamless: [80],
      temperature_2m_max_ecmwf_ifs025: [82],
      temperature_2m_max_icon_seamless: [84],
      temperature_2m_max_gem_seamless: [81],
      temperature_2m_max_ukmo_seamless: [83],
      precipitation_probability_max_gfs_seamless: [10],
      precipitation_probability_max_ecmwf_ifs025: [12],
      precipitation_probability_max_icon_seamless: [8],
      precipitation_probability_max_gem_seamless: [9],
      precipitation_probability_max_ukmo_seamless: [null]
    });

    const result = buildModelComparison(d, 'F', 'inch');
    const day = result.days[0];

    // UKMO still counts toward the temperature participant count...
    expect(day.temperature.high.count).toBe(5);
    expect(day.temperature.perModelHigh.some(v => v.model === 'ukmo_seamless')).toBe(true);
    // ...but the probability stat only reflects the four publishing models.
    expect(day.precipitation.probability).toEqual({ min: 8, max: 12, range: 4, median: 9.5, count: 4 });
    expect(day.precipitation.perModelProbability.some(v => v.model === 'ukmo_seamless')).toBe(false);
  });

  it('drops an all-null-across-every-variable model and records it in droppedModels', () => {
    const d = daily(['2026-08-18', '2026-08-19'], {
      temperature_2m_max_gfs_seamless: [80, 81],
      temperature_2m_max_ecmwf_ifs025: [82, 83],
      temperature_2m_max_icon_seamless: [81, 82],
      temperature_2m_max_gem_seamless: [79, 80],
      temperature_2m_max_ukmo_seamless: [null, null],
      temperature_2m_min_ukmo_seamless: [null, null],
      precipitation_sum_ukmo_seamless: [null, null],
      precipitation_probability_max_ukmo_seamless: [null, null],
      wind_speed_10m_max_ukmo_seamless: [null, null],
      weather_code_ukmo_seamless: [null, null]
    });

    const result = buildModelComparison(d, 'F', 'inch');

    expect(result.droppedModels).toEqual(['ukmo_seamless']);
    // Not trimmed: the 4 surviving models still have >= 2 participants each day.
    expect(result.trimmedDays).toBe(0);
    expect(result.days).toHaveLength(2);
    for (const day of result.days) {
      expect(day.participantCount).toBe(4);
      expect(day.temperature.perModelHigh.some(v => v.model === 'ukmo_seamless')).toBe(false);
    }
  });

  it('trims trailing days below 2 participants but retains an interior gap day', () => {
    const d = daily(
      ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'],
      {
        temperature_2m_max_gfs_seamless: [80, 75, 80, 80, null],
        temperature_2m_max_ecmwf_ifs025: [82, null, 82, null, null],
        temperature_2m_max_icon_seamless: [81, null, 81, null, null],
        temperature_2m_max_gem_seamless: [79, null, 79, null, null],
        temperature_2m_max_ukmo_seamless: [83, null, 83, null, null]
      }
    );

    const result = buildModelComparison(d, 'F', 'inch');

    // Day 3 (1 participant) and day 4 (0 participants) are trailing and trimmed.
    expect(result.trimmedDays).toBe(2);
    expect(result.days).toHaveLength(3);

    expect(result.days[0].participantCount).toBe(5);
    // Interior gap (day index 1, only gfs reporting) is retained, not trimmed.
    expect(result.days[1].date).toBe('2026-08-19');
    expect(result.days[1].participantCount).toBe(1);
    expect(result.days[2].participantCount).toBe(5);
  });

  it('counts a model as predicting measurable precipitation at exactly the 0.01 in threshold (imperial)', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_gfs_seamless: [80],
      temperature_2m_max_ecmwf_ifs025: [81],
      temperature_2m_max_icon_seamless: [82],
      temperature_2m_max_gem_seamless: [83],
      temperature_2m_max_ukmo_seamless: [84],
      precipitation_sum_gfs_seamless: [0.01], // at threshold -> wet
      precipitation_sum_ecmwf_ifs025: [0.0099], // just below -> dry
      precipitation_sum_icon_seamless: [0.02], // above -> wet
      precipitation_sum_gem_seamless: [0], // dry
      precipitation_sum_ukmo_seamless: [0.01] // at threshold -> wet
    });

    const result = buildModelComparison(d, 'F', 'inch');
    const precip = result.days[0].precipitation;
    expect(precip.wetParticipantCount).toBe(5);
    expect(precip.wetCount).toBe(3);
  });

  it('counts a model as predicting measurable precipitation at exactly the 0.25 mm threshold (metric)', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_gfs_seamless: [26],
      temperature_2m_max_ecmwf_ifs025: [27],
      temperature_2m_max_icon_seamless: [28],
      temperature_2m_max_gem_seamless: [29],
      temperature_2m_max_ukmo_seamless: [30],
      precipitation_sum_gfs_seamless: [0.25], // at threshold -> wet
      precipitation_sum_ecmwf_ifs025: [0.24], // just below -> dry
      precipitation_sum_icon_seamless: [0.26], // above -> wet
      precipitation_sum_gem_seamless: [0], // dry
      precipitation_sum_ukmo_seamless: [0.25] // at threshold -> wet
    });

    const result = buildModelComparison(d, 'C', 'mm');
    const precip = result.days[0].precipitation;
    expect(precip.wetParticipantCount).toBe(5);
    expect(precip.wetCount).toBe(3);
  });

  it('names the outlier when removing it drops the divergent band at least one level', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_gfs_seamless: [80],
      temperature_2m_max_ecmwf_ifs025: [81],
      temperature_2m_max_icon_seamless: [82],
      temperature_2m_max_gem_seamless: [80],
      temperature_2m_max_ukmo_seamless: [95] // far outlier
    });

    const result = buildModelComparison(d, 'F', 'inch');
    const temp = result.days[0].temperature;

    expect(temp.band).toBe('divergent'); // range 15 > 8
    // Removing ukmo leaves [80, 81, 82, 80] -> range 2 -> tight, which is >= 1 level better.
    expect(temp.outlierModel).toBe('ukmo_seamless');
    expect(temp.outlierUnnamed).toBe(false);
  });

  it('leaves the outlier unnamed ("broadly split") when removing it does not drop the band', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_gfs_seamless: [70],
      temperature_2m_max_ecmwf_ifs025: [80],
      temperature_2m_max_icon_seamless: [90],
      temperature_2m_max_gem_seamless: [100],
      temperature_2m_max_ukmo_seamless: [110]
    });

    const result = buildModelComparison(d, 'F', 'inch');
    const temp = result.days[0].temperature;

    expect(temp.band).toBe('divergent'); // range 40
    // Removing the farthest-from-median candidate (gfs, diff 25, first tie) leaves
    // [80, 90, 100, 110] -> range 30 -> still divergent: no level dropped.
    expect(temp.outlierModel).toBeUndefined();
    expect(temp.outlierUnnamed).toBe(true);
  });

  it('labels a day Good when temperature is tight and precipitation is unanimous (dry)', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_gfs_seamless: [80],
      temperature_2m_max_ecmwf_ifs025: [81],
      temperature_2m_max_icon_seamless: [82],
      temperature_2m_max_gem_seamless: [80],
      temperature_2m_max_ukmo_seamless: [81],
      precipitation_sum_gfs_seamless: [0],
      precipitation_sum_ecmwf_ifs025: [0],
      precipitation_sum_icon_seamless: [0],
      precipitation_sum_gem_seamless: [0],
      precipitation_sum_ukmo_seamless: [0]
    });

    const result = buildModelComparison(d, 'F', 'inch');
    expect(result.days[0].agreement).toBe('Good');
  });

  it('labels a day Moderate when temperature is tight but precipitation is not unanimous or split', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_gfs_seamless: [80],
      temperature_2m_max_ecmwf_ifs025: [81],
      temperature_2m_max_icon_seamless: [82],
      temperature_2m_max_gem_seamless: [80],
      temperature_2m_max_ukmo_seamless: [81],
      precipitation_sum_gfs_seamless: [0.5], // the lone wet model
      precipitation_sum_ecmwf_ifs025: [0],
      precipitation_sum_icon_seamless: [0],
      precipitation_sum_gem_seamless: [0],
      precipitation_sum_ukmo_seamless: [0]
    });

    const result = buildModelComparison(d, 'F', 'inch');
    // wetCount 1: not unanimous (1 != 0, 1 != 5), not a >=2-vs->=2 split either.
    expect(result.days[0].agreement).toBe('Moderate');
  });

  it('labels a day Low when temperature is divergent, regardless of precipitation', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_gfs_seamless: [70],
      temperature_2m_max_ecmwf_ifs025: [72],
      temperature_2m_max_icon_seamless: [74],
      temperature_2m_max_gem_seamless: [73],
      temperature_2m_max_ukmo_seamless: [95],
      precipitation_sum_gfs_seamless: [0],
      precipitation_sum_ecmwf_ifs025: [0],
      precipitation_sum_icon_seamless: [0],
      precipitation_sum_gem_seamless: [0],
      precipitation_sum_ukmo_seamless: [0]
    });

    const result = buildModelComparison(d, 'F', 'inch');
    expect(result.days[0].agreement).toBe('Low');
  });

  it('labels a day Low when precipitation splits at least 2-vs-2, even with tight temperature', () => {
    const d = daily(['2026-08-18'], {
      temperature_2m_max_gfs_seamless: [80],
      temperature_2m_max_ecmwf_ifs025: [81],
      temperature_2m_max_icon_seamless: [82],
      temperature_2m_max_gem_seamless: [80],
      temperature_2m_max_ukmo_seamless: [81],
      precipitation_sum_gfs_seamless: [0.5],
      precipitation_sum_ecmwf_ifs025: [0.5],
      precipitation_sum_icon_seamless: [0],
      precipitation_sum_gem_seamless: [0],
      precipitation_sum_ukmo_seamless: [0]
    });

    const result = buildModelComparison(d, 'F', 'inch');
    // wetCount 2, dryCount 3 -> both sides >= 2 -> split -> Low, despite tight temp.
    expect(result.days[0].agreement).toBe('Low');
  });
});
