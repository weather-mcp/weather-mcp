# Max-Range Expansion — Implementation Plan

**Status:** READY (2026-07-16)

Execution plan for `docs/max-range-expansion-plan.md` (the WHAT/WHY);
rules live in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/max-range-expansion-implementation-plan.md
```

Or, equivalently: read `docs/max-range-expansion-plan.md` (design),
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

**Live-verification rule (carried from the design plan):** the null-padding
class of bug has never been visible in the mocked suite. At T2/T3 and T7 the
orchestrator must drive the **built dist against the real APIs**, not just the
unit gate.

## Scope & branch

**Branch:** `feat/max-range-expansion`, cut from `feat/global-current-conditions`
(which carries the unreleased air-quality work these patterns mirror). Rebase
onto `main` only if that branch merges first.

In scope: the design plan's D1–D3 — marine `forecast_days` (1–16) with
full-range null-trimmed display and the dead hourly fetch dropped; historical
hourly `limit` ceiling 500 → 744 with the hourly-only semantics documented;
imagery `detail="full"` listing all animation frames plus defensive RainViewer
nowcast support. Target release: next minor after v1.12.0.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| All Tier 2 audit findings (AQI per-day peak UV, `detail="full"` for river/wildfire/lightning caps, ArcGIS `exceededTransferLimit` caveat, river forecast series + USGS footer, trimming unused AQ hourly vars) | Own plan: `docs/output-completeness-plan.md` (DRAFT, decisions unsettled). |
| Applying `limit` to the historical **daily** path | Would silently truncate multi-year requests — documented asymmetry instead (design D2). |
| NOAA marine branch changes | Current-conditions-only by design (`marineConditionsHandler.ts:201-206`). |
| NOAA recent-history clamp (1–500 at `noaa.ts:493-497`) | NOAA's own documented API max; clamping stays. |
| Advertising nowcast in the imagery tool description | Only if T7's live check shows frames actually flowing — `nowcast` was empty on two checks 2026-07-16. |

## Findings that shape the graph

Spot-checks against the code, reconciled into the tasks below:

- **`validateHistoricalWeatherParams` already reads the constant**
  (`src/utils/validation.ts:256` uses `FormatConstants.maxHistoricalLimit`) —
  flipping the constant retunes validation automatically. A grep found **no
  unit test pinning 500** for the historical limit (the 500s in
  `bounds-checking.test.ts` are gridpoint maxEntries, unrelated); T4's
  subagent must confirm and add bound tests where the other `limit` bounds
  are tested.
- **`RainViewerResponse.radar.nowcast` is already typed** as a required
  `RainViewerFrame[]` (`src/types/imagery.ts:72`), but live checks found it
  empty and it may be absent — T6 should widen it to optional (`nowcast?:`)
  and code against missing/empty as the normal case.
- **`tests/unit/imagery-handler.test.ts` mocks `rainViewerService` wholesale**
  — right seam for T5's frame-cap formatting tests, useless for T6's nowcast
  logic. T6 gets a new `tests/unit/rainviewer-nowcast.test.ts` driving the
  real `RainViewerService.getPrecipitationRadar` with a stubbed
  `getRadarData` (or mocked axios).
- **No unit test exercises `getMarine`/marine hourly** (`great-lakes-marine`
  is integration/NOAA-branch; `geography.test.ts` is routing only) — dropping
  `params.hourly` and switching `validateMarineResponse` to require `daily`
  should break nothing existing; T3 creates the marine unit coverage from
  scratch, modeled on `tests/unit/air-quality-forecast.test.ts`.
- **The formatter's `?.[i] !== undefined` guards pass `null` through** to
  `formatWaveHeight`/`getWaveHeightCategory`
  (`marineConditionsHandler.ts:347-368`) — T2 must replace them with
  finite-number checks, not merely add trimming.
- **`airQualityHandler.ts:26-49` is the exact shape to mirror** for T2's
  `forecast_days` plumbing (`DEFAULT_FORECAST_DAYS`/`MAX_FORECAST_DAYS`
  locals + `validatePositiveInteger`).
- **`src/index.ts` is touched by T2 (marine schema), T4 (historical schema),
  and T5 (imagery description)** — those three are serialized; T6 is the only
  code task with fully disjoint files.
- **CHANGELOG has an `## [Unreleased]` section** (line 8) — T7 records the
  three changes there; do not invent a version number.

## Task graph

### Phase 1 — Marine (D1)

**T1 — Marine service: 16-day cap, drop dead hourly fetch** (`sonnet`)

- Files: `src/services/openmeteo.ts`
- In `getMarine`: raise the `forecastDays` validation cap 7 → 16; update the
  doc comment (API accepts 16, verified live 2026-07-16; model horizon ~10
  days, null-padded beyond). In `buildMarineParams`: delete the
  `params.hourly` block entirely, keep `current` (always) and `daily`
  (forecast only) untouched. In `validateMarineResponse`: when
  `forecast=true`, require `daily`/`daily.time` non-empty instead of
  `hourly` (error message updated to say "daily marine forecast data").
- Acceptance: full gate green; `forecastDays` 0 and 17 rejected, 16 accepted;
  built params for `forecast=true` contain `daily` and `forecast_days` but no
  `hourly` key. Confirm no existing test stubs marine `hourly` (none found at
  planning time).
- Commit: `feat: Raise marine forecast ceiling to 16 days and drop unused hourly fetch`
- Depends on: —

**T2 — Marine handler: `forecast_days` param + full-range null-trimmed display** (`opus`)

The design-sensitive core — the orchestrator does this one itself.

- Files: `src/handlers/marineConditionsHandler.ts`, `src/index.ts`
- Handler: add `forecast_days` to `MarineConditionsArgs`; local constants
  `DEFAULT_FORECAST_DAYS = 5`, `MAX_FORECAST_DAYS = 16`; validate via
  `validatePositiveInteger(raw, 'forecast_days', 1, MAX_FORECAST_DAYS)`
  exactly per `airQualityHandler.ts:26-49`; pass through to `getMarine(...)`
  replacing the hardcoded `5`.
- Formatter (`formatOpenMeteoMarineConditions`): remove `Math.min(5, …)`;
  render every fetched day. Null-horizon handling in the AQI-fix style: a day
  whose `wave_height_max` is not a finite number is a no-data day; trailing
  no-data days are trimmed with a footer note ("the marine model provided no
  data for the final N requested day(s)"); interior per-day fields guarded
  with `Number.isFinite` (replacing the `!== undefined` checks that pass
  `null` into `formatWaveHeight`); all days null → "*No marine forecast data
  available for this location.*". Delete the "*Hourly forecast data
  available…*" line. NOAA branch untouched.
- Schema (`src/index.ts`, `get_marine_conditions`): add `forecast_days`
  (number, 1–16, default 5) noting the marine model typically provides ~10
  days and trailing no-data days are omitted with a note; update the
  `forecast` param description and the tool description (both currently
  hardcode "next 5 days").
- Acceptance: full gate green. **Live check with the built dist:**
  `forecast: true, forecast_days: 16` shows every day the model provides
  (~10 today) with real values plus the trimmed-days note; no null-derived
  "0 m (Calm)" days; `forecast_days: 0`/`17` rejected naming `forecast_days`;
  default 5; request URL contains no `hourly=`; current conditions unchanged.
- Commit: `feat: Add forecast_days to get_marine_conditions with full-range null-trimmed display`
- Depends on: T1

**T3 — Marine forecast unit tests** (`sonnet`)

- Files: `tests/unit/marine-forecast.test.ts` (new)
- Model on `tests/unit/air-quality-forecast.test.ts` (real handler, injected
  fakes/mocked service): `forecast_days` default 5 / passthrough / rejection
  (0, 17, non-integer); full-range display (all fetched days render, no 5-day
  cap); trailing-null trimming + footer note; interior-null guarding (a null
  field mid-range is skipped, not rendered as 0 m); all-null message;
  `forecast: false` output unchanged; no `hourly` in the flow.
- Acceptance: new tests pass, deterministic, no live calls; full gate green.
- Commit: `test: Cover marine forecast_days param and null-horizon trimming`
- Depends on: T2

### Phase 2 — Historical (D2)

**T4 — Historical hourly `limit` ceiling 500 → 744** (`sonnet`)

- Files: `src/config/displayThresholds.ts`, `src/index.ts`, existing unit
  tests that exercise the `limit` bound (extend; confirm none pin 500),
  `src/handlers/historicalWeatherHandler.ts` (comment only, if needed)
- `FormatConstants.maxHistoricalLimit` 500 → **744** (= 31 days × 24 h, the
  `maxHourlyHistoricalDays` window) with a comment; default stays 168.
  Schema (`index.ts:357-363`): `maximum: 744`; description states `limit`
  applies to **hourly** output only and that daily-granularity output
  (ranges > 31 days) always shows the full range (documented asymmetry —
  do NOT apply `limit` to the daily path). NOAA path untouched.
- Acceptance: validation accepts `limit: 744`, rejects 745 (unit tests cover
  both bounds); full gate green.
- Commit: `feat: Raise historical hourly limit ceiling to 744 (31 days)`
- Depends on: T2 (shared `src/index.ts`; content-independent)

### Phase 3 — Imagery (D3)

**T5 — `detail="full"` lists all animation frames** (`sonnet`)

- Files: `src/handlers/weatherImageryHandler.ts`, `src/index.ts`,
  `tests/unit/imagery-handler.test.ts`
- In `formatWeatherImageryResponse` (frame block at lines 188-211): when
  `detail === 'full'`, list **all** frames; `summary`/`standard` keep the
  existing 3-of-N (first/middle/last) and the note becomes
  `*Showing 3 of N frames for brevity — use detail="full" for all frames*`.
  Update the `get_weather_imagery` tool description sentence about
  `detail="full"` (embeds Markdown images **and lists every animation
  frame**).
- Acceptance: extended tests — >5 frames + `detail="full"` renders every
  frame; `standard` renders 3 with the escape-hatch note; ≤5 frames renders
  all regardless. Full gate green.
- Commit: `feat: List all radar animation frames at detail="full"`
- Depends on: T4 (shared `src/index.ts`; content-independent)

**T6 — RainViewer nowcast appended defensively** (`sonnet`)

- Files: `src/services/rainviewer.ts`, `src/types/imagery.ts`,
  `tests/unit/rainviewer-nowcast.test.ts` (new)
- Widen `RainViewerResponse.radar.nowcast` to optional. In
  `getPrecipitationRadar`, when `animated`: append `nowcast` frames (when
  present and non-empty) after the past frames, with descriptions labeling
  them as forecast (e.g. "+10 min forecast" relative to the latest past
  frame); missing/empty `nowcast` is the **normal** case and yields exactly
  today's behavior. Non-animated behavior unchanged (latest **past** frame).
  **Do not** touch the tool description (T7 decides per live check).
- Acceptance: new test file drives the real service with a stubbed
  `getRadarData`: empty `nowcast`, missing `nowcast`, and 3-frame `nowcast`
  (frames appended in order, labeled as forecast); non-animated ignores
  nowcast. Full gate green.
- Commit: `feat: Append RainViewer nowcast frames defensively to animated radar`
- Depends on: — · **parallel-safe with T1–T5** (disjoint files)

### Phase 4 — Live verification & docs

**T7 — Live sweep + docs** (`opus`)

- Files: `CHANGELOG.md`, `docs/TOOLS.md`, `CLAUDE.md`,
  `docs/max-range-expansion-plan.md`, `src/index.ts` (only if nowcast flows)
- **Live sweep against the built dist:** (1) marine `forecast_days: 16` —
  full acceptance list from T2 re-verified end to end; (2) a 31-day hourly
  historical range with `limit: 744` shows all 744 observations and no
  "(of M available)" note; daily-path request unchanged; (3) animated radar
  with `detail="full"` lists every frame; (4) check whether RainViewer
  `nowcast` now returns frames — if yes, add one sentence to the
  `get_weather_imagery` description + TOOLS.md; if still empty, leave
  descriptions alone (defensive code ships regardless).
- Docs: CHANGELOG `[Unreleased]` entries for all three tools; `docs/TOOLS.md`
  — marine `forecast_days` + updated forecast wording, historical `limit`
  744 + hourly-only semantics, imagery `detail="full"` frame behavior;
  `CLAUDE.md` status blurb one-liner. Mark
  `docs/max-range-expansion-plan.md` status `IMPLEMENTED`.
- Acceptance: live sweep documented in the task's commit message or a short
  note; full gate green.
- Commit: `docs: Record max-range expansion (marine 16-day, historical 744-limit, imagery frames)`
- Depends on: T3, T4, T5, T6

## Progress Tracker

- [ ] T1 — Marine service: 16-day cap, drop dead hourly fetch (`sonnet`)
- [ ] T2 — Marine handler: forecast_days + full-range null-trimmed display (`opus`)
- [ ] T3 — Marine forecast unit tests (`sonnet`)
- [ ] T4 — Historical hourly limit ceiling 500 → 744 (`sonnet`)
- [ ] T5 — detail="full" lists all animation frames (`sonnet`)
- [ ] T6 — RainViewer nowcast appended defensively (`sonnet`)
- [ ] T7 — Live sweep + docs (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the design plan's
acceptance criteria (D1–D3 + live checks) are demonstrably met, and
`docs/max-range-expansion-plan.md` is marked `IMPLEMENTED`. Opening the PR is
the human's call.
