# Global Normals Hardening — Implementation Plan

**Status:** READY (2026-08-16)

Execution plan for `docs/plans/global-normals-hardening-plan.md` (the WHAT/WHY);
rules live in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/plans/global-normals-hardening-implementation-plan.md
```

Or, equivalently: read `docs/plans/global-normals-hardening-plan.md` (design),
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
**live network calls** and flake independently. If the gate goes red only in
those files, re-run before suspecting the diff. Standing driver caveat for the
T8 checks: dist drivers need `process.exit(0)`; don't run live drivers in
parallel.

**Live-verification rule:** the archive-API facts (full-year pull +2.5 % bytes
over the current month±1 shape; interior days returned regardless; three
consecutive 30-year pulls with no rate-limit headers; the 429 weighting is
real per fair-use terms but intermittent) were live-verified 2026-08-17 —
design §Live verification. The design's footer instructs re-verifying archive
weighting **if significant time passes** before implementation; the
orchestrator should do one full-year pull at kickoff if more than a couple of
weeks have elapsed. What can only be trusted against the built dist is the
**US byte-stability guarantee** and the T8 live spot checks — the orchestrator
runs those personally; a subagent's claim is never the gate.

## Scope & branch

**Branch:** `feat/global-normals-hardening`, created off
`docs/global-normals-hardening` @ `1087267` — **not off `main`**. `main` is
still at `bcb9672` (v1.20.0); the unreleased v1.21.0 multi-model work and the
design plan live only on the docs branch. Record the actual base SHA at
kickoff — the T8 byte-stability diff runs against it. Target release: the
next minor after v1.21.0.

**Working-tree note (first commit, T0):** two uncommitted items exist at plan
time — a `docs/orchestration-playbook.md` edit (the model-policy
planning/execution split paragraph) and this file. T0 lands both as the
branch's first `docs:` commit, before T1, as part of establishing the
baseline. (The design plan and the planning-index stale-row corrections are
already committed in `1087267`.)

In scope: the design's D1–D7 — one full-year archive pull per location cached
as a 366-slot table under a new `CacheConfig.ttl.normals` entry; sample
hygiene (null-skipping, min-15 rule, Feb 29 carve-out at min 6); in-flight
dedupe + one bounded 429 retry with the soft-fail contract unchanged; the
NCEI gate moved to the shared `isInUS`; float-precision storage with
render-time rounding; one shared render helper with the failure heading
aligned to `## 📊 Climate Context`; the D7 test tightening; docs and the
planning-row flip.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Removing NCEI | Design non-goal — stays as the token-gated US upgrade. |
| International record highs/lows | No global ACIS equivalent; records remain US-only garnish, untouched. |
| Persistent on-disk caching | Project has no disk cache anywhere; D1 reduces restart-refetch to one pull per location. |
| Extending `include_normals` to more tools / schema changes | Design non-goal. |
| met.no / other providers | Separate ICR Phase 5 items. |
| ACIS records blocks in the handlers | Confirmed independent garnish; **byte-untouched** by every task. |
| Version bump | Release step, not a task (project convention). |

## Findings that shape the graph

Spot-checks against the code (2026-08-16), reconciled into the tasks below:

- **All design line references verified current:** `isLocationInUS` at
  `normals.ts:216`, `getClimateNormals` orchestration `:243`,
  compute-time rounding `:95-97`; service `getClimateNormals` at
  `openmeteo.ts:1611` with the misleading ±1-month comment `:1638-1646`;
  `isInUS` at `geography.ts:322`; the five render blocks at
  `forecastHandler.ts:559` (NOAA path), `:795` (Open-Meteo path),
  `currentConditionsHandler.ts:604` (NOAA), `:889` (Open-Meteo), `:1220`
  (METAR); the deleted-by-design test cases at `normals.test.ts:294-344`;
  the either-way assertion at `current-conditions-global.test.ts:690-701`.
- **The five render blocks differ only in inputs.** Each derives `month/day`
  from a different date source and builds `currentTemps` differently (NOAA
  day/night periods; Open-Meteo daily arrays; 24 h max/min converted to
  prefs; METAR passes `{}`). The D6 helper therefore takes
  `(openMeteoService, nceiService, latitude, longitude, month, day,
  currentTemps, prefs)` and returns the section string — the per-block
  input derivation stays in the handlers.
- **Precip render gotcha (D5).** `normalPrecipToPref` (`normals.ts:28-32`)
  returns inches **as-is** — today's clean display relies on the
  compute-time 2-decimal rounding D5 removes. Render-time rounding (inch →
  2 decimals; mm keeps its existing 1-decimal) must land **with or before**
  the float-storage switch, or imperial output prints raw floats
  mid-branch. Baked into T2, which precedes T3.
- **The old compute treats `null` as zero.** The `!== undefined` filters at
  `normals.ts:86-88` pass Open-Meteo's JSON `null`s into `reduce`, where
  `sum + null` coerces to `+ 0` and drags means down. D2's null-skipping is
  the fix, but it means values *can* legitimately shift at locations with
  archive gaps — the T8 byte-stability check must use a normal US **land**
  point with complete archive data.
- **Service-boundary fakes survive unedited.** `metar-handler.test.ts:161`
  and `almanac-handler.test.ts:287` mock `getClimateNormals` on the
  OpenMeteo fake with the exact `(lat, lon, month, day) → ClimateNormals`
  signature D1 keeps — they pass unedited, and they lock the signature.
- **Failure-heading change is safe against existing locks.** The only
  non-normals test touching the string is
  `forecast-model-comparison.test.ts:394` — a `not.toContain('Climate
  Normals')`, which the heading alignment makes *more* true.
  `almanac-handler.test.ts:634` asserts the note *text* only, which D6
  keeps.
- **The dedupe scenario is real.** `weatherSummaryHandler.ts:108` spreads
  the caller's args into every sub-handler, so a summary with
  `include_normals: true` fans out to forecast + current **concurrently**
  for the same coordinates — exactly D3's race.
- **No in-flight-dedupe precedent exists** in any service — T4 introduces
  the pattern (per-service `Map<string, Promise<…>>`, entry removed in
  `finally`, rejected pulls never cached or left in the map).
- **`getLastDayOfMonth` (`openmeteo.ts:1694`) has one caller** — the
  ±1-month window T3 deletes. It goes with it (mechanical consequence).
- **`config.test.ts:24-31` enumerates TTL entries** — T1 appends
  `expect(CacheConfig.ttl.normals).toBe(Infinity)` beside
  `historicalData`.
- **Old-helper deletion timing:** `computeNormalsFrom30YearData` and
  `getNormalsCacheKey` are used only by `openmeteo.ts:1621,1666` — they and
  their test blocks are deleted in T3, with the last caller, keeping every
  intermediate gate green.

## Task graph

### Phase 1 — Config + pure module

**T0 — Land working-tree docs** (orchestrator, with baseline)

- Files: `docs/orchestration-playbook.md` (uncommitted edit),
  `docs/plans/global-normals-hardening-implementation-plan.md` (this file)
- Create `feat/global-normals-hardening` off the docs-branch tip, run the
  full gate for the baseline (record counts + base SHA in the tracker),
  commit both docs.
- Commit: `docs: Add global-normals hardening implementation plan`

**T1 — Cache config entry** (`haiku`)

- Files: `src/config/cache.ts`, `tests/unit/config.test.ts` (append one
  assertion)
- Add `normals: Infinity` to `CacheConfig.ttl` with a house-style comment
  (1991–2020 normals never change; the full-year table is one entry per
  location). Append the `toBe(Infinity)` lock beside the `historicalData`
  one at `config.test.ts:31`.
- Acceptance: full gate green; diff is the entry + comment + one test line.
- Commit: `feat: Add normals TTL entry to cache config`
- Depends on: T0 · **parallel-safe with T2** (disjoint files)

**T2 — Pure table compute + render-precision groundwork** (`sonnet`)

- Files: `src/utils/normals.ts`, `tests/unit/normals.test.ts` (append only —
  deletions happen in T3/T5)
- Per D1, D2, D5:
  - Exported types `NormalsTableSlot` (unrounded canonical-imperial
    `tempHigh`/`tempLow`/`precipitation` floats + sample count) and
    `NormalsTable` (record keyed `"MM-DD"`, 366 slots; an unavailable slot
    is explicit — `null` or an `available: false` shape, implementer's
    choice, but indexing must distinguish it). Types live in the util
    (the `modelComparison.ts` precedent), not `src/types/`.
  - `computeNormalsTable(response: OpenMeteoHistoricalResponse):
    NormalsTable` — one pass over the full-year archive response computing
    all 366 MM-DD means. Per-variable means use only non-null, non-undefined
    samples. A slot is unavailable when any of the three variables has
    **fewer than 15** samples — except **Feb 29**, whose carve-out is
    **min 6** (8 leap days exist in 1991–2020). Stores **unrounded floats**
    (°F/inches, converted from the API's °C/mm).
  - `getNormalsTableCacheKey(latitude, longitude)` →
    `` `normals-table:${lat2dp}:${lon2dp}` `` (2-decimal rounding as today).
  - `normalPrecipToPref`: inch branch gains render-time 2-decimal rounding
    (`Math.round(inches * 100) / 100`) — a no-op against today's
    pre-rounded values, load-bearing once T3 stores floats. mm branch
    unchanged. `normalTempToPref` already rounds both branches — untouched.
  - Old helpers (`computeNormalsFrom30YearData`, `getNormalsCacheKey`)
    untouched — still the service's live path until T3.
- Tests (append): mean correctness against hand-computed fixtures; null
  samples skipped (a fixture where null-as-zero would give a different
  mean — locks the D2 fix); a <15-sample slot unavailable; a 15-sample slot
  available; Feb 29 available at 6–8 samples, unavailable below 6; float
  (unrounded) storage asserted; all-null variable → unavailable (open-ocean
  precedent); table cache-key format incl. 2-decimal rounding;
  `normalPrecipToPref` rounding lock with a raw-float input.
- Acceptance: full gate green; existing `normals.test.ts` cases pass
  unedited.
- Commit: `feat: Add full-year normals table computation`
- Depends on: T0 · **parallel-safe with T1** (disjoint files)

### Phase 2 — Service

**T3 — Service switch to the per-location table** (`sonnet`)

- Files: `src/services/openmeteo.ts`, `src/utils/normals.ts` (deletions),
  `tests/unit/normals.test.ts` (delete superseded blocks),
  `tests/unit/openmeteo-normals-table.test.ts` (new; the
  `openmeteo-fire-variables.test.ts` spy-on-private-transport pattern)
- Per D1:
  - Rewrite `OpenMeteoService.getClimateNormals` — **exact signature and
    `ClimateNormals` return shape kept** (the service-boundary fakes lock
    it): check the table cache under `getNormalsTableCacheKey`; on miss,
    fetch `/archive` for `1991-01-01`…`2020-12-31`, same three daily
    variables, `timezone: 'UTC'`; `computeNormalsTable`; cache the table
    under `CacheConfig.ttl.normals` (no hardcoded `Infinity`); index the
    requested `MM-DD` slot and return a `ClimateNormals`. An unavailable
    slot throws `DataNotFoundError('OpenMeteo', …)` — every call site's
    existing catch renders the note. The table (including its unavailable
    slots) is cached even when some slots are unavailable — open ocean must
    not refetch per date.
  - Delete the ±1-month window code and its misleading comment
    (`:1638-1650`) and the now-unused `getLastDayOfMonth` (`:1694`).
  - Delete `computeNormalsFrom30YearData` and `getNormalsCacheKey` from
    `utils/normals.ts` (last caller gone) and their describe blocks in
    `normals.test.ts` (`computeNormalsFrom30YearData` at `:17-113`,
    `getNormalsCacheKey` at `:115-145`) — superseded by T2's table tests,
    called out here by design (D7).
- Tests (new file): exact request params (full-year dates, three-variable
  `daily` list, `timezone: 'UTC'`); table cache key + TTL from
  `CacheConfig.ttl.normals`; **second date at the same location = zero
  additional transport calls** (the D1 point); different location =
  new fetch; unavailable slot → `DataNotFoundError`; all-null response →
  table cached, every slot unavailable, no refetch on a second date.
- Acceptance: full gate green; `metar-handler.test.ts`,
  `almanac-handler.test.ts`, `current-conditions-global.test.ts` pass
  **unedited**.
- Commit: `feat: Fetch normals as one full-year table per location`
- Depends on: T1, T2

**T4 — In-flight dedupe + bounded 429 retry** (`opus`)

- Files: `src/services/openmeteo.ts`,
  `tests/unit/openmeteo-normals-table.test.ts` (append)
- Per D3:
  - Private `Map<string, Promise<NormalsTable>>` keyed by the table cache
    key; concurrent `getClimateNormals` calls for the same location share
    one archive pull. The entry is removed in `finally` — a rejected pull
    is never cached and never left in the map (the next call refetches).
  - On `RateLimitError` from the pull: wait once (2 s + jitter), retry
    once; a second 429 propagates. All other errors propagate immediately,
    unchanged. **Failure contract unchanged** — every failure still ends at
    the call sites' existing catch and the unavailable note; nothing here
    fails the parent forecast/current response.
- Tests (append; fake timers for the backoff): two concurrent calls → one
  transport call, both resolve with correct (different-date) values;
  rejected pull doesn't poison the map (follow-up call triggers a fresh
  fetch); 429 then success → resolves, exactly two transport calls; 429
  twice → `RateLimitError` propagates, exactly two transport calls;
  non-429 error → no retry, one transport call.
- Acceptance: full gate green; suite stays deterministic and < 2 s (fake
  timers, no real sleeps).
- Commit: `feat: Dedupe concurrent normals pulls and retry once on 429`
- Depends on: T3

### Phase 3 — Predicate + render unification

**T5 — One US predicate** (`sonnet`)

- Files: `src/utils/normals.ts`, `tests/unit/normals.test.ts`
- Per D4: delete `isLocationInUS` (`normals.ts:216-226`); gate the NCEI
  attempt in `getClimateNormals` (the util orchestrator) on `isInUS` from
  `../utils/geography.js` — the same predicate the records line already
  uses. Update the reason-logging branch at `normals.ts:288-292`
  accordingly. Delete the `isLocationInUS` describe block
  (`normals.test.ts:294-344`, including the documented Toronto edge case)
  **with the function by design** — `isInUS` has its own locks in the
  geography tests. Add: an AK or HI point with an available NCEI fake →
  NCEI attempted (the finding-4 behavior delta); a non-US point → NCEI
  never attempted.
- Acceptance: full gate green; NCEI service tests pass unedited.
- Commit: `fix: Gate NCEI normals on the shared isInUS predicate`
- Depends on: T3 (same files as T3's deletions — serialized to keep diffs
  clean; no logic dependency)

**T6 — Shared render helper + heading alignment** (`opus`)

- Files: `src/utils/normals.ts`, `src/handlers/forecastHandler.ts`,
  `src/handlers/currentConditionsHandler.ts`, `tests/unit/normals.test.ts`
  (append)
- Per D6 (+ the five-blocks finding):
  - New exported helper in `utils/normals.ts` beside `formatNormals` —
    `renderNormalsSection(openMeteoService, nceiService, latitude,
    longitude, month, day, currentTemps, prefs): Promise<string>` — owning
    the try/catch, the `getClimateNormals` call, and both outcomes.
    Success output byte-identical to today's `formatNormals` path; the
    failure heading becomes `## 📊 Climate Context` (aligned to success),
    the note text `⚠️ Climate normals data not available for this
    location.` unchanged.
  - Replace all five handler blocks (`forecastHandler.ts:559,795`;
    `currentConditionsHandler.ts:604,889,1220`) with derivation of
    `month/day` + `currentTemps` (unchanged per-block logic) and one
    helper call. The adjacent ACIS records blocks are **byte-untouched**.
- Tests (append): helper success renders the `📊 Climate Context` heading
  and departures; helper failure renders the aligned heading + unchanged
  note text; heading-consistency lock (success and failure headings are the
  same string).
- Acceptance: full gate green; `almanac-handler.test.ts`,
  `metar-handler.test.ts`, `forecast-model-comparison.test.ts`,
  `current-conditions-global.test.ts` pass **unedited**.
- Commit: `refactor: Extract one shared climate-normals render helper`
- Depends on: T5

### Phase 4 — Test tightening + verification/docs

**T7 — Tighten the international-normals lock** (`sonnet`)

- Files: `tests/unit/current-conditions-global.test.ts`
- Per D7 / finding 6: replace the either-way assertion (`:690-701`) with a
  positive lock — the Tokyo `include_normals` call, with the fake OpenMeteo
  service's `getClimateNormals` resolving, must render the normals section
  (`📊 Climate Context`, normal high/low lines) and must **not** render the
  unavailable note. Add the inverse: a rejecting fake renders the aligned
  failure heading + note without failing the response.
- Acceptance: full gate green; only the one describe block changes.
- Commit: `test: Assert non-US normals render instead of either-way`
- Depends on: T6 (asserts the aligned failure heading)

**T8 — Byte-stability check, live spot checks, docs** (`opus`, orchestrator)

- Files: `CHANGELOG.md`, `CLAUDE.md`, `docs/TOOLS.md`, `README.md` (test
  counts), `docs/planning/README.md`,
  `docs/plans/global-normals-hardening-plan.md` (status + move), this file (move)
- **Checks against the built dist**, run by the orchestrator personally
  (base SHA from T0; `process.exit(0)` in drivers; no parallel live
  drivers):
  1. US land point (complete archive data — e.g. Kansas City),
     `include_normals: true`, keyless imperial default → success-path
     normals section **byte-identical** to the branch base (per the
     null-as-zero finding, a gap-free point is required for this to hold).
  2. Tokyo → non-US normals render.
  3. Paris, `units: metric` → renders; values may shift ≤ 0.5 °C vs base
     (the D5 fix — record, don't diff).
  4. Open-ocean point → unavailable note; a second date at the same point
     issues **no** second archive pull (log inspection).
  5. Feb 29 via `get_forecast` on a leap-adjacent window (or a direct
     dist driver against the service) → real leap-day mean renders.
  6. `get_weather_summary` with `include_normals: true` → one archive pull
     total for the fan-out (dedupe observed via logs).
- Docs, per the design's checklist:
  - CHANGELOG under `[Unreleased]`: hardening entry — one pull per
    location, dedupe + 429 retry, NCEI gate now covers AK/HI/PR, aligned
    failure heading, **and the D5 disclosure that metric normals may shift
    by ≤ 0.5 °C** (a precision fix, not drift).
  - CLAUDE.md + `docs/TOOLS.md`: normals are global (hybrid
    NCEI-when-tokened-US / computed Open-Meteo everywhere); correct any
    US-only phrasing.
  - `docs/planning/README.md:40`: hardening row 📝 → ✅ with the shipped
    link; move the plan set (design plan + this file) to `docs/plans/`,
    updating references; mark the design plan `IMPLEMENTED` with
    implementation notes recording the check results.
- Acceptance: all six checks recorded; full gate green; every box of the
  design's §Documentation checklist satisfied.
- Commit: `docs: Record global normals hardening`
- Depends on: T7

## Assumptions to confirm before `/run-plan`

- **A1 — slot availability is all-or-nothing.** A slot is unavailable when
  *any* of the three variables falls below its min-sample threshold —
  `ClimateNormals` requires all three fields, and partial normals would be
  a new output shape the design doesn't define.
- **A2 — unavailable-slot error type.** The service throws
  `DataNotFoundError('OpenMeteo', …)`; every call site's existing catch
  renders the note, so the class choice is invisible to users but should
  follow the house hierarchy.
- **A3 — table types live in `utils/normals.ts`** (the `modelComparison.ts`
  exported-result precedent), not `src/types/openmeteo.ts`.
- **A4 — precip render rounding.** Inch display rounds to 2 decimals at
  render (restoring today's display exactly); mm keeps its existing
  1-decimal render rounding. Without this, D5's float storage prints raw
  floats — the design implies it ("all rounding moves to render") but
  doesn't spell out precipitation.
- **A5 — deletion timing.** The old per-date helpers and their test blocks
  go in T3 (with their last caller), not T2 — every intermediate gate stays
  green.
- **A6 — branch base.** `feat/global-normals-hardening` branches off
  `docs/global-normals-hardening` @ `1087267` (main lacks the v1.21.0
  work); the T8 byte-stability diff runs against that SHA. If the docs
  branch has merged by kickoff, branch off `main` and record that SHA
  instead.
- **A7 — dedupe hygiene.** The in-flight map entry is removed in `finally`;
  a rejected pull is never cached and never left in the map.
- **A8 — version bump** stays a release step, not a task.

## Progress Tracker

**Baseline (2026-08-16):** branch `feat/global-normals-hardening` off
`docs/global-normals-hardening` @ `1087267` (the T8 byte-stability diff base).
Full gate green at kickoff — build 0 errors, **84 test files / 2,058 tests**
passing, `npm audit` 0 vulnerabilities.

- [x] T0 — Land working-tree docs (orchestrator, with baseline) — `dc2fbb0`
- [x] T1 — Cache config entry (`haiku`) — `cd132a4`
- [x] T2 — Pure table compute + render-precision groundwork (`sonnet`) — `888aaa2` (2,076 tests)
- [x] T3 — Service switch to the per-location table (`sonnet`) — `864ece1` (2,074 tests)
- [x] T4 — In-flight dedupe + bounded 429 retry (`opus`) — `16095ef` (2,079 tests)
- [x] T5 — One US predicate (`sonnet`) — `9de85d6` (2,072 tests)
- [x] T6 — Shared render helper + heading alignment (`opus`) — `41b8920` (2,076 tests)
- [x] T7 — Tighten the international-normals lock (`sonnet`) — `b926b2a` (2,077 tests)
- [ ] T8 — Byte-stability check, live spot checks, docs (`opus`, orchestrator)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the T8 checks are
demonstrably met against the built dist (US imperial success path
byte-identical to the branch base; Tokyo renders; open ocean soft-fails
without refetching; the summary fan-out shares one pull), the
service-boundary lock files (`metar-handler.test.ts`,
`almanac-handler.test.ts` — never edited) pass, and
`docs/plans/global-normals-hardening-plan.md` is marked `IMPLEMENTED` with the
plan set moved to `docs/plans/`. Opening the PR is the human's call.
