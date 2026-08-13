/**
 * Pure logic for the global (Open-Meteo Flood / GloFAS v4) river path.
 *
 * GloFAS discharge is modeled per ~0.05-degree grid cell, and a cell that
 * misses the river channel reports local runoff rather than the river — the
 * live probe behind this module found 0.63 m³/s at 35.125,-90.075 and
 * 11,640 m³/s one cell west at 35.125,-90.125, both nominally "Memphis".
 * Everything here exists to pick the right cell and then describe it
 * honestly. No I/O, no service calls — only the response type is imported.
 *
 * See docs/global-rivers-plan.md D3 (channel snapping) and D4 (presentation).
 */

import { calculateDistance } from './distance.js';
import type { OpenMeteoFloodResponse } from '../types/openmeteo.js';

/** Probe offsets in degrees — one GloFAS cell pitch either side of center. */
export const PROBE_OFFSETS_DEG = [-0.05, 0, 0.05] as const;

/**
 * Index of the requested (center) point in the array returned by
 * `buildProbeGrid`. The grid is emitted in a stable latitude-major order, so
 * the middle offset in both axes always lands at index 4.
 */
export const PROBE_GRID_CENTER_INDEX = 4;

/** Below this mean discharge the winning cell is not a real river. */
export const MINOR_DRAINAGE_THRESHOLD_CMS = 0.1;

/** Label for a winner below the minor-drainage threshold. */
export const MINOR_DRAINAGE_LABEL =
  'minor local drainage — no significant river within ~8 km';

/**
 * Relative change (percent) below which discharge reads "steady". Deliberately
 * not `computeStageTrend`'s ±0.05 ft rule — that threshold is a stage height in
 * feet and means nothing applied to a volumetric flow in m³/s.
 */
export const TREND_STEADY_THRESHOLD_PCT = 10;

/** Ratio at or above which today's discharge is called out as elevated. */
export const CONTEXT_ELEVATED_RATIO = 1.25;

/** Ratio below which today's discharge is called out as well below average. */
export const CONTEXT_LOW_RATIO = 0.75;

/** Days of history requested from the Flood API (`past_days`). */
export const PAST_DAYS = 31;

/** A single coordinate in the probe grid. */
export interface ProbePoint {
  latitude: number;
  longitude: number;
}

/** The cell selected as the river channel, plus how far we had to move. */
export interface ChannelCellPick {
  /** Index into the cells array (and into the probe grid that produced it). */
  index: number;
  /** Mean discharge (m³/s) over the past-31-day window, nulls ignored. */
  meanDischarge: number;
  /** True when the requested point's own cell won. */
  isCenter: boolean;
  /** Distance from the center cell to the winning cell, in km (0 if center). */
  snapDistanceKm: number;
  /** 8-point compass direction from center to winner (undefined if center). */
  snapBearing?: string;
}

/** Direction of travel in the recent discharge series. */
export interface DischargeTrend {
  direction: 'rising' | 'falling' | 'steady';
  /**
   * Signed percent change from the window's first real value to its last.
   * Undefined when the baseline is zero, where a ratio is meaningless.
   */
  percentChange?: number;
  /** Days actually spanned between the first and last real values. */
  windowDays: number;
}

/** Today's discharge expressed against its own recent history. */
export interface DischargeContext {
  ratio: number;
  label: string;
}

/** Clamp a latitude into the valid range (poles do not wrap). */
function clampLatitude(latitude: number): number {
  return Math.max(-90, Math.min(90, latitude));
}

/**
 * Wrap a longitude into [-180, 180). Longitude is cyclic, so a probe that runs
 * off the antimeridian continues on the far side rather than being clipped.
 */
function wrapLongitude(longitude: number): number {
  return (((longitude + 180) % 360) + 360) % 360 - 180;
}

/**
 * Round to 4 decimal places (~11 m) to keep float noise like 35.074999999999996
 * out of request URLs and cache keys. Far finer than the ~5 km model grid.
 */
function roundCoord(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Build the 3x3 probe grid centered on a point — the neighborhood fetched in a
 * single multi-coordinate Flood API request so channel snapping costs one HTTP
 * call rather than nine.
 *
 * Emitted in latitude-major order (south row first, west to east within each
 * row), which puts the requested point at `PROBE_GRID_CENTER_INDEX`.
 *
 * @param latitude - Requested latitude
 * @param longitude - Requested longitude
 * @returns Nine probe points; near a pole, latitude clamping may make some of
 *   them coincide, which is harmless (duplicate cells simply tie).
 */
export function buildProbeGrid(latitude: number, longitude: number): ProbePoint[] {
  const points: ProbePoint[] = [];
  for (const dLat of PROBE_OFFSETS_DEG) {
    for (const dLon of PROBE_OFFSETS_DEG) {
      points.push({
        latitude: roundCoord(clampLatitude(latitude + dLat)),
        longitude: roundCoord(wrapLongitude(longitude + dLon))
      });
    }
  }
  return points;
}

/**
 * Locate today's entry in a daily `time` array.
 *
 * The series spans `past_days=31` plus the forecast horizon, so today is
 * nowhere near index 0 — everything downstream (current level, trend window,
 * forecast start) depends on finding it correctly. Dates come back in the
 * response's own local timezone (`timezone=auto`), so the comparison is made
 * against local "today", derived from `utc_offset_seconds`.
 *
 * @param time - Daily date strings (`YYYY-MM-DD`)
 * @param utcOffsetSeconds - The response's UTC offset
 * @param now - Injectable clock, for deterministic tests
 * @returns Index of today, or of the latest date at/before today; 0 when the
 *   whole series lies in the future or the array is empty.
 */
export function findTodayIndex(
  time: string[] | undefined,
  utcOffsetSeconds: number = 0,
  now: Date = new Date()
): number {
  if (!time || time.length === 0) {
    return 0;
  }

  const localToday = new Date(now.getTime() + utcOffsetSeconds * 1000)
    .toISOString()
    .slice(0, 10);

  const exact = time.indexOf(localToday);
  if (exact !== -1) {
    return exact;
  }

  // Stale or shifted series: fall back to the latest day at or before today.
  let fallback = -1;
  for (let i = 0; i < time.length; i++) {
    if (time[i] <= localToday) {
      fallback = i;
    }
  }
  return fallback === -1 ? 0 : fallback;
}

/**
 * The past-history slice of a daily series: everything before today.
 * Falls back to the whole series when today sits at index 0, so a response
 * without history still yields a usable basis for cell selection.
 */
export function pastWindowValues(
  series: Array<number | null> | undefined,
  todayIndex: number
): Array<number | null> {
  if (!series) {
    return [];
  }
  return todayIndex > 0 ? series.slice(0, todayIndex) : series.slice();
}

/**
 * The trailing slice used for the observed trend: the last `days` entries up to
 * and including today.
 */
export function recentWindowValues(
  series: Array<number | null> | undefined,
  todayIndex: number,
  days: number = 7
): Array<number | null> {
  if (!series) {
    return [];
  }
  const end = Math.min(series.length, todayIndex + 1);
  return series.slice(Math.max(0, end - days), end);
}

/**
 * Mean of the real (non-null, finite) values in a series.
 * Returns undefined when there are none — an all-null cell has no mean, which
 * is different from a mean of zero.
 */
function meanOfReal(values: Array<number | null>): number | undefined {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      sum += value;
      count++;
    }
  }
  return count === 0 ? undefined : sum / count;
}

/** Initial bearing from one point to another, in degrees clockwise from north. */
function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaLambda = (lon2 - lon1) * toRad;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Reduce a bearing to one of eight compass points. */
export function compassPoint(degrees: number): string {
  return COMPASS_POINTS[Math.round(degrees / 45) % 8];
}

/**
 * Pick the cell that actually carries the river.
 *
 * Each cell is scored by its mean discharge over the past-31-day window,
 * ignoring null days; cells whose series is entirely null are excluded outright
 * (ocean, desert). The highest mean wins.
 *
 * Ties resolve to the center cell when it is among the tied, otherwise to the
 * lowest index — deterministic either way, so identical input always produces
 * identical output.
 *
 * @param cells - One Flood API response per probe point, in probe-grid order
 * @param centerIndex - Index of the requested point (`PROBE_GRID_CENTER_INDEX`)
 * @param now - Injectable clock, for deterministic tests
 * @returns The winning cell, or null when every cell is all-null
 */
export function pickChannelCell(
  cells: OpenMeteoFloodResponse[],
  centerIndex: number = PROBE_GRID_CENTER_INDEX,
  now: Date = new Date()
): ChannelCellPick | null {
  let bestIndex = -1;
  let bestMean = -Infinity;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const series = cell?.daily?.river_discharge;
    if (!series) {
      continue;
    }

    const todayIndex = findTodayIndex(cell.daily?.time, cell.utc_offset_seconds, now);
    const mean = meanOfReal(pastWindowValues(series, todayIndex));
    if (mean === undefined) {
      continue;
    }

    if (mean > bestMean) {
      bestIndex = i;
      bestMean = mean;
    } else if (mean === bestMean && i === centerIndex) {
      // The center is preferred on an exact tie: if the requested point's own
      // cell has as much water as any neighbor, there is nothing to snap to.
      bestIndex = i;
    }
  }

  if (bestIndex === -1) {
    return null;
  }

  const isCenter = bestIndex === centerIndex;
  const center = cells[centerIndex];
  const winner = cells[bestIndex];

  if (isCenter || !center || !winner) {
    return { index: bestIndex, meanDischarge: bestMean, isCenter, snapDistanceKm: 0 };
  }

  // Distances are measured between the model's own reported cell coordinates,
  // so "one cell west" reads as the real spacing of the grid.
  const snapDistanceKm = calculateDistance(
    center.latitude,
    center.longitude,
    winner.latitude,
    winner.longitude
  );
  const snapBearing = compassPoint(
    bearingDegrees(center.latitude, center.longitude, winner.latitude, winner.longitude)
  );

  return { index: bestIndex, meanDischarge: bestMean, isCenter, snapDistanceKm, snapBearing };
}

/**
 * Label a winning cell that is below the minor-drainage threshold, so a
 * plausible-looking 0.04 m³/s is not presented as a river.
 *
 * @returns The label, or undefined when the discharge is river-scale
 */
export function describeMinorDrainage(meanDischarge: number): string | undefined {
  return meanDischarge < MINOR_DRAINAGE_THRESHOLD_CMS ? MINOR_DRAINAGE_LABEL : undefined;
}

/**
 * Classify the direction of a recent discharge series.
 *
 * Compares the first real value in the window to the last, using a relative
 * ±10% threshold (exactly ±10% counts as a trend, mirroring the `<` convention
 * in `computeStageTrend`).
 *
 * @param recentSeries - The trailing window (see `recentWindowValues`)
 * @returns The trend, or undefined with fewer than two real points
 */
export function classifyDischargeTrend(
  recentSeries: Array<number | null> | undefined
): DischargeTrend | undefined {
  if (!recentSeries) {
    return undefined;
  }

  const real: Array<{ index: number; value: number }> = [];
  for (let i = 0; i < recentSeries.length; i++) {
    const value = recentSeries[i];
    if (typeof value === 'number' && Number.isFinite(value)) {
      real.push({ index: i, value });
    }
  }

  if (real.length < 2) {
    return undefined;
  }

  const first = real[0];
  const last = real[real.length - 1];
  const windowDays = last.index - first.index;

  if (first.value === 0) {
    // No baseline to divide by: report direction from the raw change only.
    return {
      direction: last.value > 0 ? 'rising' : 'steady',
      windowDays
    };
  }

  const percentChange = ((last.value - first.value) / first.value) * 100;
  const direction: DischargeTrend['direction'] =
    Math.abs(percentChange) < TREND_STEADY_THRESHOLD_PCT
      ? 'steady'
      : percentChange > 0
        ? 'rising'
        : 'falling';

  return { direction, percentChange, windowDays };
}

/**
 * Render a trend as an inline clause, e.g. "↗ rising (+23% / 6d)".
 * Steady trends omit the near-zero magnitude, matching the NWPS wording style.
 */
export function formatDischargeTrend(trend: DischargeTrend): string {
  if (trend.direction === 'steady') {
    return `→ steady (last ${trend.windowDays}d)`;
  }
  const arrow = trend.direction === 'rising' ? '↗' : '↘';
  if (trend.percentChange === undefined) {
    return `${arrow} ${trend.direction} (last ${trend.windowDays}d)`;
  }
  const signed = `${trend.percentChange >= 0 ? '+' : ''}${trend.percentChange.toFixed(0)}%`;
  return `${arrow} ${trend.direction} (${signed} / ${trend.windowDays}d)`;
}

/**
 * Express today's discharge against its own past-31-day mean — the closest
 * available stand-in for the flood categories GloFAS does not provide.
 *
 * Buckets: >= 1.25x elevated, 0.75x-1.25x near average, < 0.75x well below.
 *
 * @returns The ratio and its wording, or undefined when the mean is unusable
 */
export function classifyAgainstRecentMean(
  today: number,
  mean31: number | undefined
): DischargeContext | undefined {
  if (mean31 === undefined || !Number.isFinite(mean31) || mean31 <= 0) {
    return undefined;
  }
  if (!Number.isFinite(today)) {
    return undefined;
  }

  const ratio = today / mean31;

  if (ratio >= CONTEXT_ELEVATED_RATIO) {
    return { ratio, label: `~${ratio.toFixed(1)}× the recent average` };
  }
  if (ratio < CONTEXT_LOW_RATIO) {
    return { ratio, label: 'well below the recent average' };
  }
  return { ratio, label: 'near the recent average' };
}

/**
 * Disclose that the reported discharge came from a neighboring cell rather than
 * the requested point.
 *
 * @returns The note, or undefined when the requested point's own cell won (or
 *   the snap is under half a kilometre, which rounds to nothing worth saying)
 */
export function formatSnapNote(
  distanceKm: number | undefined,
  bearing: string | undefined
): string | undefined {
  if (distanceKm === undefined || bearing === undefined || !Number.isFinite(distanceKm)) {
    return undefined;
  }
  const rounded = Math.round(distanceKm);
  if (rounded < 1) {
    return undefined;
  }
  return `Nearest modeled river channel: ~${rounded} km ${bearing} of requested point`;
}
