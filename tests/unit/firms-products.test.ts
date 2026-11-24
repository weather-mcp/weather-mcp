import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRMS_LAST_MODIFIED_STALE_MS,
  FIRMS_MAX_DATE_STALE_DAYS,
  FIRMS_PRODUCTS,
  classifyLastModified,
  classifyMaxDate,
  parseDataAvailabilityCsv,
  satelliteDisplayName,
} from '../../src/utils/firmsProducts.js';

// Clock anchored to the probed 2026-11-24 ~04:00 UTC capture; boundary rows use literals (G160).
const NOW = Date.parse('2026-11-24T04:00:00Z');

const PROBED_BODY = [
  'data_id,min_date,max_date',
  'MODIS_NRT,2026-09-01,2026-11-24',
  'MODIS_SP,2000-11-01,2026-06-30',
  'VIIRS_NOAA20_NRT,2026-09-01,2026-11-24',
  'VIIRS_NOAA20_SP,2018-04-01,2026-06-30',
  'VIIRS_NOAA21_NRT,2026-09-01,2026-11-24',
  'VIIRS_SNPP_NRT,2026-09-01,2026-11-02',
  'VIIRS_SNPP_SP,2012-01-19,2026-06-30',
  'LANDSAT_NRT,2022-06-20,2026-11-24',
  'GOES_NRT,2022-08-18,2026-11-24',
  'BA_MODIS,2000-11-01,2025-12-31',
  'MODIS_NRT_E,2026-09-01,2026-11-24',
  'VIIRS_NOAA20_NRT_E,2026-09-01,2026-11-24',
].join('\n');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('constants', () => {
  it('equal their settled literals', () => {
    expect(FIRMS_LAST_MODIFIED_STALE_MS).toBe(86_400_000);
    expect(FIRMS_MAX_DATE_STALE_DAYS).toBe(2);
  });
});

describe('FIRMS_PRODUCTS', () => {
  it('holds the probed ids, directories and prefixes, NOAA-20 first', () => {
    expect(FIRMS_PRODUCTS.map((p) => [p.id, p.flatFileDir, p.flatFilePrefix, p.displayName])).toEqual([
      ['VIIRS_NOAA20_NRT', 'noaa-20-viirs-c2', 'J1_VIIRS_C2', 'NOAA-20'],
      ['VIIRS_NOAA21_NRT', 'noaa-21-viirs-c2', 'J2_VIIRS_C2', 'NOAA-21'],
    ]);
    expect(FIRMS_PRODUCTS[0]?.satelliteCodes).toEqual(['N20', '1']);
    expect(FIRMS_PRODUCTS[1]?.satelliteCodes).toEqual(['N21', '2']);
  });

  it('has no SNPP row and no colon in an id', () => {
    for (const p of FIRMS_PRODUCTS) {
      expect(JSON.stringify(p)).not.toMatch(/SNPP|suomi/i);
      expect(p.id).not.toContain(':');
    }
  });
});

describe('satelliteDisplayName', () => {
  it.each([
    ['N20', 'NOAA-20 (VIIRS)'],
    ['1', 'NOAA-20 (VIIRS)'],
    ['N21', 'NOAA-21 (VIIRS)'],
    ['2', 'NOAA-21 (VIIRS)'],
    ['N', 'Suomi NPP (VIIRS)'],
    ['T', 'T'],
    ['', 'Unknown'],
    ['__proto__', '__proto__'],
  ])('maps %j to %j', (code, expected) => {
    expect(satelliteDisplayName(code)).toBe(expected);
  });

  it('maps all six known codes to distinct satellites', () => {
    const names = new Set(['N20', '1', 'N21', '2', 'N'].map(satelliteDisplayName));
    expect(names).toEqual(new Set(['NOAA-20 (VIIRS)', 'NOAA-21 (VIIRS)', 'Suomi NPP (VIIRS)']));
  });
});

describe('classifyLastModified', () => {
  it('is current at exactly 24 h old', () => {
    expect(classifyLastModified('Mon, 23 Nov 2026 04:00:00 GMT', NOW)).toEqual({ state: 'current' });
  });

  it('is stale at 24 h and 1 s old, with the UTC date', () => {
    expect(classifyLastModified('Mon, 23 Nov 2026 03:59:59 GMT', NOW)).toEqual({
      state: 'stale',
      lastDataDate: '2026-11-23',
    });
  });

  it('is stale at 12 days with the probed date', () => {
    expect(classifyLastModified('Thu, 12 Nov 2026 15:49:36 GMT', NOW)).toEqual({
      state: 'stale',
      lastDataDate: '2026-11-12',
    });
  });

  it('is current for a fresh file', () => {
    expect(classifyLastModified('Tue, 24 Nov 2026 03:40:47 GMT', NOW)).toEqual({ state: 'current' });
  });

  it.each([[undefined], [''], ['   '], ['garbage']])('fails open on %j', (header) => {
    expect(classifyLastModified(header, NOW)).toEqual({ state: 'current' });
  });

  it('is current for a future date', () => {
    expect(classifyLastModified('Fri, 27 Nov 2026 04:00:00 GMT', NOW)).toEqual({ state: 'current' });
  });
});

describe('classifyMaxDate', () => {
  it('is current for today', () => {
    expect(classifyMaxDate('2026-11-24', NOW)).toEqual({ state: 'current' });
  });

  it('is current for yesterday', () => {
    expect(classifyMaxDate('2026-11-23', NOW)).toEqual({ state: 'current' });
  });

  it('is stale at 2 days, verbatim date', () => {
    expect(classifyMaxDate('2026-11-22', NOW)).toEqual({ state: 'stale', lastDataDate: '2026-11-22' });
  });

  it('is stale at 22 days', () => {
    expect(classifyMaxDate('2026-11-02', NOW)).toEqual({ state: 'stale', lastDataDate: '2026-11-02' });
  });

  it('is current for a future date', () => {
    expect(classifyMaxDate('2026-11-30', NOW)).toEqual({ state: 'current' });
  });

  it.each([[undefined], ['2026-1-2'], [''], ['garbage'], ['2026-11-24T00:00:00Z']])(
    'fails open on %j',
    (value) => {
      expect(classifyMaxDate(value, NOW)).toEqual({ state: 'current' });
    },
  );

  it('counts calendar days across a month seam, not 24 h spans', () => {
    // 00:30 UTC on 1 Dec: 30 Nov is one calendar day behind, 29 Nov is two.
    const seam = Date.parse('2026-12-01T00:30:00Z');
    expect(classifyMaxDate('2026-11-30', seam)).toEqual({ state: 'current' });
    expect(classifyMaxDate('2026-11-29', seam)).toEqual({ state: 'stale', lastDataDate: '2026-11-29' });
  });

  describe('in a western zone', () => {
    let originalTz: string | undefined;

    beforeEach(() => {
      originalTz = process.env.TZ;
      process.env.TZ = 'America/New_York';
    });

    afterEach(() => {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    });

    it('gives the same answers as under UTC', () => {
      // The switch must have taken effect, or this row proves nothing (G162).
      expect(new Date('2024-03-05').getDate()).toBe(4);
      // 02:00 UTC is still the previous evening in New York; the maths must stay UTC.
      const early = Date.parse('2026-11-24T02:00:00Z');
      expect(classifyMaxDate('2026-11-24', early)).toEqual({ state: 'current' });
      expect(classifyMaxDate('2026-11-23', early)).toEqual({ state: 'current' });
      expect(classifyMaxDate('2026-11-22', early)).toEqual({ state: 'stale', lastDataDate: '2026-11-22' });
      expect(classifyLastModified('Thu, 12 Nov 2026 15:49:36 GMT', early)).toEqual({
        state: 'stale',
        lastDataDate: '2026-11-12',
      });
    });
  });
});

describe('parseDataAvailabilityCsv', () => {
  it('parses the probed body with no trailing newline', () => {
    const map = parseDataAvailabilityCsv(PROBED_BODY);
    expect(map.size).toBe(12);
    expect(map.get('VIIRS_NOAA20_NRT')).toBe('2026-11-24');
    expect(map.get('VIIRS_NOAA21_NRT')).toBe('2026-11-24');
    expect(map.get('VIIRS_SNPP_NRT')).toBe('2026-11-02');
    expect(map.get('MODIS_SP')).toBe('2026-06-30');
  });

  it('accepts CRLF line endings and a trailing newline', () => {
    const map = parseDataAvailabilityCsv(PROBED_BODY.replace(/\n/g, '\r\n') + '\r\n');
    expect(map.size).toBe(12);
    expect(map.get('VIIRS_NOAA21_NRT')).toBe('2026-11-24');
  });

  it('reads by header name when columns are reordered', () => {
    const map = parseDataAvailabilityCsv(
      'max_date,min_date,data_id\n2026-11-24,2026-09-01,VIIRS_NOAA20_NRT\n2026-11-02,2026-09-01,VIIRS_SNPP_NRT',
    );
    expect(map.get('VIIRS_NOAA20_NRT')).toBe('2026-11-24');
    expect(map.get('VIIRS_SNPP_NRT')).toBe('2026-11-02');
    expect(map.size).toBe(2);
  });

  it('returns an empty map for a header-only body', () => {
    expect(parseDataAvailabilityCsv('data_id,min_date,max_date').size).toBe(0);
  });

  it('returns an empty map for an empty body', () => {
    expect(parseDataAvailabilityCsv('').size).toBe(0);
  });

  it('returns an empty map when max_date is missing from the header', () => {
    expect(parseDataAvailabilityCsv('data_id,min_date\nVIIRS_NOAA20_NRT,2026-09-01').size).toBe(0);
  });

  it('returns an empty map when data_id is missing from the header', () => {
    expect(parseDataAvailabilityCsv('id,min_date,max_date\nVIIRS_NOAA20_NRT,2026-09-01,2026-11-24').size).toBe(0);
  });

  it('returns an empty map for a non-CSV error body', () => {
    expect(parseDataAvailabilityCsv('Invalid MAP_KEY.').size).toBe(0);
  });

  it('skips a row with a malformed or short max_date and keeps the others', () => {
    const map = parseDataAvailabilityCsv(
      [
        'data_id,min_date,max_date',
        'VIIRS_NOAA20_NRT,2026-09-01,2026-1-2',
        'VIIRS_NOAA21_NRT,2026-09-01,2026-11-24',
        'VIIRS_SNPP_NRT,2026-09-01',
        'MODIS_NRT,2026-09-01,',
      ].join('\n'),
    );
    expect([...map.keys()]).toEqual(['VIIRS_NOAA21_NRT']);
  });
});
