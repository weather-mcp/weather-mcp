/**
 * Unit tests for the get_marine_conditions forecast_days parameter and the
 * full-range null-trimmed daily forecast display (Open-Meteo path only).
 *
 * Modeled on tests/unit/air-quality-forecast.test.ts: drives the real
 * handler with a mocked OpenMeteoService and stub LocationStore/
 * GeocodingService. Coordinates are used directly (mid-Atlantic, well
 * outside any NOAA Great Lakes / coastal bay region) so resolveLocationAsync
 * never touches the location store or geocoding service, and
 * shouldUseNOAAMarine routes straight to Open-Meteo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetMarineConditions } from '../../src/handlers/marineConditionsHandler.js';
import type { OpenMeteoMarineResponse } from '../../src/types/openmeteo.js';
import type { GridpointResponse } from '../../src/types/noaa.js';

const getMarineMock = vi.fn();
const getStationsMock = vi.fn();
const getGridpointDataMock = vi.fn();

const noaaService = {
  getStations: getStationsMock,
  getGridpointDataByCoordinates: getGridpointDataMock
} as never;
const openMeteoService = { getMarine: getMarineMock } as never;
const locationStore = {} as never;
const geocodingService = {} as never;

// Mid-Atlantic open ocean — outside every Great Lakes / coastal bay bounding
// box, so shouldUseNOAAMarine routes straight to Open-Meteo.
const COORDS = { latitude: 30.0, longitude: -60.0 };

// Lake Michigan coordinates (within bbox: minLat: 41.6, maxLat: 46.0, minLon: -87.8, maxLon: -84.8)
// This triggers the NOAA path
const LAKE_MICHIGAN_COORDS = { latitude: 43.0, longitude: -86.0 };

/**
 * Build a daily marine fixture. `values[i]` may be `null` to simulate the
 * real API's null-padding past the model's ~10-day horizon; the declared
 * TypeScript types say `number[]`, so fixtures are cast where nulls appear.
 */
function buildResponse(
  days: number,
  waveHeightMax: (number | null)[],
  opts: { currentTime?: string } = {}
): OpenMeteoMarineResponse {
  const time: string[] = [];
  for (let d = 0; d < days; d++) {
    time.push(`2026-07-${String(16 + d).padStart(2, '0')}`);
  }

  const waveDirectionDominant = waveHeightMax.map((v) => (v === null ? null : 180 + (v as number)));
  const wavePeriodMax = waveHeightMax.map((v) => (v === null ? null : 8 + (v as number)));
  const swellWaveHeightMax = waveHeightMax.map((v) => (v === null ? null : 0));
  const swellWaveDirectionDominant = waveHeightMax.map((v) => (v === null ? null : 190));

  return {
    latitude: 30.0,
    longitude: -60.0,
    generationtime_ms: 0.5,
    utc_offset_seconds: 0,
    timezone: 'Atlantic/Bermuda',
    timezone_abbreviation: 'AST',
    elevation: 0,
    current_units: { time: 'iso8601', wave_height: 'm' },
    current: {
      time: opts.currentTime ?? '2026-07-16T11:00',
      interval: 3600,
      wave_height: 1.2,
      wave_direction: 200,
      wave_period: 9.0
    },
    daily_units: { time: 'iso8601', wave_height_max: 'm' },
    daily: {
      time,
      wave_height_max: waveHeightMax,
      wave_direction_dominant: waveDirectionDominant,
      wave_period_max: wavePeriodMax,
      swell_wave_height_max: swellWaveHeightMax,
      swell_wave_direction_dominant: swellWaveDirectionDominant
    }
  } as unknown as OpenMeteoMarineResponse;
}

function callHandler(args: Record<string, unknown>) {
  return handleGetMarineConditions(args, noaaService, openMeteoService, locationStore, geocodingService);
}

describe('get_marine_conditions forecast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Handler falls back to a guessed timezone when getStations rejects.
    getStationsMock.mockRejectedValue(new Error('no station coverage'));
    getMarineMock.mockResolvedValue(buildResponse(5, [1.0, 1.1, 1.2, 1.3, 1.4]));
  });

  describe('forecast_days parameter', () => {
    it('defaults to 5 days', async () => {
      await callHandler({ ...COORDS, forecast: true });
      expect(getMarineMock).toHaveBeenCalledWith(30.0, -60.0, true, 5);
    });

    it('passes forecast_days through to the service', async () => {
      getMarineMock.mockResolvedValue(
        buildResponse(16, Array.from({ length: 16 }, (_, i) => 1.0 + i * 0.1))
      );
      await callHandler({ ...COORDS, forecast: true, forecast_days: 16 });
      expect(getMarineMock).toHaveBeenCalledWith(30.0, -60.0, true, 16);
    });

    it('rejects forecast_days of 0', async () => {
      await expect(callHandler({ ...COORDS, forecast: true, forecast_days: 0 }))
        .rejects.toThrow(/forecast_days/);
    });

    it('rejects forecast_days of 17', async () => {
      await expect(callHandler({ ...COORDS, forecast: true, forecast_days: 17 }))
        .rejects.toThrow(/forecast_days/);
    });

    it('rejects non-integer forecast_days', async () => {
      await expect(callHandler({ ...COORDS, forecast: true, forecast_days: 2.5 }))
        .rejects.toThrow(/forecast_days/);
    });
  });

  describe('full-range display', () => {
    it('renders all fetched days with no 5-day cap', async () => {
      getMarineMock.mockResolvedValue(
        buildResponse(10, Array.from({ length: 10 }, (_, i) => 1.0 + i * 0.2))
      );
      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 10 });
      const text = result.content[0].text;

      expect(text).toContain('**Next 10 days:**');
      const dayBullets = text.match(/• Max Wave Height:/g) ?? [];
      expect(dayBullets.length).toBe(10);
    });
  });

  describe('trailing-null trimming', () => {
    it('trims trailing no-data days and adds a footer note', async () => {
      // 16 days requested: real values for days 0-8, null for days 9-15
      // (the API null-pads past the ~10-day model horizon).
      const values: (number | null)[] = Array.from({ length: 16 }, (_, i) =>
        i < 9 ? 1.0 + i * 0.1 : null
      );
      getMarineMock.mockResolvedValue(buildResponse(16, values));

      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 16 });
      const text = result.content[0].text;

      expect(text).toContain('**Next 9 days:**');
      expect(text).not.toContain('**Next 16 days:**');
      expect(text).not.toContain('0.0m (0.0ft)');
      expect(text).not.toContain('Calm (glassy)');
      expect(text).toContain('The marine model provided no data for the final 7 requested day(s)');
    });
  });

  describe('interior-null guarding', () => {
    it('renders a no-data placeholder for an interior null day without a 0m wave height', async () => {
      const values: (number | null)[] = [1.0, 1.1, null, 1.3, 1.4];
      getMarineMock.mockResolvedValue(buildResponse(5, values));

      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 5 });
      const text = result.content[0].text;

      expect(text).toContain('**Next 5 days:**');
      expect(text).toContain('No marine data available for this day');
      // The interior gap must never be rendered as a zero-meter wave height.
      expect(text).not.toContain('0.0m (0.0ft)');

      // Days after the gap still render real values.
      const dayBullets = text.match(/• Max Wave Height:/g) ?? [];
      expect(dayBullets.length).toBe(4);
    });
  });

  describe('all-null', () => {
    it('shows the no-data message with no day headers', async () => {
      const values: (number | null)[] = [null, null, null, null, null];
      getMarineMock.mockResolvedValue(buildResponse(5, values));

      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 5 });
      const text = result.content[0].text;

      expect(text).toContain('*No marine forecast data available for this location.*');
      expect(text).not.toContain('**Next');
      expect(text).not.toContain('• Max Wave Height:');
    });
  });

  describe('forecast: false', () => {
    it('shows current conditions but no Marine Forecast section', async () => {
      const result = await callHandler({ ...COORDS });
      const text = result.content[0].text;

      expect(getMarineMock).toHaveBeenCalledWith(30.0, -60.0, false, 5);
      expect(text).toContain('Current Conditions');
      expect(text).not.toContain('## 📅 Marine Forecast');
    });
  });

  describe('no hourly references', () => {
    it('never mentions hourly forecast availability', async () => {
      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 5 });
      const text = result.content[0].text;

      expect(text.toLowerCase()).not.toContain('hourly forecast');
      expect(text).not.toContain('Hourly forecast data available');
    });
  });
});

/**
 * Build a NOAA gridpoint fixture with marine wave data
 */
function buildNOAAGridpointResponse(): GridpointResponse {
  return {
    properties: {
      '@id': 'https://api.weather.gov/gridpoints/test/1,1',
      '@type': 'wx:Gridpoint',
      updateTime: '2026-07-16T10:00:00Z',
      validTimes: '2026-07-16T06:00:00Z/P7D',
      elevation: {
        unitCode: 'wmoUnit:m',
        value: 10
      },
      forecastOffice: 'https://api.weather.gov/offices/test',
      gridId: 'test',
      gridX: 1,
      gridY: 1,
      waveHeight: {
        values: [
          { validTime: '2026-07-16T11:00:00Z', value: 1.5 },
          { validTime: '2026-07-16T12:00:00Z', value: 1.6 }
        ]
      },
      waveDirection: {
        values: [
          { validTime: '2026-07-16T11:00:00Z', value: 200 },
          { validTime: '2026-07-16T12:00:00Z', value: 205 }
        ]
      },
      wavePeriod: {
        values: [
          { validTime: '2026-07-16T11:00:00Z', value: 8.0 },
          { validTime: '2026-07-16T12:00:00Z', value: 8.2 }
        ]
      },
      windSpeed: {
        values: [
          { validTime: '2026-07-16T11:00:00Z', value: 5.0 },
          { validTime: '2026-07-16T12:00:00Z', value: 5.5 }
        ]
      },
      windDirection: {
        values: [
          { validTime: '2026-07-16T11:00:00Z', value: 210 },
          { validTime: '2026-07-16T12:00:00Z', value: 215 }
        ]
      }
    }
  } as unknown as GridpointResponse;
}

describe('get_marine_conditions NOAA path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStationsMock.mockResolvedValue({ features: [] });
    getMarineMock.mockResolvedValue(buildResponse(5, [1.0, 1.1, 1.2, 1.3, 1.4]));
  });

  describe('water-body disclosure', () => {
    it('adds disclosure line in NOAA output for Great Lakes', async () => {
      getGridpointDataMock.mockResolvedValue(buildNOAAGridpointResponse());

      const result = await callHandler({ ...LAKE_MICHIGAN_COORDS });
      const text = result.content[0].text;

      expect(text).toContain('*Conditions describe Lake Michigan — the nearest covered water body, which may be distant from the requested point.*');
    });

    it('places disclosure line after header but before Region line', async () => {
      getGridpointDataMock.mockResolvedValue(buildNOAAGridpointResponse());

      const result = await callHandler({ ...LAKE_MICHIGAN_COORDS });
      const text = result.content[0].text;

      const headerIdx = text.indexOf('# Marine Conditions Report - Lake Michigan');
      const disclosureIdx = text.indexOf('*Conditions describe Lake Michigan');
      const regionIdx = text.indexOf('**Region:**');

      expect(headerIdx).toBeGreaterThanOrEqual(0);
      expect(disclosureIdx).toBeGreaterThan(headerIdx);
      expect(regionIdx).toBeGreaterThan(disclosureIdx);
    });

    it('does NOT include disclosure line in Open-Meteo output', async () => {
      // Use ocean coordinates to force Open-Meteo path
      const result = await callHandler({ ...COORDS, forecast: false });
      const text = result.content[0].text;

      expect(text).not.toContain('*Conditions describe');
      expect(text).not.toContain('the nearest covered water body');
    });

    it('substitutes the actual region name in the disclosure', async () => {
      // Test with Chesapeake Bay coordinates (coastal bay region)
      getGridpointDataMock.mockResolvedValue(buildNOAAGridpointResponse());

      const result = await callHandler({ latitude: 37.5, longitude: -76.2 });
      const text = result.content[0].text;

      expect(text).toContain('*Conditions describe Chesapeake Bay — the nearest covered water body, which may be distant from the requested point.*');
      expect(text).not.toContain('Lake Michigan');
    });
  });
});
