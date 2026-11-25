/**
 * An NWS office that publishes no wave forecast for a gridpoint fills the
 * series with 0, not with an empty series. The NOAA marine reader treats an
 * all-zero height or direction series as "not forecast" (D1), a period that
 * displays as 0.0 s as absent (D2), and no height as no NOAA report (D3), so
 * the handler answers from Open-Meteo instead of printing a calm sea.
 *
 * Two layers, so every mutation is reachable (G45): reader rows call
 * extractNOAAMarineConditions with an injected clock (G67); handler rows call
 * handleGetMarineConditions with mocked services (G70, the seam
 * marine-render-parity uses) and freeze only `Date`, because the handler reads
 * `Date.now()` (G133). Builders take every field explicitly (G95). Synthetic
 * shapes are the live shapes measured in the design plan (G48); the "kills"
 * note on each row names the mutation that turns it red.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractNOAAMarineConditions } from '../../src/utils/marine.js';
import { handleGetMarineConditions } from '../../src/handlers/marineConditionsHandler.js';
import { logger } from '../../src/utils/logger.js';
import type { GridpointResponse, GridpointDataSeries } from '../../src/types/noaa.js';
import type { OpenMeteoMarineResponse } from '../../src/types/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);

const M = 'wmoUnit:m';
const S = 'nwsUnit:s';
const DEG = 'wmoUnit:degree_(angle)';

type Field = 'waveHeight' | 'wavePeriod' | 'waveDirection' | 'windSpeed' | 'windGust' | 'windDirection';

interface Span {
  startMs: number;
  hours: number;
  value: number | null;
}

function span(startMs: number, hours: number, value: number | null): Span {
  return { startMs, hours, value };
}

function series(uom: string | undefined, spans: Span[]): GridpointDataSeries {
  return {
    ...(uom === undefined ? {} : { uom }),
    values: spans.map(s => ({
      validTime: `${new Date(s.startMs).toISOString()}/PT${s.hours}H`,
      value: s.value
    }))
  };
}

/** A gridpoint carrying exactly the series passed; nothing is defaulted. */
function gridpoint(fields: Partial<Record<Field, GridpointDataSeries>>): GridpointResponse {
  return {
    properties: {
      updateTime: '2026-11-25T08:00:00+00:00',
      validTimes: '2026-11-25T02:00:00+00:00/P7D',
      ...fields
    }
  } as unknown as GridpointResponse;
}

/** Two distinct values: `stale` over [NOW-8h, NOW-2h), `current` over [NOW-2h, NOW+4h). */
function varying(uom: string, stale: number, current: number): GridpointDataSeries {
  return series(uom, [span(NOW - 8 * HOUR, 6, stale), span(NOW - 2 * HOUR, 6, current)]);
}

function captured(name: string): GridpointResponse {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/nws-gridpoint-${name}.json`, import.meta.url), 'utf8')
  ) as GridpointResponse;
}

// --- handler seam -----------------------------------------------------------

const getMarineMock = vi.fn();
const getStationsMock = vi.fn();
const getGridpointDataMock = vi.fn();
const noaaService = {
  getStations: getStationsMock,
  getGridpointDataByCoordinates: getGridpointDataMock
} as never;
const openMeteoService = { getMarine: getMarineMock } as never;

// Lake Michigan: inside a NOAA region box, so the handler tries the gridpoint first.
const LAKE_MICHIGAN = { latitude: 43.0, longitude: -86.0 };

const OPEN_METEO_CURRENT = {
  latitude: LAKE_MICHIGAN.latitude,
  longitude: LAKE_MICHIGAN.longitude,
  generationtime_ms: 0.5,
  utc_offset_seconds: 0,
  timezone: 'America/Detroit',
  timezone_abbreviation: 'EST',
  elevation: 0,
  current: { time: '2026-11-25T07:00', interval: 3600, wave_height: 1.0, wave_direction: 200, wave_period: 6.0 }
} as OpenMeteoMarineResponse;

const NOAA_SOURCE = '*Data source: NOAA National Weather Service*';
const OM_DISCLAIMER = '**NOT suitable for coastal navigation.**';

async function render(gp: GridpointResponse, atMs: number): Promise<string> {
  vi.setSystemTime(atMs);
  getGridpointDataMock.mockResolvedValue(gp);
  const result = await handleGetMarineConditions(
    LAKE_MICHIGAN,
    noaaService,
    openMeteoService,
    {} as LocationStore,
    {} as GeocodingService
  );
  return result.content[0].text;
}

function expectOpenMeteoReport(text: string): void {
  expect(text).toContain(OM_DISCLAIMER);
  expect(text).not.toContain(NOAA_SOURCE);
  expect(getMarineMock).toHaveBeenCalledTimes(1);
}

function expectNoaaReport(text: string): void {
  expect(text).toContain(NOAA_SOURCE);
  expect(getMarineMock).not.toHaveBeenCalled();
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  getStationsMock.mockRejectedValue(new Error('no station coverage'));
  getMarineMock.mockResolvedValue(OPEN_METEO_CURRENT);
});

afterEach(() => {
  vi.useRealTimers();
  warnSpy.mockRestore();
  infoSpy.mockRestore();
});

// --- 1: an all-zero height series is not forecast ----------------------------

describe('an all-zero height series falls through to Open-Meteo', () => {
  it('1a one interval of zero (kills: three-field gate)', async () => {
    const gp = gridpoint({
      waveHeight: series(M, [span(NOW - HOUR, 7, 0)]),
      wavePeriod: varying(S, 8, 9)
    });
    expect(extractNOAAMarineConditions(gp, NOW)).toBeNull();
    expectOpenMeteoReport(await render(gp, NOW));
  });

  it('1b four intervals of zero, the TBW shape (kills: interval-count rule)', async () => {
    const gp = gridpoint({
      waveHeight: series(M, [
        span(NOW - 8 * HOUR, 6, 0),
        span(NOW - 2 * HOUR, 6, 0),
        span(NOW + 4 * HOUR, 6, 0),
        span(NOW + 10 * HOUR, 6, 0)
      ]),
      wavePeriod: varying(S, 8, 9)
    });
    expect(extractNOAAMarineConditions(gp, NOW)).toBeNull();
    expectOpenMeteoReport(await render(gp, NOW));
  });
});

// --- 2: a zero inside a varying height series is a reading --------------------

describe('a zero inside a varying height series is a reading', () => {
  it('2 bands as Calm on the NOAA report (kills: any-zero-at-now rule)', async () => {
    const text = await render(gridpoint({ waveHeight: varying(M, 0.6, 0), wavePeriod: varying(S, 8, 9) }), NOW);
    expectNoaaReport(text);
    expect(text).toContain('🟢 Current Conditions: Calm');
    expect(text).toContain('**Significant Wave Height:** 0.0m (0.0ft)');
  });
});

// --- 3: a period that displays as 0.0 s is absent -----------------------------

describe('a wave period that displays as 0.0 s is absent', () => {
  it('3a all-zero period, real height (kills: period rule removed)', async () => {
    const text = await render(
      gridpoint({ waveHeight: varying(M, 1.4, 1.2), wavePeriod: series(S, [span(NOW - 8 * HOUR, 12, 0)]) }),
      NOW
    );
    expectNoaaReport(text);
    expect(text).toContain('**Significant Wave Height:** 1.2m');
    expect(text).not.toContain('**Wave Period:**');
    expect(text).not.toContain('choppy (short period)');
  });

  it('3b zero at now inside a varying period (kills: whole-series period rule)', async () => {
    const text = await render(gridpoint({ waveHeight: varying(M, 1.4, 1.2), wavePeriod: varying(S, 5, 0) }), NOW);
    expectNoaaReport(text);
    expect(text).not.toContain('**Wave Period:**');
    expect(text).not.toContain('choppy (short period)');
  });

  it('3c a period of 0.04 s displays as 0.0 and is absent (kills: raw === 0)', () => {
    const result = extractNOAAMarineConditions(
      gridpoint({ waveHeight: varying(M, 1.4, 1.2), wavePeriod: varying(S, 5, 0.04) }),
      NOW
    );
    expect(result).not.toBeNull();
    expect(result?.wavePeriod).toBeUndefined();
  });

  it('3d a real short period is still choppy (positive control: over-broad period rule)', async () => {
    const text = await render(gridpoint({ waveHeight: varying(M, 1.4, 1.2), wavePeriod: varying(S, 7, 5) }), NOW);
    expectNoaaReport(text);
    expect(text).toContain('and choppy (short period)');
    expect(text).toContain('**Wave Period:** 5.0s');
  });
});

// --- 4: direction ------------------------------------------------------------

describe('wave direction', () => {
  it('4a an all-zero direction series prints no direction (kills: direction rule removed)', async () => {
    const text = await render(
      gridpoint({ waveHeight: varying(M, 1.4, 1.2), waveDirection: series(DEG, [span(NOW - 8 * HOUR, 12, 0)]) }),
      NOW
    );
    expectNoaaReport(text);
    expect(text).not.toContain('**Wave Direction:**');
  });

  it('4b a zero inside a varying direction series is north (kills: any-zero rule on direction)', async () => {
    const text = await render(gridpoint({ waveHeight: varying(M, 1.4, 1.2), waveDirection: varying(DEG, 90, 0) }), NOW);
    expectNoaaReport(text);
    expect(text).toContain('**Wave Direction:** N (0°)');
  });
});

// --- 5: no height, no NOAA report ---------------------------------------------

describe('no wave height means no NOAA report', () => {
  it('5a period and direction present, height series absent (kills: three-field gate)', async () => {
    const gp = gridpoint({ wavePeriod: varying(S, 8, 9), waveDirection: varying(DEG, 200, 210) });
    expect(extractNOAAMarineConditions(gp, NOW)).toBeNull();
    const text = await render(gp, NOW);
    expectOpenMeteoReport(text);
    expect(text).not.toContain('Current Conditions: Unknown');
  });

  it('5b a gap in the height series at now (kills: three-field gate)', () => {
    const gp = gridpoint({
      waveHeight: series(M, [span(NOW - 8 * HOUR, 6, 1.0), span(NOW + HOUR, 4, 1.2)]),
      wavePeriod: varying(S, 8, 9),
      waveDirection: varying(DEG, 200, 210)
    });
    expect(extractNOAAMarineConditions(gp, NOW)).toBeNull();
  });

  it('5c a height under a wrong unit (kills: three-field gate)', () => {
    const gp = gridpoint({
      waveHeight: series('wmoUnit:ft', [span(NOW - 8 * HOUR, 6, 2.0), span(NOW - 2 * HOUR, 6, 1.0)]),
      wavePeriod: varying(S, 8, 9)
    });
    expect(extractNOAAMarineConditions(gp, NOW)).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('Unrecognised gridpoint unit; line omitted', {
      field: 'waveHeight',
      uom: 'wmoUnit:ft'
    });
  });

  it('5d an all-zero height under a wrong unit is absent with no unit warn (kills: readAt before isAllZero)', () => {
    const gp = gridpoint({
      waveHeight: series('wmoUnit:ft', [span(NOW - 8 * HOUR, 6, 0), span(NOW - 2 * HOUR, 6, 0)]),
      wavePeriod: varying(S, 8, 9)
    });
    expect(extractNOAAMarineConditions(gp, NOW)).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// --- 6: captured NWS gridpoints ------------------------------------------------

describe('captured NWS gridpoints', () => {
  // Captured 2026-11-25T16:05Z from https://api.weather.gov/gridpoints/MTR/87,106
  // (San Francisco Bay), trimmed to updateTime, validTimes and the six marine
  // series (G79). Height: one interval of 0 (2026-11-25T04:00/P7DT2H). Period:
  // 0, then 14 over 2026-11-28T12:00/PT6H, then 0. The clock sits at
  // 2026-11-28T14:00Z, inside the 14 s period interval, so a restored
  // three-field gate would print a NOAA report with no height.
  it('6a MTR/87,106 falls through to Open-Meteo (kills: three-field gate)', async () => {
    expectOpenMeteoReport(await render(captured('MTR-87-106'), Date.parse('2026-11-28T14:00:00Z')));
  });

  // Captured 2026-11-25T16:05Z from https://api.weather.gov/gridpoints/AKQ/89,58
  // (Hampton Roads / lower Chesapeake). Height varies; period and direction are
  // one interval of 0 each. The clock sits at 2026-11-25T12:00Z, inside the
  // height interval 2026-11-25T02:00/PT18H = 1.2192 m (1.2 m, 4.0 ft).
  it('6b AKQ/89,58 prints the containing height and no period or direction (kills: period/direction rules removed)', async () => {
    const text = await render(captured('AKQ-89-58'), Date.parse('2026-11-25T12:00:00Z'));
    expectNoaaReport(text);
    expect(text).toContain('**Significant Wave Height:** 1.2m (4.0ft)');
    expect(text).not.toContain('**Wave Period:**');
    expect(text).not.toContain('**Wave Direction:**');
    expect(text).not.toContain('choppy');
  });

  // Captured 2026-11-25T16:05Z from https://api.weather.gov/gridpoints/TBW/71,98
  // (Tampa Bay). Height and period are four intervals of 0 each (P6D, then three
  // PT1H). The clock sits at 2026-11-25T12:00Z, inside 2026-11-25T01:00/P6D.
  it('6c TBW/71,98 falls through to Open-Meteo (kills: interval-count rule)', async () => {
    expectOpenMeteoReport(await render(captured('TBW-71-98'), Date.parse('2026-11-25T12:00:00Z')));
  });
});
