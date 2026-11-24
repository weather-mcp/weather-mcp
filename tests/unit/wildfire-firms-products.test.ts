/**
 * Product contracts of the FIRMS path, driven through handleGetWildfireInfo (G45):
 * partial, stale, failed and unknown-freshness outcomes of the two VIIRS products.
 * Rows 1-7 use a product-keyed fake service; row 8 uses the real FIRMSService behind
 * a mocked axios, so the header read and the handler's judgement run together.
 * The fake rows never touch axios, so the file-wide mock does not affect them.
 * The clock is frozen (Date only) so every age is exact (G67).
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
import { FIRMSService, FIRMSKeyRejectedError } from '../../src/services/firms.js';
import type { NIFCService } from '../../src/services/nifc.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { FIRMSDetection } from '../../src/types/firms.js';

const POINT = { latitude: 38.72, longitude: -9.14 };
const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const DAY = 86_400_000;
const N20_ID = 'VIIRS_NOAA20_NRT';
const N21_ID = 'VIIRS_NOAA21_NRT';

const httpDate = (ms: number): string => new Date(ms).toUTCString();

function detection(satellite: string, dLat = 0): FIRMSDetection {
  return {
    latitude: POINT.latitude + dLat,
    longitude: POINT.longitude,
    frp: 10,
    confidence: 'nominal',
    acquiredAt: new Date(NOW - 3_600_000).toISOString(),
    daynight: 'D',
    satellite
  };
}

interface Fake {
  service: FIRMSService;
  bbox: ReturnType<typeof vi.fn>;
  region: ReturnType<typeof vi.fn>;
}

interface FakeOpts {
  keyed?: boolean;
  /** product id → outcome: rows + lastModified, or an Error to reject with */
  region?: Record<string, { rows: FIRMSDetection[]; lastModified: string | undefined } | Error>;
  bbox?: Record<string, FIRMSDetection[] | Error>;
  availability: Map<string, string> | undefined;
}

function fake(opts: FakeOpts): Fake {
  const bbox = vi.fn(async (_w: number, _s: number, _e: number, _n: number, _d: number, product: { id: string }) => {
    const out = opts.bbox?.[product.id];
    if (out instanceof Error) throw out;
    return out ?? [];
  });
  const region = vi.fn(async (_r: string, product: { id: string }) => {
    const out = opts.region?.[product.id];
    if (out instanceof Error) throw out;
    if (out === undefined) return { detections: [], lastModified: undefined };
    return { detections: out.rows, lastModified: out.lastModified };
  });
  const service = {
    isKeyAvailable: () => opts.keyed === true,
    getDetectionsByBbox: bbox,
    getDetectionsByRegion: region,
    getProductAvailability: vi.fn(async () => opts.availability)
  } as unknown as FIRMSService;
  return { service, bbox, region };
}

async function run(service: FIRMSService) {
  return handleGetWildfireInfo(
    { ...POINT, source: 'firms' },
    { queryFirePerimeters: vi.fn() } as unknown as NIFCService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService,
    service
  );
}

const fresh = httpDate(NOW - 600_000);
const stale12 = httpDate(NOW - 12 * DAY);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  mockGet.mockReset();
  mockCreate.mockClear();
});

describe('get_wildfire_info FIRMS products', () => {
  it('1: both current (keyless) → both render, header names both, no note, no isError', async () => {
    const f = fake({
      region: {
        [N20_ID]: { rows: [detection('N20'), detection('N20', 0.5)], lastModified: fresh },
        [N21_ID]: { rows: [detection('N21')], lastModified: fresh }
      },
      availability: undefined
    });
    const result = await run(f.service);
    const text = result.content[0].text;
    expect(Object.keys(result)).toEqual(['content']);
    expect(text).toContain('**Satellites:** NOAA-20, NOAA-21 (VIIRS)\n');
    expect(text).toContain('**Satellite:** NOAA-20 (VIIRS), NOAA-21 (VIIRS)\n');
    expect(text).toContain('3 satellite fire detections');
    expect(text).not.toContain('*Note: not every satellite');
  });

  it('2: NOAA-21 rejects → NOAA-20 rows render with a request-failed note, not an error', async () => {
    const f = fake({
      region: {
        [N20_ID]: { rows: [detection('N20')], lastModified: fresh },
        [N21_ID]: new Error('boom')
      },
      availability: undefined
    });
    const result = await run(f.service);
    const text = result.content[0].text;
    expect(Object.keys(result)).toEqual(['content']);
    expect(text).toContain('**Satellites:** NOAA-20 (VIIRS)\n');
    expect(text).toContain('*Note: not every satellite is included — NOAA-21: request failed.*\n');
    expect(text).toContain('**Satellite:** NOAA-20 (VIIRS)\n');
    expect(text).toContain('1 satellite fire detection ');
  });

  it('3a: keyless NOAA-21 stale → its rows are dropped and the note names the date', async () => {
    const f = fake({
      region: {
        [N20_ID]: { rows: [detection('N20')], lastModified: fresh },
        [N21_ID]: { rows: [detection('N21'), detection('N21', 0.3)], lastModified: stale12 }
      },
      availability: undefined
    });
    const result = await run(f.service);
    const text = result.content[0].text;
    expect(Object.keys(result)).toEqual(['content']);
    expect(text).toContain('**Satellites:** NOAA-20 (VIIRS)\n');
    expect(text).toContain('*Note: not every satellite is included — NOAA-21: no new data since 2026-11-12 (UTC).*\n');
    expect(text).toContain('1 satellite fire detection ');
    expect(text).toContain('**Satellite:** NOAA-20 (VIIRS)\n');
  });

  it('3b: keyed NOAA-21 stale → no bbox call for it, note carries max_date verbatim', async () => {
    const f = fake({
      keyed: true,
      bbox: { [N20_ID]: [detection('N20')], [N21_ID]: [detection('N21')] },
      availability: new Map([[N20_ID, '2026-11-24'], [N21_ID, '2026-11-02']])
    });
    const result = await run(f.service);
    const text = result.content[0].text;
    expect(Object.keys(result)).toEqual(['content']);
    expect(text).toContain('*Note: not every satellite is included — NOAA-21: no new data since 2026-11-02 (UTC).*\n');
    expect(text).toContain('**Satellites:** NOAA-20 (VIIRS)\n');
    expect(f.bbox.mock.calls.some(c => (c[5] as { id: string }).id === N20_ID)).toBe(true);
    expect(f.bbox.mock.calls.some(c => (c[5] as { id: string }).id === N21_ID)).toBe(false);
    expect(text).toContain('1 satellite fire detection ');
  });

  it('4a: both reject → error block with isError', async () => {
    const f = fake({
      region: { [N20_ID]: new Error('boom-20'), [N21_ID]: new Error('boom-21') },
      availability: undefined
    });
    const result = await run(f.service);
    const text = result.content[0].text;
    expect(result.isError).toBe(true);
    expect(text).toContain('❌ **Error retrieving wildfire data**');
    expect(text).toContain('Error details: boom-20\n');
  });

  it('4b: both stale (keyless) → not-updating error naming both dates, isError', async () => {
    const f = fake({
      region: {
        [N20_ID]: { rows: [detection('N20')], lastModified: httpDate(NOW - 13 * DAY) },
        [N21_ID]: { rows: [detection('N21')], lastModified: stale12 }
      },
      availability: undefined
    });
    const result = await run(f.service);
    const text = result.content[0].text;
    expect(result.isError).toBe(true);
    expect(text).toContain(
      'Error details: NASA FIRMS satellite feeds are not currently updating ' +
      '(NOAA-20: last data 2026-11-11; NOAA-21: last data 2026-11-12).\n'
    );
  });

  it('4c: both stale (keyed) → not-updating error and no bbox call at all', async () => {
    const f = fake({
      keyed: true,
      bbox: { [N20_ID]: [detection('N20')], [N21_ID]: [detection('N21')] },
      availability: new Map([[N20_ID, '2026-11-01'], [N21_ID, '2026-11-02']])
    });
    const result = await run(f.service);
    const text = result.content[0].text;
    expect(result.isError).toBe(true);
    expect(text).toContain(
      'Error details: NASA FIRMS satellite feeds are not currently updating ' +
      '(NOAA-20: last data 2026-11-01; NOAA-21: last data 2026-11-02).\n'
    );
    expect(f.bbox).not.toHaveBeenCalled();
  });

  describe('5: freshness signal missing → product included, no note', () => {
    it('keyless, lastModified undefined', async () => {
      const f = fake({
        region: {
          [N20_ID]: { rows: [detection('N20')], lastModified: undefined },
          [N21_ID]: { rows: [detection('N21')], lastModified: undefined }
        },
        availability: undefined
      });
      const result = await run(f.service);
      const text = result.content[0].text;
      expect(Object.keys(result)).toEqual(['content']);
      expect(text).toContain('**Satellites:** NOAA-20, NOAA-21 (VIIRS)\n');
      expect(text).not.toContain('*Note: not every satellite');
    });

    it('keyed, availability undefined', async () => {
      const f = fake({
        keyed: true,
        bbox: { [N20_ID]: [detection('N20')], [N21_ID]: [detection('N21')] },
        availability: undefined
      });
      const result = await run(f.service);
      const text = result.content[0].text;
      expect(text).toContain('**Satellites:** NOAA-20, NOAA-21 (VIIRS)\n');
      expect(text).not.toContain('*Note: not every satellite');
    });

    it('keyed, availability map lacks the NOAA-21 id', async () => {
      const f = fake({
        keyed: true,
        bbox: { [N20_ID]: [detection('N20')], [N21_ID]: [detection('N21')] },
        availability: new Map([[N20_ID, '2026-11-24']])
      });
      const result = await run(f.service);
      const text = result.content[0].text;
      expect(text).toContain('**Satellites:** NOAA-20, NOAA-21 (VIIRS)\n');
      expect(text).not.toContain('*Note: not every satellite');
      expect(f.bbox.mock.calls.some(c => (c[5] as { id: string }).id === N21_ID)).toBe(true);
    });
  });

  describe('6: key rejected → keyed rows discarded, keyless merge runs', () => {
    it('shows the key-rejected note and only keyless rows', async () => {
      const f = fake({
        keyed: true,
        bbox: { [N20_ID]: new FIRMSKeyRejectedError(), [N21_ID]: [detection('N21', 0.4)] },
        region: {
          [N20_ID]: { rows: [detection('N20')], lastModified: fresh },
          [N21_ID]: { rows: [], lastModified: fresh }
        },
        availability: new Map([[N20_ID, '2026-11-24'], [N21_ID, '2026-11-24']])
      });
      const result = await run(f.service);
      const text = result.content[0].text;
      expect(Object.keys(result)).toEqual(['content']);
      expect(text).toContain('*Note: FIRMS_MAP_KEY was rejected; showing keyless 24-hour data.*\n');
      expect(text).toContain('1 satellite fire detection ');
      expect(text).toContain('**Satellite:** NOAA-20 (VIIRS)\n');
      expect(f.region).toHaveBeenCalledTimes(2);
    });

    it('applies keyless freshness: stale NOAA-21 gives both notes, partial note first', async () => {
      const f = fake({
        keyed: true,
        bbox: { [N20_ID]: new FIRMSKeyRejectedError(), [N21_ID]: [] },
        region: {
          [N20_ID]: { rows: [detection('N20')], lastModified: fresh },
          [N21_ID]: { rows: [detection('N21')], lastModified: stale12 }
        },
        availability: new Map([[N20_ID, '2026-11-24'], [N21_ID, '2026-11-24']])
      });
      const result = await run(f.service);
      const text = result.content[0].text;
      const partial = '*Note: not every satellite is included — NOAA-21: no new data since 2026-11-12 (UTC).*\n';
      const rejected = '*Note: FIRMS_MAP_KEY was rejected; showing keyless 24-hour data.*\n';
      expect(text).toContain(partial);
      expect(text).toContain(rejected);
      expect(text.indexOf(partial)).toBeLessThan(text.indexOf(rejected));
      expect(text).toContain('**Satellites:** NOAA-20 (VIIRS)\n');
    });
  });

  it('7: zero rows from both current products → no-detections line, caveat, both named, no note', async () => {
    const f = fake({
      region: {
        [N20_ID]: { rows: [], lastModified: fresh },
        [N21_ID]: { rows: [], lastModified: fresh }
      },
      availability: undefined
    });
    const result = await run(f.service);
    const text = result.content[0].text;
    expect(Object.keys(result)).toEqual(['content']);
    expect(text).toContain('**Satellites:** NOAA-20, NOAA-21 (VIIRS)\n');
    expect(text).toContain('**No satellite fire detections in the last 24 h within');
    expect(text).toContain('absence of detections is not an all-clear');
    expect(text).not.toContain('*Note: not every satellite');
  });

  describe('8: real FIRMSService, axios mocked', () => {
    function csvFor(code: string): string {
      return [
        'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight',
        `${POINT.latitude},${POINT.longitude},330.0,0.4,0.4,2026-11-24,1100,${code},nominal,2.0NRT,290.0,12.0,D`
      ].join('\n');
    }

    function serve(n21LastModified: string): void {
      mockGet.mockImplementation(async (url: string) => {
        const isN21 = url.includes('noaa-21-viirs-c2');
        return {
          data: csvFor(isN21 ? 'N21' : 'N20'),
          status: 200,
          headers: { 'last-modified': isN21 ? n21LastModified : fresh }
        };
      });
    }

    it('a 12-day-old last-modified on the NOAA-21 file excludes NOAA-21', async () => {
      serve(stale12);
      const result = await run(new FIRMSService());
      const text = result.content[0].text;
      expect(Object.keys(result)).toEqual(['content']);
      expect(text).toContain('**Satellites:** NOAA-20 (VIIRS)\n');
      expect(text).toContain('*Note: not every satellite is included — NOAA-21: no new data since 2026-11-12 (UTC).*\n');
      expect(text).toContain('**Satellite:** NOAA-20 (VIIRS)\n');
    });

    it('a current last-modified on both files includes both', async () => {
      serve(fresh);
      const result = await run(new FIRMSService());
      const text = result.content[0].text;
      expect(text).toContain('**Satellites:** NOAA-20, NOAA-21 (VIIRS)\n');
      expect(text).toContain('**Satellite:** NOAA-20 (VIIRS), NOAA-21 (VIIRS)\n');
      expect(text).not.toContain('*Note: not every satellite');
    });
  });
  describe('9: keyless rows are filtered to the 24 h the report names (G168)', () => {
    // A `_24h` flat file is "recent acquisitions": measured live holding rows
    // 25-36 h old, which rendered as "in the last 24 h" (codex-DR-M2).
    function aged(satellite: string, ageMs: number, dLat = 0): FIRMSDetection {
      return { ...detection(satellite, dLat), acquiredAt: new Date(NOW - ageMs).toISOString() };
    }

    it('keeps rows at 1 h and exactly 24 h, drops 24 h + 1 s and 36 h', async () => {
      const f = fake({
        region: {
          [N20_ID]: { rows: [aged('N20', 3_600_000), aged('N20', DAY + 1000, 0.2)], lastModified: fresh },
          [N21_ID]: { rows: [aged('N21', DAY, 0.4), aged('N21', 1.5 * DAY, 0.6)], lastModified: fresh }
        },
        availability: undefined
      });
      const result = await run(f.service);
      const text = result.content[0].text;
      expect(Object.keys(result)).toEqual(['content']);
      expect(text).toContain('2 satellite fire detections in the last 24 h');
      expect(text).not.toContain('**Newest detection:** 36');
      expect(text).not.toContain('**Newest detection:** 24.0');
    });

    it('current products holding only rows older than 24 h → the no-detections line and caveat', async () => {
      const f = fake({
        region: {
          [N20_ID]: { rows: [aged('N20', 1.5 * DAY)], lastModified: fresh },
          [N21_ID]: { rows: [aged('N21', 1.1 * DAY)], lastModified: fresh }
        },
        availability: undefined
      });
      const result = await run(f.service);
      const text = result.content[0].text;
      expect(Object.keys(result)).toEqual(['content']);
      expect(text).toContain('**Satellites:** NOAA-20, NOAA-21 (VIIRS)\n');
      expect(text).toContain('**No satellite fire detections in the last 24 h within');
      expect(text).toContain('absence of detections is not an all-clear');
    });
  });
});
