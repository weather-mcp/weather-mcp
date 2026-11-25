/**
 * getHistoricalDataTTL measures a historical range from its END against a
 * seven-day correction window (RF-34). Boundary instants are built from the
 * literal seven days, never from CacheConfig.historicalCorrectionWindow, so a
 * change to the window turns these red instead of moving with them (G160).
 * Date-only ends are read with Date.UTC, so the answer is the same in every
 * process zone (G162).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheConfig, getHistoricalDataTTL } from '../../src/config/cache.js';

const HOUR_MS = 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 25, 18, 0, 0); // 2026-11-25T18:00:00Z

const RECENT = 1 * HOUR_MS;
const FINAL = Infinity;

const ORIGINAL_TZ = process.env.TZ;
function restoreTz(): void {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
}

/** The end instant of a date-only end D: D+1 00:00 at UTC-12. */
function dateOnlyEndMs(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d + 1) + 12 * HOUR_MS;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  restoreTz();
});

describe('historicalCorrectionWindow', () => {
  it('is exactly seven days', () => {
    expect(CacheConfig.historicalCorrectionWindow).toBe(SEVEN_DAYS_MS);
  });

  it('keeps the TTLs it chooses between', () => {
    expect(CacheConfig.ttl.recentHistorical).toBe(RECENT);
    expect(CacheConfig.ttl.historicalData).toBe(FINAL);
  });
});

describe('getHistoricalDataTTL — date-only end', () => {
  const ZONES = ['UTC', 'America/New_York', 'Pacific/Auckland'];
  const ROWS: Array<[string, number]> = [
    ['2026-11-25', RECENT], // today
    ['2026-11-24', RECENT], // yesterday
    ['2026-11-19', RECENT], // six days ago
    ['2026-11-18', RECENT], // seven calendar days ago: its end is 6 d 6 h old
    ['2026-11-17', FINAL], // eight calendar days ago: its end is 7 d 6 h old
    ['2026-10-26', FINAL], // a month ago
    ['2024-01-15', FINAL],
  ];

  for (const zone of ZONES) {
    it(`gives the same answer in ${zone}`, () => {
      process.env.TZ = zone;
      if (zone === 'America/New_York') expect(new Date('2024-03-05').getDate()).toBe(4);
      for (const [end, expected] of ROWS) {
        expect(getHistoricalDataTTL(end), end).toBe(expected);
      }
    });
  }

  it('turns final exactly seven days after the latest local midnight of the end date', () => {
    const endMs = dateOnlyEndMs(2026, 11, 10);
    vi.setSystemTime(endMs + SEVEN_DAYS_MS - 1);
    expect(getHistoricalDataTTL('2026-11-10')).toBe(RECENT);
    vi.setSystemTime(endMs + SEVEN_DAYS_MS);
    expect(getHistoricalDataTTL('2026-11-10')).toBe(FINAL);
  });

  it('ignores the start of the range: a month-long range ending today is recent', () => {
    // The services pass the end; the old start-based rule cached this forever.
    expect(getHistoricalDataTTL('2026-10-26')).toBe(FINAL);
    expect(getHistoricalDataTTL('2026-11-25')).toBe(RECENT);
  });
});

describe('getHistoricalDataTTL — instant end', () => {
  it('measures a Date from the instant it names', () => {
    expect(getHistoricalDataTTL(new Date(NOW - SEVEN_DAYS_MS + 1))).toBe(RECENT);
    expect(getHistoricalDataTTL(new Date(NOW - SEVEN_DAYS_MS))).toBe(FINAL);
    expect(getHistoricalDataTTL(new Date(NOW - 30 * 24 * HOUR_MS))).toBe(FINAL);
  });

  it('measures an ISO string with an offset from the instant it names', () => {
    expect(getHistoricalDataTTL(new Date(NOW - SEVEN_DAYS_MS + 1).toISOString())).toBe(RECENT);
    expect(getHistoricalDataTTL(new Date(NOW - SEVEN_DAYS_MS).toISOString())).toBe(FINAL);
  });

  it('treats a future end as recent', () => {
    expect(getHistoricalDataTTL(new Date(NOW + HOUR_MS))).toBe(RECENT);
  });
});

describe('getHistoricalDataTTL — unreadable end', () => {
  it('never caches an unreadable end forever', () => {
    expect(getHistoricalDataTTL('not-a-date')).toBe(RECENT);
    expect(getHistoricalDataTTL('')).toBe(RECENT);
    expect(getHistoricalDataTTL(new Date(NaN))).toBe(RECENT);
  });
});
