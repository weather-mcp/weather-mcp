/**
 * Unit tests for the get_air_quality forecast formatting (day-grouped output)
 * and the forecast_days parameter added for the full multi-day AQI forecast.
 *
 * The OpenMeteoService is stubbed; coordinate input means resolveLocationAsync
 * never touches the location store or geocoding service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetAirQuality } from '../../src/handlers/airQualityHandler.js';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { OpenMeteoAirQualityResponse } from '../../src/types/openmeteo.js';

const getAirQualityMock = vi.fn();

const openMeteoService = { getAirQuality: getAirQualityMock } as never;
const locationStore = {} as never;
const geocodingService = {} as never;

/**
 * Build a fixture response with hourly data spanning `days` local calendar
 * days starting at midnight 2026-07-16, with a fixed AQI ramp per day.
 */
function buildResponse(days: number, currentTime = '2026-07-16T11:00'): OpenMeteoAirQualityResponse {
  const time: string[] = [];
  const us_aqi: number[] = [];
  const european_aqi: number[] = [];

  for (let d = 0; d < days; d++) {
    const date = `2026-07-${String(16 + d).padStart(2, '0')}`;
    for (let h = 0; h < 24; h++) {
      time.push(`${date}T${String(h).padStart(2, '0')}:00`);
      // Ramp within each day: 40 at midnight up to 155 at 11 PM
      us_aqi.push(40 + h * 5);
      european_aqi.push(20 + h * 2);
    }
  }

  return {
    latitude: 43.8195,
    longitude: -84.7686,
    generationtime_ms: 0.5,
    utc_offset_seconds: -14400,
    timezone: 'America/Detroit',
    timezone_abbreviation: 'EDT',
    elevation: 258,
    current_units: { time: 'iso8601', interval: 'seconds', us_aqi: '', pm2_5: 'μg/m³' },
    current: {
      time: currentTime,
      interval: 3600,
      us_aqi: 69,
      european_aqi: 52,
      pm2_5: 24
    },
    hourly_units: { time: 'iso8601', us_aqi: '' },
    hourly: { time, us_aqi, european_aqi }
  } as OpenMeteoAirQualityResponse;
}

function callHandler(args: Record<string, unknown>) {
  return handleGetAirQuality(args, openMeteoService, locationStore, geocodingService);
}

const COORDS = { latitude: 43.8195, longitude: -84.7686 };

describe('get_air_quality forecast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAirQualityMock.mockResolvedValue(buildResponse(5));
  });

  describe('forecast_days parameter', () => {
    it('defaults to 5 days', async () => {
      await callHandler({ ...COORDS, forecast: true });
      expect(getAirQualityMock).toHaveBeenCalledWith(43.8195, -84.7686, true, 5);
    });

    it('passes forecast_days through to the service', async () => {
      await callHandler({ ...COORDS, forecast: true, forecast_days: 7 });
      expect(getAirQualityMock).toHaveBeenCalledWith(43.8195, -84.7686, true, 7);
    });

    it('rejects forecast_days above 7', async () => {
      await expect(callHandler({ ...COORDS, forecast: true, forecast_days: 8 }))
        .rejects.toThrow(/forecast_days/);
    });

    it('rejects forecast_days below 1', async () => {
      await expect(callHandler({ ...COORDS, forecast: true, forecast_days: 0 }))
        .rejects.toThrow(/forecast_days/);
    });

    it('rejects non-integer forecast_days', async () => {
      await expect(callHandler({ ...COORDS, forecast: true, forecast_days: 2.5 }))
        .rejects.toThrow(/forecast_days/);
    });
  });

  describe('day-grouped formatting', () => {
    it('shows every forecast day with a dated header', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(5));
      const result = await callHandler({ ...COORDS, forecast: true });
      const text = result.content[0].text;

      expect(text).toContain('## Air Quality Forecast');
      expect(text).toContain('### Thursday, Jul 16');
      expect(text).toContain('### Friday, Jul 17');
      expect(text).toContain('### Saturday, Jul 18');
      expect(text).toContain('### Sunday, Jul 19');
      expect(text).toContain('### Monday, Jul 20');
    });

    it('labels each day with its peak AQI and category', async () => {
      const result = await callHandler({ ...COORDS, forecast: true });
      const text = result.content[0].text;

      // Peak of the ramp is 40 + 23*5 = 155 → Unhealthy
      expect(text).toContain('peak US AQI 155 (Unhealthy)');
    });

    it('skips hours before the current observation time', async () => {
      // Current time is 11 AM on the first day, so the first day's
      // 12 AM - 5 AM and 6 AM - 10 AM hours must not appear.
      const result = await callHandler({ ...COORDS, forecast: true });
      const text = result.content[0].text;

      const firstDay = text.split('### Friday, Jul 17')[0];
      expect(firstDay).not.toContain('**12 AM – 5 AM:**');
      // First shown period starts at the current hour (11 AM)
      expect(firstDay).toContain('**11 AM – 11 AM:**');
      // Later days keep their full 12 AM start
      expect(text).toContain('**12 AM – 5 AM:**');
    });

    it('groups hours into 6-hour periods aligned to the local clock', async () => {
      const result = await callHandler({ ...COORDS, forecast: true });
      const text = result.content[0].text;

      expect(text).toContain('**6 AM – 11 AM:**');
      expect(text).toContain('**12 PM – 5 PM:**');
      expect(text).toContain('**6 PM – 11 PM:**');
    });

    it('reports the total hours shown, excluding skipped past hours', async () => {
      // 5 days * 24 hours = 120, minus the 11 past hours on day one
      const result = await callHandler({ ...COORDS, forecast: true });
      const text = result.content[0].text;

      expect(text).toContain('*Forecast covers 109 hours across 5 day(s).');
    });

    it('covers the full 168 hours for a 7-day forecast starting at midnight', async () => {
      getAirQualityMock.mockResolvedValue(buildResponse(7, '2026-07-16T00:00'));
      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 7 });
      const text = result.content[0].text;

      expect(text).toContain('*Forecast covers 168 hours across 7 day(s).');
      expect(text).toContain('### Wednesday, Jul 22');
    });

    it('uses period peak AQI for the category label', async () => {
      const result = await callHandler({ ...COORDS, forecast: true });
      const text = result.content[0].text;

      // 6 PM - 11 PM ramp is 130..155; peak 155 → Unhealthy even though
      // the period starts in the USG range.
      expect(text).toContain('**6 PM – 11 PM:** US AQI 130-155 (Unhealthy)');
    });

    it('trims trailing null-padded hours instead of rendering them as AQI 0', async () => {
      // Open-Meteo pads hourly arrays with nulls past the model's real
      // horizon; those must not appear as "AQI 0 (Good)".
      const response = buildResponse(7, '2026-07-16T00:00');
      const hourly = response.hourly! as unknown as { us_aqi: (number | null)[] };
      // Null out the last two days (hours 120-167)
      for (let i = 120; i < 168; i++) {
        hourly.us_aqi[i] = null;
      }
      getAirQualityMock.mockResolvedValue(response);

      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 7 });
      const text = result.content[0].text;

      expect(text).not.toContain('### Tuesday, Jul 21');
      expect(text).not.toContain('### Wednesday, Jul 22');
      expect(text).not.toContain('AQI 0 (Good)');
      expect(text).toContain('*Forecast covers 120 hours across 5 day(s).');
      expect(text).toContain('no data for the final 48 requested hour(s)');
    });

    it('excludes interior null values from period ranges', async () => {
      const response = buildResponse(1, '2026-07-16T00:00');
      const hourly = response.hourly! as unknown as { us_aqi: (number | null)[] };
      // Null out 6 PM - 9 PM, leaving 10 PM (90) and 11 PM (95) real
      hourly.us_aqi[18] = null;
      hourly.us_aqi[19] = null;
      hourly.us_aqi[20] = null;
      hourly.us_aqi[21] = null;
      hourly.us_aqi[22] = 90;
      hourly.us_aqi[23] = 95;
      getAirQualityMock.mockResolvedValue(response);

      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 1 });
      const text = result.content[0].text;

      expect(text).toContain('**6 PM – 11 PM:** US AQI 90-95 (Moderate)');
    });

    it('reports no forecast data when every hour is null', async () => {
      const response = buildResponse(2, '2026-07-16T00:00');
      const hourly = response.hourly! as unknown as { us_aqi: (number | null)[]; european_aqi: (number | null)[] };
      hourly.us_aqi.fill(null);
      getAirQualityMock.mockResolvedValue(response);

      const result = await callHandler({ ...COORDS, forecast: true });
      const text = result.content[0].text;

      expect(text).toContain('*No AQI forecast data available for this location.*');
      expect(text).not.toContain('AQI 0');
    });

    it('omits the forecast section when forecast=false', async () => {
      const result = await callHandler({ ...COORDS });
      const text = result.content[0].text;

      expect(text).not.toContain('## Air Quality Forecast');
      expect(getAirQualityMock).toHaveBeenCalledWith(43.8195, -84.7686, false, 5);
    });
  });

  describe('peak UV in day headers', () => {
    it('shows the max UV over the day, not the first or last hour', async () => {
      const response = buildResponse(1, '2026-07-16T00:00');
      const hourly = response.hourly! as unknown as { uv_index: number[] };
      // Low at the boundaries, high in the middle — a first/last selection
      // would report 2 or 3 instead of the true peak of 9.
      hourly.uv_index = new Array(24).fill(0);
      hourly.uv_index[0] = 2;
      hourly.uv_index[23] = 3;
      hourly.uv_index[14] = 9;
      getAirQualityMock.mockResolvedValue(response);

      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 1 });
      const text = result.content[0].text;

      expect(text).toContain('UV 9 (Very High)');
      expect(text).not.toContain('UV 2 (');
      expect(text).not.toContain('UV 3 (');
    });

    it('omits the UV clause for a day whose UV values are all null', async () => {
      const response = buildResponse(2, '2026-07-16T00:00');
      const hourly = response.hourly! as unknown as { uv_index: (number | null)[] };
      hourly.uv_index = new Array(48).fill(null);
      // Day two (hours 24-47) has real UV data; day one does not.
      for (let i = 24; i < 48; i++) {
        hourly.uv_index[i] = 5;
      }
      getAirQualityMock.mockResolvedValue(response);

      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 2 });
      const text = result.content[0].text;

      const dayOne = text.split('### Friday, Jul 17')[0];
      expect(dayOne).toContain('### Thursday, Jul 16');
      expect(dayOne).not.toContain(' · UV');

      const dayTwo = text.split('### Friday, Jul 17')[1];
      expect(dayTwo).toContain(' · UV 5 (Moderate)');
    });

    it('omits the UV clause for every day when the location has no UV data at all', async () => {
      // buildResponse's fixture never sets hourly.uv_index — it's absent,
      // matching a response where the field wasn't requested or returned.
      const response = buildResponse(5);
      getAirQualityMock.mockResolvedValue(response);

      const result = await callHandler({ ...COORDS, forecast: true });
      const text = result.content[0].text;

      expect(text).not.toContain(' · UV');
      expect(text).toContain('### Thursday, Jul 16');
      expect(text).toContain('### Monday, Jul 20');
    });

    it('renders the exact combined AQI + UV header format', async () => {
      const response = buildResponse(1, '2026-07-16T00:00');
      const hourly = response.hourly! as unknown as { uv_index: number[] };
      // Peak US AQI for this day is 40 + 23*5 = 155 (Unhealthy, see the
      // existing "labels each day" test above for the same ramp).
      hourly.uv_index = new Array(24).fill(1);
      hourly.uv_index[15] = 9.4; // rounds to 9, Very High (8 <= 9.4 < 11)
      getAirQualityMock.mockResolvedValue(response);

      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 1 });
      const text = result.content[0].text;

      expect(text).toContain('### Thursday, Jul 16 — peak US AQI 155 (Unhealthy) · UV 9 (Very High)');
    });

    it('takes the max of only the real UV values when null and real values are mixed', async () => {
      const response = buildResponse(1, '2026-07-16T00:00');
      const hourly = response.hourly! as unknown as { uv_index: (number | null)[] };
      hourly.uv_index = new Array(24).fill(null);
      hourly.uv_index[10] = 6.7; // rounds to 7, High (6 <= 7 < 8)
      getAirQualityMock.mockResolvedValue(response);

      const result = await callHandler({ ...COORDS, forecast: true, forecast_days: 1 });
      const text = result.content[0].text;

      expect(text).toContain(' · UV 7 (High)');
    });
  });
});

describe('OpenMeteoService.getAirQuality() hourly params', () => {
  function buildMinimalResponse(): OpenMeteoAirQualityResponse {
    return {
      latitude: 43.8195,
      longitude: -84.7686,
      generationtime_ms: 0.1,
      utc_offset_seconds: -14400,
      timezone: 'America/Detroit',
      timezone_abbreviation: 'EDT',
      elevation: 258,
      current_units: { time: 'iso8601', interval: 'seconds', us_aqi: '' },
      current: { time: '2026-07-16T11:00', interval: 3600, us_aqi: 69 },
      hourly_units: { time: 'iso8601', us_aqi: '' },
      hourly: { time: ['2026-07-16T00:00'], us_aqi: [40], european_aqi: [20], uv_index: [1] }
    } as OpenMeteoAirQualityResponse;
  }

  it('requests exactly the three hourly variables the forecast formatter needs', async () => {
    const service = new OpenMeteoService();
    service.clearCache();
    const spy = vi
      .spyOn(service as any, 'makeRequestToAirQuality')
      .mockResolvedValue(buildMinimalResponse());

    await service.getAirQuality(43.8195, -84.7686, true, 5);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.hourly).toBe('us_aqi,european_aqi,uv_index');
  });

  it('omits the hourly param entirely when forecast is not requested', async () => {
    const service = new OpenMeteoService();
    service.clearCache();
    const spy = vi
      .spyOn(service as any, 'makeRequestToAirQuality')
      .mockResolvedValue(buildMinimalResponse());

    await service.getAirQuality(43.8195, -84.7686, false, 5);

    const params = spy.mock.calls[0][1] as Record<string, string | number>;
    expect(params.hourly).toBeUndefined();
  });
});
