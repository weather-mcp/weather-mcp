/**
 * Astronomy utilities — moon phase, moonrise/moonset, and extended twilight.
 *
 * All computation is local via `astronomy-engine` (±1 arcminute accuracy,
 * zero transitive dependencies) — pure, deterministic, no I/O, no caching.
 * Times are returned as Luxon DateTimes in the zone of the input date, so
 * callers pass the forecast's IANA timezone once and formatting stays simple.
 */

import * as Astronomy from 'astronomy-engine';
import { DateTime } from 'luxon';
import type { UnitPreferences } from '../config/units.js';
import { formatLuxonTime } from './unitFormat.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Astronomy facts for one calendar day at one location.
 *
 * All ten time fields are nullable: a null means the event does not occur
 * during that calendar day. For the moon this happens routinely (the moon
 * rises ~50 minutes later each day, so about once a month a day has no
 * moonrise or no moonset); for twilight it happens in polar conditions.
 */
export interface DayAstronomy {
  /** One of the 8 standard phase names (New Moon, Waxing Crescent, ...). */
  phaseName: string;
  /** Illuminated fraction of the moon's disc, 0-100. */
  illuminationPct: number;
  moonrise: DateTime | null;
  moonset: DateTime | null;
  civilDawn: DateTime | null;
  civilDusk: DateTime | null;
  nauticalDawn: DateTime | null;
  nauticalDusk: DateTime | null;
  astroDawn: DateTime | null;
  astroDusk: DateTime | null;
  /**
   * Sun altitude (degrees) at local solar noon (approximated as clock noon).
   * Used by the formatter to distinguish "polar day" (sun never descends to
   * a twilight threshold) from "polar night" (sun never ascends to it) when
   * a twilight event is missing.
   */
  sunNoonAltitude: number;
}

/** The next full and new moon instants after a given time. */
export interface NextMoonQuarters {
  nextFull: DateTime;
  nextNew: DateTime;
}

// ---------------------------------------------------------------------------
// Phase naming
// ---------------------------------------------------------------------------

/**
 * The 8 standard phase names in ecliptic-longitude order starting at 0°.
 * Buckets are centered on the principal phases (New = 0°, First Quarter =
 * 90°, Full = 180°, Third Quarter = 270°), i.e. boundaries at 22.5° + k·45°.
 */
const PHASE_NAMES = [
  'New Moon',
  'Waxing Crescent',
  'First Quarter',
  'Waxing Gibbous',
  'Full Moon',
  'Waning Gibbous',
  'Third Quarter',
  'Waning Crescent',
] as const;

/**
 * Bucket a moon phase angle (0-360°, 0 = new, 180 = full) into one of the 8
 * standard phase names. Buckets are centered on the principal phases, so the
 * date USNO labels "New Moon" reports "New Moon" here (e.g. 350° and 10° are
 * both New Moon; boundaries fall at 22.5°, 67.5°, ..., 337.5°).
 */
export function moonPhaseName(phaseAngle: number): string {
  // Normalize into [0, 360) defensively (astronomy-engine already returns this range)
  const angle = ((phaseAngle % 360) + 360) % 360;
  const index = Math.floor(((angle + 22.5) % 360) / 45);
  return PHASE_NAMES[index] ?? PHASE_NAMES[0];
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/** Twilight sun altitudes: civil −6°, nautical −12°, astronomical −18°. */
const TWILIGHT_ALTITUDES = { civil: -6, nautical: -12, astro: -18 } as const;

/**
 * Search for a rise/set-style event within one calendar day, returning the
 * result in the caller's zone, or null when the event does not occur.
 */
function toZoned(time: Astronomy.AstroTime | null, zone: string): DateTime | null {
  if (!time) {
    return null;
  }
  return DateTime.fromJSDate(time.date, { zone });
}

/**
 * Compute moon phase, moonrise/moonset, and civil/nautical/astronomical
 * dawn+dusk for the calendar day containing `date` (in `date`'s zone) at the
 * given coordinates.
 *
 * Phase and illumination are evaluated at local noon — a representative
 * instant for "the" phase of a calendar day.
 */
export function computeDayAstronomy(
  latitude: number,
  longitude: number,
  date: DateTime
): DayAstronomy {
  const zone = date.zoneName ?? 'utc';
  const dayStart = date.startOf('day');
  const noon = dayStart.plus({ hours: 12 });
  const observer = new Astronomy.Observer(latitude, longitude, 0);
  const startTime = new Astronomy.AstroTime(dayStart.toJSDate());
  const noonTime = new Astronomy.AstroTime(noon.toJSDate());

  // Moon phase + illumination at local noon
  const phaseAngle = Astronomy.MoonPhase(noonTime);
  const illumination = Astronomy.Illumination(Astronomy.Body.Moon, noonTime);

  // Moonrise / moonset within this calendar day
  const moonrise = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, +1, startTime, 1);
  const moonset = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, -1, startTime, 1);

  // Twilight: sun crossing −6° / −12° / −18°, ascending (dawn) and descending (dusk)
  const twilight = (altitude: number): { dawn: Astronomy.AstroTime | null; dusk: Astronomy.AstroTime | null } => ({
    dawn: Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, +1, startTime, 1, altitude),
    dusk: Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, -1, startTime, 1, altitude),
  });
  const civil = twilight(TWILIGHT_ALTITUDES.civil);
  const nautical = twilight(TWILIGHT_ALTITUDES.nautical);
  const astro = twilight(TWILIGHT_ALTITUDES.astro);

  // Sun altitude at local noon — lets the formatter tell polar day from polar night
  const sunEquator = Astronomy.Equator(Astronomy.Body.Sun, noonTime, observer, true, true);
  const sunHorizon = Astronomy.Horizon(noonTime, observer, sunEquator.ra, sunEquator.dec, 'normal');

  return {
    phaseName: moonPhaseName(phaseAngle),
    illuminationPct: illumination.phase_fraction * 100,
    moonrise: toZoned(moonrise, zone),
    moonset: toZoned(moonset, zone),
    civilDawn: toZoned(civil.dawn, zone),
    civilDusk: toZoned(civil.dusk, zone),
    nauticalDawn: toZoned(nautical.dawn, zone),
    nauticalDusk: toZoned(nautical.dusk, zone),
    astroDawn: toZoned(astro.dawn, zone),
    astroDusk: toZoned(astro.dusk, zone),
    sunNoonAltitude: sunHorizon.altitude,
  };
}

/**
 * Find the next full moon and next new moon after `from`.
 * Iterates the lunar quarter sequence (new=0, first=1, full=2, third=3);
 * both are always found within one synodic month (4-5 iterations).
 */
export function nextMoonQuarters(from: DateTime): NextMoonQuarters {
  const zone = from.zoneName ?? 'utc';
  let quarter = Astronomy.SearchMoonQuarter(new Astronomy.AstroTime(from.toJSDate()));
  let nextFull: DateTime | undefined;
  let nextNew: DateTime | undefined;

  while (nextFull === undefined || nextNew === undefined) {
    if (quarter.quarter === 2 && nextFull === undefined) {
      nextFull = DateTime.fromJSDate(quarter.time.date, { zone });
    }
    if (quarter.quarter === 0 && nextNew === undefined) {
      nextNew = DateTime.fromJSDate(quarter.time.date, { zone });
    }
    quarter = Astronomy.NextMoonQuarter(quarter);
  }

  return { nextFull, nextNew };
}

// ---------------------------------------------------------------------------
// Formatting (shared by both forecast provider paths — keep the strings here)
// ---------------------------------------------------------------------------

/**
 * Render a nullable event time, or the explicit polar wording when the event
 * does not occur. `polarWording` is provided for the sun-threshold fields;
 * moon rise/set gaps are a normal monthly occurrence, so they render a plain
 * "none" (see formatAstronomyBlock).
 */
function renderTime(time: DateTime | null, prefs: UnitPreferences, noneLabel: string): string {
  return time ? formatLuxonTime(time, prefs) : noneLabel;
}

/**
 * Render one twilight dawn/dusk pair. When both events are missing the pair
 * collapses to a single explicit polar label — "none (polar day)" when the
 * sun never descends to the threshold, "none (polar night)" when it never
 * ascends to it — never a silent omission.
 */
function renderTwilightPair(
  dawn: DateTime | null,
  dusk: DateTime | null,
  thresholdAltitude: number,
  sunNoonAltitude: number,
  prefs: UnitPreferences
): string {
  const polarLabel = sunNoonAltitude > thresholdAltitude ? 'none (polar day)' : 'none (polar night)';
  if (!dawn && !dusk) {
    return polarLabel;
  }
  return `${renderTime(dawn, prefs, polarLabel)} / ${renderTime(dusk, prefs, polarLabel)}`;
}

/**
 * Format the per-day astronomy block — the two lines added to each daily
 * forecast entry when `include_astronomy` is set:
 *
 *   **Moon:** Waxing Gibbous (78% illuminated) · Rise 3:42 PM · Set 1:15 AM
 *   **Twilight:** Civil 5:29 AM / 9:02 PM · Nautical 4:47 AM / 9:44 PM · Astronomical 3:58 AM / 10:33 PM
 *
 * Every field always renders: missing moon rise/set shows "none" (a normal
 * monthly occurrence at any latitude), missing twilight shows the polar
 * wording. Ends with a trailing newline.
 */
export function formatAstronomyBlock(astro: DayAstronomy, prefs: UnitPreferences): string {
  const moonLine =
    `**Moon:** ${astro.phaseName} (${Math.round(astro.illuminationPct)}% illuminated)` +
    ` · Rise ${renderTime(astro.moonrise, prefs, 'none')}` +
    ` · Set ${renderTime(astro.moonset, prefs, 'none')}`;

  const twilightLine =
    `**Twilight:** Civil ${renderTwilightPair(astro.civilDawn, astro.civilDusk, TWILIGHT_ALTITUDES.civil, astro.sunNoonAltitude, prefs)}` +
    ` · Nautical ${renderTwilightPair(astro.nauticalDawn, astro.nauticalDusk, TWILIGHT_ALTITUDES.nautical, astro.sunNoonAltitude, prefs)}` +
    ` · Astronomical ${renderTwilightPair(astro.astroDawn, astro.astroDusk, TWILIGHT_ALTITUDES.astro, astro.sunNoonAltitude, prefs)}`;

  return `${moonLine}\n${twilightLine}\n`;
}

/**
 * Format the once-per-response next-quarters line:
 *
 *   **Next full moon:** Aug 27 · **Next new moon:** Sep 11
 *
 * Dates are rendered in the forecast's IANA timezone. Ends with a trailing
 * newline.
 */
export function formatNextQuarters(quarters: NextMoonQuarters, timezone: string): string {
  const fmt = (dt: DateTime): string =>
    dt.setZone(timezone).toLocaleString({ month: 'short', day: 'numeric' });
  return `**Next full moon:** ${fmt(quarters.nextFull)} · **Next new moon:** ${fmt(quarters.nextNew)}\n`;
}
