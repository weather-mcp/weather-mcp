/**
 * Unit tests for the `detail` gating on the "…and N more…" remainder line
 * (T2 of the remainder-note-detail plan; see T1's `remainderNote` and the
 * `handleGeoMetAlerts` inline copy in `src/handlers/alertsHandler.ts`).
 *
 * Exercises `handleGetAlerts` with plain fake services (no HTTP, no live
 * calls) to prove, for each of the four renderers that reach a remainder
 * line — MeteoAlarm (Europe), national CAP (India/Philippines/Indonesia),
 * Google (keyed global fallback), and GeoMet (Canada, its own inline copy):
 *
 *   - at detail="full" the remainder line never contains the
 *     `Use detail="full" to see more.` hint (there is nowhere further to go);
 *   - at detail="standard" the remainder line is byte-identical to what it
 *     rendered before the gating change — severity mix (where the renderer
 *     has one) and pluralisation included;
 *   - at detail="full" the count (and severity mix, where present) still
 *     renders — the line was truncated after the hint, not mangled.
 *
 * The four per-renderer fixtures use 26 uniform-severity items so every
 * renderer's standard cap (10) and full cap (25) are exercised together:
 * standard leaves a 16-item remainder, full a 1-item remainder (letting the
 * pluralisation branch flip too).
 *
 * A uniform severity makes the `mostly <severity>` computation trivially
 * satisfiable, so a final block gives the remainder a genuine severity mix —
 * one clear majority and one exact tie — which is what makes the selection
 * loop and its tie-break observable at all.
 */

import { describe, it, expect } from 'vitest';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { MeteoAlarmService } from '../../src/services/meteoalarm.js';
import type { MeteoAlarmWarning } from '../../src/types/meteoalarm.js';
import type { GeoMetService } from '../../src/services/geomet.js';
import type { GeoMetAlertFeature } from '../../src/types/geomet.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { GoogleWeatherService } from '../../src/services/googleWeather.js';
import type { GoogleWeatherAlert } from '../../src/types/googleWeather.js';
import type { NationalCapService } from '../../src/services/nationalCap.js';
import type { NationalCapWarning, NationalCapResult } from '../../src/types/cap.js';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared fixture coordinates and fake service builders
// ---------------------------------------------------------------------------

const BERLIN = { latitude: 52.52, longitude: 13.405 }; // MeteoAlarm (de)
const NEW_DELHI = { latitude: 28.61, longitude: 77.21 }; // National CAP (in)
const SYDNEY = { latitude: -33.87, longitude: 151.21 }; // Google fallback (au)
const TORONTO = { latitude: 43.6532, longitude: -79.3832 }; // GeoMet (ca)

/** A ring around New Delhi, closed as CAP requires, containing NEW_DELHI. */
const RING_AROUND_DELHI: Array<[number, number]> = [
  [28.0, 77.0],
  [28.0, 78.0],
  [29.0, 78.0],
  [29.0, 77.0],
  [28.0, 77.0]
];

function makeNoaaFake(): NOAAService {
  return {
    getStations: vi.fn(async () => ({ features: [] })),
    getAlerts: vi.fn(async () => ({ updated: '2026-08-24T00:00:00Z', features: [] }))
  } as unknown as NOAAService;
}

function makeNominatimFake(country: string | null): NominatimService {
  return { reverseCountry: vi.fn(async () => country) } as unknown as NominatimService;
}

const emptyStore = { get: vi.fn(() => undefined) } as unknown as LocationStore;
const emptyGeocoding = { search: vi.fn(async () => []) } as unknown as GeocodingService;

/** Count of fixture items per renderer — safely above FULL_DISPLAY_CAP (25). */
const ITEM_COUNT = 26;

// ---------------------------------------------------------------------------
// MeteoAlarm (Europe)
// ---------------------------------------------------------------------------

function makeMeteoAlarmWarnings(count: number): MeteoAlarmWarning[] {
  return Array.from({ length: count }, (_, i) => ({
    identifier: `de-${i}`,
    references: [],
    areaDesc: [],
    event: `Warning ${i}`,
    severity: 'Moderate'
  }));
}

/**
 * MeteoAlarm warnings with explicit per-item severities, for the severity-mix
 * cases below. The renderer sorts by `capSeverityRank` (Extreme first) with a
 * stable sort, so the caller controls exactly which severities land beyond the
 * cap and in what order.
 */
function makeMeteoAlarmWarningsWithSeverities(severities: string[]): MeteoAlarmWarning[] {
  return severities.map((severity, i) => ({
    identifier: `de-${i}`,
    references: [],
    areaDesc: [],
    event: `Warning ${i}`,
    severity
  }));
}

async function renderMeteoAlarmSeverities(
  severities: string[],
  detail: 'standard' | 'full'
): Promise<string> {
  const meteoAlarm = {
    getWarnings: vi.fn(async () => makeMeteoAlarmWarningsWithSeverities(severities))
  } as unknown as MeteoAlarmService;

  const result = await handleGetAlerts(
    { ...BERLIN, detail },
    makeNoaaFake(),
    emptyStore,
    emptyGeocoding,
    meteoAlarm,
    undefined,
    makeNominatimFake('de')
  );
  return result.content[0].text;
}

async function renderMeteoAlarm(detail: 'standard' | 'full'): Promise<string> {
  const meteoAlarm = {
    getWarnings: vi.fn(async () => makeMeteoAlarmWarnings(ITEM_COUNT))
  } as unknown as MeteoAlarmService;

  const result = await handleGetAlerts(
    { ...BERLIN, detail },
    makeNoaaFake(),
    emptyStore,
    emptyGeocoding,
    meteoAlarm,
    undefined,
    makeNominatimFake('de')
  );
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// National CAP (India / Philippines / Indonesia)
// ---------------------------------------------------------------------------

function makeNationalCapWarnings(count: number): NationalCapWarning[] {
  return Array.from({ length: count }, (_, i) => ({
    identifier: `in-${i}`,
    references: [],
    event: `Warning ${i}`,
    severity: 'Moderate',
    areaDesc: ['Delhi'],
    polygons: [RING_AROUND_DELHI],
    countryCode: 'in'
  }));
}

async function renderNationalCap(detail: 'standard' | 'full'): Promise<string> {
  const national = {
    getWarnings: vi.fn(async () => ({
      warnings: makeNationalCapWarnings(ITEM_COUNT),
      unavailableCount: 0,
      polygonUnavailableCount: 0,
      indexTrimmed: false
    } satisfies NationalCapResult))
  } as unknown as NationalCapService;
  const google = {
    isKeyAvailable: vi.fn(() => false),
    getPublicAlerts: vi.fn(async () => ({ alerts: [], covered: true }))
  } as unknown as GoogleWeatherService;

  const result = await handleGetAlerts(
    { ...NEW_DELHI, detail },
    makeNoaaFake(),
    emptyStore,
    emptyGeocoding,
    { getWarnings: vi.fn(async () => []) } as unknown as MeteoAlarmService,
    { getAlerts: vi.fn(async () => []) } as unknown as GeoMetService,
    makeNominatimFake('in'),
    google,
    national
  );
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// Google Weather API (keyed global fallback)
// ---------------------------------------------------------------------------

function makeGoogleAlerts(count: number): GoogleWeatherAlert[] {
  return Array.from({ length: count }, (_, i) => ({
    alertId: `g-${i}`,
    alertTitle: `Alert ${i}`,
    eventType: 'FLOOD',
    severity: 'MODERATE'
  }));
}

async function renderGoogle(detail: 'standard' | 'full'): Promise<string> {
  const google = {
    isKeyAvailable: vi.fn(() => true),
    getPublicAlerts: vi.fn(async () => ({ alerts: makeGoogleAlerts(ITEM_COUNT), covered: true }))
  } as unknown as GoogleWeatherService;

  const result = await handleGetAlerts(
    { ...SYDNEY, detail },
    makeNoaaFake(),
    emptyStore,
    emptyGeocoding,
    { getWarnings: vi.fn(async () => []) } as unknown as MeteoAlarmService,
    { getAlerts: vi.fn(async () => []) } as unknown as GeoMetService,
    makeNominatimFake('au'),
    google
  );
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// MSC GeoMet (Canada) — reaches the remainder text via its own inline copy
// ---------------------------------------------------------------------------

function makeGeoMetAlerts(count: number): GeoMetAlertFeature[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'Feature' as const,
    properties: {
      alert_type: 'warning',
      alert_name_en: `Alert ${i}`
    }
  }));
}

async function renderGeoMet(detail: 'standard' | 'full'): Promise<string> {
  const geoMet = {
    getAlerts: vi.fn(async () => makeGeoMetAlerts(ITEM_COUNT))
  } as unknown as GeoMetService;

  const result = await handleGetAlerts(
    { ...TORONTO, detail },
    makeNoaaFake(),
    emptyStore,
    emptyGeocoding,
    { getWarnings: vi.fn(async () => []) } as unknown as MeteoAlarmService,
    geoMet,
    makeNominatimFake('ca')
  );
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('remainder note detail gating', () => {
  describe('MeteoAlarm (Europe)', () => {
    it('detail="standard" renders the pre-change remainder line unchanged', async () => {
      const text = await renderMeteoAlarm('standard');
      expect(text).toContain(
        '*…and 16 more warnings, mostly Moderate. Use detail="full" to see more.*'
      );
    });

    it('detail="full" drops the hint but keeps the count and severity mix', async () => {
      const text = await renderMeteoAlarm('full');
      expect(text).not.toContain('Use detail=');
      expect(text).toContain('*…and 1 more warning, mostly Moderate.*');
    });
  });

  describe('National CAP (India / Philippines / Indonesia)', () => {
    it('detail="standard" renders the pre-change remainder line unchanged', async () => {
      const text = await renderNationalCap('standard');
      expect(text).toContain(
        '*…and 16 more warnings, mostly Moderate. Use detail="full" to see more.*'
      );
    });

    it('detail="full" drops the hint but keeps the count and severity mix', async () => {
      const text = await renderNationalCap('full');
      expect(text).not.toContain('Use detail=');
      expect(text).toContain('*…and 1 more warning, mostly Moderate.*');
    });
  });

  describe('Google Weather API (keyed global fallback)', () => {
    it('detail="standard" renders the pre-change remainder line unchanged', async () => {
      const text = await renderGoogle('standard');
      expect(text).toContain(
        '*…and 16 more alerts, mostly Moderate. Use detail="full" to see more.*'
      );
    });

    it('detail="full" drops the hint but keeps the count and severity mix', async () => {
      const text = await renderGoogle('full');
      expect(text).not.toContain('Use detail=');
      expect(text).toContain('*…and 1 more alert, mostly Moderate.*');
    });
  });

  /**
   * The fixtures above are deliberately uniform-severity, which exercises the
   * `mostly <severity>` computation with a single candidate — so the comparison
   * and its tie-break are unobservable there. These two cases give the remainder
   * more than one severity, which is what makes that logic testable at all.
   */
  describe('severity mix in the remainder', () => {
    it('names the true mode when one severity dominates the remainder', async () => {
      // 15 Extreme + 2 Minor, cap 10 at standard. Sorted Extreme-first, the
      // shown block takes 10 Extreme, leaving 5 Extreme + 2 Minor beyond it.
      const text = await renderMeteoAlarmSeverities(
        [...Array(15).fill('Extreme'), ...Array(2).fill('Minor')],
        'standard'
      );
      expect(text).toContain(
        '*…and 7 more warnings, mostly Extreme. Use detail="full" to see more.*'
      );
    });

    it('resolves a tie deterministically, by first appearance in the remainder', async () => {
      // 3 Extreme + 10 Moderate + 3 Minor, cap 10 at standard. The shown block
      // takes 3 Extreme + 7 Moderate, leaving an exact 3-vs-3 tie between
      // Moderate and Minor. Moderate appears first in the remainder and wins.
      // This is the case that catches a first-wins/last-wins flip in the
      // selection loop — a uniform-severity fixture cannot see that change.
      const text = await renderMeteoAlarmSeverities(
        [
          ...Array(3).fill('Extreme'),
          ...Array(10).fill('Moderate'),
          ...Array(3).fill('Minor')
        ],
        'standard'
      );
      expect(text).toContain(
        '*…and 6 more warnings, mostly Moderate. Use detail="full" to see more.*'
      );
    });
  });

  describe('MSC GeoMet (Canada) — inline remainder copy', () => {
    it('detail="standard" renders the pre-change remainder line unchanged', async () => {
      const text = await renderGeoMet('standard');
      expect(text).toContain('*…and 16 more alerts. Use detail="full" to see more.*');
    });

    it('detail="full" drops the hint but keeps the count (GeoMet has no severity mix)', async () => {
      const text = await renderGeoMet('full');
      expect(text).not.toContain('Use detail=');
      expect(text).toContain('*…and 1 more alert.*');
    });
  });
});
