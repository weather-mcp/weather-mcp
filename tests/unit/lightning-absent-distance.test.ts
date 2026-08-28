/**
 * Unit tests locking the absent-strike-distance fix (issue #83) in
 * src/handlers/lightningHandler.ts.
 *
 * `LightningStrike.distance` is optional but its only producer (`filterStrikes` in
 * `services/blitzortung.ts`) always sets it, so a distance-less strike can only reach the
 * handler through a mock or a future second producer. Before the fix, `strikes[0]?.distance || 0`
 * turned an unknown nearest distance into a printed `0.0 km` (a false "overhead" reading), the
 * average distance divided a strike's missing contribution by the full strike count (dragging the
 * mean toward zero), and the per-strike row interpolated the literal string `undefined` into a
 * unit string. These tests drive `getLightningActivity` end-to-end (mocked upstream) and read the
 * rendered text via `formatLightningActivityResponse`, the way the bug would actually surface —
 * not by asserting fields in isolation.
 *
 * Modeled on tests/unit/lightning-safe-message.test.ts (same mock shape, same `makeStrike` /
 * `completeCoverageStart` helpers, copied in rather than imported so that lock file stays
 * untouched).
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { getLightningActivity, formatLightningActivityResponse } from '../../src/handlers/lightningHandler.js';
import { LightningStrike } from '../../src/types/lightning.js';
import * as blitzortungModule from '../../src/services/blitzortung.js';

vi.mock('../../src/services/blitzortung.js', () => ({
  blitzortungService: {
    getLightningStrikes: vi.fn(),
    getCoverageStart: vi.fn(),
    getFeedFailure: vi.fn(() => null)
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

/** A strike whose distance is unknown — the state this whole file is about. */
function makeDistanceless(overrides: Partial<LightningStrike> = {}): LightningStrike {
  return { ...makeStrike(1, overrides), distance: undefined } as LightningStrike;
}

/** Coverage start well before any window up to 120 minutes: isComplete === true. Used
 *  throughout so the ⚠️ limited-coverage block never appears and cannot interfere with the
 *  absence/distance assertions this file is about. */
function completeCoverageStart(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

describe('Lightning absent-strike-distance contracts (issue #83 lock)', () => {
  let mockGetLightningStrikes: Mock;
  let mockGetCoverageStart: Mock;

  beforeEach(() => {
    mockGetLightningStrikes = blitzortungModule.blitzortungService.getLightningStrikes as Mock;
    mockGetLightningStrikes.mockReset();
    mockGetCoverageStart = blitzortungModule.blitzortungService.getCoverageStart as Mock;
    mockGetCoverageStart.mockReset();
    mockGetCoverageStart.mockReturnValue(completeCoverageStart());
  });

  // Contract 1. Swept across every detail level, including `summary` — the branch
  // `get_weather_summary` renders by default (G19) — because the statistics lines and the
  // per-strike list both sit outside any `detail` gate (only the list's cap changes).
  it.each(['summary', 'standard', 'full'] as const)(
    'a single distance-less strike renders "unavailable" everywhere, never 0.0 km or undefined, at detail=%s',
    async detail => {
      mockGetLightningStrikes.mockResolvedValue([makeDistanceless()]);

      const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
      expect(result.statistics.totalStrikes).toBe(1);
      expect(result.statistics.nearestDistance).toBeNull();
      expect(result.safety.nearestStrikeDistance).toBeNull();

      const formatted = formatLightningActivityResponse(result, detail);

      expect(formatted).toContain('**Nearest Strike:** distance unavailable');
      expect(formatted).toContain('**Average Distance:** unavailable');
      expect(formatted).toContain('- **Distance:** unavailable');
      expect(formatted).not.toContain('0.0 km');
      expect(formatted).not.toContain('undefined');
      expect(formatted).not.toMatch(/\*\*Nearest Strike:\*\* [\d.]+ km/);
    }
  );

  // Contract 2. The statistics reading and the safety reading of "is there a nearest distance"
  // must never disagree about the same report, across every strike-presence shape — except the
  // documented empty-strikes exception (calculateStatistics's early return is 0, assessSafety's
  // is null; unreachable through the totalStrikes > 0 render gate).
  describe('the absence claim and the distance reading agree', () => {
    it.each([
      ['one distance-less strike', [makeDistanceless()]],
      ['mixed, distance-less first', [makeDistanceless(), makeStrike(10), makeStrike(30)]],
      ['single located strike', [makeStrike(5)]],
      ['single overhead strike', [makeStrike(0)]]
    ] as const)('%s', async (_label, strikes) => {
      mockGetLightningStrikes.mockResolvedValue(strikes as LightningStrike[]);

      const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
      expect(result.statistics.nearestDistance === null).toBe(result.safety.nearestStrikeDistance === null);

      const formatted = formatLightningActivityResponse(result);
      if (/\*\*Nearest Strike:\*\* [\d.]+ km/.test(formatted)) {
        expect(result.safety.message).not.toBe('No significant lightning activity detected in the area.');
      }
    });

    it('the empty-strikes exception: statistics reads 0, safety reads null, and no Nearest Strike line renders at all', async () => {
      mockGetLightningStrikes.mockResolvedValue([]);

      const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
      expect(result.statistics.nearestDistance).toBe(0);
      expect(result.safety.nearestStrikeDistance).toBeNull();

      const formatted = formatLightningActivityResponse(result);
      expect(formatted).not.toContain('**Nearest Strike:**');
    });
  });

  // Contract 3. The control pair beside contract 1 (G13): 0.0 km must still mean overhead, not
  // "unavailable read as zero".
  it('0.0 km means a strike overhead, and carries no "unavailable"', async () => {
    mockGetLightningStrikes.mockResolvedValue([makeStrike(0)]);

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(result.safety.level).toBe('extreme');

    const formatted = formatLightningActivityResponse(result);
    expect(formatted).toContain('**Nearest Strike:** 0.0 km away');
    expect(formatted).toContain('- **Distance:** 0.0 km');
    expect(formatted).not.toContain('unavailable');
  });

  // Contract 4. The discriminating G13 case: the mean must be computed over strikes that carry a
  // distance only, not over every strike with a missing one counted as 0.
  it('the average distance is the mean over located strikes only, excluding a distance-less one from both sides', async () => {
    mockGetLightningStrikes.mockResolvedValue([makeDistanceless(), makeStrike(10), makeStrike(30)]);

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(result.statistics.averageDistance).toBe(20);
    expect(result.statistics.nearestDistance).toBeNull();

    const formatted = formatLightningActivityResponse(result);
    expect(formatted).toContain('**Average Distance:** 20.0 km');
    expect(formatted).toContain('**Nearest Strike:** distance unavailable');

    const unavailableRows = formatted.match(/- \*\*Distance:\*\* unavailable/g) ?? [];
    const numericRows = formatted.match(/- \*\*Distance:\*\* [\d.]+ km/g) ?? [];
    expect(unavailableRows.length).toBe(1);
    expect(numericRows.length).toBe(2);
  });

  it('control: an all-located fixture keeps the ordinary mean, unaffected by the filter', async () => {
    mockGetLightningStrikes.mockResolvedValue([makeStrike(10), makeStrike(20), makeStrike(30)]);

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(result.statistics.averageDistance).toBe(20);

    const formatted = formatLightningActivityResponse(result);
    expect(formatted).toContain('**Average Distance:** 20.0 km');
  });

  // Contract 5. When no strike carries a distance, the average is null, not NaN, 0, or a
  // divide-by-zero artifact.
  it('all distance-less strikes: average distance reads unavailable, not 0.0 km', async () => {
    mockGetLightningStrikes.mockResolvedValue([makeDistanceless(), makeDistanceless(), makeDistanceless()]);

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    expect(result.statistics.averageDistance).toBeNull();

    const formatted = formatLightningActivityResponse(result);
    expect(formatted).toContain('**Average Distance:** unavailable');
    expect(formatted).toContain('**Total Strikes:** 3');
  });

  // Contract 6. No unit string ever carries the literal `undefined`, at the 25-row `full` cap —
  // including once the strike-list count exceeds the cap and distance-less strikes are mixed in.
  it('no unit string carries "undefined" at the 25-row full-detail cap, with distance-less strikes mixed in', async () => {
    const strikes: LightningStrike[] = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0 ? makeDistanceless() : makeStrike(i)
    );
    mockGetLightningStrikes.mockResolvedValue(strikes);

    const result = await getLightningActivity({ latitude: LAT, longitude: LON, timeWindow: 60 });
    const formatted = formatLightningActivityResponse(result, 'full');

    expect(formatted).not.toContain('undefined');

    const headings = formatted.match(/### Strike \d+/g) ?? [];
    expect(headings.length).toBe(25);
    expect(formatted).toContain('*Showing 25 of 30 strikes detected*');

    const first25DistancelessCount = strikes.slice(0, 25).filter(s => s.distance == null).length;
    const unavailableRows = formatted.match(/- \*\*Distance:\*\* unavailable/g) ?? [];
    expect(unavailableRows.length).toBe(first25DistancelessCount);
  });
});
