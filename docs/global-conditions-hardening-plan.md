# Global Conditions Hardening — Design Plan

**Status:** IMPLEMENTED (2026-07-16, rides v1.12.0)
**Parent:** `docs/global-current-conditions-review.md` (post-implementation review
findings I1–I4); grandparent `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`
**Target release:** v1.12.0 (unreleased — these are pre-release fixes riding the
same version)
**Branch (for /impl-plan):** `feat/global-current-conditions` (continuation —
v1.12.0 has not shipped, so the fixes stack on the feature branch rather than
opening a new one)

## What / Why

Live testing of the global current-conditions feature
(`docs/global-current-conditions-review.md`, 2026-07-16) confirmed the feature
works as designed but surfaced four issues — two release blockers and two
polish items that directly affect the international users this release targets:

- **I1 (High, data correctness):** Open-Meteo reports `snowfall` in **cm**
  whenever the precipitation unit is mm (it only converts snowfall to inch when
  `precipitation_unit=inch` is sent — confirmed via the API's `current_units`
  metadata). The formatter labels it with the caller's precip unit, so metric
  users see a value understated 10× ("0.1 mm" for a real 1.4 mm). Live repro:
  Chilean Andes, 2026-07-16. The historical handler has the identical
  pre-existing bug.
- **I2 (High, user impact):** the CONUS bounding box in `isInUS` contains most
  of Canada's population. Toronto, Vancouver, and Windsor all route to NOAA
  under `source: "auto"` and get a hard `InvalidLocationError` instead of
  falling back to Open-Meteo. `get_forecast` fails identically (pre-existing).
- **I3 (Low, cosmetic):** the `## Recent Precipitation` section gates on raw
  `precipitation > 0` but displays at 2 decimals (imperial), so trace drizzle
  renders an all-zero section ("**Current:** 0.00 in"). Live repro: Sydney,
  Guam, Ushuaia.
- **I4 (Low, polish):** every international `get_weather_summary` (default
  include has `alerts`) ends with a raw NOAA error leak: `⚠️ Could not retrieve
  alerts data … Parameter "point" is invalid: out of bounds`.

## Design decisions (settled)

### D1. Snowfall unit conversion (fixes I1)

Open-Meteo's `snowfall` (current), hourly `snowfall`, and daily `snowfall_sum`
come back in **cm** unless `precipitation_unit=inch` was requested — the one
field besides pressure that does not follow the caller's precipitation unit.

- Add a helper to `src/utils/unitFormat.ts` (home of the other Open-Meteo unit
  helpers), e.g. `snowfallToPrecipUnit(value: number, prefs: UnitPreferences):
  number` — returns `value * 10` (cm → mm) when `prefs.precipitation === 'mm'`,
  passthrough when `'inch'`. Carry a comment documenting the API asymmetry so
  the trap is visible at the source (same spirit as the pressure comment in
  `currentConditionsHandler.ts`).
- Apply it at every Open-Meteo snowfall display site:
  - `formatOpenMeteoCurrentConditions` in
    `src/handlers/currentConditionsHandler.ts` (the `**Snowfall:**` line —
    both the value and its participation in D3's floor check).
  - `src/handlers/historicalWeatherHandler.ts:111` (hourly `snowfall`) and
    `:179` (daily `snowfall_sum`) — the identical pre-existing bug; the fix is
    a necessary mechanical consequence, not new scope.
- **No change to the forecast path:** `formatOpenMeteoForecast` requests
  `snowfall_sum` but never displays it (verified 2026-07-16); the only forecast
  snowfall display is the NOAA gridpoint path (`src/utils/snow.ts`), which is
  NOAA-mm and unaffected.
- The label stays the precip unit (converting to mm keeps the precipitation
  section unit-consistent; do **not** print a `cm` label).

### D2. Auto-mode NOAA → Open-Meteo fallback (fixes I2)

Applies to **both** `get_current_conditions` and `get_forecast`, and thereby to
the `current`/`forecast` sections of `get_weather_summary`.

- Scope of the fallback: **only** when `source` resolved to NOAA via `'auto'`
  and the NOAA branch throws `InvalidLocationError` (what
  `src/services/noaa.ts:140` throws for "Unable to provide data for requested
  point" — the coverage failure). On that catch: log a `logger.warn` (include
  coordinates and `fallback: true`), then run the existing Open-Meteo branch
  for the same request.
  - **Correction (found in live verification, 2026-07-16):** the coverage 404
    actually surfaces as **`DataNotFoundError`** — NOAA's `handleError` maps
    404 there, and `InvalidLocationError` is its generic non-404 4xx branch
    (the plan misread the throw sites). The implemented fallback catches
    **both** non-retryable client-error classes; the transient classes
    (`RateLimitError`, `ServiceUnavailableError`, network) propagate exactly
    as designed. Caught live against Toronto before the mocked tests were
    written — the same lesson as the pressure and snowfall traps: verify
    upstream behavior live, not just against fixtures.
- Prepend a one-line note to the fallback output so the source switch is
  explained, directly under the top heading:
  `*NOAA does not cover this location; showing Open-Meteo model data instead.*`
- **No fallback** on any other error class — transient NOAA failures
  (`ServiceUnavailableError`, `RateLimitError`, timeouts) propagate exactly as
  today; silently switching data sources during an outage would mask real
  problems, and the existing error text already points at
  `check_service_status`.
- Explicit `source: 'noaa'` keeps today's behavior: no fallback, the
  `InvalidLocationError` reaches the user.
- Accepted cost: for locations inside the US boxes that NOAA rejects (border
  cities), each uncached call pays one failed NOAA round-trip before the
  Open-Meteo request. Failure memoization is out of scope.
- Implementation shape: in each handler, wrap only the NOAA-branch invocation
  (`formatNOAACurrentConditions(...)` / `formatNOAAForecast(...)`) in a
  try/catch guarded by `requestedSource === 'auto'`; the catch re-dispatches to
  the existing Open-Meteo formatter and prepends the note. Keep both formatters
  untouched.

### D3. Trace-precipitation display floor (fixes I3)

- Add to `src/config/displayThresholds.ts` a precipitation trace floor keyed by
  unit — half of the smallest displayed increment:
  `precipitation: { traceFloor: { inch: 0.005, mm: 0.05 } }`.
- In `formatOpenMeteoCurrentConditions`, gate the `## Recent Precipitation`
  section on `precipitation >= traceFloor[prefs.precipitation]` (values are
  already in the caller's unit), and gate each breakout line (rain, showers,
  snowfall) on the same floor — snowfall *after* D1's conversion, so the floor
  applies to the displayed mm/inch value.
- Scope is the new formatter only. The historical handler's own `> 0` gates
  are pre-existing display behavior and stay as they are (it gets only the D1
  unit fix).

### D4. Clean US-only alerts note in weather summary (fixes I4)

- In `src/handlers/weatherSummaryHandler.ts`, before dispatching the `alerts`
  section (the `case 'alerts':` at ~line 136): if `!isInUS(latitude,
  longitude)` (import from `src/utils/geography.js`; the resolved coordinates
  are in scope), skip `handleGetAlerts` entirely and append a normal section
  instead:

  ```
  ## Alerts

  Weather alerts are currently available for US locations only.
  ```

  — styled as an informational section, **not** the `⚠️ … (unavailable)` error
  block, since this is expected behavior rather than a failure.
- Saves a doomed NOAA round-trip on every international summary.
- Border cities inside the US boxes still attempt NOAA alerts and, if NOAA
  rejects the point, fall into the existing generic unavailable block — that
  residual roughness is accepted; refining the boxes is out of scope.
- US behavior unchanged.

### D5. Docs

- `CHANGELOG.md`: amend the unreleased v1.12.0 entry with the four fixes (the
  snowfall and fallback items matter to users; the other two are one-liners).
- `docs/global-current-conditions-review.md`: mark I1–I4 resolved with commit
  SHAs (leave the observations section as-is).
- `docs/global-current-conditions-plan.md`: extend the D3 correction note so
  the snowfall asymmetry is recorded next to the pressure one (both are
  "Open-Meteo does not convert this field" traps).
- `CLAUDE.md`: add one line to the v1.12.0 status blurb noting the auto-mode
  NOAA→Open-Meteo fallback.

### D6. Tests (Vitest, all mocked, gate stays green)

- **Unit helper:** `snowfallToPrecipUnit` — metric ×10, imperial passthrough,
  zero-value.
- **Current conditions** (`tests/unit/current-conditions-global.test.ts`):
  - metric fixture with nonzero snowfall (e.g. API `0.14` cm) asserting the
    rendered value is `1.4 mm` — this is the test the original mocks
    structurally missed;
  - trace floor: precipitation below the floor → no `## Recent Precipitation`
    section; at/above → section present; a breakout line below the floor is
    omitted while the section shows;
  - fallback: auto + US-box coords (Toronto 43.6532, −79.3832) with a NOAA fake
    throwing `InvalidLocationError` → Open-Meteo output, fallback note present,
    no error; a NOAA fake throwing `ServiceUnavailableError` → error propagates
    (no fallback); explicit `source: 'noaa'` + `InvalidLocationError` →
    error propagates.
- **Forecast fallback:** same three routing cases against
  `handleGetForecast` (extend the existing forecast unit-test file if one
  covers routing, else add a focused new file).
- **Historical:** metric snowfall value converted (×10) in both hourly and
  daily output (extend the existing historical test file if present).
- **Weather summary:** non-US location → output contains the clean US-only
  alerts note, no `⚠️` block, and the alerts path of the NOAA fake is never
  invoked; US location → alerts dispatched exactly as before.
- All existing tests must pass untouched **except** any fixture that encodes
  the wrong snowfall assumption — correcting such a fixture is part of the fix,
  and the correction must be called out in the commit message.

## Out of scope / deferred

- Refining the `isInUS` bounding boxes (polygon lookup, territory boxes for
  Guam/USVI) — the D2 fallback makes box precision non-critical.
- Trace-floor treatment in the historical handler.
- Cardinal wind directions, day/night (`is_day`) flavored condition text,
  condensing international daily forecasts under `detail: "summary"` — recorded
  as observations in the review doc.
- NOAA failure memoization for border-city repeat lookups.
- International station observations (METARs), global alerts — roadmap phases.

## Acceptance (feature-level)

1. `get_current_conditions` and `get_forecast` with `source: "auto"` at Toronto
   coordinates (mocked NOAA `InvalidLocationError`) return Open-Meteo-formatted
   output with the fallback note — no error.
2. A mocked metric current-conditions response with `snowfall: 0.14` (cm)
   renders `1.4 mm`; imperial snowfall output is unchanged.
3. A mocked response with trace precipitation (below the floor) renders no
   `## Recent Precipitation` section.
4. `get_weather_summary` for a non-US location renders the clean US-only alerts
   note with no raw NOAA error text, and makes no NOAA alerts call.
5. US-path behavior is byte-identical for the default `auto` source outside the
   fallback case (existing tests untouched and green, minus explicitly
   corrected fixtures per D6).
6. Full gate green: `npm run build`, `npm test`, `npm audit`.

## Expected touch set

| File | Change |
|------|--------|
| `src/utils/unitFormat.ts` | + `snowfallToPrecipUnit` helper |
| `src/config/displayThresholds.ts` | + `precipitation.traceFloor` |
| `src/handlers/currentConditionsHandler.ts` | snowfall conversion, trace floor, auto-fallback wrap |
| `src/handlers/forecastHandler.ts` | auto-fallback wrap |
| `src/handlers/historicalWeatherHandler.ts` | snowfall conversion (2 sites) |
| `src/handlers/weatherSummaryHandler.ts` | US-only alerts pre-check |
| `tests/unit/…` | new/extended tests per D6 |
| `CHANGELOG.md`, `CLAUDE.md`, review + design plan docs | docs per D5 |
