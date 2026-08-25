/**
 * Unit tests locking the "safe means far, not none" coherence fixes (T1-T3) in
 * src/handlers/lightningHandler.ts.
 *
 * `safety.level === 'safe'` means the nearest strike is beyond the 50 km threshold — it does
 * NOT mean no strikes were found. Before T1-T3 the report could render a green SAFE all-clear
 * ("no significant lightning activity") directly above a strike list, and a strike at exactly
 * 0 km was silently treated as "no strikes" by `|| null` coercion. These tests drive
 * getLightningActivity end-to-end (mocked upstream) and render with
 * formatLightningActivityResponse, so a regression in either function is caught the same way
 * the bug shipped: by reading the rendered text, not by asserting fields in isolation.
 *
 * Four states recur throughout:
 *   A = empty strikes + partial coverage       C = strikes present + complete coverage
 *   B = strikes present + partial coverage     D = empty strikes + complete coverage
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

const LAT = 40.7128;
const LON = -74.006;

/** A single strike at a given distance, with otherwise realistic field values. */
function makeStrike(distance: number, overrides: Partial<LightningStrike> = {}): LightningStrike {
  return {
    timestamp: new Date(Date.now() - 5 * 60 * 1000),
    latitude: 40.8,
    longitude: -74.0,
    polarity: -1,
    amplitude: 30,
    distance,
    ...overrides
  };
}

/**
 * 20 strikes, distinct distances, nearest (index 0) at 203.2 km — comfortably past the 50 km
 * `safe` threshold. Not a single-strike or uniform-distance fixture: it holds all three
 * conditions state B/C need at once (strikes present, nearest far enough to band `safe`, and a
 * non-trivial count), which is exactly what let the original bug slip past thinner fixtures.
 */
function buildFarStrikes(count = 20): LightningStrike[] {
  return Array.from({ length: count }, (_, i) => makeStrike(203.2 + i * 5));
}

/** Coverage start well inside the 60-minute window: isComplete === false. */
function partialCoverageStart(): Date {
  return new Date(Date.now() - 5.2 * 60 * 1000);
}

/** Coverage start well before any window up to 120 minutes: isComplete === true. */
function completeCoverageStart(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

describe('Lightning safe-message coherence (T1-T3 lock)', () => {
  let mockGetLightningStrikes: Mock;
  let mockGetCoverageStart: Mock;

  beforeEach(() => {
    mockGetLightningStrikes = blitzortungModule.blitzortungService.getLightningStrikes as Mock;
    mockGetLightningStrikes.mockReset();
    mockGetCoverageStart = blitzortungModule.blitzortungService.getCoverageStart as Mock;
    mockGetCoverageStart.mockReset();
  });

  it('state B (strikes + partial coverage, nearest > 50 km): message names the distance, no false all-clear, and strikes are actually listed', async () => {
    mockGetLightningStrikes.mockResolvedValue(buildFarStrikes());
    mockGetCoverageStart.mockReturnValue(partialCoverageStart());

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(result.safety.level).toBe('safe');
    expect(result.coverage.isComplete).toBe(false);

    const formatted = formatLightningActivityResponse(result);

    expect(formatted).toContain('Nearest lightning 203.2 km away');
    expect(formatted).not.toContain('No lightning strikes observed');
    expect(formatted).not.toContain('No significant lightning');

    const totalMatch = formatted.match(/\*\*Total Strikes:\*\* (\d+)/);
    expect(totalMatch).not.toBeNull();
    expect(Number(totalMatch![1])).toBeGreaterThan(0);
  });

  it('state C (strikes + complete coverage, nearest > 50 km): message names the distance, no false all-clear, and strikes are actually listed', async () => {
    mockGetLightningStrikes.mockResolvedValue(buildFarStrikes());
    mockGetCoverageStart.mockReturnValue(completeCoverageStart());

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(result.safety.level).toBe('safe');
    expect(result.coverage.isComplete).toBe(true);

    const formatted = formatLightningActivityResponse(result);

    expect(formatted).toContain('Nearest lightning 203.2 km away');
    expect(formatted).not.toContain('No lightning strikes observed');
    expect(formatted).not.toContain('No significant lightning');

    const totalMatch = formatted.match(/\*\*Total Strikes:\*\* (\d+)/);
    expect(totalMatch).not.toBeNull();
    expect(Number(totalMatch![1])).toBeGreaterThan(0);
  });

  it('state A (empty strikes + partial coverage): message and ⚠️ block both stay honestly inconclusive', async () => {
    mockGetLightningStrikes.mockResolvedValue([]);
    mockGetCoverageStart.mockReturnValue(partialCoverageStart());

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(result.safety.level).toBe('safe');
    expect(result.coverage.isComplete).toBe(false);
    expect(result.safety.message).toContain('does NOT confirm');

    const formatted = formatLightningActivityResponse(result);
    expect(formatted).toContain(
      'An absence of strikes in this report does not confirm an absence of lightning'
    );
  });

  it('state D (empty strikes + complete coverage): plain all-clear message, no ⚠️ block at all', async () => {
    mockGetLightningStrikes.mockResolvedValue([]);
    mockGetCoverageStart.mockReturnValue(completeCoverageStart());

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(result.safety.level).toBe('safe');
    expect(result.coverage.isComplete).toBe(true);
    expect(result.safety.message).toBe('No significant lightning activity detected in the area.');

    const formatted = formatLightningActivityResponse(result);
    expect(formatted).not.toContain('Limited monitoring coverage');
    expect(formatted).not.toContain('⚠️ **Limited monitoring coverage');
  });

  it('the coverage recommendation spans both strike states inside `safe`, and stays out of `extreme`', async () => {
    // State A: empty + partial → inconclusive recommendation present.
    mockGetLightningStrikes.mockResolvedValue([]);
    mockGetCoverageStart.mockReturnValue(partialCoverageStart());
    const stateA = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(stateA.safety.level).toBe('safe');
    expect(stateA.safety.recommendations.some(r => r.includes('inconclusive'))).toBe(true);

    // State B: strikes present + partial → inconclusive recommendation still present.
    mockGetLightningStrikes.mockResolvedValue(buildFarStrikes());
    mockGetCoverageStart.mockReturnValue(partialCoverageStart());
    const stateB = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(stateB.safety.level).toBe('safe');
    expect(stateB.safety.recommendations.some(r => r.includes('inconclusive'))).toBe(true);

    // Extreme + partial coverage: the unshift must stay inside the `safe` gate — no
    // "inconclusive" recommendation may appear above an EXTREME DANGER warning.
    mockGetLightningStrikes.mockResolvedValue([makeStrike(5)]);
    mockGetCoverageStart.mockReturnValue(partialCoverageStart());
    const stateExtreme = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(stateExtreme.safety.level).toBe('extreme');
    expect(stateExtreme.coverage.isComplete).toBe(false);
    expect(stateExtreme.safety.recommendations.every(r => !r.includes('inconclusive'))).toBe(true);
    expect(stateExtreme.safety.recommendations.some(r => r.includes('⚠️ TAKE IMMEDIATE SHELTER'))).toBe(true);
  });

  it('the ⚠️ floor sentence appears only in state B, and neither floor nor absence sentence appears under complete coverage', async () => {
    // State B: strikes + partial → floor sentence.
    mockGetLightningStrikes.mockResolvedValue(buildFarStrikes());
    mockGetCoverageStart.mockReturnValue(partialCoverageStart());
    const stateB = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    const formattedB = formatLightningActivityResponse(stateB);
    expect(formattedB).toContain(
      'The nearest-strike distance below is therefore a floor'
    );

    // State A: empty + partial → floor sentence absent (absence sentence used instead).
    mockGetLightningStrikes.mockResolvedValue([]);
    mockGetCoverageStart.mockReturnValue(partialCoverageStart());
    const stateA = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    const formattedA = formatLightningActivityResponse(stateA);
    expect(formattedA).not.toContain('The nearest-strike distance below is therefore a floor');

    // State C: strikes + complete coverage → no ⚠️ block, so neither sentence appears.
    mockGetLightningStrikes.mockResolvedValue(buildFarStrikes());
    mockGetCoverageStart.mockReturnValue(completeCoverageStart());
    const stateC = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    const formattedC = formatLightningActivityResponse(stateC);
    expect(formattedC).not.toContain('The nearest-strike distance below is therefore a floor');
    expect(formattedC).not.toContain(
      'An absence of strikes in this report does not confirm an absence of lightning'
    );

    // State D: empty + complete coverage → no ⚠️ block, so neither sentence appears.
    mockGetLightningStrikes.mockResolvedValue([]);
    mockGetCoverageStart.mockReturnValue(completeCoverageStart());
    const stateD = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    const formattedD = formatLightningActivityResponse(stateD);
    expect(formattedD).not.toContain('The nearest-strike distance below is therefore a floor');
    expect(formattedD).not.toContain(
      'An absence of strikes in this report does not confirm an absence of lightning'
    );
  });

  describe('nearest-strike distance seam (T1 lock: `??` not `||`)', () => {
    it.each([
      [0, 'extreme'],
      [0.0001, 'extreme'],
      [7.9, 'extreme'],
      [8, 'extreme'],
      [8.1, 'high'],
      [15.9, 'high'],
      [16, 'high'],
      [16.1, 'elevated'],
      [49.9, 'elevated'],
      [50, 'elevated'],
      [50.1, 'safe'],
      [203.2, 'safe']
    ])('bands a nearest strike at %s km as %s', async (distance, expectedLevel) => {
      mockGetLightningStrikes.mockResolvedValue([makeStrike(distance as number)]);
      mockGetCoverageStart.mockReturnValue(completeCoverageStart());

      const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });

      expect(result.safety.level).toBe(expectedLevel);
    });
  });
});
