/**
 * Handler-level tests for the get_wildfire_info search area on the NIFC path: the
 * radius clamp (rendered as the `Search Radius` line), the nearest-first order and
 * the circular radius filter. Replaces the arithmetic copies that used to live in
 * security-v1.6.test.ts.
 *
 * No FIRMS service is wired, so every call stays on NIFC (wildfireHandler.ts: a FIRMS
 * route without an injected service falls through). The clamp runs before routing, so
 * this one table covers the FIRMS path too. Helpers are copied from
 * wildfire-handler.test.ts, never imported.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import { calculateDistance } from '../../src/utils/distance.js';
import type { FirePerimeterFeature, NIFCQueryResponse } from '../../src/types/wildfire.js';

const BASE_LAT = 38.5816;
const BASE_LON = -121.4944;

const queryFirePerimetersMock = vi.fn();
const nifcService = { queryFirePerimeters: queryFirePerimetersMock } as never;
const locationStore = {} as never;
const geocodingService = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

function callHandler(args: Record<string, unknown>) {
  return handleGetWildfireInfo(
    { latitude: BASE_LAT, longitude: BASE_LON, ...args },
    nifcService,
    locationStore,
    geocodingService
  );
}

function buildFireAt(name: string, lat: number, lon: number): FirePerimeterFeature {
  return {
    attributes: {
      poly_IncidentName: name,
      attr_IncidentTypeCategory: 'WF',
      poly_GISAcres: 100,
      attr_PercentContained: 25,
      attr_FireDiscoveryDateTime: Date.parse('2026-07-10T00:00:00Z'),
      attr_InitialLatitude: lat,
      attr_InitialLongitude: lon,
      attr_POOState: 'CA'
    },
    geometry: { rings: [[[lon, lat]]] }
  };
}

describe('handleGetWildfireInfo radius clamp (NIFC path)', () => {
  // [label, input radius, expected whole line]. Default is 100 km on this tool.
  const rows: Array<[string, unknown, string]> = [
    ['1000 clamps to 500', 1000, '**Search Radius:** 500 km (310.7 miles)\n'],
    ['0.5 clamps to 1', 0.5, '**Search Radius:** 1 km (0.6 miles)\n'],
    ['-10 clamps to 1', -10, '**Search Radius:** 1 km (0.6 miles)\n'],
    ['NaN falls back to the default', NaN, '**Search Radius:** 100 km (62.1 miles)\n'],
    ['Infinity falls back to the default', Infinity, '**Search Radius:** 100 km (62.1 miles)\n'],
    ['-Infinity falls back to the default', -Infinity, '**Search Radius:** 100 km (62.1 miles)\n'],
    ['a numeric string falls back to the default', '25', '**Search Radius:** 100 km (62.1 miles)\n'],
    ['omitted falls back to the default', undefined, '**Search Radius:** 100 km (62.1 miles)\n'],
    ['37.5 passes through', 37.5, '**Search Radius:** 37.5 km (23.3 miles)\n']
  ];

  it.each(rows)('%s', async (_label, radius, expectedLine) => {
    queryFirePerimetersMock.mockResolvedValue({ features: [] } as NIFCQueryResponse);

    const result = await callHandler({ radius });
    const text = result.content[0].text;

    expect(text).toContain(expectedLine);
  });
});

describe('handleGetWildfireInfo nearest-first order and radius filter (NIFC path)', () => {
  // radius 50 km. Distances from BASE_LAT/BASE_LON by calculateDistance:
  //   Far Fire    30 km north  (30.05 km)
  //   Near Fire    5 km north  (5.01 km)
  //   Corner Fire  at 0.9 x the box half-width on both axes: inside the NIFC bounding box,
  //               63.66 km away, beyond the 50 km radius.
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

  it('lists the near fire before the far fire and drops the fire beyond the radius', async () => {
    queryFirePerimetersMock.mockResolvedValue({
      features: [
        buildFireAt('Far Fire', FAR.lat, FAR.lon),
        buildFireAt('Near Fire', NEAR.lat, NEAR.lon),
        buildFireAt('Corner Fire', CORNER.lat, CORNER.lon)
      ]
    } as NIFCQueryResponse);

    const result = await callHandler({ radius: RADIUS });
    const text = result.content[0].text;

    expect(text).toContain('## Near Fire\n');
    expect(text).toContain('## Far Fire\n');
    expect(text.indexOf('## Near Fire\n')).toBeLessThan(text.indexOf('## Far Fire\n'));
    expect(text).not.toContain('Corner Fire');
    expect(text).toContain('**Found 2 active fires**');
  });
});
