import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the axios instance used by AcisService so no real network calls are made.
const { mockPost, mockUse } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockUse: vi.fn()
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: mockPost,
      defaults: { headers: { common: {} as Record<string, string> } },
      interceptors: { response: { use: mockUse } }
    }))
  }
}));

import { AcisService, dayOfYearIndex } from '../../src/services/acis.js';
import { getRecordsLine } from '../../src/utils/records.js';
import { IMPERIAL_PREFERENCES, METRIC_PREFERENCES } from '../../src/config/units.js';
import type { AcisSmryEntry } from '../../src/types/acis.js';

const SEATTLE_STATION = {
  name: 'SEATTLE TACOMA AIRPORT, WA US',
  sids: ['USW00024233 6', 'SEAthr 9'],
  ll: [-122.3088, 47.4502] as [number, number],
  valid_daterange: [
    ['1945-01-01', '2026-08-01'],
    ['1945-01-01', '2026-08-01']
  ] as [string, string][]
};

/** 366 default "M" (missing) entries for a smry table, with optional index overrides. */
function buildSmryTable(overrides: Record<number, AcisSmryEntry> = {}): AcisSmryEntry[] {
  const table: AcisSmryEntry[] = [];
  for (let i = 0; i < 366; i++) {
    table.push(overrides[i] ?? ['M', '1900-01-01']);
  }
  return table;
}

const AUG_12_INDEX = 224;
const FEB_29_INDEX = 59;

/**
 * Configure the mocked client for a healthy StnMeta + StnData round trip.
 * Optional overrides let individual tests simulate missing/malformed data.
 */
function setupHappyPath(opts: {
  stations?: unknown[];
  highEntry?: AcisSmryEntry;
  lowEntry?: AcisSmryEntry;
  malformed?: boolean;
} = {}) {
  const {
    stations = [SEATTLE_STATION],
    highEntry = ['96', '1977-08-12'],
    lowEntry = ['49', '1953-08-12'],
    malformed = false
  } = opts;

  mockPost.mockImplementation((url: string, body?: Record<string, unknown>) => {
    if (url === '/StnMeta') {
      return Promise.resolve({ data: { meta: stations } });
    }
    if (url === '/StnData') {
      if (malformed) {
        return Promise.resolve({ data: {} });
      }
      const highTable = buildSmryTable({ [AUG_12_INDEX]: highEntry });
      const lowTable = buildSmryTable({ [AUG_12_INDEX]: lowEntry });
      return Promise.resolve({ data: { smry: [highTable, lowTable] } });
    }
    return Promise.reject(new Error(`Unexpected URL in test: ${url} ${JSON.stringify(body)}`));
  });
}

describe('dayOfYearIndex', () => {
  it('should index Aug 12 at 224 (0-based, leap calendar)', () => {
    expect(dayOfYearIndex(8, 12)).toBe(224);
  });

  it('should index Jan 1 at 0', () => {
    expect(dayOfYearIndex(1, 1)).toBe(0);
  });

  it('should index Dec 31 at 365 (last of 366 slots)', () => {
    expect(dayOfYearIndex(12, 31)).toBe(365);
  });

  it('should give Feb 29 a real slot (index 59)', () => {
    expect(dayOfYearIndex(2, 29)).toBe(59);
  });

  it('should not shift post-February dates for common-year callers', () => {
    // Mar 1 always lands at the same index, whether or not the *current*
    // year is a leap year — the ACIS table is always the fixed 366-slot
    // leap calendar.
    expect(dayOfYearIndex(3, 1)).toBe(60);
  });

  it('should reject an invalid month', () => {
    expect(() => dayOfYearIndex(13, 1)).toThrow(RangeError);
    expect(() => dayOfYearIndex(0, 1)).toThrow(RangeError);
  });

  it('should reject an invalid day', () => {
    expect(() => dayOfYearIndex(1, 32)).toThrow(RangeError);
    expect(() => dayOfYearIndex(1, 0)).toThrow(RangeError);
  });
});

describe('AcisService', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockUse.mockClear();
  });

  describe('findRecordsStation', () => {
    it('should resolve the nearest station with a usable period of record', async () => {
      setupHappyPath();
      const service = new AcisService();
      const station = await service.findRecordsStation(47.6062, -122.3321);

      expect(station.name).toBe(SEATTLE_STATION.name);
      expect(station.porStartYear).toBe(1945);
    });

    it('should prefer a threaded ("thr") station id when picking the query id', async () => {
      setupHappyPath();
      const service = new AcisService();
      const station = await service.findRecordsStation(47.6062, -122.3321);

      expect(station.id).toBe('SEAthr 9');
    });

    it('should pick the station with the longest period of record among candidates', async () => {
      const shortPOR = {
        name: 'SHORT POR STATION',
        sids: ['SHORT 2'],
        ll: [-122.3, 47.6] as [number, number],
        valid_daterange: [
          ['2010-01-01', '2026-08-01'],
          ['2010-01-01', '2026-08-01']
        ] as [string, string][]
      };
      const longPOR = {
        name: 'LONG POR STATION',
        sids: ['LONG 2'],
        ll: [-122.31, 47.61] as [number, number],
        valid_daterange: [
          ['1900-01-01', '2026-08-01'],
          ['1900-01-01', '2026-08-01']
        ] as [string, string][]
      };
      setupHappyPath({ stations: [shortPOR, longPOR] });

      const service = new AcisService();
      const station = await service.findRecordsStation(47.6062, -122.3321);

      expect(station.name).toBe('LONG POR STATION');
      expect(station.porStartYear).toBe(1900);
    });

    it('should prefer the threaded station as a tiebreaker when POR length is equal', async () => {
      const plain = {
        name: 'PLAIN STATION',
        sids: ['PLAIN 2'],
        ll: [-122.3, 47.6] as [number, number],
        valid_daterange: [
          ['1945-01-01', '2026-08-01'],
          ['1945-01-01', '2026-08-01']
        ] as [string, string][]
      };
      const threaded = {
        name: 'THREADED STATION',
        sids: ['THRDthr 9'],
        ll: [-122.31, 47.61] as [number, number],
        valid_daterange: [
          ['1945-01-01', '2026-08-01'],
          ['1945-01-01', '2026-08-01']
        ] as [string, string][]
      };
      setupHappyPath({ stations: [plain, threaded] });

      const service = new AcisService();
      const station = await service.findRecordsStation(47.6062, -122.3321);

      expect(station.name).toBe('THREADED STATION');
    });

    it('should widen the bbox once and retry when the initial search is empty', async () => {
      let call = 0;
      mockPost.mockImplementation((url: string) => {
        if (url === '/StnMeta') {
          call++;
          if (call === 1) {
            return Promise.resolve({ data: { meta: [] } });
          }
          return Promise.resolve({ data: { meta: [SEATTLE_STATION] } });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const service = new AcisService();
      const station = await service.findRecordsStation(47.6062, -122.3321);

      expect(station.name).toBe(SEATTLE_STATION.name);
      expect(mockPost).toHaveBeenCalledTimes(2);

      const firstBbox = mockPost.mock.calls[0][1].bbox as string;
      const secondBbox = mockPost.mock.calls[1][1].bbox as string;
      expect(firstBbox).not.toBe(secondBbox);
      // Wider bbox: west edge of the second call should be further west.
      const firstWest = parseFloat(firstBbox.split(',')[0]);
      const secondWest = parseFloat(secondBbox.split(',')[0]);
      expect(secondWest).toBeLessThan(firstWest);
    });

    it('should throw when no station is found even after widening', async () => {
      setupHappyPath({ stations: [] });
      const service = new AcisService();

      await expect(service.findRecordsStation(40.0, -100.0)).rejects.toThrow(
        /No ACIS station/
      );
      expect(mockPost).toHaveBeenCalledTimes(2); // both extents tried
    });

    it('should send the expected StnMeta request parameters', async () => {
      setupHappyPath();
      const service = new AcisService();
      await service.findRecordsStation(47.6062, -122.3321);

      const [, body] = mockPost.mock.calls[0];
      expect(body.elems).toBe('maxt,mint');
      expect(body.meta).toBe('name,sids,ll,valid_daterange');
      expect(typeof body.bbox).toBe('string');
    });

    it('should cache station results and not re-query on a second identical call', async () => {
      setupHappyPath();
      const service = new AcisService();

      await service.findRecordsStation(47.6062, -122.3321);
      const callsAfterFirst = mockPost.mock.calls.length;
      await service.findRecordsStation(47.6062, -122.3321);

      expect(mockPost.mock.calls.length).toBe(callsAfterFirst);
    });
  });

  describe('getDailyRecords', () => {
    it('should parse the 366-slot table and return the requested-station metadata', async () => {
      setupHappyPath();
      const service = new AcisService();
      const records = await service.getDailyRecords('USW00024233 6', 'SEATTLE TACOMA AIRPORT, WA US', 1945);

      expect(records.stationName).toBe('SEATTLE TACOMA AIRPORT, WA US');
      expect(records.porStartYear).toBe(1945);
      expect(records.days).toHaveLength(366);
      expect(records.days[AUG_12_INDEX]).toEqual({
        high: { value: 96, year: 1977 },
        low: { value: 49, year: 1953 }
      });
    });

    it('should treat "M" (missing) as an absent side', async () => {
      setupHappyPath({ lowEntry: ['M', '1900-01-01'] });
      const service = new AcisService();
      const records = await service.getDailyRecords('id', 'name', 1945);

      expect(records.days[AUG_12_INDEX].high).toEqual({ value: 96, year: 1977 });
      expect(records.days[AUG_12_INDEX].low).toBeUndefined();
    });

    it('should treat "T" (trace) as an absent side for a temperature slot', async () => {
      setupHappyPath({ highEntry: ['T', '1900-01-01'] });
      const service = new AcisService();
      const records = await service.getDailyRecords('id', 'name', 1945);

      expect(records.days[AUG_12_INDEX].high).toBeUndefined();
      expect(records.days[AUG_12_INDEX].low).toEqual({ value: 49, year: 1953 });
    });

    it('should throw on a malformed response body', async () => {
      setupHappyPath({ malformed: true });
      const service = new AcisService();

      await expect(service.getDailyRecords('id', 'name', 1945)).rejects.toThrow(
        /Malformed ACIS/
      );
    });

    it('should cache records and not re-query on a second identical call', async () => {
      setupHappyPath();
      const service = new AcisService();

      await service.getDailyRecords('USW00024233 6', 'name', 1945);
      const callsAfterFirst = mockPost.mock.calls.length;
      await service.getDailyRecords('USW00024233 6', 'name', 1945);

      expect(mockPost.mock.calls.length).toBe(callsAfterFirst);
    });
  });

  describe('Error handling interceptor', () => {
    function getErrorInterceptor() {
      new AcisService();
      const lastCall = mockUse.mock.calls[mockUse.mock.calls.length - 1];
      return lastCall[1] as (error: unknown) => Promise<never>;
    }

    it('should surface a response error with its status', async () => {
      const onRejected = getErrorInterceptor();
      await expect(
        onRejected({ response: { status: 503, data: {} } })
      ).rejects.toThrow(/503/);
    });

    it('should map timeouts to a clear message', async () => {
      const onRejected = getErrorInterceptor();
      await expect(onRejected({ code: 'ETIMEDOUT' })).rejects.toThrow(/timed out/);
    });

    it('should map connection errors to a clear message', async () => {
      const onRejected = getErrorInterceptor();
      await expect(onRejected({ code: 'ENOTFOUND' })).rejects.toThrow(/Unable to connect/);
    });

    it('should fall back to a generic message for unrecognized errors', async () => {
      const onRejected = getErrorInterceptor();
      await expect(onRejected('not an object')).rejects.toThrow(/Unknown error/);
    });
  });
});

describe('getRecordsLine', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockUse.mockClear();
  });

  it('should return the records line and attribution for a normal day', async () => {
    setupHappyPath();
    const service = new AcisService();

    const line = await getRecordsLine(service, 47.6062, -122.3321, 8, 12);

    expect(line).toBe(
      '**Records for Aug 12:** High 96°F (1977) · Low 49°F (1953) — records since 1945\n' +
      'Records: NOAA Regional Climate Centers (ACIS)'
    );
  });

  it('should convert to metric preferences', async () => {
    setupHappyPath();
    const service = new AcisService();

    const line = await getRecordsLine(service, 47.6062, -122.3321, 8, 12, METRIC_PREFERENCES);

    // 96F -> 36C, 49F -> 9C
    expect(line).toContain('High 36°C (1977)');
    expect(line).toContain('Low 9°C (1953)');
  });

  it('should default to imperial preferences when none are given', async () => {
    setupHappyPath();
    const service = new AcisService();

    const line = await getRecordsLine(service, 47.6062, -122.3321, 8, 12);
    const lineWithExplicitPrefs = await getRecordsLine(
      service,
      47.6062,
      -122.3321,
      8,
      12,
      IMPERIAL_PREFERENCES
    );

    expect(line).toBe(lineWithExplicitPrefs);
  });

  it('should render a one-sided line when only the high is available', async () => {
    setupHappyPath({ lowEntry: ['M', '1900-01-01'] });
    const service = new AcisService();

    const line = await getRecordsLine(service, 47.6062, -122.3321, 8, 12);

    expect(line).toContain('High 96°F (1977)');
    expect(line).not.toContain('Low');
  });

  it('should render a one-sided line when only the low is available', async () => {
    setupHappyPath({ highEntry: ['M', '1900-01-01'] });
    const service = new AcisService();

    const line = await getRecordsLine(service, 47.6062, -122.3321, 8, 12);

    expect(line).toContain('Low 49°F (1953)');
    expect(line).not.toContain('High');
  });

  it('should return undefined when both sides are missing for the date', async () => {
    setupHappyPath({ highEntry: ['M', '1900-01-01'], lowEntry: ['M', '1900-01-01'] });
    const service = new AcisService();

    const line = await getRecordsLine(service, 47.6062, -122.3321, 8, 12);

    expect(line).toBeUndefined();
  });

  it('should return undefined (and not throw) when no station is found', async () => {
    setupHappyPath({ stations: [] });
    const service = new AcisService();

    const line = await getRecordsLine(service, 40.0, -100.0, 8, 12);

    expect(line).toBeUndefined();
  });

  it('should return undefined (and not throw) on a malformed StnData response', async () => {
    setupHappyPath({ malformed: true });
    const service = new AcisService();

    const line = await getRecordsLine(service, 47.6062, -122.3321, 8, 12);

    expect(line).toBeUndefined();
  });

  it('should return undefined (and not throw) on a network error', async () => {
    mockPost.mockImplementation(() => Promise.reject(new Error('network down')));
    const service = new AcisService();

    const line = await getRecordsLine(service, 47.6062, -122.3321, 8, 12);

    expect(line).toBeUndefined();
  });

  it('should serve a second identical call from cache (one ACIS round trip)', async () => {
    setupHappyPath();
    const service = new AcisService();

    await getRecordsLine(service, 47.6062, -122.3321, 8, 12);
    const callsAfterFirst = mockPost.mock.calls.length;
    const second = await getRecordsLine(service, 47.6062, -122.3321, 8, 12);

    expect(second).toBeDefined();
    expect(mockPost.mock.calls.length).toBe(callsAfterFirst);
  });
});
