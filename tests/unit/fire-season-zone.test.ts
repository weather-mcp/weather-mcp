/**
 * The fire-season month is the location's month, not the server's (G162).
 *
 * 2026-11-01T02:00:00Z is 19:00 on 31 October in Los Angeles: October, inside
 * the western fire season. Read in a UTC or Auckland server zone it is
 * November, and the winter branch wins. Each row switches `process.env.TZ` at
 * runtime and asserts a sentinel so a switch that silently failed cannot make
 * the row vacuous.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFireWeatherContext } from '../../src/utils/fireWeather.js';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ObservationResponse, StationCollectionResponse, GridpointResponse } from '../../src/types/noaa.js';

const LA = { latitude: 34.05, longitude: -118.24 };
const INSTANT = '2026-11-01T02:00:00Z';

const originalTZ = process.env.TZ;

function setZone(zone: string): void {
  process.env.TZ = zone;
}

afterEach(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

/** Server-zone sentinels: 2024-03-05 is a UTC midnight, so west of UTC it is the 4th. */
function expectZoneTookEffect(zone: string): void {
  const day = new Date('2024-03-05').getDate();
  if (zone === 'America/New_York') expect(day).toBe(4);
  else expect(day).toBe(5);
}

const ZONES = ['UTC', 'America/New_York', 'Pacific/Auckland'];

describe('getFireWeatherContext — month from the location zone', () => {
  for (const zone of ZONES) {
    it(`an LA late-October evening is October under a ${zone} server`, () => {
      setZone(zone);
      expectZoneTookEffect(zone);
      const ctx = getFireWeatherContext(LA.latitude, LA.longitude, INSTANT, 'America/Los_Angeles', null, null, null, 30);
      expect(ctx.reason).toBe('Favorable conditions');
      expect(ctx.seasonalRisk).toBe('Moderate');
    });
  }

  it('control: the same instant read in UTC is November', () => {
    setZone('America/New_York');
    expectZoneTookEffect('America/New_York');
    const ctx = getFireWeatherContext(LA.latitude, LA.longitude, INSTANT, 'UTC', null, null, null, 30);
    expect(ctx.reason).toBe('Winter/low fire season');
  });

  it('an unparseable timestamp falls to the shoulder-season branch', () => {
    const ctx = getFireWeatherContext(LA.latitude, LA.longitude, 'not-a-date', 'America/Los_Angeles', null, null, null, 30);
    expect(ctx.reason).toBe('Seasonal conditions');
  });
});

describe('get_current_conditions — fire-season month through the handler', () => {
  const NOW_MS = Date.parse('2026-11-01T02:10:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function render(): Promise<string> {
    const observation = {
      properties: {
        '@id': 'https://api.weather.gov/stations/KLAX/observations/x',
        '@type': 'wx:ObservationStation',
        elevation: { unitCode: 'wmoUnit:m', value: 10 },
        station: 'https://api.weather.gov/stations/KLAX',
        timestamp: '2026-11-01T02:00:00+00:00',
        textDescription: 'Clear',
        temperature: { unitCode: 'wmoUnit:degF', value: 68 },
        dewpoint: { unitCode: 'wmoUnit:degF', value: 50 },
        windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 270 },
        windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 10 },
        relativeHumidity: { unitCode: 'wmoUnit:percent', value: 30 },
        visibility: { unitCode: 'wmoUnit:m', value: 16090 },
      },
    } as unknown as ObservationResponse;
    const stations = {
      type: 'FeatureCollection',
      features: [
        {
          properties: {
            '@id': 'https://api.weather.gov/stations/KLAX',
            '@type': 'wx:ObservationStation',
            elevation: { unitCode: 'wmoUnit:m', value: 10 },
            stationIdentifier: 'KLAX',
            name: 'Los Angeles Intl',
            timeZone: 'America/Los_Angeles',
          },
        },
      ],
    } as unknown as StationCollectionResponse;
    const noaa = {
      getStations: vi.fn().mockResolvedValue(stations),
      getLatestObservation: vi.fn().mockResolvedValue(observation),
      getGridpointDataByCoordinates: vi.fn().mockResolvedValue({ properties: {} } as unknown as GridpointResponse),
    };
    const result = await handleGetCurrentConditions(
      { ...LA, include_fire_weather: true },
      noaa as unknown as NOAAService,
      {
        getCurrentConditions: vi.fn(),
        getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
      } as unknown as OpenMeteoService,
      { isAvailable: vi.fn().mockReturnValue(false) } as unknown as NCEIService,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService
    );
    return result.content.map((b: { text?: string }) => b.text ?? '').join('\n');
  }

  for (const zone of ZONES) {
    it(`reads the station zone's October under a ${zone} server`, async () => {
      setZone(zone);
      expectZoneTookEffect(zone);
      const text = await render();
      expect(text).toContain('🟡 **Seasonal Fire Risk:** Moderate');
    });
  }
});
