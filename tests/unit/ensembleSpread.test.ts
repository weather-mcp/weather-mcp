/**
 * Tests for the pure single-model ensemble spread module
 * (src/utils/ensembleSpread.ts). Pure, deterministic, no I/O and no mocks —
 * fixtures are built with small generator helpers shaped like the ensemble
 * API's `${variable}_memberNN` response, per docs/ensemble-spread-plan.md D4.
 */

import { describe, it, expect } from 'vitest';
import {
  ENSEMBLE_MODEL,
  ENSEMBLE_MODEL_LABEL,
  ENSEMBLE_MEMBER_COUNT,
  extractMemberSeries,
  computeSpreadStats,
  computePrecipitationSpread,
  computeConditionsSpread,
  computeConfidence,
  buildEnsembleSpread,
  type RawEnsembleDaily
} from '../../src/utils/ensembleSpread.js';

// ---------------------------------------------------------------------------
// Fixture generators
// ---------------------------------------------------------------------------

/** Build a `RawEnsembleDaily` fixture from a flat key map (single/simple cases). */
function daily(time: string[], values: Record<string, (number | null)[]>): RawEnsembleDaily {
  return { time, ...values };
}

type MemberFns = {
  high?: (member: number, day: number) => number | null;
  low?: (member: number, day: number) => number | null;
  precip?: (member: number, day: number) => number | null;
  wind?: (member: number, day: number) => number | null;
  code?: (member: number, day: number) => number | null;
};

type ControlFns = {
  high?: (day: number) => number | null;
  low?: (day: number) => number | null;
  code?: (day: number) => number | null;
};

const VARIABLE_KEY: Record<keyof MemberFns, string> = {
  high: 'temperature_2m_max',
  low: 'temperature_2m_min',
  precip: 'precipitation_sum',
  wind: 'wind_speed_10m_max',
  code: 'weather_code'
};

/**
 * Generator helper: builds a `RawEnsembleDaily` fixture with `memberCount`
 * perturbed members from per-field value functions, plus optional control
 * (unsuffixed) series — used instead of hand-typing large member arrays
 * (design §Testing).
 */
function memberDaily(time: string[], memberCount: number, members: MemberFns, control: ControlFns = {}): RawEnsembleDaily {
  const out: RawEnsembleDaily = { time };
  for (const field of Object.keys(members) as (keyof MemberFns)[]) {
    const fn = members[field]!;
    const variable = VARIABLE_KEY[field];
    for (let n = 1; n <= memberCount; n++) {
      const key = `${variable}_member${String(n).padStart(2, '0')}`;
      out[key] = time.map((_, day) => fn(n, day));
    }
  }
  for (const field of Object.keys(control) as (keyof ControlFns)[]) {
    const fn = control[field]!;
    const variable = VARIABLE_KEY[field];
    out[variable] = time.map((_, day) => fn(day));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('ensemble model constants', () => {
  it('fixes the model to ecmwf_ifs025 with display metadata', () => {
    expect(ENSEMBLE_MODEL).toBe('ecmwf_ifs025');
    expect(ENSEMBLE_MODEL_LABEL).toBe('ECMWF IFS 0.25° ensemble (ENS)');
    expect(ENSEMBLE_MEMBER_COUNT).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// extractMemberSeries
// ---------------------------------------------------------------------------

describe('extractMemberSeries', () => {
  it('collects `${variable}_memberNN` keys zero-padded from member01', () => {
    const d = daily(['d1'], {
      temperature_2m_max_member01: [80],
      temperature_2m_max_member02: [81],
      temperature_2m_max_member03: [82]
    });
    const result = extractMemberSeries(d, 'temperature_2m_max');
    expect(result.series).toEqual([[80], [81], [82]]);
    expect(result.truncated).toBe(false);
  });

  it('returns an empty series when no member keys are present', () => {
    const d = daily(['d1'], {});
    const result = extractMemberSeries(d, 'temperature_2m_max');
    expect(result.series).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('coerces non-finite entries (NaN, Infinity) to null, keeping series length aligned with time', () => {
    const d = daily(['d1', 'd2', 'd3'], { weather_code_member01: [1, NaN, Infinity] });
    const result = extractMemberSeries(d, 'weather_code');
    expect(result.series).toEqual([[1, null, null]]);
  });

  it('parses exactly 64 members without truncation at the ceiling boundary', () => {
    const d = memberDaily(['d1'], 64, { high: n => n });
    const result = extractMemberSeries(d, 'temperature_2m_max');
    expect(result.series).toHaveLength(64);
    expect(result.truncated).toBe(false);
    expect(result.series[0]).toEqual([1]);
    expect(result.series[63]).toEqual([64]);
  });

  it('truncates beyond 64 members and sets the truncated meta flag (no logging — module stays logger-free)', () => {
    const d = memberDaily(['d1'], 70, { high: n => n });
    const result = extractMemberSeries(d, 'temperature_2m_max');
    expect(result.series).toHaveLength(64);
    expect(result.truncated).toBe(true);
    // members 65-70 were present upstream but never parsed into series
    expect(result.series[63]).toEqual([64]);
  });
});

// ---------------------------------------------------------------------------
// computeSpreadStats — percentile method pinned
// ---------------------------------------------------------------------------

describe('computeSpreadStats', () => {
  it('computes min/max/median/p25/p75 for an odd-length set (integer ranks)', () => {
    // sorted [82,84,86]; rank25=0.5 -> interpolate 82..84; rank50=1 -> 84; rank75=1.5 -> interpolate 84..86
    expect(computeSpreadStats([84, 82, 86])).toEqual({ min: 82, max: 86, median: 84, p25: 83, p75: 85, count: 3 });
  });

  it('computes min/max/median/p25/p75 for an even-length set, exercising non-integer-rank interpolation', () => {
    // sorted [82,84,86,88]; rank25=0.75 -> 82+0.75*2=83.5; rank50=1.5 -> 85; rank75=2.25 -> 86+0.25*2=86.5
    expect(computeSpreadStats([88, 84, 82, 86])).toEqual({ min: 82, max: 88, median: 85, p25: 83.5, p75: 86.5, count: 4 });
  });

  it('returns a zeroed, count:0 summary for an empty set', () => {
    expect(computeSpreadStats([])).toEqual({ min: 0, max: 0, median: 0, p25: 0, p75: 0, count: 0 });
  });
});

// ---------------------------------------------------------------------------
// computePrecipitationSpread — threshold edges, wet-only amount range
// ---------------------------------------------------------------------------

describe('computePrecipitationSpread', () => {
  it('counts exactly 0.01 in as wet (imperial threshold, boundary inclusive)', () => {
    const result = computePrecipitationSpread([0.01, 0.0099, 0.02, 0, 0.01], 'inch');
    expect(result.wetCount).toBe(3);
    expect(result.participantCount).toBe(5);
    expect(result.fraction).toBe(0.6);
    // wet-only amount range: min must be 0.01, never 0 from the dry members
    expect(result.amounts).toEqual({ min: 0.01, max: 0.02, median: 0.01, p25: 0.01, p75: 0.015, count: 3 });
  });

  it('counts exactly 0.25 mm as wet (metric threshold, boundary inclusive)', () => {
    const result = computePrecipitationSpread([0.25, 0.24, 0.26, 0, 0.25], 'mm');
    expect(result.wetCount).toBe(3);
    expect(result.fraction).toBe(0.6);
    expect(result.amounts.min).toBe(0.25);
    expect(result.amounts.max).toBe(0.26);
  });

  it('never pins the amount-range minimum to 0.00 from dry members (compare_models gotcha, inherited deliberately)', () => {
    const result = computePrecipitationSpread([0, 0, 0, 0, 0.4], 'inch');
    expect(result.wetCount).toBe(1);
    expect(result.amounts).toEqual({ min: 0.4, max: 0.4, median: 0.4, p25: 0.4, p75: 0.4, count: 1 });
  });

  it('returns a zeroed fraction/amounts for zero participants', () => {
    const result = computePrecipitationSpread([], 'inch');
    expect(result).toEqual({ wetCount: 0, participantCount: 0, fraction: 0, amounts: { min: 0, max: 0, median: 0, p25: 0, p75: 0, count: 0 } });
  });
});

// ---------------------------------------------------------------------------
// computeConditionsSpread — modal bucket + runner-up >= 25% rule
// ---------------------------------------------------------------------------

describe('computeConditionsSpread', () => {
  it('names a runner-up bucket at exactly 25% of participants (boundary inclusive)', () => {
    // 5 clear (code 0), 2 rain (code 61, 2/8=0.25), 1 cloudy (code 3, 1/8=0.125)
    const codes = [0, 0, 0, 0, 0, 61, 61, 3];
    const result = computeConditionsSpread(codes);
    expect(result.bucket).toBe('clear');
    expect(result.count).toBe(5);
    expect(result.participantCount).toBe(8);
    expect(result.percentage).toBe(62.5);
    expect(result.runnerUp).toEqual({ bucket: 'rain', count: 2, percentage: 25 });
  });

  it('does not name a runner-up bucket just below 25%', () => {
    // 7 clear (code 0), 2 rain (code 61, 2/9 ~= 22.2%)
    const codes = [0, 0, 0, 0, 0, 0, 0, 61, 61];
    const result = computeConditionsSpread(codes);
    expect(result.bucket).toBe('clear');
    expect(result.runnerUp).toBeUndefined();
  });

  it('returns a zeroed conditions summary for zero participants', () => {
    const result = computeConditionsSpread([]);
    expect(result.count).toBe(0);
    expect(result.participantCount).toBe(0);
    expect(result.percentage).toBe(0);
    expect(result.runnerUp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeConfidence — boundaries at 0.2 / 0.35 / 0.65 / 0.8
// ---------------------------------------------------------------------------

describe('computeConfidence', () => {
  it('is High for a tight band at the 0.2 fraction boundary (inclusive)', () => {
    expect(computeConfidence('tight', 0.2)).toBe('High');
  });
  it('is Moderate for a tight band just above 0.2', () => {
    expect(computeConfidence('tight', 0.2001)).toBe('Moderate');
  });
  it('is Low for a tight band at the 0.35 fraction boundary (inclusive)', () => {
    expect(computeConfidence('tight', 0.35)).toBe('Low');
  });
  it('is Low for a tight band at the 0.65 fraction boundary (inclusive)', () => {
    expect(computeConfidence('tight', 0.65)).toBe('Low');
  });
  it('is Moderate for a tight band just above 0.65', () => {
    expect(computeConfidence('tight', 0.6501)).toBe('Moderate');
  });
  it('is High for a tight band at the 0.8 fraction boundary (inclusive)', () => {
    expect(computeConfidence('tight', 0.8)).toBe('High');
  });
  it('is Moderate for a tight band just below 0.8', () => {
    expect(computeConfidence('tight', 0.7999)).toBe('Moderate');
  });
  it('is Low for a divergent band regardless of fraction', () => {
    expect(computeConfidence('divergent', 0)).toBe('Low');
    expect(computeConfidence('divergent', 1)).toBe('Low');
  });
  it('is Low for a moderate band with a mid-range split fraction', () => {
    expect(computeConfidence('moderate', 0.5)).toBe('Low');
  });
  it('is Moderate for a moderate band outside the split range', () => {
    expect(computeConfidence('moderate', 0.1)).toBe('Moderate');
  });
});

// ---------------------------------------------------------------------------
// buildEnsembleSpread — integration behaviors
// ---------------------------------------------------------------------------

describe('buildEnsembleSpread', () => {
  it('classifies the temperature band on the p25-p75 range, not min-max — proven by a fixture with outlier members', () => {
    // 6 members: [80,81,82,83,84,150]. min-max range = 70 (divergent); p25-p75 = 2.5 (tight).
    const d = memberDaily(['2026-08-18'], 6, { high: n => (n <= 5 ? 79 + n : 150) });
    const result = buildEnsembleSpread(d, 'F', 'inch');
    const temp = result.days[0].temperature;
    expect(temp.high.min).toBe(80);
    expect(temp.high.max).toBe(150);
    expect(temp.high.p25).toBe(81.25);
    expect(temp.high.p75).toBe(83.75);
    expect(temp.band).toBe('tight');
  });

  it('classifies the temperature band on the p25-p75 range with Celsius scaling', () => {
    // Same shape, scaled: tightThreshold 2.2C. p25-p75 = 2.5 in the F fixture's units;
    // here the members are in "C" directly with a small IQR that stays tight at 2.2C.
    const d = memberDaily(['2026-08-18'], 6, { high: n => (n <= 5 ? 26 + n * 0.4 : 60) });
    const result = buildEnsembleSpread(d, 'C', 'mm');
    const temp = result.days[0].temperature;
    expect(temp.high.max).toBe(60); // outlier present
    expect(temp.band).toBe('tight'); // IQR excludes the outlier
  });

  it('excludes the control run from every statistic, fraction, and band decision', () => {
    const d = memberDaily(
      ['2026-08-18'],
      5,
      { high: n => 79 + n }, // 80,81,82,83,84
      { high: () => 9999 } // wild outlier control
    );
    const result = buildEnsembleSpread(d, 'F', 'inch');
    const day = result.days[0];

    expect(day.control).toEqual({ high: 9999, low: null, code: null });
    expect(day.temperature.high.min).toBe(80);
    expect(day.temperature.high.max).toBe(84);
    expect(day.temperature.high.median).toBe(82);
    expect(day.temperature.high.p25).toBe(81);
    expect(day.temperature.high.p75).toBe(83);
    expect(day.temperature.band).toBe('tight');
  });

  it('omits the control entry (control: null) when the control run is null for a day', () => {
    const d = memberDaily(
      ['2026-08-18'],
      3,
      { high: n => 79 + n },
      { high: () => null }
    );
    const result = buildEnsembleSpread(d, 'F', 'inch');
    expect(result.days[0].control).toBeNull();
    // stats still compute normally from the members
    expect(result.days[0].temperature.high.count).toBe(3);
  });

  it('trims trailing days below 2 participants but retains an interior gap day', () => {
    // Built directly (per-member arrays are ragged) mirroring modelComparison's trim fixture.
    const raw: RawEnsembleDaily = {
      time: ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'],
      temperature_2m_max_member01: [80, 75, 80, 80, null],
      temperature_2m_max_member02: [82, null, 82, null, null],
      temperature_2m_max_member03: [81, null, 81, null, null],
      temperature_2m_max_member04: [79, null, 79, null, null],
      temperature_2m_max_member05: [83, null, 83, null, null]
    };

    const result = buildEnsembleSpread(raw, 'F', 'inch');

    expect(result.trimmedDays).toBe(2);
    expect(result.days).toHaveLength(3);
    expect(result.days[0].participantCount).toBe(5);
    expect(result.days[1].date).toBe('2026-08-19');
    expect(result.days[1].participantCount).toBe(1);
    expect(result.days[2].participantCount).toBe(5);
  });

  it('treats a fixture with only 1 member as all-trimmed (fewer than 2 participants every day)', () => {
    const raw: RawEnsembleDaily = {
      time: ['2026-08-18', '2026-08-19'],
      temperature_2m_max_member01: [80, 81]
    };
    const result = buildEnsembleSpread(raw, 'F', 'inch');
    expect(result.memberCount).toBe(1);
    expect(result.trimmedDays).toBe(2);
    expect(result.days).toHaveLength(0);
  });

  it('truncates member series past the 64-member ceiling and reports it in truncatedMembers, not via logging', () => {
    const d = memberDaily(['2026-08-18'], 70, { high: n => 80 + (n % 5) });
    const result = buildEnsembleSpread(d, 'F', 'inch');
    expect(result.memberCount).toBe(64);
    expect(result.truncatedMembers).toBe(true);
    expect(result.days[0].participantCount).toBe(64);
  });

  it('assembles a full day (temperature, precipitation, wind, conditions, confidence) from a 50-member generated fixture', () => {
    const d = memberDaily(['2026-08-18'], 50, {
      high: n => 82 + ((n - 1) % 5) - 2, // 80..84 cycling, tight spread
      low: n => 62 + ((n - 1) % 5) - 2,
      precip: n => (n <= 4 ? 0.02 + n * 0.01 : 0), // 4 of 50 members wet
      wind: n => 8 + (n % 6),
      code: n => (n <= 13 ? 61 : 1) // 13 of 50 -> rain (26%), rest clear
    });

    const result = buildEnsembleSpread(d, 'F', 'inch');
    expect(result.memberCount).toBe(50);
    expect(result.truncatedMembers).toBe(false);

    const day = result.days[0];
    expect(day.participantCount).toBe(50);
    expect(day.temperature.high.min).toBe(80);
    expect(day.temperature.high.max).toBe(84);
    expect(day.temperature.band).toBe('tight');

    expect(day.precipitation.wetCount).toBe(4);
    expect(day.precipitation.participantCount).toBe(50);
    expect(day.precipitation.fraction).toBe(0.08);
    expect(day.precipitation.amounts.min).toBe(0.03);
    expect(day.precipitation.amounts.max).toBe(0.06);

    expect(day.wind.max.count).toBe(50);

    expect(day.conditions.bucket).toBe('clear');
    expect(day.conditions.count).toBe(37);
    expect(day.conditions.runnerUp).toEqual({ bucket: 'rain', count: 13, percentage: 26 });

    // Tight band + fraction 0.08 (<= 0.2) -> High confidence.
    expect(day.confidence).toBe('High');
  });
});
