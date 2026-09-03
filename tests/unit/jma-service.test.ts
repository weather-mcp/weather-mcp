import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the axios instance used by JmaService, in the national-cap-service.test.ts
// style: a hoisted `mockGet` behind `default.create`. JmaService (unlike
// NationalCapService) installs no response interceptor, so the double is a
// bare `{ get }` — anything richer would be mocking a seam the code never
// calls (G70).
const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn()
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: (...args: unknown[]) => mockGet(...args)
    }))
  }
}));

import { JmaService, JMA_INDEX_URL, JMA_INDEX_STALE_AFTER_MS } from '../../src/services/jma.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';

const INDEX_FRESHNESS_MS = CacheConfig.ttl.alerts;
const DATA_HOST = 'www.data.jma.go.jp';

// ---------------------------------------------------------------------------
// Inline XML builders — no fixture files (see plan T6).
// ---------------------------------------------------------------------------

function docUrl(officeCode: string, opts: { host?: string; infoType?: string; ts?: string; seq?: string } = {}): string {
  const { host = DATA_HOST, infoType = 'VPWW53', ts = '20260903042854', seq = '0' } = opts;
  return `https://${host}/developer/xml/data/${ts}_${seq}_${infoType}_${officeCode}.xml`;
}

function atomEntry(opts: { href: string; updated: string }): string {
  return `<entry><title>気象特別警報・警報・注意報</title><id>${opts.href}</id><updated>${opts.updated}</updated><link type="application/xml" href="${opts.href}"/></entry>`;
}

function atomFeed(entries: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>長期（随時）</title><updated>2026-09-03T13:29:22+09:00</updated>${entries.join('')}</feed>`;
}

function kindXml(opts: { name: string; code?: string; status?: string }): string {
  return `<Kind><Name>${opts.name}</Name>${opts.code ? `<Code>${opts.code}</Code>` : ''}${
    opts.status ? `<Status>${opts.status}</Status>` : ''
  }</Kind>`;
}

function warningDoc(opts: {
  officeName?: string;
  areaName?: string;
  areaCode?: string;
  kinds?: string[];
}): string {
  const { officeName = 'Test Office', areaName = 'テストエリア', areaCode = '999999', kinds = [kindXml({ name: '大雨注意報', code: '10', status: '継続' })] } =
    opts;
  return `<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象特別警報・警報・注意報</Title><PublishingOffice>${officeName}</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>Test</Title><ReportDateTime>2026-09-03T13:28:00+09:00</ReportDateTime><InfoType>発表</InfoType></Head>
<Body><Warning type="気象警報・注意報（一次細分区域等）"><Item>${kinds.join('')}<Area><Name>${areaName}</Name><Code>${areaCode}</Code></Area></Item></Warning></Body>
</Report>`;
}

function xmlResponse(data: string, opts: { status?: number; etag?: string } = {}) {
  const { status = 200, etag } = opts;
  return Promise.resolve({
    data,
    status,
    headers: etag ? { etag } : {}
  });
}

type MockCall = [string, ({ headers?: Record<string, string> } | undefined)?];

function mockCalls(): MockCall[] {
  return mockGet.mock.calls as unknown as MockCall[];
}

function callsTo(url: string): MockCall[] {
  return mockCalls().filter(c => c[0] === url);
}

describe('JmaService', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockGet.mockReset();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeService(getNow: () => number): JmaService {
    return new JmaService({ now: getNow });
  }

  // ------------------------------------------------------------------
  // 15 + G13: newest-wins per office over an interleaved, newest-first index
  // ------------------------------------------------------------------
  it('resolves the requested office from an interleaved multi-office index, picking the first (newest) match and fetching its document', async () => {
    const hrefFiller1 = docUrl('999000');
    const hrefWanted = docUrl('180000', { ts: '20260903043000' }); // should be selected — appears first for 180000
    const hrefFiller2 = docUrl('010000');
    const hrefStale180000 = docUrl('180000', { ts: '20260902000000' }); // older duplicate for the same office — must NOT be selected

    const indexXml = atomFeed([
      atomEntry({ href: hrefFiller1, updated: '2026-09-03T05:00:00Z' }),
      atomEntry({ href: hrefWanted, updated: '2026-09-03T04:30:00Z' }),
      atomEntry({ href: hrefFiller2, updated: '2026-09-03T04:00:00Z' }),
      atomEntry({ href: hrefStale180000, updated: '2026-09-02T00:00:00Z' })
    ]);

    const wantedDoc = warningDoc({
      areaName: '嶺北',
      areaCode: '180010',
      kinds: [kindXml({ name: '大雨注意報', status: '継続' }), kindXml({ name: '雷注意報', status: '発表' })]
    });

    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return xmlResponse(indexXml);
      if (url === hrefWanted) return xmlResponse(wantedDoc);
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const service = makeService(() => Date.parse('2026-09-03T05:00:00Z'));
    const result = await service.getWarnings('180000');

    expect(result.documentUrl).toBe(hrefWanted);
    expect(result.document?.areas).toEqual([
      {
        code: '180010',
        name: '嶺北',
        kinds: [
          { name: '大雨注意報', status: '継続' },
          { name: '雷注意報', status: '発表' }
        ]
      }
    ]);
    expect(result.newestEntryUpdated).toBe('2026-09-03T05:00:00Z');
    expect(result.indexTrimmed).toBe(false);
    expect(result.indexUnparsedEntries).toBe(0);
    expect(callsTo(hrefStale180000)).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // 16 / 16b: freshness window and 304 revalidation
  // ------------------------------------------------------------------
  it('serves a cached parse via 304 without re-parsing or re-fetching the document, replaying the served ETag', async () => {
    let now = Date.parse('2026-09-03T04:30:00Z');
    const href = docUrl('180000');
    const indexXml = atomFeed([atomEntry({ href, updated: '2026-09-03T04:28:53Z' })]);
    const doc = warningDoc({});

    mockGet.mockImplementation((url: string, config?: { headers?: Record<string, string> }) => {
      if (url === JMA_INDEX_URL) {
        // A second index request within this test must carry the ETag from
        // the first response — proves the mock is live, not just present.
        if (config?.headers?.['If-None-Match'] === 'W/"first-etag"') {
          return xmlResponse('', { status: 304 });
        }
        return xmlResponse(indexXml, { etag: 'W/"first-etag"' });
      }
      if (url === href) return xmlResponse(doc);
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const service = makeService(() => now);
    const first = await service.getWarnings('180000');
    expect(mockGet).toHaveBeenCalledTimes(2); // index (200) + document

    // Still inside the freshness window: zero new requests (16b).
    now += 60_000;
    const second = await service.getWarnings('180000');
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(second).toEqual(first);

    // Past the freshness window: exactly one new request (the 304), no document re-fetch.
    now += INDEX_FRESHNESS_MS;
    const before = mockGet.mock.calls.length;
    const third = await service.getWarnings('180000');
    expect(mockGet.mock.calls.length - before).toBe(1);
    const revalidationCall = mockCalls()[mockCalls().length - 1];
    expect(revalidationCall[0]).toBe(JMA_INDEX_URL);
    expect(revalidationCall[1]?.headers?.['If-None-Match']).toBe('W/"first-etag"');
    expect(third).toEqual(first);
  });

  // ------------------------------------------------------------------
  // 17: concurrency — single-flight on both the index and the document
  // ------------------------------------------------------------------
  it('makes exactly one index request and one document request for two concurrent calls', async () => {
    const href = docUrl('180000');
    const indexXml = atomFeed([atomEntry({ href, updated: '2026-09-03T04:28:53Z' })]);
    const doc = warningDoc({});

    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return xmlResponse(indexXml);
      if (url === href) return xmlResponse(doc);
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const service = makeService(() => Date.parse('2026-09-03T04:30:00Z'));
    const [a, b] = await Promise.all([service.getWarnings('180000'), service.getWarnings('180000')]);

    expect(callsTo(JMA_INDEX_URL)).toHaveLength(1);
    expect(callsTo(href)).toHaveLength(1);
    expect(a).toEqual(b);
  });

  // ------------------------------------------------------------------
  // 18: allowlist refusal before any document fetch
  // ------------------------------------------------------------------
  it('refuses a document URL off the allowlist before any fetch, and logs a securityEvent', async () => {
    const badHref = docUrl('180000', { host: 'evil.example.com' });
    const indexXml = atomFeed([atomEntry({ href: badHref, updated: '2026-09-03T04:28:53Z' })]);

    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return xmlResponse(indexXml);
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const service = makeService(() => Date.parse('2026-09-03T04:30:00Z'));
    await expect(service.getWarnings('180000')).rejects.toThrow(
      'JMA warning document URL is not permitted'
    );

    expect(mockGet).toHaveBeenCalledTimes(1); // index only — the bad URL was never requested
    expect(callsTo(badHref)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      'Refused a JMA document URL outside the allowlist',
      expect.objectContaining({ service: 'JMA', securityEvent: true })
    );
  });

  // ------------------------------------------------------------------
  // 19: positive controls on the index
  // ------------------------------------------------------------------
  it('throws when the index parses cleanly but carries zero VPWW53 entries', async () => {
    const href = docUrl('180000', { infoType: 'VPWW54' });
    const indexXml = atomFeed([atomEntry({ href, updated: '2026-09-03T04:28:53Z' })]);

    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return xmlResponse(indexXml);
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const service = makeService(() => Date.parse('2026-09-03T04:30:00Z'));
    await expect(service.getWarnings('180000')).rejects.toThrow(
      'JMA alert index carries no warning bulletins'
    );
    expect(mockGet).toHaveBeenCalledTimes(1); // never reaches document fetch
  });

  it('throws when every entry filename is unreadable, and logs the fault', async () => {
    const indexXml = atomFeed([
      atomEntry({ href: `https://${DATA_HOST}/developer/xml/data/not-a-jma-filename-1.xml`, updated: '2026-09-03T04:28:00Z' }),
      atomEntry({ href: `https://${DATA_HOST}/developer/xml/data/not-a-jma-filename-2.xml`, updated: '2026-09-03T04:27:00Z' })
    ]);

    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return xmlResponse(indexXml);
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const service = makeService(() => Date.parse('2026-09-03T04:30:00Z'));
    await expect(service.getWarnings('180000')).rejects.toThrow(
      'JMA alert index is not in the expected format'
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'JMA index filenames are all unreadable',
      expect.objectContaining({ service: 'JMA', totalEntries: 2, securityEvent: true })
    );
  });

  // ------------------------------------------------------------------
  // 20: office absent from the index — a disclosure, not an all-clear
  // ------------------------------------------------------------------
  it('returns document: undefined for an office absent from the index (disclosure, never a fabricated all-clear)', async () => {
    const href = docUrl('180000');
    const indexXml = atomFeed([atomEntry({ href, updated: '2026-09-03T04:28:53Z' })]);

    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return xmlResponse(indexXml);
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const service = makeService(() => Date.parse('2026-09-03T04:30:00Z'));
    const result = await service.getWarnings('999999');

    expect(result.document).toBeUndefined();
    expect(result.documentUrl).toBeUndefined();
    expect(result.officeCode).toBe('999999');
    expect(callsTo(href)).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // 21: indexStale driven by the injected clock
  // ------------------------------------------------------------------
  it('reports indexStale=true when the newest VPWW53 entry is older than JMA_INDEX_STALE_AFTER_MS', async () => {
    const href = docUrl('180000');
    const updated = '2026-09-03T00:00:00Z';
    const indexXml = atomFeed([atomEntry({ href, updated })]);
    const doc = warningDoc({});

    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return xmlResponse(indexXml);
      if (url === href) return xmlResponse(doc);
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const staleService = makeService(() => Date.parse(updated) + JMA_INDEX_STALE_AFTER_MS + 1);
    const stale = await staleService.getWarnings('180000');
    expect(stale.indexStale).toBe(true);
  });

  it('reports indexStale=false when the newest VPWW53 entry is within JMA_INDEX_STALE_AFTER_MS', async () => {
    const href = docUrl('180000');
    const updated = '2026-09-03T00:00:00Z';
    const indexXml = atomFeed([atomEntry({ href, updated })]);
    const doc = warningDoc({});

    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return xmlResponse(indexXml);
      if (url === href) return xmlResponse(doc);
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const freshService = makeService(() => Date.parse(updated) + JMA_INDEX_STALE_AFTER_MS - 1000);
    const fresh = await freshService.getWarnings('180000');
    expect(fresh.indexStale).toBe(false);
  });

  // ------------------------------------------------------------------
  // 22: failure propagation, no leaked URL, no raw error object logged
  // ------------------------------------------------------------------
  it('propagates a 500 as a fixed message with no URL, and never logs the raw error object', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return Promise.reject({ response: { status: 500 } });
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const service = makeService(() => Date.parse('2026-09-03T04:30:00Z'));
    await expect(service.getWarnings('180000')).rejects.toThrow(
      'JMA alert index server error (status 500)'
    );
    assertNoLeak();
  });

  it('propagates a timeout as a fixed message with no URL', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return Promise.reject({ code: 'ECONNABORTED' });
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const service = makeService(() => Date.parse('2026-09-03T04:30:00Z'));
    await expect(service.getWarnings('180000')).rejects.toThrow('JMA alert index request timed out');
    assertNoLeak();
  });

  it('propagates a rate limit (429) as a fixed message with no URL', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return Promise.reject({ response: { status: 429 } });
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const service = makeService(() => Date.parse('2026-09-03T04:30:00Z'));
    await expect(service.getWarnings('180000')).rejects.toThrow(
      'JMA alert index rate limit exceeded'
    );
    assertNoLeak();
  });

  function assertNoLeak(): void {
    for (const call of errorSpy.mock.calls) {
      const message = String(call[0] ?? '');
      expect(message.toLowerCase()).not.toContain('http');
      expect(message.toLowerCase()).not.toContain('jma.go.jp');
      // The Error slot is always left undefined — the raw axios error (which
      // carries the request URL and response body) must never reach the logger.
      expect(call[1]).toBeUndefined();
    }
    expect(errorSpy).toHaveBeenCalled();
  }

  // ------------------------------------------------------------------
  // 23: a second office served from the already-cached index
  // ------------------------------------------------------------------
  it('serves a second office from the cached index without a second index request', async () => {
    const hrefA = docUrl('180000');
    const hrefB = docUrl('140000');
    const indexXml = atomFeed([
      atomEntry({ href: hrefA, updated: '2026-09-03T04:28:53Z' }),
      atomEntry({ href: hrefB, updated: '2026-09-03T04:20:00Z' })
    ]);
    const doc = warningDoc({});

    mockGet.mockImplementation((url: string) => {
      if (url === JMA_INDEX_URL) return xmlResponse(indexXml);
      if (url === hrefA || url === hrefB) return xmlResponse(doc);
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });

    const now = Date.parse('2026-09-03T04:30:00Z');
    const service = makeService(() => now);
    await service.getWarnings('180000');
    await service.getWarnings('140000');

    expect(callsTo(JMA_INDEX_URL)).toHaveLength(1);
    expect(callsTo(hrefA)).toHaveLength(1);
    expect(callsTo(hrefB)).toHaveLength(1);
  });
});
