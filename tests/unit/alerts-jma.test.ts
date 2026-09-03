/**
 * Unit tests for the Japan routing branch of `get_alerts` and its JMA
 * renderer (`handleJmaAlerts` and helpers in src/handlers/alertsHandler.ts).
 *
 * Exercises `handleGetAlerts` end-to-end with plain fake services (no HTTP,
 * no live calls) — the real committed class10 geometry artifact
 * (src/data/jmaAreas.ts) loads for real, which is not a network call — to
 * prove:
 *   - routing: a Japanese point reaches JMA with the resolved office code
 *     and never Google, key or no key; without the trailing jmaService
 *     argument the point falls through to the pre-existing Google/
 *     not-covered behaviour; the not-covered sentence names Japan
 *   - the four not-an-all-clear states (no warning area, no issuing office,
 *     no bulletin in the index, the area cross-check failing) each render
 *     their own sentence with no ✅
 *   - rendering: 解除 (lifted) kinds are never shown as active, an
 *     unrecognised status is still shown, the emergency/warning/advisory
 *     tier order is correct even from a scrambled input, an unrecognised
 *     warning name renders verbatim with no English gloss and is never
 *     dropped, the display cap and its "mostly <severity>" remainder note,
 *     detail="summary" counts, active_only=false's caveat, and the mandatory
 *     attribution footer
 *   - failure propagation: a rejected `getWarnings` rejects the handler,
 *     never a fabricated result
 *
 * G45: every contract below is driven through `handleGetAlerts` — never by
 * calling the private `handleJmaAlerts`, `resolveJmaArea`, or
 * `classifyJmaTier` directly. Those already have their own coverage
 * (tests/unit/jma-area-resolver.test.ts, tests/unit/jma-warning-names.test.ts)
 * and are not duplicated here.
 *
 * G40 grep re-run (reported in full in this task's report): no existing test
 * file pins a Japanese coordinate to any alerts branch. The only hit for
 * "Japan" in tests/ outside the JMA-specific files themselves is a comment in
 * tests/unit/alerts-google-fallback.test.ts explaining why an uncovered point
 * must not borrow a covered point's ✅ — it drives a Sydney fixture, not a
 * Japanese one, so it is not a lock on this branch.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { MeteoAlarmService } from '../../src/services/meteoalarm.js';
import type { GeoMetService } from '../../src/services/geomet.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { GoogleWeatherService } from '../../src/services/googleWeather.js';
import type { NationalCapService } from '../../src/services/nationalCap.js';
import type { JmaService, JmaWarningsResult } from '../../src/services/jma.js';
import type { JmaWarningArea, JmaWarningKind } from '../../src/types/jma.js';

// ---------------------------------------------------------------------------
// Fixture coordinates — verified against the committed class10 artifact
// (src/data/jmaAreas.ts) by reading the file directly for this task.
// ---------------------------------------------------------------------------

const TOKYO = { latitude: 35.6895, longitude: 139.6917 };
const TOKYO_CODE = '130010';
const TOKYO_OFFICE = '130000';

const FUKUI = { latitude: 36.0652, longitude: 136.2216 };
const FUKUI_OFFICE = '180000';

const SAPPORO = { latitude: 43.0618, longitude: 141.3545 };
const SAPPORO_OFFICE = '016000';

const NAHA = { latitude: 26.2124, longitude: 127.6809 };
const NAHA_OFFICE = '471000';

/** Open sea east of Honshu: inside Japan by country, outside every warning area. */
const OPEN_SEA = { latitude: 34.0, longitude: 141.5 };

/**
 * The one area with no issuing office (class10 code `hoppo`). Its upstream
 * map label is byte-identical to real area 014010 (根室地方 / Nemuro Region),
 * which does have an office — see src/data/jmaAreas.ts's own header.
 */
const HOPPO_POINT = { latitude: 44.0, longitude: 145.8 };

// ---------------------------------------------------------------------------
// Fake service builders (precedent: tests/unit/alerts-national-cap.test.ts)
// ---------------------------------------------------------------------------

function makeNoaaFake(): NOAAService {
  return {
    getStations: vi.fn(async () => ({ features: [] })),
    getAlerts: vi.fn(async () => ({ updated: '2026-09-03T00:00:00Z', features: [] }))
  } as unknown as NOAAService;
}

function makeGeoMetFake(): GeoMetService {
  return { getAlerts: vi.fn(async () => []) } as unknown as GeoMetService;
}

function makeMeteoAlarmFake(): MeteoAlarmService {
  return { getWarnings: vi.fn(async () => []) } as unknown as MeteoAlarmService;
}

function makeNationalFake(): NationalCapService {
  return {
    getWarnings: vi.fn(async () => ({
      warnings: [],
      unavailableCount: 0,
      polygonUnavailableCount: 0,
      indexTrimmed: false
    }))
  } as unknown as NationalCapService;
}

function makeNominatimFake(country: string | null): NominatimService {
  return { reverseCountry: vi.fn(async () => country) } as unknown as NominatimService;
}

/**
 * `flag`, when supplied, is set the moment `isKeyAvailable` is actually
 * invoked — contract 2 asserts it never was, which is a stronger claim than
 * "getPublicAlerts was not called": it proves the JMA branch never even asks
 * whether a key is configured.
 */
function makeGoogleFake(flag?: { called: boolean }): GoogleWeatherService {
  return {
    isKeyAvailable: vi.fn(() => {
      if (flag) {
        flag.called = true;
      }
      return true;
    }),
    getPublicAlerts: vi.fn(async () => ({ alerts: [], covered: true }))
  } as unknown as GoogleWeatherService;
}

function makeGoogleFakeNoKey(): GoogleWeatherService {
  return {
    isKeyAvailable: vi.fn(() => false),
    getPublicAlerts: vi.fn(async () => ({ alerts: [], covered: true }))
  } as unknown as GoogleWeatherService;
}

function makeJmaFake(result: Partial<JmaWarningsResult> = {}, error?: Error): JmaService {
  return {
    getWarnings: vi.fn(async (officeCode: string) => {
      if (error) {
        throw error;
      }
      return {
        officeCode,
        indexStale: false,
        indexClockUnknown: false,
        indexTrimmed: false,
        indexUnparsedEntries: 0,
        ...result
      } satisfies JmaWarningsResult;
    })
  } as unknown as JmaService;
}

const emptyStore = { get: vi.fn(() => undefined) } as unknown as LocationStore;
const emptyGeocoding = { search: vi.fn(async () => []) } as unknown as GeocodingService;

function kindFixture(overrides: Partial<JmaWarningKind> = {}): JmaWarningKind {
  return { name: '大雨警報', status: '継続', ...overrides };
}

function areaFixture(code: string, overrides: Partial<JmaWarningArea> = {}): JmaWarningArea {
  return { code, name: 'テスト地方', kinds: [], ...overrides };
}

/**
 * Run `handleGetAlerts` with all ten arguments wired, `jma` trailing.
 * `passJma: false` passes `undefined` explicitly for the 10th argument, to
 * drive the trailing-optional-guarantee contract.
 */
async function callAlerts(
  args: Record<string, unknown>,
  options: {
    country: string | null;
    jma?: JmaService;
    google?: GoogleWeatherService;
    passJma?: boolean;
  }
): Promise<{ text: string; jma: JmaService; google: GoogleWeatherService }> {
  const jma = options.jma ?? makeJmaFake();
  const google = options.google ?? makeGoogleFakeNoKey();
  const result = await handleGetAlerts(
    args,
    makeNoaaFake(),
    emptyStore,
    emptyGeocoding,
    makeMeteoAlarmFake(),
    makeGeoMetFake(),
    makeNominatimFake(options.country),
    google,
    makeNationalFake(),
    options.passJma === false ? undefined : jma
  );
  return { text: result.content[0].text, jma, google };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('JMA routing', () => {
  it.each([
    ['Tokyo', TOKYO, TOKYO_OFFICE],
    ['Fukui', FUKUI, FUKUI_OFFICE],
    ['Sapporo', SAPPORO, SAPPORO_OFFICE],
    ['Naha', NAHA, NAHA_OFFICE]
  ])('routes %s to JMA with the resolved office code, never Google', async (_name, coords, office) => {
    const flag = { called: false };
    const { jma, google, text } = await callAlerts(coords, {
      country: 'jp',
      google: makeGoogleFake(flag)
    });

    expect(jma.getWarnings).toHaveBeenCalledWith(office);
    expect(flag.called).toBe(false);
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
    expect(text).toContain('# Weather Alerts — Japan');
  });

  it('never reaches Google even when a key is available (contract 2)', async () => {
    const flag = { called: false };
    const { google } = await callAlerts(TOKYO, {
      country: 'jp',
      google: makeGoogleFake(flag)
    });

    expect(flag.called).toBe(false);
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
  });

  it('falls through to a keyed Google answer when no jmaService is passed (trailing-optional guarantee)', async () => {
    const flag = { called: false };
    const { google, jma } = await callAlerts(TOKYO, {
      country: 'jp',
      google: makeGoogleFake(flag),
      passJma: false
    });

    expect(flag.called).toBe(true);
    expect(google.getPublicAlerts).toHaveBeenCalled();
    expect(jma.getWarnings).not.toHaveBeenCalled();
  });

  it('falls through to the not-covered message, naming Japan, when no jmaService and no Google key', async () => {
    const { text, jma } = await callAlerts(TOKYO, {
      country: 'jp',
      google: makeGoogleFakeNoKey(),
      passJma: false
    });

    expect(jma.getWarnings).not.toHaveBeenCalled();
    expect(text).toContain('not yet available for Japan');
    expect(text).toContain('Japan (JMA), matched to your point by warning area');
  });
});

// ---------------------------------------------------------------------------
// The four not-an-all-clear states
// ---------------------------------------------------------------------------

describe('JMA not-an-all-clear states', () => {
  it('discloses when the point is inside no warning area, and never calls JMA', async () => {
    const jma = makeJmaFake();
    const { text } = await callAlerts(OPEN_SEA, { country: 'jp', jma });

    expect(text).not.toContain('✅');
    expect(text).toContain('This point is not inside any JMA warning area');
    expect(text).toContain('This is not an all-clear');
    expect(jma.getWarnings).not.toHaveBeenCalled();
  });

  it('discloses the office-less area without ever calling JMA or naming the area', async () => {
    const jma = makeJmaFake();
    const { text } = await callAlerts(HOPPO_POINT, { country: 'jp', jma });

    expect(text).not.toContain('✅');
    expect(text).toContain('No JMA office issues weather warnings for this location');
    // This exact string and gloss are area 014010's real, active area name —
    // rendering it here would state something false about that different
    // area. Acceptable as a bare vocabulary negative only because that IS the
    // whole point of this test (G62); everywhere else in this file, prefer a
    // positive assertion on what IS rendered.
    expect(text).not.toContain('根室地方');
    expect(text).not.toContain('Nemuro');
    expect(jma.getWarnings).not.toHaveBeenCalled();
  });

  it('discloses when the office publishes no current bulletin in the index', async () => {
    const jma = makeJmaFake({});
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).not.toContain('✅');
    expect(text).toContain('No current JMA warning bulletin was found for');
    expect(text).toContain('東京地方 (Tokyo Region)');
  });

  it('discloses when the resolved area cannot be matched in the office bulletin', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [areaFixture('999999', { name: 'Somewhere Else' })]
      }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).not.toContain('✅');
    expect(text).toContain('could not be matched');
    expect(text).toContain('気象庁');
  });
});

// ---------------------------------------------------------------------------
// Rendering — lifted (解除) kinds
// ---------------------------------------------------------------------------

describe('JMA rendering — lifted (解除) kinds', () => {
  it('renders the honest-empty ✅ when every kind is lifted, dropping neither as active', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [
          areaFixture(TOKYO_CODE, {
            kinds: [
              kindFixture({ name: '大雨警報', status: '解除' }),
              kindFixture({ name: '洪水警報', status: '解除' })
            ]
          })
        ]
      }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('✅ **No active weather warnings for 東京地方 (Tokyo Region).**');
    // The construct (the heading line), not the vocabulary (G62): anchored so
    // a future legend or "warnings elsewhere" line printing this same word
    // cannot collide with this assertion.
    expect(text).not.toMatch(/^### 大雨警報/m);
    expect(text).not.toMatch(/^### 洪水警報/m);
  });

  it('renders only the non-lifted kind from a mixed area, with a count that matches', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [
          areaFixture(TOKYO_CODE, {
            kinds: [
              kindFixture({ name: '大雨警報', status: '解除' }),
              kindFixture({ name: '洪水警報', status: '継続' })
            ]
          })
        ]
      }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('⚠️ **1 active warning for 東京地方 (Tokyo Region)**');
    expect(text).toMatch(/^### 洪水警報/m);
    expect(text).not.toMatch(/^### 大雨警報/m);
  });
});

// ---------------------------------------------------------------------------
// Rendering — the explicit quiet marker (発表警報・注意報はなし)
//
// JMA encodes "this area currently carries nothing" as a Kind with no name, no
// code, and the status 発表警報・注意報はなし. It is routine — over one week 65
// of Tokyo's 132 area blocks carried it, 小笠原諸島 in all 33 of its bulletins
// — and it must render as the honest empty, never as a warning. No fixture in
// this file carried the marker before, which is why the branch shipped able to
// print `⚠️ 1 active warning` / `### (unnamed warning)`.
// ---------------------------------------------------------------------------

const QUIET_MARKER: JmaWarningKind = { status: '発表警報・注意報はなし' };

describe('JMA rendering — explicit quiet marker', () => {
  it('renders the honest-empty ✅ for an area whose only kind is the quiet marker', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [areaFixture(TOKYO_CODE, { kinds: [{ ...QUIET_MARKER }] })]
      }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('✅ **No active weather warnings for 東京地方 (Tokyo Region).**');
    expect(text).not.toContain('⚠️');
    // The construct, not the vocabulary (G62): no warning heading of any kind,
    // and specifically never the placeholder the marker used to produce.
    expect(text).not.toMatch(/^### /m);
    expect(text).not.toContain('(unnamed warning)');
  });

  it('does not count the quiet marker beside a real kind in the same area', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [
          areaFixture(TOKYO_CODE, {
            kinds: [{ ...QUIET_MARKER }, kindFixture({ name: '洪水警報', status: '継続' })]
          })
        ]
      }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('⚠️ **1 active warning for 東京地方 (Tokyo Region)**');
    expect(text).toMatch(/^### 洪水警報/m);
    expect(text).not.toContain('(unnamed warning)');
  });

  it('does not let a quiet marker in another area inflate the elsewhere count', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [
          areaFixture(TOKYO_CODE, { kinds: [] }),
          areaFixture('130040', { kinds: [{ ...QUIET_MARKER }] })
        ]
      }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('no warnings in force in any area of that bulletin');
    expect(text).not.toContain('1 warning in force in other areas');
  });

  it('does not render a "Unknown: 1" severity count for the marker at detail="summary"', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [areaFixture(TOKYO_CODE, { kinds: [{ ...QUIET_MARKER }] })]
      }
    });
    const { text } = await callAlerts(
      { ...TOKYO, detail: 'summary' },
      { country: 'jp', jma }
    );

    expect(text).not.toContain('⚠️');
    expect(text).not.toContain('Unknown:');
    expect(text).not.toContain('(unnamed warning)');
  });
});

// ---------------------------------------------------------------------------
// Rendering — unrecognised status
// ---------------------------------------------------------------------------

describe('JMA rendering — unrecognised status', () => {
  it('renders an unrecognised status as active, with its status text visible at detail="standard"', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [
          areaFixture(TOKYO_CODE, {
            kinds: [kindFixture({ name: '大雨警報', status: '訂正' })]
          })
        ]
      }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('⚠️ **1 active warning for 東京地方 (Tokyo Region)**');
    expect(text).toContain('- **Status:** 訂正');
  });
});

// ---------------------------------------------------------------------------
// Rendering — tier ordering
// ---------------------------------------------------------------------------

describe('JMA rendering — tier ordering', () => {
  it('sorts an Emergency Warning before a plain Warning and an Advisory, from a deliberately scrambled input order', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [
          areaFixture(TOKYO_CODE, {
            // Deliberately wrong input order (G13): advisory, then plain
            // warning, then the emergency tier that must sort first.
            kinds: [
              kindFixture({ name: '乾燥注意報' }),
              kindFixture({ name: '強風警報' }),
              kindFixture({ name: '大雨特別警報' })
            ]
          })
        ]
      }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    const emergencyIndex = text.indexOf('大雨特別警報');
    const warningIndex = text.indexOf('強風警報');
    const advisoryIndex = text.indexOf('乾燥注意報');

    expect(emergencyIndex).toBeGreaterThan(-1);
    expect(warningIndex).toBeGreaterThan(-1);
    expect(advisoryIndex).toBeGreaterThan(-1);
    expect(emergencyIndex).toBeLessThan(warningIndex);
    expect(warningIndex).toBeLessThan(advisoryIndex);
  });
});

// ---------------------------------------------------------------------------
// Rendering — unknown warning name
// ---------------------------------------------------------------------------

describe('JMA rendering — unknown warning name', () => {
  it('renders an unrecognised phenomenon verbatim with no English gloss, and never drops it', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [
          areaFixture(TOKYO_CODE, {
            kinds: [kindFixture({ name: '謎警報' })]
          })
        ]
      }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('### 謎警報\n');
    // No gloss appended: the heading is the bare name, not "name — gloss".
    expect(text).not.toContain('謎警報 —');
  });
});

// ---------------------------------------------------------------------------
// Rendering — display cap
// ---------------------------------------------------------------------------

describe('JMA rendering — display cap', () => {
  const shownKinds = Array.from({ length: 10 }, (_unused, index) =>
    kindFixture({ name: `緊急${index}特別警報` })
  );
  // Deliberate tie in the remainder (G13): two Warning-tier and two
  // Advisory-tier kinds, both counts equal, so "mostly <severity>" actually
  // exercises the mode selection rather than picking a trivially unique max.
  const remainderKinds = [
    kindFixture({ name: '強風0警報' }),
    kindFixture({ name: '強風1警報' }),
    kindFixture({ name: '乾燥0注意報' }),
    kindFixture({ name: '乾燥1注意報' })
  ];

  function buildDocument(): { publishingOffice: string; areas: JmaWarningArea[] } {
    return {
      publishingOffice: '気象庁',
      areas: [areaFixture(TOKYO_CODE, { kinds: [...shownKinds, ...remainderKinds] })]
    };
  }

  it('caps at the standard display cap (10) and names the tied-mode severity in the remainder note', async () => {
    const jma = makeJmaFake({ document: buildDocument() });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('⚠️ **14 active warnings for 東京地方 (Tokyo Region)**');
    const headingCount = (text.match(/^### /gm) ?? []).length;
    expect(headingCount).toBe(10);
    expect(text).toContain('…and 4 more warnings, mostly Warning.');
  });

  it('shows more at detail="full" (cap 25)', async () => {
    const jma = makeJmaFake({ document: buildDocument() });
    const { text } = await callAlerts({ ...TOKYO, detail: 'full' }, { country: 'jp', jma });

    const headingCount = (text.match(/^### /gm) ?? []).length;
    expect(headingCount).toBe(14);
    expect(text).not.toContain('more warnings');
  });
});

// ---------------------------------------------------------------------------
// Rendering — detail="summary"
// ---------------------------------------------------------------------------

describe('JMA rendering — detail="summary"', () => {
  it('renders severity counts, not the individual warnings', async () => {
    const jma = makeJmaFake({
      document: {
        publishingOffice: '気象庁',
        areas: [
          areaFixture(TOKYO_CODE, {
            kinds: [
              kindFixture({ name: '大雨特別警報' }),
              kindFixture({ name: '強風警報' }),
              kindFixture({ name: '強風警報' })
            ]
          })
        ]
      }
    });
    const { text } = await callAlerts({ ...TOKYO, detail: 'summary' }, { country: 'jp', jma });

    expect(text).toContain('- **Emergency Warning:** 1');
    expect(text).toContain('- **Warning:** 2');
    expect(text).not.toMatch(/^### /m);
  });
});

// ---------------------------------------------------------------------------
// active_only=false
// ---------------------------------------------------------------------------

describe('JMA rendering — active_only=false', () => {
  it('renders the historical-unavailable caveat and asks the service for nothing different', async () => {
    const jma = makeJmaFake({
      document: { publishingOffice: '気象庁', areas: [areaFixture(TOKYO_CODE, { kinds: [] })] }
    });
    const { text } = await callAlerts({ ...TOKYO, active_only: false }, { country: 'jp', jma });

    expect(text).toContain('historical alerts are not available for this region');
    // toHaveBeenCalledWith requires an exact argument-list match, so this
    // also proves the fake was called with nothing beyond the office code.
    expect(jma.getWarnings).toHaveBeenCalledWith(TOKYO_OFFICE);
  });
});

// ---------------------------------------------------------------------------
// Failure posture
// ---------------------------------------------------------------------------

describe('JMA failure posture', () => {
  it('propagates a getWarnings rejection rather than rendering a fabricated result', async () => {
    const jma = makeJmaFake({}, new Error('JMA alert index server error (status 503)'));

    await expect(callAlerts(TOKYO, { country: 'jp', jma })).rejects.toThrow(/JMA alert index/);
  });
});

// ---------------------------------------------------------------------------
// Attribution footer
// ---------------------------------------------------------------------------

describe('JMA attribution footer', () => {
  it('carries the mandated attribution string exactly, in every branch that returns output', async () => {
    const scenarios: Array<() => Promise<string>> = [
      // State 1: no warning area.
      async () => (await callAlerts(OPEN_SEA, { country: 'jp' })).text,
      // State 2: office-less area.
      async () => (await callAlerts(HOPPO_POINT, { country: 'jp' })).text,
      // State 3: no bulletin in the index.
      async () => (await callAlerts(TOKYO, { country: 'jp', jma: makeJmaFake({}) })).text,
      // State 4: cross-check failure.
      async () =>
        (
          await callAlerts(TOKYO, {
            country: 'jp',
            jma: makeJmaFake({
              document: { publishingOffice: '気象庁', areas: [areaFixture('999999')] }
            })
          })
        ).text,
      // Honest-empty ✅ (all kinds lifted).
      async () =>
        (
          await callAlerts(TOKYO, {
            country: 'jp',
            jma: makeJmaFake({
              document: {
                publishingOffice: '気象庁',
                areas: [areaFixture(TOKYO_CODE, { kinds: [kindFixture({ status: '解除' })] })]
              }
            })
          })
        ).text,
      // Active warnings, standard detail.
      async () =>
        (
          await callAlerts(TOKYO, {
            country: 'jp',
            jma: makeJmaFake({
              document: {
                publishingOffice: '気象庁',
                areas: [areaFixture(TOKYO_CODE, { kinds: [kindFixture()] })]
              }
            })
          })
        ).text,
      // detail="summary".
      async () =>
        (
          await callAlerts(
            { ...TOKYO, detail: 'summary' },
            {
              country: 'jp',
              jma: makeJmaFake({
                document: {
                  publishingOffice: '気象庁',
                  areas: [areaFixture(TOKYO_CODE, { kinds: [kindFixture()] })]
                }
              })
            }
          )
        ).text,
      // active_only=false.
      async () =>
        (
          await callAlerts(
            { ...TOKYO, active_only: false },
            {
              country: 'jp',
              jma: makeJmaFake({
                document: { publishingOffice: '気象庁', areas: [areaFixture(TOKYO_CODE, { kinds: [] })] }
              })
            }
          )
        ).text
    ];

    for (const scenario of scenarios) {
      const text = await scenario();
      expect(text).toContain('出典：気象庁ホームページ');
    }
  });
});

// ---------------------------------------------------------------------------
// Index caveats
// ---------------------------------------------------------------------------

describe('JMA index caveats', () => {
  it('renders the indexTrimmed caveat, and still earns its ✅', async () => {
    const jma = makeJmaFake({
      indexTrimmed: true,
      document: { publishingOffice: '気象庁', areas: [areaFixture(TOKYO_CODE, { kinds: [] })] }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('the JMA feed listed more bulletins than could be scanned');
    // The one caveat that does NOT contradict an all-clear: the scan is
    // newest-first, so what the cap dropped is older than what was used and
    // cannot be a newer bulletin for this office.
    expect(text).toContain('✅');
  });

  it('withholds the ✅ when entries could not be identified', async () => {
    const jma = makeJmaFake({
      indexUnparsedEntries: 2,
      document: { publishingOffice: '気象庁', areas: [areaFixture(TOKYO_CODE, { kinds: [] })] }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('2 entries in the JMA feed could not be identified');
    // An unidentified entry could be a newer bulletin for this very office.
    expect(text).not.toContain('✅');
    expect(text).toContain('this is not an all-clear');
  });

  it('withholds the ✅ when the index is stale, keeping the disclosure alone', async () => {
    const jma = makeJmaFake({
      indexStale: true,
      document: { publishingOffice: '気象庁', areas: [areaFixture(TOKYO_CODE, { kinds: [] })] }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('most recent bulletin nationwide is unusually old');
    expect(text).toContain('this is not an all-clear');
    // The lock is the ABSENCE of the all-clear marker, not the presence of the
    // caveat text: the contradiction this guards against was an output that
    // carried both (G11).
    expect(text).not.toContain('✅');
  });

  it('renders the indexClockUnknown caveat and withholds the ✅', async () => {
    const jma = makeJmaFake({
      indexClockUnknown: true,
      document: { publishingOffice: '気象庁', areas: [areaFixture(TOKYO_CODE, { kinds: [] })] }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('carries no readable timestamp');
    expect(text).toContain('this is not an all-clear');
    expect(text).not.toContain('✅');
  });

  it('still renders active warnings beside a stale caveat, as ⚠️ not ℹ️', async () => {
    // Suppressing the ✅ must not suppress a warning that IS in force — the
    // caveat casts doubt on completeness, never on what was found.
    const jma = makeJmaFake({
      indexStale: true,
      document: {
        publishingOffice: '気象庁',
        areas: [
          areaFixture(TOKYO_CODE, { kinds: [kindFixture({ name: '大雨警報', status: '継続' })] })
        ]
      }
    });
    const { text } = await callAlerts(TOKYO, { country: 'jp', jma });

    expect(text).toContain('most recent bulletin nationwide is unusually old');
    expect(text).toContain('⚠️ **1 active warning for 東京地方 (Tokyo Region)**');
    expect(text).toMatch(/^### 大雨警報/m);
  });
});
