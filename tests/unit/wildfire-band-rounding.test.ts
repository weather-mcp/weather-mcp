/**
 * Unit tests locking the "band on the displayed distance/containment, not the raw
 * measurement" fix (wildfire-band-rounding plan, T1) in
 * `src/handlers/wildfireHandler.ts`. Before the fix, both danger-tier ladders (NIFC
 * and FIRMS) banded on the raw, unrounded distance with `<`, while every rendered
 * sentence prints that distance rounded to one decimal (`.toFixed(1)`) — so two
 * reports could show the identical printed distance (e.g. "5.0 km") under different
 * tiers. The fix bands on `displayValue(distance, 1)` with `<=`, and the containment
 * picker on `displayValue(containment, 0) < 100` so a fire printed as `100%` never
 * drives the tier.
 *
 * Model: tests/unit/lightning-band-rounding.test.ts (structure) and
 * tests/unit/wildfire-handler.test.ts / tests/unit/wildfire-routing.test.ts
 * (fixture idioms). Helpers are copied here rather than imported so this file and
 * the four existing wildfire/FIRMS test files stay independent locks.
 *
 * No network: NIFC and FIRMS services are plain stub objects returning canned data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import { calculateDistance } from '../../src/utils/distance.js';
import type { FirePerimeterFeature, NIFCQueryResponse } from '../../src/types/wildfire.js';
import type { FIRMSDetection } from '../../src/types/firms.js';

// ---------------------------------------------------------------------------
// Fixture geometry — same base point as wildfire-handler.test.ts /
// wildfire-routing.test.ts (Sacramento; genuinely US, so the NIFC path routes
// here via isInUS with no nominatim service needed).
// ---------------------------------------------------------------------------

const BASE_LAT = 38.5816;
const BASE_LON = -121.4944;

/**
 * Km per degree of latitude at BASE_LAT, along the BASE_LON meridian.
 * Haversine distance is linear in latitude offset along a fixed meridian, so
 * this constant lets a fixture be placed at an exact target distance:
 * `offsetDeg(km) = km / KM_PER_DEGREE_LAT`. Measured 111.19492664455873.
 */
const KM_PER_DEGREE_LAT = calculateDistance(BASE_LAT, BASE_LON, BASE_LAT + 1, BASE_LON);

/** Latitude offset (degrees) that places a fixture `km` from BASE_LAT/BASE_LON. */
function offsetDeg(km: number): number {
  return km / KM_PER_DEGREE_LAT;
}

const FIXED_ACQUIRED_AT = '2026-08-20T12:00:00.000Z';

const emptyStore = {} as never;
const emptyGeocoding = {} as never;

/**
 * Build a single NIFC wildfire feature at an exact distance (km) from
 * BASE_LAT/BASE_LON, with an explicit containment percentage. Modeled on
 * wildfire-handler.test.ts's `buildFire`, copied here rather than imported.
 */
function buildFire(overrides: { name: string; distanceKm: number; containment: number }): FirePerimeterFeature {
  const lat = BASE_LAT + offsetDeg(overrides.distanceKm);
  return {
    attributes: {
      poly_IncidentName: overrides.name,
      attr_IncidentTypeCategory: 'WF',
      poly_GISAcres: 100,
      attr_PercentContained: overrides.containment,
      attr_FireDiscoveryDateTime: Date.parse('2026-07-10T00:00:00Z'),
      attr_InitialLatitude: lat,
      attr_InitialLongitude: BASE_LON,
      attr_POOState: 'CA'
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

/** Render the NIFC path for a single wildfire at `distanceKm` / `containment`. */
async function renderNifcAt(distanceKm: number, containment = 20): Promise<string> {
  return renderNifcFires([buildFire({ name: 'Fire A', distanceKm, containment })]);
}

/**
 * Render the FIRMS path for a single detection at `distanceKm`.
 * `source: 'firms'` forces the FIRMS branch and bypasses `reverseCountry`
 * entirely (wildfire-routing.test.ts:143), so no nominatim fake is needed —
 * the inert NIFC stub is never called either.
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
const DISTANCE_PATTERN = /\*\*Distance:\*\* ([\d.]+) km/;

/** Pull the danger tier and the nearest fire's/cluster's printed distance out of a rendered report. */
function extractTierAndDistance(text: string): { tier: string; printedDistance: string } {
  const tierMatch = text.match(TIER_PATTERN);
  const distanceMatch = text.match(DISTANCE_PATTERN);
  if (!tierMatch) {
    throw new Error(`No danger-tier line rendered:\n${text}`);
  }
  if (!distanceMatch) {
    throw new Error(`No "**Distance:**" line rendered:\n${text}`);
  }
  return { tier: tierMatch[1], printedDistance: distanceMatch[1] };
}

describe('Wildfire band rounding — sanity check (haversine fixture linearity)', () => {
  it('a fixture placed at 5.02 km via offsetDeg renders as "5.0" at toFixed(1)', () => {
    const lat = BASE_LAT + offsetDeg(5.02);
    const actual = calculateDistance(BASE_LAT, BASE_LON, lat, BASE_LON);
    expect(actual.toFixed(1)).toBe('5.0');
  });
});

// ---------------------------------------------------------------------------
// Contracts 1 & 2 — the sweep. Driven once per path in `beforeAll` and shared
// between the two contracts below, since both read the same {distance, tier,
// printedDistance} triples and driving 12,000 handler calls twice would burn
// the runtime budget for no extra coverage.
//
// 0.01 km steps over 0 < d <= 60: 6,000 points per path. Measured well under
// the ~2s budget (no network, no mocked-call bookkeeping — plain stub
// objects) so kept at 0.01 rather than coarsened to 0.05.
// ---------------------------------------------------------------------------

const SWEEP_STEP_KM = 0.01;
const SWEEP_MAX_KM = 60;
const SWEEP_POINTS = Math.round(SWEEP_MAX_KM / SWEEP_STEP_KM);

/** Integer-indexed (1..SWEEP_POINTS) to avoid floating-point drift from repeatedly adding 0.01, and to exclude exactly 0. */
function sweepDistances(): number[] {
  return Array.from({ length: SWEEP_POINTS }, (_, i) => (i + 1) * SWEEP_STEP_KM);
}

interface SweepPoint {
  distance: number;
  tier: string;
  printedDistance: string;
}

let nifcSweep: SweepPoint[];
let firmsSweep: SweepPoint[];

beforeAll(async () => {
  nifcSweep = [];
  for (const distance of sweepDistances()) {
    const text = await renderNifcAt(distance);
    const { tier, printedDistance } = extractTierAndDistance(text);
    nifcSweep.push({ distance, tier, printedDistance });
  }

  firmsSweep = [];
  for (const distance of sweepDistances()) {
    const text = await renderFirmsAt(distance);
    const { tier, printedDistance } = extractTierAndDistance(text);
    firmsSweep.push({ distance, tier, printedDistance });
  }
});

describe('Wildfire band rounding — the displayed distance determines the tier (contract 1)', () => {
  it('NIFC: no printed distance across 0-60 km maps to two different tiers', () => {
    const seenByPrinted = new Map<string, Set<string>>();
    for (const { printedDistance, tier } of nifcSweep) {
      const tiers = seenByPrinted.get(printedDistance) ?? new Set<string>();
      tiers.add(tier);
      seenByPrinted.set(printedDistance, tiers);
    }
    for (const [printed, tiers] of seenByPrinted) {
      expect(tiers.size, `printed distance "${printed} km" mapped to tiers: ${[...tiers].join(', ')}`).toBe(1);
    }
  });

  it('FIRMS: no printed distance across 0-60 km maps to two different tiers', () => {
    const seenByPrinted = new Map<string, Set<string>>();
    for (const { printedDistance, tier } of firmsSweep) {
      const tiers = seenByPrinted.get(printedDistance) ?? new Set<string>();
      tiers.add(tier);
      seenByPrinted.set(printedDistance, tiers);
    }
    for (const [printed, tiers] of seenByPrinted) {
      expect(tiers.size, `printed distance "${printed} km" mapped to tiers: ${[...tiers].join(', ')}`).toBe(1);
    }
  });
});

describe('Wildfire band rounding — no case is less cautious than the old raw-distance rule (contract 2)', () => {
  const SEVERITY: Record<string, number> = {
    AWARENESS: 0,
    CAUTION: 1,
    'HIGH ALERT': 2,
    'EXTREME DANGER': 3
  };

  // The pre-fix rule, reimplemented here (not imported) so this test fails if
  // anyone reintroduces raw-distance banding under a different name.
  function oldRawTier(raw: number): string {
    if (raw < 5) return 'EXTREME DANGER';
    if (raw < 25) return 'HIGH ALERT';
    if (raw < 50) return 'CAUTION';
    return 'AWARENESS';
  }

  it('NIFC: the new tier is never less cautious than the old raw-distance tier, across the same sweep', () => {
    for (const { distance, tier } of nifcSweep) {
      const old = oldRawTier(distance);
      expect(
        SEVERITY[tier],
        `distance ${distance} km: new tier "${tier}" (severity ${SEVERITY[tier]}) is less cautious ` +
          `than old tier "${old}" (severity ${SEVERITY[old]})`
      ).toBeGreaterThanOrEqual(SEVERITY[old]);
    }
  });

  it('FIRMS: the new tier is never less cautious than the old raw-distance tier, across the same sweep', () => {
    for (const { distance, tier } of firmsSweep) {
      const old = oldRawTier(distance);
      expect(
        SEVERITY[tier],
        `distance ${distance} km: new tier "${tier}" (severity ${SEVERITY[tier]}) is less cautious ` +
          `than old tier "${old}" (severity ${SEVERITY[old]})`
      ).toBeGreaterThanOrEqual(SEVERITY[old]);
    }
  });
});

// ---------------------------------------------------------------------------
// Contract 3 — the seam rows, enumerated. Derived by running both rules in
// node against fixtures placed via offsetDeg (see the sanity check above);
// re-derive rather than trusting this list if a threshold ever changes (G36).
// No row sits on an exact half — toFixed disagrees with itself on exact
// halves, so those are asserted separately, on the literal, below.
// ---------------------------------------------------------------------------

const SEAM_ROWS: Array<[number, string]> = [
  [0.3, 'EXTREME DANGER'],
  [4.98, 'EXTREME DANGER'],
  [5.0, 'EXTREME DANGER'], // moves
  [5.02, 'EXTREME DANGER'], // moves
  [5.049, 'EXTREME DANGER'], // moves
  [5.051, 'HIGH ALERT'],
  [5.06, 'HIGH ALERT'],
  [24.98, 'HIGH ALERT'],
  [25.0, 'HIGH ALERT'], // moves
  [25.04, 'HIGH ALERT'], // moves
  [25.049, 'HIGH ALERT'], // moves
  [25.051, 'CAUTION'],
  [49.99, 'CAUTION'],
  [50.0, 'CAUTION'], // moves
  [50.04, 'CAUTION'], // moves
  [50.049, 'CAUTION'], // moves
  [50.051, 'AWARENESS'],
  [50.1, 'AWARENESS']
];

describe('Wildfire band rounding — seam rows (contract 3)', () => {
  it.each(SEAM_ROWS)('NIFC: a wildfire at %s km bands as %s', async (distanceKm, expectedTier) => {
    const text = await renderNifcAt(distanceKm);
    const { tier } = extractTierAndDistance(text);
    expect(tier).toBe(expectedTier);
  });

  it.each(SEAM_ROWS)('FIRMS: a detection at %s km bands as %s', async (distanceKm, expectedTier) => {
    const text = await renderFirmsAt(distanceKm);
    const { tier } = extractTierAndDistance(text);
    expect(tier).toBe(expectedTier);
  });

  // Exact-half literals, asserted directly against displayValue's own rounding
  // (G36) rather than through a haversine fixture: `(5.05).toFixed(1)` and
  // `(50.05).toFixed(1)` round down ("5.0", "50.0") while `(25.05).toFixed(1)`
  // rounds up ("25.1") — verified in tests/unit/displayBanding.test.ts:10.
  // This does not exercise the handler; it pins the tier the handler's rule
  // (displayValue(d, 1) <= threshold) would assign for these three literals,
  // independent of any coordinate-fixture floating-point residue.
  it.each([
    [5.05, 'EXTREME DANGER'], // moves — (5.05).toFixed(1) === "5.0"
    [25.05, 'CAUTION'], // (25.05).toFixed(1) === "25.1"
    [50.05, 'CAUTION'] // moves — (50.05).toFixed(1) === "50.0"
  ])('the handler rule bands the literal %s km as %s (exact-half check)', (raw, expectedTier) => {
    const shown = Number(raw.toFixed(1));
    const tier = shown <= 5 ? 'EXTREME DANGER' : shown <= 25 ? 'HIGH ALERT' : shown <= 50 ? 'CAUTION' : 'AWARENESS';
    expect(tier).toBe(expectedTier);
  });
});

// ---------------------------------------------------------------------------
// Contract 4 — the containment edge (NIFC only; FIRMS has no containment).
// Three distinct containment values across the boundary (G13), not one.
// ---------------------------------------------------------------------------

describe('Wildfire band rounding — the containment edge (contract 4)', () => {
  it('a single wildfire at 1.1 km / 99.6% renders 100% contained, excluded, and AWARENESS with no EXTREME DANGER', async () => {
    const text = await renderNifcFires([buildFire({ name: 'Fire A', distanceKm: 1.1, containment: 99.6 })]);

    expect(text).toContain('**Containment:** 100%');
    expect(text).not.toContain('is 100% contained and excluded from the danger assessment');
    expect(text).toContain('All fires within radius are 100% contained');
    expect(text).toContain('ℹ️ **AWARENESS**');
    expect(text).not.toContain('EXTREME DANGER');
  });

  it('a 99.6%-contained fire at 1.1 km beside a 40%-contained fire at 16.7 km excludes the first by name and bands on the second (HIGH ALERT)', async () => {
    const text = await renderNifcFires([
      buildFire({ name: 'Fire A', distanceKm: 1.1, containment: 99.6 }),
      buildFire({ name: 'Fire B', distanceKm: 16.7, containment: 40 })
    ]);

    expect(text).toContain('Fire A, 1.1 km) is 100% contained and excluded from the danger assessment');
    expect(text).toContain('🟠 **HIGH ALERT**');
    expect(text).not.toContain('EXTREME DANGER');
  });

  it('control: a single wildfire at 1.1 km / 99.4% renders 99% contained and EXTREME DANGER', async () => {
    const text = await renderNifcFires([buildFire({ name: 'Fire A', distanceKm: 1.1, containment: 99.4 })]);

    expect(text).toContain('**Containment:** 99%');
    expect(text).toContain('⚠️ **EXTREME DANGER**');
  });
});

// ---------------------------------------------------------------------------
// Contract 5 — one number, two render sites: the nearest fire's/cluster's
// **Distance:** line and the tier line must agree, read from the same
// rendered string (G11 as an assertion).
// ---------------------------------------------------------------------------

describe('Wildfire band rounding — one number, two render sites (contract 5)', () => {
  it('NIFC: a wildfire at 5.02 km prints "5.0 km" under EXTREME DANGER, both read from the same report', async () => {
    const text = await renderNifcAt(5.02);
    const { tier, printedDistance } = extractTierAndDistance(text);
    expect(printedDistance).toBe('5.0');
    expect(tier).toBe('EXTREME DANGER');
  });

  it('FIRMS: a detection at 25.04 km prints "25.0 km" under HIGH ALERT, both read from the same report', async () => {
    const text = await renderFirmsAt(25.04);
    const { tier, printedDistance } = extractTierAndDistance(text);
    expect(printedDistance).toBe('25.0');
    expect(tier).toBe('HIGH ALERT');
  });
});
