/**
 * Unit tests for river-conditions sentinel handling.
 *
 * Regression coverage for BUG-2 (2026-07-13): NWPS returns placeholder forecast rows
 * with -999 stage/flow values and a year-0001 validTime (rendered as "Dec 31, 1"),
 * and a "fcst_not_current" category. These must be suppressed, not printed raw.
 */

import { describe, it, expect } from 'vitest';
import { isRealValue, isUsableForecast } from '../../src/handlers/riverConditionsHandler.js';
import type { GaugeStatus } from '../../src/types/noaa.js';

function status(overrides: Partial<GaugeStatus> = {}): GaugeStatus {
  return {
    primary: 4.2,
    secondary: 0.05,
    floodCategory: 'no_flooding',
    validTime: '2026-07-13T14:15:00Z',
    ...overrides,
  };
}

describe('isRealValue', () => {
  it('accepts real numeric readings', () => {
    expect(isRealValue(4.2)).toBe(true);
    expect(isRealValue(0)).toBe(true);
    expect(isRealValue(-5)).toBe(true); // plausible low stage, not a sentinel
  });

  it('rejects null/undefined and NWPS missing-data sentinels', () => {
    expect(isRealValue(null)).toBe(false);
    expect(isRealValue(undefined)).toBe(false);
    expect(isRealValue(-999)).toBe(false);
    expect(isRealValue(-999999)).toBe(false);
    expect(isRealValue(NaN)).toBe(false);
    expect(isRealValue(Infinity)).toBe(false);
  });
});

describe('isUsableForecast', () => {
  it('accepts a forecast with real values and a current timestamp', () => {
    expect(isUsableForecast(status())).toBe(true);
  });

  it('rejects the NWPS placeholder forecast (-999 values + year-0001 time)', () => {
    expect(
      isUsableForecast(status({ primary: -999, secondary: -999, validTime: '0001-12-31T18:27:00Z' })),
    ).toBe(false);
  });

  it('rejects a forecast whose values are real but timestamp is a year-0001 placeholder', () => {
    expect(isUsableForecast(status({ validTime: '0001-12-31T18:27:00Z' }))).toBe(false);
  });

  it('rejects a forecast with a valid time but only sentinel values', () => {
    expect(isUsableForecast(status({ primary: -999, secondary: -999 }))).toBe(false);
  });

  it('rejects an unparseable validTime', () => {
    expect(isUsableForecast(status({ validTime: 'not-a-date' }))).toBe(false);
  });

  it('accepts when at least one of stage/flow is real', () => {
    expect(isUsableForecast(status({ primary: -999, secondary: 0.17 }))).toBe(true);
  });
});
