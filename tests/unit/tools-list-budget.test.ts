/**
 * Locks the `tools/list` payload against silent regrowth and against silent
 * loss of hand-tuned guidance text.
 *
 * The MCP `tools/list` result goes into model context on every turn of every
 * client session, so its byte size is a standing context cost. T1-T4 cut it
 * from 40,212 to 30,812 bytes (`full`) and 17,442 to 12,979 (`basic`) by
 * removing schema restatement and output enumeration from tool and parameter
 * descriptions. Before this file, nothing in the repo measured that payload
 * and nothing asserted on any tool or parameter description text, so nothing
 * would notice either regression.
 *
 * This file carries three contracts:
 *   1. Budget    — the stringified `tools/list` payload for `basic` and `full`
 *                  stays under TOOLS_LIST_BYTE_BUDGET (src/config/tools.ts).
 *   2. Guidance  — a fixed set of hand-tuned phrases survive at a fixed count
 *                  in the `full` payload (tool AND parameter descriptions).
 *   3. Shape     — the params/required/enums shape of all 17 tools' input
 *                  schemas matches a fingerprint generated from `main`
 *                  (80d901a), so T1-T4 are proven to have changed no
 *                  parameter, enum, default, or `required` entry.
 *
 * --- G61: importing src/index.ts runs main() ---
 *
 * src/index.ts calls main() unconditionally at module scope, which constructs
 * a StdioServerTransport and calls server.connect(). Stub the transport so
 * connect() has something to call start() on, rather than attaching to this
 * worker's stdin. Import it exactly once, statically — never re-import it
 * under vi.resetModules(), which would re-run main().
 *
 * --- Why this file needs a FOURTH vi.hoisted pin beyond the usual three ---
 *
 * WEATHER_LIGHTNING_PREWARM / ANALYTICS_ENABLED / ANALYTICS_SALT are the
 * standard three (see tests/unit/tool-name-parity.test.ts for why each is
 * needed). This file adds a fourth: WEATHER_DEFAULT_LOCATION = ''. The reason
 * is a three-link chain:
 *
 *   1. DEFAULT_LOCATION_HINT (src/index.ts:301-303) is folded into
 *      `latitude`'s description at MODULE LOAD, so it is baked into eleven
 *      tools' schemas before any test in this file runs.
 *   2. src/index.ts:9 is `import 'dotenv/config'`, so the import reads the
 *      repo's own gitignored .env (G26). A developer machine with
 *      WEATHER_DEFAULT_LOCATION set in .env would measure a larger payload
 *      than CI does. dotenv does NOT overwrite a key already present in
 *      process.env, which is exactly why this pin must be hoisted (set
 *      before the import evaluates) rather than set in a beforeEach.
 *   3. getDefaultLocation() (src/config/defaultLocation.ts:22-27) trims and
 *      treats a blank string as unset, so '' is a clean "no default" and not
 *      a default literally named "".
 *
 * If this pin silently failed, and the byte-budget constants had been
 * measured in the same broken environment, every assertion here would pass
 * while measuring the wrong thing. So the positive-control test below
 * asserts DIRECTLY that DEFAULT_LOCATION_HINT's own distinctive phrase is
 * absent — not a generic word like "default", which would break the moment
 * any unrelated description uses it (G62: assert the construct, not a
 * vocabulary word).
 */

import { describe, it, expect, vi } from 'vitest';

// src/index.ts calls main() unconditionally at module scope, which constructs a
// StdioServerTransport and calls server.connect(). Stub the transport so connect()
// has something to call start() on, rather than attaching to this worker's stdin.
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    async start() {}
    async close() {}
    async send() {}
  }
}));

// All four must be set before the static import below evaluates.
vi.hoisted(() => {
  process.env.WEATHER_LIGHTNING_PREWARM = 'false';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'tools-list-budget-test';
  process.env.WEATHER_DEFAULT_LOCATION = ''; // the fourth pin — see header comment
});

// Import src/index.js exactly once, statically. Never re-import it under
// vi.resetModules() — that re-runs main().
import { TOOL_DEFINITIONS } from '../../src/index.js';
import { PRESETS, TOOLS_LIST_BYTE_BUDGET } from '../../src/config/tools.js';

type JsonSchemaProperty = {
  enum?: unknown[];
  items?: { enum?: unknown[] };
};

type ToolDefinitionShape = {
  name: string;
  description?: string;
  inputSchema: {
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
};

const DEFS = TOOL_DEFINITIONS as unknown as Record<string, ToolDefinitionShape>;

// -----------------------------------------------------------------------
// Positive control: prove the fourth pin actually took effect.
// -----------------------------------------------------------------------

describe('WEATHER_DEFAULT_LOCATION pin took effect (positive control)', () => {
  it('the default-location hint phrase is absent from get_forecast.latitude', () => {
    // G62: assert the construct (DEFAULT_LOCATION_HINT's own distinctive
    // phrase), not a vocabulary word like "default" that could appear
    // unrelated elsewhere.
    expect(DEFS.get_forecast.inputSchema.properties!.latitude.description)
      .not.toContain('configured default location');
  });
});

// -----------------------------------------------------------------------
// Contract 1: byte budget
// -----------------------------------------------------------------------

function payloadFor(preset: readonly string[]): string {
  return JSON.stringify(preset.map((name) => DEFS[name]));
}

describe('tools/list byte budget', () => {
  it(`basic payload stays within TOOLS_LIST_BYTE_BUDGET.basic (${TOOLS_LIST_BYTE_BUDGET.basic})`, () => {
    const size = payloadFor(PRESETS.basic).length;
    expect(size, `basic tools/list payload is ${size} bytes, budget is ${TOOLS_LIST_BYTE_BUDGET.basic}`)
      .toBeLessThanOrEqual(TOOLS_LIST_BYTE_BUDGET.basic);
  });

  it(`full payload stays within TOOLS_LIST_BYTE_BUDGET.full (${TOOLS_LIST_BYTE_BUDGET.full})`, () => {
    const size = payloadFor(PRESETS.full).length;
    expect(size, `full tools/list payload is ${size} bytes, budget is ${TOOLS_LIST_BYTE_BUDGET.full}`)
      .toBeLessThanOrEqual(TOOLS_LIST_BYTE_BUDGET.full);
  });

  it('all payload (same 17 tools, different order) stays within TOOLS_LIST_BYTE_BUDGET.full', () => {
    const size = payloadFor(PRESETS.all).length;
    expect(size, `all tools/list payload is ${size} bytes, budget is ${TOOLS_LIST_BYTE_BUDGET.full}`)
      .toBeLessThanOrEqual(TOOLS_LIST_BYTE_BUDGET.full);
  });

  // standard is deliberately unbudgeted — measured and reported, not asserted.
  it('standard payload is measured and reported (no assertion — deliberately unbudgeted)', () => {
    const size = payloadFor(PRESETS.standard).length;
    // eslint-disable-next-line no-console
    console.log(`standard tools/list payload: ${size} bytes (unbudgeted)`);
    expect(size).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------
// Contract 2: guidance lock
// -----------------------------------------------------------------------

const FULL_PAYLOAD = payloadFor(PRESETS.full);

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('tools/list guidance lock (full payload)', () => {
  const atLeastOnePhrases: string[] = [
    'ACTUAL or REAL observation',                          // METAR trigger phrase
    'real instrument readings outside the US',              // METAR coverage claim
    'GFS, ECMWF, ICON, GEM, UKMO',                           // compare_models — five models
    'ECMWF ENS',                                             // ensemble_spread — one model's own members
    'SINGLE call',                                           // get_weather_summary routing cue
    'call that specialized tool directly',                   // its counterpart
    'coastal navigation',                                    // marine caveat
    'no official flood-stage thresholds exist for model data', // river model-vs-gauge
    'industrial heat sources or agricultural burns',         // FIRMS false positives
    'no fire names or containment exist in satellite data',  // FIRMS vs NIFC
    'GOOGLE_WEATHER_API_KEY',                                 // alerts key story
    'keyless',                                                // its counterpart
    'knots',                                                  // G65 — below design's decision boundary
    '-90 to 90',                                              // G65 — below design's decision boundary
  ];

  it.each(atLeastOnePhrases)('contains %j at least once', (phrase) => {
    const count = countOccurrences(FULL_PAYLOAD, phrase);
    expect(count, `expected >=1 occurrence of ${JSON.stringify(phrase)}, found ${count}`).toBeGreaterThanOrEqual(1);
  });

  const exactCountPhrases: Array<[string, number]> = [
    ['1-7 for US NOAA', 2],                    // horizon disclosure: get_forecast + get_weather_summary
    ['SAFETY-CRITICAL', 3],                    // lightning, river, wildfire
    ['use get_historical_weather', 2],         // sibling cross-reference
    ['use get_current_conditions', 2],         // sibling cross-reference
  ];

  it.each(exactCountPhrases)('contains %j exactly %i time(s)', (phrase, expected) => {
    const count = countOccurrences(FULL_PAYLOAD, phrase);
    expect(count, `expected exactly ${expected} occurrence(s) of ${JSON.stringify(phrase)}, found ${count}`).toBe(expected);
  });
});

// -----------------------------------------------------------------------
// Contract 3: shape fingerprint (F6 — tool registration and schemas are the
// server's public API)
// -----------------------------------------------------------------------

type FingerprintEntry = {
  params: string[];
  required: string[];
  enums: Record<string, string[]>;
};

/**
 * Generated from `main` (80d901a), NOT from this branch. G10 applies: a
 * fingerprint generated from the branch under test would only assert that
 * the branch equals itself — precisely the accidental-parameter-removal
 * class of bug this test exists to catch. The orchestrator built a
 * `git worktree` at main, compiled it, spawned it, and dumped this
 * fingerprint, which was byte-identical (md5 e89936404a98c25d766f860deec07f7c)
 * to the same dump taken from this branch — the proof that T1-T4 changed no
 * parameter, enum, default, or `required` entry.
 *
 * The literal is inlined here on purpose. An earlier draft read it from
 * .claude/scratch/, which is gitignored: the suite passed locally off an
 * untracked artifact and died with ENOENT on any fresh clone. A lock that
 * depends on a file the repo does not carry is not a lock.
 */
const EXPECTED_FINGERPRINT_FROM_MAIN: Record<string, FingerprintEntry> = {
  check_service_status: {
    params: [],
    required: [],
    enums: {},
  },
  get_air_quality: {
    params: ['city_name', 'forecast', 'forecast_days', 'latitude', 'location_name', 'longitude'],
    required: [],
    enums: {},
  },
  get_alerts: {
    params: ['active_only', 'city_name', 'detail', 'latitude', 'location_name', 'longitude'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
    },
  },
  get_current_conditions: {
    params: ['city_name', 'distance_unit', 'include_fire_weather', 'include_normals', 'latitude', 'location_name', 'longitude', 'precipitation_unit', 'pressure_unit', 'source', 'temperature_unit', 'time_format', 'units', 'wind_speed_unit'],
    required: [],
    enums: {
      distance_unit: ['km', 'mi'],
      precipitation_unit: ['inch', 'mm'],
      pressure_unit: ['hPa', 'inHg'],
      source: ['auto', 'metar', 'noaa', 'openmeteo'],
      temperature_unit: ['C', 'F'],
      time_format: ['12h', '24h'],
      units: ['imperial', 'metric'],
      wind_speed_unit: ['kmh', 'kn', 'mph', 'ms'],
    },
  },
  get_forecast: {
    params: ['city_name', 'compare_models', 'days', 'detail', 'distance_unit', 'ensemble_spread', 'granularity', 'include_astronomy', 'include_normals', 'include_precipitation_probability', 'include_severe_weather', 'latitude', 'location_name', 'longitude', 'precipitation_unit', 'pressure_unit', 'source', 'temperature_unit', 'time_format', 'units', 'wind_speed_unit'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
      distance_unit: ['km', 'mi'],
      granularity: ['daily', 'hourly'],
      precipitation_unit: ['inch', 'mm'],
      pressure_unit: ['hPa', 'inHg'],
      source: ['auto', 'noaa', 'openmeteo'],
      temperature_unit: ['C', 'F'],
      time_format: ['12h', '24h'],
      units: ['imperial', 'metric'],
      wind_speed_unit: ['kmh', 'kn', 'mph', 'ms'],
    },
  },
  get_historical_weather: {
    params: ['city_name', 'distance_unit', 'end_date', 'latitude', 'limit', 'location_name', 'longitude', 'precipitation_unit', 'pressure_unit', 'start_date', 'temperature_unit', 'time_format', 'units', 'wind_speed_unit'],
    required: ['end_date', 'start_date'],
    enums: {
      distance_unit: ['km', 'mi'],
      precipitation_unit: ['inch', 'mm'],
      pressure_unit: ['hPa', 'inHg'],
      temperature_unit: ['C', 'F'],
      time_format: ['12h', '24h'],
      units: ['imperial', 'metric'],
      wind_speed_unit: ['kmh', 'kn', 'mph', 'ms'],
    },
  },
  get_lightning_activity: {
    params: ['city_name', 'detail', 'latitude', 'location_name', 'longitude', 'radius', 'timeWindow'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
    },
  },
  get_marine_conditions: {
    params: ['city_name', 'forecast', 'forecast_days', 'latitude', 'location_name', 'longitude'],
    required: [],
    enums: {},
  },
  get_river_conditions: {
    params: ['city_name', 'detail', 'forecast_days', 'latitude', 'location_name', 'longitude', 'radius', 'source'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
      source: ['auto', 'ea', 'noaa', 'openmeteo'],
    },
  },
  get_saved_location: {
    params: ['alias'],
    required: ['alias'],
    enums: {},
  },
  get_weather_imagery: {
    params: ['animated', 'city_name', 'composite', 'detail', 'latitude', 'location_name', 'longitude', 'type'],
    required: ['type'],
    enums: {
      detail: ['full', 'standard', 'summary'],
      type: ['precipitation', 'radar', 'satellite'],
    },
  },
  get_weather_summary: {
    params: ['city_name', 'days', 'detail', 'distance_unit', 'include', 'latitude', 'location_name', 'longitude', 'precipitation_unit', 'pressure_unit', 'temperature_unit', 'time_format', 'units', 'wind_speed_unit'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
      distance_unit: ['km', 'mi'],
      'include.items': ['air_quality', 'alerts', 'current', 'forecast', 'lightning'],
      precipitation_unit: ['inch', 'mm'],
      pressure_unit: ['hPa', 'inHg'],
      temperature_unit: ['C', 'F'],
      time_format: ['12h', '24h'],
      units: ['imperial', 'metric'],
      wind_speed_unit: ['kmh', 'kn', 'mph', 'ms'],
    },
  },
  get_wildfire_info: {
    params: ['city_name', 'day_range', 'detail', 'latitude', 'location_name', 'longitude', 'radius', 'source'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
      source: ['auto', 'firms', 'nifc'],
    },
  },
  list_saved_locations: {
    params: [],
    required: [],
    enums: {},
  },
  remove_saved_location: {
    params: ['alias'],
    required: ['alias'],
    enums: {},
  },
  save_location: {
    params: ['activities', 'alias', 'alternateNames', 'description', 'latitude', 'location_query', 'longitude', 'name', 'notes'],
    required: ['alias'],
    enums: {},
  },
  search_location: {
    params: ['limit', 'query'],
    required: ['query'],
    enums: {},
  },
};

function deriveFingerprint(def: ToolDefinitionShape): FingerprintEntry {
  const properties = def.inputSchema.properties ?? {};
  const params = Object.keys(properties).sort();
  const required = (def.inputSchema.required ?? []).slice().sort();
  const enums: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (value.enum) {
      enums[key] = value.enum.slice().sort() as string[];
    } else if (value.items?.enum) {
      enums[`${key}.items`] = value.items.enum.slice().sort() as string[];
    }
    // properties with neither contribute nothing
  }

  return { params, required, enums };
}

describe('tools/list shape fingerprint (vs main 80d901a)', () => {
  const expectedNames = Object.keys(EXPECTED_FINGERPRINT_FROM_MAIN).sort();

  it('the fingerprint file covers exactly the 17 registered tool names', () => {
    const actualNames = Object.keys(DEFS).sort();
    expect(actualNames).toEqual(expectedNames);
  });

  it.each(expectedNames)('%s input schema shape matches main', (name) => {
    const actual = deriveFingerprint(DEFS[name]);
    const expected = EXPECTED_FINGERPRINT_FROM_MAIN[name];
    expect(actual).toEqual(expected);
  });
});
