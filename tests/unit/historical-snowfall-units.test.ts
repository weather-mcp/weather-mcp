/**
 * Snowfall unit conversion tests for get_historical_weather (v1.12.0 hardening).
 *
 * Open-Meteo reports hourly `snowfall` and daily `snowfall_sum` in **cm**
 * unless `precipitation_unit=inch` was requested. The historical handler used
 * to relabel the raw cm value with the caller's precipitation unit, silently
 * understating metric snowfall by 10x. This drives the real
 * handleGetHistoricalWeather with injected fake services (no HTTP) to prove
 * `snowfallToPrecipUnit` is applied at both display sites.
 *
 * See docs/global-conditions-hardening-implementation-plan.md T3 and
 * docs/global-conditions-hardening-plan.md D1.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetHistoricalWeather } from '../../src/handlers/historicalWeatherHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoHistoricalResponse } from '../../src/types/openmeteo.js';

const COORDS = { latitude: 51.5074, longitude: -0.1278 }; // London — coordinate-only args

/** Hourly archival response with a single non-zero snowfall observation. */
function buildHourlyResponse(snowfallCm: number): OpenMeteoHistoricalResponse {
  return {
    latitude: 51.5,
    longitude: -0.13,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'Europe/London',
    timezone_abbreviation: 'GMT',
    elevation: 11,
    hourly: {
      time: ['2020-01-01T00:00'],
      temperature_2m: [2],
      snowfall: [snowfallCm],
    },
  };
}

/** Daily archival response with a single non-zero snowfall_sum observation. */
function buildDailyResponse(snowfallSumCm: number): OpenMeteoHistoricalResponse {
  return {
    latitude: 51.5,
    longitude: -0.13,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'Europe/London',
    timezone_abbreviation: 'GMT',
    elevation: 11,
    daily: {
      time: ['2020-01-01'],
      temperature_2m_max: [2],
      temperature_2m_min: [-1],
      snowfall_sum: [snowfallSumCm],
    },
  };
}

function buildOpenMeteoFake(response: OpenMeteoHistoricalResponse) {
  return {
    getHistoricalWeather: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
}

function callHistorical(
  args: Record<string, unknown>,
  openMeteo: ReturnType<typeof buildOpenMeteoFake>
) {
  const noaa = {}; // Archival dates never touch the NOAA fake.
  const locationStore = {}; // Coordinate-only args: never touched.
  const geocoding = {}; // Coordinate-only args: never touched.

  return handleGetHistoricalWeather(
    args,
    noaa as unknown as NOAAService,
    openMeteo as unknown as OpenMeteoService,
    locationStore as unknown as LocationStore,
    geocoding as unknown as GeocodingService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

describe('handleGetHistoricalWeather — snowfall unit conversion', () => {
  describe('hourly observations', () => {
    it('converts metric snowfall from cm to mm (0.5 cm -> 5.0 mm)', async () => {
      const openMeteo = buildOpenMeteoFake(buildHourlyResponse(0.5));

      const result = await callHistorical(
        {
          ...COORDS,
          start_date: '2020-01-01',
          end_date: '2020-01-02',
          units: 'metric',
        },
        openMeteo
      );
      const text = textOf(result);

      expect(text).toContain('**Snowfall:** 5.0 mm');
      expect(text).not.toContain('0.5 mm');
    });

    it('passes imperial snowfall through unchanged with the "in" label', async () => {
      const openMeteo = buildOpenMeteoFake(buildHourlyResponse(0.2));

      const result = await callHistorical(
        {
          ...COORDS,
          start_date: '2020-01-01',
          end_date: '2020-01-02',
          units: 'imperial',
        },
        openMeteo
      );
      const text = textOf(result);

      expect(text).toContain('**Snowfall:** 0.2 in');
    });
  });

  describe('daily summaries', () => {
    it('converts metric snowfall_sum from cm to mm (1.2 cm -> 12.0 mm)', async () => {
      const openMeteo = buildOpenMeteoFake(buildDailyResponse(1.2));

      const result = await callHistorical(
        {
          ...COORDS,
          start_date: '2020-01-01',
          end_date: '2020-03-01', // > 31 days: daily summaries path
          units: 'metric',
        },
        openMeteo
      );
      const text = textOf(result);

      expect(text).toContain('**Snowfall:** 12.0 mm');
      expect(text).not.toContain('1.2 mm');
    });

    it('passes imperial snowfall_sum through unchanged with the "in" label', async () => {
      const openMeteo = buildOpenMeteoFake(buildDailyResponse(0.8));

      const result = await callHistorical(
        {
          ...COORDS,
          start_date: '2020-01-01',
          end_date: '2020-03-01',
          units: 'imperial',
        },
        openMeteo
      );
      const text = textOf(result);

      expect(text).toContain('**Snowfall:** 0.8 in');
    });
  });
});
