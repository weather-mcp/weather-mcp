import { describe, it, expect } from 'vitest';
import {
  NWS_CODE_ALONE,
  NWS_CODE_PLUS_BOX,
  isNwsCountryCode,
} from '../../src/utils/nwsJurisdiction.js';

describe('nwsJurisdiction', () => {
  it('NWS_CODE_ALONE holds exactly us and pr', () => {
    expect([...NWS_CODE_ALONE].sort()).toEqual(['pr', 'us']);
  });

  it('NWS_CODE_PLUS_BOX holds exactly as, gu, mp, vi', () => {
    expect([...NWS_CODE_PLUS_BOX].sort()).toEqual(['as', 'gu', 'mp', 'vi']);
  });

  it('the two sets are disjoint', () => {
    for (const code of NWS_CODE_ALONE) {
      expect(NWS_CODE_PLUS_BOX.has(code)).toBe(false);
    }
  });

  it.each(['us', 'pr', 'gu', 'mp', 'vi', 'as'])('isNwsCountryCode(%s) is true', (code) => {
    expect(isNwsCountryCode(code)).toBe(true);
  });

  it.each(['ca', 'fm', 'pw', 'mh', '', 'US'])('isNwsCountryCode(%j) is false', (code) => {
    expect(isNwsCountryCode(code)).toBe(false);
  });
});
