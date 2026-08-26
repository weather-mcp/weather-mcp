/**
 * Unit tests locking the "band on the displayed value, not the raw measurement" fix (issue #80)
 * in `assessSafety` (`src/handlers/lightningHandler.ts`). Before the fix, the safety verdict was
 * banded on the raw, unrounded nearest-strike distance while every rendered sentence prints that
 * distance rounded to one decimal (`.toFixed(1)`) — so two reports could show the identical
 * printed distance (e.g. "8.0 km") under different verdicts. The fix bands on
 * `shownDistance = displayValue(nearestDistance, 1)`, the same value the render sites print.
 *
 * These tests drive `getLightningActivity` end-to-end (mocked upstream, per the setup idiom in
 * `lightning-safe-message.test.ts`) and read the rendered text, the same way the underlying bug
 * would actually surface to a user.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { getLightningActivity, formatLightningActivityResponse } from '../../src/handlers/lightningHandler.js';
import { LightningStrike } from '../../src/types/lightning.js';
import * as blitzortungModule from '../../src/services/blitzortung.js';

vi.mock('../../src/services/blitzortung.js', () => ({
  blitzortungService: {
    getLightningStrikes: vi.fn(),
    getCoverageStart: vi.fn()
  }
}));

const LAT = 51.5074;
const LON = -0.1278;

/** A single strike at a given distance, with otherwise realistic field values. */
function makeStrike(distance: number, overrides: Partial<LightningStrike> = {}): LightningStrike {
  return {
    timestamp: new Date(Date.now() - 20 * 60 * 1000),
    latitude: LAT + 0.1,
    longitude: LON,
    polarity: -1,
    amplitude: 30,
    distance,
    ...overrides
  };
}

/**
 * Coverage start well before any window up to 120 minutes: `isComplete === true`. Every drive in
 * this file uses complete coverage — G13: a partial-coverage fixture would render the
 * `(LIMITED DATA)` path and its extra ⚠️ block, which would confound the band assertions this
 * file exists to make (a second "X km" figure appearing in the safety section ahead of the
 * message's own figure).
 */
function completeCoverageStart(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

describe('Lightning band rounding (issue #80 lock)', () => {
  let mockGetLightningStrikes: Mock;
  let mockGetCoverageStart: Mock;

  beforeEach(() => {
    mockGetLightningStrikes = blitzortungModule.blitzortungService.getLightningStrikes as Mock;
    mockGetLightningStrikes.mockReset();
    mockGetCoverageStart = blitzortungModule.blitzortungService.getCoverageStart as Mock;
    mockGetCoverageStart.mockReset();
  });

  /**
   * Drive a single-strike report at `distance` km, complete coverage, and return both the
   * computed verdict and the distance figure actually printed in the `**Nearest Strike:**` line
   * — the stable anchor line (unlike the safety message, its wording does not change per band).
   */
  async function driveAt(distance: number): Promise<{ level: string; printedNearest: string }> {
    mockGetLightningStrikes.mockResolvedValue([makeStrike(distance)]);
    mockGetCoverageStart.mockReturnValue(completeCoverageStart());

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    const formatted = formatLightningActivityResponse(result);

    const nearestMatch = formatted.match(/\*\*Nearest Strike:\*\* ([\d.]+) km away/);
    if (!nearestMatch) {
      throw new Error(`No "**Nearest Strike:**" line rendered for distance ${distance} km`);
    }

    return { level: result.safety.level, printedNearest: nearestMatch[1] };
  }

  // 0.01 km steps over 0-60 km: 6,001 points. Measured at ~0.01 km: well under the ~1s budget
  // (mocked upstream, no network, no logging noise beyond the handler's own logger.info per
  // call) — kept at 0.01 rather than coarsened to 0.05.
  const SWEEP_STEP_KM = 0.01;
  const SWEEP_MAX_KM = 60;
  const SWEEP_POINTS = Math.round(SWEEP_MAX_KM / SWEEP_STEP_KM);

  /** Integer-indexed to avoid floating-point drift from repeatedly adding 0.01. */
  function sweepDistances(): number[] {
    return Array.from({ length: SWEEP_POINTS + 1 }, (_, i) => i * SWEEP_STEP_KM);
  }

  it('the printed nearest-strike distance never maps to two different verdicts across 0-60 km', async () => {
    const seenByPrinted = new Map<string, Set<string>>();

    for (const distance of sweepDistances()) {
      const { level, printedNearest } = await driveAt(distance);
      const levels = seenByPrinted.get(printedNearest) ?? new Set<string>();
      levels.add(level);
      seenByPrinted.set(printedNearest, levels);
    }

    for (const [printed, levels] of seenByPrinted) {
      expect(levels.size, `printed distance "${printed} km" mapped to verdicts: ${[...levels].join(', ')}`).toBe(1);
    }
  });

  it('the new banding is never less cautious than the old raw-distance banding, across the same sweep', async () => {
    const severity: Record<string, number> = { safe: 0, elevated: 1, high: 2, extreme: 3 };

    // The pre-fix rule, reimplemented here (not imported) so this test fails if anyone
    // reintroduces raw-distance banding under a different name.
    function oldRawLevel(raw: number): string {
      if (raw > 50) return 'safe';
      if (raw > 16) return 'elevated';
      if (raw > 8) return 'high';
      return 'extreme';
    }

    for (const distance of sweepDistances()) {
      const { level } = await driveAt(distance);
      const old = oldRawLevel(distance);
      expect(
        severity[level],
        `distance ${distance} km: new verdict "${level}" (severity ${severity[level]}) is less ` +
          `cautious than old verdict "${old}" (severity ${severity[old]})`
      ).toBeGreaterThanOrEqual(severity[old]);
    }
  });

  // The seam rows: the values whose band moves once rounding is applied. Small on purpose (~12
  // rows) — this is what lightning-safe-message.test.ts's raw-distance table does not cover.
  it.each([
    [8.02, 'extreme'],
    [8.04995, 'extreme'],
    [8.05, 'high'],
    [8.06, 'high'],
    [16.02, 'high'],
    [16.05, 'elevated'],
    [49.99, 'elevated'],
    [50.02, 'elevated'],
    [50.05, 'elevated'],
    [50.06, 'safe'],
    [50.1, 'safe'],
    [0, 'extreme']
  ])('bands a nearest strike at %s km as %s (post-rounding seam)', async (distance, expectedLevel) => {
    const { level } = await driveAt(distance as number);
    expect(level).toBe(expectedLevel);
  });

  it('the safety message, the **Nearest Strike:** line, and the first strike\'s **Distance:** line all report the identical rounded figure', async () => {
    // 50.02 km rounds to 50.0, which is inside the `elevated` band (50.0 is not > 50) — a seam
    // window where a banding-on-raw implementation would still print "50.0" while disagreeing
    // about the verdict, but where all three *render sites* must still agree on the figure.
    mockGetLightningStrikes.mockResolvedValue([makeStrike(50.02)]);
    mockGetCoverageStart.mockReturnValue(completeCoverageStart());

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    const formatted = formatLightningActivityResponse(result);

    // Isolate the safety section (heading + message [+ recommendations]) from both the header
    // block above it (which has its own "100 km" search-radius figure) and the statistics
    // section below it, so the first "X km" match is unambiguously the message's own figure —
    // the message wording differs per band ("Nearest lightning X km away" vs "Lightning detected
    // X km away." etc.), so match on the figure itself rather than one fixed template.
    const safetyHeadingIndex = formatted.indexOf('Safety Status:');
    const statsHeadingIndex = formatted.indexOf('## \u{1F4CA} Lightning Statistics');
    expect(safetyHeadingIndex).toBeGreaterThan(-1);
    expect(statsHeadingIndex).toBeGreaterThan(safetyHeadingIndex);
    const safetySection = formatted.slice(safetyHeadingIndex, statsHeadingIndex);

    const messageMatch = safetySection.match(/([\d.]+) km/);
    const nearestMatch = formatted.match(/\*\*Nearest Strike:\*\* ([\d.]+) km away/);
    const distanceMatch = formatted.match(/- \*\*Distance:\*\* ([\d.]+) km/);

    expect(messageMatch).not.toBeNull();
    expect(nearestMatch).not.toBeNull();
    expect(distanceMatch).not.toBeNull();

    expect(messageMatch![1]).toBe('50.0');
    expect(nearestMatch![1]).toBe(messageMatch![1]);
    expect(distanceMatch![1]).toBe(messageMatch![1]);
  });

  it('the extreme message for a near strike contains no "undefined" (the `?.` removal lock)', async () => {
    mockGetLightningStrikes.mockResolvedValue([makeStrike(7.5)]);
    mockGetCoverageStart.mockReturnValue(completeCoverageStart());

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(result.safety.level).toBe('extreme');

    const formatted = formatLightningActivityResponse(result);
    expect(formatted).not.toContain('undefined');
  });
});
