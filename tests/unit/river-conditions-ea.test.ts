/**
 * Handler tests for the Great Britain (UK Environment Agency) river conditions
 * path — routing into and out of the EA arm, and the EA renderer's own
 * contracts.
 *
 * Exercises the real handleGetRiverConditions with plain fake services (no
 * HTTP, no live network calls, no vi.mock) to prove:
 *   - source routing: `auto` inside the GB box + a resolved 'gb' selects EA;
 *     `source: "openmeteo"` at the same point still selects GloFAS; neither
 *     backend's fake is touched on the other's path
 *   - `auto` inside the GB box with no Nominatim service wired falls to
 *     GloFAS (the same fallback 19 tests in river-conditions-global.test.ts
 *     depend on for the NOAA arm)
 *   - the reverse-country lookup gate: called once inside the GB box, never
 *     outside it
 *   - US and non-GB/non-US points never touch the EA fake at all
 *   - the `riverName` filter that establishes the tool's coverage claim: a
 *     station without one is neither rendered nor counted
 *   - a `stageScale` URL string (no `_view=full`) does not throw and yields
 *     no typical range
 *   - an unresolved reading renders "not currently reported", never a number
 *   - measure selection on the real L2402 fixture: `Stage`/`m`, not
 *     `Downstream Stage`/`mAOD`
 *   - `source: "ea"` forced outside the network renders the coverage
 *     disclosure, never a ✅
 *   - a failed EA fetch propagates rather than rendering an empty list (G47)
 *   - the two distinct empty renders (no stations at all vs. stations with no
 *     river gauge) differ and neither carries a ✅ (G47)
 *   - the 5-gauge detail fan-out bounds enrichment only, never listing or
 *     counting (G8)
 *   - a `getStationDetail` rejection degrades that one gauge to no range
 *     without failing the request
 *   - a named non-`Stage` measure (e.g. a tidal gauge) renders its level with
 *     no typical range line at all, even when thresholds are available
 *
 * See src/handlers/riverConditionsHandler.ts (formatEARiverConditions) and
 * src/utils/eaGauges.ts.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { handleGetRiverConditions } from '../../src/handlers/riverConditionsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { EnvironmentAgencyService } from '../../src/services/environmentAgency.js';
import type { OpenMeteoFloodResponse } from '../../src/types/openmeteo.js';
import type { EAMeasure, EAStation } from '../../src/types/environmentAgency.js';
import { buildProbeGrid } from '../../src/utils/riverDischarge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixtures — coordinates
// ---------------------------------------------------------------------------

/** London — inside the GB routing box (isInGreatBritain). */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };
/** St. Louis, MO — inside the US. */
const US_POINT = { latitude: 38.6270, longitude: -90.1994 };
/** Rotterdam, NL — outside the GB box (longitude 4.48 > the box's 2.0 edge) and outside the US. */
const ROTTERDAM = { latitude: 51.9244, longitude: 4.4777 };

// ---------------------------------------------------------------------------
// Fixtures — noaa/openMeteo fakes (only enough to prove they're untouched or
// to reach GloFAS's harmless "no river data" branch; not this file's subject)
// ---------------------------------------------------------------------------

function buildNoaaFake() {
  return {
    getNWPSGaugesInBoundingBox: vi.fn().mockResolvedValue([]),
    getNWPSGauge: vi.fn().mockRejectedValue(new Error('detail unavailable')),
    getNWPSStageFlow: vi.fn()
  };
}

/** A minimal 9-cell all-null probe grid — reaches GloFAS's "no river data" branch without throwing. */
function buildAllNullGrid(centerLat: number, centerLon: number): OpenMeteoFloodResponse[] {
  const grid = buildProbeGrid(centerLat, centerLon);
  const time = ['2026-01-01'];
  return grid.map(point => ({
    latitude: point.latitude,
    longitude: point.longitude,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'UTC',
    timezone_abbreviation: 'UTC',
    daily_units: { time: 'iso8601', river_discharge: 'm³/s' },
    daily: { time, river_discharge: [null], river_discharge_median: [null] }
  }));
}

function buildOpenMeteoFake(cells: OpenMeteoFloodResponse[] = []) {
  return {
    getRiverDischarge: vi.fn().mockResolvedValue(cells)
  };
}

/** Copied from tests/unit/river-conditions-global.test.ts — same shape, same one-method fake. */
function makeNominatimFake(impl: (lat: number, lon: number) => Promise<string | null>) {
  const reverseCountry = vi.fn(impl);
  return { service: { reverseCountry } as unknown as NominatimService, reverseCountry };
}

// ---------------------------------------------------------------------------
// Fixtures — the EA fake
// ---------------------------------------------------------------------------

function buildEaFake() {
  return {
    getStationsNear: vi.fn(),
    getLatestLevelReadings: vi.fn(),
    getStationDetail: vi.fn()
  };
}

interface Fakes {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
  nominatim?: ReturnType<typeof makeNominatimFake>;
  /** Optional and trailing — every existing call site omits it and is unaffected. */
  ea?: ReturnType<typeof buildEaFake>;
}

function buildFakes(openMeteoCells: OpenMeteoFloodResponse[] = []): Fakes {
  return {
    noaa: buildNoaaFake(),
    openMeteo: buildOpenMeteoFake(openMeteoCells),
    // Coordinate-only args mean resolveLocationAsync never touches these.
    locationStore: {},
    geocoding: {}
  };
}

function callRiverConditions(args: Record<string, unknown>, fakes: Fakes) {
  return handleGetRiverConditions(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.nominatim?.service,
    fakes.ea as unknown as EnvironmentAgencyService | undefined
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

// ---------------------------------------------------------------------------
// Fixtures — building EA stations/measures/readings by hand
// ---------------------------------------------------------------------------

/** An ISO timestamp `minutesAgo` minutes before the real clock — always fresh at test time. */
function freshIso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

/**
 * One measure, shaped like the *station-list* endpoint: `latestReading` is a
 * URL string, never an inline object (see G7 in environmentAgency.ts) — the
 * reading comes from the separately-supplied bulk readings map, joined on
 * `@id`, exactly like production.
 */
function makeMeasure(id: string, opts: { qualifier?: string; unitName?: string } = {}): EAMeasure {
  return {
    '@id': id,
    qualifier: opts.qualifier ?? 'Stage',
    unitName: opts.unitName ?? 'm',
    parameter: 'level',
    parameterName: 'Water Level',
    period: 900,
    latestReading: `${id}/reading-latest`
  };
}

function makeStation(
  ref: string,
  riverName: string | undefined,
  measures: EAMeasure[],
  coords: { latitude: number; longitude: number } = LONDON
): EAStation {
  return {
    notation: ref,
    stationReference: ref,
    riverName,
    label: riverName,
    lat: coords.latitude,
    long: coords.longitude,
    measures
  };
}

/** [measureId, reading] entries -> the bulk readings Map the service returns. */
function readingsMap(entries: Array<[string, { value: number; dateTime: string }]>): Map<string, { value: number; dateTime: string }> {
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// 1. Routing: GB auto+gb -> EA, GB source=openmeteo -> GloFAS, neither leaks
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — EA routing (auto + explicit)', () => {
  it('renders EA gauges for a GB point on auto once Nominatim resolves gb, and never leaks a GloFAS line', async () => {
    const measureId = 'https://environment.data.gov.uk/flood-monitoring/id/measures/TEST1-stage-m';
    const station = makeStation('TEST1', 'River Test', [makeMeasure(measureId)]);
    const fakes = buildFakes();
    fakes.nominatim = makeNominatimFake(async () => 'gb');
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations: [station], truncated: false });
    fakes.ea.getLatestLevelReadings.mockResolvedValue({
      readings: readingsMap([[measureId, { value: 0.8, dateTime: freshIso(5) }]]),
      truncated: false
    });
    fakes.ea.getStationDetail.mockResolvedValue(null);

    const result = await callRiverConditions({ ...LONDON }, fakes);
    const text = textOf(result);

    expect(text).toContain('Environment Agency real-time river level gauges');
    expect(text).toContain('this uses Environment Agency flood and river level data from the real-time data API (Beta)');
    expect(text).not.toContain('Open-Meteo Flood API');
    expect(text).not.toContain('Model-estimated river discharge');
    expect(fakes.openMeteo.getRiverDischarge).not.toHaveBeenCalled();
  });

  it('renders GloFAS discharge for the same GB point when source: "openmeteo" is forced, and never leaks an EA line', async () => {
    const fakes = buildFakes(buildAllNullGrid(LONDON.latitude, LONDON.longitude));
    fakes.nominatim = makeNominatimFake(async () => 'gb');
    fakes.ea = buildEaFake();

    const result = await callRiverConditions({ ...LONDON, source: 'openmeteo' }, fakes);
    const text = textOf(result);

    expect(text).toContain('**Source:** Open-Meteo Flood API (GloFAS v4, ~5 km model grid)');
    expect(text).not.toContain('Environment Agency');
    expect(fakes.ea.getStationsNear).not.toHaveBeenCalled();
    expect(fakes.ea.getLatestLevelReadings).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. No Nominatim wired -> falls to GloFAS
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — EA auto with no Nominatim wired', () => {
  it('falls to GloFAS at a GB point on auto when no Nominatim service is wired', async () => {
    const fakes = buildFakes(buildAllNullGrid(LONDON.latitude, LONDON.longitude));
    // fakes.nominatim intentionally left undefined — the existing-harness shape.
    fakes.ea = buildEaFake();

    const result = await callRiverConditions({ ...LONDON }, fakes);

    expect(fakes.openMeteo.getRiverDischarge).toHaveBeenCalledTimes(1);
    expect(fakes.ea.getStationsNear).not.toHaveBeenCalled();
    expect(fakes.nominatim).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. reverseCountry gate: once inside the GB box, never outside it
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — reverse-country lookup gate', () => {
  it('calls reverseCountry exactly once for a GB-box point on auto', async () => {
    const fakes = buildFakes();
    fakes.nominatim = makeNominatimFake(async () => 'gb');
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations: [], truncated: false });
    fakes.ea.getLatestLevelReadings.mockResolvedValue({ readings: readingsMap([]), truncated: false });

    await callRiverConditions({ ...LONDON }, fakes);

    expect(fakes.nominatim.reverseCountry).toHaveBeenCalledTimes(1);
  });

  it('never calls reverseCountry for a non-GB, non-US point on auto', async () => {
    const fakes = buildFakes(buildAllNullGrid(ROTTERDAM.latitude, ROTTERDAM.longitude));
    fakes.nominatim = makeNominatimFake(async () => 'nl');

    await callRiverConditions({ ...ROTTERDAM }, fakes);

    expect(fakes.nominatim.reverseCountry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. US and non-GB/non-US routing never touch the EA fake
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — the EA fake is never touched off the GB arm', () => {
  it('routes a US point to NOAA and never calls the EA fake', async () => {
    const fakes = buildFakes();
    fakes.ea = buildEaFake();

    await callRiverConditions({ ...US_POINT }, fakes);

    expect(fakes.noaa.getNWPSGaugesInBoundingBox).toHaveBeenCalledTimes(1);
    expect(fakes.ea.getStationsNear).not.toHaveBeenCalled();
    expect(fakes.ea.getLatestLevelReadings).not.toHaveBeenCalled();
  });

  it('routes a non-GB, non-US point to GloFAS and never calls the EA fake', async () => {
    const fakes = buildFakes(buildAllNullGrid(ROTTERDAM.latitude, ROTTERDAM.longitude));
    fakes.nominatim = makeNominatimFake(async () => 'nl');
    fakes.ea = buildEaFake();

    await callRiverConditions({ ...ROTTERDAM }, fakes);

    expect(fakes.openMeteo.getRiverDischarge).toHaveBeenCalledTimes(1);
    expect(fakes.ea.getStationsNear).not.toHaveBeenCalled();
    expect(fakes.ea.getLatestLevelReadings).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. riverName filter: excluded stations are neither rendered nor counted
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — the riverName filter (G53 coverage claim)', () => {
  it('counts and renders only the stations that carry a riverName (3 of 5)', async () => {
    const entries: Array<[string, { value: number; dateTime: string }]> = [];
    const stations: EAStation[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `https://environment.data.gov.uk/flood-monitoring/id/measures/S${i}-stage-m`;
      const hasRiverName = i < 3;
      stations.push(
        makeStation(`S${i}`, hasRiverName ? `River Test ${i}` : undefined, [makeMeasure(id)], {
          latitude: LONDON.latitude + i * 0.01,
          longitude: LONDON.longitude
        })
      );
      entries.push([id, { value: 1.0, dateTime: freshIso(5) }]);
    }

    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations, truncated: false });
    fakes.ea.getLatestLevelReadings.mockResolvedValue({ readings: readingsMap(entries), truncated: false });
    fakes.ea.getStationDetail.mockResolvedValue(null);

    const result = await callRiverConditions({ ...LONDON, source: 'ea' }, fakes);
    const text = textOf(result);

    expect(text).toContain('Found 3 river gauges');
    expect((text.match(/\*\*Level:\*\*/g) || []).length).toBe(3);
    expect(text).not.toContain('River Test 3');
    expect(text).not.toContain('River Test 4');
  });
});

// ---------------------------------------------------------------------------
// 6. stageScale as a URL string — no throw, no range
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — a stageScale URL string yields no range, never a throw', () => {
  it('renders the level and no typical range when getStationDetail resolves null (URL-string stageScale)', async () => {
    const id = 'https://environment.data.gov.uk/flood-monitoring/id/measures/URLSCALE-stage-m';
    const station = makeStation('URLSCALE', 'River Test', [makeMeasure(id)]);
    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations: [station], truncated: false });
    fakes.ea.getLatestLevelReadings.mockResolvedValue({
      readings: readingsMap([[id, { value: 1.2, dateTime: freshIso(5) }]]),
      truncated: false
    });
    // Real getStationDetail already narrows a bare stageScale URL string to
    // null (see environmentAgency.ts) — the fake reproduces that contract.
    fakes.ea.getStationDetail.mockResolvedValue(null);

    const result = await callRiverConditions({ ...LONDON, source: 'ea', units: 'metric' }, fakes);
    const text = textOf(result);

    expect(text).toContain('**Level:** 1.20 m');
    expect(text).not.toContain('Typical range:');
  });
});

// ---------------------------------------------------------------------------
// 7. Unresolved reading -> "not currently reported", never a number
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — an unresolved reading renders honestly', () => {
  it('renders "not currently reported" and no numeric value when no reading resolves', async () => {
    const id = 'https://environment.data.gov.uk/flood-monitoring/id/measures/NOREAD-stage-m';
    const station = makeStation('NOREAD', 'River Test', [makeMeasure(id)]);
    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations: [station], truncated: false });
    // The measure's id is never present in the readings map.
    fakes.ea.getLatestLevelReadings.mockResolvedValue({ readings: readingsMap([]), truncated: false });
    fakes.ea.getStationDetail.mockResolvedValue(null);

    const result = await callRiverConditions({ ...LONDON, source: 'ea' }, fakes);
    const text = textOf(result);

    expect(text).toContain('Found 1 river gauge');
    expect(text).toContain('not currently reported by this gauge');
    expect(text).not.toMatch(/\*\*Level:\*\* [\d.]/);
  });
});

// ---------------------------------------------------------------------------
// 8. Measure selection on the real L2402 fixture
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — measure selection on the real L2402 fixture', () => {
  it('selects the freshest qualifying (Stage/m) measure, not Downstream Stage/mAOD, and discloses its age', async () => {
    // The real _view=full station-detail fixture: 5 measures, 2 with a live
    // inline reading (Downstream Stage/mAOD at 2.438, Stage/m at 0.562), 3
    // with a bare URL latestReading (no reading at all). Both live readings
    // are dated 2026-09-02T19:15:00Z, so the clock is frozen nearby rather
    // than left on the real one, keeping the case deterministic regardless of
    // when this suite actually runs.
    const fixturePath = join(__dirname, '..', 'fixtures', 'ea-station-L2402.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    const station = fixture.items as EAStation;
    expect(station.riverName).toBe('River Ouse');
    expect(Array.isArray(station.measures)).toBe(true);
    expect((station.measures as EAMeasure[]).length).toBe(5);

    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations: [station], truncated: false });
    // Both qualifying measures carry an inline reading object, so the bulk map
    // is irrelevant to selection here — it stays empty, exactly like a real
    // response would for measures resolved inline.
    fakes.ea.getLatestLevelReadings.mockResolvedValue({ readings: readingsMap([]), truncated: false });
    fakes.ea.getStationDetail.mockResolvedValue(null);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-02T19:20:00Z')); // 5 minutes after both readings
      const result = await callRiverConditions({ ...LONDON, source: 'ea', units: 'metric' }, fakes);
      const text = textOf(result);

      expect(text).toContain('**Level:** 0.56 m');
      expect(text).not.toContain('2.44 m');
      expect(text).toContain('**Observed:** 5 minutes ago');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Forced source: "ea" outside the network -> coverage disclosure, no ✅
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — forced source: "ea" outside the network', () => {
  it('renders the coverage disclosure and never a ✅ when no stations are returned', async () => {
    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations: [], truncated: false });
    fakes.ea.getLatestLevelReadings.mockResolvedValue({ readings: readingsMap([]), truncated: false });

    const result = await callRiverConditions({ ...ROTTERDAM, source: 'ea' }, fakes);
    const text = textOf(result);

    expect(text).toContain('No Environment Agency monitoring stations were found within 25 km');
    expect(text).not.toContain('✅');
  });
});

// ---------------------------------------------------------------------------
// 10. A failed EA fetch propagates (contract, not garnish)
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — a failed EA fetch propagates', () => {
  it('rejects rather than rendering an empty-but-successful gauge list when getStationsNear fails', async () => {
    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockRejectedValue(new Error('Environment Agency flood-monitoring server error (status 503)'));
    fakes.ea.getLatestLevelReadings.mockResolvedValue({ readings: readingsMap([]), truncated: false });

    await expect(callRiverConditions({ ...LONDON, source: 'ea' }, fakes)).rejects.toThrow(
      /Environment Agency flood-monitoring server error/
    );
  });

  it('rejects rather than rendering an empty-but-successful gauge list when getLatestLevelReadings fails', async () => {
    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations: [], truncated: false });
    fakes.ea.getLatestLevelReadings.mockRejectedValue(new Error('Environment Agency flood-monitoring rate limit exceeded'));

    await expect(callRiverConditions({ ...LONDON, source: 'ea' }, fakes)).rejects.toThrow(
      /Environment Agency flood-monitoring rate limit exceeded/
    );
  });
});

// ---------------------------------------------------------------------------
// 11. G47 — the two distinct empty renders differ, and neither is a fabricated all-clear
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — two distinct empty renders (G47)', () => {
  it('renders "no monitoring stations" when the network returns zero stations of any kind', async () => {
    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations: [], truncated: false });
    fakes.ea.getLatestLevelReadings.mockResolvedValue({ readings: readingsMap([]), truncated: false });

    const result = await callRiverConditions({ ...LONDON, source: 'ea' }, fakes);
    const text = textOf(result);

    expect(text).toContain('No Environment Agency monitoring stations were found within 25 km');
    expect(text).not.toContain('No Environment Agency river gauges were found');
    expect(text).not.toContain('✅');
    expect(text).not.toContain('currently clear');
  });

  it('renders "no river gauges" (tidal/coastal note) when stations exist but none carry a riverName', async () => {
    const stations = [
      makeStation('T1', undefined, [makeMeasure('https://x/T1-m')]),
      makeStation('T2', undefined, [makeMeasure('https://x/T2-m')])
    ];
    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations, truncated: false });
    fakes.ea.getLatestLevelReadings.mockResolvedValue({ readings: readingsMap([]), truncated: false });

    const result = await callRiverConditions({ ...LONDON, source: 'ea' }, fakes);
    const text = textOf(result);

    expect(text).toContain('No Environment Agency river gauges were found within 25 km');
    expect(text).toContain('tidal or coastal gauges');
    expect(text).not.toContain('No Environment Agency monitoring stations were found');
    expect(text).not.toContain('✅');
    expect(text).not.toContain('currently clear');
  });
});

// ---------------------------------------------------------------------------
// 12. G8 — the 5-gauge detail fan-out bounds enrichment only
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — the detail fan-out bound is enrichment-only (G8)', () => {
  it('lists and counts all 8 gauges; only the nearest 5 carry a typical range', async () => {
    const entries: Array<[string, { value: number; dateTime: string }]> = [];
    const stations: EAStation[] = [];
    for (let i = 0; i < 8; i++) {
      const id = `https://environment.data.gov.uk/flood-monitoring/id/measures/G${i}-stage-m`;
      stations.push(
        makeStation(`G${i}`, `River Test ${i}`, [makeMeasure(id)], {
          // Ascending distance from LONDON by index, so the nearest 5 are
          // deterministic (G0..G4).
          latitude: LONDON.latitude + i * 0.05,
          longitude: LONDON.longitude
        })
      );
      entries.push([id, { value: 1.0, dateTime: freshIso(5) }]);
    }

    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations, truncated: false });
    fakes.ea.getLatestLevelReadings.mockResolvedValue({ readings: readingsMap(entries), truncated: false });
    fakes.ea.getStationDetail.mockResolvedValue({ typicalRangeLow: 0.4, typicalRangeHigh: 2.0 });

    const result = await callRiverConditions({ ...LONDON, source: 'ea', detail: 'full' }, fakes);
    const text = textOf(result);

    expect(text).toContain('Found 8 river gauges');
    expect((text.match(/\*\*Level:\*\*/g) || []).length).toBe(8);
    expect((text.match(/\*\*Typical range:\*\*/g) || []).length).toBe(5);
    expect(fakes.ea.getStationDetail).toHaveBeenCalledTimes(5);
    expect(text).toContain('typical ranges were fetched for the nearest 5 gauges only');
  });
});

// ---------------------------------------------------------------------------
// 13. A getStationDetail rejection degrades to no range, never fails the request
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — a getStationDetail rejection is garnish, not contract', () => {
  it('renders the level with no typical range and does not fail the request', async () => {
    const id = 'https://environment.data.gov.uk/flood-monitoring/id/measures/DETAILFAIL-stage-m';
    const station = makeStation('DETAILFAIL', 'River Test', [makeMeasure(id)]);
    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations: [station], truncated: false });
    fakes.ea.getLatestLevelReadings.mockResolvedValue({
      readings: readingsMap([[id, { value: 1.5, dateTime: freshIso(5) }]]),
      truncated: false
    });
    fakes.ea.getStationDetail.mockRejectedValue(new Error('Environment Agency flood-monitoring server error (status 500)'));

    const result = await callRiverConditions({ ...LONDON, source: 'ea', units: 'metric' }, fakes);
    const text = textOf(result);

    expect(text).toContain('**Level:** 1.50 m');
    expect(text).not.toContain('Typical range:');
  });
});

// ---------------------------------------------------------------------------
// 14. A named non-Stage measure (tidal gauge) never renders a typical range
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions — a non-Stage measure never renders a typical range (River Tweed at Berwick)', () => {
  it('renders the level with no typical range even when thresholds are available', async () => {
    const id = 'https://environment.data.gov.uk/flood-monitoring/id/measures/BERWICK-tidal-m';
    const station = makeStation('BERWICK', 'River Tweed', [makeMeasure(id, { qualifier: 'Tidal Level' })]);
    const fakes = buildFakes();
    fakes.ea = buildEaFake();
    fakes.ea.getStationsNear.mockResolvedValue({ stations: [station], truncated: false });
    fakes.ea.getLatestLevelReadings.mockResolvedValue({
      readings: readingsMap([[id, { value: 3.1, dateTime: freshIso(5) }]]),
      truncated: false
    });
    // Thresholds ARE available — bandRiverLevel must still refuse a non-Stage
    // measure, so no range should print despite this.
    fakes.ea.getStationDetail.mockResolvedValue({ typicalRangeLow: 1.0, typicalRangeHigh: 3.0 });

    const result = await callRiverConditions({ ...LONDON, source: 'ea', units: 'metric' }, fakes);
    const text = textOf(result);

    expect(text).toContain('River Tweed');
    expect(text).toContain('**Level:** 3.10 m');
    expect(text).not.toContain('Typical range:');
    expect(text).not.toContain('Against typical range:');
  });
});
