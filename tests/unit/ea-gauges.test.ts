/**
 * Unit tests for `src/utils/eaGauges.ts` — the pure, zero-I/O selection/
 * banding module for UK Environment Agency river gauges. No network, no
 * mocking: every function here is pure, and the two on-disk fixtures under
 * `tests/fixtures/` are real captures (2026-09-02) rather than hand-built
 * shapes, per the module's own header ("observed live... not written
 * defensively for a shape that might arrive later").
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  filterStationsWithRiverName,
  selectStageMeasure,
  narrowStageScale,
  bandRiverLevel,
  formatStageLevel,
  EA_STAGE_STALE_CUTOFF_MINUTES,
  type EASelectedMeasure,
  type EARiverThresholds,
  type EAJoinedReading
} from '../../src/utils/eaGauges.js';
import { IMPERIAL_PREFERENCES, METRIC_PREFERENCES } from '../../src/config/units.js';
import type { EAMeasure, EAStation } from '../../src/types/environmentAgency.js';

function loadFixture<T>(name: string): T {
  const text = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
  return JSON.parse(text) as T;
}

const L2402_DETAIL = loadFixture<{ items: EAStation }>('ea-station-L2402.json');
const YORK_STATIONS = loadFixture<{ items: EAStation[] }>('ea-stations-york.json');

/**
 * L2011 (Nun Appleton Fleet Pumping Station, River Wharfe) — the mAOD-only
 * station, captured live 2026-09-02 via `/id/stations/L2011?_view=full`.
 * Inlined as a builder rather than a third fixture file, per the plan: only
 * two fixture files are named for this task. Three Stage measures publish —
 * `'---'`, `'m'` and `'mAOD'` — and only the `mAOD` one carries a live
 * reading; the other two carry a stale (2021) reading as a bare URL string,
 * exactly as the list endpoint always shapes `latestReading`.
 */
function buildL2011Station(): EAStation {
  return {
    notation: 'L2011',
    label: 'Nun Appleton Fleet Pumping Station',
    riverName: 'River Wharfe',
    measures: [
      {
        '@id': 'http://environment.data.gov.uk/flood-monitoring/id/measures/L2011-level-stage-i-15_min----',
        qualifier: 'Stage',
        unitName: '---',
        latestReading:
          'http://environment.data.gov.uk/flood-monitoring/data/readings/L2011-level-stage-i-15_min----/2021-07-26T05-30-00Z'
      },
      {
        '@id': 'http://environment.data.gov.uk/flood-monitoring/id/measures/L2011-level-stage-i-15_min-m',
        qualifier: 'Stage',
        unitName: 'm',
        latestReading:
          'http://environment.data.gov.uk/flood-monitoring/data/readings/L2011-level-stage-i-15_min-m/2021-07-26T05-30-00Z'
      },
      {
        '@id': 'http://environment.data.gov.uk/flood-monitoring/id/measures/L2011-level-stage-i-15_min-mAOD',
        qualifier: 'Stage',
        unitName: 'mAOD',
        latestReading: {
          '@id': 'http://environment.data.gov.uk/flood-monitoring/data/readings/L2011-level-stage-i-15_min-mAOD/2026-09-02T19-30-00Z',
          date: '2026-09-02',
          dateTime: '2026-09-02T19:30:00Z',
          measure: 'http://environment.data.gov.uk/flood-monitoring/id/measures/L2011-level-stage-i-15_min-mAOD',
          value: 2.019
        }
      }
    ],
    stageScale: {
      datum: 0.868,
      scaleMax: 8,
      typicalRangeHigh: 5.71,
      typicalRangeLow: 2
    }
  };
}

/** Minimal synthetic station with one Stage/m measure, for staleness edge tests. */
function buildSingleMeasureStation(measure: Partial<EAMeasure>): EAStation {
  return {
    notation: 'TEST1',
    riverName: 'Test River',
    measures: [
      {
        '@id': 'http://environment.data.gov.uk/flood-monitoring/id/measures/TEST1-level-stage-i-15_min-m',
        qualifier: 'Stage',
        unitName: 'm',
        ...measure
      }
    ]
  };
}

const EMPTY_READINGS: ReadonlyMap<string, EAJoinedReading> = new Map();

// ---------------------------------------------------------------------------
// 1. riverName filter
// ---------------------------------------------------------------------------

describe('filterStationsWithRiverName', () => {
  it('drops a station with no riverName', () => {
    const withoutRiver: EAStation = { notation: 'NR1', label: 'Tidal test' };
    const withRiver: EAStation = { notation: 'WR1', label: 'River test', riverName: 'River Test' };
    expect(filterStationsWithRiverName([withoutRiver, withRiver])).toEqual([withRiver]);
  });

  it('drops a station whose riverName is empty/whitespace-only', () => {
    const blank: EAStation = { notation: 'BL1', riverName: '   ' };
    expect(filterStationsWithRiverName([blank])).toEqual([]);
  });

  it('against the real York capture: keeps only the stations carrying riverName', () => {
    const kept = filterStationsWithRiverName(YORK_STATIONS.items);
    const expectedKept = YORK_STATIONS.items.filter(
      s => typeof s.riverName === 'string' && s.riverName.trim().length > 0
    );
    expect(kept).toEqual(expectedKept);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(YORK_STATIONS.items.length);
  });
});

// ---------------------------------------------------------------------------
// 2. selectStageMeasure
// ---------------------------------------------------------------------------

describe('selectStageMeasure', () => {
  it("L2402: picks Stage/m = 0.562 over Downstream Stage/mAOD = 2.438, despite an identical freshest timestamp on both — the qualifier preference decides, not freshness", () => {
    // Both live measures on L2402 publish latestReading.dateTime =
    // 2026-09-02T19:15:00Z, so a freshness-only tie-break would be
    // ambiguous; only the qualifier === 'Stage' preference makes this
    // deterministic. The other two Stage/'---' and Downstream Stage/'---'
    // measures carry a bare URL string (2018), so they never enter the
    // candidate set at all.
    const now = new Date('2026-09-02T19:16:00Z');
    const selected = selectStageMeasure(L2402_DETAIL.items, EMPTY_READINGS, now);

    expect(selected).not.toBeNull();
    expect(selected!.qualifier).toBe('Stage');
    expect(selected!.unitName).toBe('m');
    expect(selected!.value).toBe(0.562);
    // Not the Downstream Stage / mAOD reading:
    expect(selected!.value).not.toBe(2.438);
  });

  it('mAOD-only station (L2011, the common case — 21 of 68 real York stations): still selects when the only measure with a reading publishes mAOD', () => {
    const now = new Date('2026-09-02T19:31:00Z');
    const selected = selectStageMeasure(buildL2011Station(), EMPTY_READINGS, now);

    expect(selected).not.toBeNull();
    expect(selected!.qualifier).toBe('Stage');
    expect(selected!.unitName).toBe('mAOD');
    expect(selected!.value).toBe(2.019);
  });

  it('a latestReading arriving as a URL string yields no value — never a fabricated reading', () => {
    const station = buildSingleMeasureStation({
      latestReading: 'http://environment.data.gov.uk/flood-monitoring/data/readings/TEST1-level-stage-i-15_min-m/2020-01-01T00-00-00Z'
    });
    // No entry in the readings map for this measure's @id either — the join
    // has nothing to resolve to.
    const selected = selectStageMeasure(station, EMPTY_READINGS, new Date('2026-09-02T19:00:00Z'));
    expect(selected).toBeNull();
  });

  it('a latestReading URL string DOES resolve via the bulk readings map join, on the measure @id', () => {
    const measureId = 'http://environment.data.gov.uk/flood-monitoring/id/measures/TEST1-level-stage-i-15_min-m';
    const station = buildSingleMeasureStation({
      '@id': measureId,
      latestReading: 'http://environment.data.gov.uk/flood-monitoring/data/readings/TEST1-level-stage-i-15_min-m/2026-09-02T19-00-00Z'
    });
    const now = new Date('2026-09-02T19:05:00Z');
    const readings = new Map<string, EAJoinedReading>([
      [measureId, { dateTime: '2026-09-02T19:00:00Z', value: 1.23 }]
    ]);
    const selected = selectStageMeasure(station, readings, now);
    expect(selected).not.toBeNull();
    expect(selected!.value).toBe(1.23);
  });

  it('rejects a reading older than the 6-hour staleness cutoff', () => {
    expect(EA_STAGE_STALE_CUTOFF_MINUTES).toBe(360);
    const now = new Date('2026-09-02T19:00:00Z');
    // 400 minutes old — 40 minutes past the 360-minute cutoff, well clear of the boundary.
    const staleDateTime = new Date(now.getTime() - 400 * 60000).toISOString();
    const station = buildSingleMeasureStation({
      latestReading: { dateTime: staleDateTime, value: 1.5 }
    });
    expect(selectStageMeasure(station, EMPTY_READINGS, now)).toBeNull();
  });

  it('accepts a reading inside the cutoff and returns its age in whole minutes', () => {
    const now = new Date('2026-09-02T19:00:00Z');
    // 300 minutes old — 60 minutes clear of the 360-minute cutoff.
    const freshDateTime = new Date(now.getTime() - 300 * 60000).toISOString();
    const station = buildSingleMeasureStation({
      latestReading: { dateTime: freshDateTime, value: 1.5 }
    });
    const selected = selectStageMeasure(station, EMPTY_READINGS, now);
    expect(selected).not.toBeNull();
    expect(selected!.value).toBe(1.5);
    expect(selected!.ageMinutes).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// 3. narrowStageScale
// ---------------------------------------------------------------------------

describe('narrowStageScale', () => {
  it('a stageScale URL string yields no range and does not throw', () => {
    expect(() =>
      narrowStageScale('http://environment.data.gov.uk/flood-monitoring/id/stations/L2402/stageScale')
    ).not.toThrow();
    expect(
      narrowStageScale('http://environment.data.gov.uk/flood-monitoring/id/stations/L2402/stageScale')
    ).toBeNull();
  });

  it('null/undefined yields no range and does not throw', () => {
    expect(narrowStageScale(null)).toBeNull();
    expect(narrowStageScale(undefined)).toBeNull();
  });

  it('against the real L2402 detail capture: narrows to the published typical range', () => {
    const narrowed = narrowStageScale(L2402_DETAIL.items.stageScale);
    expect(narrowed).toEqual({
      datum: 4.621,
      typicalRangeHigh: 2.247,
      typicalRangeLow: 0.417,
      scaleMax: 4.5
    });
  });

  it('a stageScale object with neither typical-range bound yields null', () => {
    expect(narrowStageScale({ datum: 1.2, scaleMax: 4 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. bandRiverLevel
// ---------------------------------------------------------------------------

function makeMeasure(overrides: Partial<EASelectedMeasure>): EASelectedMeasure {
  return {
    measureId: 'test-measure',
    qualifier: 'Stage',
    unitName: 'm',
    value: 1,
    dateTime: '2026-09-02T19:00:00Z',
    ageMinutes: 0,
    ...overrides
  };
}

describe('bandRiverLevel', () => {
  it('refuses (returns null) a non-Stage measure, even when its value is well outside the range', () => {
    const measure = makeMeasure({ qualifier: 'Downstream Stage', value: 2.613 });
    const thresholds: EARiverThresholds = { typicalRangeHigh: 2.247, typicalRangeLow: 0.417 };
    expect(bandRiverLevel(measure, thresholds, METRIC_PREFERENCES)).toBeNull();
  });

  it('refuses when thresholds is null/undefined', () => {
    const measure = makeMeasure({ qualifier: 'Stage', value: 1 });
    expect(bandRiverLevel(measure, null, METRIC_PREFERENCES)).toBeNull();
    expect(bandRiverLevel(measure, undefined, METRIC_PREFERENCES)).toBeNull();
  });

  it('applies no datum arithmetic — L2011-shaped case: reading 2.019 mAOD, datum 0.868, typicalRangeLow 2 bands "within", not "below"', () => {
    // If datum were (wrongly) subtracted from the reading before banding,
    // 2.019 - 0.868 = 1.151, which is below typicalRangeLow (2) and even
    // below the station's own all-time minimum (1.54) — an impossible
    // reading. bandRiverLevel must compare the raw reading directly.
    const measure = makeMeasure({ qualifier: 'Stage', value: 2.019 });
    const thresholds: EARiverThresholds = { datum: 0.868, typicalRangeLow: 2, typicalRangeHigh: 5.71 };
    const band = bandRiverLevel(measure, thresholds, METRIC_PREFERENCES);
    expect(band).not.toBeNull();
    expect(band!.position).toBe('within');
  });

  it(
    'DISPLAY-SPACE BAND LOCK: a reading of 2.2475 m against typicalRangeHigh 2.247 m bands "within" under BOTH ' +
      'IMPERIAL_PREFERENCES and METRIC_PREFERENCES, because both display identically (7.37 ft / 2.25 m) — ' +
      'banding on the raw metric pair would say "above" and contradict two identical rendered numbers',
    () => {
      const measure = makeMeasure({ qualifier: 'Stage', value: 2.2475 });
      const thresholds: EARiverThresholds = { typicalRangeHigh: 2.247, typicalRangeLow: 0.417 };

      // Derived with node: displayValue(2.2475, 2) === 2.25 === displayValue(2.247, 2)
      // in metric; metersToFeet(2.2475) -> 7.3736879 -> displayValue -> 7.37, and
      // metersToFeet(2.247) -> 7.37204748 -> displayValue -> 7.37, in imperial.
      const metricShown = formatStageLevel(measure.value, METRIC_PREFERENCES);
      const metricHighShown = formatStageLevel(thresholds.typicalRangeHigh!, METRIC_PREFERENCES);
      expect(metricShown.value).toBe(2.25);
      expect(metricHighShown.value).toBe(2.25);

      const imperialShown = formatStageLevel(measure.value, IMPERIAL_PREFERENCES);
      const imperialHighShown = formatStageLevel(thresholds.typicalRangeHigh!, IMPERIAL_PREFERENCES);
      expect(imperialShown.value).toBe(7.37);
      expect(imperialHighShown.value).toBe(7.37);

      const metricBand = bandRiverLevel(measure, thresholds, METRIC_PREFERENCES);
      const imperialBand = bandRiverLevel(measure, thresholds, IMPERIAL_PREFERENCES);

      expect(metricBand).not.toBeNull();
      expect(metricBand!.position).toBe('within');
      expect(imperialBand).not.toBeNull();
      expect(imperialBand!.position).toBe('within');
    }
  );

  it('bands "below" when the display-space reading is under the display-space low bound', () => {
    const measure = makeMeasure({ qualifier: 'Stage', value: 0.1 });
    const thresholds: EARiverThresholds = { typicalRangeLow: 0.417, typicalRangeHigh: 2.247 };
    const band = bandRiverLevel(measure, thresholds, METRIC_PREFERENCES);
    expect(band!.position).toBe('below');
    expect(band!.description).toBe('below the published typical range');
  });

  it('bands "above" when the display-space reading exceeds the display-space high bound by a clear margin', () => {
    const measure = makeMeasure({ qualifier: 'Stage', value: 3.5 });
    const thresholds: EARiverThresholds = { typicalRangeLow: 0.417, typicalRangeHigh: 2.247 };
    const band = bandRiverLevel(measure, thresholds, METRIC_PREFERENCES);
    expect(band!.position).toBe('above');
    expect(band!.description).toBe('above the published typical range');
  });
});
