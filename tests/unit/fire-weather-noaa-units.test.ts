/**
 * NOAA fire-weather mixing height and transport wind (RF-29, M12/M13).
 *
 * NWS publishes `mixingHeight` in metres and `transportWindSpeed` in km/h, as
 * start/duration intervals whose first entry is the start of the forecast
 * period, not the present. The section must read the interval that contains
 * the request time, convert from the published `uom`, and band on the number
 * it prints. Display stays feet and mph for every caller (docs/TOOLS.md).
 *
 * Fakes are copied from current-conditions-band-coherence.test.ts, not
 * imported. Every validTime is built relative to the faked NOW in the live
 * shape `<ISO>+00:00/<duration>`. Expected strings were produced by running
 * the handler first, then checked against the arithmetic (G36).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ObservationResponse, StationCollectionResponse, GridpointResponse } from '../../src/types/noaa.js';
import { formatMixingHeight, interpretTransportWind } from '../../src/utils/fireWeather.js';
import { logger } from '../../src/utils/logger.js';

/** Washington, DC — inside the US routing boxes, so auto routes to NOAA. */
const US_COORDS = { latitude: 38.8951, longitude: -77.0364 };

const NOW_MS = Date.parse('2026-11-14T21:00:00Z');
const HOUR = 3_600_000;

/** A live-shaped validTime: `<ISO with +00:00>/<duration>`. */
function vt(offsetMs: number, duration: string): string {
  return `${new Date(NOW_MS + offsetMs).toISOString().replace('.000Z', '+00:00')}/${duration}`;
}

interface Entry { validTime: string; value: number | null }
interface Series { uom?: string; values: Entry[] }

function buildObservation(timestamp = new Date(NOW_MS - 30 * 60_000).toISOString()): ObservationResponse {
  return {
    properties: {
      '@id': 'https://api.weather.gov/stations/KAAA/observations/x',
      '@type': 'wx:ObservationStation',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      station: 'https://api.weather.gov/stations/KAAA',
      timestamp,
      textDescription: 'Clear',
      temperature: { unitCode: 'wmoUnit:degF', value: 68 },
      dewpoint: { unitCode: 'wmoUnit:degF', value: 50 },
      windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 270 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 10 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
      visibility: { unitCode: 'wmoUnit:m', value: 16090 },
    },
  } as unknown as ObservationResponse;
}

function buildStations(): StationCollectionResponse {
  return {
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          '@id': 'https://api.weather.gov/stations/KAAA',
          '@type': 'wx:ObservationStation',
          elevation: { unitCode: 'wmoUnit:m', value: 10 },
          stationIdentifier: 'KAAA',
          name: 'Alpha Field',
          timeZone: 'America/New_York',
        },
      },
    ] as unknown as StationCollectionResponse['features'],
  };
}

function buildGridpoint(props: { mixingHeight?: Series; transportWindSpeed?: Series }): GridpointResponse {
  return { properties: { ...props } } as unknown as GridpointResponse;
}

async function render(
  gridpoint: GridpointResponse,
  args: Record<string, unknown> = {},
  observation: ObservationResponse = buildObservation()
): Promise<string> {
  const noaa = {
    getStations: vi.fn().mockResolvedValue(buildStations()),
    getLatestObservation: vi.fn().mockResolvedValue(observation),
    getGridpointDataByCoordinates: vi.fn().mockResolvedValue(gridpoint),
  };
  const result = await handleGetCurrentConditions(
    { ...US_COORDS, include_fire_weather: true, ...args },
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

/** Stale first interval (the start of the forecast period), then the current one. */
const MIXING_STALE_THEN_CURRENT: Series = {
  uom: 'wmoUnit:m',
  values: [
    { validTime: vt(-9 * HOUR, 'PT8H'), value: 149.9616 },
    { validTime: vt(-1 * HOUR, 'PT2H'), value: 732.1296 },
    { validTime: vt(1 * HOUR, 'PT1H'), value: 900 },
  ],
};

/** Current value in a P1DT6H interval that started yesterday. */
const TRANSPORT_LONG_INTERVAL: Series = {
  uom: 'wmoUnit:km_h-1',
  values: [{ validTime: vt(-20 * HOUR, 'P1DT6H'), value: 25.928 }],
};

describe('get_current_conditions — NOAA mixing height and transport wind', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    warnSpy = vi.spyOn(logger, 'warn');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('(a) reads the interval containing now and converts metres to feet', async () => {
    const text = await render(buildGridpoint({ mixingHeight: MIXING_STALE_THEN_CURRENT }));
    expect(text).toContain('**Mixing Height:** 2402 ft (poor dispersion)\n');
    expect(text).not.toContain('150 ft');
  });

  it('(b) reads an in-progress multi-day interval and converts km/h to mph', async () => {
    const text = await render(buildGridpoint({ transportWindSpeed: TRANSPORT_LONG_INTERVAL }));
    expect(text).toContain('**Transport Wind:** 16 mph (good smoke transport)\n');
  });

  it('(c) metric callers get the same feet and mph lines, by policy', async () => {
    const gridpoint = buildGridpoint({
      mixingHeight: MIXING_STALE_THEN_CURRENT,
      transportWindSpeed: TRANSPORT_LONG_INTERVAL,
    });
    const text = await render(gridpoint, { units: 'metric' });
    expect(text).toContain('**Mixing Height:** 2402 ft (poor dispersion)\n');
    expect(text).toContain('**Transport Wind:** 16 mph (good smoke transport)\n');
  });

  it('(d) an absent uom omits the line and warns once', async () => {
    const { uom: _drop, ...noUom } = MIXING_STALE_THEN_CURRENT;
    void _drop;
    const text = await render(buildGridpoint({ mixingHeight: noUom }));
    expect(text).not.toContain('Mixing Height');
    expect(text).not.toContain('Atmospheric Monitoring');
    const unitWarns = warnSpy.mock.calls.filter(c => c[0] === 'Unrecognised gridpoint unit; line omitted');
    expect(unitWarns).toEqual([['Unrecognised gridpoint unit; line omitted', { field: 'mixingHeight', uom: null }]]);
  });

  it('(e) an unrecognised uom omits the line and warns once', async () => {
    const text = await render(
      buildGridpoint({ transportWindSpeed: { ...TRANSPORT_LONG_INTERVAL, uom: 'wmoUnit:ft' } })
    );
    expect(text).not.toContain('Transport Wind');
    const unitWarns = warnSpy.mock.calls.filter(c => c[0] === 'Unrecognised gridpoint unit; line omitted');
    expect(unitWarns).toEqual([
      ['Unrecognised gridpoint unit; line omitted', { field: 'transportWindSpeed', uom: 'wmoUnit:ft' }],
    ]);
  });

  it('(f) every interval already ended: no lines, no header, the no-data line, no unit warn', async () => {
    const ended = (uom: string, value: number): Series => ({
      uom,
      values: [{ validTime: vt(-3 * HOUR, 'PT2H'), value }],
    });
    const text = await render(
      buildGridpoint({ mixingHeight: ended('wmoUnit:m', 500), transportWindSpeed: ended('wmoUnit:km_h-1', 20) })
    );
    expect(text).not.toContain('Mixing Height');
    expect(text).not.toContain('Transport Wind');
    expect(text).not.toContain('Atmospheric Monitoring');
    expect(text).toContain('No atmospheric monitoring data available for this location.');
    expect(warnSpy.mock.calls.filter(c => c[0] === 'Unrecognised gridpoint unit; line omitted')).toEqual([]);
  });

  it('(g) selects by the request time, not the observation timestamp', async () => {
    const series: Series = {
      uom: 'wmoUnit:m',
      values: [
        { validTime: vt(-3 * HOUR, 'PT2H'), value: 100 },
        { validTime: vt(-1 * HOUR, 'PT2H'), value: 732.1296 },
      ],
    };
    const observation = buildObservation(new Date(NOW_MS - 2 * HOUR).toISOString());
    const text = await render(buildGridpoint({ mixingHeight: series }), {}, observation);
    expect(text).toContain('**Mixing Height:** 2402 ft (poor dispersion)\n');
  });

  it('(h) bands on the rounded, converted figure through the handler', async () => {
    const one = (uom: string, value: number): Series => ({
      uom,
      values: [{ validTime: vt(-1 * HOUR, 'PT2H'), value }],
    });
    // 304.678 m = 999.596 ft → 1000 ft → poor
    expect(await render(buildGridpoint({ mixingHeight: one('wmoUnit:m', 304.678) }))).toContain(
      '**Mixing Height:** 1000 ft (poor dispersion)\n'
    );
    // 304.556 m = 999.196 ft → 999 ft → very poor
    expect(await render(buildGridpoint({ mixingHeight: one('wmoUnit:m', 304.556) }))).toContain(
      '**Mixing Height:** 999 ft (very poor dispersion)\n'
    );
    // 7.9728 km/h = 4.954 mph → 5 mph → moderate
    expect(await render(buildGridpoint({ transportWindSpeed: one('wmoUnit:km_h-1', 7.9728) }))).toContain(
      '**Transport Wind:** 5 mph (moderate smoke transport)\n'
    );
  });
});

describe('formatMixingHeight / interpretTransportWind band on the printed number', () => {
  it.each([
    [999.6, '1000 ft (poor dispersion)'],
    [999.4, '999 ft (very poor dispersion)'],
    [2999.6, '3000 ft (moderate dispersion)'],
    [2999.4, '2999 ft (poor dispersion)'],
    [5999.6, '6000 ft (good dispersion)'],
    [5999.4, '5999 ft (moderate dispersion)'],
  ])('formatMixingHeight(%s) → %s', (ft, expected) => {
    expect(formatMixingHeight(ft)).toBe(expected);
  });

  it.each([
    [4.6, '5 mph (moderate smoke transport)'],
    [4.4, '4 mph (light - poor smoke transport)'],
    [14.6, '15 mph (good smoke transport)'],
    [14.4, '14 mph (moderate smoke transport)'],
    [24.6, '25 mph (strong - rapid fire spread potential)'],
    [24.4, '24 mph (good smoke transport)'],
  ])('interpretTransportWind(%s) → %s', (mph, expected) => {
    expect(interpretTransportWind(mph)).toBe(expected);
  });
});
