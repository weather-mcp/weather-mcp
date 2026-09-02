/**
 * Handler unit tests for the NOAA forecast horizon disclosure (T2 of
 * .devdocs/plan-noaa-forecast-horizon-disclosure-impl.md):
 *
 *   - `get_forecast`'s NOAA daily path discloses NOAA's own published
 *     7-day/night horizon (`*NOAA publishes a N-day forecast...`) only when
 *     the request asks for more days than NOAA actually returned, naming the
 *     *delivered* count read from the unsliced response — not `days`, not
 *     `periods.length / 2`, not a hard-coded 7.
 *   - The NOAA hourly path discloses its own ~156-hour horizon
 *     (`*NOAA publishes N hours...`) the same way, and the cap-note remedy
 *     (`*Hourly output capped at...`) switches wording when the horizon note
 *     also rendered, so it never promises a `days`-day hourly forecast NOAA
 *     never published.
 *   - Both notes are silent on the Open-Meteo path and are reachable through
 *     `get_weather_summary`'s forecast section (G19), which calls the same
 *     handler with its own default `detail`.
 *
 * Modeled on tests/unit/almanac-handler.test.ts: the real handlers are
 * exercised end to end with plain fake services (vi.fn() spies returning
 * canned fixtures) — no HTTP, no live network calls, fully deterministic.
 * The generic fixture helpers below (US_COORDS/PARIS, buildForecastPeriod,
 * buildNoaaPoints, buildNoaaForecastResponse, buildNoaaForecastFake,
 * buildOpenMeteoForecastFake, buildForecastFakes, callForecast) are copied
 * verbatim from that file — none of them is exported from production code,
 * and tests/unit/forecast-fallback.test.ts / forecast-model-comparison.test.ts
 * / forecast-ensemble-spread.test.ts already duplicate the same set.
 *
 * See .devdocs/plan-noaa-forecast-horizon-disclosure-impl.md T2.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoForecastResponse } from '../../src/types/openmeteo.js';
import type { ForecastPeriod } from '../../src/types/noaa.js';

// ---------------------------------------------------------------------------
// Shared fixtures / fakes — copied verbatim from almanac-handler.test.ts
// ---------------------------------------------------------------------------

/** Paris, France — outside the US routing boxes, drives the Open-Meteo path. */
const PARIS = { latitude: 48.8566, longitude: 2.3522 };
/** Washington, DC — inside the US routing boxes, drives the NOAA path. */
const US_COORDS = { latitude: 38.8951, longitude: -77.0364 };

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

/** Count non-overlapping occurrences of a literal substring. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

interface ForecastFakes {
  noaa: ReturnType<typeof buildNoaaForecastFake>;
  openMeteo: ReturnType<typeof buildOpenMeteoForecastFake>;
  ncei: { isAvailable: ReturnType<typeof vi.fn> };
  acis: undefined;
  locationStore: Record<string, never>;
  geocoding: Record<string, never>;
}

function buildNceiFake() {
  return { isAvailable: vi.fn().mockReturnValue(false) };
}

// --- Open-Meteo forecast fixtures -------------------------------------------------

function buildOpenMeteoDailyForecastResponse(days: string[], timezone = 'Europe/Paris'): OpenMeteoForecastResponse {
  return {
    latitude: 48.86,
    longitude: 2.35,
    generationtime_ms: 0.1,
    utc_offset_seconds: 3600,
    timezone,
    timezone_abbreviation: 'CET',
    elevation: 35,
    daily: {
      time: days,
      temperature_2m_max: days.map(() => 25),
      temperature_2m_min: days.map(() => 15),
      sunrise: days.map(d => `${d}T06:00`),
      sunset: days.map(d => `${d}T21:00`),
    },
  };
}

function buildOpenMeteoHourlyForecastResponse(timezone = 'Europe/Paris'): OpenMeteoForecastResponse {
  return {
    latitude: 48.86,
    longitude: 2.35,
    generationtime_ms: 0.1,
    utc_offset_seconds: 3600,
    timezone,
    timezone_abbreviation: 'CET',
    elevation: 35,
    hourly: {
      time: ['2026-08-12T00:00', '2026-08-12T01:00'],
      temperature_2m: [18, 17],
    },
  };
}

function buildOpenMeteoForecastFake(response: OpenMeteoForecastResponse) {
  return {
    getForecast: vi.fn().mockResolvedValue(response),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    getClimateNormals: vi.fn().mockRejectedValue(new Error('normals not configured for this fixture')),
  };
}

// --- NOAA forecast fixtures -------------------------------------------------------

function buildNoaaPoints(timeZone = 'America/Los_Angeles') {
  return {
    properties: {
      gridId: 'TEST',
      gridX: 1,
      gridY: 1,
      timeZone,
    },
  };
}

function buildForecastPeriod(overrides: Partial<ForecastPeriod>): ForecastPeriod {
  return {
    number: 1,
    name: 'Day',
    startTime: '2026-08-12T06:00:00-07:00',
    endTime: '2026-08-12T18:00:00-07:00',
    isDaytime: true,
    temperature: 75,
    temperatureUnit: 'F',
    temperatureTrend: null,
    probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: null },
    dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
    relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    windSpeed: '5 mph',
    windDirection: 'N',
    icon: '',
    shortForecast: 'Sunny',
    detailedForecast: 'Sunny throughout.',
    ...overrides,
  } as ForecastPeriod;
}

function buildNoaaForecastResponse(periods: ForecastPeriod[]) {
  return {
    properties: {
      updated: '2026-08-12T00:00:00-07:00',
      units: 'us',
      forecastGenerator: 'test',
      generatedAt: '2026-08-12T00:00:00-07:00',
      updateTime: '2026-08-12T00:00:00-07:00',
      validTimes: '2026-08-12T00:00:00-07:00/P7D',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      periods,
    },
  };
}

function buildNoaaForecastFake(periods: ForecastPeriod[] = [buildForecastPeriod({})]) {
  return {
    getPointData: vi.fn().mockResolvedValue(buildNoaaPoints()),
    getForecast: vi.fn().mockResolvedValue(buildNoaaForecastResponse(periods)),
    getHourlyForecast: vi.fn().mockResolvedValue(buildNoaaForecastResponse(periods)),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
    getGridpointDataByCoordinates: vi.fn().mockRejectedValue(new Error('not needed for this fixture')),
  };
}

function buildForecastFakes(overrides: Partial<ForecastFakes> = {}): ForecastFakes {
  return {
    noaa: buildNoaaForecastFake(),
    openMeteo: buildOpenMeteoForecastFake(buildOpenMeteoDailyForecastResponse(['2026-08-12'])),
    ncei: buildNceiFake(),
    acis: undefined,
    locationStore: {},
    geocoding: {},
    ...overrides,
  };
}

function callForecast(args: Record<string, unknown>, fakes: ForecastFakes) {
  return handleGetForecast(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService,
    fakes.ncei as unknown as NCEIService,
    fakes.acis
  );
}

/** Drives the same NOAA daily path through get_weather_summary's forecast
 * section (G19) — a second public path with its own default `detail`. */
function callSummary(args: Record<string, unknown>, fakes: ForecastFakes) {
  return handleGetWeatherSummary(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    fakes.ncei as unknown as NCEIService,
    fakes.locationStore as unknown as LocationStore,
    fakes.geocoding as unknown as GeocodingService
  );
}

// ---------------------------------------------------------------------------
// Horizon-disclosure fixtures (T2-specific) — daily and hourly period sets
// whose delivered count is deliberately shorter than a wide `days` request,
// and whose day-count / date-count / period-count diverge from each other so
// a mutated counting strategy renders a different, catchable number (G13,
// G32: the design rejected distinct-calendar-dates, `periods.length / 2`,
// and a hard-coded day/hour count).
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Add `days` (may be 0) to an ISO date-only string, in UTC to avoid DST skew. */
function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * F-A: "Today"-first daily response — 7 day/night pairs, 14 periods, 7
 * daytime periods, 7 distinct calendar dates. The live NOAA daily shape at
 * ~14Z.
 */
function buildDailyTodayFirst(): ForecastPeriod[] {
  const periods: ForecastPeriod[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysISO('2026-08-12', i);
    const nextDate = addDaysISO('2026-08-12', i + 1);
    periods.push(buildForecastPeriod({
      number: periods.length + 1,
      name: i === 0 ? 'Today' : `Day${i}`,
      isDaytime: true,
      startTime: `${date}T06:00:00-07:00`,
      endTime: `${date}T18:00:00-07:00`,
    }));
    periods.push(buildForecastPeriod({
      number: periods.length + 1,
      name: i === 0 ? 'Tonight' : `Day${i} Night`,
      isDaytime: false,
      startTime: `${date}T18:00:00-07:00`,
      endTime: `${nextDate}T06:00:00-07:00`,
    }));
  }
  return periods;
}

/**
 * "Tonight"-first daily period set: a leading `Tonight` (calendar date 0),
 * `pairCount` day/night pairs on dates 1..pairCount, and — when `trailingDay`
 * is set — one more daytime-only period on date `pairCount + 1`.
 *
 * F-B = buildDailyTonightFirst(6, true)  — 14 periods, 7 daytime periods, 8
 *       distinct dates (Tonight's date 0 plus the 7 daytime dates 1-7): a
 *       distinct-calendar-date count would say 8 where `isDaytime` correctly
 *       says 7.
 * F-C = buildDailyTonightFirst(6, false) — 13 periods, 6 daytime periods, 7
 *       distinct dates: `periods.length / 2` says 6.5, a distinct-date count
 *       says 7, and only `isDaytime` correctly says 6.
 */
function buildDailyTonightFirst(pairCount: number, trailingDay: boolean): ForecastPeriod[] {
  const periods: ForecastPeriod[] = [
    buildForecastPeriod({
      number: 1,
      name: 'Tonight',
      isDaytime: false,
      startTime: '2026-08-12T20:00:00-07:00',
      endTime: '2026-08-13T06:00:00-07:00',
    }),
  ];
  for (let i = 1; i <= pairCount; i++) {
    const date = addDaysISO('2026-08-12', i);
    const nextDate = addDaysISO('2026-08-12', i + 1);
    periods.push(buildForecastPeriod({
      number: periods.length + 1,
      name: `Day${i}`,
      isDaytime: true,
      startTime: `${date}T06:00:00-07:00`,
      endTime: `${date}T18:00:00-07:00`,
    }));
    periods.push(buildForecastPeriod({
      number: periods.length + 1,
      name: `Day${i} Night`,
      isDaytime: false,
      startTime: `${date}T18:00:00-07:00`,
      endTime: `${nextDate}T06:00:00-07:00`,
    }));
  }
  if (trailingDay) {
    const date = addDaysISO('2026-08-12', pairCount + 1);
    periods.push(buildForecastPeriod({
      number: periods.length + 1,
      name: `Day${pairCount + 1}`,
      isDaytime: true,
      startTime: `${date}T06:00:00-07:00`,
      endTime: `${date}T18:00:00-07:00`,
    }));
  }
  return periods;
}

/**
 * Hourly period set stepping one hour at a time from
 * 2026-08-12T06:00:00-07:00, empty `name` (the live hourly shape),
 * `isDaytime` true for the 06:00-17:59 local window each day.
 *
 * F-H  = buildHourlyPeriods(156) — the live ~156h NOAA hourly horizon.
 * F-H2 = buildHourlyPeriods(150) — a different delivered count, to catch a
 *        hard-coded 156.
 */
function buildHourlyPeriods(count: number): ForecastPeriod[] {
  const periods: ForecastPeriod[] = [];
  for (let i = 0; i < count; i++) {
    const totalHours = 6 + i;
    const nextTotalHours = totalHours + 1;
    const dayOffset = Math.floor(totalHours / 24);
    const hour = totalHours % 24;
    const nextDayOffset = Math.floor(nextTotalHours / 24);
    const nextHour = nextTotalHours % 24;
    const date = addDaysISO('2026-08-12', dayOffset);
    const nextDate = addDaysISO('2026-08-12', nextDayOffset);
    periods.push(buildForecastPeriod({
      number: i + 1,
      name: '',
      isDaytime: hour >= 6 && hour < 18,
      startTime: `${date}T${pad2(hour)}:00:00-07:00`,
      endTime: `${nextDate}T${pad2(nextHour)}:00:00-07:00`,
    }));
  }
  return periods;
}

/** Builds a NOAA fake whose `getHourlyForecast` returns the given hourly
 * period set (the daily `getForecast` is irrelevant to these cases). */
function buildNoaaHourlyFake(hourlyPeriods: ForecastPeriod[]) {
  const fake = buildNoaaForecastFake([]);
  fake.getHourlyForecast = vi.fn().mockResolvedValue(buildNoaaForecastResponse(hourlyPeriods));
  return fake;
}

const F_A = buildDailyTodayFirst();
const F_B = buildDailyTonightFirst(6, true);
const F_C = buildDailyTonightFirst(6, false);

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

describe('get_forecast — NOAA daily horizon disclosure', () => {
  it('renders no horizon note when the request is within NOAA\'s published 7 days (F-A and F-B, days 7 and 3)', async () => {
    for (const periods of [F_A, F_B]) {
      for (const days of [7, 3]) {
        const fakes = buildForecastFakes({ noaa: buildNoaaForecastFake(periods) });
        const result = await callForecast({ ...US_COORDS, days }, fakes);
        const text = textOf(result);
        expect(text).not.toContain('*NOAA publishes ');
      }
    }
  });

  it('discloses NOAA\'s 7-day horizon exactly once, between "Showing" and the first period, when days exceeds it (F-A and F-B, days 8/10/16)', async () => {
    for (const periods of [F_A, F_B]) {
      for (const days of [8, 10, 16]) {
        const fakes = buildForecastFakes({ noaa: buildNoaaForecastFake(periods) });
        const result = await callForecast({ ...US_COORDS, days }, fakes);
        const text = textOf(result);

        const expectedLine = `*NOAA publishes a 7-day forecast; showing all 7 of the ${days} days requested. For a longer horizon use source: "openmeteo".*`;
        expect(countOccurrences(text, expectedLine)).toBe(1);

        const showingIdx = text.indexOf('**Showing:** 14 periods');
        const noteIdx = text.indexOf(expectedLine);
        const firstHeadingIdx = text.indexOf('## ');
        expect(showingIdx).toBeGreaterThanOrEqual(0);
        expect(noteIdx).toBeGreaterThan(showingIdx);
        expect(firstHeadingIdx).toBeGreaterThan(noteIdx);
        expect(countOccurrences(text, '## ')).toBe(14);
      }
    }
  });

  it('names NOAA\'s actual delivered day count (6), not periods.length / 2 (6.5) or a distinct-date count (7), for a 13-period response (F-C, days 7)', async () => {
    const fakes = buildForecastFakes({ noaa: buildNoaaForecastFake(F_C) });
    const result = await callForecast({ ...US_COORDS, days: 7 }, fakes);
    const text = textOf(result);
    expect(text).toContain(
      '*NOAA publishes a 6-day forecast; showing all 6 of the 7 days requested. For a longer horizon use source: "openmeteo".*'
    );
  });
});

describe('get_forecast — NOAA hourly horizon disclosure', () => {
  it('renders no horizon note, and keeps the pre-existing cap remedy, when the hourly request is within NOAA\'s published horizon (F-H, days 6, all detail levels)', async () => {
    const F_H = buildHourlyPeriods(156);
    for (const detail of ['summary', 'standard', 'full'] as const) {
      const fakes = buildForecastFakes({ noaa: buildNoaaHourlyFake(F_H) });
      const result = await callForecast(
        { ...US_COORDS, days: 6, granularity: 'hourly', detail },
        fakes
      );
      const text = textOf(result);
      expect(text).not.toContain('*NOAA publishes ');
      if (detail === 'summary' || detail === 'standard') {
        expect(text).toContain('Use detail="full" for the full 6-day hourly forecast.*');
      }
    }
  });

  // The equality boundary of the hourly guard (`deliveredHours < days * 24`).
  // F-H above sits at 156 > 144 and F-H2 at 150 < 168, so both are strictly
  // off the boundary and neither can tell `<` from `<=`: a `<=` regression
  // stays green against them. Here `deliveredHours === days * 24` exactly, so
  // `<=` would render a shortfall disclosure over a response that was not
  // short — `showing 48 of the 144 hours requested` with all 144 delivered —
  // and would reword the cap remedy with it. The daily side already carries
  // its boundary case (F-A, 7 daytime periods at days 7); this is its hourly
  // twin, so both guards are locked on the same axis.
  // Source: diff-review copilot F2 (triage: fix now).
  it('renders no horizon note, and keeps the pre-existing cap remedy, when the delivered hours exactly equal the request (F-H3, 144 hours at days 6, all detail levels)', async () => {
    const F_H3 = buildHourlyPeriods(144);
    for (const detail of ['summary', 'standard', 'full'] as const) {
      const fakes = buildForecastFakes({ noaa: buildNoaaHourlyFake(F_H3) });
      const result = await callForecast(
        { ...US_COORDS, days: 6, granularity: 'hourly', detail },
        fakes
      );
      const text = textOf(result);
      expect(text).not.toContain('*NOAA publishes ');
      if (detail === 'summary' || detail === 'standard') {
        expect(text).toContain('Use detail="full" for the full 6-day hourly forecast.*');
        expect(text).not.toContain('hours NOAA published.');
      }
    }
  });

  it('names the delivered hours and day-equivalent, and switches the cap remedy, when hourly is short of the request (F-H, days 7, all detail levels)', async () => {
    const F_H = buildHourlyPeriods(156);
    const dayEquivalent = Number((156 / 24).toFixed(1));
    // The middle clause carries the *shown* count (which hourlyEntryCap may have
    // bounded) against the *asked* count — 24/48/156 of 168 — not the delivered
    // 156 in all three. Pinned exactly so swapping periods.length for
    // deliveredHours there cannot pass.
    const shownHours = { summary: 24, standard: 48, full: 156 } as const;
    for (const detail of ['summary', 'standard', 'full'] as const) {
      const fakes = buildForecastFakes({ noaa: buildNoaaHourlyFake(F_H) });
      const result = await callForecast(
        { ...US_COORDS, days: 7, granularity: 'hourly', detail },
        fakes
      );
      const text = textOf(result);
      expect(text).toContain(
        `*NOAA publishes 156 hours (about ${dayEquivalent} days) of hourly forecast; showing ${shownHours[detail]} of the 168 hours requested. For a longer horizon use source: "openmeteo".*`
      );

      if (detail === 'full') {
        expect(text).toContain('**Showing:** 156 hours');
        expect(text).not.toContain('*Hourly output capped at ');
      } else {
        expect(text).toContain('Use detail="full" for all 156 hours NOAA published.*');
        expect(text).not.toContain('for the full 7-day');
      }
    }
  });

  it('names 150 hours and its own day-equivalent, not a hard-coded 156, for a different delivered hourly count (F-H2, days 7)', async () => {
    const F_H2 = buildHourlyPeriods(150);
    const dayEquivalent = Number((150 / 24).toFixed(1));
    const fakes = buildForecastFakes({ noaa: buildNoaaHourlyFake(F_H2) });
    const result = await callForecast({ ...US_COORDS, days: 7, granularity: 'hourly' }, fakes);
    const text = textOf(result);
    expect(text).toContain(
      `*NOAA publishes 150 hours (about ${dayEquivalent} days) of hourly forecast; showing 48 of the 168 hours requested. For a longer horizon use source: "openmeteo".*`
    );
  });
});

describe('get_forecast — Open-Meteo path renders no NOAA horizon note', () => {
  it('stays silent on the Open-Meteo path (PARIS, daily days 10 and hourly days 7)', async () => {
    const dailyFakes = buildForecastFakes({
      openMeteo: buildOpenMeteoForecastFake(buildOpenMeteoDailyForecastResponse(['2026-08-12'])),
    });
    const dailyResult = await callForecast({ ...PARIS, days: 10 }, dailyFakes);
    expect(textOf(dailyResult)).not.toContain('*NOAA publishes ');

    const hourlyFakes = buildForecastFakes({
      openMeteo: buildOpenMeteoForecastFake(buildOpenMeteoHourlyForecastResponse()),
    });
    const hourlyResult = await callForecast({ ...PARIS, days: 7, granularity: 'hourly' }, hourlyFakes);
    expect(textOf(hourlyResult)).not.toContain('*NOAA publishes ');
  });
});

describe('get_weather_summary — NOAA daily horizon disclosure reaches the forecast section (G19)', () => {
  it('discloses the horizon at both the default detail and an explicit "standard" detail, and stays silent when the request fits (US_COORDS, F-A)', async () => {
    for (const detailArgs of [{}, { detail: 'standard' as const }]) {
      const fakes = buildForecastFakes({ noaa: buildNoaaForecastFake(F_A) });
      const result = await callSummary(
        { ...US_COORDS, include: ['forecast'], days: 10, ...detailArgs },
        fakes
      );
      const text = textOf(result);
      expect(text).toContain(
        '*NOAA publishes a 7-day forecast; showing all 7 of the 10 days requested. For a longer horizon use source: "openmeteo".*'
      );
    }

    for (const detailArgs of [{}, { detail: 'standard' as const }]) {
      const fakes = buildForecastFakes({ noaa: buildNoaaForecastFake(F_A) });
      const result = await callSummary(
        { ...US_COORDS, include: ['forecast'], days: 7, ...detailArgs },
        fakes
      );
      const text = textOf(result);
      expect(text).not.toContain('*NOAA publishes ');
    }
  });
});
