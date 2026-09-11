/**
 * Pure daily aggregation for MET Norway's Locationforecast `complete` product.
 *
 * Zero network, zero caching: a parsed response in, a typed daily aggregate (or
 * a thrown, fixed, sanitized message) out. The service layer owns fetching,
 * conditional revalidation and the contract-vs-garnish decision; this module
 * owns every shape and size constant and every aggregation decision. The
 * service imports the constants from here, never the reverse
 * (`src/utils/jmaParse.ts` is the in-repo precedent).
 *
 * **met.no publishes no daily product.** Daily values are aggregated from
 * `properties.timeseries`, and three properties of that series — all measured
 * live 2026-09-03 at Oslo, Tokyo and Denver, recorded in
 * `.devdocs/plan-metno-fallback.md` D3 — make the aggregation less obvious than
 * it looks:
 *
 * 1. **The series step changes partway through, and the seam moves by
 *    location** — h+53 at Oslo, h+65 at Tokyo and Denver, so 2.2 to 2.7 days
 *    rather than the ~3 days earlier research recorded. The step is therefore
 *    read from the timestamps, per entry, as the gap to the *next* entry. A
 *    hard-coded index or a hard-coded day count is wrong.
 * 2. **One rendered temperature column is fed by two upstream sources.**
 *    `next_1_hours.details` is precipitation-only and carries no temperature at
 *    all; only `next_6_hours` / `next_12_hours` carry `air_temperature_max` and
 *    `_min`. Inside the hourly segment the daily extremes therefore come from
 *    `instant.air_temperature`, and beyond the seam from the window extrema.
 *    Which source fed a day is returned on the day (`temperatureBasis`) rather
 *    than rendered here.
 * 3. **The final entry carries no aggregation window at all.** A loop that
 *    assumes every entry has a `next_*` block emits a degenerate final day, so
 *    coverage is accumulated per day and incomplete trailing days are dropped.
 *
 * **This module computes in SI and returns SI.** It does not round, does not
 * band and does not convert: the caller's unit preferences are not its business
 * and the conversion and the rounding both happen once, at the render site
 * (G69). Nothing here imports `src/utils/unitFormat.ts`.
 *
 * **Every numeric field is read through `finiteNumber`.** met.no encodes "not
 * recorded" as JSON `null`, which survives a `!== undefined` guard and then
 * coerces to `0` in arithmetic — the shape behind the v1.20.0 F1 bug and the
 * normals-averaging bug. A real `0 °C` is a valid reading and must survive, so
 * the guard tests for a finite number rather than for truthiness (G56).
 */

import { DateTime } from 'luxon';
import { logger } from './logger.js';
import type {
  MetnoForecastResponse,
  MetnoTimeseriesEntry,
} from '../types/metno.js';

/**
 * Maximum accepted byte size of a Locationforecast response.
 *
 * Mirrors `JMA_MAX_DOCUMENT_BYTES`. The service records the payload it actually
 * observed in its own `maxContentLength` comment, so the cap is known to sit
 * above a measured figure rather than at a default.
 */
export const METNO_MAX_RESPONSE_BYTES = 2_000_000;

/**
 * Maximum number of `properties.timeseries` entries aggregated from one
 * response.
 *
 * Defence in depth, not a working limit: the series ran to 85-92 entries at the
 * three points measured for D3, so ~5x headroom bounds the loop against a
 * pathological response without ever trimming a real one. The run's live
 * verification re-measures the entry count per probe and records it.
 *
 * A trim is disclosed, never silent — and it trims a render list, it is never
 * used as a membership test (G8).
 */
export const METNO_MAX_TIMESERIES_ENTRIES = 500;

/** A local day is complete when published windows cover this many of its hours. */
const HOURS_PER_DAY = 24;

/** Local hour a day's representative `symbol_code` is chosen closest to. */
const REPRESENTATIVE_HOUR = 12;

/** Which upstream field(s) fed a day's rendered min/max — see the seam note above. */
export type MetnoTemperatureBasis = 'instant' | 'window' | 'mixed';

/** One aggregated local day. Every value is SI and unrounded. */
export interface MetnoDailyForecast {
  /** Local calendar date, `YYYY-MM-DD`, in the timezone this aggregate was built for. */
  date: string;
  /** ISO timestamp of the first entry attributed to this day, in that timezone. */
  startsAt: string;
  /** Hours of the day covered by published aggregation windows. */
  hoursCovered: number;
  /** `hoursCovered` reaches a whole day. A leading partial day is kept; see `aggregateMetnoDaily`. */
  complete: boolean;
  /** Highest temperature, °C. */
  temperatureMaxC?: number;
  /** Lowest temperature, °C. */
  temperatureMinC?: number;
  /** Which source(s) fed the two fields above. Absent when neither was published. */
  temperatureBasis?: MetnoTemperatureBasis;
  /** Total precipitation, mm, summed over this day's non-overlapping windows. */
  precipitationMm?: number;
  /** Highest published probability of precipitation, percent. */
  precipitationProbabilityMaxPct?: number;
  /** Highest published probability of thunder, percent. */
  thunderProbabilityMaxPct?: number;
  /** Highest instantaneous wind speed, m/s. */
  windSpeedMaxMps?: number;
  /** Wind direction at the strongest instantaneous reading, degrees from north. */
  windFromDirectionDeg?: number;
  /** met.no's own `symbol_code` for the window nearest local midday. Not a WMO code. */
  symbolCode?: string;
}

/** The whole aggregate. */
export interface MetnoDailyAggregate {
  /** The timezone every `date` and `startsAt` above is expressed in. */
  timezone: string;
  /** The days served, in ascending order, trailing incomplete days already dropped. */
  days: MetnoDailyForecast[];
  /** How many of `days` cover a whole day. Never larger than `days.length`. */
  completeDayCount: number;
  /** Entries the response carried, before any trim. */
  entriesSeen: number;
  /** Entries actually aggregated, after the trim and after unusable timestamps were skipped. */
  entriesAggregated: number;
  /** The response carried more than `METNO_MAX_TIMESERIES_ENTRIES` and was trimmed. */
  entriesTrimmed: boolean;
}

/**
 * A finite number, or `undefined`.
 *
 * `!= null` rather than `!== undefined`, because met.no's missing-data encoding
 * is JSON `null` — which `!== undefined` admits, after which it coerces to `0`
 * in arithmetic and a missing reading becomes a real-looking `0 °C`. A genuine
 * `0` is a valid temperature and survives this guard, which is why the test is
 * for finiteness and not for truthiness (G56).
 */
function finiteNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The union of fields this module reads out of any aggregation block.
 *
 * Both `MetnoOneHourDetails` and `MetnoSixHourDetails` are structurally
 * assignable to it, so the two blocks share one reader without a cast — and the
 * fields one of them never publishes simply read as absent, which is the same
 * answer as "not recorded". Whether a block *may* carry temperature is decided
 * by `carriesTemperature` below, never by whether the field happened to parse.
 */
interface WindowDetails {
  precipitation_amount?: number | null;
  probability_of_precipitation?: number | null;
  probability_of_thunder?: number | null;
  air_temperature_max?: number | null;
  air_temperature_min?: number | null;
}

/** One entry, with its timestamp resolved and its own aggregation window derived. */
interface PreparedEntry {
  entry: MetnoTimeseriesEntry;
  /** Epoch ms of the entry's own timestamp. */
  epochMs: number;
  /** Local `YYYY-MM-DD` the entry's window is attributed to. */
  date: string;
  /** ISO timestamp in the requested zone. */
  localIso: string;
  /** Local hour of day, for the representative-symbol pick. */
  localHour: number;
  /** Hours to the next entry — 0 for the final entry, which has no window. */
  windowHours: number;
}

/**
 * The aggregation window this entry actually owns, chosen by the step read from
 * the timestamps.
 *
 * This is the whole reason the step is derived rather than assumed. Inside the
 * hourly segment every entry carries **both** `next_1_hours` and
 * `next_6_hours`, and the 6-hour windows of consecutive hourly entries overlap
 * five-sixths of the way. Summing `next_6_hours.precipitation_amount` across
 * hourly entries counts every millimetre six times; reading `next_1_hours`
 * beyond the seam undercounts it by the same factor. Matching the window to the
 * step is what keeps the sum a sum.
 *
 * An unrecognised step yields no window rather than a guess.
 */
function windowFor(prepared: PreparedEntry): {
  details?: WindowDetails;
  symbolCode?: string;
  carriesTemperature: boolean;
} | undefined {
  const data = prepared.entry.data;
  if (!data) return undefined;

  if (prepared.windowHours === 1) {
    const period = data.next_1_hours;
    if (!period) return undefined;
    // Precipitation-only: this block carries no temperature field at all, so
    // the hourly segment's extremes come from `instant` instead.
    return {
      ...(period.details ? { details: period.details } : {}),
      ...(period.summary?.symbol_code ? { symbolCode: period.summary.symbol_code } : {}),
      carriesTemperature: false,
    };
  }
  if (prepared.windowHours === 6 || prepared.windowHours === 12) {
    const period = prepared.windowHours === 6 ? data.next_6_hours : data.next_12_hours;
    if (!period) return undefined;
    return {
      ...(period.details ? { details: period.details } : {}),
      ...(period.summary?.symbol_code ? { symbolCode: period.summary.symbol_code } : {}),
      carriesTemperature: true,
    };
  }
  return undefined;
}

/**
 * Aggregate a Locationforecast response into local days.
 *
 * **Attribution is by window start.** Every value an entry publishes is
 * attributed to the local day its own timestamp falls in, including a window
 * that runs past local midnight. Splitting a window would be exact for a sum
 * and meaningless for a min/max, so one rule is applied to all of them and
 * stated here rather than varying by field.
 *
 * **A leading partial day is kept; trailing partial days are dropped.** The
 * series begins at the current hour by construction, so the first local day is
 * always short — that is "today", which every forecast product carries, and
 * dropping it would answer a different question than the caller asked. The
 * trailing partial day is the artifact D3 names: the final entry has no window,
 * so the last day's coverage falls short and it is removed. Both cases are
 * decided by the same accumulated-coverage test rather than by position, and
 * `complete` plus `hoursCovered` ride on every day so the render site can
 * disclose rather than having a sentence baked in here.
 *
 * Throws a fixed message when the response cannot be aggregated at all. A
 * response that parsed but carries no usable series is a *shape* failure, not
 * "no forecast" — and this path exists to answer an outage, so an empty-looking
 * success would be the worst possible answer.
 *
 * @param response The parsed Locationforecast body.
 * @param timezone An IANA zone the days are expressed in.
 */
export function aggregateMetnoDaily(
  response: MetnoForecastResponse,
  timezone: string
): MetnoDailyAggregate {
  const zone = DateTime.local().setZone(timezone);
  if (!zone.isValid) {
    throw new Error('MET Norway forecast requested for an unrecognized timezone');
  }

  const series = response.properties?.timeseries;
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error('MET Norway forecast carries no timeseries');
  }

  const entriesSeen = series.length;
  const entriesTrimmed = entriesSeen > METNO_MAX_TIMESERIES_ENTRIES;
  if (entriesTrimmed) {
    logger.warn('MET Norway timeseries exceeds max entries', {
      service: 'MetNo',
      length: entriesSeen,
      maxEntries: METNO_MAX_TIMESERIES_ENTRIES,
      securityEvent: true,
    });
  }
  const bounded = entriesTrimmed ? series.slice(0, METNO_MAX_TIMESERIES_ENTRIES) : series;

  // Resolve every timestamp first, then sort: the step is derived from the gap
  // to the next entry, so an out-of-order feed would otherwise produce negative
  // and overlong windows. met.no publishes in order; this does not rely on it.
  const timed = bounded
    .map(entry => {
      const parsed = typeof entry.time === 'string'
        ? DateTime.fromISO(entry.time, { zone: 'utc' })
        : undefined;
      return parsed?.isValid ? { entry, epochMs: parsed.toMillis() } : undefined;
    })
    .filter((value): value is { entry: MetnoTimeseriesEntry; epochMs: number } => value !== undefined)
    .sort((a, b) => a.epochMs - b.epochMs);

  if (timed.length === 0) {
    throw new Error('MET Norway forecast carries no readable timestamps');
  }

  const prepared: PreparedEntry[] = timed.map((item, index) => {
    const next = timed[index + 1];
    // The final entry has no next entry and, as measured at all three D3
    // points, no aggregation window of its own: its window is zero hours.
    const windowHours = next ? (next.epochMs - item.epochMs) / 3_600_000 : 0;
    const local = DateTime.fromMillis(item.epochMs, { zone: 'utc' }).setZone(timezone);
    return {
      entry: item.entry,
      epochMs: item.epochMs,
      date: local.toISODate() ?? '',
      localIso: local.toISO() ?? '',
      localHour: local.hour,
      windowHours,
    };
  });

  const byDate = new Map<string, PreparedEntry[]>();
  for (const item of prepared) {
    if (!item.date) continue;
    const bucket = byDate.get(item.date);
    if (bucket) bucket.push(item);
    else byDate.set(item.date, [item]);
  }

  const days: MetnoDailyForecast[] = [...byDate.keys()]
    .sort()
    .map(date => buildDay(date, byDate.get(date) ?? []));

  // Trailing partial days go, however many there are; the leading one stays.
  while (days.length > 0 && days[days.length - 1]?.complete === false) {
    days.pop();
  }

  if (days.length === 0) {
    throw new Error('MET Norway forecast covers no complete day');
  }

  return {
    timezone,
    days,
    completeDayCount: days.filter(day => day.complete).length,
    entriesSeen,
    entriesAggregated: prepared.length,
    entriesTrimmed,
  };
}

/** Fold one local day's entries into a single record. */
function buildDay(date: string, entries: PreparedEntry[]): MetnoDailyForecast {
  let hoursCovered = 0;
  let temperatureMaxC: number | undefined;
  let temperatureMinC: number | undefined;
  let fedByInstant = false;
  let fedByWindow = false;
  let precipitationMm: number | undefined;
  let precipitationProbabilityMaxPct: number | undefined;
  let thunderProbabilityMaxPct: number | undefined;
  let windSpeedMaxMps: number | undefined;
  let windFromDirectionDeg: number | undefined;
  let symbolCode: string | undefined;
  let symbolDistance = Number.POSITIVE_INFINITY;

  for (const item of entries) {
    const instant = item.entry.data?.instant?.details;

    // An instant reading is a real observation at that moment and is a
    // candidate on every entry, on both sides of the seam.
    const airTemperature = finiteNumber(instant?.air_temperature);
    if (airTemperature !== undefined) {
      fedByInstant = true;
      temperatureMaxC = temperatureMaxC === undefined
        ? airTemperature
        : Math.max(temperatureMaxC, airTemperature);
      temperatureMinC = temperatureMinC === undefined
        ? airTemperature
        : Math.min(temperatureMinC, airTemperature);
    }

    const windSpeed = finiteNumber(instant?.wind_speed);
    if (windSpeed !== undefined && (windSpeedMaxMps === undefined || windSpeed > windSpeedMaxMps)) {
      windSpeedMaxMps = windSpeed;
      const direction = finiteNumber(instant?.wind_from_direction);
      windFromDirectionDeg = direction;
    }

    const window = windowFor(item);
    if (!window) continue;

    hoursCovered += item.windowHours;

    if (window.symbolCode !== undefined) {
      const distance = Math.abs(item.localHour - REPRESENTATIVE_HOUR);
      if (distance < symbolDistance) {
        symbolDistance = distance;
        symbolCode = window.symbolCode;
      }
    }

    const details = window.details;
    if (!details) continue;

    const precipitation = finiteNumber(details.precipitation_amount);
    if (precipitation !== undefined) {
      precipitationMm = (precipitationMm ?? 0) + precipitation;
    }

    const probability = finiteNumber(details.probability_of_precipitation);
    if (
      probability !== undefined &&
      (precipitationProbabilityMaxPct === undefined || probability > precipitationProbabilityMaxPct)
    ) {
      precipitationProbabilityMaxPct = probability;
    }

    const thunder = finiteNumber(details.probability_of_thunder);
    if (
      thunder !== undefined &&
      (thunderProbabilityMaxPct === undefined || thunder > thunderProbabilityMaxPct)
    ) {
      thunderProbabilityMaxPct = thunder;
    }

    // Only a window that actually carries temperature contributes extrema. A
    // `next_1_hours` block never does, so a hourly-only day never fabricates a
    // high or a low from a precipitation block.
    if (!window.carriesTemperature) continue;

    const windowMax = finiteNumber(details.air_temperature_max);
    if (windowMax !== undefined) {
      fedByWindow = true;
      temperatureMaxC = temperatureMaxC === undefined
        ? windowMax
        : Math.max(temperatureMaxC, windowMax);
    }
    const windowMin = finiteNumber(details.air_temperature_min);
    if (windowMin !== undefined) {
      fedByWindow = true;
      temperatureMinC = temperatureMinC === undefined
        ? windowMin
        : Math.min(temperatureMinC, windowMin);
    }
  }

  const temperatureBasis: MetnoTemperatureBasis | undefined =
    fedByInstant && fedByWindow ? 'mixed'
      : fedByWindow ? 'window'
        : fedByInstant ? 'instant'
          : undefined;

  const first = entries[0];
  return {
    date,
    startsAt: first ? first.localIso : '',
    hoursCovered,
    complete: hoursCovered >= HOURS_PER_DAY,
    ...(temperatureMaxC !== undefined ? { temperatureMaxC } : {}),
    ...(temperatureMinC !== undefined ? { temperatureMinC } : {}),
    ...(temperatureBasis !== undefined ? { temperatureBasis } : {}),
    ...(precipitationMm !== undefined ? { precipitationMm } : {}),
    ...(precipitationProbabilityMaxPct !== undefined ? { precipitationProbabilityMaxPct } : {}),
    ...(thunderProbabilityMaxPct !== undefined ? { thunderProbabilityMaxPct } : {}),
    ...(windSpeedMaxMps !== undefined ? { windSpeedMaxMps } : {}),
    ...(windFromDirectionDeg !== undefined ? { windFromDirectionDeg } : {}),
    ...(symbolCode !== undefined ? { symbolCode } : {}),
  };
}

/**
 * met.no's `symbol_code` vocabulary, without its time-of-day suffix.
 *
 * These are **not** WMO codes, so `OpenMeteoService.getWeatherDescription`
 * cannot be reused and is not called from here. The table is keyed on the base
 * code and the `_day` / `_night` / `_polartwilight` suffix is stripped before
 * lookup, so the three variants of one condition share one row rather than
 * tripling the table.
 *
 * Two keys carry met.no's own double-`s` spellings
 * (`lightssleetshowersandthunder`, `lightssnowshowersandthunder`), which appear
 * that way in its published legend. They are kept verbatim beside the singular
 * forms rather than corrected, because the key has to match what the wire
 * sends.
 */
const METNO_SYMBOL_GLOSS: Record<string, string> = {
  clearsky: 'Clear sky',
  fair: 'Fair',
  partlycloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',

  lightrain: 'Light rain',
  rain: 'Rain',
  heavyrain: 'Heavy rain',
  lightrainandthunder: 'Light rain and thunder',
  rainandthunder: 'Rain and thunder',
  heavyrainandthunder: 'Heavy rain and thunder',

  lightrainshowers: 'Light rain showers',
  rainshowers: 'Rain showers',
  heavyrainshowers: 'Heavy rain showers',
  lightrainshowersandthunder: 'Light rain showers and thunder',
  rainshowersandthunder: 'Rain showers and thunder',
  heavyrainshowersandthunder: 'Heavy rain showers and thunder',

  lightsleet: 'Light sleet',
  sleet: 'Sleet',
  heavysleet: 'Heavy sleet',
  lightsleetandthunder: 'Light sleet and thunder',
  sleetandthunder: 'Sleet and thunder',
  heavysleetandthunder: 'Heavy sleet and thunder',

  lightsleetshowers: 'Light sleet showers',
  sleetshowers: 'Sleet showers',
  heavysleetshowers: 'Heavy sleet showers',
  lightssleetshowersandthunder: 'Light sleet showers and thunder',
  sleetshowersandthunder: 'Sleet showers and thunder',
  heavysleetshowersandthunder: 'Heavy sleet showers and thunder',

  lightsnow: 'Light snow',
  snow: 'Snow',
  heavysnow: 'Heavy snow',
  lightsnowandthunder: 'Light snow and thunder',
  snowandthunder: 'Snow and thunder',
  heavysnowandthunder: 'Heavy snow and thunder',

  lightsnowshowers: 'Light snow showers',
  snowshowers: 'Snow showers',
  heavysnowshowers: 'Heavy snow showers',
  lightssnowshowersandthunder: 'Light snow showers and thunder',
  snowshowersandthunder: 'Snow showers and thunder',
  heavysnowshowersandthunder: 'Heavy snow showers and thunder',
};

/** The time-of-day suffixes met.no appends to a base symbol code. */
const SYMBOL_SUFFIXES = ['_polartwilight', '_night', '_day'];

/**
 * An English gloss for a met.no `symbol_code`.
 *
 * **An unmapped code comes back verbatim.** met.no may add vocabulary at any
 * time, and a code the reader can look up is strictly better than a blank or a
 * thrown error on a path that exists to answer an outage.
 */
export function describeMetnoSymbol(symbolCode: string): string {
  let base = symbolCode;
  for (const suffix of SYMBOL_SUFFIXES) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }
  return METNO_SYMBOL_GLOSS[base] ?? symbolCode;
}
