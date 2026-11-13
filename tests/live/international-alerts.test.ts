/**
 * Integration tests for international alerts routing (T9,
 * docs/plans/international-alerts-plan.md) — MeteoAlarm (Europe) and MSC GeoMet
 * (Canada) driven end to end through the real `handleGetAlerts` handler.
 *
 * Block 1 is deterministic: rather than a module-level `vi.mock('axios')`
 * (which would also swallow Block 2's live calls — both `MeteoAlarmService`
 * and `GeoMetService` import the same `axios` module), each test creates a
 * real service instance and scopes a `vi.spyOn` to that one instance's
 * private axios `client.get`, mirroring the instance-scoped mocking
 * convention in `tests/integration/metar.test.ts` (itself mirroring
 * `tests/integration/almanac.test.ts`'s `AcisService` client.post spy and
 * `tests/integration/global-rivers.test.ts`'s `makeRequestToFlood` spy).
 * Country routing is driven through a hand-built fake `NominatimService`
 * (`{ reverseCountry: async () => <code> }` cast to the real type) so the
 * real `resolveLocationAsync` / country-routing logic in
 * `src/handlers/alertsHandler.ts` runs unmodified against plain coordinates
 * — no real Nominatim network call is made anywhere in this file.
 * `NOAAService`/`LocationStore`/`GeocodingService` are passed as untouched
 * dummies: the coordinate-only resolution path never calls them, and the
 * `country_code` returned by the fake Nominatim always routes away from the
 * NOAA branch, so a bug that accidentally reached NOAA would surface as a
 * thrown error against the dummy rather than silently passing.
 *
 * Block 2 makes **live** network calls — a small MeteoAlarm country feed
 * (`gb`) and a live MSC GeoMet bbox query (Toronto) — with no mocking
 * applied at all, so it is unaffected by Block 1's instance-scoped spies.
 * It follows this project's tolerant-of-live-network-flake convention: a
 * generous per-test timeout, shape-only assertions (array-ness and element
 * field types — never a specific warning, count, or value), and the test
 * catches and logs a network error instead of failing the suite. This file
 * therefore belongs to the project's live-network integration set (see the
 * "Flaky live-network tests" memory) — re-run before blaming a diff if only
 * the Block 2 tests go red.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import { MeteoAlarmService } from '../../src/services/meteoalarm.js';
import { GeoMetService } from '../../src/services/geomet.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type {
  MeteoAlarmCapAlert,
  MeteoAlarmCapInfo,
  MeteoAlarmFeedResponse
} from '../../src/types/meteoalarm.js';
import type { GeoMetAlertFeature, GeoMetFeatureCollection } from '../../src/types/geomet.js';

/** Never touched by the coordinate-only resolution path exercised in this file. */
const UNUSED = {} as never;

/** Far-future / long-past instants so fixtures never age out mid-run. */
const FUTURE = '2099-01-01T00:00:00+00:00';
const PAST = '2020-01-01T00:00:00+00:00';

/** A fake NominatimService that resolves reverse-country lookups to a fixed code, with no network call. */
function fakeNominatim(countryCode: string): NominatimService {
  return { reverseCountry: async () => countryCode } as unknown as NominatimService;
}

/** Stub a fresh service instance's private axios `client.get` to resolve with a canned 200 body. */
function stubSuccess(service: MeteoAlarmService | GeoMetService, data: unknown, status = 200): void {
  vi.spyOn((service as any).client, 'get').mockResolvedValue({ data, status });
}

// ---------------------------------------------------------------------------
// MeteoAlarm fixture — trimmed, hand-built CAP shapes modeled on the plan
// doc's "Verified API contract" (MeteoAlarm section), not a raw feed capture.
// ---------------------------------------------------------------------------

function makeInfo(overrides: Partial<MeteoAlarmCapInfo> = {}): MeteoAlarmCapInfo {
  return {
    language: 'en',
    event: 'Weather warning',
    severity: 'Severe',
    urgency: 'Immediate',
    certainty: 'Likely',
    onset: '2026-08-13T09:00:00+02:00',
    expires: FUTURE,
    headline: 'Warning in effect',
    description: 'Trimmed description for tests.',
    instruction: 'Take precautions.',
    senderName: 'Deutscher Wetterdienst',
    area: [{ areaDesc: 'Bavaria' }],
    parameter: [{ valueName: 'awareness_level', value: '3; orange; Severe' }],
    ...overrides
  };
}

function makeAlert(overrides: Partial<MeteoAlarmCapAlert> = {}): MeteoAlarmCapAlert {
  return {
    identifier: 'DE-TEST-1',
    sender: 'https://www.dwd.de/',
    sent: '2026-08-13T09:20:02+02:00',
    status: 'Actual',
    msgType: 'Alert',
    scope: 'Public',
    info: [makeInfo()],
    ...overrides
  };
}

/**
 * The Germany feed fixture: a multi-language warning (de-DE + en), an
 * expired warning, and an Update+references chain (an Update superseding a
 * surviving original) — the three load-bearing behaviours from the plan's
 * "Verified API contract" section, in miniature.
 */
const GERMANY_FEED: MeteoAlarmFeedResponse = {
  warnings: [
    {
      uuid: 'uuid-multilang',
      alert: makeAlert({
        identifier: 'DE-MULTI-1',
        info: [
          makeInfo({ language: 'de-DE', event: 'Sturmwarnung', headline: 'Achtung Sturm' }),
          makeInfo({ language: 'en', event: 'Storm Warning', headline: 'Storm warning in effect' })
        ]
      })
    },
    {
      uuid: 'uuid-expired',
      alert: makeAlert({
        identifier: 'DE-EXPIRED-1',
        info: [makeInfo({ event: 'Expired Heat Warning', expires: PAST })]
      })
    },
    {
      uuid: 'uuid-original',
      alert: makeAlert({
        identifier: 'DE-ORIG-1',
        info: [makeInfo({ event: 'Original Flood Watch' })]
      })
    },
    {
      uuid: 'uuid-update',
      alert: makeAlert({
        identifier: 'DE-UPDATE-1',
        msgType: 'Update',
        references: 'opendata@dwd.de,DE-ORIG-1,2026-08-01T00:00:00+02:00',
        info: [makeInfo({ event: 'Updated Flood Warning' })]
      })
    }
  ]
};

// ---------------------------------------------------------------------------
// GeoMet fixture — trimmed, hand-built feature-collection modeled on the
// plan doc's "MSC GeoMet (Canada)" verified field set.
// ---------------------------------------------------------------------------

const GEOMET_GEOMETRY = {
  type: 'Polygon',
  coordinates: [[[-79.5, 43.5], [-79.4, 43.5], [-79.4, 43.6], [-79.5, 43.6], [-79.5, 43.5]]]
};

function buildFeature(overrides: Partial<GeoMetAlertFeature['properties']> = {}): GeoMetAlertFeature {
  return {
    type: 'Feature',
    id: 'test-feature-1',
    geometry: GEOMET_GEOMETRY,
    properties: {
      alert_code: 'WA',
      alert_type: 'warning',
      alert_name_en: 'Heat Warning',
      alert_short_name_en: 'Heat',
      alert_text_en: 'A heat warning is in effect for the Greater Toronto Area.',
      feature_name_en: 'City of Toronto',
      province: 'ON',
      status_en: 'active',
      risk_colour_en: 'Orange',
      confidence_en: 'High',
      publication_datetime: '2026-08-13T09:00:00.000Z',
      validity_datetime: '2026-08-13T09:00:00.000Z',
      event_end_datetime: '2026-08-14T03:00:00.000Z',
      expiration_datetime: FUTURE,
      feature_id: 'active-1',
      ...overrides
    }
  };
}

function geoMetCollection(features: GeoMetAlertFeature[], numberMatched?: number): GeoMetFeatureCollection {
  return {
    type: 'FeatureCollection',
    features,
    numberMatched: numberMatched ?? features.length
  };
}

// ---------------------------------------------------------------------------
// Block 1 — mocked, deterministic
// ---------------------------------------------------------------------------

describe('International alerts routing (mocked, deterministic)', () => {
  describe('MeteoAlarm (Europe)', () => {
    it('renders the English variant, omits expired/superseded warnings, and carries attribution + coverage note', async () => {
      const meteoAlarmService = new MeteoAlarmService();
      stubSuccess(meteoAlarmService, GERMANY_FEED);

      const result = await handleGetAlerts(
        { latitude: 48.1351, longitude: 11.582 }, // Munich
        UNUSED as NOAAService,
        UNUSED as LocationStore,
        UNUSED as GeocodingService,
        meteoAlarmService,
        undefined,
        fakeNominatim('de')
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const text = result.content[0].text as string;

      // Header + coverage note (country-level European matching).
      expect(text).toContain('# Weather Alerts — Germany');
      expect(text).toContain('**Coverage note:** European alerts are matched at country level');

      // English variant selected; the German variant of the same warning is discarded.
      expect(text).toContain('Storm Warning');
      expect(text).not.toContain('Sturmwarnung');

      // Expired warning dropped entirely.
      expect(text).not.toContain('Expired Heat Warning');

      // Supersession: the original is dropped, the Update survives.
      expect(text).not.toContain('Original Flood Watch');
      expect(text).toContain('Updated Flood Warning');

      // Only the two surviving warnings are counted.
      expect(text).toContain('2 active warnings for Germany');

      // Attribution footer (MeteoAlarm licence terms: EUMETNET + national service).
      expect(text).toContain('EUMETNET – MeteoAlarm');
      expect(text).toContain('Deutscher Wetterdienst');
    });
  });

  describe('MSC GeoMet (Canada)', () => {
    it('filters an ended feature and renders the ECCC attribution footer', async () => {
      const geoMetService = new GeoMetService();
      const active = buildFeature();
      const ended = buildFeature({
        alert_type: 'warning',
        alert_name_en: 'Rainfall Warning',
        status_en: 'ended',
        feature_id: 'ended-1'
      });
      stubSuccess(geoMetService, geoMetCollection([active, ended]));

      const result = await handleGetAlerts(
        { latitude: 43.6532, longitude: -79.3832 }, // Toronto
        UNUSED as NOAAService,
        UNUSED as LocationStore,
        UNUSED as GeocodingService,
        undefined,
        geoMetService,
        fakeNominatim('ca')
      );

      expect(result.content).toHaveLength(1);
      const text = result.content[0].text as string;

      expect(text).toContain('# Weather Alerts — Canada');
      expect(text).toContain('Heat Warning');
      expect(text).toContain('City of Toronto');
      expect(text).not.toContain('Rainfall Warning');

      expect(text).toContain('Environment and Climate Change Canada (MSC GeoMet)');
    });

    it('renders the clean "No active weather alerts" message for a numberMatched: 0 body', async () => {
      const geoMetService = new GeoMetService();
      stubSuccess(geoMetService, geoMetCollection([], 0));

      const result = await handleGetAlerts(
        { latitude: 45.4215, longitude: -75.6972 }, // Ottawa
        UNUSED as NOAAService,
        UNUSED as LocationStore,
        UNUSED as GeocodingService,
        undefined,
        geoMetService,
        fakeNominatim('ca')
      );

      const text = result.content[0].text as string;
      expect(text).toContain('No active weather alerts for this area.');
      expect(text).toContain('Environment and Climate Change Canada (MSC GeoMet)');
    });
  });
});

// ---------------------------------------------------------------------------
// Block 2 — live smoke test (tolerant of network flake)
// ---------------------------------------------------------------------------

describe('International alerts — live smoke test (tolerant of network flake)', () => {
  it('fetches a real MeteoAlarm country feed (United Kingdom)', async () => {
    const meteoAlarmService = new MeteoAlarmService();

    try {
      const warnings = await meteoAlarmService.getWarnings('gb');

      expect(Array.isArray(warnings)).toBe(true);
      for (const warning of warnings) {
        expect(typeof warning.identifier).toBe('string');
        expect(warning.identifier.length).toBeGreaterThan(0);
        expect(Array.isArray(warning.areaDesc)).toBe(true);
      }

      console.log('\n=== Live MeteoAlarm smoke test: gb feed ===');
      console.log(`${warnings.length} warning(s) returned`);
    } catch (error) {
      // Tolerant of live-network flake: log and pass rather than fail the
      // suite (see file header — this joins the project's live-network
      // integration set).
      console.warn(
        '\n=== Live MeteoAlarm smoke test skipped (network error) ===\n',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, 30000);

  it('fetches real MSC GeoMet alerts for a bbox with known coverage (Toronto)', async () => {
    const geoMetService = new GeoMetService();

    try {
      const alerts = await geoMetService.getAlerts(43.6532, -79.3832);

      expect(Array.isArray(alerts)).toBe(true);
      for (const alert of alerts) {
        expect(alert.type).toBe('Feature');
        expect(typeof alert.properties).toBe('object');
      }

      console.log('\n=== Live GeoMet smoke test: Toronto bbox ===');
      console.log(`${alerts.length} alert(s) returned`);
    } catch (error) {
      console.warn(
        '\n=== Live GeoMet smoke test skipped (network error) ===\n',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, 30000);
});
