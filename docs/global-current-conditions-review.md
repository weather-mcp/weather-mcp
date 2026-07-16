# Global Current Conditions — Post-Implementation Review

**Date:** 2026-07-16
**Branch:** `feat/global-current-conditions` @ `77b7e3d`
**Reviewer:** Claude (code review + live testing against the built server)
**Verdict:** Feature works as designed and is a real win for international users,
but **two issues should be fixed before cutting v1.12.0** — a metric snowfall
unit bug (I1) and the Canadian-border routing gap (I2).

## How this was verified

- **Gate:** `npm run build` clean, `npm test` 1210/1210 passing.
- **Code review:** full diff vs `main` (handler, service, types, geography,
  thresholds, index, tests, docs).
- **Live testing:** the four local MCP server configs (`weather-local` imperial,
  `weather-metric`, `weather-knots-24h`, default) all run this branch's `dist/`
  build, driven against the real Open-Meteo / NOAA / Nominatim APIs.
- **Cross-checks:** raw `curl` calls to Open-Meteo to compare values and
  `current_units` metadata against what the formatter prints.

### Live test matrix (all passed unless noted)

| Scenario | Location | Result |
|----------|----------|--------|
| Non-US auto → Open-Meteo path | London, Tokyo, Sydney, Berlin, Nairobi, Auckland, Svalbard, Ushuaia, Andes | ✅ Open-Meteo footer, no Station line, sane values |
| Pressure conversion (the T8 fix) | London 30.17 inHg vs API's 1021.7 hPa | ✅ correct (also ✅ hPa passthrough on `weather-knots-24h`: 1026 hPa) |
| US auto → NOAA unchanged | Seattle | ✅ station KBFI, identical format to v1.11 |
| `source: "openmeteo"` on US coords | Seattle | ✅ model data with Open-Meteo footer |
| `source: "noaa"` abroad | London | ✅ clean error: "outside NOAA's coverage area (US only)" |
| Metric / per-call overrides / 24h | Tokyo (server env), Berlin (`units` param) | ✅ °C, km/h, hPa, 24h all honored |
| Wind + knots | Auckland on `weather-knots-24h` | ✅ kn label, gust rule fires correctly |
| Feels-like threshold | Tokyo 34°C feels 42°C shown; Berlin 19°C ≈ apparent, hidden | ✅ |
| `include_fire_weather` abroad | Sydney | ✅ US-only note, no NOAA call, no error |
| `include_normals` abroad | Tokyo | ✅ Climate Context section renders with departures |
| `get_weather_summary` current section abroad | Nairobi, London | ✅ current + forecast work (but see I4 for the alerts block) |
| `city_name` geocoding + Location header | London, Berlin, Nairobi | ✅ |
| Timezone display | all of the above | ✅ local times correct; code confirmed naive Open-Meteo strings are parsed in the target zone (no double shift) |
| High latitude / southern winter | Svalbard 78°N, Ushuaia 55°S | ✅ |
| Canadian border cities | Toronto, Vancouver, Windsor | ❌ **error — see I2** |
| Metric snowfall | Chilean Andes (active snow) | ❌ **wrong by 10× — see I1** |

## Issues

### I1 — Metric snowfall is mislabeled and understated 10× (fix before release)

**Severity: High (data correctness).** Open-Meteo returns `snowfall` in **cm**
when the precipitation unit is mm (it only converts snowfall when
`precipitation_unit=inch` is sent). The formatter labels every precipitation
field with the caller's precip unit, so in metric a real `0.14 cm` (= 1.4 mm)
prints as:

```
**Snowfall:** 0.1 mm        ← live output, Chilean Andes (-33.35, -70.25), 2026-07-16
```

Confirmed against the API's own `current_units`, which reports `"snowfall": "cm"`
alongside `"precipitation": "mm"`. Imperial output is correct (inch in, inch out
— verified live at Ushuaia).

This is the same class of trap as the pressure bug T8 caught: the design plan
assumed Open-Meteo converts everything, and the mocked test fixtures inherited
the assumption, so the suite passes while the metric label is wrong.

- **Fix:** in `formatOpenMeteoCurrentConditions`, when `prefs.precipitation === 'mm'`,
  multiply `current.snowfall` by 10 before printing (or print it with a `cm`
  label — converting to mm keeps the section's unit consistent). Add a metric
  fixture with nonzero snowfall to `tests/unit/current-conditions-global.test.ts`
  asserting the converted value.
- **Same pre-existing bug elsewhere:** `historicalWeatherHandler.ts:111` and
  `:179` label hourly `snowfall` / daily `snowfall_sum` with the precip unit too
  — the archive API also reports cm in metric. Not introduced by this branch,
  but it's the identical fix and worth folding in (or ticketing).

### I2 — Canadian border cities error out instead of falling back (fix or mitigate before release)

**Severity: High (user impact) — pre-existing pattern, newly prominent.**
`isInUS` is a bounding-box check, and the CONUS box (lat 24.5–49.4,
lon −125…−66.9) contains most of Canada's population. Live results with
`source: "auto"`:

- Toronto (43.65, −79.38) → routed to NOAA → **error**
- Vancouver (49.28, −123.12) → **error**
- Windsor, ON (42.31, −83.04) → **error**

`get_forecast` fails identically (verified live), so this isn't a regression —
the plan mandated byte-identical boxes. But v1.12.0's headline is "global
current conditions," and the second-largest anglophone user base outside the US
gets a hard error unless the client knows to retry with `source: "openmeteo"`.
Northern Mexico (e.g. Tijuana at 32.5°N) has the same exposure.

- **Recommended fix (small):** in `auto` mode only, catch the NOAA
  point-lookup failure (`InvalidLocationError` / "Unable to provide data for
  requested point") and fall back to the Open-Meteo path, noting the fallback in
  the output. Explicit `source: "noaa"` should keep erroring as it does now.
  Applying the same fallback to `get_forecast` fixes the pre-existing hole.
- **Minimum mitigation if fallback is deferred:** append a hint to the error —
  *"Retry with source: 'openmeteo' for model-based data at this location."* —
  so AI clients can self-recover.

### I3 — "Recent Precipitation" section can render all zeros

**Severity: Low (cosmetic).** The section gates on raw `precipitation > 0`, but
values are displayed at 2 decimals (imperial), so trace amounts render as:

```
## Recent Precipitation
**Current:** 0.00 in
**Rain:** 0.00 in          ← live output, Sydney drizzle (0.1 mm ≈ 0.004 in)
```

Seen live at Sydney, Guam, and Ushuaia — any drizzle < 0.005 in triggers it.
**Fix:** gate on the rounded display value (e.g. ≥ 0.005 in / ≥ 0.05 mm), or
print "Trace" below the threshold.

### I4 — International `get_weather_summary` leaks a raw NOAA error for alerts

**Severity: Low (polish, but every international user sees it).** The default
`include` is `["current", "forecast", "alerts"]`, so every non-US summary ends
with:

```
## alerts (unavailable)
⚠️ Could not retrieve alerts data for this location: Parameter "point" is invalid: out of bounds
```

The graceful-degradation design works (the summary doesn't fail), but the
message leaks NOAA API internals and doesn't tell the user *why*.
**Fix:** in `weatherSummaryHandler`, check `isInUS(lat, lon)` before requesting
the alerts section and emit "Weather alerts are currently available for US
locations only." — clearer, and it saves a doomed NOAA round-trip on every
international summary.

## Observations (no action required for v1.12.0)

1. **US territories route to Open-Meteo.** Guam / USVI / American Samoa fall
   outside all four boxes, so `auto` uses model data even though NWS covers
   them. This matches `get_forecast`'s long-standing behavior, and the new
   `source: "noaa"` override now recovers the station when wanted. Notably, the
   live Guam NOAA observation (PGUM) was missing temperature, wind, and pressure
   entirely while Open-Meteo returned a full picture — model data may genuinely
   be the better default for sparse-station areas.
2. **`detail: "summary"` doesn't condense international daily forecasts.** On
   the Open-Meteo path `detail` only caps *hourly* entries; a `summary` London
   summary still prints seven full daily blocks. v1.11.0 behavior, not this
   branch — but worth a future look since the summary tool is the default entry
   point.
3. **`is_day` is requested and typed but never used** by the formatter. Harmless
   (one param in the URL); either use it (e.g. day/night flavored condition
   text) or drop it from `buildCurrentParams`.
4. **Wind direction prints degrees only** ("from 233°") on both paths —
   consistent, but a cardinal ("SW") would read better for non-technical users.
   Future polish.
5. **Test quality is good.** The new suites (`current-conditions-global`,
   `openmeteo-current`, `geography` isInUS block) genuinely drive the real
   handler with injected fakes, assert the negative (no NOAA calls on the
   non-US path), and cover unit-signature cache separation. The two bugs found
   live (I1 here, pressure in T8) were both *upstream-assumption* bugs that
   mocks structurally can't catch — a periodic live smoke test against real
   APIs (even manual, like this review) is the right complement.

## Release recommendation

Fix **I1** (small, self-contained) and decide on **I2** (fallback preferred;
error-hint mitigation at minimum) before tagging v1.12.0. I3/I4 are fast
follows that would noticeably polish the international experience the release
is named for. With I1 and I2 addressed, this feature delivers exactly what the
roadmap promised: accurate, unit-correct current conditions everywhere.
