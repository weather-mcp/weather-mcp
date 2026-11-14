/**
 * formatWallClockDate / formatWallClockDateTime: Open-Meteo wall-clock strings
 * print the same in every process zone, equal to the old expression's output
 * on a UTC server. Expectations come from the old expression run under TZ=UTC
 * (G75), never from pasted terminal output.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { formatWallClockDate, formatWallClockDateTime } from '../../src/utils/timezone.js';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
});
function inZone<T>(zone: string, fn: () => T): T {
  process.env.TZ = zone;
  return fn();
}

const ZONES = ['UTC', 'America/New_York', 'Pacific/Auckland'];
const DATES = ['2024-03-05', '2024-03-10', '2024-12-31', '2025-01-01'];
const DATE_TIMES = [
  '2024-03-10T01:00',
  '2024-03-10T02:00', // spring-forward hour in America/New_York
  '2024-03-10T03:00',
  '2024-12-31T23:00',
  '2025-01-01T00:00',
];

function sentinel(zone: string): void {
  if (zone === 'America/New_York') expect(new Date('2024-03-05').getDate()).toBe(4);
}

describe('formatWallClockDate', () => {
  for (const zone of ZONES) {
    it(`equals the TZ=UTC old-expression output in ${zone}`, () => {
      const reference = inZone('UTC', () => DATES.map(d => new Date(d).toLocaleDateString()));
      const actual = inZone(zone, () => {
        sentinel(zone);
        return DATES.map(d => formatWallClockDate(d));
      });
      expect(actual).toEqual(reference);
    });
  }

  it('reads a year boundary as the named day', () => {
    const a = inZone('America/New_York', () => formatWallClockDate('2025-01-01'));
    const b = inZone('America/New_York', () => formatWallClockDate('2024-12-31'));
    expect(a).not.toBe(b);
  });
});

describe('formatWallClockDateTime', () => {
  for (const zone of ZONES) {
    it(`equals the TZ=UTC old-expression output in ${zone}`, () => {
      const reference = inZone('UTC', () => DATE_TIMES.map(h => new Date(h).toLocaleString()));
      const actual = inZone(zone, () => {
        sentinel(zone);
        return DATE_TIMES.map(h => formatWallClockDateTime(h));
      });
      expect(actual).toEqual(reference);
    });
  }

  it('keeps the spring-forward hour distinct from its neighbours in America/New_York', () => {
    const out = inZone('America/New_York', () => {
      sentinel('America/New_York');
      return DATE_TIMES.slice(0, 3).map(h => formatWallClockDateTime(h));
    });
    expect(new Set(out).size).toBe(3);
  });

  it('prints the literal wall-clock hour (en locales)', () => {
    if (!Intl.DateTimeFormat().resolvedOptions().locale.startsWith('en-US')) return;
    const out = inZone('Pacific/Auckland', () => formatWallClockDateTime('2024-03-10T02:00'));
    expect(out.replace(/[  ]/g, ' ')).toBe('3/10/2024, 2:00:00 AM');
  });
});
