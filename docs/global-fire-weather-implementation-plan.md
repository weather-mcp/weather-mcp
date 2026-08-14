# Global Fire Weather Indices (Fosberg FFWI) — Implementation Plan

**Status:** READY (2026-08-14)

Execution plan for `docs/global-fire-weather-plan.md` (the WHAT/WHY); rules live in
`docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/global-fire-weather-implementation-plan.md
```

Or, equivalently: read `docs/global-fire-weather-plan.md` (design),
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
**live network calls** and flake independently (see the standing flaky-tests
caveat). If the gate goes red only in those files, re-run before suspecting
the diff. **T6 adds another file in that category** (Open-Meteo live smoke)
and must follow the same tolerant-of-flake convention.

**Live-verification rule:** the upstream contract was live-verified 2026-08-13
and re-verified 2026-08-14 (Milan, Sydney, Reykjavik all return complete
non-null `current` values for the six variables on the endpoint
`getCurrentConditions` already calls — design header). What can only be
trusted against the built dist is the **byte-identical guarantee** (no-flag and
US-flag requests vs the branch base) and the T7 acceptance points — the
orchestrator runs that sweep personally; a subagent's claim is never the gate.
Standing driver caveat: dist drivers need `process.exit(0)`; don't run live
drivers in parallel.

## Scope & branch

**Branch:** `feat/global-fire-weather`, created **off `feat/global-wildfire`**
(unmerged as of 2026-08-14; this feature's docs edit CLAUDE.md/CHANGELOG lines
that branch rewrote — design header). Target release: rides the v1.20.0 line;
version settled at release time.

In scope: the design's D1–D7 — Fosberg Fire Weather Index computed on the
Open-Meteo current-conditions path (non-US via `auto`, anywhere via explicit
`source: "openmeteo"`), dryness context (soil moisture, VPD) as secondary
lines, prefs→fixed-unit normalization (`knotsToMph` added), fire-flag-keyed
request/cache extension, D5/D6 honest-framing renderer, schema/description
updates, and the testing + documentation checklists.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Global Haines via Open-Meteo pressure levels | Design non-goal — second request shape + verification burden; record as a 💡 idea row in T7. |
| METAR-path Fosberg | Design non-goal — one render path per release; `metar-handler.test.ts`'s asserted note substring (`:617`) stays untouched. Record as a 💡 idea row in T7. |
| US NOAA path changes, incl. generalizing `getFireWeatherContext` | Design non-goal — byte-for-byte unchanged; the global path never calls it (D5); `tests/unit/fireWeatherContext.test.ts` passes unedited. |
| Forecast/hourly fire weather | Design non-goal — current conditions only, like the NOAA path today. |
| Version bump to the release number | Release step, not a task (project convention). |

## Findings that shape the graph

Spot-checks against the code, reconciled into the tasks below:

- **The design's prefs field names are shorthand.** `UnitPreferences` uses
  `prefs.temperature` (`'F' | 'C'`) and `prefs.windSpeed`
  (`'mph' | 'kmh' | 'ms' | 'kn'`) — see `src/config/units.ts:32-33` — not
  `temperatureUnit`/`windSpeedUnit`. T4's normalization helper switches on
  those.
- **No handler-boundary signature change is needed.**
  `formatOpenMeteoCurrentConditions` (`currentConditionsHandler.ts:654`)
  already receives `includeFireWeather` and `prefs` from both call sites
  (`:188`, `:202`). The change is (a) passing the flag into
  `openMeteoService.getCurrentConditions(latitude, longitude, prefs)` at
  `:668` and (b) replacing the stub at `:766-769`.
- **`OpenMeteoService.getCurrentConditions` gains an optional trailing flag**
  (default `false`), so every existing caller compiles and behaves
  unchanged — the optional-trailing-parameter precedent from wildfire A2.
  `buildCurrentParams` is at `:719`, the cache-key block at `:693-704`.
- **The stub-asserting test to replace** is exactly
  `tests/unit/current-conditions-global.test.ts:478-492` — it asserts the
  US-only sentence verbatim plus three no-NOAA-call assertions
  (`getGridpointDataByCoordinates`, `getCurrentConditions`, `getStations` not
  called). The replacement keeps all three negative assertions.
- **The METAR path converts knots → m/s → caller unit**
  (`currentConditionsHandler.ts:79`, `:1023`) — the new `knotsToMph` in
  `units.ts` (design D4) is additive and collides with nothing.
- **The NOAA fire block's emoji convention** (`:517-560`) is
  Low → 🟢, Moderate → 🟡, High → 🟠, else 🔴, keyed on the category `level` —
  the Fosberg line mirrors it.
- **CHANGELOG `[Unreleased]` already holds the global-wildfire entry** (this
  branch forks off `feat/global-wildfire`) — T7 appends the fire-weather
  entry beneath it; both ship in the same release.
- **The planning-index row is already 📝, not 💡**: "Global fire weather
  indices (computed Fosberg FFWI outside US)" at `docs/planning/README.md:40`,
  pointing at the design. T7 flips it 📝 → ✅ and moves the link to
  `docs/plans/`. ICR: the stale Phase 5 item 3 wording at
  `INTERNATIONAL_COVERAGE_ROADMAP.md:102` ("run the existing fireWeather.ts
  formulas" — the corrected premise) gets marked shipped with a
  corrected-premise note; the Phase 5 live-verification note is at `:186-190`.
- **Schema targets confirmed**: `include_fire_weather` description at
  `src/index.ts:356-359` (currently "…default: false, US only"), tool
  description at `:351` (currently promises only Haines/Grassland/Red-Flag).

## Task graph

### Phase 1 — Pure foundation (parallel-safe fan-out)

**T1 — Fosberg + dryness-context pure functions** (`sonnet`)

- Files: `src/utils/fireWeather.ts`, `tests/unit/fireWeather.test.ts`
  (**append only** — existing tests pass unedited)
- Append to the already-pure, zero-import module (keep it that way), per D2:
  - `calculateFosbergIndex(tempF, rhPercent, windMph): number` — EMC from the
    three-branch RH piecewise (RH < 10 / 10–50 / > 50), moisture damping
    `η = 1 − 2(m/30) + 1.5(m/30)² − 0.5(m/30)³` clamped ≥ 0,
    `FFWI = η · √(1 + U²) / 0.3002`, clamped 0–100. Doc comment cites
    Fosberg (1978) / NWS-WFAS documentation. **Any non-finite input returns
    `NaN`** (documented) — the caller (T4) checks `Number.isFinite` and
    renders the unavailable note; never NaN in output.
  - `getFosbergCategory(ffwi): { level, description, color }` — same shape as
    the existing category functions; bands `< 25` Low/Green, `25–39`
    Moderate/Yellow, `40–49` High/Orange, `≥ 50` Extreme/Red; doc comment
    discloses the banding as a project heuristic (published usage: ≥ 50 is
    significant fire weather).
  - `describeVpd(kPa)` (`< 1` low drying power, `1–2` moderate, `2–3` high,
    `> 3` extreme) and `describeTopsoilMoisture(m3m3)` (`< 0.1` very dry,
    `0.1–0.2` dry, `0.2–0.3` moist, `> 0.3` wet) — pure, disclosed as
    heuristic in doc comments.
- Tests (design §Testing): FFWI against **hand-verified vectors derived from
  the published formula** — at least one per EMC branch, each with the
  expected value computed by hand in a comment; clamping at 0 and 100; the η
  floor at high EMC (high RH / low wind → ~0, renders Low — correct, not a
  failure); band boundaries 24/25, 39/40, 49/50; VPD and soil-moisture band
  edges; non-finite inputs → NaN.
- Acceptance: full gate green; existing `fireWeather.test.ts` and
  `fireWeatherContext.test.ts` blocks unedited. The orchestrator
  independently hand-checks one mid-range vector against the formula before
  committing.
- Commit: `feat: Add Fosberg Fire Weather Index and dryness-context helpers`
- Depends on: — · **parallel-safe with T2, T3** (disjoint files)

**T2 — `knotsToMph`** (`haiku`)

- Files: `src/utils/units.ts`, `tests/unit/units.test.ts` (append)
- Add `knotsToMph(knots: number): number` with the standard 1.15078 factor,
  doc-commented like its neighbors (`celsiusToFahrenheit:20`, `mpsToMph:27`,
  `kphToMph:34`). Append unit tests (0, a known round-trip value, negative
  passthrough).
- Acceptance: full gate green; no behavior change anywhere (nothing consumes
  it yet).
- Commit: `feat: Add knotsToMph unit conversion`
- Depends on: — · **parallel-safe with T1, T3** (disjoint files)

**T3 — Fire-weather variables on the Open-Meteo current request** (`sonnet`)

- Files: `src/services/openmeteo.ts`, `src/types/openmeteo.ts`,
  `tests/unit/openmeteo-fire-variables.test.ts` (new; follow the
  per-instance-client-spy pattern noted in the wildfire T6 tracker — no
  module-level `vi.mock` if avoidable)
- Per D3:
  - `getCurrentConditions(latitude, longitude, prefs, includeFireWeather = false)`
    — optional trailing flag, existing callers unchanged.
  - `buildCurrentParams` takes the flag and appends
    `soil_moisture_0_to_1cm,vapour_pressure_deficit` to the `current=` list
    **only when true** — the no-flag request URL is byte-identical to today.
    The two variables are not affected by `openMeteoUnitParams` (always
    m³/m³ and kPa).
  - Cache key (`openmeteo-current`, `:694`) incorporates the flag so a cached
    non-fire response is never served to a fire-weather request (and vice
    versa is fine but keep the keys simply distinct).
  - Types: extend `OpenMeteoCurrentWeather` (`src/types/openmeteo.ts:273-291`)
    with `soil_moisture_0_to_1cm?: number | null` and
    `vapour_pressure_deficit?: number | null` (open ocean returns HTTP 200
    with nulls — the Flood-API precedent), plus the matching optional entries
    in `OpenMeteoCurrentWeatherUnits`.
- Acceptance: full gate green. Tests: no-flag call sends exactly today's
  `current` variable list (assert the string, not just absence); flag call
  appends exactly the two variables; two calls differing only in the flag
  produce two HTTP requests (distinct cache entries); flag call with a cached
  no-flag entry still fetches.
- Commit: `feat: Fetch soil moisture and VPD for fire-weather requests`
- Depends on: — · **parallel-safe with T1, T2** (disjoint files)

### Phase 2 — Handler rendering

**T4 — Fosberg rendering on the Open-Meteo path** (`opus`)

- Files: `src/handlers/currentConditionsHandler.ts`,
  `tests/unit/current-conditions-global.test.ts`
- Per D4/D5:
  - Pass `includeFireWeather` into the service call at `:668`.
  - Prefs→fixed normalization helper (small, pure, in the handler): switch on
    `prefs.temperature` (`C` → `celsiusToFahrenheit`) and `prefs.windSpeed`
    (`kmh` → `kphToMph`, `ms` → `mpsToMph`, `kn` → `knotsToMph`, `mph` →
    identity). **No second fixed-unit fetch.** Sustained `wind_speed_10m`
    feeds the index; gusts are display context only (already rendered
    elsewhere — don't repeat inputs in the section, per D5).
  - Replace the stub (`:766-769`) with the D5 section: `## Fire Weather`,
    the `**{emoji} Fosberg Fire Weather Index:** N (Level)` line using the
    NOAA block's emoji convention (Low 🟢 / Moderate 🟡 / High 🟠 / Extreme 🔴),
    the computed-from sentence, the `**Dryness context:**` block (VPD in kPa
    with `describeVpd`, topsoil moisture in m³/m³ with
    `describeTopsoilMoisture`), and the italic derivation disclosure
    (D6 — "*Derived by this server from Open-Meteo model data — not an
    official fire-danger rating. Heed warnings from your national fire
    authority.*").
  - Null handling: either dryness value null/undefined → omit that line;
    both → omit the whole `**Dryness context:**` block; any core input
    (temp/RH/wind) missing or `calculateFosbergIndex` → non-finite →
    `⚠️ Fire weather inputs unavailable for this location.` — no NaN, no
    throw. High-RH/low-wind ~0 renders as Low (correct, not suppressed).
  - **Never call `getFireWeatherContext`** on this path; existing Open-Meteo
    footer/attribution unchanged.
- Tests: **replace** the stub-asserting test (`:478-492`) with: non-US +
  `include_fire_weather` renders the Fosberg section **and keeps all three
  no-NOAA-call negative assertions**; null-dryness omission (one null → line
  omitted, both null → block omitted, index still renders); unavailable-note
  path (core input missing); unit-invariance (same fake response values
  expressed in metric prefs produce the same index number as imperial —
  normalization is pure).
- Acceptance: full gate green; `tests/unit/fireWeatherContext.test.ts` and
  `tests/unit/metar-handler.test.ts` pass **unedited**; every existing
  no-flag test in `current-conditions-global.test.ts` passes unedited (the
  default-output byte-identical lock).
- Commit: `feat: Compute Fosberg fire weather on the Open-Meteo path`
- Depends on: T1, T2, T3

### Phase 3 — Registration + tests

**T5 — Schema and tool-description updates** (`haiku`)

- Files: `src/index.ts`
- Per D7: `include_fire_weather` description (`:356-359`) drops "US only" →
  "US locations get NOAA fire-weather indices (Haines, grassland, red-flag);
  elsewhere a computed Fosberg Fire Weather Index with dryness context.
  (default: false)". Tool description (`:351`) updates its fire-weather
  sentence to match. No other schema change; `required: []` and
  `LOCATION_SCHEMA_PROPERTIES` untouched.
- Acceptance: full gate green; diff touches only the two description strings.
- Commit: `feat: Describe global fire weather in the current-conditions schema`
- Depends on: T4 · **parallel-safe with T6** (disjoint files)

**T6 — Integration coverage: mocked end-to-end + tolerant live smoke** (`sonnet`)

- Files: `tests/integration/global-fire-weather.test.ts` (new)
- Two blocks (the wildfire T6 template):
  1. Mocked HTTP through the real service + handler end to end — a realistic
     Open-Meteo current response including the two new variables → the
     Fosberg section renders with a value in the expected band, dryness
     lines, and the derivation disclosure; a nulls-variant (ocean-like) →
     dryness omitted, index still present.
  2. One **live smoke** on the keyless Open-Meteo path (e.g. Sydney with
     `include_fire_weather`), tolerant-of-flake convention: generous timeout,
     assert shape/section presence not values, never fail on a network
     error. **This adds a file to the live-network set** — say so in the
     file header (`almanac.test.ts` header as template).
- Acceptance: mocked block deterministic; live block tolerant; full gate
  green (re-run once if only live files are red).
- Commit: `test: Add global fire weather integration coverage`
- Depends on: T4 · **parallel-safe with T5** (disjoint files)

### Phase 4 — Verification and docs

**T7 — Byte-identical sweep + documentation/registration checklist** (`opus`)

- Files: `CHANGELOG.md`, `README.md`, `docs/TOOLS.md`, `CLAUDE.md`,
  `docs/planning/README.md`,
  `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`,
  `docs/global-fire-weather-plan.md` (status + move),
  this file (move)
- **Sweep against the built dist**, run by the orchestrator personally
  (record the branch-base SHA — the `feat/global-wildfire` tip — at kickoff;
  dist drivers need `process.exit(0)`, no parallel live drivers):
  1. Default no-flag request (one US point, one non-US point) →
     **byte-identical** to the branch base.
  2. US point + `include_fire_weather` (auto → NOAA) → **byte-identical** to
     the branch base.
  3. Milan or Sydney + `include_fire_weather` → Fosberg section with index,
     category, dryness context, and the derivation disclosure.
  4. Reykjavik + `include_fire_weather` → low FFWI renders as Low (not
     suppressed — design edge case).
  5. US point + `source: "openmeteo"` + `include_fire_weather` → Fosberg
     renders (model path works anywhere — rivers/FIRMS precedent).
  6. Same non-US point queried with `units: "metric"` and imperial → the
     index number is identical (normalization check).
  7. METAR source + `include_fire_weather` → the existing "not available on
     the METAR source" note, unchanged.
  8. Mid-ocean point + `include_fire_weather` → dryness lines omitted (index
     or unavailable note per what the API returns — either is per design;
     record which).
- Docs, per the design's checklist:
  - CHANGELOG under `[Unreleased]`, appended beneath the global-wildfire
    entry (no version bump).
  - README: feature/limitations tables — fire weather no longer US-only; the
    computed-not-official caveat; test-count badge.
  - `docs/TOOLS.md`: current-conditions section — both fire-weather modes
    (US: NOAA indices; elsewhere: computed Fosberg + dryness context).
  - CLAUDE.md: the two "fire weather indices are US-only" statements
    (~lines 90 and 579) and the v1.20.0 status blurb; note the METAR-path
    note is unchanged.
  - `docs/planning/README.md`: row `:40` 📝 → ✅ with the Shipped link;
    Shipped-table row; two new 💡 rows for the descoped ideas (global Haines
    via pressure levels, METAR-path Fosberg). ICR: Phase 5 item 3 (`:102`)
    marked shipped with the corrected-premise note (no formulas existed —
    Fosberg computed in-house from current values).
  - Fill the design plan's implementation notes, mark it `IMPLEMENTED`, then
    **move the plan set (design plan + this file) to `docs/plans/`**,
    updating references (incl. the planning-README link).
- Acceptance: the sweep recorded in this file (tracker section) or the commit
  message; full gate green; every box of the design's checklist satisfied.
- Commit: `docs: Record global fire weather indices (Fosberg FFWI)`
- Depends on: T5, T6

## Assumptions to confirm before `/run-plan`

- **A1 — branch base.** `feat/global-wildfire` is unmerged, so
  `feat/global-fire-weather` forks off it and both ride the v1.20.0-line
  release; the CHANGELOG `[Unreleased]` section is shared. If wildfire merges
  first, rebase/fork off `main` instead (design header covers both).
- **A2 — prefs field names.** Normalization switches on `prefs.temperature`
  and `prefs.windSpeed` (the actual `UnitPreferences` fields), not the
  design's `temperatureUnit`/`windSpeedUnit` shorthand.
- **A3 — non-finite sentinel.** `calculateFosbergIndex` returns `NaN` for any
  non-finite input; the handler checks `Number.isFinite` and renders the
  unavailable note. NaN never reaches output.
- **A4 — nullable types.** The two new `OpenMeteoCurrentWeather` fields are
  `?: number | null` (open ocean: HTTP 200 with nulls — Flood-API precedent).
- **A5 — optional trailing flag.** `getCurrentConditions` gains
  `includeFireWeather = false` as an optional trailing parameter so every
  existing caller (handler fallback paths, summary) compiles and behaves
  unchanged.
- **A6 — banding is heuristic and disclosed.** The Fosberg category bands and
  the VPD/soil-moisture bands are project choices, disclosed in doc comments
  (and the output discloses derivation per D6); they are not agency scales.
- **A7 — version bump.** Stays a release step, not a task.

## Progress Tracker

- [ ] T1 — Fosberg + dryness-context pure functions (`sonnet`)
- [ ] T2 — `knotsToMph` (`haiku`)
- [ ] T3 — Fire-weather variables on the Open-Meteo current request (`sonnet`)
- [ ] T4 — Fosberg rendering on the Open-Meteo path (`opus`)
- [ ] T5 — Schema and tool-description updates (`haiku`)
- [ ] T6 — Integration coverage: mocked end-to-end + tolerant live smoke (`sonnet`)
- [ ] T7 — Byte-identical sweep + documentation checklist (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the T7 sweep is
demonstrably met against the built dist (no-flag and US-flag requests
byte-identical to the branch base, Milan/Sydney Fosberg section, Reykjavik
Low, US `source: "openmeteo"` Fosberg, metric/imperial index invariance,
METAR note unchanged, ocean dryness omission), the locked test files
(`fireWeatherContext.test.ts`, `metar-handler.test.ts`, NOAA-path fire
rendering) pass unedited, and `docs/global-fire-weather-plan.md` is marked
`IMPLEMENTED` with the plan set moved to `docs/plans/`. Opening the PR is the
human's call.
