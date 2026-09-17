/**
 * Unit tests locking the containment and distance coherence contracts from the
 * wildfire-display-coherence plan (T1/T2) in `src/handlers/wildfireHandler.ts`:
 *
 * - `parseContainment(raw: unknown): number | null` — a finite number in
 *   [0, 100] passes through; anything else (absent, `null`, `NaN`, negative,
 *   >100) becomes `null`, meaning "NIFC published no usable containment".
 * - `formatContainmentLine(containment: number | null)` — `null` renders
 *   `**Containment:** not reported` (no bar, no `%`); otherwise the bar is
 *   `Math.floor(shown / 10)` filled cells of the *printed* percentage
 *   (`shown = displayValue(containment, 0)`), so a full bar renders only at
 *   `100%`.
 * - `formatDistanceFigure(km)` — miles are derived from the *displayed*
 *   kilometres (`displayValue(km, 1)`) at two decimals, on both the NIFC and
 *   FIRMS render sites.
 *
 * Model: tests/unit/wildfire-band-rounding.test.ts (structure, fixture idiom,
 * helpers copied rather than imported so this file and the four existing
 * wildfire/FIRMS test files stay independent locks) and
 * tests/unit/wildfire-handler.test.ts (fixture shape).
 *
 * No network: NIFC and FIRMS services are plain stub objects returning canned
 * data.
 */

import { describe, it, expect } from 'vitest';
import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import { calculateDistance } from '../../src/utils/distance.js';
import type { FirePerimeterFeature, NIFCQueryResponse } from '../../src/types/wildfire.js';
import type { FIRMSDetection } from '../../src/types/firms.js';

// ---------------------------------------------------------------------------
// Fixture geometry — same base point as wildfire-handler.test.ts /
// wildfire-band-rounding.test.ts (Sacramento; genuinely US, so the NIFC path
// routes here via isInUS with no nominatim service needed).
// ---------------------------------------------------------------------------

const BASE_LAT = 38.5816;
const BASE_LON = -121.4944;

/**
 * Km per degree of latitude at BASE_LAT, along the BASE_LON meridian.
 * Haversine distance is linear in latitude offset along a fixed meridian, so
 * this constant lets a fixture be placed at an exact target distance:
 * `offsetDeg(km) = km / KM_PER_DEGREE_LAT`.
 */
const KM_PER_DEGREE_LAT = calculateDistance(BASE_LAT, BASE_LON, BASE_LAT + 1, BASE_LON);

/** Latitude offset (degrees) that places a fixture `km` from BASE_LAT/BASE_LON. */
function offsetDeg(km: number): number {
  return km / KM_PER_DEGREE_LAT;
}

// Copied from wildfire-band-rounding.test.ts. Not asserted on here (this file's
// contracts are all about containment and distance), but the FIRMS render path
// (formatClusterDetails) always prints a "**Newest detection:**" line derived
// from this timestamp against the wall clock, so it must be a fixed, valid
// date for the report to render at all (G67).
const FIXED_ACQUIRED_AT = '2026-08-20T12:00:00.000Z';

const emptyStore = {} as never;
const emptyGeocoding = {} as never;

/**
 * Build a single NIFC wildfire feature at an exact distance (km) from
 * BASE_LAT/BASE_LON, with an arbitrary containment value. `containment` is
 * `unknown` (widened from wildfire-band-rounding.test.ts's `number`) so one
 * builder can produce `null`, `undefined`, `NaN`, out-of-range numbers, and
 * ordinary numbers alike — exercising `parseContainment`'s full input domain.
 * When `containment` is `undefined`, `attr_PercentContained` is omitted
 * entirely, so that case is a genuinely *absent* field, not a present-but-
 * `undefined` one.
 */
function buildFire(overrides: { name: string; distanceKm: number; containment: unknown }): FirePerimeterFeature {
  const lat = BASE_LAT + offsetDeg(overrides.distanceKm);
  return {
    attributes: {
      poly_IncidentName: overrides.name,
      attr_IncidentTypeCategory: 'WF',
      poly_GISAcres: 100,
      attr_FireDiscoveryDateTime: Date.parse('2026-07-10T00:00:00Z'),
      attr_InitialLatitude: lat,
      attr_InitialLongitude: BASE_LON,
      attr_POOState: 'CA',
      ...(overrides.containment !== undefined
        ? { attr_PercentContained: overrides.containment as number }
        : {})
    },
    geometry: {
      rings: [[[BASE_LON, lat]]]
    }
  };
}

/**
 * Build a single FIRMS detection at an exact distance (km) from
 * BASE_LAT/BASE_LON. One detection is its own cluster at its own distance
 * (clusterDetections with a single input just echoes it back), so no
 * clustering-radius interaction to reason about.
 */
function buildDetection(distanceKm: number): FIRMSDetection {
  const lat = BASE_LAT + offsetDeg(distanceKm);
  return {
    latitude: lat,
    longitude: BASE_LON,
    frp: 10,
    confidence: 'nominal',
    acquiredAt: FIXED_ACQUIRED_AT,
    daynight: 'N',
    satellite: 'N'
  };
}

/** Render the NIFC path for an arbitrary set of already-built fires. */
async function renderNifcFires(fires: FirePerimeterFeature[]): Promise<string> {
  const response: NIFCQueryResponse = { features: fires };
  const nifcService = { queryFirePerimeters: async () => response } as never;

  const result = await handleGetWildfireInfo(
    { latitude: BASE_LAT, longitude: BASE_LON },
    nifcService,
    emptyStore,
    emptyGeocoding
  );
  return result.content[0].text;
}

/**
 * Render the NIFC path for a single wildfire at `distanceKm` / `containment`.
 * `containment` has no default: a JS default parameter substitutes on an
 * `undefined` *argument*, which would silently turn the "absent containment"
 * fixture (an explicit `undefined`) into containment `20` — exactly the kind
 * of degenerate fixture this file exists to avoid.
 */
async function renderNifcAt(distanceKm: number, containment: unknown): Promise<string> {
  return renderNifcFires([buildFire({ name: 'Fire A', distanceKm, containment })]);
}

/**
 * Render the FIRMS path for a single detection at `distanceKm`.
 * `source: 'firms'` forces the FIRMS branch and bypasses `reverseCountry`
 * entirely, so no nominatim fake is needed — the inert NIFC stub is never
 * called either.
 */
async function renderFirmsAt(distanceKm: number): Promise<string> {
  const detection = buildDetection(distanceKm);
  const firmsService = {
    isKeyAvailable: () => false,
    getDetectionsByBbox: async () => [],
    getDetectionsByRegion: async () => [detection]
  } as never;
  const inertNifc = {} as never;

  const result = await handleGetWildfireInfo(
    { latitude: BASE_LAT, longitude: BASE_LON, source: 'firms' },
    inertNifc,
    emptyStore,
    emptyGeocoding,
    firmsService
  );
  return result.content[0].text;
}

const TIER_PATTERN = /\*\*(EXTREME DANGER|HIGH ALERT|CAUTION|AWARENESS)\*\*/;

/** All rendered "**Containment:** ..." lines, in report order (nearest fire first). */
function extractContainmentLines(text: string): string[] {
  return text.match(/\*\*Containment:\*\* [^\n]*/g) ?? [];
}

/** All rendered "**Distance:** ..." lines, in report order (nearest fire/cluster first). */
function extractDistanceLines(text: string): string[] {
  return text.match(/\*\*Distance:\*\* [^\n]*/g) ?? [];
}

function extractTier(text: string): string {
  const match = text.match(TIER_PATTERN);
  if (!match) {
    throw new Error(`No danger-tier line rendered:\n${text}`);
  }
  return match[1];
}

// ---------------------------------------------------------------------------
// Contract 1 — Bar coherence: for a containment printing N%, the bar carries
// floor(N/10) filled cells and 10 - floor(N/10) empty ones, and a full bar
// renders only with 100%.
// ---------------------------------------------------------------------------

describe('Wildfire display coherence — bar coherence (contract 1)', () => {
  const BAR_ROWS: Array<[unknown, string]> = [
    // Reported symptom: containment 95-99 used to draw a full (10-cell) bar
    // under round(raw/10). floor(shown/10) draws 9.
    [95, '**Containment:** 95% █████████░'],
    [99, '**Containment:** 99% █████████░'],
    // The x9.6 seam: floor(shown/10) parts company with floor(raw/10) here.
    // shown = 100 (displayValue(99.6, 0)), so floor(100/10) = 10 -- a full bar,
    // matching the printed 100% and the fire's exclusion from the assessment.
    [99.6, '**Containment:** 100% ██████████'],
    // Low-end twin: shown = 10, floor(10/10) = 1.
    [9.6, '**Containment:** 10% █░░░░░░░░░'],
    // x4.4/x4.6: a control for the bar (both draw 9 cells) and a seam for the
    // printed percentage (94% vs 95%). Do not expect this pair to discriminate
    // the bar -- that is x9.4/x9.6's job.
    [94.4, '**Containment:** 94% █████████░'],
    [94.6, '**Containment:** 95% █████████░'],
    // Zero is a value, not a sentinel (contract 3 restates this on its own).
    [0, '**Containment:** 0% ░░░░░░░░░░'],
    // Exactly 100 is the only value that draws a full bar.
    [100, '**Containment:** 100% ██████████']
  ];

  it.each(BAR_ROWS)('containment %s renders the line %j', async (containment, expectedLine) => {
    const text = await renderNifcAt(1.1, containment);
    const lines = extractContainmentLines(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(expectedLine);
  });

  it('a fire displayed below 100% never draws a full ten-cell bar', async () => {
    const text = await renderNifcAt(1.1, 99);
    const lines = extractContainmentLines(text);
    expect(lines[0]).not.toBe('**Containment:** 99% ██████████');
  });
});

// ---------------------------------------------------------------------------
// Contract 2 — Not reported: an absent, null, NaN, negative, and >100
// containment each render "**Containment:** not reported", with no bar and
// no percent sign. Such a fire still drives the danger tier as uncontained.
// ---------------------------------------------------------------------------

describe('Wildfire display coherence — not reported (contract 2)', () => {
  const NOT_REPORTED_VALUES: Array<[string, unknown]> = [
    ['absent', undefined],
    ['null', null],
    ['NaN', NaN],
    ['-10', -10],
    ['150', 150]
  ];

  it.each(NOT_REPORTED_VALUES)('containment %s renders exactly "**Containment:** not reported"', async (_label, containment) => {
    const text = await renderNifcAt(20, containment);
    const lines = extractContainmentLines(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('**Containment:** not reported');
  });

  it.each(NOT_REPORTED_VALUES)('containment %s at 1.1 km still renders EXTREME DANGER', async (_label, containment) => {
    const text = await renderNifcAt(1.1, containment);
    expect(extractTier(text)).toBe('EXTREME DANGER');
    expect(extractContainmentLines(text)[0]).toBe('**Containment:** not reported');
  });

  it.each(NOT_REPORTED_VALUES)('containment %s in radius: "All fires within radius are 100%% contained." never renders', async (_label, containment) => {
    const text = await renderNifcAt(20, containment);
    expect(text).not.toContain('All fires within radius are 100% contained.');
  });

  it('a not-reported fire (16.7 km) beside a nearer 100%-contained fire (1.1 km): the exclusion note names the nearer one, and the not-reported fire still drives the tier', async () => {
    const text = await renderNifcFires([
      buildFire({ name: 'Fire A', distanceKm: 1.1, containment: 100 }),
      buildFire({ name: 'Fire B', distanceKm: 16.7, containment: null })
    ]);

    expect(text).toContain('Fire A, 1.1 km) is 100% contained and excluded from the danger assessment');
    expect(extractTier(text)).toBe('HIGH ALERT');
    // Report order is nearest-first: Fire A's containment line, then Fire B's.
    const lines = extractContainmentLines(text);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('**Containment:** 100% ██████████');
    expect(lines[1]).toBe('**Containment:** not reported');
    expect(text).not.toContain('All fires within radius are 100% contained.');
  });
});

// ---------------------------------------------------------------------------
// Contract 3 — Zero is a value: 0 renders "0% ░░░░░░░░░░", ten empty cells.
// tests/unit/wildfire-routing.test.ts:547 (attr_PercentContained: 0) remains
// the untouched control for this same property.
// ---------------------------------------------------------------------------

describe('Wildfire display coherence — zero is a value (contract 3)', () => {
  it('containment 0 renders "**Containment:** 0% ░░░░░░░░░░", not "not reported"', async () => {
    const text = await renderNifcAt(20, 0);
    const lines = extractContainmentLines(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('**Containment:** 0% ░░░░░░░░░░');
  });
});

// ---------------------------------------------------------------------------
// Contract 4 — No throw: 150 and -10 render a report rather than rejecting.
// Under the bar rule alone (no parse), -10 throws RangeError ('░'.repeat(-1))
// and 150 throws RangeError ('░'.repeat(-5)) -- see the implementation plan's
// C4 table. Assert the report renders AND that the line reads "not reported",
// so a future clamp (which would also avoid the throw) cannot satisfy this
// contract; also assert the tier is unaffected, so a clamp to 100 (which
// would exclude the fire from the assessment) is separately caught.
// ---------------------------------------------------------------------------

describe('Wildfire display coherence — no throw (contract 4)', () => {
  it.each([150, -10])('containment %s renders (does not throw) and reads "not reported" at EXTREME DANGER', async containment => {
    await expect(renderNifcAt(1.1, containment)).resolves.toBeTypeOf('string');
    const text = await renderNifcAt(1.1, containment);
    expect(extractContainmentLines(text)[0]).toBe('**Containment:** not reported');
    expect(extractTier(text)).toBe('EXTREME DANGER');
  });
});

// ---------------------------------------------------------------------------
// Contract 5 — Miles coherence, both paths: the miles figure is derived from
// the *displayed* kilometres, at two decimals. Expected miles are pinned as
// literals (derived in node against the real code), not recomputed from
// kmToMiles(displayValue(km, 1)).toFixed(2) -- a derivation whose expected
// value is computed by the same expression as the subject is self-consistent
// under permutations of it (G45), and a literal is what makes the "raw km at
// 2 dp" mutation red rather than arguable.
// ---------------------------------------------------------------------------

describe('Wildfire display coherence — miles coherence, both paths (contract 5)', () => {
  const SEAM_ROWS: Array<[number, string]> = [
    [5.0, '5.0 km (3.11 mi)'],
    [5.1, '5.1 km (3.17 mi)'],
    [25.0, '25.0 km (15.53 mi)'],
    [25.1, '25.1 km (15.60 mi)'],
    [50.0, '50.0 km (31.07 mi)'],
    [50.1, '50.1 km (31.13 mi)']
  ];

  it.each(SEAM_ROWS)('NIFC: a wildfire at %s km prints exactly "**Distance:** %s"', async (distanceKm, fragment) => {
    const text = await renderNifcAt(distanceKm, 20);
    const lines = extractDistanceLines(text);
    expect(lines[0]).toBe(`**Distance:** ${fragment}`);
  });

  it.each(SEAM_ROWS)('FIRMS: a detection at %s km prints exactly "**Distance:** %s N" (bearing, one space)', async (distanceKm, fragment) => {
    const text = await renderFirmsAt(distanceKm);
    const lines = extractDistanceLines(text);
    expect(lines[0]).toBe(`**Distance:** ${fragment} N`);
  });

  // The mutation-discriminating fixture: 5.06 km is not itself a displayed
  // value (it displays as 5.1 km), so "raw km at two decimals" and "displayed
  // km at two decimals" compute different miles from it -- 3.14 vs 3.17.
  it('NIFC: a wildfire at 5.06 km prints "**Distance:** 5.1 km (3.17 mi)", not the raw-km figure (3.14 mi)', async () => {
    const text = await renderNifcAt(5.06, 20);
    const lines = extractDistanceLines(text);
    expect(lines[0]).toBe('**Distance:** 5.1 km (3.17 mi)');
  });

  it('FIRMS: a detection at 5.06 km prints "**Distance:** 5.1 km (3.17 mi) N", not the raw-km figure (3.14 mi)', async () => {
    const text = await renderFirmsAt(5.06);
    const lines = extractDistanceLines(text);
    expect(lines[0]).toBe('**Distance:** 5.1 km (3.17 mi) N');
  });

  // Two fires printing the same displayed km print the same miles. 4.98 and
  // 5.02 km both display as "5.0 km" (toFixed(1)), so both must print
  // "3.11 mi" -- under "raw km at N decimals" they would not.
  it('NIFC: fires at 4.98 km and 5.02 km (both display "5.0 km") print identical distance lines', async () => {
    const textLow = await renderNifcAt(4.98, 20);
    const textHigh = await renderNifcAt(5.02, 20);
    const lineLow = extractDistanceLines(textLow)[0];
    const lineHigh = extractDistanceLines(textHigh)[0];
    expect(lineLow).toBe('**Distance:** 5.0 km (3.11 mi)');
    expect(lineHigh).toBe('**Distance:** 5.0 km (3.11 mi)');
    expect(lineLow).toBe(lineHigh);
  });

  it('FIRMS: detections at 4.98 km and 5.02 km (both display "5.0 km") print identical distance lines', async () => {
    const textLow = await renderFirmsAt(4.98);
    const textHigh = await renderFirmsAt(5.02);
    const lineLow = extractDistanceLines(textLow)[0];
    const lineHigh = extractDistanceLines(textHigh)[0];
    expect(lineLow).toBe('**Distance:** 5.0 km (3.11 mi) N');
    expect(lineHigh).toBe('**Distance:** 5.0 km (3.11 mi) N');
    expect(lineLow).toBe(lineHigh);
  });
});

// ---------------------------------------------------------------------------
// Contract 6 — Pin the line whole, not a prefix. A `toContain` prefix that
// stops before the bar (or before the miles figure) is exactly how the
// existing wildfire-band-rounding.test.ts `**Containment:** 100%` assertions
// became blind to the bar (G65). Demonstrate the discipline directly: a
// fire whose bar or distance figure is corrupted *after* the point a prefix
// assertion would stop must still be caught by the whole-line assertion.
// ---------------------------------------------------------------------------

describe('Wildfire display coherence — pin the line whole, not a prefix (contract 6)', () => {
  it('a bare toContain prefix on "**Containment:** 40%" cannot see the bar; the whole-line assertion can', async () => {
    const text = await renderNifcAt(1.1, 40);
    const lines = extractContainmentLines(text);

    // The prefix a toContain-style assertion would use -- true regardless of
    // what the bar looks like.
    expect(text).toContain('**Containment:** 40%');

    // The whole line is what actually pins the bar shape: 4 filled cells,
    // 6 empty, matching floor(40/10) = 4.
    expect(lines[0]).toBe('**Containment:** 40% ████░░░░░░');
  });

  it('a bare toContain prefix on "**Distance:** 5.0 km" cannot see the miles figure; the whole-line assertion can', async () => {
    const text = await renderNifcAt(5.0, 20);
    const lines = extractDistanceLines(text);

    expect(text).toContain('**Distance:** 5.0 km');
    expect(lines[0]).toBe('**Distance:** 5.0 km (3.11 mi)');
  });

  it('the FIRMS distance line is pinned to its terminator, including the trailing bearing', async () => {
    const text = await renderFirmsAt(25.0);
    const lines = extractDistanceLines(text);

    expect(text).toContain('**Distance:** 25.0 km');
    expect(lines[0]).toBe('**Distance:** 25.0 km (15.53 mi) N');
  });
});
