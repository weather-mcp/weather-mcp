/**
 * A trimmed national CAP index never earns a ✅ (RF-28 M2,
 * plan-alert-territory-trim-cancel §2).
 *
 * When the feed listed more than `MAX_INDEX_ITEMS` alerts, only the first ones
 * were checked, and item 201 may be an unexpired warning for this point (G8).
 * So a no-match answer over a trimmed index says "not an all-clear" instead of
 * printing the green check. Something matched → unchanged apart from the
 * existing caveat line. Untrimmed output is byte-identical to before the
 * change in every branch; the literals below were captured from `main` @
 * 01f1810 for exactly these fixtures.
 *
 * Every fixture states `indexTrimmed` and `unavailableCount`; no defaulted
 * service result (G95).
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { NationalCapService } from '../../src/services/nationalCap.js';
import type { NationalCapResult, NationalCapWarning } from '../../src/types/cap.js';

const NEW_DELHI = { latitude: 28.61, longitude: 77.21 };

const RING_AROUND_DELHI: Array<[number, number]> = [
  [28.0, 77.0],
  [28.0, 78.0],
  [29.0, 78.0],
  [29.0, 77.0],
  [28.0, 77.0]
];

const RING_ELSEWHERE: Array<[number, number]> = [
  [10.0, 70.0],
  [10.0, 71.0],
  [11.0, 71.0],
  [11.0, 70.0],
  [10.0, 70.0]
];

function warning(identifier: string, polygons: Array<Array<[number, number]>>): NationalCapWarning {
  return {
    identifier,
    status: 'Actual',
    msgType: 'Alert',
    references: [],
    event: 'Heavy Rainfall Warning',
    severity: 'Severe',
    urgency: 'Expected',
    certainty: 'Likely',
    sent: '2026-08-23T06:00:00+05:30',
    expires: '2026-08-23T18:00:00+05:30',
    headline: 'Heavy rainfall expected',
    description: 'Widespread heavy rain.',
    instruction: 'Avoid low-lying areas.',
    senderName: 'IMD',
    areaDesc: ['Somewhere'],
    polygons,
    countryCode: 'in'
  };
}

function nationalFake(result: NationalCapResult): NationalCapService {
  return { getWarnings: vi.fn(async () => result) } as unknown as NationalCapService;
}

const emptyStore = { get: vi.fn(() => undefined) } as unknown as LocationStore;
const emptyGeocoding = { search: vi.fn(async () => []) } as unknown as GeocodingService;
const noaa = {} as unknown as NOAAService;
const nominatimIndia = { reverseCountry: vi.fn(async () => 'in') } as unknown as NominatimService;

async function render(warnings: NationalCapWarning[], unavailableCount: number, indexTrimmed: boolean): Promise<string> {
  const result = await handleGetAlerts(
    { ...NEW_DELHI },
    noaa,
    emptyStore,
    emptyGeocoding,
    undefined,
    undefined,
    nominatimIndia,
    undefined,
    nationalFake({ warnings, unavailableCount, polygonUnavailableCount: 0, indexTrimmed })
  );
  return result.content[0].text;
}

const ELSEWHERE_ONE = [warning('IN-E1', [RING_ELSEWHERE])];
const ELSEWHERE_THREE = [
  warning('IN-E1', [RING_ELSEWHERE]),
  warning('IN-E2', [RING_ELSEWHERE]),
  warning('IN-E3', [RING_ELSEWHERE])
];
const MATCHED_ONE = [warning('IN-M1', [RING_AROUND_DELHI])];

const CAVEAT_LINE = '*Note: the NDMA SACHET feed listed more than 200 alerts; only the first 200 were checked.*';
const ALL_CLEAR = '✅ **No active weather alerts';
const TRIMMED_HEADLINE = 'ℹ️ **No alert covering your location among those checked — this is not an all-clear.**';
const ZERO_COUNT = /\b0 (alert|active|warning)/;

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Pre-change render of each fixture, untrimmed. Captured from `main` @ 01f1810. */
const BASE = {
  emptyFeed:
    '# Weather Alerts — India\n\n**Location:** 28.6100, 77.2100\n\n✅ **No active weather alerts for your location in India.**\n\n*Checked against NDMA SACHET\'s public CAP feed — no active warnings nationwide.*\n\n---\n*Data source: NDMA SACHET (National Disaster Management Authority, Government of India) — public domain; alerts shown unmodified as issued, times as published.*\n',
  elsewhereOne:
    '# Weather Alerts — India\n\n**Location:** 28.6100, 77.2100\n\n✅ **No active weather alerts for your location in India.**\n\n*Checked against NDMA SACHET\'s public CAP feed — 1 active warning elsewhere in India, none covering this point.*\n\n---\n*Data source: NDMA SACHET (National Disaster Management Authority, Government of India) — public domain; alerts shown unmodified as issued, times as published.*\n',
  elsewhereThree:
    '# Weather Alerts — India\n\n**Location:** 28.6100, 77.2100\n\n✅ **No active weather alerts for your location in India.**\n\n*Checked against NDMA SACHET\'s public CAP feed — 3 active warnings elsewhere in India, none covering this point.*\n\n---\n*Data source: NDMA SACHET (National Disaster Management Authority, Government of India) — public domain; alerts shown unmodified as issued, times as published.*\n',
  partialUnavailable:
    '# Weather Alerts — India\n\n**Location:** 28.6100, 77.2100\n\n⚠️ *2 alerts in the NDMA SACHET feed could not be loaded and are not shown — this is not an all-clear for those alerts.*\n\nℹ️ **No alert covering your location among those that could be read.**\n\n*Checked against NDMA SACHET\'s public CAP feed — 1 active warning elsewhere in India. The 2 alerts above could not be read, so this is not a full all-clear.*\n\n---\n*Data source: NDMA SACHET (National Disaster Management Authority, Government of India) — public domain; alerts shown unmodified as issued, times as published.*\n',
  nothingLoadedUnavailable:
    '# Weather Alerts — India\n\n**Location:** 28.6100, 77.2100\n\n⚠️ *2 alerts in the NDMA SACHET feed could not be loaded and are not shown — this is not an all-clear for those alerts.*\n\nℹ️ **The NDMA SACHET alert list could not be loaded for your location.**\n\n---\n*Data source: NDMA SACHET (National Disaster Management Authority, Government of India) — public domain; alerts shown unmodified as issued, times as published.*\n',
  matchedOne:
    '# Weather Alerts — India\n\n**Location:** 28.6100, 77.2100\n\n⚠️ **1 active warning matched to your location**\n\n🟠 **Heavy Rainfall Warning**\n---\n**Headline:** Heavy rainfall expected\n**Severity:** Severe | **Urgency:** Expected | **Certainty:** Likely\n**Area:** Somewhere\n**Issued:** 2026-08-23 06:00 (+05:30)\n**Expires:** 2026-08-23 18:00 (+05:30)\n\n**Instructions:**\nAvoid low-lying areas.\n\n**Sender:** IMD\n\n*Showing standard detail. Use detail="full" for complete warning descriptions.*\n\n---\n*Data source: NDMA SACHET (National Disaster Management Authority, Government of India) — public domain; alerts shown unmodified as issued, times as published.*\n'
};

describe('national CAP — trimmed index, nothing matched: no ✅', () => {
  const cases: Array<[string, NationalCapWarning[], string]> = [
    ['an empty feed', [], '*Checked against NDMA SACHET\'s public CAP feed — no active warnings among the first 200 alerts; the rest of the feed was not checked.*'],
    ['one warning elsewhere', ELSEWHERE_ONE, '*Checked against NDMA SACHET\'s public CAP feed — 1 active warning elsewhere in India; alerts beyond the first 200 in the feed were not checked.*'],
    ['three warnings elsewhere', ELSEWHERE_THREE, '*Checked against NDMA SACHET\'s public CAP feed — 3 active warnings elsewhere in India; alerts beyond the first 200 in the feed were not checked.*']
  ];

  for (const [label, warnings, scopeLine] of cases) {
    it(`${label}: caveat, neutral headline, scope line, "not an all-clear", no zero count`, async () => {
      const text = await render(warnings, 0, true);

      expect(text).not.toContain(ALL_CLEAR);
      expect(text).not.toContain('✅');
      expect(text).toContain(CAVEAT_LINE);
      expect(text).toContain(TRIMMED_HEADLINE);
      expect(text).toContain(scopeLine);
      expect(text).toContain('not an all-clear');
      expect(text).not.toMatch(ZERO_COUNT);
    });
  }
});

describe('national CAP — trimmed plus unavailable', () => {
  it('nothing matched: one closing sentence carries both reasons, "not checked" appears once', async () => {
    const text = await render(ELSEWHERE_ONE, 2, true);

    expect(text).not.toContain(ALL_CLEAR);
    expect(text).not.toContain('✅');
    expect(text).toContain(CAVEAT_LINE);
    expect(text).toContain('ℹ️ **No alert covering your location among those that could be read.**');
    expect(text).toContain(
      'The 2 alerts above could not be read and alerts beyond the first 200 in the feed were not checked, so this is not a full all-clear.*'
    );
    expect(count(text, 'not checked')).toBe(1);
    expect(count(text, 'not a full all-clear')).toBe(1);
    expect(text).not.toMatch(ZERO_COUNT);
  });

  it('nothing loaded: the unchanged nothing-loaded text plus the caveat', async () => {
    const text = await render([], 2, true);

    expect(text).toBe(BASE.nothingLoadedUnavailable.replace(
      '**Location:** 28.6100, 77.2100\n\n',
      `**Location:** 28.6100, 77.2100\n\n${CAVEAT_LINE}\n\n`
    ));
    expect(text).not.toContain('✅');
  });
});

describe('national CAP — trimmed, something matched: unchanged apart from the caveat', () => {
  it('equals the untrimmed render minus exactly the caveat line', async () => {
    const trimmed = await render(MATCHED_ONE, 0, true);
    const untrimmed = await render(MATCHED_ONE, 0, false);

    expect(trimmed).toContain(CAVEAT_LINE);
    expect(trimmed.replace(`${CAVEAT_LINE}\n\n`, '')).toBe(untrimmed);
  });
});

describe('national CAP — untrimmed output is byte-identical to before the change', () => {
  it('empty feed (✅ nationwide)', async () => {
    expect(await render([], 0, false)).toBe(BASE.emptyFeed);
  });

  it('one warning elsewhere (✅ with scope line)', async () => {
    expect(await render(ELSEWHERE_ONE, 0, false)).toBe(BASE.elsewhereOne);
  });

  it('three warnings elsewhere', async () => {
    expect(await render(ELSEWHERE_THREE, 0, false)).toBe(BASE.elsewhereThree);
  });

  it('partial load, nothing matched', async () => {
    expect(await render(ELSEWHERE_ONE, 2, false)).toBe(BASE.partialUnavailable);
  });

  it('nothing loaded', async () => {
    expect(await render([], 2, false)).toBe(BASE.nothingLoadedUnavailable);
  });

  it('one matched', async () => {
    expect(await render(MATCHED_ONE, 0, false)).toBe(BASE.matchedOne);
  });
});
