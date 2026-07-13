# Bug Report — Full-Tool Test Session (2026-07-13)

**Server version:** 1.11.0
**Branch:** `release/features-1.10.0`
**Method:** Exercised all 17 MCP tools against live APIs, home base **Clare, MI**
(43.8195, -84.7686), using off-location coordinates for marine / wildfire / lightning.

**Summary:** 3 issues found, all addressed — 1 significant bug (city_name geocoding, fixed),
1 display bug (river sentinels, fixed), 1 inherent data-availability limitation (lightning
first-query coverage, mitigated via startup pre-warm + clearer messaging). All 17 tools
return correct data on the coordinate and saved-`location_name` paths.

**Status:** BUG-1 ✅ fixed · BUG-2 ✅ fixed · BUG-3 ✅ mitigated · 1,165 tests pass ·
`dist/` rebuilt (restart to load).

---

## BUG-1 — `city_name` geocoding fails for US queries (limit=1) — ✅ FIXED

**Severity:** High — the v1.11.0 "universal location resolution" `city_name` feature was
fully non-functional for US places. Every `get_*` call using `city_name` failed.

### Symptom
```
get_forecast(city_name="Clare, MI")      -> "No locations found matching "Clare, MI"."
get_weather_summary(city_name="Detroit, Michigan") -> same error
search_location(query="Clare, MI", limit=1)        -> same error   (limit=1 reproduces it)
search_location(query="Clare, MI")                 -> OK           (default limit=5 masks it)
```
Error text: `Tried 3 provider(s): Census.gov: No results found; Nominatim: No results found; Open-Meteo: No results found`

### Root cause
Two interacting defects in `src/services/geocoding.ts`:

1. **Space encoding.** Axios's default param serializer encodes spaces as `+`
   (`q=Clare,+MI`) rather than RFC-3986 `%20` (`q=Clare%2C%20MI`).
2. **Nominatim `+` / limit=1 quirk.** For a `+`-encoded query, Nominatim returns
   **0 results at `limit=1`** but 2 results at `limit>=2`. With proper `%20` encoding,
   `limit=1` correctly returns 1 result.

The on-demand resolver hard-codes `geocode(cityName, 1)`
(`src/utils/locationResolver.ts:238`), so `city_name` lookups always hit both landmines.
`search_location`'s default `limit=5` accidentally avoided the second one, which is why
that tool appeared to work while `city_name` did not — same underlying `GeocodingService`
singleton (`src/index.ts:141`).

### Ground truth captured during diagnosis
```
# Direct Nominatim, "+"-encoded query:
q=Clare,+MI     limit=1 -> 0 results
q=Clare,+MI     limit=2 -> 2 results
# Direct Nominatim, %20-encoded query:
q=Clare%2C%20MI limit=1 -> 1 result     <-- what the fix produces
```

### Fix (`src/services/geocoding.ts`)
1. Added `rfc3986ParamsSerializer()` (spaces -> `%20`) and applied it as
   `paramsSerializer` on all three provider axios clients (Census, Nominatim, Open-Meteo).
   This is the true root-cause fix.
2. Added a defensive result floor: `GeocodingService.geocode()` now requests
   `Math.max(limit, PROVIDER_RESULT_FLOOR /* 5 */)` from providers and slices the result
   down to the caller's `limit`, so no lookup is ever at the fragile upstream `limit=1`
   boundary.

### Verification
- `GeocodingService.geocode("Clare, MI", 1)` -> Clare County (was: error) — against **live
  Nominatim**.
- `resolveLocationAsync({city_name:"Clare, MI"})` -> resolves + emits correct
  `**Location:** Clare County, Michigan, United States (43.9689, -84.8505)` header.
- Added `tests/unit/geocoding.test.ts` (6 tests: `%20` encoding, undefined/null omission,
  limit=1 regression, floor=5 request, slice-to-limit, caller-limit > floor).
- Full suite: **1,155 passed** (was 1,149). `npm run build` clean.

### Post-fix note
All four MCP instances launch from `.../weather-mcp/dist/index.js` (see workspace
`.mcp.json`), so **restarting the Claude Code session relaunches them with the rebuilt,
fixed code** — no npm publish required to test.

---

## BUG-2 — River forecast renders no-data sentinels literally — ✅ FIXED

**Severity:** Low — cosmetic; current observations are correct, only the "no active
forecast" case was ugly.

**Symptom** (`get_river_conditions`, Clare 75 km radius): gauges with no current forecast
printed raw sentinels instead of omitting the forecast:
```
### Forecast
**Valid Time:** Dec 31, 1, 6:27 PM
**Forecasted Stage:** -999.00 ft
**Forecasted Flow:** -999.00 kcfs
**Forecasted Category:** ⚪ FCST NOT CURRENT
```
`-999.00` is NWPS's missing-value sentinel and `Dec 31, 1` is a year-0001 placeholder
timestamp. The handler's `!== null` guards let `-999` through and formatted the placeholder
date literally.

**Fix** (`src/handlers/riverConditionsHandler.ts`):
- `isRealValue()` — treats `null`/`undefined`/non-finite and values `<= -900` (the NWPS
  `-999`/`-999999` sentinels) as "no data". Replaces the `!== null` checks on both observed
  and forecast stage/flow, and the flood-stage percentage calc.
- `hasPlausibleValidTime()` — rejects unparseable times and any year `< 2000` (kills the
  year-0001 placeholder).
- `isUsableForecast()` — a forecast is rendered only if it has at least one real value AND a
  plausible timestamp; otherwise the whole `### Forecast` block is suppressed.

**Verification:** `tests/unit/riverConditions.test.ts` (8 tests covering sentinel values,
year-0001 times, unparseable times, and the "one real value is enough" case). Full suite
green.

---

## BUG-3 — Lightning reports 0.0-min live coverage on first query — ✅ MITIGATED

**Severity:** Low / inherent limitation — output was already honest; the gap was missing
coverage on first use and unclear "why".

**Symptom** (`get_lightning_activity`, tried Clare and a Tampa FL summer afternoon):
```
## 🟢 Safety Status: SAFE (LIMITED DATA)
**Monitoring Coverage:** 0.0 of N minutes ⚠️
```

**Root nature:** NOT a code defect. Blitzortung is a **real-time MQTT feed with no
historical backfill** (`src/services/blitzortung.ts`). Strikes only buffer for an area
*after* it is first subscribed (lazily, on first query), so a location's first lookup can
never show more than the ~10 s post-subscribe wait — reported as 0.0-min coverage. Strikes
cannot be retroactively fetched.

**Mitigation applied (pre-warm + clearer messaging):**
- `BlitzortungService.prewarmLocation()` — subscribes an area (no wait/read), best-effort,
  swallows its own errors.
- `prewarmLightningMonitoring()` in `src/index.ts` subscribes all **saved locations'**
  geohashes at startup (non-blocking), so their coverage accumulates before the user asks.
  Gated on the lightning tool being enabled; opt out with `WEATHER_LIGHTNING_PREWARM=false`.
  Trade-off: keeps a persistent MQTT connection open from boot.
- Handler now appends a "*Why:*" explainer making clear that near-zero coverage is expected
  on a first query, that saved locations are pre-warmed, and that history cannot be
  backfilled.

**Still true after the fix:** a brand-new (non-saved) location's *first* query — and the
first query immediately after a restart, before coverage accrues — will still show low/zero
coverage. This is fundamental to the live feed. Verified via startup smoke test (server
logs "Pre-warming lightning monitoring for saved locations" → connects → subscribes;
stdout stays clean). Messaging locked by `tests/unit/lightningMessaging.test.ts`.

**New env var:** `WEATHER_LIGHTNING_PREWARM` (default on) — set `false` to disable startup
pre-warming and its always-on MQTT connection.

---

## Tools verified healthy (coordinate / `location_name` paths)

`check_service_status`, `search_location` (limit>=2), `get_forecast`,
`get_current_conditions` (+fire weather, +normals), `get_alerts` (live Heat Advisory),
`get_weather_summary` (all 5 sections), `get_historical_weather`, `get_air_quality`,
`get_marine_conditions`, `get_weather_imagery` (radar frames + GOES satellite),
`get_river_conditions` (16 gauges; see BUG-2), `get_wildfire_info` (8 active CA fires),
`save_location`, `list_saved_locations`, `get_saved_location`, `remove_saved_location`.
After BUG-1's fix, all of these also work via `city_name`.

---

## How to verify after restarting the session
All fixes ship in `dist/` (rebuilt); the four MCP instances relaunch `node dist/index.js`
on restart.

- **BUG-1 (city_name):** `get_forecast(city_name="Clare, MI")` → forecast with a
  `**Location:** Clare County, Michigan, United States (...)` header, not an error. Also try
  `get_weather_summary(city_name="Detroit, Michigan")` and `get_forecast(city_name="Paris, France")`.
- **BUG-2 (river sentinels):** `get_river_conditions(location_name="home")` → gauges with no
  real forecast should simply omit the `### Forecast` block; no `-999.00` or `Dec 31, 1`
  anywhere.
- **BUG-3 (lightning):** `get_lightning_activity(location_name="home")` → still expect
  "LIMITED DATA" right after restart, but now with a "*Why:*" explainer. Coverage for saved
  locations should climb on repeat queries a few minutes apart (pre-warm). Set
  `WEATHER_LIGHTNING_PREWARM=false` to disable startup pre-warming.

## Test suite
1,165 tests pass (was 1,149; +16: geocoding 6, river 8, lightning messaging 2). `npm run
build` clean.
