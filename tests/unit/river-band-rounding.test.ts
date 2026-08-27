/**
 * Unit tests locking the "band on the displayed value, not the raw stage" fix
 * (T3, commit addba54) in `src/handlers/riverConditionsHandler.ts`'s
 * `deriveFloodCategory`. Before the fix, the forecast-series block banded the
 * raw, unrounded stage against the gauge's flood-category thresholds while the
 * very next expression prints `stage.toFixed(2)` — so two forecast points could
 * render the identical stage (e.g. "8.00 ft") under different flood-category
 * labels. The fix bands on `shown = displayValue(stage, 2)`, the same value the
 * render site prints; the raw thresholds (`categories.*`) are NOAA's published
 * gauge metadata and are deliberately left unrounded.
 *
 * `deriveFloodCategory` is not exported — its one call site is the forecast
 * series block inside `formatGaugeDetails`, reached only through
 * `handleGetRiverConditions` at `detail: "full"`. Every contract here drives
 * the public handler (NOAA service mocked; no network) and parses the
 * rendered `- **<time>:** X.XX ft[ <emoji> <CATEGORY>]` lines.
 *
 * Model: tests/unit/marine-band-rounding.test.ts (structure, sweep/seam/
 * mutation idioms) and the existing forecast-series harness in
 * tests/unit/riverConditions.test.ts:443-521 (handler-driven mock shape).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { handleGetRiverConditions } from '../../src/handlers/riverConditionsHandler.js';
import type { NWPSGauge, StageFlowDataPoint, FloodCategories } from '../../src/types/noaa.js';

// ---------------------------------------------------------------------------
// Harness — mirrors tests/unit/riverConditions.test.ts:443-521's mock shape.
// ---------------------------------------------------------------------------

const BASE_LAT = 42.3601;
const BASE_LON = -71.0589;

// src/handlers/riverConditionsHandler.ts:83 — "Max forecast-series points
// rendered at detail='full'". Read from source, not assumed.
const FORECAST_SERIES_CAP = 80;

const getNWPSGaugesInBoundingBoxMock = vi.fn();
const getNWPSStageFlowMock = vi.fn();
const noaaService = {
  getNWPSGaugesInBoundingBox: getNWPSGaugesInBoundingBoxMock,
  getNWPSStageFlow: getNWPSStageFlowMock
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

function buildGauge(categories: FloodCategories): NWPSGauge {
  return {
    lid: 'LID0',
    name: 'Gauge 0',
    latitude: BASE_LAT,
    longitude: BASE_LON,
    state: { abbreviation: 'MA', name: 'Massachusetts' },
    status: {
      observed: {
        primary: 4.2,
        secondary: 0.05,
        floodCategory: null,
        validTime: '2026-07-17T14:00:00Z'
      }
    },
    flood: { categories }
  };
}

function forecastPoint(i: number, stage: number): StageFlowDataPoint {
  return {
    // Distinct, plausible (>= year 2000) validTimes so hasPlausibleValidTime
    // never suppresses a point.
    validTime: new Date(Date.UTC(2026, 6, 17, 14, 0, 0) + i * 1000).toISOString(),
    generatedTime: '2026-07-17T14:00:00Z',
    primary: stage,
    secondary: null
  };
}

function callHandler() {
  return handleGetRiverConditions(
    { latitude: BASE_LAT, longitude: BASE_LON, detail: 'full' },
    noaaService,
    {} as never,
    {} as never,
    {} as never
  );
}

/** Parses one rendered "- **<time>:** X.XX ft[ <emoji> <CATEGORY>]" line. */
function parseLine(line: string): { printed: string; category: string | null } {
  const m = line.match(/^- \*\*.+?:\*\* (\d+\.\d{2}) ft(.*)$/);
  if (!m) {
    throw new Error(`Unparseable series line: "${line}"`);
  }
  const rest = m[2].trim();
  const category = rest.length > 0 ? (rest.split(/\s+/).pop() as string).toLowerCase() : null;
  return { printed: m[1], category };
}

/**
 * Renders `stages` (in order) as one or more forecast-series batches of at
 * most FORECAST_SERIES_CAP points per handler call, and returns the parsed
 * lines in the same order as `stages`.
 *
 * G28: a validation error or a seriesless report parses to the same empty
 * result as a genuinely empty series — so every batch's parsed line count is
 * asserted against the number of points sent in that batch, not merely
 * checked for non-emptiness.
 */
async function runSeries(categories: FloodCategories, stages: number[]): Promise<{ lines: string[]; calls: number }> {
  const lines: string[] = [];
  let calls = 0;
  for (let offset = 0; offset < stages.length; offset += FORECAST_SERIES_CAP) {
    const batch = stages.slice(offset, offset + FORECAST_SERIES_CAP);
    getNWPSGaugesInBoundingBoxMock.mockResolvedValueOnce([buildGauge(categories)]);
    getNWPSStageFlowMock.mockResolvedValueOnce({
      forecast: { data: batch.map((s, i) => forecastPoint(offset + i, s)) }
    });
    calls++;
    const result = await callHandler();
    const text = (result.content[0] as { text: string }).text;
    const batchLines = text.split('\n').filter(l => l.startsWith('- **') && l.includes(' ft'));
    expect(
      batchLines.length,
      `handler call #${calls} (offset=${offset}) parsed ${batchLines.length} forecast-series ` +
        `lines for ${batch.length} points sent — the sweep would be silently vacuous. Raw output:\n${text}`
    ).toBe(batch.length);
    lines.push(...batchLines);
  }
  return { lines, calls };
}

// ---------------------------------------------------------------------------
// Contracts 1 & 2 share one sweep (driven through the handler once, in
// beforeAll) — 6 <= stage <= 20 ft at a 0.0005 ft step, indexed by division
// (i / 2000) rather than repeated or scaled multiplication (G36): different
// indexing lands on different doubles at exact display-halves, which changes
// which points fall inside the rounding window.
// ---------------------------------------------------------------------------

const SWEEP_MIN_FT = 6;
const SWEEP_MAX_FT = 20;
const SWEEP_STEP_FT = 0.0005;
const SWEEP_DIVISOR = 1 / SWEEP_STEP_FT; // 2000
const SWEEP_START_I = Math.round(SWEEP_MIN_FT * SWEEP_DIVISOR); // 12000
const SWEEP_END_I = Math.round(SWEEP_MAX_FT * SWEEP_DIVISOR); // 40000

/** stage[k] = (SWEEP_START_I + k) / 2000, division-indexed per G36. */
function sweepStages(): number[] {
  return Array.from({ length: SWEEP_END_I - SWEEP_START_I + 1 }, (_, k) => (SWEEP_START_I + k) / SWEEP_DIVISOR);
}

const SWEEP_CATEGORIES: FloodCategories = { action: 8, minor: 10, moderate: 14, major: 18 };
const CATEGORY_ORDER = ['none', 'action', 'minor', 'moderate', 'major'];

/** The pre-fix rule: the same four thresholds, banded on the raw stage directly. */
function oldRawCategory(stage: number, categories: FloodCategories): string {
  if (stage >= categories.major) return 'major';
  if (stage >= categories.moderate) return 'moderate';
  if (stage >= categories.minor) return 'minor';
  if (stage >= categories.action) return 'action';
  return 'none';
}

describe('River band rounding — contracts 1 & 2 (shared sweep, driven through the handler)', () => {
  const stages = sweepStages();
  let results: Array<{ stage: number; printed: string; category: string | null }> = [];
  let handlerCalls = 0;

  beforeAll(async () => {
    const { lines, calls } = await runSeries(SWEEP_CATEGORIES, stages);
    handlerCalls = calls;
    results = lines.map((line, idx) => ({ stage: stages[idx], ...parseLine(line) }));
  });

  it('(1) the displayed stage determines the band — no printed stage maps to two different flood categories', () => {
    // Every point sent must have produced exactly one parsed line, in order.
    expect(results.length, `sent ${stages.length} points across ${handlerCalls} handler calls but parsed ${results.length} lines`).toBe(stages.length);

    const seenByPrinted = new Map<string, Set<string | null>>();
    for (const { printed, category } of results) {
      const set = seenByPrinted.get(printed) ?? new Set<string | null>();
      set.add(category);
      seenByPrinted.set(printed, set);
    }
    for (const [printed, set] of seenByPrinted) {
      expect(set.size, `printed stage "${printed}" ft mapped to categories: ${[...set].map(c => c ?? 'none').join(', ')}`).toBe(1);
    }
  });

  it('(2) no case becomes less cautious than the old raw-stage rule, across the same sweep', () => {
    let more = 0;
    let less = 0;
    for (const { stage, category } of results) {
      const oldCategory = oldRawCategory(stage, SWEEP_CATEGORIES);
      const newRank = CATEGORY_ORDER.indexOf(category ?? 'none');
      const oldRank = CATEGORY_ORDER.indexOf(oldCategory);
      if (newRank > oldRank) more++;
      else if (newRank < oldRank) less++;
      expect(
        newRank,
        `stage=${stage}: new category "${category ?? 'none'}" (rank ${newRank}) is less cautious than ` +
          `old category "${oldCategory}" (rank ${oldRank})`
      ).toBeGreaterThanOrEqual(oldRank);
    }
    expect(less).toBe(0);
    // Measured at a 0.0005 ft step, division-indexed (i / 2000), over
    // 6 <= stage <= 20 ft (28,001 points) against thresholds
    // {action:8, minor:10, moderate:14, major:18}: 38 points became more
    // cautious, 0 became less cautious. Re-measure rather than trusting this
    // comment if the sweep parameters change (G22).
    expect(more).toBe(38);
  });
});

// ---------------------------------------------------------------------------
// Contract 3 — seam rows, enumerated. Expected printed values verified by
// running `(v).toFixed(2)` in node (G36) — see the report for the transcript.
// ---------------------------------------------------------------------------

interface SeamRow {
  label: string;
  categories: FloodCategories;
  stage: number;
  expectedPrinted: string;
  expectedCategory: string | null;
}

const DEFAULT_CATEGORIES: FloodCategories = { action: 8, minor: 10, moderate: 14, major: 18 };

const SEAM_ROWS: SeamRow[] = [
  { label: 'just below the action seam rounds up into ACTION', categories: DEFAULT_CATEGORIES, stage: 7.996, expectedPrinted: '8.00', expectedCategory: 'action' },
  { label: 'just below that rounds down stays clear of ACTION', categories: DEFAULT_CATEGORIES, stage: 7.994, expectedPrinted: '7.99', expectedCategory: null },
  { label: 'just below the minor seam rounds up into MINOR', categories: DEFAULT_CATEGORIES, stage: 9.996, expectedPrinted: '10.00', expectedCategory: 'minor' },
  { label: 'just below the moderate seam rounds up into MODERATE', categories: DEFAULT_CATEGORIES, stage: 13.996, expectedPrinted: '14.00', expectedCategory: 'moderate' },
  { label: 'just below the major seam rounds up into MAJOR', categories: DEFAULT_CATEGORIES, stage: 17.996, expectedPrinted: '18.00', expectedCategory: 'major' },
  // G13 unchanged controls — a seam table of only moving rows cannot show a
  // non-moving one stayed put.
  { label: 'exactly at the action threshold (unchanged control)', categories: DEFAULT_CATEGORIES, stage: 8, expectedPrinted: '8.00', expectedCategory: 'action' },
  { label: 'just below action, no rounding involved (unchanged control)', categories: DEFAULT_CATEGORIES, stage: 7.99, expectedPrinted: '7.99', expectedCategory: null },
  // Non-integer threshold: NOAA does not always publish integer gauge
  // datums. action=8.35 here is already at 2-decimal precision, so this row
  // alone does not distinguish "round stage only" from "round stage AND
  // threshold" (see mutation-check report) — it exists to prove the handler
  // doesn't assume integer thresholds.
  { label: 'non-integer threshold: stage rounds to exactly the action threshold', categories: { action: 8.35, minor: 10, moderate: 14, major: 18 }, stage: 8.3451, expectedPrinted: '8.35', expectedCategory: 'action' },
  // Threshold with 3 decimal places, deliberately NOT at 2-decimal precision:
  // shown=8.00 is below the raw 8.004 threshold, so this stays clear of
  // ACTION under the shipped rule. This is the row that catches the
  // "round the threshold too" rejected alternative (mutation check #2).
  { label: 'threshold with 3 decimal places: shown stage stays below the raw (unrounded) threshold', categories: { action: 8.004, minor: 10, moderate: 14, major: 18 }, stage: 8.0, expectedPrinted: '8.00', expectedCategory: null },
  { label: 'threshold with 3 decimal places: a clearly-above stage still reads ACTION (control)', categories: { action: 8.004, minor: 10, moderate: 14, major: 18 }, stage: 8.01, expectedPrinted: '8.01', expectedCategory: 'action' }
];

describe('River band rounding — seam rows (contract 3)', () => {
  it.each(SEAM_ROWS)('$label (stage=$stage)', async ({ categories, stage, expectedPrinted, expectedCategory }) => {
    const { lines } = await runSeries(categories, [stage]);
    expect(lines.length).toBe(1);
    const parsed = parseLine(lines[0]);
    expect(parsed.printed).toBe(expectedPrinted);
    expect(parsed.category).toBe(expectedCategory);
  });
});
