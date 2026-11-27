/**
 * National CAP feeds do not retry a timed-out request (plan national-cap-timeout-no-retry).
 *
 * A timeout has already spent its whole deadline (API_TIMEOUT_MS for the index, 10 s for a
 * document) or the tool call's remaining budget, so a retry answers after the caller has given
 * up. This is the v1.34.2 rule that NOAA, Open-Meteo, MeteoAlarm and GeoMet already follow.
 * Before this fix, a hung index was fetched four times (125 s at the default timeout, measured).
 *
 * Every row asserts the request count as well as the message (GOTCHAS G138). The controls prove
 * the edit removed only the timeout arm: a rate limit and a 5xx are still retried.
 *
 * The axios mock and the fixtures are trimmed copies of national-cap-service.test.ts, which does
 * not export them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

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
            use: (_onFulfilled: unknown, onRejected: (error: unknown) => Promise<never>) => {
              errorInterceptor = onRejected;
            }
          }
        }
      };
    })
  }
}));

import { NationalCapService } from '../../src/services/nationalCap.js';
import { logger } from '../../src/utils/logger.js';
import type { NationalCapFeed } from '../../src/types/cap.js';

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

const FUTURE = '2099-01-01T00:00:00+00:00';

/** Longer than the index ladder's 7 s of backoff, so a reintroduced retry shows in the count. */
const SETTLE_MS = 10_000;

function xmlResponse(data: string) {
  return Promise.resolve({ data, status: 200 });
}

function rssIndex(items: Array<{ guid: string; link: string }>): string {
  const itemsXml = items
    .map(i => `<item><guid isPermaLink="false">${i.guid}</guid><link>${i.link}</link></item>`)
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>${itemsXml}</channel></rss>`;
}

function sachetDoc(identifier: string, polygonUrl?: string): string {
  return `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
<cap:identifier>${identifier}</cap:identifier>
<cap:sender>Test-SDMA</cap:sender>
<cap:sent>2026-08-23T00:00:00+00:00</cap:sent>
<cap:status>Actual</cap:status>
<cap:msgType>Alert</cap:msgType>
<cap:scope>Public</cap:scope>
<cap:info>
<cap:language>en</cap:language>
<cap:event>Flood Warning</cap:event>
<cap:urgency>Expected</cap:urgency>
<cap:severity>Moderate</cap:severity>
<cap:certainty>Possible</cap:certainty>
<cap:expires>${FUTURE}</cap:expires>
<cap:headline>Test headline</cap:headline>
${
  polygonUrl
    ? `<cap:parameter><cap:valueName>Polygon URL</cap:valueName><cap:value>${polygonUrl}</cap:value></cap:parameter>`
    : ''
}
<cap:area>
<cap:areaDesc>Test District</cap:areaDesc>
</cap:area>
</cap:info>
</cap:alert>`;
}

function calledUrls(): string[] {
  return (mockGet.mock.calls as unknown as Array<[string]>).map(c => c[0]);
}

function countCalls(url: string): number {
  return calledUrls().filter(u => u === url).length;
}

describe('NationalCapService — a timed-out request is not retried', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));
    mockGet.mockReset();
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeService(): NationalCapService {
    return new NationalCapService({
      feeds: TEST_FEEDS,
      now: () => new Date(),
      backoffJitter: () => 0.5
    });
  }

  async function settle<T>(promise: Promise<T>): Promise<T | Error> {
    const caught = promise.catch((e: unknown) => e as Error);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    return caught;
  }

  describe('index', () => {
    it.each(['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'])(
      'ph: %s is fetched once and rejects with the timeout message',
      async code => {
        mockGet.mockImplementation(() => Promise.reject({ code }));
        const err = await settle(makeService().getWarnings('ph'));
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe('PAGASA-DOST alert feed request timed out');
        expect(mockGet).toHaveBeenCalledTimes(1);
      }
    );

    it.each([
      ['in', 'NDMA SACHET'],
      ['id', 'BMKG']
    ])('%s: ECONNABORTED is fetched once and names %s', async (cc, publisher) => {
      mockGet.mockImplementation(() => Promise.reject({ code: 'ECONNABORTED' }));
      const err = await settle(makeService().getWarnings(cc));
      expect((err as Error).message).toBe(`${publisher} alert feed request timed out`);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('the diagnostic getIndex path is fetched once on a timeout as well', async () => {
      mockGet.mockImplementation(() => Promise.reject({ code: 'ECONNABORTED' }));
      const err = await settle(makeService().getIndex('ph'));
      expect((err as Error).message).toBe('PAGASA-DOST alert feed request timed out');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('document', () => {
    it.each(['ECONNABORTED', 'ETIMEDOUT'])(
      'a document that fails with %s is fetched once and counted unavailable; the other returns',
      async code => {
        const okUrl = 'https://sachet.ndma.gov.in/cap_public_website/ok';
        const slowUrl = 'https://sachet.ndma.gov.in/cap_public_website/slow';
        mockGet.mockImplementation((url: string) => {
          if (url === TEST_FEEDS.in.indexUrl) {
            return xmlResponse(
              rssIndex([
                { guid: 'ok', link: okUrl },
                { guid: 'slow', link: slowUrl }
              ])
            );
          }
          if (url === okUrl) return xmlResponse(sachetDoc('OK-1'));
          if (url === slowUrl) return Promise.reject({ code });
          return Promise.reject(new Error(`unexpected url: ${url}`));
        });
        const result = await settle(makeService().getWarnings('in'));
        if (result instanceof Error) throw result;
        expect(result.warnings.map(w => w.identifier)).toEqual(['OK-1']);
        expect(result.unavailableCount).toBe(1);
        expect(countCalls(slowUrl)).toBe(1);
      }
    );

    it('a linked polygon that times out is fetched once; the warning stays, its polygon is counted unavailable', async () => {
      const docUrl = 'https://sachet.ndma.gov.in/cap_public_website/doc-p';
      const polyUrl = 'https://sachet.ndma.gov.in/cap_public_website/poly-p';
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) return xmlResponse(rssIndex([{ guid: 'p', link: docUrl }]));
        if (url === docUrl) return xmlResponse(sachetDoc('POLY-1', polyUrl));
        if (url === polyUrl) return Promise.reject({ code: 'ECONNABORTED' });
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const result = await settle(makeService().getWarnings('in'));
      if (result instanceof Error) throw result;
      expect(result.warnings.map(w => w.identifier)).toEqual(['POLY-1']);
      expect(result.unavailableCount).toBe(0);
      expect(result.polygonUnavailableCount).toBe(1);
      expect(countCalls(polyUrl)).toBe(1);
    });
  });

  describe('the refresh deadline stops the index fetch (diff review codex-DR-M1)', () => {
    // With API_TIMEOUT_MS above the 40 s refresh deadline, the index GET used to outlive the
    // answer: refresh() aborted its controller, but fetchIndex never received the signal.
    function makeSlowService(): NationalCapService {
      return new NationalCapService({
        feeds: TEST_FEEDS,
        timeout: 120_000,
        now: () => new Date(),
        backoffJitter: () => 0.5
      });
    }

    function indexSignal(callIndex: number): AbortSignal | undefined {
      const calls = mockGet.mock.calls as unknown as Array<[string, { signal?: AbortSignal }?]>;
      return calls[callIndex]?.[1]?.signal;
    }

    it('an index GET still open at the 40 s deadline is aborted, and the caller gets the timeout message', async () => {
      mockGet.mockImplementation(() => new Promise(() => undefined));
      const caught = makeSlowService()
        .getWarnings('ph')
        .catch((e: unknown) => e as Error);
      await vi.advanceTimersByTimeAsync(40_000);
      const err = await caught;
      expect((err as Error).message).toBe('PAGASA-DOST alert feed request timed out');
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(indexSignal(0)?.aborted).toBe(true);
    });

    it('a 503 just before the deadline starts no retry after it', async () => {
      mockGet.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject({ response: { status: 503 } }), 39_500);
          })
      );
      const caught = makeSlowService()
        .getWarnings('ph')
        .catch((e: unknown) => e as Error);
      // The 503 lands at 39.5 s; the first backoff (1000 ms × 0.75) ends after the 40 s abort.
      await vi.advanceTimersByTimeAsync(50_000);
      const err = await caught;
      expect((err as Error).message).toBe('PAGASA-DOST alert feed request timed out');
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('the diagnostic getIndex path passes no signal', async () => {
      mockGet.mockImplementation(() => xmlResponse(rssIndex([])));
      await settle(makeService().getIndex('in'));
      expect(indexSignal(0)).toBeUndefined();
    });
  });

  describe('controls: a rate limit and a 5xx are still retried', () => {
    it('an index 429 is fetched four times and rejects with the rate-limit message', async () => {
      mockGet.mockImplementation(() => Promise.reject({ response: { status: 429 } }));
      const err = await settle(makeService().getWarnings('ph'));
      expect((err as Error).message).toBe('PAGASA-DOST alert feed rate limit exceeded');
      expect(mockGet).toHaveBeenCalledTimes(4);
    });

    it('an index 503 is fetched four times', async () => {
      mockGet.mockImplementation(() => Promise.reject({ response: { status: 503 } }));
      const err = await settle(makeService().getWarnings('ph'));
      expect((err as Error).message).toBe('PAGASA-DOST alert feed server error (status 503)');
      expect(mockGet).toHaveBeenCalledTimes(4);
    });

    it('a document 503 is fetched twice (one retry) and counted unavailable', async () => {
      const okUrl = 'https://sachet.ndma.gov.in/cap_public_website/ok';
      const badUrl = 'https://sachet.ndma.gov.in/cap_public_website/bad';
      mockGet.mockImplementation((url: string) => {
        if (url === TEST_FEEDS.in.indexUrl) {
          return xmlResponse(
            rssIndex([
              { guid: 'ok', link: okUrl },
              { guid: 'bad', link: badUrl }
            ])
          );
        }
        if (url === okUrl) return xmlResponse(sachetDoc('OK-1'));
        if (url === badUrl) return Promise.reject({ response: { status: 503 } });
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      const result = await settle(makeService().getWarnings('in'));
      if (result instanceof Error) throw result;
      expect(result.warnings.map(w => w.identifier)).toEqual(['OK-1']);
      expect(result.unavailableCount).toBe(1);
      expect(countCalls(badUrl)).toBe(2);
    });
  });
});
