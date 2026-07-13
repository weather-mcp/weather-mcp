# Live Test Report — Weather MCP Server v1.8.2

**Date:** 2026-07-07
**Tester:** Claude Code (live MCP session) — ~76 test cases across all 16 tools
**Build under test:** Local `dist/` build. The session's server process launched from the pre-release build, but `git diff v1.8.0..v1.8.2 -- src/` is empty (both releases were docs-only), so all findings apply verbatim to v1.8.2 / current `main` (`cd29f7a`).
**Method:** Exploratory edge-case testing via live MCP tool calls — polar coordinates, the antimeridian, Null Island, 1940s reanalysis data, world extremes (Vostok, Death Valley), unicode/injection inputs, invalid raw JSON-RPC requests bypassing client schema validation, and full write-path exercise of saved locations (original `locations.json` backed up and verified byte-identical after cleanup).

---

## Executive Summary

The server is in very good shape: **all 16 tools returned useful, well-formatted responses across every happy path and nearly every extreme input**, error messages are consistently helpful, server-side input validation is airtight (hostile raw JSON-RPC requests were all rejected cleanly with no crashes or stack traces), and the saved-locations write path left storage byte-identical after a save/update/remove cycle.

Seven genuine defects were found. The two most important:

1. **Sunrise/sunset times are wrong for all non-US (Open-Meteo) forecasts** — a timezone double-shift renders Tokyo's sunrise as "5:32 PM".
2. **The lightning tool reports "🟢 SAFE, 0 strikes" from an empty buffer** — including at NYC *during an active thunderstorm* — because its MQTT strike buffer only accumulates while the process is running. For a safety-critical tool, a fresh server always reports "safe".

| Severity | Count | IDs |
|----------|-------|-----|
| High (safety/correctness) | 2 | F1, F2 |
| Medium | 3 | F3, F4, F5 |
| Low | 2 | F6, F7 |
| Observations (polish) | 8 | O1–O8 |

---

## Findings (Defects)

### F1 — Sunrise/sunset double timezone shift on Open-Meteo forecasts (HIGH)

**Where:** `src/handlers/forecastHandler.ts:508-514`

Open-Meteo returns sunrise/sunset as timezone-naive, *location-local* ISO strings (the API is called with a `timezone` parameter). The handler does:

```ts
DateTime.fromISO(daily.sunrise[i], { setZone: false }).setZone(forecast.timezone)
```

`setZone: false` parses the naive string in the **server's** zone, then `.setZone()` converts to the location zone — applying the offset twice.

**Evidence (server in EDT):**
- Tokyo: "Sunrise: 5:32 PM / Sunset: 8:00 AM" (actual: ~4:32 AM / ~7:00 PM JST). 4:32 EDT → 08:32 UTC → 17:32 JST = 5:32 PM, exact match for the double shift.
- Null Island (0,0): "Sunrise 10:01 AM" in Etc/GMT (actual ~6:01 AM UTC) — +4 h, the EDT offset.
- Fiji: "Sunrise: 10:29 PM".

US forecasts are unaffected only because the NOAA path doesn't render sunrise. **Fix:** parse directly in the location zone: `DateTime.fromISO(daily.sunrise[i], { zone: forecast.timezone })`.

### F2 — Lightning tool reports "SAFE" from an empty strike buffer (HIGH, safety)

**Where:** `src/services/blitzortung.ts` (rolling 2-h in-memory MQTT buffer)

The strike buffer only fills while the server process is running and connected. A freshly started server answers every query with "🟢 Safety Status: SAFE — Total Strikes: 0" for up to 2 hours, regardless of actual conditions.

**Evidence:** NYC (500 km / 120 min) returned SAFE/0 strikes while NYC's own NOAA forecast showed active "Showers And Thunderstorms" (81% precip) at query time. Congo basin — the most lightning-active region on Earth — also returned 0 at max radius/window. Tampa in July, 0.

**Recommendation:** Track connection/collection start time; when buffer age < requested `timeWindow`, say so ("monitoring for 3 of the requested 120 minutes — results may be incomplete") and downgrade the confidence of the SAFE verdict instead of implying verified absence of lightning.

### F3 — River conditions leak raw `-999` sentinels and year-1 dates (MEDIUM)

**Where:** river conditions formatter (NWPS/USGS data path)

Gauges without current observations/forecasts render NWPS missing-data sentinels verbatim: "Forecasted Stage: **-999.00 ft**", "Flow Rate: **-999.00 kcfs (-999000 cfs)**", "Valid Time: **Dec 31, 1, 6:09 PM**" (year-1 epoch). In New Orleans — the most flood-critical city tested — 4 of the 5 nearest gauges showed only this noise. Also: "Flood Category: **✅ NOT DEFINED**" pairs a green check with an undefined category, and the flood-stage threshold values (action/minor/moderate/major) promised by the tool description never render. Core discovery works well (530 gauges at max radius, correct distances, clean truncation).

### F4 — Wildfire safety assessment ignores fire size (MEDIUM)

A 1-acre brush fire 14.5 km from Boston produced "🟠 **HIGH ALERT** … Prepare for possible evacuation". The assessment is distance-only. Also: unreported sizes render as literal "**Size:** 0 acres (0 hectares)" instead of "not yet reported", and "1 acres" grammar. Discovery/rendering otherwise solid (18 fires near Boise at 500 km, Alaska interior coverage, containment bars, truncation notes).

### F5 — Dead satellite-imagery URLs outside GOES coverage (MEDIUM)

**Where:** `get_weather_imagery` type=satellite

Tokyo returns a GOES-East tile URL that **404s** (verified with curl; the equivalent Denver tile returns 200 with a 111 KB PNG). The disclaimer says out-of-range locations "may appear blank" — the link is actually broken. Should detect GOES-East/West longitude coverage and return a clear "outside satellite coverage" error (or select GOES-West where applicable).

### F6 — Smart update silently wipes `description`, `alternateNames`, `notes` (LOW)

**Where:** `src/handlers/savedLocationsHandler.ts:192-194`

The partial-update path preserves coordinates, timezone, admin fields, and activities, but `description`/`alternateNames`/`notes` are always taken from the incoming args — an activities-only update overwrites them with `undefined`. **Reproduced:** saved `test-geocode` with a description; updated only `activities`; description gone from `locations.json`.

### F7 — Saved-location output advertises `location_name` on tools that don't support it (LOW)

`save_location` and `get_saved_location` responses suggest `get_current_conditions(location_name=…)`, `get_alerts(location_name=…)`, `get_air_quality(location_name=…)` and say "can be used with **any** weather tool". Only `get_forecast` accepts `location_name` (per schemas and CLAUDE.md). Following the printed examples produces errors.

---

## Observations (polish, not defects)

| ID | Tool | Observation |
|----|------|-------------|
| O1 | get_forecast | `days=16` at a US/NOAA location silently returns 7 days (14 periods) with no clamp notice |
| O2 | get_alerts | With `active_only=false`, header still reads "14 **active** alerts found" while listing expired alerts |
| O3 | get_alerts | Non-US point (Toronto) surfaces raw NOAA `Parameter "point" is invalid: out of bounds` instead of the friendly "outside NOAA coverage (US only)" message other tools use |
| O4 | get_historical_weather | "Period:" header is a day earlier than requested (e.g. request 1940-01-01 → "12/31/1939") — same server-local-TZ formatting family as F1 (`historicalWeatherHandler.ts:56` uses `toLocaleDateString()` on naive timestamps) |
| O5 | get_historical_weather | "Number of observations" shows the pre-`limit` fetch count (48) while only `limit` entries (10) render; hours with no data render as bare empty headings; NOAA path is newest-first while Open-Meteo path is oldest-first |
| O6 | get_marine_conditions | Landlocked "Unknown" state uses the 🟤 icon that the legend defines as ">9m extremely dangerous"; message could say "not an ocean location" |
| O7 | get_river_conditions / get_wildfire_info | Non-US empty results say "no gauges/fires found — area is clear" without disclosing US-only coverage (matters during e.g. Australian fire season) |
| O8 | list vs get saved location | List shows "Saved: 11/16/2025" (UTC date) while detail shows "11/15/2025, 11:52:45 PM" (local) for the same record |

**Not a bug:** `check_service_status` reported "Installed Version: 1.8.0" during testing — the session's server process predated the release commit; version is read correctly from `package.json` at startup (`src/index.ts:55-63`).

---

## Per-Tool Results

### 1. check_service_status — ✅ PASS
NOAA + Open-Meteo status, cache statistics, version + upgrade tip all rendered.

### 2. get_forecast — ✅ PASS (F1, O1)
- NYC 7-day + `include_normals` + `include_severe_weather`: NOAA, 14 periods, thunderstorm probability + climate-normals departure sections.
- Tokyo 16-day: full 16 days via Open-Meteo. Seattle hourly: 24 hourly periods via NOAA.
- **North Pole (90,0):** 24 h daylight, July snow. **South Pole (-90,0):** −50 °F, 0 h polar night, elevation 2774 m. **Null Island (0,0):** ocean point returns data.
- **Antimeridian (−16.5, ±179.99):** both sides work, consistent Pacific/Fiji timezone.
- `source=noaa` for Paris → clean "outside NOAA coverage" error. `location_name="home"` resolves; `location_name="narnia"` → helpful error listing available aliases.

### 3. get_current_conditions — ✅ PASS
Denver (+fire weather indices, mixing height, transport wind, climate normals), Utqiaġvik AK (station PABR, Arctic), San Juan PR (station TJSJ, territories covered, heat index), London → clean US-only error.

### 4. get_alerts — ✅ PASS (O2, O3)
Miami: live Heat Advisory with full CAP detail (severity/urgency/certainty, onset, instructions, recommended response). OKC `active_only=false`: 14 alerts including expired July 4 severe-thunderstorm warnings. Anchorage: clean no-alerts state.

### 5. get_historical_weather — ✅ PASS (O4, O5)
- **Berlin 1940-01-01** (first day of the archive): works. **D-Day, Normandy 1944-06-06:** overcast, 11–12 mph westerly — matches the historical record. **Vostok 1983-07-21** (Earth's coldest recorded day): −106 °F reanalysis at 3498 m. **Death Valley 2021-07-09:** 109 °F at midnight, elevation −59 m handled.
- Recent US dates correctly route to "NOAA Real-time API".
- Error paths all excellent: future date, start > end, pre-1940, and `"not-a-date"` each get specific, actionable messages.

### 6. search_location — ✅ PASS
Unicode "東京" → Tokyo JP; one-letter village "Y, Somme, France" found; "Springfield" ×10 disambiguated with confidence ranking; nonsense query → 3-provider fallback report (Census.gov, Nominatim, Open-Meteo) with suggestions; SQL-injection string treated as a literal query — no injection surface.

### 7. get_air_quality — ✅ PASS
Delhi: European AQI 81 "Very Poor" (correct non-US scale) with US AQI 140 cross-reference, health guidance, UV with clear-sky note, aerosol optical depth. LA: US AQI scale + 24 h banded forecast (120 h of data). Near South Pole: pristine air (PM2.5 0.4 µg/m³), UV 0 in polar night.

### 8. get_marine_conditions — ✅ PASS (O6)
Mid-Atlantic: full wind-wave/swell decomposition, currents in m/s + knots, safety legend. **Drake Passage + forecast:** 5.3 m now, 5-day forecast peaking 8.0 m "Very Rough". **Lake Michigan:** dedicated Great Lakes NOAA path with region label. Landlocked Denver: graceful no-data state.

### 9. get_weather_imagery — ⚠️ PASS with F5
Miami precipitation URL verified **200 OK** (PNG). Chicago animated radar: 13 frames. Denver satellite tile verified **200 OK** (111 KB PNG). Tokyo satellite: dead link (F5).

### 10. get_lightning_activity — ❌ FAIL (F2)
All queries (Tampa 200 km/120 min, Congo basin 500 km/120 min, NYC-under-thunderstorm 500 km/120 min, min-bounds 1 km/5 min) returned "SAFE, 0 strikes" from the cold buffer. Formatting, parameter bounds, and disclaimers are fine; the data path is the problem.

### 11. get_river_conditions — ⚠️ PASS with F3 (parallel agent)
St. Louis: 16 gauges, nearest Mississippi gauge 1.7 km with real stage/flow/forecast. Leadville at max 500 km radius: 530 gauges, clean nearest-5 truncation. London: graceful zero-gauge state. Sentinel leakage per F3.

### 12. get_wildfire_info — ⚠️ PASS with F4 (parallel agent)
Sacramento: Antelope fire (NV) with distance, containment bar, days active. Boise 500 km: 18 fires across 5 states. Fairbanks: 19 Alaska-interior fires. Boston: real 1-acre incident found (over-alerting per F4). Sydney: no crash (disclosure gap per O7).

### 13–16. save_location / list_saved_locations / get_saved_location / remove_saved_location — ✅ PASS (F6, F7, O8)
- Geocoded save ("Reykjavík, Iceland"), coordinate save with unicode alias `Test-Coords-Café` → normalized `test-coords-café`, activities/notes/alternate-names round-trip.
- Case-insensitive lookup including unicode fold (`TEST-COORDS-CAFÉ` → `é`).
- End-to-end: saved McMurdo alias → `get_forecast(location_name=…)` → correct Antarctic polar-night forecast.
- Validation: missing query+coords, >50-char alias, >50-char activity, remove/get of nonexistent alias — all clean, specific errors (nonexistent-alias errors list available aliases).
- After removing test entries, `locations.json` was **byte-identical** to the pre-test backup.

### Raw JSON-RPC hostile-input tests (bypassing client schema validation) — ✅ PASS
Sent directly to a fresh `dist/index.js` over stdio: `latitude: 999` → "Invalid latitude: 999. Must be between -90 and 90"; string latitude → coordinates-or-location_name guidance; empty args → "must be a finite number, received undefined"; unknown tool name → clean not-enabled error; `radius: 99999` → "must be a number between 1 and 500 km"; 60-char alias → "50 characters or less". No crashes, no stack traces, no internal detail leakage.

---

## Suggested Fix Priority

1. **F1** — one-line fix in `forecastHandler.ts:508` (`{ zone: forecast.timezone }`), plus the same audit for `historicalWeatherHandler.ts` date headers (O4).
2. **F2** — disclose buffer/collection age in lightning reports; a SAFE verdict from a cold buffer is a false negative in a safety-critical tool.
3. **F3** — map NWPS `-999` sentinels and year-1 timestamps to "N/A"; render flood-stage thresholds.
4. **F5** — coverage check before emitting satellite URLs.
5. **F4, F6, F7, O-series** — small formatter/copy fixes.
