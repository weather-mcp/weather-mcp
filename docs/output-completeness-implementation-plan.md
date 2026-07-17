# Output Completeness — Implementation Plan

**Status:** READY (2026-07-17)

Execution plan for `docs/output-completeness-plan.md` (the WHAT/WHY);
rules live in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/output-completeness-implementation-plan.md
```

Or, equivalently: read `docs/output-completeness-plan.md` (design),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — green baseline, one subagent per task, review
the diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass
npm audit         # no high/critical
```

**Gate caveat (standing):** two files under `tests/integration/` make **live
network calls** and flake independently — `visualization-lightning.test.ts`
(Blitzortung MQTT) and `safety-hazards.test.ts` (live NOAA/USGS). If the gate
goes red in only those files, re-run before suspecting the diff.

**Live-verification rule (carried from the design plan):** the null/sentinel
bug classes this plan guards against have never been visible in the mocked
suite. At T1, T3, T6, T7, and T8 the orchestrator must drive the **built dist
against the real APIs**, not just the unit gate.

## Scope & branch

**Branch:** `feat/output-completeness`, cut from `main` after
`feat/max-range-expansion` merged. **The branch already exists and is the
current branch**; the design plan's sequencing step 1 (D4 attribution
one-liner — NWPS-only river footer) is **already landed** on it as `4fae1f8`.
Do not redo it; T0 is pre-ticked below.

In scope: the design plan's four settled decisions — D1 (AQI per-day peak UV +
hourly fetch trimmed to 3 variables), D2 (`detail="full"` = capped 25,
disclosed, on river/wildfire/lightning), D3 (ArcGIS `exceededTransferLimit`
caveat at all detail levels), D4 (observed trend on all shown gauges; forecast
series at `full`; attribution already done). Target release: next minor.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| O1 — historical `limit` ≳ 490 token-cap note in schema | "Noted, not settled" in the design plan; no decision taken. |
| O2 — historical truncation note naming the `limit` lever | Same — cheap, but not among the four decisions. |
| F4 — wildfire "Size: 0 acres" when NIFC reports no size | Owned by `docs/testing/DEFECT_FIX_PLAN.md`; explicitly not pulled in. |
| O5 recheck (historical pre-limit count) | Defect-plan bookkeeping, appears already fixed; not this batch. |
| Wiring USGS streamflow as a live source | Rejected in design D4. |
| Hourly pollutant forecast display | Rejected in design D1 (never shown at any detail level). |
| Anything shipped in `docs/max-range-expansion-plan.md` | Already merged to `main`. |

## Findings that shape the graph

Spot-checks against the code (2026-07-17), reconciled into the tasks below:

- **D3 needs no service change.** The design plan's touch set lists
  `src/services/nifc.ts` ("surface flag"), but `exceededTransferLimit?: boolean`
  is already on `NIFCQueryResponse` (`src/types/wildfire.ts:79`) and
  `wildfireHandler.ts` already receives the whole response object
  (`response.features` — the flag rides along). D3 is handler + tests only.
- **The `NWPSStageFlowResponse` type is dead code and likely wrong.**
  `src/types/noaa.ts:497` models a single flat series (`data: StageFlowDataPoint[]`),
  but the live probe counted **separate observed and forecast series** per gauge
  — the real `/gauges/{lid}/stageflow` payload is almost certainly
  `{ observed: {...}, forecast: {...} }`. T6 must hit the endpoint live
  **first**, correct the type to match reality, then wire it. Do not trust the
  existing interface.
- **The UV plumbing mostly exists.** `OpenMeteoAirQualityHourlyData.uv_index`
  is already typed (`src/types/openmeteo.ts:386`) and `getUVIndexCategory` is
  already imported by `airQualityHandler.ts` (line 13, used at 133-148). D1 is
  a formatter + fetch-list change, no new types or mappings.
- **`alertsHandler.ts` is the exact `detail` pattern to mirror** for T3–T5:
  `detail?: DetailLevel` on the args interface, `validateDetail((args as X)?.detail)`
  at the top, and the escape-hatch note at non-full levels
  (`alertsHandler.ts:135-137`). The schema side is spreading
  `...DETAIL_SCHEMA_PROPERTY` (`src/index.ts:235`) into each tool's properties.
- **`src/index.ts` is touched by T3, T4, and T5** (three tool schemas) — those
  are serialized. T2 (a test file only) is the only task parallel-safe beside
  them.
- **Lightning's formatter doesn't see args today** —
  `formatLightningActivityResponse(result)` takes only the response
  (`lightningHandler.ts:51`); T5 threads a `detail` parameter through it.
  Statistics already aggregate all strikes; only the listed-strike cap moves.
- **No wildfire-handler unit test exists** (`tests/unit/` has only
  `fireWeather*.test.ts`, which are utils) — T4 creates
  `tests/unit/wildfire-handler.test.ts` from scratch, modeled on the
  handler-with-mocked-service pattern in `tests/unit/air-quality-forecast.test.ts`.
- **`tests/unit/riverConditions.test.ts` tests exported pure helpers only**
  (`isRealValue`, `isUsableForecast`) — reuse those exported guards for the
  trend/series work (T6/T7) instead of re-deriving sentinel logic, and extend
  that file for the new pure functions.
- **Trend cost control:** at `detail="full"` T6 issues up to 25 stageflow
  calls. `getNWPSStageFlow` already caches (30 min TTL). Fetch per-gauge with
  `Promise.allSettled`-style tolerance: a failed stageflow fetch degrades that
  gauge to no-trend — it must never fail the whole report.
- **CHANGELOG has an `## [Unreleased]` section** carrying the max-range
  entries — T8 appends there; do not invent a version number.

## Task graph

### Phase 0 — already landed

**T0 — D4 attribution one-liner (NWPS-only river footer)** — DONE, `4fae1f8`,
committed before this plan was written. River footer reads
`*Data source: NOAA National Water Prediction Service (NWPS)*`.

### Phase 1 — D1: AQI peak UV + fetch trim

**T1 — AQI forecast: per-day peak UV in day headers, hourly fetch trimmed to 3 vars** (`opus`)

The null-coercion bug class the design plan warns about lives here — the
orchestrator does this one itself.

- Files: `src/handlers/airQualityHandler.ts`, `src/services/openmeteo.ts`
- Formatter (`formatHourlyForecast`, `airQualityHandler.ts:208+`): add a peak-UV
  scan per day using the **same finite-number guard shape as `aqiAt`**
  (`typeof v === 'number' && Number.isFinite(v)`); render the day header as
  `### Friday, Jul 17 — peak US AQI 133 (Unhealthy for Sensitive Groups) · UV 9 (Very High)`
  using the existing `getUVIndexCategory` mapping (do **not** fork thresholds;
  match the current-conditions block's level words). A day whose UV values are
  all null/missing renders the AQI header with **no** UV clause — never
  "UV 0 (Low)". A day with AQI data absent keeps its existing
  "*No AQI data available for this day*" behavior regardless of UV.
- Fetch (`src/services/openmeteo.ts:978-1006`, the `if (forecast)` hourly
  block): reduce the hourly list from 24 variables to exactly
  `us_aqi`, `european_aqi`, `uv_index`. The `current=` list is **untouched**.
- Acceptance: full gate green; built params for a forecast request contain an
  `hourly` value of exactly `us_aqi,european_aqi,uv_index`; current-conditions
  output unchanged. **Live check with the built dist:** 7-day AQI forecast at
  a high-UV location (e.g. Phoenix) shows plausible peak UV per day with level
  words matching the current-conditions UV scale; no "UV 0 (Low)" on trailing
  no-data days.
- Commit: `feat: Add per-day peak UV to AQI forecast and trim hourly fetch to 3 variables`
- Depends on: —

**T2 — AQI forecast UV unit tests** (`sonnet`)

- Files: `tests/unit/air-quality-forecast.test.ts` (extend)
- Extend the existing handler-with-mocked-service tests: peak-UV selection
  (max over the day's hours, not first/last); null-UV day omits the UV clause
  entirely; all-null-UV location renders AQI-only headers throughout; header
  format matches `— peak US AQI N (Level) · UV N (Level)`; mixed
  null-and-real UV within a day picks the max of the real values; hourly
  request carries exactly the 3 variables (assert on the captured params).
- Acceptance: new tests pass, deterministic, no live calls; full gate green.
- Commit: `test: Cover AQI forecast peak-UV selection and null-UV omission`
- Depends on: T1 · **parallel-safe with T3** (files disjoint: test file only)

### Phase 2 — D2 + D3: `detail="full"` capped-25 + truncation caveat

All three tasks mirror `alertsHandler.ts`'s `detail` plumbing and spread
`...DETAIL_SCHEMA_PROPERTY` into the tool schema. Serialized — all touch
`src/index.ts`.

**T3 — River: `detail` param; `full` lists nearest 25 gauges and 25 crests** (`sonnet`)

- Files: `src/handlers/riverConditionsHandler.ts`, `src/index.ts`,
  `tests/unit/riverConditions.test.ts` (extend)
- Handler: add `detail` to `RiverConditionsArgs`; `validateDetail` at top.
  `maxGaugesToShow` = 25 when `detail === 'full'`, else 5 (unchanged).
  Historic crests slice (`:223`) = 25 at `full`, else 3. The remainder note
  stays present and accurate at every level, including `full` when >25 exist
  (e.g. `*Note: 1,914 additional gauges found within radius (showing nearest 25 only)*`);
  at `summary`/`standard` append the escape-hatch pointer
  (`use detail="full" for more`, matching the alerts wording style).
- Schema: spread `...DETAIL_SCHEMA_PROPERTY` into `get_river_conditions`.
- Tests (handler-level, mocked `NOAAService`): cap-at-25 with 30 gauges at
  `full`; 5 shown at default; note text at each detail level; note accuracy
  when total exceeds 25; crests 3 vs 25; `validateDetail` rejection of bad
  values (consistent error message).
- Acceptance: full gate green; new tests as listed. **Live check deferred to
  T8** (Chicago 500 km at `full`).
- Commit: `feat: Add detail param to get_river_conditions (full lists nearest 25)`
- Depends on: T1 (serialize; T2 may run beside this)

**T4 — Wildfire: `detail` param + ArcGIS transfer-limit caveat (D3)** (`sonnet`)

- Files: `src/handlers/wildfireHandler.ts`, `src/index.ts`,
  `tests/unit/wildfire-handler.test.ts` (new)
- Handler: `detail` plumbing as T3; `maxFiresToShow` = 25 at `full`, else 5;
  remainder note + escape-hatch pointer as in T3. **D3:** when
  `response.exceededTransferLimit` is true, render
  `*Results may be incomplete — the fire data service truncated the response.*`
  at **all** detail levels (no service change needed — the flag already rides
  on the response; see Findings). Place it where it reads as a data caveat
  (near the found-count line or the footer), and ensure at `full` the output
  does not imply completeness when the flag is set.
- Schema: spread `...DETAIL_SCHEMA_PROPERTY` into `get_wildfire_info`.
- Tests (new file, mocked `NIFCService`): cap-at-25 at `full` / 5 at default;
  note text per level; caveat present at all three levels with the flag set;
  caveat absent with it unset; `validateDetail` rejection. Do **not** "fix"
  the 0-acres display (F4 — out of scope).
- Acceptance: full gate green; new test file passes deterministically.
- Commit: `feat: Add detail param to get_wildfire_info and surface ArcGIS truncation caveat`
- Depends on: T3 (shared `src/index.ts`)

**T5 — Lightning: `detail` param; `full` lists 25 strikes** (`sonnet`)

- Files: `src/handlers/lightningHandler.ts`, `src/index.ts`,
  `tests/unit/lightning-handler.test.ts` (extend)
- Handler: `detail` plumbing; thread `detail` into
  `formatLightningActivityResponse`; strike list cap (`:369`) = 25 at `full`,
  else 10 (unchanged); the "*Showing 10 of N strikes detected*" note stays
  accurate at each level and gains the escape-hatch pointer at non-full;
  statistics (which aggregate **all** strikes) unchanged.
- Schema: spread `...DETAIL_SCHEMA_PROPERTY` into `get_lightning_activity`.
- Tests: extend the existing lightning handler tests — 30 strikes: 10 listed
  at default with note+pointer, 25 at `full` with accurate remainder note;
  ≤10 strikes lists all with no note; statistics identical across levels;
  `validateDetail` rejection.
- Acceptance: full gate green.
- Commit: `feat: Add detail param to get_lightning_activity (full lists 25 strikes)`
- Depends on: T4 (shared `src/index.ts`)

### Phase 3 — D4: river trend + forecast series

**T6 — River: observed rise/fall trend on every shown gauge** (`opus`)

Design-sensitive (dead-code endpoint, sentinel class, fan-out failure
tolerance) — the orchestrator does this one itself.

- Files: `src/handlers/riverConditionsHandler.ts`, `src/types/noaa.ts`,
  `tests/unit/riverConditions.test.ts` (extend); `src/services/noaa.ts` only
  if the live shape check forces a client change
- **First, live-verify the stageflow payload shape** (`curl` the NWPS
  `/gauges/{lid}/stageflow` endpoint for a real LID from live tool output) and
  correct `NWPSStageFlowResponse` (`types/noaa.ts:497`) to match reality —
  expected `{ observed?: {...series}, forecast?: {...series} }`; the current
  flat interface is unverified dead code.
- Trend: for each **shown** gauge (5 default / 25 at `full`), fetch stageflow
  (cached, 30 min TTL); compute direction + magnitude from the **observed**
  series over a ~6 h window ending at the latest **real** point (filter every
  point through the exported `isRealValue`; timestamps through the plausible-
  time guard). Render inline on the existing stage line:
  `**River Stage:** 0.97 ft  ↘ falling (-0.4 ft / 6h)` (rising ↗ / falling ↘ /
  steady →; pick a small steady threshold, e.g. |Δ| < 0.05 ft, as a named
  constant). Gauges with no usable observed series omit the trend silently.
  Fetch with per-gauge error tolerance (`Promise.allSettled` or equivalent):
  a failed/timed-out stageflow call degrades that gauge to no-trend and never
  fails the report. Extract the trend math as an exported pure function.
- Tests: trend direction/magnitude/window math (pure function): rising,
  falling, steady-threshold boundary, sentinel points excluded from the
  window, empty/all-sentinel series → undefined, window shorter than 6 h uses
  what exists (label the actual window).
- Acceptance: full gate green. **Live check with the built dist:** Boston
  100 km — a trend renders on all 5 shown gauges (matches the probe's 5/5
  observed coverage); magnitudes plausible; no `-999`-derived trends.
- Commit: `feat: Show observed rise/fall trend on every shown river gauge`
- Depends on: T5 (river handler already carries `detail` from T3; serialized
  behind Phase 2 to keep the handler stable)

**T7 — River: forecast series at `detail="full"`** (`sonnet`)

- Files: `src/handlers/riverConditionsHandler.ts`,
  `tests/unit/riverConditions.test.ts` (extend)
- At `detail === 'full'` only: for gauges whose stageflow response (already
  fetched in T6 — reuse it, do not fetch twice) carries a **forecast** series
  with usable points, render the multi-point series (time, stage, per-point
  flood category where derivable from the gauge's flood categories). Every
  point filtered through `isRealValue` + the plausible-time guard — a `-999`
  or year-0001 point is dropped, and a series with no surviving points renders
  **nothing** (no header, no empty section) — the probe says ~4/5 gauges have
  no forecast series and they must stay visually unchanged. Keep the existing
  single-point `### Forecast` block at non-full levels (unchanged behavior).
- Tests: series rendered at `full` for a gauge with a usable forecast series;
  nothing rendered for a gauge without one (assert no empty "Forecast series"
  header); sentinel points dropped per-point; all-sentinel series suppressed
  entirely; non-full levels unchanged.
- Acceptance: full gate green. **Live check deferred to T8** (BHBM3 series).
- Commit: `feat: Render river forecast series at detail="full"`
- Depends on: T6

### Phase 4 — live verification & docs

**T8 — Live sweep + docs** (`opus`)

- Files: `CHANGELOG.md`, `docs/TOOLS.md`, `CLAUDE.md`,
  `docs/output-completeness-plan.md`
- **Live sweep against the built dist** (real APIs, per the design plan's
  acceptance criteria):
  1. AQI 7-day forecast, high-UV location — peak UV per day, level words
     correct, no "UV 0 (Low)" (re-verify T1).
  2. River, Chicago 500 km, `detail="full"` — exactly 25 gauges, correct
     remainder note (≈1,9xx additional), response well inside client token
     limits.
  3. River, Boston 100 km — trend on all 5 shown gauges; forecast series on
     BHBM3 only at `full`; no sentinel values anywhere in output.
  4. Wildfire, active region, default + `full` — caps and notes correct
     (the `exceededTransferLimit` caveat is unit-verified; note in the sweep
     record if it can't be triggered live).
  5. Lightning, active-storm region if one exists — 25-strike cap at `full`,
     statistics identical across levels (fall back to unit evidence if the
     map is quiet).
- Docs: CHANGELOG `[Unreleased]` entries for D1–D4; `docs/TOOLS.md` — AQI
  forecast day-header format, `detail` on the three tools (caps and
  escape hatch), truncation caveat, river trend + `full` forecast series;
  `CLAUDE.md` status blurb one-liner. Mark `docs/output-completeness-plan.md`
  status `IMPLEMENTED`.
- Acceptance: live sweep documented (commit message or a short
  `docs/output-completeness-verification.md` note, matching the max-range
  precedent); full gate green.
- Commit: `docs: Record output-completeness batch (peak UV, capped-25 detail, truncation caveat, river trends)`
- Depends on: T2, T7

## Progress Tracker

- [x] T0 — D4 attribution one-liner (NWPS-only footer) (`opus`) — `4fae1f8` (pre-landed)
- [x] T1 — AQI peak UV in day headers + hourly fetch trim (`opus`) — `6939347`
- [ ] T2 — AQI forecast UV unit tests (`sonnet`)
- [ ] T3 — River `detail` param, capped-25 `full` (`sonnet`)
- [ ] T4 — Wildfire `detail` param + ArcGIS truncation caveat (`sonnet`)
- [ ] T5 — Lightning `detail` param, capped-25 `full` (`sonnet`)
- [ ] T6 — River observed trend on all shown gauges (`opus`)
- [ ] T7 — River forecast series at `detail="full"` (`sonnet`)
- [ ] T8 — Live sweep + docs (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the design plan's
acceptance criteria (D1–D4 + live checks) are demonstrably met, and
`docs/output-completeness-plan.md` is marked `IMPLEMENTED`. Opening the PR is
the human's call.
