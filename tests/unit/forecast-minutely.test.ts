/**
 * `get_forecast` at `granularity: "minutely"` — the 15-minute precipitation
 * nowcast (T3 of .devdocs/plan-minutely-nowcast-impl.md).
 *
 * Drives the real `handleGetForecast` with plain fake services, the idiom of
 * tests/unit/forecast-metno-fallback.test.ts: no HTTP, no mocked axios. The
 * seam under test is `openMeteoService.getNowcast`, faked to resolve a
 * `NowcastResult`. Fixtures are the 2026-10-01 live captures.
 *
 * The handler reads `Date.now()` to drop quarters that have ended, so every
 * test pins the clock (Date only — promises and timers stay real).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { criticalAlertBannerFromError } from '../../src/handlers/criticalAlertBanner.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService, NowcastResult } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { MetnoService } from '../../src/services/metno.js';
import type { OpenMeteoNowcastResponse } from '../../src/types/openmeteo.js';
import type { AlertCollectionResponse } from '../../src/types/noaa.js';
import { DataNotFoundError, ServiceUnavailableError } from '../../src/errors/ApiError.js';
import { formatLuxonTime } from '../../src/utils/unitFormat.js';
import { IMPERIAL_PREFERENCES, METRIC_PREFERENCES } from '../../src/config/units.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Michigan — inside the CONUS routing box, so `auto` would route to NOAA. */
const US_POINT = { latitude: 43.8195, longitude: -84.7686 };
/** Tokyo — outside both nowcast boxes. */
const TOKYO = { latitude: 35.6762, longitude: 139.6503 };

/** 2026-10-01T23:35:00Z = 19:35 EDT, inside the 19:30 local quarter. */
const NOW = Date.UTC(2026, 9, 1, 23, 35);

const DETROIT_TIMES = [
  '2026-10-01T19:30', '2026-10-01T19:45', '2026-10-01T20:00', '2026-10-01T20:15',
  '2026-10-01T20:30', '2026-10-01T20:45', '2026-10-01T21:00', '2026-10-01T21:15',
];

const NOT_COVERED_BLOCK =
  '# 15-Minute Precipitation Nowcast\n\n' +
  'No 15-minute precipitation model covers this location. Native 15-minute data is available only in the contiguous US and nearby Canada and Mexico (HRRR) and in Central Europe (ICON-D2). This is not a forecast of dry weather. Use granularity "hourly" for an hour-by-hour forecast here.\n\n' +
  '---\n' +
  '*Data source: Open-Meteo*\n';

const BANNER_FIRST_LINE = '🚨 **LIFE-THREATENING WEATHER ALERT IN EFFECT: Tornado Warning**';

const TORNADO_WARNING = {
  event: 'Tornado Warning',
  severity: 'Extreme',
  urgency: 'Immediate',
  certainty: 'Observed',
  response: 'Shelter',
  senderName: 'NWS Grand Rapids MI',
  expires: '2026-10-01T21:15:00-04:00',
};

function alertCollection(...features: Array<Record<string, unknown>>): AlertCollectionResponse {
  return {
    type: 'FeatureCollection',
    features: features.map(properties => ({ properties })) as unknown as AlertCollectionResponse['features'],
  };
}

/**
 * A covered HRRR response. Both series are required arguments with no
 * defaults (G95), so an "absent" probability fixture is really absent.
 */
function hrrrResponse(
  precipitation: (number | null)[] | undefined,
  precipitation_probability: (number | null)[] | undefined
): OpenMeteoNowcastResponse {
  const minutely: NonNullable<OpenMeteoNowcastResponse['minutely_15']> = { time: DETROIT_TIMES };
  if (precipitation !== undefined) minutely.precipitation = precipitation;
  if (precipitation_probability !== undefined) minutely.precipitation_probability = precipitation_probability;
  return {
    latitude: 43.81505,
    longitude: -84.7735,
    utc_offset_seconds: -14400,
    timezone: 'America/Detroit',
    timezone_abbreviation: 'GMT-4',
    minutely_15: minutely,
  };
}

function covered(response: OpenMeteoNowcastResponse): NowcastResult {
  return { status: 'covered', model: 'gfs_hrrr', response };
}

const LIVE_PRECIP = [0.1, 0.4, 0.4, 0.5, 0.8, 0.6, 0.3, 0.2];
const LIVE_PROB = [60, 60, 59, 56, 52, 48, 46, 46];

function buildNoaaFake(getAlerts = vi.fn().mockResolvedValue(alertCollection())) {
  return {
    getPointData: vi.fn().mockRejectedValue(new Error('NOAA forecast must not be called at minutely')),
    getForecast: vi.fn().mockRejectedValue(new Error('NOAA forecast must not be called at minutely')),
    getHourlyForecast: vi.fn().mockRejectedValue(new Error('NOAA forecast must not be called at minutely')),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not needed')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed')),
    getAlerts,
  };
}

function buildOpenMeteoFake(getNowcast = vi.fn().mockResolvedValue(covered(hrrrResponse(LIVE_PRECIP, LIVE_PROB)))) {
  return {
    getNowcast,
    getForecast: vi.fn().mockRejectedValue(new Error('getForecast must not be called at minutely')),
    getModelComparison: vi.fn().mockRejectedValue(new Error('not exercised')),
    getEnsembleSpread: vi.fn().mockRejectedValue(new Error('not exercised')),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
}

function buildMetnoFake() {
  return { getForecast: vi.fn().mockRejectedValue(new Error('met.no must not be called at minutely')) };
}

const locationStore = { get: () => undefined, getAll: () => ({}) } as unknown as LocationStore;
const geocoding = { geocode: vi.fn() } as unknown as GeocodingService;
const ncei = { isAvailable: vi.fn().mockReturnValue(false) } as unknown as NCEIService;

type Fakes = {
  noaa: ReturnType<typeof buildNoaaFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoFake>;
  metno: ReturnType<typeof buildMetnoFake>;
};

function fakes(overrides: Partial<Fakes> = {}): Fakes {
  return {
    noaa: overrides.noaa ?? buildNoaaFake(),
    openMeteo: overrides.openMeteo ?? buildOpenMeteoFake(),
    metno: overrides.metno ?? buildMetnoFake(),
  };
}

function run(args: Record<string, unknown>, f: Fakes, banner?: boolean) {
  return handleGetForecast(
    args,
    f.noaa as unknown as NOAAService,
    f.openMeteo as unknown as OpenMeteoService,
    locationStore,
    geocoding,
    ncei,
    undefined,
    banner,
    f.metno as unknown as MetnoService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(c => c.text).join('\n');
}

/** Table rows as [time, cell] pairs, parsed out before any assertion (G96). */
function tableRows(text: string): Array<[string, string]> {
  return text
    .split('\n')
    .filter(line => line.startsWith('| ') && !line.startsWith('| Time ') && !line.startsWith('|---'))
    .map(line => {
      const cells = line.split('|').map(c => c.trim());
      return [cells[1], cells[2]] as [string, string];
    });
}

/** Expected label, built with the handler's own formatter (G75: ICU's narrow no-break space). */
function label(iso: string, prefs = IMPERIAL_PREFERENCES): string {
  return formatLuxonTime(DateTime.fromISO(iso, { zone: 'America/Detroit' }), prefs);
}

// ---------------------------------------------------------------------------

describe('get_forecast granularity "minutely"', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('covered', () => {
    it('renders the model line, the table, the hourly probability and the source footer', async () => {
      const f = fakes();
      const text = textOf(await run({ ...US_POINT, granularity: 'minutely' }, f));

      expect(text).toContain('# 15-Minute Precipitation Nowcast\n');
      expect(text).toContain('**Model:** HRRR (NOAA) via Open-Meteo — updates hourly\n');
      expect(text).toContain(
        '*Next 2 hours in 15-minute steps, local time (EDT). Amounts are shown as bands, not figures: consecutive model runs can disagree about individual showers, so read a single quarter as indicative.*\n'
      );
      expect(text).toContain(
        '*Bands are this server\'s heuristic for the 15-minute amount: none · trace · light · moderate · heavy (thresholds in docs/TOOLS.md).*\n'
      );
      expect(text).toContain('---\n*Data source: Open-Meteo (HRRR model)*\n');

      // 0.1 0.4 0.4 0.5 -> light; 0.8 -> moderate; 0.6 0.3 0.2 -> light
      expect(tableRows(text)).toEqual([
        [label(DETROIT_TIMES[0]), 'light'],
        [label(DETROIT_TIMES[1]), 'light'],
        [label(DETROIT_TIMES[2]), 'light'],
        [label(DETROIT_TIMES[3]), 'light'],
        [label(DETROIT_TIMES[4]), 'moderate'],
        [label(DETROIT_TIMES[5]), 'light'],
        [label(DETROIT_TIMES[6]), 'light'],
        [label(DETROIT_TIMES[7]), 'light'],
      ]);
      expect(text).toContain(`| ${label(DETROIT_TIMES[4])} | moderate |\n`);

      // G11: read the rendered text, not only the assertions.
      console.log('--- minutely covered (read for G11) ---\n' + text);
    });

    it('carries no digit in any band cell (no amount per quarter)', async () => {
      const text = textOf(await run({ ...US_POINT, granularity: 'minutely' }, fakes()));
      const rows = tableRows(text);
      expect(rows).toHaveLength(8);
      for (const [, cell] of rows) {
        expect(cell).not.toMatch(/\d/);
      }
    });

    it('renders probability once, from the on-the-hour quarters only', async () => {
      const text = textOf(await run({ ...US_POINT, granularity: 'minutely' }, fakes()));
      const lines = text.split('\n').filter(l => l.includes('Chance of precipitation'));
      expect(lines).toEqual([
        `**Chance of precipitation (hourly figure, not per quarter):** ${label(DETROIT_TIMES[2])}: 59% · ${label(DETROIT_TIMES[6])}: 46%`,
      ]);
      // Interpolated quarters (60, 56, 52, 48) never appear.
      expect(text).not.toMatch(/\b(56|52|48)%/);
    });

    it('drops quarters that have already ended', async () => {
      vi.setSystemTime(Date.UTC(2026, 9, 1, 23, 50)); // 19:50 EDT: 19:30 has ended, 19:45 is live
      const rows = tableRows(textOf(await run({ ...US_POINT, granularity: 'minutely' }, fakes())));
      expect(rows.map(r => r[0])).toEqual(DETROIT_TIMES.slice(1).map(t => label(t)));
    });

    it('reaches the nowcast at a US point under source "auto": NOAA forecast never called', async () => {
      const f = fakes();
      await run({ ...US_POINT, granularity: 'minutely' }, f);
      expect(f.openMeteo.getNowcast).toHaveBeenCalledWith(US_POINT.latitude, US_POINT.longitude, NOW);
      expect(f.noaa.getPointData).not.toHaveBeenCalled();
      expect(f.noaa.getForecast).not.toHaveBeenCalled();
      expect(f.noaa.getHourlyForecast).not.toHaveBeenCalled();
      expect(f.openMeteo.getForecast).not.toHaveBeenCalled();
    });

    it('reaches the nowcast under source "openmeteo"', async () => {
      const f = fakes();
      await run({ ...US_POINT, granularity: 'minutely', source: 'openmeteo' }, f);
      expect(f.openMeteo.getNowcast).toHaveBeenCalledTimes(1);
    });

    it('renders identically in imperial and metric (12h clock in both)', async () => {
      const imperial = textOf(await run({ ...US_POINT, granularity: 'minutely', units: 'imperial' }, fakes()));
      const metric = textOf(await run({ ...US_POINT, granularity: 'minutely', units: 'metric', time_format: '12h' }, fakes()));
      expect(metric).toBe(imperial);
    });

    it('formats times in 24h when asked, and changes nothing else', async () => {
      const text = textOf(await run({ ...US_POINT, granularity: 'minutely', units: 'metric', time_format: '24h' }, fakes()));
      const prefs24 = { ...METRIC_PREFERENCES, timeFormat: '24h' as const };
      expect(tableRows(text)[0]).toEqual([label(DETROIT_TIMES[0], prefs24), 'light']);
    });
  });

  describe('crossing the two optionals (G59)', () => {
    const someNull = [0.1, null, 0.4, 0.5, null, 0.6, 0.3, 0.2];
    const cases: Array<[string, (number | null)[], (number | null)[] | undefined, boolean, boolean]> = [
      ['null quarters, probability on', someNull, LIVE_PROB, true, true],
      ['null quarters, probability off', someNull, LIVE_PROB, false, false],
      ['probability all null, flag on', LIVE_PRECIP, Array(8).fill(null), true, false],
      ['probability absent, flag on', LIVE_PRECIP, undefined, true, false],
    ];

    for (const [name, precip, prob, flag, expectLine] of cases) {
      it(name, async () => {
        const f = fakes({
          openMeteo: buildOpenMeteoFake(vi.fn().mockResolvedValue(covered(hrrrResponse(precip, prob)))),
        });
        const text = textOf(
          await run({ ...US_POINT, granularity: 'minutely', include_precipitation_probability: flag }, f)
        );
        const rows = tableRows(text);
        precip.forEach((value, i) => {
          if (value === null) {
            expect(rows[i][1]).toBe('no data');
          }
        });
        expect(text.includes('Chance of precipitation')).toBe(expectLine);
      });
    }

    it('renders a null quarter as "no data", never "none"', async () => {
      const f = fakes({
        openMeteo: buildOpenMeteoFake(
          vi.fn().mockResolvedValue(covered(hrrrResponse([0, null, 0, 0, 0, 0, 0, 0], LIVE_PROB)))
        ),
      });
      const rows = tableRows(textOf(await run({ ...US_POINT, granularity: 'minutely' }, f)));
      expect(rows[0][1]).toBe('none');
      expect(rows[1][1]).toBe('no data');
    });
  });

  describe('not covered', () => {
    it('replaces the whole block for a box-out point (model null)', async () => {
      const f = fakes({
        openMeteo: buildOpenMeteoFake(vi.fn().mockResolvedValue({ status: 'not-covered', model: null })),
      });
      const text = textOf(await run({ ...TOKYO, granularity: 'minutely' }, f));
      expect(text).toBe(NOT_COVERED_BLOCK);
    });

    it('renders the same block for an in-box point the model refused', async () => {
      const f = fakes({
        openMeteo: buildOpenMeteoFake(vi.fn().mockResolvedValue({ status: 'not-covered', model: 'gfs_hrrr' })),
      });
      const text = textOf(await run({ latitude: 53.5, longitude: -113.5, granularity: 'minutely' }, f));
      expect(text).toBe(NOT_COVERED_BLOCK);
      expect(tableRows(text)).toEqual([]);
      expect(text).not.toMatch(/\bnone\b/);
      expect(text).not.toMatch(/no rain/i);
    });
  });

  describe('unreadable covered answer', () => {
    it('throws DataNotFoundError when every live quarter is no data, never an empty table', async () => {
      const f = fakes({
        openMeteo: buildOpenMeteoFake(vi.fn().mockResolvedValue(covered(hrrrResponse(Array(8).fill(null), LIVE_PROB)))),
      });
      await expect(run({ ...US_POINT, granularity: 'minutely' }, f)).rejects.toBeInstanceOf(DataNotFoundError);
    });

    it('throws DataNotFoundError when no quarter is still live', async () => {
      vi.setSystemTime(Date.UTC(2026, 9, 2, 2, 0)); // 22:00 EDT, after the 21:15 quarter ends
      await expect(run({ ...US_POINT, granularity: 'minutely' }, fakes())).rejects.toBeInstanceOf(DataNotFoundError);
    });
  });

  describe('conflicts, thrown before any request', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      [
        'source "noaa"',
        { source: 'noaa' },
        'granularity "minutely" uses Open-Meteo 15-minute model data; use source "auto" or "openmeteo"',
      ],
      ['compare_models', { compare_models: true }, 'compare_models requires daily granularity'],
      ['ensemble_spread', { ensemble_spread: true }, 'ensemble_spread requires daily granularity'],
    ];

    for (const [name, extra, message] of cases) {
      it(`${name} + minutely throws "${message}"`, async () => {
        const f = fakes();
        await expect(run({ ...US_POINT, granularity: 'minutely', ...extra }, f)).rejects.toThrow(message);
        expect(f.openMeteo.getNowcast).not.toHaveBeenCalled();
        expect(f.openMeteo.getForecast).not.toHaveBeenCalled();
        expect(f.noaa.getForecast).not.toHaveBeenCalled();
        expect(f.noaa.getAlerts).not.toHaveBeenCalled();
      });
    }
  });

  describe('contract: failures propagate, no met.no fallback', () => {
    it('propagates a retryable failure under source "auto" without calling met.no', async () => {
      const failure = new ServiceUnavailableError('OpenMeteo', new Error('boom'));
      const f = fakes({ openMeteo: buildOpenMeteoFake(vi.fn().mockRejectedValue(failure)) });
      await expect(run({ ...TOKYO, granularity: 'minutely' }, f)).rejects.toBe(failure);
      expect(f.metno.getForecast).not.toHaveBeenCalled();
      expect(f.openMeteo.getForecast).not.toHaveBeenCalled();
    });
  });

  describe('critical-alert banner', () => {
    it('renders the banner first, above the nowcast, at an NWS point', async () => {
      const f = fakes({ noaa: buildNoaaFake(vi.fn().mockResolvedValue(alertCollection(TORNADO_WARNING))) });
      const text = textOf(await run({ ...US_POINT, granularity: 'minutely' }, f, true));
      expect(text.startsWith(BANNER_FIRST_LINE)).toBe(true);
      expect(text.indexOf('# 15-Minute Precipitation Nowcast')).toBeGreaterThan(text.indexOf(BANNER_FIRST_LINE));
    });

    it('carries the banner on a nowcast failure', async () => {
      const f = fakes({
        noaa: buildNoaaFake(vi.fn().mockResolvedValue(alertCollection(TORNADO_WARNING))),
        openMeteo: buildOpenMeteoFake(vi.fn().mockRejectedValue(new ServiceUnavailableError('OpenMeteo', new Error('boom')))),
      });
      const error = await run({ ...US_POINT, granularity: 'minutely' }, f, true).catch((e: unknown) => e);
      expect(criticalAlertBannerFromError(error)).toContain(BANNER_FIRST_LINE);
    });
  });
});
