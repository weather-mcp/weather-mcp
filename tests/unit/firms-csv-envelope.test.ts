/**
 * Tests for the FIRMS CSV envelope predicate (src/utils/firmsHotspots.ts).
 * parsedRowCount always comes from the real parser on the same text.
 */

import { describe, it, expect } from 'vitest';
import {
  parseFIRMSCsv,
  classifyFIRMSCsvEnvelope
} from '../../src/utils/firmsHotspots.js';
import type { FIRMSCsvEnvelope } from '../../src/utils/firmsHotspots.js';

const AREA_HEADER =
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const FLAT_HEADER =
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight';
const AREA_ROW = '40.1,-3.5,335.2,0.38,0.36,2026-08-13,215,N,VIIRS,n,2.0NRT,297.6,15.3,D';
const FLAT_ROW = '-37.20348,174.72556,327.51,0.35,0.57,2026-11-24,0136,N20,low,2.0NRT,300.02,5.41,D';
const BAD_LAT_FLAT = 'abc,174.72556,327.51,0.35,0.57,2026-11-24,0136,N20,low,2.0NRT,300.02,5.41,D';
const BAD_DATE_FLAT = '-37.2,174.7,327.51,0.35,0.57,not-a-date,0136,N20,low,2.0NRT,300.02,5.41,D';

function classify(csv: string): FIRMSCsvEnvelope {
  return classifyFIRMSCsvEnvelope(csv, parseFIRMSCsv(csv).length);
}

describe('classifyFIRMSCsvEnvelope', () => {
  it.each<[string, string]>([
    ['Area API header alone', AREA_HEADER],
    ['flat-file header alone (no instrument)', FLAT_HEADER],
    ['Area API header with one good row', `${AREA_HEADER}\n${AREA_ROW}\n`],
    ['flat-file header with one good row', `${FLAT_HEADER}\n${FLAT_ROW}\n`],
    ['one good and one bad row', `${FLAT_HEADER}\n${FLAT_ROW}\n${BAD_LAT_FLAT}\n`],
    ['upper-case header with one row', 'LATITUDE,LONGITUDE,ACQ_DATE,ACQ_TIME\n40.1,-3.5,2026-08-13,215\n'],
    ['CRLF body', `${FLAT_HEADER}\r\n${FLAT_ROW}\r\n`],
    ['header followed by trailing blank lines', `${FLAT_HEADER}\n\n\n  \n`]
  ])('usable: %s', (_name, csv) => {
    expect(classify(csv)).toBe('usable');
  });

  // Literal list, not the exported constant: a test derived from the constant cannot catch the constant shrinking.
  const REQUIRED = ['latitude', 'longitude', 'acq_date', 'acq_time'];
  const threeOfFour = REQUIRED.map(missing => {
    const cols = REQUIRED.filter(c => c !== missing);
    const header = cols.join(',');
    const row = cols.map(c => (c === 'latitude' ? '40.1' : c === 'longitude' ? '-3.5' : c === 'acq_date' ? '2026-08-13' : '215')).join(',');
    return [`3-of-4 header missing ${missing}`, `${header}\n${row}\n`] as [string, string];
  });

  it.each<[string, string]>([
    ['empty body', ''],
    ['blank lines only', '\n\n'],
    ['HTML', '<html><body>Maintenance</body></html>'],
    ['JSON error', '{"error":"x"}'],
    ['String(obj)', '[object Object]'],
    ['JSON 404 shape', '{"detail":"The file /data/x.csv cannot be found"}'],
    ...threeOfFour
  ])('no-header: %s', (_name, csv) => {
    expect(classify(csv)).toBe('no-header');
  });

  it.each<[string, string]>([
    ['non-numeric latitude', `${FLAT_HEADER}\n${BAD_LAT_FLAT}\n`],
    ['three rows with a bad acq_date', `${FLAT_HEADER}\n${BAD_DATE_FLAT}\n${BAD_DATE_FLAT}\n${BAD_DATE_FLAT}\n`],
    ['truncated row', `${FLAT_HEADER}\n40.1,-105\n`]
  ])('no-usable-rows: %s', (_name, csv) => {
    expect(parseFIRMSCsv(csv)).toHaveLength(0);
    expect(classify(csv)).toBe('no-usable-rows');
  });
});
