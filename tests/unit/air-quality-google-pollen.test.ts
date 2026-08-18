/**
 * Unit tests for the optional keyed Google Pollen global fallback on
 * get_air_quality (design plan `docs/global-pollen-fallback-plan.md`
 * D1/D5/D6).
 *
 * The contract under test:
 * - Google fires **only** when a key is configured and the CAMS European
 *   model returned nothing — partial CAMS coverage keeps the keyless path.
 * - The data is garnish, not contract: every failure degrades to today's
 *   no-section behavior and never fails the air-quality call.
 * - Without the (optional, trailing 5th) service argument the output is
 *   byte-identical to the keyless path — the property that lets
 *   `air-quality-pollen.test.ts` keep passing unedited.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetAirQuality } from '../../src/handlers/airQualityHandler.js';
import { GooglePollenKeyRejectedError } from '../../src/services/googlePollen.js';
import type { OpenMeteoAirQualityResponse } from '../../src/types/openmeteo.js';
import type { GooglePollenDailyInfo } from '../../src/types/googlePollen.js';

const getAirQualityMock = vi.fn();
const getCurrentPollenMock = vi.fn();
const isKeyAvailableMock = vi.fn();

const openMeteoService = { getAirQuality: getAirQualityMock } as never;
const locationStore = {} as never;
const geocodingService = {} as never;
const googlePollenService = {
  isKeyAvailable: isKeyAvailableMock,
  getCurrentPollen: getCurrentPollenMock
} as never;

/** The exact attribution string the Google Pollen API policies mandate. */
const ATTRIBUTION = 'Source: Includes pollen data from Google';

const ALL_NULL_CAMS = {
  alder_pollen: null as unknown as number,
  birch_pollen: null as unknown as number,
  grass_pollen: null as unknown as number,
  mugwort_pollen: null as unknown as number,
  olive_pollen: null as unknown as number,
  ragweed_pollen: null as unknown as number
};

function buildResponse(
  pollen: Record<string, number | null | undefined>,
  extra: Partial<OpenMeteoAirQualityResponse> = {}
): OpenMeteoAirQualityResponse {
  return {
    latitude: 39.1,
    longitude: -94.58,
    generationtime_ms: 0.1,
    utc_offset_seconds: -18000,
    timezone: 'America/Chicago',
    timezone_abbreviation: 'CDT',
    elevation: 271,
    current_units: { time: 'iso8601', interval: 'seconds', us_aqi: '', pm2_5: 'μg/m³' },
    current: {
      time: '2026-08-18T15:00',
      interval: 3600,
      us_aqi: 42,
      european_aqi: 30,
      pm2_5: 8,
      ...pollen
    },
    ...extra
  } as OpenMeteoAirQualityResponse;
}

function buildGoogleDay(overrides: Partial<GooglePollenDailyInfo> = {}): GooglePollenDailyInfo {
  return {
    date: { year: 2026, month: 8, day: 18 },
    pollenTypeInfo: [
      {
        code: 'GRASS',
        displayName: 'Grass',
        inSeason: true,
        indexInfo: { value: 2, category: 'Low' }
      },
      {
        code: 'TREE',
        displayName: 'Tree',
        inSeason: true,
        indexInfo: { value: 3, category: 'Moderate' }
      },
      {
        code: 'WEED',
        displayName: 'Weed',
        inSeason: false,
        indexInfo: { value: 0, category: 'None' }
      }
    ],
    plantInfo: [
      {
        displayName: 'Ragweed',
        inSeason: true,
        indexInfo: { value: 3, category: 'Moderate' }
      },
      { displayName: 'Oak', inSeason: true, indexInfo: { value: 1, category: 'Low' } },
      { displayName: 'Birch', inSeason: false }
    ],
    ...overrides
  };
}

/** Calls the handler WITH the optional 5th service argument. */
function callWithService() {
  return handleGetAirQuality(
    { latitude: 39.1, longitude: -94.58 },
    openMeteoService,
    locationStore,
    geocodingService,
    googlePollenService
  );
}

/** Calls the handler with exactly 4 args — the locked keyless path. */
function callKeyless() {
  return handleGetAirQuality(
    { latitude: 39.1, longitude: -94.58 },
    openMeteoService,
    locationStore,
    geocodingService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

describe('get_air_quality — Google Pollen global fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isKeyAvailableMock.mockReturnValue(true);
  });

  describe('trigger conditions', () => {
    it('renders the Google section when every CAMS species is null and a key is configured', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));
      getCurrentPollenMock.mockResolvedValue(buildGoogleDay());

      const text = textOf(await callWithService());

      expect(getCurrentPollenMock).toHaveBeenCalledWith(39.1, -94.58);
      expect(text).toContain('## 🌾 Pollen');
      expect(text).toContain('**Grass:** 2 (Low) — in season');
      expect(text).toContain('**Tree:** 3 (Moderate) — in season');
      expect(text).toContain('**Weed:** 0 (None)');
      expect(text).toContain('In season: Ragweed (Moderate), Oak (Low)');
      // The attribution string is mandatory and exact (upstream (d)).
      expect(text).toContain(ATTRIBUTION);
      expect(text).toContain('*Universal Pollen Index (0–5) for today.');
      // The keyless CAMS footer must not appear on the Google path.
      expect(text).not.toContain('CAMS European forecast');
    });

    it('keeps the CAMS section and never calls Google when the model has real data', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse({
        alder_pollen: 0.5,
        birch_pollen: 12.3,
        grass_pollen: 45,
        mugwort_pollen: 3.14,
        olive_pollen: 0,
        ragweed_pollen: 88.88
      }));

      const text = textOf(await callWithService());

      expect(getCurrentPollenMock).not.toHaveBeenCalled();
      expect(text).toContain('**Grass:** 45 grains/m³');
      expect(text).toContain('*Pollen from the CAMS European forecast');
      expect(text).not.toContain(ATTRIBUTION);
    });

    it('never calls Google on PARTIAL CAMS coverage (one real species is coverage)', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse({
        ...ALL_NULL_CAMS,
        grass_pollen: 30
      }));

      const text = textOf(await callWithService());

      expect(getCurrentPollenMock).not.toHaveBeenCalled();
      expect(text).toContain('**Grass:** 30 grains/m³');
      expect(text).not.toContain(ATTRIBUTION);
    });

    it('does not call Google when the key is unavailable', async () => {
      isKeyAvailableMock.mockReturnValue(false);
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));

      const text = textOf(await callWithService());

      expect(getCurrentPollenMock).not.toHaveBeenCalled();
      expect(text).not.toContain('Pollen');
    });

    it('does not call Google when there is no current block at all', async () => {
      getAirQualityMock.mockResolvedValue(
        buildResponse({}, { current: undefined }) as OpenMeteoAirQualityResponse
      );

      await callWithService();

      expect(getCurrentPollenMock).not.toHaveBeenCalled();
    });
  });

  describe('failure modes — garnish, not contract', () => {
    it('renders no section and no note when the service throws a generic error', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));
      getCurrentPollenMock.mockRejectedValue(new Error('Google Pollen API returned an error response.'));

      const result = await callWithService();
      const text = textOf(result);

      // The air-quality call still succeeds — that is the whole point.
      expect(text).toContain('# Air Quality Report');
      expect(text).not.toContain('Pollen');
      expect(text).not.toContain('GOOGLE_POLLEN_API_KEY');
    });

    it('renders the misconfiguration note when the key is rejected, and still succeeds', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));
      getCurrentPollenMock.mockRejectedValue(new GooglePollenKeyRejectedError());

      const text = textOf(await callWithService());

      expect(text).toContain('# Air Quality Report');
      expect(text).toContain(
        '*Note: GOOGLE_POLLEN_API_KEY was rejected; global pollen data is unavailable.*'
      );
      expect(text).not.toContain('## 🌾 Pollen');
    });

    it('renders no section for an uncovered region (undefined day)', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));
      getCurrentPollenMock.mockResolvedValue(undefined);

      const text = textOf(await callWithService());

      expect(text).toContain('# Air Quality Report');
      expect(text).not.toContain('Pollen');
    });

    it('renders no section when every type lacks indexInfo (all out of season)', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));
      getCurrentPollenMock.mockResolvedValue(buildGoogleDay({
        pollenTypeInfo: [
          { code: 'GRASS', displayName: 'Grass', inSeason: false },
          { code: 'TREE', displayName: 'Tree', inSeason: false },
          { code: 'WEED', displayName: 'Weed', inSeason: false }
        ]
      }));

      const text = textOf(await callWithService());

      expect(text).not.toContain('## 🌾 Pollen');
      expect(text).not.toContain(ATTRIBUTION);
    });

    it('renders no section when the day carries no pollenTypeInfo at all', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));
      getCurrentPollenMock.mockResolvedValue({ date: { year: 2026, month: 8, day: 18 } });

      const text = textOf(await callWithService());

      expect(text).not.toContain('## 🌾 Pollen');
    });
  });

  describe('rendering details', () => {
    it('renders a zero UPI that carries indexInfo (meaningful "none detected")', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));
      getCurrentPollenMock.mockResolvedValue(buildGoogleDay({
        pollenTypeInfo: [
          {
            code: 'GRASS',
            displayName: 'Grass',
            inSeason: true,
            indexInfo: { value: 0, category: 'None' }
          }
        ],
        plantInfo: []
      }));

      const text = textOf(await callWithService());

      expect(text).toContain('**Grass:** 0 (None) — in season');
      expect(text).toContain(ATTRIBUTION);
    });

    it('omits only the types lacking indexInfo, keeping the rest', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));
      getCurrentPollenMock.mockResolvedValue(buildGoogleDay({
        pollenTypeInfo: [
          {
            code: 'GRASS',
            displayName: 'Grass',
            inSeason: true,
            indexInfo: { value: 4, category: 'High' }
          },
          { code: 'TREE', displayName: 'Tree', inSeason: false }
        ],
        plantInfo: []
      }));

      const text = textOf(await callWithService());

      expect(text).toContain('**Grass:** 4 (High) — in season');
      expect(text).not.toContain('**Tree:**');
    });

    it('drops the "In season" line when no plant is in season', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));
      getCurrentPollenMock.mockResolvedValue(buildGoogleDay({
        plantInfo: [{ displayName: 'Birch', inSeason: false }]
      }));

      const text = textOf(await callWithService());

      expect(text).toContain('## 🌾 Pollen');
      expect(text).not.toContain('In season:');
    });

    it('falls back to the title-cased code when a type omits displayName', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));
      getCurrentPollenMock.mockResolvedValue(buildGoogleDay({
        pollenTypeInfo: [{ code: 'WEED', inSeason: true, indexInfo: { value: 1, category: 'Low' } }],
        plantInfo: []
      }));

      const text = textOf(await callWithService());

      expect(text).toContain('**Weed:** 1 (Low) — in season');
    });

    it('leaves the hourly forecast section untouched when the Google section renders', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS, {
        hourly_units: { time: 'iso8601', us_aqi: '' },
        hourly: {
          time: ['2026-08-18T15:00', '2026-08-18T16:00'],
          us_aqi: [40, 44],
          european_aqi: [20, 22],
          uv_index: [3, 2]
        }
      } as Partial<OpenMeteoAirQualityResponse>));
      getCurrentPollenMock.mockResolvedValue(buildGoogleDay());

      const result = await handleGetAirQuality(
        { latitude: 39.1, longitude: -94.58, forecast: true },
        openMeteoService,
        locationStore,
        geocodingService,
        googlePollenService
      );
      const text = textOf(result);

      expect(text).toContain(ATTRIBUTION);
      expect(text).toContain('## Air Quality Forecast');
    });
  });

  describe('keyless byte-identity', () => {
    it('produces output strictly equal to the keyless path when no service is passed', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(ALL_NULL_CAMS));

      const keyless = textOf(await callKeyless());

      // A configured service that would have rendered a section changes
      // nothing about the 4-arg call's output.
      getCurrentPollenMock.mockResolvedValue(buildGoogleDay());
      const stillKeyless = textOf(await callKeyless());

      expect(stillKeyless).toBe(keyless);
      expect(getCurrentPollenMock).not.toHaveBeenCalled();
      expect(keyless).not.toContain('Pollen');
    });

    it('leaves the CAMS-present output identical with and without the service', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse({
        alder_pollen: 0.5,
        birch_pollen: 12.3,
        grass_pollen: 45,
        mugwort_pollen: 3.14,
        olive_pollen: 0,
        ragweed_pollen: 88.88
      }));

      const keyless = textOf(await callKeyless());
      const withService = textOf(await callWithService());

      expect(withService).toBe(keyless);
    });
  });
});
