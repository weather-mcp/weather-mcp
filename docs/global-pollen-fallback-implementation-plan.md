# Global Pollen Fallback (Google Pollen API) — Implementation Plan

**Status:** READY (2026-08-18)

Execution plan for `docs/global-pollen-fallback-plan.md` (the WHAT/WHY); rules
live in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/global-pollen-fallback-implementation-plan.md
```

Or, equivalently: read `docs/global-pollen-fallback-plan.md` (design),
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

**Live-verification rule:** unlike prior plans, the upstream source is
**keyed** and was web-verified only (design header, facts a–e); the design's
upstream (f) list is a **live to-verify** that can only be resolved during T6
with a real `GOOGLE_POLLEN_API_KEY` — which requires a Google Cloud **billing
account the project does not yet have**. T6 therefore begins with the
orchestrator stopping to ask the human for a key (see T6's decision branch).
Everything before T6, including the keyless byte-identity sweep, needs no key.
Standing driver caveat: dist drivers need `process.exit(0)`; don't run live
drivers in parallel; **grep every driver's output and logs for the key string
afterwards — it must appear nowhere**.

## Scope & branch

**Branch:** `feat/global-pollen-fallback`, created **off `main`** (v1.21.0
released; tip `f895761` at plan time — record the actual base SHA at kickoff
for the T5 sweep). Target release: v1.22.0.

**Working-tree note (first commit):** the design doc
(`docs/global-pollen-fallback-plan.md`) and the related research register
`docs/planning/GOOGLE_KEY_OPPORTUNITIES.md` (catalogues what else the Google
key could unlock; its own header defers its index row to this branch) are
**untracked** at plan time. The branch's first commit (T0) lands both plus
this file: `docs: Add global pollen fallback plans and Google key register` —
before T1, as part of establishing the baseline. (Unlike the multi-model
precedent, no planning-index edits exist in the working tree; the index
updates happen in T5.)

In scope: the design's D1–D10 — an optional keyed Google Pollen API fallback on
`get_air_quality` that fires only when a `GOOGLE_POLLEN_API_KEY` is configured
**and** all six CAMS species come back null; a new service with FIRMS-grade
key-in-URL hygiene; day-1 UPI rendering in the existing `## 🌾 Pollen` slot
with the **mandatory exact attribution string**; silent-degrade failure modes
(rejected key excepted); config/cache/types; tests including the byte-identical
keyless lock; docs.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Multi-day Google pollen forecast | Design descope — day-1 ("current") section only. |
| Health-recommendation strings, per-plant deep detail | Design descope — UPI + category + in-season line only. |
| `statusHandler` key reporting | Design descope — matches FIRMS, which reports no key. |
| Persistent caching | Design descope — Google ToS; in-memory session cache only (disclosed trade-off, upstream (e)). |
| Any change to the CAMS fetch or render path | Design descope — Europe keeps keyless grains/m³ and never contacts Google; CAMS-present output stays byte-identical. |
| Retries in the Google service | Design D2 — garnish must not add latency on failure. |
| Version bump to v1.22.0 | Release step, not a task (project convention). |

## Findings that shape the graph

Spot-checks against the code (2026-08-18), reconciled into the tasks below:

- **All design anchors verified current.** CAMS species filter at
  `src/handlers/airQualityHandler.ts:187-194` with the render block at
  `:196-203` and the secondary-AQI line following at `:206`;
  `formatAirQuality` is synchronous (`:75`); `handleGetAirQuality` takes
  exactly 4 args (`:32-37`). `src/index.ts`: `firmsService` init at `:177`,
  tool description with the "pollen data is not available outside Europe" tail
  at `:497`, dispatch 4-arg call at `:831`. `FIRMSKeyRejectedError` and the
  key-hygiene doc-comment block in `src/services/firms.ts:28-51` are the
  templates for D2. `getUserAgent()` exists (`src/utils/version.ts:27`).
- **`CacheConfig.ttl` addition is additive-safe.** `tests/unit/config.test.ts`
  asserts specific TTL keys but not exhaustively — adding
  `googlePollen: 6 * HOUR` beside `floodDischarge: 6 * HOUR`
  (`src/config/cache.ts:118`, the design's stated posture peer) breaks
  nothing. The file must still pass unedited.
- **The keyless lock is real and 4-arg.** `tests/unit/air-quality-pollen.test.ts`
  (175 lines) calls `handleGetAirQuality` with exactly 4 args (`:45-50`), so
  the new `googlePollenService` parameter **must be optional and trailing
  (5th)** — `undefined` ⇒ old path by construction, and the file passes
  unedited. It also locks partial-CAMS rendering (≥ 1 real species → CAMS
  subset renders), which doubles as the "Google never fires on partial
  coverage" guard at the render level.
- **The hourly-param lock lives in `tests/unit/air-quality-forecast.test.ts`**
  (the `us_aqi,european_aqi,uv_index` string). Nothing in this plan touches
  `buildAirQualityParams`, so it must pass unedited.
- **No test locks the `get_air_quality` tool-description string** (grepped) —
  T4's description rewrite is test-safe.
- **`finiteCamsPollen` extraction must be byte-preserving.** The existing
  filter maps to `{label, value}` pairs consumed by the render loop; the
  shared helper must return the same pairs in the same order so the
  CAMS-present output (locked by the existing tests) doesn't move.
- **Error-class placement.** `GooglePollenKeyRejectedError extends Error`
  with a fixed message, in the service module — **not** `ApiError`
  (`ApiServiceName` is a closed union, `src/errors/ApiError.ts:8-14`; FIRMS
  deliberately stayed outside it).
- **Docs surface.** The design's checklist omits `docs/TOOLS.md`, but house
  convention (multi-model T7) updates it when a tool's behavior/description
  changes — T5 updates the `get_air_quality` section there too, as a
  necessary mechanical consequence.

## Task graph

### Phase 1 — Foundation

**T1 — Types, config key, cache TTL, .env.example** (`haiku`)

- Files: `src/types/googlePollen.ts` (new), `src/config/api.ts`,
  `src/config/cache.ts`, `.env.example`
- Per D3/D4 and the design's types checklist item:
  - `src/types/googlePollen.ts`: subset-only, **all-optional** fields —
    `GooglePollenResponse { dailyInfo?: GooglePollenDailyInfo[] }`;
    `GooglePollenDailyInfo { date?, pollenTypeInfo?, plantInfo? }`;
    `GooglePollenTypeInfo { code?, displayName?, inSeason?, indexInfo? }`;
    `GooglePollenIndexInfo { value?, category? }`; plant entries with
    `displayName?`/`inSeason?`/`indexInfo?`. Doc comment notes `indexInfo` is
    omitted entirely for out-of-season types (upstream (c)) and that exact
    casing is on the T6 live to-verify list.
  - `src/config/api.ts`: third entry `GOOGLE_POLLEN_API_KEY` +
    `isGooglePollenKeyAvailable()` (trim check), NCEI/FIRMS doc-comment
    convention verbatim: OPTIONAL; key from the Google Cloud console
    (**requires a billing account**; first 5,000 lookups/month free);
    benefits: pollen worldwide incl. the US (65+ countries); if not provided:
    European pollen via CAMS continues to work, no setup required; rate
    limits: 5,000/month free tier.
  - `src/config/cache.ts`: `googlePollen: 6 * HOUR` in `ttl`, beside
    `floodDischarge` with a comment (daily-model posture; shields the
    5,000/month quota; in-memory only per Google ToS — upstream (e)).
  - `.env.example`: third API-token entry after `FIRMS_MAP_KEY` (`:123-129`
    pattern), carrying the billing-account caveat.
- Acceptance: full gate green; `tests/unit/config.test.ts` passes unedited.
- Commit: `feat: Add Google Pollen API types, config key, and cache TTL`
- Depends on: — (first code task)

### Phase 2 — Service

**T2 — GooglePollenService: fetch, cache, error mapping, key hygiene** (`sonnet`)

- Files: `src/services/googlePollen.ts` (new),
  `tests/unit/google-pollen-service.test.ts` (new; `vi.mock('axios')`,
  `firms-service.test.ts` style)
- Per D2/D3, modeled on `firms.ts`:
  - Module doc-comment carries the FIRMS "Security: the key lives in the URL"
    block. The service **never logs or throws URLs or raw axios errors**;
    every thrown error is a fixed pre-written string; logs carry only
    `{ status, code }` (+ `redactCoordinatesForLogging` for coordinates).
  - `GooglePollenKeyRejectedError extends Error`, fixed message, exported
    (the `FIRMSKeyRejectedError` shape, `firms.ts:45-50`). Not `ApiError`.
  - `GooglePollenServiceConfig { timeout?, apiKey? }`; constructor defaults
    `apiKey` to `GOOGLE_POLLEN_API_KEY`, timeout to `CacheConfig.apiTimeoutMs`;
    `isKeyAvailable()` (trim check); `getCacheStats()`; `clearCache()`.
  - `getCurrentPollen(latitude, longitude): Promise<GooglePollenDailyInfo | undefined>`:
    `validateLatitude`/`validateLongitude`; axios GET
    `https://pollen.googleapis.com/v1/forecast:lookup` with
    `params: { key, 'location.latitude', 'location.longitude', days: 1,
    languageCode: 'en' }` and `User-Agent: getUserAgent()`. Returns
    `dailyInfo?.[0]`; empty/absent `dailyInfo` caches a null sentinel
    (uncovered regions aren't re-probed for the TTL) and returns `undefined`.
    **No retries.**
  - Cache key `Cache.generateKey('google-pollen', lat.toFixed(2),
    lon.toFixed(2))` (FIRMS 2-dp precedent), TTL `CacheConfig.ttl.googlePollen`.
  - Module-level `mapPollenApiError(error)` copying `mapAreaApiError`'s
    shape: `ECONNABORTED` → fixed timeout string; 400/403 whose stringified
    body contains a key-rejection marker (upstream (f): `API_KEY_INVALID` /
    `"API key not valid"` / `PERMISSION_DENIED`) →
    `GooglePollenKeyRejectedError`; 429 → fixed quota string; other status →
    fixed generic; no response → fixed network string. Doc comment flags the
    markers as web-verified, to be confirmed/adjusted at T6.
- Tests per design §Testing (service bullet): exact request params (`days: 1`,
  dotted location keys, `languageCode: 'en'`); cache hit on second call;
  empty `dailyInfo` → `undefined` **and** cached (transport called once
  across two calls); key-rejection body → `GooglePollenKeyRejectedError`;
  429 → fixed string; `ECONNABORTED` → fixed string; **key hygiene** — with
  a distinctive test key, assert its substring appears in no thrown message
  and no argument of any spied `logger` call; whitespace-only key →
  `isKeyAvailable()` false.
- Acceptance: full gate green; `tests/unit/firms-service.test.ts` passes
  unedited (pattern donor, untouched).
- Commit: `feat: Add GooglePollenService with key hygiene and error mapping`
- Depends on: T1

### Phase 3 — Handler

**T3 — Air-quality handler: trigger, render, failure modes** (`opus`)

- Files: `src/handlers/airQualityHandler.ts`,
  `tests/unit/air-quality-google-pollen.test.ts` (new)
- Per D1/D5/D6:
  - Extract the existing per-species filter (`:187-194`) into a shared
    `finiteCamsPollen(current)` helper used by both the trigger and the CAMS
    render block — **byte-preserving**: same `{label, value}` pairs, same
    order, so CAMS-present output doesn't move.
  - `googlePollenService` as optional trailing **5th** positional parameter
    on `handleGetAirQuality` (`undefined` ⇒ old path by construction — the
    4-arg lock file must keep passing).
  - After `getAirQuality` succeeds, fire Google **only when all hold**:
    service present and `isKeyAvailable()`; `airQualityData.current` exists;
    `finiteCamsPollen` returns zero species. Sequential, not parallel —
    the trigger needs the CAMS answer first (D1).
  - The entire Google fetch sits in one `try/catch`; the air-quality call
    **never** fails because of it. `GooglePollenKeyRejectedError` → set a
    `googleKeyRejected` flag + `logger.warn`; any other throw →
    `logger.warn`, nothing rendered; `undefined` (uncovered region /
    empty day) → `logger.info`, nothing rendered.
  - `googlePollen` + `googleKeyRejected` reach `formatAirQuality` as trailing
    optional parameters. Rendering per the D5 sketch, in the CAMS slot
    (after pollutant concentrations, before the secondary-AQI line), same
    `## 🌾 Pollen` heading: one line per type whose `indexInfo.value` is a
    finite number (`**Grass:** 2 (Low) — in season`; zero-with-`indexInfo`
    renders; missing `indexInfo` omits the type); `In season:` line from
    `plantInfo` (drops when empty); footer sentence
    `*Universal Pollen Index (0–5) for today. Source: Includes pollen data
    from Google.*` — the attribution substring is **mandatory and exact**
    (upstream (d)). All three types lacking `indexInfo` → no section.
    Slot priority: CAMS species present → today's block byte-identical; else
    Google block; else key-rejected note
    `*Note: GOOGLE_POLLEN_API_KEY was rejected; global pollen data is
    unavailable.*`; else nothing.
- Tests per design §Testing (handler bullet), mock service object
  `{ isKeyAvailable, getCurrentPollen }`: all-null CAMS + key → Google
  section containing the exact attribution string; real CAMS + key → CAMS
  section AND `getCurrentPollen` **not called** (partial-CAMS case too);
  generic service throw → no section, no note, call succeeds;
  `GooglePollenKeyRejectedError` → note line, call succeeds; empty day /
  all-types-missing-`indexInfo` → no section; **no 5th arg → output strictly
  equal (`toBe`) to keyless output**; zero-UPI-with-`indexInfo` renders;
  `isKeyAvailable() === false` → `getCurrentPollen` not called;
  `forecast: true` + Google section → hourly forecast section unchanged.
- Acceptance: full gate green; `tests/unit/air-quality-pollen.test.ts` and
  `tests/unit/air-quality-forecast.test.ts` pass **unedited**
  (`git diff --name-only` clean for both).
- Commit: `feat: Add Google Pollen global fallback to get_air_quality`
- Depends on: T1, T2

### Phase 4 — Registration

**T4 — index.ts wiring + tool description** (`haiku`)

- Files: `src/index.ts`
- Per D7: instantiate `const googlePollenService = new GooglePollenService()`
  beside the FIRMS init (`:177`); pass as 5th arg at the `handleGetAirQuality`
  dispatch (`:831`). Rewrite the description tail at `:497` (currently
  "…pollen data is not available outside Europe") to the three-state truth:
  European locations get CAMS grains/m³ automatically; elsewhere, a
  grass/tree/weed Universal Pollen Index is included when an optional
  `GOOGLE_POLLEN_API_KEY` is configured; otherwise pollen is unavailable
  outside Europe. No schema change (no new tool parameters).
- Acceptance: full gate green; diff touches only the import, the
  instantiation, the 5th arg, and the description string.
- Commit: `feat: Register Google Pollen fallback in get_air_quality wiring`
- Depends on: T3

### Phase 5 — Verification and docs

**T5 — Keyless byte-identity sweep + documentation checklist** (`opus`, orchestrator)

- Files: `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `docs/TOOLS.md`,
  `docs/GOOGLE_POLLEN_KEY_SETUP.md` (new), `docs/planning/README.md`,
  `docs/planning/FUTURE_ENHANCEMENTS.md`
- **Sweep against the built dist**, run by the orchestrator personally
  (branch-base SHA recorded at kickoff; `process.exit(0)` in drivers; no
  parallel live drivers; **no key set in the environment**):
  1. `get_air_quality` for a US point (Kansas City) → **byte-identical** to
     the branch base (built in a throwaway worktree, multi-model T7 method).
  2. `get_air_quality` for a European point (Berlin) → **byte-identical**
     to the branch base (CAMS section present, Google never constructed
     into the path).
- Docs, per the design's checklist:
  - `CHANGELOG.md` under a new `[Unreleased]` section: byte-identical-keyless
    claim, garnish doctrine, key hygiene, mandatory attribution, ToS
    in-memory-cache note, descoped multi-day; note that live verification
    against a real key happens at T6 (amend afterwards if T6 changes
    anything).
  - `README.md`: env-var table (`~:256`) gains `GOOGLE_POLLEN_API_KEY` with
    the billing caveat, linking to the setup doc below; coverage prose
    updated (pollen: Europe keyless, global with optional key).
  - `README.md` — new **"Optional API keys"** section (settled 2026-08-18,
    user direction): one consolidated place for the three optional keys,
    placed near the Configuration section and linked from the env-var table
    rows. Framing, in this order:
    1. **The default is the product** — every tool works with zero keys,
       zero signup, zero cost; most users should stop reading here. The
       headline claims at `:9`/`:51-52`/`:169` stay true *for the default
       configuration* and gain a pointer to this section as the honest
       caveat ("optional keys unlock a few extras — see Optional API
       keys").
    2. A small table: `NCEI_API_TOKEN` (free registration — official US
       climate normals), `FIRMS_MAP_KEY` (free registration — targeted
       wildfire queries, 5-day history), `GOOGLE_POLLEN_API_KEY`
       (**free tier but requires a Google Cloud billing account /
       credit card** — 5,000 lookups/month; pollen outside Europe, incl.
       the US; links to `docs/GOOGLE_POLLEN_KEY_SETUP.md`). What each key
       adds, what happens without it (the tool still works), and the
       registration cost stated plainly — the Google row must not be
       described as simply "free" given `:51`'s explicit "no credit card"
       promise.
    3. **Standing key policy**, stated in the section: optional keys must
       always have a usable free tier; the server will never *require* a
       key for any tool; features that would require a **paid** key are
       out of scope unless there is significant user demand for that
       specific service. (Also record this policy as a standing note in
       `docs/planning/README.md`'s intro so future feature triage inherits
       it.)
    The existing scattered key mentions (NCEI table row `:256`, FIRMS
    prose `:278`) get cross-links to the section rather than duplicated
    detail.
  - `docs/GOOGLE_POLLEN_KEY_SETUP.md` (new): small, concise walkthrough for
    creating the key — Google Cloud project, **billing account required**
    (first 5,000 lookups/month free, ~$10/1,000 after), enable the Pollen
    API, create + restrict an API key (restrict to the Pollen API only),
    set `GOOGLE_POLLEN_API_KEY`. Header carries a freshness stamp:
    `**Last verified:** 2026-08-18 (web-verified; not yet tested against a
    live key)` plus a one-line note that Google's signup flow and pricing
    change over time and the doc is re-verified periodically (cadence per
    the standing re-check decision — see A7). `.env.example` and the
    `src/config/api.ts` doc comment link to it.
  - `docs/TOOLS.md`: `get_air_quality` section — three-state pollen
    behavior + the attribution note.
  - `CLAUDE.md`: feature bullet mirroring the v1.20.0 FIRMS key-hygiene
    phrasing.
  - `docs/planning/README.md` pollen status row (`~:83`): annotate that the
    global (non-Europe) gap is closed via the optional Google key; link the
    design plan. Also add the 📋 RESEARCH row for
    `docs/planning/GOOGLE_KEY_OPPORTUNITIES.md` (its header defers the row
    to this branch), noting its #1 candidate (global alerts fallback) as a
    possible future 💡.
  - `docs/planning/FUTURE_ENHANCEMENTS.md` §6.1 (`~:361`): mark the
    "MAJOR ISSUE: Lack of free, reliable API" blocker (`:385`) resolved —
    stale since the v1.18.0 CAMS ship, now fully closed by the keyed
    fallback.
- Acceptance: both sweep diffs empty, recorded in the tracker; full gate
  green; every design-checklist docs box satisfied (the plan-set move waits
  for T6).
- Commit: `docs: Record Google Pollen global fallback`
- Depends on: T4

**T6 — T-live: keyed live verification + upstream (f) resolution** (`opus`, orchestrator)

- Files: possibly `src/services/googlePollen.ts` +
  `tests/unit/google-pollen-service.test.ts` (only if live shapes differ from
  the web-verified mapping), `docs/global-pollen-fallback-plan.md` (status +
  implementation notes + move), this file (move), `CHANGELOG.md` (amend if
  needed)
- **Human gate first:** a real `GOOGLE_POLLEN_API_KEY` requires a Google
  Cloud billing account the project does not yet have. The orchestrator
  **stops and asks** the human to either (a) provision a key (put it in
  `weather-mcp/.env`, gitignored — the `FIRMS_MAP_KEY` convention), or
  (b) defer live verification. On (b): record "live verification pending a
  key; upstream (f) unresolved" in the design plan's implementation notes
  and CHANGELOG, mark the design plan `IMPLEMENTED (live verification
  deferred)`, move the plan set, tick this task as deferred-by-human. Do
  **not** silently skip.
- With a key, via scratchpad drivers against `dist/` (`process.exit(0)`;
  serial):
  1. US point → Google section renders with the exact attribution string.
  2. Berlin → CAMS section renders and (debug log, `LOG_LEVEL=0`) Google is
     **not** contacted.
  3. Garbage key → the rejected-key note line renders and the tool still
     succeeds.
  4. Resolve every upstream (f) item: rejected-key status + body markers;
     uncovered-region shape (error status vs empty `dailyInfo` — both must
     end at silent no-section); exact `indexInfo`/`category` field casing;
     whether zero-UPI in-season types carry `indexInfo`. Adjust
     `mapPollenApiError` / types / tests if live shapes differ; gate green
     after any adjustment.
  5. **Grep all driver output and logs for the key string — must appear
     nowhere.**
- On a successful keyed run, update `docs/GOOGLE_POLLEN_KEY_SETUP.md`'s
  freshness stamp to `**Last verified:** <date> (live-verified)` and correct
  any signup step that didn't match reality while provisioning the key —
  the provisioning walk-through **is** the doc's first field test.
- Then: fill the design plan's implementation notes, mark it `IMPLEMENTED`,
  **move the plan set (design plan + this file) to `docs/plans/`**, updating
  references (incl. the planning-README link).
- Acceptance: every T-live item recorded in the design plan's implementation
  notes (or the deferred-by-human record made); key-grep clean; full gate
  green; plan set moved.
- Commit: `docs: Record Google Pollen live verification` (or
  `fix: Adjust Google Pollen error mapping to live API shapes` first, if
  needed)
- Depends on: T5

## Assumptions to confirm before `/run-plan`

- **A1 — design status (RESOLVED 2026-08-18).** The design doc is now marked
  `✅ SETTLED` with D8–D10 backfilled during plan authoring; no T0 status
  flip needed.
- **A2 — key provisioning is a human step.** T6 cannot self-serve a Google
  Cloud billing account; the plan encodes an explicit stop-and-ask with a
  deferred-by-human branch rather than guessing.
- **A3 — error-mapping markers are provisional.** The 400/403 key-rejection
  body markers and the uncovered-region shape are web-verified only; T2
  implements them as designed and T6 is the authority that may amend them.
- **A4 — `docs/TOOLS.md` is in scope for T5** as a necessary mechanical
  consequence of the tool-description change, though the design's checklist
  omits it.
- **A5 — no schema change.** The feature adds no tool parameters; only the
  description string moves (no test locks it — grepped).
- **A6 — version bump.** Stays a release step, not a task.
- **A7 — quarterly re-verification of the key-setup doc (SETTLED
  2026-08-18).** The human chose a **scheduled cloud agent**: a quarterly
  routine (created outside this plan, at plan-authoring time) re-checks
  Google's Pollen API signup/pricing/free-tier pages against
  `docs/GOOGLE_POLLEN_KEY_SETUP.md` and reports drift. The doc's cadence
  note says "re-verified quarterly by a scheduled check". The routine
  no-ops gracefully while the doc doesn't exist yet.

## Progress Tracker

- [x] T0 — Land design doc + this file as first `docs:` commit; record base SHA + baseline gate (orchestrator) — `7ccf48c`
  - **Branch base SHA (for the T5 sweep): `f895761`** (`chore: Release v1.21.0`)
  - Baseline gate on `f895761`: `npm run build` 0 errors; `npm test` 89 files / 2161 tests passed; `npm audit` 0 vulnerabilities.
- [x] T1 — Types, config key, cache TTL, .env.example (`haiku`) — `aad8e13`
- [x] T2 — GooglePollenService: fetch, cache, error mapping, key hygiene (`sonnet`) — `c247892`
- [x] T3 — Air-quality handler: trigger, render, failure modes (`opus`) — `43417a8`
- [ ] T4 — index.ts wiring + tool description (`haiku`)
- [ ] T5 — Keyless byte-identity sweep + documentation checklist (`opus`, orchestrator)
- [ ] T6 — T-live: keyed live verification + upstream (f) resolution (`opus`, orchestrator; human key gate)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the T5 keyless sweep is
demonstrably byte-identical against the branch base for both points, the lock
files (`air-quality-pollen.test.ts`, `air-quality-forecast.test.ts`,
`config.test.ts`, `firms-service.test.ts`) pass **unedited**, T6's live items
are resolved (or the deferred-by-human record is made), the key string appears
in no output or log, and `docs/global-pollen-fallback-plan.md` is marked
`IMPLEMENTED` with the plan set moved to `docs/plans/`. Opening the PR is the
human's call.
