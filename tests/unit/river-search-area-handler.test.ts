/**
 * Handler-level tests for the get_river_conditions search area: the radius clamp
 * (rendered as the `Search Radius` line) on the NWPS and Environment Agency paths,
 * and the nearest-first order and circular radius filter on the NWPS path. Replaces
 * the arithmetic copies that used to live in security-v1.6.test.ts.
 *
 * The NWPS fake builder is a top-level helper so a later describe in this file (the
 * bounding-box arguments) can reuse it. Helpers are copied from riverConditions.test.ts
 * and river-conditions-ea.test.ts, never imported.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetRiverConditions } from '../../src/handlers/riverConditionsHandler.js';
import { calculateDistance } from '../../src/utils/distance.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { EnvironmentAgencyService } from '../../src/services/environmentAgency.js';
import type { NWPSGauge } from '../../src/types/noaa.js';

const BASE_LAT = 42.3601;
const BASE_LON = -71.0589;
/** London — only used with source: 'ea', so no routing or Nominatim is involved. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

// ---------------------------------------------------------------------------
// NWPS fake (reusable)
// ---------------------------------------------------------------------------

/** Detail mock that hands back the gauge the bbox mock returned (see riverConditions.test.ts). */
function detailFromBbox(bboxMock: ReturnType<typeof vi.fn>): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (lid: string) => {
    const lastCall = bboxMock.mock.results.at(-1);
    const gauges = (lastCall ? await lastCall.value : []) as NWPSGauge[];
    const found = gauges.find(g => g.lid === lid);
    if (!found) {
      throw new Error(`no detail response for ${lid}`);
    }
    return found;
  });
}

function buildNwpsFake() {
  const getNWPSGaugesInBoundingBox = vi.fn();
  const getNWPSGauge = detailFromBbox(getNWPSGaugesInBoundingBox);
  return {
    getNWPSGaugesInBoundingBox,
    getNWPSGauge,
    service: { getNWPSGaugesInBoundingBox, getNWPSGauge } as unknown as NOAAService
  };
}

function buildGaugeAt(lid: string, name: string, latitude: number, longitude: number): NWPSGauge {
  return {
    lid,
    name,
    latitude,
    longitude,
    state: { abbreviation: 'MA', name: 'Massachusetts' },
    status: {
      observed: {
        primary: 4.2,
        secondary: 0.05,
        floodCategory: null,
        validTime: '2026-07-16T14:00:00Z'
      }
    }
  };
}

function callNwps(nwps: ReturnType<typeof buildNwpsFake>, args: Record<string, unknown>) {
  return handleGetRiverConditions(
    { latitude: BASE_LAT, longitude: BASE_LON, ...args },
    nwps.service,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    {} as unknown as OpenMeteoService
  );
}

// ---------------------------------------------------------------------------
// EA fake
// ---------------------------------------------------------------------------

function buildEaFake() {
  return {
    getStationsNear: vi.fn(),
    getLatestLevelReadings: vi.fn(),
    getStationDetail: vi.fn()
  };
}

function callEa(ea: ReturnType<typeof buildEaFake>, args: Record<string, unknown>) {
  return handleGetRiverConditions(
    { ...LONDON, source: 'ea', ...args },
    {} as unknown as NOAAService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    {} as unknown as OpenMeteoService,
    undefined,
    ea as unknown as EnvironmentAgencyService
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Radius clamp
// ---------------------------------------------------------------------------

// [label, input radius, whole expected line]. Default is 50 km on this path.
describe('handleGetRiverConditions radius clamp (NWPS path)', () => {
  const rows: Array<[string, unknown, string]> = [
    ['1000 clamps to 500', 1000, '**Search Radius:** 500 km (310.7 miles)\n'],
    ['0.5 clamps to 1', 0.5, '**Search Radius:** 1 km (0.6 miles)\n'],
    ['-10 clamps to 1', -10, '**Search Radius:** 1 km (0.6 miles)\n'],
    ['NaN falls back to the default', NaN, '**Search Radius:** 50 km (31.1 miles)\n'],
    ['Infinity falls back to the default', Infinity, '**Search Radius:** 50 km (31.1 miles)\n'],
    ['-Infinity falls back to the default', -Infinity, '**Search Radius:** 50 km (31.1 miles)\n'],
    ['a numeric string falls back to the default', '25', '**Search Radius:** 50 km (31.1 miles)\n'],
    ['omitted falls back to the default', undefined, '**Search Radius:** 50 km (31.1 miles)\n'],
    ['37.5 passes through', 37.5, '**Search Radius:** 37.5 km (23.3 miles)\n']
  ];

  it.each(rows)('%s', async (_label, radius, expectedLine) => {
    const nwps = buildNwpsFake();
    nwps.getNWPSGaugesInBoundingBox.mockResolvedValue([]);

    const result = await callNwps(nwps, { radius });
    const text = result.content[0].text;

    expect(text).toContain(expectedLine);
  });
});

describe('handleGetRiverConditions radius clamp (EA path)', () => {
  // [label, input radius, radius handed to getStationsNear, whole line]. Default is 25 km.
  const rows: Array<[string, unknown, number, string]> = [
    ['1000 clamps to 500', 1000, 500, '**Search Radius:** 500 km (310.7 miles)\n'],
    ['0.5 clamps to 1', 0.5, 1, '**Search Radius:** 1 km (0.6 miles)\n'],
    ['-10 clamps to 1', -10, 1, '**Search Radius:** 1 km (0.6 miles)\n'],
    ['NaN falls back to the default', NaN, 25, '**Search Radius:** 25 km (15.5 miles)\n'],
    ['Infinity falls back to the default', Infinity, 25, '**Search Radius:** 25 km (15.5 miles)\n'],
    ['-Infinity falls back to the default', -Infinity, 25, '**Search Radius:** 25 km (15.5 miles)\n'],
    ['a numeric string falls back to the default', '25', 25, '**Search Radius:** 25 km (15.5 miles)\n'],
    ['omitted falls back to the default', undefined, 25, '**Search Radius:** 25 km (15.5 miles)\n'],
    ['37.5 passes through', 37.5, 37.5, '**Search Radius:** 37.5 km (23.3 miles)\n']
  ];

  it.each(rows)('%s', async (_label, radius, searched, expectedLine) => {
    const ea = buildEaFake();
    ea.getStationsNear.mockResolvedValue({ stations: [], truncated: false });
    ea.getLatestLevelReadings.mockResolvedValue({ readings: new Map(), truncated: false });

    const result = await callEa(ea, { radius });
    const text = result.content[0].text;

    expect(text).toContain(expectedLine);
    expect(ea.getStationsNear).toHaveBeenCalledWith(LONDON.latitude, LONDON.longitude, searched);
  });
});

// ---------------------------------------------------------------------------
// Nearest-first order and radius filter (NWPS)
// ---------------------------------------------------------------------------

describe('handleGetRiverConditions nearest-first order and radius filter (NWPS path)', () => {
  // radius 50 km. Distances from BASE_LAT/BASE_LON by calculateDistance:
  //   Far Gauge     30 km north  (30.05 km)
  //   Near Gauge     5 km north  (5.01 km)
  //   Corner Gauge  at 0.9 x the box half-width on both axes: inside the bounding box,
  //                 63.65 km away, beyond the 50 km radius.
  const RADIUS = 50;
  const lonOffset = (0.9 * RADIUS) / (111 * Math.cos((BASE_LAT * Math.PI) / 180));
  const FAR = { lat: BASE_LAT + 30 / 111, lon: BASE_LON };
  const NEAR = { lat: BASE_LAT + 5 / 111, lon: BASE_LON };
  const CORNER = { lat: BASE_LAT + (0.9 * RADIUS) / 111, lon: BASE_LON + lonOffset };

  it('fixture distances are what the comments say', () => {
    const km = (p: { lat: number; lon: number }) => calculateDistance(BASE_LAT, BASE_LON, p.lat, p.lon);
    expect(km(FAR)).toBeGreaterThan(29);
    expect(km(FAR)).toBeLessThan(31);
    expect(km(NEAR)).toBeGreaterThan(4);
    expect(km(NEAR)).toBeLessThan(6);
    expect(km(CORNER)).toBeGreaterThan(RADIUS);
    expect(km(CORNER)).toBeLessThan(RADIUS * 1.5);
  });

  it('lists the near gauge before the far gauge and drops the gauge beyond the radius', async () => {
    const nwps = buildNwpsFake();
    nwps.getNWPSGaugesInBoundingBox.mockResolvedValue([
      buildGaugeAt('FARG1', 'Far Gauge', FAR.lat, FAR.lon),
      buildGaugeAt('NEARG', 'Near Gauge', NEAR.lat, NEAR.lon),
      buildGaugeAt('CORG1', 'Corner Gauge', CORNER.lat, CORNER.lon)
    ]);

    const result = await callNwps(nwps, { radius: RADIUS });
    const text = result.content[0].text;

    expect(text).toContain('## Near Gauge\n');
    expect(text).toContain('## Far Gauge\n');
    expect(text.indexOf('## Near Gauge\n')).toBeLessThan(text.indexOf('## Far Gauge\n'));
    expect(text).not.toContain('Corner Gauge');
    expect(text).toContain('**Found 2 river gauges**');
  });
});
