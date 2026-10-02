import { describe, it, expect } from 'vitest';
import {
  NOWCAST_MODELS,
  NOWCAST_NO_DATA_REASON,
  NOWCAST_BAND_THRESHOLDS_MM,
  selectNowcastModel,
  classifyNowcastResponse,
  bandForQuarter,
  quarterEpochMs,
  liveQuarterIndices,
  hourlyProbabilities,
  msUntilNextQuarter,
} from '../../src/utils/nowcast.js';

describe('NOWCAST_MODELS', () => {
  it('names each model and its cadence', () => {
    expect(NOWCAST_MODELS.gfs_hrrr).toEqual({ label: 'HRRR (NOAA)', cadence: 'updates hourly' });
    expect(NOWCAST_MODELS.icon_d2).toEqual({ label: 'ICON-D2 (DWD)', cadence: 'updates every 3 hours' });
  });
});

describe('selectNowcastModel', () => {
  describe('HRRR box edges (lat 21..58, lon -135..-60, inclusive)', () => {
    it.each([
      ['south edge in', 21, -100, 'gfs_hrrr'],
      ['south edge just out', 20.999, -100, null],
      ['north edge in', 58, -100, 'gfs_hrrr'],
      ['north edge just out', 58.001, -100, null],
      ['west edge in', 40, -135, 'gfs_hrrr'],
      ['west edge just out', 40, -135.001, null],
      ['east edge in', 40, -60, 'gfs_hrrr'],
      ['east edge just out', 40, -59.999, null],
    ])('%s', (_name, lat, lon, expected) => {
      expect(selectNowcastModel(lat, lon)).toBe(expected);
    });
  });

  describe('ICON-D2 box edges (lat 43..59, lon -4..21, inclusive)', () => {
    it.each([
      ['south edge in', 43, 10, 'icon_d2'],
      ['south edge just out', 42.999, 10, null],
      ['north edge in', 59, 10, 'icon_d2'],
      ['north edge just out', 59.001, 10, null],
      ['west edge in', 50, -4, 'icon_d2'],
      ['west edge just out', 50, -4.001, null],
      ['east edge in', 50, 21, 'icon_d2'],
      ['east edge just out', 50, 21.001, null],
    ])('%s', (_name, lat, lon, expected) => {
      expect(selectNowcastModel(lat, lon)).toBe(expected);
    });
  });

  describe('spot points', () => {
    it.each([
      ['Michigan', 43.82, -84.77],
      ['Key West', 24.55, -81.78],
      ['Monterrey', 25.67, -100.31],
      ['Calgary', 51.05, -114.07],
      ['Edmonton', 53.5, -113.5],
      ['Maine', 44.8, -68.8],
      ['Halifax (east of -66)', 44.65, -63.57],
      ['in box, answers 400 (22,-98)', 22, -98],
    ])('%s -> gfs_hrrr', (_name, lat, lon) => {
      expect(selectNowcastModel(lat, lon)).toBe('gfs_hrrr');
    });

    it.each([
      ['Paris', 48.85, 2.35],
      ['London', 51.51, -0.13],
      ['Krakow (in box; the response says not-covered)', 50.06, 19.94],
      ['57.5,20', 57.5, 20],
    ])('%s -> icon_d2', (_name, lat, lon) => {
      expect(selectNowcastModel(lat, lon)).toBe('icon_d2');
    });

    it.each([
      ['Madrid (lat < 43)', 40.42, -3.7],
      ['Tokyo', 35.68, 139.65],
      ['Honolulu', 21.31, -157.86],
      ['Anchorage', 61.22, -149.9],
      ['Mexico City (lat < 21)', 19.43, -99.13],
    ])('%s -> null', (_name, lat, lon) => {
      expect(selectNowcastModel(lat, lon)).toBeNull();
    });
  });
});

describe('classifyNowcastResponse', () => {
  const covered = { minutely_15: { precipitation: [0, 0.2, null], precipitation_probability: [10, 20, 30] } };

  it('200 with a finite precipitation value is covered', () => {
    expect(classifyNowcastResponse(200, covered)).toBe('covered');
  });

  it('200 with one finite value among nulls is covered', () => {
    expect(classifyNowcastResponse(200, { minutely_15: { precipitation: [null, null, 0] } })).toBe('covered');
  });

  it('200 with all-null precipitation and full probability is not-covered', () => {
    expect(
      classifyNowcastResponse(200, {
        minutely_15: { precipitation: [null, null, null], precipitation_probability: [50, 60, 70, 80] },
      })
    ).toBe('not-covered');
  });

  it('200 with only a populated probability (no precipitation key) is not-covered', () => {
    expect(
      classifyNowcastResponse(200, { minutely_15: { precipitation_probability: [50, 60] } })
    ).toBe('not-covered');
  });

  it.each([
    ['precipitation not an array', { minutely_15: { precipitation: 'x' } }],
    ['no minutely_15', { hourly: {} }],
    ['empty precipitation', { minutely_15: { precipitation: [] } }],
    ['null body', null],
    ['string body', ''],
  ])('200 with %s is not-covered', (_name, body) => {
    expect(classifyNowcastResponse(200, body)).toBe('not-covered');
  });

  it('400 with the exact no-data reason is not-covered', () => {
    expect(classifyNowcastResponse(400, { error: true, reason: NOWCAST_NO_DATA_REASON })).toBe('not-covered');
  });

  it('400 with another reason is an error', () => {
    expect(classifyNowcastResponse(400, { error: true, reason: 'Latitude must be in range' })).toBe('error');
  });

  it('400 with a reason that merely contains the no-data text is an error', () => {
    expect(
      classifyNowcastResponse(400, { reason: `${NOWCAST_NO_DATA_REASON} for this model` })
    ).toBe('error');
  });

  it("400 with data '' is an error (G111)", () => {
    expect(classifyNowcastResponse(400, '')).toBe('error');
  });

  it('400 with data null is an error', () => {
    expect(classifyNowcastResponse(400, null)).toBe('error');
  });

  it('400 with the reason text as a bare string is an error', () => {
    expect(classifyNowcastResponse(400, NOWCAST_NO_DATA_REASON)).toBe('error');
  });

  it('400 with an array body is an error', () => {
    expect(classifyNowcastResponse(400, [NOWCAST_NO_DATA_REASON])).toBe('error');
  });

  it('500 is an error', () => {
    expect(classifyNowcastResponse(500, covered)).toBe('error');
  });

  it('404 and 429 are errors', () => {
    expect(classifyNowcastResponse(404, {})).toBe('error');
    expect(classifyNowcastResponse(429, {})).toBe('error');
  });
});

describe('bandForQuarter', () => {
  // Expected bands derived from (v).toFixed(2) in node (G36):
  // 0.004->0.00, 0.006->0.01, 0.094->0.09, 0.096->0.10, 0.694->0.69, 0.696->0.70, 1.994->1.99, 1.996->2.00
  it.each([
    [0, 'none'],
    [0.004, 'none'],
    [0.006, 'trace'],
    [0.094, 'trace'],
    [0.096, 'light'],
    [0.694, 'light'],
    [0.696, 'moderate'],
    [1.994, 'moderate'],
    [1.996, 'heavy'],
    [5, 'heavy'],
  ])('%s mm -> %s', (mm, band) => {
    expect(bandForQuarter(mm)).toBe(band);
  });

  it('bands on the rounded display value, not the raw value (0.004 is none, not trace)', () => {
    expect(bandForQuarter(0.004)).toBe('none');
    expect(bandForQuarter(0.096)).toBe('light');
  });

  it('keeps trace distinct from none', () => {
    expect(bandForQuarter(0.05)).toBe('trace');
    expect(bandForQuarter(0.2)).toBe('light');
  });

  it('returns null, never none, for null / undefined / NaN / Infinity / negative (G56)', () => {
    expect(bandForQuarter(null)).toBeNull();
    expect(bandForQuarter(undefined)).toBeNull();
    expect(bandForQuarter(NaN)).toBeNull();
    expect(bandForQuarter(Infinity)).toBeNull();
    expect(bandForQuarter(-0.1)).toBeNull();
  });

  it('exports the thresholds in mm', () => {
    expect(NOWCAST_BAND_THRESHOLDS_MM).toEqual({ traceBelow: 0.1, lightBelow: 0.7, moderateBelow: 2 });
  });
});

describe('quarterEpochMs', () => {
  it('converts local time with a negative UTC offset (EDT)', () => {
    expect(quarterEpochMs('2026-10-01T15:00', -14400)).toBe(Date.UTC(2026, 9, 1, 19, 0));
  });

  it('converts local time with a positive UTC offset (CEST)', () => {
    expect(quarterEpochMs('2026-10-01T15:15', 7200)).toBe(Date.UTC(2026, 9, 1, 13, 15));
  });

  it('crosses a day boundary', () => {
    expect(quarterEpochMs('2026-10-01T23:45', -14400)).toBe(Date.UTC(2026, 9, 2, 3, 45));
  });

  it('returns NaN for an unparseable string', () => {
    expect(quarterEpochMs('nope', 0)).toBeNaN();
  });
});

describe('liveQuarterIndices', () => {
  const times = ['2026-10-01T15:00', '2026-10-01T15:15', '2026-10-01T15:30'];
  const offset = -14400;
  const start0 = Date.UTC(2026, 9, 1, 19, 0);
  const min = 60 * 1000;

  it('keeps the first quarter while now is inside it', () => {
    expect(liveQuarterIndices(times, offset, start0 + 5 * min)).toEqual([0, 1, 2]);
  });

  it('keeps a quarter one ms before its end', () => {
    expect(liveQuarterIndices(times, offset, start0 + 15 * min - 1)).toEqual([0, 1, 2]);
  });

  it('drops a quarter at its exact end', () => {
    expect(liveQuarterIndices(times, offset, start0 + 15 * min)).toEqual([1, 2]);
  });

  it('returns nothing when every quarter has ended', () => {
    expect(liveQuarterIndices(times, offset, start0 + 45 * min)).toEqual([]);
  });
});

describe('hourlyProbabilities', () => {
  // The design's measured ramp: only :00 values are model figures, the rest interpolated.
  const probs = [76, 76, 74, 70, 67, 65, 63, 61, 59];
  const fromHour = [
    '2026-10-01T15:00', '2026-10-01T15:15', '2026-10-01T15:30', '2026-10-01T15:45',
    '2026-10-01T16:00', '2026-10-01T16:15', '2026-10-01T16:30', '2026-10-01T16:45',
    '2026-10-01T17:00',
  ];
  const all = fromHour.map((_t, i) => i);

  it('picks only the on-the-hour quarters, never an interpolated one', () => {
    expect(hourlyProbabilities(fromHour, probs, all)).toEqual([
      { index: 0, percent: 76 },
      { index: 4, percent: 67 },
      { index: 8, percent: 59 },
    ]);
  });

  it('a window of eight quarters from HH:00 yields exactly two entries', () => {
    expect(hourlyProbabilities(fromHour, probs, all.slice(0, 8))).toHaveLength(2);
  });

  it('a window starting at HH:15 has no entry for that hour', () => {
    expect(hourlyProbabilities(fromHour, probs, all.slice(1, 5))).toEqual([{ index: 4, percent: 67 }]);
    expect(hourlyProbabilities(fromHour, probs, all.slice(1, 4))).toEqual([]);
  });

  it('skips on-the-hour quarters whose probability is null or non-finite', () => {
    const p: Array<number | null> = [null, 1, 2, 3, NaN, 5, 6, 7, 59];
    expect(hourlyProbabilities(fromHour, p, all)).toEqual([{ index: 8, percent: 59 }]);
  });

  it('never reads an interpolated value even when it is the only finite one', () => {
    const p: Array<number | null> = [null, 50, null, null, null, null, null, null, null];
    expect(hourlyProbabilities(fromHour, p, all)).toEqual([]);
  });
});

describe('msUntilNextQuarter', () => {
  const min = 60 * 1000;
  const base = Date.UTC(2026, 9, 1, 19, 0);

  it('returns the time to the next UTC quarter boundary', () => {
    expect(msUntilNextQuarter(base + 5 * min)).toBe(10 * min);
    expect(msUntilNextQuarter(base + 14 * min)).toBe(1 * min);
  });

  it('returns a full quarter exactly on a boundary', () => {
    expect(msUntilNextQuarter(base)).toBe(15 * min);
  });

  it('clamps to at least 1000 ms', () => {
    expect(msUntilNextQuarter(base + 15 * min - 1)).toBe(1000);
    expect(msUntilNextQuarter(base + 15 * min - 500)).toBe(1000);
  });

  it('never exceeds 15 minutes', () => {
    for (let i = 0; i < 1000; i++) {
      const v = msUntilNextQuarter(base + i * 7919);
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(15 * min);
    }
  });
});
