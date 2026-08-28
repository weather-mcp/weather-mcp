/**
 * Contract test for T4 (src/utils/modelComparison.ts): the day-comparison
 * temperature-spread band must key on `Math.round(highStats.range)` — the
 * same whole-degree figure the report prints — not the raw range, so the
 * printed spread and its band can never disagree.
 *
 * Drives the real entry point (`buildModelComparison`) with a minimal
 * two-model `RawModelComparisonDaily` fixture (see
 * `tests/unit/modelComparison.test.ts` for the shape this mirrors), rather
 * than the module-private `DaySeriesBag`/`buildDay`, since only
 * `buildModelComparison` is exported. Two participating models is exactly
 * the D4-level-3 trimming floor (>= 2 participants), so nothing gets
 * trimmed.
 *
 * Also pins `ensembleSpread.ts`'s `computeConfidence`/band behaviour at one
 * IQR (4.4 F) — that site is a plan non-goal (still keys on the raw,
 * unrounded p75-p25 spread) and this assertion exists only to stop it
 * drifting in silently.
 */

import { describe, it, expect } from 'vitest';
import {
  buildModelComparison,
  classifyTempSpread,
  type RawModelComparisonDaily
} from '../../src/utils/modelComparison.js';
import { buildEnsembleSpread, type RawEnsembleDaily } from '../../src/utils/ensembleSpread.js';

/** Two-model comparison fixture: gfs_seamless and ecmwf_ifs025 daily highs `range` degrees apart. */
function twoModelDaily(range: number): RawModelComparisonDaily {
  return {
    time: ['2026-08-18'],
    temperature_2m_max_gfs_seamless: [70],
    temperature_2m_max_ecmwf_ifs025: [70 + range]
  };
}

describe('Model-comparison day spread bands on the rounded printed range (Contract 4)', () => {
  const fahrenheitRanges = [3.5, 4.4, 4.49, 4.51, 7.5, 8.49, 8.51];
  const celsiusRanges = [2.49, 2.51, 4.49, 4.51];

  it('Fahrenheit: the band always equals classifyTempSpread(Math.round(range), F), and equal rounds never disagree', () => {
    const bandByRoundedRange = new Map<number, string>();

    for (const range of fahrenheitRanges) {
      const result = buildModelComparison(twoModelDaily(range), 'F', 'inch');
      const day = result.days[0];
      const rounded = Math.round(range);
      const expected = classifyTempSpread(rounded, 'F');

      expect(day.temperature.band, `range=${range} (rounded ${rounded})`).toBe(expected);

      const seen = bandByRoundedRange.get(rounded);
      if (seen !== undefined) {
        expect(day.temperature.band, `two F ranges rounding to ${rounded} disagreed on band`).toBe(seen);
      } else {
        bandByRoundedRange.set(rounded, day.temperature.band);
      }
    }
  });

  it('Celsius: the band always equals classifyTempSpread(Math.round(range), C), and equal rounds never disagree', () => {
    const bandByRoundedRange = new Map<number, string>();

    for (const range of celsiusRanges) {
      const result = buildModelComparison(twoModelDaily(range), 'C', 'mm');
      const day = result.days[0];
      const rounded = Math.round(range);
      const expected = classifyTempSpread(rounded, 'C');

      expect(day.temperature.band, `range=${range} (rounded ${rounded})`).toBe(expected);

      const seen = bandByRoundedRange.get(rounded);
      if (seen !== undefined) {
        expect(day.temperature.band, `two C ranges rounding to ${rounded} disagreed on band`).toBe(seen);
      } else {
        bandByRoundedRange.set(rounded, day.temperature.band);
      }
    }
  });
});

describe('Ensemble spread confidence is unchanged at one IQR (deliberately deferred site)', () => {
  /**
   * Five perturbed members whose daily-high p25/p75 (numpy-default linear
   * interpolation, see `percentileOf` in ensembleSpread.ts) are exactly
   * 75 and 79.4 -> IQR = 4.4 F. `Math.round(4.4)` is 4 (tight, <= 4), but
   * this site never rounds: 4.4 raw classifies as `moderate` (> 4, <= 8).
   * If a future change rounded this site the way T4 rounded
   * modelComparison.ts, this test would go red on the band, catching the
   * drift.
   */
  function fiveMemberDaily(): RawEnsembleDaily {
    return {
      time: ['2026-08-18'],
      // Sorted ranks (n=5): p25 -> index 1 -> 75; p75 -> index 3 -> 79.4.
      temperature_2m_max_member01: [70],
      temperature_2m_max_member02: [75],
      temperature_2m_max_member03: [77],
      temperature_2m_max_member04: [79.4],
      temperature_2m_max_member05: [90]
    };
  }

  it('keys the band on the raw (unrounded) p75-p25 spread and confidence on that band', () => {
    const result = buildEnsembleSpread(fiveMemberDaily(), 'F', 'inch');
    const day = result.days[0];

    expect(day.temperature.high.p25).toBe(75);
    expect(day.temperature.high.p75).toBe(79.4);
    expect(day.temperature.high.p75 - day.temperature.high.p25).toBeCloseTo(4.4, 10);

    // Pinned today: raw 4.4 F -> 'moderate' (not 'tight', which is what
    // Math.round(4.4) = 4 would classify as).
    expect(day.temperature.band).toBe('moderate');
    // No precipitation members reported this day -> wetFraction 0 -> not in
    // [0.35, 0.65] -> not Low; band isn't 'tight' -> not High -> Moderate.
    expect(day.confidence).toBe('Moderate');
  });
});
