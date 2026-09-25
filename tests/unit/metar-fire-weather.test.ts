/**
 * Unit tests for the METAR `include_fire_weather` Fosberg section (T3,
 * metar-fosberg plan) — the locks that `metar-handler.test.ts` section 10
 * does not attempt: fixed-unit invariance, printed-input coherence, the
 * missing-input gap set (G59), and the US pointer gate.
 *
 * Exercises the real `handleGetCurrentConditions` / `formatMetarCurrentConditions`
 * path with plain fake services — no HTTP, no live network, no timers, no env
 * stubbing. Unit preferences are set per call (`units`, `wind_speed_unit`),
 * following base-tree fact 7.
 *
 * One `describe` per design Test (plan-metar-fosberg.md "## Tests" 1-5):
 *   1. Construct — the index-line shape, band-edge coherence, and disclosure.
 *   2. Preference invariance.
 *   3. Printed-input coherence.
 *   4. Missing inputs (G59: the two-absent-fields cell, and JSON `null`).
 *   5. US pointer gating.
 *
 * See `.devdocs/plan-metar-fosberg.md` and `.devdocs/plan-metar-fosberg-impl.md`
 * T3 for the mutation table this file is built to catch.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { calculateFosbergIndex, getFosbergCategory } from '../../src/utils/fireWeather.js';
import { celsiusToFahrenheit, knotsToMph } from '../../src/utils/units.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { AcisService } from '../../src/services/acis.js';
import type { AviationWeatherService } from '../../src/services/aviationWeather.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { BoundingBox, MetarObservation } from '../../src/types/aviationWeather.js';

// ---------------------------------------------------------------------------
// Fixtures — copied from tests/unit/metar-handler.test.ts's minimum pattern
// (base-tree fact 8).
// ---------------------------------------------------------------------------

/** Seattle, WA — a US point, well inside the NOAA routing box. */
const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };
/** London, UK — outside the US routing box. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

/** obsTime relative to "now" so fixtures never rot into staleness by clock drift. */
function obsTimeMinutesAgo(ageMinutes: number): number {
  return Math.round((Date.now() - ageMinutes * 60000) / 1000);
}

/**
 * A complete, "good" METAR observation near the requested point (~1 km
 * offset, comfortably inside the near band), fresh (20 minutes old).
 * Individual tests override just the fields under test.
 */
function buildMetarObservation(overrides: Partial<MetarObservation> = {}): MetarObservation {
  const nowIso = new Date().toISOString();
  return {
    icaoId: 'KSEA',
    name: 'Seattle-Tacoma Intl',
    lat: SEATTLE.latitude + 0.01,
    lon: SEATTLE.longitude + 0.01,
    elev: 130,
    obsTime: obsTimeMinutesAgo(20),
    reportTime: nowIso,
    receiptTime: nowIso,
    rawOb: 'METAR KSEA 131453Z 19006KT 10SM FEW250 20/10 A3000',
    metarType: 'METAR',
    qcField: 0,
    temp: 20,
    dewp: 10,
    wdir: 190,
    wspd: 6,
    wgst: 18,
    altim: 1015,
    slp: 1016,
    visib: 10,
    clouds: [{ cover: 'FEW', base: 25000 }],
    fltCat: 'VFR',
    wxString: 'BR',
    ...overrides,
  };
}

function buildAviationFake(...tierResponses: MetarObservation[][]) {
  const fn = vi.fn<[BoundingBox], Promise<MetarObservation[]>>();
  for (const response of tierResponses) {
    fn.mockResolvedValueOnce(response);
  }
  fn.mockResolvedValue([]);
  return { getMetarsInBoundingBox: fn };
}

function buildNoaaFake() {
  return {
    getCurrentConditions: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
    getStations: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
    getLatestObservation: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('NOAA not expected on the METAR path')),
  };
}

function buildOpenMeteoFake() {
  return {
    getCurrentConditions: vi.fn().mockRejectedValue(new Error('Open-Meteo not expected on the METAR path')),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    getClimateNormals: vi.fn().mockRejectedValue(new Error('normals not requested in these tests')),
  };
}

function buildNceiFake() {
  return { isAvailable: vi.fn().mockReturnValue(false) };
}

interface Fakes {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  ncei: ReturnType<typeof buildNceiFake>;
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
}

function buildFakes(): Fakes {
  return {
    noaa: buildNoaaFake(),
    openMeteo: buildOpenMeteoFake(),
    ncei: buildNceiFake(),
    locationStore: {},
    geocoding: {},
  };
}

function callCurrentConditions(
  args: Record<string, unknown>,
  fakes: Fakes,
  aviationWeatherService: { getMetarsInBoundingBox: ReturnType<typeof vi.fn> }
) {
  return handleGetCurrentConditions(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.ncei as unknown as NCEIService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService,
    undefined as unknown as AcisService | undefined,
    aviationWeatherService as unknown as AviationWeatherService
  );
}

/** The T2 construct regex — the `u` flag is mandatory (G28: without it an
 *  emoji class matches half a surrogate pair and never matches). */
const INDEX_LINE_RE =
  /^\*\*([🟢🟡🟠🔴]) Fosberg Fire Weather Index:\*\* (\d+) \((Low|Moderate|High|Extreme)\)$/mu;

function parseIndexLine(text: string): { emoji: string; index: number; level: string } {
  const match = text.match(INDEX_LINE_RE);
  if (!match) {
    throw new Error(`No Fosberg index line found in:\n${text}`);
  }
  return { emoji: match[1], index: Number(match[2]), level: match[3] };
}

/** The humidity percent printed on the Temperature line — the value the
 *  index is contracted to agree with (design Test 3). */
function parseHumidityPercent(text: string): number {
  const match = text.match(/humidity (\d+)%/);
  if (!match) {
    throw new Error(`No humidity percent found in:\n${text}`);
  }
  return Number(match[1]);
}

/**
 * Strip the Fire Weather section out of a rendered report: from
 * `\n## Fire Weather\n` up to (not including) the next `\n---\n`. Used to
 * assert the rest of the report is byte-identical to the no-flag output.
 */
function stripFireWeatherSection(text: string): string {
  const startMarker = '\n## Fire Weather\n';
  const start = text.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`No Fire Weather section found in:\n${text}`);
  }
  const endMarker = '\n---\n';
  const end = text.indexOf(endMarker, start);
  if (end === -1) {
    throw new Error(`No terminating "---" found after the Fire Weather section in:\n${text}`);
  }
  return text.slice(0, start) + text.slice(end);
}

// ---------------------------------------------------------------------------
// 1. Construct (design Test 1)
// ---------------------------------------------------------------------------

describe('METAR Fosberg section — construct (Test 1)', () => {
  // temp 30C, dewp 1C, wspd 16kt -> rh 16%, index 48 (High). Chosen so the
  // index is Moderate or above (G13: a Low-only fixture cannot discriminate
  // the emoji/label ladder), and it doubles as the Test 3 triple (see below).
  const HIGH_FIXTURE = buildMetarObservation({ temp: 30, dewp: 1, wspd: 16 });

  it('renders the index-line construct, agreeing number/label, no dryness or NOAA-index vocabulary, and a disclosure naming the station', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([HIGH_FIXTURE]);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', include_fire_weather: true },
      fakes,
      aviation
    );
    const text = textOf(result);

    const { index, level } = parseIndexLine(text);
    expect(level).toBe(getFosbergCategory(index).level);

    expect(text).not.toContain('Vapour-pressure');
    expect(text).not.toContain('Topsoil');
    expect(text).not.toContain('Red Flag');

    expect(text).toContain('*Derived by this server from the KSEA observation above');
  });

  // M6/M9 target: an index that rounds *up* across the Moderate/High edge
  // (raw 39.998, rounded 40) so a duplicated ladder with a shifted edge, or a
  // "band the unrounded value" mutant, renders a different label than the
  // real one. Found by .claude/scratch/metar-fosberg/search-band-edge2.mjs.
  const BAND_EDGE_FIXTURE = buildMetarObservation({ temp: 23, dewp: 7, wspd: 17 });

  it('categorizes a band-edge index (rounds to exactly 40) as High, not Moderate', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([BAND_EDGE_FIXTURE]);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', include_fire_weather: true },
      fakes,
      aviation
    );
    const text = textOf(result);

    const { index, level } = parseIndexLine(text);
    expect(index).toBe(40);
    expect(level).toBe('High');
  });
});

// ---------------------------------------------------------------------------
// 2. Preference invariance (design Test 2)
// ---------------------------------------------------------------------------

describe('METAR Fosberg section — preference invariance (Test 2)', () => {
  // Display-unit values differ grossly from the fixed native values (30C /
  // 20kt), so a mutation that routes either through the display/prefs chain
  // diverges between these three calls.
  const FIXTURE = buildMetarObservation({ temp: 30, dewp: 15, wspd: 20 });

  it('renders the identical index line under imperial, metric, and wind_speed_unit: kn', async () => {
    const fakesImperial = buildFakes();
    const resultImperial = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', include_fire_weather: true, units: 'imperial' },
      fakesImperial,
      buildAviationFake([FIXTURE])
    );

    const fakesMetric = buildFakes();
    const resultMetric = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', include_fire_weather: true, units: 'metric' },
      fakesMetric,
      buildAviationFake([FIXTURE])
    );

    const fakesKn = buildFakes();
    const resultKn = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', include_fire_weather: true, units: 'metric', wind_speed_unit: 'kn' },
      fakesKn,
      buildAviationFake([FIXTURE])
    );

    const imperialLine = parseIndexLine(textOf(resultImperial));
    const metricLine = parseIndexLine(textOf(resultMetric));
    const knLine = parseIndexLine(textOf(resultKn));

    expect(metricLine).toEqual(imperialLine);
    expect(knLine).toEqual(imperialLine);
  });
});

// ---------------------------------------------------------------------------
// 3. Printed-input coherence (design Test 3)
// ---------------------------------------------------------------------------

describe('METAR Fosberg section — printed-input coherence (Test 3)', () => {
  // The T3 search triple: temp 30C, dewp 1C, wspd 16kt. Chosen by
  // .claude/scratch/metar-fosberg/search-test3-triple-narrow.mjs, which loops
  // a small grid and picks a triple where the unrounded Magnus RH
  // (15.500348...%) sits within 0.001 of a whole-percent boundary AND
  // Math.round of the Fosberg index differs between the rounded RH the
  // shipped code (and the humidity line) uses (16% -> index 48) and the
  // unrounded RH an "unrounded Magnus RH" mutant would use (15.5003...% ->
  // index 48.99 -> rounds to 49). That gap is what makes this row catch M4.
  const TRIPLE_FIXTURE = buildMetarObservation({ temp: 30, dewp: 1, wspd: 16 });

  it('equals Math.round(calculateFosbergIndex(celsiusToFahrenheit(t), <printed RH>, knotsToMph(w)))', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([TRIPLE_FIXTURE]);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', include_fire_weather: true },
      fakes,
      aviation
    );
    const text = textOf(result);

    const { index: renderedIndex } = parseIndexLine(text);
    const printedRH = parseHumidityPercent(text);
    expect(printedRH).toBe(16);

    const expected = Math.round(
      calculateFosbergIndex(celsiusToFahrenheit(30), printedRH, knotsToMph(16))
    );
    expect(renderedIndex).toBe(expected);
    expect(renderedIndex).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// 4. Missing inputs (design Test 4, G59)
// ---------------------------------------------------------------------------

describe('METAR Fosberg section — missing inputs (Test 4, G59)', () => {
  async function renderWithFlag(observation: MetarObservation, includeFireWeather: boolean) {
    const fakes = buildFakes();
    const aviation = buildAviationFake([observation]);
    const result = await callCurrentConditions(
      {
        ...SEATTLE,
        source: 'metar',
        ...(includeFireWeather ? { include_fire_weather: true } : {}),
      },
      fakes,
      aviation
    );
    return textOf(result);
  }

  async function expectGapRow(observation: MetarObservation, expectedNamedGap: string) {
    const withFlag = await renderWithFlag(observation, true);
    const withoutFlag = await renderWithFlag(observation, false);

    expect(withFlag).toContain(
      `⚠️ Fire weather index unavailable — the ${observation.icaoId} report omits ${expectedNamedGap}.`
    );
    expect(withFlag).not.toContain('NaN');
    expect(withFlag).not.toContain('undefined');

    expect(stripFireWeatherSection(withFlag)).toBe(withoutFlag);
  }

  it('names "temperature" when temp is absent', async () => {
    await expectGapRow(buildMetarObservation({ temp: undefined }), 'temperature');
  });

  it('names "dew point" when dewp is absent', async () => {
    await expectGapRow(buildMetarObservation({ dewp: undefined }), 'dew point');
  });

  it('names "wind speed" when wspd is absent', async () => {
    await expectGapRow(buildMetarObservation({ wspd: undefined }), 'wind speed');
  });

  it('names "dew point and wind speed" when both are absent (G59: the two-absent cell)', async () => {
    await expectGapRow(
      buildMetarObservation({ dewp: undefined, wspd: undefined }),
      'dew point and wind speed'
    );
  });

  it('names "wind speed" when wspd is JSON null (not merely absent)', async () => {
    // Real third-party JSON, not just an omitted key (base-tree fact 2). The
    // pre-existing wind line prints "0 mph" for this same fixture (obs.wspd
    // * KNOTS_TO_MPS coerces null to 0) — known, out of scope, not asserted
    // on here.
    await expectGapRow(
      buildMetarObservation({ wspd: null as unknown as number }),
      'wind speed'
    );
  });

  it('renders an index for wspd: 0 (calm is not a gap)', async () => {
    const fakes = buildFakes();
    const observation = buildMetarObservation({ wspd: 0 });
    const aviation = buildAviationFake([observation]);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', include_fire_weather: true },
      fakes,
      aviation
    );
    const text = textOf(result);

    // Renders a real index line, not the "unavailable" warning.
    expect(() => parseIndexLine(text)).not.toThrow();
    expect(text).not.toContain('Fire weather index unavailable');
  });
});

// ---------------------------------------------------------------------------
// 5. US pointer gating (design Test 5)
// ---------------------------------------------------------------------------

describe('METAR Fosberg section — US pointer gating (Test 5)', () => {
  const NOAA_POINTER =
    'For a US location, NOAA publishes Haines, grassland and red-flag indices — use `source: "noaa"`.';

  it('renders the NOAA pointer for a US point (SEATTLE/KSEA)', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([buildMetarObservation()]);

    const result = await callCurrentConditions(
      { ...SEATTLE, source: 'metar', include_fire_weather: true },
      fakes,
      aviation
    );
    const text = textOf(result);

    expect(text).toContain(NOAA_POINTER);
  });

  it('omits the NOAA pointer for a non-US point (LONDON/EGLL)', async () => {
    const fakes = buildFakes();
    const aviation = buildAviationFake([
      buildMetarObservation({
        icaoId: 'EGLL',
        name: 'London Heathrow',
        lat: LONDON.latitude + 0.01,
        lon: LONDON.longitude + 0.01,
      }),
    ]);

    const result = await callCurrentConditions(
      { ...LONDON, source: 'metar', include_fire_weather: true },
      fakes,
      aviation
    );
    const text = textOf(result);

    expect(text).not.toContain('source: "noaa"');
  });
});
