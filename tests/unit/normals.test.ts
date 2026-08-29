/**
 * Unit tests for climate normals utilities
 */

import { describe, it, expect, vi } from 'vitest';
import {
  calculateDeparture,
  formatNormals,
  getDateComponents,
  getClimateNormals,
  renderNormalsSection,
  computeNormalsTable,
  getNormalsTableCacheKey,
  type NormalsTable
} from '../../src/utils/normals.js';
import type { OpenMeteoHistoricalResponse } from '../../src/types/openmeteo.js';
import { METRIC_PREFERENCES } from '../../src/config/units.js';

/**
 * Build a synthetic full-year(ish) archive response for `computeNormalsTable`.
 * `entries` maps a `"MM-DD"` key to the per-year samples for that calendar
 * date (temp high/low in °C, precipitation in mm); `null` in any position
 * simulates Open-Meteo's null-padding. Each entry produces one `daily.time`
 * row per array element, dated against a distinct fabricated year so the
 * function under test never sees duplicate dates.
 *
 * The `OpenMeteoDailyData` series are declared `(number | null)[]`, matching
 * what the real API sends, so a null-bearing fixture needs no cast.
 */
function buildNormalsFixture(
  entries: Record<string, { high: (number | null)[]; low: (number | null)[]; precip: (number | null)[] }>
): OpenMeteoHistoricalResponse {
  const time: string[] = [];
  const temperature_2m_max: (number | null)[] = [];
  const temperature_2m_min: (number | null)[] = [];
  const precipitation_sum: (number | null)[] = [];

  for (const [monthDay, samples] of Object.entries(entries)) {
    const count = Math.max(samples.high.length, samples.low.length, samples.precip.length);
    for (let i = 0; i < count; i++) {
      // Fabricated distinct year per sample index, offset per monthDay so
      // different entries never collide on the same date.
      const year = 1991 + i;
      time.push(`${year}-${monthDay}`);
      temperature_2m_max.push(samples.high[i] ?? null);
      temperature_2m_min.push(samples.low[i] ?? null);
      precipitation_sum.push(samples.precip[i] ?? null);
    }
  }

  return {
    latitude: 35.0,
    longitude: 139.0,
    elevation: 10,
    timezone: 'UTC',
    timezone_abbreviation: 'UTC',
    generationtime_ms: 0.5,
    utc_offset_seconds: 0,
    daily: {
      time,
      temperature_2m_max,
      temperature_2m_min,
      precipitation_sum
    }
  };
}

/** Repeat a value `n` times into an array — shorthand for uniform fixtures. */
function repeat<T>(value: T, n: number): T[] {
  return new Array(n).fill(value);
}

describe('Climate Normals Utilities', () => {
  describe('calculateDeparture', () => {
    it('should calculate positive departure', () => {
      const departure = calculateDeparture(75, 65);

      expect(departure).toBe('+10');
    });

    it('should calculate negative departure', () => {
      const departure = calculateDeparture(55, 65);

      expect(departure).toBe('-10');
    });

    it('should handle zero departure', () => {
      const departure = calculateDeparture(65, 65);

      expect(departure).toBe('+0');
    });

    it('should round to nearest integer', () => {
      const departure1 = calculateDeparture(65.4, 60);
      const departure2 = calculateDeparture(65.6, 60);

      expect(departure1).toBe('+5');
      expect(departure2).toBe('+6');
    });
  });

  describe('formatNormals', () => {
    it('should format normals without current temps', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.12,
        source: 'Open-Meteo' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals);

      expect(output).toContain('## 📊 Climate Context');
      expect(output).toContain('**Normal High:** 65°F');
      expect(output).toContain('**Normal Low:** 45°F');
      expect(output).toContain('**Normal Precipitation:** 0.12 in');
      expect(output).toContain('*Climate normals based on 1991-2020 data*');
      expect(output).toContain('*Source: Open-Meteo*');
      expect(output).not.toContain('Departure');
    });

    it('should format normals with current high temperature', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.12,
        source: 'Open-Meteo' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals, { high: 75 });

      expect(output).toContain('**High Departure:** +10°F (warmer than normal)');
      expect(output).not.toContain('**Low Departure:**');
    });

    it('should format normals with current low temperature', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.12,
        source: 'Open-Meteo' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals, { low: 40 });

      expect(output).toContain('**Low Departure:** -5°F (cooler than normal)');
      expect(output).not.toContain('**High Departure:**');
    });

    it('should format normals with both high and low', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.12,
        source: 'Open-Meteo' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals, { high: 70, low: 50 });

      expect(output).toContain('**High Departure:** +5°F (warmer than normal)');
      expect(output).toContain('**Low Departure:** +5°F (warmer than normal)');
    });

    it('should format NCEI source correctly', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.12,
        source: 'NCEI' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals);

      expect(output).toContain('*Source: NCEI*');
    });
  });

  describe('getDateComponents', () => {
    it('should extract date components from Date object', () => {
      const date = new Date('2025-06-15T12:00:00Z');
      const { month, day } = getDateComponents(date);

      expect(month).toBe(6);
      expect(day).toBe(15);
    });

    it('should extract date components from ISO string', () => {
      // Note: Uses local timezone, not UTC
      const testDate = '2025-06-15T12:00:00';  // Use local time, not UTC
      const { month, day } = getDateComponents(testDate);

      expect(month).toBe(6);
      expect(day).toBe(15);
    });

    it('should handle December 31st', () => {
      const { month, day } = getDateComponents('2025-12-31T23:59:59Z');

      expect(month).toBe(12);
      expect(day).toBe(31);
    });

    it('should handle leap day', () => {
      const { month, day } = getDateComponents('2024-02-29T12:00:00Z');

      expect(month).toBe(2);
      expect(day).toBe(29);
    });
  });

  describe('computeNormalsTable', () => {
    it('computes a slot mean from hand-computed fixtures (exact float)', () => {
      const fixture = buildNormalsFixture({
        '07-04': {
          high: repeat(20, 15), // mean 20°C -> exactly 68°F
          low: repeat(5, 15), // mean 5°C -> exactly 41°F
          precip: repeat(25.4, 15) // mean 25.4mm -> exactly 1 inch
        }
      });

      const table = computeNormalsTable(fixture);
      const slot = table['07-04'];

      expect(slot).not.toBeNull();
      expect(slot!.tempHigh).toBe(68);
      expect(slot!.tempLow).toBe(41);
      // 25.4mm / 25.4 = 1 inch mathematically; asserted to full float
      // precision (not rounded) since binary division leaves a residual.
      expect(slot!.precipitation).toBeCloseTo(1, 10);
      expect(slot!.sampleCount).toBe(15);
    });

    it('skips null samples rather than treating them as zero (D2 fix)', () => {
      const fixture = buildNormalsFixture({
        '03-10': {
          // 15 real 40°C samples + 1 null. Null-as-zero would average to
          // (15*40 + 0) / 16 = 37.5°C = 99.5°F; skipping the null correctly
          // averages to 40°C = 104°F.
          high: [...repeat(40, 15), null],
          low: repeat(10, 16),
          precip: repeat(12.7, 16)
        }
      });

      const table = computeNormalsTable(fixture);
      const slot = table['03-10'];

      expect(slot).not.toBeNull();
      expect(slot!.tempHigh).toBe(104);
      expect(slot!.tempHigh).not.toBe(99.5); // would be the null-as-zero bug
      expect(slot!.sampleCount).toBe(15); // the null sample doesn't count
    });

    it('marks a 14-sample slot unavailable', () => {
      const fixture = buildNormalsFixture({
        '04-01': {
          high: repeat(20, 14),
          low: repeat(5, 14),
          precip: repeat(10, 14)
        }
      });

      const table = computeNormalsTable(fixture);

      expect(table['04-01']).toBeNull();
    });

    it('marks an exactly-15-sample slot available', () => {
      const fixture = buildNormalsFixture({
        '04-02': {
          high: repeat(20, 15),
          low: repeat(5, 15),
          precip: repeat(10, 15)
        }
      });

      const table = computeNormalsTable(fixture);

      expect(table['04-02']).not.toBeNull();
      expect(table['04-02']!.sampleCount).toBe(15);
    });

    it('applies the Feb 29 carve-out: available at 6 samples', () => {
      const fixture = buildNormalsFixture({
        '02-29': {
          high: repeat(0, 6),
          low: repeat(-5, 6),
          precip: repeat(2.54, 6)
        }
      });

      const table = computeNormalsTable(fixture);

      expect(table['02-29']).not.toBeNull();
      expect(table['02-29']!.sampleCount).toBe(6);
    });

    it('applies the Feb 29 carve-out: available at 8 samples (all leap days 1992-2020)', () => {
      const fixture = buildNormalsFixture({
        '02-29': {
          high: repeat(0, 8),
          low: repeat(-5, 8),
          precip: repeat(2.54, 8)
        }
      });

      const table = computeNormalsTable(fixture);

      expect(table['02-29']).not.toBeNull();
      expect(table['02-29']!.sampleCount).toBe(8);
    });

    it('marks Feb 29 unavailable below 6 samples', () => {
      const fixture = buildNormalsFixture({
        '02-29': {
          high: repeat(0, 5),
          low: repeat(-5, 5),
          precip: repeat(2.54, 5)
        }
      });

      const table = computeNormalsTable(fixture);

      expect(table['02-29']).toBeNull();
    });

    it('would mark a non-leap-day slot unavailable at the Feb-29 sample count (15 still required)', () => {
      const fixture = buildNormalsFixture({
        '06-15': {
          high: repeat(20, 6),
          low: repeat(5, 6),
          precip: repeat(10, 6)
        }
      });

      const table = computeNormalsTable(fixture);

      expect(table['06-15']).toBeNull();
    });

    it('stores unrounded floats, not compute-time-rounded values (D5)', () => {
      const fixture = buildNormalsFixture({
        '09-09': {
          // 14 * 20 + 1 * 21 = 301; 301 / 15 = 20.0666...°C, a fractional mean.
          high: [...repeat(20, 14), 21],
          low: repeat(5, 15),
          precip: repeat(10, 15)
        }
      });

      const table = computeNormalsTable(fixture);
      const slot = table['09-09'];

      expect(slot).not.toBeNull();
      expect(slot!.tempHigh).toBeCloseTo(68.12, 4);
      expect(slot!.tempHigh).not.toBe(Math.round(slot!.tempHigh)); // proves it's unrounded
    });

    it('marks a slot unavailable when one variable is entirely null (open-ocean precedent)', () => {
      const fixture = buildNormalsFixture({
        '05-05': {
          high: repeat(null, 15),
          low: repeat(5, 15),
          precip: repeat(10, 15)
        }
      });

      const table = computeNormalsTable(fixture);

      expect(table['05-05']).toBeNull();
    });

    it('returns an all-unavailable, fully-keyed table for a response with no daily data', () => {
      const response: OpenMeteoHistoricalResponse = {
        latitude: 0,
        longitude: 0,
        elevation: 0,
        timezone: 'UTC',
        timezone_abbreviation: 'UTC',
        generationtime_ms: 0.5,
        utc_offset_seconds: 0
      };

      const table: NormalsTable = computeNormalsTable(response);

      expect(Object.keys(table)).toHaveLength(366);
      expect(table['01-01']).toBeNull();
      expect(table['02-29']).toBeNull();
      expect(table['12-31']).toBeNull();
      // A key that was never populated (not a real MM-DD) is genuinely
      // absent, distinguishing "unavailable" (null) from "missing" (undefined).
      expect(table['13-40']).toBeUndefined();
    });

    it('always populates all 366 MM-DD keys, including Feb 29', () => {
      const fixture = buildNormalsFixture({
        '01-01': { high: repeat(20, 15), low: repeat(5, 15), precip: repeat(10, 15) }
      });

      const table = computeNormalsTable(fixture);

      expect(Object.keys(table)).toHaveLength(366);
      expect(table['02-29']).toBeNull(); // present, but unavailable (no samples)
    });
  });

  describe('getNormalsTableCacheKey', () => {
    it('generates the per-location table cache key format', () => {
      const key = getNormalsTableCacheKey(40.7128, -74.0060);

      expect(key).toBe('normals-table:40.71:-74.01');
    });

    it('rounds coordinates to 2 decimals', () => {
      const key = getNormalsTableCacheKey(40.71283847, -74.00601234);

      expect(key).toBe('normals-table:40.71:-74.01');
    });

    it('is stable across repeated calls with the same coordinates', () => {
      const key1 = getNormalsTableCacheKey(35.6762, 139.6503);
      const key2 = getNormalsTableCacheKey(35.6762, 139.6503);

      expect(key1).toBe(key2);
    });

    it('has no month/day component — one key per location, not per date', () => {
      const key = getNormalsTableCacheKey(35.6762, 139.6503);

      expect(key).toBe('normals-table:35.68:139.65');
      expect(key.split(':')).toHaveLength(3); // "normals-table", lat, lon only
    });
  });

  describe('formatNormals precipitation rounding (D5/A4 render-time rounding)', () => {
    it('rounds a raw unrounded inch value to 2 decimals at render time', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.123456, // raw float, as the table would now store it
        source: 'Open-Meteo' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals);

      expect(output).toContain('**Normal Precipitation:** 0.12 in');
    });

    it('leaves the mm branch rounding behavior unchanged', () => {
      const normals = {
        tempHigh: 65,
        tempLow: 45,
        precipitation: 0.5, // inches, raw
        source: 'Open-Meteo' as const,
        month: 6,
        day: 15
      };

      const output = formatNormals(normals, undefined, METRIC_PREFERENCES);

      expect(output).toContain('**Normal Precipitation:** 12.7 mm');
    });
  });

  describe('getClimateNormals (D4: NCEI gate on the shared isInUS predicate)', () => {
    function buildOpenMeteoFake() {
      return {
        getClimateNormals: vi.fn().mockResolvedValue({
          tempHigh: 65,
          tempLow: 45,
          precipitation: 0.1,
          source: 'Open-Meteo' as const,
          month: 7,
          day: 15
        })
      };
    }

    function buildAvailableNceiFake() {
      return {
        isAvailable: vi.fn().mockReturnValue(true),
        getClimateNormals: vi.fn().mockResolvedValue({
          tempHigh: 68,
          tempLow: 50,
          precipitation: 0.05,
          source: 'NCEI' as const,
          month: 7,
          day: 15
        })
      };
    }

    it('attempts NCEI for an Alaska point when NCEI is available (finding-4 delta)', async () => {
      // Anchorage, AK — outside the old contiguous-US-only box (isLocationInUS
      // required lat <= 50), but inside the shared isInUS Alaska band.
      const openMeteo = buildOpenMeteoFake();
      const ncei = buildAvailableNceiFake();

      const result = await getClimateNormals(
        openMeteo as unknown as Parameters<typeof getClimateNormals>[0],
        ncei as unknown as Parameters<typeof getClimateNormals>[1],
        61.2181,
        -149.9003,
        7,
        15
      );

      expect(ncei.getClimateNormals).toHaveBeenCalledWith(61.2181, -149.9003, 7, 15);
      expect(result.source).toBe('NCEI');
      expect(openMeteo.getClimateNormals).not.toHaveBeenCalled();
    });

    it('attempts NCEI for a Hawaii point when NCEI is available (finding-4 delta)', async () => {
      // Honolulu, HI — also outside the old contiguous-US-only box.
      const openMeteo = buildOpenMeteoFake();
      const ncei = buildAvailableNceiFake();

      const result = await getClimateNormals(
        openMeteo as unknown as Parameters<typeof getClimateNormals>[0],
        ncei as unknown as Parameters<typeof getClimateNormals>[1],
        21.3069,
        -157.8583,
        7,
        15
      );

      expect(ncei.getClimateNormals).toHaveBeenCalledWith(21.3069, -157.8583, 7, 15);
      expect(result.source).toBe('NCEI');
      expect(openMeteo.getClimateNormals).not.toHaveBeenCalled();
    });

    it('never attempts NCEI for a non-US point, even when NCEI is available', async () => {
      // Tokyo, Japan.
      const openMeteo = buildOpenMeteoFake();
      const ncei = buildAvailableNceiFake();

      const result = await getClimateNormals(
        openMeteo as unknown as Parameters<typeof getClimateNormals>[0],
        ncei as unknown as Parameters<typeof getClimateNormals>[1],
        35.6762,
        139.6503,
        7,
        15
      );

      expect(ncei.getClimateNormals).not.toHaveBeenCalled();
      expect(openMeteo.getClimateNormals).toHaveBeenCalledWith(35.6762, 139.6503, 7, 15);
      expect(result.source).toBe('Open-Meteo');
    });
  });

  /**
   * D6: one shared renderer behind all five handler blocks (two in
   * forecastHandler, three in currentConditionsHandler). Before this, the
   * success path rendered `## 📊 Climate Context` while every failure path
   * rendered `## Climate Normals` — the same section under two names.
   */
  describe('renderNormalsSection (D6: shared renderer + aligned heading)', () => {
    function buildResolvingOpenMeteoFake() {
      return {
        getClimateNormals: vi.fn().mockResolvedValue({
          tempHigh: 80,
          tempLow: 60,
          precipitation: 0.12,
          source: 'Open-Meteo' as const,
          month: 7,
          day: 15
        })
      };
    }

    function buildRejectingOpenMeteoFake() {
      return {
        getClimateNormals: vi.fn().mockRejectedValue(new Error('no normals here'))
      };
    }

    type RenderArgs = Parameters<typeof renderNormalsSection>;

    it('renders the climate section with departures on success', async () => {
      const openMeteo = buildResolvingOpenMeteoFake();

      const output = await renderNormalsSection(
        openMeteo as unknown as RenderArgs[0],
        undefined,
        35.6762,
        139.6503,
        7,
        15,
        { high: 90, low: 65 }
      );

      expect(output).toContain('## 📊 Climate Context');
      expect(output).toContain('**Normal High:** 80°F');
      expect(output).toContain('**Normal Low:** 60°F');
      expect(output).toContain('**High Departure:** +10°F (warmer than normal)');
      expect(output).toContain('**Low Departure:** +5°F (warmer than normal)');
      expect(output).not.toContain('not available');
    });

    it('renders the aligned heading and the unchanged note on failure', async () => {
      const openMeteo = buildRejectingOpenMeteoFake();

      const output = await renderNormalsSection(
        openMeteo as unknown as RenderArgs[0],
        undefined,
        0,
        -160,
        7,
        15,
        {}
      );

      expect(output).toContain('## 📊 Climate Context');
      expect(output).toContain('⚠️ Climate normals data not available for this location.');
      // The old failure-only heading is gone.
      expect(output).not.toContain('## Climate Normals');
    });

    it('never throws when the normals fetch fails — normals are garnish', async () => {
      const openMeteo = buildRejectingOpenMeteoFake();

      await expect(
        renderNormalsSection(
          openMeteo as unknown as RenderArgs[0],
          undefined,
          0,
          -160,
          2,
          29,
          {}
        )
      ).resolves.toBeTypeOf('string');
    });

    it('uses the same heading on the success and failure paths', async () => {
      const heading = (text: string): string | undefined =>
        text.split('\n').find(line => line.startsWith('## '));

      const success = await renderNormalsSection(
        buildResolvingOpenMeteoFake() as unknown as RenderArgs[0],
        undefined,
        35.6762,
        139.6503,
        7,
        15,
        {}
      );
      const failure = await renderNormalsSection(
        buildRejectingOpenMeteoFake() as unknown as RenderArgs[0],
        undefined,
        0,
        -160,
        7,
        15,
        {}
      );

      expect(heading(success)).toBeDefined();
      expect(heading(failure)).toBe(heading(success));
    });
  });
});
