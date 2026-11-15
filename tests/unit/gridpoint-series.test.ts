import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GRIDPOINT_MAX_ENTRIES,
  parseValidTime,
  valueAt,
  maxOverlapping
} from '../../src/utils/gridpointSeries.js';
import { logger } from '../../src/utils/logger.js';

const START = '2026-11-14T12:00:00+00:00';
const START_MS = Date.parse(START);
const H = 3_600_000;
const D = 24 * H;

const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', '+00:00');
const entry = (startMs: number, dur: string, value: unknown) => ({ validTime: `${iso(startMs)}/${dur}`, value });

describe('parseValidTime', () => {
  it.each([
    ['PT1H', H],
    ['PT2H', 2 * H],
    ['PT5H', 5 * H],
    ['PT19H', 19 * H],
    ['P1D', D],
    ['P5D', 5 * D],
    ['P1DT6H', D + 6 * H],
    ['P2DT21H', 2 * D + 21 * H],
    ['P7DT18H', 7 * D + 18 * H],
    ['P8DT6H', 8 * D + 6 * H],
    ['PT30M', 30 * 60_000]
  ])('parses %s with an exact end', (dur, ms) => {
    expect(parseValidTime(`${START}/${dur}`)).toEqual({ startMs: START_MS, endMs: START_MS + ms });
  });

  it('accepts a Z start', () => {
    expect(parseValidTime('2026-11-14T12:00:00Z/PT1H')).toEqual({ startMs: START_MS, endMs: START_MS + H });
  });

  it.each([
    ['no slash', START],
    ['three parts', `${START}/PT1H/PT1H`],
    ['empty string', ''],
    ['unparseable start', 'nonsense+00:00/PT1H'],
    ['naive start', '2026-11-14T12:00:00/PT1H'],
    ['P', `${START}/P`],
    ['PT', `${START}/PT`],
    ['P1DT', `${START}/P1DT`],
    ['week', `${START}/P1W`],
    ['month as P1M', `${START}/P1M`],
    ['seconds', `${START}/PT1S`],
    ['zero hours', `${START}/PT0H`],
    ['no P', `${START}/1H`]
  ])('returns null for %s', (_label, input) => {
    expect(parseValidTime(input)).toBeNull();
  });

  it('returns null for a number', () => {
    expect(parseValidTime(12345)).toBeNull();
  });
});

describe('valueAt', () => {
  const now = START_MS + 30 * 60_000;

  it('includes the start and excludes the end', () => {
    const series = { values: [entry(START_MS, 'PT1H', 7)] };
    expect(valueAt(series, START_MS)).toBe(7);
    expect(valueAt(series, START_MS + H)).toBeNull();
    expect(valueAt(series, START_MS + H - 1)).toBe(7);
  });

  it('returns null before the first and after the last interval', () => {
    const series = { values: [entry(START_MS, 'PT1H', 7), entry(START_MS + H, 'PT1H', 8)] };
    expect(valueAt(series, START_MS - 1)).toBeNull();
    expect(valueAt(series, START_MS + 2 * H)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN]
  ])('returns null for a %s value', (_label, value) => {
    expect(valueAt({ values: [entry(START_MS, 'PT1H', value)] }, now)).toBeNull();
  });

  it('does not search past the containing interval when its value is missing', () => {
    const series = { values: [entry(START_MS, 'PT1H', null), entry(START_MS, 'PT1H', 5)] };
    expect(valueAt(series, now)).toBeNull();
  });

  it('returns null for empty, absent and values-less series', () => {
    expect(valueAt({ values: [] }, now)).toBeNull();
    expect(valueAt(undefined, now)).toBeNull();
    expect(valueAt({}, now)).toBeNull();
  });

  it('skips a stale first interval and returns the current one', () => {
    const n = START_MS;
    const series = {
      values: [entry(n - 9 * H, 'PT8H', 150), entry(n - H, 'PT2H', 732)]
    };
    expect(valueAt(series, n)).toBe(732);
  });
});

describe('maxOverlapping', () => {
  const from = START_MS;
  const to = START_MS + 48 * H;

  it('counts an in-progress interval', () => {
    expect(maxOverlapping({ values: [entry(from - 2 * H, 'PT4H', 3)] }, from, to)).toBe(3);
  });

  it('does not count an interval ending exactly at fromMs', () => {
    expect(maxOverlapping({ values: [entry(from - H, 'PT1H', 3)] }, from, to)).toBeNull();
  });

  it('counts an interval starting exactly at toMs', () => {
    expect(maxOverlapping({ values: [entry(to, 'PT1H', 3)] }, from, to)).toBe(3);
  });

  it('does not count an interval starting after toMs', () => {
    expect(maxOverlapping({ values: [entry(to + 1000, 'PT1H', 3)] }, from, to)).toBeNull();
  });

  it('returns null when every value is missing', () => {
    const series = { values: [entry(from, 'PT1H', null), entry(from + H, 'PT1H', undefined), entry(from + 2 * H, 'PT1H', Number.NaN)] };
    expect(maxOverlapping(series, from, to)).toBeNull();
  });

  it('returns the largest of several finite overlapping values', () => {
    const series = { values: [entry(from, 'PT1H', 4), entry(from + H, 'PT1H', 9), entry(from + 2 * H, 'PT1H', 9)] };
    expect(maxOverlapping(series, from, to)).toBe(9);
  });

  it('returns null for absent series', () => {
    expect(maxOverlapping(undefined, from, to)).toBeNull();
    expect(maxOverlapping({}, from, to)).toBeNull();
  });
});

describe('cap', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const build = (n: number, marker: number) => ({
    values: Array.from({ length: n }, (_v, i) => entry(START_MS + i * H, 'PT1H', i === n - 1 ? marker : 1))
  });

  it('pins the constant', () => {
    expect(GRIDPOINT_MAX_ENTRIES).toBe(500);
  });

  it('reads 500 entries without a warn', () => {
    const series = build(500, 99);
    expect(valueAt(series, START_MS + 499 * H + 1)).toBe(99);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once with the exact object and ignores entry 501', () => {
    const series = build(501, 99);
    expect(valueAt(series, START_MS + 500 * H + 1)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Gridpoint series exceeds max entries', {
      length: 501,
      maxEntries: 500,
      securityEvent: true
    });
    expect(series.values).toHaveLength(501);
  });

  it('applies the cap to maxOverlapping too', () => {
    const series = build(501, 99);
    expect(maxOverlapping(series, START_MS, START_MS + 600 * H)).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
