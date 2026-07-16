# Global Conditions Hardening — Implementation Plan

**Status:** READY (2026-07-16)

Execution plan for `docs/global-conditions-hardening-plan.md` (the WHAT/WHY);
rules live in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/global-conditions-hardening-implementation-plan.md
```

Or, equivalently: read `docs/global-conditions-hardening-plan.md` (design),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — green baseline, one subagent per task, review
the diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass
npm audit         # no high/critical
```

**Gate caveat (carried over from the parent plan):** two files under
`tests/integration/` make **live network calls** and flake independently —
`visualization-lightning.test.ts` (Blitzortung MQTT) and
`safety-hazards.test.ts` (live NOAA/USGS). If the gate goes red in only those
files, re-run before suspecting the diff.

## Scope & branch

**Branch:** `feat/global-current-conditions` — a deliberate **continuation** of
the existing feature branch, per the design plan: v1.12.0 is unreleased and
these fixes are release blockers for it, so they stack on the same branch and
version rather than opening `feat/global-conditions-hardening`. The green
baseline is the branch's current HEAD (`77b7e3d` at planning time).

In scope: the design plan's D1–D6 — snowfall cm→mm conversion (current +
historical), the auto-mode NOAA→Open-Meteo fallback (current conditions +
forecast), the trace-precipitation display floor, the clean US-only alerts note
in weather summaries, docs, and tests.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| `isInUS` bounding-box refinement (polygons, Guam/USVI boxes) | The D2 fallback makes box precision non-critical (design plan). |
| Trace floor in the historical handler | Pre-existing display behavior; historical gets only the unit fix (D3). |
| Cardinal wind, `is_day` usage, `detail: "summary"` condensing international dailies | Review-doc observations, not tasked (design plan). |
| NOAA failure memoization for repeat border-city lookups | Accepted cost in D2. |
| METARs, global alerts | Roadmap phases. |

## Findings that shape the graph

Spot-checks against the code, reconciled into the tasks below:

- **NOAA coverage failures throw `InvalidLocationError`** (`src/services/noaa.ts:140`)
  — the precise catch target for the D2 fallback. `ServiceUnavailableError` /
  `RateLimitError` must propagate untouched.
- **`tests/unit/units-localization.test.ts` is the existing home of
  `unitFormat.ts` helper tests** — the snowfall helper tests belong there, not
  in a new file.
- **No unit-test file covers `forecastHandler` routing today** — T5 creates
  `tests/unit/forecast-fallback.test.ts` from scratch. Likewise nothing covers
  the historical handler's Open-Meteo formatting — T3 creates
  `tests/unit/historical-snowfall-units.test.ts`.
- **`tests/unit/current-conditions-global.test.ts` has only `snowfall: 0`
  fixtures** — no existing fixture encodes the wrong cm/mm assumption, so no
  fixture *corrections* are expected; T2 adds new nonzero-snowfall fixtures.
- **`tests/unit/weather-summary-handler.test.ts` mocks the sub-handlers
  wholesale** — which is exactly the right seam for D4: the alerts pre-check
  lives in the summary handler itself, so the test asserts the mocked
  `handleGetAlerts` is *not called* for a non-US location and the clean note
  text appears. (For D2-related behavior this file remains vacuous — fallback
  proof lives in T5's real-handler tests, per the parent plan's precedent.)
- **`formatOpenMeteoForecast` requests `snowfall_sum` but never displays it** —
  confirmed; the forecast path needs no snowfall change (design plan D1).
- **`weatherSummaryHandler` has `resolved.latitude/longitude` in scope** at the
  section-dispatch switch (~line 136) — the `isInUS` pre-check drops in without
  plumbing changes.
- **T2 and T4 both touch `currentConditionsHandler.ts`** — serialized (T4
  depends on T2). T6 touches only summary files and is parallel-safe with the
  whole T2–T5 chain.

## Task graph

### Phase 1 — Foundation

**T1 — Snowfall unit helper** (`sonnet`)

- Files: `src/utils/unitFormat.ts`, `tests/unit/units-localization.test.ts`
- Add `snowfallToPrecipUnit(value: number, prefs: UnitPreferences): number`:
  `value * 10` (cm → mm) when `prefs.precipitation === 'mm'`, passthrough for
  `'inch'`. Include a comment documenting the API asymmetry: Open-Meteo
  converts `snowfall` to inch under `precipitation_unit=inch` but reports
  **cm** (not mm) otherwise — same class of trap as `pressure_msl` (see the
  pressure comment in `currentConditionsHandler.ts`).
- Acceptance: new tests in `units-localization.test.ts` cover metric ×10,
  imperial passthrough, and zero. Full gate green.
- Commit: `feat: Add snowfall cm-to-mm helper for Open-Meteo metric responses`
- Depends on: —

### Phase 2 — Display fixes

**T2 — Current-conditions snowfall conversion + trace floor** (`sonnet`)

- Files: `src/handlers/currentConditionsHandler.ts`,
  `src/config/displayThresholds.ts`, `tests/unit/current-conditions-global.test.ts`
- Add `precipitation: { traceFloor: { inch: 0.005, mm: 0.05 } }` to
  `DisplayThresholds` (half the smallest displayed increment).
- In `formatOpenMeteoCurrentConditions`: pass `current.snowfall` through
  `snowfallToPrecipUnit` before display; gate `## Recent Precipitation` on
  `precipitation >= traceFloor[prefs.precipitation]` and each breakout line
  (rain, showers, snowfall) on the same floor — snowfall compared **after**
  conversion, so the floor applies to the displayed value.
- Acceptance: new tests — metric fixture with `snowfall: 0.14` (cm) renders
  `1.4 mm`; imperial snowfall unchanged; precipitation below the floor → no
  section; at/above → section present; a breakout below the floor omitted while
  the section shows. Existing tests in the file stay green unmodified. Full
  gate green.
- Commit: `fix: Convert metric snowfall and gate trace precipitation in current conditions`
- Depends on: T1 · **parallel-safe with T3, T6**

**T3 — Historical snowfall conversion** (`sonnet`)

- Files: `src/handlers/historicalWeatherHandler.ts`,
  `tests/unit/historical-snowfall-units.test.ts` (new)
- Apply `snowfallToPrecipUnit` at the two display sites — hourly `snowfall`
  (line ~111) and daily `snowfall_sum` (line ~179). No other behavior change
  (the `> 0` gates stay as they are, per D3's scope note).
- Acceptance: new test file drives the real handler with injected fakes —
  metric hourly and daily snowfall render ×10 with the `mm` label; imperial
  passthrough. Full gate green.
- Commit: `fix: Convert Open-Meteo snowfall from cm in metric historical output`
- Depends on: T1 · **parallel-safe with T2, T6**

### Phase 3 — Fallback routing

**T4 — Auto-mode NOAA → Open-Meteo fallback** (`opus`)

The design-sensitive core — the orchestrator does this one itself.

- Files: `src/handlers/currentConditionsHandler.ts`,
  `src/handlers/forecastHandler.ts`
- In both handlers, wrap **only the NOAA-branch invocation**
  (`formatNOAACurrentConditions(...)` / `formatNOAAForecast(...)`) in a
  try/catch active **only when `requestedSource === 'auto'`**. Catch
  **`InvalidLocationError` only**; on catch, `logger.warn` with coordinates and
  `fallback: true`, run the existing Open-Meteo branch for the same request,
  and prepend the note line directly under the top heading:
  `*NOAA does not cover this location; showing Open-Meteo model data instead.*`
- Every other error class propagates untouched; explicit `source: 'noaa'`
  keeps today's error behavior. Both formatters themselves stay untouched.
- Watch the layering in `forecastHandler`: the note must land inside the
  result's text content so `prependLocationLine` / location-line handling
  still composes correctly.
- Acceptance: full gate green with the existing suite untouched (the fallback
  is unreachable by any existing test's inputs). Behavioral proof lands in T5.
- Commit: `feat: Fall back to Open-Meteo when NOAA rejects auto-routed coordinates`
- Depends on: T2 (same file) · **parallel-safe with T3, T6**

**T5 — Fallback routing tests** (`sonnet`)

- Files: `tests/unit/current-conditions-global.test.ts`,
  `tests/unit/forecast-fallback.test.ts` (new)
- Current conditions (extend the existing file, real handler + injected
  fakes): auto + Toronto (43.6532, −79.3832) with the NOAA fake throwing
  `InvalidLocationError` → Open-Meteo output, fallback note present, no error;
  NOAA fake throwing `ServiceUnavailableError` → error propagates (no
  fallback); explicit `source: 'noaa'` + `InvalidLocationError` → error
  propagates.
- Forecast (new file): the same three routing cases against the real
  `handleGetForecast` with injected fakes; assert the fallback output carries
  the Open-Meteo forecast footer and the note.
- Keep everything mocked; no live calls; suite stays fast.
- Commit: `test: Cover NOAA-to-Open-Meteo auto fallback routing`
- Depends on: T4 · **parallel-safe with T6**

### Phase 4 — Summary polish & docs

**T6 — Clean US-only alerts note in weather summary** (`sonnet`)

- Files: `src/handlers/weatherSummaryHandler.ts`,
  `tests/unit/weather-summary-handler.test.ts`
- Import `isInUS` from `../utils/geography.js`. In the section loop, before
  dispatching `case 'alerts'`: if `!isInUS(resolved.latitude,
  resolved.longitude)`, skip `handleGetAlerts` and append the informational
  section (not the `⚠️ … (unavailable)` block):
  `## Alerts` / `Weather alerts are currently available for US locations only.`
  followed by the same `\n\n---\n\n` separator the other sections use.
- Acceptance: extended tests assert — non-US location: note text present, no
  `⚠️` block, mocked `handleGetAlerts` **never called**; US location:
  `handleGetAlerts` dispatched exactly as before. Full gate green.
- Commit: `fix: Note US-only alerts cleanly in international weather summaries`
- Depends on: — · **parallel-safe with T2, T3, T4, T5** (disjoint files)

**T7 — Docs** (`opus`)

- Files: `CHANGELOG.md`, `CLAUDE.md`,
  `docs/global-current-conditions-review.md`,
  `docs/global-current-conditions-plan.md`
- `CHANGELOG.md`: amend the unreleased v1.12.0 entry — snowfall unit fix and
  auto-fallback prominently, trace floor and alerts note as one-liners.
- `CLAUDE.md`: add one line to the v1.12.0 status blurb noting the auto-mode
  NOAA→Open-Meteo fallback.
- `docs/global-current-conditions-review.md`: mark I1–I4 resolved with commit
  SHAs (leave the observations section as-is).
- `docs/global-current-conditions-plan.md`: extend the D3 correction note so
  the snowfall cm asymmetry is recorded beside the pressure one.
- Acceptance: full gate green (docs-only; no test churn expected).
- Commit: `docs: Record global conditions hardening fixes`
- Depends on: T2, T3, T5, T6

## Progress Tracker

- [ ] T1 — Snowfall unit helper (`sonnet`)
- [ ] T2 — Current-conditions snowfall conversion + trace floor (`sonnet`)
- [ ] T3 — Historical snowfall conversion (`sonnet`)
- [ ] T4 — Auto-mode NOAA → Open-Meteo fallback (`opus`)
- [ ] T5 — Fallback routing tests (`sonnet`)
- [ ] T6 — Clean US-only alerts note in weather summary (`sonnet`)
- [ ] T7 — Docs (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, all six design-plan
acceptance criteria are demonstrably met, and
`docs/global-conditions-hardening-plan.md` is marked `IMPLEMENTED`. Opening the
PR is the human's call.
