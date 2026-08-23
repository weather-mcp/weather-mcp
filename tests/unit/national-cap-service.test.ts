import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the axios instance used by NationalCapService, in the meteoalarm.test.ts
// style: a hoisted `mockGet`, with the mocked module exposing only
// `default.create` (no `axios.isAxiosError` — the service uses a structural
// guard precisely because a real test double can't provide that helper).
const { mockGet, mockUse } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUse: vi.fn()
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => {
      let errorInterceptor: ((error: unknown) => Promise<never>) | undefined;
      return {
        get: (...args: unknown[]) =>
          mockGet(...args).catch((error: unknown) => {
            if (errorInterceptor) {
              return errorInterceptor(error);
            }
            throw error;
          }),
        interceptors: {
          response: {
            use: (onFulfilled: unknown, onRejected: (error: unknown) => Promise<never>) => {
              errorInterceptor = onRejected;
              mockUse(onFulfilled, onRejected);
            }
          }
        }
      };
    })
  }
}));

import axios from 'axios';
import { NationalCapService, NATIONAL_CAP_FEEDS, isNationalCapCountry } from '../../src/services/nationalCap.js';
import { MAX_DOCUMENT_BYTES, MAX_RINGS_PER_WARNING } from '../../src/utils/capParse.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger } from '../../src/utils/logger.js';
import type { NationalCapFeed } from '../../src/types/cap.js';

/**
 * A local copy of the real feed map's hosts and path prefixes (not the live
 * `indexUrl`s themselves need differ — they don't — but keeping a private
 * copy means these tests never depend on, or could mutate, the shared
 * `NATIONAL_CAP_FEEDS` singleton export). Same hosts, same prefixes as
 * production, so `isAllowedFeedUrl` is genuinely exercised, not bypassed.
 * `cap-parse.test.ts` doesn't export its fixtures, so every fixture below is
 * declared locally rather than imported.
 */
const TEST_FEEDS: Record<string, NationalCapFeed> = {
  in: {
    name: 'India',
    indexUrl: 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml',
    indexKind: 'rss',
    polygonSource: 'linked-parameter',
    preferLanguage: 'en',
    publisher: 'NDMA SACHET',
    attribution:
      'NDMA SACHET (National Disaster Management Authority, Government of India) — public domain',
    allowedHosts: ['sachet.ndma.gov.in'],
    allowedPathPrefixes: ['/cap_public_website/']
  },
  ph: {
    name: 'Philippines',
    indexUrl: 'https://publicalert.pagasa.dost.gov.ph/feeds/',
    indexKind: 'atom',
    polygonSource: 'inline',
    preferLanguage: 'en',
    publisher: 'PAGASA-DOST',
    attribution: 'PAGASA-DOST, via its public CAP feed (CC BY 4.0)',
    allowedHosts: ['publicalert.pagasa.dost.gov.ph'],
    allowedPathPrefixes: ['/output/', '/feeds/']
  },
  id: {
    name: 'Indonesia',
    indexUrl: 'https://www.bmkg.go.id/alerts/nowcast/en',
    indexKind: 'rss',
    polygonSource: 'inline',
    preferLanguage: 'en',
    publisher: 'BMKG',
    attribution: 'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
    allowedHosts: ['www.bmkg.go.id'],
    allowedPathPrefixes: ['/alerts/'],
    requestsPerMinute: 60
  }
};

/** Far-future / long-past instants so fixtures never age out mid-run. */
const FUTURE = '2099-01-01T00:00:00+00:00';
const PAST = '2020-01-01T00:00:00+00:00';

const RING1 = '10,10 10,20 20,20 10,10';
const RING2 = '30,30 30,40 40,40 30,30';

function xmlResponse(data: string, status = 200) {
  return Promise.resolve({ data, status });
}

function rssIndex(
  items: Array<{ guid: string; link: string; pubDate?: string; author?: string }>
): string {
  const itemsXml = items
    .map(
      i =>
        `<item><guid isPermaLink="false">${i.guid}</guid><link>${i.link}</link>${
          i.pubDate ? `<pubDate>${i.pubDate}</pubDate>` : ''
        }${i.author ? `<author>${i.author}</author>` : ''}</item>`
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>${itemsXml}</channel></rss>`;
}

function atomIndex(
  entries: Array<{ id: string; href: string; updated?: string; author?: string }>
): string {
  const entriesXml = entries
    .map(
      e =>
        `<entry><id>${e.id}</id><updated>${e.updated ?? ''}</updated>${
          e.author ? `<author><name>${e.author}</name></author>` : ''
        }<link type="application/cap+xml" href="${e.href}"/></entry>`
    )
    .join('');
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>test-feed</id><updated>2026-01-01T00:00:00Z</updated>${entriesXml}</feed>`;
}

/** SACHET-shaped document (`cap:` prefix, `linked-parameter` polygon source). */
function sachetDoc(opts: {
  identifier: string;
  msgType?: string;
  status?: string;
  references?: string;
  expires?: string;
  headline?: string;
  description?: string;
  polygonUrl?: string;
}): string {
  return `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
<cap:identifier>${opts.identifier}</cap:identifier>
<cap:sender>Test-SDMA</cap:sender>
<cap:sent>2026-08-23T00:00:00+00:00</cap:sent>
<cap:status>${opts.status ?? 'Actual'}</cap:status>
<cap:msgType>${opts.msgType ?? 'Alert'}</cap:msgType>
<cap:scope>Public</cap:scope>
${opts.references ? `<cap:references>${opts.references}</cap:references>` : ''}
<cap:info>
<cap:language>en</cap:language>
<cap:event>Flood Warning</cap:event>
<cap:urgency>Expected</cap:urgency>
<cap:severity>Moderate</cap:severity>
<cap:certainty>Possible</cap:certainty>
<cap:expires>${opts.expires ?? FUTURE}</cap:expires>
<cap:headline>${opts.headline ?? 'Test headline'}</cap:headline>
${opts.description ? `<cap:description>${opts.description}</cap:description>` : ''}
${
  opts.polygonUrl
    ? `<cap:parameter><cap:valueName>Polygon URL</cap:valueName><cap:value>${opts.polygonUrl}</cap:value></cap:parameter>`
    : ''
}
<cap:area>
<cap:areaDesc>Test District</cap:areaDesc>
</cap:area>
</cap:info>
</cap:alert>`;
}

/** PAGASA-shaped document (default namespace, inline polygons). */
function pagasaDoc(opts: {
  identifier: string;
  msgType?: string;
  status?: string;
  responseType?: string;
  references?: string;
  expires?: string;
  headline?: string;
  polygons?: string[];
}): string {
  const polygons = opts.polygons ?? [RING1];
  return `<?xml version="1.0"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
<identifier>${opts.identifier}</identifier>
<sender>PAGASA-DOST</sender>
<sent>2026-08-23T00:00:00+08:00</sent>
<status>${opts.status ?? 'Actual'}</status>
<msgType>${opts.msgType ?? 'Alert'}</msgType>
<scope>Public</scope>
${opts.references ? `<references>${opts.references}</references>` : ''}
<info>
<category>Met</category>
<event>Flood Advisory</event>
${opts.responseType ? `<responseType>${opts.responseType}</responseType>` : ''}
<urgency>Expected</urgency>
<severity>Minor</severity>
<certainty>Possible</certainty>
<expires>${opts.expires ?? FUTURE}</expires>
<senderName>PAGASA-DOST</senderName>
<headline>${opts.headline ?? 'Test PAGASA headline'}</headline>
<area>
<areaDesc>Area A</areaDesc>
${polygons.map(r => `<polygon>${r}</polygon>`).join('')}
</area>
</info>
</alert>`;
}

/** BMKG-shaped document (default namespace, inline polygons). */
function bmkgDoc(opts: {
  identifier: string;
  msgType?: string;
  status?: string;
  expires?: string;
  headline?: string;
  polygons?: string[];
}): string {
  const polygons = opts.polygons ?? [RING1];
  return `<?xml version="1.0" ?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${opts.identifier}</identifier>
  <sender>cuaca.ekstrem@bmkg.go.id</sender>
  <sent>2026-08-23T00:00:00+07:00</sent>
  <status>${opts.status ?? 'Actual'}</status>
  <msgType>${opts.msgType ?? 'Alert'}</msgType>
  <scope>Public</scope>
  <info>
    <language>en</language>
    <event>Thunderstorm</event>
    <urgency>Immediate</urgency>
    <severity>Moderate</severity>
    <certainty>Observed</certainty>
    <expires>${opts.expires ?? FUTURE}</expires>
    <headline>${opts.headline ?? 'Test BMKG headline'}</headline>
    <area>
      <areaDesc>Test Area</areaDesc>
      ${polygons.map(r => `<polygon>${r}</polygon>`).join('')}
    </area>
  </info>
</alert>`;
}

/** A linked SACHET polygon document: `<alert><identifier/><polygon/>...</alert>`. */
function polygonDoc(rings: string[]): string {
  return `<alert><identifier>poly-doc</identifier>${rings
    .map(r => `<polygon>${r}</polygon>`)
    .join('')}</alert>`;
}

type MockCall = [string, ({ timeout?: number; signal?: AbortSignal } | undefined)?];

function mockCalls(): MockCall[] {
  return mockGet.mock.calls as unknown as MockCall[];
}

function calledUrls(): string[] {
  return mockCalls().map(c => c[0]);
}

describe('NationalCapService', () => {
  let currentTime: Date;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));
    currentTime = new Date('2026-08-23T00:00:00Z');
    mockGet.mockReset();
    mockUse.mockClear();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeService(): NationalCapService {
    return new NationalCapService({
      feeds: TEST_FEEDS,
      now: () => currentTime,
      backoffJitter: () => 0.5
    });
  }

  // ------------------------------------------------------------------
  // Feed map
  // ------------------------------------------------------------------
  describe('feed map', () => {
    it('has exactly three entries, routed by isNationalCapCountry', () => {
      expect(Object.keys(NATIONAL_CAP_FEEDS).sort()).toEqual(['id', 'in', 'ph']);
      expect(isNationalCapCountry('in')).toBe(true);
      expect(isNationalCapCountry('ph')).toBe(true);
      expect(isNationalCapCountry('id')).toBe(true);
      expect(isNationalCapCountry('au')).toBe(false);
    });

    it('carries the exact attribution strings', () => {
      expect(NATIONAL_CAP_FEEDS.in.attribution).toBe(
        'NDMA SACHET (National Disaster Management Authority, Government of India) — public domain'
      );
      expect(NATIONAL_CAP_FEEDS.ph.attribution).toBe(
        'PAGASA-DOST, via its public CAP feed (CC BY 4.0)'
      );
      expect(NATIONAL_CAP_FEEDS.id.attribution).toBe(
        'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)'
      );
    });

    it('every feed declares a non-empty host and path allowlist', () => {
      for (const feed of Object.values(NATIONAL_CAP_FEEDS)) {
        expect(feed.allowedHosts.length).toBeGreaterThan(0);
        expect(feed.allowedPathPrefixes.length).toBeGreaterThan(0);
      }
    });
  });

  // ------------------------------------------------------------------
  // SACHET happy path
  // ------------------------------------------------------------------
  describe('SACHET happy path', () => {
    it('fetches the polygon only for the surviving document, applies rings, and handles Update+references and the cap: prefix', async () => {
      const activeDocUrl = 'https://sachet.ndma.gov.in/cap_public_website/active';
      const activePolyUrl = 'https://sachet.ndma.gov.in/cap_public_website/active-poly';
      const expiredDocUrl = 'https://sachet.ndma.gov.in/cap_public_website/expired';
      const expiredPolyUrl = 'https://sachet.ndma.gov.in/cap_public_website/expired-poly';

      const indexXml = rssIndex([
        { guid: 'active-guid', link: activeDocUrl, pubDate: 'Sun, 23 Aug 2026 00:00:00 GMT' },
        { guid: 'expired-guid', link: expiredDocUrl, pubDate: 'Sun, 23 Aug 2026 00:00:00 GMT' }
      ]);

      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === activeDocUrl) {
          return xmlResponse(
            sachetDoc({
              identifier: 'ACTIVE-1',
              msgType: 'Update',
              references: 'sender,ORIGINAL-0,2026-08-22T00:00:00+00:00',
              expires: FUTURE,
              headline: 'Active warning',
              polygonUrl: activePolyUrl
            })
          );
        }
        if (url === expiredDocUrl) {
          return xmlResponse(
            sachetDoc({ identifier: 'EXPIRED-1', expires: PAST, headline: 'Expired warning', polygonUrl: expiredPolyUrl })
          );
        }
        if (url === activePolyUrl) return xmlResponse(polygonDoc([RING1]));
        return Promise.reject(new Error(`polygon fetched for a document outside the view: ${url}`));
      });

      const service = makeService();
      const result = await service.getWarnings('in');

      expect(result.warnings.map(w => w.identifier)).toEqual(['ACTIVE-1']);
      expect(result.warnings[0].references).toEqual(['ORIGINAL-0']);
      expect(result.warnings[0].polygons).toEqual([
        [
          [10, 10],
          [10, 20],
          [20, 20],
          [10, 10]
        ]
      ]);

      const requested = calledUrls();
      expect(requested).toContain(activeDocUrl);
      expect(requested).toContain(expiredDocUrl);
      expect(requested).toContain(activePolyUrl);
      expect(requested).not.toContain(expiredPolyUrl);
    });
  });

  // ------------------------------------------------------------------
  // Stamp keying
  // ------------------------------------------------------------------
  describe('stamp keying (identifier + published pair)', () => {
    it('refetches and replaces the cached document on a newer pubDate for the same guid; a same-stamp re-serve is a cache hit', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/thread';
      let docCallCount = 0;
      let stamp = 'Sun, 23 Aug 2026 00:00:00 GMT';

      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) {
          return xmlResponse(rssIndex([{ guid: 'THREAD-1', link: docUrl, pubDate: stamp }]));
        }
        if (url === docUrl) {
          docCallCount++;
          return xmlResponse(sachetDoc({ identifier: 'THREAD-DOC', headline: `Version ${docCallCount}` }));
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();

      const first = await service.getWarnings('in');
      expect(first.warnings[0].headline).toBe('Version 1');
      expect(docCallCount).toBe(1);

      // Past ttl.alerts: the list refreshes, but the stamp hasn't changed —
      // the document cache must be hit, not refetched.
      vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
      const second = await service.getWarnings('in');
      expect(second.warnings[0].headline).toBe('Version 1');
      expect(docCallCount).toBe(1);

      // Same guid, newer stamp: the thread was extended — must refetch and replace.
      stamp = 'Sun, 23 Aug 2026 00:10:00 GMT';
      vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
      const third = await service.getWarnings('in');
      expect(third.warnings[0].headline).toBe('Version 2');
      expect(docCallCount).toBe(2);
    });
  });

  // ------------------------------------------------------------------
  // Key injectivity
  // ------------------------------------------------------------------
  describe('key injectivity: the (identifier, stamp) pair cannot collide across an unescaped colon join', () => {
    it('produces distinct document and polygon fetches/cache entries for entries whose id/stamp halves would alias if naively joined', async () => {
      const doc1Url = 'https://sachet.ndma.gov.in/cap_public_website/doc-a';
      const poly1Url = 'https://sachet.ndma.gov.in/cap_public_website/poly-a';
      const doc2Url = 'https://sachet.ndma.gov.in/cap_public_website/doc-b';
      const poly2Url = 'https://sachet.ndma.gov.in/cap_public_website/poly-b';

      const indexXml = rssIndex([
        { guid: 'thread:2026-08-23T00', link: doc1Url, pubDate: '00:00Z' },
        { guid: 'thread', link: doc2Url, pubDate: '2026-08-23T00:00:00Z' }
      ]);

      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === doc1Url) return xmlResponse(sachetDoc({ identifier: 'DOC-A', headline: 'A', polygonUrl: poly1Url }));
        if (url === doc2Url) return xmlResponse(sachetDoc({ identifier: 'DOC-B', headline: 'B', polygonUrl: poly2Url }));
        if (url === poly1Url) return xmlResponse(polygonDoc([RING1]));
        if (url === poly2Url) return xmlResponse(polygonDoc([RING2]));
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();
      const result = await service.getWarnings('in');

      expect(result.warnings).toHaveLength(2);
      const requested = calledUrls();
      expect(requested).toContain(doc1Url);
      expect(requested).toContain(doc2Url);
      expect(requested).toContain(poly1Url);
      expect(requested).toContain(poly2Url);

      // 1 list + 2 document + 2 polygon cache entries: a colon-joined key
      // would collapse the two pairs and leave only 3.
      expect(service.getCacheStats().size).toBe(5);
    });
  });

  // ------------------------------------------------------------------
  // Unfiltered cache / read view
  // ------------------------------------------------------------------
  describe('unfiltered cache, read-time filter', () => {
    it('an Update that expires before its Original resurfaces the Original once the Update expires, with no refetch', async () => {
      const oDocUrl = 'https://sachet.ndma.gov.in/cap_public_website/orig';
      const uDocUrl = 'https://sachet.ndma.gov.in/cap_public_website/update';
      const uExpiry = '2026-08-23T00:10:00+00:00';

      const indexXml = rssIndex([
        { guid: 'O', link: oDocUrl },
        { guid: 'U', link: uDocUrl }
      ]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === oDocUrl) return xmlResponse(sachetDoc({ identifier: 'ORIGINAL', expires: FUTURE, headline: 'Original' }));
        if (url === uDocUrl) {
          return xmlResponse(
            sachetDoc({
              identifier: 'UPDATE',
              msgType: 'Update',
              references: 'sender,ORIGINAL,2026-08-23T00:00:00+00:00',
              expires: uExpiry,
              headline: 'Updated'
            })
          );
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();

      const first = await service.getWarnings('in');
      expect(first.warnings.map(w => w.identifier)).toEqual(['UPDATE']);

      currentTime = new Date('2026-08-23T00:15:00Z'); // past the Update's expiry
      const second = await service.getWarnings('in'); // system clock unmoved — still a cache hit
      expect(second.warnings.map(w => w.identifier)).toEqual(['ORIGINAL']);

      expect(mockGet).toHaveBeenCalledTimes(3); // index + 2 docs, no refetch
    });

    it('re-filters a cached list at a later now, dropping a warning that has since expired, without a refetch', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/soon';
      const soonExpiry = '2026-08-23T00:05:00+00:00';
      const indexXml = rssIndex([{ guid: 'soon', link: docUrl }]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) return xmlResponse(sachetDoc({ identifier: 'SOON-1', expires: soonExpiry }));
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();
      const first = await service.getWarnings('in');
      expect(first.warnings).toHaveLength(1);

      currentTime = new Date('2026-08-23T00:10:00Z'); // past soonExpiry
      const second = await service.getWarnings('in');
      expect(second.warnings).toEqual([]);

      expect(calledUrls().filter(u => u === docUrl)).toHaveLength(1); // no refetch
    });

    it('caches an expired document too — a later index refresh (past ttl.alerts) with the same stamp does not refetch it', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/old';
      let docCalls = 0;
      const indexXml = rssIndex([{ guid: 'OLD-GUID', link: docUrl, pubDate: 'Sun, 23 Aug 2026 00:00:00 GMT' }]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) {
          docCalls++;
          return xmlResponse(sachetDoc({ identifier: 'OLD-1', expires: PAST }));
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();
      const first = await service.getWarnings('in');
      expect(first.warnings).toEqual([]); // expired — filtered from the view
      expect(docCalls).toBe(1);

      vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000)); // past ttl.alerts
      const indexCallsBefore = calledUrls().filter(u => u === TEST_FEEDS.in.indexUrl).length;
      const second = await service.getWarnings('in');
      expect(second.warnings).toEqual([]);
      const indexCallsAfter = calledUrls().filter(u => u === TEST_FEEDS.in.indexUrl).length;

      expect(indexCallsAfter).toBe(indexCallsBefore + 1); // index refetched
      expect(docCalls).toBe(1); // document cache hit
    });

    it('a polygon that fails on refresh 1 and succeeds on refresh 2 does not retroactively mutate refresh 1\'s already-returned result', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/doc-x';
      const polyUrl = 'https://sachet.ndma.gov.in/cap_public_website/poly-x';
      const indexXml = rssIndex([{ guid: 'X-GUID', link: docUrl, pubDate: 'Sun, 23 Aug 2026 00:00:00 GMT' }]);
      let polyAttempt = 0;
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) return xmlResponse(sachetDoc({ identifier: 'X-1', expires: FUTURE, polygonUrl: polyUrl }));
        if (url === polyUrl) {
          polyAttempt++;
          if (polyAttempt === 1) return Promise.reject({ response: { status: 404 } });
          return xmlResponse(polygonDoc([RING1]));
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();
      const first = await service.getWarnings('in');
      expect(first.warnings[0].polygonUnavailable).toBe(true);
      expect(first.warnings[0].polygons).toEqual([]);
      expect(first.polygonUnavailableCount).toBe(1);

      vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000)); // past ttl.alerts — refresh 2
      const second = await service.getWarnings('in');
      expect(second.warnings[0].polygons).toEqual([
        [
          [10, 10],
          [10, 20],
          [20, 20],
          [10, 10]
        ]
      ]);
      expect(second.polygonUnavailableCount).toBe(0);

      // `first` must be an untouched snapshot — proves per-refresh freshCopy().
      expect(first.warnings[0].polygonUnavailable).toBe(true);
      expect(first.warnings[0].polygons).toEqual([]);
      expect(first.polygonUnavailableCount).toBe(1);
    });

    it('derives polygonUnavailableCount from the current view — it drops to 0 once that warning expires (no refetch)', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/pu-doc';
      const polyUrl = 'https://sachet.ndma.gov.in/cap_public_website/pu-poly';
      const nearExpiry = '2026-08-23T00:10:00+00:00';
      const indexXml = rssIndex([{ guid: 'PU-GUID', link: docUrl }]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) return xmlResponse(sachetDoc({ identifier: 'PU-1', expires: nearExpiry, polygonUrl: polyUrl }));
        if (url === polyUrl) return Promise.reject({ response: { status: 404 } });
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();
      const first = await service.getWarnings('in');
      expect(first.polygonUnavailableCount).toBe(1);

      currentTime = new Date('2026-08-23T00:15:00Z'); // past nearExpiry
      const second = await service.getWarnings('in'); // system clock unmoved — cache hit
      expect(second.warnings).toEqual([]);
      expect(second.polygonUnavailableCount).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // CACHE_ENABLED=false
  // ------------------------------------------------------------------
  describe('CACHE_ENABLED=false', () => {
    it('refreshes on every sequential call, while concurrent calls still dedupe via the in-flight map', async () => {
      const originalEnabled = CacheConfig.enabled;
      (CacheConfig as unknown as { enabled: boolean }).enabled = false;
      try {
        const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/nc';
        const indexXml = rssIndex([{ guid: 'NC-GUID', link: docUrl }]);
        let indexCalls = 0;
        let docCalls = 0;
        mockGet.mockImplementation((url: string) => {
          if (url === TEST_FEEDS.in.indexUrl) {
            indexCalls++;
            return xmlResponse(indexXml);
          }
          if (url === docUrl) {
            docCalls++;
            return xmlResponse(sachetDoc({ identifier: 'NC-1' }));
          }
          return Promise.reject(new Error(`unexpected url: ${url}`));
        });

        const service = makeService();

        const [a, b] = await Promise.all([service.getWarnings('in'), service.getWarnings('in')]);
        expect(a.warnings).toHaveLength(1);
        expect(b.warnings).toHaveLength(1);
        expect(indexCalls).toBe(1); // concurrent calls still dedupe
        expect(docCalls).toBe(1);

        await service.getWarnings('in'); // sequential — cache disabled, must refresh
        expect(indexCalls).toBe(2);
        expect(docCalls).toBe(2);
      } finally {
        (CacheConfig as unknown as { enabled: boolean }).enabled = originalEnabled;
      }
    });
  });

  // ------------------------------------------------------------------
  // PAGASA
  // ------------------------------------------------------------------
  describe('PAGASA (Atom index, inline polygons)', () => {
    it('parses an Atom index via the cap+xml link and flattens inline rings from multiple areas', async () => {
      const docUrl = 'https://publicalert.pagasa.dost.gov.ph/output/gfa/one.cap';
      const atomXml = atomIndex([
        { id: 'urn:uuid:11111111-1111-1111-1111-111111111111', href: docUrl, updated: '2026-08-23T00:00:00+08:00' }
      ]);
      const docXml = `<?xml version="1.0"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
<identifier>PAGASA-MULTI-1</identifier>
<sender>PAGASA-DOST</sender>
<sent>2026-08-23T00:00:00+08:00</sent>
<status>Actual</status>
<msgType>Alert</msgType>
<scope>Public</scope>
<info>
<category>Met</category>
<event>Flood Advisory</event>
<urgency>Expected</urgency>
<severity>Minor</severity>
<certainty>Possible</certainty>
<expires>${FUTURE}</expires>
<senderName>PAGASA-DOST</senderName>
<headline>Multi-area advisory</headline>
<area>
<areaDesc>Area A</areaDesc>
<polygon>${RING1}</polygon>
</area>
<area>
<areaDesc>Area B</areaDesc>
<polygon>${RING2}</polygon>
</area>
</info>
</alert>`;
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.ph.indexUrl) return xmlResponse(atomXml);
        if (url === docUrl) return xmlResponse(docXml);
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();
      const result = await service.getWarnings('ph');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].areaDesc).toEqual(['Area A', 'Area B']);
      expect(result.warnings[0].polygons).toHaveLength(2);
    });

    it('retires the advisory a Final (Update + AllClear + references) points at, and the Final is itself absent from the view', async () => {
      const origUrl = 'https://publicalert.pagasa.dost.gov.ph/output/gfa/orig.cap';
      const finalUrl = 'https://publicalert.pagasa.dost.gov.ph/output/gfa/final.cap';
      const origBareId = 'b3b0a099-5e54-4687-a2a2-a94abb873247';
      const finalBareId = '8a8d3a9c-df82-4f85-be5c-9c007e90a557';

      const atomXml = atomIndex([
        { id: `urn:uuid:${origBareId}`, href: origUrl, updated: '2026-08-20T17:31:20+08:00' },
        { id: `urn:uuid:${finalBareId}`, href: finalUrl, updated: '2026-08-21T05:15:47+08:00' }
      ]);

      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.ph.indexUrl) return xmlResponse(atomXml);
        if (url === origUrl) return xmlResponse(pagasaDoc({ identifier: origBareId }));
        if (url === finalUrl) {
          return xmlResponse(
            pagasaDoc({
              identifier: finalBareId,
              msgType: 'Update',
              responseType: 'AllClear',
              references: `PAGASA-DOST,${origBareId},2026-08-20T17:31:20+08:00`
            })
          );
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();
      const result = await service.getWarnings('ph');

      // The urn:uuid: index id and the bare CAP identifier are deliberately
      // never compared for equality anywhere in this test — only that both
      // are handled (fetched, and matched correctly against `references`,
      // which points at the CAP identifier, not the index guid).
      expect(result.warnings).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // BMKG
  // ------------------------------------------------------------------
  describe('BMKG (RSS index, inline polygons, rate limiter)', () => {
    it('parses inline rings from an RSS index', async () => {
      const docUrl = 'https://www.bmkg.go.id/alerts/nowcast/doc/one.xml';
      const indexXml = rssIndex([{ guid: 'BMKG-1', link: docUrl }]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.id.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) return xmlResponse(bmkgDoc({ identifier: 'BMKG-DOC-1' }));
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const service = makeService();
      const promise = service.getWarnings('id');
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].polygons.length).toBeGreaterThan(0);
    });

    it('spaces every request start — index, document misses, and the retry — by at least 1000ms under requestsPerMinute: 60', async () => {
      const docAUrl = 'https://www.bmkg.go.id/alerts/nowcast/doc/a.xml';
      const docBUrl = 'https://www.bmkg.go.id/alerts/nowcast/doc/b.xml';
      const indexXml = rssIndex([
        { guid: 'BMKG-A', link: docAUrl },
        { guid: 'BMKG-B', link: docBUrl }
      ]);
      const timestamps: Array<{ url: string; t: number }> = [];
      let docBAttempts = 0;

      mockGet.mockImplementation((url: string) => {
        timestamps.push({ url, t: Date.now() });
        if (url === TEST_FEEDS.id.indexUrl) return xmlResponse(indexXml);
        if (url === docAUrl) return xmlResponse(bmkgDoc({ identifier: 'A' }));
        if (url === docBUrl) {
          docBAttempts++;
          if (docBAttempts === 1) return Promise.reject({ response: { status: 500 } });
          return xmlResponse(bmkgDoc({ identifier: 'B' }));
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();
      const promise = service.getWarnings('id');
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result.warnings).toHaveLength(2);
      expect(timestamps).toHaveLength(4); // index + docA + docB(2 attempts)
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i].t - timestamps[i - 1].t).toBeGreaterThanOrEqual(1000);
      }
    });
  });

  // ------------------------------------------------------------------
  // Allowlist
  // ------------------------------------------------------------------
  describe('allowlist enforcement', () => {
    it('never requests a document URL that violates the allowlist, counting and logging each without ever logging a URL', async () => {
      const badUrls = {
        downgrade: 'http://sachet.ndma.gov.in/cap_public_website/x',
        localhost: 'https://localhost/cap_public_website/x',
        linkLocal: 'https://169.254.169.254/cap_public_website/x',
        crossOrigin: 'https://evil.test/cap_public_website/x',
        wrongPrefix: 'https://sachet.ndma.gov.in/other/x'
      };
      const indexXml = rssIndex(
        Object.entries(badUrls).map(([key, url]) => ({ guid: `bad-${key}`, link: url }))
      );
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        return Promise.reject(new Error(`should never be requested: ${url}`));
      });

      const service = makeService();
      const result = await service.getWarnings('in');

      expect(result.warnings).toEqual([]);
      expect(result.unavailableCount).toBe(5);

      const requested = calledUrls();
      for (const url of Object.values(badUrls)) {
        expect(requested).not.toContain(url);
      }

      const notAllowedWarnings = (warnSpy.mock.calls as Array<[string, Record<string, unknown>?]>).filter(
        c => c[1]?.reason === 'url-not-allowed'
      );
      expect(notAllowedWarnings).toHaveLength(5);
      for (const call of notAllowedWarnings) {
        expect(call[1]).toMatchObject({ securityEvent: true });
        expect(JSON.stringify(call)).not.toMatch(/https?:\/\//);
      }
    });

    it('a SACHET Polygon URL off the allowlist is never requested; the warning still renders with polygonUnavailable', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/al-doc';
      const badPolyUrl = 'https://evil.test/poly';
      const indexXml = rssIndex([{ guid: 'AL-GUID', link: docUrl }]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) return xmlResponse(sachetDoc({ identifier: 'AL-1', polygonUrl: badPolyUrl }));
        return Promise.reject(new Error(`should never be requested: ${url}`));
      });

      const service = makeService();
      const result = await service.getWarnings('in');

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].polygons).toEqual([]);
      expect(result.warnings[0].polygonUnavailable).toBe(true);
      expect(result.polygonUnavailableCount).toBe(1);
      expect(calledUrls()).not.toContain(badPolyUrl);
    });
  });

  // ------------------------------------------------------------------
  // Transport bound
  // ------------------------------------------------------------------
  describe('transport bound', () => {
    it('creates the axios client with maxContentLength and maxRedirects: 0', () => {
      makeService();
      const createMock = axios.create as unknown as { mock: { calls: unknown[][] } };
      const config = createMock.mock.calls[createMock.mock.calls.length - 1][0] as Record<string, unknown>;
      expect(config.maxContentLength).toBe(MAX_DOCUMENT_BYTES);
      expect(config.maxRedirects).toBe(0);
      if ('maxBodyLength' in config) {
        expect(config.maxBodyLength).toBe(MAX_DOCUMENT_BYTES);
      }
    });

    it('maps an oversize-body rejection without a response property to the fixed too-large message', async () => {
      mockGet.mockImplementation(() =>
        Promise.reject({ code: 'ERR_BAD_RESPONSE', message: 'maxContentLength size of 2000000 exceeded' })
      );
      const service = makeService();
      await expect(service.getWarnings('in')).rejects.toThrow('NDMA SACHET alert feed response too large');
    });
  });

  // ------------------------------------------------------------------
  // Deadline
  // ------------------------------------------------------------------
  describe('deadline', () => {
    it('resolves after the deadline, counting every not-yet-settled document unavailable, with the abort signal triggered', async () => {
      const doc1Url = 'https://sachet.ndma.gov.in/cap_public_website/stuck-1';
      const doc2Url = 'https://sachet.ndma.gov.in/cap_public_website/stuck-2';
      const indexXml = rssIndex([
        { guid: 'stuck-1', link: doc1Url },
        { guid: 'stuck-2', link: doc2Url }
      ]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        return new Promise(() => {
          /* never resolves */
        });
      });

      const service = makeService();
      const promise = service.getWarnings('in');
      await vi.advanceTimersByTimeAsync(41000);
      const result = await promise;

      expect(result.warnings).toEqual([]);
      expect(result.unavailableCount).toBe(2);

      const docCalls = mockCalls().filter(c => c[0] !== TEST_FEEDS.in.indexUrl);
      expect(docCalls.length).toBe(2);
      for (const call of docCalls) {
        expect(call[1]?.signal?.aborted).toBe(true);
      }
    });

    it('a document that settles after the deadline does not change the already-cached list', async () => {
      const fastUrl = 'https://sachet.ndma.gov.in/cap_public_website/fast';
      const slowUrl = 'https://sachet.ndma.gov.in/cap_public_website/slow';
      const indexXml = rssIndex([
        { guid: 'fast-1', link: fastUrl },
        { guid: 'slow-1', link: slowUrl }
      ]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === fastUrl) return xmlResponse(sachetDoc({ identifier: 'FAST-DOC' }));
        if (url === slowUrl) {
          return new Promise(resolve => {
            setTimeout(() => resolve({ data: sachetDoc({ identifier: 'SLOW-DOC' }), status: 200 }), 45000);
          });
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();
      const firstPromise = service.getWarnings('in');
      await vi.advanceTimersByTimeAsync(46000);
      const first = await firstPromise;

      expect(first.warnings.map(w => w.identifier)).toEqual(['FAST-DOC']);
      expect(first.unavailableCount).toBe(1);

      const callsAfterFirst = mockGet.mock.calls.length;
      const second = await service.getWarnings('in'); // still within ttl.alerts — cache hit
      expect(second.warnings.map(w => w.identifier)).toEqual(['FAST-DOC']);
      expect(second.unavailableCount).toBe(1);
      expect(mockGet.mock.calls.length).toBe(callsAfterFirst); // no new fetch
    });

    it('a 3xx document response (maxRedirects: 0) counts unavailable', async () => {
      const okUrl = 'https://sachet.ndma.gov.in/cap_public_website/redir-ok';
      const redirectUrl = 'https://sachet.ndma.gov.in/cap_public_website/redir-bad';
      const indexXml = rssIndex([
        { guid: 'redir-ok', link: okUrl },
        { guid: 'redir-bad', link: redirectUrl }
      ]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === okUrl) return xmlResponse(sachetDoc({ identifier: 'OK-1' }));
        if (url === redirectUrl) return Promise.reject({ response: { status: 301 } });
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const service = makeService();
      const result = await service.getWarnings('in');
      expect(result.warnings.map(w => w.identifier)).toEqual(['OK-1']);
      expect(result.unavailableCount).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // Caches / dedupe
  // ------------------------------------------------------------------
  describe('caching and dedupe', () => {
    it('serves the second call within ttl.alerts from cache — one index fetch', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/simple';
      const indexXml = rssIndex([{ guid: 'S-1', link: docUrl }]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) return xmlResponse(sachetDoc({ identifier: 'S-DOC' }));
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const service = makeService();
      const first = await service.getWarnings('in');
      const second = await service.getWarnings('in');
      expect(first.warnings).toHaveLength(1);
      expect(second.warnings).toHaveLength(1);
      expect(calledUrls().filter(u => u === TEST_FEEDS.in.indexUrl)).toHaveLength(1);
    });

    it('two concurrent calls for the same country share one index fetch', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/concurrent';
      const indexXml = rssIndex([{ guid: 'C-1', link: docUrl }]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) return xmlResponse(sachetDoc({ identifier: 'C-DOC' }));
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const service = makeService();
      const [a, b] = await Promise.all([service.getWarnings('in'), service.getWarnings('in')]);
      expect(a.warnings).toHaveLength(1);
      expect(b.warnings).toHaveLength(1);
      expect(calledUrls().filter(u => u === TEST_FEEDS.in.indexUrl)).toHaveLength(1);
    });

    it('a rejected refresh leaves the in-flight map empty, so a later call retries', async () => {
      mockGet.mockImplementation(() => Promise.reject({ response: { status: 500 } }));
      const service = makeService();

      const firstPromise = service.getWarnings('in').catch(e => e as Error);
      await vi.advanceTimersByTimeAsync(10000);
      const err = await firstPromise;
      expect(err).toBeInstanceOf(Error);

      const callsAfterFirst = mockGet.mock.calls.length;
      expect(callsAfterFirst).toBe(4); // initial + 3 retries

      mockGet.mockImplementation(() => xmlResponse(rssIndex([])));
      const second = await service.getWarnings('in');
      expect(second.warnings).toEqual([]);
      expect(mockGet.mock.calls.length).toBe(callsAfterFirst + 1);
    });
  });

  // ------------------------------------------------------------------
  // Bounds / normalisation
  // ------------------------------------------------------------------
  describe('bounds and normalisation', () => {
    it('caps a 201-item index at 200, reports indexTrimmed, and logs a securityEvent warn', async () => {
      const items = Array.from({ length: 201 }, (_unused, i) => ({
        guid: `item-${i}`,
        link: `https://sachet.ndma.gov.in/cap_public_website/doc-${i}`
      }));
      const indexXml = rssIndex(items);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        return Promise.reject({ response: { status: 404 } });
      });

      const service = makeService();
      const result = await service.getWarnings('in');

      expect(result.indexTrimmed).toBe(true);
      expect(result.unavailableCount).toBe(200);

      const trimWarnings = (warnSpy.mock.calls as Array<[string, Record<string, unknown>?]>).filter(
        c => c[0] === 'National CAP index trimmed to the item cap'
      );
      expect(trimWarnings).toHaveLength(1);
      expect(trimWarnings[0][1]).toMatchObject({ securityEvent: true });
    });

    it('drops an entry missing an identifier or url, and dedupes a duplicate identifier (first wins)', async () => {
      const indexXml = `<rss><channel><title>x</title>
<item><link>https://sachet.ndma.gov.in/cap_public_website/no-id</link></item>
<item><guid>no-url</guid></item>
<item><guid>dup</guid><link>https://sachet.ndma.gov.in/cap_public_website/first</link></item>
<item><guid>dup</guid><link>https://sachet.ndma.gov.in/cap_public_website/second</link></item>
</channel></rss>`;
      mockGet.mockImplementation(() => xmlResponse(indexXml));
      const service = makeService();

      const { entries, dropped } = await service.getIndex('in');
      expect(dropped).toBe(2);
      expect(entries).toHaveLength(1);
      expect(entries[0].documentUrl).toContain('first');
    });
  });

  // ------------------------------------------------------------------
  // Failure posture
  // ------------------------------------------------------------------
  describe('failure posture', () => {
    it('index 500 after retries throws the fixed server-error string naming the publisher', async () => {
      mockGet.mockImplementation(() => Promise.reject({ response: { status: 500 } }));
      const service = makeService();
      const promise = service.getWarnings('in').catch(e => e as Error);
      await vi.advanceTimersByTimeAsync(10000);
      const err = await promise;
      expect(err.message).toBe('NDMA SACHET alert feed server error (status 500)');
    });

    it('index 200 with an HTML error page throws the unexpected-shape message', async () => {
      mockGet.mockImplementation(() => xmlResponse('<!DOCTYPE html><html><body>503</body></html>'));
      const service = makeService();
      await expect(service.getWarnings('in')).rejects.toThrow('Alert feed returned an unexpected shape');
    });

    it('an RSS body served to the Atom-configured ph feed throws unexpected shape', async () => {
      mockGet.mockImplementation(() =>
        xmlResponse(rssIndex([{ guid: 'x', link: 'https://publicalert.pagasa.dost.gov.ph/output/x' }]))
      );
      const service = makeService();
      await expect(service.getWarnings('ph')).rejects.toThrow('Alert feed index has an unexpected shape');
    });

    it('ECONNABORTED throws the fixed timeout string after retries', async () => {
      mockGet.mockImplementation(() => Promise.reject({ code: 'ECONNABORTED' }));
      const service = makeService();
      const promise = service.getWarnings('in').catch(e => e as Error);
      await vi.advanceTimersByTimeAsync(10000);
      const err = await promise;
      expect(err.message).toBe('NDMA SACHET alert feed request timed out');
    });

    it('one document 404 counts unavailable; the others still return', async () => {
      const okUrl = 'https://sachet.ndma.gov.in/cap_public_website/ok';
      const badUrl = 'https://sachet.ndma.gov.in/cap_public_website/bad';
      const indexXml = rssIndex([
        { guid: 'ok', link: okUrl },
        { guid: 'bad', link: badUrl }
      ]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === okUrl) return xmlResponse(sachetDoc({ identifier: 'OK-1' }));
        if (url === badUrl) return Promise.reject({ response: { status: 404 } });
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const service = makeService();
      const result = await service.getWarnings('in');
      expect(result.warnings.map(w => w.identifier)).toEqual(['OK-1']);
      expect(result.unavailableCount).toBe(1);
    });

    it('all documents failing resolves with warnings: [] and the count — never throws', async () => {
      const url1 = 'https://sachet.ndma.gov.in/cap_public_website/f1';
      const url2 = 'https://sachet.ndma.gov.in/cap_public_website/f2';
      const indexXml = rssIndex([
        { guid: 'f1', link: url1 },
        { guid: 'f2', link: url2 }
      ]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        return Promise.reject({ response: { status: 404 } });
      });
      const service = makeService();
      const result = await service.getWarnings('in');
      expect(result.warnings).toEqual([]);
      expect(result.unavailableCount).toBe(2);
    });

    it('a malformed (unparseable) linked polygon document keeps the warning, unavailableCount unchanged', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/mp-doc';
      const polyUrl = 'https://sachet.ndma.gov.in/cap_public_website/mp-poly';
      const indexXml = rssIndex([{ guid: 'mp', link: docUrl }]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) return xmlResponse(sachetDoc({ identifier: 'MP-1', polygonUrl: polyUrl }));
        if (url === polyUrl) return xmlResponse('<a><b></a>'); // not well-formed
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const service = makeService();
      const result = await service.getWarnings('in');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].polygons).toEqual([]);
      expect(result.warnings[0].polygonUnavailable).toBe(true);
      expect(result.polygonUnavailableCount).toBe(1);
      expect(result.unavailableCount).toBe(0);
    });

    it('an index that fails the shape check throws — never falls back to an empty list', async () => {
      mockGet.mockImplementation(() => xmlResponse('<rss><error>maintenance</error></rss>'));
      const service = makeService();
      await expect(service.getWarnings('in')).rejects.toThrow('Alert feed index has an unexpected shape');
    });

    it('a document shaped as <alert><status>Actual</status></alert> (no identifier/info) is unavailable and not cached', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/shapeless';
      let docCalls = 0;
      const indexXml = rssIndex([{ guid: 'shapeless', link: docUrl }]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) {
          docCalls++;
          return xmlResponse('<alert><status>Actual</status></alert>');
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const service = makeService();
      const first = await service.getWarnings('in');
      expect(first.warnings).toEqual([]);
      expect(first.unavailableCount).toBe(1);
      expect(docCalls).toBe(1);

      vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
      const second = await service.getWarnings('in');
      expect(second.warnings).toEqual([]);
      expect(second.unavailableCount).toBe(1);
      expect(docCalls).toBe(2); // re-requested — never cached as a success
    });

    it('a linked polygon document with no <polygon> element sets polygonUnavailable, not an error', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/np-doc';
      const polyUrl = 'https://sachet.ndma.gov.in/cap_public_website/np-poly';
      const indexXml = rssIndex([{ guid: 'np', link: docUrl }]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === docUrl) return xmlResponse(sachetDoc({ identifier: 'NP-1', polygonUrl: polyUrl }));
        if (url === polyUrl) return xmlResponse('<alert><identifier>x</identifier></alert>');
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const service = makeService();
      const result = await service.getWarnings('in');
      expect(result.warnings[0].polygonUnavailable).toBe(true);
      expect(result.polygonUnavailableCount).toBe(1);
    });

    it('257-ring geometry — inline (BMKG) and linked (SACHET) — both drop to polygons: [], polygonUnavailable: true, and the warning is still returned', async () => {
      const validRing = '0,0 0,1 1,1 0,0';
      const tooMany = Array(MAX_RINGS_PER_WARNING + 1).fill(validRing);

      // Inline: flattenCapAlert (a pure util) sets polygonUnavailable/
      // geometryTrimmed itself and cannot log — so the *service* reports the
      // trim, keeping the bounded-array convention (every cap that trims
      // emits a securityEvent) true on both geometry paths.
      warnSpy.mockClear();
      const bmkgDocUrl = 'https://www.bmkg.go.id/alerts/nowcast/doc/many.xml';
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.id.indexUrl) return xmlResponse(rssIndex([{ guid: 'many', link: bmkgDocUrl }]));
        if (url === bmkgDocUrl) return xmlResponse(bmkgDoc({ identifier: 'MANY-1', polygons: tooMany }));
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const bmkgService = makeService();
      const bmkgPromise = bmkgService.getWarnings('id');
      await vi.advanceTimersByTimeAsync(3000);
      const bmkgResult = await bmkgPromise;
      expect(bmkgResult.warnings).toHaveLength(1);
      expect(bmkgResult.warnings[0].polygons).toEqual([]);
      expect(bmkgResult.warnings[0].polygonUnavailable).toBe(true);
      expect(bmkgResult.warnings[0].geometryTrimmed).toBe(true);

      const inlineTrimWarn = (warnSpy.mock.calls as Array<[string, Record<string, unknown>?]>).filter(
        c => c[1]?.reason === 'rings-trimmed'
      );
      expect(inlineTrimWarn).toHaveLength(1);
      expect(inlineTrimWarn[0][1]).toMatchObject({ securityEvent: true, country: 'id' });

      // Linked: SACHET reports the same trim from applyRings.
      warnSpy.mockClear();
      const sachetDocUrl = 'https://sachet.ndma.gov.in/cap_public_website/many-doc';
      const sachetPolyUrl = 'https://sachet.ndma.gov.in/cap_public_website/many-poly';
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(rssIndex([{ guid: 'many-sachet', link: sachetDocUrl }]));
        if (url === sachetDocUrl) return xmlResponse(sachetDoc({ identifier: 'MANY-SACHET-1', polygonUrl: sachetPolyUrl }));
        if (url === sachetPolyUrl) return xmlResponse(polygonDoc(tooMany));
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const sachetService = makeService();
      const sachetResult = await sachetService.getWarnings('in');
      expect(sachetResult.warnings).toHaveLength(1);
      expect(sachetResult.warnings[0].polygons).toEqual([]);
      expect(sachetResult.warnings[0].polygonUnavailable).toBe(true);
      expect(sachetResult.warnings[0].geometryTrimmed).toBe(true);

      const trimWarn = (warnSpy.mock.calls as Array<[string, Record<string, unknown>?]>).filter(
        c => c[1]?.reason === 'rings-trimmed'
      );
      expect(trimWarn).toHaveLength(1);
      expect(trimWarn[0][1]).toMatchObject({ securityEvent: true });
    });
  });

  // ------------------------------------------------------------------
  // getIndex
  // ------------------------------------------------------------------
  describe('getIndex', () => {
    it('getIndex(\'id\') returns normalised entries + trimmed + dropped in one uncached request', async () => {
      // 'id' (BMKG) carries a requestsPerMinute limiter, so each call's
      // single request needs its fake-timer slot advanced.
      const indexXml = rssIndex([{ guid: 'a1', link: 'https://www.bmkg.go.id/alerts/nowcast/doc/a1' }]);
      mockGet.mockImplementation(() => xmlResponse(indexXml));
      const service = makeService();

      const firstPromise = service.getIndex('id');
      await vi.advanceTimersByTimeAsync(2000);
      const first = await firstPromise;
      expect(first.entries).toHaveLength(1);
      expect(first.trimmed).toBe(false);
      expect(first.dropped).toBe(0);
      expect(mockGet).toHaveBeenCalledTimes(1);

      const secondPromise = service.getIndex('id');
      await vi.advanceTimersByTimeAsync(2000);
      const second = await secondPromise;
      expect(second.entries).toHaveLength(1);
      expect(mockGet).toHaveBeenCalledTimes(2); // nothing cached — refetched
    });
  });

  // ------------------------------------------------------------------
  // Hygiene
  // ------------------------------------------------------------------
  describe('logging hygiene', () => {
    it('never logs a coordinate, a body fragment, a fixture URL, or the description text', async () => {
      const badUrl = 'https://evil.test/cap_public_website/x';
      const goodDocUrl = 'https://sachet.ndma.gov.in/cap_public_website/good';
      const badPolyUrl = 'https://evil.test/poly';
      const secretDescription = 'SECRET_DESCRIPTION_MARKER_1234';

      const indexXml = rssIndex([
        { guid: 'bad-1', link: badUrl },
        { guid: 'good-1', link: goodDocUrl }
      ]);
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(indexXml);
        if (url === goodDocUrl) {
          return xmlResponse(
            sachetDoc({ identifier: 'GOOD-1', description: secretDescription, polygonUrl: badPolyUrl })
          );
        }
        return Promise.reject(new Error(`should not be requested: ${url}`));
      });

      const service = makeService();
      const result = await service.getWarnings('in');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].polygonUnavailable).toBe(true);

      const allCalls = [...warnSpy.mock.calls, ...infoSpy.mock.calls, ...errorSpy.mock.calls];
      const serialized = JSON.stringify(allCalls);

      expect(serialized).not.toContain(badUrl);
      expect(serialized).not.toContain(goodDocUrl);
      expect(serialized).not.toContain(badPolyUrl);
      expect(serialized).not.toContain(secretDescription);
      expect(serialized).not.toContain('<');
      expect(serialized).not.toMatch(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/); // a coordinate pair
    });
  });
});
