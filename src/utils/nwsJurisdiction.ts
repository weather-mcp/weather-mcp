/**
 * NWS alert-authority country codes (pure, no imports).
 *
 * Two consumers: the critical-alert banner (`resolveCriticalAlertBanner` in
 * `src/handlers/criticalAlertBanner.ts`) and `get_alerts`'s country router
 * (`src/handlers/alertsHandler.ts`, via `isNwsCountryCode`).
 *
 * **The banner applies `NWS_CODE_PLUS_BOX` together with `isInNwsTerritory`;
 * `get_alerts` deliberately does not.** On 2026-11-11 NWS answered HTTP 200 at
 * Pagan (18.12, 145.76) and the other northern Marianas, which lie outside the
 * `isInNwsTerritory` box. A box-gated router would claim "not covered" where
 * NOAA serves. The banner is a positive-assertion-only element that may omit
 * itself; a router that claims coverage may not.
 */

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
 * never produces proves nothing). `us` comes from Census (`CensusGovProvider`
 * hard-codes `'US'`), from Nominatim (`NominatimProvider` upper-cases
 * `address.country_code`; OSM resolves every US territory to `US` at country
 * zoom, measured in issue #86 and again 2026-09-18), and from saved locations.
 * The ISO territory codes `GU`/`MP`/`VI`/`AS`/`PR` come **only** from the
 * Open-Meteo geocoder (`OpenMeteoProvider` passes `item.country_code` through),
 * the last provider in every provider order `GeocodingService` builds, reached
 * when the first two return nothing. So `pr` is reachable on that path and
 * nowhere else.
 *
 * COFA codes (`fm`, `pw`, `mh`) are absent from both sets deliberately: sovereign
 * countries, `/points` answers 500, out of scope until someone asks.
 *
 * Lower-cased, as `NIFC_COVERED_COUNTRIES` is (`wildfireHandler.ts`); these are
 * not geography facts, which is why they live apart from `geography.ts`.
 */
export const NWS_CODE_ALONE: ReadonlySet<string> = new Set(['us', 'pr']);

/**
 * Territory codes that require `isInNwsTerritory` **as well**, wherever the
 * caller is the banner (see the module header: `get_alerts` does not apply it).
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
export const NWS_CODE_PLUS_BOX: ReadonlySet<string> = new Set(['gu', 'mp', 'vi', 'as']);

/** Lower-cased code → true when NWS is the alert authority for that country code, with no geography. */
export function isNwsCountryCode(code: string): boolean {
  return NWS_CODE_ALONE.has(code) || NWS_CODE_PLUS_BOX.has(code);
}
