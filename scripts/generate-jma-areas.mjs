/**
 * JMA class10 area geometry generator.
 *
 * Fetches two JMA-published const files and emits a committed TypeScript
 * module (`src/data/jmaAreas.ts`) mapping every class10 warning area code to
 * its Japanese/English name, parent office code, and outer-ring polygon(s).
 *
 * Sources:
 *   - https://www.jma.go.jp/bosai/common/const/geojson/class10s.json  (polygons)
 *   - https://www.jma.go.jp/bosai/common/const/area.json              (names + office parents)
 *
 * Run by hand: `npm run generate:jma-areas`. Nothing in CI runs this — the
 * generator is what gets reviewed, its output is committed and read-only in
 * normal operation (see `.devdocs/plan-japan-alerts.md`, "Artifact governance
 * is by properties, not a byte ceiling").
 *
 * ---------------------------------------------------------------------------
 * COORDINATE ORDER — the single most dangerous trap in this file.
 *
 * GeoJSON coordinates are `[lon, lat]`. The consumer, `pointInAnyRing` in
 * `src/utils/pointInPolygon.ts` (see lines 86 and 137), takes `[lat, lon]`.
 * Every ring emitted below MUST be swapped to `[lat, lon]` before it is
 * written out. Get this backwards and every lookup silently resolves to the
 * wrong area, or none — with no exception to catch it.
 * ---------------------------------------------------------------------------
 *
 * Precision: coordinates are rounded to 3 decimal places (~110 m). This was
 * measured at design time (214 KB raw / 53 KB gzipped, vs 184/38 at 2 dp and
 * 241/65 at 4 dp) and is a settled choice — do not change it here.
 *
 * Outer rings only: the design plan verified zero interior rings across all
 * 458 polygons in the live feed, so hole support is unneeded and dropped.
 *
 * One area, `hoppo`, carries no entry in area.json and therefore no parent
 * office. It is still emitted (a later feature renders an explicit "no
 * issuing office" note for it) with `officeCode` left undefined.
 *
 * Its NAME, however, is upstream's map label and is byte-identical to real
 * area 014010 ("\u6839\u5ba4\u5730\u65b9" / "Nemuro"), which has an issuing office and does
 * receive warnings. Names are not unique in this feed generally --
 * "\u5317\u90e8"/"Northern Region" appears 17 times. The emitted header repeats both
 * traps for whoever reads the artifact; nothing is renamed here, because a
 * generated file reproduces its source rather than improving on it.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT_PATH = resolve(ROOT, 'src', 'data', 'jmaAreas.ts');

const CLASS10S_URL = 'https://www.jma.go.jp/bosai/common/const/geojson/class10s.json';
const AREA_URL = 'https://www.jma.go.jp/bosai/common/const/area.json';

// Positive-control thresholds (G47): the live feed measured at design time
// was 153 features / 14,018 coordinate pairs. A rate-limited or errored
// response still returns HTTP 200 with a well-formed but small/empty body,
// so these floors are well below the true count but far above what a
// throttled response could plausibly contain.
const MIN_FEATURES = 140;
const MIN_COORD_PAIRS = 10000;

const COORD_PRECISION = 3;

function fail(message) {
  console.error(`generate-jma-areas: ${message}`);
  process.exit(1);
}

async function fetchJson(url, label) {
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    fail(`network error fetching ${label} (${url}): ${err instanceof Error ? err.message : String(err)}`);
    return undefined; // unreachable; keeps TS-style control flow obvious
  }
  if (response.status !== 200) {
    fail(`${label} returned HTTP ${response.status} (expected 200) from ${url}`);
  }
  let body;
  try {
    body = await response.json();
  } catch (err) {
    fail(`${label} body did not parse as JSON (${url}): ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  return body;
}

const COORD_SCALE = 10 ** COORD_PRECISION;

function round3(value) {
  return Math.round(value * COORD_SCALE) / COORD_SCALE;
}

/**
 * Convert one GeoJSON ring (`[lon, lat]` pairs) into an emitted ring
 * (`[lat, lon]` pairs), rounded to 3 dp with consecutive duplicate points
 * (created by rounding) dropped.
 */
function convertRing(ring) {
  const out = [];
  for (const pair of ring) {
    const lon = round3(pair[0]);
    const lat = round3(pair[1]);
    const prev = out[out.length - 1];
    if (prev && prev[0] === lat && prev[1] === lon) {
      continue;
    }
    out.push([lat, lon]);
  }
  return out;
}

/**
 * Extract the outer ring of every polygon in a Polygon or MultiPolygon
 * geometry, converted to `[lat, lon]`. Interior rings (holes) are dropped —
 * verified absent from the live feed (see module header).
 */
function extractOuterRings(geometry) {
  const rings = [];
  if (geometry.type === 'Polygon') {
    const outer = geometry.coordinates[0];
    if (outer) {
      rings.push(convertRing(outer));
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      const outer = polygon[0];
      if (outer) {
        rings.push(convertRing(outer));
      }
    }
  } else {
    fail(`unexpected geometry type "${geometry.type}" in class10s.json`);
  }
  return rings;
}

function assertPositiveControl(featureCollection) {
  if (!featureCollection || featureCollection.type !== 'FeatureCollection') {
    fail(
      `class10s.json did not parse as a GeoJSON FeatureCollection (got type=${featureCollection && featureCollection.type})`
    );
  }
  const features = featureCollection.features;
  if (!Array.isArray(features) || features.length === 0) {
    fail('class10s.json FeatureCollection has no features — refusing to emit a partial artifact');
  }
  if (features.length < MIN_FEATURES) {
    fail(
      `class10s.json has only ${features.length} features, expected >= ${MIN_FEATURES} ` +
        '(a throttled/error response can still parse to a small, well-formed body — see GOTCHAS G47)'
    );
  }

  let coordPairs = 0;
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const rawRings =
      geometry.type === 'Polygon'
        ? geometry.coordinates
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates.flat(1)
          : [];
    for (const ring of rawRings) {
      coordPairs += ring.length;
    }
  }
  if (coordPairs < MIN_COORD_PAIRS) {
    fail(
      `class10s.json has only ${coordPairs} total coordinate pairs, expected >= ${MIN_COORD_PAIRS} ` +
        '(see GOTCHAS G47 — a throttled response is plausible-looking, not just empty)'
    );
  }

  console.error(
    `generate-jma-areas: positive control passed — ${features.length} features, ${coordPairs} coordinate pairs`
  );
}

function assertAreaShape(areaData) {
  if (!areaData || typeof areaData !== 'object') {
    fail('area.json did not parse as an object');
  }
  if (!areaData.class10s || typeof areaData.class10s !== 'object') {
    fail('area.json has no class10s object — unexpected shape');
  }
  if (!areaData.offices || typeof areaData.offices !== 'object') {
    fail('area.json has no offices object — unexpected shape');
  }
}

function tsStringLiteral(value) {
  return JSON.stringify(value);
}

async function main() {
  const [featureCollection, areaData] = await Promise.all([
    fetchJson(CLASS10S_URL, 'class10s.json'),
    fetchJson(AREA_URL, 'area.json'),
  ]);

  assertPositiveControl(featureCollection);
  assertAreaShape(areaData);

  const class10Index = areaData.class10s;
  const officeIndex = areaData.offices;

  // Group features by class10 code — a handful of codes (island chains) are
  // split across multiple Feature entries in the source file.
  /** @type {Map<string, { name?: string; enName?: string; rings: Array<Array<[number, number]>> }>} */
  const byCode = new Map();

  for (const feature of featureCollection.features) {
    const properties = feature.properties || {};
    const code = properties.code;
    if (!code) {
      fail(`feature missing properties.code: ${JSON.stringify(properties)}`);
    }
    const rings = extractOuterRings(feature.geometry);

    let entry = byCode.get(code);
    if (!entry) {
      entry = { name: undefined, enName: undefined, rings: [] };
      byCode.set(code, entry);
    }
    if (!entry.name && properties.name) {
      entry.name = properties.name;
    }
    if (!entry.enName && properties.enName) {
      entry.enName = properties.enName;
    }
    entry.rings.push(...rings);
  }

  const records = [];
  for (const [code, entry] of byCode) {
    const areaEntry = class10Index[code];

    let name = entry.name;
    let enName = entry.enName;
    let officeCode;

    if (areaEntry) {
      // area.json is the authoritative, complete source for the 142 codes it
      // covers — prefer it over the geojson properties (which are missing
      // enName on a handful of island-chain shard features).
      name = areaEntry.name || name;
      enName = areaEntry.enName || enName;
      officeCode = areaEntry.parent;
    }

    if (!name) {
      fail(`no Japanese name resolved for class10 code ${code}`);
    }
    if (!enName) {
      // Sensible fallback for a missing English name rather than dropping
      // the record (e.g. the "hoppo" area, absent from area.json, still
      // carries an enName in the geojson properties in practice, but this
      // guards a future feed that omits it).
      enName = name;
    }
    if (officeCode !== undefined && !officeIndex[officeCode]) {
      fail(`class10 code ${code} has parent office ${officeCode}, absent from area.json offices`);
    }

    records.push({
      code,
      name,
      enName,
      officeCode,
      rings: entry.rings,
    });
  }

  // Stable, deterministic ordering (acceptance criterion: byte-identical
  // re-runs).
  records.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const generatedDate = new Date().toISOString().slice(0, 10);

  const lines = [];
  lines.push('/**');
  lines.push(' * JMA class10 warning-area geometry — generated, do not hand-edit.');
  lines.push(' *');
  lines.push(' * Generated by `scripts/generate-jma-areas.mjs`. Regenerate with:');
  lines.push(' *   npm run generate:jma-areas');
  lines.push(' *');
  lines.push(' * Sources:');
  lines.push(` *   - ${CLASS10S_URL}`);
  lines.push(` *   - ${AREA_URL}`);
  lines.push(` * Generated: ${generatedDate}`);
  lines.push(' *');
  lines.push(' * Ring coordinates are `[lat, lon]` pairs (swapped from GeoJSON\'s');
  lines.push(' * `[lon, lat]` order) to match `pointInAnyRing` in');
  lines.push(' * `src/utils/pointInPolygon.ts`. Rounded to 3 decimal places (~110 m);');
  lines.push(' * consecutive duplicate points (an artifact of rounding) are dropped.');
  lines.push(' * Outer rings only — the source feed has zero interior rings.');
  lines.push(' *');
  lines.push(' * `officeCode` is undefined for exactly one area (code `hoppo`), which has');
  lines.push(' * no entry in the upstream area.json and therefore no issuing office.');
  lines.push(' *');
  lines.push(' * TWO NAMING TRAPS FOR ANY RENDERER READING THIS DATA:');
  lines.push(' *   1. `hoppo` carries upstream\'s own map label, which is byte-identical');
  lines.push(' *      to real area 014010 ("\u6839\u5ba4\u5730\u65b9" / "Nemuro"). 014010 has an issuing');
  lines.push(' *      office and does receive warnings. Rendering `hoppo`\'s name beside a');
  lines.push(' *      "no issuing office" note therefore states something false about');
  lines.push(' *      014010. Key the no-office case off `officeCode === undefined` and do');
  lines.push(' *      not print the name for it.');
  lines.push(' *   2. Names are NOT unique. "\u5317\u90e8" / "Northern Region" appears 17 times and');
  lines.push(' *      "\u5357\u90e8" / "Southern Region" 18 times \u2014 they are prefecture sub-region');
  lines.push(' *      labels, meaningful only beside their parent office. Never present a');
  lines.push(' *      bare area name as if it identified a place.');
  lines.push(' */');
  lines.push('');
  lines.push('/** One class10 JMA warning area. */');
  lines.push('export interface JmaClass10Area {');
  lines.push('  /** class10 area code, e.g. "130010". */');
  lines.push('  readonly code: string;');
  lines.push('  /** Japanese name, e.g. "東京地方". */');
  lines.push('  readonly name: string;');
  lines.push('  /** English name, e.g. "Tokyo Region". */');
  lines.push('  readonly enName: string;');
  lines.push('  /** Parent JMA office code. Undefined for the one area with no issuing office. */');
  lines.push('  readonly officeCode?: string;');
  lines.push('  /** Outer-ring polygons, each a list of [lat, lon] pairs. */');
  lines.push('  readonly rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;');
  lines.push('}');
  lines.push('');

  lines.push('export const JMA_CLASS10_AREAS: readonly JmaClass10Area[] = [');
  for (const record of records) {
    lines.push('  {');
    lines.push(`    code: ${tsStringLiteral(record.code)},`);
    lines.push(`    name: ${tsStringLiteral(record.name)},`);
    lines.push(`    enName: ${tsStringLiteral(record.enName)},`);
    if (record.officeCode !== undefined) {
      lines.push(`    officeCode: ${tsStringLiteral(record.officeCode)},`);
    }
    lines.push('    rings: [');
    for (const ring of record.rings) {
      const pointsText = ring.map((point) => `[${point[0]}, ${point[1]}]`).join(', ');
      lines.push(`      [${pointsText}],`);
    }
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');

  const output = lines.join('\n');
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, output, 'utf8');
  console.error(`generate-jma-areas: wrote ${records.length} areas to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
