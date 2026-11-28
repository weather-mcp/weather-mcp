/**
 * Current-conditions observation times carry a zone label.
 *
 * Drives the real handleGetCurrentConditions (and, for the summary row, the
 * real handleGetWeatherSummary) with plain fake services, no HTTP. Pins:
 *   - NOAA `**Time:**` and the stale-nearest substitution note end in the
 *     station zone's label (station zone wins over the coordinate guess)
 *   - Open-Meteo `**Time:**` is labelled from the IANA `timezone`, never from
 *     `timezone_abbreviation` (G130), and the naive wall clock is not shifted (G162)
 *   - the current section of get_weather_summary is labelled (G19)
 *   - the METAR `**Observed:**` line keeps its own construction
 *
 * Fixtures are copied from noaa-staleness, current-conditions-global,
 * weather-summary-source and metar-handler tests; those files are locks and
 * are not imported. Every extracted line is anchored (G96) and has ICU's
 * narrow no-break space normalised (G75).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import {
  formatInTimezone,
  getTimezoneAbbreviation,
  guessTimezoneFromCoords
} from '../../src/utils/timezone.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { AviationWeatherService } from '../../src/services/aviationWeather.js';
import type { ObservationResponse, StationCollectionResponse } from '../../src/types/noaa.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import type { MetarObservation } from '../../src/types/aviationWeather.js';

/** Chicago — inside the US routing boxes, so auto routes to NOAA. */
const CHICAGO = { latitude: 41.8781, longitude: -87.6298 };
/** Memphis — US point for the summary row. */
const MEMPHIS = { latitude: 35.1495, longitude: -90.049 };
/** London — outside the US routing boxes, so auto routes to Open-Meteo. */
const LONDON = { latitude: 51.5074, longitude: -0.1278 };
/** Seattle — METAR row. */
const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };

/** Observation instant: 2026-11-28 00:50 in Chicago. */
const OBS_ISO = '2026-11-28T06:50:00+00:00';
/** Pinned "now": 20 minutes after the observation. */
const NOW = new Date('2026-11-28T07:10:00Z');

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

/** G75: ICU may use U+202F or U+00A0 before AM/PM. */
function norm(s: string): string {
  return s.replace(/[  ]/g, ' ');
}

/** Anchored extraction (G96): throws when the line is absent. */
function extract(text: string, re: RegExp): string {
  const m = norm(text).match(re);
  if (!m) {
    throw new Error(`pattern ${String(re)} not found in:\n${text}`);
  }
  return m[1];
}

const TIME_LINE = /^\*\*Time:\*\* (.+)$/m;

/** The label the handler should have appended, derived independently of the helper under test. */
function labelFor(iso: string, zone: string): string {
  return DateTime.fromISO(iso, { zone }).offsetNameShort ?? '';
}

/** Prefix contract (G75): clock from formatInTimezone, then a space and the label. */
function expectedClock(iso: string, zone: string, tf: '12h' | '24h' = '12h'): string {
  return norm(`${formatInTimezone(iso, zone, 'medium', tf)} ${labelFor(iso, zone)}`);
}

// ---------------------------------------------------------------------------
// NOAA fixtures (copied from noaa-staleness.test.ts)
// ---------------------------------------------------------------------------

function buildObservation(stationId: string, timestamp: string): ObservationResponse {
  return {
    properties: {
      '@id': `https://api.weather.gov/stations/${stationId}/observations/${timestamp}`,
      '@type': 'wx:ObservationStation',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      station: `https://api.weather.gov/stations/${stationId}`,
      timestamp,
      textDescription: 'Sunny',
      temperature: { unitCode: 'wmoUnit:degC', value: 20 },
      dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
      windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 270 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 10 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    },
  } as unknown as ObservationResponse;
}

function buildStations(
  ids: Array<[id: string, name: string]>,
  timeZone: string
): StationCollectionResponse {
  return {
    type: 'FeatureCollection',
    features: ids.map(([stationIdentifier, name]) => ({
      properties: {
        '@id': `https://api.weather.gov/stations/${stationIdentifier}`,
        '@type': 'wx:ObservationStation',
        elevation: { unitCode: 'wmoUnit:m', value: 10 },
        stationIdentifier,
        name,
        timeZone,
      },
    })) as unknown as StationCollectionResponse['features'],
  };
}

function buildNoaaFake(
  stations: StationCollectionResponse,
  observations: Record<string, ObservationResponse | 'error'>
) {
  return {
    getStations: vi.fn().mockResolvedValue(stations),
    getLatestObservation: vi.fn().mockImplementation((stationId: string) => {
      const entry = observations[stationId];
      if (entry === undefined || entry === 'error') {
        return Promise.reject(new Error(`fetch failed for ${stationId}`));
      }
      return Promise.resolve(entry);
    }),
    getGridpointDataByCoordinates: vi.fn().mockResolvedValue({ properties: {} }),
  };
}

function buildOpenMeteoCurrentResponse(
  currentOverrides: Record<string, unknown> = {},
  timezone = 'Europe/London',
  topOverrides: Record<string, unknown> = {}
): OpenMeteoForecastResponse {
  return {
    latitude: 51.5,
    longitude: -0.13,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone,
    timezone_abbreviation: 'GMT',
    elevation: 11,
    current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°F' },
    current: {
      time: '2024-01-01T12:00',
      interval: 900,
      temperature_2m: 60,
      relative_humidity_2m: 55,
      apparent_temperature: 60,
      dew_point_2m: 50,
      is_day: 1,
      precipitation: 0,
      rain: 0,
      showers: 0,
      snowfall: 0,
      weather_code: 3,
      cloud_cover: 40,
      pressure_msl: 1012,
      wind_speed_10m: 10,
      wind_direction_10m: 200,
      wind_gusts_10m: 10,
      ...currentOverrides,
    },
    daily: {
      time: ['2024-01-01'],
      temperature_2m_max: [65],
      temperature_2m_min: [55],
    },
    ...topOverrides,
  } as OpenMeteoForecastResponse;
}

function buildSupportFakes(response: OpenMeteoForecastResponse = buildOpenMeteoCurrentResponse()) {
  return {
    openMeteo: {
      getCurrentConditions: vi.fn().mockResolvedValue(response),
      getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
      getClimateNormals: vi.fn().mockRejectedValue(new Error('normals not configured')),
    },
    ncei: { isAvailable: vi.fn().mockReturnValue(false) },
    locationStore: {},
    geocoding: {},
  };
}

function callHandler(
  args: Record<string, unknown>,
  noaa: unknown,
  support: ReturnType<typeof buildSupportFakes>,
  aviation?: unknown
) {
  return handleGetCurrentConditions(
    args,
    noaa as NOAAService,
    support.openMeteo as unknown as OpenMeteoService,
    support.ncei as unknown as NCEIService,
    support.locationStore as unknown as LocationStore,
    support.geocoding as unknown as GeocodingService,
    undefined,
    aviation as AviationWeatherService | undefined
  );
}

/** A NOAA fake with one fresh station in `zone`. */
function singleStationNoaa(zone: string) {
  return buildNoaaFake(buildStations([['KAAA', 'Alpha Field']], zone), {
    KAAA: buildObservation('KAAA', OBS_ISO),
  });
}

describe('current-conditions time zone label', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('NOAA path', () => {
    it('labels the observation time with the station zone and keeps the age after it', async () => {
      const text = textOf(await callHandler({ ...CHICAGO }, singleStationNoaa('America/Chicago'), buildSupportFakes()));
      const line = extract(text, TIME_LINE);

      const [clock, rest] = line.split(' (');
      expect(clock).toBe('Nov 28, 2026, 12:50 AM CST');
      expect(rest).toBe('20 minutes ago)');
      // Prefix contract against the function itself.
      expect(clock).toBe(expectedClock(OBS_ISO, 'America/Chicago'));
    });

    it('prefers the station zone over the coordinate guess', async () => {
      const text = textOf(await callHandler({ ...CHICAGO }, singleStationNoaa('America/Denver'), buildSupportFakes()));
      const clock = extract(text, TIME_LINE).split(' (')[0];

      expect(clock).toBe('Nov 27, 2026, 11:50 PM MST');
      expect(clock).toBe(expectedClock(OBS_ISO, 'America/Denver'));
    });

    it('falls back to the coordinate-guessed zone when the station names none', async () => {
      const guessed = guessTimezoneFromCoords(CHICAGO.latitude, CHICAGO.longitude);
      expect(guessed).toBe('America/Chicago');

      const text = textOf(await callHandler({ ...CHICAGO }, singleStationNoaa(''), buildSupportFakes()));
      const clock = extract(text, TIME_LINE).split(' (')[0];

      expect(clock.endsWith(' CST')).toBe(true);
      expect(clock).toBe(expectedClock(OBS_ISO, guessed));
    });

    it('labels the time in the stale-nearest substitution note', async () => {
      const staleIso = new Date(NOW.getTime() - 2 * 24 * 60 * 60_000).toISOString();
      const noaa = buildNoaaFake(
        buildStations([['KAAA', 'Alpha Field'], ['KBBB', 'Bravo Field']], 'America/Chicago'),
        {
          KAAA: buildObservation('KAAA', staleIso),
          KBBB: buildObservation('KBBB', OBS_ISO),
        }
      );
      const text = textOf(await callHandler({ ...CHICAGO }, noaa, buildSupportFakes()));
      const lastReport = extract(text, /has not reported since (.+?); showing/);

      expect(lastReport.endsWith(' CST')).toBe(true);
      expect(lastReport).toBe(expectedClock(staleIso, 'America/Chicago'));
    });

    it('renders 24-hour clocks with the label', async () => {
      const text = textOf(
        await callHandler({ ...CHICAGO, time_format: '24h' }, singleStationNoaa('America/Chicago'), buildSupportFakes())
      );
      const clock = extract(text, TIME_LINE).split(' (')[0];

      expect(clock).toBe('Nov 28, 2026, 00:50 CST');
      expect(clock).toBe(expectedClock(OBS_ISO, 'America/Chicago', '24h'));
    });
  });

  describe('Open-Meteo path', () => {
    it('labels a US zone and keeps the local wall clock', async () => {
      const response = buildOpenMeteoCurrentResponse({ time: '2024-01-01T12:00' }, 'America/Chicago');
      const text = textOf(await callHandler({ ...LONDON }, {}, buildSupportFakes(response)));
      const clock = extract(text, TIME_LINE);

      expect(clock).toBe('Jan 1, 2024, 12:00 PM CST');
      expect(clock).toBe(expectedClock('2024-01-01T12:00', 'America/Chicago'));
    });

    it('labels Berlin with a GMT offset and never prints timezone_abbreviation', async () => {
      const response = buildOpenMeteoCurrentResponse({ time: '2024-01-01T12:00' }, 'Europe/Berlin', {
        timezone_abbreviation: 'XYZ',
      });
      const text = textOf(await callHandler({ ...LONDON }, {}, buildSupportFakes(response)));
      const clock = extract(text, TIME_LINE);

      expect(clock).toBe('Jan 1, 2024, 12:00 PM GMT+1');
      expect(clock).toBe(expectedClock('2024-01-01T12:00', 'Europe/Berlin'));
      expect(text).not.toContain('XYZ');
    });
  });

  describe('get_weather_summary current section', () => {
    it('labels the NOAA observation time in the summary', async () => {
      const noaa = {
        ...singleStationNoaa('America/Chicago'),
        getPointData: vi.fn().mockRejectedValue(new Error('not needed for the current section')),
      };
      const support = buildSupportFakes();
      const result = await handleGetWeatherSummary(
        { ...MEMPHIS, include: ['current'] },
        noaa as unknown as NOAAService,
        support.openMeteo as unknown as OpenMeteoService,
        support.ncei as unknown as NCEIService,
        support.locationStore as unknown as LocationStore,
        support.geocoding as unknown as GeocodingService
      );
      const line = extract(textOf(result), TIME_LINE);

      expect(line).toMatch(/ C[SD]T \(/);
      expect(line.split(' (')[0]).toBe(expectedClock(OBS_ISO, 'America/Chicago'));
    });
  });

  describe('METAR path is unchanged', () => {
    it('keeps the formatInTimezone + getTimezoneAbbreviation construction on **Observed:**', async () => {
      const obsTime = Math.round((NOW.getTime() - 20 * 60_000) / 1000);
      const nowIso = NOW.toISOString();
      const metar: MetarObservation = {
        icaoId: 'KSEA',
        name: 'Seattle-Tacoma Intl',
        lat: SEATTLE.latitude + 0.01,
        lon: SEATTLE.longitude + 0.01,
        elev: 130,
        obsTime,
        reportTime: nowIso,
        receiptTime: nowIso,
        rawOb: 'METAR KSEA 280650Z 19006KT 10SM FEW250 20/10 A3000',
        metarType: 'METAR',
        qcField: 0,
        temp: 20,
        dewp: 10,
        wdir: 190,
        wspd: 6,
        wgst: 18,
        altim: 1015,
        slp: 1016,
        visib: 10,
        clouds: [{ cover: 'FEW', base: 25000 }],
        fltCat: 'VFR',
        wxString: 'BR',
      } as MetarObservation;
      const aviation = { getMetarsInBoundingBox: vi.fn().mockResolvedValue([metar]) };

      const text = textOf(
        await callHandler({ ...SEATTLE, source: 'metar' }, {}, buildSupportFakes(), aviation)
      );
      const line = extract(text, /^\*\*Observed:\*\* (.+)$/m);

      const zone = guessTimezoneFromCoords(metar.lat, metar.lon);
      const iso = new Date(obsTime * 1000).toISOString();
      const expected = norm(
        `${formatInTimezone(iso, zone, 'medium', '12h')} ${getTimezoneAbbreviation(zone, new Date(obsTime * 1000))} (20 minutes ago)`
      );
      expect(line).toBe(expected);
    });
  });
});
