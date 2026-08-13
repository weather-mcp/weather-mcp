/**
 * METAR station selection and field parsing — pure functions, no I/O.
 *
 * The aviationweather.gov bbox endpoint returns every station in the box with
 * no distance field and no useful sort order (the first five latitudes of a
 * 242-station response were 42.4, 42.21, 41.88, 44.38, 40.63). Choosing which
 * station answers "what is the weather here" is therefore entirely
 * client-side, and it is the design-sensitive part of the feature: a METAR is
 * a real measurement *at an airport*, which may be far from the caller's
 * point, and observations age.
 *
 * This module mirrors how `pickChannelCell` isolates the rivers heuristic —
 * all the judgement lives here, unit-tested without HTTP. Fetching, including
 * the bbox tier widening, is the caller's job; `SEARCH_TIERS` below is the
 * ladder it should walk.
 *
 * See docs/metar-plan.md D3 (station selection) and D4 (parsing helpers).
 */

import { calculateDistance, bearingDegrees } from './distance.js';
import { windDirectionFromDegrees } from './units.js';
import type { MetarObservation } from '../types/aviationWeather.js';

/**
 * Bounding-box half-widths, in degrees, tried in order until one yields a
 * usable station. Widening exists because global coverage is thin — 0.5°
 * boxes over Nairobi, Mumbai, Amazonia, and Patagonia each returned only one
 * or two stations, while the same box over the US returned hundreds.
 *
 * Longitude degrees shrink with latitude, so high-latitude boxes over-search
 * in longitude. That is harmless: distance sorting decides the winner, and an
 * over-wide box only costs a slightly larger response.
 *
 * The ladder is exported so the handler iterates it rather than hardcoding
 * degrees; the picker itself is pure and simply scores whatever it is given.
 */
export const SEARCH_TIERS = [0.5, 2.0, 5.0] as const;

/** Observations at or below this age are preferred outright. */
export const FRESH_MAX_AGE_MINUTES = 90;

/**
 * Observations older than `FRESH_MAX_AGE_MINUTES` but within this bound are
 * accepted with a `stale` flag; anything older is not a station at all.
 */
export const STALE_MAX_AGE_MINUTES = 6 * 60;

/** At or below this distance the station renders without comment. */
export const NEAR_MAX_KM = 100;

/** Beyond this distance there is no usable station, however fresh it is. */
export const FAR_MAX_KM = 250;

/**
 * A chosen station, with everything the formatter needs to let a reader judge
 * how much the number is worth.
 */
export interface StationPick {
  /** The winning observation, passed through unchanged. */
  observation: MetarObservation;
  /** Great-circle distance from the requested point, in kilometres. */
  distanceKm: number;
  /** 16-point compass direction of the station from the requested point. */
  bearing: string;
  /** Observation age in whole minutes at `now`. */
  ageMinutes: number;
  /** True when the observation is older than 90 minutes (but within 6 hours). */
  stale: boolean;
  /** True when the station is 100-250 km away and warrants a distance caveat. */
  far: boolean;
  /** Half-width in degrees of the search tier that produced this station, when the caller supplied it. */
  tierDegrees?: number;
}

/**
 * Age of an observation in whole minutes.
 *
 * `obsTime` is epoch **seconds** — not milliseconds, and not one of the two
 * ISO strings that sit beside it in the same object. Getting this wrong
 * yields an age off by a factor of a thousand, which is the single easiest
 * bug in this feature.
 */
function ageInMinutes(observation: MetarObservation, now: Date): number {
  return (now.getTime() - observation.obsTime * 1000) / 60000;
}

/**
 * Choose the station that best answers "what is the weather at this point".
 *
 * Freshness gates, then distance decides:
 *
 * 1. **Freshness** — stations reporting within 90 minutes are preferred
 *    outright (METARs are issued hourly near :53; the live sample's oldest was
 *    49 minutes, so 90 covers the cycle plus reporting lag). Only if *no*
 *    station is fresh does the search widen to 6 hours, and those results are
 *    flagged `stale`. Older than 6 hours is not a station.
 * 2. **Distance** — within the chosen freshness pool, nearest wins. A fresher
 *    but farther station does not beat a nearer one; the age is disclosed in
 *    the output either way, and proximity is what makes the reading relevant.
 * 3. **Banding** — at or under 100 km renders normally, 100-250 km renders
 *    with a distance caveat (`far`), and beyond 250 km there is no usable
 *    station and this returns `null`.
 *
 * Ties in distance resolve to the first station in input order, so identical
 * input always produces identical output.
 *
 * @param stations - Candidate observations, in any order
 * @param latitude - Requested point latitude
 * @param longitude - Requested point longitude
 * @param now - Injectable clock, for deterministic tests
 * @param tierDegrees - Half-width of the search tier these stations came from, recorded on the result
 * @returns The chosen station, or null when none qualifies
 */
export function pickNearestStation(
  stations: MetarObservation[],
  latitude: number,
  longitude: number,
  now: Date = new Date(),
  tierDegrees?: number
): StationPick | null {
  if (stations.length === 0) {
    return null;
  }

  const scored = stations
    .map(observation => ({
      observation,
      ageMinutes: ageInMinutes(observation, now),
      distanceKm: calculateDistance(latitude, longitude, observation.lat, observation.lon)
    }))
    // Future-dated observations (clock skew) are treated as current, not discarded.
    .filter(candidate => candidate.ageMinutes <= STALE_MAX_AGE_MINUTES);

  if (scored.length === 0) {
    return null;
  }

  // Prefer the fresh pool outright; fall back to the stale pool only when
  // nothing is fresh, so a 20-minute observation is never passed over.
  const fresh = scored.filter(candidate => candidate.ageMinutes <= FRESH_MAX_AGE_MINUTES);
  const pool = fresh.length > 0 ? fresh : scored;
  const stale = fresh.length === 0;

  let best = pool[0];
  for (const candidate of pool) {
    if (candidate.distanceKm < best.distanceKm) {
      best = candidate;
    }
  }

  if (best.distanceKm > FAR_MAX_KM) {
    return null;
  }

  return {
    observation: best.observation,
    distanceKm: best.distanceKm,
    bearing: windDirectionFromDegrees(
      bearingDegrees(latitude, longitude, best.observation.lat, best.observation.lon)
    ),
    ageMinutes: Math.max(0, Math.round(best.ageMinutes)),
    stale,
    far: best.distanceKm > NEAR_MAX_KM,
    ...(tierDegrees === undefined ? {} : { tierDegrees })
  };
}

/** Visibility in statute miles, with the `"10+"` qualifier preserved rather than flattened to a bare 10. */
export interface ParsedVisibility {
  miles: number;
  qualifier?: 'plus';
}

/**
 * Parse the `visib` field, which is genuinely polymorphic: a plain number at
 * some stations, but a string at most — `"10+"` is the majority case, and
 * fractions like `"1/2"` and `"1 1/2"` appear in low visibility.
 *
 * The `"+"` matters. Reporting `"10+"` as `10` states a measurement the
 * station did not make: 10+ means "at least 10", which is the difference
 * between a ceiling and a floor.
 *
 * @returns The parsed value, or undefined when the field is absent or unparseable
 */
export function parseVisibilityMiles(v: number | string | undefined): ParsedVisibility | undefined {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? { miles: v } : undefined;
  }
  if (typeof v !== 'string') {
    return undefined;
  }

  const trimmed = v.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const qualifier = trimmed.endsWith('+') ? ('plus' as const) : undefined;
  const body = (qualifier ? trimmed.slice(0, -1) : trimmed).trim();

  // "1 1/2" — a whole part and a fraction.
  const mixed = body.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const denominator = Number(mixed[3]);
    if (denominator === 0) return undefined;
    const miles = Number(mixed[1]) + Number(mixed[2]) / denominator;
    return qualifier ? { miles, qualifier } : { miles };
  }

  // "1/2" — a bare fraction.
  const fraction = body.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return undefined;
    const miles = Number(fraction[1]) / denominator;
    return qualifier ? { miles, qualifier } : { miles };
  }

  // "10", "0.5" — a plain number, possibly with the qualifier stripped above.
  if (/^\d*\.?\d+$/.test(body)) {
    const miles = Number(body);
    if (!Number.isFinite(miles)) return undefined;
    return qualifier ? { miles, qualifier } : { miles };
  }

  return undefined;
}

/**
 * Parse the `wdir` field, which is degrees at most stations and the literal
 * `"VRB"` when the wind is variable.
 *
 * Returning `'variable'` rather than a number keeps the formatter from
 * printing a bogus compass point for a wind that has no direction.
 *
 * @returns Degrees, the string 'variable', or undefined when absent or unparseable
 */
export function parseWindDirection(v: number | string | undefined): number | 'variable' | undefined {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined;
  }
  if (typeof v !== 'string') {
    return undefined;
  }

  const trimmed = v.trim();
  if (trimmed.toUpperCase() === 'VRB') {
    return 'variable';
  }
  if (/^\d*\.?\d+$/.test(trimmed)) {
    const degrees = Number(trimmed);
    return Number.isFinite(degrees) ? degrees : undefined;
  }

  return undefined;
}
