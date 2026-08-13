# Global River Conditions — Implementation Plan

**Status:** READY (2026-08-12)

Execution plan for `docs/global-rivers-plan.md` (the WHAT/WHY); rules live in
`docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/global-rivers-implementation-plan.md
```

Or, equivalently: read `docs/global-rivers-plan.md` (design),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — green baseline, one subagent per task, review the
diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass
npm audit         # no high/critical
```

**Gate caveat (standing):** two files under `tests/integration/` make **live
network calls** and flake independently — `visualization-lightning.test.ts`
(Blitzortung MQTT) and `safety-hazards.test.ts` (live NOAA/USGS). If the gate
goes red only in those files, re-run before suspecting the diff. T7 adds a third
file in that category and must follow the same tolerant-of-flake convention.

**Live-verification rule (carried from the design plan):** the channel-snapping
decision (D3) cannot be validated by mocks — a mocked 9-cell array proves the
selection logic, not that the *real* grid puts the channel where we think. At
T4/T5 and T8 the orchestrator must drive the **built dist against the live Flood
API**, including the Memphis probe from the design plan (35.125,-90.075 vs
35.125,-90.125 — expect the snap to pick the ~11,600 m³/s cell, not the 0.63
m³/s one).

## Scope & branch

**Branch:** `feat/global-rivers`, cut from `main` (v1.14.0 is released; nothing
unreleased is in flight). Target release: **v1.15.0**.

In scope: the design plan's D1–D6 — `source` routing, the Open-Meteo Flood
service method, channel snapping, discharge-vs-history presentation, args/schema,
and output framing/attribution, plus the testing and documentation checklists.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| UK Environment Agency gauge supplement | Explicitly descoped by the design plan's 2026-08-12 scope decision; stays 💡 in `docs/planning/README.md` as its own follow-up. |
| Cross-fallback (US point with zero NWPS gauges → model discharge) | Design D1: the two outputs mean different things; noted as future work, not built in v1. |
| Border-overrun cases (Toronto-style, `isInUS` true but no gauges) | Design edge-case table: unchanged in v1, documented limitation. |
| Per-call unit parameters on `get_river_conditions` | D5 adds only `source` and `forecast_days`; discharge units follow `WEATHER_UNITS` (see Assumption A1). |
| Rivers in `get_weather_summary` | The summary composite does not call rivers today (verified) and the design does not add it. |

## Findings that shape the graph

Spot-checks against the code, reconciled into the tasks below:

- **The handler signature changes, and test call sites depend on it.**
  `handleGetRiverConditions(args, noaaService, locationStore, geocodingService)`
  is called from `src/index.ts:761`, `tests/unit/riverConditions.test.ts` (3
  sites: lines 133, 374, 481) and `tests/integration/safety-hazards.test.ts` (7
  sites, one of which is `handleGetRiverConditions({}, noaaService)` with
  positional args omitted). `tsconfig.json` has `include: ["src/**/*"]`, so
  **tests are not type-checked by `npm run build`** — a signature change breaks
  them only at runtime. Mitigation baked into T4: append `openMeteoService` as
  the **last** positional parameter, so US-path call sites that omit it keep
  working, and update the call sites anyway.
- **`isInUS` lives at `src/utils/geography.ts:322`** and is already the routing
  primitive used by `currentConditionsHandler.ts:99-101`. The `source` triple
  (`auto`/`noaa`/`openmeteo`) is copied from that handler verbatim — including
  the schema wording at `src/index.ts:292` / `:322`.
- **`OpenMeteoService` has four sibling clients** (`client`, `geocodingClient`,
  `forecastClient`, `airQualityClient`, `marineClient`) each with its own
  `baseURL`, its own `interceptors.response.use(..., this.handleError)` wiring
  (`openmeteo.ts:64-153`), and its own `makeRequestTo*` retry wrapper. The
  marine trio (`getMarine` / `buildMarineParams` / `makeRequestToMarine` /
  `validateMarineResponse`, lines 1046-1207) is the closest template for T1 —
  copy its shape, including adding `floodURL` to `OpenMeteoServiceConfig`.
- **`CacheConfig.ttl` (`src/config/cache.ts:72-108`) has no flood entry**;
  `HOUR` is already defined at line 13. Note that several service methods hard-
  code TTLs inline (marine/air-quality use `60 * 60 * 1000`) — D2 asks for a
  named `ttl.floodDischarge`, so add the constant and use it.
- **`src/utils/units.ts` has no discharge conversion** — the file is plain
  numeric converters (`celsiusToFahrenheit`, `metersToFeet`, …), which is where
  T2's m³/s → ft³/s belongs. `src/utils/unitFormat.ts` is the units-*aware*
  layer; discharge does not need a `format*` helper there unless T5 wants one
  (a local formatter in the handler is acceptable and keeps `unitFormat.ts`
  untouched).
- **`validateDetail` already exists** (`src/utils/validation.ts:174`) and the
  handler already calls it (`riverConditionsHandler.ts:144`). The levels are
  `summary | standard | full` — D4's "basic" maps onto `summary`+`standard`
  (Assumption A2).
- **`validatePositiveInteger`** (`validation.ts:64`) is the right validator for
  `forecast_days` (1–210), matching how `airQualityHandler` handles its own
  `forecast_days`.
- **`calculateDistance`** (`src/utils/distance.ts:13`, haversine, km) and
  `kmToMiles` are ready for D3's snap-distance line — no new geo math.
- **`src/config/tools.ts` needs no change**: presets reference
  `get_river_conditions` by name only (lines 81, 104, 270) and
  `tests/unit/tool-config.test.ts` does not assert tool descriptions.
- **`CHANGELOG.md` has an `## [Unreleased]` section** (line 8). T8 records the
  feature there; the version bump to 1.15.0 is a separate release step, not part
  of this plan.
- **`docs/planning/README.md:34`** carries the idea row (📝) and line 88 the
  viability entry; `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md` Phase 2 is
  the parent. Both are T8's, along with `README.md:70` (tool table, 🇺🇸 → global),
  `README.md:253` (coverage table) and `docs/TOOLS.md:26,454-485`.
- **Existing US output must stay byte-identical.** `tests/unit/riverConditions.test.ts`
  pins the NOAA path in detail (gauge caps, crest caps, trend clauses, sentinel
  suppression). Any diff there is a regression, not a rebaseline — the `radius`
  and `Search Radius:` lines stay exactly as-is on the NOAA path.

## Task graph

### Phase 1 — Data layer

**T1 — Open-Meteo Flood client, types, and cache TTL** (`sonnet`)

- Files: `src/types/openmeteo.ts`, `src/config/cache.ts`,
  `src/services/openmeteo.ts`, `tests/unit/flood-discharge-service.test.ts` (new)
- Types: `OpenMeteoFloodResponse` (top-level `latitude`/`longitude`/
  `generationtime_ms`/`utc_offset_seconds`/`timezone`/`timezone_abbreviation`,
  plus `daily_units?` and `daily?` blocks) modeled on `OpenMeteoMarineResponse`
  (`types/openmeteo.ts:623`). The daily block carries `time: string[]` and the
  seven `river_discharge*` series as `Array<number | null>`. Unit strings
  contain the Unicode `³` (`m³/s`) — type them as `string`, never parse them.
  No `any`.
- Service: add `floodURL = 'https://flood-api.open-meteo.com/v1'` to
  `OpenMeteoServiceConfig` + a `floodClient` with the same headers/timeout and
  the same `handleError` interceptor wiring; add `makeRequestToFlood<T>()`
  mirroring `makeRequestToMarine` (retry/backoff/jitter identical).
- `getRiverDischarge(latitudes: number[], longitudes: number[], forecastDays = 7): Promise<OpenMeteoFloodResponse[]>`:
  validates each coordinate with `validateLatitude`/`validateLongitude`,
  rejects `forecastDays` outside 1–210 via `InvalidLocationError` (matching
  `getMarine`'s message style), rejects mismatched array lengths and empty
  input. Params: comma-joined `latitude`/`longitude`, `daily` = the seven
  variables from D2, `past_days: 31`, `forecast_days`, `timezone: 'auto'`.
  **Normalize the response defensively**: Open-Meteo returns a bare object for a
  single coordinate and an array for multiple — always return an array.
- Cache: `CacheConfig.ttl.floodDischarge = 6 * HOUR` with a comment (GloFAS
  updates daily; 6h balances freshness against the 9-point probe cost). Key via
  `Cache.generateKey('openmeteo-flood', …)` over the **rounded requested
  coordinates** (2 decimals — must stay finer than the 0.05° probe pitch) and
  `forecastDays`, caching the whole assembled array, guarded by
  `CacheConfig.enabled` exactly like `getMarine`.
- Do **not** validate that any series is non-null: all-null is a legitimate
  ocean/desert response (D3) and must reach the handler, not throw.
- Acceptance: full gate green. New unit tests (mock the axios instance / stub
  the client like `tests/unit/openmeteo-current.test.ts` does): comma-joined
  multi-point params with `past_days=31`; `forecast_days` 0/211 rejected, 1 and
  210 accepted, default 7; object-shaped response normalized to a 1-element
  array; all-null series returned rather than thrown; second identical call
  served from cache (one HTTP call).
- Commit: `feat: Add Open-Meteo Flood API client for global river discharge`
- Depends on: —

**T2 — Discharge unit conversion** (`haiku`)

- Files: `src/utils/units.ts`, `tests/unit/units.test.ts`
- Add `cubicMetersPerSecondToCubicFeetPerSecond(cms: number): number`
  (× 35.3147) with a doc comment, in the same plain-converter style as the
  neighbouring functions. No formatting, no `UnitPreferences` import.
- Acceptance: full gate green; test covers 0, 1 (≈35.31), and a large value
  (11 640 m³/s ≈ 411 062 ft³/s) to a sensible tolerance.
- Commit: `feat: Add cubic-meters-per-second to cubic-feet-per-second conversion`
- Depends on: — · **parallel-safe with T1** (disjoint files)

### Phase 2 — Channel snapping and derived logic (D3/D4 core)

**T3 — `riverDischarge` pure logic + unit tests** (`opus`)

The load-bearing design decision — the orchestrator does this one itself.

- Files: `src/utils/riverDischarge.ts` (new), `tests/unit/river-discharge.test.ts` (new)
- Exports (all pure, no I/O, no service imports beyond the response type):
  - `PROBE_OFFSETS_DEG = [-0.05, 0, 0.05]` and
    `buildProbeGrid(lat, lon): Array<{ latitude, longitude }>` — 9 points,
    **center first is not required but the center's index must be identifiable**
    (return the grid in a stable order and expose the center index, or compare
    coordinates when disclosing the snap). Clamp latitudes to ±90 and wrap/clamp
    longitudes to ±180 so polar/antimeridian requests stay valid.
  - `pickChannelCell(cells, centerIndex)` — computes each cell's mean discharge
    over the **past-31-day window** ignoring nulls; cells whose series is
    all-null are excluded; picks the highest mean. Returns
    `{ index, meanDischarge, isCenter, snapDistanceKm, snapBearing }` or `null`
    when every cell is all-null. Ties resolve to the **center** if it is tied,
    else the lowest index (deterministic — assert this in a test).
  - `MINOR_DRAINAGE_THRESHOLD_CMS = 0.1` and a helper that labels a winner below
    it as "minor local drainage — no significant river within ~8 km".
  - `classifyDischargeTrend(recentSeries)` — rising/falling/steady from the
    past-7-day window using a **relative ±10%** threshold (explicitly *not*
    `computeStageTrend`'s ±0.05 ft rule); returns direction + percent change +
    the actual window used; `undefined` with fewer than two real points.
  - `classifyAgainstRecentMean(today, mean31)` — the D4 context ratio, with the
    wording buckets ("~2.1× the recent average" / "near the recent average" /
    "well below the recent average"); define and test the bucket boundaries.
  - `formatSnapNote(distanceKm, bearing)` — "Nearest modeled river channel:
    ~5 km W of requested point", using `calculateDistance` from
    `src/utils/distance.ts`; returns `undefined` when the winner is the center.
  - Split "today's index" out as a helper (the daily array spans `past_days=31`
    + forecast, so today is **not** index 0) — everything downstream depends on
    locating it correctly from the `time` array; test it explicitly.
- Acceptance: full gate green; new tests cover max-selection, all-null → null,
  mixed-null (a cell with a partial series still competes), the minor-drainage
  threshold on both sides, deterministic ties, trend at exactly ±10% and either
  side, the context buckets at their boundaries, today-index location including
  a timezone-shifted `time` array, and snap-note wording/omission for the
  center-wins case.
- Commit: `feat: Add river-discharge channel snapping and context classification`
- Depends on: T1 (response type) · **parallel-safe with T2**

### Phase 3 — Handler and registration

**T4 — Route by `isInUS`, add `source`/`forecast_days`, global output core** (`opus`)

- Files: `src/handlers/riverConditionsHandler.ts`, `src/index.ts`,
  `tests/unit/riverConditions.test.ts` (call sites),
  `tests/integration/safety-hazards.test.ts` (call sites)
- Handler: extend `RiverConditionsArgs` with `source?: 'auto' | 'noaa' | 'openmeteo'`
  and `forecast_days?: number`; append `openMeteoService: OpenMeteoService` as
  the **last** positional parameter (see Findings). Extract today's NOAA body
  into `formatNOAARiverConditions(...)` unchanged and add
  `formatOpenMeteoRiverConditions(...)`, mirroring the two-formatter shape of
  `currentConditionsHandler.ts`. Route: `source ?? 'auto'`; `auto` →
  `isInUS(lat, lon)`; explicit values force the branch. **No cross-fallback.**
- Global path: build the 3×3 grid, one `getRiverDischarge` call, `pickChannelCell`;
  emit per D6 — `**Source:** Open-Meteo Flood API (GloFAS v4, ~5 km model grid)`,
  the ⚠️ model-estimate caveat, the snap note when the winner is off-center,
  current discharge in m³/s (plus ft³/s via T2 when `prefs.distance`-style
  imperial resolution says imperial — see A1), the recent-average context, and
  the observed trend. Footer: `*River discharge data by Open-Meteo.com (CC-BY 4.0)*`
  replacing the NWPS credit **on this path only**. All-null → the friendly
  "no river data for this location" message (not an error, not a throw).
  `radius` is ignored here and the `**Search Radius:**` line is **not** emitted.
  `forecast_days` validated with `validatePositiveInteger(raw, 'forecast_days', 1, 210)`,
  default 7; validation errors propagate (they are not swallowed by the NOAA
  path's `try/catch`, which stays scoped to the NOAA branch).
- Registration (`src/index.ts`): pass `openMeteoService` at the call site
  (line ~761); add `source` (enum, wording copied from `index.ts:292`) and
  `forecast_days` (1–210, default 7) to the schema; update `radius`'s
  description to "US gauge search radius; ignored for the global model path";
  rewrite the tool description — drop "(US only)", describe the two modes (US:
  NWPS gauge observations + flood categories; elsewhere: GloFAS model discharge
  vs. historical/ensemble context). `required: []` unchanged.
- Acceptance: full gate green with **zero diff in existing US output** (the
  whole of `tests/unit/riverConditions.test.ts` passes untouched apart from the
  added argument). **Live check with the built dist:** Memphis 35.125,-90.075
  snaps to the channel cell (~11 600 m³/s, snap note present); a mid-Pacific
  point returns the no-river message; London/Cairo return plausible discharge;
  `source: 'openmeteo'` at a US point uses the model framing; `source: 'noaa'`
  abroad keeps today's empty-gauge message; `forecast_days: 0`/`211` rejected
  naming `forecast_days`.
- Commit: `feat: Route get_river_conditions to Open-Meteo Flood outside the US`
- Depends on: T2, T3

**T5 — Ensemble forecast section and `detail` levels** (`opus`)

- Files: `src/handlers/riverConditionsHandler.ts`
- Add the D4 forecast block to the global formatter: per-day median with the
  p25–p75 band, section titled "ensemble forecast" (the spread is only
  meaningful from ~day 4 — show the band from day 1 anyway and let the label
  carry the caveat). `summary`/`standard` → current + trend + context + a 7-day
  median/band summary; `full` → adds the min/max envelope and the **full
  requested day range** (up to `forecast_days`). Trim trailing all-null forecast
  days with a note, in the style of the marine/AQI null-horizon handling.
- NOAA path untouched.
- Acceptance: full gate green. **Live check:** `forecast_days: 30, detail: "full"`
  renders every day the model provides with envelope rows and no null-derived
  `0 m³/s` days; `standard` stays at the 7-day summary; day-1 band renders
  without pretending to have spread it doesn't have.
- Commit: `feat: Add ensemble discharge forecast and detail levels to global rivers`
- Depends on: T4

### Phase 4 — Tests

**T6 — Global river handler unit tests** (`sonnet`)

- Files: `tests/unit/river-conditions-global.test.ts` (new)
- Model on `tests/unit/current-conditions-global.test.ts` (real handler, fake
  services injected). Cover: `auto` routes US → NOAA and non-US → Open-Meteo;
  explicit `source: 'noaa'` abroad and `source: 'openmeteo'` in the US; the
  non-US path makes **no** NOAA call at all (assert on the NOAA fake); the 9-cell
  mocked probe produces the snap note when an off-center cell wins and omits it
  when the center wins; all-null → friendly no-river message with no throw;
  minor-drainage labeling; the D6 header/caveat/footer strings; `forecast_days`
  default/passthrough/rejection; `detail` levels; invalid `detail` rejected;
  Unicode `³` survives into the output.
- Acceptance: new tests pass, deterministic, **no live calls**; full gate green.
- Commit: `test: Cover global river conditions routing, snapping, and output`
- Depends on: T5

**T7 — Flood integration test (mocked shape + tolerant live smoke)** (`sonnet`)

- Files: `tests/integration/global-rivers.test.ts` (new)
- Two blocks: (1) a mocked multi-point response exercising the **real** service
  + handler end to end against the true 9-element array shape (including
  `daily_units` with `m³/s`, a null-series cell, and a `time` array spanning
  past+forecast days); (2) one live smoke test against the Flood API following
  the tolerant-of-flake convention used by the existing integration files
  (generous timeout, assert on shape not values, do not fail the suite on a
  network error).
- Acceptance: mocked block deterministic; live block tolerant; full gate green
  (re-run once if only live files are red).
- Commit: `test: Add flood API integration coverage for global rivers`
- Depends on: T5 · **parallel-safe with T6** (disjoint files)

### Phase 5 — Live verification and docs

**T8 — Live sweep + documentation/registration checklist** (`opus`)

- Files: `CHANGELOG.md`, `README.md`, `docs/TOOLS.md`, `CLAUDE.md`,
  `docs/planning/README.md`, `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`,
  `docs/global-rivers-plan.md`
- **Live sweep against the built dist**, re-verifying T4 and T5's acceptance
  lists end to end plus a US regression pass (St. Louis / Mississippi output
  identical to pre-branch behavior) and one saved-location + one `city_name`
  call abroad (the `**Location:**` header still leads).
- Docs: CHANGELOG `[Unreleased]` entry (do **not** invent the version bump);
  `README.md:70` tool table 🇺🇸 → 🌍 with a one-line note on the two data modes,
  and the `README.md:253` coverage table row; `docs/TOOLS.md` §12 — new
  `source`/`forecast_days` params, the global output description, the CC-BY
  attribution, and the index line at `:26`; `CLAUDE.md` tool list (rivers no
  longer "US only") + the v1.15.0 status blurb; `docs/planning/README.md` row 34
  flipped to ✅ (the orchestrator may flip it to 🚧 at kickoff) with the viability
  row left as historical record; ICR Phase 2 marked shipped for the Flood API
  half, with the UK EA supplement explicitly still open. Mark
  `docs/global-rivers-plan.md` status `IMPLEMENTED`.
- Leave the plan set in `docs/` — per the playbook, the move to `docs/plans/`
  happens when v1.15.0 actually ships.
- Acceptance: live sweep recorded in the commit message or a short note; full
  gate green; every checklist box in the design plan's "Documentation /
  registration checklist" satisfied.
- Commit: `docs: Record global river conditions via Open-Meteo Flood API`
- Depends on: T6, T7

## Assumptions to confirm before `/run-plan`

- **A1 — discharge units.** D5 adds only `source` and `forecast_days`, so the
  tool gets **no** per-call unit knobs; the handler resolves units from the
  environment via `resolveUnitPreferences(args as UnitArgs)` (which still honors
  an explicitly passed `units` even though it is undeclared) and shows ft³/s
  alongside m³/s under imperial. If per-call `units` on this tool is wanted, say
  so — it is a one-line schema spread, but it is not in the design.
- **A2 — `detail` mapping.** D4 says "basic"; the codebase has
  `summary | standard | full`. Assumed: `summary` and `standard` both render
  D4's basic level, `full` adds the envelope and full range.
- **A3 — handler parameter order.** `openMeteoService` appended last, to keep
  existing (untypechecked) test call sites working at runtime.
- **A4 — no `radius` semantics on the global path**, and no `**Search Radius:**`
  line there — D5 says `radius` is NOAA-only; the plan omits the line entirely
  rather than printing an ignored value.

## Progress Tracker

- [x] T1 — Open-Meteo Flood client, types, cache TTL (`sonnet`) — `1b25201`
- [x] T2 — Discharge unit conversion (`haiku`) — `0cfdd38`
- [x] T3 — riverDischarge pure logic + unit tests (`opus`) — `318a466`
- [x] T4 — Route by isInUS, source/forecast_days, global output core (`opus`) — `cb6dd6e`
- [ ] T5 — Ensemble forecast section and detail levels (`opus`)
- [ ] T6 — Global river handler unit tests (`sonnet`)
- [ ] T7 — Flood integration test (mocked + live smoke) (`sonnet`)
- [ ] T8 — Live sweep + documentation checklist (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the design plan's D1–D6
acceptance (including the live Memphis snap check) is demonstrably met, existing
US river output is unchanged, and `docs/global-rivers-plan.md` is marked
`IMPLEMENTED`. Opening the PR is the human's call.
