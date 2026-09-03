/**
 * JMA (Japan Meteorological Agency) warning service.
 *
 * Reads JMA's official disaster-prevention XML service: one Atom index listing
 * roughly seven days of bulletins, then the newest VPWW53 warning document for
 * the office asked about.
 *
 * **Contract, not garnish.** A failed index or document fetch **propagates**.
 * A fabricated "no warnings in force" built from a fetch that failed is the
 * worst thing this codebase can emit, so nothing here catches and returns an
 * empty result. The handler renders the failure.
 *
 * **Errors are plain `Error`s with fixed, pre-written messages.**
 * `ApiServiceName` in `src/errors/ApiError.ts` is a closed union and JMA stays
 * outside it, following FIRMS and the other peripheral services. No message
 * here ever carries a URL, a response body, or a raw axios error.
 *
 * ## Two clocks on the index, and why
 *
 * The index is cached under `CacheConfig.ttl.jmaIndex` (1 hour) — that is
 * **retention**. Separately, `INDEX_FRESHNESS_MS` (`CacheConfig.ttl.alerts`,
 * 5 minutes) is how long the entry is served without asking JMA at all — that
 * is **freshness**, and it is checked from `revalidatedAt` *inside* the entry
 * rather than by letting the entry expire.
 *
 * They have to be separate. A conditional `If-None-Match` returns **304 with
 * zero bytes**, and the whole value of that is reusing the parse we already
 * have; a single 5-minute TTL would evict the parse at precisely the moment the
 * ETag became useful. Age is not a problem for correctness either — a 304 is
 * JMA stating the index is current, whatever its age.
 *
 * The ETag lives **in the cache entry**, never on the instance (G43): a field on
 * the service is not per-request across an `await`, and two overlapping refreshes
 * would interleave one request's validator into another's fetch.
 *
 * ## What is bounded, and what a bound may never do
 *
 * The index is capped by bytes (`JMA_MAX_INDEX_BYTES`) and by entry count
 * (`JMA_MAX_INDEX_ENTRIES`), both in `jmaParse.ts`. **A trim is a caveat the
 * renderer shows, never a reason to report an office as having no warnings**
 * (G8) — `JmaWarningsResult.indexTrimmed` carries it out to be disclosed.
 *
 * ## Positive controls on the index
 *
 * An upstream that answers HTTP 200 with well-formed, correctly-shaped content
 * it has stopped updating is invisible to every other check here, and JMA's
 * `bosai/warning/data/warning/*.json` endpoint is doing exactly that today —
 * frozen since May 2026 while answering 200. So two properties are asserted
 * before any answer is derived, and both fail loudly rather than emptily:
 *
 *   - the index yields **at least one VPWW53 entry**. VPWW53 covers all 58
 *     offices and carried 2,515 entries in seven days; zero is a fault.
 *   - not every entry's filename failed to parse. All-unparseable means the
 *     filename convention moved, which would otherwise present as "this office
 *     publishes nothing".
 *
 * Measured live 2026-09-03: index 5,267,421 bytes decompressed / 271 KB on the
 * wire, `If-None-Match` returns 304 with zero bytes, one document 25 KB with
 * `cache-control: max-age=86400` and an immutable timestamped filename.
 */

import axios, { type AxiosInstance } from 'axios';

import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { getUserAgent } from '../utils/version.js';
import { logger } from '../utils/logger.js';
import { isAllowedFeedUrl } from '../utils/capParse.js';
import {
  JMA_MAX_DOCUMENT_BYTES,
  JMA_MAX_INDEX_BYTES,
  JMA_WARNING_INFO_TYPE,
  parseJmaIndex,
  parseJmaWarningDocument
} from '../utils/jmaParse.js';
import type { JmaIndexEntry, JmaIndexResult, JmaWarningDocument } from '../types/jma.js';

/** The long-term index: roughly seven days of bulletins. */
export const JMA_INDEX_URL = 'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml';

/**
 * Public page the licence-mandated attribution points at.
 *
 * JMA's Government Standard Terms require `出典：気象庁ホームページ （当該ページのURL）`.
 * The renderer reproduces that string exactly; this is the URL it carries.
 */
export const JMA_SOURCE_URL = 'https://www.jma.go.jp/bosai/warning/';

/**
 * Allowlist for document URLs, which come **from the index** and are therefore
 * untrusted input.
 *
 * `isAllowedFeedUrl` (reused from `capParse.ts`) additionally requires https,
 * rejects userinfo and any explicit port, and is applied before any request is
 * made.
 */
const JMA_URL_ALLOWLIST: { allowedHosts: string[]; allowedPathPrefixes: string[] } = {
  allowedHosts: ['www.data.jma.go.jp'],
  allowedPathPrefixes: ['/developer/xml/data/']
};

/**
 * How long the cached index is served without contacting JMA. Reuses the
 * existing `alerts` interval; see the file header for why this is not the
 * entry's TTL.
 */
const INDEX_FRESHNESS_MS = CacheConfig.ttl.alerts;

/**
 * Above this age, the index's newest warning bulletin — across all of Japan —
 * is treated as stale, and the renderer discloses rather than reporting an
 * all-clear.
 *
 * Six hours. VPWW53 ran at 2,515 bulletins over seven days when measured, about
 * one every four minutes nationwide, so a six-hour national silence is far
 * outside normal operation and is much more likely to mean the feed has stopped
 * than that Japan has.
 */
export const JMA_INDEX_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** What the index cache entry holds: the parse, its validator, and when it was last confirmed current. */
interface CachedIndex {
  result: JmaIndexResult;
  /** `ETag` as served, replayed verbatim as `If-None-Match`. Weak validators are fine. */
  etag?: string;
  /** Epoch ms of the last 200 or 304 — *not* of the last parse. */
  revalidatedAt: number;
}

/** One office's warning answer. */
export interface JmaWarningsResult {
  /** The office asked about. */
  officeCode: string;
  /**
   * The office's newest VPWW53, or `undefined` when the index carries none for
   * it.
   *
   * `undefined` is **not** an all-clear. All 58 offices publish VPWW53
   * continuously, so an office missing from the index means the answer is
   * unknown, and the renderer discloses that rather than reporting no warnings.
   */
  document?: JmaWarningDocument;
  /** URL the document came from, for attribution and diagnostics. */
  documentUrl?: string;
  /** `<updated>` of the chosen entry, as published. */
  documentUpdated?: string;
  /** `<updated>` of the newest VPWW53 entry anywhere in the index — the feed's own pulse. */
  newestEntryUpdated?: string;
  /** True when the newest bulletin nationwide is older than `JMA_INDEX_STALE_AFTER_MS`. */
  indexStale: boolean;
  /**
   * True when the index's newest entry carries no parseable `<updated>`, so the
   * feed's freshness could not be checked at all.
   *
   * Distinct from `indexStale` on purpose. Both mean "we cannot vouch for this
   * being current", but only `indexStale` means "and we know it is old" — a
   * feed that dropped or reformatted `<updated>` would otherwise read as fresh,
   * which is the exact shape the staleness check exists to catch (G72).
   */
  indexClockUnknown: boolean;
  /** True when the entry cap trimmed the index. A caveat to disclose, never an exclusion (G8). */
  indexTrimmed: boolean;
  /** How many entries had an unreadable filename. Nonzero is worth disclosing; all of them is a fault. */
  indexUnparsedEntries: number;
}

/** Shape-only narrowing: unit tests mock axios down to `default.create`, so `axios.isAxiosError` is undefined there. */
interface AxiosLikeError {
  code?: string;
  message?: string;
  response?: { status?: number };
}

function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === 'object' && error !== null;
}

export interface JmaServiceConfig {
  timeout?: number;
  /** Injectable clock, so freshness and staleness are testable without waiting. */
  now?: () => number;
}

export class JmaService {
  private client: AxiosInstance;
  private cache: Cache<unknown>;
  private inFlight = new Map<string, Promise<unknown>>();
  private now: () => number;

  constructor(config: JmaServiceConfig = {}) {
    const { timeout = CacheConfig.apiTimeoutMs, now = () => Date.now() } = config;

    this.now = now;
    this.cache = new Cache(CacheConfig.maxSize);
    this.client = axios.create({
      timeout,
      headers: {
        Accept: 'application/xml, text/xml, application/atom+xml;q=0.9, */*;q=0.5',
        'User-Agent': getUserAgent()
      },
      responseType: 'text',
      // A 3xx is an error and is never followed: a redirect off an allowlisted
      // host would defeat the allowlist entirely.
      maxRedirects: 0,
      // Applies to the decompressed body. The index is the larger of the two;
      // document requests tighten it per-request.
      maxContentLength: JMA_MAX_INDEX_BYTES,
      maxBodyLength: JMA_MAX_INDEX_BYTES,
      // A 304 must reach us as a value, not as an exception — it is the
      // success case for a revalidation.
      validateStatus: status => (status >= 200 && status < 300) || status === 304
    });
  }

  /** Map a request failure to a fixed message. Never includes a URL, a body, or a raw axios error. */
  private toJmaError(error: unknown, what: string): Error {
    if (isAxiosLikeError(error)) {
      // Checked *before* the `response` branch: an oversize-body rejection
      // carries no `response`, so testing `response` first misclassifies it as
      // a connection failure.
      if (error.code === 'ERR_BAD_RESPONSE' && /maxContentLength/.test(error.message ?? '')) {
        return new Error(`JMA ${what} response too large`);
      }
      if (error.response) {
        const status = error.response.status;
        if (status === 429) {
          return new Error(`JMA ${what} rate limit exceeded`);
        }
        if (status !== undefined && status >= 500) {
          return new Error(`JMA ${what} server error (status ${status})`);
        }
        return new Error(`JMA ${what} returned status ${status}`);
      }
      if (
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ERR_CANCELED'
      ) {
        return new Error(`JMA ${what} request timed out`);
      }
      // ECONNRESET / EPIPE (peer dropped the socket) and EAI_AGAIN (transient
      // DNS failure) are connection failures like the two above. Left
      // unmapped they fell to the "Unknown error" line, which reads as a
      // defect rather than a network event — and CI's live smoke rethrows
      // anything it cannot classify as transport (G64).
      if (
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'EAI_AGAIN' ||
        error.code === 'EPIPE'
      ) {
        return new Error(`Unable to connect to the JMA ${what}`);
      }
    }
    return new Error(`Unknown error occurred while contacting the JMA ${what}`);
  }

  /**
   * Log a failure with status and code only.
   *
   * The `Error` slot is deliberately left empty: the logger serialises the
   * message and stack of whatever it is handed, and an axios error carries the
   * request URL and the response body.
   */
  private logFailure(operation: string, error: unknown): void {
    const failure = isAxiosLikeError(error) ? error : undefined;
    logger.error('JMA request failed', undefined, {
      service: 'JMA',
      operation,
      status: failure?.response?.status,
      code: failure?.code
    });
  }

  /**
   * Cache-then-in-flight-then-fetch.
   *
   * The single-flight map is keyed by the cache key, so N concurrent callers
   * make one request; the entry is deleted in `finally`, so a rejection is
   * retried rather than remembered.
   */
  private async pull<T>(cacheKey: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached as T;
    }
    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      return existing as Promise<T>;
    }

    const pull = (async () => {
      const value = await fetcher();
      this.cache.set(cacheKey, value, ttlMs);
      return value;
    })().finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, pull);
    return pull;
  }

  /**
   * The parsed index, revalidated conditionally when it is older than
   * `INDEX_FRESHNESS_MS`.
   *
   * Always returns the **unfiltered** index. Filtering by office and bulletin
   * type happens at read time in `getWarnings`, so one cached index serves every
   * Japanese request rather than one cache entry per office (G6).
   */
  private async getIndex(): Promise<JmaIndexResult> {
    // Components are passed separately, never pre-joined: `Cache.generateKey`
    // joins with an unescaped `:` (G5).
    const cacheKey = Cache.generateKey('jma', 'index');

    const cached = this.cache.get(cacheKey) as CachedIndex | undefined;
    if (cached && this.now() - cached.revalidatedAt < INDEX_FRESHNESS_MS) {
      return cached.result;
    }

    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      return (await (existing as Promise<CachedIndex>)).result;
    }

    const pull = (async (): Promise<CachedIndex> => {
      let response;
      try {
        response = await this.client.get<string>(JMA_INDEX_URL, {
          headers: cached?.etag ? { 'If-None-Match': cached.etag } : undefined
        });
      } catch (error) {
        this.logFailure('index', error);
        throw this.toJmaError(error, 'alert index');
      }

      // 304: JMA says the parse we hold is current. Zero bytes, no re-parse —
      // only the freshness stamp moves.
      if (response.status === 304 && cached) {
        const revalidated: CachedIndex = { ...cached, revalidatedAt: this.now() };
        this.cache.set(cacheKey, revalidated, CacheConfig.ttl.jmaIndex);
        return revalidated;
      }

      const result = parseJmaIndex(typeof response.data === 'string' ? response.data : '');
      this.assertIndexIsUsable(result);

      const etagHeader = response.headers?.['etag'];
      const fresh: CachedIndex = {
        result,
        ...(typeof etagHeader === 'string' ? { etag: etagHeader } : {}),
        revalidatedAt: this.now()
      };
      this.cache.set(cacheKey, fresh, CacheConfig.ttl.jmaIndex);
      return fresh;
    })().finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, pull);
    return (await pull).result;
  }

  /**
   * Refuse an index that parsed cleanly but cannot be what it claims to be.
   *
   * Both checks fail **loudly**. Either one, treated as an empty index, becomes
   * "no warnings for your office" — a fabricated all-clear derived from a broken
   * upstream rather than from Japan being quiet.
   */
  private assertIndexIsUsable(result: JmaIndexResult): void {
    if (result.totalEntries > 0 && result.unparsedEntries === result.entries.length) {
      logger.warn('JMA index filenames are all unreadable', {
        service: 'JMA',
        totalEntries: result.totalEntries,
        securityEvent: true
      });
      throw new Error('JMA alert index is not in the expected format');
    }

    const hasWarnings = result.entries.some(entry => entry.infoType === JMA_WARNING_INFO_TYPE);
    if (!hasWarnings) {
      logger.warn('JMA index carries no warning bulletins', {
        service: 'JMA',
        totalEntries: result.totalEntries,
        infoType: JMA_WARNING_INFO_TYPE
      });
      throw new Error('JMA alert index carries no warning bulletins');
    }
  }

  /** Fetch and parse one warning document. Immutable filename, so the 24h document TTL applies. */
  private async getDocument(url: string): Promise<JmaWarningDocument> {
    if (!isAllowedFeedUrl(url, JMA_URL_ALLOWLIST)) {
      // The URL came from the index and is untrusted. Refused before any
      // request is made — nothing below this line has run.
      logger.warn('Refused a JMA document URL outside the allowlist', {
        service: 'JMA',
        securityEvent: true
      });
      throw new Error('JMA warning document URL is not permitted');
    }

    // Filenames are timestamped and therefore immutable, which is what makes a
    // 24-hour TTL correct here. Keyed on the filename rather than the whole URL
    // so no `/` or `:` reaches `Cache.generateKey` (G5).
    const pathname = new URL(url).pathname;
    const filename = pathname.slice(pathname.lastIndexOf('/') + 1);
    const cacheKey = Cache.generateKey('jma', 'document', filename);

    return this.pull(cacheKey, CacheConfig.ttl.capDocument, async () => {
      let response;
      try {
        response = await this.client.get<string>(url, {
          maxContentLength: JMA_MAX_DOCUMENT_BYTES,
          maxBodyLength: JMA_MAX_DOCUMENT_BYTES
        });
      } catch (error) {
        this.logFailure('document', error);
        throw this.toJmaError(error, 'warning document');
      }
      return parseJmaWarningDocument(typeof response.data === 'string' ? response.data : '');
    });
  }

  /**
   * The newest VPWW53 warning document for one office.
   *
   * Index entries are newest-first, so the first match per office is the
   * current one.
   */
  async getWarnings(officeCode: string): Promise<JmaWarningsResult> {
    const index = await this.getIndex();

    const warningEntries: JmaIndexEntry[] = index.entries.filter(
      entry => entry.infoType === JMA_WARNING_INFO_TYPE
    );
    const newest = warningEntries[0];
    const forOffice = warningEntries.find(entry => entry.officeCode === officeCode);

    // A missing or unparseable `<updated>` is NOT evidence of freshness. The
    // staleness check is the one positive control against a feed that answers
    // 200 while frozen (G72), and reading an unreadable clock as "not stale"
    // puts a hole in exactly the shape it guards — so it becomes its own
    // disclosed caveat rather than silently passing.
    const newestUpdatedMs = newest?.updated ? Date.parse(newest.updated) : Number.NaN;
    const indexClockUnknown = newest !== undefined && !Number.isFinite(newestUpdatedMs);
    const indexStale =
      Number.isFinite(newestUpdatedMs) && this.now() - newestUpdatedMs > JMA_INDEX_STALE_AFTER_MS;

    const base = {
      officeCode,
      indexStale,
      indexClockUnknown,
      indexTrimmed: index.trimmed,
      indexUnparsedEntries: index.unparsedEntries,
      ...(newest?.updated ? { newestEntryUpdated: newest.updated } : {})
    };

    // No entry for this office. Not an all-clear — every office publishes
    // VPWW53 continuously, so this means the answer is unknown.
    if (!forOffice) {
      return base;
    }

    const document = await this.getDocument(forOffice.documentUrl);
    return {
      ...base,
      document,
      documentUrl: forOffice.documentUrl,
      ...(forOffice.updated ? { documentUpdated: forOffice.updated } : {})
    };
  }
}
