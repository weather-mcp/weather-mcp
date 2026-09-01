/**
 * Unit tests for the sea-state taxonomy (WMO Code Table 3700 rungs, grouped
 * into five severity tiers) in `src/utils/marine.ts`, and its rendering
 * through `src/handlers/marineConditionsHandler.ts`
 * (`formatOpenMeteoMarineConditions`).
 *
 * Pure imports only — no I/O, no network, no `vi.resetModules()`. Contract 6
 * drives the real `handleGetMarineConditions` with a mocked
 * `OpenMeteoService.getMarine` and stub `noaaService`/`locationStore`/
 * `geocodingService`, coordinates 30.0, -60.0 (mid-Atlantic — outside every
 * NOAA Great Lakes/coastal-bay bounding box, so `shouldUseNOAAMarine` routes
 * straight to Open-Meteo), following the pattern in
 * tests/unit/marine-forecast.test.ts (a lock, not imported from — its
 * `buildResponse`/`callHandler` helpers are module-local, not exported).
 *
 * `tests/unit/marine-band-rounding.test.ts` is the other lock in this area:
 * it pins the seam behavior of `getWaveHeightCategory`/`getSafetyAssessment`
 * with its own fixed strings. Contract 7 here re-derives seam consistency
 * positionally (equal/not-equal comparisons) rather than repeating that
 * lock's literal expected strings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetMarineConditions } from '../../src/handlers/marineConditionsHandler.js';
import {
  SEA_STATE_TIERS,
  SEA_STATE_SCALE,
  NO_DATA_LEVEL,
  NO_DATA_MARKER,
  seaStateMarker,
  formatSeaStateLegend,
  getWaveHeightCategory,
  getSafetyAssessment,
  formatWaveHeight,
  type SeaStateTier
} from '../../src/utils/marine.js';
import type { OpenMeteoMarineResponse } from '../../src/types/openmeteo.js';

// ---------------------------------------------------------------------------
// Contract 1 — table well-formedness.
// ---------------------------------------------------------------------------

describe('Sea-state table well-formedness (contract 1)', () => {
  it('upperBound strictly increases and ends at Infinity, names are unique, every rung names a real tier, and every tier has at least one rung', () => {
    const bounds = SEA_STATE_SCALE.map((rung) => rung.upperBound);
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i], `bound at index ${i} (${bounds[i]}) is not > previous (${bounds[i - 1]})`).toBeGreaterThan(bounds[i - 1]);
    }
    expect(bounds[bounds.length - 1]).toBe(Infinity);

    const names = SEA_STATE_SCALE.map((rung) => rung.name);
    expect(new Set(names).size).toBe(names.length);

    const tierKeys = new Set(Object.keys(SEA_STATE_TIERS));
    const rungCountByTier = new Map<string, number>();
    for (const rung of SEA_STATE_SCALE) {
      expect(tierKeys.has(rung.tier), `rung "${rung.name}" names unknown tier "${rung.tier}"`).toBe(true);
      rungCountByTier.set(rung.tier, (rungCountByTier.get(rung.tier) ?? 0) + 1);
    }

    // The legend builder indexes `rungs[rungs.length - 1]` for each tier — a
    // tier with zero rungs is a runtime throw, not just a cosmetic gap.
    for (const tierKey of tierKeys) {
      expect(rungCountByTier.get(tierKey) ?? 0, `tier "${tierKey}" has no rungs`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Contract 2 — marker monotonic non-decreasing across the full range.
// ---------------------------------------------------------------------------

describe('Marker severity is monotonic non-decreasing across the full range (contract 2)', () => {
  it('sweeping 0..30 m at a 0.005 m step (division-indexed, i/200), the tier index never decreases, each tier position renders its expected severity marker, and exactly 5 distinct markers appear', () => {
    const tierOrder = Object.keys(SEA_STATE_TIERS) as SeaStateTier[];

    // The five markers, in the visual severity order they must render in —
    // fixed here independent of SEA_STATE_TIERS's own current values. A
    // reverse lookup through the live table (find which tier key currently
    // owns a given marker) cannot catch a mutation that swaps which of two
    // tiers owns which marker: that permutation is exactly as internally
    // self-consistent after the swap as before it, since seaStateMarker and
    // the reverse lookup would both be reading the same (mutated) table.
    // Only an expectation independent of that table can tell the two apart.
    const EXPECTED_MARKERS_IN_TIER_ORDER = ['🟢', '🟡', '🟠', '🔴', '🟣'];
    expect(tierOrder.length, 'SEA_STATE_TIERS must have exactly 5 tiers for this pinned list').toBe(EXPECTED_MARKERS_IN_TIER_ORDER.length);

    function tierIndexForLevel(level: string): number {
      const rung = SEA_STATE_SCALE.find((entry) => entry.name === level);
      if (rung === undefined) {
        throw new Error(`no rung named "${level}"`);
      }
      return tierOrder.indexOf(rung.tier);
    }

    let lastIndex = -1;
    const seenMarkers = new Set<string>();

    for (let i = 0; i <= 6000; i++) {
      const meters = i / 200;
      const level = getWaveHeightCategory(meters).level;
      const marker = seaStateMarker(level);
      seenMarkers.add(marker);

      const index = tierIndexForLevel(level);
      expect(index, `m=${meters}: tier index ${index} regressed from ${lastIndex}`).toBeGreaterThanOrEqual(lastIndex);
      expect(
        marker,
        `m=${meters}: tier position ${index} ("${tierOrder[index]}") rendered marker "${marker}", expected "${EXPECTED_MARKERS_IN_TIER_ORDER[index]}"`
      ).toBe(EXPECTED_MARKERS_IN_TIER_ORDER[index]);
      lastIndex = index;
    }

    expect(seenMarkers.size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Contract 3 — opposite ends of the scale never share a marker.
// ---------------------------------------------------------------------------

describe('Opposite ends of the scale never share a marker (contract 3)', () => {
  it('the first rung and the last rung have different markers, and neither is the no-data marker', () => {
    const first = SEA_STATE_SCALE[0];
    const last = SEA_STATE_SCALE[SEA_STATE_SCALE.length - 1];

    const firstMarker = seaStateMarker(first.name);
    const lastMarker = seaStateMarker(last.name);

    expect(firstMarker).not.toBe(lastMarker);
    expect(firstMarker).not.toBe(NO_DATA_MARKER);
    expect(lastMarker).not.toBe(NO_DATA_MARKER);
  });
});

// ---------------------------------------------------------------------------
// Contract 4 — every level has a marker, including the no-data level.
// ---------------------------------------------------------------------------

describe('Every level has a marker (contract 4)', () => {
  it('every rung maps to one of the tier markers; the no-data level maps to the no-data marker, which no tier uses; both no-data accessors report Unknown', () => {
    const tierMarkers = new Set(Object.values(SEA_STATE_TIERS).map((tier) => tier.marker));

    for (const rung of SEA_STATE_SCALE) {
      expect(tierMarkers.has(seaStateMarker(rung.name))).toBe(true);
    }

    expect(seaStateMarker(NO_DATA_LEVEL)).toBe(NO_DATA_MARKER);
    expect(tierMarkers.has(NO_DATA_MARKER)).toBe(false);

    expect(getWaveHeightCategory(undefined).level).toBe('Unknown');
    expect(getSafetyAssessment(undefined, undefined, undefined, undefined).level).toBe('Unknown');
  });
});

// ---------------------------------------------------------------------------
// Contract 5 — legend rows equal the tier unions.
// ---------------------------------------------------------------------------

describe('Legend rows equal the tier unions (contract 5)', () => {
  it('exactly 5 severity rows, in tier order, each with the tier marker, its rungs\' names, the true union range, and the tier blurb; one no-data line, never on a severity row', () => {
    const legend = formatSeaStateLegend();
    const lines = legend.split('\n');

    // Marker, then " **names**", then " (range)", then ": blurb" — to end of
    // line (G28: names like "Very rough" and "Smooth (wavelets)" are
    // multi-word). Ranges never contain parentheses, so `[^()]+` is safe there.
    const rowRegex = /^(\S+) \*\*(.+)\*\* \(([^()]+)\): (.+)$/;
    const severityRows = lines
      .map((line) => ({ line, match: rowRegex.exec(line) }))
      .filter((entry): entry is { line: string; match: RegExpExecArray } => entry.match !== null);

    expect(severityRows.length).toBe(5);

    const tierOrder = Object.keys(SEA_STATE_TIERS) as SeaStateTier[];
    let lowerBound = 0;

    tierOrder.forEach((tier, i) => {
      const rungs = SEA_STATE_SCALE.filter((entry) => entry.tier === tier);
      const tierUpper = rungs[rungs.length - 1].upperBound;
      const [, marker, names, range, blurb] = severityRows[i].match;

      expect(marker, `row ${i} marker`).toBe(SEA_STATE_TIERS[tier].marker);
      expect(names.split(' / '), `row ${i} names`).toEqual(rungs.map((entry) => entry.name));

      const expectedRange = tierUpper === Infinity ? `≥${lowerBound} m` : `${lowerBound}–${tierUpper} m`;
      expect(range, `row ${i} range`).toBe(expectedRange);
      expect(blurb, `row ${i} blurb`).toBe(SEA_STATE_TIERS[tier].blurb);

      lowerBound = tierUpper;
    });

    const noDataLines = lines.filter((line) => line.startsWith(NO_DATA_MARKER));
    expect(noDataLines.length).toBe(1);
    for (const row of severityRows) {
      expect(row.line.startsWith(NO_DATA_MARKER)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Contract 6 — header, wave line and legend agree, through the handler.
// ---------------------------------------------------------------------------

/**
 * Scan backward from the end of a line for the outermost, balanced trailing
 * `(...)` group — robust against a rung name that itself contains
 * parentheses (`Smooth (wavelets)`), unlike a naive `\(([^()]+)\)$` regex.
 */
function trailingBalancedParenContent(line: string): string {
  if (!line.endsWith(')')) {
    throw new Error(`line does not end with ')': ${line}`);
  }
  let depth = 0;
  for (let i = line.length - 1; i >= 0; i--) {
    if (line[i] === ')') {
      depth++;
    } else if (line[i] === '(') {
      depth--;
      if (depth === 0) {
        return line.slice(i + 1, line.length - 1);
      }
    }
  }
  throw new Error(`unbalanced parentheses in line: ${line}`);
}

const getMarineMock = vi.fn();
const getStationsMock = vi.fn();
const getGridpointDataMock = vi.fn();

const noaaService = {
  getStations: getStationsMock,
  getGridpointDataByCoordinates: getGridpointDataMock
} as never;
const openMeteoService = { getMarine: getMarineMock } as never;
const locationStore = {} as never;
const geocodingService = {} as never;

// Mid-Atlantic open ocean — outside every Great Lakes/coastal-bay bounding
// box, so shouldUseNOAAMarine routes straight to Open-Meteo.
const COORDS = { latitude: 30.0, longitude: -60.0 };

function buildCurrentResponse(waveHeight: number | undefined): OpenMeteoMarineResponse {
  return {
    latitude: 30.0,
    longitude: -60.0,
    generationtime_ms: 0.5,
    utc_offset_seconds: 0,
    timezone: 'Atlantic/Bermuda',
    timezone_abbreviation: 'AST',
    elevation: 0,
    current: {
      time: '2026-07-16T11:00',
      interval: 3600,
      ...(waveHeight !== undefined ? { wave_height: waveHeight } : {}),
      wave_direction: 200,
      wave_period: 9.0
    }
  };
}

function callHandler(args: Record<string, unknown>) {
  return handleGetMarineConditions(args, noaaService, openMeteoService, locationStore, geocodingService);
}

describe('Header, wave line and legend agree, through the handler (contract 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Handler falls back to a guessed timezone when getStations rejects.
    getStationsMock.mockRejectedValue(new Error('no station coverage'));
  });

  // One fixture per rung, off every x.x5 half (G36) — the displayed
  // (one-decimal) value is what getWaveHeightCategory bands on.
  const rungFixtures: Array<[number, string]> = [
    [0.02, 'Calm'],
    [0.12, 'Smooth (wavelets)'],
    [0.52, 'Slight'],
    [1.27, 'Moderate'],
    [2.52, 'Rough'],
    [4.02, 'Very rough'],
    [6.02, 'High'],
    [9.02, 'Very high'],
    [14.02, 'Phenomenal']
  ];

  it.each(rungFixtures)(
    'wave_height %s m renders as %s consistently in the header, the wave-height line and the legend',
    async (waveHeight, expectedLevel) => {
      getMarineMock.mockResolvedValue(buildCurrentResponse(waveHeight));
      const result = await callHandler({ ...COORDS });
      const text = result.content[0].text;

      const headerMatch = /^## (\S+) Current Conditions: (.+)$/m.exec(text);
      expect(headerMatch, 'header line present').not.toBeNull();
      const [, headerMarker, headerLevel] = headerMatch!;
      expect(headerLevel).toBe(expectedLevel);
      expect(headerMarker).toBe(seaStateMarker(expectedLevel as never));

      const waveLine = text.split('\n').find((line) => line.startsWith('**Significant Wave Height:**'));
      expect(waveLine, 'wave-height line present').toBeDefined();
      expect(trailingBalancedParenContent(waveLine!)).toBe(expectedLevel);

      // Parse the legend as actually rendered in the handler output, not the
      // pure formatSeaStateLegend() result directly — the two can diverge if
      // the handler stops calling it (or wraps/prepends extra text), and this
      // contract exists specifically to catch that divergence.
      const legendLines = text.split('\n');
      const legendRow = legendLines.find((line) => line.startsWith(headerMarker));
      expect(legendRow, `legend row for marker ${headerMarker}`).toBeDefined();
      const namesMatch = /\*\*(.+)\*\*/.exec(legendRow!);
      expect(namesMatch, 'legend row has a bold name list').not.toBeNull();
      const names = namesMatch![1].split(' / ');
      expect(names).toContain(expectedLevel);
    }
  );

  it('omitted current.wave_height renders an exact Unknown header, and the no-data marker appears exactly twice total (header + legend)', async () => {
    getMarineMock.mockResolvedValue(buildCurrentResponse(undefined));
    const result = await callHandler({ ...COORDS });
    const text = result.content[0].text;

    const headerMatch = /^## (\S+) Current Conditions: (.+)$/m.exec(text);
    expect(headerMatch, 'header line present').not.toBeNull();
    expect(headerMatch![0]).toBe(`## ${NO_DATA_MARKER} Current Conditions: ${NO_DATA_LEVEL}`);

    const occurrences = text.split(NO_DATA_MARKER).length - 1;
    expect(occurrences).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Contract 7 — seams still band on the displayed value.
//
// Positional (equal/not-equal), not string-repeating — the exact seam
// strings are already locked by tests/unit/marine-band-rounding.test.ts.
// ---------------------------------------------------------------------------

describe('Seams still band on the displayed value (contract 7)', () => {
  it('at each finite one-decimal threshold, the value just below it bands the same as the threshold itself, and a value well below it bands differently', () => {
    const finiteThresholds = SEA_STATE_SCALE
      .map((rung) => rung.upperBound)
      .filter((bound): bound is number => Number.isFinite(bound));

    for (const t of finiteThresholds) {
      // 1.25 is not reached by this generic epsilon check: it is the one
      // threshold in the table with two decimal digits of precision, sitting
      // exactly at the midpoint of the one-decimal display granularity
      // (displayValue(1.25, 1) rounds up to 1.3; displayValue(1.25 - anything, 1)
      // rounds down to 1.2 — no raw value below 1.25 ever displays as 1.3).
      // marine-band-rounding.test.ts documents and locks this same threshold
      // as "unreachable" via a dedicated literal pair ([1.2499, 'Slight'],
      // [1.25, 'Moderate']) rather than a generic epsilon, for the same
      // reason (G13). Skip it here rather than assert something that cannot
      // be true by construction.
      if (Number(t.toFixed(1)) !== t) {
        continue;
      }

      const atThreshold = getWaveHeightCategory(t).level;
      const justBelow = getWaveHeightCategory(t - 0.0001).level;
      const wellBelow = getWaveHeightCategory(t - 0.06).level;

      expect(justBelow, `t=${t}: t-0.0001 should band the same as t`).toBe(atThreshold);
      expect(wellBelow, `t=${t}: t-0.06 should band differently from t`).not.toBe(atThreshold);
    }
  });
});

// ---------------------------------------------------------------------------
// Sanity — formatWaveHeight is exercised indirectly above; assert it
// directly once so the import is not unused-only.
// ---------------------------------------------------------------------------

describe('formatWaveHeight sanity', () => {
  it('formats meters to one decimal with a feet conversion', () => {
    expect(formatWaveHeight(0.12)).toBe('0.1m (0.4ft)');
  });
});
