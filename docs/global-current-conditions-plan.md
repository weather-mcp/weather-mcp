# Global Current Conditions — Design Plan

**Status:** IMPLEMENTED (2026-07-15, v1.12.0)
**Parent:** `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md` (Phase 1)
**Target release:** v1.12.0
**Branch (for /impl-plan):** `feat/global-current-conditions`

## What / Why

`get_current_conditions` is the most-used tool after `get_forecast`, and it is
US-only: `src/handlers/currentConditionsHandler.ts` calls
`noaaService.getCurrentConditions()` unconditionally (it imports
`OpenMeteoService` but only uses it for climate normals). Any non-US location
fails, which also degrades the `current` section of `get_weather_summary`
outside the US.

Fix: replicate the forecast tool's auto-select pattern
(`src/handlers/forecastHandler.ts:235`) — US → NOAA station observations
(unchanged), elsewhere → Open-Meteo current weather. No new provider: Open-Meteo
is already integrated (`src/services/openmeteo.ts`), free (non-commercial,
CC-BY), keyless.

## Design decisions (settled)

### D1. Routing

- Extract the private `isInUS()` from `src/handlers/forecastHandler.ts:76` into
  `src/utils/geography.ts` (exported, unit-tested; same bounding boxes:
  CONUS, Alaska, Hawaii, Puerto Rico). Update forecastHandler to import it.
- Add a `source` parameter to `get_current_conditions` with the same contract as
  `get_forecast`: `'auto' | 'noaa' | 'openmeteo'`, default `'auto'`.
  `auto` → `isInUS(lat, lon) ? NOAA : Open-Meteo`.
- Explicit `source: 'noaa'` outside the US keeps today's behavior (NOAA throws
  its own error). Explicit `source: 'openmeteo'` works anywhere, including the
  US (useful for comparison/debugging).

### D2. New service method

`OpenMeteoService.getCurrentConditions(latitude, longitude, prefs)` in
`src/services/openmeteo.ts`, following the existing `getForecast()` shape
(validate coords → build params → cache-or-fetch via
`makeRequestToForecast('/forecast', params)`).

Request: `current=` with
`temperature_2m, relative_humidity_2m, apparent_temperature, dew_point_2m,
is_day, precipitation, rain, showers, snowfall, weather_code, cloud_cover,
pressure_msl, wind_speed_10m, wind_direction_10m, wind_gusts_10m`,
plus `daily=temperature_2m_max,temperature_2m_min&forecast_days=1` (for a
"Today's Range" line), `timezone=auto`, and unit params via the existing
`openMeteoUnitParams(prefs)`.

- Cache TTL: `CacheConfig.ttl.currentConditions` (15 min), key includes
  `unitSignature(prefs)` like the forecast cache.
- Response validation mirroring `validateForecastResponse` (require `current`
  and `current_units` blocks; throw `ServiceUnavailableError` on malformed).
- Types: extend `src/types/openmeteo.ts` with `current` / `current_units`
  fields on the forecast response (new `OpenMeteoCurrentWeather` interface).
  No `any`.

### D3. Output format (non-US path)

New formatter in `currentConditionsHandler.ts` mirroring the NOAA layout so
downstream consumers see a familiar shape:

```
# Current Weather Conditions

**Time:** <current.time formatted in response timezone, prefs.timeFormat>

**Conditions:** <WMO weather_code description — reuse the existing code→text
                 mapping used by formatOpenMeteoForecast>
**Temperature:** …
**Feels Like:** <apparent_temperature — shown only when it differs from
                 temperature by more than DisplayThresholds' feels-like gap;
                 add a small threshold constant if none fits>
**Today's Range:** High … / Low …           (from daily block)
**Dewpoint:** …
**Humidity:** …%
**Wind:** … from …°, gusting to …           (gust shown per the existing
                                             DisplayThresholds.wind.gustSignificanceRatio rule)
**Pressure:** <pressure_msl>
**Cloud Cover:** …%                          (percentage — no layer data)

## Recent Precipitation                      (only if precipitation > 0;
**Current:** …                               rain/showers/snowfall broken out
                                             when nonzero)
---
*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*
```

- **No `**Station:**` line** (there is no station); the data-source footer and
  the "model-interpolated" caveat carry that distinction instead.
- Values arrive already in the caller's preferred units (Open-Meteo converts
  server-side) — format with the plain-number helpers in
  `src/utils/unitFormat.ts`, not the NOAA QV helpers.
  - **Correction (found in implementation, 2026-07-15):** this is true for
    temperature, wind, and precipitation but **not pressure**.
    `openMeteoUnitParams` carries no pressure token, so `pressure_msl` always
    returns hPa — the live API reports `"pressure_msl": "hPa"` even under
    `temperature_unit=fahrenheit`. Pressure must be **converted**
    (`formatPressureFromPa(hPa * 100, prefs)`), not relabelled. Every other
    field we read does honour the unit params.
- Timezone comes from the response's `timezone` field (no station lookup).
- `prependLocationLine` behavior unchanged.

### D4. Optional flags on the non-US path

- `include_fire_weather`: **skip the NOAA gridpoint call entirely** and emit a
  one-line note: "Fire weather indices are currently available for US locations
  only." (Global fire-weather computation is roadmap Phase 5 — out of scope.)
- `include_normals`: keep calling the existing hybrid
  `getClimateNormals(openMeteoService, nceiService, …)` from
  `src/utils/normals.ts` — it already has an Open-Meteo path. Verify with a
  test that a non-US location produces normals (or degrades to the existing
  "not available" note) without throwing.
- `units` / per-unit overrides: honored via `resolveUnitPreferences` exactly as
  today.

### D5. Registration & docs

- `src/index.ts`: add `source` to the `get_current_conditions` input schema
  (enum, default `auto`); update the tool description to say global coverage
  (NOAA stations in the US, Open-Meteo model data elsewhere). Remove/adjust any
  "US only" wording for this tool in schema text.
- `get_weather_summary` needs **no code change** — its `current` section calls
  `handleGetCurrentConditions` and inherits the fallback.
- Docs: README.md tool table, CHANGELOG.md (v1.12.0), CLAUDE.md tool list
  ("US only" → global for current conditions), roadmap Phase 1 marked done.

### D6. Tests (Vitest, all mocked, gate stays < 2 s)

- `tests/unit/geography.test.ts` (or extend existing): `isInUS` boxes — CONUS,
  Alaska, Hawaii, Puerto Rico, plus non-US probes (London, Tokyo, Sydney,
  border-adjacent Canada/Mexico points).
- Service: param construction (current + daily + timezone + unit params),
  cache hit/miss with unit-signature keys, malformed-response rejection.
- Handler routing: US coords → NOAA path; non-US → Open-Meteo path; explicit
  `source` overrides both ways; `include_fire_weather` note on the non-US path;
  no NOAA station/gridpoint calls made on the non-US path.
- Formatter: weather-code text, feels-like display rule, gust-significance
  rule, precipitation section presence/absence, footer text.

## Out of scope / deferred

- Visibility and snow depth on the non-US path (hourly-only variables in
  Open-Meteo; not worth a second request in v1).
- Real station observations internationally (aviationweather.gov METARs) —
  roadmap Phase 1 optional supplement, separate plan if wanted.
- Global fire-weather indices (roadmap Phase 5).
- Any change to `get_alerts`, rivers, wildfire (roadmap Phases 2–4).

## Acceptance (feature-level)

1. `get_current_conditions` returns formatted current weather for London,
   Tokyo, and Sydney coordinates (mocked responses) with the Open-Meteo footer.
2. US behavior is byte-identical to today for the default `auto` source
   (existing tests untouched and green).
3. `get_weather_summary` with `sections: ['current']` succeeds for a non-US
   location (mocked).
4. Full gate green: `npm run build`, `npm test`, `npm audit`.

## Expected touch set

| File | Change |
|------|--------|
| `src/utils/geography.ts` | + exported `isInUS` |
| `src/handlers/forecastHandler.ts` | − private `isInUS`, + import |
| `src/types/openmeteo.ts` | + current-weather response types |
| `src/services/openmeteo.ts` | + `getCurrentConditions()` |
| `src/handlers/currentConditionsHandler.ts` | + routing, + Open-Meteo formatter, fire-weather note |
| `src/index.ts` | schema/description updates (`source` param) |
| `tests/unit/…` | new tests per D6 |
| `README.md`, `CHANGELOG.md`, `CLAUDE.md`, roadmap | docs |
