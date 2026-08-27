/**
 * Unit tests locking the "band on the displayed value, not the raw measurement" fix
 * (T1, commit 1a7f9bd) in `src/utils/marine.ts`. Before the fix, `getWaveHeightCategory`
 * banded the raw, unrounded wave height against the eight Douglas thresholds while
 * `formatWaveHeight` prints `meters.toFixed(1)` — so two reports could show the identical
 * printed height (e.g. "1.2m") under different sea-state descriptions. The fix bands on
 * `shown = displayValue(meters, 1)`, the same value the render site prints; the two
 * `getSafetyAssessment` period/height clauses were fixed the same way.
 *
 * These functions are pure and exported directly — no handler, no mocks, no I/O.
 *
 * Model: tests/unit/wildfire-band-rounding.test.ts and
 * tests/unit/lightning-band-rounding.test.ts (structure, sweep/seam/mutation idioms),
 * adapted to call the pure functions directly instead of driving a handler.
 */

import { describe, it, expect } from 'vitest';
import { getWaveHeightCategory, getSafetyAssessment, formatWaveHeight, formatWavePeriod } from '../../src/utils/marine.js';

// ---------------------------------------------------------------------------
// Contract 1 — the displayed value determines the band.
//
// Sweep 0 <= m <= 18 at a 0.005 m step, indexed by division (i / 200, i.e.
// i / (1 / 0.005)) rather than repeated or scaled multiplication (G36):
// different indexing lands on different doubles at exact display-halves,
// which changes which points fall inside the rounding window. A single `it`
// with a loop, not `it.each`, so the sweep does not inflate the published
// test count.
// ---------------------------------------------------------------------------

const SWEEP_STEP_M = 0.005;
const SWEEP_MAX_M = 18;
const SWEEP_DIVISOR = 1 / SWEEP_STEP_M; // 200
const SWEEP_POINTS = Math.round(SWEEP_MAX_M * SWEEP_DIVISOR); // 3600

/** m[i] = i / 200 for i = 0..3600 (3601 points, division-indexed per G36). */
function sweepHeights(): number[] {
  return Array.from({ length: SWEEP_POINTS + 1 }, (_, i) => i / SWEEP_DIVISOR);
}

describe('Marine band rounding — the displayed value determines the band (contract 1)', () => {
  it('no printed wave height across 0-18 m maps to two different sea-state descriptions', () => {
    const seenByPrinted = new Map<string, Set<string>>();
    for (const m of sweepHeights()) {
      const printed = formatWaveHeight(m);
      const description = getWaveHeightCategory(m).description;
      const descriptions = seenByPrinted.get(printed) ?? new Set<string>();
      descriptions.add(description);
      seenByPrinted.set(printed, descriptions);
    }
    for (const [printed, descriptions] of seenByPrinted) {
      expect(descriptions.size, `printed height "${printed}" mapped to descriptions: ${[...descriptions].join(', ')}`).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Contract 2 — no case becomes less cautious than the pre-fix (raw-meters)
// rule. The old rule is reimplemented inline here (not imported), so this
// test fails if raw-meters banding is ever reintroduced under a different
// name.
//
// Per G32: this contract cannot be turned red by reverting to the pre-fix
// implementation (that makes "new" and "old" the same rule, so it holds by
// equality everywhere) — it is caught by contracts 1 and 3 instead.
// ---------------------------------------------------------------------------

const SEA_STATE_ORDER = [
  'Calm (glassy)',
  'Calm (rippled)',
  'Smooth',
  'Slight',
  'Moderate',
  'Rough',
  'Very Rough',
  'High',
  'Very High'
];

function rank(description: string): number {
  const index = SEA_STATE_ORDER.indexOf(description);
  if (index === -1) {
    throw new Error(`Unranked sea-state description: "${description}"`);
  }
  return index;
}

/** The pre-fix rule: the same eight thresholds, banded on raw `meters` directly. */
function oldRawDescription(meters: number): string {
  if (meters < 0.1) return 'Calm (glassy)';
  else if (meters < 0.5) return 'Calm (rippled)';
  else if (meters < 1.25) return 'Smooth';
  else if (meters < 2.5) return 'Slight';
  else if (meters < 4.0) return 'Moderate';
  else if (meters < 6.0) return 'Rough';
  else if (meters < 9.0) return 'Very Rough';
  else if (meters < 14.0) return 'High';
  else return 'Very High';
}

describe('Marine band rounding — no case is less cautious than the old raw-meters rule (contract 2)', () => {
  it('the new (displayed-value) band is never less cautious than the old (raw-value) band, across the same sweep', () => {
    let more = 0;
    let less = 0;
    for (const m of sweepHeights()) {
      const newDescription = getWaveHeightCategory(m).description;
      const oldDescription = oldRawDescription(m);
      const newRank = rank(newDescription);
      const oldRank = rank(oldDescription);
      if (newRank > oldRank) more++;
      else if (newRank < oldRank) less++;
      expect(
        newRank,
        `m=${m}: new description "${newDescription}" (rank ${newRank}) is less cautious than old ` +
          `description "${oldDescription}" (rank ${oldRank})`
      ).toBeGreaterThanOrEqual(oldRank);
    }
    expect(less).toBe(0);
    // Measured at 0.005 m step, division-indexed (i / 200) over 0..18 m
    // (3,601 points): 68 points became more cautious, 0 became less
    // cautious. Re-measure rather than trusting this comment if the sweep
    // parameters change (G22).
    expect(more).toBe(68);
  });
});

// ---------------------------------------------------------------------------
// Contract 3 — seam rows, enumerated. Derived by running both rules in node
// against the same thresholds `getWaveHeightCategory` uses; re-derive rather
// than trusting this table if a threshold ever changes (G36).
// ---------------------------------------------------------------------------

const SEAM_ROWS: Array<[number, string]> = [
  // t = 0.1
  [0.1 - 0.0001, 'Calm (rippled)'], // at/above 0.1
  [0.1 - 0.06, 'Calm (glassy)'], // below 0.1
  // t = 0.5
  [0.5 - 0.0001, 'Smooth'], // at/above 0.5
  [0.5 - 0.06, 'Calm (rippled)'], // below 0.5
  // t = 2.5
  [2.5 - 0.0001, 'Moderate'], // at/above 2.5
  [2.5 - 0.06, 'Slight'], // below 2.5
  // t = 4.0
  [4.0 - 0.0001, 'Rough'], // at/above 4.0
  [4.0 - 0.06, 'Moderate'], // below 4.0
  // t = 6.0
  [6.0 - 0.0001, 'Very Rough'], // at/above 6.0
  [6.0 - 0.06, 'Rough'], // below 6.0
  // t = 9.0
  [9.0 - 0.0001, 'High'], // at/above 9.0
  [9.0 - 0.06, 'Very Rough'], // below 9.0
  // t = 14.0
  [14.0 - 0.0001, 'Very High'], // at/above 14.0
  [14.0 - 0.06, 'High'], // below 14.0
  // Unreachable threshold (1.25) proven unmoved: G13, a "pick" fixture needs
  // at least one non-moving row alongside the moving ones.
  [1.2499, 'Smooth'],
  [1.25, 'Slight'],
  // Exact-half literals at two of the seven thresholds (G36): a naive
  // "shift the threshold by 0.05" mutation (`meters < t - 0.05` in place of
  // `displayValue(meters, 1) < t`) is mathematically identical to the fixed
  // rule almost everywhere, EXCEPT exactly at the literal `t - 0.05` where
  // `toFixed`'s floating-point rounding disagrees with the naive shift for
  // some thresholds and not others — verified in node:
  // `(8.95).toFixed(1) === '8.9'` and `(13.95).toFixed(1) === '13.9'`
  // (round down), so `displayValue(8.95, 1) < 9` is true (stays "Very
  // Rough") while a shifted `8.95 < 9 - 0.05` is false (would fall through
  // to "High"). By contrast `(0.45).toFixed(1) === '0.5'`,
  // `(2.45).toFixed(1) === '2.5'`, `(3.95).toFixed(1) === '4.0'`, and
  // `(5.95).toFixed(1) === '6.0'` (round up) — the naive shift is exactly
  // equivalent there, so those four thresholds cannot distinguish the two
  // rules at any point and are not asserted here (see the mutation-check
  // report for the full seven-threshold sweep that established this).
  [8.95, 'Very Rough'],
  [13.95, 'High']
];

describe('Marine band rounding — seam rows (contract 3)', () => {
  it.each(SEAM_ROWS)('a wave height of %s m bands as %s', (meters, expectedDescription) => {
    expect(getWaveHeightCategory(meters).description).toBe(expectedDescription);
  });
});

// ---------------------------------------------------------------------------
// Contract 4 — the safety-assessment clauses key on the displayed period and
// height, not the raw values. Values verified against the built dist; see
// the plan and CLAUDE.md G36 (toFixed disagrees with decimal intuition on
// exact halves) — do not "correct" these from decimal intuition.
// ---------------------------------------------------------------------------

describe('Marine band rounding — safety clauses key on the displayed period and height (contract 4)', () => {
  it('1.04 m / 5.0 s does not read as choppy (height displays 1.0, not > 1.0)', () => {
    const { description } = getSafetyAssessment(1.04, undefined, undefined, 5.0);
    expect(description).not.toContain('choppy');
  });

  it('1.05 m / 5.94 s reads as choppy (height displays 1.1, period displays 5.9)', () => {
    const { description } = getSafetyAssessment(1.05, undefined, undefined, 5.94);
    expect(description).toContain('choppy');
  });

  it('1.05 m / 5.96 s does not read as choppy (period displays 6.0, not < 6)', () => {
    const { description } = getSafetyAssessment(1.05, undefined, undefined, 5.96);
    expect(description).not.toContain('choppy');
  });

  it('2.05 m / 12.05 s does not read as long-period swell (height displays 2.0, not > 2.0)', () => {
    const { description } = getSafetyAssessment(2.05, undefined, undefined, 12.05);
    expect(description).not.toContain('long-period');
  });

  it('2.06 m / 12.05 s reads as long-period swell (height displays 2.1, period displays 12.1)', () => {
    const { description } = getSafetyAssessment(2.06, undefined, undefined, 12.05);
    expect(description).toContain('long-period');
  });

  // The wind-vs-swell dominance ratio is deliberately out of scope (T1) — it
  // compares two raw values directly, with no display rounding involved.
  // Locked here on one raw pair on each side of the 1.5x cutoff so a future
  // change to this file cannot silently touch it.
  it('wind-vs-swell dominance context is unchanged: windWaveHeight 3x swellHeight reads as wind-dominated', () => {
    const { description } = getSafetyAssessment(0.05, 3.0, 1.0, undefined);
    expect(description).toContain('Conditions dominated by local wind waves.');
  });

  it('wind-vs-swell dominance context is unchanged: equal windWaveHeight/swellHeight reads as mixed', () => {
    const { description } = getSafetyAssessment(0.05, 1.0, 1.0, undefined);
    expect(description).toContain('Mixed wind and swell conditions.');
  });
});

// ---------------------------------------------------------------------------
// Sanity check — formatWavePeriod is exercised indirectly via the seconds
// values above; assert it directly once so the import is not unused-only.
// ---------------------------------------------------------------------------

describe('Marine band rounding — formatWavePeriod sanity', () => {
  it('formats a period to one decimal with a trailing "s"', () => {
    expect(formatWavePeriod(5.94)).toBe('5.9s');
  });
});
