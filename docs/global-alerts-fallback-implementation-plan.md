# Global Alerts Fallback (Google Weather API) — Implementation Plan

**Status:** READY (2026-08-18)

Execution plan for `docs/global-alerts-fallback-plan.md` (the WHAT/WHY); rules
live in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/global-alerts-fallback-implementation-plan.md
```

Or, equivalently: read `docs/global-alerts-fallback-plan.md` (design),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — green baseline, one subagent per task, review
the diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass
npm audit         # no high/critical
```

**Gate caveat (standing):** several files under `tests/integration/` make live
network calls and flake independently (standing flaky-tests caveat). If the
gate goes red only in those files, re-run before suspecting the diff.

**Live-verification rule:** the upstream source is **keyed** and web-verified
only (design header, upstream (a)–(f)); upstream (g) is a live to-verify list
resolvable only at T6 with a real `GOOGLE_WEATHER_API_KEY`. The billing
account exists (pollen T6 provisioned it), but the **Weather API is not yet
enabled** on that project and the pollen key is **restricted to the Pollen
API** — so T6 still begins with a stop-and-ask human gate (enable the API;
mint or un-restrict a key). **T6 also carries the design's D10 free-tier
gate: if `publicAlerts:lookup` turns out to have no usable free quota, the
feature does not ship as designed — stop and return the plan to review.**
Everything before T6, including the keyless byte-identity sweep, needs no key.
Standing driver caveats: dist drivers need `process.exit(0)`; don't run live
drivers in parallel; grep every driver's output and logs for the key string
afterwards — it must appear nowhere.

## Scope & branch

**Branch:** `feat/global-alerts-fallback`, created **off `main`**. The design's
hard sequencing dependency is already satisfied: `feat/global-pollen-fallback`
merged and shipped as v1.22.0 (`09cff0b`), so the README "Optional API keys"
table, `docs/GOOGLE_POLLEN_KEY_SETUP.md`, and the planning-index register row
all exist on `main` for this branch to extend. Record the actual base SHA at
kickoff for the T5 sweep. Target release: v1.23.0.

**Working-tree note (first commit):** the design doc
(`docs/global-alerts-fallback-plan.md`) is **untracked** at plan time. T0
lands it plus this file as the branch's first commit:
`docs: Add global alerts fallback plans` — before T1, as part of establishing
the baseline. T0 also flips the design header from `🔶 DRAFT` to
`✅ SETTLED` (see A1).

In scope: the design's D1–D10 — an optional keyed Google Weather API
public-alerts fallback on the **elsewhere branch only** of `get_alerts`; a new
service with FIRMS-grade key-in-URL hygiene; a fourth CAP-shaped renderer with
the **two-layer mandatory attribution** (exact string
`Source: Includes weather data from Google` + per-alert `dataSource`
publisher line); **contract-not-garnish failure posture** (loud sanitized
errors, never a fabricated all-clear); honest-empty on `regionCode`-only
responses; config/types/cache; `get_weather_summary` pass-through; tests
including the keyless byte-identity lock; docs.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Any other Google Weather API endpoint (forecast/current/history; minute-nowcast) | Design descope — forecast/current/history rejected outright in the register; nowcast is register #2, its own future decision. |
| Polygon rendering / point-in-polygon filtering | Design descope — render `areaName`, disclose provider-polygon matching in the coverage caveat. |
| `languageCode` as a tool parameter | Design descope — pinned `en` (pollen precedent; Google translates `alertTitle` only anyway). |
| `statusHandler` key reporting | Design descope — matches FIRMS/pollen (no key reporting). |
| Persistent caching | Design descope — GMP ToS; in-memory 5-minute cache only (upstream (e)). |
| Retries in the new service | Design descope — matches GeoMet/MeteoAlarm. |
| Any change to the NOAA / GeoMet / MeteoAlarm paths or renderers | Design invariant — US/Canada/Europe never contact Google; three lock files pass unedited. |
| Client-side country allowlist | Design D1/D9 — Google answers coverage per request; no list ships in code. |
| Version bump to v1.23.0 | Release step, not a task (project convention). |

## Findings that shape the graph

Spot-checks against the code (2026-08-18), reconciled into the tasks below:

- **All design anchors verified current.** Routing ladder at
  `src/handlers/alertsHandler.ts:96-117` with the unconditional
  `notCoveredResult` call at `:118` (the exact line the new branch replaces);
  `notCoveredResult` itself at `:584-605`; the shared CAP helpers the D5
  renderer reuses all exist (`formatPublishedTime` `:256`,
  `regionDisplayName` `:270`, `capSeverityRank` `:288`, `capSeverityEmoji`
  `:292`, `STANDARD_DISPLAY_CAP`/`FULL_DISPLAY_CAP` `:53-54`).
  `src/index.ts`: pollen service init at `:185` (the new init sits beside
  it), `get_alerts` dispatch with seven args at `:809-811`,
  `get_weather_summary` dispatch at `:819-824`, `get_alerts` tool
  description at `:398`. `handleGetWeatherSummary` threads services to its
  own `handleGetAlerts` call at `src/handlers/weatherSummaryHandler.ts:152`.
- **No `CacheConfig` change needed.** Design D3 reuses
  `CacheConfig.ttl.alerts` (5 min, `src/config/cache.ts:95`) — unlike the
  pollen plan there is no new TTL entry, so `tests/unit/config.test.ts` is
  untouched by construction.
- **The keyless locks are real.** `tests/unit/alerts-routing.test.ts` calls
  `handleGetAlerts` 16 times with **at most seven args**, so the optional
  trailing 8th parameter exercises the keyless path by construction; its
  Australia case (`:208-215`) locks the not-covered message.
  `tests/unit/alerts-detail.test.ts` and `tests/unit/alert-sorting.test.ts`
  lock the NOAA renderer. All three must pass **unedited**.
- **Summary-handler arity is safe.** Both
  `tests/unit/weather-summary-handler.test.ts` and
  `tests/unit/current-conditions-global.test.ts` call
  `handleGetWeatherSummary` with at most nine args — the new optional
  trailing **10th** parameter (`googleWeatherService`) leaves them passing
  unedited, and their calls exercise the keyless path by construction.
- **No test locks the `get_alerts` tool-description string** (grepped) —
  T4's description extension is test-safe.
- **Pattern donors on `main`:** `src/services/googlePollen.ts` +
  `src/services/firms.ts` for the key-in-URL hygiene block, fixed-string
  error mapping, and `KeyRejectedError extends Error` placement
  (`ApiServiceName` is a closed union — stay outside `ApiError`);
  `tests/unit/google-pollen-service.test.ts` for the `vi.mock('axios')`
  service-test style including the key-hygiene assertions.
- **Docs surfaces from pollen all exist on `main`:** README "Optional API
  keys" section (`README.md:262`) with the three-row table (`:274-276`), the
  coverage table's alerts row (`:309` region), `docs/GOOGLE_POLLEN_KEY_SETUP.md`
  as the sibling template, and `docs/planning/GOOGLE_KEY_OPPORTUNITIES.md`
  §"#1 — Global weather alerts fallback" (`:47`) awaiting its status flip.
  The design's parent note deferred this doc's planning-index row until the
  pollen branch landed — it has, so the row is added in T5 on this branch.
- **Error-mapping markers are provisional.** The 400/403 key-rejection body
  markers, the `alertTitle` object shape, and the `regionCode`-only no-data
  shape are web-verified only; T2/T3 implement them as designed and T6 is
  the authority that may amend them (the pollen T6 precedent: the
  uncovered-region shape was the one real deviation found live).

## Task graph

### Phase 1 — Foundation

**T1 — Types, config key, .env.example** (`haiku`)

- Files: `src/types/googleWeather.ts` (new), `src/config/api.ts`,
  `.env.example`
- Per D2 (types) and D4 (config):
  - `src/types/googleWeather.ts`: subset-only, **all-optional** fields —
    `GoogleWeatherAlertsResponse { alerts?: GoogleWeatherAlert[]; regionCode?: string }`
    and `GoogleWeatherAlert` with `alertId?`, `alertTitle?` (typed loosely —
    doc comment flags its exact object shape as a T6 live to-verify),
    `eventType?`, `areaName?`, `description?`, `severity?`, `urgency?`,
    `certainty?`, `instruction?`, `safetyRecommendations?`, `startTime?`,
    `expirationTime?` (may be null), `timezoneOffset?`, `dataSource?`
    (`{ name?, fullName?, authorityUri? }` — loose, T6-verifiable),
    `regionCode?`. `polygon` deliberately not typed — never read.
  - `src/config/api.ts`: fourth entry `GOOGLE_WEATHER_API_KEY` +
    `isGoogleWeatherKeyAvailable()` (trim check), NCEI/FIRMS/pollen
    doc-comment convention verbatim: OPTIONAL; key from the Google Cloud
    console (**requires a billing account**; the **Weather API** must be
    enabled on the project — a Pollen-restricted key will not work);
    benefits: official weather alerts in ~45+ additional territories
    (Australia, Japan, Brazil, Mexico, …); if not provided: US, Canadian,
    and European alerts continue to work keyless, no setup required; rate
    limits: per Google's Weather API free tier. Setup guide:
    `docs/GOOGLE_WEATHER_KEY_SETUP.md` (created in T5).
  - `.env.example`: fourth API-key entry after `GOOGLE_POLLEN_API_KEY`
    (`:131-139` pattern), carrying the billing caveat and the
    pollen-key-reuse note (a key restricted to the Pollen API cannot serve
    this — enable the Weather API and use an unrestricted or
    Weather-restricted key).
- No `src/config/cache.ts` change — D3 reuses `CacheConfig.ttl.alerts`.
- Acceptance: full gate green; `tests/unit/config.test.ts` passes unedited.
- Commit: `feat: Add Google Weather API types and config key`
- Depends on: — (first code task)

### Phase 2 — Service

**T2 — GoogleWeatherService: fetch, cache, error mapping, key hygiene** (`sonnet`)

- Files: `src/services/googleWeather.ts` (new),
  `tests/unit/google-weather-service.test.ts` (new; `vi.mock('axios')`,
  `google-pollen-service.test.ts` style)
- Per D2/D3, modeled on `googlePollen.ts`/`firms.ts`:
  - Module doc-comment carries the "Security: the key lives in the URL"
    block. The service **never logs or throws URLs or raw axios errors**;
    every thrown error is a fixed pre-written string; logs carry only
    `{ status, code }` (+ `redactCoordinatesForLogging` for coordinates).
  - `GoogleWeatherKeyRejectedError extends Error`, exported, fixed
    actionable message naming `GOOGLE_WEATHER_API_KEY` and suggesting the
    Weather API be enabled and the key unrestricted or Weather-restricted
    (the D4 pollen-key-reuse trap). **Not** `ApiError`.
  - `GoogleWeatherServiceConfig { timeout?, apiKey? }`; constructor defaults
    `apiKey` to `GOOGLE_WEATHER_API_KEY`, timeout to
    `CacheConfig.apiTimeoutMs`; `isKeyAvailable()` (trim check);
    `getCacheStats()`; `clearCache()`.
  - `getPublicAlerts(latitude, longitude): Promise<GoogleWeatherAlert[]>`:
    `validateLatitude`/`validateLongitude`; axios GET
    `https://weather.googleapis.com/v1/publicAlerts:lookup` with
    `params: { key, 'location.latitude', 'location.longitude',
    languageCode: 'en' }` and `User-Agent: getUserAgent()`. A
    `regionCode`-only body (no `alerts` array) returns `[]` **and is
    cached** — an uncovered region isn't re-probed for the TTL. **No
    retries.**
  - Cache key `Cache.generateKey('google-weather-alerts', lat.toFixed(2),
    lon.toFixed(2))` (FIRMS 2-dp precedent), TTL `CacheConfig.ttl.alerts`
    (5 min — alerts volatility is alerts volatility regardless of source).
  - Module-level `mapPublicAlertsError(error)` copying
    `mapPollenApiError`'s shape: `ECONNABORTED` → fixed timeout string;
    400/403 whose stringified body contains a key-rejection marker
    (upstream (g): `API_KEY_INVALID` / `"API key not valid"` /
    `PERMISSION_DENIED`) → `GoogleWeatherKeyRejectedError`; 429 → fixed
    quota string; other status → fixed generic; no response → fixed network
    string. Doc comment flags the markers as web-verified, to be
    confirmed/adjusted at T6.
- Tests per design §Testing (service bullet): exact request params (dotted
  location keys, `languageCode: 'en'`, **no `days` param**); cache hit on
  second call (transport called once); `regionCode`-only body → `[]` and
  cached; key-rejection body → `GoogleWeatherKeyRejectedError`; 429 → fixed
  string; `ECONNABORTED` → fixed string; no-response → fixed network string;
  **key hygiene** — with a distinctive test key, assert its substring
  appears in no thrown message and no argument of any spied `logger` call;
  whitespace-only key → `isKeyAvailable()` false.
- Acceptance: full gate green; `tests/unit/google-pollen-service.test.ts`
  and `tests/unit/firms-service.test.ts` pass unedited (pattern donors,
  untouched).
- Commit: `feat: Add GoogleWeatherService with key hygiene and error mapping`
- Depends on: T1

### Phase 3 — Handler

**T3 — Alerts handler: elsewhere-branch routing + Google renderer** (`opus`)

- Files: `src/handlers/alertsHandler.ts`,
  `tests/unit/alerts-google-fallback.test.ts` (new)
- Per D1/D5/D6 — this is the design-sensitive core:
  - `handleGetAlerts` gains an optional trailing **8th** parameter
    `googleWeatherService?: GoogleWeatherService`. The elsewhere branch
    (`:118`) becomes: if the service is present and `isKeyAvailable()`,
    `return handleGoogleAlerts(...)`; else `return notCoveredResult(...)`
    **byte-identically** (same call, same args — no advertising line).
    **No client-side country gate** (D1): the branch order alone guarantees
    the invariant — a US, Canadian, or MeteoAlarm-country request never
    reaches the Google branch, key or no key. Open-ocean/no-country non-US
    points reach Google when keyed; the existing `reverseLookupFailed`
    one-line note still renders on the Google path too.
  - New `handleGoogleAlerts(resolved, googleWeatherService, countryCode,
    active_only, detail, reverseLookupFailed)` renderer, deliberately close
    to `handleMeteoAlarmAlerts` and reusing the existing helpers: header
    `# Weather Alerts — <regionDisplayName>` (fall back to a generic header
    when no country resolved), location line, `active_only: false` → the
    same historical-not-available note, sort by `capSeverityRank` (Google's
    severity enum is exactly NOAA's) then by `expirationTime`,
    `capSeverityEmoji` markers, `summary` counts-only /
    `standard` (cap 10) / `full` (cap 25) with the remainder note.
  - Per alert: title from `alertTitle` (fallback: humanized `eventType`,
    else `'Weather alert'` — the MeteoAlarm `?? 'Weather warning'`
    convention); severity/urgency/certainty line; `**Area:** areaName`;
    `**Effective:**`/`**Expires:**` from `startTime`/`expirationTime`
    rendered in the alert's own `timezoneOffset` (times-as-issued doctrine;
    null `expirationTime` omits its line; absent `timezoneOffset` falls
    back to rendering the UTC instant as published); `description` verbatim
    at `full` only; `instruction` at `standard`+`full`;
    `safetyRecommendations` at `full`; empty arrays omit their lines;
    per-alert `**Source:** <dataSource fullName> (<authorityUri>)` — the
    layer-2 attribution (upstream (d)).
  - Standing coverage-caveat line above the footer (provider polygons,
    "coverage alignment may not be exact") on **both** empty and non-empty
    results. Footer per the D5 sketch, ending with the **exact mandatory
    string** `Source: Includes weather data from Google`.
  - **Failure posture is contract, not garnish (D6):** `[]` from the
    service → `✅ No active weather alerts found for this location via the
    Google Weather API.` plus the coverage caveat (honest-empty, FIRMS
    framing — never a bare all-clear); `GoogleWeatherKeyRejectedError` and
    every other service error **propagate** — no try/catch-to-empty, no
    silent degrade, exactly as a GeoMet or MeteoAlarm failure surfaces
    today.
- Tests per design §Testing (mock service
  `{ isKeyAvailable, getPublicAlerts }`):
  - Routing: Sydney + key → Google renderer output containing the exact
    mandatory attribution string; Sydney with `isKeyAvailable() === false`
    → not-covered message and `getPublicAlerts` **not called**; Sydney with
    no 8th arg → output **strictly equal** (`toBe`) to the keyless
    not-covered output; US point + key → NOAA path, Google not called;
    MeteoAlarm country + key (all services passed) → MeteoAlarm path,
    Google not called; Canada + key → GeoMet path, Google not called.
  - Rendering: severity sort + emoji; caps 10/25 + remainder note;
    `summary` counts-only; null `expirationTime` omits its line; per-alert
    `dataSource` attribution line; coverage caveat on both empty and
    non-empty; `active_only: false` note; missing `alertTitle` falls back
    to `eventType`.
  - Failure modes: `[]` → honest-empty + caveat;
    `GoogleWeatherKeyRejectedError` propagates with the fixed message
    (`await expect(...).rejects`); generic service error propagates
    sanitized.
- Acceptance: full gate green; `tests/unit/alerts-routing.test.ts`,
  `tests/unit/alerts-detail.test.ts`, and `tests/unit/alert-sorting.test.ts`
  pass **unedited** (`git diff --name-only` clean for all three).
- Commit: `feat: Add Google Weather alerts fallback to get_alerts`
- Depends on: T1, T2

### Phase 4 — Registration

**T4 — index.ts wiring, summary pass-through, tool description** (`haiku`)

- Files: `src/index.ts`, `src/handlers/weatherSummaryHandler.ts`
- Per D7:
  - Instantiate `const googleWeatherService = new GoogleWeatherService()`
    beside the pollen init (`src/index.ts:185`), with the doc-comment
    convention (optional keyed alerts fallback; without the key the
    keyless authorities are unaffected).
  - Pass as 8th arg at the `get_alerts` dispatch (`:809-811`) and as a new
    optional trailing **10th** parameter into `handleGetWeatherSummary`
    (`:819-824`), which threads it to its own `handleGetAlerts` call
    (`weatherSummaryHandler.ts:152`) — no flag-stripping needed (nothing
    here is a per-call flag).
  - Tool description (`:398`): extend the coverage sentence to the keyed
    truth — keyless coverage as today, plus *"with an optional
    `GOOGLE_WEATHER_API_KEY`, official alerts for ~45+ more territories
    (Australia, Japan, Brazil, Mexico, and others) via the Google Weather
    API"*. Representative list only, per D9. **No schema change** (no new
    tool parameters).
- Acceptance: full gate green; diff touches only the import, the
  instantiation, the two dispatch sites, the summary-handler signature +
  threading, and the description string;
  `tests/unit/weather-summary-handler.test.ts` and
  `tests/unit/current-conditions-global.test.ts` pass unedited.
- Commit: `feat: Register Google Weather alerts fallback in wiring`
- Depends on: T3

### Phase 5 — Verification and docs

**T5 — Keyless byte-identity sweep + documentation checklist** (`opus`, orchestrator)

- Files: `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `docs/TOOLS.md`,
  `docs/GOOGLE_WEATHER_KEY_SETUP.md` (new),
  `docs/planning/GOOGLE_KEY_OPPORTUNITIES.md`, `docs/planning/README.md`
- **Sweep against the built dist**, run by the orchestrator personally
  (branch-base SHA recorded at T0; the pollen T5 method — `git worktree` of
  the base, one stdio JSON-RPC driver against the real `dist/index.js`,
  unchanged across both builds; `GOOGLE_WEATHER_API_KEY` explicitly unset;
  `WEATHER_LIGHTNING_PREWARM=false`; `process.exit(0)`), calling
  `get_alerts` for four points and diffing base vs branch — all four must
  be **byte-identical**:
  1. Sydney (not-covered path — the elsewhere branch, keyless)
  2. a US point (NOAA path)
  3. Berlin (MeteoAlarm path)
  4. Toronto (GeoMet path — also re-locks the CONUS-overrun edge case)
  Verify the runs genuinely exercised each path (not vacuously empty), and
  grep both outputs for any key fragment.
- Docs, per the design's checklist (all pollen-created surfaces exist on
  `main`):
  - `CHANGELOG.md` under a new `[Unreleased]` section: keyed elsewhere-only
    fallback; byte-identical-keyless claim; **contract-not-garnish failure
    posture** (loud errors, honest-empty with caveat); two-layer mandatory
    attribution; key hygiene; ToS in-memory 5-min cache note; note that
    live verification (incl. the D10 free-tier gate) happens at T6.
  - `README.md`: env-var table row for `GOOGLE_WEATHER_API_KEY` (beside
    `:258`); "Optional API keys" table (`:274-276`) gains the fourth row —
    what the key adds (official alerts beyond US/Canada/Europe,
    representative territory list), what still works without it, the
    billing caveat stated plainly (never "free"), setup-guide link; the
    coverage table's alerts row (`:309` region) updated to the keyed tier;
    coverage prose updated per D9 (representative list + "per Google's
    coverage page" pointer, never exhaustive).
  - `docs/GOOGLE_WEATHER_KEY_SETUP.md` (new): short sibling of
    `docs/GOOGLE_POLLEN_KEY_SETUP.md`, cross-referencing the shared console
    steps (project, billing — including the live-verified corrections the
    pollen doc already carries: Application restrictions **None**, quota
    caps) and differing only in: enable the **Weather API**, restrict the
    key to the Weather API, set `GOOGLE_WEATHER_API_KEY`, and the explicit
    pollen-key-reuse note (D4). Freshness stamp:
    `**Last verified:** 2026-08-18 (web-verified; not yet tested against a
    live key)` — upgraded at T6.
  - `docs/TOOLS.md`: `get_alerts` section — keyed coverage tier +
    attribution note + provider-polygon caveat.
  - `CLAUDE.md`: feature bullet (mirror the pollen/FIRMS phrasing:
    elsewhere-only routing invariant, contract-not-garnish, key hygiene,
    exact attribution string, ToS cache).
  - `docs/planning/GOOGLE_KEY_OPPORTUNITIES.md` §#1 (`:47`): status flip to
    "designed: `docs/global-alerts-fallback-plan.md`" (amended to
    implemented/moved at T6).
  - `docs/planning/README.md`: add this feature's row (the design's parent
    note deferred it until pollen landed — it has); update the
    GOOGLE_KEY_OPPORTUNITIES row (`:69`) whose "#1 candidate … possible
    future 💡" text is now in-flight; update the international-alerts row
    (`:45`)'s "rest-of-world stays out" caveat to point at the keyed
    fallback.
  - **Quarterly routine prompt update (A7):** the existing scheduled
    key-doc re-check routine (created at pollen plan-authoring, lives
    outside the repo) must gain the new doc + the Weather API pages in its
    scope. The orchestrator updates the routine's prompt if it has access
    to `/schedule`, else records a one-line TODO for the human in the
    tracker — do not silently skip.
- Acceptance: all four sweep diffs empty, recorded in the tracker; full
  gate green; every design-checklist docs box satisfied except the
  CHANGELOG/plan-set items that wait for T6.
- Commit: `docs: Record Google Weather alerts fallback`
- Depends on: T4

**T6 — T-live: keyed live verification + upstream (g) + D10 free-tier gate** (`opus`, orchestrator)

- Files: possibly `src/services/googleWeather.ts` +
  `tests/unit/google-weather-service.test.ts` + `src/types/googleWeather.ts`
  (only if live shapes differ from the web-verified mapping),
  `docs/global-alerts-fallback-plan.md` (status + implementation notes +
  move), this file (move), `CHANGELOG.md` (amend if needed),
  `docs/GOOGLE_WEATHER_KEY_SETUP.md` (freshness upgrade)
- **Human gate first:** the billing account exists (pollen), but the
  Weather API must be enabled and a usable key produced (the pollen key is
  Pollen-restricted — mint a second Weather-restricted key on the same
  project, or un-restrict; put it in gitignored `weather-mcp/.env` as
  `GOOGLE_WEATHER_API_KEY`, the FIRMS/pollen convention). The orchestrator
  **stops and asks** the human to either (a) provision, or (b) defer live
  verification. On (b): record "live verification pending a key; upstream
  (g) and the D10 free-tier gate unresolved" in the design plan's
  implementation notes and CHANGELOG, mark the design plan
  `IMPLEMENTED (live verification deferred)`, move the plan set, tick this
  task as deferred-by-human. Do **not** silently skip.
- **D10 free-tier gate, first item with a key:** confirm from the console /
  SKU pages that `publicAlerts:lookup` bills under a SKU with a usable free
  tier (expected: Weather Essentials, 10,000/month). **If it has no free
  quota, stop — the standing key policy says this feature does not ship as
  designed; report to the human and return the plan to review.** Record the
  verified SKU + quota in the design plan's implementation notes and
  correct any docs numbers.
- With a key and the gate passed, via scratchpad drivers against `dist/`
  (`process.exit(0)`; serial; **frugal** — the household Google quota
  discipline from the pollen key applies):
  1. Sydney (or wherever a live warning exists — pick from Google's
     coverage) → warnings render with **both** attribution layers.
  2. Mid-Pacific point → honest-empty + coverage caveat.
  3. Garbage key → the fixed rejected-key error propagates (tool errors
     loudly — contract posture), logs carry only `{ status, code }`.
  4. US point, Berlin, Toronto with the key set and `LOG_LEVEL=0` → Google
     **not contacted** (zero Google log lines).
  5. Resolve every upstream (g) item: rejected-key status + body markers;
     the exact `alertTitle` object shape; the `regionCode`-only shape vs
     any error status for genuinely uncovered countries (the pollen
     deviation precedent — an uncovered region answered HTTP 400 there,
     not the documented empty shape); covered-country point outside every
     provider polygon; `instruction`/`safetyRecommendations` element types;
     timestamp formats and `timezoneOffset` presence. Adjust
     `mapPublicAlertsError` / types / renderer / tests if live shapes
     differ; gate green after any adjustment.
  6. **Grep all driver output and logs for the key string — must appear
     nowhere.**
- On a successful keyed run: upgrade `docs/GOOGLE_WEATHER_KEY_SETUP.md` to
  `**Last verified:** <date> (live-verified)` and correct any console step
  that didn't match reality — the provisioning walk-through is the doc's
  first field test.
- Then: fill the design plan's implementation notes, mark it `IMPLEMENTED`,
  **move the plan set (design plan + this file) to `docs/plans/`**, update
  inbound references (planning README, GOOGLE_KEY_OPPORTUNITIES #1,
  CHANGELOG), and flip #1's status to shipped/implemented.
- Acceptance: D10 gate explicitly resolved and recorded; every upstream (g)
  item recorded in the design plan's implementation notes (or the
  deferred-by-human record made); key-grep clean; full gate green; plan set
  moved.
- Commit: `docs: Record Google Weather alerts live verification` (preceded
  by `fix: Adjust Google Weather error mapping to live API shapes` if
  needed)
- Depends on: T5

## Assumptions to confirm before `/run-plan`

- **A1 — design status.** The design header reads `🔶 DRAFT — review +
  `/impl-plan` pending`. This plan's authoring is that review pass (every
  anchor spot-checked; no contradictions found). The human should confirm
  the design is settled; T0 then flips the header to `✅ SETTLED` as part
  of the first docs commit. If the human wants design changes, they happen
  before `/run-plan`.
- **A2 — sequencing satisfied.** The design's hard dependency
  ("create the branch only after `feat/global-pollen-fallback` merges") is
  met — v1.22.0 shipped; all pollen-created doc surfaces verified present
  on `main`. The design's own text still describes them as future ("created
  by pollen T5") — read those references as present-tense.
- **A3 — key provisioning is a human step, but cheaper than pollen's.** The
  billing account exists; T6's gate is "enable the Weather API + mint/adjust
  a key", not "create a billing account". The plan still encodes an explicit
  stop-and-ask with a deferred-by-human branch.
- **A4 — the D10 free-tier gate is a real stop condition.** If
  `publicAlerts:lookup` has no usable free quota, T6 halts the feature and
  returns the plan to review — this is a named gate, not a footnote.
- **A5 — error-mapping markers and response shapes are provisional**
  (web-verified only); T2/T3 implement as designed, T6 may amend (pollen
  precedent: one real deviation found live).
- **A6 — no schema change; no test locks the `get_alerts` description**
  (grepped) — T4's description edit is test-safe.
- **A7 — quarterly re-verification routine.** The scheduled key-doc
  re-check routine from the pollen plan lives outside the repo; extending
  its scope to the new setup doc is a prompt update handled at T5 (or a
  recorded TODO for the human), not a new trigger.
- **A8 — version bump to v1.23.0** stays a release step, not a task.

## Progress Tracker

- [x] T0 — Land design doc + this file as first `docs:` commit; flip design status to SETTLED; record base SHA + baseline gate (orchestrator) — `f9b1eaa`
  - **Branch base SHA: `09cff0b`** (v1.22.0 release commit on `main`) — the T5 sweep diffs against this.
  - Baseline gate on the fresh branch: `npm run build` 0 errors; `npm test` 91 files / 2204 tests passed; `npm audit` 0 vulnerabilities.
- [x] T1 — Types, config key, .env.example (`haiku`) — `8aff76e`
- [x] T2 — GoogleWeatherService: fetch, cache, error mapping, key hygiene (`sonnet`) — `bca769d`
- [x] T3 — Alerts handler: elsewhere-branch routing + Google renderer (`opus`) — `99f5712`
- [x] T4 — index.ts wiring, summary pass-through, tool description (`haiku`) — `e3d94e4`
- [ ] T5 — Keyless byte-identity sweep + documentation checklist (`opus`, orchestrator)
- [ ] T6 — T-live: keyed live verification + upstream (g) + D10 free-tier gate (`opus`, orchestrator; human key gate)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the T5 keyless sweep is
demonstrably byte-identical against the branch base for all four points
(Sydney / US / Berlin / Toronto), the lock files
(`alerts-routing.test.ts`, `alerts-detail.test.ts`, `alert-sorting.test.ts`,
`weather-summary-handler.test.ts`, `current-conditions-global.test.ts`,
`config.test.ts`, `google-pollen-service.test.ts`, `firms-service.test.ts`)
pass **unedited**, T6's live items **including the D10 free-tier gate** are
resolved (or the deferred-by-human record is made), the key string appears in
no output or log, and `docs/global-alerts-fallback-plan.md` is marked
`IMPLEMENTED` with the plan set moved to `docs/plans/`. Opening the PR is the
human's call.
