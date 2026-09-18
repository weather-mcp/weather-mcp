import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveCriticalAlertBanner } from '../../src/handlers/criticalAlertBanner.js';
import { logger } from '../../src/utils/logger.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { ResolvedLocation } from '../../src/utils/locationResolver.js';
import type { AlertCollectionResponse } from '../../src/types/noaa.js';

/**
 * Every test mocks at the `noaaService.getAlerts` seam with a plain fake object
 * — no HTTP, no network, per the bindings' determinism rule. G70 is the reason
 * the seam is named explicitly rather than spied onto a private method: a mock
 * on the wrong seam is inert, and the test silently becomes a live-network test
 * that passes while the network is fast. `getAlerts` is the only method this
 * module calls, so a fake carrying just that method is the whole surface.
 */

/** Grand Rapids, MI — inside the CONUS box, and the point that prompted the feature. */
const US_POINT: ResolvedLocation = {
  latitude: 42.9634,
  longitude: -85.6681,
  source: 'coordinates',
};

/** Tokyo — outside every US box, with no country_code to short-circuit on. */
const NON_US_POINT: ResolvedLocation = {
  latitude: 35.6762,
  longitude: 139.6503,
  source: 'coordinates',
};

function alertFeature(properties: Record<string, unknown>) {
  return { properties } as unknown as AlertCollectionResponse['features'][number];
}

function collection(...features: Array<Record<string, unknown>>): AlertCollectionResponse {
  return {
    type: 'FeatureCollection',
    features: features.map(alertFeature),
  };
}

const TORNADO_WARNING = {
  event: 'Tornado Warning',
  severity: 'Extreme',
  urgency: 'Immediate',
  certainty: 'Observed',
  response: 'Shelter',
  senderName: 'NWS Grand Rapids MI',
  expires: '2026-09-03T16:15:00-04:00',
};

const SEVERE_THUNDERSTORM_WARNING = {
  event: 'Severe Thunderstorm Warning',
  severity: 'Severe',
  urgency: 'Immediate',
  certainty: 'Observed',
  response: 'Shelter',
  senderName: 'NWS Grand Rapids MI',
  expires: '2026-09-03T15:45:00-04:00',
};

/** A fake carrying only the method under test, so an unexpected call throws rather than silently working. */
function fakeNoaa(getAlerts: ReturnType<typeof vi.fn>): NOAAService {
  return { getAlerts } as unknown as NOAAService;
}

describe('resolveCriticalAlertBanner', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the US pre-filter', () => {
    it('returns an empty string for a non-US point and never calls getAlerts', () => {
      // The strongest assertion in this file: the pre-filter must return
      // *before* any request, so a forecast for Tokyo pays nothing at all.
      const getAlerts = vi.fn();
      return resolveCriticalAlertBanner(fakeNoaa(getAlerts), NON_US_POINT, 'Asia/Tokyo').then(
        (banner) => {
          expect(banner).toBe('');
          expect(getAlerts).toHaveBeenCalledTimes(0);
        }
      );
    });

    it('returns an empty string for a non-US country_code even at US coordinates', () => {
      // country_code wins over the box. A saved location that knows it is in
      // Canada is not re-litigated against a bounding box that overlaps it.
      const getAlerts = vi.fn();
      return resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        { ...US_POINT, country_code: 'CA' },
        'America/Toronto'
      ).then((banner) => {
        expect(banner).toBe('');
        expect(getAlerts).toHaveBeenCalledTimes(0);
      });
    });

    it('reaches the fetch for country_code "US"', async () => {
      const getAlerts = vi.fn().mockResolvedValue(collection());
      await resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        { ...US_POINT, country_code: 'US' },
        'America/Detroit'
      );
      expect(getAlerts).toHaveBeenCalledTimes(1);
    });

    it('reaches the fetch for a lowercase country_code "us"', async () => {
      // Casing follows the upstream source — saved locations store "US",
      // geocoders vary — so the compare is case-insensitive.
      const getAlerts = vi.fn().mockResolvedValue(collection());
      await resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        { ...US_POINT, country_code: 'us' },
        'America/Detroit'
      );
      expect(getAlerts).toHaveBeenCalledTimes(1);
    });

    it('reaches the fetch for a US point with no country_code at all', async () => {
      const getAlerts = vi.fn().mockResolvedValue(collection());
      await resolveCriticalAlertBanner(fakeNoaa(getAlerts), US_POINT, 'America/Detroit');
      expect(getAlerts).toHaveBeenCalledTimes(1);
      expect(getAlerts).toHaveBeenCalledWith(42.9634, -85.6681, true);
    });
  });

  describe('the NWS-jurisdiction pre-filter — territories', () => {
    // The four NWS-served territories isInUS deliberately leaves out. NWS answers
    // 200 for an alerts point at every coordinate asserted reachable below (probed
    // live 2026-09-18; the table is in .devdocs/plan-nws-alert-jurisdiction.md) and
    // 400 `out of bounds` at every coordinate asserted unreachable.
    //
    // G48 — where these country_code values come from live. `US` is what Census
    // (geocoding.ts:150) and Nominatim (geocoding.ts:239) emit for ALL of these
    // places: OSM resolves every US territory to `US` at country zoom, so the
    // existing block's 'US'/'us' cases describe the common path. The ISO territory
    // codes below come from ONE provider only — the Open-Meteo geocoder
    // (geocoding.ts:334), last in both GeocodingService orders (:443, :447) and
    // reached only when the first two return nothing. A fixture code no resolver
    // emits would prove nothing; these are emitted, and this comment names by whom.

    /** Hagatna — the coordinates river-conditions-global.test.ts already uses. */
    const GUAM_POINT: ResolvedLocation = {
      latitude: 13.4443,
      longitude: 144.7937,
      source: 'coordinates',
    };
    /** Saipan — inside the CNMI southern arc NWS serves. */
    const SAIPAN_POINT: ResolvedLocation = {
      latitude: 15.185,
      longitude: 145.7467,
      source: 'coordinates',
    };
    /** St Croix — the coordinates river-conditions-global.test.ts already uses. */
    const ST_CROIX_POINT: ResolvedLocation = {
      latitude: 17.7333,
      longitude: -64.7833,
      source: 'coordinates',
    };
    /** Pago Pago, Tutuila. */
    const PAGO_PAGO_POINT: ResolvedLocation = {
      latitude: -14.2756,
      longitude: -170.702,
      source: 'coordinates',
    };
    /** Swains Island — American Samoa's separate northern pocket. */
    const SWAINS_POINT: ResolvedLocation = {
      latitude: -11.06,
      longitude: -171.08,
      source: 'coordinates',
    };
    /** Pagan — northern CNMI. NWS answers 400 here; the box excludes it on purpose. */
    const PAGAN_POINT: ResolvedLocation = {
      latitude: 18.1,
      longitude: 145.77,
      source: 'coordinates',
    };
    /** Pohnpei, FSM — sovereign COFA state, deliberately out of scope. */
    const POHNPEI_POINT: ResolvedLocation = {
      latitude: 6.92,
      longitude: 158.16,
      source: 'coordinates',
    };

    // --- R1: raw coordinates inside each box reach the fetch, exactly once ---

    it.each([
      ['Guam (Hagatna)', GUAM_POINT],
      ['CNMI (Saipan)', SAIPAN_POINT],
      ['USVI (St Croix)', ST_CROIX_POINT],
      ['American Samoa (Pago Pago)', PAGO_PAGO_POINT],
      ['American Samoa (Swains Island)', SWAINS_POINT],
    ])('reaches the fetch for raw coordinates in %s', async (_label, point) => {
      const getAlerts = vi.fn().mockResolvedValue(collection());
      const banner = await resolveCriticalAlertBanner(fakeNoaa(getAlerts), point);
      expect(banner).toBe('');
      expect(getAlerts).toHaveBeenCalledTimes(1);
      expect(getAlerts).toHaveBeenCalledWith(point.latitude, point.longitude, true);
    });

    // --- R2: the deliberate absences make no call at all ---
    //
    // Midway is NOT here on purpose. It sits inside isInUS's Hawaii box, so it
    // reaches the fetch today and a zero-call assertion would be red on the base
    // tree — locking a defect if it were inverted. That false positive is the
    // Toronto class and is deferred, not fixed here.

    it('makes no call for Pagan, northern CNMI — NWS answers 400 there', async () => {
      const getAlerts = vi.fn();
      const banner = await resolveCriticalAlertBanner(fakeNoaa(getAlerts), PAGAN_POINT);
      expect(banner).toBe('');
      expect(getAlerts).toHaveBeenCalledTimes(0);
    });

    it('makes no call for Pohnpei, FSM — sovereign COFA state, out of scope', async () => {
      const getAlerts = vi.fn();
      const banner = await resolveCriticalAlertBanner(fakeNoaa(getAlerts), POHNPEI_POINT);
      expect(banner).toBe('');
      expect(getAlerts).toHaveBeenCalledTimes(0);
    });

    // --- R3a: NWS_CODE_ALONE decides without geography ---
    //
    // Every case is spread onto NON_US_POINT (Tokyo), outside every box, so the
    // fetch can ONLY have been reached through the set. That isolation is the whole
    // reason the code branch exists — it is the arm that costs no geography — and
    // the 'PR' cases are what keep `pr` from being tidied into NWS_CODE_PLUS_BOX,
    // where it would evaluate false (Puerto Rico is in isInUS, not the territory
    // predicate) and drop the banner for every Open-Meteo-geocoded PR request.

    it.each(['US', 'us', 'PR', 'pr'])(
      'reaches the fetch for country_code "%s" at coordinates outside every box',
      async (code) => {
        const getAlerts = vi.fn().mockResolvedValue(collection());
        await resolveCriticalAlertBanner(fakeNoaa(getAlerts), {
          ...NON_US_POINT,
          country_code: code,
        });
        expect(getAlerts).toHaveBeenCalledTimes(1);
      }
    );

    // --- R3b: NWS_CODE_PLUS_BOX requires the box — a pair per code ---
    //
    // A green in-box case on its own cannot tell you whether the set or the box
    // admitted the point. The pair can: in-box reaches the fetch, the same code at
    // Tokyo does not. The Tokyo half is what keeps the set isolated from geography,
    // and together they are the conjunction's only direct proof.

    it.each([
      ['GU', GUAM_POINT],
      ['gu', GUAM_POINT],
      ['MP', SAIPAN_POINT],
      ['mp', SAIPAN_POINT],
      ['VI', ST_CROIX_POINT],
      ['vi', ST_CROIX_POINT],
      ['AS', PAGO_PAGO_POINT],
      ['as', PAGO_PAGO_POINT],
    ])('reaches the fetch for country_code "%s" at a coordinate inside its box', async (code, point) => {
      const getAlerts = vi.fn().mockResolvedValue(collection());
      await resolveCriticalAlertBanner(fakeNoaa(getAlerts), { ...point, country_code: code });
      expect(getAlerts).toHaveBeenCalledTimes(1);
    });

    it.each(['GU', 'gu', 'MP', 'mp', 'VI', 'vi', 'AS', 'as'])(
      'makes no call for country_code "%s" at coordinates outside every box',
      async (code) => {
        const getAlerts = vi.fn();
        const banner = await resolveCriticalAlertBanner(fakeNoaa(getAlerts), {
          ...NON_US_POINT,
          country_code: code,
        });
        expect(banner).toBe('');
        expect(getAlerts).toHaveBeenCalledTimes(0);
      }
    );

    // --- R4: the veto runs in both directions (G59 — the combination cells) ---

    it('makes no call for a Guam coordinate carrying country_code "CA" — the code vetoes the box', async () => {
      const getAlerts = vi.fn();
      const banner = await resolveCriticalAlertBanner(fakeNoaa(getAlerts), {
        ...GUAM_POINT,
        country_code: 'CA',
      });
      expect(banner).toBe('');
      expect(getAlerts).toHaveBeenCalledTimes(0);
    });

    it('makes no call for a Pohnpei coordinate carrying country_code "FM" — COFA, absent from both sets', async () => {
      const getAlerts = vi.fn();
      const banner = await resolveCriticalAlertBanner(fakeNoaa(getAlerts), {
        ...POHNPEI_POINT,
        country_code: 'FM',
      });
      expect(banner).toBe('');
      expect(getAlerts).toHaveBeenCalledTimes(0);
    });

    it('makes no call for a Pagan coordinate carrying country_code "MP" — the box vetoes the code', async () => {
      // The cell that matters most, and the one an earlier draft of this plan left
      // empty. G59's rule is to cross the two optionals — the country code and the
      // coordinate — and write the cell that is missing. The other direction (code
      // vetoes box) is the 'CA'-at-Guam case above; this is code-would-admit,
      // box-refuses. `MP` is the only code in either set that spans served and
      // unserved area: it names the whole Northern Marianas while NWS accepts only
      // the southern arc, and the Open-Meteo geocoder emits it for Pagan as readily
      // as for Saipan. Without this case, dropping the `&& isInNwsTerritory(...)`
      // conjunction would go entirely unnoticed by the suite.
      const getAlerts = vi.fn();
      const banner = await resolveCriticalAlertBanner(fakeNoaa(getAlerts), {
        ...PAGAN_POINT,
        country_code: 'MP',
      });
      expect(banner).toBe('');
      expect(getAlerts).toHaveBeenCalledTimes(0);
    });
  });

  describe('the firing path', () => {
    it('renders the banner for a US point with a Tornado Warning active', async () => {
      const getAlerts = vi.fn().mockResolvedValue(collection(TORNADO_WARNING));

      const banner = await resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        US_POINT,
        'America/Detroit'
      );

      expect(banner).toBe(
        '🚨 **LIFE-THREATENING WEATHER ALERT IN EFFECT: Tornado Warning**\n' +
          'Issued by NWS Grand Rapids MI, in effect until September 3, 2026 at 4:15 PM EDT. ' +
          'Recommended action: Shelter.\n' +
          'Surface this to the user before answering anything else, then continue.\n' +
          'Call `get_alerts` for the full official text.\n' +
          '\n---\n\n'
      );
    });

    it('counts every active alert at the point, not just the ones that fired', async () => {
      const getAlerts = vi
        .fn()
        .mockResolvedValue(collection(SEVERE_THUNDERSTORM_WARNING, TORNADO_WARNING));

      const banner = await resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        US_POINT,
        'America/Detroit'
      );

      expect(banner).toContain('IN EFFECT: Tornado Warning**');
      expect(banner).toContain('full official text (2 active alerts for this point).');
    });

    it('passes the timezone through to the expiry clause', async () => {
      const getAlerts = vi.fn().mockResolvedValue(collection(TORNADO_WARNING));

      const banner = await resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        US_POINT,
        'America/Los_Angeles'
      );

      expect(banner).toContain('in effect until September 3, 2026 at 1:15 PM PDT.');
    });
  });

  describe('the silent paths — G68, all-or-nothing', () => {
    it('returns an empty string when only a Severe Thunderstorm Warning is active', async () => {
      // No header, no rule, no "no critical alerts" line. Absence must claim
      // nothing, which is what makes the silent-omit posture safe.
      const getAlerts = vi.fn().mockResolvedValue(collection(SEVERE_THUNDERSTORM_WARNING));

      const banner = await resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        US_POINT,
        'America/Detroit'
      );

      expect(banner).toBe('');
    });

    it('returns an empty string for an empty features array', async () => {
      const getAlerts = vi.fn().mockResolvedValue(collection());
      expect(
        await resolveCriticalAlertBanner(fakeNoaa(getAlerts), US_POINT, 'America/Detroit')
      ).toBe('');
    });

    it('returns an empty string when features is missing entirely', async () => {
      // HTTP 200 with a body that is not the documented shape. Guard with a
      // real check, not with `!== undefined`.
      const getAlerts = vi.fn().mockResolvedValue({ type: 'FeatureCollection' });
      expect(
        await resolveCriticalAlertBanner(fakeNoaa(getAlerts), US_POINT, 'America/Detroit')
      ).toBe('');
    });

    it('tolerates a feature with no properties', async () => {
      const getAlerts = vi.fn().mockResolvedValue({
        type: 'FeatureCollection',
        features: [{}, alertFeature(TORNADO_WARNING)],
      });

      const banner = await resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        US_POINT,
        'America/Detroit'
      );

      expect(banner).toContain('IN EFFECT: Tornado Warning**');
    });
  });

  describe('the failure posture — D1', () => {
    it('returns an empty string, throws nothing, and logs exactly once when getAlerts rejects', async () => {
      const getAlerts = vi.fn().mockRejectedValue(new Error('NOAA API unavailable'));

      const banner = await resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        US_POINT,
        'America/Detroit'
      );

      expect(banner).toBe('');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ service: 'NOAA', securityEvent: true })
      );
    });

    it('makes exactly one request — no retries', async () => {
      // The banner is garnish and must add no latency on failure.
      const getAlerts = vi.fn().mockRejectedValue(new Error('NOAA API unavailable'));

      await resolveCriticalAlertBanner(fakeNoaa(getAlerts), US_POINT, 'America/Detroit');

      expect(getAlerts).toHaveBeenCalledTimes(1);
    });

    it('logs no URL and no raw axios error', async () => {
      // The title's second half used to outrun its assertions (MAJOR-1): the
      // warn carried `error.message`, and "Request failed with status code 503"
      // IS the raw axios message. Both halves are asserted now.
      const axiosShaped = Object.assign(
        new Error('Request failed with status code 503'),
        {
          config: { url: 'https://api.weather.gov/alerts/active?point=42.9634,-85.6681' },
          response: { status: 503 },
        }
      );
      const getAlerts = vi.fn().mockRejectedValue(axiosShaped);

      await resolveCriticalAlertBanner(fakeNoaa(getAlerts), US_POINT, 'America/Detroit');

      const logged = JSON.stringify(warnSpy.mock.calls);
      expect(logged).not.toContain('api.weather.gov');
      expect(logged).not.toContain('point=');
      expect(logged).not.toContain('Request failed with status code');
    });

    it('logs the status and the error type, so an outage is still diagnosable', () => {
      // The inverse half (G10): a warn that carried nothing at all would pass
      // every assertion above. Dropping the message must not leave the log
      // useless — a reader still has to tell a 404 from a 503.
      const axiosShaped = Object.assign(
        new Error('Request failed with status code 503'),
        { response: { status: 503 } }
      );
      const getAlerts = vi.fn().mockRejectedValue(axiosShaped);

      return resolveCriticalAlertBanner(fakeNoaa(getAlerts), US_POINT, 'America/Detroit').then(() => {
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const meta = warnSpy.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(meta.status).toBe(503);
        expect(meta.errorType).toBe('Error');
        expect(meta.securityEvent).toBe(true);
      });
    });

    it('renders no note of any kind on failure', async () => {
      // D1 rejected a "⚠️ Could not check alerts" line explicitly: repeated
      // benign warnings during an outage train readers to ignore the slot.
      const getAlerts = vi.fn().mockRejectedValue(new Error('boom'));

      const banner = await resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        US_POINT,
        'America/Detroit'
      );

      expect(banner).toBe('');
      expect(banner).not.toContain('Could not');
      expect(banner).not.toContain('unavailable');
    });
  });

  describe('no new cache surface', () => {
    it('calls getAlerts with activeOnly true, reusing the existing key and TTL', async () => {
      // F5 stays untripped by construction: this module introduces no cache key
      // and no TTL of its own, so a banner fetch and a real get_alerts call
      // within five minutes share one request.
      const getAlerts = vi.fn().mockResolvedValue(collection(TORNADO_WARNING));

      await resolveCriticalAlertBanner(fakeNoaa(getAlerts), US_POINT, 'America/Detroit');

      expect(getAlerts).toHaveBeenCalledWith(42.9634, -85.6681, true);
    });
  });
});
