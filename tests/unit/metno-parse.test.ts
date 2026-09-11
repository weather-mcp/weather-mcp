/**
 * Specification for the pure MET Norway daily aggregator.
 *
 * These tests *are* the aggregator's specification: every fixture below is
 * built from the live measurements recorded in `.devdocs/plan-metno-fallback.md`
 * D3 (Oslo, Tokyo, Denver, 2026-09-03), and each one pins a property of met.no's
 * series that is invisible from a two-point sample.
 *
 * **Every fixture pins its timezone explicitly and no test reads the clock.**
 * The aggregator buckets by local calendar day, so an ambient zone or a
 * `Date.now()` would make these pass or fail by where and when they ran.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '../../src/utils/logger.js';
import {
  METNO_MAX_TIMESERIES_ENTRIES,
  aggregateMetnoDaily,
  describeMetnoSymbol,
} from '../../src/utils/metnoParse.js';
import type { MetnoForecastResponse, MetnoTimeseriesEntry } from '../../src/types/metno.js';

/** Base of every generated series: a local midnight in UTC, so hour-of-day == offset % 24. */
const SERIES_START = '2026-09-11T00:00:00Z';

const HOUR_MS = 3_600_000;

function isoAtOffset(startIso: string, hours: number): string {
  return new Date(Date.parse(startIso) + hours * HOUR_MS).toISOString().replace('.000Z', 'Z');
}

/**
 * Temperature as a deterministic function of the hour of day.
 *
 * The point of this shape is that a day's true minimum (10 °C, at 00:00) and
 * maximum (33 °C, at 23:00) are the same whichever resolution the series
 * happens to be publishing at across that day — which is what makes the two
 * seam fixtures directly comparable.
 */
function temperatureAtHour(hourOfDay: number): number {
  return 10 + hourOfDay;
}

/**
 * A met.no-shaped series: hourly to the seam, then aligned 6-hourly, with a
 * final entry that carries an instant reading and no aggregation window.
 *
 * Hourly entries carry **both** `next_1_hours` and `next_6_hours`, exactly as
 * the live product does. That overlap is the trap the derived step exists to
 * avoid, so the fixture has to reproduce it rather than tidy it away.
 */
function buildSeries(seamHours: number, totalHours: number): MetnoForecastResponse {
  const timeseries: MetnoTimeseriesEntry[] = [];

  const pushEntry = (offset: number, step: 1 | 6 | 0): void => {
    const hourOfDay = offset % 24;
    const instantTemp = temperatureAtHour(hourOfDay);
    const entry: MetnoTimeseriesEntry = {
      time: isoAtOffset(SERIES_START, offset),
      data: {
        instant: {
          details: {
            air_temperature: instantTemp,
            wind_speed: 2 + (hourOfDay % 5),
            wind_from_direction: 180,
            relative_humidity: 60,
            air_pressure_at_sea_level: 101_300,
            cloud_area_fraction: 40,
          },
        },
      },
    };

    if (step === 1) {
      entry.data!.next_1_hours = {
        summary: { symbol_code: hourOfDay < 18 ? 'clearsky_day' : 'clearsky_night' },
        details: {
          precipitation_amount: 0.1,
          probability_of_precipitation: 10,
          probability_of_thunder: 1,
        },
      };
      // Present on every hourly entry in the live product, and deliberately
      // wrong to read here: six consecutive 6-hour windows overlap.
      entry.data!.next_6_hours = {
        summary: { symbol_code: 'cloudy_day' },
        details: {
          air_temperature_max: 99,
          air_temperature_min: -99,
          precipitation_amount: 0.6,
          probability_of_precipitation: 90,
        },
      };
    } else if (step === 6) {
      entry.data!.next_6_hours = {
        summary: { symbol_code: hourOfDay < 18 ? 'partlycloudy_day' : 'partlycloudy_night' },
        details: {
          air_temperature_max: temperatureAtHour(hourOfDay + 5),
          air_temperature_min: temperatureAtHour(hourOfDay),
          precipitation_amount: 0.6,
          probability_of_precipitation: 20,
        },
      };
    }
    timeseries.push(entry);
  };

  let offset = 0;
  while (offset <= seamHours) {
    pushEntry(offset, 1);
    offset += 1;
  }
  // Align onto met.no's 6-hourly grid, exactly as the live series does.
  while (offset % 6 !== 0) offset += 1;
  while (offset < totalHours) {
    pushEntry(offset, 6);
    offset += 6;
  }
  // The final entry: an instant reading and no `next_*` block at all (D3).
  pushEntry(offset, 0);

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10.7522, 59.9139, 3] },
    properties: { meta: { updated_at: SERIES_START }, timeseries },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('aggregateMetnoDaily — the resolution seam', () => {
  it('gives a day the same min/max whether the seam falls before or after it', () => {
    // h+53 is Oslo's measured seam and h+65 is Tokyo's and Denver's (D3). Day 2
    // is hourly-then-6-hourly under the first and almost entirely hourly under
    // the second, so it crosses the seam in one fixture and not the other.
    const oslo = aggregateMetnoDaily(buildSeries(53, 240), 'UTC');
    const tokyo = aggregateMetnoDaily(buildSeries(65, 240), 'UTC');

    const shared = Math.min(oslo.days.length, tokyo.days.length);
    expect(shared).toBeGreaterThan(3);

    for (let i = 0; i < shared; i++) {
      expect(oslo.days[i]!.date).toBe(tokyo.days[i]!.date);
      expect(oslo.days[i]!.temperatureMaxC).toBe(tokyo.days[i]!.temperatureMaxC);
      expect(oslo.days[i]!.temperatureMinC).toBe(tokyo.days[i]!.temperatureMinC);
    }

    // And the values are the day's real extremes, not an artifact of either
    // resolution: 10 °C at 00:00 and 33 °C at 23:00.
    expect(oslo.days[2]!.temperatureMaxC).toBe(33);
    expect(oslo.days[2]!.temperatureMinC).toBe(10);
    expect(tokyo.days[2]!.temperatureMaxC).toBe(33);
    expect(tokyo.days[2]!.temperatureMinC).toBe(10);
  });

  it('reports which source fed each day, and reports "mixed" where the seam crosses one', () => {
    const aggregate = aggregateMetnoDaily(buildSeries(53, 240), 'UTC');

    // Day 0 is entirely hourly: only `instant` readings can feed it, because
    // `next_1_hours` carries no temperature at all.
    expect(aggregate.days[0]!.temperatureBasis).toBe('instant');
    // Day 2 straddles h+53: instants in the hourly part, 6-hour window extrema
    // beyond it.
    expect(aggregate.days[2]!.temperatureBasis).toBe('mixed');
    // Day 5 is entirely 6-hourly, so both sources are present (an instant
    // reading rides every entry) — still `mixed`, and never `window` alone here.
    expect(aggregate.days[5]!.temperatureBasis).toBe('mixed');
  });

  it('does not read the overlapping 6-hour window that rides every hourly entry', () => {
    // Every hourly entry in the fixture carries a `next_6_hours` block holding
    // absurd extremes (+99/-99) and 0.6 mm. Reading it would be a six-fold
    // overcount of precipitation and a nonsense temperature range; matching the
    // window to the step read from the timestamps is what prevents both.
    const day0 = aggregateMetnoDaily(buildSeries(53, 240), 'UTC').days[0]!;

    expect(day0.temperatureMaxC).toBe(33);
    expect(day0.temperatureMinC).toBe(10);
    // 24 hourly windows at 0.1 mm each.
    expect(day0.precipitationMm).toBeCloseTo(2.4, 10);
    expect(day0.precipitationProbabilityMaxPct).toBe(10);
  });

  it('sums a 6-hourly day from its own windows, once each', () => {
    const day5 = aggregateMetnoDaily(buildSeries(53, 240), 'UTC').days[5]!;
    // Four 6-hour windows at 0.6 mm each.
    expect(day5.precipitationMm).toBeCloseTo(2.4, 10);
    expect(day5.hoursCovered).toBe(24);
    expect(day5.complete).toBe(true);
  });
});

describe('aggregateMetnoDaily — the degenerate final day', () => {
  it('drops the trailing day the final window-less entry would otherwise create', () => {
    const response = buildSeries(53, 240);
    const series = response.properties!.timeseries!;
    const lastTime = series[series.length - 1]!.time!;
    const lastLocalDate = lastTime.slice(0, 10);

    const aggregate = aggregateMetnoDaily(response, 'UTC');

    expect(aggregate.days.some(day => day.date === lastLocalDate)).toBe(false);
    expect(aggregate.days.every(day => day.complete)).toBe(true);
    expect(aggregate.completeDayCount).toBe(aggregate.days.length);
  });

  it('drops a trailing day even when its final entry carries an empty data block', () => {
    const response = buildSeries(53, 240);
    const series = response.properties!.timeseries!;
    series[series.length - 1]!.data = {};

    const aggregate = aggregateMetnoDaily(response, 'UTC');
    const lastServed = aggregate.days[aggregate.days.length - 1]!;

    expect(lastServed.date < series[series.length - 1]!.time!.slice(0, 10)).toBe(true);
    expect(lastServed.complete).toBe(true);
  });

  it('keeps a leading partial day and reports its real coverage', () => {
    // The series begins at the current hour by construction, so the first local
    // day is always short. It is "today", it is kept, and it says so.
    const response = buildSeries(53, 240);
    for (const entry of response.properties!.timeseries!) {
      entry.time = isoAtOffset(entry.time!, 12);
    }

    const aggregate = aggregateMetnoDaily(response, 'UTC');

    expect(aggregate.days[0]!.hoursCovered).toBe(12);
    expect(aggregate.days[0]!.complete).toBe(false);
    expect(aggregate.days[0]!.startsAt).toContain('T12:00');
    expect(aggregate.completeDayCount).toBe(aggregate.days.length - 1);
    // Every other day is whole.
    expect(aggregate.days.slice(1).every(day => day.complete)).toBe(true);
  });
});

describe('aggregateMetnoDaily — missing data', () => {
  function oneDay(entries: MetnoTimeseriesEntry[]): MetnoForecastResponse {
    return { properties: { timeseries: entries } };
  }

  /** 24 hourly entries plus a window-less closer, so exactly one day is served. */
  function hourlyDay(
    detailsAt: (hour: number) => MetnoTimeseriesEntry['data']
  ): MetnoForecastResponse {
    const entries: MetnoTimeseriesEntry[] = [];
    for (let hour = 0; hour <= 24; hour++) {
      entries.push({ time: isoAtOffset(SERIES_START, hour), data: detailsAt(hour) });
    }
    return oneDay(entries);
  }

  it('fabricates no temperature from a next_1_hours-only day', () => {
    // `next_1_hours.details` is precipitation-only. A day whose entries carry
    // no `instant.air_temperature` has no temperature, and must not borrow one.
    const aggregate = aggregateMetnoDaily(
      hourlyDay(() => ({
        instant: { details: { wind_speed: 3 } },
        next_1_hours: {
          summary: { symbol_code: 'rain_day' },
          details: { precipitation_amount: 0.2, probability_of_precipitation: 55 },
        },
      })),
      'UTC'
    );

    const day = aggregate.days[0]!;
    expect(day.temperatureMaxC).toBeUndefined();
    expect(day.temperatureMinC).toBeUndefined();
    expect(day.temperatureBasis).toBeUndefined();
    // The precipitation it *did* publish still renders.
    expect(day.precipitationProbabilityMaxPct).toBe(55);
  });

  it("takes the day's symbol from the window nearest local midday", () => {
    // met.no publishes a symbol per window, so a day has up to 24 of them and
    // one has to be chosen. Midday is the choice, and it is deterministic:
    // "the first one" would report last night's sky as today's conditions, and
    // a modal pick would skew to whichever half of the day has more entries.
    const aggregate = aggregateMetnoDaily(
      hourlyDay(hour => ({
        instant: { details: { air_temperature: temperatureAtHour(hour % 24) } },
        next_1_hours: {
          summary: { symbol_code: `symbol_h${hour % 24}` },
          details: { precipitation_amount: 0 },
        },
      })),
      'UTC'
    );

    expect(aggregate.days[0]!.symbolCode).toBe('symbol_h12');
  });

  it("reports the day's strongest wind and the direction it was blowing from at that moment", () => {
    // The direction has to be the one that rode the strongest reading. A
    // direction taken from any other entry is a plausible-looking number
    // attached to the wrong wind.
    const aggregate = aggregateMetnoDaily(
      hourlyDay(hour => ({
        instant: {
          details: {
            air_temperature: temperatureAtHour(hour % 24),
            wind_speed: hour === 14 ? 17.5 : 3,
            wind_from_direction: hour === 14 ? 275 : 90,
          },
        },
        next_1_hours: { details: { precipitation_amount: 0 } },
      })),
      'UTC'
    );

    expect(aggregate.days[0]!.windSpeedMaxMps).toBe(17.5);
    expect(aggregate.days[0]!.windFromDirectionDeg).toBe(275);
  });

  it('reports a wind with no direction rather than pairing it with another hour’s', () => {
    const aggregate = aggregateMetnoDaily(
      hourlyDay(hour => ({
        instant: {
          details: {
            air_temperature: temperatureAtHour(hour % 24),
            wind_speed: hour === 14 ? 17.5 : 3,
            ...(hour === 14 ? {} : { wind_from_direction: 90 }),
          },
        },
        next_1_hours: { details: { precipitation_amount: 0 } },
      })),
      'UTC'
    );

    expect(aggregate.days[0]!.windSpeedMaxMps).toBe(17.5);
    expect(aggregate.days[0]!.windFromDirectionDeg).toBeUndefined();
  });

  it('leaves the symbol absent rather than inventing one when no window publishes it', () => {
    const aggregate = aggregateMetnoDaily(
      hourlyDay(hour => ({
        instant: { details: { air_temperature: temperatureAtHour(hour % 24) } },
        next_1_hours: { details: { precipitation_amount: 0 } },
      })),
      'UTC'
    );

    expect(aggregate.days[0]!.symbolCode).toBeUndefined();
  });

  it('ignores a temperature on a next_1_hours block even when the wire sends one', () => {
    // The type says `next_1_hours.details` has no temperature, which is what
    // the live product sends. A type is not a runtime guard, though: widening
    // it would not make the value newly reachable and narrowing it does not
    // make the value unreachable (G51), so the aggregator decides by which
    // window the entry owns, not by whether a field happened to parse.
    //
    // The cast is the point of the test — it is what the wire can do and the
    // compiler cannot stop.
    const aggregate = aggregateMetnoDaily(
      hourlyDay(hour => ({
        instant: { details: { air_temperature: temperatureAtHour(hour % 24) } },
        next_1_hours: {
          details: {
            precipitation_amount: 0,
            air_temperature_max: 500,
            air_temperature_min: -500,
          },
        },
      } as unknown as MetnoTimeseriesEntry['data'])),
      'UTC'
    );

    expect(aggregate.days[0]!.temperatureMaxC).toBe(33);
    expect(aggregate.days[0]!.temperatureMinC).toBe(10);
    expect(aggregate.days[0]!.temperatureBasis).toBe('instant');
  });

  it('excludes a null air_temperature from the extremes instead of reading it as 0 °C', () => {
    const aggregate = aggregateMetnoDaily(
      hourlyDay(hour => ({
        instant: { details: { air_temperature: hour === 3 ? null : temperatureAtHour(hour % 24) } },
        next_1_hours: { details: { precipitation_amount: 0 } },
      })),
      'UTC'
    );

    const day = aggregate.days[0]!;
    // 0 °C is nowhere in this series; a `null` read as 0 would become the low.
    expect(day.temperatureMinC).toBe(10);
    expect(day.temperatureMaxC).toBe(33);
  });

  it('keeps a real 0 °C reading, which is a valid temperature and not a sentinel', () => {
    const aggregate = aggregateMetnoDaily(
      hourlyDay(hour => ({
        instant: { details: { air_temperature: hour === 4 ? 0 : 10 + (hour % 24) } },
        next_1_hours: { details: { precipitation_amount: 0 } },
      })),
      'UTC'
    );

    expect(aggregate.days[0]!.temperatureMinC).toBe(0);
  });

  it('treats NaN like a missing reading', () => {
    const aggregate = aggregateMetnoDaily(
      hourlyDay(hour => ({
        instant: { details: { air_temperature: hour === 5 ? Number.NaN : temperatureAtHour(hour % 24) } },
        next_1_hours: { details: { precipitation_amount: 0 } },
      })),
      'UTC'
    );

    expect(Number.isNaN(aggregate.days[0]!.temperatureMinC)).toBe(false);
    expect(aggregate.days[0]!.temperatureMinC).toBe(10);
  });
});

describe('aggregateMetnoDaily — series shape', () => {
  it('does not mis-bucket a series whose step changes more than once', () => {
    // 1, 1, 1, 6, 1, 6, 1, 6, 1 — a pattern no real feed publishes, which is
    // exactly why it belongs here: the aggregator reads each gap rather than
    // assuming the series changes resolution once, at one seam.
    const offsets = [0, 1, 2, 3, 9, 10, 16, 17, 23, 24];
    const entries: MetnoTimeseriesEntry[] = offsets.map((offset, index) => {
      const step = index < offsets.length - 1 ? offsets[index + 1]! - offset : 0;
      const data: MetnoTimeseriesEntry['data'] = {
        instant: { details: { air_temperature: temperatureAtHour(offset % 24) } },
      };
      // Every entry carries both blocks, as the live product does inside the
      // hourly segment. Exactly one of them is the entry's own window.
      data.next_1_hours = { details: { precipitation_amount: 1 } };
      data.next_6_hours = {
        details: {
          precipitation_amount: 6,
          air_temperature_max: temperatureAtHour((offset + 5) % 24),
          air_temperature_min: temperatureAtHour(offset % 24),
        },
      };
      if (step === 0) {
        // The closer carries no window at all (D3).
        delete data.next_1_hours;
        delete data.next_6_hours;
      }
      return { time: isoAtOffset(SERIES_START, offset), data };
    });

    const day = aggregateMetnoDaily({ properties: { timeseries: entries } }, 'UTC').days[0]!;

    // 1+1+1+6+1+6+1+6+1 — the day is covered exactly once, end to end.
    expect(day.hoursCovered).toBe(24);
    expect(day.complete).toBe(true);
    // Six 1-hour windows at 1 mm and three 6-hour windows at 6 mm: 24 mm, which
    // is 1 mm for every hour of the day and no hour counted twice. Reading the
    // wrong block anywhere in this series moves this number.
    expect(day.precipitationMm).toBeCloseTo(24, 10);
    // The 6-hour windows fill the gaps the sparse instants leave.
    expect(day.temperatureMinC).toBe(10);
    expect(day.temperatureMaxC).toBe(33);
    expect(day.temperatureBasis).toBe('mixed');
  });

  it('sorts an out-of-order series before deriving any step', () => {
    const response = buildSeries(53, 240);
    const series = response.properties!.timeseries!;
    const shuffled = [series[5]!, series[1]!, ...series.slice(6), series[0]!, ...series.slice(2, 5)];
    const aggregate = aggregateMetnoDaily(
      { properties: { timeseries: shuffled } },
      'UTC'
    );

    expect(aggregate.days[0]!.temperatureMaxC).toBe(33);
    expect(aggregate.days[0]!.hoursCovered).toBe(24);
  });

  it('skips entries whose timestamp is missing or unreadable', () => {
    const response = buildSeries(53, 120);
    const series = response.properties!.timeseries!;
    delete series[30]!.time;
    series[40]!.time = 'not a timestamp';

    const aggregate = aggregateMetnoDaily(response, 'UTC');

    expect(aggregate.entriesSeen).toBe(series.length);
    expect(aggregate.entriesAggregated).toBe(series.length - 2);
    expect(aggregate.days.length).toBeGreaterThan(0);
  });

  it('trims a series above the cap, warns once, and says it trimmed', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const entries: MetnoTimeseriesEntry[] = [];
    for (let hour = 0; hour <= METNO_MAX_TIMESERIES_ENTRIES; hour++) {
      entries.push({
        time: isoAtOffset(SERIES_START, hour),
        data: {
          instant: { details: { air_temperature: temperatureAtHour(hour % 24) } },
          next_1_hours: { details: { precipitation_amount: 0 } },
        },
      });
    }

    const aggregate = aggregateMetnoDaily({ properties: { timeseries: entries } }, 'UTC');

    expect(aggregate.entriesSeen).toBe(METNO_MAX_TIMESERIES_ENTRIES + 1);
    expect(aggregate.entriesAggregated).toBe(METNO_MAX_TIMESERIES_ENTRIES);
    expect(aggregate.entriesTrimmed).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toMatchObject({ securityEvent: true });
  });

  it('does not trim, or claim to have trimmed, a series at the cap', () => {
    const aggregate = aggregateMetnoDaily(buildSeries(53, 240), 'UTC');
    expect(aggregate.entriesTrimmed).toBe(false);
    expect(aggregate.entriesAggregated).toBe(aggregate.entriesSeen);
  });
});

describe('aggregateMetnoDaily — timezone', () => {
  it('buckets by the timezone it is given, not by UTC or the ambient zone', () => {
    const response = buildSeries(53, 240);

    const utc = aggregateMetnoDaily(response, 'UTC');
    const tokyo = aggregateMetnoDaily(response, 'Asia/Tokyo');

    expect(utc.timezone).toBe('UTC');
    expect(tokyo.timezone).toBe('Asia/Tokyo');
    // The same instants, nine hours later locally, so Tokyo's first day starts
    // at 09:00 local and is short where UTC's is whole.
    expect(utc.days[0]!.hoursCovered).toBe(24);
    expect(tokyo.days[0]!.hoursCovered).toBe(15);
    expect(tokyo.days[0]!.startsAt).toContain('T09:00');
  });

  it('rejects an unrecognized timezone rather than silently falling back to one', () => {
    expect(() => aggregateMetnoDaily(buildSeries(53, 120), 'Mars/Olympus')).toThrow(
      /unrecognized timezone/i
    );
  });
});

describe('aggregateMetnoDaily — unusable responses throw a fixed message', () => {
  it('throws when there is no timeseries at all', () => {
    expect(() => aggregateMetnoDaily({}, 'UTC')).toThrow('MET Norway forecast carries no timeseries');
  });

  it('throws on an empty timeseries rather than returning an empty forecast', () => {
    expect(() => aggregateMetnoDaily({ properties: { timeseries: [] } }, 'UTC')).toThrow(
      'MET Norway forecast carries no timeseries'
    );
  });

  it('throws when no entry carries a readable timestamp', () => {
    expect(() =>
      aggregateMetnoDaily({ properties: { timeseries: [{ data: {} }, { time: 'nope' }] } }, 'UTC')
    ).toThrow('MET Norway forecast carries no readable timestamps');
  });

  it('never leaks upstream content into a thrown message', () => {
    try {
      aggregateMetnoDaily({ properties: { timeseries: [{ time: 'nope' }] } }, 'UTC');
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('nope');
      expect((error as Error).message).not.toContain('api.met.no');
    }
  });
});

describe('describeMetnoSymbol', () => {
  it('glosses a base code', () => {
    expect(describeMetnoSymbol('clearsky')).toBe('Clear sky');
    expect(describeMetnoSymbol('partlycloudy')).toBe('Partly cloudy');
    expect(describeMetnoSymbol('heavyrainshowersandthunder')).toBe(
      'Heavy rain showers and thunder'
    );
  });

  it('strips the time-of-day suffix rather than enumerating every variant', () => {
    expect(describeMetnoSymbol('clearsky_day')).toBe('Clear sky');
    expect(describeMetnoSymbol('clearsky_night')).toBe('Clear sky');
    expect(describeMetnoSymbol('clearsky_polartwilight')).toBe('Clear sky');
    expect(describeMetnoSymbol('lightrainshowers_polartwilight')).toBe('Light rain showers');
  });

  it("keeps met.no's own double-s spellings, because the key must match the wire", () => {
    expect(describeMetnoSymbol('lightssleetshowersandthunder_day')).toBe(
      'Light sleet showers and thunder'
    );
    expect(describeMetnoSymbol('lightssnowshowersandthunder_night')).toBe(
      'Light snow showers and thunder'
    );
  });

  it('returns the raw code when the gloss is unknown', () => {
    // met.no may add vocabulary at any time. An unmapped code is a missing
    // gloss, never a thrown error and never a blank.
    expect(describeMetnoSymbol('meteorshower_day')).toBe('meteorshower_day');
    expect(describeMetnoSymbol('')).toBe('');
  });

  it('never throws, whatever it is handed', () => {
    expect(() => describeMetnoSymbol('_day')).not.toThrow();
    expect(describeMetnoSymbol('_day')).toBe('_day');
  });
});
