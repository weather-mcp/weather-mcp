/**
 * Sentinel test: proves the JMA service is threaded from
 * `handleGetWeatherSummary` all the way through to `handleGetAlerts`'s Japan
 * routing (T11). Mirrors tests/unit/weather-summary-national-cap.test.ts and
 * drives the real `handleGetWeatherSummary` and the real `handleGetAlerts`
 * (neither is mocked) with plain typed fakes for `JmaService`,
 * `GoogleWeatherService`, and `NominatimService` — offline, no axios
 * mocking, no network. The committed class10 geometry artifact
 * (src/data/jmaAreas.ts) loads for real, which is not a network call.
 *
 * See tests/unit/alerts-jma.test.ts for the full routing/rendering coverage
 * of `handleGetAlerts` itself; this file only proves the summary handler's
 * pass-through wiring, plus the G19 detail-default divergence between the
 * summary's own default (`summary`) and the `get_alerts` tool's own default
 * (`standard`) — see `handleGetWeatherSummary`'s `jmaService` doc comment.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { GoogleWeatherService } from '../../src/services/googleWeather.js';
import type { JmaService, JmaWarningsResult } from '../../src/services/jma.js';
import type { JmaWarningArea, JmaWarningKind } from '../../src/types/jma.js';

// ---------------------------------------------------------------------------
// Fixture coordinates — verified against the committed class10 artifact by
// reading src/data/jmaAreas.ts directly for this task (see also
// tests/unit/alerts-jma.test.ts, which uses the same pair).
// ---------------------------------------------------------------------------

const TOKYO = { latitude: 35.6895, longitude: 139.6917 };
const TOKYO_CODE = '130010';
const TOKYO_OFFICE = '130000';

const emptyStore = { get: vi.fn(() => undefined) } as unknown as LocationStore;
const emptyGeocoding = { search: vi.fn(async () => []) } as unknown as GeocodingService;

function makeNominatimFake(country: string | null): NominatimService {
  return { reverseCountry: vi.fn(async () => country) } as unknown as NominatimService;
}

/**
 * `flag`, when supplied, is set the moment `isKeyAvailable` is actually
 * invoked — a stronger claim than "getPublicAlerts was not called": it
 * proves the JMA branch never even asks whether a key is configured.
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

function makeJmaFake(result: Partial<JmaWarningsResult> = {}, error?: Error): JmaService {
  return {
    getWarnings: vi.fn(async (officeCode: string) => {
      if (error) {
        throw error;
      }
      return {
        officeCode,
        indexStale: false,
        indexTrimmed: false,
        indexUnparsedEntries: 0,
        ...result
      } satisfies JmaWarningsResult;
    })
  } as unknown as JmaService;
}

function kindFixture(overrides: Partial<JmaWarningKind> = {}): JmaWarningKind {
  return { name: '大雨注意報', status: '継続', ...overrides };
}

function areaFixture(code: string, overrides: Partial<JmaWarningArea> = {}): JmaWarningArea {
  return { code, name: 'テスト地方', kinds: [], ...overrides };
}

/** One area, one active Advisory-tier kind — enough for a non-empty alerts block in either detail branch. */
function activeDocument(): { publishingOffice: string; areas: JmaWarningArea[] } {
  return {
    publishingOffice: '気象庁',
    areas: [areaFixture(TOKYO_CODE, { kinds: [kindFixture()] })]
  };
}

/**
 * Drives the real `handleGetWeatherSummary` with an `include: ['alerts']`
 * summary for a Tokyo point, all 12 arguments wired positionally exactly as
 * `src/index.ts` wires them. `passJma: false` omits the trailing 12th
 * argument entirely (rather than passing `undefined` explicitly) to prove
 * the pre-existing 11-argument call shape still works unedited.
 */
async function callSummary(
  args: Record<string, unknown>,
  options: { jma?: JmaService; google?: GoogleWeatherService; passJma?: boolean }
): Promise<string> {
  const nominatim = makeNominatimFake('jp');
  const argsWithInclude = { ...args, include: ['alerts'] };

  const result =
    options.passJma === false
      ? await handleGetWeatherSummary(
          argsWithInclude,
          {} as unknown as NOAAService,
          {} as unknown as OpenMeteoService,
          {} as unknown as NCEIService,
          emptyStore,
          emptyGeocoding,
          undefined, // meteoAlarmService — not reached for a 'jp' point
          undefined, // geoMetService — not reached for a 'jp' point
          nominatim,
          options.google
          // nationalCapService and jmaService both omitted entirely — the
          // pre-existing 9-argument call shape.
        )
      : await handleGetWeatherSummary(
          argsWithInclude,
          {} as unknown as NOAAService,
          {} as unknown as OpenMeteoService,
          {} as unknown as NCEIService,
          emptyStore,
          emptyGeocoding,
          undefined, // meteoAlarmService — not reached for a 'jp' point
          undefined, // geoMetService — not reached for a 'jp' point
          nominatim,
          options.google,
          undefined, // nationalCapService — not reached for a 'jp' point
          options.jma
        );

  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// Contract 1 — JMA warnings render inside the summary's alerts section
// ---------------------------------------------------------------------------

describe('handleGetWeatherSummary — JMA pass-through (T11)', () => {
  it('routes a Japanese point to JMA with the resolved office code and renders it inside the summary', async () => {
    const jma = makeJmaFake({ document: activeDocument() });
    const text = await callSummary(TOKYO, { jma });

    expect(jma.getWarnings).toHaveBeenCalledWith(TOKYO_OFFICE);
    expect(text).toContain('Weather Alerts — Japan');
  });

  // -------------------------------------------------------------------------
  // Contract 2 — the two detail defaults land in different render branches
  // -------------------------------------------------------------------------

  it('with no detail at all, renders the detail="summary" counts branch (the summary\'s own default)', async () => {
    const jma = makeJmaFake({ document: activeDocument() });
    const text = await callSummary(TOKYO, { jma });

    expect(text).toContain('- **Advisory:** 1');
    expect(text).toContain('Counts only at detail="summary"');
    expect(text).not.toMatch(/^### /m);
  });

  it('with an explicit detail="standard", renders the individual ### warning headings instead', async () => {
    const jma = makeJmaFake({ document: activeDocument() });
    const text = await callSummary({ ...TOKYO, detail: 'standard' }, { jma });

    expect(text).toMatch(/^### 大雨注意報/m);
    expect(text).not.toContain('Counts only at detail="summary"');
  });

  it('the two detail defaults produce genuinely different renders of the same handler, not just two non-empty strings', async () => {
    const summaryDefaultText = await callSummary(TOKYO, { jma: makeJmaFake({ document: activeDocument() }) });
    const explicitStandardText = await callSummary(
      { ...TOKYO, detail: 'full' },
      { jma: makeJmaFake({ document: activeDocument() }) }
    );

    expect(summaryDefaultText).not.toEqual(explicitStandardText);
    expect(summaryDefaultText).toContain('- **Advisory:** 1');
    expect(summaryDefaultText).toContain('Counts only at detail="summary"');
    expect(summaryDefaultText).not.toMatch(/^### /m);

    expect(explicitStandardText).toMatch(/^### 大雨注意報/m);
    expect(explicitStandardText).not.toContain('Counts only at detail="summary"');
  });

  // -------------------------------------------------------------------------
  // Contract 3 — never Google, even with a key available
  // -------------------------------------------------------------------------

  it('never consults Google even when a key is available, once jmaService is passed', async () => {
    const flag = { called: false };
    const jma = makeJmaFake({ document: activeDocument() });
    const google = makeGoogleFake(flag);

    await callSummary(TOKYO, { jma, google });

    expect(flag.called).toBe(false);
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Contract 4 — regression lock: no jmaService, no JMA output
  // -------------------------------------------------------------------------

  it('without jmaService (12th argument omitted entirely), a Japanese point does NOT render JMA', async () => {
    const text = await callSummary(TOKYO, { passJma: false });

    expect(text).not.toContain('出典：気象庁ホームページ');
    expect(text).toContain('not yet available for Japan');
    expect(text).toContain('Japan (JMA), matched to your point by warning area');
  });

  it('without jmaService, falls through to a keyed Google answer instead', async () => {
    const flag = { called: false };
    const google = makeGoogleFake(flag);

    const text = await callSummary(TOKYO, { google, passJma: false });

    expect(flag.called).toBe(true);
    expect(google.getPublicAlerts).toHaveBeenCalled();
    expect(text).not.toContain('出典：気象庁ホームページ');
  });

  // -------------------------------------------------------------------------
  // Contract 5 — a JMA failure surfaces as the summary's own per-section
  // unavailable note, never a fabricated all-clear
  // -------------------------------------------------------------------------

  it('surfaces a JMA failure as the summary\'s own per-section unavailable note', async () => {
    const jma = makeJmaFake({}, new Error('JMA alert index server error (status 503)'));

    const text = await callSummary(TOKYO, { jma });

    expect(text).toContain('## alerts (unavailable)');
    expect(text).toContain('Could not retrieve alerts data for this location');
    expect(text).toContain('JMA alert index server error (status 503)');
    expect(text).not.toContain('✅');
  });

  // -------------------------------------------------------------------------
  // Contract 6 — mandated attribution survives into the summary
  // -------------------------------------------------------------------------

  it('carries the mandated JMA attribution string into the summary output', async () => {
    const jma = makeJmaFake({ document: activeDocument() });
    const text = await callSummary(TOKYO, { jma });

    expect(text).toContain('出典：気象庁ホームページ');
  });
});
