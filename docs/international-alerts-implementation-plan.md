# International Alerts (MeteoAlarm + MSC GeoMet) — Implementation Plan

**Status:** READY (2026-08-13)

Execution plan for `docs/international-alerts-plan.md` (the WHAT/WHY); rules
live in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/international-alerts-implementation-plan.md
```

Or, equivalently: read `docs/international-alerts-plan.md` (design),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — green baseline, one subagent per task, review
the diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass
npm audit         # no high/critical
```

**Gate caveat (standing):** several files under `tests/integration/` make
**live network calls** and flake independently (see the standing flaky-tests
caveat — currently six files). If the gate goes red only in those files, re-run
before suspecting the diff. **T9 adds another file in that category** (live
MeteoAlarm + GeoMet smoke) and must follow the same tolerant-of-flake
convention.

**Live-verification rule:** the design's API contract was verified live on
2026-08-13, but two pieces of this feature can only be trusted against the live
services: the **full MeteoAlarm slug map** (T4 — every slug must be fetched
once) and the design's **seven acceptance points** (T10). The orchestrator must
run both itself against the built dist; a subagent's claim that live
verification passed is never the gate.

## Scope & branch

**Branch:** `feat/international-alerts` (named in the design). Target release:
**v1.19.0**.

In scope: the design's D1–D8 — country-routed `get_alerts` (US → NOAA
unchanged, Canada → MSC GeoMet, MeteoAlarm members → the country feed,
elsewhere → a clean not-covered message), the Nominatim reverse-country lookup
with permanent cache, `country_code` threading through `ResolvedLocation`, the
two new services with their filter pipelines, per-source renderers honouring
the licence terms, `active_only` semantics, the `get_weather_summary`
short-circuit removal, plus the testing and documentation checklists.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Rest-of-world alerts (WMO SWIC / Alert-Hub) | D9 — verified not production-usable (demo feeds, no geometry, no redistribution grant); not-covered message instead. |
| Sub-country European matching | D9 — needs bundled EMMA/NUTS geometry; user chose country-level for v1; the D5 coverage note discloses the granularity. |
| A `source` override parameter | D1 — alert authorities don't overlap; an override could only select an empty or wrong source. |
| French output on GeoMet (`_fr` fields) | D4 — English only in v1. |
| MeteoGate registered API (polygons, pan-Europe) | D9 — would break the zero-key model for marginal v1 gain. |
| `check_service_status` entries for the new services | D9 — pre-existing gap (NIFC/ACIS/aviationweather are also absent); separate follow-up. |
| UK Environment Agency flood warnings | D9 — separate planned idea (rivers supplement), not an alerts source. |
| Client-side point-in-polygon on GeoMet | D4 — deliberately out; bbox is tight and output names the affected area. |

## Findings that shape the graph

Spot-checks against the code, reconciled into the tasks below:

- **`tests/unit/alerts-detail.test.ts` calls `handleGetAlerts` with exactly
  four arguments** (`:48` — `args, noaaStub, store, geocoding`) at a US point
  (40, −100), and the design requires it to pass **unedited**. Therefore the
  three new services are appended as **optional trailing parameters**
  (`meteoAlarmService?`, `geoMetService?`, `nominatimService?` — the METAR A6
  precedent). With no `nominatimService` injected, the router must skip the
  reverse lookup **silently** and fall through to `isInUS` — the D1 "one-line
  note" applies only when a real lookup *errors*, never when the service is
  simply absent (Assumption A3). That is what keeps the stubbed US test
  byte-identical.
- **`tests/unit/alert-sorting.test.ts` is pure** (severity-ordering logic, no
  handler import) — it passes unedited for free, but stays named in T6's
  acceptance as the second lock on the NOAA path.
- **The NOAA timezone side-call sits in the shared prologue**
  (`alertsHandler.ts:39-51`, `getStations` + fallback). D5 requires both new
  paths to skip it, so T6 restructures the handler: resolve → route → only the
  NOAA branch keeps its existing prologue + renderer **verbatim**.
- **`weatherSummaryHandler.ts` imports `isInUS` solely for the short-circuit**
  (`:18` import, `:127` only use). Deleting the short-circuit (D7) must also
  delete the import — `noUnusedLocals` fails the build otherwise. The summary
  strips `location_name`/`city_name` from `subArgs` (`:106-107`), so the
  summary's alerts section is always coordinate-only and takes the
  reverse-lookup path — exactly the D7 wrinkle, accepted as-is.
- **`tests/unit/weather-summary-handler.test.ts:126-139`** asserts the
  short-circuit text and `alertsMock` not being called for London — T7 replaces
  these with dispatch-everywhere assertions (a designed behaviour change).
- **No `ApiError` union widening needed.** The design names the
  `acis.ts`/`nifc.ts` error shape for both new services, and those throw
  **plain `Error`s** with sanitized messages (verified: `nifc.ts:153-163`) —
  the union stays untouched. The reverse-country lookup rides the existing
  `NominatimService`, whose `'Nominatim'` service name is already in the union.
- **Wiring points in `src/index.ts`:** `nominatimService` is already
  constructed at `:118` (currently only `save_location` uses it); the
  `get_alerts` dispatch is at `:753-755`, the summary dispatch at `:763-765`,
  and the `get_alerts` schema/description at `:353-370` (the "(US only)" text
  the design quotes). `MeteoAlarmService`/`GeoMetService` get constructed
  beside the other keyless services.
- **`isInUS` (`src/utils/geography.ts:322`)** — the CONUS box runs to 49.4°N /
  −66.9°E, so Toronto (43.65, −79.38) and Vancouver (49.28, −123.12) are
  inside it. These are the routing test's canary coordinates: reverse-country
  must win.
- **Country-code casing is inconsistent across sources**: saved locations and
  `GeocodingResult.country_code` are uppercase (`"US"`, `"GB"` —
  `nominatim.ts:204` upcases), while the reverse `jsonv2` response returns
  lowercase (`"de"`, `"ca"`). The router normalizes to **lowercase** at the
  boundary and the slug map is keyed lowercase ISO 3166-1 alpha-2
  (Assumption A6). Note `gb → united-kingdom` (not `uk`).
- **`CacheConfig.ttl` is additive-safe** — `tests/unit/config.test.ts` asserts
  individual keys, not an exhaustive snapshot (METAR precedent), so
  `reverseCountry: Infinity` needs no test churn.
- **MeteoAlarm cache semantics need one clarification the design implies**:
  the cached value is the *parsed* country result, but expiry (and therefore
  supersession, which the design orders **after** expiry) must be applied **at
  read time** — a 4-minute-old cache entry must not serve a warning that
  expired 3 minutes ago. T3 caches the parsed warning list and runs a pure
  `filterActive(warnings, now)` (expiry → supersession) on every read.
- **Fixtures cannot be raw captures** — Germany's feed is 2.76 MB. T3/T5 commit
  *trimmed* fixtures: a representative handful of warnings preserving the
  load-bearing shapes (multi-language `info[]`, an expired item, an
  `Update`+`references` chain, awareness parameters; GeoMet's `ended` status
  and a `numberMatched: 0` body). The < 2 s test budget stands.

## Task graph

### Phase 1 — Country resolution infrastructure

**T1 — `NominatimService.reverseCountry` + permanent cache** (`sonnet`)

- Files: `src/services/nominatim.ts`, `src/types/nominatim.ts`,
  `src/config/cache.ts`, `tests/unit/reverse-country.test.ts` (new)
- Add `reverseCountry(latitude, longitude): Promise<string | null>` to
  `NominatimService`: GET `/reverse` with
  `lat`, `lon`, `format=jsonv2`, `zoom=3` — the existing axios client,
  User-Agent, 1 req/s `enforceRateLimit()`, and error interceptor all apply
  unchanged. Response handling: `{"error": "Unable to geocode"}` (HTTP 200) →
  `null` — a *result*, not a failure; otherwise return
  `address.country_code` lowercased (missing → `null`). Add a minimal
  `NominatimReverseResponse` type to `src/types/nominatim.ts`.
- Cache in the service's existing `Cache` member, key
  `Cache.generateKey('reverse-country', lat.toFixed(2), lon.toFixed(2))`
  (~1.1 km rounding per D2), TTL from new
  `CacheConfig.ttl.reverseCountry: Infinity` in `src/config/cache.ts`
  (comment: countries don't move). `null` results are cached too (open ocean
  is permanent).
- Acceptance: full gate green. New tests (mocked axios, template:
  existing service tests): jsonv2 parsing (Munich fixture → `"de"`);
  "Unable to geocode" → `null`; second call on same rounded key makes one HTTP
  request; keys differing only past 2 decimals share an entry; rate limiter
  invoked; lowercase normalization.
- Commit: `feat: Add cached country-level reverse geocoding to NominatimService`
- Depends on: — · **parallel-safe with T2** (disjoint files)

**T2 — Thread `country_code` through `ResolvedLocation`** (`sonnet`)

- Files: `src/utils/locationResolver.ts`
- `ResolvedLocation` (`:19-24`) gains `country_code?: string`. Populate it on
  the saved-location path (`SavedLocation.country_code`,
  `src/types/savedLocations.ts:17-18` — both `resolveLocation` returns) and
  the geocoded path (`GeocodingResult.country_code`,
  `src/services/geocoding.ts:44-45`, currently discarded) — including through
  `CachedCityGeocode` (`:86-90`), which gains the field so cache hits carry it
  too. Preserve source casing here; consumers normalize (A6). The
  coordinates and default paths leave it unset. Pure plumbing — nothing reads
  the field yet, so no output changes anywhere.
- Acceptance: full gate green with **zero edits to existing tests** — the
  no-behaviour-change proof.
- Commit: `feat: Thread country_code through location resolution`
- Depends on: — · **parallel-safe with T1** (disjoint files)

### Phase 2 — Alert data services

**T3 — MeteoAlarm types, service, and filter pipeline** (`opus`)

- Files: `src/types/meteoalarm.ts` (new), `src/services/meteoalarm.ts` (new),
  `tests/unit/meteoalarm.test.ts` (new)
- Types mirroring the verified feed shape: `{ warnings: [{ alert, uuid }] }`
  with the CAP `alert` (`identifier`, `sender`, `sent`, `status`, `msgType`,
  `scope`, `references?`, `info[]`) and `info` entries (`language`, `event`,
  `severity`, `urgency`, `certainty`, `onset`, `expires`, `headline`,
  `description`, `instruction`, `senderName`, `web`, `responseType`,
  `area[]` with `areaDesc`, `parameter[]`). Optional wherever presence isn't
  guaranteed; no `any`.
- `MeteoAlarmService` (shape: `acis.ts` construction, `noaa.ts:175-199` retry;
  errors are **plain sanitized `Error`s** — the ACIS/NIFC precedent, no
  `ApiError` union change):
  - Static `COUNTRY_FEEDS: Record<string, { slug: string; name: string; service?: string }>`
    keyed by lowercase ISO code, seeded with the full MeteoAlarm membership
    (~35 entries; `de`/`fr`/`gb` slugs are already live-verified; the rest are
    **candidates until T4**). `name` is the display name ("Germany"),
    `service` the national met service where known (for the D8 footer, e.g.
    "Deutscher Wetterdienst"). Export a `isMeteoAlarmCountry(code)` helper.
  - `getWarnings(countryCode): Promise<MeteoAlarmWarning[]>` — fetch
    `https://feeds.meteoalarm.org/api/v1/warnings/feeds-<slug>`, parse once,
    then per warning: select the `en`-prefixed `info` entry (else the first);
    normalize into a flat internal `MeteoAlarmWarning` (identifier, msgType,
    references, event, severity, colour, urgency, certainty, onset, expires,
    headline, description, instruction, senderName, areaDesc list, sent).
    Parse `awareness_level` (`"2; yellow; Moderate"`) → colour; malformed →
    undefined, never a throw.
  - **Read-time filtering** (pure, exported for tests):
    `filterActiveWarnings(warnings, now)` applies, in order: drop
    `status !== 'Actual'` and `msgType === 'Cancel'`; drop `expires <= now`;
    then drop any warning whose `identifier` is `references`-d by a surviving
    `Update` (supersession — after expiry, per the design). The **cache stores
    the parsed list** under `Cache.generateKey('meteoalarm', countryCode)`
    with `CacheConfig.ttl.alerts` (5 min); `getWarnings` runs
    `filterActiveWarnings` on every return, cached or fresh. Never fetch
    per-request without the cache in front (2.76 MB worst case).
- Acceptance: full gate green. Tests use **trimmed live-captured fixtures**
  (see Findings — not the raw 2.76 MB feed): language selection (`en` prefix
  match incl. `en-GB`; fallback to first for a warning with no `en`); expiry
  filtering (the Germany 161→51 behaviour in miniature); supersession
  (an `Update` referencing a surviving identifier removes it; references to
  already-expired items are inert); awareness colour parsing incl. malformed;
  unknown country code → clear error; empty feed → `[]`; second call within
  TTL makes one HTTP request; a fresh read of a stale cache entry still drops
  newly-expired warnings.
- Commit: `feat: Add MeteoAlarm country warnings client`
- Depends on: — · **parallel-safe with T1, T2, T5** (disjoint files)

**T4 — Live-verify the full MeteoAlarm slug map** (`sonnet`)

- Files: `src/services/meteoalarm.ts` (the `COUNTRY_FEEDS` table only)
- The design makes this an explicit task: fetch every candidate slug once
  (HTTP status + `warnings` key present is enough — do **not** commit these
  captures), correct any slug that 404s by checking MeteoAlarm's published
  country list, and **drop** any member that cannot be verified (an absent map
  entry degrades to the not-covered message by design — never ship an
  unverified slug). Record the sweep result (N verified, any dropped/renamed)
  in the commit message. Respect the feeds with a small delay between
  requests; this is ~35 requests, once.
- Acceptance: every entry in the committed map returned HTTP 200 JSON with a
  `warnings` array on the sweep date; `de`/`fr`/`gb` unchanged; full gate
  green.
- Commit: `feat: Complete and live-verify the MeteoAlarm country feed map`
- Depends on: T3 · **parallel-safe with T5, T6** (T6 touches handler/index
  only; coordinate if T6's subagent needs map helpers renamed — it shouldn't)

**T5 — GeoMet types, service, and filtering** (`sonnet`)

- Files: `src/types/geomet.ts` (new), `src/services/geomet.ts` (new),
  `tests/unit/geomet.test.ts` (new)
- Types for the **verified** (not roadmap) properties: `alert_type`,
  `alert_name_en`, `alert_short_name_en`, `alert_text_en`, `feature_name_en`,
  `province`, `status_en`, `risk_colour_en`, `confidence_en`, `impact_en`,
  `publication_datetime`, `validity_datetime`, `event_end_datetime`,
  `expiration_datetime`, `alert_code`, `feature_id` (French twins may be
  typed but are unused in v1). No severity/urgency/certainty fields exist —
  do not invent them.
- `GeoMetService.getAlerts(latitude, longitude)`: GET
  `https://api.weather.gc.ca/collections/weather-alerts/items` with
  `bbox=lon-0.25,lat-0.25,lon+0.25,lat+0.25`, `f=json`. `numberMatched: 0` is
  the happy empty path (`[]`, never an error). Filter out `status_en` values
  meaning ended/expired (observed: `"ended"`; compare case-insensitively) and
  features past `expiration_datetime`. Plain sanitized `Error`s;
  retry/backoff per the `noaa.ts` template. Cache under
  `Cache.generateKey('geomet-alerts', lat.toFixed(2), lon.toFixed(2))`,
  `CacheConfig.ttl.alerts` (5 min).
- Acceptance: full gate green. Tests from a trimmed live fixture: field
  mapping; `ended` filtering; expired-datetime filtering; `numberMatched: 0`
  → `[]`; cache hit on second call; a feature with missing optional fields
  maps without crashing.
- Commit: `feat: Add MSC GeoMet weather alerts client`
- Depends on: — · **parallel-safe with T1, T2, T3, T4** (disjoint files)

### Phase 3 — Routing, rendering, registration

**T6 — Country routing + per-source renderers in `get_alerts`** (`opus`)

- Files: `src/handlers/alertsHandler.ts`, `src/index.ts`
- Signature: append **optional trailing** parameters to `handleGetAlerts` —
  `meteoAlarmService?`, `geoMetService?`, `nominatimService?` (Finding above;
  A2). `tests/unit/alerts-detail.test.ts`'s four-argument call must keep
  compiling and passing **unedited**.
- Routing (D1), in order: (1) `resolved.country_code` from T2 if present;
  (2) else `nominatimService.reverseCountry` (skipped silently when the
  service is absent — A3); (3) reverse `null` (open water) or thrown →
  `isInUS` fallback — true → NOAA (preserves US marine alerts), false →
  not-covered message, plus a one-line note **only** when the lookup threw.
  Normalize codes to lowercase before comparing (A6). Then: `us` → NOAA
  branch, `ca` → GeoMet, `isMeteoAlarmCountry(code)` → MeteoAlarm, else
  not-covered message naming the region. The reverse answer **wins over
  `isInUS`** — Toronto/Vancouver route to GeoMet.
- **NOAA branch untouched**: the existing prologue (timezone side-call,
  `alertsHandler.ts:39-51`) and renderer (`:58-142`) move intact into the US
  branch — byte-identical output. The two new branches **skip `getStations`
  entirely** and render timestamps in the offsets the source published (D5).
- MeteoAlarm renderer (D5): heading `# Weather Alerts — <Country>`; the
  country-level coverage note; count line; warnings sorted by CAP severity
  (same Extreme→Unknown order and emoji conventions as NOAA) then expiry;
  per-warning colour + severity/urgency/certainty, area, **Issued** (always —
  licence term), Expires; headline/description/instruction **verbatim**
  (description at `full` only, instruction at `standard`+`full`, matching the
  NOAA detail contract). Display caps: `standard` top 10, `full` top 25, both
  with disclosed remainder ("…and N more warnings, mostly Minor"); `summary`
  = counts by severity/colour only. Footer:
  `*Data source: EUMETNET – MeteoAlarm (national warnings: <service>). Alerts
  shown unmodified as issued; times as published.*` (omit the parenthetical
  when the map has no service name).
- GeoMet renderer (D5): sort by `alert_type` rank (warning > watch > advisory
  > statement) then recency; per-alert area (`feature_name_en`),
  Risk/Confidence when present, Issued/Ends, `alert_text_en` **verbatim** at
  `standard`+`full`; **no invented severity lines**. Same 10/25/summary caps.
  Footer: `*Data source: Environment and Climate Change Canada (MSC GeoMet).
  Alert content shown unaltered.*`
- Zero-warning paths: "No active weather alerts for <Country/this area>."
  D6: `active_only: false` on either new source appends one line — historical
  alerts are not available for this region — never an error.
- Not-covered message: friendly, names the region, states current coverage
  (US, Canada, European MeteoAlarm members).
- Registration in `src/index.ts`: construct `MeteoAlarmService` and
  `GeoMetService` beside the other keyless services; pass all three new
  services at the `get_alerts` dispatch (`:753-755`); rewrite the tool
  description (`:355`) — remove "(US only)", state the three-region coverage
  and country-level European granularity, keep the semantic triggers and
  location-input wording.
- Acceptance: full gate green; **`tests/unit/alerts-detail.test.ts` and
  `tests/unit/alert-sorting.test.ts` pass unedited** (the US no-change lock —
  if either needs editing, stop and ask). Quick sanity against the built
  dist: Munich coordinates return German warnings (or the clean empty
  message), Toronto returns a GeoMet response, Seattle output diffs clean
  against `main`.
- Commit: `feat: Route get_alerts by country — NOAA, MSC GeoMet, MeteoAlarm`
- Depends on: T1, T2, T3, T5 (T4 may still be in flight — disjoint files)

**T7 — `get_weather_summary`: drop the US-only short-circuit** (`sonnet`)

- Files: `src/handlers/weatherSummaryHandler.ts`, `src/index.ts`,
  `tests/unit/weather-summary-handler.test.ts`
- Delete the short-circuit (`weatherSummaryHandler.ts:121-132`) **and the
  now-unused `isInUS` import** (`:18` — `noUnusedLocals`). Thread the three
  new services: extend `handleGetWeatherSummary`'s parameters, pass them to
  `handleGetAlerts` at `:148`, and update the dispatch call site
  (`src/index.ts:765`). The alerts section now dispatches everywhere; the
  handler's own routing produces alerts or the not-covered message.
- Update `tests/unit/weather-summary-handler.test.ts:126-139` intentionally
  (designed behaviour change): London now **dispatches** to the (mocked)
  alerts handler; add a not-covered-region case asserting the section renders
  the handler's message via the normal dispatch path; the US dispatch case
  stays.
- Acceptance: full gate green; no other summary test assertions change.
- Commit: `feat: Extend weather summary alerts section beyond the US`
- Depends on: T6

### Phase 4 — Tests

**T8 — Routing unit tests** (`sonnet`)

- Files: `tests/unit/alerts-routing.test.ts` (new)
- Real handler, plain fake services (template:
  `tests/unit/current-conditions-global.test.ts`). Cover, per the design's
  testing section: Toronto coordinates + fake reverse `ca` → GeoMet called,
  NOAA **not** called (country wins over `isInUS`); coordinate-only requests
  consult the reverse service; a resolved `country_code` (saved/geocoded,
  uppercase `"DE"`) skips reverse entirely and routes to MeteoAlarm
  (casing normalization); reverse `null` + US point → NOAA (marine
  preservation); reverse `null` + non-US → not-covered, no note; reverse
  *throws* + non-US → not-covered **with** the one-line note; absent
  `nominatimService` → silent `isInUS` fallback; not-covered message for a
  non-member country; `active_only: false` note on both new sources;
  `detail` caps (11 warnings → 10 shown + remainder at `standard`; 25 at
  `full`; counts-only at `summary`).
- Acceptance: deterministic, no live calls; full gate green.
- Commit: `test: Cover country routing and international alert rendering`
- Depends on: T6 · **parallel-safe with T7, T9** (disjoint files)

**T9 — Integration tests: captured shapes + tolerant live smoke** (`sonnet`)

- Files: `tests/integration/international-alerts.test.ts` (new)
- Two blocks: (1) mocked HTTP against the real services + handler end to end
  using the trimmed captured shapes — a MeteoAlarm country feed (multi-language
  `info`, expired items, an `Update` chain), a GeoMet feature collection
  (incl. an `ended` item), and a `numberMatched: 0` body; (2) one live smoke
  test per source (a MeteoAlarm country feed; the GeoMet collection with a
  Toronto bbox) following the tolerant-of-flake convention — generous
  timeouts, assert shape not values, never fail on a network error. **This
  adds a file to the live-network set** — say so in the file header.
- Acceptance: mocked block deterministic; live block tolerant; full gate green
  (re-run once if only live files are red).
- Commit: `test: Add international alerts integration coverage`
- Depends on: T6 (T4 recommended first so the live smoke uses the final map)
  · **parallel-safe with T7, T8** (disjoint files)

### Phase 5 — Live verification and docs

**T10 — Live acceptance sweep + documentation/registration checklist** (`opus`)

- Files: `CHANGELOG.md`, `README.md`, `docs/TOOLS.md`, `CLAUDE.md`,
  `docs/planning/README.md`,
  `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`,
  `docs/international-alerts-plan.md`
- **Live sweep against the built dist** — the design's seven acceptance
  points, run by the orchestrator personally:
  1. Munich (`city_name` **and** raw coordinates) → German warnings, coverage
     note, MeteoAlarm + DWD attribution, issue times shown.
  2. Toronto (raw coordinates) → GeoMet (ECCC alerts or clean empty), **not**
     NOAA.
  3. Seattle → byte-identical to `main` for the same arguments (diff the
     built-dist output).
  4. Sydney → not-covered message naming the region, not an error.
  5. US offshore point (~10 km off the Washington coast) → NOAA alerts.
  6. `get_weather_summary` Paris → real alerts section; Sydney → the
     handler's not-covered message.
  7. Two consecutive Munich calls → one country-feed fetch (verify via debug
     logs — the 2.8 MB class fetch happens once per 5 min).
- Docs, per the design's checklist:
  - CHANGELOG under `[Unreleased]` (A1 — appended beneath the unreleased
    composited-imagery content; no version bump here).
  - README: tool table ("US only" → three-region coverage), coverage notes,
    feature highlight, test-count badge.
  - `docs/TOOLS.md` `get_alerts`: coverage map, per-source output shapes,
    licence attributions, the country-level European granularity.
  - CLAUDE.md: `meteoalarm.ts`/`geomet.ts` in the architecture tree,
    `reverseCountry` note, v1.19.0 status blurb, and **every remaining "US
    only" claim about alerts corrected** (tool list, feature list, v1.12/v1.15
    blurbs mentioning alerts staying US-only).
  - `docs/planning/README.md`: flip the international-alerts row (`:36`)
    📝 → ✅ with the Shipped link; update the viability row (`:100`) and the
    ICR Phase 3 sequencing row in
    `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`.
  - Mark `docs/international-alerts-plan.md` status `IMPLEMENTED`, then **move
    the plan set (design plan + this file) to `docs/plans/`** per the
    playbook, updating references.
- Acceptance: the sweep recorded in this file (tracker section) or the commit
  message; full gate green; every box of the design's checklist satisfied.
- Commit: `docs: Record international weather alerts (MeteoAlarm + MSC GeoMet)`
- Depends on: T4, T7, T8, T9

## Assumptions to confirm before `/run-plan`

- **A1 — CHANGELOG state.** `[Unreleased]` already carries the merged
  composited-imagery content; international alerts appends beneath it and both
  presumably ship together as v1.19.0. The version bump stays a release step.
- **A2 — optional trailing services.** `handleGetAlerts` gains
  `meteoAlarmService?`, `geoMetService?`, `nominatimService?` appended last
  and optional, so `tests/unit/alerts-detail.test.ts`'s four-argument call
  passes unedited (METAR A6 precedent). Production always injects all three.
- **A3 — absent service vs failed lookup.** A missing `nominatimService`
  (test harnesses) falls back to `isInUS` **silently**; the D1 one-line note
  renders only when a real reverse lookup throws. This is what preserves the
  byte-identical stubbed-US-test output.
- **A4 — slug map sourcing.** The candidate map is seeded from MeteoAlarm's
  published membership; T4 drops any slug that cannot be live-verified rather
  than shipping it unverified (absent = not-covered, the designed graceful
  degradation). `gb → united-kingdom`.
- **A5 — country display names and national services.** Carried as columns of
  the `COUNTRY_FEEDS` map (name always; national met service where known,
  used in the attribution footer and omitted otherwise).
- **A6 — casing.** Stored/geocoded codes are uppercase, reverse results
  lowercase; the router normalizes to lowercase once, and the map is keyed
  lowercase.
- **A7 — fixtures are trimmed.** Raw captures (2.76 MB Germany) are never
  committed; fixtures keep only the load-bearing shapes and the < 2 s test
  budget.
- **A8 — reverse-country cache location.** Lives in `NominatimService`'s
  existing `Cache` member (like forward geocoding), keyed on 2-decimal
  rounding with the new `Infinity` TTL; `null` (ocean) results are cached too.
- **A9 — summary detail.** The summary passes its `detail` (default
  `summary`) through, so European alerts render as counts-by-severity/colour
  inside `get_weather_summary` — the designed lean behaviour, not a bug.

## Progress Tracker

- [x] T1 — `NominatimService.reverseCountry` + permanent cache (`sonnet`) — `279d4ad`
- [x] T2 — Thread `country_code` through `ResolvedLocation` (`sonnet`) — `c53f729`
- [x] T3 — MeteoAlarm types, service, and filter pipeline (`opus`) — `0f4c554`
- [x] T4 — Live-verify the full MeteoAlarm slug map (orchestrator-run sweep: 38/38 verified, `mk` slug corrected to `republic-of-north-macedonia`) — `2bece5b`
- [x] T5 — GeoMet types, service, and filtering (`sonnet`) — `ccb4953`
- [ ] T6 — Country routing + per-source renderers in `get_alerts` (`opus`)
- [ ] T7 — `get_weather_summary`: drop the US-only short-circuit (`sonnet`)
- [ ] T8 — Routing unit tests (`sonnet`)
- [ ] T9 — Integration tests: captured shapes + tolerant live smoke (`sonnet`)
- [ ] T10 — Live acceptance sweep + documentation checklist (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the design's seven live
acceptance points are demonstrably met against the built dist (Munich both
ways, Toronto → GeoMet, Seattle byte-identical, Sydney not-covered, US
offshore → NOAA, summary Paris/Sydney, cache single-fetch),
`tests/unit/alerts-detail.test.ts` and `tests/unit/alert-sorting.test.ts` pass
unedited, and `docs/international-alerts-plan.md` is marked `IMPLEMENTED` and
the plan set moved to `docs/plans/`. Opening the PR is the human's call.
