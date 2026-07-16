# Max-Range Expansion — Design Plan

**Status:** SETTLED (2026-07-16) — ready for `/impl-plan`
**Parent:** Full-codebase range audit (2026-07-16, this doc's What/Why) following
the `get_air_quality` forecast fix (`forecast_days` param + day-grouped output +
null-horizon trimming, committed 3e50ebc on `feat/global-current-conditions`)
**Target release:** next minor (first unreleased version after v1.12.0)
**Branch (for /impl-plan):** `feat/max-range-expansion`, cut from
`feat/global-current-conditions` (which carries the unreleased air-quality
work this plan's patterns come from); rebase onto `main` if that branch merges
first.

## What / Why

After the air-quality fix, every tool was audited for the same defect class:
handlers fetching less than the data source's maximum range, fetching data that
is never displayed, or truncating display with no escape hatch. Three gaps are
real; everything else was verified clean (see "Verified clean" below).

- **M1 (High, feature gap):** `get_marine_conditions` is the air-quality bug on
  every axis — handler hardcodes a 5-day fetch
  (`marineConditionsHandler.ts:128`), no `forecast_days` schema param
  (`index.ts:460-467`), service validation caps at 7 (`openmeteo.ts:1085`),
  daily display double-capped at `Math.min(5, …)`
  (`marineConditionsHandler.ts:337`), and 13 hourly variables are fetched then
  discarded except for a "N hours available" line
  (`marineConditionsHandler.ts:374-376`).
- **H1 (Medium, silent truncation):** `get_historical_weather`'s Open-Meteo
  archive path fetches every hour in the range, and hourly mode covers ranges
  up to 31 days = 744 hours (`ApiConstants.maxHourlyHistoricalDays`), but the
  display `limit` maxes at 500 (`FormatConstants.maxHistoricalLimit`,
  `displayThresholds.ts:116`; schema `index.ts:361`). Ranges past ~20.8 days
  silently lose their tail with no way to see it. Also, `limit` truncates the
  hourly path but is ignored on the daily path — undocumented asymmetry.
- **V1 (Low, missing data + inconsistent detail contract):**
  `get_weather_imagery` never reads RainViewer's `radar.nowcast` forecast
  frames (`rainviewer.ts:137-149` reads `past` only), and animated mode shows
  only first/middle/last of ~13 frames with **no override** —
  `weatherImageryHandler.ts:192-211`; `detail="full"` toggles embed-vs-URL only,
  unlike `get_forecast` where `full` lifts the hourly cap.

### Live API verification (2026-07-16)

| Check | Result |
|---|---|
| Open-Meteo Marine `forecast_days=8` | Accepted, 8 real days |
| Marine `forecast_days=9,10,12,14,16` | All accepted — **API now serves 16 days** (docs/service comment say 8) |
| Marine 16-day data quality | Real values through day ~10; days 11-16 **null-padded** (`wave_height_max: null`; 144/384 hourly nulls) — same trap the AQI fix handled |
| Marine request anatomy | `current=` is its own API param (always sent); the `hourly=` list is only added when `forecast=true` and nothing displays it — droppable without touching current conditions |
| RainViewer `weather-maps.json` | 13 past frames (2 h @ 10-min steps); `nowcast` array **empty on two checks 20+ min apart** — feed may be temporarily down or discontinued |

## Design decisions (settled)

### D1. Marine `forecast_days` + full day-range display (fixes M1)

Mirror the air-quality change end to end. Ceiling **16 with null trimming**
(user decision 2026-07-16): match what the API accepts and trim trailing
no-data days, rather than hardcoding today's ~10-day model horizon.

- **Schema** (`src/index.ts`, `get_marine_conditions` entry): add
  `forecast_days` (number, 1-16, default 5) with a description noting the
  marine model typically provides ~10 days and trailing days without data are
  omitted with a note. Update the `forecast` param description and tool
  description (currently hardcode "next 5 days").
- **Handler** (`src/handlers/marineConditionsHandler.ts`): validate via
  `validatePositiveInteger(raw, 'forecast_days', 1, MAX_FORECAST_DAYS)`
  (`src/utils/validation.ts:64`) with local constants
  `DEFAULT_FORECAST_DAYS = 5`, `MAX_FORECAST_DAYS = 16` — same shape as
  `airQualityHandler.ts`. Pass through to `getMarine(...)` (replace the
  hardcoded `5`).
- **Service** (`src/services/openmeteo.ts` `getMarine`): raise the validation
  cap 7 → 16; update the doc comment (note the API accepts 16, verified live
  2026-07-16, model horizon ~10 days, null-padded beyond).
- **Drop the dead hourly fetch:** remove the `params.hourly` block from
  `buildMarineParams` (keep `current` and `daily`); change
  `validateMarineResponse` to require `daily` (not `hourly`) when
  `forecast=true`; delete the "*Hourly forecast data available…*" line from the
  formatter. Current conditions are unaffected (separate `current=` param,
  verified live). Daily aggregates are the right granularity for this tool;
  16 days × 24 h × 13 hourly vars would be noise.
- **Formatter** (`formatOpenMeteoMarineConditions`): remove `Math.min(5, …)`;
  render every fetched day. Add null-horizon handling in the AQI-fix style:
  a day whose `wave_height_max` is not a finite number is a no-data day;
  trailing no-data days are trimmed and a footer notes "the marine model
  provided no data for the final N requested day(s)". Guard each per-day field
  with finite-number checks (the current `?.[i] !== undefined` checks pass
  `null` through to `formatWaveHeight`/`getWaveHeightCategory`). All-null →
  "*No marine forecast data available for this location.*"
- **No NOAA-branch changes:** the NOAA Great-Lakes/coastal branch is
  current-conditions-only by design (`marineConditionsHandler.ts:201-206`).

### D2. Historical hourly `limit` ceiling 500 → 744 (fixes H1)

- **Constant** (`src/config/displayThresholds.ts`):
  `FormatConstants.maxHistoricalLimit` 500 → **744** (= 31 days × 24 h, the
  largest hourly window `maxHourlyHistoricalDays` allows). Default stays 168.
- **Schema** (`src/index.ts:357-363`): `limit` maximum 744; description states
  that `limit` applies to **hourly** output and that daily-granularity output
  (ranges > 31 days) always shows the full range.
- **Docs asymmetry made explicit, not "fixed":** applying `limit` to the daily
  path would silently truncate multi-year requests — worse than today.
  Document the asymmetry in the schema description and `docs/TOOLS.md`.
- **NOAA recent path unchanged:** the clamp at `noaa.ts:493-497` stays 1-500 —
  that is NOAA's own documented API maximum for the observations endpoint, and
  the NOAA path only ever serves the last-7-days window. If a request with
  `limit > 500` routes to NOAA, clamp (existing behavior) — no error.

### D3. Imagery: `detail="full"` shows all frames; nowcast appended defensively (fixes V1)

- **Frame cap** (`src/handlers/weatherImageryHandler.ts:192-211`): when
  `detail === 'full'`, list **all** frames instead of first/middle/last; keep
  3-of-N for `summary`/`standard` and extend the existing "Showing 3 of N"
  note with "use detail=\"full\" for all frames" (same escape-hatch contract as
  `get_forecast`'s hourly cap).
- **Nowcast** (`src/services/rainviewer.ts` `getPrecipitationRadar`): when
  `animated`, append `data.radar.nowcast` frames (when present and non-empty)
  after the past frames, labeled as forecast frames (e.g. "+10 min forecast");
  single-frame (non-animated) behavior unchanged (latest **past** frame).
  Defensive by design: live checks found `nowcast` empty — the code must treat
  a missing/empty array as normal. **Do not** advertise nowcast in the tool
  description unless implementation-time live verification shows frames
  actually flowing; if still empty, ship the defensive code (harmless) and
  leave the description alone.

## Out of scope / deferred (user decision 2026-07-16: Tier 1 only)

All Tier 2 audit findings are deferred to their own plan,
**`docs/output-completeness-plan.md`** (DRAFT — decisions not yet settled),
which carries the full audit evidence for each. In brief: AQI per-day peak UV
(fetched, never displayed), `detail="full"` overrides for the river/wildfire/
lightning top-N caps, surfacing the ArcGIS `exceededTransferLimit` caveat, the
river forecast time series + USGS footer attribution fix, and trimming unused
hourly UV/pollutant variables from the air-quality fetch. Create no tasks for
these here.

## Verified clean (no action, for the record)

- `get_forecast` — Open-Meteo requests exactly `days` up to the API max 16;
  NOAA endpoints take no count param; hourly display caps are disclosed and
  lifted by `detail="full"`.
- `get_weather_summary` — pure delegation; `detail` defaults to `summary` by
  design.
- `get_lightning_activity` — 120-min `timeWindow` max equals the real rolling
  buffer retention (`blitzortung.ts:70-73`).
- `get_current_conditions`, `get_alerts`, saved-location tools,
  `search_location` — no range semantics (`forecast_days: 1` on the current
  path exists only to read today's high/low).

## Acceptance criteria

- **D1:** `get_marine_conditions` with `forecast: true, forecast_days: 16`
  against the live API shows every day the model provides (~10 today), each
  with real values, plus the trimmed-days note; no null-derived "0 m (Calm)"
  days; `forecast_days: 17` and `0` rejected with a `forecast_days` message;
  default remains 5; the request no longer contains `hourly=`; current
  conditions output unchanged. New unit tests (new
  `tests/unit/marine-forecast.test.ts`, modeled on
  `tests/unit/air-quality-forecast.test.ts`): param default/passthrough/
  rejection, full-range display, trailing-null trimming, interior-null
  guarding, all-null message, forecast=false unchanged.
- **D2:** schema and validation accept `limit: 744` (745 rejected); a 31-day
  hourly range displays all 744 fetched observations with no "(of M
  available)" truncation note; daily path behavior unchanged; TOOLS.md +
  schema state the hourly-only semantics. Unit tests cover the new bound.
- **D3:** with >5 frames, `detail="full"` lists every frame; summary/standard
  keep 3-of-N with the escape-hatch note; empty and non-empty `nowcast` arrays
  both handled (unit tests with stubbed RainViewer payloads); live spot-check
  of animated radar output.
- Full gate green: `npm run build` (0 errors), `npx vitest run tests/unit`
  (100% pass; live-network integration flakes per
  `docs/…` / memory are excluded from judgment), `npm audit` no new criticals.
- CHANGELOG (Unreleased) + `docs/TOOLS.md` updated for all three tools.

## Touch set

| Decision | Files |
|---|---|
| D1 | `src/handlers/marineConditionsHandler.ts`, `src/services/openmeteo.ts` (getMarine, buildMarineParams, validateMarineResponse), `src/index.ts` (schema), `tests/unit/marine-forecast.test.ts` (new) |
| D2 | `src/config/displayThresholds.ts`, `src/index.ts` (schema), `src/handlers/historicalWeatherHandler.ts` (comment/note only if needed), existing historical unit tests (extend) |
| D3 | `src/handlers/weatherImageryHandler.ts`, `src/services/rainviewer.ts`, `src/types/` (rainviewer types if nowcast needs typing), imagery unit tests (new/extend) |
| All | `CHANGELOG.md`, `docs/TOOLS.md` |

Verification rule carried from the hardening batch: drive the real APIs and the
built dist at each step — the null-padding class of bug (air quality, marine)
has never been visible in the mocked suite.
