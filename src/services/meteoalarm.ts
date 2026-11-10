/**
 * Service for the MeteoAlarm country warning feeds
 * (https://feeds.meteoalarm.org/api/v1/warnings/feeds-<country>).
 *
 * MeteoAlarm (EUMETNET) aggregates the official severe-weather warnings of
 * the European national meteorological services as keyless per-country CAP
 * JSON feeds. There is no pan-Europe aggregate on the keyless tier — one
 * fetch per country.
 *
 * Load-bearing behaviours, all observed live (2026-08-13):
 * - `info[]` is duplicated per language; the `en`-prefixed entry is selected
 *   with a fallback to the first.
 * - Feeds contain expired warnings (Germany: 161 published, 51 unexpired) —
 *   client-side expiry filtering is mandatory, and it must run at **read
 *   time**: a cached list must never serve a warning that expired since it
 *   was cached.
 * - `Update` messages carry `references` to the identifiers they replace;
 *   after expiry filtering, warnings referenced by a surviving Update are
 *   dropped (supersession).
 * - Payloads are large and uncompressed (Germany 2.76 MB) — the parsed
 *   result is cached for the alerts TTL (5 min) and the feed is never
 *   fetched per-request without the cache in front.
 *
 * Errors are `MeteoAlarmRequestError`s with fixed, pre-written messages (the
 * GeoMet precedent — no `ApiError` union change): upstream body text and
 * axios text are never forwarded, and the retry decision is the error's
 * `transient` flag, never its message.
 *
 * Licence terms honoured downstream (renderer): alerts display unmodified,
 * attribution "EUMETNET – MeteoAlarm" plus the national service, time of
 * issue always shown.
 */

import axios, { AxiosInstance } from 'axios';
import type {
  MeteoAlarmCapInfo,
  MeteoAlarmCountryFeed,
  MeteoAlarmFeedResponse,
  MeteoAlarmFeedWarning,
  MeteoAlarmWarning
} from '../types/meteoalarm.js';
import { logger } from '../utils/logger.js';
import { getUserAgent } from '../utils/version.js';
import { Cache } from '../utils/cache.js';
import { withRequestDeadline } from '../utils/httpDeadline.js';
import { isConnectionFailureCode } from '../utils/connectionFailure.js';
import { CacheConfig } from '../config/cache.js';

export interface MeteoAlarmServiceConfig {
  baseURL?: string;
  timeout?: number;
}

/**
 * MeteoAlarm membership: lowercase ISO 3166-1 alpha-2 country code → feed
 * slug, display name, and (where known) the national meteorological service
 * for the attribution footer.
 *
 * Every slug in this table was live-verified (HTTP 200 JSON with a
 * `warnings` array) on 2026-08-13 — 38/38 members passed after one
 * correction (`mk`: `north-macedonia` 404'd; the live slug is
 * `republic-of-north-macedonia`). A country absent from this map routes to
 * the not-covered message by design, so the map degrades gracefully; never
 * add an unverified slug.
 */
export const COUNTRY_FEEDS: Record<string, MeteoAlarmCountryFeed> = {
  at: { slug: 'austria', name: 'Austria', service: 'GeoSphere Austria' },
  be: { slug: 'belgium', name: 'Belgium', service: 'Royal Meteorological Institute of Belgium' },
  ba: { slug: 'bosnia-herzegovina', name: 'Bosnia and Herzegovina' },
  bg: { slug: 'bulgaria', name: 'Bulgaria' },
  hr: { slug: 'croatia', name: 'Croatia', service: 'DHMZ' },
  cy: { slug: 'cyprus', name: 'Cyprus' },
  cz: { slug: 'czechia', name: 'Czechia', service: 'CHMI' },
  dk: { slug: 'denmark', name: 'Denmark', service: 'Danish Meteorological Institute' },
  ee: { slug: 'estonia', name: 'Estonia' },
  fi: { slug: 'finland', name: 'Finland', service: 'Finnish Meteorological Institute' },
  fr: { slug: 'france', name: 'France', service: 'Météo-France' },
  de: { slug: 'germany', name: 'Germany', service: 'Deutscher Wetterdienst' },
  gr: { slug: 'greece', name: 'Greece', service: 'Hellenic National Meteorological Service' },
  hu: { slug: 'hungary', name: 'Hungary' },
  is: { slug: 'iceland', name: 'Iceland', service: 'Icelandic Meteorological Office' },
  ie: { slug: 'ireland', name: 'Ireland', service: 'Met Éireann' },
  il: { slug: 'israel', name: 'Israel', service: 'Israel Meteorological Service' },
  it: { slug: 'italy', name: 'Italy' },
  lv: { slug: 'latvia', name: 'Latvia' },
  lt: { slug: 'lithuania', name: 'Lithuania' },
  lu: { slug: 'luxembourg', name: 'Luxembourg' },
  mt: { slug: 'malta', name: 'Malta' },
  md: { slug: 'moldova', name: 'Moldova' },
  me: { slug: 'montenegro', name: 'Montenegro' },
  nl: { slug: 'netherlands', name: 'Netherlands', service: 'KNMI' },
  mk: { slug: 'republic-of-north-macedonia', name: 'North Macedonia' },
  no: { slug: 'norway', name: 'Norway', service: 'MET Norway' },
  pl: { slug: 'poland', name: 'Poland', service: 'IMGW-PIB' },
  pt: { slug: 'portugal', name: 'Portugal', service: 'IPMA' },
  ro: { slug: 'romania', name: 'Romania' },
  rs: { slug: 'serbia', name: 'Serbia' },
  sk: { slug: 'slovakia', name: 'Slovakia', service: 'SHMÚ' },
  si: { slug: 'slovenia', name: 'Slovenia', service: 'ARSO' },
  es: { slug: 'spain', name: 'Spain', service: 'AEMET' },
  se: { slug: 'sweden', name: 'Sweden', service: 'SMHI' },
  ch: { slug: 'switzerland', name: 'Switzerland', service: 'MeteoSwiss' },
  gb: { slug: 'united-kingdom', name: 'United Kingdom', service: 'UK Met Office' },
  ua: { slug: 'ukraine', name: 'Ukraine' }
};

/**
 * Whether a country (lowercase ISO 3166-1 alpha-2 code) has a MeteoAlarm
 * feed in the verified membership map.
 */
export function isMeteoAlarmCountry(countryCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(COUNTRY_FEEDS, countryCode);
}

/**
 * Select the language variant to render: the first `en`-prefixed `info`
 * entry (`en`, `en-GB`, …), falling back to the first entry. Feeds without
 * an English variant render in their own language, unmodified (a licence
 * term either way).
 */
export function selectEnglishInfo(info: MeteoAlarmCapInfo[] | undefined): MeteoAlarmCapInfo | undefined {
  if (!info || info.length === 0) {
    return undefined;
  }
  return info.find(entry => (entry.language ?? '').toLowerCase().startsWith('en')) ?? info[0];
}

/**
 * Parse a MeteoAlarm `awareness_level` parameter value
 * (`"2; yellow; Moderate"`) into its colour segment, lowercased. Malformed
 * values return `undefined` — never a throw.
 */
export function parseAwarenessColour(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parts = value.split(';').map(part => part.trim().toLowerCase());
  const colour = parts[1];
  if (!colour || !/^[a-z]+$/.test(colour)) {
    return undefined;
  }
  return colour;
}

/**
 * Extract the referenced identifiers from a CAP `references` value: a
 * space-separated list of `sender,identifier,sent` triples. Entries without
 * a comma are taken as bare identifiers (permissive — feeds vary).
 */
export function parseReferences(references: string | undefined): string[] {
  if (!references) {
    return [];
  }
  const identifiers: string[] = [];
  for (const triple of references.trim().split(/\s+/)) {
    if (!triple) {
      continue;
    }
    const parts = triple.split(',');
    const identifier = parts.length >= 2 ? parts[1] : parts[0];
    if (identifier) {
      identifiers.push(identifier);
    }
  }
  return identifiers;
}

/**
 * Read-time filter pipeline, in order:
 *  1. drop non-`Actual` status and `Cancel` messages;
 *  2. drop warnings already expired at `now`;
 *  3. drop warnings whose identifier is referenced by a *surviving* `Update`
 *     (supersession — deliberately after expiry, so references held by
 *     expired Updates are inert).
 *
 * Pure and exported for tests; `getWarnings` applies it on every return,
 * cached or fresh — a stale cache entry must never serve a warning that
 * expired after it was cached.
 */
export function filterActiveWarnings(warnings: MeteoAlarmWarning[], now: Date): MeteoAlarmWarning[] {
  const current = warnings.filter(warning => {
    if (warning.status !== undefined && warning.status !== 'Actual') {
      return false;
    }
    if (warning.msgType === 'Cancel') {
      return false;
    }
    if (warning.expires) {
      const expires = new Date(warning.expires);
      if (!isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) {
        return false;
      }
    }
    return true;
  });

  const superseded = new Set<string>();
  for (const warning of current) {
    if (warning.msgType === 'Update') {
      for (const identifier of warning.references) {
        superseded.add(identifier);
      }
    }
  }

  return current.filter(warning => !superseded.has(warning.identifier));
}

/**
 * A MeteoAlarm failure already classified by `handleError`. `transient` is the
 * retry decision — read by `makeRequest`, decided in exactly one place. A plain
 * `Error` subclass on purpose: MeteoAlarm is outside `ApiServiceName` (CLAUDE.md,
 * Error Handling), so `formatErrorForUser` renders `Error: <message>` unchanged.
 */
class MeteoAlarmRequestError extends Error {
  constructor(message: string, public readonly transient: boolean) {
    super(message);
    this.name = 'MeteoAlarmRequestError';
  }
}

/**
 * MeteoAlarm country feed client. No API key required.
 */
export class MeteoAlarmService {
  private client: AxiosInstance;
  private cache: Cache<unknown>;
  private maxRetries = 3;

  constructor(config: MeteoAlarmServiceConfig = {}) {
    const {
      baseURL = 'https://feeds.meteoalarm.org/api/v1/warnings',
      timeout = CacheConfig.apiTimeoutMs
    } = config;

    this.cache = new Cache(CacheConfig.maxSize);

    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': getUserAgent()
      },
      adapter: withRequestDeadline(),
    });

    this.client.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );
  }

  /**
   * Fetch the current warnings for a MeteoAlarm member country.
   *
   * The **parsed** (unfiltered) warning list is cached for the alerts TTL —
   * one worst-case 2.8 MB country fetch per 5 minutes — and
   * `filterActiveWarnings` runs on every return so expiry and supersession
   * are always evaluated against the caller's `now`.
   *
   * @param countryCode Lowercase ISO 3166-1 alpha-2 code of a member country
   * @throws {Error} If the country is not in the verified membership map, or
   *   the feed request fails.
   */
  async getWarnings(countryCode: string): Promise<MeteoAlarmWarning[]> {
    const feed = COUNTRY_FEEDS[countryCode];
    if (!feed) {
      throw new Error(`No MeteoAlarm feed for country code "${countryCode}"`);
    }

    const cacheKey = Cache.generateKey('meteoalarm', countryCode);
    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey) as MeteoAlarmWarning[] | undefined;
      if (cached) {
        logger.info('MeteoAlarm cache hit', { country: countryCode });
        return filterActiveWarnings(cached, new Date());
      }
    }

    logger.info('MeteoAlarm feed fetch', { country: countryCode, slug: feed.slug });
    const data: unknown = await this.makeRequest<unknown>(`/feeds-${feed.slug}`);
    // A 200 whose body is not the verified envelope is an error, never an empty list (G4).
    // Thrown outside `makeRequest`, so it is never retried, and before `cache.set`, so never cached.
    if (!isMeteoAlarmFeed(data)) {
      logger.warn('MeteoAlarm feed returned an unexpected shape', {
        country: countryCode,
        securityEvent: true
      });
      throw new MeteoAlarmRequestError('MeteoAlarm feed returned an unexpected shape', false);
    }
    const warnings = parseFeed(data);

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, warnings, CacheConfig.ttl.alerts);
    }

    return filterActiveWarnings(warnings, new Date());
  }

  /**
   * Request with retry/backoff: a 429, a 5xx or a failed connection is
   * retried up to `maxRetries` times with exponential backoff and jitter; a
   * timeout and any other status are not. The decision is
   * `MeteoAlarmRequestError.transient`, set once in `handleError` — the
   * thrown message is never read.
   * @private
   */
  private async makeRequest<T>(url: string, retries = 0): Promise<T> {
    try {
      const response = await this.client.get<T>(url);
      return response.data;
    } catch (error) {
      if (retries < this.maxRetries && error instanceof MeteoAlarmRequestError && error.transient) {
        const baseDelay = Math.pow(2, retries) * 1000;
        const delay = baseDelay * (0.5 + Math.random() * 0.5);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequest<T>(url, retries + 1);
      }
      throw error;
    }
  }

  /**
   * Normalize API failures into `MeteoAlarmRequestError`s with fixed,
   * pre-written messages — upstream body text and axios text are never
   * forwarded; the alerts handler formats messages for users.
   * @private
   */
  private async handleError(error: unknown): Promise<never> {
    if (isAxiosLikeError(error)) {
      if (error.response) {
        const status = error.response.status;
        if (status === 429) {
          throw new MeteoAlarmRequestError('MeteoAlarm API rate limit exceeded', true);
        }
        if (status >= 500) {
          throw new MeteoAlarmRequestError(`MeteoAlarm API server error (status ${status})`, true);
        }
        throw new MeteoAlarmRequestError(`MeteoAlarm API returned status ${status}`, false);
      }

      // Not retried: a timeout has exhausted either its own deadline
      // (API_TIMEOUT_MS, 30 s by default) or the enclosing tool call's
      // remaining budget (`toolBudget.ts`); either way a retry would answer
      // after the client has given up — the v1.34.2 rule for NOAA and
      // Open-Meteo. Checked before the connection set, which excludes it.
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new MeteoAlarmRequestError('MeteoAlarm request timed out', false);
      }

      // The retry flag (`true`) is MeteoAlarm's own decision, not the util's.
      if (isConnectionFailureCode(error.code)) {
        throw new MeteoAlarmRequestError('Unable to connect to the MeteoAlarm feed service', true);
      }

      if ((error as { message?: unknown }).message) {
        throw new MeteoAlarmRequestError('MeteoAlarm request failed', false);
      }
    }

    // `isAxiosLikeError` accepts any object, so this rethrow is reached only
    // by an `Error` whose message is empty — there is no text to forward.
    if (error instanceof Error) {
      throw error;
    }

    throw new MeteoAlarmRequestError('Unknown error occurred while contacting MeteoAlarm', false);
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

/**
 * Minimal structural shape of an axios-style error, checked without `any`.
 * Deliberately carries no `message` field: `handleError` never forwards
 * upstream body text or the HTTP client's own text.
 */
interface AxiosLikeError {
  response?: { status: number };
  code?: string;
}

function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === 'object' && error !== null;
}

/** A JSON object — not `null`, not an array, not a string (G4, G111: `''` is the real empty body). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The verified feed envelope: an object whose `warnings` is an array of objects. */
type MeteoAlarmFeedEnvelope = MeteoAlarmFeedResponse & { warnings: MeteoAlarmFeedWarning[] };

/**
 * True for one `warnings[]` entry in the verified shape. `parseFeed` skips an
 * entry with no `alert`, no `identifier` or no `info`, so each of those may be
 * **absent**. When present it must be the verified type: `alert` an object,
 * `identifier` a string, `info` an array of objects. Otherwise a malformed entry
 * would be skipped like an empty one, and a feed of them would render the
 * all-clear (G4, one level down). All 3,612 entries of the 38 live feeds had the
 * full shape on 2026-11-10.
 */
function isMeteoAlarmEntry(entry: unknown): boolean {
  if (!isPlainObject(entry)) {
    return false;
  }
  if (entry.alert === undefined) {
    return true;
  }
  const alert = entry.alert;
  if (!isPlainObject(alert)) {
    return false;
  }
  if (alert.identifier !== undefined && typeof alert.identifier !== 'string') {
    return false;
  }
  return alert.info === undefined || (Array.isArray(alert.info) && alert.info.every(isPlainObject));
}

/**
 * True only for the verified envelope `{ warnings: [ {…}, … ] }` whose every
 * entry passes `isMeteoAlarmEntry`. An HTML page, a gateway's `{ error }`
 * object, `''`, `null`, a bare array, or any malformed entry is refused; the
 * caller throws rather than reading an empty list.
 */
function isMeteoAlarmFeed(data: unknown): data is MeteoAlarmFeedEnvelope {
  return isPlainObject(data) && Array.isArray(data.warnings) && data.warnings.every(isMeteoAlarmEntry);
}

/**
 * Parse a country feed into flat single-language warnings. The envelope has
 * already passed `isMeteoAlarmFeed`, so a missing list is not tolerated here.
 * Object entries without an identifier or any `info` content are skipped
 * (nothing to render or track).
 */
function parseFeed(data: MeteoAlarmFeedEnvelope): MeteoAlarmWarning[] {
  const warnings: MeteoAlarmWarning[] = [];

  for (const entry of data.warnings) {
    const alert = entry.alert;
    if (!alert?.identifier) {
      continue;
    }

    const info = selectEnglishInfo(alert.info);
    if (!info) {
      continue;
    }

    const awarenessLevel = info.parameter?.find(
      parameter => parameter.valueName === 'awareness_level'
    )?.value;

    warnings.push({
      identifier: alert.identifier,
      status: alert.status,
      msgType: alert.msgType,
      references: parseReferences(alert.references),
      event: info.event,
      severity: info.severity,
      colour: parseAwarenessColour(awarenessLevel),
      urgency: info.urgency,
      certainty: info.certainty,
      onset: info.onset,
      expires: info.expires,
      headline: info.headline,
      description: info.description,
      instruction: info.instruction,
      senderName: info.senderName,
      areaDesc: (info.area ?? [])
        .map(area => area.areaDesc)
        .filter((desc): desc is string => typeof desc === 'string' && desc.length > 0),
      sent: alert.sent
    });
  }

  return warnings;
}
