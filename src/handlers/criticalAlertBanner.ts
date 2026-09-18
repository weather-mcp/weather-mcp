/**
 * The one place that fetches for the life-threatening alert banner.
 *
 * `get_forecast`, `get_current_conditions` and `get_weather_summary` all call
 * `resolveCriticalAlertBanner` rather than each doing their own fetch-gate-format
 * sequence, so the **failure posture exists once**. Three copies of a safety
 * failure posture is how one copy drifts, and the copy that drifts is the one
 * that renders a fabricated all-clear.
 *
 * The posture itself is D1 of the design plan: **silent omit**, one
 * `logger.warn`, and no retries. That is only safe because the banner is a
 * positive assertion — its absence claims nothing. `get_alerts` still serves
 * the same data under full contract rules, where a failure propagates. Nothing
 * in a tool description, schema or doc may ever say these three tools "check
 * for alerts", or absence silently becomes an implied all-clear.
 *
 * The gate, the selection and the copy all live in `src/utils/criticalAlert.ts`,
 * which is pure and zero-I/O. This module is the glue between that and the
 * service, and holds no display logic of its own.
 */

import { NOAAService } from '../services/noaa.js';
import { isInUS, isInNwsTerritory } from '../utils/geography.js';
import { logger } from '../utils/logger.js';
import type { ResolvedLocation } from '../utils/locationResolver.js';
import {
  formatCriticalAlertBanner,
  selectCriticalAlert,
  type CriticalAlertCandidate,
} from '../utils/criticalAlert.js';

/**
 * The HTTP status an error carries, or `undefined`.
 *
 * Reads the two shapes this path can see — an `ApiError` subclass's
 * `statusCode`, and an axios error's `response.status` — and nothing else. A
 * bare number is the whole of what is logged: no message, no config, no URL.
 */
function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const record = error as { statusCode?: unknown; response?: { status?: unknown } };
  if (typeof record.statusCode === 'number') {
    return record.statusCode;
  }
  if (typeof record.response?.status === 'number') {
    return record.response.status;
  }
  return undefined;
}

/**
 * Country codes that settle NWS jurisdiction **on their own**, with no geography.
 *
 * Two sets, not one with a special case: a single set whose membership means
 * different things for different members is how the next reader gets it wrong.
 * The names state the rule.
 *
 * `'pr'` belongs **here and not in `NWS_CODE_PLUS_BOX`, and that is a correctness
 * constraint rather than a style one.** Puerto Rico lives in `isInUS`, *not* in
 * `isInNwsTerritory` — the new predicate covers only the four territories `isInUS`
 * leaves out. Pairing `'pr'` with the territory box would therefore evaluate
 * `false` and silently drop the banner for every Open-Meteo-geocoded Puerto Rico
 * request, turning a coverage fix into a coverage regression. Tidying it across is
 * the obvious wrong move; a mutation row in the plan pins it, and a relocation has
 * the same red set as a deletion.
 *
 * `us` also stays code-alone because making it conditional on a box would silently
 * narrow behaviour this change does not touch.
 *
 * **Which provider emits which value** (G48 — a fixture value the live resolver
 * never produces proves nothing). `us` comes from Census (`geocoding.ts:150`,
 * hard-coded), from Nominatim (`geocoding.ts:239` — OSM resolves every US
 * territory to `US` at country zoom, measured in issue #86 and again 2026-09-18),
 * and from saved locations. The ISO territory codes `GU`/`MP`/`VI`/`AS`/`PR` come
 * **only** from the Open-Meteo geocoder (`geocoding.ts:334`), the last provider in
 * both `GeocodingService` orders (`:443`, `:447`), reached when the first two
 * return nothing. So `pr` is reachable on that path and nowhere else.
 *
 * COFA codes (`fm`, `pw`, `mh`) are absent from both sets deliberately: sovereign
 * countries, `/points` answers 500, out of scope until someone asks.
 *
 * Lower-cased, as `NIFC_COVERED_COUNTRIES` is (`wildfireHandler.ts:68`); these live
 * beside their only consumer because they are not geography facts.
 */
const NWS_CODE_ALONE: ReadonlySet<string> = new Set(['us', 'pr']);

/**
 * Territory codes that require `isInNwsTerritory` **as well**.
 *
 * A country code is a *fast path* — a resolved location already knows its country,
 * so the common case costs no geography at all — and a fast path must not admit
 * what the authoritative predicate rejects. `MP` is the one code in either set that
 * spans served and unserved area: it names the whole Northern Marianas while NWS
 * accepts only the southern arc, so `'MP'` deciding alone would re-open, through
 * the Open-Meteo geocoder, exactly the northern-CNMI request the box was drawn to
 * prevent — an uncached HTTP 400 and two `securityEvent` warns at the points the
 * box exists to exclude.
 */
const NWS_CODE_PLUS_BOX: ReadonlySet<string> = new Set(['gu', 'mp', 'vi', 'as']);

/**
 * The banner for this point, or `''` — which is every path but one.
 *
 * In order:
 *
 * 1. **NWS-jurisdiction pre-filter.** `country_code` when the resolution path
 *    knew one, geography otherwise — `isInUS` **or** `isInNwsTerritory`, the
 *    latter covering the four territories `isInUS` deliberately leaves out
 *    (Guam, the southern Marianas, the USVI, American Samoa). `isInUS` is not
 *    widened to absorb them because it backs a *rendered* NWPS coverage claim in
 *    `get_river_conditions`, where Puerto Rico is gauged and Guam is not
 *    (GOTCHAS G53). The code path is the two sets above, and there are two of
 *    them because a code settles `us` and `pr` on its own while the four
 *    territory codes must also satisfy `isInNwsTerritory` — `MP` names a
 *    territory NWS serves only the southern half of. NOAA is the only upstream
 *    in v1 (D2), so a point outside NWS jurisdiction returns without making any
 *    request at all.
 * 2. **One fetch, no retries.** `getAlerts` caches on its own point-keyed
 *    alerts entry with the five-minute alerts TTL (`src/services/noaa.ts`), so a
 *    banner fetch and a real `get_alerts` call within five minutes share one
 *    request. This module deliberately builds no key and declares no TTL of its
 *    own — that is what keeps risk floor F5 untripped, and the acceptance check
 *    for it is a grep of this file for either construct.
 * 3. **Any failure is silent.** One `logger.warn` and `''`. Never a
 *    "could not check alerts" note: repeated benign warnings during an upstream
 *    outage train readers to ignore the banner slot, which is worse than
 *    nothing at all.
 * 4. **All-or-nothing.** With no critical alert this emits nothing — no header,
 *    no rule, no "no critical alerts" line.
 *
 * **G53 is not tripped by the pre-filter.** These are bounding boxes, but
 * nothing about any box is rendered: a false negative omits a
 * positive-assertion-only element and claims nothing.
 *
 * **A false positive is not free, and the old wording here was wrong about it.**
 * A point the CONUS or Hawaii box admits but NWS does not serve — Toronto
 * `43.65, -79.38`; Midway `28.21, -177.38`, which sits inside the Hawaii box —
 * draws **HTTP 400 `Parameter "point" is invalid: out of bounds`**, not a
 * 200-empty collection. `NOAAService.makeRequest` (`noaa.ts:133-138`) logs a
 * `securityEvent` warn and throws `InvalidLocationError`; this module's catch
 * logs a second; and `getAlerts` never caches a failure, so every call repeats
 * both. That cost is known, deferred (it needs either a narrowed shared routing
 * box or a 4xx-branch change in `noaa.ts`, both beyond the banner), and it is
 * the reason `isInNwsTerritory`'s boxes are drawn tightly to the islands rather
 * than generously — unlike `isInGreatBritain`, whose false positive is one cheap
 * Nominatim call.
 *
 * @param noaaService The NOAA client; its `getAlerts` is the only method called
 * @param resolved The already-resolved location, carrying `country_code` when known
 * @param timezone IANA zone the banner's expiry is rendered in
 * @returns The formatted banner, or `''`
 */
export async function resolveCriticalAlertBanner(
  noaaService: NOAAService,
  resolved: ResolvedLocation,
  timezone?: string
): Promise<string> {
  const { latitude, longitude } = resolved;

  // country_code first, geography second. A saved or geocoded location already
  // knows its country, so the common case costs no geography at all. Casing
  // follows the upstream source (saved locations store "US", geocoders vary),
  // hence the case-insensitive compare.
  //
  // The conjunction on the territory arm is not decoration: a code from
  // NWS_CODE_PLUS_BOX must also satisfy the box, because `MP` names a territory
  // NWS serves only the southern half of. See the two sets' comments above.
  const countryCode =
    typeof resolved.country_code === 'string' && resolved.country_code.length > 0
      ? resolved.country_code.toLowerCase()
      : undefined;

  const isNwsServed =
    countryCode !== undefined
      ? NWS_CODE_ALONE.has(countryCode) ||
        (NWS_CODE_PLUS_BOX.has(countryCode) && isInNwsTerritory(latitude, longitude))
      : isInUS(latitude, longitude) || isInNwsTerritory(latitude, longitude);

  if (!isNwsServed) {
    return '';
  }

  try {
    const alerts = await noaaService.getAlerts(latitude, longitude, true);

    const features = Array.isArray(alerts?.features) ? alerts.features : [];
    if (features.length === 0) {
      return '';
    }

    // `properties` is required on the documented shape but a third-party
    // response may omit it, so the map tolerates a feature without one rather
    // than throwing inside a garnish path.
    const candidates: CriticalAlertCandidate[] = features.map(
      (feature) => (feature?.properties ?? {}) as CriticalAlertCandidate
    );

    return formatCriticalAlertBanner(selectCriticalAlert(candidates), features.length, timezone);
  } catch (error) {
    // Exactly one warn, carrying no URL and no raw axios error. The banner is
    // garnish (D1): this must add no latency and must never rethrow, because
    // the forecast the caller actually asked for still has to render.
    //
    // The impl plan's contract is "no URL and no raw axios error", and
    // `error.message` was carrying exactly that — "Request failed with status
    // code 503" is the axios message, and an axios message is one upstream
    // change away from carrying the request URL with it. What is logged is
    // therefore the error's *type* and its status, the shape this project
    // already uses for key-bearing services, which is what a reader of these
    // logs actually needs to tell a 404 from an outage.
    logger.warn('Critical-alert banner lookup failed; omitting the banner', {
      service: 'NOAA',
      securityEvent: true,
      errorType: error instanceof Error ? error.constructor.name : 'Unknown',
      status: httpStatusOf(error),
    });
    return '';
  }
}

/**
 * The banner a failed weather request is carrying, if any.
 *
 * A `Symbol.for` key rather than a named property: it cannot collide with any
 * field on an `ApiError` subclass, it does not appear in `JSON.stringify`, and
 * it survives being rethrown unchanged through the handlers' existing
 * fallback `catch` blocks.
 */
const CRITICAL_ALERT_BANNER = Symbol.for('weather-mcp.critical-alert-banner');

/**
 * Carry an already-resolved banner on an error about to be thrown.
 *
 * `get_forecast` and `get_current_conditions` resolve the banner concurrently
 * with the weather body. When the body fails, the warning is the half the
 * caller most needs, so it travels with the error to the one place that renders
 * errors (`src/server/weatherServer.ts`) instead of being dropped. This keeps error formatting
 * and error logging at that single site rather than duplicating either here.
 *
 * An empty banner attaches nothing at all, so a failure with no critical alert
 * — every point outside NWS jurisdiction, and every point inside it with nothing
 * life-threatening active — is byte-identical to what it was before.
 *
 * @param error The error being thrown; returned unchanged for `throw` chaining
 * @param banner The resolved banner, or `''`
 * @returns The same error
 */
export function carryCriticalAlertBannerOnError(error: unknown, banner: string): unknown {
  if (banner && typeof error === 'object' && error !== null) {
    (error as Record<symbol, unknown>)[CRITICAL_ALERT_BANNER] = banner;
  }
  return error;
}

/**
 * The banner carried by an error, or `''`.
 *
 * Read once, by the dispatch's error path. Returning `''` for every error that
 * carries nothing is what keeps the existing error output unchanged.
 *
 * @param error The caught error
 * @returns The carried banner, or `''`
 */
export function criticalAlertBannerFromError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const banner = (error as Record<symbol, unknown>)[CRITICAL_ALERT_BANNER];
    if (typeof banner === 'string') {
      return banner;
    }
  }
  return '';
}
