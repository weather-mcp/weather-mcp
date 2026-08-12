# Global Conditions Hardening — Live Verification (2026-07-16)

**Status:** COMPLETE — all four hardening fixes verified working live;
follow-up findings N1 and N2 fixed same day (see "New findings" below)
**Parent:** `docs/global-conditions-hardening-plan.md` (fixes D1–D4 for review
findings I1–I4); grandparent `docs/global-current-conditions-review.md`
**Branch:** `feat/global-current-conditions` @ `3b595d8` (dist built 2026-07-16
00:03, confirmed newer than all `src/` files — the MCP servers under test ran
the hardened build)
**Method:** Live MCP calls through the configured `weather-local` (imperial,
all tools) and `weather-metric` servers, both pointed at the local
`dist/index.js`. 15 locations exercised (14 international + 1 US control),
covering every hardening fix plus the explicit-source and US-unchanged
acceptance criteria.

## Verdict

The international experience is dramatically improved. Every location that
previously hard-errored or leaked NOAA error text now returns clean, usable
output. All four fixes behave exactly as designed. Two **new** issues were
found (one functional, one cosmetic), both in the historical handler — details
in "New findings" below.

## Locations tested

| # | Location | Coords | Calls | Purpose |
|---|----------|--------|-------|---------|
| 1 | Toronto, Canada | 43.6532, −79.3832 | current, forecast, current(`source:noaa`) | D2 fallback (both tools) + explicit-source behavior |
| 2 | Vancouver, Canada | 49.2827, −123.1207 | current | D2 fallback (western US box) |
| 3 | Windsor, Canada | 42.3149, −83.0364 | current | D2 fallback (third border city from review) |
| 4 | London, UK | 51.5074, −0.1278 | summary | D4 alerts note |
| 5 | Sydney, Australia | −33.8688, 151.2093 | current | D3 trace floor (original repro site) |
| 6 | Portillo, Chilean Andes | −32.835, −70.129 | current (metric), historical ×2 (metric) | D1 snowfall (original repro site) |
| 7 | Ushuaia, Argentina | −54.8019, −68.303 | current (metric) | Southern-winter sanity |
| 8 | Queenstown, NZ | −45.0312, 168.6626 | summary (metric) | D4 + metric composite |
| 9 | Tokyo, Japan | 35.6762, 139.6503 | summary | D4 + hot/humid formatting |
| 10 | Mumbai, India | 19.076, 72.8777 | current | Monsoon region |
| 11 | Nairobi, Kenya | −1.2921, 36.8219 | current | Equatorial/African coverage |
| 12 | Reykjavik, Iceland | 64.1466, −21.9426 | summary | High-latitude (19.6 h daylight) |
| 13 | Cairo, Egypt | 30.0444, 31.2357 | current | Arid region |
| 14 | Guam (Hagåtña) | 13.4443, 144.7937 | summary | US territory outside `isInUS` boxes (known limitation) |
| 15 | Seattle, WA (US control) | 47.6062, −122.3321 | summary | US path unchanged |

## Fix-by-fix results

### D2 — Auto-mode NOAA → Open-Meteo fallback ✅

Toronto, Vancouver, and Windsor all previously returned a hard
`InvalidLocationError`/`DataNotFoundError` under `source: "auto"`. All three
now return full Open-Meteo current conditions with the explanatory note
directly under the heading:

> *NOAA does not cover this location; showing Open-Meteo model data instead.*

`get_forecast` at Toronto falls back identically (3-day Open-Meteo forecast,
same note). Acceptance criterion 1 met live, not just mocked.

- **Explicit `source: "noaa"` at Toronto still errors** with the NOAA
  coverage message — the fallback is correctly scoped to auto mode only.
- Accepted cost is visible but tolerable: border-city calls pay one failed
  NOAA round-trip before the Open-Meteo request (subjectively ~1–2 s extra on
  an uncached call; not instrumented).

### D1 — Metric snowfall unit conversion ✅

Portillo (Chilean Andes, mid-winter) under the metric server, live during
"Heavy snow showers":

```
## Recent Precipitation
**Current:** 0.3 mm
**Showers:** 0.1 mm
**Snowfall:** 2.1 mm
```

The 2.1 mm snowfall against 0.3 mm total precipitation is the plausible cm→mm
converted value; the pre-fix build would have printed **0.21 mm** (the raw cm
number mislabeled as mm — the exact 10× understatement from finding I1).

### D3 — Trace-precipitation display floor ✅

- Sydney reported **"Light drizzle"** conditions with **no**
  `## Recent Precipitation` section — the original all-zero
  ("**Current:** 0.00 in") repro no longer renders.
- Portillo's section (above) shows only breakout lines at/above the floor —
  the rain line is correctly omitted while showers and snowfall display.
- No other location rendered a zero-valued precipitation section.

### D4 — Clean US-only alerts note in summaries ✅

All five international summaries (London, Tokyo, Queenstown, Reykjavik, Guam)
ended with the informational section:

```
## Alerts

Weather alerts are currently available for US locations only.
```

No `⚠️ Could not retrieve alerts data … out of bounds` leak anywhere. This
also removes the doomed NOAA round-trip, so international summaries complete
in roughly two upstream calls instead of three.

### US control — unchanged ✅

Seattle's summary is the familiar full NOAA product: station observation
(KBFI), NOAA period forecast, and a real alerts section ("No active weather
alerts"). No fallback note, no behavior drift.

### General output quality (all 14 international sites)

Every location returned complete, sensible data: correct local timezones and
times (16:15 in Queenstown vs 04:15 in Reykjavik simultaneously), plausible
seasonal values (−12 °C Andes winter, 93 °F Tokyo heat with 107 °F feels-like,
Guam thunderstorm at 18 mph gusting 33), correct sunrise/sunset (19 h 37 m
Reykjavik daylight), and the "model-interpolated values, not station
observations" caveat on every Open-Meteo current-conditions block.

## New findings

### N1 (High, functional): recent-date historical weather hard-fails internationally — ✅ FIXED

**Fixed 2026-07-16 (same session).** Routing now checks `isInUS` before
choosing NOAA — recent international dates go to the Open-Meteo archive, which
was verified live to serve data through yesterday (recent days blend
ERA5T/model data; no 5-day gap). US-box border points NOAA rejects fall back
to Open-Meteo with the same note/error contract as D2 (transient NOAA errors
still propagate). Covered by `tests/unit/historical-routing.test.ts` (6 routing
cases) and re-verified live: Portillo and Toronto "yesterday" queries now
return hourly data; Seattle still uses NOAA. Original finding follows.

`get_historical_weather` for Portillo with `start_date: 2026-07-14` (2 days
ago) returns:

```
NOAA API Error: Unable to provide data for requested point -32.835,-70.129
This location may be outside NOAA's coverage area (US only).
```

The same location with `start_date: 2026-07-01` (15 days ago) works perfectly
via Open-Meteo. Root cause confirmed in code: routing in
`src/handlers/historicalWeatherHandler.ts:61` is date-only
(`useArchivalData = startTime < thresholdDate`); the recent-date branch
(`:206`) calls NOAA unconditionally — no `isInUS` check and no D2-style
fallback. So "what was the weather in Paris yesterday?" fails for every
international location. This is the same class of bug D2 just fixed for
current/forecast, and probably the top candidate for the next fix on this
branch. (Suggested shape: route recent international dates to Open-Meteo's
forecast API `past_days`, or check `isInUS` before choosing NOAA.)

### N2 (Low, cosmetic): historical location line mislabels southern latitudes — ✅ FIXED

**Fixed 2026-07-16 (same session).** Both sites now use a shared
`formatCoordinates` helper with proper hemisphere labels; verified live
(`32.8647°S, 70.1714°W`) and covered by two tests in
`tests/unit/historical-routing.test.ts`. Original finding follows.

Open-Meteo historical output prints `**Location:** -32.8647°N, 70.1714°W` —
longitude handles hemisphere correctly, but latitude is hardcoded `°N` with
the raw signed value (`historicalWeatherHandler.ts:87` and `:151`). Should
render `32.8647°S`.

### Observations (no action required)

- Guam behaves per the accepted limitation: treated as international
  (Open-Meteo model data + the US-only alerts note), even though NOAA/NWS
  actually covers Guam. Territory boxes remain deferred per the hardening
  plan's out-of-scope list.
- The performance cost/benefit landed as designed: international summaries
  are faster (no doomed alerts call), border-city auto calls slightly slower
  on first hit (one failed NOAA round-trip, then cached). No latency
  instrumentation was added; timings above are subjective.
- Prior review observations still stand (degrees-only wind direction, no
  day/night condition flavoring, verbose international daily forecasts under
  `detail: "summary"`).

## Suggested next steps for this branch

1. ~~**Fix N1** — international recent-date historical routing~~ ✅ Done
   2026-07-16.
2. ~~Fix N2 while in the file~~ ✅ Done 2026-07-16.
3. The branch looks ready for the v1.12.0 release gate — all four hardening
   acceptance criteria verified live, N1/N2 fixed and re-verified live, US
   path unchanged, full gate green (1,242 tests, 0 vulnerabilities).

## Re-run (fresh session, 2026-07-16, branch @ 046ba3b)

The full matrix was re-run in a fresh session with the servers running the
latest build (dist 2026-07-16 00:27, includes the committed N1 fix). **All
previously verified results reproduced; no regressions.** Highlights:

- **D2:** Toronto, Vancouver, and Windsor currents plus the Toronto forecast
  all fell back to Open-Meteo with the coverage note; explicit
  `source: "noaa"` at Toronto still errors as designed.
- **D1:** Portillo (metric, live "Heavy snow showers") again showed converted
  snowfall — 2.1 mm against 0.3 mm precipitation. Historical metric snowfall
  values are also converted (e.g. 11.2 mm snowfall on 1.6 mm precipitation
  hours).
- **D3:** Sydney "Light drizzle" rendered no all-zero precipitation section.
- **D4:** London, Tokyo, Queenstown, Reykjavik, and Guam summaries all ended
  with the clean US-only alerts note; no NOAA error leak.
- **N1 (committed as 046ba3b):** "Yesterday" (2026-07-15) queries for Portillo
  and Toronto returned 24 hourly Open-Meteo observations (Toronto with the
  fallback note); Seattle recent dates still route to NOAA.
- **N2:** Hemisphere labels correct (`32.8647°S, 70.1714°W`; `79.4117°W`).
- **US control:** Seattle summary unchanged — KBFI station observation, NOAA
  period forecast, real alerts section.
- Ushuaia, Mumbai, Nairobi, and Cairo currents all returned plausible,
  correctly localized data.

### N3 (Low, pre-existing): US same-day recent-history range returns nothing — ✅ FIXED

**Fixed 2026-07-16 (same session).** Date-only `end_date` values are now
extended to end-of-day (clamped to now — NOAA rejects future end times)
before the NOAA observations query; explicit datetime ends are untouched,
and the Open-Meteo path is unchanged (it already treats calendar dates
inclusively). Covered by three tests in
`tests/unit/historical-routing.test.ts` and verified live against the
rebuilt dist: the Seattle 2026-07-15 same-day query now returns NOAA
observations. Original finding follows.

Seattle `get_historical_weather` with `start_date = end_date = 2026-07-15`
returned "No historical observations found", while the identical
international query works (Open-Meteo treats calendar dates inclusively).
Root cause: `historicalWeatherHandler.ts:73-74` parses both dates with
`new Date("YYYY-MM-DD")` (midnight UTC), so a same-day range is a zero-width
window on the NOAA station-observations path. A wider range (2026-07-13 to
2026-07-14) returns NOAA data normally — routing is fine; only the
degenerate same-day range is affected. Not a regression from this branch
(the NOAA recent path always parsed dates this way), but the now-working
international path makes the asymmetry visible. Suggested fix: extend
`endTime` to end-of-day (or +1 day) before querying NOAA observations.

### Observation (cosmetic)

Historical hourly output can print `**Precipitation:** 0.00 in` for trace
hours (0.1 mm rounds to 0.00 in imperial — Toronto 7/15 4 PM and 6 PM). The
D3 trace floor applies to current conditions only; the historical formatter
prints any hour with nonzero source precipitation. Metric output is
unaffected (0.10 mm displays meaningfully).
