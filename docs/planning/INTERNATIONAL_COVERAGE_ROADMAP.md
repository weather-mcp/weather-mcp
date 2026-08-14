# International Coverage Roadmap

**Created:** 2026-07-15
**Status:** In progress — Phase 1 shipped in v1.12.0 (2026-07-15); Phases 2–5 proposed. Per-idea status is tracked in the [planning index](./README.md).
**See also:** [FORK_DERIVED_IDEAS.md](./FORK_DERIVED_IDEAS.md) — the 2026-08 fork review independently surfaced Phases 2 and 4 (global rivers, NASA FIRMS wildfire).
**Goal:** Extend the remaining US-only tools (`get_alerts`, `get_river_conditions`, `get_wildfire_info`) to worldwide coverage using free, open APIs, preserving the project's zero-cost model.

## Current Coverage Inventory

Already global (no work needed):

| Tool | Provider | Coverage |
|------|----------|----------|
| `get_forecast` | NOAA (US) / Open-Meteo (auto-select) | Global |
| `get_historical_weather` | Open-Meteo | Global, 1940–present |
| `get_air_quality` | Open-Meteo | Global |
| `get_marine_conditions` | Open-Meteo | Global |
| `get_weather_imagery` | RainViewer | Global |
| `get_lightning_activity` | Blitzortung.org | Global |
| `search_location` / geocoding | Nominatim/OSM | Global |
| `get_current_conditions` | NOAA (US) / Open-Meteo (auto-select) | Global (since v1.12.0 — Phase 1) |

US-only today:

| Tool | Provider | Gap |
|------|----------|-----|
| `get_alerts` | NOAA CAP | US alerts only |
| `get_river_conditions` | NOAA NWPS + USGS | US gauges only |
| `get_wildfire_info` | NIFC | US incidents only |
| Fire weather indices | NOAA gridpoint | Computed from US-only data |
| Climate normals (`include_normals`) | NCEI | US stations only |

The auto-select pattern to replicate everywhere: `forecastHandler.ts:235` (US → NOAA, elsewhere → Open-Meteo).

## Priority 1 — Global current conditions (no new provider) ✅ DONE (v1.12.0)

**Design plan:** `docs/plans/global-current-conditions-plan.md` (implemented 2026-07-15)

**Shipped:** `OpenMeteoService.getCurrentConditions()` plus US/non-US auto-select in
`currentConditionsHandler.ts`, routed by the shared `isInUS` helper in
`src/utils/geography.ts` and overridable with a `source` parameter.

**Leftover now closed (v1.17.0):** the aviationweather.gov METAR supplement
below — carried as "not taken up, remains available as a future option" since
2026-07-15 — shipped on `feat/metar` as `source: 'metar'` on
`get_current_conditions`. See [`docs/plans/metar-plan.md`](../plans/metar-plan.md).
Non-US current conditions can now be **real station observations** rather than
only model-interpolated values, though `auto` still defaults to Open-Meteo
because a METAR measures at an airport while the model estimates at the
caller's exact coordinates. Phase 1 is complete.

**API:** Open-Meteo forecast API `current=` parameters (temperature, humidity, apparent temperature, wind, gusts, pressure, precipitation, cloud cover, weather code).

- Effort: Small. `OpenMeteoService` already exists; add a `getCurrentConditions()` method and the US/non-US auto-select fallback in `currentConditionsHandler.ts`.
- Output note: model-interpolated values, not station observations — label the data source accordingly (as the forecast handler does).
- ~~Optional supplement: real station observations worldwide via the aviationweather.gov data API (global METARs by ICAO station, JSON, no key, 100 req/min): https://aviationweather.gov/data/api/~~ — **shipped in v1.17.0** (see the note above); implemented via bbox search rather than by ICAO id, since the caller supplies coordinates, not a station.
- License: Open-Meteo free for non-commercial use, CC-BY attribution.

## Priority 2 — Global river/flood data (no new provider)

**API:** Open-Meteo Flood API — GloFAS v4 river discharge, ~5 km resolution, daily forecast to 210 days, reanalysis back to 1984. https://open-meteo.com/en/docs/flood-api

- Effort: Small–medium. New endpoint on the existing Open-Meteo service; route non-US requests in `riverConditionsHandler.ts`.
- Output note: river *discharge* (m³/s) with ensemble percentiles — no flood-stage categories like NWPS. Present as discharge vs. historical percentiles.
- **UK supplement (later):** Environment Agency flood-monitoring API — real-time gauge levels and flood warnings for ~3,200 stations in England; Open Government Licence, no registration. https://environment.data.gov.uk/flood-monitoring/doc/reference

## Priority 3 — International alerts (region-routed CAP sources)

Route by country code (already available from Nominatim results and stored on saved locations). CAP is a shared format — one internal alert model covers all sources.

| Region | API | Notes |
|--------|-----|-------|
| US | NOAA (existing) | No change |
| Europe (30+ countries) | MeteoAlarm CAP/Atom feeds — https://api.meteoalarm.org/ | Free; EUMETNET aggregate of national met services; attribution required; alerts must be shown unmodified |
| Canada | MSC GeoMet-OGC-API — https://api.weather.gc.ca/ | Free, anonymous, OGC API Features with weather-alerts collection (also has current conditions + hydrometric data) |
| Rest of world | WMO SWIC / Alert-Hub.org CAP feeds — https://severeweather.wmo.int/, https://www.alert-hub.org/ | Aggregates official national CAP feeds globally; evaluate feed stability before committing |

- Effort: Medium. New `meteoalarm.ts` and `geomet.ts` services + country routing in `alertsHandler.ts`; graceful "not yet covered" message elsewhere.
- Watch later: KDE FOSS Public Alert Server (open-source global CAP aggregator with JSON API, pre-production as of mid-2026): https://github.com/KDE/foss-public-alert-server

## Priority 4 — Global wildfire (NASA FIRMS) ✅ DONE (v1.20.0)

**API:** NASA FIRMS — global MODIS/VIIRS satellite fire detections within ~3 hours. Area and country endpoints, CSV/JSON. https://firms.modaps.eosdis.nasa.gov/api/

Shipped on `feat/global-wildfire` targeting v1.20.0 — see
[`docs/plans/global-wildfire-plan.md`](../plans/global-wildfire-plan.md).
The implementation went **keyless-first** (better than planned here): the
tool works globally with zero keys via FIRMS' keyless 24 h regional flat
CSVs, and the optional `FIRMS_MAP_KEY` upgrades to Area-API bbox queries
with `day_range` 1–5 — the "without it, stays US-only" fallback in the
original note below never became necessary. Detections are clustered (2 km,
FRP-descending) with an honest hotspots-not-incidents framing.

- Free MAP_KEY optional; 5,000 requests / 10 min (keyed path).
- Output note: FIRMS returns satellite *hotspots* (lat/lon, brightness, confidence, FRP) — not named incidents with acreage/containment like NIFC. Shipped with a distinct clustered output format.
- Europe supplement (still open): Copernicus EFFIS fire-danger forecast (free, open data, but WMS-based — clunkier): https://forest-fire.emergency.copernicus.eu/applications/data-and-services

## Priority 5 — Polish items (small, independent)

1. **met.no Locationforecast as fallback/second-opinion forecast source** — free, global (ECMWF HRES), no key; requires identifying User-Agent (already sent for Nominatim) and CC-BY 4.0 attribution. https://api.met.no/weatherapi/locationforecast/2.0/documentation
2. **Global climate normals** — compute from Open-Meteo historical archive (already integrated) when outside US, instead of NCEI.
3. ~~**Global fire weather indices**~~ — ✅ **Shipped** on `feat/global-fire-weather` targeting v1.20.0; [`docs/plans/global-fire-weather-plan.md`](../plans/global-fire-weather-plan.md). **The premise above was wrong** and design exploration corrected it: there were no `fireWeather.ts` formulas to run — that module *interprets* five indices NOAA pre-computes on its gridpoint API, and nothing in the codebase computed a fire-weather index. The global path therefore computes a **Fosberg Fire Weather Index in-house** from Open-Meteo *current* values (not hourly), with soil moisture and VPD as dryness context, framed in-output as server-derived rather than an agency rating. Descoped to ideas: global Haines via pressure-level variables, and Fosberg on the METAR source.
4. **UK river gauges** — see Priority 2 supplement.

## Licensing Summary

| Provider | Cost | Key | License / condition |
|----------|------|-----|---------------------|
| Open-Meteo (current, flood) | Free (non-commercial) | None | CC-BY attribution |
| MeteoAlarm | Free | None | Attribution; display alerts unmodified |
| MSC GeoMet (Canada) | Free | None | Attribution (Environment and Climate Change Canada) |
| NASA FIRMS | Free | MAP_KEY (free signup) | Rate limit 5,000/10 min |
| MET Norway | Free | None (User-Agent required) | CC-BY 4.0 |
| UK Environment Agency | Free | None | Open Government Licence |
| aviationweather.gov | Free | None | 100 req/min |
| Copernicus EFFIS | Free | None | Copernicus open data policy |

All options preserve the zero-cost model; only FIRMS breaks the zero-key model (kept optional).

## Suggested Sequencing

| Phase | Change | New provider? | Effort |
|-------|--------|---------------|--------|
| ~~1~~ ✅ | ~~Open-Meteo fallback in `get_current_conditions`~~ — shipped in v1.12.0 | No | Small |
| ~~2~~ ✅ | ~~Open-Meteo Flood API in `get_river_conditions`~~ — implemented for v1.15.0 (channel snapping per the live finding below). The **UK Environment Agency gauge supplement remains open** and moves to Phase 5. | No (new endpoint) | Small–medium |
| ~~3~~ ✅ | ~~MeteoAlarm + GeoMet alerts routing~~ — implemented for v1.19.0 (country routing via a cached Nominatim reverse lookup; all 38 MeteoAlarm slugs live-verified) | Yes (2, keyless) | Medium |
| ~~4~~ ✅ | ~~NASA FIRMS in `get_wildfire_info`~~ — implemented for v1.20.0 (keyless-first: regional flat CSVs with conservative inset region picking; optional key upgrades to Area-API bbox + multi-day, with a rolling-window correction for the API's calendar-day semantics) | Yes (free key, optional) | Medium |
| 5 | Polish: met.no fallback, global normals/FWI, UK gauges | Yes (keyless) | Small each |

Each phase is independently shippable as a minor release, following the existing pattern: types → validation → service → handler → registration in `src/index.ts` → tests → docs.

## Live verification notes (2026-08-12)

All APIs above were verified with real requests (summary table in the
[planning index](./README.md)). Corrections to what this document previously
claimed:

- **Phase 2 (Open-Meteo Flood)** — *shipped for v1.15.0; the snapping requirement
  below is what `src/utils/riverDischarge.ts` implements.* Works as described,
  **but** discharge is per
  ~5 km GloFAS grid cell and a cell that misses the river channel returns
  runoff noise, not the river (Memphis 35.125,-90.075 → 0.63 m³/s; one cell
  west → 11,640 m³/s). Any implementation must probe neighboring cells and
  snap to the max-discharge cell. Ocean/no-river points return HTTP 200 with
  all-null `river_discharge` arrays — detect and message, don't error-handle.
  Live API accepted `forecast_days` up to 366 (docs say 210; treat 210 as the
  contract).
- **Phase 3 (MeteoAlarm):** the keyless endpoint is
  `https://feeds.meteoalarm.org/api/v1/warnings/feeds-<country>` (JSON, full
  CAP fields, one fetch per country — no pan-Europe aggregate).
  `api.meteoalarm.org` (EDR + metadata/geocode APIs) returns 401 without a
  MeteoGate registration token. Keyless feeds carry geocodes (NUTS3/EMMA)
  but **no polygons** — sub-country lat/lon matching needs bundled geometry
  data or country-level granularity. `info[]` is duplicated per language
  (filter by `language`); `AllClear`/cancellation messages appear in-feed.
  Terms: display unmodified, attribute "EUMETNET – MeteoAlarm" (or the
  national service for single-country), include time of issue.
- **Phase 3 (MSC GeoMet):** the collection is **`weather-alerts`**, not
  `alerts`. Native `bbox=` filtering works; features carry real polygons and
  bilingual `_en`/`_fr` fields but are **not CAP-shaped** (no
  severity/urgency/certainty — closest: `alert_type`, `risk_colour_en`,
  `confidence_en`). ECCC licence: attribution required, alert content must
  not be altered.
- **Phase 3 (rest of world):** WMO SWIC's `wmo_all.json` + per-alert CAP XML
  are fetchable but self-labeled "Demo", undocumented, geometry-free, with
  no redistribution grant — **not production-usable**. Ship US+Canada+Europe
  with a clean "not yet covered" message elsewhere.
- **Phase 4 (NASA FIRMS):** area API verified live with a real MAP_KEY. The
  **country API is down** (docs say "currently not available") — build on
  area/bbox only. Day range max is **5**, not 10. Key errors are inconsistent
  (400/401, text body `Invalid MAP_KEY.`). Area-API CSV adds an `instrument`
  column and abbreviates `confidence` to `l/n/h` (flat files spell them out) —
  normalize both forms. **Keyless fallback exists:** flat 24h/48h/7d CSVs
  under `/data/active_fire/` (global ~12 MB, regional cuts much smaller,
  Range-request capable) — the optional key buys targeted bbox queries, not
  access itself.
- **Phase 5 (met.no):** confirmed global (not Nordic-only), ~9.5-day horizon,
  hourly → 6-hourly after ~3 days. ToS obligations are real: identifying
  User-Agent, `If-Modified-Since` conditional requests, coordinates truncated
  to 4 decimals, 20 req/s ceiling, CC-BY 4.0.
- **Phase 5 (global normals):** a single 30-year daily archive pull returns in
  ~1.2 s (~300–500 KB) **but counts as hundreds of weighted API calls** under
  Open-Meteo's pricing rules — two consecutive pulls hit the 600/min limit
  live. Cache computed normals permanently (TTL Infinity) and serialize
  first-time pulls with 429 backoff.
- **Phase 5 (global FWI):** all Fosberg inputs (temp, RH, wind, gusts) are in
  Open-Meteo hourly globally, zero nulls observed, plus `soil_moisture_0_to_1cm`
  and `vapour_pressure_deficit` as dryness context. No direct fire-weather
  variable exists on any Open-Meteo endpoint. Open-Meteo winds are **km/h**;
  the Fosberg formula expects mph — convert.
