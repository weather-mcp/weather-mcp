/**
 * The NOAA marine reader reads each gridpoint series at the interval that
 * contains the request time, under its published unit (GOTCHAS G163).
 *
 * Before this file, `extractNOAAMarineConditions` returned the first non-null
 * value of each series: the start of the forecast period, 7 to 13 hours old.
 * One row per rejected alternative; the "kills" note on each names the
 * mutation that row turns red.
 *
 * I/O-free. The reader takes `nowMs` as an argument, so every row injects its
 * own clock (G67) and no fake timers are needed. Builders take every field
 * explicitly, with no default parameters (G95): a field left out is absent,
 * exactly as an omitted key is absent from a real gridpoint response.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractNOAAMarineConditions } from '../../src/utils/marine.js';
import { handleGetMarineConditions } from '../../src/handlers/marineConditionsHandler.js';
import { logger } from '../../src/utils/logger.js';
import type { GridpointResponse, GridpointDataSeries } from '../../src/types/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

const HOUR = 3_600_000;
// Any fixed instant; every interval below is placed relative to it.
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

const M = 'wmoUnit:m';
const S = 'nwsUnit:s';
const DEG = 'wmoUnit:degree_(angle)';
const KMH = 'wmoUnit:km_h-1';

type Field = 'waveHeight' | 'wavePeriod' | 'waveDirection' | 'windSpeed' | 'windGust' | 'windDirection';

/** One `[startMs, startMs + hours)` interval with its value. */
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
      updateTime: '2026-11-24T08:00:00+00:00',
      validTimes: '2026-11-24T02:00:00+00:00/P7D',
      ...fields
    }
  } as unknown as GridpointResponse;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('extractNOAAMarineConditions reads the interval that contains now', () => {
  it('returns the value of the containing interval, not the first one (kills: first non-null)', () => {
    const two = (uom: string, stale: number, current: number) =>
      series(uom, [span(NOW - 8 * HOUR, 6, stale), span(NOW - 2 * HOUR, 6, current)]);
    const result = extractNOAAMarineConditions(
      gridpoint({
        waveHeight: two(M, 2.1, 0.9),
        wavePeriod: two(S, 7, 5),
        waveDirection: two(DEG, 330, 300),
        windSpeed: two(KMH, 40, 13),
        windGust: two(KMH, 44, 18),
        windDirection: two(DEG, 320, 290)
      }),
      NOW
    );
    expect(result).toMatchObject({
      waveHeight: 0.9,
      wavePeriod: 5,
      waveDirection: 300,
      windSpeed: 13,
      windGust: 18,
      windDirection: 290
    });
  });

  it('reads a long interval that started before now (kills: start-only filter, start >= now)', () => {
    const long = (uom: string, v: number) => series(uom, [span(NOW - 30 * HOUR, 48, v)]);
    const result = extractNOAAMarineConditions(
      gridpoint({ waveHeight: long(M, 1.2), wavePeriod: long(S, 6), waveDirection: long(DEG, 250) }),
      NOW
    );
    expect(result).toMatchObject({ waveHeight: 1.2, wavePeriod: 6, waveDirection: 250 });
  });

  it('treats a gap at now as absent, with no nearest-interval fallback (kills: fallback)', () => {
    const gapped = (uom: string) => series(uom, [span(NOW - 8 * HOUR, 6, 1.5), span(NOW + HOUR, 4, 2.5)]);
    const result = extractNOAAMarineConditions(
      gridpoint({ waveHeight: gapped(M), wavePeriod: gapped(S), waveDirection: gapped(DEG) }),
      NOW
    );
    expect(result).toBeNull();
    // An absent value is not a unit problem: nothing warns.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('leaves one gapped field absent while the others read', () => {
    const result = extractNOAAMarineConditions(
      gridpoint({
        waveHeight: series(M, [span(NOW - HOUR, 3, 1.1)]),
        wavePeriod: series(S, [span(NOW - 8 * HOUR, 6, 9), span(NOW + HOUR, 4, 8)])
      }),
      NOW
    );
    expect(result).not.toBeNull();
    expect(result?.waveHeight).toBe(1.1);
    expect(result?.wavePeriod).toBeUndefined();
  });

  it('reads zero as a value (kills: falsy check)', () => {
    const result = extractNOAAMarineConditions(
      gridpoint({ waveHeight: series(M, [span(NOW - 5 * HOUR, 4, 0.6), span(NOW - HOUR, 2, 0)]) }),
      NOW
    );
    expect(result).not.toBeNull();
    expect(result?.waveHeight).toBe(0);
  });

  it('omits a value under a wrong or missing unit and warns once per field (kills: removed unit check)', () => {
    const here = (uom: string | undefined, v: number) => series(uom, [span(NOW - HOUR, 2, v)]);
    const result = extractNOAAMarineConditions(
      gridpoint({
        waveHeight: here(M, 3),
        wavePeriod: here('nwsUnit:min', 6),
        waveDirection: here(DEG, 200),
        windSpeed: here(undefined, 20),
        windGust: here(KMH, 30),
        windDirection: here(DEG, 210)
      }),
      NOW
    );
    expect(result?.wavePeriod).toBeUndefined();
    expect(result?.windSpeed).toBeUndefined();
    expect(result).toMatchObject({ waveHeight: 3, waveDirection: 200, windGust: 30, windDirection: 210 });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith('Unrecognised gridpoint unit; line omitted', {
      field: 'wavePeriod',
      uom: 'nwsUnit:min'
    });
    expect(warnSpy).toHaveBeenCalledWith('Unrecognised gridpoint unit; line omitted', {
      field: 'windSpeed',
      uom: null
    });
  });

  it('reads every field at the same instant, each from its own interval (kills: per-field clocks)', () => {
    const result = extractNOAAMarineConditions(
      gridpoint({
        // boundary exactly at now
        waveHeight: series(M, [span(NOW - 3 * HOUR, 3, 9), span(NOW, 3, 1)]),
        // boundary an hour after now
        wavePeriod: series(S, [span(NOW - 2 * HOUR, 3, 5), span(NOW + HOUR, 3, 9)]),
        // boundary an hour before now
        waveDirection: series(DEG, [span(NOW - 4 * HOUR, 3, 100), span(NOW - HOUR, 3, 200)]),
        windSpeed: series(KMH, [span(NOW - 5 * HOUR, 4, 50), span(NOW - HOUR, 2, 20)]),
        windGust: series(KMH, [span(NOW - 2 * HOUR, 4, 30), span(NOW + 2 * HOUR, 2, 60)]),
        windDirection: series(DEG, [span(NOW - 6 * HOUR, 6, 10), span(NOW, 1, 20)])
      }),
      NOW
    );
    expect(result).toMatchObject({
      waveHeight: 1,
      wavePeriod: 5,
      waveDirection: 200,
      windSpeed: 20,
      windGust: 30,
      windDirection: 20
    });
  });

  it('treats an interval end as exclusive (kills: <= on the end)', () => {
    const result = extractNOAAMarineConditions(
      gridpoint({ waveHeight: series(M, [span(NOW - 2 * HOUR, 2, 3), span(NOW, 2, 1)]) }),
      NOW
    );
    expect(result?.waveHeight).toBe(1);
  });
});

describe('extractNOAAMarineConditions on a captured NWS gridpoint', () => {
  // Captured 2026-11-24T17:49Z from https://api.weather.gov/gridpoints/DTX/74,149
  // (Lake Huron, 44.8, -82.5), trimmed to updateTime, validTimes and the six
  // marine series (G79). NOW_CAPTURE sits inside these intervals:
  //   waveHeight    2026-11-24T16:00/PT3H  0.6096   (first: 2.1336)
  //   wavePeriod    2026-11-24T15:00/PT5H  5        (first: 7)
  //   waveDirection 2026-11-24T08:00/PT13H 330      (first: 330)
  //   windSpeed     2026-11-24T17:00/PT3H  12.964   (first: 40.744)
  //   windGust      2026-11-24T16:00/PT2H  18.52    (first: 44.448)
  //   windDirection 2026-11-24T17:00/PT1H  300      (first: 320)
  const NOW_CAPTURE = Date.parse('2026-11-24T17:30:00Z');
  const captured = JSON.parse(
    readFileSync(new URL('../fixtures/nws-gridpoint-DTX-74-149.json', import.meta.url), 'utf8')
  ) as GridpointResponse;

  it('the first value and the containing value differ, so this row can discriminate (G13)', () => {
    expect(captured.properties.waveHeight?.values[0]?.value).toBe(2.1336);
    expect(captured.properties.windSpeed?.values[0]?.value).toBe(40.744);
  });

  it('returns the values of the intervals that contain the request time', () => {
    expect(extractNOAAMarineConditions(captured, NOW_CAPTURE)).toEqual({
      waveHeight: 0.6096,
      wavePeriod: 5,
      waveDirection: 330,
      windSpeed: 12.964,
      windGust: 18.52,
      windDirection: 300,
      timestamp: '2026-11-24T08:24:07+00:00'
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('handleGetMarineConditions passes the request time to the NOAA reader', () => {
  const getGridpointDataMock = vi.fn();
  const noaaService = {
    getStations: vi.fn().mockRejectedValue(new Error('no station coverage')),
    getGridpointDataByCoordinates: getGridpointDataMock
  } as never;
  const openMeteoService = { getMarine: vi.fn() } as never;

  it('renders the current interval, not the stale first one', async () => {
    // Built from the real clock: the handler reads Date.now().
    const now = Date.now();
    getGridpointDataMock.mockResolvedValue(
      gridpoint({
        waveHeight: series(M, [span(now - 10 * HOUR, 6, 2.1), span(now - 4 * HOUR, 24, 0.9)]),
        wavePeriod: series(S, [span(now - 10 * HOUR, 6, 7), span(now - 4 * HOUR, 24, 5)])
      })
    );
    // Lake Michigan: routes to the NOAA path.
    const result = await handleGetMarineConditions(
      { latitude: 43.0, longitude: -86.0 },
      noaaService,
      openMeteoService,
      {} as LocationStore,
      {} as GeocodingService
    );
    const text = result.content.map(c => ('text' in c ? c.text : '')).join('\n');
    expect(text).toContain('**Significant Wave Height:** 0.9m');
    expect(text).not.toContain('2.1m');
    expect(text).toContain('**Wave Period:** 5');
  });
});
