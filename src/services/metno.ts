/**
 * Service for MET Norway's keyless Locationforecast API
 * (https://api.met.no/weatherapi/locationforecast/2.0/), published under
 * CC BY 4.0.
 *
 * **Routing position.** This is not a source a caller can ask for. It is
 * reached only when Open-Meteo fails *transiently* on an `auto`-routed non-US
 * `get_forecast`, and there is no `source: "metno"` to request — the tool's
 * schema is unchanged.
 *
 * **Classification — garnish wearing a contract's clothes, and it is garnish.**
 * A met.no failure does **not** propagate: the *original Open-Meteo error*
 * propagates, untouched, exactly as today. That is the only honest posture,
 * because met.no's success adds a forecast and its failure restores the current
 * behaviour — it can never manufacture an all-clear, and there is no coverage
 * claim for it to falsify. Two consequences ride on it:
 *
 * - **No retry layer on this path, anywhere.** By the time the fallback fires,
 *   the caller has already waited out Open-Meteo's own attempts, so the budget
 *   is one request. A 403 in particular is never retried: met.no's ToS warns
 *   that sites exceeding its limit are throttled, and retrying a throttle is
 *   how a throttle becomes a block.
 * - **No met.no error text ever reaches the user.** Every message below is
 *   fixed, pre-written, and read only by the handler deciding whether the
 *   fallback worked. The user sees Open-Meteo's message.
 *
 * **Terms of service, all four obligations, none of them cosmetic.**
 * An identifying User-Agent carrying contact information; conditional requests;
 * coordinates truncated to four decimals; and a request rate well inside the
 * published ceiling. Excess coordinate precision is a documented 403 cause, so
 * the truncation below is a correctness requirement rather than tidiness.
 *
 * **Errors are plain fixed-message `Error`s, never `ApiError`.**
 * `ApiServiceName` is a closed union and this is a peripheral service, so the
 * union is not edited. The API is keyless, so there is no secret to leak — the
 * house pattern is uniform and cheap to keep, and since none of these messages
 * reaches a user a detailed one would buy nothing and risk something.
 *
 * Live shapes verified 2026-09-11: `Last-Modified` and `Expires` are published
 * and **no `ETag`** is, so the conditional request is `If-Modified-Since` and
 * nothing in this repo's JMA precedent transfers but its structure.
 */

import axios, { AxiosInstance } from 'axios';
import type { MetnoForecastResponse } from '../types/metno.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { logger } from '../utils/logger.js';
import { VERSION } from '../utils/version.js';
import {
  METNO_MAX_RESPONSE_BYTES,
  aggregateMetnoDaily,
} from '../utils/metnoParse.js';
import type { MetnoDailyAggregate } from '../utils/metnoParse.js';

/** The one endpoint this service reads. */
const METNO_FORECAST_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';

/**
 * Descriptive User-Agent for this service only, per the METAR precedent — does
 * not touch the shared `getUserAgent()`.
 *
 * met.no's ToS: *"All requests must (if possible) include an identifying User
 * Agent-string (UA) in the request where we can find contact information. If we
 * cannot contact you in case of problems, you risk being blocked without
 * warning."* The shared helper returns a bare `weather-mcp/<version>` with no
 * contact at all, which would satisfy neither half of that sentence.
 */
const METNO_USER_AGENT = `weather-mcp/${VERSION} (+https://github.com/weather-mcp/weather-mcp)`;

/**
 * How long a cached aggregate is served with no request to met.no at all.
 *
 * Reuses the existing forecast TTL rather than adding a number, exactly as the
 * JMA service reuses `alerts`. This is the **freshness** clock and is
 * deliberately much shorter than `CacheConfig.ttl.metnoForecast`, which is
 * **retention** — how long the parse is kept so a conditional revalidation has
 * something to reuse. Past this interval the entry is revalidated, not
 * discarded.
 */
const METNO_FRESHNESS_MS = CacheConfig.ttl.forecast;

/** Decimal places every coordinate is reduced to before it reaches a URL or a cache key. */
const METNO_COORDINATE_DECIMALS = 4;

/**
 * What a cache entry holds: the aggregate, its validator, and when met.no last
 * confirmed it current.
 *
 * **The validator lives here and never on the instance.** The MCP SDK starts
 * every `tools/call` on its own promise chain and this service is a
 * module-level singleton, so any `await` is a window in which another request
 * overwrites an instance field — a `lastModified` on `this` would replay one
 * point's validator against another point's URL (G43). There is no `last*` or
 * `current*` field on this class, by construction.
 */
interface CachedForecast {
  /** The aggregate as `aggregateMetnoDaily` built it. Reused verbatim on a 304. */
  result: MetnoDailyAggregate;
  /** `Last-Modified` as served, replayed verbatim as `If-Modified-Since`. */
  lastModified?: string;
  /** Epoch ms of the last 200 or 304 — *not* of the last parse. */
  revalidatedAt: number;
}

/** Minimal structural shape of an axios-style error, checked without `any`. */
interface AxiosLikeError {
  code?: string;
  message?: string;
  response?: { status?: number; headers?: Record<string, unknown> };
}

/**
 * Structural guard rather than `axios.isAxiosError`: unit tests mock the axios
 * module down to `default.create`, so an imported helper or an `AxiosError`
 * class reference would be undefined there.
 */
function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === 'object' && error !== null;
}

export interface MetnoServiceConfig {
  timeout?: number;
  /** Injectable clock, so the freshness and retention clocks are testable without faking timers. */
  now?: () => number;
}

export class MetnoService {
  private client: AxiosInstance;
  private cache: Cache<CachedForecast>;
  private inFlight = new Map<string, Promise<CachedForecast>>();
  private now: () => number;

  constructor(config: MetnoServiceConfig = {}) {
    const { timeout = CacheConfig.apiTimeoutMs, now = () => Date.now() } = config;

    this.now = now;
    this.cache = new Cache(CacheConfig.maxSize);
    this.client = axios.create({
      timeout,
      headers: {
        Accept: 'application/json',
        'User-Agent': METNO_USER_AGENT,
      },
      // A 3xx is an error and is never followed.
      maxRedirects: 0,
      // Applies to the decompressed body. Measured live 2026-09-11 at Oslo,
      // Tokyo and Denver: 93,237 bytes was the largest of the three, so this
      // cap sits about 21x above an observed figure rather than at a default.
      maxContentLength: METNO_MAX_RESPONSE_BYTES,
      maxBodyLength: METNO_MAX_RESPONSE_BYTES,
      // A 304 must reach us as a value, not as an exception — it is the
      // success case for a revalidation. Without this line the whole
      // conditional-request design is dead code.
      validateStatus: status => (status >= 200 && status < 300) || status === 304,
    });
  }

  /**
   * The daily aggregate for one point, revalidated conditionally once it is
   * older than `METNO_FRESHNESS_MS`.
   *
   * @param latitude Latitude in degrees.
   * @param longitude Longitude in degrees.
   * @param timezone IANA zone (or fixed-offset zone) the days are bucketed in.
   *   met.no publishes UTC timestamps and no timezone of its own, so the caller
   *   names the zone and the render site discloses which one it used.
   */
  async getForecast(
    latitude: number,
    longitude: number,
    timezone: string
  ): Promise<MetnoDailyAggregate> {
    // Truncate once, at the top, and use the truncated pair for **both** the
    // request and the cache key. A key built from the untruncated pair would
    // store one answer under unboundedly many keys and defeat the very cache
    // met.no's ToS is asking for.
    const lat = roundCoordinate(latitude);
    const lon = roundCoordinate(longitude);

    // Components are passed separately, never pre-joined: `Cache.generateKey`
    // joins with an unescaped `:` (G5). The first four are literals and
    // numbers; `timezone` is the only string and it is last, so a colon inside
    // it cannot shift the boundary of any earlier component.
    const cacheKey = Cache.generateKey('metno', 'forecast', lat, lon, timezone);

    const cached = this.cache.get(cacheKey);
    if (cached && this.now() - cached.revalidatedAt < METNO_FRESHNESS_MS) {
      return cached.result;
    }

    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      return (await existing).result;
    }

    const pull = this.pull(cacheKey, lat, lon, timezone, cached).finally(() => {
      // Deleted in a `finally`, so a rejected pull is neither cached nor left
      // behind: the next caller retries rather than awaiting a dead promise.
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, pull);
    return (await pull).result;
  }

  /** One upstream round trip, including the 304 paths. */
  private async pull(
    cacheKey: string,
    lat: number,
    lon: number,
    timezone: string,
    cached: CachedForecast | undefined
  ): Promise<CachedForecast> {
    let response;
    try {
      response = await this.client.get<MetnoForecastResponse>(METNO_FORECAST_URL, {
        params: { lat, lon },
        ...(cached?.lastModified
          ? { headers: { 'If-Modified-Since': cached.lastModified } }
          : {}),
      });
    } catch (error) {
      this.logFailure(error);
      throw this.toMetnoError(error);
    }

    // A 304 with nothing to serve. `validateStatus` admits 304 because a
    // revalidation's success case *is* a 304 with zero bytes — but that depends
    // on holding a cached aggregate to reuse, and here there is none. No
    // `If-Modified-Since` was sent on this pull (the header above is
    // conditional on `cached?.lastModified`), so a conforming origin cannot
    // answer 304 at all; an intermediary can. Falling through would hand an
    // empty body to the aggregator and report "carries no timeseries" — a true
    // description of our own empty object and a false one of what happened.
    //
    // This is the v1.27.1 bug, shipped one release ago: it must never become an
    // empty result.
    if (response.status === 304 && !cached) {
      logger.error('MET Norway request failed', undefined, {
        service: 'MetNo',
        operation: 'forecast',
        status: 304,
      });
      throw new Error('MET Norway forecast revalidation returned no content');
    }

    // 304: met.no says the aggregate we hold is current. Zero bytes, no
    // re-aggregation — only the freshness stamp moves.
    if (response.status === 304 && cached) {
      const revalidated: CachedForecast = { ...cached, revalidatedAt: this.now() };
      this.cache.set(cacheKey, revalidated, CacheConfig.ttl.metnoForecast);
      return revalidated;
    }

    const result = aggregateMetnoDaily(response.data ?? {}, timezone);

    const lastModified = response.headers?.['last-modified'];
    const fresh: CachedForecast = {
      result,
      ...(typeof lastModified === 'string' ? { lastModified } : {}),
      revalidatedAt: this.now(),
    };
    this.cache.set(cacheKey, fresh, CacheConfig.ttl.metnoForecast);
    return fresh;
  }

  /**
   * Map a request failure to a fixed message. Never includes a URL, a response
   * body, a coordinate, or a raw axios error.
   */
  private toMetnoError(error: unknown): Error {
    if (isAxiosLikeError(error)) {
      // Checked *before* the `response` branch: an oversize-body rejection
      // carries no `response` at all, so testing `error.response` first would
      // misclassify it as a connection failure.
      if (error.code === 'ERR_BAD_RESPONSE' && /maxContentLength/.test(error.message ?? '')) {
        return new Error('MET Norway forecast response too large');
      }

      if (error.response) {
        const status = error.response.status;
        if (status === 429) {
          return new Error('MET Norway forecast rate limit exceeded');
        }
        // **403 is unavailable-or-throttled, never a permanent
        // misconfiguration.** An 8-point sweep in ~5 s once returned 403 on 5
        // of 8 and follow-up probes did not reproduce it; the cause was never
        // isolated, and the design is allowed not to know. What it must not do
        // is treat a 403 as "our request is wrong forever" — it is the same
        // "met.no is not available right now" answer a 5xx gives.
        if (status === 403 || (status !== undefined && status >= 500)) {
          return new Error('MET Norway forecast is not available');
        }
        return new Error(`MET Norway forecast returned status ${status}`);
      }

      if (
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ERR_CANCELED'
      ) {
        return new Error('MET Norway forecast request timed out');
      }

      if (
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'EAI_AGAIN' ||
        error.code === 'EPIPE'
      ) {
        return new Error('Unable to connect to MET Norway');
      }
    }

    return new Error('Unknown error occurred while contacting MET Norway');
  }

  /**
   * Log a failure with status and code only.
   *
   * The `Error` slot is deliberately left empty: the logger renders the message
   * and stack of whatever it is handed, and an axios error carries the request
   * URL — which here carries the caller's coordinates.
   */
  private logFailure(error: unknown): void {
    const failure = isAxiosLikeError(error) ? error : undefined;
    const status = failure?.response?.status;
    logger.warn('MET Norway request failed', {
      service: 'MetNo',
      operation: 'forecast',
      ...(status !== undefined ? { status } : {}),
      ...(failure?.code !== undefined ? { code: failure.code } : {}),
      // A 403 here is the throttling signal met.no's ToS warns about, and it is
      // the one status worth noticing in a log sweep.
      ...(status === 403 ? { securityEvent: true } : {}),
    });
  }
}

/**
 * A coordinate reduced to met.no's published precision limit.
 *
 * Four decimals is ~11 m, and excess precision is a documented 403 cause. It is
 * also already this handler's display precision — `formatOpenMeteoForecast`
 * renders `latitude.toFixed(4)` — so nothing about the rendered location moves.
 */
function roundCoordinate(value: number): number {
  return Number(value.toFixed(METNO_COORDINATE_DECIMALS));
}
