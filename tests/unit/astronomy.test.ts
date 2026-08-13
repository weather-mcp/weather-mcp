/**
 * Tests for the pure astronomy utility (moon phase, rise/set, twilight).
 *
 * Golden values are cross-checked against USNO-published data for
 * 2026-08-12 (the total-solar-eclipse new moon) and the surrounding lunar
 * quarters. Everything here is pure computation — no mocks, no I/O.
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  computeDayAstronomy,
  nextMoonQuarters,
  formatAstronomyBlock,
  formatNextQuarters,
  moonPhaseName,
} from '../../src/utils/astronomy.js';
import { IMPERIAL_PREFERENCES, METRIC_PREFERENCES } from '../../src/config/units.js';
import type { UnitPreferences } from '../../src/config/units.js';

const SEATTLE = { lat: 47.6062, lon: -122.3321, zone: 'America/Los_Angeles' };
const TROMSO = { lat: 69.6492, lon: 18.9553, zone: 'Europe/Oslo' };
// Alert, Nunavut (82.5°N): in late December the sun stays between roughly
// −31° and −16° — permanently below the civil and nautical thresholds.
const ALERT = { lat: 82.5018, lon: -62.3481, zone: 'America/Toronto' };

/** Absolute difference in minutes between a DateTime and an HH:mm local time. */
function minutesFrom(dt: DateTime, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return Math.abs(dt.hour * 60 + dt.minute - ((h ?? 0) * 60 + (m ?? 0)));
}

describe('moonPhaseName', () => {
  it('names the principal phases at their exact angles', () => {
    expect(moonPhaseName(0)).toBe('New Moon');
    expect(moonPhaseName(90)).toBe('First Quarter');
    expect(moonPhaseName(180)).toBe('Full Moon');
    expect(moonPhaseName(270)).toBe('Third Quarter');
  });

  it('names the intermediate phases mid-bucket', () => {
    expect(moonPhaseName(45)).toBe('Waxing Crescent');
    expect(moonPhaseName(135)).toBe('Waxing Gibbous');
    expect(moonPhaseName(225)).toBe('Waning Gibbous');
    expect(moonPhaseName(315)).toBe('Waning Crescent');
  });

  it('switches buckets exactly at the 22.5° + k·45° boundaries', () => {
    // Buckets are centered on the principal phases, so a day just before the
    // new-moon instant (angle ~350°) still reads "New Moon" — matching USNO's
    // calendar-date phase labels.
    expect(moonPhaseName(22.4)).toBe('New Moon');
    expect(moonPhaseName(22.5)).toBe('Waxing Crescent');
    expect(moonPhaseName(67.4)).toBe('Waxing Crescent');
    expect(moonPhaseName(67.5)).toBe('First Quarter');
    expect(moonPhaseName(202.4)).toBe('Full Moon');
    expect(moonPhaseName(202.5)).toBe('Waning Gibbous');
    expect(moonPhaseName(337.4)).toBe('Waning Crescent');
    expect(moonPhaseName(337.5)).toBe('New Moon');
    expect(moonPhaseName(359.9)).toBe('New Moon');
  });

  it('normalizes out-of-range angles defensively', () => {
    expect(moonPhaseName(360)).toBe('New Moon');
    expect(moonPhaseName(-10)).toBe('New Moon');
    expect(moonPhaseName(450)).toBe('First Quarter');
  });
});

describe('computeDayAstronomy — golden values (Seattle 2026-08-12)', () => {
  const date = DateTime.fromISO('2026-08-12', { zone: SEATTLE.zone });
  const astro = computeDayAstronomy(SEATTLE.lat, SEATTLE.lon, date);

  it('reports the new moon USNO lists for the date (solar-eclipse day)', () => {
    expect(astro.phaseName).toBe('New Moon');
    expect(astro.illuminationPct).toBeLessThan(2);
  });

  it('computes moonrise within ±3 minutes of USNO (5:48 AM PDT)', () => {
    expect(astro.moonrise).not.toBeNull();
    expect(minutesFrom(astro.moonrise!, '05:48')).toBeLessThanOrEqual(3);
    expect(astro.moonrise!.zoneName).toBe(SEATTLE.zone);
  });

  it('computes civil twilight within ±3 minutes of USNO (5:27 AM / 9:00 PM PDT)', () => {
    expect(astro.civilDawn).not.toBeNull();
    expect(astro.civilDusk).not.toBeNull();
    expect(minutesFrom(astro.civilDawn!, '05:27')).toBeLessThanOrEqual(3);
    expect(minutesFrom(astro.civilDusk!, '21:00')).toBeLessThanOrEqual(3);
  });

  it('orders the twilight sequence astro < nautical < civil dawn, reversed at dusk', () => {
    expect(astro.astroDawn!.toMillis()).toBeLessThan(astro.nauticalDawn!.toMillis());
    expect(astro.nauticalDawn!.toMillis()).toBeLessThan(astro.civilDawn!.toMillis());
    expect(astro.civilDusk!.toMillis()).toBeLessThan(astro.nauticalDusk!.toMillis());
    expect(astro.nauticalDusk!.toMillis()).toBeLessThan(astro.astroDusk!.toMillis());
  });

  it('reports a high positive noon sun altitude in August', () => {
    expect(astro.sunNoonAltitude).toBeGreaterThan(45);
  });
});

describe('computeDayAstronomy — illumination at known quarters', () => {
  it('is ~0% at the new moon and ~100% at the full moon', () => {
    const newMoon = computeDayAstronomy(
      SEATTLE.lat,
      SEATTLE.lon,
      DateTime.fromISO('2026-08-12', { zone: SEATTLE.zone })
    );
    expect(newMoon.illuminationPct).toBeLessThan(2);

    // Full moon instant: 2026-08-28 04:19 UTC — local noon Aug 27 PDT is ~9h before
    const fullMoon = computeDayAstronomy(
      SEATTLE.lat,
      SEATTLE.lon,
      DateTime.fromISO('2026-08-27', { zone: SEATTLE.zone })
    );
    expect(fullMoon.phaseName).toBe('Full Moon');
    expect(fullMoon.illuminationPct).toBeGreaterThan(97);
  });

  it('is ~50% at the first quarter', () => {
    // First quarter instant: 2026-08-20 02:47 UTC
    const firstQuarter = computeDayAstronomy(51.5, 0, DateTime.fromISO('2026-08-19', { zone: 'utc' }));
    expect(firstQuarter.phaseName).toBe('First Quarter');
    expect(firstQuarter.illuminationPct).toBeGreaterThan(40);
    expect(firstQuarter.illuminationPct).toBeLessThan(60);
  });
});

describe('computeDayAstronomy — polar cases', () => {
  it('returns null twilight for Tromsø in June (midnight sun)', () => {
    const astro = computeDayAstronomy(
      TROMSO.lat,
      TROMSO.lon,
      DateTime.fromISO('2026-06-15', { zone: TROMSO.zone })
    );
    expect(astro.civilDawn).toBeNull();
    expect(astro.civilDusk).toBeNull();
    expect(astro.nauticalDawn).toBeNull();
    expect(astro.astroDawn).toBeNull();
    expect(astro.astroDusk).toBeNull();
    expect(astro.sunNoonAltitude).toBeGreaterThan(0);
  });

  it('returns null civil/nautical twilight for Alert in December (polar night)', () => {
    const astro = computeDayAstronomy(
      ALERT.lat,
      ALERT.lon,
      DateTime.fromISO('2026-12-21', { zone: ALERT.zone })
    );
    expect(astro.civilDawn).toBeNull();
    expect(astro.civilDusk).toBeNull();
    expect(astro.nauticalDawn).toBeNull();
    expect(astro.nauticalDusk).toBeNull();
    expect(astro.sunNoonAltitude).toBeLessThan(-6);
  });
});

describe('nextMoonQuarters', () => {
  it('finds the USNO-published next full and new moons from 2026-08-12', () => {
    const from = DateTime.fromISO('2026-08-12T20:00:00', { zone: SEATTLE.zone });
    const { nextFull, nextNew } = nextMoonQuarters(from);
    // Full: 2026-08-28 04:19 UTC; New: 2026-09-11 03:27 UTC
    expect(nextFull.toUTC().toISODate()).toBe('2026-08-28');
    expect(nextNew.toUTC().toISODate()).toBe('2026-09-11');
    // Returned in the caller's zone
    expect(nextFull.zoneName).toBe(SEATTLE.zone);
  });

  it('crosses a month boundary cleanly', () => {
    const from = DateTime.fromISO('2026-09-28T00:00:00', { zone: 'utc' });
    const { nextFull, nextNew } = nextMoonQuarters(from);
    expect(nextNew.toISODate()).toBe('2026-10-10');
    expect(nextFull.toISODate()).toBe('2026-10-26');
    // The new moon comes before the full moon here — order is not assumed
    expect(nextNew.toMillis()).toBeLessThan(nextFull.toMillis());
  });
});

describe('formatAstronomyBlock', () => {
  const date = DateTime.fromISO('2026-08-12', { zone: SEATTLE.zone });
  const astro = computeDayAstronomy(SEATTLE.lat, SEATTLE.lon, date);

  it('renders the Moon and Twilight lines in 12h format', () => {
    const block = formatAstronomyBlock(astro, IMPERIAL_PREFERENCES);
    expect(block).toContain('**Moon:** New Moon (0% illuminated)');
    expect(block).toContain('· Rise 5:49 AM');
    expect(block).toContain('**Twilight:** Civil 5:27 AM / 9:00 PM');
    expect(block).toContain('Nautical');
    expect(block).toContain('Astronomical');
    expect(block.endsWith('\n')).toBe(true);
  });

  it('renders 24h clock times under metric preferences', () => {
    const block = formatAstronomyBlock(astro, METRIC_PREFERENCES);
    expect(block).toContain('Rise 05:49');
    expect(block).toContain('Civil 05:27 / 21:00');
    expect(block).not.toContain('AM');
    expect(block).not.toContain('PM');
  });

  it('honors an explicit 24h override on imperial prefs', () => {
    const prefs: UnitPreferences = { ...IMPERIAL_PREFERENCES, timeFormat: '24h' };
    const block = formatAstronomyBlock(astro, prefs);
    expect(block).toContain('21:00');
    expect(block).not.toContain('9:00 PM');
  });

  it('renders "none (polar day)" for missing twilight under the midnight sun', () => {
    const tromso = computeDayAstronomy(
      TROMSO.lat,
      TROMSO.lon,
      DateTime.fromISO('2026-06-15', { zone: TROMSO.zone })
    );
    const block = formatAstronomyBlock(tromso, IMPERIAL_PREFERENCES);
    expect(block).toContain('Civil none (polar day)');
    expect(block).toContain('Nautical none (polar day)');
    expect(block).toContain('Astronomical none (polar day)');
  });

  it('renders "none (polar night)" when the sun never reaches the threshold', () => {
    const alert = computeDayAstronomy(
      ALERT.lat,
      ALERT.lon,
      DateTime.fromISO('2026-12-21', { zone: ALERT.zone })
    );
    const block = formatAstronomyBlock(alert, IMPERIAL_PREFERENCES);
    expect(block).toContain('Civil none (polar night)');
    expect(block).toContain('Nautical none (polar night)');
  });

  it('renders a plain "none" for a day without moonrise/moonset', () => {
    // Tromsø 2026-06-15: the moon stays below the horizon all day
    const tromso = computeDayAstronomy(
      TROMSO.lat,
      TROMSO.lon,
      DateTime.fromISO('2026-06-15', { zone: TROMSO.zone })
    );
    const block = formatAstronomyBlock(tromso, IMPERIAL_PREFERENCES);
    expect(block).toContain('Rise none');
    expect(block).toContain('Set none');
    // Moon gaps are a normal monthly occurrence — no polar wording
    expect(block).not.toContain('Rise none (polar');
  });

  it('never omits a field', () => {
    const block = formatAstronomyBlock(astro, IMPERIAL_PREFERENCES);
    for (const label of ['**Moon:**', 'Rise', 'Set', '**Twilight:**', 'Civil', 'Nautical', 'Astronomical']) {
      expect(block).toContain(label);
    }
  });
});

describe('formatNextQuarters', () => {
  it('renders both dates in the forecast timezone', () => {
    const quarters = nextMoonQuarters(
      DateTime.fromISO('2026-08-12T20:00:00', { zone: SEATTLE.zone })
    );
    // Full moon 2026-08-28 04:19 UTC = Aug 27 9:19 PM PDT; new moon Sep 11
    // 03:27 UTC = Sep 10 8:27 PM PDT — the zone matters.
    const line = formatNextQuarters(quarters, SEATTLE.zone);
    expect(line).toBe('**Next full moon:** Aug 27 · **Next new moon:** Sep 10\n');
    const utcLine = formatNextQuarters(quarters, 'utc');
    expect(utcLine).toBe('**Next full moon:** Aug 28 · **Next new moon:** Sep 11\n');
  });
});
