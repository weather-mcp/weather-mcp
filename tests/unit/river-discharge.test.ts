import { describe, it, expect } from 'vitest';
import {
  PROBE_OFFSETS_DEG,
  PROBE_GRID_CENTER_INDEX,
  MINOR_DRAINAGE_THRESHOLD_CMS,
  MINOR_DRAINAGE_LABEL,
  buildProbeGrid,
  findTodayIndex,
  pastWindowValues,
  recentWindowValues,
  pickChannelCell,
  describeMinorDrainage,
  classifyDischargeTrend,
  formatDischargeTrend,
  classifyAgainstRecentMean,
  formatSnapNote
} from '../../src/utils/riverDischarge.js';
import { compassPoint } from '../../src/utils/distance.js';
import type { OpenMeteoFloodResponse } from '../../src/types/openmeteo.js';

/**
 * Channel-snapping and presentation logic for the global river path.
 *
 * The scenario these tests are built around is the live Memphis probe from
 * docs/plans/global-rivers-plan.md: 35.125,-90.075 sits off the Mississippi channel
 * and reads 0.63 m³/s, while the cell one step west reads ~11,600 m³/s.
 */

/** Fixed clock so today's index is deterministic. */
const NOW = new Date('2026-08-12T18:00:00Z');

/**
 * Build a `time` array of `past` days of history, then today, then `forecast`
 * days ahead — the real Flood API shape (past_days=31 + forecast horizon).
 */
function buildTimeArray(past: number, forecast: number, today: string = '2026-08-12'): string[] {
  const times: string[] = [];
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  for (let i = -past; i <= forecast; i++) {
    times.push(new Date(todayMs + i * 86400000).toISOString().slice(0, 10));
  }
  return times;
}

/** A cell whose past window holds a constant discharge. */
function buildCell(
  latitude: number,
  longitude: number,
  pastValue: number | null,
  options: { past?: number; forecast?: number; utcOffsetSeconds?: number } = {}
): OpenMeteoFloodResponse {
  const past = options.past ?? 31;
  const forecast = options.forecast ?? 7;
  const time = buildTimeArray(past, forecast);
  const series = time.map(() => pastValue);

  return {
    latitude,
    longitude,
    generationtime_ms: 0.1,
    utc_offset_seconds: options.utcOffsetSeconds ?? 0,
    timezone: 'GMT',
    timezone_abbreviation: 'GMT',
    daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
    daily: { time, river_discharge: series }
  };
}

/**
 * Nine cells around 35.125,-90.075. Every cell reads 0.63 m³/s except the one
 * at the given index, which carries the Mississippi.
 */
function buildMemphisGrid(channelIndex: number, channelValue = 11600): OpenMeteoFloodResponse[] {
  const grid = buildProbeGrid(35.125, -90.075);
  return grid.map((point, i) =>
    buildCell(point.latitude, point.longitude, i === channelIndex ? channelValue : 0.63)
  );
}

describe('buildProbeGrid', () => {
  it('returns nine points at one cell pitch either side of center', () => {
    const grid = buildProbeGrid(35.125, -90.075);
    expect(grid).toHaveLength(9);
    expect(PROBE_OFFSETS_DEG).toEqual([-0.05, 0, 0.05]);
  });

  it('puts the requested point at PROBE_GRID_CENTER_INDEX', () => {
    const grid = buildProbeGrid(35.125, -90.075);
    expect(grid[PROBE_GRID_CENTER_INDEX]).toEqual({ latitude: 35.125, longitude: -90.075 });
  });

  it('emits latitude-major order, west to east within each row', () => {
    const grid = buildProbeGrid(35.125, -90.075);
    expect(grid[0]).toEqual({ latitude: 35.075, longitude: -90.125 });
    expect(grid[2]).toEqual({ latitude: 35.075, longitude: -90.025 });
    expect(grid[8]).toEqual({ latitude: 35.175, longitude: -90.025 });
  });

  it('rounds away float noise from the offset arithmetic', () => {
    for (const point of buildProbeGrid(35.125, -90.075)) {
      expect(Number.isInteger(point.latitude * 10000)).toBe(true);
      expect(Number.isInteger(point.longitude * 10000)).toBe(true);
    }
  });

  it('wraps longitude across the antimeridian instead of clipping', () => {
    const grid = buildProbeGrid(0, 179.98);
    const longitudes = grid.map(p => p.longitude);
    expect(longitudes).toContain(-179.97);
    expect(longitudes.every(lon => lon >= -180 && lon <= 180)).toBe(true);
  });

  it('clamps latitude at the poles', () => {
    const grid = buildProbeGrid(89.98, 10);
    expect(grid.every(p => p.latitude <= 90)).toBe(true);
    const southern = buildProbeGrid(-89.98, 10);
    expect(southern.every(p => p.latitude >= -90)).toBe(true);
  });
});

describe('findTodayIndex', () => {
  it('finds today well past index 0 in a past+forecast series', () => {
    const time = buildTimeArray(31, 7);
    expect(findTodayIndex(time, 0, NOW)).toBe(31);
    expect(time[31]).toBe('2026-08-12');
  });

  it('honors a negative UTC offset that has not yet rolled the local date', () => {
    // 18:00Z minus 6h is still 2026-08-12 locally.
    const time = buildTimeArray(31, 7);
    expect(findTodayIndex(time, -21600, NOW)).toBe(31);
  });

  it('honors a positive UTC offset that has already rolled the local date', () => {
    // 18:00Z plus 10h is 2026-08-13 locally — one day further into the array.
    const time = buildTimeArray(31, 7);
    expect(findTodayIndex(time, 36000, NOW)).toBe(32);
  });

  it('falls back to the latest day at or before today when today is absent', () => {
    const time = ['2026-08-08', '2026-08-09', '2026-08-10'];
    expect(findTodayIndex(time, 0, NOW)).toBe(2);
  });

  it('returns 0 when the whole series lies in the future', () => {
    const time = ['2026-08-20', '2026-08-21'];
    expect(findTodayIndex(time, 0, NOW)).toBe(0);
  });

  it('returns 0 for an empty or missing array', () => {
    expect(findTodayIndex([], 0, NOW)).toBe(0);
    expect(findTodayIndex(undefined, 0, NOW)).toBe(0);
  });
});

describe('window slicing', () => {
  it('pastWindowValues takes everything before today', () => {
    const series = [1, 2, 3, 4, 5];
    expect(pastWindowValues(series, 3)).toEqual([1, 2, 3]);
  });

  it('pastWindowValues falls back to the whole series when today is index 0', () => {
    const series = [1, 2, 3];
    expect(pastWindowValues(series, 0)).toEqual([1, 2, 3]);
  });

  it('recentWindowValues takes the trailing days up to and including today', () => {
    const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(recentWindowValues(series, 7, 7)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('recentWindowValues clamps at the start of a short series', () => {
    expect(recentWindowValues([1, 2, 3], 2, 7)).toEqual([1, 2, 3]);
  });

  it('returns an empty array for a missing series', () => {
    expect(pastWindowValues(undefined, 3)).toEqual([]);
    expect(recentWindowValues(undefined, 3)).toEqual([]);
  });
});

describe('compassPoint', () => {
  it('maps bearings to the eight compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(270)).toBe('W');
    expect(compassPoint(359)).toBe('N');
  });
});

describe('pickChannelCell', () => {
  it('snaps to the highest-mean cell — the Memphis case', () => {
    // Index 3 is due west of center in the latitude-major grid.
    const pick = pickChannelCell(buildMemphisGrid(3), PROBE_GRID_CENTER_INDEX, NOW);
    expect(pick).not.toBeNull();
    expect(pick!.index).toBe(3);
    expect(pick!.meanDischarge).toBeCloseTo(11600, 5);
    expect(pick!.isCenter).toBe(false);
    expect(pick!.snapBearing).toBe('W');
    expect(pick!.snapDistanceKm).toBeGreaterThan(1);
  });

  it('reports the center with no snap when the requested cell wins', () => {
    const pick = pickChannelCell(
      buildMemphisGrid(PROBE_GRID_CENTER_INDEX),
      PROBE_GRID_CENTER_INDEX,
      NOW
    );
    expect(pick!.index).toBe(PROBE_GRID_CENTER_INDEX);
    expect(pick!.isCenter).toBe(true);
    expect(pick!.snapDistanceKm).toBe(0);
    expect(pick!.snapBearing).toBeUndefined();
  });

  it('returns null when every cell is all-null', () => {
    const grid = buildProbeGrid(0, -140).map(p => buildCell(p.latitude, p.longitude, null));
    expect(pickChannelCell(grid, PROBE_GRID_CENTER_INDEX, NOW)).toBeNull();
  });

  it('lets a cell with a partially-null series still compete and win', () => {
    const grid = buildMemphisGrid(-1); // every cell reads 0.63
    const time = grid[1].daily!.time;
    const todayIndex = 31;
    // Cell 1: mostly null, but the few real days are large.
    grid[1].daily!.river_discharge = time.map((_, i) =>
      i < todayIndex && i % 10 === 0 ? 5000 : null
    );

    const pick = pickChannelCell(grid, PROBE_GRID_CENTER_INDEX, NOW);
    expect(pick!.index).toBe(1);
    expect(pick!.meanDischarge).toBeCloseTo(5000, 5);
  });

  it('excludes all-null cells rather than scoring them as zero', () => {
    const grid = buildMemphisGrid(-1);
    grid[0].daily!.river_discharge = grid[0].daily!.time.map(() => null);

    const pick = pickChannelCell(grid, PROBE_GRID_CENTER_INDEX, NOW);
    expect(pick!.index).not.toBe(0);
    expect(pick!.meanDischarge).toBeCloseTo(0.63, 5);
  });

  it('ignores a cell with no daily block at all', () => {
    const grid = buildMemphisGrid(3);
    delete grid[3].daily;
    const pick = pickChannelCell(grid, PROBE_GRID_CENTER_INDEX, NOW);
    expect(pick!.index).not.toBe(3);
  });

  it('resolves an all-equal tie to the center', () => {
    const grid = buildMemphisGrid(-1); // every cell identical
    const pick = pickChannelCell(grid, PROBE_GRID_CENTER_INDEX, NOW);
    expect(pick!.index).toBe(PROBE_GRID_CENTER_INDEX);
    expect(pick!.isCenter).toBe(true);
  });

  it('resolves a tie that excludes the center to the lowest index', () => {
    const grid = buildMemphisGrid(-1);
    grid[2].daily!.river_discharge = grid[2].daily!.time.map(() => 900);
    grid[6].daily!.river_discharge = grid[6].daily!.time.map(() => 900);

    const pick = pickChannelCell(grid, PROBE_GRID_CENTER_INDEX, NOW);
    expect(pick!.index).toBe(2);
  });

  it('is deterministic across repeated calls on the same input', () => {
    const grid = buildMemphisGrid(-1);
    grid[2].daily!.river_discharge = grid[2].daily!.time.map(() => 900);
    grid[6].daily!.river_discharge = grid[6].daily!.time.map(() => 900);

    const first = pickChannelCell(grid, PROBE_GRID_CENTER_INDEX, NOW);
    const second = pickChannelCell(grid, PROBE_GRID_CENTER_INDEX, NOW);
    expect(first).toEqual(second);
  });

  it('scores on history only, ignoring a forecast spike', () => {
    const grid = buildMemphisGrid(-1);
    // Cell 0 is tiny historically but spikes in the forecast — it must not win.
    grid[0].daily!.river_discharge = grid[0].daily!.time.map((_, i) => (i > 31 ? 99999 : 0.1));

    const pick = pickChannelCell(grid, PROBE_GRID_CENTER_INDEX, NOW);
    expect(pick!.index).not.toBe(0);
  });

  it('returns null for an empty cell array', () => {
    expect(pickChannelCell([], PROBE_GRID_CENTER_INDEX, NOW)).toBeNull();
  });
});

describe('describeMinorDrainage', () => {
  it('labels a winner below the threshold', () => {
    expect(describeMinorDrainage(0.05)).toBe(MINOR_DRAINAGE_LABEL);
    expect(describeMinorDrainage(0.05)).toContain('minor local drainage');
  });

  it('stays silent at and above the threshold', () => {
    expect(describeMinorDrainage(MINOR_DRAINAGE_THRESHOLD_CMS)).toBeUndefined();
    expect(describeMinorDrainage(0.63)).toBeUndefined();
    expect(describeMinorDrainage(11600)).toBeUndefined();
  });
});

describe('classifyDischargeTrend', () => {
  it('reads a clear rise', () => {
    const trend = classifyDischargeTrend([100, 110, 130, 150]);
    expect(trend!.direction).toBe('rising');
    expect(trend!.percentChange).toBeCloseTo(50, 5);
    expect(trend!.windowDays).toBe(3);
  });

  it('reads a clear fall', () => {
    const trend = classifyDischargeTrend([200, 180, 120]);
    expect(trend!.direction).toBe('falling');
    expect(trend!.percentChange).toBeCloseTo(-40, 5);
  });

  it('treats exactly +10% as rising', () => {
    const trend = classifyDischargeTrend([100, 110]);
    expect(trend!.percentChange).toBeCloseTo(10, 5);
    expect(trend!.direction).toBe('rising');
  });

  it('treats exactly -10% as falling', () => {
    const trend = classifyDischargeTrend([100, 90]);
    expect(trend!.percentChange).toBeCloseTo(-10, 5);
    expect(trend!.direction).toBe('falling');
  });

  it('treats just inside +/-10% as steady', () => {
    expect(classifyDischargeTrend([100, 109.9])!.direction).toBe('steady');
    expect(classifyDischargeTrend([100, 90.1])!.direction).toBe('steady');
  });

  it('ignores nulls and reports the span actually covered', () => {
    const trend = classifyDischargeTrend([null, 100, null, null, 150, null]);
    expect(trend!.direction).toBe('rising');
    expect(trend!.percentChange).toBeCloseTo(50, 5);
    expect(trend!.windowDays).toBe(3);
  });

  it('returns undefined with fewer than two real points', () => {
    expect(classifyDischargeTrend([null, 100, null])).toBeUndefined();
    expect(classifyDischargeTrend([])).toBeUndefined();
    expect(classifyDischargeTrend(undefined)).toBeUndefined();
  });

  it('handles a zero baseline without dividing by it', () => {
    const rising = classifyDischargeTrend([0, 5]);
    expect(rising!.direction).toBe('rising');
    expect(rising!.percentChange).toBeUndefined();

    const flat = classifyDischargeTrend([0, 0]);
    expect(flat!.direction).toBe('steady');
    expect(flat!.percentChange).toBeUndefined();
  });
});

describe('formatDischargeTrend', () => {
  it('renders a rise with its magnitude', () => {
    expect(formatDischargeTrend({ direction: 'rising', percentChange: 23.4, windowDays: 6 }))
      .toBe('↗ rising (+23% / 6d)');
  });

  it('renders a fall with a signed magnitude', () => {
    expect(formatDischargeTrend({ direction: 'falling', percentChange: -40, windowDays: 5 }))
      .toBe('↘ falling (-40% / 5d)');
  });

  it('omits the magnitude when steady', () => {
    expect(formatDischargeTrend({ direction: 'steady', percentChange: 2, windowDays: 6 }))
      .toBe('→ steady (last 6d)');
  });

  it('omits the magnitude when the baseline was zero', () => {
    expect(formatDischargeTrend({ direction: 'rising', windowDays: 4 }))
      .toBe('↗ rising (last 4d)');
  });
});

describe('classifyAgainstRecentMean', () => {
  it('calls out an elevated river with its multiple', () => {
    const context = classifyAgainstRecentMean(2100, 1000);
    expect(context!.label).toBe('~2.1× the recent average');
    expect(context!.ratio).toBeCloseTo(2.1, 5);
  });

  it('treats exactly 1.25x as elevated', () => {
    expect(classifyAgainstRecentMean(1250, 1000)!.label).toBe('~1.3× the recent average');
  });

  it('treats just under 1.25x as near average', () => {
    expect(classifyAgainstRecentMean(1249, 1000)!.label).toBe('near the recent average');
  });

  it('treats exactly 0.75x as near average', () => {
    expect(classifyAgainstRecentMean(750, 1000)!.label).toBe('near the recent average');
  });

  it('treats just under 0.75x as well below', () => {
    expect(classifyAgainstRecentMean(749, 1000)!.label).toBe('well below the recent average');
  });

  it('calls an equal reading near average', () => {
    expect(classifyAgainstRecentMean(1000, 1000)!.label).toBe('near the recent average');
  });

  it('returns undefined for an unusable mean', () => {
    expect(classifyAgainstRecentMean(100, 0)).toBeUndefined();
    expect(classifyAgainstRecentMean(100, undefined)).toBeUndefined();
    expect(classifyAgainstRecentMean(100, -5)).toBeUndefined();
    expect(classifyAgainstRecentMean(Number.NaN, 100)).toBeUndefined();
  });
});

describe('formatSnapNote', () => {
  it('discloses a snap with distance and bearing', () => {
    expect(formatSnapNote(4.6, 'W')).toBe(
      'Nearest modeled river channel: ~5 km W of requested point'
    );
  });

  it('stays silent when there is no bearing (the center won)', () => {
    expect(formatSnapNote(0, undefined)).toBeUndefined();
  });

  it('stays silent when the snap rounds to under a kilometre', () => {
    expect(formatSnapNote(0.4, 'W')).toBeUndefined();
  });

  it('stays silent on non-finite input', () => {
    expect(formatSnapNote(Number.NaN, 'W')).toBeUndefined();
    expect(formatSnapNote(undefined, 'W')).toBeUndefined();
  });
});

describe('end-to-end snap disclosure', () => {
  it('produces the Memphis snap note from a raw nine-cell response', () => {
    const pick = pickChannelCell(buildMemphisGrid(3), PROBE_GRID_CENTER_INDEX, NOW);
    const note = formatSnapNote(pick!.snapDistanceKm, pick!.snapBearing);
    expect(note).toMatch(/^Nearest modeled river channel: ~\d+ km W of requested point$/);
  });

  it('produces no note when the requested cell is already the channel', () => {
    const pick = pickChannelCell(
      buildMemphisGrid(PROBE_GRID_CENTER_INDEX),
      PROBE_GRID_CENTER_INDEX,
      NOW
    );
    expect(formatSnapNote(pick!.snapDistanceKm, pick!.snapBearing)).toBeUndefined();
  });
});
