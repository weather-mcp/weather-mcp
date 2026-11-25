/**
 * An unusable wildfire feed renders an error, never an all-clear (wildfire-feed-envelope, T6).
 *
 * The guards live in FIRMSService and NIFCService, so every row enters the real service AND the
 * real handler (G45). Both services share this file's `mockGet` under a file-wide axios mock
 * (G70) and the mock dispatches on the request URL. Rows 7 and 8 are the positive controls: they
 * prove the mock reaches the parsers, so rows 1-6 are not vacuous.
 * The clock is frozen (Date only); data rows are dated one hour before NOW so the window
 * filter keeps them (G168).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGet, mockCreate } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockCreate: vi.fn()
}));

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  mockCreate.mockImplementation(() => ({ get: mockGet }));
  return {
    default: {
      ...actual.default,
      create: mockCreate,
      isAxiosError: actual.default.isAxiosError
    }
  };
});

import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import { FIRMSService } from '../../src/services/firms.js';
import { NIFCService } from '../../src/services/nifc.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

const LISBON = { latitude: 38.72, longitude: -9.14 };
const BOISE = { latitude: 43.615, longitude: -116.202 };
const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const TEST_KEY = 'feed-envelope-test-key-hyg';

const FRESH_LAST_MODIFIED = new Date(NOW - 600_000).toUTCString();
const HEADER = 'latitude,longitude,frp,acq_date,acq_time,satellite,confidence,daynight';
const HEADER_NO_TIME = 'latitude,longitude,frp,acq_date,satellite,confidence,daynight';
const HTML = '<!DOCTYPE html><html><body>Service Unavailable</body></html>';

const ROW_DATE = '2026-11-24';
const ROW_TIME = '1100'; // one hour before NOW

const validRow = (satellite: string): string =>
  `${LISBON.latitude},${LISBON.longitude},10.5,${ROW_DATE},${ROW_TIME},${satellite},nominal,D`;
const unusableRow = (): string =>
  `${LISBON.latitude},${LISBON.longitude},10.5,not-a-date,${ROW_TIME},N21,nominal,D`;
const csv = (header: string, rows: string[]): string => [header, ...rows].join('\n') + '\n';

type FlatBodies = { n20: string; n21: string };

/** URL-dispatching transport shared by both real services. */
function installTransport(opts: { flat?: FlatBodies; area?: FlatBodies; nifc?: unknown }): void {
  mockGet.mockImplementation(async (url: string) => {
    if (url.includes('services3.arcgis.com')) {
      return { data: opts.nifc, headers: {} };
    }
    if (url.includes('data_availability')) {
      throw new Error('availability unreachable');
    }
    if (url.includes('/api/area/csv/')) {
      if (!opts.area) throw new Error(`unexpected area request`);
      return { data: url.includes('VIIRS_NOAA20_NRT') ? opts.area.n20 : opts.area.n21, headers: {} };
    }
    if (url.includes('noaa-20-viirs-c2') || url.includes('noaa-21-viirs-c2')) {
      if (!opts.flat) throw new Error(`unexpected flat-file request`);
      return {
        data: url.includes('noaa-20-viirs-c2') ? opts.flat.n20 : opts.flat.n21,
        headers: { 'last-modified': FRESH_LAST_MODIFIED }
      };
    }
    throw new Error(`unmapped URL in test transport`);
  });
}

const requestedUrls = (): string[] => mockGet.mock.calls.map(c => String(c[0]));

async function runFirms(service: FIRMSService) {
  return handleGetWildfireInfo(
    { ...LISBON, source: 'firms' },
    new NIFCService(),
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    service
  );
}

async function runNifc() {
  return handleGetWildfireInfo(
    { ...BOISE, source: 'nifc' },
    new NIFCService(),
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    new FIRMSService({ mapKey: '' })
  );
}

const satelliteLine = (text: string): string => /^\*\*Satellite:\*\*.*$/m.exec(text)?.[0] ?? '';

const FIRMS_REFUSAL = 'Error details: FIRMS returned an unexpected response.';
const NIFC_REFUSAL = 'Error details: NIFC service returned an unexpected response.';
const FIRMS_ALL_CLEAR = 'No satellite fire detections';
const NIFC_ALL_CLEAR = 'No active wildfires found within';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  mockGet.mockReset();
  mockCreate.mockClear();
});

describe('wildfire feed envelope: an unusable feed is an error, not an all-clear', () => {
  it('1: keyless, NOAA-20 HTML and NOAA-21 valid → partial answer, NOAA-20 named as failed', async () => {
    installTransport({ flat: { n20: HTML, n21: csv(HEADER, [validRow('N21')]) } });
    const result = await runFirms(new FIRMSService({ mapKey: '' }));
    const text = result.content[0].text;

    expect('isError' in result).toBe(false);
    expect(text).toContain('*Note: not every satellite is included — NOAA-20: request failed.*');
    expect(satelliteLine(text)).toContain('NOAA-21 (VIIRS)');
    expect(satelliteLine(text)).not.toContain('NOAA-20');
    expect(text).not.toContain(FIRMS_ALL_CLEAR);
  });

  it('2: keyless, both HTML → isError with the fixed refusal, no all-clear', async () => {
    installTransport({ flat: { n20: HTML, n21: HTML } });
    const result = await runFirms(new FIRMSService({ mapKey: '' }));
    const text = result.content[0].text;

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(text).toContain(FIRMS_REFUSAL);
    expect(text).not.toContain(FIRMS_ALL_CLEAR);
  });

  it('3: keyless, valid header but every row unusable on both → isError, no all-clear', async () => {
    const bad = csv(HEADER, [unusableRow(), unusableRow()]);
    installTransport({ flat: { n20: bad, n21: bad } });
    const result = await runFirms(new FIRMSService({ mapKey: '' }));
    const text = result.content[0].text;

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(text).toContain(FIRMS_REFUSAL);
    expect(text).not.toContain(FIRMS_ALL_CLEAR);
  });

  it('4: keyed, both Area responses lack acq_time → isError, and no keyless fallback (G115)', async () => {
    const noTime = csv(HEADER_NO_TIME, [`${LISBON.latitude},${LISBON.longitude},10.5,${ROW_DATE},N21,nominal,D`]);
    installTransport({ area: { n20: noTime, n21: noTime } });
    const result = await runFirms(new FIRMSService({ mapKey: TEST_KEY }));
    const text = result.content[0].text;

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(text).toContain(FIRMS_REFUSAL);
    expect(text).not.toContain(FIRMS_ALL_CLEAR);
    const urls = requestedUrls();
    expect(urls.filter(u => u.includes('/api/area/csv/')).length).toBe(2);
    expect(urls.some(u => u.includes('active_fire'))).toBe(false);
    expect(text).not.toContain(TEST_KEY);
  });

  it('5: NIFC, the live ArcGIS error body → isError, no all-clear', async () => {
    installTransport({
      nifc: { error: { code: 400, message: 'Cannot perform query. Invalid query parameters.', details: [] } }
    });
    const result = await runNifc();
    const text = result.content[0].text;

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(text).toContain(NIFC_REFUSAL);
    expect(text).not.toContain(NIFC_ALL_CLEAR);
  });

  it('6: NIFC, an empty object → isError, no all-clear', async () => {
    installTransport({ nifc: {} });
    const result = await runNifc();
    const text = result.content[0].text;

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(text).toContain(NIFC_REFUSAL);
    expect(text).not.toContain(NIFC_ALL_CLEAR);
  });

  it('7: positive control — keyless header-only on both products renders the honest empty', async () => {
    const empty = csv(HEADER, []);
    installTransport({ flat: { n20: empty, n21: empty } });
    const result = await runFirms(new FIRMSService({ mapKey: '' }));
    const text = result.content[0].text;

    expect('isError' in result).toBe(false);
    expect(text).toContain(FIRMS_ALL_CLEAR);
    expect(requestedUrls().filter(u => u.includes('active_fire')).length).toBe(2);
  });

  it('8: positive control — NIFC { features: [] } renders the all-clear', async () => {
    installTransport({ nifc: { features: [] } });
    const result = await runNifc();
    const text = result.content[0].text;

    expect('isError' in result).toBe(false);
    expect(text).toContain(`✅ **${NIFC_ALL_CLEAR}`);
  });
});
