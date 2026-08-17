# Multi-Model Forecast Comparison — Implementation Plan

**Status:** READY (2026-08-14)

Execution plan for `docs/plans/multi-model-comparison-plan.md` (the WHAT/WHY); rules
live in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/multi-model-comparison-implementation-plan.md
```

Or, equivalently: read `docs/plans/multi-model-comparison-plan.md` (design),
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
**live network calls** and flake independently (standing flaky-tests caveat).
If the gate goes red only in those files, re-run before suspecting the diff.
**T6 adds another file in that category** (Open-Meteo model-comparison live
smoke) and must follow the same tolerant-of-flake convention.

**Live-verification rule:** the upstream `models=` contract was live-verified
2026-08-14 (design header, facts a–h: suffixed keys, single-model unsuffixed
shape, `_best_match` suffix, 400 on bad model name, ragged-horizon trailing
nulls, all-null-200 models, per-variable nulls, unit-param composition). What
can only be trusted against the built dist is the **byte-identical guarantee**
(no-flag requests vs the branch base) and the T7 sweep — the orchestrator runs
that personally; a subagent's claim is never the gate. Standing driver caveat:
dist drivers need `process.exit(0)`; don't run live drivers in parallel.

## Scope & branch

**Branch:** `feat/multi-model-comparison`, created **off `main`** (v1.20.0
released and tagged; tip `bcb9672` at plan time — record the actual base SHA
at kickoff for the T7 sweep). Target release: v1.21.0.

**Working-tree note (first commit):** the design doc
(`docs/multi-model-comparison-plan.md`, untracked) and the planning-index
edits (`docs/planning/README.md` row 💡→📝 with design link;
`docs/planning/FORK_DERIVED_IDEAS.md` §4 back-link) are **uncommitted** in the
working tree at plan time. The branch's first commit lands them (plus this
file): `docs: Add multi-model comparison design and implementation plans` —
before T1, as part of establishing the baseline.

In scope: the design's D1–D10 and D-types — a `compare_models: boolean`
parameter on `get_forecast` that returns a model-agreement comparison built
from the fixed six-model curated set in one Open-Meteo request; the pure
comparison module; agreement/divergence rendering with honest framing;
`get_weather_summary` flag strip; schema/docs; the testing checklist including
the byte-identical no-flag locks.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Caller-selectable model list (`models:` override) | Design non-goal — fixed curated global set; regional models break the anywhere-on-Earth contract. Recorded as a 💡 row in T7. |
| Hourly comparison | Design non-goal — daily only (D1); hourly × 6 models is a context bomb. |
| NOMADS/GRIB approach | Rejected upstream (FORK_DERIVED_IDEAS §4); off the table. |
| NOAA/NBM/HRRR in the compared set | Design non-goal — `gfs_seamless` represents the US global model; disclosed in-output for US points (D2/D5). |
| A new tool | Settled: parameter on `get_forecast` (parameters over proliferation). |
| Single-model ensemble spread (Open-Meteo ensemble API) | Different product. Recorded as a 💡 row in T7. |
| Refactor of `getForecast`'s hardcoded TTL (`openmeteo.ts:661`) | Known inconsistency, explicitly not touched (D8 byte-identical discipline). |
| Version bump to v1.21.0 | Release step, not a task (project convention). |

## Findings that shape the graph

Spot-checks against the code (2026-08-14), reconciled into the tasks below:

- **`COMPARISON_MODELS` lives in the pure module, not the service.** D3's
  prose places the constant "on the service", but D4 forbids the pure module
  from importing services. Reconciled the only compile-clean way that keeps a
  single source of truth: `export const COMPARISON_MODELS` is defined in
  `src/utils/modelComparison.ts` and **imported by** `openmeteo.ts` (the
  normal service→util import direction, cf. `openMeteoUnitParams`). This
  makes T2 depend on T1.
- **Cache-key helpers exist as designed.** `unitSignature(prefs)` is at
  `src/services/openmeteo.ts:42`; the forecast key namespace pattern to
  mirror is `:651` (`openmeteo-forecast`). `CacheConfig.ttl.forecast` is
  2 h (`src/config/cache.ts:87`).
- **All design line references verified current**: `ForecastArgs` at
  `forecastHandler.ts:68`, `validateOptionalBoolean` pattern `:241-245`,
  routing `useNOAA` `:253-261`, `formatLocationLine` prepend `:341`;
  `buildForecastParams:855`, `makeRequestToForecast:925`,
  `validateForecastResponse:956`, `getForecast:627-670`; summary `subArgs`
  literal at `weatherSummaryHandler.ts:107-114` with the existing
  `location_name: undefined` / `city_name: undefined` nulling to sit beside;
  `get_forecast` schema block `src/index.ts:296-347` with
  `...DETAIL_SCHEMA_PROPERTY` at `:343`; dispatch `:781-784` needs no change.
- **`prefs` field names**: band scaling switches on `prefs.temperature`
  (`'F' | 'C'`) and precip threshold on `prefs.precipitation`
  (`'inch' | 'mm'`) — the actual `UnitPreferences` fields
  (`src/config/units.ts`), not unit-param strings.
- **Renderer precedents in place**: `formatEnsembleForecast` at
  `riverConditionsHandler.ts:539` (spread-first style),
  `formatOpenMeteoForecast` header/per-day/footer structure in
  `forecastHandler.ts` (design D5 references verified).
- **`getWeatherDescription` is handler-side.** The pure module returns codes,
  buckets, and dissenter `{model, code}` pairs; the handler maps codes to
  descriptions at render time (D4) — keeps the module zero-import.
- **Service-test pattern**: `tests/unit/openmeteo-fire-variables.test.ts`
  exists and spies on the private transport, per the design's instruction —
  T2's test follows it.
- **Planning-index state**: `docs/planning/README.md:51` is already 📝
  pointing at the design (uncommitted edit — see Working-tree note). T7 flips
  it 📝 → ✅ and annotates the FE §13.1 "Forecast uncertainty/confidence" row
  as substantially covered.

## Task graph

### Phase 1 — Foundation

**T1 — Pure comparison module** (`sonnet`)

- Files: `src/utils/modelComparison.ts` (new),
  `tests/unit/modelComparison.test.ts` (new)
- Per D4 (+ the constant relocation finding). Pure, zero I/O, **no imports at
  all** (the `fireWeather.ts`/`firmsHotspots.ts` pattern):
  - `export const COMPARISON_MODELS = ['best_match', 'gfs_seamless',
    'ecmwf_ifs025', 'icon_seamless', 'gem_seamless', 'ukmo_seamless'] as
    const;` — single source of truth (service and tests import it).
  - `extractModelSeries(daily, variable, model)` — key
    `` `${variable}_${model}` ``, `Array.isArray` guard, non-numeric entries
    coerced to `null`, returns `(number | null)[] | undefined`.
  - Three-level participation per D4: all-null model drop (recorded in meta
    for the disclosure line), per-variable participation counts, per-day
    counts with trailing-trim at < 2 comparison models (anchored on
    `temperature_2m_max`; `best_match` excluded; interior gaps retained).
  - Per-day per-variable stats (min/max/range/median) across comparison
    models, `best_match` excluded from everything (D6).
  - Bands with heuristic-disclosure doc comments (Fosberg precedent):
    `classifyTempSpread(range, tempUnit)` (≤ 4 °F / ≤ 2.2 °C tight, ≤ 8 °F /
    ≤ 4.4 °C moderate, else divergent); precip-consensus threshold
    ≥ 0.01 in / ≥ 0.25 mm by pref; `weatherCodeBucket(code)` (clear 0–1,
    cloudy 2–3, fog 45/48, rain 51–67+80–82, snow 71–77+85–86, thunderstorm
    95–99) with modal-bucket consensus and ≤ 2 named dissenters as
    `{model, code}` pairs; day-level label (Good = temp tight AND precip
    unanimous-or-dry; Low = temp divergent OR ≥ 2-vs-≥ 2 precip split;
    Moderate otherwise); outlier naming only when divergent AND removing the
    farthest-from-others'-median model drops the band ≥ 1 level, else the
    unnamed "broadly split" signal.
  - Exported typed `ModelComparisonResult { days: DayComparison[];
    droppedModels: string[]; trimmedDays: number; … }` — the handler renders
    from this, never raw JSON.
- Tests per design §Testing (pure-module bullet): stats; band edges at
  4/8 °F and 2.2/4.4 °C; precip threshold edges both units; UKMO-style
  missing-probability count; bucket boundaries; agreement-label rule; outlier
  naming incl. the band-drop condition; all-null drop; per-day counts;
  trailing trim at < 2; interior gap retained; best_match excluded from every
  stat.
- Acceptance: full gate green; module has zero imports; the orchestrator
  hand-checks one outlier-naming case and one trim case against the design
  before committing.
- Commit: `feat: Add pure model-comparison computation module`
- Depends on: — (first code task; runs alone — T2 imports its constant)

**T2 — Service method + types** (`sonnet`)

- Files: `src/services/openmeteo.ts`, `src/types/openmeteo.ts`,
  `tests/unit/openmeteo-model-comparison.test.ts` (new; the
  `openmeteo-fire-variables.test.ts` spy-on-private-transport pattern)
- Per D3, D8, D-types:
  - Types first: `OpenMeteoModelComparisonDaily` (index-signature shape) and
    `OpenMeteoModelComparisonResponse` as separate interfaces — the existing
    closed `OpenMeteoForecastDailyData`/`OpenMeteoForecastResponse` are
    **not** widened.
  - `getModelComparison(latitude, longitude, days = 7, prefs =
    IMPERIAL_PREFERENCES)` importing `COMPARISON_MODELS` from the pure
    module.
  - New private `buildModelComparisonParams` (do **not** extend
    `buildForecastParams`): exactly the six daily variables `weather_code,
    temperature_2m_max, temperature_2m_min, precipitation_sum,
    precipitation_probability_max, wind_speed_10m_max`; `models=` joined
    constant; `forecast_days`; `timezone=auto`; `...openMeteoUnitParams(prefs)`.
  - Transport via the existing `makeRequestToForecast` (retry/backoff free).
    **No garnish retry** — a failure propagates sanitized (D7, contract not
    garnish).
  - New `validateModelComparisonResponse`: non-empty `daily.time` AND at
    least one `temperature_2m_max_<model>` key for a `COMPARISON_MODELS`
    member, else `DataNotFoundError`; doc comment records the
    single-model-unsuffixed defensive note.
  - Cache: `Cache.generateKey('openmeteo-model-comparison', latitude,
    longitude, days, unitSignature(prefs))`, TTL `CacheConfig.ttl.forecast`;
    comment beside the key noting the model set is a constant, not a key
    component (in-process cache clears on restart). `getForecast` stays
    byte-untouched (params, key, hardcoded TTL all unchanged).
- Tests per design §Testing (service bullet): exact `models` param string
  `best_match,gfs_seamless,ecmwf_ifs025,icon_seamless,gem_seamless,ukmo_seamless`
  (the D7 typo lock); exact six-variable `daily` list; unit params;
  `forecast_days`; cache namespace + unit signature; TTL from config;
  validator throws on empty `daily.time` and on unsuffixed-only keys; **no
  retry-without-models on 400**; plus an assertion that `getForecast`'s
  request params and cache key are unchanged (diff-lock).
- Acceptance: full gate green; existing `openmeteo-*.test.ts` files pass
  unedited.
- Commit: `feat: Add multi-model comparison fetch to OpenMeteoService`
- Depends on: T1

### Phase 2 — Handler

**T3 — Forecast handler: validation, routing, rendering** (`opus`)

- Files: `src/handlers/forecastHandler.ts`,
  `tests/unit/forecast-model-comparison.test.ts` (new; fake services per
  `forecast-fallback.test.ts` conventions)
- Per D1, D2, D5, D6, D7:
  - `compare_models?: boolean` on `ForecastArgs`; `validateOptionalBoolean`
    beside the existing flags. Interaction errors: `granularity: "hourly"` →
    validation error (`compare_models requires daily granularity`);
    `source: "noaa"` → validation error (`compare_models uses Open-Meteo
    model data; use source "auto" or "openmeteo"`). Thrown **before** any
    service call.
  - Routing: after validation + `resolveUnitPreferences`, the flag
    short-circuits the `useNOAA` block entirely — NOAA never called, no
    fallback logic. `formatLocationLine` prepend unchanged.
  - `formatModelComparisonForecast` per the D5 sketch: header with models
    list + reference line; overall-agreement line; per-day `##` blocks
    (Best-match line — omitted when best_match is null that day; Agreement
    label with optional "driven by X"; temperature/precipitation/wind/
    conditions lines with per-variable counts); dropped-model disclosure
    under the header; trim note; footer with attribution, not-counted-in-
    spreads sentence, spread-is-a-proxy honesty framing, run-times sentence,
    and the NWS-not-compared sentence **only** when `isInUS`.
  - `detail`: `summary` one line per day + overall line; `standard` the
    blocks; `full` appends compact per-model values lines — never six full
    forecasts. `include_precipitation_probability: false` drops the
    probability fragment. `include_normals`/`include_astronomy`/
    `include_severe_weather` silently ignored on this path.
  - Handler throws `DataNotFoundError('OpenMeteo', 'Model comparison data is
    unavailable for this location')` when the pure module's meta reports
    < 2 surviving comparison models (D7).
  - Dissenter codes from the pure module render via the existing
    `getWeatherDescription`.
- Tests per design §Testing (handler bullet): happy 5-model path;
  all-null-model drop + disclosure; UKMO per-variable null count; ragged
  fixture asserting "(4 of 5 models)" + trim note; hourly+flag error;
  `source: "noaa"`+flag error; US point + flag asserts **no NOAA service
  method called** and the NWS disclosure renders (and non-US omits it);
  `include_precipitation_probability: false`; `detail`
  summary/standard/full shapes; < 2 models → `DataNotFoundError`;
  best_match-null day omits the Best-match line.
- Acceptance: full gate green; the flag-off byte-identical locks pass
  **unedited**: `tests/unit/forecast-fallback.test.ts`, `astronomy.test.ts`,
  `normals.test.ts`, `almanac-handler.test.ts`,
  `weather-summary-handler.test.ts`.
- Commit: `feat: Add compare_models model-agreement view to get_forecast`
- Depends on: T1, T2

### Phase 3 — Guard rails + registration (parallel-safe fan-out)

**T4 — get_weather_summary flag strip** (`sonnet`)

- Files: `src/handlers/weatherSummaryHandler.ts`,
  `tests/unit/weather-summary-handler.test.ts` (append only)
- Per D9: add `compare_models: undefined` to the `subArgs` literal
  (`:107-114`) beside the existing `location_name`/`city_name` nulling, with
  a one-line comment (comparison is the wrong shape inside a summary).
  Append the lock test: summary call with `compare_models: true` →
  `getModelComparison` never invoked; forecast section renders the standard
  shape.
- Acceptance: full gate green; existing tests in the file pass unedited.
- Commit: `fix: Strip compare_models from weather-summary sub-requests`
- Depends on: T3 · **parallel-safe with T5, T6** (disjoint files)

**T5 — Schema + tool description** (`haiku`)

- Files: `src/index.ts`
- Per D10: add the `compare_models` property to `get_forecast`'s schema
  immediately before `...DETAIL_SCHEMA_PROPERTY` (`:343`), `type: 'boolean'`,
  `default: false`, with the exact D1 description string ("Compare 5 global
  weather models (GFS, ECMWF, ICON, GEM, UKMO) and summarize their
  agreement/divergence instead of a single forecast. Use when asked how
  confident or certain a forecast is, or whether models agree. Daily
  granularity only; always Open-Meteo (default: false)."). Add one sentence
  to the tool description ("Can compare multiple global weather models with
  compare_models=true to gauge forecast confidence."). Dispatch untouched;
  `src/config/tools.ts` untouched.
- Acceptance: full gate green; diff touches only the two strings/property.
- Commit: `feat: Register compare_models in the get_forecast schema`
- Depends on: T3 · **parallel-safe with T4, T6** (disjoint files)

**T6 — Integration live smoke** (`sonnet`)

- Files: `tests/integration/model-comparison.test.ts` (new)
- One live smoke per design §Testing, tolerant-of-flake convention (file
  header notes it joins the live-network set — `almanac.test.ts` header as
  template): real endpoint, stable location, generous timeout; asserts
  suffixed keys present and ≥ 4 of 5 comparison models return non-null
  temperature data; never fails on a network error.
- Acceptance: full gate green (re-run once if only live files are red).
- Commit: `test: Add model-comparison live smoke test`
- Depends on: T3 · **parallel-safe with T4, T5** (disjoint files)

### Phase 4 — Verification and docs

**T7 — Byte-identical sweep + documentation/registration checklist** (`opus`)

- Files: `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `docs/TOOLS.md`,
  `docs/planning/README.md`, `docs/planning/FORK_DERIVED_IDEAS.md`,
  `docs/multi-model-comparison-plan.md` (status + move), this file (move)
- **Sweep against the built dist**, run by the orchestrator personally
  (branch-base `main` SHA recorded at kickoff; `process.exit(0)` in drivers;
  no parallel live drivers):
  1. Default no-flag US request → **byte-identical** to the branch base.
  2. Default no-flag non-US request → **byte-identical** to the branch base.
  3. Non-US point + `compare_models: true` → comparison renders: header
     model list, per-day agreement blocks, footer honesty framing, **no**
     NWS sentence.
  4. US point + flag (`source: "auto"`) → comparison renders with the NWS
     disclosure; NOAA endpoints never contacted (verify via handler logic /
     absence of NOAA fetch in a spy driver, or design-test coverage).
  5. `days: 16` at a mid-latitude point → per-day "(N of 5 models)" counts
     and/or the trailing-trim note (ragged horizons — record what renders).
  6. Same point metric vs imperial → values in caller's units; agreement
     labels consistent with the scaled thresholds.
  7. `detail: "summary"` and `"full"` shapes render per D1.
  8. `get_weather_summary` with `compare_models: true` → summary forecast
     section unchanged (strip verified live).
- Docs, per the design's checklist:
  - CHANGELOG under a new `[Unreleased]` section (v1.20.0 shipped; no
    version bump).
  - README features table: model-comparison row with the honest-framing
    caveat; test-count badge.
  - `docs/TOOLS.md` get_forecast section: `compare_models` semantics
    including every D1 interaction (hourly/source errors; normals/astronomy
    silently ignored; probability compose; detail levels).
  - CLAUDE.md: tool list entry + "New in v1.21.0" status blurb per house
    style.
  - `docs/planning/README.md`: row `:51` 📝 → ✅ with the Shipped link;
    Shipped-table row; annotate the FE §13.1 "Forecast
    uncertainty/confidence" row as substantially covered; two new 💡 rows
    (caller-selectable model list; single-model ensemble spread).
    `FORK_DERIVED_IDEAS.md` §4: mark shipped.
  - Fill the design plan's implementation notes, mark it `IMPLEMENTED`, then
    **move the plan set (design plan + this file) to `docs/plans/`**,
    updating references (incl. the planning-README link).
- Acceptance: the sweep recorded in the tracker or the design plan's
  implementation notes; full gate green; every box of the design's
  §Documentation checklist satisfied.
- Commit: `docs: Record multi-model forecast comparison`
- Depends on: T4, T5, T6

## Assumptions to confirm before `/run-plan`

- **A1 — constant location.** `COMPARISON_MODELS` is defined in the pure
  module `src/utils/modelComparison.ts` and imported by the service — the
  only arrangement satisfying both D3 ("single source of truth") and D4 ("no
  service imports" in the pure module). D3's placement prose yields.
- **A2 — first commit.** The uncommitted design doc + planning-index edits
  land as the branch's first `docs:` commit before T1 (baseline includes
  them).
- **A3 — prefs fields.** Band scaling keys on `prefs.temperature`
  (`'F' | 'C'`) and the precip threshold on `prefs.precipitation`
  (`'inch' | 'mm'`) — actual `UnitPreferences` fields.
- **A4 — dissenter descriptions.** The pure module returns dissenters as
  `{model, code}`; the handler maps codes via the existing
  `getWeatherDescription` (keeps the module import-free).
- **A5 — trimming anchor.** Per-day participation and the < 2 trim are
  anchored on `temperature_2m_max` only (D4 level 3); other variables show
  their own counts but never trigger trimming.
- **A6 — bands are heuristics, disclosed.** Spread bands, precip threshold,
  buckets, and the agreement-label rule are project choices, disclosed in doc
  comments (and the output carries the proxy-not-guarantee framing per D5).
- **A7 — version bump.** Stays a release step, not a task.

## Progress Tracker

- [x] T0 — Land design doc + planning edits as first `docs:` commit (orchestrator, with baseline) — `ec5ea81`

**Branch base:** `main` @ `bcb9672` (v1.20.0) — the T7 byte-identical sweep
diffs against this SHA.

**Baseline (2026-08-15):** `npm run build` 0 errors · `npm test` 1961/1961 ·
`npm audit` 0 vulnerabilities. Gate runs use `TZ=UTC` — `metar-handler.test.ts`
builds its ACIS records slot from local `new Date()` while the handler derives
month/day from the observation timestamp (20 min earlier), so the file fails
deterministically in the ~20-minute window after local midnight. Pre-existing,
unrelated to this branch, and not a product bug.
- [x] T1 — Pure comparison module (`sonnet`) — `46d06f8` (48 tests; suite 2009)

  Entry point is `buildModelComparison(daily, tempUnit, precipUnit)` (the design
  left the name open). `ModelComparisonResult { days, droppedModels,
  trimmedDays, totalModels }`; each `DayComparison` carries `date`, `bestMatch`,
  `participantCount`/`totalModels`, `temperature`/`precipitation`/`wind`/
  `conditions` blocks with `perModel*` arrays for `detail: "full"`, and
  `agreement`. **Note for T3:** an all-days-trimmed response yields
  `days: []` — the handler must treat that like the D7 `< 2 models` case rather
  than render an empty comparison, and an interior day with
  `participantCount < 2` must not render a spread as if it were agreement.
- [x] T2 — Service method + types (`sonnet`) — `32e43f4` (19 tests; suite 2028)

  `getModelComparison(latitude, longitude, days = 7, prefs = IMPERIAL_PREFERENCES)`.
  `getForecast` verified unchanged by an explicit diff-lock describe block
  (its 19-variable `daily` list, absence of a `models` param, and its
  `openmeteo-forecast` key + hardcoded 2 h TTL), in addition to the existing
  `openmeteo-*.test.ts` files passing unedited.
- [x] T3 — Forecast handler: validation, routing, rendering (`opus`, orchestrator) — `0f57686` (28 tests; suite 2056)

  All five flag-off lock files verified unedited (`git diff --name-only` empty)
  and passing. **Rendering fix beyond the task text, made after eyeballing real
  output:** the precipitation amount range was computed across *all*
  participating models, so dry models pinned every minimum to `0.00` —
  "3 of 5 models predict measurable precipitation (0.00–0.31 in)" where the wet
  models were 0.05/0.20/0.31. The range now covers the wet models only, matching
  the D5 sketch's "(0.05–0.31 in)"; locked by two new tests. Also: singular verb
  agreement at one wet model, and the overall-agreement line no longer emits a
  double parenthetical.
- [x] T4 — get_weather_summary flag strip (`sonnet`) — `1b061de` (append-only: 59 insertions, 0 deletions)

  The file mocks `forecastHandler.js` at module level, which would have made
  "`getModelComparison` never called" vacuously true. The lock test unmocks and
  re-imports so it drives the *real* `handleGetForecast`, restoring the shared
  mock in a `finally`.
- [x] T5 — Schema + tool description (`haiku`) — `0c529c3` (diff = one property + one sentence)
- [x] T6 — Integration live smoke (`sonnet`) — `03060eb` (live: 5/5 models, 7 days)

  **Deliberate deviation from the sibling live files:** their blanket
  `catch` swallows assertion failures too, so such a test can never fail. This
  one re-throws `AssertionError` and tolerates only transport failures — the
  plan's acceptance is "never fails on a *network* error", not "never fails".
  Verified both directions: forced threshold breach turns the suite red; an
  unroutable endpoint passes with a logged skip.
- [x] T7 — Byte-identical sweep + documentation checklist (`opus`, orchestrator)

  All 8 sweeps pass — recorded in the design plan's **Implementation notes**
  table. Sweeps 1 and 2 confirmed **byte-identical** against `bcb9672` by
  building the base in a throwaway worktree and diffing built-dist driver
  output. Docs updated: CHANGELOG `[Unreleased]`, README (feature bullet, tool
  table, three test counts, badge), CLAUDE.md (tool entry, v1.21.0 blurb,
  utils tree, counts), `docs/TOOLS.md` (parameter + a Model-comparison section
  with the full D1 interaction table), planning index (row 💡→✅, FE §13.1
  annotated, two descoped 💡 rows), `FORK_DERIVED_IDEAS.md` §4 marked shipped.
  Plan set moved to `docs/plans/`.

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the T7 sweep is
demonstrably met against the built dist (both no-flag requests byte-identical
to the branch base; comparison renders with honest framing US and non-US;
summary strip holds live), the flag-off lock files
(`forecast-fallback.test.ts`, `astronomy.test.ts`, `normals.test.ts`,
`almanac-handler.test.ts`, `weather-summary-handler.test.ts` — appended-to
only where a task says so, never edited) pass, and
`docs/multi-model-comparison-plan.md` is marked `IMPLEMENTED` with the plan
set moved to `docs/plans/`. Opening the PR is the human's call.
