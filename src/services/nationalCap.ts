/**
 * Service for the keyless national CAP 1.2 alert feeds — NDMA SACHET
 * (India), PAGASA (Philippines), and BMKG (Indonesia).
 *
 * **Routing position.** `get_alerts` routes by country: US → NOAA, Canada →
 * GeoMet, MeteoAlarm members → MeteoAlarm, then *this* service, and only
 * then the optional keyed Google fallback. Reaching Google still proves the
 * point is in no keyless authority.
 *
 * **Contract, not garnish.** An index failure propagates with a fixed
 * sanitized message; a fabricated "no alerts" from a failed fetch would be a
 * dangerous lie on safety data. Per-document failures are counted and
 * disclosed, never silently dropped.
 *
 * **The N+1 and why the polygon hop runs after filtering.** SACHET publishes
 * geometry in a *separate* document per alert (`Polygon URL` parameter), so a
 * cold refresh is 1 index + N documents + N polygon documents. Polygons are
 * therefore fetched only for the warnings that survive the current read view
 * — not for expired or superseded ones. A warning resurrected later (because
 * the Update that superseded it expired first) renders at country level until
 * the next index refresh; that is rare, honest, and disclosed by the
 * country-level block's wording.
 *
 * **`(identifier, published stamp)` keying and the SACHET thread guid.** A
 * SACHET RSS `guid` is the alert *thread* id: `FetchXMLFile?identifier=<guid>`
 * serves whatever the *latest* version of that thread is. Keying the document
 * cache on the identifier alone would keep serving the version first seen —
 * an alert extended from 12:00 to 15:00 would read as *no alert* after 12:00,
 * the forbidden fabricated all-clear. The index `published` stamp changes
 * exactly when the document does, so the pair is what makes the key
 * immutable. The pair is encoded as one injective token, because
 * `Cache.generateKey` joins components with an unescaped `:` and both
 * identifiers (`urn:uuid:…`) and ISO stamps contain colons.
 *
 * **Unfiltered cache, read-time filter.** The country list cache holds the
 * complete assembled set; `filterActiveCapWarnings` runs on every return,
 * cached or fresh (the MeteoAlarm precedent). Caching post-filter would stop
 * an original reappearing when the Update superseding it expires first, and
 * would re-fetch every expired document on each 5-minute refresh.
 *
 * **Network policy.** Every URL taken from a feed body — document URLs and
 * `Polygon URL` parameters alike — is checked against the feed's own
 * HTTPS host/path allowlist before it is fetched; redirects are not followed
 * (a 3xx is an error); the response size is bounded at the transport as well
 * as after reading. Each feed has a request-start limiter consulted before
 * *every* request, and a whole refresh is bounded by a deadline.
 *
 * All parsing lives in `src/utils/capParse.ts`; this module does fetching,
 * caching, bounding, and error mapping only. Errors are plain sanitized
 * `Error`s (the MeteoAlarm/ACIS/NIFC precedent — `ApiServiceName` is a closed
 * union and this is a peripheral service). No message or log argument ever
 * carries a URL, a response body, or polygon text.
 */

import axios, { AxiosInstance } from 'axios';
import type {
  NationalCapFeed,
  NationalCapResult,
  NationalCapWarning,
  NormalizedCapIndexEntry
} from '../types/cap.js';
import {
  MAX_DOCUMENT_BYTES,
  filterActiveCapWarnings,
  flattenCapAlert,
  isAllowedFeedUrl,
  normalizeIndexEntries,
  parseCapDocument,
  parseCapIndex,
  parsePolygonDocument
} from '../utils/capParse.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { logger } from '../utils/logger.js';
import { getUserAgent } from '../utils/version.js';

/**
 * The three national CAP feeds, as data rather than code. The only
 * per-country *code* is the SACHET polygon hop (`polygonSource:
 * 'linked-parameter'`). Exported so a future tool can reuse the country map.
 *
 * `allowedHosts`/`allowedPathPrefixes` are required by the type, so a feed
 * cannot be added without an allowlist. The path prefixes are deliberately
 * one level broader than any single observed document family: PAGASA serves
 * CAP documents under at least `/output/gfa/` and `/output/acp/` (live
 * 2026-08-23), so `/output/` is both correct and future-proof, where
 * enumerating the observed families would silently drop an unsampled one.
 */
export const NATIONAL_CAP_FEEDS: Record<string, NationalCapFeed> = {
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
    // BMKG documents 60 requests/minute/IP; the limiter below enforces it.
    requestsPerMinute: 60
  }
};

/** Whether a country (lowercase ISO 3166-1 alpha-2 code) has a national CAP feed. */
export function isNationalCapCountry(countryCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(NATIONAL_CAP_FEEDS, countryCode);
}

/** Concurrent in-flight document/polygon fetches per refresh. */
const DOCUMENT_FETCH_CONCURRENCY = 6;
/** Whole-refresh budget, measured from refresh start. */
const REFRESH_DEADLINE_MS = 40_000;
/** Per-document/polygon request timeout ceiling (the index gets the full API timeout). */
const DOCUMENT_TIMEOUT_CEILING_MS = 10_000;

export interface NationalCapServiceConfig {
  timeout?: number;
  /** Feed map override — lets tests point URLs at fixtures without touching the real map. */
  feeds?: Record<string, NationalCapFeed>;
  /** Injectable clock, so read-time filtering is deterministic under test. */
  now?: () => Date;
  /** Injectable retry jitter (default `Math.random`), so backoff is deterministic under test. */
  backoffJitter?: () => number;
}

/**
 * One request-start limiter per feed, consulted before **every** request —
 * index, documents, polygons, and retries alike, not only document misses.
 * A feed that declares no rate limit is bounded only by the fan-out.
 *
 * A promise chain, so starts are serialised and spaced; no dependency.
 */
class FeedLimiter {
  private readonly minIntervalMs: number;
  private chain: Promise<void> = Promise.resolve();
  private lastStart = -Infinity;

  constructor(requestsPerMinute?: number) {
    this.minIntervalMs =
      requestsPerMinute && requestsPerMinute > 0 ? Math.ceil(60_000 / requestsPerMinute) : 0;
  }

  /** Resolves when the caller may start its request. */
  acquire(): Promise<void> {
    if (this.minIntervalMs === 0) {
      return Promise.resolve();
    }
    const next = this.chain.then(async () => {
      const wait = this.lastStart + this.minIntervalMs - Date.now();
      if (wait > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, wait));
      }
      this.lastStart = Date.now();
    });
    // A rejected link must not poison the chain for later callers.
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/** Minimal structural shape of an axios-style error, checked without `any`. */
interface AxiosLikeError {
  response?: { status: number };
  code?: string;
  message?: string;
}

/**
 * Structural guard rather than `axios.isAxiosError`: unit tests mock the
 * axios module down to `default.create`, so an imported helper or an
 * `AxiosError` class reference would be undefined there.
 */
function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === 'object' && error !== null;
}

export class NationalCapService {
  private client: AxiosInstance;
  private cache: Cache<unknown>;
  private feeds: Record<string, NationalCapFeed>;
  private limiters = new Map<string, FeedLimiter>();
  private inFlight = new Map<string, Promise<NationalCapResult>>();
  private now: () => Date;
  private backoffJitter: () => number;
  private documentTimeout: number;
  private maxIndexRetries = 3;

  constructor(config: NationalCapServiceConfig = {}) {
    const {
      timeout = CacheConfig.apiTimeoutMs,
      feeds = NATIONAL_CAP_FEEDS,
      now = () => new Date(),
      backoffJitter = Math.random
    } = config;

    this.feeds = feeds;
    this.now = now;
    this.backoffJitter = backoffJitter;
    this.documentTimeout = Math.min(timeout, DOCUMENT_TIMEOUT_CEILING_MS);
    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      timeout,
      headers: {
        'Accept':
          'application/xml, text/xml, application/rss+xml, application/atom+xml;q=0.9, */*;q=0.5',
        'User-Agent': getUserAgent()
      },
      responseType: 'text',
      // A 3xx is an error, never followed: a redirect off an allowlisted host
      // would defeat the allowlist entirely.
      maxRedirects: 0,
      // Refused at the transport; the post-read byte check in `parseXml` is
      // the second line of defence. `maxBodyLength` is request-side and set
      // only for symmetry.
      maxContentLength: MAX_DOCUMENT_BYTES,
      maxBodyLength: MAX_DOCUMENT_BYTES
    });
  }

  /** The limiter for a feed, created on first use. */
  private limiterFor(countryCode: string, feed: NationalCapFeed): FeedLimiter {
    let limiter = this.limiters.get(countryCode);
    if (!limiter) {
      limiter = new FeedLimiter(feed.requestsPerMinute);
      this.limiters.set(countryCode, limiter);
    }
    return limiter;
  }

  /**
   * Map a request failure to a fixed message naming the publisher. Never
   * includes a URL, a body, or a raw axios error.
   */
  private toFeedError(error: unknown, feed: NationalCapFeed): Error {
    if (isAxiosLikeError(error)) {
      // Checked *before* the `response` branch: an oversize-body rejection
      // carries no `response` at all, so testing `error.response` first would
      // misclassify it as a connection failure.
      if (
        error.code === 'ERR_BAD_RESPONSE' &&
        /maxContentLength/.test(error.message ?? '')
      ) {
        return new Error(`${feed.publisher} alert feed response too large`);
      }

      if (error.response) {
        const status = error.response.status;
        if (status === 429) {
          return new Error(`${feed.publisher} alert feed rate limit exceeded`);
        }
        if (status >= 500) {
          return new Error(`${feed.publisher} alert feed server error (status ${status})`);
        }
        return new Error(`${feed.publisher} alert feed returned status ${status}`);
      }

      if (
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ERR_CANCELED'
      ) {
        return new Error(`${feed.publisher} alert feed request timed out`);
      }

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return new Error(`Unable to connect to the ${feed.publisher} alert feed`);
      }
    }

    return new Error(`Unknown error occurred while contacting the ${feed.publisher} alert feed`);
  }

  /** Whether a mapped failure is worth retrying. */
  private isRetryable(error: Error): boolean {
    const message = error.message;
    return (
      message.includes('rate limit') ||
      message.includes('server error') ||
      message.includes('timed out')
    );
  }

  /** One limited GET returning the response body as text. */
  private async fetchText(
    url: string,
    countryCode: string,
    feed: NationalCapFeed,
    options: { timeout?: number; signal?: AbortSignal } = {}
  ): Promise<string> {
    await this.limiterFor(countryCode, feed).acquire();
    try {
      const response = await this.client.get<string>(url, {
        timeout: options.timeout,
        signal: options.signal
      });
      return typeof response.data === 'string' ? response.data : String(response.data);
    } catch (error) {
      throw this.toFeedError(error, feed);
    }
  }

  /** The index fetch, with MeteoAlarm-style backoff on transient failures. */
  private async fetchIndex(
    countryCode: string,
    feed: NationalCapFeed,
    retries = 0
  ): Promise<string> {
    try {
      return await this.fetchText(feed.indexUrl, countryCode, feed);
    } catch (error) {
      const mapped = error as Error;
      if (retries < this.maxIndexRetries && this.isRetryable(mapped)) {
        const baseDelay = Math.pow(2, retries) * 1000;
        const delay = baseDelay * (0.5 + this.backoffJitter() * 0.5);
        await new Promise<void>(resolve => setTimeout(resolve, delay));
        return this.fetchIndex(countryCode, feed, retries + 1);
      }
      throw mapped;
    }
  }

  /** A document/polygon fetch: one retry on a transient failure, none on 4xx/3xx. */
  private async fetchDocument(
    url: string,
    countryCode: string,
    feed: NationalCapFeed,
    signal: AbortSignal
  ): Promise<string> {
    try {
      return await this.fetchText(url, countryCode, feed, {
        timeout: this.documentTimeout,
        signal
      });
    } catch (error) {
      const mapped = error as Error;
      if (this.isRetryable(mapped) && !signal.aborted) {
        return this.fetchText(url, countryCode, feed, {
          timeout: this.documentTimeout,
          signal
        });
      }
      throw mapped;
    }
  }

  /**
   * The one injective cache-version token for a document/polygon. Both parts
   * are untrusted strings that routinely contain `:`, and
   * `Cache.generateKey` joins components with an unescaped `:` — passing them
   * as two adjacent components would let `('thread:2026-08-23T00', '00:00Z')`
   * and `('thread', '2026-08-23T00:00:00Z')` collide.
   */
  private versionToken(entry: NormalizedCapIndexEntry): string {
    return JSON.stringify([entry.identifier, entry.published?.trim() ?? '']);
  }

  /**
   * Fetch, parse and normalise one feed index. Uncached and un-deduped —
   * exposed for the live integration smoke and for diagnostics, deliberately
   * not on the `getWarnings` path.
   */
  async getIndex(
    countryCode: string
  ): Promise<{ entries: NormalizedCapIndexEntry[]; trimmed: boolean; dropped: number }> {
    const feed = this.feeds[countryCode];
    if (!feed) {
      throw new Error(`No national CAP feed for country code "${countryCode}"`);
    }
    const xml = await this.fetchIndex(countryCode, feed);
    const { entries, trimmed } = parseCapIndex(xml, feed.indexKind);
    const normalized = normalizeIndexEntries(entries);
    return { entries: normalized.entries, trimmed, dropped: normalized.dropped };
  }

  /**
   * Current warnings for a national CAP country.
   *
   * The cached set is the complete, **unfiltered** assembly; the returned
   * view is always filtered against `now`, cached or fresh.
   * `polygonUnavailableCount` is derived over that returned view on every
   * call and never cached — a refresh-time count rendered over a re-filtered
   * list could contradict the block beneath it.
   *
   * @throws {Error} If the country has no feed, or the index request/parse fails.
   */
  async getWarnings(countryCode: string): Promise<NationalCapResult> {
    const feed = this.feeds[countryCode];
    if (!feed) {
      throw new Error(`No national CAP feed for country code "${countryCode}"`);
    }

    const listKey = Cache.generateKey('nationalcap', 'list', countryCode);
    if (CacheConfig.enabled) {
      const cached = this.cache.get(listKey) as CachedList | undefined;
      if (cached) {
        logger.info('National CAP cache hit', { country: countryCode });
        return this.readView(cached);
      }
    }

    // Join a refresh already running for this country rather than racing it.
    const existing = this.inFlight.get(countryCode);
    if (existing) {
      logger.info('Joining in-flight national CAP refresh', { country: countryCode });
      return existing;
    }

    // `finally` runs whether the refresh resolves or rejects, so a failed
    // refresh is never cached nor left behind for the next caller to join.
    const pull = this.refresh(countryCode, feed).finally(() => {
      this.inFlight.delete(countryCode);
    });
    this.inFlight.set(countryCode, pull);
    return pull;
  }

  /** Filter an assembled set to the current read view and derive its counts. */
  private readView(cached: CachedList): NationalCapResult {
    const warnings = filterActiveCapWarnings(cached.warnings, this.now());
    return {
      warnings,
      unavailableCount: cached.unavailableCount,
      indexTrimmed: cached.indexTrimmed,
      // Derived over the *returned* view, never cached: an inline flattener
      // flag and a failed linked hop both count here, and a warning that has
      // since expired must stop counting.
      polygonUnavailableCount: warnings.filter(warning => warning.polygonUnavailable).length
    };
  }

  /** One full refresh: index → documents → polygons for the current view. */
  private async refresh(countryCode: string, feed: NationalCapFeed): Promise<NationalCapResult> {
    const controller = new AbortController();
    let deadlinePassed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const deadline = new Promise<void>(resolve => {
      timer = setTimeout(() => {
        deadlinePassed = true;
        // Abort so sockets are released rather than held to their own timeout.
        controller.abort();
        resolve();
      }, REFRESH_DEADLINE_MS);
    });

    try {
      // The index is the contract: its failure propagates, and a 200 HTML
      // error page is a parse failure, not zero alerts.
      const indexXml = await Promise.race([
        this.fetchIndex(countryCode, feed),
        deadline.then(() => {
          throw new Error(`${feed.publisher} alert feed request timed out`);
        })
      ]);

      const { entries: rawEntries, trimmed: indexTrimmed } = parseCapIndex(
        indexXml,
        feed.indexKind
      );
      if (indexTrimmed) {
        logger.warn('National CAP index trimmed to the item cap', {
          country: countryCode,
          securityEvent: true
        });
      }

      const { entries, dropped } = normalizeIndexEntries(rawEntries);
      let unavailableCount = dropped;

      // --- Documents ---------------------------------------------------
      const assembled = new Map<number, NationalCapWarning>();
      const settled = new Set<number>();
      // The polygon stage runs on the filtered read view, which has lost the
      // link back to the index entry — so the entry's version token is
      // carried here, keeping document and polygon keys on the same
      // injective (identifier, stamp) pair.
      const versionByWarning = new Map<NationalCapWarning, string>();

      await this.runBounded(
        entries,
        async (entry, index) => {
          const outcome = await this.loadDocument(entry, countryCode, feed, controller.signal);
          // A result that arrives after the deadline is discarded for this
          // refresh's assembled set; the immutable document cache it may have
          // written still helps the next one.
          if (deadlinePassed) {
            return;
          }
          settled.add(index);
          if (outcome) {
            assembled.set(index, outcome);
            versionByWarning.set(outcome, this.versionToken(entry));
          } else {
            unavailableCount += 1;
          }
        },
        deadline,
        () => deadlinePassed
      );

      // Anything not settled by the deadline counts unavailable for this refresh.
      for (let index = 0; index < entries.length; index++) {
        if (!settled.has(index)) {
          unavailableCount += 1;
        }
      }

      const all = [...assembled.values()];

      // --- Polygons, for the current read view only ---------------------
      const view = filterActiveCapWarnings(all, this.now());
      const needsPolygon = view.filter(
        warning => warning.linkedPolygonUrl !== undefined && warning.polygons.length === 0
      );

      if (needsPolygon.length > 0) {
        await this.runBounded(
          needsPolygon,
          async warning => {
            const version = versionByWarning.get(warning);
            if (!version) {
              // Unreachable: every warning in the view came from the document
              // stage. Skipping rather than inventing a token keeps the
              // polygon cache keyed on the same pair as the document cache.
              return;
            }
            await this.loadPolygon(
              warning,
              version,
              countryCode,
              feed,
              controller.signal,
              () => deadlinePassed
            );
          },
          deadline,
          () => deadlinePassed
        );

        // A linked warning still without geometry after the polygon stage —
        // fetch failure, disallowed URL, or a deadline miss — is
        // geometry-unavailable. That is not an *unavailable alert*: it still
        // renders, at country level, with the disclosure.
        for (const warning of needsPolygon) {
          if (warning.polygons.length === 0) {
            warning.polygonUnavailable = true;
          }
        }
      }

      const list: CachedList = { warnings: all, unavailableCount, indexTrimmed };
      if (CacheConfig.enabled) {
        // Cached even when some documents failed: a partial refresh is the
        // honest answer for the next five minutes, disclosed by the count.
        this.cache.set(listKeyFor(countryCode), list, CacheConfig.ttl.alerts);
      }
      return this.readView(list);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Run `worker` over `items` with a bounded fan-out, stopping early when the
   * deadline fires: no new work starts, and the caller treats anything not
   * settled as unavailable.
   */
  private async runBounded<T>(
    items: T[],
    worker: (item: T, index: number) => Promise<void>,
    deadline: Promise<void>,
    isDeadlinePassed: () => boolean
  ): Promise<void> {
    let cursor = 0;
    const runnerCount = Math.min(DOCUMENT_FETCH_CONCURRENCY, items.length);
    const runners: Array<Promise<void>> = [];

    for (let i = 0; i < runnerCount; i++) {
      runners.push(
        (async () => {
          for (;;) {
            const index = cursor++;
            if (index >= items.length || isDeadlinePassed()) {
              return;
            }
            await worker(items[index], index);
          }
        })()
      );
    }

    await Promise.race([Promise.all(runners), deadline]);
  }

  /**
   * One index entry → a flattened warning, or `undefined` when the document
   * is unavailable or structurally unusable.
   *
   * The document cache holds the flattened record **without any refresh-time
   * geometry state**, and every refresh builds fresh objects from it — so a
   * transient polygon failure can never be frozen into a 24-hour cache entry.
   */
  private async loadDocument(
    entry: NormalizedCapIndexEntry,
    countryCode: string,
    feed: NationalCapFeed,
    signal: AbortSignal
  ): Promise<NationalCapWarning | undefined> {
    const key = Cache.generateKey('nationalcap', 'doc', countryCode, this.versionToken(entry));

    if (CacheConfig.enabled) {
      const cached = this.cache.get(key) as NationalCapWarning | undefined;
      if (cached) {
        this.noteInlineGeometryTrim(cached, countryCode);
        return freshCopy(cached);
      }
    }

    if (!isAllowedFeedUrl(entry.documentUrl, feed)) {
      logger.warn('National CAP document URL outside the feed allowlist', {
        country: countryCode,
        reason: 'url-not-allowed',
        securityEvent: true
      });
      return undefined;
    }

    let record: NationalCapWarning | undefined;
    try {
      const xml = await this.fetchDocument(entry.documentUrl, countryCode, feed, signal);
      record = flattenCapAlert(parseCapDocument(xml), feed, countryCode);
    } catch (error) {
      logger.warn('National CAP document unavailable', {
        country: countryCode,
        reason: (error as Error).message
      });
      return undefined;
    }

    if (!record) {
      // A well-formed document with no identifier or no info block is a
      // shape failure, not an honest empty: count it, and do not cache it as
      // a successful document.
      logger.warn('National CAP document had an unusable shape', { country: countryCode });
      return undefined;
    }

    if (CacheConfig.enabled) {
      this.cache.set(key, record, CacheConfig.ttl.capDocument);
    }
    this.noteInlineGeometryTrim(record, countryCode);
    return freshCopy(record);
  }

  /**
   * Surface an inline ring-cap trim as a bounded-array security event.
   *
   * The flattener detects the trim but cannot log it — `capParse.ts` is a
   * pure zero-I/O module — so the service reports it here, matching what
   * `applyRings` does for the linked-polygon path. Without this, an inline
   * feed's over-cap geometry would be dropped silently.
   */
  private noteInlineGeometryTrim(record: NationalCapWarning, countryCode: string): void {
    if (record.geometryTrimmed) {
      logger.warn('National CAP geometry exceeded the ring cap', {
        country: countryCode,
        reason: 'rings-trimmed',
        securityEvent: true
      });
    }
  }

  /** Fetch and attach a linked polygon document, caching only a successful parse. */
  private async loadPolygon(
    warning: NationalCapWarning,
    versionToken: string,
    countryCode: string,
    feed: NationalCapFeed,
    signal: AbortSignal,
    isDeadlinePassed: () => boolean
  ): Promise<void> {
    const url = warning.linkedPolygonUrl;
    if (!url) {
      return;
    }
    const key = Cache.generateKey('nationalcap', 'poly', countryCode, versionToken);

    if (CacheConfig.enabled) {
      const cached = this.cache.get(key) as PolygonCacheEntry | undefined;
      if (cached) {
        this.applyRings(warning, cached, countryCode);
        return;
      }
    }

    if (!isAllowedFeedUrl(url, feed)) {
      logger.warn('National CAP polygon URL outside the feed allowlist', {
        country: countryCode,
        reason: 'url-not-allowed',
        securityEvent: true
      });
      return;
    }

    let parsed: PolygonCacheEntry;
    try {
      const xml = await this.fetchDocument(url, countryCode, feed, signal);
      parsed = parsePolygonDocument(xml);
    } catch (error) {
      // Nothing is cached on failure, so the next refresh retries it.
      logger.warn('National CAP polygon document unavailable', {
        country: countryCode,
        reason: (error as Error).message
      });
      return;
    }

    if (CacheConfig.enabled) {
      this.cache.set(key, parsed, CacheConfig.ttl.capDocument);
    }
    if (isDeadlinePassed()) {
      return;
    }
    this.applyRings(warning, parsed, countryCode);
  }

  /** Attach a parsed ring set, honouring the ring cap's all-or-nothing rule. */
  private applyRings(
    warning: NationalCapWarning,
    parsed: PolygonCacheEntry,
    countryCode: string
  ): void {
    if (parsed.trimmed) {
      // A partial ring set must never be used for exclusion — a point covered
      // only by the ring beyond the cap must not read as "elsewhere".
      logger.warn('National CAP geometry exceeded the ring cap', {
        country: countryCode,
        reason: 'rings-trimmed',
        securityEvent: true
      });
      warning.polygons = [];
      warning.polygonUnavailable = true;
      warning.geometryTrimmed = true;
      return;
    }
    if (parsed.rings.length === 0) {
      // A successfully fetched polygon document with no usable ring is
      // geometry-unavailable, not geometry-absent.
      warning.polygonUnavailable = true;
      return;
    }
    warning.polygons = parsed.rings;
  }

  /** Get cache statistics. */
  getCacheStats() {
    return this.cache.getStats();
  }

  /** Clear the cache. */
  clearCache(): void {
    this.cache.clear();
  }
}

/** The complete, unfiltered assembly cached per country. */
interface CachedList {
  warnings: NationalCapWarning[];
  unavailableCount: number;
  indexTrimmed: boolean;
}

/** A parsed linked-polygon document, as cached. */
interface PolygonCacheEntry {
  rings: Array<Array<[number, number]>>;
  trimmed: boolean;
}

function listKeyFor(countryCode: string): string {
  return Cache.generateKey('nationalcap', 'list', countryCode);
}

/**
 * A per-refresh copy of a cached document record. The polygon stage writes
 * only into these, never into a cache value — otherwise one polygon timeout
 * would render that alert country-level for the whole 24-hour document TTL.
 */
function freshCopy(record: NationalCapWarning): NationalCapWarning {
  return {
    ...record,
    polygons: record.polygons.map(ring => [...ring]),
    polygonUnavailable: record.polygonUnavailable,
    geometryTrimmed: record.geometryTrimmed
  };
}
