/**
 * Unit tests for the optional keyed Google Weather API alerts fallback
 * (global-alerts-fallback feature, T3).
 *
 * Exercises handleGetAlerts with plain fake services (no HTTP, no live calls)
 * to prove:
 *   - D1 routing: the Google branch is reached **only** from the elsewhere
 *     branch, and only when a key is available; the US, Canada, and
 *     MeteoAlarm countries never contact Google
 *   - the keyless path is byte-identical to the pre-fallback output
 *   - D5 rendering: severity sort, emoji, detail caps, the two-layer
 *     mandatory attribution, times in the alert's own offset
 *   - D6 failure posture: honest-empty with the coverage caveat, and errors
 *     that propagate rather than degrading to a fabricated all-clear
 *
 * See docs/global-alerts-fallback-plan.md D1, D5, D6.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import { GoogleWeatherKeyRejectedError } from '../../src/services/googleWeather.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { MeteoAlarmService } from '../../src/services/meteoalarm.js';
import type { GeoMetService } from '../../src/services/geomet.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { GoogleWeatherService } from '../../src/services/googleWeather.js';
import type { GoogleWeatherAlert } from '../../src/types/googleWeather.js';

// ---------------------------------------------------------------------------
// Fixture coordinates
// ---------------------------------------------------------------------------

/** Outside the CONUS box and not a MeteoAlarm member — the elsewhere branch. */
const SYDNEY = { latitude: -33.87, longitude: 151.21 };
/** Genuinely US. */
const SEATTLE = { latitude: 47.6, longitude: -122.3 };
/** Inside the deliberately sloppy CONUS box, but actually Canada. */
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
/** MeteoAlarm member country. */
const BERLIN = { latitude: 52.52, longitude: 13.405 };

// ---------------------------------------------------------------------------
// Fake service builders
// ---------------------------------------------------------------------------

function makeNoaaFake(): NOAAService {
  return {
    getStations: vi.fn(async () => ({ features: [] })),
    getAlerts: vi.fn(async () => ({ updated: '2026-08-18T00:00:00Z', features: [] }))
  } as unknown as NOAAService;
}

function makeGeoMetFake(): GeoMetService {
  return {
    getAlerts: vi.fn(async () => [])
  } as unknown as GeoMetService;
}

function makeMeteoAlarmFake(): MeteoAlarmService {
  return {
    getWarnings: vi.fn(async () => [])
  } as unknown as MeteoAlarmService;
}

function makeNominatimFake(country: string | null): NominatimService {
  return {
    reverseCountry: vi.fn(async () => country)
  } as unknown as NominatimService;
}

interface GoogleFakeOptions {
  keyAvailable?: boolean;
  alerts?: GoogleWeatherAlert[];
  /**
   * Whether Google serves this location at all. `false` models the HTTP 404
   * `NOT_FOUND` answer, which returns no alerts for a completely different
   * reason than a quiet covered region. Defaults to covered.
   */
  covered?: boolean;
  error?: Error;
}

function makeGoogleFake(options: GoogleFakeOptions = {}): GoogleWeatherService {
  const { keyAvailable = true, alerts = [], covered = true, error } = options;
  return {
    isKeyAvailable: vi.fn(() => keyAvailable),
    getPublicAlerts: vi.fn(async () => {
      if (error) {
        throw error;
      }
      return { alerts, covered };
    })
  } as unknown as GoogleWeatherService;
}

const emptyStore = {
  get: vi.fn(() => undefined)
} as unknown as LocationStore;

const emptyGeocoding = {
  search: vi.fn(async () => [])
} as unknown as GeocodingService;

// ---------------------------------------------------------------------------
// Alert fixtures
// ---------------------------------------------------------------------------

function alertFixture(overrides: Partial<GoogleWeatherAlert> = {}): GoogleWeatherAlert {
  return {
    alertId: 'a1',
    alertTitle: { text: 'Severe Thunderstorm Warning', languageCode: 'en' },
    eventType: 'SEVERE_THUNDERSTORM',
    areaName: 'Greater Sydney',
    description: 'Damaging winds and large hail expected.',
    // SCREAMING_CASE, as the live API publishes them (T6).
    severity: 'SEVERE',
    urgency: 'IMMEDIATE',
    certainty: 'LIKELY',
    instruction: ['Move vehicles under cover.'],
    safetyRecommendations: [{ directive: 'Stay indoors.' }],
    startTime: '2026-08-18T02:00:00Z',
    expirationTime: '2026-08-18T08:00:00Z',
    // Seconds duration, as the live API publishes it (T6): +10:00.
    timezoneOffset: '36000s',
    dataSource: {
      publisher: 'AUSTRALIA_BOM',
      name: 'Australian Bureau of Meteorology',
      authorityUri: 'https://www.bom.gov.au'
    },
    ...overrides
  };
}

/** The exact mandatory attribution string (Weather API policies, layer 1). */
const MANDATORY_ATTRIBUTION = 'Source: Includes weather data from Google';

// ---------------------------------------------------------------------------
// Routing (D1)
// ---------------------------------------------------------------------------

describe('get_alerts — Google Weather fallback routing (D1)', () => {
  it('a non-covered country with a key routes to the Google renderer', async () => {
    const google = makeGoogleFake({ alerts: [alertFixture()] });

    const result = await handleGetAlerts(
      SYDNEY, makeNoaaFake(), emptyStore, emptyGeocoding,
      makeMeteoAlarmFake(), makeGeoMetFake(), makeNominatimFake('au'), google
    );

    const text = result.content[0].text;
    expect(google.getPublicAlerts).toHaveBeenCalledWith(SYDNEY.latitude, SYDNEY.longitude);
    expect(text).toContain('Weather Alerts — Australia');
    expect(text).toContain(MANDATORY_ATTRIBUTION);
  });

  it('a non-covered country with an unavailable key renders the not-covered message and never calls Google', async () => {
    const google = makeGoogleFake({ keyAvailable: false });

    const result = await handleGetAlerts(
      SYDNEY, makeNoaaFake(), emptyStore, emptyGeocoding,
      makeMeteoAlarmFake(), makeGeoMetFake(), makeNominatimFake('au'), google
    );

    const text = result.content[0].text;
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
    expect(text).toContain('not yet available');
    expect(text).not.toContain('Google');
  });

  it('with no 8th argument the output is strictly identical to the keyless not-covered output', async () => {
    const keyless = await handleGetAlerts(
      SYDNEY, makeNoaaFake(), emptyStore, emptyGeocoding,
      makeMeteoAlarmFake(), makeGeoMetFake(), makeNominatimFake('au')
    );
    const withUnavailableKey = await handleGetAlerts(
      SYDNEY, makeNoaaFake(), emptyStore, emptyGeocoding,
      makeMeteoAlarmFake(), makeGeoMetFake(), makeNominatimFake('au'),
      makeGoogleFake({ keyAvailable: false })
    );

    expect(withUnavailableKey.content[0].text).toBe(keyless.content[0].text);
  });

  it('a US point with a key routes to NOAA and never calls Google', async () => {
    const google = makeGoogleFake({ alerts: [alertFixture()] });
    const noaa = makeNoaaFake();

    const result = await handleGetAlerts(
      SEATTLE, noaa, emptyStore, emptyGeocoding,
      makeMeteoAlarmFake(), makeGeoMetFake(), makeNominatimFake('us'), google
    );

    expect(noaa.getAlerts).toHaveBeenCalled();
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain(MANDATORY_ATTRIBUTION);
  });

  it('a MeteoAlarm country with a key routes to MeteoAlarm and never calls Google', async () => {
    const google = makeGoogleFake({ alerts: [alertFixture()] });
    const meteoAlarm = makeMeteoAlarmFake();

    const result = await handleGetAlerts(
      BERLIN, makeNoaaFake(), emptyStore, emptyGeocoding,
      meteoAlarm, makeGeoMetFake(), makeNominatimFake('de'), google
    );

    expect(meteoAlarm.getWarnings).toHaveBeenCalledWith('de');
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain(MANDATORY_ATTRIBUTION);
  });

  it('a Canadian point inside the CONUS box with a key routes to GeoMet and never calls Google', async () => {
    const google = makeGoogleFake({ alerts: [alertFixture()] });
    const geoMet = makeGeoMetFake();

    const result = await handleGetAlerts(
      TORONTO, makeNoaaFake(), emptyStore, emptyGeocoding,
      makeMeteoAlarmFake(), geoMet, makeNominatimFake('ca'), google
    );

    expect(geoMet.getAlerts).toHaveBeenCalled();
    expect(google.getPublicAlerts).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('Weather Alerts — Canada');
  });

  it('an unresolved country (open ocean) with a key still reaches Google, with a generic header', async () => {
    const google = makeGoogleFake({ alerts: [] });

    const result = await handleGetAlerts(
      { latitude: -20, longitude: -140 }, makeNoaaFake(), emptyStore, emptyGeocoding,
      makeMeteoAlarmFake(), makeGeoMetFake(), makeNominatimFake(null), google
    );

    const text = result.content[0].text;
    expect(google.getPublicAlerts).toHaveBeenCalled();
    expect(text).toContain('# Weather Alerts\n');
    expect(text).not.toContain('Weather Alerts —');
  });

  it('a failed reverse lookup still renders its one-line note on the Google path', async () => {
    const nominatim = {
      reverseCountry: vi.fn(async () => {
        throw new Error('nominatim down');
      })
    } as unknown as NominatimService;

    const result = await handleGetAlerts(
      SYDNEY, makeNoaaFake(), emptyStore, emptyGeocoding,
      makeMeteoAlarmFake(), makeGeoMetFake(), nominatim, makeGoogleFake({ alerts: [] })
    );

    expect(result.content[0].text).toContain('country lookup service was unavailable');
  });
});

// ---------------------------------------------------------------------------
// Rendering (D5)
// ---------------------------------------------------------------------------

describe('get_alerts — Google Weather renderer (D5)', () => {
  async function render(
    alerts: GoogleWeatherAlert[],
    args: Record<string, unknown> = {}
  ): Promise<string> {
    const result = await handleGetAlerts(
      { ...SYDNEY, ...args }, makeNoaaFake(), emptyStore, emptyGeocoding,
      makeMeteoAlarmFake(), makeGeoMetFake(), makeNominatimFake('au'),
      makeGoogleFake({ alerts })
    );
    return result.content[0].text;
  }

  it('sorts by CAP severity and marks each alert with its severity emoji', async () => {
    const text = await render([
      alertFixture({ alertId: 'minor', alertTitle: 'Minor Flood Advisory', severity: 'MINOR' }),
      alertFixture({ alertId: 'extreme', alertTitle: 'Tsunami Warning', severity: 'EXTREME' }),
      alertFixture({ alertId: 'moderate', alertTitle: 'Wind Advisory', severity: 'MODERATE' })
    ]);

    expect(text.indexOf('Tsunami Warning')).toBeLessThan(text.indexOf('Wind Advisory'));
    expect(text.indexOf('Wind Advisory')).toBeLessThan(text.indexOf('Minor Flood Advisory'));
    expect(text).toContain('🔴 **Tsunami Warning**');
    expect(text).toContain('🟡 **Wind Advisory**');
    expect(text).toContain('🔵 **Minor Flood Advisory**');
  });

  it('caps standard detail at 10 alerts and adds the remainder note', async () => {
    const alerts = Array.from({ length: 14 }, (_, i) =>
      alertFixture({ alertId: `a${i}`, alertTitle: `Alert ${i}`, severity: 'MINOR' })
    );

    const text = await render(alerts);

    expect(text).toContain('Alert 9');
    expect(text).not.toContain('Alert 10');
    expect(text).toContain('…and 4 more alerts, mostly Minor');
  });

  it('caps full detail at 25 alerts and adds the remainder note', async () => {
    const alerts = Array.from({ length: 28 }, (_, i) =>
      alertFixture({ alertId: `a${i}`, alertTitle: `Alert ${i}`, severity: 'MINOR' })
    );

    const text = await render(alerts, { detail: 'full' });

    expect(text).toContain('Alert 24');
    expect(text).not.toContain('**Alert 25**');
    expect(text).toContain('…and 3 more alerts, mostly Minor');
  });

  it('renders counts only at detail="summary"', async () => {
    const text = await render(
      [
        alertFixture({ severity: 'SEVERE' }),
        alertFixture({ alertId: 'a2', severity: 'MINOR', eventType: 'FLOOD' })
      ],
      { detail: 'summary' }
    );

    expect(text).toContain('**By severity:** Severe: 1 | Minor: 1');
    expect(text).toContain('Counts only at detail="summary"');
    expect(text).not.toContain('Damaging winds');
    expect(text).not.toContain('**Area:**');
  });

  it('renders times in the alert\'s own timezone offset', async () => {
    const text = await render([alertFixture()]);

    // 02:00Z at +10:00 is 12:00 local; 08:00Z is 18:00 local.
    expect(text).toContain('**Effective:** 2026-08-18 12:00 (+10:00)');
    expect(text).toContain('**Expires:** 2026-08-18 18:00 (+10:00)');
  });

  it('falls back to the published instant when timezoneOffset is absent', async () => {
    const text = await render([alertFixture({ timezoneOffset: undefined })]);

    expect(text).toContain('**Effective:** 2026-08-18 02:00 (UTC)');
  });

  it('omits the Expires line when expirationTime is null', async () => {
    const text = await render([alertFixture({ expirationTime: null })]);

    expect(text).toContain('**Effective:**');
    expect(text).not.toContain('**Expires:**');
  });

  it('renders the per-alert dataSource attribution line (layer 2)', async () => {
    const text = await render([alertFixture()]);

    expect(text).toContain('**Source:** Australian Bureau of Meteorology (https://www.bom.gov.au)');
  });

  it('falls back to a humanized eventType when alertTitle is missing', async () => {
    const text = await render([alertFixture({ alertTitle: undefined, eventType: 'FLASH_FLOOD' })]);

    expect(text).toContain('**Flash Flood**');
  });

  it('falls back to "Weather alert" when both alertTitle and eventType are missing', async () => {
    const text = await render([alertFixture({ alertTitle: undefined, eventType: undefined })]);

    expect(text).toContain('**Weather alert**');
  });

  it('omits the event-type suffix when the title already says it, and keeps it otherwise', async () => {
    const redundant = await render([
      alertFixture({ alertTitle: 'Severe Thunderstorm Warning', eventType: 'SEVERE_THUNDERSTORM' })
    ]);
    const informative = await render([
      alertFixture({ alertTitle: 'Coastal Hazard Advice', eventType: 'HIGH_WIND' })
    ]);

    expect(redundant).toContain('**Severe Thunderstorm Warning**\n');
    expect(redundant).not.toContain('(Severe Thunderstorm)');
    expect(informative).toContain('**Coastal Hazard Advice** (High Wind)');
  });

  it('accepts an object-shaped alertTitle', async () => {
    const text = await render([
      alertFixture({ alertTitle: { text: 'Cyclone Warning', languageCode: 'en' } })
    ]);

    expect(text).toContain('**Cyclone Warning**');
  });

  it('shows the description only at detail="full"', async () => {
    const standard = await render([alertFixture()]);
    const full = await render([alertFixture()], { detail: 'full' });

    expect(standard).not.toContain('Damaging winds and large hail expected.');
    expect(full).toContain('Damaging winds and large hail expected.');
  });

  it('shows instructions at standard and safety recommendations only at full', async () => {
    const standard = await render([alertFixture()]);
    const full = await render([alertFixture()], { detail: 'full' });

    expect(standard).toContain('Move vehicles under cover.');
    expect(standard).not.toContain('Stay indoors.');
    expect(full).toContain('Stay indoors.');
  });

  it('omits instruction and safety lines when the arrays are empty', async () => {
    const text = await render(
      [alertFixture({ instruction: [], safetyRecommendations: [] })],
      { detail: 'full' }
    );

    expect(text).not.toContain('**Instructions:**');
    expect(text).not.toContain('**Safety recommendations:**');
  });

  // ---- Live-verified shape locks (T6) --------------------------------------

  it('normalizes SCREAMING_CASE CAP enums to the project title-case form', async () => {
    const text = await render([alertFixture()]);

    expect(text).toContain('**Severity:** Severe | **Urgency:** Immediate | **Certainty:** Likely');
    expect(text).not.toContain('SEVERE');
    expect(text).not.toContain('IMMEDIATE');
  });

  it('ranks and colours by the normalized severity, not the raw enum', async () => {
    // Regression: raw "EXTREME" misses CAP_SEVERITY_ORDER, which would rank
    // every alert Unknown and mark every one ⚪.
    const text = await render([alertFixture({ severity: 'EXTREME' })]);

    expect(text).toContain('🔴 **Severe Thunderstorm Warning**');
  });

  it('omits the CAP line entirely when the publisher supplies none of the three fields', async () => {
    const text = await render([
      alertFixture({ severity: undefined, urgency: undefined, certainty: undefined })
    ]);

    expect(text).not.toContain('**Severity:**');
    expect(text).toContain('**Area:** Greater Sydney');
  });

  it('parses timezoneOffset as a seconds duration', async () => {
    // "36000s" is +10:00, so 02:00Z renders as 12:00 local.
    const text = await render([alertFixture()]);

    expect(text).toContain('**Effective:** 2026-08-18 12:00 (+10:00)');
    expect(text).toContain('**Expires:** 2026-08-18 18:00 (+10:00)');
  });

  it('parses a negative seconds offset', async () => {
    // -18000s is -05:00, so 02:00Z renders as 21:00 the previous day.
    const text = await render([alertFixture({ timezoneOffset: '-18000s' })]);

    expect(text).toContain('**Effective:** 2026-08-17 21:00 (-05:00)');
  });

  it('still accepts a ±HH:MM offset defensively', async () => {
    const text = await render([alertFixture({ timezoneOffset: '+05:30' })]);

    expect(text).toContain('**Effective:** 2026-08-18 07:30 (+05:30)');
  });

  it('renders object-shaped safety recommendations, including subtext', async () => {
    const text = await render(
      [
        alertFixture({
          safetyRecommendations: [
            { directive: 'Turn on your TV/radio.', subtext: 'Listen for the latest updates.' },
            { directive: 'Stay indoors.' }
          ]
        })
      ],
      { detail: 'full' }
    );

    expect(text).toContain('- Turn on your TV/radio. Listen for the latest updates.');
    expect(text).toContain('- Stay indoors.');
  });

  it('drops safety recommendation entries carrying neither directive nor subtext', async () => {
    const text = await render(
      [alertFixture({ safetyRecommendations: [{}, { directive: 'Stay indoors.' }] })],
      { detail: 'full' }
    );

    expect(text).toContain('- Stay indoors.');
    expect(text).not.toContain('- undefined');
  });

  it('attributes to dataSource.name, falling back to publisher', async () => {
    const named = await render([alertFixture()]);
    const enumOnly = await render([
      alertFixture({
        dataSource: { publisher: 'PHILIPPINES_PAGASA', authorityUri: 'http://example.org' }
      })
    ]);

    expect(named).toContain('**Source:** Australian Bureau of Meteorology (https://www.bom.gov.au)');
    expect(enumOnly).toContain('**Source:** PHILIPPINES_PAGASA (http://example.org)');
  });

  it('renders an alert that omits times entirely', async () => {
    const text = await render([
      alertFixture({ startTime: undefined, expirationTime: undefined, timezoneOffset: undefined })
    ]);

    expect(text).not.toContain('**Effective:**');
    expect(text).not.toContain('**Expires:**');
    expect(text).toContain('**Severe Thunderstorm Warning**');
  });

  it('renders the coverage caveat on both empty and non-empty results', async () => {
    const nonEmpty = await render([alertFixture()]);
    const empty = await render([]);

    expect(nonEmpty).toContain('coverage alignment may not be exact');
    expect(empty).toContain('coverage alignment may not be exact');
  });

  it('adds the historical-not-available note when active_only is false', async () => {
    const text = await render([alertFixture()], { active_only: false });

    expect(text).toContain('historical alerts are not available for this region');
  });
});

// ---------------------------------------------------------------------------
// Failure posture (D6) — contract, not garnish
// ---------------------------------------------------------------------------

describe('get_alerts — Google Weather failure posture (D6)', () => {
  function callSydney(google: GoogleWeatherService) {
    return handleGetAlerts(
      SYDNEY, makeNoaaFake(), emptyStore, emptyGeocoding,
      makeMeteoAlarmFake(), makeGeoMetFake(), makeNominatimFake('au'), google
    );
  }

  it('an empty result renders the honest-empty message plus the caveat, never a bare all-clear', async () => {
    const result = await callSydney(makeGoogleFake({ alerts: [] }));
    const text = result.content[0].text;

    expect(text).toContain('No active weather alerts found for this location via the Google Weather API');
    expect(text).toContain('rather than a guarantee that this location is covered');
    expect(text).toContain(MANDATORY_ATTRIBUTION);
  });

  it('an uncovered region is not rendered as an all-clear', async () => {
    // The two empty answers mean opposite things. Live testing found Google
    // 404s for India, Kenya, Hong Kong and the open ocean while answering 200
    // for Australia and Japan — so an uncovered point must never borrow the
    // covered point's ✅.
    const result = await callSydney(makeGoogleFake({ alerts: [], covered: false }));
    const text = result.content[0].text;

    expect(text).toContain('No alert coverage for this location');
    expect(text).toContain('this is not an all-clear');
    expect(text).not.toContain('✅');
    expect(text).not.toContain('No active weather alerts found');
  });

  it('an uncovered region swaps in the uncovered caveat, not the covered one', async () => {
    const result = await callSydney(makeGoogleFake({ alerts: [], covered: false }));
    const text = result.content[0].text;

    expect(text).toContain('falls outside that aggregation');
    // The covered caveat's closing clause describes a search that happened;
    // here nothing was searched, so it must not appear.
    expect(text).not.toContain('rather than a guarantee that this location is covered');
    // Attribution is still mandatory — Google was contacted either way.
    expect(text).toContain(MANDATORY_ATTRIBUTION);
  });

  it('a covered-but-quiet region keeps the all-clear untouched', async () => {
    // Guards the other direction: the fix must not have made every empty
    // result read as uncovered.
    const covered = (await callSydney(makeGoogleFake({ alerts: [], covered: true }))).content[0].text;

    expect(covered).toContain('✅');
    expect(covered).toContain('No active weather alerts found for this location via the Google Weather API');
    expect(covered).not.toContain('No alert coverage for this location');
    expect(covered).not.toContain('falls outside that aggregation');
  });

  it('a rejected key propagates with its fixed sanitized message — no silent degrade', async () => {
    const google = makeGoogleFake({ error: new GoogleWeatherKeyRejectedError() });

    await expect(callSydney(google)).rejects.toThrow(GoogleWeatherKeyRejectedError);
    await expect(callSydney(google)).rejects.toThrow(/GOOGLE_WEATHER_API_KEY/);
  });

  it('a generic service error propagates rather than producing a fabricated all-clear', async () => {
    const google = makeGoogleFake({
      error: new Error('Google Weather API quota exceeded. Please try again later.')
    });

    await expect(callSydney(google)).rejects.toThrow('Google Weather API quota exceeded');
  });
});
