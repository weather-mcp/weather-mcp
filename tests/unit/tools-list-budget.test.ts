/**
 * Locks the `tools/list` payload against silent regrowth and against silent
 * loss of hand-tuned guidance text.
 *
 * The MCP `tools/list` result goes into model context on every turn of every
 * client session, so its byte size is a standing context cost. T1-T4 cut it
 * from 40,254 to 30,836 bytes (`full`) and 17,458 to 12,987 (`basic`) by
 * removing schema restatement and output enumeration from tool and parameter
 * descriptions. Before this file, nothing in the repo measured that payload
 * and nothing asserted on any tool or parameter description text, so nothing
 * would notice either regression.
 *
 * This file carries three contracts:
 *   1. Budget    — the stringified `tools/list` payload for `basic` and `full`
 *                  stays under TOOLS_LIST_BYTE_BUDGET (src/config/tools.ts),
 *                  measured in UTF-8 BYTES. See payloadBytes below for why
 *                  String.length is the wrong ruler here.
 *   2. Guidance  — a fixed set of hand-tuned phrases survive at a fixed count
 *                  in the `full` payload (tool AND parameter descriptions).
 *   3. Shape     — the params/required/enums/defaults shape of all 17 tools'
 *                  input schemas matches a fingerprint generated from `main`
 *                  (b699bce), with the entries tool-schema-truth moved on
 *                  purpose applied (listed above the literal). Any other
 *                  parameter, enum, default, or `required` change fails it.
 *
 * --- G61 no longer applies to this import ---
 *
 * G61 (importing `src/index.ts` runs `main()` unconditionally at module
 * scope) still describes the stdio entry point, but nothing in this file
 * imports it. `src/server/weatherServer.ts` constructs no transport, calls
 * no `server.connect()`, and registers no signal handler — importing it is
 * inert but for the analytics singleton (see the pins below).
 *
 * --- Why this file needs a THIRD vi.hoisted pin beyond the usual two ---
 *
 * ANALYTICS_ENABLED / ANALYTICS_SALT are the standard two (see
 * tests/unit/tool-name-parity.test.ts for why each is needed). This file
 * adds a third: WEATHER_DEFAULT_LOCATION = ''. The reason is a two-link
 * chain:
 *
 *   1. DEFAULT_LOCATION_HINT (src/server/weatherServer.ts:285-287) is folded
 *      into `latitude`'s description at MODULE LOAD, so it is baked into
 *      eleven tools' schemas before any test in this file runs.
 *   2. getDefaultLocation() (src/config/defaultLocation.ts:22-27) trims and
 *      treats a blank string as unset, so '' is a clean "no default" and not
 *      a default literally named "".
 *
 * `dotenv/config` is no longer in this import chain — that import lives only
 * in the entry, src/index.ts (which this file does not import) — so the
 * repo's own gitignored .env cannot reach WEATHER_DEFAULT_LOCATION here. A
 * shell that **exports** the variable still can, though, which is why the
 * pin stays, and stays hoisted (set before the static import evaluates)
 * rather than set in a beforeEach.
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

// All three must be set before the static import below evaluates: ANALYTICS_ENABLED
// and ANALYTICS_SALT are the standard pins (see tests/unit/tool-name-parity.test.ts
// for why each is needed); WEATHER_DEFAULT_LOCATION is this file's own third pin —
// see header comment.
vi.hoisted(() => {
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'tools-list-budget-test';
  process.env.WEATHER_DEFAULT_LOCATION = ''; // the third pin — see header comment
});

// Import src/server/weatherServer.js once, statically. The import is inert but for
// the analytics singleton; never re-import it under vi.resetModules() — that
// re-constructs sixteen services and their Cache timers (G21 point 3).
import { TOOL_DEFINITIONS } from '../../src/server/weatherServer.js';
import { PRESETS, TOOLS_LIST_BYTE_BUDGET } from '../../src/config/tools.js';

type JsonSchemaProperty = {
  enum?: unknown[];
  default?: unknown;
  items?: { enum?: unknown[]; default?: unknown };
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

/**
 * The size of a payload in UTF-8 BYTES, which is what TOOLS_LIST_BYTE_BUDGET,
 * README.md and CHANGELOG.md all claim to state.
 *
 * `String.length` counts UTF-16 code units, not bytes, and the descriptions are
 * full of em-dashes (U+2014 — one code unit, three UTF-8 bytes). On today's text
 * the two rulers differ by only 8 bytes (`basic`) and 24 (`full`), but the error
 * grows with every non-ASCII character added and always in the unsafe direction:
 * `.length` under-reports, so a payload could cross the real ceiling while the
 * lock still read green.
 */
function payloadBytes(preset: readonly string[]): number {
  return Buffer.byteLength(payloadFor(preset), 'utf8');
}

describe('tools/list byte budget', () => {
  it(`basic payload stays within TOOLS_LIST_BYTE_BUDGET.basic (${TOOLS_LIST_BYTE_BUDGET.basic})`, () => {
    const size = payloadBytes(PRESETS.basic);
    expect(size, `basic tools/list payload is ${size} bytes, budget is ${TOOLS_LIST_BYTE_BUDGET.basic}`)
      .toBeLessThanOrEqual(TOOLS_LIST_BYTE_BUDGET.basic);
  });

  it(`full payload stays within TOOLS_LIST_BYTE_BUDGET.full (${TOOLS_LIST_BYTE_BUDGET.full})`, () => {
    const size = payloadBytes(PRESETS.full);
    expect(size, `full tools/list payload is ${size} bytes, budget is ${TOOLS_LIST_BYTE_BUDGET.full}`)
      .toBeLessThanOrEqual(TOOLS_LIST_BYTE_BUDGET.full);
  });

  it('all payload (same 17 tools, different order) stays within TOOLS_LIST_BYTE_BUDGET.full', () => {
    const size = payloadBytes(PRESETS.all);
    expect(size, `all tools/list payload is ${size} bytes, budget is ${TOOLS_LIST_BYTE_BUDGET.full}`)
      .toBeLessThanOrEqual(TOOLS_LIST_BYTE_BUDGET.full);
  });

  // standard is deliberately unbudgeted — measured and reported, not asserted.
  it('standard payload is measured and reported (no assertion — deliberately unbudgeted)', () => {
    const size = payloadBytes(PRESETS.standard);
    // eslint-disable-next-line no-console
    console.log(`standard tools/list payload: ${size} bytes (unbudgeted)`);
    expect(size).toBeGreaterThan(0);
  });

  // Positive control for the ruler itself. If the payload were pure ASCII the
  // two metrics would agree, payloadBytes would be indistinguishable from
  // String.length, and a later "simplification" back to .length would pass
  // every test above while silently under-reporting again. This asserts the
  // construct (G62): non-ASCII is present, and bytes exceed code units.
  it('the payload contains non-ASCII, so bytes and code units genuinely differ', () => {
    const payload = payloadFor(PRESETS.full);
    const nonAscii = payload.match(/[^\x00-\x7F]/g) ?? [];
    expect(nonAscii.length, 'expected non-ASCII characters (em-dashes, degree signs) in the payload')
      .toBeGreaterThan(0);
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThan(payload.length);
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
  defaults: Record<string, unknown>;
};

/**
 * Generated from `main` (b699bce), NOT from the branch under test alone. G10
 * applies: a fingerprint generated from the branch under test would only
 * assert that the branch equals itself — precisely the accidental-parameter-
 * removal class of bug this test exists to catch. A `git worktree` at main
 * and the tool-schema-truth branch were each dumped through this file's
 * projection and diffed. Exactly these entries moved, deliberately, under
 * that plan, and every other entry of all 17 tools diffed identical:
 *
 *   - get_weather_imagery.required: ['type'] -> [] (the handler has always
 *     defaulted `type`, so the required entry was dead);
 *   - get_weather_summary.params gains `source`;
 *   - get_weather_summary.enums gains source: ['auto', 'noaa', 'openmeteo'];
 *   - get_weather_summary.defaults gains source: 'auto'.
 *
 * (Dump md5s: main c6e6138a5a347a21c3a0f31e3500530b, branch
 * d7f13f4559bc36018315f752350a63f8.) The previous base was 80d901a, whose
 * dump was byte-identical to its branch.
 *
 * The four projected fields are exactly what `deriveFingerprint` below
 * derives. Nothing else is locked: descriptions are Contract 2's job, and
 * `type`/`minimum`/`maximum` are deliberately outside the fingerprint — say
 * so here rather than letting the next editor infer coverage from the word
 * "shape". That is also why search_location.limit's `number` -> `integer`
 * change in the same plan does not appear in the list above;
 * tests/unit/search-location-fractional-limit.test.ts locks it instead.
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
    defaults: {},
  },
  get_air_quality: {
    params: ['city_name', 'forecast', 'forecast_days', 'latitude', 'location_name', 'longitude'],
    required: [],
    enums: {},
    defaults: {
      forecast: false,
      forecast_days: 5,
    },
  },
  get_alerts: {
    params: ['active_only', 'city_name', 'detail', 'latitude', 'location_name', 'longitude'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
    },
    defaults: {
      active_only: true,
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
    defaults: {
      include_fire_weather: false,
      include_normals: false,
      source: 'auto',
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
    defaults: {
      compare_models: false,
      days: 7,
      ensemble_spread: false,
      granularity: 'daily',
      include_astronomy: false,
      include_normals: false,
      include_precipitation_probability: true,
      include_severe_weather: false,
      source: 'auto',
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
    defaults: {
      limit: 168,
    },
  },
  get_lightning_activity: {
    params: ['city_name', 'detail', 'latitude', 'location_name', 'longitude', 'radius', 'timeWindow'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
    },
    defaults: {
      radius: 100,
      timeWindow: 60,
    },
  },
  get_marine_conditions: {
    params: ['city_name', 'forecast', 'forecast_days', 'latitude', 'location_name', 'longitude'],
    required: [],
    enums: {},
    defaults: {
      forecast: false,
      forecast_days: 5,
    },
  },
  get_river_conditions: {
    params: ['city_name', 'detail', 'forecast_days', 'latitude', 'location_name', 'longitude', 'radius', 'source'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
      source: ['auto', 'ea', 'noaa', 'openmeteo'],
    },
    defaults: {
      forecast_days: 7,
      radius: 50,
      source: 'auto',
    },
  },
  get_saved_location: {
    params: ['alias'],
    required: ['alias'],
    enums: {},
    defaults: {},
  },
  get_weather_imagery: {
    params: ['animated', 'city_name', 'composite', 'detail', 'latitude', 'location_name', 'longitude', 'type'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
      type: ['precipitation', 'radar', 'satellite'],
    },
    defaults: {
      animated: false,
      composite: false,
      type: 'precipitation',
    },
  },
  get_weather_summary: {
    params: ['city_name', 'days', 'detail', 'distance_unit', 'include', 'latitude', 'location_name', 'longitude', 'precipitation_unit', 'pressure_unit', 'source', 'temperature_unit', 'time_format', 'units', 'wind_speed_unit'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
      distance_unit: ['km', 'mi'],
      'include.items': ['air_quality', 'alerts', 'current', 'forecast', 'lightning'],
      precipitation_unit: ['inch', 'mm'],
      pressure_unit: ['hPa', 'inHg'],
      source: ['auto', 'noaa', 'openmeteo'],
      temperature_unit: ['C', 'F'],
      time_format: ['12h', '24h'],
      units: ['imperial', 'metric'],
      wind_speed_unit: ['kmh', 'kn', 'mph', 'ms'],
    },
    defaults: {
      days: 7,
      source: 'auto',
    },
  },
  get_wildfire_info: {
    params: ['city_name', 'day_range', 'detail', 'latitude', 'location_name', 'longitude', 'radius', 'source'],
    required: [],
    enums: {
      detail: ['full', 'standard', 'summary'],
      source: ['auto', 'firms', 'nifc'],
    },
    defaults: {
      day_range: 1,
      radius: 100,
      source: 'auto',
    },
  },
  list_saved_locations: {
    params: [],
    required: [],
    enums: {},
    defaults: {},
  },
  remove_saved_location: {
    params: ['alias'],
    required: ['alias'],
    enums: {},
    defaults: {},
  },
  save_location: {
    params: ['activities', 'alias', 'alternateNames', 'description', 'latitude', 'location_query', 'longitude', 'name', 'notes'],
    required: ['alias'],
    enums: {},
    defaults: {},
  },
  search_location: {
    params: ['limit', 'query'],
    required: ['query'],
    enums: {},
    defaults: {
      limit: 5,
    },
  },
};

function deriveFingerprint(def: ToolDefinitionShape): FingerprintEntry {
  const properties = def.inputSchema.properties ?? {};
  const params = Object.keys(properties).sort();
  const required = (def.inputSchema.required ?? []).slice().sort();
  const enums: Record<string, string[]> = {};
  const defaults: Record<string, unknown> = {};

  // Iterate the SORTED keys, not Object.entries: `defaults` is compared with
  // toEqual, which ignores key order, but a sorted literal is the one a human
  // can diff against the generated dump when this lock goes red.
  for (const key of params) {
    const value = properties[key];
    if (value.enum) {
      enums[key] = value.enum.slice().sort() as string[];
    } else if (value.items?.enum) {
      enums[`${key}.items`] = value.items.enum.slice().sort() as string[];
    }
    // hasOwnProperty, not `!== undefined`: `default: undefined` is a declared
    // default whose value happens to be undefined, and dropping it silently
    // would be exactly the class of loss this fingerprint exists to catch.
    if (Object.prototype.hasOwnProperty.call(value, 'default')) {
      defaults[key] = value.default;
    }
    if (value.items && Object.prototype.hasOwnProperty.call(value.items, 'default')) {
      defaults[`${key}.items`] = value.items.default;
    }
    // properties with none of the three contribute nothing
  }

  return { params, required, enums, defaults };
}

describe('tools/list shape fingerprint (vs main b699bce)', () => {
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
