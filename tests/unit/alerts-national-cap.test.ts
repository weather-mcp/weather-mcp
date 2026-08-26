/**
 * Unit tests for the keyless national CAP alerts branch of `get_alerts`
 * (India — NDMA SACHET, Philippines — PAGASA, Indonesia — BMKG).
 *
 * Exercises `handleGetAlerts` with plain fake services (no HTTP, no live
 * calls) to prove:
 *   - D1 routing: an Indian/Philippine/Indonesian point reaches the national
 *     service and **never** Google, key or no key; US/Canada/Europe are
 *     untouched; without the 9th argument the point falls through to the
 *     not-covered message
 *   - D4 matching: a warning whose polygon contains the point is matched, one
 *     whose polygon excludes it is for somewhere else and is not shown, and
 *     one with no usable geometry is never dropped — it falls back to the
 *     country-level block
 *   - D6 disclosure: nothing-loaded renders ℹ️ and never ✅; a partial load
 *     renders the ✅ *with* its caveat; the geometry-lost line is computed
 *     from the block it labels
 *   - D8 rendering: severity sort, combined display cap, exact per-country
 *     attribution
 *   - D9 failure posture: a service error propagates rather than degrading
 *     to a fabricated all-clear
 *
 * See .devdocs/archive/completed/plan-national-cap-alerts.md D1, D4, D6, D8, D9.
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
import type { NationalCapResult, NationalCapWarning } from '../../src/types/cap.js';

// ---------------------------------------------------------------------------
// Fixture coordinates
// ---------------------------------------------------------------------------

const NEW_DELHI = { latitude: 28.61, longitude: 77.21 };
const MANILA = { latitude: 14.6, longitude: 120.98 };
const JAKARTA = { latitude: -6.21, longitude: 106.85 };
/** Elsewhere: not US, not Canada, not MeteoAlarm, not a national CAP country. */
const SYDNEY = { latitude: -33.87, longitude: 151.21 };
const SEATTLE = { latitude: 47.6, longitude: -122.3 };
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const BERLIN = { latitude: 52.52, longitude: 13.405 };

/** A small ring around New Delhi, closed as CAP requires. */
const RING_AROUND_DELHI: Array<[number, number]> = [
  [28.0, 77.0],
  [28.0, 78.0],
  [29.0, 78.0],
  [29.0, 77.0],
  [28.0, 77.0]
];

/** A ring far away from every fixture coordinate above. */
const RING_ELSEWHERE: Array<[number, number]> = [
  [10.0, 70.0],
  [10.0, 71.0],
  [11.0, 71.0],
  [11.0, 70.0],
  [10.0, 70.0]
];

// ---------------------------------------------------------------------------
// Fake service builders
// ---------------------------------------------------------------------------

function makeNoaaFake(): NOAAService {
  return {
    getStations: vi.fn(async () => ({ features: [] })),
    getAlerts: vi.fn(async () => ({ updated: '2026-08-23T00:00:00Z', features: [] }))
  } as unknown as NOAAService;
}

function makeGeoMetFake(): GeoMetService {
  return { getAlerts: vi.fn(async () => []) } as unknown as GeoMetService;
}

function makeMeteoAlarmFake(): MeteoAlarmService {
  return { getWarnings: vi.fn(async () => []) } as unknown as MeteoAlarmService;
}

function makeNominatimFake(country: string | null): NominatimService {
  return { reverseCountry: vi.fn(async () => country) } as unknown as NominatimService;
}

function makeGoogleFake(keyAvailable = true): GoogleWeatherService {
  return {
    isKeyAvailable: vi.fn(() => keyAvailable),
    getPublicAlerts: vi.fn(async () => ({ alerts: [], covered: true }))
  } as unknown as GoogleWeatherService;
}

function makeNationalFake(
  result: Partial<NationalCapResult> = {},
  error?: Error
): NationalCapService {
  return {
    getWarnings: vi.fn(async () => {
      if (error) {
        throw error;
      }
      return {
        warnings: [],
        unavailableCount: 0,
        polygonUnavailableCount: 0,
        indexTrimmed: false,
        ...result
      } satisfies NationalCapResult;
    })
  } as unknown as NationalCapService;
}

const emptyStore = { get: vi.fn(() => undefined) } as unknown as LocationStore;
const emptyGeocoding = { search: vi.fn(async () => []) } as unknown as GeocodingService;

function warningFixture(overrides: Partial<NationalCapWarning> = {}): NationalCapWarning {
  return {
    identifier: 'IN-1',
    status: 'Actual',
    msgType: 'Alert',
    references: [],
    event: 'Heavy Rainfall Warning',
    severity: 'Severe',
    urgency: 'Expected',
    certainty: 'Likely',
    sent: '2026-08-23T06:00:00+05:30',
    expires: '2026-08-23T18:00:00+05:30',
    headline: 'Heavy rainfall expected over Delhi',
    description: 'Widespread heavy rain with isolated very heavy falls.',
    instruction: 'Avoid low-lying areas.',
    senderName: 'IMD Delhi',
    areaDesc: ['Delhi'],
    polygons: [RING_AROUND_DELHI],
    countryCode: 'in',
    ...overrides
  };
}

/** Run `handleGetAlerts` with all nine services wired. */
async function callAlerts(
  args: Record<string, unknown>,
  options: {
    country: string | null;
    national?: NationalCapService;
    google?: GoogleWeatherService;
    passNational?: boolean;
  }
): Promise<{ text: string; national: NationalCapService; google: GoogleWeatherService }> {
  const national = options.national ?? makeNationalFake();
  const google = options.google ?? makeGoogleFake();
  const result = await handleGetAlerts(
    args,
    makeNoaaFake(),
    emptyStore,
    emptyGeocoding,
    makeMeteoAlarmFake(),
    makeGeoMetFake(),
    makeNominatimFake(options.country),
    google,
    options.passNational === false ? undefined : national
  );
  return { text: result.content[0].text, national, google };
}

// ---------------------------------------------------------------------------
// Routing (D1)
// ---------------------------------------------------------------------------

describe('national CAP routing', () => {
  it.each([
    ['New Delhi', NEW_DELHI, 'in', 'India'],
    ['Manila', MANILA, 'ph', 'Philippines'],
    ['Jakarta', JAKARTA, 'id', 'Indonesia']
  ])('routes %s to the national CAP service, never Google', async (_name, coords, cc, country) => {
    const { text, national, google } = await callAlerts(coords, { country: cc });

    expect(national.getWarnings).toHaveBeenCalledWith(cc);
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
    expect(text).toContain(`# Weather Alerts — ${country}`);
  });

  it('routes to the national service even when a Google key is available', async () => {
    const { national, google } = await callAlerts(NEW_DELHI, {
      country: 'in',
      google: makeGoogleFake(true)
    });

    expect(national.getWarnings).toHaveBeenCalledWith('in');
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
  });

  it('routes an uppercase saved-location country_code without a reverse lookup', async () => {
    const store = {
      get: vi.fn(() => ({
        name: 'Home',
        latitude: NEW_DELHI.latitude,
        longitude: NEW_DELHI.longitude,
        country_code: 'IN'
      }))
    } as unknown as LocationStore;
    const national = makeNationalFake();
    const nominatim = makeNominatimFake(null);

    const result = await handleGetAlerts(
      { location_name: 'home' },
      makeNoaaFake(),
      store,
      emptyGeocoding,
      makeMeteoAlarmFake(),
      makeGeoMetFake(),
      nominatim,
      makeGoogleFake(),
      national
    );

    expect(national.getWarnings).toHaveBeenCalledWith('in');
    expect(nominatim.reverseCountry).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('# Weather Alerts — India');
  });

  it.each([
    ['the US', SEATTLE, 'us'],
    ['Canada', TORONTO, 'ca'],
    ['a MeteoAlarm country', BERLIN, 'de']
  ])('leaves %s routing untouched', async (_name, coords, cc) => {
    const { national } = await callAlerts(coords, { country: cc });
    expect(national.getWarnings).not.toHaveBeenCalled();
  });

  it('still reaches Google for a keyed elsewhere point', async () => {
    const google = makeGoogleFake(true);
    const { national } = await callAlerts(SYDNEY, { country: 'au', google });

    expect(google.getPublicAlerts).toHaveBeenCalled();
    expect(national.getWarnings).not.toHaveBeenCalled();
  });

  it('falls through to the not-covered message when no national service is passed', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      google: makeGoogleFake(false),
      passNational: false
    });

    expect(text).toContain('not yet available for India');
    expect(text).toContain('India (NDMA SACHET)');
    expect(text).toContain('the Philippines (PAGASA)');
    expect(text).toContain('Indonesia (BMKG)');
    // The keyless coverage sentence must never name Google.
    expect(text).not.toContain('Google');
  });
});

// ---------------------------------------------------------------------------
// Matching and rendering (D4, D8)
// ---------------------------------------------------------------------------

describe('national CAP matching', () => {
  it('renders a warning whose polygon contains the point', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({ warnings: [warningFixture()] })
    });

    expect(text).toContain('1 active warning matched to your location');
    expect(text).toContain('Heavy Rainfall Warning');
  });

  it('omits a warning whose polygon excludes the point', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [warningFixture({ polygons: [RING_ELSEWHERE] })]
      })
    });

    expect(text).not.toContain('Heavy Rainfall Warning');
    expect(text).toContain('✅ **No active weather alerts for your location in India.**');
    expect(text).toContain('1 active warning elsewhere in India, none covering this point');
  });

  it('keeps a warning with no geometry in the country-level block', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({ warnings: [warningFixture({ polygons: [] })] })
    });

    expect(text).toContain('**Country-level warnings**');
    expect(text).toContain('no usable area geometry for these alerts');
    expect(text).toContain('may not affect your exact location');
    expect(text).toContain('Heavy Rainfall Warning');
  });

  it('renders matched warnings before the country-level block', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [
          warningFixture({ identifier: 'IN-country', event: 'Country Level Event', polygons: [] }),
          warningFixture({ identifier: 'IN-matched', event: 'Matched Event' })
        ]
      })
    });

    expect(text.indexOf('Matched Event')).toBeLessThan(text.indexOf('Country Level Event'));
  });

  it('renders a trimmed-geometry warning at country level rather than dropping it', async () => {
    // A ring set over the cap is discarded wholesale, so the warning arrives
    // with no polygons — it must never read as "somewhere else".
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [
          warningFixture({
            polygons: [],
            polygonUnavailable: true,
            geometryTrimmed: true
          })
        ],
        polygonUnavailableCount: 1
      })
    });

    expect(text).toContain('**Country-level warnings**');
    expect(text).toContain('Heavy Rainfall Warning');
  });
});

// ---------------------------------------------------------------------------
// Geometry-lost disclosure (D6)
// ---------------------------------------------------------------------------

describe('geometry-lost disclosure', () => {
  it('discloses geometry that could not be loaded, above the country-level block', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [warningFixture({ polygons: [], polygonUnavailable: true })],
        polygonUnavailableCount: 1
      })
    });

    expect(text).toContain('Area geometry for 1 alert could not be loaded or parsed');
    expect(text.indexOf('could not be loaded or parsed')).toBeLessThan(
      text.indexOf('**Country-level warnings**')
    );
  });

  it('produces the same disclosure for an inline feed with unusable geometry', async () => {
    // No linkedPolygonUrl: the flattener itself marked the geometry unusable.
    const { text } = await callAlerts(JAKARTA, {
      country: 'id',
      national: makeNationalFake({
        warnings: [
          warningFixture({
            countryCode: 'id',
            polygons: [],
            polygonUnavailable: true
          })
        ],
        polygonUnavailableCount: 1
      })
    });

    expect(text).toContain('Area geometry for 1 alert could not be loaded or parsed');
  });

  it('omits the disclosure when no geometry was lost', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [warningFixture({ polygons: [] })],
        polygonUnavailableCount: 0
      })
    });

    expect(text).toContain('**Country-level warnings**');
    expect(text).not.toContain('could not be loaded or parsed');
  });

  it('omits the disclosure when the flagged warning is not in the country-level block', async () => {
    // The count is a gate; the number rendered is computed from the block
    // itself, so a flag on a warning that never reaches that block cannot
    // produce a line contradicting what is printed.
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [warningFixture({ polygons: [RING_AROUND_DELHI], polygonUnavailable: true })],
        polygonUnavailableCount: 1
      })
    });

    expect(text).not.toContain('could not be loaded or parsed');
  });

  it('keeps the geometry-lost count equal to the whole country-level block at every detail level', async () => {
    // Thirty is chosen so standard (cap 10) and full (cap 25) each land on a
    // distinct, unmistakable remainder count — a coincidence cannot hide a
    // scope slip back to the display-capped slice.
    const warnings = Array.from({ length: 30 }, (_unused, index) =>
      warningFixture({
        identifier: `IN-lost-${index}`,
        polygons: [],
        polygonUnavailable: true
      })
    );

    const standard = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({ warnings, polygonUnavailableCount: 30 })
    });
    const full = await callAlerts({ ...NEW_DELHI, detail: 'full' }, {
      country: 'in',
      national: makeNationalFake({ warnings, polygonUnavailableCount: 30 })
    });

    expect(standard.text).toContain('Area geometry for 30 alerts could not be loaded or parsed');
    expect(standard.text).toContain('…and 20 more warnings');
    expect(full.text).toContain('Area geometry for 30 alerts could not be loaded or parsed');
    expect(full.text).toContain('…and 5 more warnings');

    // The disclosure is a fact about the feed, not about the caller's
    // requested verbosity — it must read identically at both detail levels.
    const disclosureRegex = /\*Area geometry for \d+ alerts? could not be loaded or parsed[^\n]*\*/;
    const standardDisclosure = standard.text.match(disclosureRegex)?.[0];
    const fullDisclosure = full.text.match(disclosureRegex)?.[0];
    expect(standardDisclosure).toBeDefined();
    expect(standardDisclosure).toBe(fullDisclosure);
  });

  it('discloses geometry lost only in the remainder, above the country-level header', async () => {
    // Ten warnings that were simply never given geometry by the publisher
    // (no polygonUnavailable flag) rank Extreme and fill the standard cap
    // exactly; two that lost already-published geometry rank Minor and fall
    // into the remainder. The old count (over the shown slice) would have
    // been 0 here and rendered nothing — this is the case that proves the
    // guard now reads the whole block.
    const published = Array.from({ length: 10 }, (_unused, index) =>
      warningFixture({
        identifier: `IN-published-${index}`,
        polygons: [],
        severity: 'Extreme'
      })
    );
    const lost = Array.from({ length: 2 }, (_unused, index) =>
      warningFixture({
        identifier: `IN-lost-${index}`,
        polygons: [],
        polygonUnavailable: true,
        severity: 'Minor'
      })
    );

    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [...published, ...lost],
        polygonUnavailableCount: 2
      })
    });

    expect(text).toContain('Area geometry for 2 alerts could not be loaded or parsed');
    expect(text.indexOf('Area geometry for 2 alerts could not be loaded or parsed')).toBeLessThan(
      text.indexOf('**Country-level warnings**')
    );
  });
});

// ---------------------------------------------------------------------------
// Empty, partial, and nothing-loaded (D6)
// ---------------------------------------------------------------------------

describe('national CAP empty and partial states', () => {
  it('renders the honest empty with a nationwide scope line', async () => {
    const { text } = await callAlerts(NEW_DELHI, { country: 'in' });

    expect(text).toContain('✅ **No active weather alerts for your location in India.**');
    expect(text).toContain('no active warnings nationwide');
  });

  it('gives the country name its definite article in prose but not in the header', async () => {
    const { text } = await callAlerts(MANILA, { country: 'ph' });

    expect(text).toContain('# Weather Alerts — Philippines');
    expect(text).toContain('No active weather alerts for your location in the Philippines.');
    expect(text).not.toContain('in Philippines.');
  });

  it('uses the article in the elsewhere scope line too', async () => {
    const { text } = await callAlerts(MANILA, {
      country: 'ph',
      national: makeNationalFake({
        warnings: [
          warningFixture({ countryCode: 'ph', polygons: [RING_ELSEWHERE] })
        ]
      })
    });

    expect(text).toContain('1 active warning elsewhere in the Philippines, none covering this point');
  });

  it('renders ℹ️ and never ✅ when nothing could be loaded', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({ warnings: [], unavailableCount: 3 })
    });

    expect(text).toContain('ℹ️ **The NDMA SACHET alert list could not be loaded for your location.**');
    expect(text).toContain('3 alerts in the NDMA SACHET feed could not be loaded');
    expect(text).toContain('this is not an all-clear');
    expect(text).not.toContain('✅');
  });

  it('never renders ✅ on a partial load, even when everything loaded was elsewhere', async () => {
    // A green check needs the whole feed read. Alerts that could not be
    // loaded have unknown areas, so "no alerts for your location" would be an
    // all-clear the feed never supported.
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [warningFixture({ polygons: [RING_ELSEWHERE] })],
        unavailableCount: 2
      })
    });

    expect(text).toContain('2 alerts in the NDMA SACHET feed could not be loaded');
    expect(text).toContain('ℹ️ **No alert covering your location among those that could be read.**');
    expect(text).toContain('this is not a full all-clear');
    expect(text).not.toContain('✅');
  });

  it('renders ✅ only when the whole feed was read and nothing covers the point', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [warningFixture({ polygons: [RING_ELSEWHERE] })],
        unavailableCount: 0
      })
    });

    expect(text).toContain('✅ **No active weather alerts for your location in India.**');
    expect(text).toContain('1 active warning elsewhere in India, none covering this point');
  });

  it('lists a warning at country level when its ring set is incomplete and misses the point', async () => {
    // The rings that survived parsing exclude New Delhi, but a ring was
    // dropped — so the set cannot answer "this does not cover you". The
    // warning must be listed, never silently treated as elsewhere.
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [
          warningFixture({
            polygons: [RING_ELSEWHERE],
            polygonUnavailable: true,
            ringsDropped: 1
          })
        ],
        // The real service derives this over the returned view, so a warning
        // flagged polygonUnavailable always arrives with a non-zero count.
        polygonUnavailableCount: 1
      })
    });

    expect(text).not.toContain('✅');
    expect(text).toContain('**Country-level warnings**');
    expect(text).toContain('could not be loaded or parsed');
    expect(text).toContain('Heavy Rainfall Warning');
  });

  it('still matches a warning whose incomplete ring set contains the point', async () => {
    // Losing a ring must not cost precision in the safe direction: a point
    // inside a surviving ring is still a match, not a country-level listing.
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [
          warningFixture({
            polygons: [RING_AROUND_DELHI],
            polygonUnavailable: true,
            ringsDropped: 1
          })
        ]
      })
    });

    expect(text).toContain('1 active warning matched to your location');
    expect(text).not.toContain('**Country-level warnings**');
  });

  it('renders the index-trimmed caveat', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({ indexTrimmed: true })
    });

    expect(text).toContain('listed more than 200 alerts; only the first 200 were checked');
  });

  it('notes that history is unavailable when active_only is false', async () => {
    const { text } = await callAlerts({ ...NEW_DELHI, active_only: false }, { country: 'in' });

    expect(text).toContain('historical alerts are not available for this region');
  });
});

// ---------------------------------------------------------------------------
// Rendering detail (D8)
// ---------------------------------------------------------------------------

describe('national CAP rendering', () => {
  it('caps the combined list and adds the remainder note', async () => {
    const warnings = Array.from({ length: 14 }, (_unused, index) =>
      warningFixture({ identifier: `IN-${index}`, event: `Event ${index}`, severity: 'Minor' })
    );
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({ warnings })
    });

    expect(text).toContain('Event 0');
    expect(text).toContain('…and 4 more warnings, mostly Minor');
  });

  it('renders severity counts at detail="summary"', async () => {
    const { text } = await callAlerts({ ...NEW_DELHI, detail: 'summary' }, {
      country: 'in',
      national: makeNationalFake({
        warnings: [
          warningFixture({ identifier: 'IN-1', severity: 'Severe' }),
          warningFixture({ identifier: 'IN-2', severity: 'Minor', polygons: [] })
        ]
      })
    });

    expect(text).toContain('**Matched to your location:** Severe: 1');
    expect(text).toContain('**Country-level (no usable geometry):** Minor: 1');
    expect(text).toContain('Counts only at detail="summary"');
  });

  it('omits the severity/urgency/certainty line when all three are absent', async () => {
    const { text } = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({
        warnings: [
          warningFixture({ severity: undefined, urgency: undefined, certainty: undefined })
        ]
      })
    });

    expect(text).not.toContain('Unknown | **Urgency:** Unknown');
  });

  it('shows description and the info link only at detail="full"', async () => {
    const withWeb = warningFixture({ web: 'https://sachet.ndma.gov.in/alert/1' });

    const standard = await callAlerts(NEW_DELHI, {
      country: 'in',
      national: makeNationalFake({ warnings: [withWeb] })
    });
    expect(standard.text).not.toContain('**Description:**');
    expect(standard.text).not.toContain('**More info:**');
    // Instructions render at standard as well as full.
    expect(standard.text).toContain('**Instructions:**');

    const full = await callAlerts({ ...NEW_DELHI, detail: 'full' }, {
      country: 'in',
      national: makeNationalFake({ warnings: [withWeb] })
    });
    expect(full.text).toContain('**Description:**');
    expect(full.text).toContain('**More info:** https://sachet.ndma.gov.in/alert/1');
  });

  it.each([
    [
      'in',
      NEW_DELHI,
      'NDMA SACHET (National Disaster Management Authority, Government of India) — public domain'
    ],
    ['ph', MANILA, 'PAGASA-DOST, via its public CAP feed (CC BY 4.0)'],
    ['id', JAKARTA, 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)']
  ])('renders the exact %s attribution footer', async (cc, coords, attribution) => {
    const { text } = await callAlerts(coords, { country: cc });

    expect(text).toContain(
      `*Data source: ${attribution}; alerts shown unmodified as issued, times as published.*`
    );
  });

  it('prepends the resolved location line for a city_name request', async () => {
    const geocoding = {
      geocode: vi.fn(async () => [
        {
          display_name: 'New Delhi, Delhi, India',
          latitude: NEW_DELHI.latitude,
          longitude: NEW_DELHI.longitude,
          country_code: 'in'
        }
      ])
    } as unknown as GeocodingService;

    const result = await handleGetAlerts(
      { city_name: 'New Delhi' },
      makeNoaaFake(),
      emptyStore,
      geocoding,
      makeMeteoAlarmFake(),
      makeGeoMetFake(),
      makeNominatimFake('in'),
      makeGoogleFake(),
      makeNationalFake()
    );

    expect(result.content[0].text).toContain('**Location:**');
    expect(result.content[0].text).toContain('New Delhi, Delhi, India');
  });
});

// ---------------------------------------------------------------------------
// Failure posture (D9)
// ---------------------------------------------------------------------------

describe('national CAP failure posture', () => {
  it('propagates a service failure rather than rendering an all-clear', async () => {
    const national = makeNationalFake({}, new Error('NDMA SACHET alert feed server error (status 503)'));

    await expect(
      callAlerts(NEW_DELHI, { country: 'in', national })
    ).rejects.toThrow(/alert feed/);
  });
});
