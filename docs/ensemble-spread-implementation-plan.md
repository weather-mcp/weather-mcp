# Single-Model Ensemble Spread — Implementation Plan

**Status:** READY (2026-08-16)

Execution plan for `docs/ensemble-spread-plan.md` (the WHAT/WHY); rules live in
`docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/ensemble-spread-implementation-plan.md
```

Or, equivalently: read `docs/ensemble-spread-plan.md` (design),
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
**T6 adds another file in that category** (Open-Meteo ensemble live smoke) —
it follows the `model-comparison.test.ts` convention (re-throws
`AssertionError`, tolerates only transport failures), **not** the older
swallow-everything files.

**Live-verification rule:** the upstream ensemble contract was live-verified
2026-08-16 (design header, facts a–j: daily aggregation supported; unsuffixed
control + `_memberNN` keys; `precipitation_probability_max` all-null trap;
ragged whole-model horizons; 400 on bad model; ocean coverage; unit-param
composition; multi-model suffix renaming; payload size; real WMO codes per
member). What can only be trusted against the built dist is the
**byte-identical guarantee** (no-flag requests vs the branch base) and the T7
sweep — the orchestrator runs that personally; a subagent's claim is never the
gate. Standing driver caveat: dist drivers need `process.exit(0)`; don't run
live drivers in parallel.

## Scope & branch

**Branch:** `feat/ensemble-spread`, created **off `main` only after the
v1.21.0 branches merge** (`feat/multi-model-comparison` and
`feat/global-normals-hardening` — this feature imports from
`src/utils/modelComparison.ts` and mirrors its seams). At plan time neither is
merged: **if `main` lacks `src/utils/modelComparison.ts` at kickoff, stop and
ask the human** — do not branch off a feature branch. Record the actual base
SHA at kickoff for the T7 sweep. Target release: v1.22.0.

**Working-tree note (first commit, T0):** the design doc
(`docs/ensemble-spread-plan.md`, untracked) and the planning-index edit
(`docs/planning/README.md:54` row 💡 → 📝 with design link) are **uncommitted**
in the working tree at plan time — on the `feat/global-normals-hardening`
checkout. They must survive the branch switch (untracked + modified files
carry over; verify) and land as the branch's first commit (plus this file):
`docs: Add ensemble-spread design and implementation plans` — before T1, as
part of establishing the baseline.

In scope: the design's D1–D10 and D-types — an `ensemble_spread: boolean`
parameter on `get_forecast` that returns a member-spread confidence view built
from one fixed model (`ecmwf_ifs025`, ECMWF ENS 0.25°, 50 perturbed members +
control) via Open-Meteo's ensemble API; the pure statistics module; confidence
rendering with honest framing; `get_weather_summary` flag strip; schema/docs;
the testing checklist including the byte-identical no-flag locks.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Caller-selectable ensemble model (`gfs_seamless` 33-day horizon, `icon_seamless`, …) | Design non-goal — one fixed curated choice; all verified working upstream. Recorded as a 💡 planning-index row in T7. |
| Hourly member spread | Design non-goal — daily only; compare_models D1 context-bomb reasoning, 10× worse by member count. |
| Combining with `compare_models` in one output | Design non-goal — distinct products, distinct requests; the flags are mutually exclusive (D1). |
| Probability calibration / skill claims | Design non-goal — raw member fractions disclosed as such, never calibrated probabilities. |
| Beyond-16-day horizons | Design non-goal — ECMWF daily data ends ~day 14; `days` stays 1–16 with trailing trim. |
| Version bump to v1.22.0 | Release step, not a task (project convention). |

## Findings that shape the graph

Spot-checks against the code (2026-08-16, on the v1.21.0 stack —
`feat/global-normals-hardening` tip; **line refs may shift slightly after the
merges**, re-verify at kickoff), reconciled into the tasks below:

- **`precipThreshold` is module-private** (`modelComparison.ts:169`,
  `function`, not exported) — the design's parenthetical applies: T1 exports
  it **unchanged** (keyword only) so `ensembleSpread.ts` can reuse it.
  `tests/unit/modelComparison.test.ts` and
  `forecast-model-comparison.test.ts` must pass **unedited**.
- **The pure→pure imports exist as designed:** `classifyTempSpread`
  (`modelComparison.ts:154`) and `weatherCodeBucket` (`:181`) are already
  exported. `ensembleSpread.ts` imports these three symbols and nothing else
  (pure→pure is allowed by D4; zero *service* imports).
- **All design line references verified current** on this stack:
  `ForecastArgs` at `forecastHandler.ts:88`, `compare_models` validation
  `:259-263` (the `validateOptionalBoolean` pattern to sit beside),
  interaction guards `:276-281` (plain `throw new Error(...)` — the
  "validation error" shape to mirror), routing short-circuit `:296`,
  `formatLocationLine` prepend `:386`, `formatModelComparisonForecast` from
  `:1099` (the renderer template), handler-side
  `openMeteoService.getWeatherDescription` at render `:1131`, `isInUS` footer
  gate `:1186`.
- **Service seams in place:** `unitSignature(prefs)` at `openmeteo.ts:44`
  (module-private, fine — T2 works inside the file); constructor URL defaults
  `:93-100` (`forecastURL`/`floodURL` pattern to extend with `ensembleURL`);
  `makeRequestToFlood` at `:1592` (the transport template for
  `makeRequestToEnsemble`); the comparison cache key + set-is-a-constant
  comment at `:1042-1048` (the D8 pattern to mirror);
  `CacheConfig.ttl.forecast` = 2 h at `src/config/cache.ts:87`.
- **Summary strip site:** `weatherSummaryHandler.ts:107-115` — the `subArgs`
  literal with `compare_models: undefined` at `:115`; `ensemble_spread:
  undefined` goes beside it. **T4 caveat inherited from the comparison's T4:**
  `weather-summary-handler.test.ts` mocks `forecastHandler.js` at module
  level, which makes "`getEnsembleSpread` never called" vacuously true — the
  lock test must unmock and re-import to drive the real `handleGetForecast`
  (the existing `compare_models` lock test in that file is the exact template).
- **Schema site:** `src/index.ts:342` (`compare_models` property) before
  `...DETAIL_SCHEMA_PROPERTY` at `:347`; the tool description sentence to
  extend is at `:298` ("Can compare multiple global weather models…").
  Dispatch needs no change.
- **Live-smoke template:** `tests/integration/model-comparison.test.ts` is the
  corrected re-throw-assertions convention — use it, not `almanac.test.ts`.
- **Fixture ergonomics:** handler tests need 50-member fixtures — a generator
  helper (member values from a seedable pattern), never a hand-typed
  250-array fixture (design §Testing).
- **Planning-index state:** `docs/planning/README.md:54` is already 📝
  pointing at the design (uncommitted — see Working-tree note). T7 flips it
  📝 → ✅, adds the descoped caller-selectable-ensemble-model 💡 row, and
  annotates the FE §13.1 row (`:79`) as fully covered (the *within*-model
  half now shipped).

## Task graph

### Phase 1 — Foundation

**T1 — Pure spread module** (`sonnet`)

- Files: `src/utils/ensembleSpread.ts` (new),
  `src/utils/modelComparison.ts` (export-keyword-only on `precipThreshold`),
  `tests/unit/ensembleSpread.test.ts` (new)
- Per D4 (+ the export finding). Pure, zero I/O, no service imports; MAY
  import `classifyTempSpread`, `weatherCodeBucket`, `precipThreshold` from
  `modelComparison.ts` (pure→pure):
  - `export const ENSEMBLE_MODEL = 'ecmwf_ifs025' as const;` plus display
    metadata `ENSEMBLE_MODEL_LABEL = 'ECMWF IFS 0.25° ensemble (ENS)'` and
    `ENSEMBLE_MEMBER_COUNT = 50` (header line only — the parser counts
    members from the response, never trusts the constant).
  - `extractMemberSeries(daily, variable)` — collects
    `` `${variable}_member${NN}` `` keys (zero-padded from `member01`) behind
    `Array.isArray` guards, non-numeric entries coerced to `null`. Defensive
    ceiling: at most 64 members per variable; beyond, warn-with-
    `securityEvent`-flag **via a returned meta flag** (the module stays
    logger-free; the handler logs) and truncate.
  - Control run: the unsuffixed series extracted separately — headline
    reference only, **excluded from every statistic, fraction, and trimming
    decision** (D6, mirror of best_match).
  - Per-day, per-variable stats across perturbed members: median, p25, p75,
    min, max. Percentile method pinned: sort ascending, linear interpolation
    between closest ranks (numpy default) — doc comment + unit tests lock it.
  - Heuristics (disclosed in doc comments, Fosberg precedent): temp band =
    `classifyTempSpread` on the **p25–p75 range** of the daily high;
    wet-member fraction with `precipThreshold(precipUnit)` and amount range
    over **wet members only**; modal `weatherCodeBucket` + runner-up named at
    ≥ 25%; day confidence **High** = temp tight AND fraction ≤ 0.2 or ≥ 0.8,
    **Low** = temp divergent OR fraction in [0.35, 0.65], **Moderate**
    otherwise.
  - Trimming: trailing days with < 2 members reporting `temperature_2m_max`
    trimmed and counted (`trimmedDays`); interior gaps retained with reduced
    counts.
  - Exported typed `EnsembleSpreadResult { days: EnsembleDay[]; memberCount:
    number; trimmedDays: number; … }` (entry-point name orchestrator's
    choice, cf. `buildModelComparison`) — the handler renders from this,
    never raw JSON. Control-run weather code returned as a code; the handler
    maps to a description (module stays import-lean).
- Tests per design §Testing (pure-module bullet): percentile method pinned
  (odd/even counts, interpolation); median/p25/p75/min/max; band on the
  p25–p75 range incl. °C scaling; wet fraction incl. threshold edges and
  wet-only amount ranges; bucket modal + runner-up ≥ 25% rule; label rule at
  the 0.2/0.35/0.65/0.8 boundaries; control excluded from every stat;
  trailing trim vs interior gap; 64-member ceiling; < 2 members meta;
  null-control day.
- Acceptance: full gate green; the only `modelComparison.ts` change is the
  export keyword; `modelComparison.test.ts` and
  `forecast-model-comparison.test.ts` pass unedited; the orchestrator
  hand-checks one percentile case and one trim case against the design
  before committing.
- Commit: `feat: Add pure ensemble-spread computation module`
- Depends on: — (first code task; T2 imports its constant)

**T2 — Service method + types** (`sonnet`)

- Files: `src/services/openmeteo.ts`, `src/types/openmeteo.ts`,
  `tests/unit/openmeteo-ensemble.test.ts` (new; the
  `openmeteo-model-comparison.test.ts` spy-on-private-transport pattern)
- Per D3, D8, D-types:
  - Types first: `OpenMeteoEnsembleDaily` (index-signature shape) and
    `OpenMeteoEnsembleResponse` as new closed interfaces — nothing existing
    widened.
  - `getEnsembleSpread(latitude, longitude, days = 7, prefs =
    IMPERIAL_PREFERENCES)` importing `ENSEMBLE_MODEL` from the pure module.
  - New constructor default `ensembleURL =
    'https://ensemble-api.open-meteo.com/v1'` beside `floodURL`
    (`:93-100`); new private `makeRequestToEnsemble<T>` following
    `makeRequestToFlood` (`:1592`) — retry/backoff/sanitization from the
    shared shape.
  - New private `buildEnsembleParams`: exactly five daily variables
    `weather_code, temperature_2m_max, temperature_2m_min,
    precipitation_sum, wind_speed_10m_max` — **never**
    `precipitation_probability_max` (all-null trap, verification c);
    `models=<ENSEMBLE_MODEL>`; `forecast_days=<days>`; `timezone=auto`;
    `...openMeteoUnitParams(prefs)`.
  - New `validateEnsembleResponse`: non-empty `daily.time` AND a
    `temperature_2m_max_member01` key, else `DataNotFoundError`. Doc comment
    records the two shapes it must fail loudly on rather than mis-parse:
    memberless plain-forecast, and the multi-model renamed-suffix shape
    (verification h).
  - Cache: `Cache.generateKey('openmeteo-ensemble', latitude, longitude,
    days, unitSignature(prefs))`, TTL `CacheConfig.ttl.forecast`; comment
    beside the key noting the model is a constant, not a key component
    (in-process cache clears on restart). **No garnish retry** — failures
    propagate sanitized (D7). `getForecast` and `getModelComparison` stay
    byte-untouched.
- Tests per design §Testing (service bullet): exact `models=ecmwf_ifs025`
  param (the D7 typo lock); exact five-variable `daily` list and **absence
  of `precipitation_probability_max`**; ensemble host used (not the forecast
  host); unit params; `forecast_days`; cache namespace `openmeteo-ensemble`
  + unit signature; TTL from config; validator throws on memberless and
  renamed-suffix fixtures; no retry-without-anything on 400; plus a
  diff-lock assertion that `getForecast`'s and `getModelComparison`'s
  request params and cache keys are unchanged.
- Acceptance: full gate green; existing `openmeteo-*.test.ts` files pass
  unedited.
- Commit: `feat: Add ensemble-spread fetch to OpenMeteoService`
- Depends on: T1

### Phase 2 — Handler

**T3 — Forecast handler: validation, routing, rendering** (`opus`)

- Files: `src/handlers/forecastHandler.ts`,
  `tests/unit/forecast-ensemble-spread.test.ts` (new; fake services +
  a 50-member fixture **generator helper**)
- Per D1, D2, D5, D6, D7:
  - `ensemble_spread?: boolean` on `ForecastArgs` (`:88` region);
    `validateOptionalBoolean` beside `compare_models` (`:259-263`).
    Interaction errors thrown **before any service call**, beside the
    existing guards (`:276-281`): both flags → `ensemble_spread and
    compare_models are mutually exclusive; request one view at a time`;
    `granularity: "hourly"` + flag → validation error;
    `source: "noaa"` + flag → `ensemble_spread uses Open-Meteo ensemble
    data; use source "auto" or "openmeteo"`.
  - Routing: the flag short-circuits the `useNOAA` block exactly as
    `compare_models` does (`:296`) — NOAA never contacted, no fallback,
    `formatLocationLine` prepend unchanged.
  - `formatEnsembleSpreadForecast` per the D5 sketch: header
    (Location/Timezone/Forecast Days/Model line with
    `ENSEMBLE_MODEL_LABEL` + real member count); overall-confidence line;
    per-day `##` blocks (Control-run line via
    `openMeteoService.getWeatherDescription` — omitted on a null-control
    day; Confidence label; temperature p25–p75 "likely" + median;
    "N of M members (NN%)" precipitation with wet-only amount range; wind
    "max typically p25–p75"; conditions modal % + runner-up); trim note
    only when `trimmedDays > 0`; footer with attribution
    ("Open-Meteo (Ensemble API)"), control-not-counted sentence,
    raw-fractions-not-calibrated honesty framing, heuristics disclosure,
    and the NWS-not-shown sentence **only** when `isInUS` (`:1186`
    pattern).
  - `detail`: `summary` → overall line + one compact line per day;
    `standard` → the blocks; `full` → appends one absolute-envelope line
    per day (min–max high/low, wind max, precipitation max). Never member
    dumps. `include_precipitation_probability` / `include_normals` /
    `include_astronomy` / `include_severe_weather` silently ignored on this
    path.
  - `DataNotFoundError('OpenMeteo', 'Ensemble spread data is unavailable
    for this location')` when the module reports < 2 perturbed members or
    all days trimmed (`days: []` — never render an empty view). The
    module's over-64-members meta flag logs the `securityEvent` warn here.
- Tests per design §Testing (handler bullet): happy path off the generated
  50-member fixture; both mutual-exclusion/validation errors + the
  source-noaa error; US point asserts **no NOAA service method called** +
  NWS sentence renders (and non-US omits it); horizon-trim fixture with
  note; interior-gap day shows reduced count; null-control day omits the
  line; `detail` summary/standard/full shapes; `DataNotFoundError` on < 2
  members and on all-trimmed; wet-only amount range asserted explicitly
  (the inherited compare_models gotcha).
- Acceptance: full gate green; the flag-off byte-identical locks pass
  **unedited**: `tests/unit/forecast-fallback.test.ts`,
  `forecast-model-comparison.test.ts`, `astronomy.test.ts`,
  `normals.test.ts`, `almanac-handler.test.ts`,
  `weather-summary-handler.test.ts` (verify via `git diff --name-only`).
- Commit: `feat: Add ensemble_spread confidence view to get_forecast`
- Depends on: T1, T2

### Phase 3 — Guard rails + registration (parallel-safe fan-out)

**T4 — get_weather_summary flag strip** (`sonnet`)

- Files: `src/handlers/weatherSummaryHandler.ts`,
  `tests/unit/weather-summary-handler.test.ts` (append only)
- Per D9: add `ensemble_spread: undefined` to the `subArgs` literal beside
  `compare_models: undefined` (`:115`), one-line comment. Append the lock
  test: summary call with `ensemble_spread: true` → `getEnsembleSpread`
  never invoked; forecast section renders the standard shape. **Must
  unmock/re-import** `forecastHandler.js` (the file's module-level mock
  makes the assertion vacuous otherwise) — copy the existing
  `compare_models` lock test's unmock pattern, restore in `finally`.
- Acceptance: full gate green; existing tests in the file pass unedited.
- Commit: `fix: Strip ensemble_spread from weather-summary sub-requests`
- Depends on: T3 · **parallel-safe with T5, T6** (disjoint files)

**T5 — Schema + tool description** (`haiku`)

- Files: `src/index.ts`
- Per D10: add the `ensemble_spread` property beside `compare_models`
  (`:342`), `type: 'boolean'`, `default: false`, with the exact D1
  description string ("Show one model's ensemble spread (ECMWF ENS, 50
  members) instead of a single forecast — how confident the model itself
  is, day by day. Use when asked how certain/uncertain the forecast is.
  Daily only; always Open-Meteo (default: false)."). Extend the tool
  description's existing confidence sentence (`:298`) by the clause
  "…or ensemble_spread=true for one model's own spread". Dispatch
  untouched; `src/config/tools.ts` untouched.
- Acceptance: full gate green; diff touches only the property + one
  sentence.
- Commit: `feat: Register ensemble_spread in the get_forecast schema`
- Depends on: T3 · **parallel-safe with T4, T6** (disjoint files)

**T6 — Integration live smoke** (`sonnet`)

- Files: `tests/integration/ensemble-spread.test.ts` (new)
- One live smoke per design §Testing, on the
  `tests/integration/model-comparison.test.ts` template (re-throws
  `AssertionError`, tolerates only transport failures; header notes it
  joins the live-network set): real ensemble endpoint, stable location,
  generous timeout; asserts `_member01`…`_member50` keys present and ≥ 45
  members non-null for day-1 `temperature_2m_max`.
- Acceptance: full gate green (re-run once if only live files are red).
- Commit: `test: Add ensemble-spread live smoke test`
- Depends on: T3 · **parallel-safe with T4, T5** (disjoint files)

### Phase 4 — Verification and docs

**T7 — Byte-identical sweep + documentation/registration checklist** (`opus`)

- Files: `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `docs/TOOLS.md`,
  `docs/planning/README.md`, `docs/ensemble-spread-plan.md` (status +
  move), this file (move)
- **Sweep against the built dist**, run by the orchestrator personally
  (branch-base SHA recorded at kickoff; `process.exit(0)` in drivers; no
  parallel live drivers):
  1. Default no-flag US request → **byte-identical** to the branch base.
  2. Default no-flag non-US request → **byte-identical** to the branch
     base.
  3. Non-US point + `ensemble_spread: true` → spread renders: model
     header, per-day confidence blocks, footer honesty framing, **no**
     NWS sentence.
  4. US point + flag (`source: "auto"`) → spread renders with the NWS
     disclosure; NOAA never contacted.
  5. `days: 16` → trailing-trim note past the ECMWF ~14-day daily horizon
     (counts from real data — record what renders).
  6. Metric units → values in caller's units; bands consistent with °C
     scaling; wet threshold 0.25 mm.
  7. `detail: "summary"` and `"full"` shapes render per D1.
  8. `ensemble_spread: true` + `compare_models: true` → the
     mutual-exclusion error text (validation, no request made).
  9. `get_weather_summary` with the flag → summary forecast section
     unchanged (strip verified live).
- Docs, per the design's checklist:
  - CHANGELOG under `[Unreleased]` (no version bump).
  - README features table: ensemble-spread note with the honest-framing
    caveat; test-count badge.
  - `docs/TOOLS.md` get_forecast section: `ensemble_spread` semantics
    including **every** D1 interaction (mutual exclusion; hourly/source
    errors; probability/normals/astronomy/severe silently ignored; detail
    levels; days 1–16 with trim).
  - CLAUDE.md: tool list entry + "New in v1.22.0" status blurb per house
    style; utils tree entry for `ensembleSpread.ts`; test counts.
  - `docs/planning/README.md`: row `:54` 📝 → ✅ with the Shipped link;
    Shipped-table row; annotate the FE §13.1 row (`:79`) as fully covered
    (within-model half shipped); add the descoped 💡 row for
    caller-selectable ensemble model.
  - Fill the design plan's implementation notes, mark it `IMPLEMENTED`,
    then **move the plan set (design plan + this file) to `docs/plans/`**,
    updating references (incl. the planning-README link).
- Acceptance: the sweep recorded in the tracker or the design plan's
  implementation notes; full gate green; every box of the design's
  §Documentation checklist satisfied.
- Commit: `docs: Record single-model ensemble spread`
- Depends on: T4, T5, T6

## Assumptions to confirm before `/run-plan`

- **A1 — branch precondition.** `feat/ensemble-spread` is created off `main`
  only after both v1.21.0 branches merge. If `src/utils/modelComparison.ts`
  is absent from `main` at kickoff, stop and ask — never branch off a
  feature branch.
- **A2 — first commit.** The uncommitted design doc + planning-index edit
  (currently sitting in the `feat/global-normals-hardening` working tree)
  land as the branch's first `docs:` commit (T0) before T1.
- **A3 — `precipThreshold` export.** T1 adds the `export` keyword only; no
  behavior change; the comparison test files pass unedited.
- **A4 — validation-error shape.** The D1 "validation errors" are plain
  `throw new Error(...)` in the handler, matching the existing
  `compare_models` guards at `forecastHandler.ts:276-281`.
- **A5 — description mapping is handler-side.** The pure module returns
  weather codes; the handler maps via
  `openMeteoService.getWeatherDescription` at render time (comparison
  precedent, keeps the module service-free).
- **A6 — module stays logger-free.** The 64-member defensive ceiling
  surfaces as a meta flag from the pure module; the handler emits the
  `securityEvent` warn (keeps `ensembleSpread.ts` import-lean like
  `modelComparison.ts`).
- **A7 — heuristics are disclosed.** Bands, wet threshold, buckets, and the
  confidence-label rule are project heuristics, disclosed in doc comments
  and the output footer (D5).
- **A8 — version bump.** Stays a release step, not a task.
- **A9 — line refs.** All refs above were taken on the v1.21.0 stack and
  may shift after the merges; the orchestrator re-verifies anchors at
  kickoff rather than trusting the numbers.

## Kickoff record (2026-08-16)

- **A1 was NOT met at kickoff** and was resolved as the plan directs (stop and
  ask): `main` was at `bcb9672` ("chore: Release v1.20.0") with no
  `src/utils/modelComparison.ts`. Both v1.21.0 branches were unmerged with no
  open PRs, and `feat/global-normals-hardening` was stacked on top of
  `feat/multi-model-comparison`. On the human's instruction the stack was
  squash-merged to `main` first: PR #62 (`292a901`) then PR #63 (`5995b80`).
  #63 had to be **rebased onto the squashed `main`** (`git rebase --onto
  origin/main feat/multi-model-comparison feat/global-normals-hardening`)
  because the squash left its merge base behind and GitHub reported
  `CONFLICTING`; the rebase was verified content-identical to the pre-rebase
  tip (`git diff 72857b2 HEAD` empty) and reduced the PR diff from 30 files to
  the correct 18.
- **Branch base SHA (for the T7 sweep): `5995b80`** — `feat/ensemble-spread`
  created off `main` at that commit.
- **Green baseline on the branch before T1:** `npm run build` 0 errors ·
  `npm test` 2077/2077 in 85 files · `npm audit` 0 vulnerabilities.
- **A9 anchors re-verified on the merged base** — all current:
  `precipThreshold` module-private at `modelComparison.ts:169`;
  `classifyTempSpread` `:154` and `weatherCodeBucket` `:181` exported;
  `ForecastArgs` `:77` with `compare_models` at `:88`; handler guards
  `:276-281`; routing short-circuit `:296`; `formatModelComparisonForecast`
  `:1106`; `isInUS` footer gate `:1186`; `unitSignature` `openmeteo.ts:44`;
  URL defaults `:97-100`; `makeRequestToFlood` `:1592`; comparison cache
  comment + key `:1042-1048`; summary strip `weatherSummaryHandler.ts:115`;
  schema `index.ts:342` / `:347`, tool description `:298`.
- **Housekeeping:** this file had been saved as `docs/.md` by the planning
  session; renamed to its intended path before T0.

## Progress Tracker

- [x] T0 — Land design doc + planning edit as first `docs:` commit (orchestrator, with baseline) — `d5c157e`
- [x] T1 — Pure spread module (`sonnet`) — `38ae647`
  - Orchestrator hand-checks (acceptance): percentile verified independently
    against the built dist — `[83,84,85,86]` → p25 83.75, p75 85.25, median
    84.5 (numpy-default `rank = q*(n-1)` interpolation); trim verified —
    participant counts `[3,3,1,3,0]` yield 4 days with the interior 1-member
    gap retained and `trimmedDays: 1`; control exclusion verified — a 9999
    control moves no statistic while still rendering as the reference.
  - **Gate detour (pre-existing, unrelated):**
    `tests/unit/metar-handler.test.ts` failed the gate because it built its
    ACIS records slot from `new Date()` while the handler derives the slot
    from the observation's timestamp — a nightly ~20-minute window after
    local midnight where the two land on different calendar dates. Confirmed
    pre-existing on a clean tree (the branch baseline at 23:47 passed; the
    same code failed at 00:11), fixed test-only in `be03155` and verified
    *inside* the failing window. The two `tests/integration/safety-hazards`
    failures in the same run were the documented live-network flake and
    passed on re-run.
- [ ] T2 — Service method + types (`sonnet`)
- [ ] T3 — Forecast handler: validation, routing, rendering (`opus`)
- [ ] T4 — get_weather_summary flag strip (`sonnet`)
- [ ] T5 — Schema + tool description (`haiku`)
- [ ] T6 — Integration live smoke (`sonnet`)
- [ ] T7 — Byte-identical sweep + documentation checklist (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the T7 sweep is
demonstrably met against the built dist (both no-flag requests byte-identical
to the branch base; the spread renders with honest framing US and non-US;
summary strip and mutual exclusion hold live), the flag-off lock files
(`forecast-fallback.test.ts`, `forecast-model-comparison.test.ts`,
`astronomy.test.ts`, `normals.test.ts`, `almanac-handler.test.ts`,
`weather-summary-handler.test.ts` — appended-to only where a task says so,
never edited) pass, and `docs/ensemble-spread-plan.md` is marked
`IMPLEMENTED` with the plan set moved to `docs/plans/`. Opening the PR is the
human's call.
