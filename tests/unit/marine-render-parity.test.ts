/**
 * Unit tests for the T1-T4 marine-render-parity contracts: both
 * `get_marine_conditions` render paths (NOAA gridpoint and Open-Meteo) now
 * share one sea-state block (`formatSeaStateBlock`), one legend
 * (`formatSeaStateLegend`), and one no-marine-cell hint
 * (`formatNoMarineCellNote`) — this file pins that they actually agree, not
 * just that each path renders *something*.
 *
 * Fixture-driven, no I/O — this project's determinism rule is that a unit
 * test reaching the network is a defect regardless of whether it passes.
 * Drives everything through the real `handleGetMarineConditions`, never
 * through the private formatters (`formatNOAAMarineConditions` /
 * `formatOpenMeteoMarineConditions`) — they are module-private and nothing
 * imports them. Mock setup, the `callHandler` shape and the NOAA gridpoint
 * fixture shape follow tests/unit/marine-sea-state-taxonomy.test.ts and
 * tests/unit/marine-forecast.test.ts (both locks, not imported from — their
 * own header comments say their helpers are module-local, not exported).
 *
 * `getSafetyAssessment` and `formatNoMarineCellNote` are exported pure
 * utilities (unlike the two formatters above), so contracts 6 and 7 call
 * them directly where that is the more precise way to pin their contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGetMarineConditions } from '../../src/handlers/marineConditionsHandler.js';
import { clearCityGeocodeCache } from '../../src/utils/locationResolver.js';
import { NO_DATA_MARKER, getSafetyAssessment } from '../../src/utils/marine.js';
import type { OpenMeteoMarineResponse } from '../../src/types/openmeteo.js';
import type { GridpointResponse } from '../../src/types/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService, GeocodingResult } from '../../src/services/geocoding.js';
import type { SavedLocation } from '../../src/types/savedLocations.js';

// ---------------------------------------------------------------------------
// Shared mocks / fixtures
// ---------------------------------------------------------------------------

const getMarineMock = vi.fn();
const getStationsMock = vi.fn();
const getGridpointDataMock = vi.fn();

const noaaService = {
  getStations: getStationsMock,
  getGridpointDataByCoordinates: getGridpointDataMock
} as never;
const openMeteoService = { getMarine: getMarineMock } as never;

const emptyLocationStore: LocationStore = {} as never;
const emptyGeocodingService: GeocodingService = {} as never;

function callHandler(
  args: Record<string, unknown>,
  locationStore: LocationStore = emptyLocationStore,
  geocodingService: GeocodingService = emptyGeocodingService
) {
  return handleGetMarineConditions(args, noaaService, openMeteoService, locationStore, geocodingService);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Handler falls back to a guessed timezone when getStations rejects.
  getStationsMock.mockRejectedValue(new Error('no station coverage'));
});

// Mid-Atlantic open ocean — outside every Great Lakes/coastal-bay bounding
// box, so shouldUseNOAAMarine routes straight to Open-Meteo.
const OCEAN_COORDS = { latitude: 30.0, longitude: -60.0 };

// Lake Michigan (bbox: minLat 41.6, maxLat 46.0, minLon -87.8, maxLon -84.8)
// — routes to the NOAA path.
const LAKE_MICHIGAN_COORDS = { latitude: 43.0, longitude: -86.0 };

/**
 * Build a NOAA gridpoint fixture. Each of waveHeight/wavePeriod/waveDirection
 * is included in `properties` only when the caller explicitly names it in
 * `opts` — no defaulted parameter stands in for "upstream published nothing"
 * (G95): a field left out of `opts` is genuinely absent from the fixture,
 * exactly as an omitted key is absent from a real NOAA gridpoint response.
 */
function buildNOAAGridpointResponse(opts: {
  waveHeight?: number;
  wavePeriod?: number;
  waveDirection?: number;
}): GridpointResponse {
  const properties: Record<string, unknown> = {
    '@id': 'https://api.weather.gov/gridpoints/test/1,1',
    '@type': 'wx:Gridpoint',
    updateTime: '2026-07-16T10:00:00Z',
    validTimes: '2026-07-16T06:00:00Z/P7D',
    elevation: { unitCode: 'wmoUnit:m', value: 10 },
    forecastOffice: 'https://api.weather.gov/offices/test',
    gridId: 'test',
    gridX: 1,
    gridY: 1
  };

  if (opts.waveHeight !== undefined) {
    properties.waveHeight = { values: [{ validTime: '2026-07-16T11:00:00Z', value: opts.waveHeight }] };
  }
  if (opts.wavePeriod !== undefined) {
    properties.wavePeriod = { values: [{ validTime: '2026-07-16T11:00:00Z', value: opts.wavePeriod }] };
  }
  if (opts.waveDirection !== undefined) {
    properties.waveDirection = { values: [{ validTime: '2026-07-16T11:00:00Z', value: opts.waveDirection }] };
  }

  return { properties } as unknown as GridpointResponse;
}

/**
 * Build an Open-Meteo current-block fixture. `waveHeight` and `wavePeriod`
 * are required, explicit arguments — no default parameter (G95) — so a test
 * that means "upstream published null here" always says `null` in the call,
 * never relies on a substituted value.
 */
function buildOpenMeteoCurrent(waveHeight: number | null, wavePeriod: number | null): OpenMeteoMarineResponse {
  return {
    latitude: OCEAN_COORDS.latitude,
    longitude: OCEAN_COORDS.longitude,
    generationtime_ms: 0.5,
    utc_offset_seconds: 0,
    timezone: 'Atlantic/Bermuda',
    timezone_abbreviation: 'AST',
    elevation: 0,
    current: {
      time: '2026-07-16T11:00',
      interval: 3600,
      wave_height: waveHeight,
      wave_direction: 200,
      wave_period: wavePeriod
    }
  } as OpenMeteoMarineResponse;
}

/** Minimal LocationStore stub with the two methods resolveLocationAsync uses. */
function makeLocationStore(locations: Record<string, SavedLocation> = {}): LocationStore {
  return {
    get: (alias: string) => locations[alias.toLowerCase().trim()],
    getAll: () => locations
  } as unknown as LocationStore;
}

/** GeocodingService stub whose geocode() always returns the supplied results. */
function makeGeocodingService(results: GeocodingResult[]): GeocodingService {
  return { geocode: vi.fn(async () => results) } as unknown as GeocodingService;
}

function makeGeocodingResult(overrides: Partial<GeocodingResult> = {}): GeocodingResult {
  return {
    name: 'Parity Test Place',
    display_name: 'Parity Test Place, Testland',
    latitude: 0,
    longitude: 0,
    confidence: 'high',
    source: 'openmeteo',
    ...overrides
  };
}

function makeSavedLocation(overrides: Partial<SavedLocation> = {}): SavedLocation {
  return {
    name: 'Parity Test Saved Spot',
    latitude: 0,
    longitude: 0,
    saved_at: '2025-01-15T10:30:00.000Z',
    updated_at: '2025-01-15T10:30:00.000Z',
    ...overrides
  } as SavedLocation;
}

interface SeaStateBlockFields {
  marker: string;
  level: string;
  seaState: string;
  safety: string;
}

/** Extracts formatSeaStateBlock's rendered fields from a full report. */
function extractSeaStateBlock(text: string): SeaStateBlockFields {
  const match = /^## (\S+) Current Conditions: (.+)\n\n\*\*Sea state:\*\* (.+)\n\*\*Safety:\*\* (.+)$/m.exec(text);
  if (match === null) {
    throw new Error(`no sea-state block found in report:\n${text}`);
  }
  const [, marker, level, seaState, safety] = match;
  return { marker, level, seaState, safety };
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The exact literal formatNoMarineCellNote renders with `fromPlaceName: false`. */
const SHORT_NO_CELL_NOTE =
  '*No marine-model cell here — the marine model covers ocean and large-lake water cells only. ' +
  'For coastal conditions, try a point just offshore.*';

/**
 * The exact literal formatNoMarineCellNote renders with `fromPlaceName: true`. It names neither
 * the place nor the coordinates — both already render in the `**Location:**` header above the
 * report (test-drive Observation 1), and contract 4 pins that they are still there.
 */
const LONG_NO_CELL_NOTE =
  '*No marine-model cell here — a place name resolves to a land centroid, and the marine model ' +
  'covers ocean and large-lake water cells only. For coastal conditions, pass ' +
  '`latitude`/`longitude` for a point just offshore.*';

/** Extracts the rendered no-marine-cell note (either variant) from a report. */
function extractNoCellNote(text: string): string | undefined {
  const match = /\*No marine-model cell[^\n]*\*/.exec(text);
  return match ? match[0] : undefined;
}

// ---------------------------------------------------------------------------
// Contract 1 — cross-path parity.
// ---------------------------------------------------------------------------

describe('Cross-path parity: NOAA and Open-Meteo render the identical sea-state block (contract 1)', () => {
  it('same wave height and period produce the same marker, level, sea-state sentence and safety line on both paths', async () => {
    getGridpointDataMock.mockResolvedValue(buildNOAAGridpointResponse({ waveHeight: 1.5, wavePeriod: 8.0 }));
    const noaaResult = await callHandler(LAKE_MICHIGAN_COORDS);
    const noaaBlock = extractSeaStateBlock(noaaResult.content[0].text);

    getMarineMock.mockResolvedValue(buildOpenMeteoCurrent(1.5, 8.0));
    const openMeteoResult = await callHandler(OCEAN_COORDS);
    const openMeteoBlock = extractSeaStateBlock(openMeteoResult.content[0].text);

    expect(noaaBlock).toEqual(openMeteoBlock);
  });
});

// ---------------------------------------------------------------------------
// Contract 2 — the legend appears exactly once, on both paths.
// ---------------------------------------------------------------------------

describe('The legend appears exactly once in every report, on both paths (contract 2)', () => {
  // A legend-unique substring — not a rung word (G62): the legend now
  // renders every rung name on both paths, so `not.toContain('Calm')` and
  // friends are false in every report regardless of correctness.
  const LEGEND_UNIQUE_TEXT = 'Markers describe the sea state at the point';

  it('appears exactly once in the NOAA report', async () => {
    getGridpointDataMock.mockResolvedValue(buildNOAAGridpointResponse({ waveHeight: 1.5, wavePeriod: 8.0 }));
    const result = await callHandler(LAKE_MICHIGAN_COORDS);
    const text = result.content[0].text;

    expect(countOccurrences(text, LEGEND_UNIQUE_TEXT)).toBe(1);
  });

  it('appears exactly once in the Open-Meteo report', async () => {
    getMarineMock.mockResolvedValue(buildOpenMeteoCurrent(1.5, 8.0));
    const result = await callHandler(OCEAN_COORDS);
    const text = result.content[0].text;

    expect(countOccurrences(text, LEGEND_UNIQUE_TEXT)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Contract 3 — NOAA zero/no-data banding (design decision D2).
// ---------------------------------------------------------------------------

describe('NOAA zero/no-data banding (contract 3, design decision D2)', () => {
  it('a gridpoint with wavePeriod but no waveHeight renders an Unknown header, a full sea-state block, and no wave-height line', async () => {
    getGridpointDataMock.mockResolvedValue(buildNOAAGridpointResponse({ wavePeriod: 8.0 }));
    const result = await callHandler(LAKE_MICHIGAN_COORDS);
    const text = result.content[0].text;

    // Parsed through the block, not just a header substring: a malformed or
    // truncated block (e.g. a missing **Safety:** line) throws here rather
    // than passing silently.
    const block = extractSeaStateBlock(text);
    expect(block.marker).toBe(NO_DATA_MARKER);
    expect(block.level).toBe('Unknown');
    expect(block.safety.length).toBeGreaterThan(0);

    expect(text).not.toContain('**Significant Wave Height:**');
  });

  it('a gridpoint with waveHeight: 0 renders Calm with the calm marker, a full sea-state block, and no "Calm or minimal wave activity" fallback line', async () => {
    getGridpointDataMock.mockResolvedValue(buildNOAAGridpointResponse({ waveHeight: 0, wavePeriod: 8.0 }));
    const result = await callHandler(LAKE_MICHIGAN_COORDS);
    const text = result.content[0].text;

    const block = extractSeaStateBlock(text);
    expect(block.marker).toBe('🟢');
    expect(block.level).toBe('Calm');
    expect(block.safety.length).toBeGreaterThan(0);

    expect(text).not.toContain('Calm or minimal wave activity');
  });
});

// ---------------------------------------------------------------------------
// Contract 4 — the no-marine-cell hint (design decision D4).
// ---------------------------------------------------------------------------

describe('The no-marine-cell hint (contract 4, design decision D4)', () => {
  it('wave_height: null with a geocoded resolution renders the long variant, which restates neither the place nor the coordinates', async () => {
    clearCityGeocodeCache();
    const geocoding = makeGeocodingService([
      makeGeocodingResult({
        display_name: 'Parity Test Geocoded Spot, Testland',
        latitude: 35.1234,
        longitude: -100.6543
      })
    ]);
    getMarineMock.mockResolvedValue(buildOpenMeteoCurrent(null, 9.0));

    const result = await callHandler({ city_name: 'Parity Test Geocoded City Alpha' }, emptyLocationStore, geocoding);
    const text = result.content[0].text;

    expect(text).toContain(LONG_NO_CELL_NOTE);

    // The note explains the mechanism; the data it used to restate lives in the
    // `**Location:**` header `prependLocationLine` puts above the report. Pin both halves
    // together — the note is only allowed to stay silent about the place because the header
    // is guaranteed to name it (test-drive Observation 1).
    expect(text).toContain('**Location:** Parity Test Geocoded Spot, Testland (35.1234, -100.6543)');

    const note = extractNoCellNote(text);
    expect(note).toBeDefined();
    expect(note).not.toContain('Parity Test Geocoded Spot, Testland');
    expect(note).not.toContain('35.1234');
    expect(note).not.toContain('-100.6543');
  });

  it('wave_height: null with a coordinates resolution renders the short variant, mentioning no resolution', async () => {
    getMarineMock.mockResolvedValue(buildOpenMeteoCurrent(null, 9.0));

    const result = await callHandler(OCEAN_COORDS);
    const text = result.content[0].text;

    expect(text).toContain(SHORT_NO_CELL_NOTE);
    expect(text).not.toContain('land centroid');
  });

  it('a finite wave_height never renders the hint at all', async () => {
    getMarineMock.mockResolvedValue(buildOpenMeteoCurrent(1.2, 9.0));

    const result = await callHandler(OCEAN_COORDS);
    const text = result.content[0].text;

    expect(text).not.toContain('No marine-model cell');
  });
});

// ---------------------------------------------------------------------------
// Contract 5 — source: 'default' renders the short variant in every shape.
// ---------------------------------------------------------------------------

describe("source: 'default' renders the short variant in every shape it comes in (contract 5)", () => {
  const ENV_KEY = 'WEATHER_DEFAULT_LOCATION';
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    getMarineMock.mockResolvedValue(buildOpenMeteoCurrent(null, 9.0));
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedEnv;
    }
  });

  // 5a — the blocker contract: a default resolved through a *saved alias*.
  // resolveDefaultLocation spreads `source: 'default'` over the saved
  // resolution (locationResolver.ts:428), so `resolved.location_name` is set
  // (the alias) even though this was never a geocoded place. A guard that
  // admitted 'default' would print fabricated provenance ("<alias> resolved
  // to ... a place name resolves to a land centroid") for a hand-saved
  // coordinate. Built through a real saved-alias default (WEATHER_DEFAULT_LOCATION
  // + a mocked LocationStore), not by hand-setting `source` — the point is
  // that the spread overwrites the subtype.
  it('5a: default from a saved alias — short variant, no saved name or land-centroid phrase in the hint', async () => {
    process.env[ENV_KEY] = 'parity-alias';
    const store = makeLocationStore({
      'parity-alias': makeSavedLocation({
        name: 'Parity Alias Display Name',
        latitude: OCEAN_COORDS.latitude,
        longitude: OCEAN_COORDS.longitude
      })
    });

    const result = await callHandler({}, store, emptyGeocodingService);
    const text = result.content[0].text;

    expect(text).toContain(SHORT_NO_CELL_NOTE);
    expect(text).not.toContain('resolves to a land centroid');
    expect(text).not.toContain('Parity Alias Display Name');
    // Tightest form of the blocker contract: the note is the short literal and nothing else,
    // so no provenance of any shape can leak into it.
    expect(extractNoCellNote(text)).toBe(SHORT_NO_CELL_NOTE);
  });

  // 5b — a bare "lat,lon" default: resolved.location_name is genuinely
  // absent (locationResolver.ts:422 returns no location_name field at all).
  // A separate combination from 5a (G59) — a variant of 5a's fixture would
  // never reach this code path.
  it('5b: default as a bare lat,lon pair — short variant, no literal "undefined" anywhere in the report', async () => {
    process.env[ENV_KEY] = `${OCEAN_COORDS.latitude}, ${OCEAN_COORDS.longitude}`;

    const result = await callHandler({}, emptyLocationStore, emptyGeocodingService);
    const text = result.content[0].text;

    expect(text).toContain(SHORT_NO_CELL_NOTE);
    expect(text).not.toMatch(/\bundefined\b/);
  });

  // 5c — a default resolved through geocoding. Pins the accepted cost of
  // narrowing the guard to 'geocoded' only: D4 intended this case to get the
  // long variant, and it deliberately no longer does. A third, distinct
  // fixture (G59) — sharing 5a's or 4's fixture would not exercise this
  // resolution path (locationResolver.ts:436).
  it('5c: default from a geocoded place — short variant (the accepted D4 narrowing cost)', async () => {
    clearCityGeocodeCache();
    process.env[ENV_KEY] = 'Parity Default Geocoded Place Beta';
    const geocoding = makeGeocodingService([
      makeGeocodingResult({
        display_name: 'Parity Default Geocoded Place Beta, Testland',
        latitude: OCEAN_COORDS.latitude,
        longitude: OCEAN_COORDS.longitude
      })
    ]);

    const result = await callHandler({}, emptyLocationStore, geocoding);
    const text = result.content[0].text;

    expect(text).toContain(SHORT_NO_CELL_NOTE);
    expect(text).not.toContain('resolves to a land centroid');
    expect(extractNoCellNote(text)).toBe(SHORT_NO_CELL_NOTE);
  });
});

// ---------------------------------------------------------------------------
// Contract 6 — the hint never contains the no-data marker.
// ---------------------------------------------------------------------------

describe('The hint never contains NO_DATA_MARKER (contract 6)', () => {
  it('the short-variant hint omits the no-data marker', async () => {
    getMarineMock.mockResolvedValue(buildOpenMeteoCurrent(null, 9.0));

    const result = await callHandler(OCEAN_COORDS);
    const note = extractNoCellNote(result.content[0].text);

    expect(note).toBeDefined();
    expect(note).not.toContain(NO_DATA_MARKER);
  });

  it('the long-variant hint omits the no-data marker', async () => {
    clearCityGeocodeCache();
    const geocoding = makeGeocodingService([
      makeGeocodingResult({
        display_name: 'Parity Marker Check Spot',
        latitude: 35.1234,
        longitude: -100.6543
      })
    ]);
    getMarineMock.mockResolvedValue(buildOpenMeteoCurrent(null, 9.0));

    const result = await callHandler(
      { city_name: 'Parity Marker Check City Gamma' },
      emptyLocationStore,
      geocoding
    );
    const note = extractNoCellNote(result.content[0].text);

    expect(note).toBeDefined();
    expect(note).not.toContain(NO_DATA_MARKER);
  });
});

// ---------------------------------------------------------------------------
// Contract 7 — punctuation between the rung name and the context (D3).
// ---------------------------------------------------------------------------

describe('Punctuation between the rung name and the context, for every context branch (contract 7, design decision D3)', () => {
  // Construct, not a hand-copied full string: capital-initial, no interior
  // period, then a single sentence-terminating period at the very end.
  // Applied to the rung-name *portion only* (the known context sentence
  // stripped off the end) — asserting this construct against the whole
  // description is not enough on its own: the context sentence supplies its
  // own trailing period, so `/^[A-Z][^.]*\.(\s|$)/` matches the whole string
  // even when the '.' *separating* the rung name from the context is
  // missing (e.g. "Moderate Conditions dominated..." still ends in a
  // period). Stripping the context first isolates exactly the punctuation
  // D3 is about.
  const PUNCTUATION_CONSTRUCT = /^[A-Z][^.]*\.$/;

  // Each context sentence carries its own leading space, exactly as
  // getSafetyAssessment concatenates it — so slicing it off the end of the
  // full description leaves the rung-name portion with no extra whitespace.
  const CONTEXT_BRANCHES: Array<[label: string, windWaveHeight: number, swellHeight: number, contextSentence: string]> = [
    ['wind-dominated', 3.0, 1.0, ' Conditions dominated by local wind waves.'],
    ['swell-dominated', 1.0, 3.0, ' Conditions dominated by swell from distant systems.'],
    ['mixed', 2.0, 2.0, ' Mixed wind and swell conditions.']
  ];

  it.each(CONTEXT_BRANCHES)(
    '%s branch: rung name and context are separated by sentence punctuation',
    (_label, windWaveHeight, swellHeight, contextSentence) => {
      const safety = getSafetyAssessment(1.5, windWaveHeight, swellHeight, undefined);

      // The context sentence is still present, verbatim, at the end.
      expect(safety.description.endsWith(contextSentence)).toBe(true);

      // What's left after stripping it off must be the rung name plus its
      // own separating period — nothing more, nothing less.
      const rungNamePortion = safety.description.slice(0, safety.description.length - contextSentence.length);
      expect(rungNamePortion).toMatch(PUNCTUATION_CONSTRUCT);
    }
  );

  it('none branch (wind/swell split absent): the rung name alone still ends in sentence punctuation', () => {
    const safety = getSafetyAssessment(1.5, undefined, undefined, undefined);

    // No context to strip — the whole description is the rung-name portion.
    expect(safety.description).toMatch(PUNCTUATION_CONSTRUCT);
  });
});
