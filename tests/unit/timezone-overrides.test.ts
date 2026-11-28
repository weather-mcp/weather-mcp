/**
 * Date-line timezone overrides (plan-dateline-timezone-overrides, roadmap row 95).
 *
 * Every expectation here is a literal zone string or a literal bound copied from the
 * design plan's measured table — never computed through the code under test (G160).
 */

import { describe, it, expect } from 'vitest';
import tzLookup from 'tz-lookup';
import { TIMEZONE_OVERRIDE_BOXES, timezoneOverrideFor } from '../../src/utils/timezoneOverrides.js';
import { guessTimezoneFromCoords, isValidTimezone } from '../../src/utils/timezone.js';

/** The design plan's table, digit for digit (codex-R1: an independent literal pin). */
const EXPECTED_BOXES = [
  { minLat: -14.8, maxLat: -14.0, minLon: -171.1, maxLon: -167.9, zone: 'Pacific/Pago_Pago' },
  { minLat: -9.7, maxLat: -8.4, minLon: -172.7, maxLon: -170.9, zone: 'Pacific/Fakaofo' },
  { minLat: 62.8, maxLat: 64.0, minLon: -172.25, maxLon: -168.4, zone: 'America/Nome' },
  { minLat: 65.6, maxLat: 66.0, minLon: -168.975, maxLon: -168.7, zone: 'America/Nome' },
  { minLat: 65.36, maxLat: 65.64, minLon: -170.65, maxLon: -168.98, zone: 'Asia/Anadyr' },
  { minLat: 52.5, maxLat: 53.5, minLon: -169.34, maxLon: -168.7, zone: 'America/Nome' },
] as const;

describe('timezone overrides', () => {
  describe('the table matches the measured design table', () => {
    it('has exactly the six measured boxes, bound for bound', () => {
      expect(
        TIMEZONE_OVERRIDE_BOXES.map(({ minLat, maxLat, minLon, maxLon, zone }) => ({ minLat, maxLat, minLon, maxLon, zone }))
      ).toEqual(EXPECTED_BOXES);
    });

    it.each(EXPECTED_BOXES.map((b, i) => [i, b] as const))('box %i: all four corners are inside (inclusive bounds)', (_i, b) => {
      for (const lat of [b.minLat, b.maxLat]) {
        for (const lon of [b.minLon, b.maxLon]) {
          expect(timezoneOverrideFor(lat, lon)).toBe(b.zone);
        }
      }
    });

    it('every box is well-formed, named and carries a valid IANA zone', () => {
      for (const b of TIMEZONE_OVERRIDE_BOXES) {
        expect(b.minLat).toBeLessThan(b.maxLat);
        expect(b.minLon).toBeLessThan(b.maxLon);
        expect(Math.abs(b.minLat)).toBeLessThanOrEqual(90);
        expect(Math.abs(b.maxLat)).toBeLessThanOrEqual(90);
        expect(Math.abs(b.minLon)).toBeLessThanOrEqual(180);
        expect(Math.abs(b.maxLon)).toBeLessThanOrEqual(180);
        expect(isValidTimezone(b.zone)).toBe(true);
        expect(b.place.length).toBeGreaterThan(0);
      }
    });

    it('no two boxes intersect, so lookup order never matters', () => {
      const boxes = TIMEZONE_OVERRIDE_BOXES;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const latOverlap = a.minLat <= b.maxLat && b.minLat <= a.maxLat;
          const lonOverlap = a.minLon <= b.maxLon && b.minLon <= a.maxLon;
          expect(latOverlap && lonOverlap, `${a.place} / ${b.place}`).toBe(false);
        }
      }
    });

    it('the table and each box are frozen', () => {
      expect(Object.isFrozen(TIMEZONE_OVERRIDE_BOXES)).toBe(true);
      for (const b of TIMEZONE_OVERRIDE_BOXES) expect(Object.isFrozen(b)).toBe(true);
    });
  });

  describe('fixed points resolve to the real local zone', () => {
    it.each([
      ['Pago Pago', -14.2756, -170.702, 'Pacific/Pago_Pago'],
      ['Tafuna', -14.33, -170.72, 'Pacific/Pago_Pago'],
      ['Aunu‘u', -14.285, -170.555, 'Pacific/Pago_Pago'],
      ['Ofu', -14.17, -169.67, 'Pacific/Pago_Pago'],
      ['Ta‘u', -14.23, -169.45, 'Pacific/Pago_Pago'],
      ['Rose Atoll', -14.55, -168.15, 'Pacific/Pago_Pago'],
      ['Fakaofo', -9.38, -171.25, 'Pacific/Fakaofo'],
      ['Gambell', 63.78, -171.74, 'America/Nome'],
      ['Little Diomede', 65.76, -168.93, 'America/Nome'],
      ['Nikolski', 52.94, -168.86, 'America/Nome'],
      ['Samalga Island', 52.78, -169.25, 'America/Nome'],
    ] as const)('%s → %s', (_place, lat, lon, zone) => {
      expect(guessTimezoneFromCoords(lat, lon)).toBe(zone);
    });
  });

  describe('the defect is still in the dataset (evidence each box is still needed)', () => {
    // Red here means tz-lookup was fixed upstream: re-measure the box per the GOTCHAS
    // entry and retire it, rather than editing this row.
    it.each([
      ['Pago Pago', -14.2756, -170.702, 'Pacific/Apia'],
      ['Fakaofo', -9.38, -171.25, 'Pacific/Pago_Pago'],
      ['Gambell', 63.78, -171.74, 'Asia/Anadyr'],
      ['Rose Atoll', -14.55, -168.15, 'Pacific/Rarotonga'],
      ['Nikolski', 52.94, -168.86, 'America/Adak'],
    ] as const)('tz-lookup alone puts %s in %s', (_place, lat, lon, zone) => {
      expect(tzLookup(lat, lon)).toBe(zone);
    });
  });

  describe('neighbours outside every box are unchanged', () => {
    it.each([
      ['Apia', -13.83, -171.76, 'Pacific/Apia'],
      ['Upolu east tip', -14.03, -171.41, 'Pacific/Apia'],
      ['Big Diomede', 65.78, -169.07, 'Asia/Anadyr'],
      ['Swains Island', -11.06, -171.08, 'Pacific/Pago_Pago'],
      ['Atka', 52.2, -174.2, 'America/Adak'],
      ['west of Samalga Pass', 53.0, -169.6, 'America/Adak'],
      // A real geo-tz Adak point between −169.5 and −169.34: it is what turns the
      // rejected −169.5 west edge red.
      ['Hawaii–Aleutian side of Samalga Pass', 53.2, -169.49, 'America/Adak'],
      ['Unalaska', 53.88, -166.54, 'America/Nome'],
    ] as const)('%s keeps %s', (_place, lat, lon, zone) => {
      expect(timezoneOverrideFor(lat, lon)).toBeUndefined();
      expect(guessTimezoneFromCoords(lat, lon)).toBe(zone);
    });
  });

  describe('points inside a box that tz-lookup already had right stay right', () => {
    it.each([
      ['Savoonga', 63.69, -170.48, 'America/Nome'],
      ['Nukunonu', -9.2, -171.85, 'Pacific/Fakaofo'],
      ['Atafu', -8.54, -172.52, 'Pacific/Fakaofo'],
      ['Umnak east end, inside the box', 53.4, -168.72, 'America/Nome'],
    ] as const)('%s: tz-lookup and the override agree on %s', (_place, lat, lon, zone) => {
      expect(tzLookup(lat, lon)).toBe(zone);
      expect(timezoneOverrideFor(lat, lon)).toBe(zone);
      expect(guessTimezoneFromCoords(lat, lon)).toBe(zone);
    });
  });

  describe('edges', () => {
    it('Little Diomede west edge sits on the US side of the −168.978 line', () => {
      expect(timezoneOverrideFor(65.76, -168.975)).toBe('America/Nome');
      expect(timezoneOverrideFor(65.76, -168.98)).toBeUndefined();
    });

    it('American Samoa west edge stops short of Upolu', () => {
      expect(timezoneOverrideFor(-14.05, -171.09)).toBe('Pacific/Pago_Pago');
      expect(timezoneOverrideFor(-14.05, -171.11)).toBeUndefined();
    });

    it('Umnak west edge is −169.34, east of every geo-tz Adak point', () => {
      expect(timezoneOverrideFor(53.0, -169.34)).toBe('America/Nome');
      // −169.35 is in the Samalga Pass wedge: geo-tz says Nome there, and the wedge is
      // deliberately left out of the box. This row pins the edge, not a correct zone.
      expect(timezoneOverrideFor(53.0, -169.35)).toBeUndefined();
    });

    it('Umnak east edge is −168.7', () => {
      expect(timezoneOverrideFor(53.0, -168.7)).toBe('America/Nome');
      expect(timezoneOverrideFor(53.0, -168.69)).toBeUndefined();
    });
  });

  describe('purity', () => {
    it('a non-finite coordinate matches no box', () => {
      expect(timezoneOverrideFor(NaN, NaN)).toBeUndefined();
      expect(timezoneOverrideFor(-14.2756, NaN)).toBeUndefined();
    });

    it('a point far from every box matches none, and repeat calls agree', () => {
      expect(timezoneOverrideFor(0, 0)).toBeUndefined();
      expect(timezoneOverrideFor(-14.2756, -170.702)).toBe(timezoneOverrideFor(-14.2756, -170.702));
    });
  });
});
