/**
 * UK Environment Agency (EA) river gauges — pure, zero-I/O middle layer.
 *
 * Three-layer split for this feature: `src/services/environmentAgency.ts`
 * fetches (station list + national bulk latest-readings map + per-station
 * thresholds), this module computes (river-name filtering, measure
 * selection, level banding, display formatting), and the handler renders.
 * This module owns the constants below; the service — or a future edit to
 * it — imports from here, never the reverse. Accordingly this file makes
 * **no** network call and imports **no** service: the shapes it needs from
 * `EnvironmentAgencyService` (a joined reading's `{ dateTime, value }`, and
 * a station's threshold numbers) are declared locally
 * (`EAJoinedReading`, `EARiverThresholds`) rather than imported, and are
 * structurally identical to that service's `EALatestReading` /
 * `EAStationThresholds` — TypeScript's structural typing means a caller can
 * pass the service's values straight through with no conversion.
 *
 * Every guard in this file — the non-object `stageScale`, the non-object
 * `latestReading`, the missing `riverName`, the reading-less `m` measure on
 * a station whose only live Stage reading is in `mAOD` — was observed live
 * against the real API on 2026-09-02, not written defensively for a shape
 * that might arrive later. See `src/services/environmentAgency.ts` for the
 * fetch side and the verified endpoint behaviour this module relies on.
 *
 * **G8.** A later task bounds *typical-range enrichment* to a handful of
 * gauges per query for cost reasons. That bound must never change which
 * gauges are listed or counted, so the range is deliberately modelled here
 * as an optional enrichment argument to `bandRiverLevel` — never as a filter
 * a station must pass to be listed. `filterStationsWithRiverName` and
 * `selectStageMeasure` never look at thresholds at all.
 */

import type { EAMeasure, EAStageScale, EAStation } from '../types/environmentAgency.js';
import { displayValue } from './displayBanding.js';
import { metersToFeet } from './units.js';
import type { UnitPreferences } from '../config/units.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * A reading older than this is rejected outright rather than rendered as
 * current. Matches the METAR station picker's existing staleness posture in
 * this repo (`STALE_MAX_AGE_MINUTES` in `src/utils/metarStation.ts`) — six
 * hours is this project's standing bound for "old but still worth surfacing
 * with a caveat" on an observation-based surface; EA's 15-minute publication
 * cadence means anything past it has stopped updating.
 */
export const EA_STAGE_STALE_CUTOFF_MINUTES = 6 * 60;

/**
 * Unit preference order for choosing between multiple readable `Stage`
 * measures on one station, most preferred first. `m` is a plain stage
 * height; `mAOD` and `mASD` are absolute-elevation references (still
 * metres — see `formatStageLevel`); `'---'` is EA's own placeholder for "no
 * unit published". A unit outside this list ranks after all four.
 *
 * In live data (68 York-area river stations, 2026-09-02) this tier never
 * actually chooses between two *readable* Stage measures — no station
 * published more than one Stage measure with a live reading at once — but it
 * is kept as a deterministic, reproducible tie-break.
 */
export const EA_UNIT_PREFERENCE_ORDER: readonly string[] = ['m', 'mAOD', 'mASD', '---'];

/**
 * Decimal places for a displayed EA stage/level value, and the precision
 * `bandRiverLevel` rounds to before comparing against the published typical
 * range. Matches `deriveFloodCategory`'s precision for the NOAA gauge path
 * (`riverConditionsHandler.ts`), scaled down from feet to metres/feet: an EA
 * stage can be well under a metre, where whole-unit rounding (as
 * `formatElevationFromM` uses for elevation) would erase the entire signal.
 */
export const EA_STAGE_DISPLAY_DECIMALS = 2;

// ---------------------------------------------------------------------------
// 1. riverName filter
// ---------------------------------------------------------------------------

/**
 * Keep only stations carrying a non-empty `riverName`.
 *
 * This is what makes the tool's rendered coverage claim true by
 * construction. Measured at York (2026-09-02): of 80 stations returned by a
 * 25 km search, 68 carry `riverName` and the same 68 carry `stageScale`;
 * every tidal hit in Wales, Scotland and Northern Ireland carries neither.
 * Sprouston on the Tweed (55.611 N, -2.395, in Scotland) is correctly kept
 * by this filter; Leith is correctly dropped.
 */
export function filterStationsWithRiverName(stations: readonly EAStation[]): EAStation[] {
  return stations.filter((station) => typeof station.riverName === 'string' && station.riverName.trim().length > 0);
}

// ---------------------------------------------------------------------------
// 2. Measure selection
// ---------------------------------------------------------------------------

/**
 * One latest level reading, joined to a station's measure. Structurally
 * identical to `EnvironmentAgencyService`'s `EALatestReading` — see the file
 * header for why this module declares its own copy instead of importing it.
 */
export interface EAJoinedReading {
  /** ISO 8601 observation time, as published. */
  dateTime: string;
  /** Level in the measure's own `unitName`. */
  value: number;
}

/**
 * The measure `selectStageMeasure` chose, with everything a caller needs to
 * render and to band it.
 */
export interface EASelectedMeasure {
  /** The measure's own `@id` — the join key into a readings map, and the cache/debug identifier. */
  measureId?: string;
  /** As published: `'Stage'`, `'Downstream Stage'`, etc. `bandRiverLevel` only bands `'Stage'`. */
  qualifier?: string;
  /** As published: `'m'`, `'mAOD'`, `'mASD'`, or the placeholder `'---'`. */
  unitName?: string;
  /** The reading, in `unitName` — always metres regardless of which of the three. */
  value: number;
  /** ISO 8601 observation time, as published. */
  dateTime: string;
  /** Observation age in whole minutes, at the `now` `selectStageMeasure` was given. */
  ageMinutes: number;
}

/** Normalise `measures`, which is a single object on some stations and an array on others. */
function normalizeMeasures(measures: EAMeasure | EAMeasure[] | undefined): EAMeasure[] {
  if (measures === undefined || measures === null) {
    return [];
  }
  return Array.isArray(measures) ? measures : [measures];
}

interface ResolvedMeasureReading {
  value: number;
  dateTime: string;
}

/**
 * Resolve one measure's reading, from whichever of the two live shapes it
 * carries: an inline `EAReading` object (only present via the
 * `?_view=full` station-detail endpoint), or a lookup into the separately
 * fetched national bulk-readings map by the measure's own `@id` (the shape
 * every station-*list* measure requires, since that endpoint carries no
 * `latestReading` at all).
 *
 * An inline object, when present, is treated as authoritative for this
 * measure and is not cross-checked against the map — a caller build a raw
 * detail-endpoint response deliberately wants that fetch's own number. An
 * inline object missing a usable `value`/`dateTime`, or a bare URL string,
 * yields no reading rather than falling back to the map or fabricating one.
 */
function resolveMeasureReading(
  measure: EAMeasure,
  readings: ReadonlyMap<string, EAJoinedReading>
): ResolvedMeasureReading | null {
  const inline = measure.latestReading;

  if (typeof inline === 'object' && inline !== null) {
    // Guard on `!= null`, not `!== undefined`: JSON `null` survives the
    // stricter check and then coerces to 0 in arithmetic, which here would
    // be a fabricated river level of zero.
    if (inline.value != null && typeof inline.value === 'number' && Number.isFinite(inline.value) && typeof inline.dateTime === 'string') {
      return { value: inline.value, dateTime: inline.dateTime };
    }
    return null;
  }

  // `inline` is either `undefined` or a URL string here — neither carries a
  // value, so the join is the only remaining path.
  const id = measure['@id'];
  if (typeof id !== 'string') {
    return null;
  }

  const joined = readings.get(id);
  if (joined === undefined) {
    return null;
  }
  if (joined.value == null || typeof joined.value !== 'number' || !Number.isFinite(joined.value) || typeof joined.dateTime !== 'string') {
    return null;
  }
  return { value: joined.value, dateTime: joined.dateTime };
}

/** Age of an ISO 8601 timestamp in minutes at `now`, or `null` when it does not parse. */
function ageInMinutes(dateTime: string, now: Date): number | null {
  const observed = new Date(dateTime).getTime();
  if (Number.isNaN(observed)) {
    return null;
  }
  return (now.getTime() - observed) / 60000;
}

/** Sort rank for a measure's `unitName`: lower is more preferred. Unknown units rank worst. */
function unitRank(unitName: string | undefined): number {
  if (unitName === undefined) {
    return EA_UNIT_PREFERENCE_ORDER.length;
  }
  const index = EA_UNIT_PREFERENCE_ORDER.indexOf(unitName);
  return index === -1 ? EA_UNIT_PREFERENCE_ORDER.length : index;
}

/**
 * Choose the one measure that answers "what is the current level at this
 * station" — or `null` when nothing qualifies.
 *
 * **Order matters, and the obvious order is wrong.** This filters to
 * measures that actually resolve to a fresh-enough reading **first**, and
 * only *then* applies preference. Applying the unit preference first would
 * drop 31% of British river gauges: of 68 York-area river stations
 * (2026-09-02), 21 publish a live Stage reading only in `mAOD`, not `m`, and
 * the worked case is station L2011 (Nun Appleton, River Wharfe), which
 * publishes three Stage measures — `'---'`, `'m'` and `'mAOD'` — and only the
 * `mAOD` one has a reading. A preference applied before the has-a-reading
 * filter would pick the `m` measure and render no level for a gauge
 * reporting normally.
 *
 * Selection, in order:
 * 1. Discard every measure with no reading (inline or joined — see
 *    `resolveMeasureReading`) or whose reading is older than
 *    `EA_STAGE_STALE_CUTOFF_MINUTES`.
 * 2. Prefer `qualifier === 'Stage'`.
 * 3. Then prefer by `unitName`, via `EA_UNIT_PREFERENCE_ORDER`.
 * 4. Then prefer the freshest `dateTime`.
 *
 * Steps 3-4 are deterministic tie-breaks that make the selection total and
 * reproducible; live data never actually needs them to choose (no station
 * observed publishes two readable Stage measures at once).
 *
 * @param station A station from the (already `riverName`-filtered) list.
 * @param readings The national bulk latest-readings map, keyed by measure `@id`.
 * @param now Injectable clock, for deterministic tests.
 */
export function selectStageMeasure(
  station: EAStation,
  readings: ReadonlyMap<string, EAJoinedReading>,
  now: Date = new Date()
): EASelectedMeasure | null {
  const candidates: Array<{ measure: EAMeasure; value: number; dateTime: string; ageMinutes: number }> = [];

  for (const measure of normalizeMeasures(station.measures)) {
    const resolved = resolveMeasureReading(measure, readings);
    if (resolved === null) {
      continue;
    }
    const ageMinutes = ageInMinutes(resolved.dateTime, now);
    // Future-dated readings (clock skew) are treated as current, not
    // discarded — only an unparseable timestamp or genuine staleness drops
    // the candidate, mirroring `pickNearestStation` in metarStation.ts.
    if (ageMinutes === null || ageMinutes > EA_STAGE_STALE_CUTOFF_MINUTES) {
      continue;
    }
    candidates.push({ measure, value: resolved.value, dateTime: resolved.dateTime, ageMinutes });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    const stageRank = (m: EAMeasure) => (m.qualifier === 'Stage' ? 0 : 1);
    const stageDiff = stageRank(a.measure) - stageRank(b.measure);
    if (stageDiff !== 0) {
      return stageDiff;
    }

    const unitDiff = unitRank(a.measure.unitName) - unitRank(b.measure.unitName);
    if (unitDiff !== 0) {
      return unitDiff;
    }

    return a.ageMinutes - b.ageMinutes;
  });

  const best = candidates[0];
  return {
    measureId: best.measure['@id'],
    qualifier: best.measure.qualifier,
    unitName: best.measure.unitName,
    value: best.value,
    dateTime: best.dateTime,
    ageMinutes: Math.max(0, Math.round(best.ageMinutes))
  };
}

// ---------------------------------------------------------------------------
// 3. stageScale narrowing
// ---------------------------------------------------------------------------

/**
 * A station's published typical range, reduced to finite numbers only.
 * Structurally identical to `EnvironmentAgencyService`'s
 * `EAStationThresholds` — see the file header for why this module declares
 * its own copy instead of importing it.
 */
export interface EARiverThresholds {
  /** Datum the stage is measured against, metres. Metadata only — never apply this to a reading; see `bandRiverLevel`. */
  datum?: number;
  /** Top of the gauge's published typical range, metres. */
  typicalRangeHigh?: number;
  /** Bottom of the gauge's published typical range, metres. */
  typicalRangeLow?: number;
  /** Top of the gauge's published scale, metres. */
  scaleMax?: number;
}

/**
 * Narrow a raw `stageScale` field to its usable range, or `null`.
 *
 * `stageScale` is `string | EAStageScale` on the wire: a URL string on the
 * station-list endpoint, an inlined object only via `?_view=full`. A string
 * is not a range and must not throw — this returns `null` for it rather than
 * attempting to read through it. `EnvironmentAgencyService.getStationDetail`
 * already performs this narrowing for its own return value
 * (`EAStationThresholds | null`); this function exists so a caller holding a
 * raw `EAStation.stageScale` (e.g. from a station fetched directly rather
 * than through that method) can narrow it the same way, and so a caller can
 * pass either shape into `bandRiverLevel`.
 *
 * Returns `null` when neither `typicalRangeHigh` nor `typicalRangeLow` is a
 * finite number — a range with neither bound is not a usable range.
 */
export function narrowStageScale(stageScale: string | EAStageScale | null | undefined): EARiverThresholds | null {
  if (typeof stageScale !== 'object' || stageScale === null) {
    return null;
  }

  const thresholds: EARiverThresholds = {
    datum: finiteOrUndefined(stageScale.datum),
    typicalRangeHigh: finiteOrUndefined(stageScale.typicalRangeHigh),
    typicalRangeLow: finiteOrUndefined(stageScale.typicalRangeLow),
    scaleMax: finiteOrUndefined(stageScale.scaleMax)
  };

  if (thresholds.typicalRangeHigh === undefined && thresholds.typicalRangeLow === undefined) {
    return null;
  }
  return thresholds;
}

/** A finite number, or `undefined`. JSON `null` survives `!== undefined` and then coerces to 0 in arithmetic. */
function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// 4. Level banding
// ---------------------------------------------------------------------------

/** A plain position report against a station's published typical range. Never a flood category — see `bandRiverLevel`. */
export interface RiverLevelBand {
  position: 'below' | 'within' | 'above';
  /** Human-readable phrase, e.g. `"within the published typical range"`. */
  description: string;
}

/**
 * Band a selected measure's reading against its station's published typical
 * range — a plain position report ("below" / "within" / "above the published
 * typical range"), **never a flood category**. `typicalRangeHigh` is not a
 * flood threshold, and the EA publishes no action/minor/moderate/major
 * equivalent on this API; word any rendering of this result accordingly.
 *
 * **Refuses (returns `null`) when the measure is not a `'Stage'` measure.**
 * `stageScale` belongs to a station's `Stage` measure specifically. Banding
 * any other measure against it is wrong even though the units match:
 * observed live on station L2402, the `'Downstream Stage'` measure reads
 * 2.613 mAOD against that station's `typicalRangeHigh` of 2.247 — comparing
 * the two renders a false "above typical range" on a river-safety surface.
 * Also refuses when `thresholds` is absent or carries neither bound.
 *
 * **Never applies `thresholds.datum` to the reading.** The published range is
 * in the same units as the station's own live Stage measure, so the reading
 * and the range are directly comparable with no conversion. Falsified live
 * on station L2011: reading 2.019 mAOD against `typicalRangeLow: 2` and
 * `minOnRecord: 1.54`, `datum: 0.868` — subtracting the datum from the
 * reading gives 1.151, which is below the station's own all-time minimum and
 * therefore impossible. `datum` is metadata only.
 *
 * **Bands in display space — all three numbers, not just the reading.** The
 * reading *and* both range bounds are put through `formatStageLevel` with the
 * caller's own `prefs` before they are compared, so the band is decided on
 * exactly the numbers the reader sees. Rounding the reading alone is not
 * enough here, because the renderer prints the typical range too: at
 * imperial preferences a reading of 2.2475 m and a `typicalRangeHigh` of
 * 2.247 m both display as `7.37 ft`, and banding on the raw metric pair
 * would print "above the published typical range" directly underneath two
 * identical numbers. Converting first and rounding both sides makes that
 * contradiction unrepresentable rather than unlikely.
 *
 * Rounding happens inside this function, per the `marine.ts` convention,
 * since more than one call site shares it.
 *
 * The caller **must** pass the same `prefs` it renders with. A band computed
 * under one unit system and printed under another reintroduces exactly the
 * seam this function closes.
 */
export function bandRiverLevel(
  measure: EASelectedMeasure,
  thresholds: EARiverThresholds | null | undefined,
  prefs: UnitPreferences
): RiverLevelBand | null {
  if (measure.qualifier !== 'Stage') {
    return null;
  }
  if (thresholds === null || thresholds === undefined) {
    return null;
  }

  const { typicalRangeLow, typicalRangeHigh } = thresholds;
  if (typicalRangeLow === undefined && typicalRangeHigh === undefined) {
    return null;
  }

  // Display space: convert and round the reading and both bounds identically,
  // through the same helper the renderer uses to print them.
  const shown = formatStageLevel(measure.value, prefs).value;
  const low =
    typicalRangeLow === undefined ? undefined : formatStageLevel(typicalRangeLow, prefs).value;
  const high =
    typicalRangeHigh === undefined ? undefined : formatStageLevel(typicalRangeHigh, prefs).value;

  if (low !== undefined && shown < low) {
    return { position: 'below', description: 'below the published typical range' };
  }
  if (high !== undefined && shown > high) {
    return { position: 'above', description: 'above the published typical range' };
  }
  return { position: 'within', description: 'within the published typical range' };
}

// ---------------------------------------------------------------------------
// 5. Metres/feet formatting
// ---------------------------------------------------------------------------

/** A formatted EA stage/level value, at `EA_STAGE_DISPLAY_DECIMALS`. */
export interface FormattedStageValue {
  /** The numeric value, in `unitLabel`, rounded to `EA_STAGE_DISPLAY_DECIMALS`. */
  value: number;
  /** `'ft'` for `prefs.distance === 'mi'`, `'m'` for `prefs.distance === 'km'`. */
  unitLabel: 'ft' | 'm';
  /** Pre-formatted, e.g. `"0.56 m"` / `"1.84 ft"`. */
  formatted: string;
}

/**
 * Format an EA level reading to two decimal places, keyed on
 * `prefs.distance`.
 *
 * Deliberately a **local** formatter rather than reusing
 * `formatElevationFromM` (`src/utils/unitFormat.ts`), which rounds to whole
 * units — correct for elevation, wrong for a river stage where 0.56 m
 * against a 1.2 m typical range is the whole signal and whole-metre rounding
 * would erase it. Not added to `unitFormat.ts` itself, to avoid putting that
 * file's five existing `formatElevationFromM` call sites at risk for no
 * gain; this also matches `riverConditionsHandler.ts`, which already keeps
 * its own local formatters (`dischargeInPrefUnit`/`dischargeUnitLabel`)
 * rather than importing from `unitFormat.ts`.
 *
 * `valueMeters` is always metres regardless of the source measure's
 * `unitName` — `'m'`, `'mAOD'` and `'mASD'` are all metres (the latter two
 * are an absolute-elevation reference rather than a stage height, but the
 * unit itself is still metres, so `metersToFeet` applies correctly to any of
 * the three). `unitName` is not an input to this function; carry it
 * separately (`EASelectedMeasure.unitName`) so the caller can label what the
 * number represents.
 */
export function formatStageLevel(valueMeters: number, prefs: UnitPreferences): FormattedStageValue {
  if (prefs.distance === 'km') {
    const value = displayValue(valueMeters, EA_STAGE_DISPLAY_DECIMALS);
    return { value, unitLabel: 'm', formatted: `${value.toFixed(EA_STAGE_DISPLAY_DECIMALS)} m` };
  }

  const value = displayValue(metersToFeet(valueMeters), EA_STAGE_DISPLAY_DECIMALS);
  return { value, unitLabel: 'ft', formatted: `${value.toFixed(EA_STAGE_DISPLAY_DECIMALS)} ft` };
}
