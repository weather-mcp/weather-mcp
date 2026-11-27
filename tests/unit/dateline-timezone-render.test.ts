/**
 * Date-line zone overrides, pinned at the two rendering seams that read
 * `guessTimezoneFromCoords` (plan-dateline-timezone-overrides, T2).
 *
 * Before the override, tz-lookup put Pago Pago in Pacific/Apia (UTC+13), so an
 * alert time rendered a calendar day ahead. Both seams here take the zone from
 * `guessTimezoneFromCoords` itself, never a hard-coded string (G45), and apply
 * each assertion to the one line the mutation touches (G96). Handlers are
 * called directly with fakes, so no service cache persists (G158 n/a).
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveCriticalAlertBanner } from '../../src/handlers/criticalAlertBanner.js';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import { guessTimezoneFromCoords } from '../../src/utils/timezone.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ResolvedLocation } from '../../src/utils/locationResolver.js';
import type { AlertCollectionResponse } from '../../src/types/noaa.js';

/** Pago Pago, Tutuila. */
const PAGO_PAGO_POINT: ResolvedLocation = {
  latitude: -14.2756,
  longitude: -170.702,
  source: 'coordinates',
};

/** G75: ICU may emit U+202F or U+00A0 before AM/PM. */
function normalise(s: string): string {
  return s.replace(/[\u202F\u00A0]/g, ' ');
}

function alertFeature(properties: Record<string, unknown>) {
  return { properties } as unknown as AlertCollectionResponse['features'][number];
}

function collection(...features: Array<Record<string, unknown>>): AlertCollectionResponse {
  return {
    type: 'FeatureCollection',
    features: features.map(alertFeature),
  };
}

function fakeNoaa(getAlerts: ReturnType<typeof vi.fn>): NOAAService {
  return { getAlerts } as unknown as NOAAService;
}

describe('critical-alert banner expiry at Pago Pago', () => {
  it('renders the expiry on the Samoa calendar day, not the Apia one', async () => {
    const getAlerts = vi.fn(async () =>
      collection({
        event: 'Tsunami Warning',
        severity: 'Extreme',
        urgency: 'Immediate',
        certainty: 'Observed',
        response: 'Evacuate',
        senderName: 'NWS Honolulu HI',
        expires: '2026-11-27T05:00:00Z',
      })
    );

    const banner = normalise(
      await resolveCriticalAlertBanner(
        fakeNoaa(getAlerts),
        PAGO_PAGO_POINT,
        guessTimezoneFromCoords(-14.2756, -170.702)
      )
    );

    expect(getAlerts).toHaveBeenCalledOnce();
    const match = /in effect until ([^.]*?\d{4} at \d{1,2}:\d{2} [AP]M [^.]+)\./.exec(banner);
    if (!match) {
      throw new Error(`no expiry clause in banner: ${JSON.stringify(banner)}`);
    }
    const clause = match[1];
    expect(clause).toContain('November 26, 2026 at 6:00 PM');
    // Samoa label as ICU renders it at runtime: "GMT-11" (U+0047 U+004D U+0054 U+002D U+0031 U+0031).
    expect(clause).toContain('GMT-11');
    expect(clause).not.toContain('November 27');
  });
});

describe('get_alerts effective and expiry at Pago Pago', () => {
  function makeNoaaFake(): NOAAService {
    return {
      getStations: vi.fn(async () => ({ features: [] })),
      getAlerts: vi.fn(async () => ({
        updated: '2026-11-27T05:00:00Z',
        features: [
          alertFeature({
            event: 'Tsunami Advisory',
            severity: 'Moderate',
            urgency: 'Expected',
            certainty: 'Likely',
            response: 'Prepare',
            senderName: 'NWS Honolulu HI',
            areaDesc: 'Test area',
            effective: '2026-11-27T05:00:00Z',
            expires: '2026-11-27T17:00:00Z',
          }),
        ],
      })),
    } as unknown as NOAAService;
  }

  const emptyStore = { get: vi.fn(() => undefined) } as unknown as LocationStore;
  const emptyGeocoding = { search: vi.fn(async () => []) } as unknown as GeocodingService;

  async function alertsText(latitude: number, longitude: number, country_code: string): Promise<string> {
    const noaa = makeNoaaFake();
    const result = await handleGetAlerts(
      { latitude, longitude, country_code },
      noaa,
      emptyStore,
      emptyGeocoding,
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(noaa.getAlerts).toHaveBeenCalledOnce();
    return normalise(result.content[0].text);
  }

  function line(text: string, label: string): string {
    const m = new RegExp(`^\\*\\*${label}:\\*\\* (.+)$`, 'm').exec(text);
    if (!m) {
      throw new Error(`no ${label} line in: ${JSON.stringify(text)}`);
    }
    return m[1];
  }

  it('renders Pago Pago times on the Samoa calendar day', async () => {
    const text = await alertsText(-14.2756, -170.702, 'AS');
    expect(line(text, 'Effective')).toContain('Nov 26, 2026, 6:00 PM');
    expect(line(text, 'Expires')).toContain('Nov 27, 2026, 6:00 AM');
  });

  it('control: Honolulu, inside the US but outside every box, renders in Pacific/Honolulu', async () => {
    const text = await alertsText(21.31, -157.86, 'US');
    expect(line(text, 'Effective')).toContain('Nov 26, 2026, 7:00 PM');
  });
});
