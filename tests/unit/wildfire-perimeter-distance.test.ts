/**
 * Handler-level tests for RF-26: NIFC fires are measured to the mapped perimeter
 * (zero inside it), else to the reported point of origin, else listed as unlocated.
 * Every case goes through handleGetWildfireInfo (GOTCHAS G45), with multi-vertex
 * `[lon, lat]` rings in the live WFIGS shape (G48).
 *
 * The fixture builder takes every optional input explicitly and has no defaults, so
 * an `undefined` argument builds the absent case rather than a default (G95).
 * Negative assertions are scoped to a parsed block or section (G96) and name the
 * construct, not a bare word (G62). No fixture distance sits on an exact half at one
 * decimal (G36).
 *
 * No FIRMS service is wired, so every call stays on NIFC.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import { calculateDistance } from '../../src/utils/distance.js';
import type { FirePerimeterFeature, NIFCQueryResponse } from '../../src/types/wildfire.js';

const BASE_LAT = 38.5816;
const BASE_LON = -121.4944;
const KM_PER_DEG_LAT = 111;
const KM_PER_DEG_LON = 111 * Math.cos((BASE_LAT * Math.PI) / 180);

const queryFirePerimetersMock = vi.fn();
const nifcService = { queryFirePerimeters: queryFirePerimetersMock } as never;
const locationStore = {} as never;
const geocodingService = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

async function render(features: FirePerimeterFeature[], radius: number): Promise<string> {
  queryFirePerimetersMock.mockResolvedValue({ features } as NIFCQueryResponse);
  const result = await handleGetWildfireInfo(
    { latitude: BASE_LAT, longitude: BASE_LON, radius },
    nifcService,
    locationStore,
    geocodingService
  );
  return result.content[0].text;
}

/** A point `northKm` north and `eastKm` east of the query point. */
function offset(northKm: number, eastKm: number): { lat: number; lon: number } {
  return { lat: BASE_LAT + northKm / KM_PER_DEG_LAT, lon: BASE_LON + eastKm / KM_PER_DEG_LON };
}

/**
 * A closed square ring of `[lon, lat]` pairs centred `northKm`/`eastKm` from the
 * query point, `halfKm` from centre to each side. Eight vertices (corners and side
 * midpoints) so it is a real multi-vertex ring, not a degenerate one.
 */
function squareRing(northKm: number, eastKm: number, halfKm: number): number[][] {
  const pts: Array<[number, number]> = [
    [-halfKm, -halfKm], [0, -halfKm], [halfKm, -halfKm], [halfKm, 0],
    [halfKm, halfKm], [0, halfKm], [-halfKm, halfKm], [-halfKm, 0]
  ];
  return pts.map(([n, e]) => {
    const p = offset(northKm + n, eastKm + e);
    return [p.lon, p.lat];
  });
}

interface FireSpec {
  name: string;
  type: 'WF' | 'RX';
  originLat: unknown;
  originLon: unknown;
  /** `undefined` builds a feature with no `geometry` key at all. */
  rings: unknown;
  containment: unknown;
}

function fire(spec: FireSpec): FirePerimeterFeature {
  const feature = {
    attributes: {
      poly_IncidentName: spec.name,
      attr_IncidentTypeCategory: spec.type,
      poly_GISAcres: 1200,
      attr_PercentContained: spec.containment,
      attr_FireDiscoveryDateTime: Date.parse('2026-07-10T00:00:00Z'),
      attr_InitialLatitude: spec.originLat,
      attr_InitialLongitude: spec.originLon,
      attr_POOState: 'CA'
    },
    ...(spec.rings === undefined ? {} : { geometry: { rings: spec.rings } })
  };
  return feature as unknown as FirePerimeterFeature;
}

/** The block of one fire, `## <name>` through its closing rule. Throws if absent. */
function fireBlock(text: string, name: string): string {
  const start = text.indexOf(`## ${name}\n`);
  if (start < 0) throw new Error(`no block for ${name}`);
  const end = text.indexOf('\n---\n', start);
  if (end < 0) throw new Error(`unterminated block for ${name}`);
  return text.slice(start, end);
}

/** The Safety Assessment section, heading through the footer rule. Throws if absent. */
function safetySection(text: string): string {
  const m = text.match(/## Safety Assessment\n\n[\s\S]*?(?=\n---\n\*Data source)/);
  if (!m) throw new Error('no Safety Assessment section');
  return m[0];
}

const TIER_OR_ALL_CONTAINED =
  /EXTREME DANGER|HIGH ALERT|\*\*CAUTION\*\*|\*\*AWARENESS\*\*|All fires within radius are 100% contained/;

const INSIDE_LINE = '**Measured to:** the mapped fire perimeter — this location is inside it\n';
const EDGE_LINE = '**Measured to:** nearest edge of the mapped fire perimeter\n';
const ORIGIN_LINE = '**Measured to:** reported point of origin (NIFC published no usable perimeter)\n';
const UNLOCATED_LINE =
  '**Measured to:** not available — NIFC published neither a perimeter nor a point of origin\n';

describe('contract 1: a point inside the mapped perimeter', () => {
  it('prints 0.0 km, the inside line, and EXTREME DANGER for an uncontained wildfire', async () => {
    const origin = offset(20.3, 0);
    const text = await render([
      fire({
        name: 'Inside Fire', type: 'WF', originLat: origin.lat, originLon: origin.lon,
        rings: [squareRing(0.4, -0.2, 2)], containment: 10
      })
    ], 50);

    const block = fireBlock(text, 'Inside Fire');
    expect(block).toContain(`**Distance:** 0.0 km (0.00 mi)\n${INSIDE_LINE}`);
    expect(safetySection(text)).toContain('⚠️ **EXTREME DANGER** - Wildfire within 5 km\n');
  });

  it('prints the nearest-edge line, not the inside line, 0.03 km outside (displays 0.0)', async () => {
    const text = await render([
      fire({
        name: 'Edge Fire', type: 'WF', originLat: undefined, originLon: undefined,
        rings: [squareRing(-2.03, 0, 2)], containment: 10
      })
    ], 50);

    const block = fireBlock(text, 'Edge Fire');
    expect(block).toContain(`**Distance:** 0.0 km (0.00 mi)\n${EDGE_LINE}`);
    expect(block).not.toContain(INSIDE_LINE);
  });
});

describe('contract 3 at handler level: a point in a hole', () => {
  it('is outside, measured to the hole edge', async () => {
    const text = await render([
      fire({
        name: 'Ring Fire', type: 'WF', originLat: undefined, originLon: undefined,
        rings: [squareRing(0, 0, 10), squareRing(0.3, 0, 3)], containment: 10
      })
    ], 50);

    const block = fireBlock(text, 'Ring Fire');
    const m = block.match(/\*\*Distance:\*\* ([\d.]+) km/);
    if (!m) throw new Error('no distance line');
    // Hole centred 0.3 km north, 3 km half-side: the nearest side is the south one,
    // 2.7 km away. The outer ring is 10 km away on every side.
    expect(Number(m[1])).toBe(2.7);
    expect(block).toContain(EDGE_LINE);
    expect(block).not.toContain(INSIDE_LINE);
  });
});

describe('contract 4: perimeter beats origin', () => {
  it('lists, sorts, prints and bands on the ring edge 3 km away, not the origin 60 km away', async () => {
    const farOrigin = offset(60.2, 0);
    const tenKm = offset(0, 10.2);
    const text = await render([
      fire({
        name: 'Ten Km Fire', type: 'WF', originLat: tenKm.lat, originLon: tenKm.lon,
        rings: [[[tenKm.lon, tenKm.lat]]], containment: 10
      }),
      fire({
        name: 'Big Fire', type: 'WF', originLat: farOrigin.lat, originLon: farOrigin.lon,
        rings: [squareRing(-4.03, 0.5, 1)], containment: 10
      })
    ], 50);

    const block = fireBlock(text, 'Big Fire');
    expect(block).toContain(`**Distance:** 3.0 km (1.86 mi)\n${EDGE_LINE}`);
    expect(text.indexOf('## Big Fire\n')).toBeLessThan(text.indexOf('## Ten Km Fire\n'));
    expect(safetySection(text)).toContain('⚠️ **EXTREME DANGER** - Wildfire within 5 km\n');
  });

  it('drops a fire whose origin is 3 km away but whose ring is 60 km away (radius 50)', async () => {
    const nearOrigin = offset(3.2, 0);
    const tenKm = offset(0, 10.2);
    const text = await render([
      fire({
        name: 'Ten Km Fire', type: 'WF', originLat: tenKm.lat, originLon: tenKm.lon,
        rings: [[[tenKm.lon, tenKm.lat]]], containment: 10
      }),
      fire({
        name: 'Mirror Fire', type: 'WF', originLat: nearOrigin.lat, originLon: nearOrigin.lon,
        rings: [squareRing(61.2, 0, 1)], containment: 10
      })
    ], 50);

    expect(text).toContain('## Ten Km Fire\n');
    expect(text).not.toContain('## Mirror Fire\n');
    expect(text).toContain('**Found 1 active fire**');
  });
});

describe('contract 5: origin fallback and its label', () => {
  const origin = offset(20.3, 0);

  it.each([
    ['no geometry key', undefined],
    ['an empty ring list', []]
  ])('uses the origin with %s and labels it', async (_label, rings) => {
    const text = await render([
      fire({
        name: 'Origin Fire', type: 'WF', originLat: origin.lat, originLon: origin.lon,
        rings, containment: 10
      })
    ], 50);

    const block = fireBlock(text, 'Origin Fire');
    const km = calculateDistance(BASE_LAT, BASE_LON, origin.lat, origin.lon);
    const shown = Number(km.toFixed(1));
    expect(block).toContain(
      `**Distance:** ${shown.toFixed(1)} km (${(shown * 0.621371).toFixed(2)} mi)\n${ORIGIN_LINE}`
    );
    expect(block).toContain(
      `**Point of Origin (reported):** ${origin.lat.toFixed(4)}, ${origin.lon.toFixed(4)}\n`
    );
  });

  it.each([
    ['latitude 0', 0, BASE_LON],
    ['longitude 0', BASE_LAT, 0],
    ['latitude 91', 91, BASE_LON],
    ['longitude 181', BASE_LAT, 181]
  ])('treats an origin at %s as unusable: the fire is unlocated, listed, and has no origin line', async (_label, lat, lon) => {
    const text = await render([
      fire({
        name: 'Sentinel Fire', type: 'WF', originLat: lat, originLon: lon,
        rings: undefined, containment: 10
      })
    ], 50);

    const block = fireBlock(text, 'Sentinel Fire');
    expect(block).toContain(`**Distance:** not reported\n${UNLOCATED_LINE}`);
    expect(block).not.toContain('**Point of Origin (reported):**');
    expect(text).toContain('**Found 1 active fire**');
  });
});

describe('contract 6: an unlocated fire is kept', () => {
  it('lists it last, counts it, names it in the Safety Assessment, and lets the located fire set the tier', async () => {
    const located = offset(12.2, 0);
    const text = await render([
      fire({
        name: 'Nowhere Fire', type: 'WF', originLat: null, originLon: null,
        rings: undefined, containment: 10
      }),
      fire({
        name: 'Located Fire', type: 'WF', originLat: located.lat, originLon: located.lon,
        rings: [[[located.lon, located.lat]]], containment: 10
      })
    ], 50);

    const block = fireBlock(text, 'Nowhere Fire');
    expect(block).toContain(`**Distance:** not reported\n${UNLOCATED_LINE}`);
    expect(text.indexOf('## Located Fire\n')).toBeLessThan(text.indexOf('## Nowhere Fire\n'));
    expect(text).toContain('🔥 **Found 2 active fires**\n   - 2 wildfires\n');

    const section = safetySection(text);
    expect(section).toContain('🟠 **HIGH ALERT** - Wildfire within 25 km\n');
    expect(section).toContain(
      '⚠️ 1 wildfire in this search area has no published location (Nowhere Fire). ' +
      'Its distance is unknown and is not reflected in any tier above. ' +
      'Do not read this section as an all-clear.\n'
    );
  });

  it('pins the plural line and caps the names at five', async () => {
    const names = ['A Fire', 'B Fire', 'C Fire', 'D Fire', 'E Fire', 'F Fire', 'G Fire'];
    const text = await render(names.map(name => fire({
      name, type: 'WF', originLat: undefined, originLon: undefined, rings: undefined, containment: 10
    })), 50);

    expect(safetySection(text)).toContain(
      '⚠️ 7 wildfires in this search area have no published location ' +
      '(A Fire, B Fire, C Fire, D Fire, E Fire and 2 more). ' +
      'Their distance is unknown and is not reflected in any tier above. ' +
      'Do not read this section as an all-clear.\n'
    );
  });

  it('a lone unlocated uncontained wildfire selects no tier and no all-contained line', async () => {
    const text = await render([
      fire({
        name: 'Lone Fire', type: 'WF', originLat: undefined, originLon: undefined,
        rings: undefined, containment: 10
      })
    ], 50);

    const section = safetySection(text);
    expect(section).not.toMatch(TIER_OR_ALL_CONTAINED);
    expect(section).toBe(
      '## Safety Assessment\n\n' +
      '⚠️ 1 wildfire in this search area has no published location (Lone Fire). ' +
      'Its distance is unknown and is not reflected in any tier above. ' +
      'Do not read this section as an all-clear.\n\n'
    );
  });

  it('a lone unlocated wildfire with unknown containment selects no tier either', async () => {
    const text = await render([
      fire({
        name: 'Lone Fire', type: 'WF', originLat: undefined, originLon: undefined,
        rings: undefined, containment: null
      })
    ], 50);

    expect(safetySection(text)).not.toMatch(TIER_OR_ALL_CONTAINED);
  });

  it('a lone unlocated 100%-contained wildfire keeps the all-contained block and adds the line', async () => {
    const text = await render([
      fire({
        name: 'Done Fire', type: 'WF', originLat: undefined, originLon: undefined,
        rings: undefined, containment: 100
      })
    ], 50);

    const section = safetySection(text);
    expect(section).toContain('ℹ️ All fires within radius are 100% contained.\n');
    expect(section).toContain('⚠️ 1 wildfire in this search area has no published location (Done Fire).');
  });
});

describe('contract 9: a one-vertex ring equal to the origin', () => {
  it('prints the perimeter basis and the same figure the origin distance gives', async () => {
    const p = offset(7.33, 1.1);
    const text = await render([
      fire({
        name: 'Point Fire', type: 'WF', originLat: p.lat, originLon: p.lon,
        rings: [[[p.lon, p.lat]]], containment: 10
      })
    ], 50);

    const km = calculateDistance(BASE_LAT, BASE_LON, p.lat, p.lon);
    const shown = Number(km.toFixed(1));
    expect(fireBlock(text, 'Point Fire')).toContain(
      `**Distance:** ${shown.toFixed(1)} km (${(shown * 0.621371).toFixed(2)} mi)\n${EDGE_LINE}`
    );
  });
});
