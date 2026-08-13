# Worldwide Station Observations (METAR) — Implementation Plan

**Status:** READY (2026-08-13)

Execution plan for `docs/metar-plan.md` (the WHAT/WHY); rules live in
`docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/metar-implementation-plan.md
```

Or, equivalently: read `docs/metar-plan.md` (design),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — green baseline, one subagent per task, review the
diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass
npm audit         # no high/critical
```

**Gate caveat (standing):** four files under `tests/integration/` make **live
network calls** and flake independently — `visualization-lightning.test.ts`
(Blitzortung MQTT), `safety-hazards.test.ts` (live NOAA/USGS),
`global-rivers.test.ts` (live Flood API), and `almanac.test.ts` (live ACIS). If
the gate goes red only in those files, re-run before suspecting the diff. **T7
adds a fifth file in that category** (live aviationweather.gov) and must follow
the same tolerant-of-flake convention.

**Live-verification rule:** the design's field survey was taken from a single
live sweep on 2026-08-13, and the endpoint is *demonstrably flaky* (a sustained
burst returned HTML 502 from the Azure gateway). At T5 and T8 the orchestrator
must drive the **built dist against the live API** for the design's five
acceptance points — a US point, a non-US point, mid-ocean, unchanged `auto`
output, and both unit systems. Do not accept a subagent's claim that live
verification passed; run it yourself.

## Scope & branch

**Branch:** `feat/metar`. Target release: **v1.17.0**.

✅ **Base-commit decision (Assumption A1) — RESOLVED 2026-08-13:** `feat/almanac`
was merged to `main` via PR #53 (merge commit `8c323d8`) and `feat/metar` was cut
from the updated `main`. The collision risk below does not apply; CHANGELOG
`[Unreleased]` on this branch still carries the unreleased global-rivers
(v1.15.0) and almanac (v1.16.0) content, and T8 appends METAR beneath it.

Original text:

⚠️ **Base-commit decision (Assumption A1):** `feat/almanac` (v1.16.0) is
complete but **unmerged and unreleased**, and CHANGELOG `[Unreleased]` currently
holds *both* the global-rivers (v1.15.0) and almanac (v1.16.0) content. Cut
`feat/metar` from `main` **after** almanac merges (recommended). If METAR must
start sooner, stack on `feat/almanac` and say so — T8's docs edits (CHANGELOG,
README, CLAUDE.md, `docs/planning/README.md`) collide otherwise, and T2 touches
`src/utils/units.ts`, which almanac also modified.

In scope: the design plan's D1–D6 — the `AviationWeatherService`, the METAR
types, the pure station picker and parsing helpers, `source: 'metar'` on
`get_current_conditions`, the D5 output format with its caveat lines, the D6
unit conversions, plus the testing and documentation checklists.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| TAF (terminal aerodrome forecasts) | D7 — `get_current_conditions` is an observation tool; the endpoint is verified and stays available for a forecast-side idea. |
| A `get_metar` / dedicated aviation tool | D7 — design principle #1 (parameters over proliferation). The raw METAR already ships in the output. |
| `get_weather_summary` pass-through | D7 — the summary stays lean, per the almanac precedent (D3 there). |
| `include_fire_weather` on the METAR path | D7 — needs NOAA gridpoint inputs (transport wind, Haines). Renders a one-line "unavailable on this source" note instead. **This note IS in scope**; the indices are not. |
| Auto-routing `auto` → METAR outside the US | D1 — explicitly unchanged in v1; revisit on feedback. |
| METAR as the NOAA border-overrun fallback (Toronto/Vancouver → CYYZ/CYVR) | D1 — documented follow-up, not v1. |
| `aviationweather.gov` in `check_service_status` | Not in the design's registration checklist (A5). Note it as a follow-up; do not add. |

## Findings that shape the graph

Spot-checks against the code, reconciled into the tasks below:

- **`ApiError`'s service union is a closed literal, repeated six times** in
  `src/errors/ApiError.ts` (`'NOAA' | 'OpenMeteo' | 'NCEI' | 'RainViewer' |
  'Nominatim'`, at `:10`, `:18`, `:60`, `:99`, `:143`, `:167`). D2 requires
  mapping an HTML 502 to `ServiceUnavailableError`, which **does not compile**
  until the union admits the new service. This is a mechanical consequence of an
  in-scope change, not new scope (playbook §Task rules) — T1 does it first, and
  extracts a named `ApiServiceName` alias so the seventh service is a one-line
  edit. Note that ACIS and NIFC dodged this by throwing plain `Error`s; METAR
  cannot, because a user who explicitly asked for `source: 'metar'` deserves the
  sanitized service-level error contract.
- **`bearingDegrees` is private** (`src/utils/riverDischarge.ts:227`) and
  **`compassPoint` is exported** (`:242`) — and
  `tests/unit/river-discharge.test.ts:11` imports `compassPoint` **from
  `riverDischarge.js`**. D3's move to `distance.ts` therefore breaks that import
  unless the test is updated in the same commit (T2). Do **not** leave a
  re-export shim in `riverDischarge.ts`; update the test import.
- **`compassPoint` is 8-point** (`N/NE/E/SE/S/SW/W/NW`), but D5's sample output
  reads `12 mi SSW` — 16-point. See Assumption **A2**: use the new 16-point
  helper for the station bearing and leave the rivers path on 8-point
  (no behaviour change there).
- **`formatWindDirection` (`src/utils/units.ts:147`) already contains the
  16-point table** and takes a `QuantitativeValue`. D4's
  `windDirectionFromDegrees(deg)` extracts that table verbatim; the delegation
  is byte-identical (same array, same `Math.round(deg / 22.5) % 16`), so
  `tests/unit/units.test.ts` is the regression guard.
- **`getUserAgent()` (`src/utils/version.ts:26`) returns `weather-mcp/<version>`
  with no contact string.** D2 asks for "project + contact". See Assumption
  **A3**: build a METAR-local UA rather than changing the global one, which
  would alter every service's headers.
- **`handleGetCurrentConditions` already ends with an optional
  `acisService?`** (`currentConditionsHandler.ts:75–83`), and `tsconfig.json`
  has `include: ["src/**/*"]` — **tests are not type-checked by `npm run
  build`**, so `tests/unit/current-conditions-global.test.ts:193` and
  `src/handlers/weatherSummaryHandler.ts:138` call it positionally. Mitigation
  baked into T5: append `aviationWeatherService?` as the **last, optional**
  parameter (almanac's A6 precedent). Existing call sites keep working; a call
  with no service and `source: 'metar'` degrades to a clean error rather than a
  crash.
- **The D1 no-change guarantee already has a test suite.**
  `tests/unit/current-conditions-global.test.ts` (`:211` source routing, `:249`
  non-US never touches NOAA, `:264` Open-Meteo formatter, `:458`/`:478` the
  optional blocks) must pass **untouched** after T5. That file is the byte-level
  guard for "`auto` is unchanged"; if T5 needs to edit it, something is wrong —
  stop and ask.
- **`get_weather_summary` never passes `source`**, so it stays on `auto` and is
  unaffected by D1. Its only exposure is the positional call site above.
- **`CacheConfig.ttl` (`src/config/cache.ts:73–120`)** — `MINUTE`/`HOUR`/`DAY`
  constants at `:12–14`; add `metarObservations: 10 * MINUTE`.
  `tests/unit/config.test.ts:24–37` asserts individual keys, not an exhaustive
  snapshot, so a new key needs no test churn.
- **`src/services/acis.ts` is the closest service template** — axios instance
  with `CacheConfig.apiTimeoutMs`, a `Cache` member, a private `handleError`
  response interceptor, keyless. `src/services/noaa.ts:175–199` is the
  retry/backoff template (exponential backoff with jitter, recursive
  `makeRequest`). METAR needs **both**, plus two behaviours neither template
  has: a **204-is-success-with-zero-rows** branch (axios resolves 204 with
  `data: ''`; calling `.json()`-style parsing on it throws) and a
  **content-type guard on non-2xx** so an HTML body never reaches JSON parsing.
- **Unit converters all exist** in `src/utils/unitFormat.ts`:
  `formatTemperatureFromC` (`:147`), `convertWindFromMps` (`:101`),
  `convertPressureFromPa` (`:110`), `convertDistanceFromKm` (`:118`),
  `formatHeightFromFt` (`:185`), `formatElevationFromM` (`:177`). D6 is pure
  wiring — no new converters beyond D4's two pure helpers.
- **`docs/planning/README.md` rows to flip at T8**: `:42` (the METAR row, 📝) and
  `:65` (the aviation-tool row — partly superseded; the observation half closes,
  the pilot-facing half stays 💡).

## Task graph

### Phase 1 — Shared foundations

**T1 — Widen the `ApiError` service union for a new source** (`haiku`)

- Files: `src/errors/ApiError.ts`
- Extract the repeated literal into an exported
  `export type ApiServiceName = 'NOAA' | 'OpenMeteo' | 'NCEI' | 'RainViewer' |
  'Nominatim' | 'AviationWeather';` and use it at all six sites (`:10`, `:18`,
  `:60`, `:99`, `:143`, `:167`). Pure widening — no message text, no
  `formatErrorForUser` (`:223`) behaviour change.
- Acceptance: full gate green; `tests/unit/errors.test.ts` and
  `tests/unit/security.test.ts` pass **untouched**.
- Commit: `refactor: Extract ApiServiceName and add AviationWeather`
- Depends on: — · **parallel-safe with T2** (disjoint files)

**T2 — Move geometry to `distance.ts`; add compass + humidity helpers** (`sonnet`)

- Files: `src/utils/distance.ts`, `src/utils/riverDischarge.ts`,
  `src/utils/units.ts`, `tests/unit/river-discharge.test.ts`,
  `tests/unit/distance.test.ts`, `tests/unit/units.test.ts`
- Move `bearingDegrees` (currently private, `riverDischarge.ts:227`) and
  `compassPoint` (`:242`, with its `COMPASS_POINTS` table) into
  `src/utils/distance.ts` as exports; have `riverDischarge.ts` import them.
  **No re-export shim** — update the `compassPoint` import in
  `tests/unit/river-discharge.test.ts:11` to point at `distance.js`.
- Add to `src/utils/units.ts`:
  - `windDirectionFromDegrees(deg: number): string` — the 16-point table lifted
    verbatim from `formatWindDirection` (`:147`); have `formatWindDirection`
    delegate to it (null/undefined still yields `'Variable'`).
  - `relativeHumidityFromDewpoint(tempC: number, dewpC: number): number` —
    Magnus formula, returning whole percent clamped to 0–100.
- Acceptance: full gate green. **`tests/unit/river-discharge.test.ts` (incl. the
  `compassPoint` block at `:182–188`) and `tests/unit/units.test.ts` pass with
  no assertion changes** — that is D3 step 2's regression guard. New tests:
  `bearingDegrees` cardinal cases (N/E/S/W ±1°) and antipodal stability;
  `windDirectionFromDegrees` bucket boundaries (0/11.24/11.26/348.75/360);
  `relativeHumidityFromDewpoint` against known pairs (T=20 Td=20 → 100%;
  T=20 Td=10 → ≈53%; T=13 Td=13 → 100%) and the clamp when `dewp > temp`.
- Commit: `refactor: Move bearing and compass geometry into distance utils`
- Depends on: — · **parallel-safe with T1** (disjoint files)

### Phase 2 — METAR data layer

**T3 — METAR types, `AviationWeatherService`, cache TTL** (`sonnet`)

- Files: `src/types/aviationWeather.ts` (new),
  `src/services/aviationWeather.ts` (new), `src/config/cache.ts`,
  `tests/unit/metar-service.test.ts` (new)
- Types (D4): `MetarObservation` mirroring the verified field survey. Every
  field below 100% presence is optional. The two polymorphic fields get honest
  unions — `wdir?: number | string` and `visib?: number | string` — plus
  `clouds?: Array<{ cover: string; base?: number }>`. No `any`; `obsTime` is
  epoch **seconds** while `reportTime`/`receiptTime` are ISO strings, and the
  type comments must say so (this is the single easiest bug in the feature).
- Service (`AviationWeatherService`, modeled on `src/services/acis.ts` for
  shape and `src/services/noaa.ts:175–199` for retry):
  - `getMetarsInBoundingBox(bbox): Promise<MetarObservation[]>` against
    `https://aviationweather.gov/api/data/metar` with
    `bbox=minLat,minLon,maxLat,maxLon` and `format=json`.
  - **HTTP 204 → `[]`**, never parsed. Treat an empty/whitespace body the same
    way regardless of status code, since axios surfaces 204 as `data: ''`.
  - **Content-type guard on non-2xx**: an HTML body maps to
    `ServiceUnavailableError('AviationWeather', …)` with a sanitized message —
    never `JSON.parse` of gateway HTML.
  - Retry with exponential backoff + jitter on 502/503/504/network only. **204
    is a success with zero rows, never a retry trigger.**
  - Descriptive `User-Agent` per A3.
  - Cache keyed on the **rounded** bbox with
    `CacheConfig.ttl.metarObservations = 10 * MINUTE` (add to
    `src/config/cache.ts:73–120` with the design's rationale comment).
  - **Antimeridian**: clamp the bbox to ±180 and never emit an inverted box
    (`minLon > maxLon`); the picker's tier widening supplies the recovery.
- Acceptance: full gate green. New mocked-axios unit tests (template:
  `tests/unit/ncei.test.ts`) covering: a 200 with the captured multi-station
  shape; 204 → `[]` with no parse attempt; HTML 502 → `ServiceUnavailableError`
  with no raw HTML in the message; retry-then-succeed on 503; no retry on 204 or
  4xx; second identical call served from cache (one HTTP call); bbox clamping at
  the antimeridian and at the poles.
- Commit: `feat: Add aviationweather.gov METAR client`
- Depends on: T1 · **parallel-safe with T2** (disjoint files)

**T4 — Station picker and METAR parsing helpers** (`opus`)

- Files: `src/utils/metarStation.ts` (new), `tests/unit/metar-station.test.ts`
  (new), `tests/unit/metar-parsing.test.ts` (new)
- Pure module, no I/O, no caching — the picker is the design-sensitive piece
  (D3), the parsers are the honesty layer (D4).
- `pickNearestStation(stations, latitude, longitude, now): StationPick | null`:
  1. **Freshness** — prefer obs ≤ 90 min old; if none qualify, accept up to 6 h
     and set `stale: true`; anything older is not a station.
  2. **Distance** via `calculateDistance`, **bearing** via `bearingDegrees` +
     the 16-point renderer (A2), both from T2.
  3. **Banding** — ≤ 100 km normal, 100–250 km `far: true`, > 250 km → `null`.
  4. Returns the observation plus `distanceKm`, `bearing`, `stale`, `far`, and
     the search tier that found it.
  - The **tier widening itself (±0.5° → ±2.0° → ±5.0°) is the caller's loop** —
    the picker is pure and takes whatever stations it is given, so tests can
    drive tiers without HTTP. Export the tier ladder as a constant from this
    module so T5 iterates it rather than hardcoding degrees.
- Parsing helpers in the same module (D4, "beside the picker"):
  - `parseVisibilityMiles(v)` → `{ miles: number; qualifier?: 'plus' }` —
    `"10+"` (the majority case), fractions (`"1/2"`, `"1 1/2"`), plain numbers,
    and numeric input; unparseable → `undefined`.
  - `parseWindDirection(v)` → `number | 'variable'` — `"VRB"` → `'variable'`,
    numeric degrees pass through, anything else → `undefined`.
- Acceptance: full gate green; both new test files deterministic, pure, no
  mocks, well inside the < 2 s budget. `tests/unit/metar-station.test.ts`:
  nearest wins over a fresher-but-farther station within the same band; the
  freshness preference flips only when nothing is fresh; the stale flag; the
  100 km and 250 km band edges (99/101, 249/251); empty input → `null`;
  all-stale-beyond-6h → `null`; bearing/compass correctness against known pairs.
  `tests/unit/metar-parsing.test.ts`: the full D-plan visibility and wind-dir
  matrices, plus a sparse observation missing `wgst`/`wxString`/`slp`/`temp`.
- Commit: `feat: Add METAR station selection and field parsing`
- Depends on: T2, T3

### Phase 3 — Handler and registration

**T5 — `source: 'metar'` on `get_current_conditions` + schema** (`opus`)

- Files: `src/handlers/currentConditionsHandler.ts`, `src/index.ts`
- Args: widen `CurrentConditionsArgs.source` to
  `'auto' | 'noaa' | 'openmeteo' | 'metar'`. **`auto` routing is untouched** —
  the existing `useNOAA` ternary keeps its exact semantics; the METAR branch is
  a new arm taken only on an explicit request (D1).
- Append `aviationWeatherService?: AviationWeatherService` as the **last,
  optional** parameter of `handleGetCurrentConditions` (Finding above; almanac
  A6 precedent). Instantiate it in `src/index.ts` beside `acisService` (`:138`)
  and pass it at the `get_current_conditions` call site (`:737`). A
  `source: 'metar'` call with no service injected must produce a clean
  `ServiceUnavailableError`-class message, not a crash.
- New `formatMetarCurrentConditions(...)` rendering exactly D5: heading with
  station name + ICAO; `**Station:**` line with name, distance in the caller's
  unit, 16-point bearing, and elevation; `**Observed:**` line with the local
  time **and** the relative age; then temperature (with dew point and the
  computed humidity), wind, visibility, sky, weather, pressure, flight category;
  then the raw METAR on its own line; then the D5 footer.
  - **Absent fields are omitted, never rendered empty** — `wgst` at 14% and
    `wxString` at 8% mean most reports are sparse.
  - Caveat lines when they apply: far station (100–250 km), stale observation
    (90 min – 6 h), and `metarType === 'SPECI'`.
  - No station within any tier / all beyond 250 km → the friendly
    "no reporting station near this location" message (rivers precedent),
    **not** an error and **not** a silent fallback to Open-Meteo (D1).
  - Timezone: `guessTimezoneFromCoords` on the **station's** coordinates, then
    `formatInTimezone` — matching how the NOAA path derives its clock.
- Units (D6): temp/dewp via `formatTemperatureFromC`; `wspd`/`wgst` kt → m/s
  (×0.514444) then `convertWindFromMps`; `altim`/`slp` hPa → Pa (×100) then
  `convertPressureFromPa`; `visib` mi → km then `convertDistanceFromKm`
  (preserving the `"10+"` qualifier as a leading `+`, never a bare `10`); `elev`
  via `formatElevationFromM`; cloud `base` (feet AGL) via `formatHeightFromFt`.
- Optional blocks (D7): `include_normals` **is** supported — call the existing
  `getClimateNormals` + `getRecordsLine` helpers exactly as the other two paths
  do, using the observation date. `include_fire_weather` renders a one-line
  "not available on the METAR source" note.
- Registration (`src/index.ts:333–338`): add `'metar'` to the `source` enum and
  rewrite the description with D1's semantic triggers — "actual/real
  observation", "measured", "what is the station reporting", "METAR", "airport
  weather", "flight category" — while keeping the existing `auto`/`noaa`/
  `openmeteo` wording intact.
- Acceptance: full gate green. **`tests/unit/current-conditions-global.test.ts`
  passes with zero edits** — that is the D1 no-change guarantee; if it needs
  editing, stop and ask. **Live check against the built dist:** Seattle with
  `source: 'metar'` returns KSEA (or a nearer field) with plausible values and a
  raw METAR; London/Nairobi/Sydney each return a real station; a mid-Pacific
  point returns the friendly no-station message; `auto` output for a US and a
  non-US point is byte-identical to `main`; metric and imperial both render.
- Commit: `feat: Add METAR station observations as a get_current_conditions source`
- Depends on: T4

### Phase 4 — Tests

**T6 — Handler unit tests for METAR routing and rendering** (`sonnet`)

- Files: `tests/unit/metar-handler.test.ts` (new)
- Model on `tests/unit/current-conditions-global.test.ts` and
  `tests/unit/almanac-handler.test.ts` (real handler, plain fake services, no
  HTTP). Cover: `source: 'metar'` selects the METAR path and makes **no** NOAA
  or Open-Meteo call; `auto` for both a US and a non-US point makes **no**
  aviation-weather call (the D1 guarantee, asserted on the fake); the tier
  ladder widens only when a tier yields nothing usable; the far-station,
  stale, and SPECI caveat lines each appear exactly when their condition holds;
  a sparse observation omits rather than blanks its missing lines; `"VRB"`
  renders "Variable" with no compass point; `"10+"` keeps its qualifier;
  no-station → the friendly message and no thrown error; `include_normals`
  renders on the METAR path (US) and adds no ACIS call abroad;
  `include_fire_weather` renders the unavailable note; imperial and metric
  fixtures both render.
- Acceptance: new tests deterministic, no live calls; full gate green.
- Commit: `test: Cover METAR source routing, caveats, and rendering`
- Depends on: T5 · **parallel-safe with T7** (disjoint files)

**T7 — Integration tests: captured shapes + tolerant live smoke** (`sonnet`)

- Files: `tests/integration/metar.test.ts` (new)
- Two blocks: (1) mocked HTTP against the **real** service + handler end to end
  using the captured 2026-08-13 shapes — a 200 multi-station body (including
  string `visib`, `"VRB"` wdir, mixed epoch/ISO timestamps, and a station
  missing `temp`), a 204 empty body, and the HTML 502; (2) one live smoke test
  hitting aviationweather.gov, following the tolerant-of-flake convention of the
  four existing live files — generous timeout, assert **shape not values**,
  never fail the suite on a network error.
- **This is the fifth live-network integration file** — say so in the file
  header so the gate caveat stays discoverable.
- Acceptance: mocked block deterministic; live block tolerant; full gate green
  (re-run once if only live files are red).
- Commit: `test: Add METAR integration coverage for captured and live responses`
- Depends on: T5 · **parallel-safe with T6** (disjoint files)

### Phase 5 — Live verification and docs

**T8 — Live sweep + documentation/registration checklist** (`opus`)

- Files: `CHANGELOG.md`, `README.md`, `docs/TOOLS.md`, `CLAUDE.md`,
  `docs/planning/README.md`,
  `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`, `docs/metar-plan.md`
- **Live sweep against the built dist**, re-running T5's acceptance list end to
  end, plus: a no-`source` call byte-identical to pre-branch output; a
  `location_name` and a `city_name` call with `source: 'metar'` (the
  `**Location:**` header must still lead, above the `**Station:**` line); a
  second identical call served from the 10-minute cache (one upstream fetch in
  the logs); a deliberate burst to confirm the 502/retry path degrades to a
  sanitized error rather than a parse crash.
- Docs, per the design's checklist:
  - CHANGELOG entry under `[Unreleased]` (A7 — do not invent the version bump).
  - README: tool table and coverage notes — international current conditions can
    now be real station observations.
  - `docs/TOOLS.md` §2 (`:87`) — the third source, what a METAR means, the
    station-distance and observation-age caveats, and the D7 limits.
  - `CLAUDE.md` — `aviationWeather.ts` in the architecture tree, the
    `metarStation.ts` utility, and the v1.17.0 status blurb.
  - `docs/planning/README.md` — flip the METAR row (`:42`) 📝 → ✅ and add the
    Shipped row; update the aviation-tool row (`:65`) to note the observation
    half is closed and only TAF + a pilot-facing tool remain 💡; mark the ICR
    Phase 1 leftover closed in
    `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`.
  - Mark `docs/metar-plan.md` status `IMPLEMENTED`, then **move the plan set
    (`docs/metar-plan.md` + this file) to `docs/plans/`** and update every
    reference — matching what the maintainer asked for on almanac.
- Acceptance: live sweep recorded in the commit message or a short note; full
  gate green; every box of the design plan's "Documentation / registration
  checklist" satisfied.
- Commit: `docs: Record worldwide METAR station observations`
- Depends on: T6, T7

## Assumptions to confirm before `/run-plan`

- **A1 — branch base.** `feat/almanac` (v1.16.0) is complete but unmerged and
  shares CHANGELOG `[Unreleased]` with the unreleased global-rivers work.
  Recommended: merge/release almanac first and cut `feat/metar` from `main`. If
  METAR must start sooner, stack on `feat/almanac` and say so — T2
  (`src/utils/units.ts`) and T8 (all four doc files) collide otherwise.
- **A2 — compass resolution for the station bearing.** D3 step 2 names
  `compassPoint` (8-point), but D5's sample output reads `12 mi SSW`
  (16-point). Assumed: the **station bearing uses the new 16-point
  `windDirectionFromDegrees`**, matching the published example; the rivers
  channel-snap disclosure keeps 8-point `compassPoint` unchanged. The move of
  both functions into `distance.ts` still happens as designed. Flip this if the
  8-point reading was intended.
- **A3 — User-Agent contact string.** `getUserAgent()` yields
  `weather-mcp/<version>` with no contact. Assumed: `AviationWeatherService`
  builds its own header (`weather-mcp/<version>
  (+https://github.com/weather-mcp/weather-mcp)`) rather than changing
  `getUserAgent()`, which would alter every existing service's requests.
- **A4 — `ApiError` union widening is in scope.** D2's
  `ServiceUnavailableError` mapping does not compile without it; treated as a
  mechanical consequence (T1), not new scope.
- **A5 — `check_service_status` unchanged.** The design's checklist does not
  list aviationweather.gov. Assumed: not added in v1.17.0; noted as a follow-up.
- **A6 — optional trailing service param.** `aviationWeatherService?` is
  appended last and optional on `handleGetCurrentConditions`, so the
  untypechecked test call sites and `weatherSummaryHandler.ts:138` keep working
  and simply cannot reach the METAR path — the correct isolation behaviour.
- **A7 — CHANGELOG heading.** Design says "CHANGELOG.md under `[Unreleased]`";
  confirmed as repo convention. The version bump stays a release step.
- **A8 — an extra service test file.** The design names three test files; T3
  adds `tests/unit/metar-service.test.ts` so the 204/HTML-502/retry/cache
  branches are covered at the unit level rather than waiting for T7. Additive
  coverage, same intent.
- **A9 — tier widening lives in the handler.** D3 describes expanding bbox
  search inside `pickNearestStation`, but the picker is specified as pure and
  I/O-free. Assumed: the picker stays pure and exports the tier ladder; T5's
  handler drives the fetch-per-tier loop. Behaviour is identical; testability is
  much better.

## Progress Tracker

- [x] T1 — Widen the ApiError service union (`haiku`) — `b2e57c4`
- [x] T2 — Move bearing/compass geometry; add compass + humidity helpers (`sonnet`) — `07f0bc1`
- [ ] T3 — METAR types, AviationWeatherService, cache TTL (`sonnet`)
- [ ] T4 — Station picker and METAR parsing helpers (`opus`)
- [ ] T5 — `source: 'metar'` on get_current_conditions + schema (`opus`)
- [ ] T6 — Handler unit tests for METAR routing and rendering (`sonnet`)
- [ ] T7 — Integration tests: captured shapes + tolerant live smoke (`sonnet`)
- [ ] T8 — Live sweep + documentation checklist (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the design plan's five live
acceptance points are demonstrably met against the built dist (US station,
non-US station, mid-ocean friendly message, unchanged `auto` output, both unit
systems), `tests/unit/current-conditions-global.test.ts` still passes unedited,
and `docs/metar-plan.md` is marked `IMPLEMENTED` and moved to `docs/plans/`.
Opening the PR is the human's call.
