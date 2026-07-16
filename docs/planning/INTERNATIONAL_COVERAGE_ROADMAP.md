# International Coverage Roadmap

**Created:** 2026-07-15
**Status:** In progress — Phase 1 shipped in v1.12.0 (2026-07-15); Phases 2–5 proposed
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

**Design plan:** `docs/global-current-conditions-plan.md` (implemented 2026-07-15)

**Shipped:** `OpenMeteoService.getCurrentConditions()` plus US/non-US auto-select in
`currentConditionsHandler.ts`, routed by the shared `isInUS` helper in
`src/utils/geography.ts` and overridable with a `source` parameter. The
aviationweather.gov METAR supplement below was **not** taken up and remains
available as a future option.

**API:** Open-Meteo forecast API `current=` parameters (temperature, humidity, apparent temperature, wind, gusts, pressure, precipitation, cloud cover, weather code).

- Effort: Small. `OpenMeteoService` already exists; add a `getCurrentConditions()` method and the US/non-US auto-select fallback in `currentConditionsHandler.ts`.
- Output note: model-interpolated values, not station observations — label the data source accordingly (as the forecast handler does).
- Optional supplement: real station observations worldwide via the aviationweather.gov data API (global METARs by ICAO station, JSON, no key, 100 req/min): https://aviationweather.gov/data/api/
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

## Priority 4 — Global wildfire (NASA FIRMS)

**API:** NASA FIRMS — global MODIS/VIIRS satellite fire detections within ~3 hours. Area and country endpoints, CSV/JSON. https://firms.modaps.eosdis.nasa.gov/api/

- Free MAP_KEY required; 5,000 requests / 10 min.
- **This would be the project's first API key.** Make it optional via env var (e.g. `FIRMS_MAP_KEY`); without it, `get_wildfire_info` stays US-only (NIFC).
- Output note: FIRMS returns satellite *hotspots* (lat/lon, brightness, confidence, FRP) — not named incidents with acreage/containment like NIFC. Needs a distinct output format; consider clustering nearby detections.
- Europe supplement: Copernicus EFFIS fire-danger forecast (free, open data, but WMS-based — clunkier): https://forest-fire.emergency.copernicus.eu/applications/data-and-services

## Priority 5 — Polish items (small, independent)

1. **met.no Locationforecast as fallback/second-opinion forecast source** — free, global (ECMWF HRES), no key; requires identifying User-Agent (already sent for Nominatim) and CC-BY 4.0 attribution. https://api.met.no/weatherapi/locationforecast/2.0/documentation
2. **Global climate normals** — compute from Open-Meteo historical archive (already integrated) when outside US, instead of NCEI.
3. **Global fire weather indices** — run the existing `fireWeather.ts` formulas off Open-Meteo hourly variables instead of NOAA gridpoint data outside the US.
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
| 2 | Open-Meteo Flood API in `get_river_conditions` | No (new endpoint) | Small–medium |
| 3 | MeteoAlarm + GeoMet alerts routing | Yes (2, keyless) | Medium |
| 4 | NASA FIRMS in `get_wildfire_info` | Yes (free key, optional) | Medium |
| 5 | Polish: met.no fallback, global normals/FWI, UK gauges | Yes (keyless) | Small each |

Each phase is independently shippable as a minor release, following the existing pattern: types → validation → service → handler → registration in `src/index.ts` → tests → docs.
