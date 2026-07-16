# Global Current Conditions — Implementation Plan

**Status:** COMPLETE (2026-07-15) — all tasks landed on `feat/global-current-conditions`

Execution plan for `docs/global-current-conditions-plan.md` (the WHAT/WHY); rules
live in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/global-current-conditions-implementation-plan.md
```

Or, equivalently: read `docs/global-current-conditions-plan.md` (design),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — branch, green baseline, one subagent per task,
review the diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass, < 2s
npm audit         # no high/critical
```

**Gate caveat (observed during execution):** two files under `tests/integration/`
make **live network calls** and flake independently of any change here —
`visualization-lightning.test.ts` (Blitzortung MQTT, fails `ECONNRESET` during
upstream hiccups) and `safety-hazards.test.ts` (live NOAA/USGS). Both were
confirmed to fail on a clean tree and pass on retry. If the gate goes red in only
those files, re-run before suspecting the diff.

Read **Assumptions to confirm** below before starting T4 — two design details
(the feels-like threshold in metric, and which error class malformed responses
throw) resolve differently than a literal reading of the design plan suggests.

## Scope & branch

**Branch:** `feat/global-current-conditions`
**Target release:** v1.12.0

In scope: everything under the design plan's D1–D6 — routing via a shared
`isInUS`, an Open-Meteo `getCurrentConditions()` service method, the non-US
formatter, the fire-weather note, the `source` parameter, and docs.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Visibility and snow depth on the non-US path | Hourly-only in Open-Meteo; not worth a second request in v1 (design plan). |
| International station observations (aviationweather.gov METARs) | Roadmap Phase 1 optional supplement; separate plan. |
| Global fire-weather indices | Roadmap Phase 5. |
| `get_alerts`, rivers, wildfire globalization | Roadmap Phases 2–4. |

## Findings that shape the graph

Spot-checks against the code, all reconciled into the tasks below:

- **`src/utils/geography.ts` and `tests/unit/geography.test.ts` already exist**
  (Great Lakes / coastal-bay / country-code helpers). `isInUS` is an *addition*
  to both files, not a new file. The design plan's phrasing ("extract into
  `src/utils/geography.ts`") reads as if creating it.
- **No unit test file covers `currentConditionsHandler` today.** T5 creates
  `tests/unit/current-conditions-global.test.ts` from scratch.
- **`tests/unit/weather-summary-handler.test.ts` mocks `currentConditionsHandler`
  wholesale**, so a non-US test added *there* would prove nothing about routing.
  Design-plan acceptance #3 is therefore satisfied in T5's new file, driving the
  real handler with injected fake services.
- **`docs/TOOLS.md` documents this tool as "US only"** (lines 13, 86) and is not
  in the design plan's touch set. Updating it is a mechanical consequence of the
  change — folded into T7.
- **`package.json` version bumps ride with the feature commit** in this repo
  (precedent: `1e960b9` for v1.11.0) — folded into T7.
- **No test asserts on tool description text**, so the D5 description rewrite
  carries no test risk.
- `src/config/tools.ts` presets already include `get_current_conditions` in every
  tier; no preset change is needed.

## Task graph

### Phase 1 — Foundation

**T1 — Extract `isInUS` into geography utils** (`sonnet`)

- Files: `src/utils/geography.ts`, `src/handlers/forecastHandler.ts`,
  `tests/unit/geography.test.ts`
- Add an exported `isInUS(latitude, longitude)` to the existing
  `geography.ts`, carrying over the four bounding boxes from
  `forecastHandler.ts:76-84` **unchanged** (CONUS, Alaska, Hawaii, Puerto Rico).
  Delete the private copy; import the shared one. Do not "improve" the boxes —
  byte-identical US routing is design-plan acceptance #2.
- Note: `geography.ts` already has a `getCountryFromCoordinates` with
  *different, looser* US boxes for analytics privacy. Leave it alone; the two
  serve different purposes and must not be merged.
- Acceptance: new `isInUS` describe block in `tests/unit/geography.test.ts`
  covers CONUS, Alaska, Hawaii, Puerto Rico, plus non-US probes (London, Tokyo,
  Sydney, border-adjacent Canada and Mexico points). Full gate green — existing
  forecast tests must not move.
- Commit: `refactor: Extract isInUS routing helper into geography utils`
- Depends on: — · **parallel-safe with T2**

**T2 — Open-Meteo current-weather response types** (`haiku`)

- Files: `src/types/openmeteo.ts`
- Add an `OpenMeteoCurrentWeather` interface (and a matching units interface)
  covering: `time`, `interval`, `temperature_2m`, `relative_humidity_2m`,
  `apparent_temperature`, `dew_point_2m`, `is_day`, `precipitation`, `rain`,
  `showers`, `snowfall`, `weather_code`, `cloud_cover`, `pressure_msl`,
  `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`. Add optional
  `current` / `current_units` fields to `OpenMeteoForecastResponse`
  (line 273). Follow the optional-field style of
  `OpenMeteoAirQualityCurrentData`. No `any`.
- Acceptance: `npm run build` clean; full gate green.
- Commit: `feat: Add Open-Meteo current-weather response types`
- Depends on: — · **parallel-safe with T1**

### Phase 2 — Service

**T3 — `OpenMeteoService.getCurrentConditions()`** (`sonnet`)

- Files: `src/services/openmeteo.ts`, `tests/unit/openmeteo-current.test.ts` (new)
- Mirror `getForecast()` (line 608): validate coords → `buildCurrentParams()` →
  cache-or-fetch via `makeRequestToForecast('/forecast', params)` →
  `validateCurrentResponse()`.
- Params: the D2 `current=` list, plus
  `daily=temperature_2m_max,temperature_2m_min`, `forecast_days=1`,
  `timezone: 'auto'`, and `...openMeteoUnitParams(prefs)`.
- Cache: key `Cache.generateKey('openmeteo-current', latitude, longitude,
  unitSignature(prefs))`, TTL `CacheConfig.ttl.currentConditions` (15 min).
  Honor `CacheConfig.enabled` both ways, as the sibling methods do.
- Validation: require `current` and `current_units`; throw `DataNotFoundError`
  on malformed — **not** `ServiceUnavailableError` (see Assumptions).
- Acceptance: `tests/unit/openmeteo-current.test.ts` covers param construction
  (current list + daily + `forecast_days=1` + `timezone=auto` + unit params),
  cache hit/miss with distinct unit signatures (imperial vs metric must not
  share an entry), and malformed-response rejection. Mock HTTP per existing
  `tests/unit/` patterns — no live calls. Full gate green.
- Commit: `feat: Add Open-Meteo current conditions service method`
- Depends on: T2

### Phase 3 — Handler

**T4 — Route non-US current conditions to Open-Meteo** (`opus`)

The design-sensitive core — the orchestrator does this one itself.

- Files: `src/handlers/currentConditionsHandler.ts`,
  `src/config/displayThresholds.ts`
- Add `source?: 'auto' | 'noaa' | 'openmeteo'` to `CurrentConditionsArgs`;
  resolve exactly as `forecastHandler.ts:231-239` does (`auto` →
  `isInUS(lat, lon)`), then branch to the existing NOAA body or a new
  `formatOpenMeteoCurrentConditions()`.
- Refactor shape: lift today's inline NOAA body into a
  `formatNOAACurrentConditions()` alongside the new formatter, keeping
  `handleGetCurrentConditions` as resolve → route → `prependLocationLine`.
  The NOAA branch's behavior must not change.
- Non-US formatter per D3: no `**Station:**` line; timezone from
  `response.timezone`; plain-number helpers from `unitFormat.ts` (`withLabel`,
  `temperatureLabel`, …) — **not** the `*QV` helpers, which expect NOAA
  `QuantitativeValue` shapes; weather-code text via
  `openMeteoService.getWeatherDescription()`; gusts per
  `DisplayThresholds.wind.gustSignificanceRatio`; `## Recent Precipitation`
  only when `precipitation > 0`, breaking out rain/showers/snowfall when
  nonzero; footer `*Data source: Open-Meteo (Global) — model-interpolated
  values, not station observations*`.
- Add a feels-like gap constant to `DisplayThresholds.temperature` — see
  Assumptions for the unit trap.
- `include_fire_weather` on the non-US path: **no NOAA call at all**; emit
  "Fire weather indices are currently available for US locations only."
- `include_normals`: keep calling `getClimateNormals(openMeteoService,
  nceiService, …)` unchanged.
- Acceptance: full gate green with the existing suite untouched (US path
  byte-identical). Behavioral proof lands in T5.
- Commit: `feat: Route non-US current conditions to Open-Meteo`
- Depends on: T1, T3

**T5 — Handler routing and formatter tests** (`sonnet`)

- Files: `tests/unit/current-conditions-global.test.ts` (new)
- Routing: US coords → NOAA path; non-US → Open-Meteo path; explicit
  `source: 'noaa'` / `source: 'openmeteo'` overrides both ways. Assert the
  **negative**: on the non-US path, no station and no gridpoint call is made on
  the NOAA fake.
- Formatter: London / Tokyo / Sydney fixtures produce the Open-Meteo footer
  (design-plan acceptance #1); weather-code text; feels-like display rule at and
  around the threshold; gust-significance rule; `## Recent Precipitation`
  present when precipitation > 0 and absent at 0; no `**Station:**` line.
- `include_fire_weather` on the non-US path emits the US-only note and makes no
  gridpoint call. `include_normals` for a non-US location resolves (normals or
  the existing "not available" note) without throwing.
- Design-plan acceptance #3 lives here too: `handleGetWeatherSummary` with
  `sections: ['current']` at a non-US location, driving the **real**
  `currentConditionsHandler` with injected fake services. Do not add this to
  `tests/unit/weather-summary-handler.test.ts` — that file mocks the handler
  module, so the test would be vacuous.
- Services are constructor-injected, so pass plain fakes; no HTTP. Keep the
  suite under the 2s gate.
- Commit: `test: Cover global current conditions routing and formatting`
- Depends on: T4

### Phase 4 — Registration & docs

**T6 — Expose `source` on `get_current_conditions`** (`sonnet`)

- Files: `src/index.ts`
- Add the `source` property to the `get_current_conditions` input schema
  (`~line 300`), copying the enum/default/description shape from
  `get_forecast` (`~line 282`).
- Rewrite the tool description (line 297): drop "(US only)", state global
  coverage — NOAA station observations in the US, Open-Meteo model data
  elsewhere. Update the `include_fire_weather` description (line 304) to say
  US-only indices. Leave the `get_alerts` / river / wildfire descriptions alone
  — those tools are still US-only.
- Acceptance: full gate green. `tests/unit/tool-config.test.ts` asserts no
  description text, so no test churn is expected.
- Commit: `feat: Expose source parameter on get_current_conditions`
- Depends on: T4 · **parallel-safe with T5** (disjoint files)

**T7 — Docs and version** (`opus`)

- Files: `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `docs/TOOLS.md`,
  `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`,
  `docs/global-current-conditions-plan.md`, `package.json`
- `README.md`: tool table line 61 (🇺🇸 US → global with the NOAA/Open-Meteo
  split) and the Coverage & Limitations table line ~250 (Current conditions
  ❌ → ✅ global, richer via NOAA in the US).
- `CHANGELOG.md`: v1.12.0 entry.
- `CLAUDE.md`: tool list line 77 ("NOAA, US only" → global), version/status
  block, and the `Last Updated` line.
- `docs/TOOLS.md`: index line 13 and the `get_current_conditions` section
  (line 85-96) — coverage wording plus the new `source` parameter.
- `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md`: mark Priority 1 done; move
  `get_current_conditions` out of the US-only inventory table.
- `docs/global-current-conditions-plan.md`: `Status: SETTLED` → `IMPLEMENTED`.
- `package.json`: `1.11.1` → `1.12.0` (rides with the feature, per `1e960b9`).
- Acceptance: no "US only" wording remains for this tool anywhere
  (`grep -rn "US only" README.md CLAUDE.md docs/TOOLS.md src/index.ts` shows
  only alerts / rivers / wildfire / fire-weather hits). Full gate green.
- Commit: `docs: Document global current conditions (v1.12.0)`
- Depends on: T5, T6

## Assumptions to confirm

Resolve these before T4 — each is a place where the design plan is thin or the
code contradicts it.

1. **Feels-like threshold is unit-dependent.** D3 says show
   `apparent_temperature` only when it differs from temperature "by more than
   `DisplayThresholds`' feels-like gap; add a small threshold constant if none
   fits". No such constant exists — and the trap is that Open-Meteo returns
   values *already in the caller's unit*, so a single `°F` gap silently becomes
   a ~1.8× stricter rule in metric. **Recommendation:** add
   `feelsLikeGap: { F: 3, C: 2 }` to `DisplayThresholds.temperature` and select
   by `prefs.temperature`. Note the existing NOAA constants
   (`showHeatIndex: 80`, `showWindChill: 50`) are documented as Fahrenheit and
   are compared against explicitly-converted `°F` values — the non-US path has
   no such canonical value to lean on.
2. **Error class on malformed responses.** D2 says throw
   `ServiceUnavailableError`, but the method it says to mirror
   (`validateForecastResponse`, line 758) throws `DataNotFoundError`, as do the
   air-quality and marine validators. The tasks above follow the **existing
   pattern (`DataNotFoundError`)** — a malformed body is not an outage. Flip T3
   if you disagree.
3. **`get_weather_summary` gets no code change** (D5), which holds — it calls
   `handleGetCurrentConditions` at `weatherSummaryHandler.ts:127` and inherits
   the routing. The only summary work is the T5 test.
4. **v1.12.0 in `package.json`** is inferred from the v1.11.0 precedent, not
   stated in the design plan. If releases are cut separately here, drop the
   bump from T7.

## Progress Tracker

- [x] T1 — Extract `isInUS` into geography utils (`sonnet`) — `987cf96`
- [x] T2 — Open-Meteo current-weather response types (`haiku`) — `8de3593`
- [x] T3 — `OpenMeteoService.getCurrentConditions()` (`sonnet`) — `824f2bd`
- [x] T4 — Route non-US current conditions to Open-Meteo (`opus`) — `9df95ad`
- [x] T5 — Handler routing and formatter tests (`sonnet`) — `cb82b03`
- [x] T6 — Expose `source` on `get_current_conditions` (`sonnet`) — `b3af4d9`
- [x] T7 — Docs and version (`opus`) — `4c30c1f`

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, all four design-plan
feature acceptance criteria are demonstrably met, and
`docs/global-current-conditions-plan.md` is marked `IMPLEMENTED`. Opening the PR
is the human's call.
