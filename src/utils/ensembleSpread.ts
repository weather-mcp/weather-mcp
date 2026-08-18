/**
 * Single-model ensemble spread — pure functions, no I/O, no service imports.
 * Mirrors `modelComparison.ts`'s split: fetching the raw ensemble response is
 * the service's job (T2), rendering the confidence narrative is the
 * handler's job (T3); every judgement call about what the suffixed daily
 * member arrays mean lives here, unit-tested without HTTP.
 *
 * See `docs/ensemble-spread-plan.md` D4 (this module's spec), D5 (renderer
 * needs), D6 (control-run exclusion), and the Edge cases table.
 *
 * This module MAY import pure→pure from `./modelComparison.js` (three
 * symbols only: `classifyTempSpread`, `weatherCodeBucket`, `precipThreshold`)
 * but never a service, and it never logs — the 64-member defensive ceiling
 * surfaces as a returned meta flag (`truncatedMembers`); the handler is
 * responsible for the `securityEvent` warn (assumption A6).
 */

import { classifyTempSpread, weatherCodeBucket, precipThreshold } from './modelComparison.js';

/** Local re-declaration of the two band/bucket types this module classifies into — kept in sync with modelComparison.ts by construction (both are literal-string unions of the same values), not imported, since this module's import budget is limited to the three named functions above. */
export type TempSpreadBand = 'tight' | 'moderate' | 'divergent';
export type WeatherCodeBucket = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunderstorm' | 'other';

/**
 * The single fixed ensemble model this feature spreads (design non-goal:
 * caller-selectable models). ECMWF ENS 0.25° — the largest member count and
 * the strongest-regarded global ensemble (design "Upstream verification" b).
 */
export const ENSEMBLE_MODEL = 'ecmwf_ifs025' as const;

/** Display label for the header line. */
export const ENSEMBLE_MODEL_LABEL = 'ECMWF IFS 0.25° ensemble (ENS)';

/**
 * Header-display only. The parser (`extractMemberSeries`) always counts
 * members from the actual response — it never trusts this constant, since a
 * live member count can differ from what's documented upstream.
 */
export const ENSEMBLE_MEMBER_COUNT = 50;

/**
 * Local mirror of the service's `OpenMeteoEnsembleResponse.daily` shape
 * (`src/types/openmeteo.ts`, D-types). Deliberately re-declared rather than
 * imported — this module's import budget is limited to the three functions
 * above — but structurally identical, so the service's real response object
 * is assignable here without a cast.
 */
export interface RawEnsembleDaily {
  time: string[];
  [key: string]: string[] | (number | null)[] | undefined;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Defensive ceiling on parsed member series per variable (verified member count: 50; see D4). */
const MAX_MEMBER_SERIES = 64;

/**
 * Absolute scan ceiling on the member-index probe below. Defends against a
 * pathological response object whose `_memberNN` keys never run out; far
 * above any real ensemble's member count.
 */
const MEMBER_SCAN_CEILING = 1000;

export interface MemberSeriesExtraction {
  /** One series per perturbed member, in member-number order, capped at MAX_MEMBER_SERIES entries. */
  series: (number | null)[][];
  /** True when more than MAX_MEMBER_SERIES member keys were present and had to be truncated. */
  truncated: boolean;
}

/**
 * Collect `${variable}_memberNN` series from the raw ensemble response,
 * zero-padded from `member01` (verified upstream shape b). Guarded with
 * `Array.isArray` against the index-signature type. Non-numeric entries
 * (including `NaN`/`Infinity`) are coerced to `null` rather than thrown out,
 * so every member's series stays the same length as `daily.time` — the same
 * strict-safe discipline as `extractModelSeries` in `modelComparison.ts`.
 *
 * Scans a numeric member index (1, 2, 3, …) rather than a hardcoded 2-digit
 * range, so member counts past 99 would still be found — `padStart(2, '0')`
 * only guarantees the *minimum* width the upstream shape uses. Stops at the
 * first missing key. Beyond `MAX_MEMBER_SERIES` present series, further
 * series are not parsed (bounded memory) and `truncated` is set — the module
 * itself never logs; the handler emits the `securityEvent` warn (A6).
 */
export function extractMemberSeries(daily: RawEnsembleDaily, variable: string): MemberSeriesExtraction {
  const series: (number | null)[][] = [];
  let index = 1;
  while (index <= MEMBER_SCAN_CEILING) {
    const key = `${variable}_member${String(index).padStart(2, '0')}`;
    const raw = daily[key];
    if (!Array.isArray(raw)) {
      break;
    }
    if (series.length < MAX_MEMBER_SERIES) {
      series.push(raw.map(entry => (typeof entry === 'number' && Number.isFinite(entry) ? entry : null)));
    }
    index++;
  }
  const presentCount = index - 1;
  return { series, truncated: presentCount > MAX_MEMBER_SERIES };
}

/**
 * Extract the control run's series for one variable — the unsuffixed key.
 * Same coercion discipline as `extractMemberSeries`. The control run is a
 * headline reference only (D6): it is never merged into a member series and
 * so is structurally excluded from every statistic below without any
 * special-case filtering.
 */
function extractControlSeries(daily: RawEnsembleDaily, variable: string): (number | null)[] | undefined {
  const raw = daily[variable];
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw.map(entry => (typeof entry === 'number' && Number.isFinite(entry) ? entry : null));
}

function valuesAtDay(series: (number | null)[][], index: number): number[] {
  const values: number[] = [];
  for (const memberSeries of series) {
    const value = memberSeries[index];
    if (value !== null && value !== undefined) {
      values.push(value);
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface SpreadStatSummary {
  min: number;
  max: number;
  median: number;
  p25: number;
  p75: number;
  /** Number of participating (non-null) values this summary was computed from. */
  count: number;
}

/**
 * Percentile via linear interpolation between closest ranks — the
 * numpy-default convention: `rank = q * (n - 1)`, interpolate between the
 * `floor` and `ceil` ranks. Pinned for determinism; locked by unit tests in
 * `ensembleSpread.test.ts`. `sorted` must already be ascending.
 */
function percentileOf(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) {
    return 0;
  }
  const rank = q * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

/**
 * min/max/median/p25/p75 across a set of participating values (perturbed
 * members only — the control run is never included; see module doc).
 * Returns a zeroed, `count: 0` summary for an empty input rather than
 * throwing — an interior day can legitimately have zero participating
 * members for one variable while still rendering (mirrors
 * `computeStatSummary` in `modelComparison.ts`).
 */
export function computeSpreadStats(values: number[]): SpreadStatSummary {
  if (values.length === 0) {
    return { min: 0, max: 0, median: 0, p25: 0, p75: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: percentileOf(sorted, 0.5),
    p25: percentileOf(sorted, 0.25),
    p75: percentileOf(sorted, 0.75),
    count: sorted.length
  };
}

// ---------------------------------------------------------------------------
// Precipitation (project heuristic — disclosed, not a published standard)
// ---------------------------------------------------------------------------

export interface PrecipitationSpread {
  /** Members with a non-null `precipitation_sum` this day whose value meets `precipThreshold` — "predicts measurable precipitation". */
  wetCount: number;
  /** Members with a non-null `precipitation_sum` this day. */
  participantCount: number;
  /** `wetCount / participantCount`, or 0 when no member reported. */
  fraction: number;
  /**
   * Amount stats over **wet members only** — a deliberate inherited gotcha
   * from `compare_models`: including dry members pins every minimum to
   * 0.00, which misreads a confident "0.05-0.31 in" as "anywhere from
   * nothing".
   */
  amounts: SpreadStatSummary;
}

export function computePrecipitationSpread(values: number[], precipUnit: 'inch' | 'mm'): PrecipitationSpread {
  const threshold = precipThreshold(precipUnit);
  const wetValues = values.filter(value => value >= threshold);
  return {
    wetCount: wetValues.length,
    participantCount: values.length,
    fraction: values.length > 0 ? wetValues.length / values.length : 0,
    amounts: computeSpreadStats(wetValues)
  };
}

// ---------------------------------------------------------------------------
// Conditions (project heuristic — disclosed, not a WMO-published taxonomy)
// ---------------------------------------------------------------------------

const BUCKET_ORDER: WeatherCodeBucket[] = ['clear', 'cloudy', 'fog', 'rain', 'snow', 'thunderstorm', 'other'];

export interface ConditionsSpread {
  /** Modal (most common) weather-code bucket among participating members. */
  bucket: WeatherCodeBucket;
  count: number;
  participantCount: number;
  /** `count / participantCount * 100`, or 0 when no member reported. */
  percentage: number;
  /** Named only when the runner-up bucket holds >= 25% of participating members. */
  runnerUp?: { bucket: WeatherCodeBucket; count: number; percentage: number };
}

/**
 * Modal `weatherCodeBucket` across participating members, with a runner-up
 * bucket named only when it holds `>= 25%` of participants (project
 * heuristic, D4). Deterministic tie-break: `BUCKET_ORDER` is scanned in a
 * fixed order so the first bucket at the max count wins ties, mirroring
 * `buildConditionsConsensus` in `modelComparison.ts`.
 */
export function computeConditionsSpread(codes: number[]): ConditionsSpread {
  const counts = new Map<WeatherCodeBucket, number>();
  for (const code of codes) {
    const bucket = weatherCodeBucket(code);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  let bucket: WeatherCodeBucket = 'other';
  let count = -1;
  for (const candidate of BUCKET_ORDER) {
    const candidateCount = counts.get(candidate) ?? 0;
    if (candidateCount > count) {
      count = candidateCount;
      bucket = candidate;
    }
  }
  if (count < 0) {
    count = 0;
  }

  let runnerUpBucket: WeatherCodeBucket | undefined;
  let runnerUpCount = -1;
  for (const candidate of BUCKET_ORDER) {
    if (candidate === bucket) {
      continue;
    }
    const candidateCount = counts.get(candidate) ?? 0;
    if (candidateCount > runnerUpCount) {
      runnerUpCount = candidateCount;
      runnerUpBucket = candidate;
    }
  }

  const participantCount = codes.length;
  let runnerUp: ConditionsSpread['runnerUp'];
  if (runnerUpBucket !== undefined && participantCount > 0 && runnerUpCount / participantCount >= 0.25) {
    runnerUp = { bucket: runnerUpBucket, count: runnerUpCount, percentage: (runnerUpCount / participantCount) * 100 };
  }

  return {
    bucket,
    count,
    participantCount,
    percentage: participantCount > 0 ? (count / participantCount) * 100 : 0,
    runnerUp
  };
}

// ---------------------------------------------------------------------------
// Confidence (project heuristic — disclosed; this is the model's own
// certainty about itself, not cross-model agreement — hence "Confidence",
// not "Agreement" as in modelComparison.ts)
// ---------------------------------------------------------------------------

export type EnsembleConfidence = 'High' | 'Moderate' | 'Low';

/**
 * Day-level confidence label (D4). Project heuristic combination rule,
 * evaluated Low-first for consistency with `computeAgreement`'s evaluation
 * order in `modelComparison.ts` (the two branches below are mutually
 * exclusive by construction — a fraction can't be both in [0.35, 0.65] and
 * at or beyond [0.2, 0.8] — but the ordering mirrors the precedent anyway):
 *
 * - **Low**: temperature band is `divergent`, OR the wet-member fraction
 *   falls in `[0.35, 0.65]` inclusive (members roughly split on rain).
 * - **High**: temperature band is `tight` AND the wet fraction is `<= 0.2`
 *   or `>= 0.8` (members agree on both temperature and precipitation).
 * - **Moderate**: otherwise.
 */
export function computeConfidence(band: TempSpreadBand, wetFraction: number): EnsembleConfidence {
  if (band === 'divergent' || (wetFraction >= 0.35 && wetFraction <= 0.65)) {
    return 'Low';
  }
  if (band === 'tight' && (wetFraction <= 0.2 || wetFraction >= 0.8)) {
    return 'High';
  }
  return 'Moderate';
}

// ---------------------------------------------------------------------------
// Per-day assembly
// ---------------------------------------------------------------------------

export interface TemperatureSpread {
  high: SpreadStatSummary;
  low: SpreadStatSummary;
  /** Band classification of the daily-high **p25-p75 interquartile range** — not min-max (D4: the IQR is what gets rendered, so it's what gets classified). */
  band: TempSpreadBand;
}

export interface WindSpread {
  max: SpreadStatSummary;
}

/**
 * The control run's values for one day. `null` when the control's daily
 * high is null for that day — mirroring `BestMatchDay`'s null rule in
 * `modelComparison.ts` (the whole entry is omitted, not just one field).
 * `code` is the raw WMO code, never a description — the handler maps it via
 * `getWeatherDescription` at render time (assumption A5, keeps this module
 * import-lean).
 */
export interface EnsembleControlDay {
  high: number;
  low: number | null;
  code: number | null;
}

export interface EnsembleDay {
  date: string;
  control: EnsembleControlDay | null;
  /** Members reporting a non-null `temperature_2m_max` this day — the trimming anchor (mirrors modelComparison's `participantCount`). */
  participantCount: number;
  temperature: TemperatureSpread;
  precipitation: PrecipitationSpread;
  wind: WindSpread;
  conditions: ConditionsSpread;
  confidence: EnsembleConfidence;
}

function buildDay(
  index: number,
  date: string,
  tempUnit: 'F' | 'C',
  precipUnit: 'inch' | 'mm',
  highSeries: (number | null)[][],
  lowSeries: (number | null)[][],
  precipSeries: (number | null)[][],
  windSeries: (number | null)[][],
  codeSeries: (number | null)[][],
  controlHigh: (number | null)[] | undefined,
  controlLow: (number | null)[] | undefined,
  controlCode: (number | null)[] | undefined
): EnsembleDay {
  const highValues = valuesAtDay(highSeries, index);
  const lowValues = valuesAtDay(lowSeries, index);
  const precipValues = valuesAtDay(precipSeries, index);
  const windValues = valuesAtDay(windSeries, index);
  const codeValues = valuesAtDay(codeSeries, index);

  const highStats = computeSpreadStats(highValues);
  const lowStats = computeSpreadStats(lowValues);
  const band = classifyTempSpread(highStats.p75 - highStats.p25, tempUnit);

  const precipitation = computePrecipitationSpread(precipValues, precipUnit);
  const wind: WindSpread = { max: computeSpreadStats(windValues) };
  const conditions = computeConditionsSpread(codeValues);
  const confidence = computeConfidence(band, precipitation.fraction);

  const controlHighVal = controlHigh?.[index];
  const control: EnsembleControlDay | null =
    controlHighVal === null || controlHighVal === undefined
      ? null
      : { high: controlHighVal, low: controlLow?.[index] ?? null, code: controlCode?.[index] ?? null };

  return {
    date,
    control,
    participantCount: highStats.count,
    temperature: { high: highStats, low: lowStats, band },
    precipitation,
    wind,
    conditions,
    confidence
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface EnsembleSpreadResult {
  days: EnsembleDay[];
  /** Actual perturbed-member count found for `temperature_2m_max` (post-truncation), never trusted from `ENSEMBLE_MEMBER_COUNT`. */
  memberCount: number;
  /** Trailing days dropped because fewer than 2 members had a non-null `temperature_2m_max` (D4). */
  trimmedDays: number;
  /** True when any variable's member series exceeded `MAX_MEMBER_SERIES` and had to be truncated (A6: the handler logs, this module does not). */
  truncatedMembers: boolean;
}

/**
 * Build a full single-model ensemble spread from a raw ensemble `daily`
 * block (the service's `OpenMeteoEnsembleResponse.daily`, structurally
 * matching `RawEnsembleDaily`) plus the caller's temperature and
 * precipitation unit preferences.
 *
 * The control run (unsuffixed series) is extracted separately from the
 * perturbed-member series and carried through per day as a reference value
 * only (D6, mirror of `best_match` in `modelComparison.ts`) — it is never
 * merged into `highSeries`/`lowSeries`/etc., so it is structurally excluded
 * from every statistic, fraction, band, and trimming decision without any
 * special-case filtering.
 *
 * Trimming mirrors `modelComparison.ts`'s D4 level 3: trailing days with
 * fewer than 2 members reporting `temperature_2m_max` are trimmed and
 * counted (`trimmedDays`); interior gaps are retained and render with their
 * reduced participant count. Callers (the handler) are responsible for
 * treating an all-trimmed result, or a `memberCount < 2`, as unavailable
 * (D7) — this function never throws.
 */
export function buildEnsembleSpread(daily: RawEnsembleDaily, tempUnit: 'F' | 'C', precipUnit: 'inch' | 'mm'): EnsembleSpreadResult {
  const dayCount = daily.time.length;

  const highExtraction = extractMemberSeries(daily, 'temperature_2m_max');
  const lowExtraction = extractMemberSeries(daily, 'temperature_2m_min');
  const precipExtraction = extractMemberSeries(daily, 'precipitation_sum');
  const windExtraction = extractMemberSeries(daily, 'wind_speed_10m_max');
  const codeExtraction = extractMemberSeries(daily, 'weather_code');

  const truncatedMembers =
    highExtraction.truncated ||
    lowExtraction.truncated ||
    precipExtraction.truncated ||
    windExtraction.truncated ||
    codeExtraction.truncated;

  const controlHigh = extractControlSeries(daily, 'temperature_2m_max');
  const controlLow = extractControlSeries(daily, 'temperature_2m_min');
  const controlCode = extractControlSeries(daily, 'weather_code');

  const participantCounts: number[] = [];
  for (let i = 0; i < dayCount; i++) {
    participantCounts.push(valuesAtDay(highExtraction.series, i).length);
  }

  // Trim only from the end: interior gaps (fewer than 2 participants in the
  // middle of the range, with valid days after) are retained per D4.
  let lastValidIndex = dayCount - 1;
  while (lastValidIndex >= 0 && participantCounts[lastValidIndex] < 2) {
    lastValidIndex--;
  }
  const trimmedDays = dayCount - 1 - lastValidIndex;

  const days: EnsembleDay[] = [];
  for (let i = 0; i <= lastValidIndex; i++) {
    days.push(
      buildDay(
        i,
        daily.time[i],
        tempUnit,
        precipUnit,
        highExtraction.series,
        lowExtraction.series,
        precipExtraction.series,
        windExtraction.series,
        codeExtraction.series,
        controlHigh,
        controlLow,
        controlCode
      )
    );
  }

  return {
    days,
    memberCount: highExtraction.series.length,
    trimmedDays,
    truncatedMembers
  };
}
