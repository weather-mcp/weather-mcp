# Heat/Cold Stress Indices (WBGT + Frostbite Time-to-Onset) — Implementation Plan

**Status:** READY (2026-08-18)

Execution plan for `docs/heat-cold-stress-plan.md` (the WHAT/WHY); rules live in
`docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/heat-cold-stress-implementation-plan.md
```

Or, equivalently: read `docs/heat-cold-stress-plan.md` (design),
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
**live network calls** and flake independently (the standing flaky-tests
caveat). If the gate goes red only in those files, re-run before suspecting
the diff. This feature adds **no** new live-network test file.

**Live-verification rule:** the design header records the 2026-08-18 upstream
probe (Vostok: complete non-null temp/RH/wind at −70.3 °F → computed WCI
≈ −114 °F; Ushuaia complete at a milder point) — no new API variables are
requested anywhere in this feature, so nothing upstream needs re-proving.
What can only be trusted against the built dist is the **moderate-weather
byte-identity guarantee** and the T5 sweep — the orchestrator runs that sweep
personally; a subagent's claim is never the gate. Standing driver caveats:
dist drivers need `process.exit(0)`; don't run live drivers in parallel; run
keyless before/after probes back-to-back (feed-drift lesson).

## Scope & branch

**Branch:** `feat/heat-cold-stress`, created off `main` (base `8e5af48`,
v1.23.0). Target release: next minor (v1.24.0 line; version settled at
release time).

**Working-tree note:** the settled design plan
(`docs/heat-cold-stress-plan.md`, untracked) and its planning-index row
(`docs/planning/README.md`, modified) are uncommitted as of plan-writing.
The branch's first commit — before T1 — is
`docs: Add heat/cold stress design and implementation plans`, capturing the
design plan, the planning-row edit, and this file. The green baseline is
established on that commit.

In scope: the design's D1–D8 — a new pure module `src/utils/thermalStress.ts`
(NA Wind Chill Index, Environment-Canada-banded frostbite time-to-onset, ABM
simplified WBGT, flag-condition exertion bands), config display gates,
automatic gated rendering on the NOAA and Open-Meteo current-conditions
paths (and therefore `get_weather_summary`'s current section, which renders
through the same formatters), the tool-description half-sentence, and the
testing + documentation checklists. **Zero service changes, zero new request
variables, zero cache-key changes** — every input is already fetched on
every path.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| METAR-path thermal stress | Design non-goal — one render path per release (Fosberg-on-METAR precedent). `metar-handler.test.ts` stays unedited as the lock. Record as a 💡 idea row in T5. |
| Forecast-path thermal stress (per-day WBGT/frostbite on `get_forecast`) | Design non-goal — current conditions only, exactly like fire weather. Record as a 💡 idea row in T5. |
| Full Liljegren WBGT | Design non-goal — needs solar radiation + iterative solve; the simplified ABM estimate is the disclosed heuristic. Revisit only on user demand. |
| Mold spores / other FE §6 items | Not part of this planning row. |
| New tool or `include_*` parameter | Rejected by design principle 1 — automatic gated enhancement; the `get_current_conditions` inputSchema is untouched. |
| Version bump to the release number | Release step, not a task (project convention). |

## Findings that shape the graph

Spot-checks against the code (2026-08-18), reconciled into the tasks below:

- **Insertion points confirmed.** NOAA path: the temperature/feels-like block
  is `currentConditionsHandler.ts:357-377` (heat index `:362-368`, wind chill
  `:370-376`); the 24-Hour Range block starts at `:380` — the new lines go
  between them. Open-Meteo path: temperature/feels-like is `:784-794`,
  Today's Range starts at `:797` — same slot. RH is available before the
  render point on both paths (`props.relativeHumidity.value`;
  `current.relative_humidity_2m`), as is wind
  (`props.windSpeed` QuantitativeValue; `current.wind_speed_10m`).
- **NOAA wind arrives as a QuantitativeValue** whose mph conversion is the
  existing inline pattern (`unitCode.includes('km_h')` → ×0.621371, else m/s
  → ×2.23694, `:399-404`). The frostbite computation needs that mph value
  *before* the wind section renders — compute it locally in the new block;
  don't restructure the wind section.
- **The Open-Meteo normalization helpers the design cites exist as
  described**: `prefsTempToFahrenheit` (`:657`) and `prefsWindToMph` (`:662`),
  switching on `prefs.temperature` / `prefs.windSpeed`. Reuse, don't invent
  (design D3).
- **`units.ts` has no `fahrenheitToCelsius`.** The computed °F wind chill /
  WBGT must display in the caller's unit (design D5), and only
  `celsiusToFahrenheit` exists (`src/utils/units.ts:20`). T2 adds the inverse
  as a mechanical additive helper (the fire-weather `knotsToMph` precedent).
- **Published-`windChill` case:** the NOAA path already computes
  `convertToFahrenheit(props.windChill.value, …)` at `:371` for the
  `Feels Like (Wind Chill)` line; the frostbite band reuses that °F value as
  the effective wind chill (D4 — displayed value and band basis must match).
  At ≤ −18 °F effective, the existing display gate (`tempF < 50` and
  `windChillF < tempF`) always fires too, so line adjacency holds.
- **Gate comparison nuance:** the existing heat-index *display* gate is
  strict (`tempF > showHeatIndex`, `:364`); design D6 says the WBGT
  computation gate is **at or above** `showHeatIndex`. The two gates are
  independent — at exactly 80.0 °F a WBGT line could render without a
  heat-index line above it. Per design text; see A4.
- **The moderate-fixture byte-identity claim checks out**: the Open-Meteo
  formatter fixture in `tests/unit/openmeteo-current.test.ts` sits at
  58.3 °F; `current-conditions-global.test.ts` and `noaa-staleness.test.ts`
  fixtures are all moderate (e.g. 20 °C / 10 km/h). Neither gate fires, so
  every existing test passes unedited — that *is* the lock (design D1).
- **NOAA-path handler-test harness to model on:**
  `tests/unit/noaa-staleness.test.ts` drives `handleGetCurrentConditions`
  with plain fake services (no HTTP) and fixture builders
  (`buildObservation`/`buildStations`); its header says fixtures follow
  `current-conditions-global.test.ts`. T3's new NOAA-path cases follow the
  same pattern in a **new** file rather than appending to the staleness
  file (which is scoped to F2/D2a–c).
- **Registration target confirmed:** the `get_current_conditions` tool
  description is `src/index.ts:378`. No inputSchema change (design D8).
- **Docs targets confirmed:** planning-index row at
  `docs/planning/README.md:87` (📝, already pointing at the design); FE §6.2
  at `docs/planning/FUTURE_ENHANCEMENTS.md:410` (gets the §6.1-style
  resolution banner).
- **Sentinel convention differs from Fosberg:** D2 specifies the pure
  functions return **`null`** on non-finite/out-of-domain input (not
  Fosberg's `NaN`). The handler checks `null`; never NaN in output.

## Task graph

### Phase 1 — Pure foundation (parallel-safe fan-out)

**T1 — Thermal-stress pure module** (`sonnet`)

- Files: `src/utils/thermalStress.ts` (new),
  `tests/unit/thermalStress.test.ts` (new)
- New module, **pure with zero imports** (the `fireWeather.ts` /
  `modelComparison.ts` discipline). Four functions per design D2:
  - `calculateWindChillF(tempF, windMph): number | null` — NA Wind Chill
    Index (NWS/EC joint 2001 model, Osczevski & Bluestein):
    `WC = 35.74 + 0.6215·T − 35.75·V^0.16 + 0.4275·T·V^0.16`. Validity
    domain `T ≤ 50 °F` and `V ≥ 3 mph`; outside it, or on any non-finite
    input, return `null`. Doc comment cites the model.
  - `getFrostbiteRisk(windChillF): { level, timeToFrostbite, description } | null`
    — bands adapted from Environment Canada's wind chill program (published
    in °C; °F equivalents), disclosed as a project heuristic in the doc
    comment. `> −18` → `null`; ≤ −18 High "10–30 minutes"; ≤ −40 Very High
    "5–10 minutes"; ≤ −54 Severe "2–5 minutes"; ≤ −67 Extreme
    "under 2 minutes".
  - `calculateSimplifiedWbgtF(tempF, rhPercent): number | null` — ABM
    simplified WBGT: °F→°C, `e = (rh/100)·6.105·exp(17.27·T/(237.7+T))`
    (hPa), `WBGT(°C) = 0.567·T + 0.393·e + 3.94`, °C→°F. `null` on
    non-finite input. Doc comment states the model's published assumption:
    moderately high radiation and light wind — a full-sun outdoor estimate
    that can overestimate in shade/overcast.
  - `getWbgtCategory(wbgtF): { level, description } | null` — flag-condition
    bands, disclosed as a project heuristic (acclimatization shifts them):
    `< 80` → `null`; 80–84 Elevated; 85–87 High; 88–89 Very High; ≥ 90
    Extreme.
  - Category functions are documented as taking the **rounded** display
    value (the caller's contract, per the v1.20.0 fire-weather lesson —
    shown number and band must never disagree at an edge).
- Tests (design §Testing): `calculateWindChillF` against ≥ 3 hand-verified
  NWS-chart vectors spanning the chart (e.g., 5 °F @ 30 mph → −19 °F), each
  with the expected value computed by hand in a comment; domain nulls
  (T > 50 °F, V < 3 mph) and non-finite inputs. `getFrostbiteRisk` band
  edges both sides of −18/−40/−54/−67. `calculateSimplifiedWbgtF` against
  hand-computed ABM vectors (35 °C @ 50 % RH → ≈ 34.8 °C / 94.6 °F).
  `getWbgtCategory` edges both sides of 80/85/88/90. All four with
  non-finite inputs → `null`.
- Acceptance: full gate green; new module has zero imports; the
  orchestrator independently hand-checks one wind-chill vector against the
  published NWS chart and one WBGT vector against the ABM formula before
  committing.
- Commit: `feat: Add wind-chill, frostbite-risk, and WBGT pure helpers`
- Depends on: — · **parallel-safe with T2** (disjoint files)

**T2 — Display gates + `fahrenheitToCelsius`** (`haiku`)

- Files: `src/config/displayThresholds.ts`, `src/utils/units.ts`,
  `tests/unit/units.test.ts` (append only)
- Per design D6, add to `DisplayThresholds`:

  ```typescript
  thermalStress: {
    /** Render the frostbite line when effective wind chill (°F) is at or below this */
    showFrostbiteAtWindChillF: -18,
    /** Compute/render WBGT only when air temp (°F) is at or above showHeatIndex and rounded WBGT (°F) is at or above this */
    showWbgtF: 80,
  },
  ```

  Band boundaries stay in the pure module (T1); these are display gates,
  consistent with the file's existing role.
- Add `fahrenheitToCelsius(f: number): number` to `src/utils/units.ts`,
  doc-commented like its neighbor `celsiusToFahrenheit` (`:20`); append unit
  tests (32 → 0, a round-trip against `celsiusToFahrenheit`, negative
  passthrough).
- Acceptance: full gate green; no behavior change anywhere (nothing
  consumes either addition yet); existing `units.test.ts` cases unedited.
- Commit: `feat: Add thermal-stress display gates and fahrenheitToCelsius`
- Depends on: — · **parallel-safe with T1** (disjoint files)

### Phase 2 — Handler rendering

**T3 — Frostbite + WBGT lines on both current-conditions paths** (`opus`)

- Files: `src/handlers/currentConditionsHandler.ts`,
  `tests/unit/current-conditions-global.test.ts` (**append only**),
  `tests/unit/thermal-stress-handler.test.ts` (new — NOAA-path cases,
  modeled on the `noaa-staleness.test.ts` fake-service harness)
- Per design D4/D5, both lines sit directly after the temperature/feels-like
  block, before the 24-Hour Range / Today's Range line (NOAA: between `:377`
  and `:380`; Open-Meteo: between `:794` and `:797`).
- **Effective wind chill (D4):**
  - NOAA path: when `props.windChill` is present, its `convertToFahrenheit`
    value (already computed at `:371`) is the effective wind chill — the
    band must match the displayed `Feels Like (Wind Chill)` number. When
    absent but temp + wind present, compute via `calculateWindChillF` from
    `tempF` and the inline-converted mph (the `:399-404` pattern, computed
    locally in the new block).
  - Open-Meteo path: always compute via `calculateWindChillF` from
    `prefsTempToFahrenheit(current.temperature_2m)` +
    `prefsWindToMph(current.wind_speed_10m)`. **Never band off
    `apparent_temperature`** (Steadman model — different claim).
  - Calm-air carve-out: below 3 mph (`calculateWindChillF` → `null`), the
    *handler* substitutes the air temperature itself as the effective
    value — −50 °F air freezes skin regardless of wind. The pure function
    stays faithful to the published domain.
- **Cold rendering** (gate: effective wind chill ≤
  `DisplayThresholds.thermalStress.showFrostbiteAtWindChillF`): one
  `🥶 **Frostbite risk (<level>):** …` line per design D5 — "exposed skin
  can freeze in <time>" + "Cover all skin and limit time outdoors." When the
  band's basis is not already on screen as `Feels Like (Wind Chill)` (the
  Open-Meteo path always; the NOAA computed/carve-out cases — see A2), the
  line echoes the effective value converted to the caller's unit
  (`fahrenheitToCelsius` for °C prefs).
- **Heat rendering** (gate: air temp °F ≥
  `DisplayThresholds.temperature.showHeatIndex` **and** rounded WBGT °F ≥
  `DisplayThresholds.thermalStress.showWbgtF`): one
  `🥵 **Heat stress (<level>):** estimated WBGT <value> — <action>.` line
  with the **mandatory** italic caveat: `*Estimated from temperature and
  humidity assuming full sun; thresholds vary with acclimatization.*`
  WBGT computed from °F temp + RH (`props.relativeHumidity.value` /
  `current.relative_humidity_2m`); band from the **rounded** °F value;
  displayed value in the caller's unit.
- **Omission discipline:** missing RH → no WBGT line; effective wind chill
  above the gate → no frostbite line; `null` from any pure function → line
  omitted. **Never** a `⚠️ unavailable` note (garnish, not contract), never
  NaN in output. The two gates are mutually exclusive by construction.
- Tests:
  - Append to `current-conditions-global.test.ts` (Open-Meteo formatter
    harness): cold fixture (e.g. −21 °F, 25 mph) renders the frostbite line
    with the correct band and echoed wind chill; calm-air carve-out
    (< 3 mph, ≤ −18 °F air) renders; cold-but-mild (wind chill > −18 °F)
    does not; hot-humid fixture renders the WBGT line + caveat; hot-dry
    (WBGT rounds < 80) does not; RH-missing hot fixture renders no line and
    no note; metric-prefs fixture produces the same band as imperial
    (fixed-°F computation); a boundary case on each side of −18 and 80.
  - New `thermal-stress-handler.test.ts` (NOAA path, fake services):
    published-`windChill` fixture drives band and display from the station
    value; `windChill`-absent cold fixture uses the computed WCI; calm-air
    carve-out; hot-humid fixture renders WBGT; moderate fixture renders
    neither line.
  - **Never edit existing cases** — they are the moderate-weather
    byte-identity lock.
- Acceptance: full gate green; `metar-handler.test.ts`,
  `noaa-staleness.test.ts`, `openmeteo-current.test.ts`,
  `fireWeather.test.ts`, `fireWeatherContext.test.ts`, and every existing
  case in `current-conditions-global.test.ts` pass **unedited**.
- Commit: `feat: Render frostbite-risk and heat-stress (WBGT) context on current conditions`
- Depends on: T1, T2

### Phase 3 — Registration

**T4 — Tool-description half-sentence** (`haiku`)

- Files: `src/index.ts`
- Per design D1/D8: the `get_current_conditions` description string (`:378`)
  gains a half-sentence — e.g. append after the fire-weather sentence:
  "Automatically includes frostbite-risk and heat-stress (WBGT) context
  when conditions are extreme." **No inputSchema change** —
  `LOCATION_SCHEMA_PROPERTIES`, `include_fire_weather`, `required` all
  untouched.
- Acceptance: full gate green; diff touches only the one description
  string.
- Commit: `feat: Describe thermal-stress context in the current-conditions description`
- Depends on: T3

### Phase 4 — Verification and docs

**T5 — Byte-identical sweep + documentation/registration checklist** (`opus`)

- Files: `CHANGELOG.md`, `README.md`, `docs/TOOLS.md`, `CLAUDE.md`,
  `docs/planning/README.md`, `docs/planning/FUTURE_ENHANCEMENTS.md`,
  `docs/heat-cold-stress-plan.md` (implementation notes, status, move),
  this file (move)
- **Sweep against the built dist**, run by the orchestrator personally
  (branch base `8e5af48`; dist drivers need `process.exit(0)`; no parallel
  live drivers; keyless before/after probes back-to-back per the
  feed-drift lesson):
  1. Moderate US point (NOAA path) and moderate non-US point (Open-Meteo
     path), imperial **and** metric → **byte-identical** to the branch
     base (Milan is the design's named no-new-lines probe).
  2. Vostok or a high-Andes point via `source: "openmeteo"` (it is
     August — southern winter) → frostbite line, band consistent with the
     echoed wind chill.
  3. Kuwait City or another hot-humid point on the Open-Meteo path, and
     Phoenix (NOAA path, northern summer) → WBGT line with the italic
     caveat. (If Phoenix is hot-dry that day and WBGT rounds < 80, that is
     the hot-dry edge case rendering correctly — record it and pick a
     more humid US point for the positive case.)
  4. The extreme point queried metric and imperial → same band, values in
     the caller's unit.
  5. METAR source on any point → **byte-identical** (out of scope path).
  6. Record all results in the design plan's implementation notes.
- Docs, per the design's D8 checklist:
  - CHANGELOG under `[Unreleased]` (no version bump).
  - README features table + the computed-not-official caveat; test-count
    badge if it moved.
  - `docs/TOOLS.md` current-conditions section: both gates, both formulas'
    provenance (2001 NA WCI; EC frostbite bands; ABM simplified WBGT with
    the full-sun assumption).
  - CLAUDE.md: `get_current_conditions` feature-list line; status blurb at
    the top of §Project Status.
  - `docs/planning/README.md`: row `:87` 📝 → ✅ with the Shipped link;
    Shipped-table row; two new 💡 rows (METAR-path thermal stress —
    companion to the deferred METAR-path Fosberg; forecast-path thermal
    stress). FE §6.2 (`FUTURE_ENHANCEMENTS.md:410`) gets a resolution
    banner (the §6.1 pollen pattern) noting the shipped subset (WBGT +
    frostbite) and the descoped remainder.
  - Fill the design plan's implementation notes, mark it `IMPLEMENTED`,
    then **move the plan set (design plan + this file) to `docs/plans/`**,
    updating references (incl. the planning-README link).
- Acceptance: the sweep recorded in the design plan's implementation notes;
  full gate green; every box of the design's checklist satisfied.
- Commit: `docs: Record heat/cold stress indices (WBGT + frostbite time-to-onset)`
- Depends on: T4

## Assumptions to confirm before `/run-plan`

- **A1 — branch base and uncommitted docs.** Branch off `main` @ `8e5af48`.
  The design plan (untracked) and the planning-index row edit (modified) are
  committed as the branch's first `docs:` commit before T1; the green
  baseline is established there.
- **A2 — echo rule on the NOAA computed path.** The design's D5 example
  omits the echoed number only in the published-`windChill` case (where the
  `Feels Like (Wind Chill)` line above already shows the band's basis). When
  the NOAA path *computes* the WCI (station `windChill` absent) or uses the
  calm-air carve-out, no such line is on screen — this plan has the
  frostbite line echo the effective value there, same as the Open-Meteo
  variant, per D4's "the band's basis is always visible" principle. Flag if
  you'd rather keep the NOAA line echo-free in all cases.
- **A3 — `null` sentinel, not `NaN`.** D2 specifies `null` returns
  (differing from Fosberg's `NaN` convention); the handler checks `null`
  and omits. NaN never reaches output.
- **A4 — WBGT air-temp gate is `>=`.** D6 says "at or above
  `showHeatIndex`", while the existing heat-index *display* gate at `:364`
  is strict `>`. The gates stay independent; at exactly 80.0 °F a WBGT line
  can render without a heat-index line. Taken as designed.
- **A5 — calm-air carve-out lives in the handler.** `calculateWindChillF`
  returns `null` below 3 mph (faithful to the published domain); the
  handler substitutes air temperature as the effective value (D4).
- **A6 — bands are heuristics and disclosed.** EC-adapted frostbite bands
  and flag-condition WBGT bands are project choices, disclosed in doc
  comments; the heat line's in-output caveat (full sun; acclimatization) is
  mandatory (D5/D7).
- **A7 — version bump.** Stays a release step, not a task.

## Progress Tracker

- [ ] T1 — Thermal-stress pure module (`sonnet`)
- [ ] T2 — Display gates + `fahrenheitToCelsius` (`haiku`)
- [ ] T3 — Frostbite + WBGT lines on both current-conditions paths (`opus`)
- [ ] T4 — Tool-description half-sentence (`haiku`)
- [ ] T5 — Byte-identical sweep + documentation checklist (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the T5 sweep is
demonstrably met against the built dist (moderate US + non-US points
byte-identical to branch base `8e5af48` in imperial and metric, a southern-
winter frostbite line with a consistent band, a WBGT line with the italic
caveat on both paths, metric/imperial band invariance, METAR unchanged), the
locked test files (`metar-handler.test.ts`, `noaa-staleness.test.ts`,
`openmeteo-current.test.ts`, `fireWeather*.test.ts`, and every pre-existing
case in `current-conditions-global.test.ts`) pass unedited, and
`docs/heat-cold-stress-plan.md` is marked `IMPLEMENTED` with the plan set
moved to `docs/plans/`. Opening the PR is the human's call.
