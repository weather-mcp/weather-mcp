# Global Alerts Fallback (Google Weather API) — Design Plan

**Status:** ✅ SETTLED — authored 2026-08-18; reviewed and planned 2026-08-18
(`docs/global-alerts-fallback-implementation-plan.md`).
**Origin:** `docs/planning/GOOGLE_KEY_OPPORTUNITIES.md` #1 — "the killer feature
for the key. If only one more Google integration ever ships, it should be this
one."
**Related:** `docs/global-pollen-fallback-plan.md` (D8–D10 there settle the
key-setup doc pattern, the README "Optional API keys" section + standing key
policy, and per-feature key naming — all inherited here, not re-decided)
**Parent:** `docs/planning/README.md` — **index row deferred**: the pollen
branch currently owns in-flight edits to the planning index; add this doc's
row (💡 or 📝 per its state then) only after that branch lands.
**Target release:** v1.23.0 (next minor after the pollen v1.22.0)
**Branch (for /impl-plan):** `feat/global-alerts-fallback` — create off `main`
**only after `feat/global-pollen-fallback` merges**. Sequencing is a hard
dependency at the docs level, not the code level: this feature adds a fourth
row to the README "Optional API keys" table, a sibling to the
`docs/GOOGLE_POLLEN_KEY_SETUP.md` walkthrough, and a register-row update —
all surfaces the pollen branch creates.

## Upstream verification (web-verified 2026-08-18; live verification pending a key)

Same posture as the pollen plan: the source is **keyed**, the project has no
Google Cloud billing account yet, so everything below is from Google's
published docs (fetched 2026-08-18) with a live to-verify list for T-live.

- **(a) Endpoint:** GET
  `https://weather.googleapis.com/v1/publicAlerts:lookup?key=KEY` with
  `location.latitude`, `location.longitude`, optional `languageCode`
  (translates **`alertTitle` only** — every other field stays in the
  publisher's source language, a provider restriction). API-key auth only;
  no pagination parameters documented.
- **(b) Coverage:** ~45+ territories per the coverage page
  (`developers.google.com/maps/documentation/weather/coverage`). Set-differenced
  against current `get_alerts` coverage (US → NOAA, Canada → ECCC, 38
  MeteoAlarm countries), the **new** territories include: Australia,
  New Zealand, Japan, South Korea, Taiwan, Philippines, Thailand, Singapore,
  Vietnam, Brazil, Mexico, Ecuador, Jamaica, Ghana, Côte d'Ivoire. (The
  research register also lists Colombia; the coverage-page fetch on
  2026-08-18 did not show it — **re-derive the exact set from the live page
  at implementation** and treat any doc list as representative, not
  exhaustive.) Japan / South Korea / Vietnam are *alerts-only* territories
  (no other Weather API function works there — irrelevant to us, alerts is
  all we call). Excluded everywhere: China, Cuba, Iran, North Korea, Syria.
  Google's own caveat: alert regions are provider polygons, so *"country and
  region coverage alignment may not be exact"*.
- **(c) Response shape:** an array of alert objects, each with `alertId`,
  `alertTitle` (documented as an object — exact shape is a live to-verify),
  `eventType` (≈60-value enum: TORNADO, FLASH_FLOOD, HEAT, TSUNAMI, …),
  `areaName`, `polygon`, `description` (source language),
  `severity` / `urgency` / `certainty` (CAP-style enums — severity is
  exactly NOAA's `Extreme | Severe | Moderate | Minor | Unknown`),
  `instruction[]`, `safetyRecommendations[]`, `startTime` /
  `expirationTime` (UTC; expiration may be null), `timezoneOffset`
  (±HH:MM), `dataSource` (publisher name, full name, authority URI), and
  `regionCode`. **A location with no active alerts returns a response
  containing only `regionCode`** — that is the documented no-data shape,
  not an error.
- **(d) Attribution is mandatory, in two layers** (Weather API policies
  page, fetched live):
  1. The exact string **"Source: Includes weather data from Google"** on or
     next to the data (the Weather API sibling of the pollen string).
  2. Per-alert attribution to the **original publisher** via the
     `dataSource` field — provider name with its authority URI. In text
     output this is a Sender/Source line per alert carrying the publisher's
     full name and URL.
- **(e) Caching:** the GMP ToS caching prohibition applies verbatim (pollen
  upstream (e)). Alerts already have the tightest TTL in the project
  (`CacheConfig.ttl.alerts` = 5 min); a 5-minute **in-memory** cache is the
  same disclosed trade-off, and comfortably conservative here.
- **(f) SKU / free tier — partially verified, gating:** the SKU-details page
  lists **"Weather Usage" as an Essentials-tier SKU** (10,000 free
  calls/month under the March 2025 model), but the fetched page cut off
  before confirming whether `publicAlerts:lookup` bills under that same SKU
  or a separate one. **This is a live to-verify with teeth:** the standing
  key policy (pollen D9) says optional keys must always have a usable free
  tier — if alerts requests turn out to have no free quota, this feature is
  re-evaluated before any code ships.
- **(g) Live to-verify list (T-live):** rejected-key status + body markers
  (expected 400/403 with `API_KEY_INVALID` / `"API key not valid"` /
  `PERMISSION_DENIED` — same family as pollen (f)); the exact `alertTitle`
  object shape; the no-alerts `regionCode`-only shape vs any error status
  for genuinely uncovered countries; behavior at a covered-country point
  outside every provider polygon; whether `instruction` /
  `safetyRecommendations` arrays are strings or objects; the alerts SKU (f);
  timestamp formats and whether `timezoneOffset` is always present.

Rejected alternatives (researched during v1.19.0 and re-checked for the
register, 2026-08-18):

- **WMO Severe Weather Information Centre (SWIC)** — the keyless candidate
  for exactly this hole; verified **not production-usable** during v1.19.0.
  Nothing has changed.
- **Per-country national feeds** (BOM Australia, JMA Japan, CMA, …) — each
  is its own integration with its own format, licence, and maintenance
  burden; N integrations vs one aggregator. Any single country that later
  earns a first-class keyless integration can still get one — the routing
  ladder makes that a pure insertion above the Google branch.
- **Other commercial aggregators** (AccuWeather, Tomorrow.io alerts) — paid
  or free-tier-hostile; the Google key is the one the project already asks
  users to hold (pollen).

## What / Why

`get_alerts` routes by country: US → NOAA, Canada → ECCC via MSC GeoMet, 38
European countries → MeteoAlarm, **elsewhere → a clean not-covered message**
(`src/handlers/alertsHandler.ts:118`, `notCoveredResult`). That "elsewhere" is
the largest remaining hole in the server's safety-data story — an Australian,
Japanese, or Brazilian user asking "any weather warnings?" gets a polite
shrug, and alerts are the highest-value category in the routing doctrine.

This plan adds a **keyed fallback for the elsewhere branch only**: when an
optional `GOOGLE_WEATHER_API_KEY` is configured, the final branch fetches
Google's public-alerts endpoint — an aggregation of official national feeds
across ~45+ territories — and renders the warnings. The keyless authorities
stay untouched and **never contact Google**: NOAA, ECCC, and MeteoAlarm are
jurisdictional authorities and remain first-choice even when a key exists
(mirror of the pollen plan's "Europe never contacts Google" rule — here it is
"the US, Canada, and Europe never contact Google"). Without a key, behavior
is **byte-identical to today** — the NCEI/FIRMS/Google-Pollen "optional key
upgrades the tool" pattern, with the same key-in-URL hygiene threat model as
FIRMS.

**Unlike pollen, the Google data here is contract, not garnish.** Pollen is a
section riding an air-quality response; alerts *are* the tool's entire
answer. So the failure posture is the peer-source posture of the GeoMet and
MeteoAlarm services (plain sanitized errors that surface), **never** a silent
degrade — a silent "✅ no alerts" produced by a failed fetch would be a
dangerous lie on safety data (the FIRMS not-all-clear doctrine).

## Scope

- One new service (`src/services/googleWeather.ts`), one new types file
  (`src/types/googleWeather.ts`), one new config key, a fourth renderer +
  routing branch in `alertsHandler.ts`, `index.ts` instantiation + wiring +
  tool-description update, `get_weather_summary` pass-through, tests, docs.
- **Descoped:** any other Google Weather API endpoint (forecast / current /
  history — rejected outright in the register; minute-nowcast is register #2,
  its own future decision); polygon rendering or point-in-polygon filtering
  (render `areaName`, disclose that matching is provider-polygon-based);
  `languageCode` pass-through as a tool parameter (pinned `en`, like pollen);
  `statusHandler` key reporting (matches FIRMS/pollen — no key reporting);
  persistent caching; any change to the NOAA / GeoMet / MeteoAlarm paths or
  renderers; retries in the new service.

## Design decisions (settled at draft level; review may amend)

### D1. Routing — the elsewhere branch only, no client-side country gate

The new branch slots into `handleGetAlerts` **after** the existing four
routing checks (`alertsHandler.ts:102-117`), replacing the unconditional
`notCoveredResult` call: if a `googleWeatherService` is present and
`isKeyAvailable()`, call Google; otherwise return today's not-covered message
byte-identically.

**No client-side country allowlist.** Google's own caveat — coverage is
provider polygons, "alignment may not be exact" — means a hardcoded country
list would drift and mis-gate border regions. Google itself answers the
coverage question per request: a `regionCode`-only response *is* the
"nothing here" answer (D6). Cost of firing for a genuinely uncovered point is
one cached lookup per 5 minutes. This also means open-ocean points (no
country resolved, non-US) reach Google when keyed — harmless, and marine
extremes (typhoon warnings) may even be covered.

The branch order guarantees the invariant worth stating outright: **a US,
Canadian, or MeteoAlarm-country request never contacts Google, key or no
key.**

### D2. Service — `src/services/googleWeather.ts`, modeled on `firms.ts` / the pollen service

The key rides in the URL query string — same threat model, same
countermeasures: the service **never logs or throws URLs or raw axios
errors**; every thrown error is a fixed pre-written string; logs carry only
`{ status, code }` (+ `redactCoordinatesForLogging`); module doc-comment
carries the "Security: the key lives in the URL" block.

```ts
export class GoogleWeatherKeyRejectedError extends Error { /* fixed message naming GOOGLE_WEATHER_API_KEY */ }
export interface GoogleWeatherServiceConfig { timeout?: number; apiKey?: string; }
export class GoogleWeatherService {
  constructor(config: GoogleWeatherServiceConfig = {})  // apiKey = GOOGLE_WEATHER_API_KEY default
  isKeyAvailable(): boolean
  getCacheStats(); clearCache();
  /** Active public alerts for a point; [] when the region has none. Fixed-string errors only. */
  async getPublicAlerts(latitude: number, longitude: number): Promise<GoogleWeatherAlert[]>
}
```

Internals: `validateLatitude`/`validateLongitude`; axios GET with
`params: { key, 'location.latitude', 'location.longitude',
languageCode: 'en' }`, `User-Agent: getUserAgent()`, timeout
`CacheConfig.apiTimeoutMs`. A `regionCode`-only body returns `[]` (and is
cached — an uncovered region isn't re-probed for the TTL). **No retries** —
matches GeoMet/MeteoAlarm.

`GoogleWeatherKeyRejectedError extends Error` with a fixed message — **not**
`ApiError` (`ApiServiceName` is a closed union; FIRMS and the pollen service
both deliberately stayed outside it). Error mapping in a module-level
`mapPublicAlertsError(error)` copying the FIRMS/pollen shape: `ECONNABORTED`
→ fixed timeout string; 400/403 with a key-rejection marker →
`GoogleWeatherKeyRejectedError`; 429 → fixed quota string; other status →
fixed generic; no response → fixed network string. Markers are web-verified
only until T-live (upstream (g)).

Types (`src/types/googleWeather.ts`): subset-only, **all-optional** fields —
only what the renderer reads (`alertTitle`, `eventType`, `areaName`,
`description`, `severity`, `urgency`, `certainty`, `instruction`,
`safetyRecommendations`, `startTime`, `expirationTime`, `timezoneOffset`,
`dataSource`, `regionCode`). `polygon` is deliberately not typed — never
read. Doc comment flags `alertTitle`'s exact shape as a T-live item.

### D3. Cache — reuse the alerts posture: 5 minutes, in-memory

Namespace `Cache.generateKey('google-weather-alerts', lat.toFixed(2),
lon.toFixed(2))` (FIRMS 2-dp precedent), TTL `CacheConfig.ttl.alerts`
(5 min) — alerts volatility is alerts volatility regardless of source, and no
new TTL entry is needed. In-memory only per upstream (e). Quota math: even a
pathological single-location poller costs ≤ 288 calls/day ≈ 8,640/month —
above the presumed 10k free tier only under continuous abuse; normal use is
orders of magnitude below it.

### D4. Config — `GOOGLE_WEATHER_API_KEY` in `src/config/api.ts`

Fourth entry beside `NCEI_API_TOKEN` / `FIRMS_MAP_KEY` /
`GOOGLE_POLLEN_API_KEY`, plus `isGoogleWeatherKeyAvailable()` (trim check),
NCEI/FIRMS doc-comment convention verbatim: OPTIONAL; key from the Google
Cloud console (**requires a billing account**; Weather API must be enabled on
the project); benefits: official weather alerts in ~45+ additional
territories (Australia, Japan, Brazil, Mexico, …); if not provided: US,
Canadian, and European alerts continue to work keyless, no setup required;
rate limits: per Google's Weather API free tier. `.env.example` gains the
entry with the billing caveat.

**Per-feature key naming is already settled** (pollen D10 / the register):
this is `GOOGLE_WEATHER_API_KEY`, never a shared platform var. A user holding
a pollen key restricted to the Pollen API **cannot** reuse it here — the
setup doc must say so explicitly (enable the Weather API; either un-restrict
a shared-string key or mint a second key restricted to the Weather API on the
same zero-friction project/billing account).

### D5. Rendering — a fourth CAP-shaped renderer beside MeteoAlarm's

New `handleGoogleAlerts` in `alertsHandler.ts`, deliberately close to the
MeteoAlarm renderer (the data is CAP-shaped and the display conventions
already exist): header `# Weather Alerts — <Region>` via the existing
`regionDisplayName`, location line, sort by `capSeverityRank` (Google's
severity enum is exactly NOAA's) then by expiration, `capSeverityEmoji`
markers, the `summary` / `standard` / `full` detail contract with the
existing 10/25 display caps and remainder note.

Per alert: title line from `alertTitle` + `eventType`; severity / urgency /
certainty line; `**Area:** areaName`; `**Effective:**` / `**Expires:**` from
`startTime`/`expirationTime` rendered in the alert's own `timezoneOffset`
(the formatPublishedTime "times as issued" doctrine; a null
`expirationTime` omits its line); `description` verbatim at `full` only;
`instruction` at `standard`+`full`; `safetyRecommendations` at `full`;
per-alert `**Source:** <dataSource full name> (<authority URI>)` — the
layer-2 attribution from upstream (d).

Footer, all mandatory or doctrine-driven:

```
---
*Data source: official national weather services, aggregated by the Google
Weather API. Alert text is shown in its source language, as issued.
Source: Includes weather data from Google*
```

The final sentence is the **exact mandatory string** (upstream (d), layer 1).
A standing coverage-caveat line renders above the footer: alert regions are
provider polygons and *"coverage alignment may not be exact"* — warnings may
not match the exact point. `active_only: false` → the same
historical-not-available note as MeteoAlarm/GeoMet.

### D6. No-alerts vs failure — an honest empty, loud errors

- **`regionCode`-only response** (no active alerts, or an uncovered region —
  Google does not distinguish) → `✅ No active weather alerts found for this
  location via the Google Weather API.` **plus** the coverage caveat: Google
  aggregates ~45+ territories and matches by provider polygon, so an empty
  answer is *"no alerts found"*, not a guarantee of coverage — the FIRMS
  empty-result framing.
- **Key rejected** → `GoogleWeatherKeyRejectedError` propagates with its
  fixed, actionable message (env var named; suggests checking that the
  Weather API is enabled and the key is unrestricted or Weather-restricted —
  the D4 pollen-key-reuse trap). Alerts are contract: erroring loudly is
  correct where pollen's garnish note was.
- **Everything else** (timeout, 429, 5xx, network) → the service's fixed
  sanitized error propagates, exactly as a GeoMet or MeteoAlarm failure
  does today. Never a fabricated all-clear.
- **No key** → today's `notCoveredResult` **byte-identical** — no
  advertising line in the output (the key is advertised in the tool
  description, README, and setup doc; keyless output bytes are locked).

### D7. Wiring — `index.ts` + `get_weather_summary` pass-through

- Instantiate `const googleWeatherService = new GoogleWeatherService()`
  beside the other service inits (~`src/index.ts:163`).
- `handleGetAlerts` gains an optional trailing **8th** parameter; pass it at
  the dispatch (`:803`) and into `handleGetWeatherSummary` (`:813-816`),
  which threads it to its own `handleGetAlerts` call
  (`weatherSummaryHandler.ts:152`) — the summary's alerts section picks up
  the fallback for free, no flag-stripping needed (nothing about this is a
  per-call flag).
- Tool description (`:390`): extend the coverage sentence to the keyed truth
  — keyless coverage as today; *"with an optional `GOOGLE_WEATHER_API_KEY`,
  official alerts for ~45+ more territories (Australia, Japan, Brazil,
  Mexico, and others) via the Google Weather API"*. No schema change (no new
  tool parameters).

### D8. Docs — inherit the pollen surfaces, add a sibling setup doc

- README "Optional API keys" table (created by pollen T5) gains a fourth
  row: what the key adds (alerts beyond US/Canada/Europe), what still works
  without it, the billing-account caveat stated plainly (never "free").
- `docs/GOOGLE_WEATHER_KEY_SETUP.md` — a short sibling of
  `docs/GOOGLE_POLLEN_KEY_SETUP.md` that cross-references the shared console
  steps (project, billing) and differs only in: enable the **Weather API**,
  restrict the key to the Weather API, set `GOOGLE_WEATHER_API_KEY`, and the
  pollen-key-reuse note (D4). Same `**Last verified:**` freshness-stamp
  convention; fold it into the existing quarterly re-check routine's scope
  (the routine re-reads Google's published pages — pointing it at a second
  doc is a prompt update, not a new trigger).
- `docs/planning/GOOGLE_KEY_OPPORTUNITIES.md` #1 → status flip to "designed:
  `docs/global-alerts-fallback-plan.md`" (that file is on this feature's
  branch by then, so editing it is safe).
- `docs/planning/README.md`, `CHANGELOG.md`, `CLAUDE.md`, `docs/TOOLS.md`
  (`get_alerts` section — keyed coverage tier + attribution note) per house
  convention.

### D9. Coverage claims — never hardcoded in code, representative in docs

No country list ships in code (D1). Docs and the tool description use a
short representative list + "per Google's coverage page" pointer, so
Google adding a country is a free upgrade and removing one is not a bug in
our copy.

### D10. Free-tier gate — standing key policy conformance check at T-live

Upstream (f) is unresolved: if live verification finds `publicAlerts:lookup`
has **no usable free tier**, the standing key policy (pollen D9) says this
feature does not ship as designed — the plan returns to review rather than
shipping a paid-key dependency. This is a named gate, not a footnote.

## Edge cases

- Covered country, point outside every provider polygon → `regionCode`-only
  → the honest-empty message with the coverage caveat (D6).
- Toronto/Vancouver (CONUS-box overrun) → still GeoMet — the reverse-country
  answer wins before the Google branch is ever reached; existing routing
  tests lock this and must pass unedited.
- Reverse lookup **failed** + non-US point + key → Google fires (it needs
  only coordinates); the existing one-line lookup-failure note still
  renders. Reverse lookup absent (test harness) + non-US point → same.
- MeteoAlarm-member point when `meteoAlarmService` is absent (test-harness
  shape) falls through to the elsewhere branch — with a mock Google service
  it would fire. Acceptable: production always passes all services; tests
  just need to pass the full set when asserting never-contacts-Google.
- `expirationTime` null (documented) → Expires line omitted.
- Empty `instruction`/`safetyRecommendations` arrays → lines omitted.
- Whitespace-only key → `isKeyAvailable()` false → keyless path.
- `alertTitle` missing/unexpected shape → fall back to a humanized
  `eventType`, else "Weather alert" (the MeteoAlarm `?? 'Weather warning'`
  convention).

## Testing

`tests/unit/alerts-routing.test.ts`, `tests/unit/alerts-detail.test.ts`, and
`tests/unit/alert-sorting.test.ts` **must pass unedited** — the routing file
calls `handleGetAlerts` with seven args, so the new optional trailing 8th
parameter means those calls exercise the keyless path by construction, and
its Australia case locks the keyless not-covered message. New
`tests/unit/alerts-google-fallback.test.ts`:

- **Routing** (mock service `{ isKeyAvailable, getPublicAlerts }`): Sydney +
  key → Google renderer output containing the exact mandatory attribution
  string; Sydney, `isKeyAvailable() === false` → not-covered message,
  `getPublicAlerts` not called; Sydney, no 8th arg → output **strictly
  equal** (`toBe`) to today's; US point + key → NOAA path, Google not
  called; MeteoAlarm country + key (all services passed) → MeteoAlarm path,
  Google not called; Canada + key → GeoMet path, Google not called.
- **Rendering:** severity sort + emoji; detail caps 10/25 + remainder note;
  `summary` counts-only; null `expirationTime` omits its line; per-alert
  `dataSource` attribution line; coverage-caveat line present on both empty
  and non-empty results; `active_only: false` note.
- **Failure modes:** `regionCode`-only → honest-empty + caveat;
  `GoogleWeatherKeyRejectedError` propagates with the fixed message; generic
  service error propagates sanitized.
- **Service** (`vi.mock('axios')`, FIRMS/pollen-service style): exact request
  params (dotted location keys, `languageCode: 'en'`, no `days`); cache hit
  on second call; `regionCode`-only body → `[]` and cached; key-rejection
  body → `GoogleWeatherKeyRejectedError`; 429/timeout → fixed strings;
  **key hygiene** — a distinctive test key appears in no thrown message and
  no logger-call argument.

## Documentation / registration checklist (for /run-plan tracking)

- [ ] `src/types/googleWeather.ts` (subset-only, all-optional fields)
- [ ] `src/config/api.ts` — `GOOGLE_WEATHER_API_KEY` + predicate
- [ ] `src/services/googleWeather.ts` — service + error mapping + key hygiene
- [ ] `src/handlers/alertsHandler.ts` — elsewhere-branch fallback +
      `handleGoogleAlerts` renderer
- [ ] `src/index.ts` — instantiation, 8th arg (both dispatch sites), tool
      description ~line 390
- [ ] `src/handlers/weatherSummaryHandler.ts` — thread the service through
- [ ] `.env.example` — fourth API-key entry (billing caveat)
- [ ] `README.md` — "Optional API keys" fourth row + coverage prose
- [ ] `docs/GOOGLE_WEATHER_KEY_SETUP.md` — sibling walkthrough, freshness
      stamp, pollen-key-reuse note; quarterly routine prompt updated
- [ ] `docs/TOOLS.md` — `get_alerts` keyed coverage tier + attribution
- [ ] `docs/planning/GOOGLE_KEY_OPPORTUNITIES.md` — #1 status flip
- [ ] `docs/planning/README.md` — alerts row + this doc's deferred index row
- [ ] `CHANGELOG.md` — Unreleased entry (byte-identical-keyless claim,
      contract-not-garnish failure posture, two-layer mandatory attribution,
      key hygiene, ToS cache note)
- [ ] `CLAUDE.md` — feature bullet

## Verification

1. `npm run build` clean; `npm test` full suite, with the three alert lock
   files passing **zero-edit**.
2. Keyless byte-identity: diff built-dist `get_alerts` output against the
   branch base with no key set, for Sydney (not-covered path), a US point,
   Berlin (MeteoAlarm), and Toronto (GeoMet).
3. **T-live** (human key gate first — same billing account as the pollen key;
   enable the Weather API; stop-and-ask with a deferred-by-human branch, per
   the pollen T6 pattern): Sydney → warnings render with both attribution
   layers; mid-Pacific point → honest-empty + caveat; garbage key → the
   fixed rejected-key error; US/Berlin/Toronto with the key set + debug log →
   Google **not contacted**; resolve every upstream (g) item **including the
   D10 free-tier gate**, adjusting `mapPublicAlertsError` / types if live
   shapes differ.
4. Grep all driver output and logs for the key string — must appear nowhere.
