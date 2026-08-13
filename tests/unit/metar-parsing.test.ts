/**
 * Tests for METAR field parsing (src/utils/metarStation.ts).
 *
 * `visib` and `wdir` are the two genuinely polymorphic fields in the API's
 * response — a number at some stations, a string at most. These are the
 * honesty layer: "10+" must never be flattened to a bare 10, and "VRB" must
 * never become a compass point.
 */

import { describe, it, expect } from 'vitest';
import {
  parseVisibilityMiles,
  parseWindDirection
} from '../../src/utils/metarStation.js';
import type { MetarObservation } from '../../src/types/aviationWeather.js';

describe('METAR field parsing', () => {
  describe('parseVisibilityMiles', () => {
    it('should pass a plain number through', () => {
      expect(parseVisibilityMiles(10)).toEqual({ miles: 10 });
      expect(parseVisibilityMiles(0.25)).toEqual({ miles: 0.25 });
      expect(parseVisibilityMiles(0)).toEqual({ miles: 0 });
    });

    it('should parse a numeric string', () => {
      expect(parseVisibilityMiles('10')).toEqual({ miles: 10 });
      expect(parseVisibilityMiles('2.5')).toEqual({ miles: 2.5 });
    });

    it('should preserve the plus qualifier rather than flatten it', () => {
      // "10+" means "at least 10" — a floor, not a measurement of 10.
      expect(parseVisibilityMiles('10+')).toEqual({ miles: 10, qualifier: 'plus' });
      expect(parseVisibilityMiles('6+')).toEqual({ miles: 6, qualifier: 'plus' });
    });

    it('should parse a bare fraction', () => {
      expect(parseVisibilityMiles('1/2')).toEqual({ miles: 0.5 });
      expect(parseVisibilityMiles('1/4')).toEqual({ miles: 0.25 });
      expect(parseVisibilityMiles('3/4')).toEqual({ miles: 0.75 });
    });

    it('should parse a mixed whole-and-fraction value', () => {
      expect(parseVisibilityMiles('1 1/2')).toEqual({ miles: 1.5 });
      expect(parseVisibilityMiles('2 3/4')).toEqual({ miles: 2.75 });
    });

    it('should combine a fraction with the plus qualifier', () => {
      expect(parseVisibilityMiles('1 1/2+')).toEqual({ miles: 1.5, qualifier: 'plus' });
    });

    it('should tolerate surrounding whitespace', () => {
      expect(parseVisibilityMiles('  10+  ')).toEqual({ miles: 10, qualifier: 'plus' });
      expect(parseVisibilityMiles(' 1/2 ')).toEqual({ miles: 0.5 });
    });

    it('should return undefined for an absent field', () => {
      expect(parseVisibilityMiles(undefined)).toBeUndefined();
    });

    it('should return undefined for an unparseable value', () => {
      expect(parseVisibilityMiles('')).toBeUndefined();
      expect(parseVisibilityMiles('   ')).toBeUndefined();
      expect(parseVisibilityMiles('unknown')).toBeUndefined();
      expect(parseVisibilityMiles('M1/4SM')).toBeUndefined();
      expect(parseVisibilityMiles('+')).toBeUndefined();
    });

    it('should return undefined for a zero denominator rather than emit Infinity', () => {
      expect(parseVisibilityMiles('1/0')).toBeUndefined();
      expect(parseVisibilityMiles('1 1/0')).toBeUndefined();
    });

    it('should return undefined for a non-finite number', () => {
      expect(parseVisibilityMiles(Number.NaN)).toBeUndefined();
      expect(parseVisibilityMiles(Number.POSITIVE_INFINITY)).toBeUndefined();
    });
  });

  describe('parseWindDirection', () => {
    it('should pass numeric degrees through', () => {
      expect(parseWindDirection(190)).toBe(190);
      expect(parseWindDirection(0)).toBe(0);
      expect(parseWindDirection(360)).toBe(360);
    });

    it('should map VRB to variable', () => {
      expect(parseWindDirection('VRB')).toBe('variable');
    });

    it('should map VRB case-insensitively and with whitespace', () => {
      expect(parseWindDirection('vrb')).toBe('variable');
      expect(parseWindDirection(' Vrb ')).toBe('variable');
    });

    it('should parse a numeric string', () => {
      expect(parseWindDirection('240')).toBe(240);
    });

    it('should return undefined for an absent field', () => {
      expect(parseWindDirection(undefined)).toBeUndefined();
    });

    it('should return undefined for anything else', () => {
      expect(parseWindDirection('')).toBeUndefined();
      expect(parseWindDirection('CALM')).toBeUndefined();
      expect(parseWindDirection('N')).toBeUndefined();
    });

    it('should return undefined for a non-finite number', () => {
      expect(parseWindDirection(Number.NaN)).toBeUndefined();
    });
  });

  describe('sparse observations', () => {
    /**
     * `wgst` is present in 14% of reports and `wxString` in 8%, so the sparse
     * case is the normal case. Optional fields must simply read as undefined
     * rather than require defensive access at every call site.
     */
    const sparse: MetarObservation = {
      icaoId: 'HKJK',
      name: 'Jomo Kenyatta Intl',
      lat: -1.3192,
      lon: 36.9278,
      elev: 1624,
      obsTime: 1755097980,
      reportTime: '2026-08-13T14:13:00Z',
      receiptTime: '2026-08-13T14:14:20Z',
      rawOb: 'METAR HKJK 131413Z 12008KT 9999 SCT025 22/12 Q1021',
      metarType: 'METAR',
      qcField: '0',
      temp: 22,
      dewp: 12,
      wdir: 120,
      wspd: 8
    };

    it('should read absent optional fields as undefined, not empty values', () => {
      expect(sparse.wgst).toBeUndefined();
      expect(sparse.wxString).toBeUndefined();
      expect(sparse.slp).toBeUndefined();
      expect(sparse.visib).toBeUndefined();
      expect(sparse.clouds).toBeUndefined();
      expect(sparse.fltCat).toBeUndefined();
    });

    it('should yield undefined from the parsers for absent fields', () => {
      expect(parseVisibilityMiles(sparse.visib)).toBeUndefined();
      expect(parseWindDirection(sparse.wdir)).toBe(120);
    });

    it('should still carry the always-present identity and timing fields', () => {
      expect(sparse.icaoId).toBe('HKJK');
      expect(typeof sparse.obsTime).toBe('number');
      expect(typeof sparse.reportTime).toBe('string');
      expect(sparse.rawOb).toContain('HKJK');
    });

    it('should handle a report missing temperature entirely', () => {
      const noTemp: MetarObservation = { ...sparse, temp: undefined, dewp: undefined };

      expect(noTemp.temp).toBeUndefined();
      expect(noTemp.dewp).toBeUndefined();
      expect(noTemp.wspd).toBe(8);
    });
  });
});
