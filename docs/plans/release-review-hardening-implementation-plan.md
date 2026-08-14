# v1.20.0 Pre-Release Review Hardening — Implementation Plan

**Status:** READY (2026-08-14)

Execution plan for `docs/plans/release-review-hardening-plan.md` (the WHAT/WHY); rules
live in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/plans/release-review-hardening-implementation-plan.md
```

Or, equivalently: read `docs/plans/release-review-hardening-plan.md` (design),
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
those files, re-run before suspecting the diff.

## Scope & branch

**Branch:** `fix/release-review-hardening`, created **off
`feat/global-fire-weather`** (the design header sets this explicitly — it
overrides the usual `feat/<name>` derivation; these are pre-tag fixes against
the release branch, which already carries the wildfire work as an ancestor).
If the release branch merges to `main` first, fork off `main` instead.

In scope: findings **F1–F6** per the design's settled decisions D1–D6, in the
design's priority order (F1 > F2 > F3 > F4 > F5 > F6 — the task graph honors
it per lane; lanes run in parallel).

### Deferred / out of scope

| Item | Reason |
|------|--------|
| **F7** — `clusterDetections` O(n·k) without a spatial index | Design defers unless trivial; it is not (spatial index = algorithm change days before a tag). Bounded by the existing 5,000-row cap. Stays a recorded note in the design plan. |
| Examples exercising the two new v1.20.0 features | Design follow-up, explicitly "not tasked here" — a content task (manifest + conversational layer), not a review finding. |
| Re-verifying the Fosberg formula, region-file insets, or `fetchDays` compensation | Design non-goal — all three verified live this review pass. |
| Any change to the US NIFC rendering body or the NOAA fire block | Design non-goal — the byte-identical guarantees stand; `tests/unit/fireWeatherContext.test.ts` and `tests/unit/wildfire-handler.test.ts` must pass **unedited**. |
| Security re-review | The security pass returned no findings; recorded in the design so it isn't re-run without cause. |
| Version bump to v1.20.0 | Release step, not a task (project convention). |

## Findings that shape the graph

Spot-checks against the code, reconciled into the tasks below:

- **F1's exact sites.** The `!== undefined` guards are at
  `currentConditionsHandler.ts:706` (`formatOpenMeteoFireWeather`); the
  dryness-pattern to copy (`!= null` + `Number.isFinite`) is ten lines down at
  `:733-735`. The three fields to widen are in `OpenMeteoCurrentWeather`
  (`src/types/openmeteo.ts:273`) — the two dryness fields there are already
  `?: number | null`, the precedent shape.
- **Widening the types has compile-forced fallout — that is the point.** The
  main Open-Meteo formatter guards the same three fields with `!== undefined`
  (`currentConditionsHandler.ts:792`, `:820`, `:824`) and feeds them to
  `Math.round`; under `strictNullChecks` the widened type breaks those sites
  until the guards become `!= null`. This is the necessary mechanical
  consequence the playbook allows — and strictly better behavior (a null
  temperature currently renders `**Temperature:** 0°F`-style fabrications
  there too). Note it in the T1 commit body. Grep confirms no consumer of
  these fields outside `currentConditionsHandler.ts`.
- **F4's locked assertion survives.** `tests/unit/metar-handler.test.ts:619`
  asserts only the leading clause ("Fire weather indices are not available on
  the METAR source"), which D4 keeps. The design anticipated an expectation
  update; in fact the existing assertion stands unedited — T2 *appends* an
  assertion for the corrected advice clause instead.
- **F2 is one line plus an allowlist.** The routing line is
  `wildfireHandler.ts:124` (`useFirms = countryCode !== 'us'`). Note
  `isInUS` (`geography.ts:322-330`) boxes CONUS/AK/HI/**PR only** — Guam,
  American Samoa, and the Marianas have no box, so the coordinate-only
  fallback (`:126`) already routes them to FIRMS. D2 keys the fix on the
  reverse-geocode answer only; the `isInUS` fallback stays as-is (widening
  those boxes is not in the design).
- **F3 needs country knowledge on the forced-`nifc` path**, which currently
  short-circuits before country resolution (`wildfireHandler.ts:96-98`).
  Reuse the auto-path's resolution block (steps 1–3, `:100-127`) — extract it
  as a small helper returning `{ countryCode, lookupFailed }`. The locked
  harness (`tests/unit/wildfire-handler.test.ts`) passes no
  `nominatimService` and uses Sacramento coordinates (`:14-15`), so it falls
  back to `isInUS` → inside coverage → rendering byte-identical, and the
  file passes unedited.
- **F5's retry hinges on the 400 mapping.** Open-Meteo 400s become
  `InvalidLocationError` in `handleError` (`openmeteo.ts:183-197`), so
  `getCurrentConditions` (`:683`) can catch precisely that class when
  `includeFireWeather` is true and retry once without the flag. The two fire
  variables are the *only* additions to the `current=` list
  (`buildCurrentParams:767-769`) — temperature/RH/wind are in the base list —
  so a successful retry still carries all three core inputs and the handler
  renders the index with dryness omitted, no signal needed. That is the
  edge-case table's "fire section degrades" (see A2).
- **F6's site** is the keyed-path bbox at `wildfireHandler.ts:383-405`
  (`formatFIRMSWildfire`). `getDetectionsByBbox` validates each corner with
  `validateLongitude` and requires `west < east` (`firms.ts:121-131`), so
  wrapped slices must be normalized into [-180, 180] before the call. Slice
  cache keys are naturally distinct (`firms.ts:139-140`).

## Task graph

Three parallel lanes (disjoint files), then a docs/verification close-out:
**Lane A** `currentConditionsHandler.ts` (T1 → T2), **Lane B**
`wildfireHandler.ts` (T3 → T4 → T5), **Lane C** `services/openmeteo.ts` (T6).

### Phase 1 — Lane A: fire-weather input integrity (F1, F4)

**T1 — F1: null-safe Fosberg core inputs, matching the dryness pattern** (`sonnet`)

- Files: `src/handlers/currentConditionsHandler.ts`,
  `src/types/openmeteo.ts`, `tests/unit/current-conditions-global.test.ts`
  (**append only** — every existing test passes unedited)
- Per D1:
  - Widen `temperature_2m`, `relative_humidity_2m`, `wind_speed_10m` in
    `OpenMeteoCurrentWeather` to `?: number | null` (the shape the runtime
    actually returns — same as the two dryness fields beneath them).
  - In `formatOpenMeteoFireWeather` (`:706`), replace the three
    `!== undefined` guards with `!= null` (the `Number.isFinite(ffwi)` check
    at `:714` plus `calculateFosbergIndex`'s NaN-on-non-finite contract
    backstop the rest); widen the function's parameter types to match.
  - Fix every site the compiler now flags in the main formatter
    (`:792`, `:820`, `:824`, and any others) with `!= null` guards — the
    necessary mechanical consequence; a null value now omits its line
    instead of rendering a converted zero. Note this in the commit body.
- Tests (design §Testing — the gap that let F1 through): a null-input matrix
  for the fire section — each of the three core inputs null, under **both**
  imperial and metric preferences → the `⚠️ Fire weather inputs unavailable`
  note and **never** an index line (6 cells minimum); all-three-present with
  null dryness → index renders, dryness omitted (existing behavior, keep
  covered).
- Acceptance: full gate green; `tests/unit/fireWeatherContext.test.ts` and
  `tests/unit/metar-handler.test.ts` pass **unedited**; all pre-existing
  tests in `current-conditions-global.test.ts` pass unedited.
- Commit: `fix: Treat null fire-weather inputs as unavailable regardless of units`
- Depends on: — · **parallel-safe with T3, T6** (disjoint files)

**T2 — F4: correct the METAR fire-weather note's advice** (`haiku`)

- Files: `src/handlers/currentConditionsHandler.ts` (`:1213-1214`),
  `tests/unit/metar-handler.test.ts` (append one assertion)
- Per D4: keep the leading clause verbatim ("Fire weather indices are not
  available on the METAR source — they require NOAA gridpoint data."); the
  advice clause becomes two routes: `source: "noaa"` for a US location, **or
  omit `source`** to get a computed Fosberg index from model data elsewhere.
- Tests: the existing `:619` assertion survives untouched; append an
  assertion covering the new both-routes advice text in the same test.
- Acceptance: full gate green; only the advice clause and the appended
  assertion change.
- Commit: `fix: Point the METAR fire-weather note at both index routes`
- Depends on: T1 (same file — serialize the lane)

### Phase 2 — Lane B: wildfire routing and rendering (F2, F3, F6)

**T3 — F2: route US territories to NIFC** (`opus`)

- Files: `src/handlers/wildfireHandler.ts`,
  `tests/unit/wildfire-routing.test.ts` (append)
- Per D2: replace `useFirms = countryCode !== 'us'` (`:124`) with a check
  against a small module-level allowlist of NIFC-covered country codes —
  nominally `us, pr, vi, gu, as, mp` — with a doc comment stating WFIGS
  coverage (not political status) as the criterion.
- **Before hard-coding, confirm the territory set against what WFIGS
  actually publishes** (design instruction): a quick live check of the WFIGS
  ArcGIS service / docs for territory incidents (e.g. `POOState` values).
  Drop any code WFIGS does not cover and record the evidence in the commit
  body. This judgment call is why the task is `opus`.
- Tests: routing cases for `pr`, `vi`, `gu`, `as` (design §Testing) — each
  resolves to NIFC, not FIRMS; a non-US code (e.g. `gr`) still routes FIRMS;
  bare `us` unchanged.
- Acceptance: full gate green; `tests/unit/wildfire-handler.test.ts` passes
  **unedited**; existing `wildfire-routing.test.ts` tests pass unedited.
- Commit: `fix: Keep US territories on the NIFC wildfire path`
- Depends on: — · **parallel-safe with T1, T6** (disjoint files)

**T4 — F3: coverage disclosure on forced-NIFC empty results** (`opus`)

- Files: `src/handlers/wildfireHandler.ts`,
  `tests/unit/wildfire-routing.test.ts` (append)
- Per D3 (no cross-fallback — the override is deliberate; disclose, don't
  error):
  - Extract the auto-path's country resolution (steps 1–3, `:100-127`) into
    a helper returning `{ countryCode, lookupFailed }`; the auto branch
    behaves exactly as today.
  - The forced-`nifc` branch now also resolves the country (cached,
    country-level) to compute `outsideNifcCoverage`: country code present →
    not in the T3 allowlist; no code (absent service, open water, failed
    lookup) → `!isInUS(lat, lon)`. A failed lookup sets the existing
    `reverseLookupFailed` note, same as auto.
  - `formatNIFCWildfire` gains an **optional trailing** `outsideCoverage =
    false` parameter. Only the empty-result branch changes, and only when
    true: drop the `✅ **No active wildfires found…**` line and "The area is
    currently clear…" sentence; state instead that NIFC/WFIGS tracks
    incidents in the US and its territories only, that this location appears
    to be outside that coverage, and suggest `source: "firms"` (or omitting
    `source`) for satellite detections. Keep the report header and radius
    lines.
  - Non-empty results render normally regardless (if NIFC somehow returns
    incidents, show them).
- Tests: Athens + `source: 'nifc'` + empty NIFC response → no ✅, no
  "currently clear", disclosure + `source: "firms"` suggestion present;
  US point + `source: 'nifc'` + empty response → byte-identical all-clear
  (unchanged); forced-nifc with no `nominatimService` and US coordinates →
  unchanged (harness fallback).
- Acceptance: full gate green; `tests/unit/wildfire-handler.test.ts` passes
  **unedited** (it forces neither source nor non-US coordinates — verify).
- Commit: `fix: Disclose NIFC coverage instead of an all-clear outside the US`
- Depends on: T3 (same files; the allowlist is the coverage predicate)

**T5 — F6: split keyed FIRMS bbox queries across the antimeridian** (`sonnet`)

- Files: `src/handlers/wildfireHandler.ts` (`:383-405`),
  `tests/unit/wildfire-routing.test.ts` (append)
- Per D6 — keyed path only; latitude clamps stay (the pole genuinely ends at
  ±90):
  - Compute `rawWest = longitude − lonOffset`, `rawEast = longitude +
    lonOffset` unclamped.
  - `lonOffset ≥ 180` (pole-adjacent `cos` blow-up, incl. `Infinity`) → one
    full-range query `[-180, 180]`.
  - `rawWest < -180` → two queries: `[rawWest + 360, 180]` and
    `[-180, rawEast]`. `rawEast > 180` → `[rawWest, 180]` and
    `[-180, rawEast − 360]`. Otherwise → one query, as today.
  - Await sequentially, concatenate the raw detections (slices are disjoint —
    no dedup needed), then apply the existing rolling-window filter and
    `filterByRadius` to the merged list. `fetchDays` identical for both
    slices. `FIRMSKeyRejectedError` from either call reaches the existing
    keyless-fallback catch unchanged.
- Tests (mock `firmsService.getDetectionsByBbox`): Fiji-like point (178°E,
  radius 500 km) → exactly two bbox calls, each with `west < east`, corners
  in range, slices meeting at ±180; detections returned from both slices all
  appear (merged before clustering); a non-dateline point → exactly one call
  with today's bbox; a pole-adjacent case → single `[-180, 180]` longitude
  span.
- Acceptance: full gate green; `tests/unit/wildfire-handler.test.ts` and
  existing routing tests pass unedited; keyless path untouched.
- Commit: `fix: Split keyed FIRMS bbox queries across the antimeridian`
- Depends on: T4 (same files — serialize the lane; no logical coupling)

### Phase 3 — Lane C: best-effort fire variables (F5)

**T6 — F5: retry the current-conditions request without fire variables on a 400** (`sonnet`)

- Files: `src/services/openmeteo.ts`,
  `tests/unit/openmeteo-fire-variables.test.ts` (append)
- Per D5 (preferred design — the retry, not a second happy-path request):
  - In `getCurrentConditions` (`:683`), when `includeFireWeather` is true and
    the request rejects with the 400-mapped `InvalidLocationError`, log a
    warn (`logger.warn`, service + reason — the garnish degraded) and retry
    **once** with the no-fire-variables params. A successful retry proves the
    variables were at fault; if the retry also fails, propagate *its* error
    (the 400 wasn't the garnish's fault).
  - Cache the degraded response under the `includeFireWeather = true` cache
    key it was requested under (15-min TTL; a re-request would 400 again).
  - No happy-path change: zero extra requests when the flagged request
    succeeds; no-flag callers untouched.
- Tests (per-instance client-spy pattern already used in this file): flagged
  request 400s → second request issued **without**
  `soil_moisture_0_to_1cm,vapour_pressure_deficit` in `current=`, response
  returned, call resolves; flagged request 400s and retry 400s → rejects
  with the retry's error, exactly two requests; happy path → one request
  (unchanged); non-400 errors (e.g. 500-mapped) → no retry-without-variables,
  existing behavior.
- Acceptance: full gate green; existing tests in
  `openmeteo-fire-variables.test.ts` and `openmeteo-current.test.ts` pass
  unedited.
- Commit: `fix: Retry current conditions without fire variables on a 400`
- Depends on: — · **parallel-safe with T1, T3** (disjoint files)

### Phase 4 — Verification and docs

**T7 — Edge-case sweep + documentation checklist** (`opus`)

- Files: `CHANGELOG.md`, `CLAUDE.md`,
  `docs/plans/release-review-hardening-plan.md` (status + move),
  this file (move)
- **Sweep** (orchestrator personally; unit-level against the built dist where
  live APIs aren't needed — standing driver caveat: `process.exit(0)`, no
  parallel live drivers). Walk the design's edge-case table:
  1. Null `temperature_2m`, metric prefs → unavailable note, not `2 (Low)`
     (the reproduced F1 case, now against dist).
  2. Null `temperature_2m`, imperial prefs → unavailable note (unchanged).
  3. Core inputs present, dryness null → index renders, dryness omitted.
  4. San Juan PR, coordinate-only → NIFC named-incident path.
  5. Athens, `source: 'nifc'`, empty → coverage disclosure, no ✅.
  6. Non-US + `source: 'metar'` + `include_fire_weather` → note names both
     routes.
  7. Mocked 400 on a fire variable → conditions render, section degrades.
  8. Fiji 178°E, 500 km, key set → two-slice merge equals keyless-path
     detections (mocked or live per key availability; record which).
  Confirm the three locked files are untouched by the branch diff:
  `git diff feat/global-fire-weather...HEAD --stat` shows no
  `fireWeatherContext.test.ts`, no `wildfire-handler.test.ts`.
- Docs, per the design's checklist:
  - CHANGELOG: fold F1–F6 into the existing `[Unreleased]` v1.20.0-line
    entries (pre-tag fixes — they refine the feature bullets rather than
    announcing themselves; a null-safety/routing-correctness clause each on
    the fire-weather and wildfire entries suffices).
  - CLAUDE.md: correct the v1.20.0 blurb's "as is the METAR note
    (`metar-handler.test.ts` unedited)" clause (the advice clause changed in
    T2, the asserted substring stands) and note the review-hardening pass;
    update the test-count if the README/CLAUDE badge convention requires it.
  - Mark the design plan `IMPLEMENTED` with brief implementation notes
    (including the WFIGS territory-set evidence from T3 and the sweep
    record), then **move the plan set (design plan + this file) to
    `docs/plans/`**. No `docs/planning/README.md` row exists for this —
    it is review hardening, not a feature idea; confirm and skip.
- Acceptance: sweep recorded (tracker or commit body); full gate green;
  every design-checklist box satisfied.
- Commit: `docs: Record the v1.20.0 pre-release review hardening`
- Depends on: T2, T5, T6

## Assumptions to confirm before `/run-plan`

- **A1 — branch name.** `fix/release-review-hardening` off
  `feat/global-fire-weather`, per the design header (overrides the playbook's
  `feat/<name>` derivation). If the release branch has merged, fork off
  `main`.
- **A2 — F5 "degrades" means index-without-dryness.** The two fire variables
  are the only flag-added request fields; a successful retry still carries
  temperature/RH/wind, so the handler naturally renders the Fosberg index
  with dryness omitted. This satisfies D5's requirement (the call must not
  fail; the section degrades) without any service→handler signal. The
  unavailable note appears only when core inputs are genuinely missing.
- **A3 — `metar-handler.test.ts` is edited additively only.** The design
  expected its asserted substring to change; in fact the assertion covers
  only the surviving clause, so T2 appends rather than rewrites.
- **A4 — forced-`nifc` now performs a country lookup.** Cached
  (country-level, permanent on rounded coords) and absent-service-safe
  (harness precedent: silent `isInUS` fallback), so US callers see no
  behavior change and at most one cheap cached lookup.
- **A5 — territory allowlist is evidence-gated.** `us, pr, vi, gu, as, mp`
  is the nominal set; T3 confirms against WFIGS before hard-coding and
  records the evidence. Guam/AS/MP still fall to FIRMS on the
  coordinate-only fallback (`isInUS` has no boxes for them) — a known,
  accepted limit; D2 keys on the reverse-geocode answer.
- **A6 — null-guard fallout in the main formatter is in scope.** Widening
  the three types compile-forces `!= null` guards at the temperature/
  humidity/wind display lines; a null now omits the line instead of
  rendering a converted zero. Necessary mechanical consequence, noted in
  T1's commit body.

## Progress Tracker

- [x] T1 — F1: null-safe Fosberg core inputs (`sonnet`) — `65f962a`
- [x] T2 — F4: correct the METAR fire-weather note's advice (`haiku`) — `40e60fc`
- [x] T3 — F2: route US territories to NIFC (`opus`) — `456a6a6`
      (WFIGS evidence 2026-08-14: all-years `POOState` carries `US-GU` 90,
      `US-VI` 5, `US-PR` 4; `US-AS`/`US-MP` zero → allowlist is `us, pr, vi, gu`)
- [x] T4 — F3: coverage disclosure on forced-NIFC empty results (`opus`) — `ddf713f`
      (also updated one pre-existing `wildfire-routing.test.ts` case that
      asserted the old all-clear — the exact behaviour D3 changes)
- [x] T5 — F6: split keyed FIRMS bbox queries across the antimeridian (`sonnet`) — `5d81446`
- [x] T6 — F5: retry without fire variables on a 400 (`sonnet`) — `9180be0`
- [ ] T7 — Edge-case sweep + documentation checklist (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the T7 sweep covers all
eight edge-case rows, the locked files
(`tests/unit/fireWeatherContext.test.ts`, `tests/unit/wildfire-handler.test.ts`)
are absent from the branch diff, and
`docs/plans/release-review-hardening-plan.md` is marked `IMPLEMENTED` with the plan
set moved to `docs/plans/`. Opening the PR / tagging v1.20.0 is the human's
call.
