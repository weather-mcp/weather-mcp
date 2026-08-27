/**
 * Multi-model forecast comparison — pure functions, no I/O, zero imports.
 * Mirrors the `fireWeather.ts`/`firmsHotspots.ts` precedent: fetching the
 * multi-model Open-Meteo response is the service's job (T2), rendering the
 * agreement narrative is the handler's job (T3); every judgement call about
 * what the suffixed daily arrays mean lives here, unit-tested without HTTP.
 *
 * See `docs/multi-model-comparison-plan.md` D4 (this module's spec), D6
 * (best_match exclusion), and the Edge cases table.
 *
 * `COMPARISON_MODELS` is the single source of truth for the curated model
 * set — the service (`src/services/openmeteo.ts`) imports it from here
 * rather than the reverse, because this module must never import a service
 * (design D4 vs D3 reconciliation, implementation-plan assumption A1).
 *
 * `best_match` is the reference member of `COMPARISON_MODELS`: it renders as
 * the headline "Best match" line but is excluded from every statistic, band,
 * participation count, and trimming decision (D6) — it is Open-Meteo's own
 * blend of (largely) these same models, not an independent member, and
 * including it would double-count and artificially tighten every spread.
 */

/**
 * Curated set of Open-Meteo daily models requested for a comparison, in
 * request order. `best_match` is the reference member (D6); the other five
 * — `gfs_seamless` (NOAA/NCEP), `ecmwf_ifs025` (ECMWF), `icon_seamless`
 * (DWD), `gem_seamless` (ECCC), `ukmo_seamless` (UK Met Office) — are the
 * "comparison models" that participate in every statistic below.
 */
export const COMPARISON_MODELS = [
  'best_match',
  'gfs_seamless',
  'ecmwf_ifs025',
  'icon_seamless',
  'gem_seamless',
  'ukmo_seamless'
] as const;

export type ComparisonModel = (typeof COMPARISON_MODELS)[number];

/** The six daily variables a comparison request fetches per model (D3/D4). */
const REQUESTED_VARIABLES = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max'
] as const;

/**
 * Local mirror of `OpenMeteoModelComparisonDaily` (`src/types/openmeteo.ts`,
 * D-types). Deliberately re-declared rather than imported — this module has
 * zero imports by design — but structurally identical, so the service's real
 * response object is assignable here without a cast.
 */
export interface RawModelComparisonDaily {
  time: string[];
  [key: string]: string[] | (number | null)[] | undefined;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract one model's series for one daily variable from the suffixed
 * multi-model response, e.g. `temperature_2m_max_gfs_seamless`. Guarded with
 * `Array.isArray` against the index-signature type (the key may be absent, or
 * present as the `time: string[]` shape for an unrelated key collision, which
 * cannot happen here but the guard is what keeps this TypeScript-strict-safe
 * without a cast). Non-numeric entries (including `NaN`/`Infinity`, which
 * `typeof` alone would not catch) are coerced to `null` rather than thrown
 * out, so every model's series stays the same length as `daily.time`.
 */
export function extractModelSeries(
  daily: RawModelComparisonDaily,
  variable: string,
  model: string
): (number | null)[] | undefined {
  const raw = daily[`${variable}_${model}`];
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw.map(entry => (typeof entry === 'number' && Number.isFinite(entry) ? entry : null));
}

/** True when every requested variable is entirely null (or absent) for a model — the all-null-200 mode (D4 level 1). */
function isModelAllNull(daily: RawModelComparisonDaily, model: string): boolean {
  for (const variable of REQUESTED_VARIABLES) {
    const series = extractModelSeries(daily, variable, model);
    if (series !== undefined && series.some(value => value !== null)) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface StatSummary {
  min: number;
  max: number;
  range: number;
  median: number;
  /** Number of participating (non-null) values this summary was computed from. */
  count: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Min/max/range/median across a set of participating values. Returns a
 * zeroed, `count: 0` summary for an empty input rather than throwing — an
 * interior day can legitimately have zero participating models for one
 * variable while still rendering (D4 level 3, interior gaps retained).
 */
export function computeStatSummary(values: number[]): StatSummary {
  if (values.length === 0) {
    return { min: 0, max: 0, range: 0, median: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return { min, max, range: max - min, median: median(values), count: values.length };
}

// ---------------------------------------------------------------------------
// Bands (project heuristics — disclosed, not published standards)
// ---------------------------------------------------------------------------

export type TempSpreadBand = 'tight' | 'moderate' | 'divergent';

function bandRank(band: TempSpreadBand): number {
  return band === 'tight' ? 0 : band === 'moderate' ? 1 : 2;
}

/**
 * Classify a daily-high temperature spread (max - min across participating
 * comparison models, `best_match` excluded per D6) into an agreement band.
 *
 * **Project heuristic, not a published meteorological standard** (Fosberg
 * banding precedent, `fireWeather.ts`): `<= 4 F` (`<= 2.2 C`) tight,
 * `<= 8 F` (`<= 4.4 C`) moderate, else divergent. The Celsius thresholds are
 * independently rounded scale equivalents for band-width judgment, not exact
 * unit conversions of the Fahrenheit width.
 */
export function classifyTempSpread(range: number, tempUnit: 'F' | 'C'): TempSpreadBand {
  const tightThreshold = tempUnit === 'C' ? 2.2 : 4;
  const moderateThreshold = tempUnit === 'C' ? 4.4 : 8;
  if (range <= tightThreshold) return 'tight';
  if (range <= moderateThreshold) return 'moderate';
  return 'divergent';
}

/**
 * Minimum daily precipitation sum for a model to count as "predicts
 * measurable precipitation" (D4). **Project heuristic threshold**, chosen to
 * exclude trace/rounding noise near zero: `>= 0.01 in` under imperial prefs,
 * `>= 0.25 mm` under metric — these are independently chosen round numbers
 * per unit, not a unit conversion of each other.
 */
export function precipThreshold(precipUnit: 'inch' | 'mm'): number {
  return precipUnit === 'mm' ? 0.25 : 0.01;
}

export type WeatherCodeBucket = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunderstorm' | 'other';

/**
 * Bucket a WMO daily weather code into a coarse category for consensus
 * display. **Project heuristic grouping**, not a WMO-published taxonomy:
 * clear (0-1), cloudy (2-3), fog (45, 48), rain (51-67, 80-82), snow (71-77,
 * 85-86), thunderstorm (95-99); anything else buckets to `other`.
 */
export function weatherCodeBucket(code: number): WeatherCodeBucket {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunderstorm';
  return 'other';
}

export type AgreementLabel = 'Good' | 'Moderate' | 'Low';

/**
 * Day-level agreement label (D4). **Project heuristic combination rule**:
 * `Low` when the temperature band is divergent OR precipitation is split at
 * least 2-vs-2 among participating models; `Good` when temperature is tight
 * AND precipitation is unanimous (all wet or all dry, including "no wet
 * models"); `Moderate` otherwise. `Low` is checked first, so a
 * divergent-but-unanimous-precip day still reads `Low`.
 */
function computeAgreement(band: TempSpreadBand, wetCount: number, wetParticipantCount: number): AgreementLabel {
  const precipSplit = wetCount >= 2 && wetParticipantCount - wetCount >= 2;
  if (band === 'divergent' || precipSplit) return 'Low';
  const precipUnanimous = wetCount === 0 || wetCount === wetParticipantCount;
  if (band === 'tight' && precipUnanimous) return 'Good';
  return 'Moderate';
}

// ---------------------------------------------------------------------------
// Per-day assembly
// ---------------------------------------------------------------------------

export interface ModelValue {
  model: string;
  value: number;
}

export interface BestMatchDay {
  high: number;
  low: number | null;
  code: number | null;
}

export interface TemperatureComparison {
  high: StatSummary;
  low: StatSummary;
  /** Band classification of the daily-high spread (`high.range`). */
  band: TempSpreadBand;
  /**
   * Named outlier model ("driven by X"), set only when the band is
   * `divergent` AND removing the candidate (farthest-from-others'-median
   * high) drops the band at least one level. Otherwise undefined, and
   * `outlierUnnamed` signals the unnamed "models broadly split" case.
   */
  outlierModel?: string;
  outlierUnnamed: boolean;
  /** Per-model daily-high values, for `detail: "full"` rendering. */
  perModelHigh: ModelValue[];
  /** Per-model daily-low values, for `detail: "full"` rendering. */
  perModelLow: ModelValue[];
}

export interface PrecipitationComparison {
  /** Models predicting measurable precipitation (>= threshold, see `precipThreshold`). */
  wetCount: number;
  /** Models with a non-null `precipitation_sum` for this day. */
  wetParticipantCount: number;
  sum: StatSummary;
  /** Undefined when no participating model published a probability value that day (e.g. UKMO, every day). */
  probability?: StatSummary;
  perModelSum: ModelValue[];
  perModelProbability: ModelValue[];
}

export interface WindComparison {
  max: StatSummary;
  perModel: ModelValue[];
}

export interface ConditionsComparison {
  /** Modal (most common) weather-code bucket among participating models. */
  bucket: WeatherCodeBucket;
  count: number;
  participantCount: number;
  /** Up to 2 non-modal models, named with their raw WMO code (never a description — A4). */
  dissenters: { model: string; code: number }[];
  perModel: { model: string; code: number }[];
}

export interface DayComparison {
  date: string;
  /** Null when best_match's daily high is null for this day — the Best-match line is omitted (D6). */
  bestMatch: BestMatchDay | null;
  /** Comparison models (best_match excluded) with a non-null `temperature_2m_max` this day — the trimming anchor (D4 level 3 / A5). */
  participantCount: number;
  /** Size of the curated comparison set (5), for "(N of 5 models)" headings. */
  totalModels: number;
  temperature: TemperatureComparison;
  precipitation: PrecipitationComparison;
  wind: WindComparison;
  conditions: ConditionsComparison;
  agreement: AgreementLabel;
}

export interface ModelComparisonResult {
  days: DayComparison[];
  /** Comparison models dropped before any stats because every requested variable was entirely null (D4 level 1). */
  droppedModels: string[];
  /** Trailing days dropped because fewer than 2 comparison models had a non-null `temperature_2m_max` (D4 level 3). */
  trimmedDays: number;
  /** Size of the curated comparison set (5) before any drops. */
  totalModels: number;
}

function valuesAtIndex(seriesByModel: Record<string, (number | null)[]>, models: readonly string[], index: number): ModelValue[] {
  const result: ModelValue[] = [];
  for (const model of models) {
    const value = seriesByModel[model][index];
    if (value !== null && value !== undefined) {
      result.push({ model, value });
    }
  }
  return result;
}

/**
 * Candidate outlier: the participating model whose daily high is farthest
 * from the median of the *other* participating models' highs (D4). Requires
 * at least 2 values to be meaningful.
 */
function findOutlierCandidate(values: ModelValue[]): ModelValue | undefined {
  if (values.length < 2) return undefined;
  let best: (ModelValue & { diff: number }) | undefined;
  for (const { model, value } of values) {
    const others = values.filter(v => v.model !== model).map(v => v.value);
    const diff = Math.abs(value - median(others));
    if (!best || diff > best.diff) {
      best = { model, value, diff };
    }
  }
  return best ? { model: best.model, value: best.value } : undefined;
}

function buildConditionsConsensus(codeValues: ModelValue[], models: readonly string[]): ConditionsComparison {
  const bucketByModel = new Map<string, WeatherCodeBucket>();
  const bucketCounts = new Map<WeatherCodeBucket, number>();
  for (const { model, value } of codeValues) {
    const bucket = weatherCodeBucket(value);
    bucketByModel.set(model, bucket);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }

  // Deterministic tie-break: strict `>` while scanning models in
  // COMPARISON_MODELS order means the first-encountered bucket wins ties.
  let modalBucket: WeatherCodeBucket = 'other';
  let modalCount = -1;
  for (const model of models) {
    const bucket = bucketByModel.get(model);
    if (bucket === undefined) continue;
    const count = bucketCounts.get(bucket) ?? 0;
    if (count > modalCount) {
      modalCount = count;
      modalBucket = bucket;
    }
  }

  const dissenters: { model: string; code: number }[] = [];
  for (const { model, value } of codeValues) {
    if (bucketByModel.get(model) !== modalBucket) {
      dissenters.push({ model, code: value });
    }
  }

  return {
    bucket: modalBucket,
    count: modalCount < 0 ? 0 : modalCount,
    participantCount: codeValues.length,
    dissenters: dissenters.slice(0, 2),
    perModel: codeValues.map(v => ({ model: v.model, code: v.value }))
  };
}

interface DaySeriesBag {
  high: Record<string, (number | null)[]>;
  low: Record<string, (number | null)[]>;
  precip: Record<string, (number | null)[]>;
  prob: Record<string, (number | null)[]>;
  wind: Record<string, (number | null)[]>;
  code: Record<string, (number | null)[]>;
  bestMatchHigh: (number | null)[];
  bestMatchLow: (number | null)[];
  bestMatchCode: (number | null)[];
}

function buildDay(
  index: number,
  date: string,
  participantCount: number,
  totalModels: number,
  models: readonly string[],
  tempUnit: 'F' | 'C',
  precipUnit: 'inch' | 'mm',
  bag: DaySeriesBag
): DayComparison {
  const highValues = valuesAtIndex(bag.high, models, index);
  const lowValues = valuesAtIndex(bag.low, models, index);
  const precipValues = valuesAtIndex(bag.precip, models, index);
  const probValues = valuesAtIndex(bag.prob, models, index);
  const windValues = valuesAtIndex(bag.wind, models, index);
  const codeValues = valuesAtIndex(bag.code, models, index);

  const highStats = computeStatSummary(highValues.map(v => v.value));
  const lowStats = computeStatSummary(lowValues.map(v => v.value));
  // The handler prints the spread as a whole degree (`r0` in forecastHandler.ts),
  // so band the same rounded figure; the raw range stays on the result for the min/max line.
  const band = classifyTempSpread(Math.round(highStats.range), tempUnit);

  let outlierModel: string | undefined;
  let outlierUnnamed = false;
  if (band === 'divergent') {
    const candidate = findOutlierCandidate(highValues);
    if (candidate) {
      const remaining = highValues.filter(v => v.model !== candidate.model).map(v => v.value);
      const remainingBand = classifyTempSpread(computeStatSummary(remaining).range, tempUnit);
      if (bandRank(remainingBand) < bandRank(band)) {
        outlierModel = candidate.model;
      } else {
        outlierUnnamed = true;
      }
    } else {
      outlierUnnamed = true;
    }
  }

  const threshold = precipThreshold(precipUnit);
  const wetCount = precipValues.filter(v => v.value >= threshold).length;

  const precipitation: PrecipitationComparison = {
    wetCount,
    wetParticipantCount: precipValues.length,
    sum: computeStatSummary(precipValues.map(v => v.value)),
    probability: probValues.length > 0 ? computeStatSummary(probValues.map(v => v.value)) : undefined,
    perModelSum: precipValues,
    perModelProbability: probValues
  };

  const wind: WindComparison = {
    max: computeStatSummary(windValues.map(v => v.value)),
    perModel: windValues
  };

  const conditions = buildConditionsConsensus(codeValues, models);
  const agreement = computeAgreement(band, precipitation.wetCount, precipitation.wetParticipantCount);

  const bestMatchHighVal = bag.bestMatchHigh[index];
  const bestMatch: BestMatchDay | null =
    bestMatchHighVal === null || bestMatchHighVal === undefined
      ? null
      : { high: bestMatchHighVal, low: bag.bestMatchLow[index] ?? null, code: bag.bestMatchCode[index] ?? null };

  return {
    date,
    bestMatch,
    participantCount,
    totalModels,
    temperature: {
      high: highStats,
      low: lowStats,
      band,
      outlierModel,
      outlierUnnamed,
      perModelHigh: highValues,
      perModelLow: lowValues
    },
    precipitation,
    wind,
    conditions,
    agreement
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function seriesFor(
  daily: RawModelComparisonDaily,
  variable: string,
  models: readonly string[],
  dayCount: number
): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const model of models) {
    out[model] = extractModelSeries(daily, variable, model) ?? new Array(dayCount).fill(null);
  }
  return out;
}

/**
 * Build a full model-agreement comparison from a raw multi-model `daily`
 * block (the service's `OpenMeteoModelComparisonResponse.daily`, structurally
 * matching `RawModelComparisonDaily`) plus the caller's temperature and
 * precipitation unit preferences.
 *
 * Three-level participation (D4): (1) a comparison model whose every
 * requested variable is entirely null is dropped before any stats and
 * recorded in `droppedModels`; (2) surviving models participate per-variable
 * wherever they have data (e.g. UKMO publishes no precipitation
 * probability); (3) per-day participation is anchored on
 * `temperature_2m_max` only (A5) — trailing days with fewer than 2
 * participating comparison models are trimmed (`trimmedDays`), while
 * interior gaps are retained and render with their reduced count.
 * `best_match` is excluded from every statistic, band, participation count,
 * and trimming decision (D6); it is carried through as a per-day reference
 * value only and may be null for a day.
 */
export function buildModelComparison(daily: RawModelComparisonDaily, tempUnit: 'F' | 'C', precipUnit: 'inch' | 'mm'): ModelComparisonResult {
  const dayCount = daily.time.length;
  const totalModels = COMPARISON_MODELS.length - 1; // exclude best_match

  const droppedModels: string[] = COMPARISON_MODELS.filter(model => model !== 'best_match' && isModelAllNull(daily, model));
  const survivingModels: string[] = COMPARISON_MODELS.filter(model => model !== 'best_match' && !droppedModels.includes(model));

  const bag: DaySeriesBag = {
    high: seriesFor(daily, 'temperature_2m_max', survivingModels, dayCount),
    low: seriesFor(daily, 'temperature_2m_min', survivingModels, dayCount),
    precip: seriesFor(daily, 'precipitation_sum', survivingModels, dayCount),
    prob: seriesFor(daily, 'precipitation_probability_max', survivingModels, dayCount),
    wind: seriesFor(daily, 'wind_speed_10m_max', survivingModels, dayCount),
    code: seriesFor(daily, 'weather_code', survivingModels, dayCount),
    bestMatchHigh: extractModelSeries(daily, 'temperature_2m_max', 'best_match') ?? new Array(dayCount).fill(null),
    bestMatchLow: extractModelSeries(daily, 'temperature_2m_min', 'best_match') ?? new Array(dayCount).fill(null),
    bestMatchCode: extractModelSeries(daily, 'weather_code', 'best_match') ?? new Array(dayCount).fill(null)
  };

  const participantCounts: number[] = [];
  for (let i = 0; i < dayCount; i++) {
    let count = 0;
    for (const model of survivingModels) {
      if (bag.high[model][i] !== null && bag.high[model][i] !== undefined) count++;
    }
    participantCounts.push(count);
  }

  // Trim only from the end: interior gaps (fewer than 2 participants in the
  // middle of the range, with valid days after) are retained per D4 level 3.
  let lastValidIndex = dayCount - 1;
  while (lastValidIndex >= 0 && participantCounts[lastValidIndex] < 2) {
    lastValidIndex--;
  }
  const trimmedDays = dayCount - 1 - lastValidIndex;

  const days: DayComparison[] = [];
  for (let i = 0; i <= lastValidIndex; i++) {
    days.push(buildDay(i, daily.time[i], participantCounts[i], totalModels, survivingModels, tempUnit, precipUnit, bag));
  }

  return { days, droppedModels, trimmedDays, totalModels };
}
