/**
 * Unit tests for formatInTimezoneWithZone (pure, no I/O)
 */

import { describe, it, expect } from 'vitest';
import { formatInTimezone, formatInTimezoneWithZone } from '../../src/utils/timezone.js';

const CHICAGO = 'America/Chicago';

// Every valid row: [iso, zone, expected label, format, timeFormat]
const VALID_ROWS: Array<[string, string, string, ('medium' | 'short')?, ('12h' | '24h')?]> = [
  ['2026-01-15T18:00:00Z', CHICAGO, 'CST'],
  ['2026-07-15T17:00:00Z', CHICAGO, 'CDT'],
  ['2026-07-15T12:00', CHICAGO, 'CDT'],
  ['2026-11-01T05:30:00Z', CHICAGO, 'CDT'],
  ['2026-11-01T09:00:00Z', CHICAGO, 'CST'],
  ['2026-01-15T12:00:00Z', 'Pacific/Guam', 'GMT+10'],
  ['2026-01-15T12:00:00Z', 'UTC', 'UTC'],
  ['2026-11-11T00:00:00Z', 'America/Los_Angeles', 'PST'],
  ['2026-07-15T17:00:00Z', CHICAGO, 'CDT', 'short'],
  ['2026-07-15T17:00:00Z', CHICAGO, 'CDT', 'medium', '24h']
];

describe('formatInTimezoneWithZone', () => {
  it('labels standard time and daylight time at the instant', () => {
    expect(formatInTimezoneWithZone('2026-01-15T18:00:00Z', CHICAGO).endsWith(' CST')).toBe(true);
    expect(formatInTimezoneWithZone('2026-07-15T17:00:00Z', CHICAGO).endsWith(' CDT')).toBe(true);
  });

  it('reads a naive wall clock in the target zone and labels that local moment', () => {
    const out = formatInTimezoneWithZone('2026-07-15T12:00', CHICAGO);
    expect(out.endsWith(' CDT')).toBe(true);
    expect(out).toContain('12:00');
  });

  it('labels each end of a DST straddle differently', () => {
    expect(formatInTimezoneWithZone('2026-11-01T05:30:00Z', CHICAGO).endsWith(' CDT')).toBe(true);
    expect(formatInTimezoneWithZone('2026-11-01T09:00:00Z', CHICAGO).endsWith(' CST')).toBe(true);
  });

  it('prints an offset for a zone with no short name, and UTC for UTC', () => {
    expect(formatInTimezoneWithZone('2026-01-15T12:00:00Z', 'Pacific/Guam').endsWith(' GMT+10')).toBe(true);
    expect(formatInTimezoneWithZone('2026-01-15T12:00:00Z', 'UTC').endsWith(' UTC')).toBe(true);
  });

  it('returns the bare clock for an unparseable string, with no trailing space', () => {
    const out = formatInTimezoneWithZone('garbage', CHICAGO);
    expect(out).toBe(formatInTimezone('garbage', CHICAGO));
    expect(out.endsWith(' ')).toBe(false);
  });

  it.each(VALID_ROWS)('is the clock, one space, and the label: %s %s', (iso, zone, label, format, timeFormat) => {
    const clock = formatInTimezone(iso, zone, format, timeFormat);
    expect(formatInTimezoneWithZone(iso, zone, format, timeFormat)).toBe(`${clock} ${label}`);
  });

  it.each(VALID_ROWS)('has no double space and no IANA name: %s %s', (iso, zone, _label, format, timeFormat) => {
    const out = formatInTimezoneWithZone(iso, zone, format, timeFormat);
    expect(out).not.toContain('  ');
    expect(out).not.toContain('America/');
    expect(out).not.toContain('Pacific/');
  });

  it('excludes full and long at compile time', () => {
    // @ts-expect-error 'full' already carries a zone, so the type refuses it
    expect(typeof formatInTimezoneWithZone('2026-07-15T17:00:00Z', CHICAGO, 'full')).toBe('string');
  });
});
