# Tool Reference

Complete reference for all 17 MCP tools provided by the Weather MCP Server.

> **Note on tool presets:** By default the server exposes the `basic` preset (6 tools, led by `get_weather_summary`). Set `ENABLED_TOOLS=all` to enable everything. See [Tool Selection](../README.md#tool-selection) in the README.

> **Common parameters (all location-based tools):** Every weather tool accepts the location in one of three ways — `latitude`+`longitude`, a saved `location_name` (e.g. `"home"`), or a free-text `city_name` (e.g. `"Bend, Oregon"`, geocoded on demand). Precedence: coordinates > `location_name` > `city_name`. When a name is used, the response echoes the resolved place in a `**Location:**` header. If the server sets `WEATHER_DEFAULT_LOCATION`, all location parameters may be omitted — the configured default is used and disclosed as `— server default` in that header. The high-volume tools (`get_forecast`, `get_alerts`, `get_weather_imagery`, `get_river_conditions`, `get_wildfire_info`, `get_lightning_activity`) also accept `detail`: `summary` | `standard` (default) | `full`.

## Contents

**Core Weather**
1. [get_forecast](#1-get_forecast) — Forecasts, global
2. [get_current_conditions](#2-get_current_conditions) — Current weather, global
3. [get_alerts](#3-get_alerts) — Watches/warnings/advisories: US, Canada, Europe, India, Philippines, Indonesia (+ ~45 more territories with an optional key)
4. [get_historical_weather](#4-get_historical_weather) — 1940–present, global
5. [get_weather_summary](#5-get_weather_summary) — One-call combined overview, global
6. [search_location](#6-search_location) — Geocoding, global
7. [check_service_status](#7-check_service_status) — API health checks

**Environment & Safety**

8. [get_air_quality](#8-get_air_quality) — AQI + pollutants, global
9. [get_marine_conditions](#9-get_marine_conditions) — Waves/swell/currents, global
10. [get_weather_imagery](#10-get_weather_imagery) — Radar, precipitation, and satellite imagery
11. [get_lightning_activity](#11-get_lightning_activity) — Strike detection, global
12. [get_river_conditions](#12-get_river_conditions) — River levels/flooding, global
13. [get_wildfire_info](#13-get_wildfire_info) — Active fires, global (US: NIFC incidents; elsewhere: NASA FIRMS satellite detections)

**Saved Locations**

14. [save_location](#14-save_location)
15. [list_saved_locations](#15-list_saved_locations)
16. [get_saved_location](#16-get_saved_location)
17. [remove_saved_location](#17-remove_saved_location)

Also in this document:
- [Finding Coordinates](#finding-coordinates)
- [Using Saved Locations with Weather Tools](#using-saved-locations-with-weather-tools)
- [Units & Localization](#units--localization)
- [Error Handling & Service Status](#error-handling--service-status)

---

### 1. get_forecast
Get weather forecast for any location worldwide.

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location (e.g., "home") — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode (e.g., "Paris, France", "Bend, Oregon") — use instead of coordinates when you only have a place name
- `days` (optional): Number of days in forecast (1-16, default: 7)
- `granularity` (optional): "daily" or "hourly" (default: "daily")
- `include_precipitation_probability` (optional): Include rain chances (default: true)
- `include_normals` (optional): Include climate normals for comparison (default: false). Normals are **global**: official NCEI station normals when an `NCEI_API_TOKEN` is configured and the point is in the US, and 1991-2020 normals computed from the Open-Meteo archive everywhere else — which, since the server ships keyless, is the default path. One full-year archive pull is made per location and reused for every date there. For US locations, also appends the record high/low for the date and the year it was set (source: NOAA Regional Climate Centers / ACIS)
- `include_astronomy` (optional): Include a per-day astronomy block — moon phase name, illumination %, moonrise/moonset, and civil/nautical/astronomical twilight times — plus one next-full-moon / next-new-moon line per response (default: false, daily forecasts only; computed locally, no API calls). Polar days render explicit "none (polar day)" / "none (polar night)" wording
- `compare_models` (optional): Compare five global weather models and summarize their agreement instead of returning a single forecast (default: false) — see **Model comparison** below
- `ensemble_spread` (optional): Summarize one model's ensemble members instead of returning a single forecast (default: false) — see **Ensemble spread** below. Mutually exclusive with `compare_models`
- `source` (optional): "auto" (default), "noaa" (US only), or "openmeteo" (global)
- `units` (optional): "imperial" (default) or "metric" — see [Units & Localization](#units--localization)
- Unit overrides (optional): `temperature_unit`, `wind_speed_unit`, `precipitation_unit`, `pressure_unit`, `distance_unit`, `time_format`

*Coordinates not required when `location_name` or `city_name` is provided. Precedence: coordinates > `location_name` > `city_name`.

**Description:**
Automatically selects the best data source: NOAA for US locations (more detailed) or Open-Meteo for international locations. Supports extended forecasts up to 16 days. Includes sunrise/sunset times, daylight duration, temperature, precipitation, wind, and UV index. When a location is resolved from `location_name` or `city_name`, the matched place is shown in a `**Location:**` header so ambiguous names are transparent.

**Model comparison (`compare_models=true`).**
Answers "how confident is this forecast?" — a question a single deterministic
forecast cannot address. Fetches five global models in one request —
**GFS** (NOAA/NCEP), **ECMWF IFS**, **ICON** (DWD), **GEM** (ECCC), and
**UKMO** (UK Met Office) — and summarizes where they agree and where they
diverge. It never dumps five forecasts: you get per-day temperature spreads
with an agreement band, how many models predict measurable precipitation,
wind ranges, and a conditions consensus with any dissenting models named.

Open-Meteo's `best_match` blend is shown as a headline **Best match** reference
line but is **excluded from every spread statistic** — it is a blend of
(largely) these same models, so counting it would double-count and artificially
tighten every spread.

Honest framing is part of the output: spread across models is a *proxy* for
uncertainty, not a guarantee — a tight spread can still be wrong, and model run
times differ and are not shown.

The agreement band (`tight` / `moderate` / `divergent`) is keyed on the spread
**as displayed** — the whole degree the line prints — so the number and its
label can never disagree.

Interactions, each deliberate:

| With | Behavior |
|------|----------|
| `granularity: "hourly"` | **Validation error.** The comparison is the requested product, so it fails loudly rather than silently returning a plain hourly forecast |
| `source: "noaa"` | **Validation error** — the comparison is Open-Meteo-only. Use `"auto"` or `"openmeteo"` |
| `source: "auto"` at a US point | Goes straight to the comparison; NOAA is never called. The footer discloses that the NOAA/NWS point forecast is not among the compared models (`gfs_seamless` represents the US global model) |
| `include_normals`, `include_astronomy` | **Silently ignored** — the comparison is a focused agreement product; both remain available in the standard view |
| `include_precipitation_probability: false` | Composes — the probability fragment is dropped from the precipitation line |
| `detail` | `summary` → one compact line per day; `standard` → the per-day blocks; `full` → additionally one compact per-model values line per variable group |
| `days` | Unchanged 1–16. Model horizons are ragged (ECMWF ~14 days, GFS 15), so each day shows its participation count (e.g. "(4 of 5 models)") and trailing days with fewer than 2 models are trimmed with a note |

A model that returns no data for a location is dropped from the comparison and
disclosed by name. Not every model publishes every product — UKMO has no
precipitation probability at all — so probability counts can legitimately be
lower than the model count, and the output says so. If fewer than two models
survive, the tool errors rather than presenting a one-model "comparison".

Note that `get_weather_summary` deliberately **strips** this flag: a comparison
block is the wrong shape inside a summary. Call `get_forecast` directly.

**Ensemble spread (`ensemble_spread=true`).**
The sibling question to model comparison: not "do the models agree?" but
**"how confident is the model itself?"** A global ensemble runs the same model
many times from slightly perturbed initial conditions, and the spread of those
members is the model's own uncertainty estimate — one that widens with lead
time in a way five deterministic models cannot show (5 samples versus 50).

Uses one fixed model: **ECMWF IFS 0.25° (ENS)**, 50 perturbed members plus a
control run, fetched in a single request. It never dumps 50 forecasts. Per day
you get a **High/Moderate/Low confidence** label, the p25–p75 interquartile
band for the daily high and low with the median, how many members produce
measurable precipitation with the amount range **across the wet members only**,
a typical wind band, and a conditions consensus with a runner-up bucket named
when it holds at least a quarter of members.

Every rendered range is the **interquartile band, not the absolute envelope**.
With 50 members the extremes are single outlying runs, so min–max would read as
far more uncertainty than the ensemble actually carries; `detail: "full"` adds
the envelope as its own line.

The **control run** is shown as a headline reference line but is **excluded
from every statistic, fraction, band, and trimming decision** — it is the
unperturbed higher-weight run, not an equal-probability member. Its line is
simply omitted on a day where it has no value.

Honest framing is part of the output: **member fractions are raw model output,
not calibrated probabilities.** "26 of 50 members" is not "52% chance" in any
calibrated sense — a confident ensemble can still be wrong. The confidence
labels and spread bands are project heuristics, not a published standard, and
the footer says so.

Interactions, each deliberate:

| With | Behavior |
|------|----------|
| `compare_models: true` | **Validation error** — the two are mutually exclusive. They are distinct products answering different questions; request one view at a time |
| `granularity: "hourly"` | **Validation error.** The spread is the requested product, so it fails loudly rather than silently returning a plain hourly forecast |
| `source: "noaa"` | **Validation error** — the ensemble is Open-Meteo-only. Use `"auto"` or `"openmeteo"` |
| `source: "auto"` at a US point | Goes straight to the spread; NOAA is never called. The footer discloses that the NOAA/NWS point forecast is not the model being spread |
| `include_normals`, `include_astronomy`, `include_severe_weather` | **Silently ignored** — the spread is a focused confidence product; all remain available in the standard view |
| `include_precipitation_probability` | **Silently ignored.** Unlike `compare_models`, where probability was a separately fetched variable, the wet-member fraction *is* the precipitation story here — the ensemble endpoint publishes no probability of its own |
| `detail` | `summary` → one compact line per day; `standard` → the per-day blocks; `full` → additionally one absolute-envelope line per day. Never member dumps at any level |
| `days` | Unchanged 1–16. ECMWF's daily ensemble data ends around day 14, so `days: 16` renders what exists and trims the rest under a note; interior gaps are retained and render with their reduced member count |
| `units` | Values in your units throughout; band thresholds scale for °C and the wet threshold is 0.25 mm rather than 0.01 in |

If fewer than two perturbed members are available, or nothing survives
trimming, the tool errors rather than presenting a one-member "distribution".

`get_weather_summary` deliberately **strips** this flag too, for the same
reason it strips `compare_models`.

**Examples:**
```
"Get a 7-day forecast for Paris (48.8534, 2.3488)"
"What's the forecast for Bend, Oregon?"   (uses city_name — no coordinates needed)
"Hourly forecast for Tokyo for the next 3 days"
"16-day extended forecast for Sydney, Australia"
```

**Returns:**
- Temperature (high/low, feels like)
- Sunrise and sunset times with daylight duration
- Precipitation chances and amounts
- Wind speed, direction, and gusts
- Weather conditions and descriptions
- UV index (for international locations)
- Humidity and atmospheric conditions
- Climate normals comparison (when `include_normals=true`), plus the US record high/low for the first forecast date with attribution "Records: NOAA Regional Climate Centers (ACIS)"
- Moon phase, moonrise/moonset, twilight times, and next full/new moon (when `include_astronomy=true`, daily only)
- Model agreement/divergence instead of a single forecast (when `compare_models=true`)
- Per-day ensemble confidence, interquartile bands, and wet-member fractions instead of a single forecast (when `ensemble_spread=true`)
- Snow and ice accumulation forecasts (when available)
- All timestamps in local timezone

### 2. get_current_conditions
Get current weather conditions for a location (global).

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode — use instead of coordinates
- `include_fire_weather` (optional): Include fire weather (default: false). US locations get NOAA's published indices; elsewhere a Fosberg Fire Weather Index computed by this server, with dryness context
- `include_normals` (optional): Include climate normals for comparison (default: false). Normals are **global**: official NCEI station normals when an `NCEI_API_TOKEN` is configured and the point is in the US, and 1991-2020 normals computed from the Open-Meteo archive everywhere else — which, since the server ships keyless, is the default path. One full-year archive pull is made per location and reused for every date there. For US locations, also appends the record high/low for the date and the year it was set (source: NOAA Regional Climate Centers / ACIS)
- `source` (optional): `"auto"` (default), `"noaa"`, `"openmeteo"`, or `"metar"` — see Description
- `units` (optional): "imperial" (default) or "metric", plus per-unit overrides — see [Units & Localization](#units--localization)

*Coordinates not required when `location_name` or `city_name` is provided.

**Description:**
Automatically selects the best data source: NOAA for US locations (real station
observations, richer detail) or Open-Meteo for international locations. Open-Meteo
values are **model-interpolated, not station observations**, and the output footer
says so. Use `source` to force a provider — `"openmeteo"` works anywhere including
the US (useful for comparison), while `"noaa"` outside the US will error.

**`source="metar"` — real station observations worldwide.** A METAR is the
routine observation an airport issues, usually near :53 past the hour, with
off-cycle `SPECI` reports when conditions change sharply. It is a genuine
instrument reading rather than a model estimate, and it is the only way this
tool returns an observation outside the US. Sourced from NOAA's Aviation
Weather Center (keyless), it works globally — including inside the US, where
it is a useful second opinion carrying flight category and the raw METAR text.

The tradeoff is deliberate and visible, which is why `"metar"` is never
selected automatically: Open-Meteo estimates conditions *at your exact
coordinates*, while a METAR measures them *at an airport* that may be tens of
kilometers away. Neither strictly wins, so the choice stays yours. Every
response names the station, its distance and 16-point bearing from the
requested point, its elevation, and the observation time with its age.

Caveats are surfaced, not buried:
- **Far station** — the nearest reporting station is 100–250 km away.
- **Stale observation** — nothing nearby has reported in the last 90 minutes
  (accepted up to 6 hours; beyond that the station is not used).
- **SPECI** — the report was issued off the hourly cycle.
- **No station** — nothing within 250 km yields a friendly message, not an
  error, and never a silent fallback to model data.

Sparse reports are normal: wind gusts appear in ~14% of observations and
present-weather in ~8%, so absent fields are omitted rather than rendered
blank. A visibility of `"10+"` keeps its qualifier (`+10 mi`) because "at
least 10" is a floor, not a measurement of exactly 10.

Limits on this source: `include_normals` works as usual, but
`include_fire_weather` renders a one-line note instead of indices — Haines
and transport wind need NOAA gridpoint data a METAR does not carry — and the
thermal-stress lines do not render on this source. TAF
(aerodrome forecasts) and a dedicated aviation tool are out of scope;
`get_weather_summary` does not pass this source through.

**Example:**
```
What are the current weather conditions in New York? (latitude: 40.7128, longitude: -74.0060)
What's the weather right now in Tokyo?
```

**Returns (US, via NOAA):**
- Current temperature, humidity, wind, pressure
- Heat index or wind chill (when applicable)
- 24-hour temperature range
- Recent precipitation
- Cloud cover and visibility (the visibility descriptor — `clear`, `haze/mist`, `fog`, `dense fog` — is keyed on the figure **as displayed**, **in the unit the report prints**, so it follows the km figure under metric preferences rather than a hidden miles value)
- Snow depth on ground (when available)
- Climate normals comparison (when `include_normals=true`), plus the US record high/low for today's date with attribution "Records: NOAA Regional Climate Centers (ACIS)"
- Fire weather indices (when `include_fire_weather=true`) — Haines Index, Grassland Fire Danger, Red Flag Threat, mixing height, transport winds, as published by NOAA
  (the category beside each figure — Red Flag Threat, and on the international
  path vapour-pressure deficit and topsoil moisture — is keyed on the value **as
  displayed**, so the number and its label can never disagree)
- Thermal-stress context in extreme conditions (automatic, see below)
- All timestamps in local timezone

**Returns (international, via Open-Meteo):**
- Current temperature and feels-like (when it diverges meaningfully from actual)
- Today's high/low range
- Dewpoint, humidity, wind with gusts, pressure, cloud cover percentage
- Recent precipitation (broken out into rain/showers/snowfall when present)
- Climate normals comparison (when `include_normals=true`)
- Fire weather (when `include_fire_weather=true`) — a **Fosberg Fire Weather
  Index computed by this server** from the current temperature, humidity, and
  sustained wind, with its category, plus a dryness-context block (vapour-pressure
  deficit, topsoil moisture) when the model reports those values
- Thermal-stress context in extreme conditions (automatic, see below)
- All timestamps in the location's local timezone

Visibility, snow depth, and cloud layer detail are not available on the
international path. Neither are NOAA's published fire-danger indices (Haines,
grassland, red-flag): those are agency products computed on NOAA's gridpoint
API, and no equivalent exists globally. The Fosberg index shown instead is
**derived by this server from model data, not an official fire-danger rating** —
the output says so and defers to national fire authorities, and its category
bands are a project heuristic rather than an agency scale. It renders anywhere
the model path runs, including US locations queried with `source="openmeteo"`.

**Thermal stress (automatic, both the US and international paths):**

Two safety lines render directly after the temperature/feels-like block, with
no parameter to enable them and nothing shown in moderate weather. They are
mutually exclusive by construction.

- 🥶 **Frostbite risk** — gate: effective wind chill at or below **−18 °F**.
  Bands a wind chill into a time-to-onset for *exposed* skin: High (10–30 min)
  at −18 °F, Very High (5–10 min) at −40 °F, Severe (2–5 min) at −54 °F,
  Extreme (under 2 min) at −67 °F.
- 🥵 **Heat stress** — gate: air temperature at or above **80 °F** *and* rounded
  WBGT at or above **80 °F**. Bands an estimated wet-bulb globe temperature
  into exertion risk: Elevated (80–84), High (85–87), Very High (88–89),
  Extreme (90+).

**Provenance.** The wind chill is the **North American Wind Chill Index**, the
joint NWS/Environment Canada 2001 model (Osczevski & Bluestein), valid for
temperatures at or below 50 °F and winds at or above 3 mph. The frostbite time
bands are **adapted from Environment Canada's wind chill program** (published in
°C; the °F banding here is a project heuristic adaptation) and describe the most
cold-susceptible fraction of the population — the conservative direction is
intentional for a safety line. The WBGT is the **Australian Bureau of
Meteorology's simplified estimate** from temperature and humidity alone, whose
own published assumption is *moderately high radiation with light wind* — a
full-sun outdoor estimate that can overestimate in shade, overcast, or strong
wind. The exertion bands follow the widely used flag-condition categories and
are likewise a project heuristic, since acclimatization genuinely shifts them.
Both numbers are **computed by this server**, not observed or agency-published,
and the heat line carries that caveat inline.

**Which value drives the band.** On the US path a station-published wind chill
drives both the band and the display, so the risk statement always matches the
`Feels Like (Wind Chill)` number above it; absent one, the index is computed
from temperature and sustained wind. On the international path it is always
computed and **never taken from `apparent_temperature`**, which is a Steadman
model making a different claim — so that line echoes its own basis. Below the
3 mph validity floor the air temperature itself becomes the effective value
(calm −50 °F air freezes skin regardless of wind), and is named as an air
temperature rather than as a wind chill. Wind that was *never reported* is
kept distinct from measured calm air: claiming "calm" from a missing
measurement would assert something nobody observed, and the air-temperature
band understates the risk if it is in fact windy — so that case says wind is
unknown and that the time could be shorter. Bands are computed on the rounded
displayed value, so the number shown and the band naming it never disagree.
Values display in the caller's preferred unit while the computation is always
on fixed °F, so the band is identical in metric and imperial.

Missing inputs simply omit the line — there is no "unavailable" note, since
absence of a bonus line needs no announcement. Not available on the METAR
source.

**Returns (worldwide, via `source="metar"`):**
- Station name, ICAO identifier, distance and bearing from the requested
  point, and station elevation
- Observation time in the station's local zone, with its age
- Temperature with dew point and computed relative humidity
- Wind direction (or "Variable") and speed, with gusts when reported
- Visibility, preserving a `"10+"` qualifier
- Sky condition layers with cloud bases
- Present weather, decoded (e.g. `BCFG` → "Patches fog")
- Pressure (altimeter setting, plus sea level when reported)
- Flight category (VFR / MVFR / IFR / LIFR)
- The raw METAR text, as the observation of record
- Climate normals and US records (when `include_normals=true`)

Any field the station did not report is omitted. Fire weather indices are not
available on this source.

### 3. get_alerts
Get active weather alerts, watches, warnings, and advisories. Coverage is routed by country: the United States (NOAA), Canada (Environment and Climate Change Canada via MSC GeoMet), 38 European MeteoAlarm member countries (each country's official national warnings), and — via their official national CAP feeds — India (NDMA SACHET), the Philippines (PAGASA), and Indonesia (BMKG). Elsewhere, an optional `GOOGLE_WEATHER_API_KEY` adds official alerts for ~45+ more territories via the Google Weather API; without that key those regions receive a clean "not yet covered" message.

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode — use instead of coordinates
- `active_only` (optional): Show only active alerts (default: true)
- `detail` (optional): `summary` (headline + timing), `standard` (default; adds instructions), or `full` (adds the complete NWS description)

*Coordinates not required when `location_name` or `city_name` is provided.

**Description:**
Retrieves current weather alerts for safety-critical weather information, routed by the location's country:

| Region | Source | Output shape |
|--------|--------|--------------|
| United States | NOAA National Weather Service | Severity/urgency/certainty, effective/expiration times, affected zones, instructions — unchanged from previous releases |
| Canada | Environment and Climate Change Canada (MSC GeoMet) | Alert name + type (warning > watch > advisory > statement), affected area, risk/confidence where provided, issued/ends times, full alert text verbatim — no invented severity fields |
| Europe (38 MeteoAlarm members) | The country's national meteorological service, via EUMETNET MeteoAlarm | CAP severity/urgency/certainty, MeteoAlarm awareness colour, areas, issued/expires times as published, headline/description/instruction verbatim |
| India / Philippines / Indonesia | National CAP feeds — NDMA SACHET / PAGASA-DOST / BMKG | CAP severity/urgency/certainty, matched to the requested point by the alert's own polygon where the feed publishes geometry, with a separate country-level block for alerts that carry no usable geometry; issued/onset/expires as published; headline/description/instruction verbatim |
| Elsewhere (~45+ territories, **needs `GOOGLE_WEATHER_API_KEY`**) | Official national weather services, aggregated by the Google Weather API | CAP severity/urgency/certainty, area name, effective/expires times in the alert's own timezone offset, description/instructions/safety recommendations verbatim, and the issuing publisher named per alert |

Country resolution: a saved location or geocoded `city_name` that already knows its country is used directly; coordinate-only requests use a cached country-level reverse lookup (Nominatim, `zoom=3`). A "no country" answer (e.g. US coastal waters) falls back to the US bounding boxes, preserving NOAA marine alerts offshore.

**The keyed fallback is the last branch only.** The US, Canada, the MeteoAlarm countries, India, the Philippines, and Indonesia are jurisdictional authorities and stay first choice — they **never contact Google**, key or no key — and without a key the elsewhere branch is byte-for-byte the message it has always returned. Google's coverage list ([authoritative here](https://developers.google.com/maps/documentation/weather/coverage)) includes Australia, Japan, Brazil and Mexico among others; any list in these docs is representative, not exhaustive. Matching is by **provider polygon**, so Google's own caveat applies — "country and region coverage alignment may not be exact" — An uncovered region answers HTTP 404 and renders an explicit no-coverage note stating that **this is not an all-clear** — distinct from a covered region with nothing active, which renders a ✅ none-found result; the coverage caveat is rendered either way. Alert text appears in the publisher's source language (only the title is translated — a provider restriction). Unlike the optional pollen key, a **key failure here surfaces loudly**: a rejected key, quota exhaustion, timeout, or network error returns an error rather than a possibly-false "no alerts", because alerts are this tool's entire answer.

**European coverage is country-level**: the keyless MeteoAlarm feeds carry no region geometry, so all of a country's warnings are returned with an explicit coverage note — warnings may not affect the exact requested point.

**The national CAP feeds are finer, where the publisher supplies geometry.** The Philippines and Indonesia publish each alert's polygon inline, so a warning is shown only when it actually contains the requested point — the first keyless source in this server with true point-level matching. **India is currently country-level**: SACHET serves each alert's geometry from a separate endpoint that is not reliably reachable from a server, so Indian warnings render in the country-level block with an explicit note that geometry could not be loaded and they may not affect your exact location. An alert whose geometry is missing or unusable is always listed, never dropped — treating "geometry unavailable" as "not near you" would be a fabricated all-clear. If the index itself cannot be read, the tool fails loudly rather than reporting zero alerts; when some individual alerts fail to load, the count is disclosed and the result is explicitly not an all-clear for those alerts.

Alerts from all sources are sorted most-critical-first; European, Canadian, and national-CAP lists cap at 10 (`standard`) / 25 (`full`) with a disclosed remainder, and `summary` returns counts only.

**Licence attributions (rendered in the output, per source terms):** US: *NOAA National Weather Service*. Canada: *Environment and Climate Change Canada (MSC GeoMet)* — alert content shown unaltered. Europe: *EUMETNET – MeteoAlarm (national warnings: <service>)* — alerts shown unmodified as issued, times as published. India: *NDMA SACHET (National Disaster Management Authority, Government of India) — public domain*. Philippines: *PAGASA-DOST, via its public CAP feed (CC BY 4.0)*. Indonesia: *BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)* — each followed by *alerts shown unmodified as issued, times as published*. Elsewhere (keyed): *Data source: official national weather services, aggregated by the Google Weather API* ending in the exact required string *Source: Includes weather data from Google*, plus a **per-alert** `**Source:**` line naming the original publisher and its authority URI — Google's terms require both layers.

**Examples:**
```
"Are there any weather alerts for Miami, Florida?"
"Check for severe weather warnings in Oklahoma City"
"Are there any weather warnings for Munich right now?"
"Any alerts in Toronto?"
"Any weather warnings for Manila?"
"What weather watches are active in my area?" (latitude: 40.7128, longitude: -74.0060)
```

**Returns:**
- Alert type and severity (Extreme → Severe → Moderate → Minor, where the source provides severity)
- Urgency, certainty, and response type (US, Europe, and the national CAP feeds)
- Event description and instructions, verbatim
- Effective/issued and expiration times (international times shown as published by the source)
- Affected geographic areas
- Recommended actions and safety information
- Source attribution and, in Europe or for an alert without usable geometry in India/the Philippines/Indonesia, the country-level coverage note
- In India, the Philippines, and Indonesia, a matched-vs-country-level split

### 4. get_historical_weather
Get historical weather observations for a location.

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode — use instead of coordinates
- `start_date` (required): Start date in ISO format (YYYY-MM-DD)
- `end_date` (required): End date in ISO format (YYYY-MM-DD)
- `limit` (optional): Max hourly observations to return (1-744, default: 168; 744 = the full 31-day hourly window). Applies to hourly output only — daily-granularity output for ranges over 31 days always shows the full range.
- `units` (optional): "imperial" (default) or "metric", plus per-unit overrides — see [Units & Localization](#units--localization)

*Coordinates not required when `location_name` or `city_name` is provided.

**Data Source Selection:**
The server automatically chooses the best data source based on your date range:

- **Last 7 days**: Uses NOAA real-time API
  - ✓ Detailed hourly observations from weather stations
  - ✓ Includes: temperature, conditions, wind speed, humidity, pressure
  - ✓ High reliability and availability
  - ⚠️ US locations only

- **Older than 7 days**: Uses Open-Meteo Historical Weather API
  - ✓ No API token required
  - ✓ Global coverage (worldwide)
  - ✓ Historical data from 1940 to present
  - ✓ Hourly data for ranges up to 31 days
  - ✓ Daily summaries for longer periods
  - ✓ Includes: temperature, precipitation, wind, humidity, pressure, cloud cover
  - ✓ High resolution reanalysis data (9-25km grid)
  - ⚠️ 5-day delay for most recent data

**Examples:**

Recent data (US locations, detailed observations):
```
"What was the weather like in Chicago 3 days ago?"
Coordinates: latitude: 41.8781, longitude: -87.6298
Date range: 3 days ago to 2 days ago
```

Historical data (global coverage):
```
"What was the weather in Paris on January 15, 2024?"
Coordinates: latitude: 48.8566, longitude: 2.3522
Date range: 2024-01-15 to 2024-01-15
```

Long-term historical analysis:
```
"Show me weather data for Tokyo from January 1, 2020 to December 31, 2020"
Coordinates: latitude: 35.6762, longitude: 139.6503
Date range: 2020-01-01 to 2020-12-31
```

**Troubleshooting:**
If you get "No historical data available":
- For recent dates (last 7 days): Ensure you're using US coordinates
- For older dates: Data should be available globally back to 1940
- Note: Most recent data has a 5-day delay
- Very recent dates (last 5 days) may not be available in archival data yet

### 5. get_weather_summary
Get a combined weather overview for a location in a single call.

**Parameters:**
- `latitude` / `longitude` (required*): Coordinates (-90 to 90 / -180 to 180)
- `location_name` (optional): Name of a saved location — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode — use instead of coordinates
- `include` (optional): Array of sections to include — any of `current`, `forecast`, `alerts`, `air_quality`, `lightning` (default: `["current", "forecast", "alerts"]`)
- `days` (optional): Forecast days when the forecast section is included (1-16, default: 7)
- `detail` (optional): `summary` (default here), `standard`, or `full`
- `units` (optional): "imperial" (default) or "metric", plus per-unit overrides — see [Units & Localization](#units--localization)

*Coordinates not required when `location_name` or `city_name` is provided. Precedence: coordinates > `location_name` > `city_name`.

**Description:**
Best for broad questions like "What's the weather like in Seattle?" or "Is it safe to hike today?". Aggregates several specialized tools for one location in a single response, resolving the location once so there is no repeated geocoding. Sections that are unavailable for a location (e.g. alerts in a country not yet covered) are noted rather than failing the whole summary. For a single specific data product, call that specialized tool directly.

**Examples:**
```
"Give me a weather rundown for Bend, Oregon"
"What's the weather like at home, and is there any lightning?"  (include=["current","forecast","lightning"])
```

**Returns:**
- A `# Weather Summary` header with the resolved location and the included sections
- Each requested section's full output (current conditions, forecast, alerts, air quality, lightning), separated by rules

### 6. search_location
Find coordinates for any location worldwide by name.

**Parameters:**
- `query` (required): Location name to search for (e.g., "Paris", "New York, NY", "Tokyo")
- `limit` (optional): Maximum number of results to return (1-100, default: 5)

**Description:**
Converts location names to coordinates. Returns multiple matches with detailed metadata including coordinates, timezone, elevation, population, and administrative regions. Enables natural language weather queries by finding coordinates automatically.

**Examples:**
```
"Find coordinates for Paris"
"Search for Tokyo, Japan"
"Where is San Francisco, CA?"
```

**Returns:**
- Location name and full administrative hierarchy
- Latitude and longitude coordinates
- Timezone and elevation
- Population (when available)
- Country and region information
- Feature type (capital, city, airport, etc.)

### 7. check_service_status
Check the operational status of weather APIs and cache performance.

**Parameters:** None

**Description:**
Performs health checks on both NOAA and Open-Meteo APIs to verify they are operational. Use this tool when experiencing errors or to proactively verify service availability before making weather data requests. Returns current status, helpful messages, links to official status pages, and cache statistics.

**Example:**
```
Check if the weather services are operational
```

**Returns:**
- Operational status for NOAA API (forecasts & current conditions)
- Operational status for Open-Meteo API (historical data & forecasts)
- Cache statistics (hit rate, size, API call reduction)
- Status page links and recommended actions if issues are detected
- Overall service availability summary

### 8. get_air_quality
Get comprehensive air quality data for any location worldwide.

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode — use instead of coordinates
- `forecast` (optional): Include an hourly AQI forecast grouped by day (default: false)
- `forecast_days` (optional): Days of forecast when `forecast=true` (1-7, default: 5; 7 days / 168 hours is the model maximum)

*Coordinates not required when `location_name` or `city_name` is provided.

**Description:**
Provides current air quality conditions using the Open-Meteo Air Quality API with automatic AQI scale selection (US AQI for US locations, European EAQI elsewhere). Includes health recommendations, pollutant concentrations, and UV index. With `forecast=true`, the full forecast range is shown grouped by calendar day — each day gets a dated header with its peak AQI **and peak UV index** (e.g. `— peak US AQI 63 (Moderate) · UV 10 (Very High)`), plus 6-hour period ranges labeled by the period's peak AQI category. Hours already past are skipped; days with no UV data omit the UV clause. The AQI and UV categories are keyed on the figures **as displayed** — the rounded AQI and the one-decimal UV index the report prints — so a number and the category beside it can never disagree.

**Pollen — three states.** Pollen rides the CAMS *European* model on the same Open-Meteo endpoint, so it has exactly three behaviors:

1. **European locations (keyless):** current levels for six species (alder, birch, grass, mugwort, olive, ragweed) in grains/m³, shown automatically. No key needed, and this path never contacts Google.
2. **Elsewhere, with an optional `GOOGLE_POLLEN_API_KEY`:** a grass/tree/weed **Universal Pollen Index** (0–5) with category labels and an in-season plant list, from Google's Pollen API (65+ countries, including the US). The section carries the attribution line `Source: Includes pollen data from Google`, which Google's API terms require to appear with the data. Only types actually carrying an index render — Google omits the index entirely for out-of-season types. See [GOOGLE_POLLEN_KEY_SETUP.md](./GOOGLE_POLLEN_KEY_SETUP.md).
3. **Elsewhere, without that key:** no pollen section renders.

The Google fallback fires only when *every* CAMS species comes back empty, so partial European coverage keeps the richer keyless data. It is garnish, never contract: a quota error, timeout, or uncovered country degrades silently to no section and never fails the air-quality call. The one exception is a **rejected key**, which adds a single note (`*Note: GOOGLE_POLLEN_API_KEY was rejected; global pollen data is unavailable.*`) so a misconfiguration isn't hidden forever.

**Examples:**
```
"What's the air quality in Los Angeles?"
"Check pollution levels in Beijing"
"Get air quality forecast for Paris for the next 5 days"
```

**Returns:**
- Air Quality Index (AQI) with appropriate scale (US or European)
- Health risk category and recommendations
- Pollutant concentrations (PM2.5, PM10, O₃, NO₂, SO₂, CO, NH₃)
- UV Index with sun protection guidance
- Pollen — CAMS species in grains/m³ for Europe, or a Universal Pollen Index elsewhere when `GOOGLE_POLLEN_API_KEY` is set
- Activity recommendations for sensitive groups
- Optional 5-day hourly forecast

### 9. get_marine_conditions
Get marine weather conditions including wave height, swell, ocean currents, and sea state with automatic source selection for Great Lakes and coastal bays.

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode — use instead of coordinates
- `forecast` (optional): Include daily marine forecast (default: false)
- `forecast_days` (optional): Number of forecast days when `forecast=true` (1-16, default: 5). The marine model typically provides ~10 days of data — trailing days without data are omitted with a note.

*Coordinates not required when `location_name` or `city_name` is provided.

**Description:**
Provides comprehensive marine weather data with intelligent dual-source support:
- **Great Lakes & Coastal Bays**: Automatically uses NOAA gridpoint data for all 5 Great Lakes (Superior, Michigan, Huron, Erie, Ontario) and major US coastal bays (Chesapeake Bay, San Francisco Bay, Tampa Bay, Puget Sound, Lake Okeechobee). Provides wave height, wave period, wave direction, and wind conditions.
- **Ocean Coverage**: Uses Open-Meteo Marine API for global ocean coverage, including significant wave height with Douglas Sea Scale categorization, wind waves vs swell separation, wave period/direction, ocean currents, and safety assessment for maritime activities.
- **Automatic Selection**: Intelligent geographic detection automatically selects the best data source with zero configuration required.

**Important:** Data has limited accuracy in coastal areas and is NOT suitable for coastal navigation — always consult official marine forecasts.

**Examples:**
```
"What are the ocean conditions off the coast of California?"
"Get wave height and swell for surfing in Hawaii"
"Check marine conditions in the Atlantic Ocean" (latitude: 30.0, longitude: -60.0)
```

**Returns:**
- Significant wave height (meters/feet) with safety category
- Wind waves (locally generated) height and direction
- Swell height, period, and direction (from distant systems)
- Ocean current velocity and direction
- Sea state interpretation (Calm → Phenomenal based on Douglas Sea Scale). The sea-state category and the safety assessment are keyed on the wave height and period **as displayed** (metres and seconds, one decimal), so the label can never disagree with the number beside it.
- Safety assessment for maritime activities
- Wave period for planning and safety
- Optional daily forecast up to 16 days (`forecast_days`, default 5; days past the marine model's ~10-day horizon are trimmed with a note)

### 10. get_weather_imagery
Get weather radar, precipitation, and satellite imagery for visual weather analysis.

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode — use instead of coordinates
- `type` (optional): Imagery type - "precipitation" (default), "radar", or "satellite"
- `animated` (optional): Return animated loop vs static image (default: false)
- `composite` (optional): Return a finished radar map as an image content block alongside the text (default: false) — see **Composited maps** below
- `detail` (optional): `summary`/`standard` (default) surface direct image URLs and show 3 representative frames of longer animations; `full` embeds Markdown images and lists every animation frame

*Coordinates not required when `location_name` or `city_name` is provided.
- `layers` (optional): Additional map layers (reserved for future use)

**Description:**
Provides access to weather imagery from two sources: precipitation/radar tiles from the RainViewer API (global coverage, static or animated loops showing up to 2 hours of history), and satellite imagery from NOAA GOES-East/West ABI GeoColor via NASA GIBS (Western Hemisphere, day and night). Perfect for visual confirmation of approaching weather systems.

**Examples:**
```
"Show me the current radar for New York"
"Get animated precipitation radar for London for the last 2 hours"
"Show me a satellite image of the hurricane off Florida"
"Is there any precipitation showing on radar near me?"
```

**Returns:**
- Precipitation radar imagery (static or animated)
- Satellite snapshot (GOES GeoColor, when `type="satellite"`)
- Tile URLs for efficient rendering
- Frame timestamps for animated sequences
- Coverage area and resolution information
- Automatic coordinate-to-tile calculation
- Up to 2 hours of historical radar frames when animated
- An interactive-map link (RainViewer's live map for radar/precipitation, NASA Worldview for satellite) for viewing the imagery layered over a base map in the browser

**Note:** Precipitation/radar coverage is global (RainViewer). Satellite coverage is Western Hemisphere only (GOES GeoColor via NASA GIBS). Tile URLs are transparent overlays (blank where there is no precipitation) and RainViewer frames expire after roughly 2 hours — for a durable, human-viewable picture, use `composite: true` or the interactive-map link.

**Composited maps (`composite: true`):**

Returns a finished 512×512 PNG as an MCP image content block *alongside* the usual text, so the response is `[text, image]`.

The image contains three layers: a NASA GIBS land/water base map, coastline and border outlines over it, and the radar/precipitation overlay on top — plus a high-contrast crosshair marking the requested coordinates. That marker is what makes an echo-free result readable: instead of a blank square, you get recognizable geography with your location on it.

The map is **centered on the requested coordinates**, so the marker sits at the middle of the image and you see roughly equal weather in every direction. (Near a pole the window is clamped to the edge of the Web Mercator projection, so the marker sits off-center — there is no imagery beyond the edge to center it against.)

Rules and caveats:
- **Radar/precipitation only.** `type: "satellite"` with `composite` returns a note, not an error — GOES GeoColor is already a complete picture and needs no base map.
- **Latest observed frame only.** With `animated: true` the animation frames stay URL-based and only the newest observed frame is composited (forecast/nowcast frames are never used as "the latest radar"). Compositing a full 13-frame loop would be a multi-megabyte payload.
- **Client rendering varies.** The assistant always receives the image and can describe what it shows; whether it displays inline is up to the MCP client. Text-only clients ignore image blocks per protocol and still get the complete text answer.
- **Degrades quietly.** If any step of the composite fails, the response is the normal URL-based text plus a one-line note. The tool call itself never fails because compositing failed.
- Typical payloads run 30–97 KB (PNG) / 40–129 KB (base64). Attribution for both RainViewer and NASA GIBS/ESDIS is included in the text block.

### 11. get_lightning_activity
Get real-time lightning strike detection and safety assessment for outdoor activity planning.

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode — use instead of coordinates
- `radius` (optional): Search radius in kilometers (1-500, default: 100)
- `timeWindow` (optional): Historical time window in minutes (5-120, default: 60)
- `detail` (optional): `"summary"`, `"standard"` (default), or `"full"` — `full` lists up to 25 nearest strikes instead of 10; statistics always cover every detected strike regardless of level

*Coordinates not required when `location_name` or `city_name` is provided.

**Description:**
Provides real-time lightning strike detection from the Blitzortung.org global lightning detection network. Includes comprehensive safety assessment with 4 risk levels based on strike proximity. Critical for outdoor safety planning including boating, hiking, golfing, and other outdoor activities.

**Examples:**
```
"Are there any lightning strikes near Miami?"
"Check for lightning activity within 50km"
"Is it safe to be outside based on lightning?"
"Show me recent lightning strikes in the last hour"
```

**Returns:**
- Real-time lightning strikes within specified radius
- 4-level safety assessment, banded on the nearest-strike distance **as displayed** (rounded to 0.1 km),
  so the verdict can never disagree with the number shown:
  - **Extreme** (≤8 km): Active thunderstorm, dangerous conditions
  - **High** (>8–16 km): Seek shelter immediately
  - **Elevated** (>16–50 km): Monitor conditions, plan indoor access
  - **Safe** (>50 km): No immediate lightning threat
- Comprehensive statistics:
  - Total strikes and strike density (per sq km)
  - Strikes per minute rate
  - Distance to nearest strike
  - Average distance of all strikes
- Strike details:
  - Polarity (cloud-to-ground vs intra-cloud)
  - Amplitude in kiloamperes (kA)
  - Precise timestamp and location
- Safety recommendations based on proximity
- Geographic region-optimized data retrieval

**Note:** Data provided by Blitzortung.org, a free community-operated lightning detection network. May have regional coverage variations.

**Requires the optional `mqtt` package.** It is installed by default; if the server was installed with `--omit=optional` this tool returns an error naming the package and how to reinstall it, never a "no strikes" result. The same message appears in `get_weather_summary`'s `lightning` section. See [Optional dependency](../README.md#optional-dependency).

### 12. get_river_conditions
Monitor river levels and flood status worldwide — NOAA gauge observations in the US, GloFAS modeled discharge elsewhere.

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode — use instead of coordinates
- `radius` (optional): US gauge search radius in kilometers (1-500, default: 50). Ignored on the global model path, which has no gauges to search
- `source` (optional): `"auto"` (default — NOAA for US coordinates, Open-Meteo elsewhere), `"noaa"` (US only), or `"openmeteo"` (global)
- `forecast_days` (optional): Discharge forecast days, 1-210 (default: 7). Global model path only; ignored for US gauge data
- `detail` (optional): `"summary"`, `"standard"` (default), or `"full"`
  - US path: `full` shows up to 25 nearest gauges (instead of 5), up to 25 historic crests per gauge (instead of 3), and each gauge's multi-point NWPS forecast series where one exists
  - Global path: `full` adds the min/max ensemble envelope and the full requested day range (lower levels cap the forecast at 7 days)

*Coordinates not required when `location_name` or `city_name` is provided.

**Description:**

*US locations (NOAA NWPS):* Finds the nearest river gauges within the specified radius and reports current water levels, flood stages, and flow rates. Each shown gauge also gets an observed rise/fall trend derived from its stage history (e.g. `↗ rising (+0.5 ft / 6h)`); gauges whose stage series can't be fetched simply omit the trend. Gauge IDs include the USGS site number where NWPS reports one, but streamflow data is not fetched from USGS Water Services.

*Everywhere else (Open-Meteo Flood API, GloFAS v4):* Returns modeled river discharge in m³/s (with ft³/s under imperial units) on a ~5km grid. Because a grid cell that misses the river channel reports local runoff rather than the river, each request probes a 3×3 neighborhood in one call and selects the cell with the highest mean discharge over the past 31 days; when the selected cell is not the requested point, the output discloses it ("Nearest modeled river channel: ~5 km W of requested point"). GloFAS publishes no flood-stage thresholds, so discharge is presented against its own recent history and the forecast ensemble instead of flood categories. Points with no modeled channel — open ocean, arid regions — return a plain "no river data" result rather than an error.

**Examples:**
```
"What are the river conditions near St. Louis?" (latitude: 38.6270, longitude: -90.1994)
"Check for flooding on the Mississippi River"
"Is the river level safe for kayaking?"
"How high is the Rhine at Cologne?" (city_name: "Cologne, Germany")
"What's the Thames discharge forecast for the next month?" (forecast_days: 30, detail: "full")
```

**Returns (US path):**
- Nearest river gauges with current water levels
- Observed trend per gauge (rising/falling/steady with magnitude and window)
- Flood stage thresholds (action, minor, moderate, major) — **only for gauges that publish them.** Many NWPS gauges return no threshold set at all, and those reports carry no flood-stage section and no threshold-derived labels; the `**Flood Category:**` line you see on most gauges comes from NOAA's own published status string, not from these thresholds. Where thresholds are published, forecast-series points are labelled against them using the stage **as displayed** (two decimals), so a point printing at its action stage is labelled; the published thresholds themselves are NOAA's own values and are not rounded.
- Current flood status and forecast (multi-point forecast series at `detail="full"` for gauges that have one — mostly tidal and major-river gauges)
- Streamflow data (cubic feet per second)
- Distance to each gauge from query location
- River and location names, safety assessment for recreation
- Historical context (flood crests if available)

**Returns (global model path):**
- Current modeled discharge with a rise/fall trend over the past 7 days (relative ±10% threshold)
- Context against the past-31-day mean ("~2.1× the recent average" / "near the recent average" / "well below the recent average")
- Snap disclosure when the reported channel is not the requested point
- Ensemble forecast: daily median with the p25–p75 band, plus the min/max envelope at `detail="full"`
- A "minor local drainage" label when the best cell is under 0.1 m³/s

**Note:** US data provided by NOAA National Water Prediction Service (NWPS). Non-US data provided by the Open-Meteo Flood API (GloFAS v4), licensed CC-BY 4.0 and credited in the output as *"River discharge data by Open-Meteo.com (CC-BY 4.0)"*. Model discharge is **not** a gauge observation and carries no official flood-stage thresholds — do not substitute it for national flood warnings. Border cities that fall inside the US routing boxes (Toronto, Vancouver) route to NOAA and find no gauges; pass `source: "openmeteo"` explicitly for model data there.

### 13. get_wildfire_info
Monitor active wildfires and fire activity for safety and evacuation planning, worldwide.

**Parameters:**
- `latitude` (required*): Latitude coordinate (-90 to 90)
- `longitude` (required*): Longitude coordinate (-180 to 180)
- `location_name` (optional): Name of a saved location — use instead of coordinates
- `city_name` (optional): Free-text place name to geocode — use instead of coordinates
- `radius` (optional): Search radius in kilometers (1-500, default: 100)
- `source` (optional): `"auto"` (default — routes by country: NIFC for the US, NASA FIRMS elsewhere), `"nifc"` (US named incidents only; finds nothing outside the US), or `"firms"` (satellite detections, works anywhere including the US — useful for fires not yet catalogued as incidents). There is deliberately no automatic cross-fallback: incidents and detections are different claims.
- `day_range` (optional): Days of detection history (1-5, default: 1). FIRMS path only; more than 1 day requires a configured `FIRMS_MAP_KEY` (keyless data covers the last 24 hours — the output says so). The NIFC path ignores it.
- `detail` (optional): `"summary"`, `"standard"` (default), or `"full"` — `full` shows up to 25 nearest fires/clusters instead of 5

*Coordinates not required when `location_name` or `city_name` is provided.

**Description — two data modes:**

**US locations (NIFC):** critical wildfire monitoring using NIFC (National Interagency Fire Center) WFIGS data — named incidents with fire size, containment status, and proximity-based safety assessments. If the NIFC service truncates its response (ArcGIS transfer limit), the report says so explicitly at every detail level.

**Everywhere else (NASA FIRMS):** near-real-time satellite fire detections from VIIRS (Suomi NPP), landing within ~3 hours of a satellite overpass. These are **heat detections, not managed incidents** — no fire names, sizes, or containment percentages exist, and detections can include industrial heat sources, gas flares, or agricultural burns; the output states this up front. Detections are clustered (2 km radius) so a large fire reads as one entry with a detection count, distance and 16-point bearing, peak fire radiative power (MW) as the intensity signal, newest-detection age, day/night mix, and confidence summary. A result with no detections carries an explicit not-all-clear caveat — cloud cover can hide fires, and small or new fires may evade detection. Works with **zero configuration** (keyless 24 h regional data files); an optional free [`FIRMS_MAP_KEY`](https://firms.modaps.eosdis.nasa.gov/api/map_key/) upgrades to targeted queries and `day_range` up to 5. A rejected key falls back to keyless data with a disclosure note.

Country routing matches `get_alerts`: saved/geocoded locations use their known country, coordinate-only requests use a cached country-level reverse lookup, and border cities inside the approximate US bounding boxes (Toronto, Vancouver) route correctly to FIRMS.

**Examples:**
```
"Are there any wildfires near Los Angeles?" (latitude: 34.0522, longitude: -118.2437)
"Check for active fires near Athens, Greece"
"How close is the nearest wildfire?"
"Any satellite fire detections near my location in the last 3 days?" (day_range: 3)
```

**Returns (US / NIFC):**
- Active wildfire locations within search radius
- Fire size in acres and hectares
- Containment percentage with visual indicator
- Distance from query location to each fire
- Discovery date and days active
- Fire type (Wildfire vs Prescribed Fire)
- Location details (state, county, city)

**Returns (elsewhere / FIRMS):**
- Detection clusters within search radius, nearest first
- Per cluster: detection count, distance + bearing, centroid, peak fire radiative power (MW), newest detection age, day/night mix, confidence summary, satellite

**Both modes** include the 4-level safety assessment, banded on the nearest uncontained fire's distance (NIFC) or the nearest detection cluster's distance (FIRMS) **as displayed** (rounded to 0.1 km), so the tier can never disagree with the number shown:
- **EXTREME DANGER** (≤5 km): Evacuate if advised
- **HIGH ALERT** (>5–25 km): Prepare for evacuation
- **CAUTION** (>25–50 km): Monitor conditions
- **AWARENESS** (>50 km): Stay informed

On the NIFC path a fire whose containment **displays** as `100%` is excluded from the assessment, and the report says so by name; the tier keys on the nearest fire that is not.

**Note:** US data from NIFC WFIGS (Wildland Fire Interagency Geospatial Services); global detections from NASA FIRMS (Fire Information for Resource Management System). Always consult official sources for evacuation orders — in the US, https://inciweb.nwcg.gov/

### 14. save_location
Save a location with an alias for easy reuse in weather queries.

**Parameters:**
- `alias` (required): Short name for the location (e.g., "home", "work", "cabin"). Max 50 characters.
- `location_query` (optional): Location to geocode and save (e.g., "Seattle, WA", "Paris, France"). Not required if latitude/longitude provided.
- `latitude` (optional): Latitude if providing coordinates directly. Not required if location_query provided.
- `longitude` (optional): Longitude if providing coordinates directly. Not required if location_query provided.
- `name` (optional): Display name (required when using latitude/longitude directly)
- `activities` (optional): Activities you do at this location (e.g., ["boating", "fishing"]). Helps AI provide relevant weather information. Each activity max 50 characters.

**Description:**
Saves a location to persistent storage (`~/.weather-mcp/locations.json`) for easy reuse. Accepts either a location query (which will be automatically geocoded using Nominatim/OpenStreetMap) or direct coordinates. Once saved, the location can be used in any weather tool by providing `location_name` instead of coordinates.

**Smart Updates:** If the alias already exists and you only provide `name` and/or `activities` (without location details), it will update just those fields while preserving all coordinates and metadata. This makes it easy to add activities or rename locations without re-specifying the full address.

**Examples:**
```
"Save my home location in Seattle, WA"
  → save_location(alias="home", location_query="Seattle, WA")

"Save the cabin at Lake Tahoe"
  → save_location(alias="cabin", location_query="Lake Tahoe, CA")

"Save coordinates 47.6062, -122.3321 as my office"
  → save_location(alias="office", latitude=47.6062, longitude=-122.3321, name="Seattle Office")

"Save the lake house where we go boating and fishing"
  → save_location(alias="lake_house", location_query="Lake Tahoe, CA", activities=["boating", "fishing"])

"Save my favorite hiking spot"
  → save_location(alias="trail", location_query="Mt. Rainier, WA", activities=["hiking", "camping", "photography"])

"Add more activities to the cabin" (smart update - no location needed)
  → save_location(alias="cabin", activities=["boating", "fishing", "hiking", "swimming"])

"Rename my campsite" (smart update - no location needed)
  → save_location(alias="campsite", name="Yosemite Valley Campground")
```

**Returns:**
- Confirmation of save with location details
- Coordinates, timezone, and administrative region
- Usage examples showing how to use with weather tools

### 15. list_saved_locations
View all saved locations.

**Parameters:** None

**Description:**
Lists all locations saved in your persistent storage with their aliases, names, coordinates, and save dates. Helpful for seeing what location names are available for use with weather tools.

**Examples:**
```
"Show my saved locations"
"What locations do I have saved?"
"List all my saved places"
```

**Returns:**
- List of all saved locations with full details
- Usage examples for each location
- Total count of saved locations

### 16. get_saved_location
Get details for a specific saved location.

**Parameters:**
- `alias` (required): The name of the saved location to retrieve (e.g., "home", "work")

**Description:**
Retrieves detailed information about a specific saved location, including coordinates, timezone, region information, and save/update timestamps.

**Examples:**
```
"Show details for my home location"
"What are the coordinates for my cabin?"
"Get info about my work location"
```

**Returns:**
- Location name and coordinates
- Timezone and administrative regions
- Save and update timestamps
- Usage examples

### 17. remove_saved_location
Remove a saved location.

**Parameters:**
- `alias` (required): The name of the saved location to remove (e.g., "home", "work")

**Description:**
Permanently removes a saved location from storage. The location data is deleted and can no longer be used with weather tools unless saved again.

**Examples:**
```
"Remove my work location"
"Delete the cabin from saved locations"
"Remove home"
```

**Returns:**
- Confirmation of removal
- Count of remaining saved locations

---

## Finding Coordinates

Use the built-in `search_location` tool to find coordinates automatically:

```
"What's the weather in Paris?"
→ Uses search_location to find Paris coordinates (48.8534°, 2.3488°)
→ Then gets the forecast for those coordinates
```

You can also find coordinates manually:
- Using Google Maps: Right-click a location and select the coordinates
- Using a geocoding service like geocode.maps.co or nominatim.org

### Common City Coordinates (For Reference)

| City | Latitude | Longitude |
|------|----------|-----------|
| Paris, France | 48.8534 | 2.3488 |
| Tokyo, Japan | 35.6895 | 139.6917 |
| London, UK | 51.5085 | -0.1257 |
| New York, NY | 40.7128 | -74.0060 |
| San Francisco, CA | 37.7749 | -122.4194 |
| Sydney, Australia | -33.8688 | 151.2093 |
| Berlin, Germany | 52.5200 | 13.4050 |
| Dubai, UAE | 25.2048 | 55.2708 |

## Using Saved Locations with Weather Tools

Once you've saved locations, you can use them by providing `location_name` instead of coordinates:

```
# Instead of:
get_forecast(latitude=47.6062, longitude=-122.3321)

# You can use:
get_forecast(location_name="home")

# Natural language queries work too:
"What's the weather forecast at home?"
"How's the air quality at my cabin?"
```

**Currently Supported Tools:**
- `get_forecast` - Weather forecasts using saved locations

**Coming Soon:** Support for saved locations in all weather tools (current conditions, alerts, air quality, marine conditions, etc.)

## Units & Localization

Weather output defaults to **imperial** units and can be switched to **metric** either server-wide (environment variables) or per request (tool parameters). Precedence, highest first: a per-call `*_unit` override → a per-call `units` preset → a per-unit env override → the `WEATHER_UNITS` env default → imperial.

**Per-call parameters** (on `get_forecast`, `get_current_conditions`, `get_historical_weather`):

| Parameter | Values | Applies to |
|-----------|--------|------------|
| `units` | `imperial`, `metric` | Whole system (sets all of the below) |
| `temperature_unit` | `F`, `C` | Temperature, dewpoint, feels-like, normals |
| `wind_speed_unit` | `mph`, `kmh`, `ms`, `kn` | Wind speed and gusts |
| `precipitation_unit` | `inch`, `mm` | Precipitation, snowfall |
| `pressure_unit` | `inHg`, `hPa` | Barometric pressure |
| `distance_unit` | `mi`, `km` | Visibility, elevation |
| `time_format` | `12h`, `24h` | Clock times (headers, sunrise/sunset) |

**Environment defaults:** `WEATHER_UNITS` (`imperial`\|`metric`), plus `WEATHER_TEMPERATURE_UNIT`, `WEATHER_WIND_SPEED_UNIT`, `WEATHER_PRECIPITATION_UNIT`, `WEATHER_PRESSURE_UNIT`, `WEATHER_DISTANCE_UNIT`, `WEATHER_TIME_FORMAT`.

**Examples:**
```
"What's the forecast for Berlin in Celsius?"  → units: "metric"
"Wind in knots for the marina"                → wind_speed_unit: "kn"
```

**Note:** Fire-weather heights/transport wind, river gauge stage, and the marine tool's wave output use their domain-standard units and are not affected by this setting.

## Error Handling & Service Status

### Enhanced Error Messages

All error messages include:

- **Clear problem description** - What went wrong and why
- **Contextual help** - Specific guidance based on the error type
- **Status page links** - Direct links to official service status pages
- **Recommended actions** - Concrete steps to resolve or investigate the issue

**Example error messages:**

When a service is down:
```
NOAA API server error: Service temporarily unavailable

The NOAA Weather API may be experiencing an outage.

Check service status:
- Planned outages: https://weather-gov.github.io/api/planned-outages
- Service notices: https://www.weather.gov/notification
- Report issues: nco.ops@noaa.gov or (301) 683-1518
```

When rate limited:
```
Open-Meteo API rate limit exceeded (10,000 requests/day for non-commercial use).

Please retry later or consider:
- Reducing request frequency
- Using daily instead of hourly data for longer periods
- Upgrading to a commercial plan for higher limits

More info: https://open-meteo.com/en/pricing
```

### Service Status Checking

Use the `check_service_status` tool to proactively verify API availability:

**When to use:**
- Before making multiple weather requests
- When experiencing errors or timeouts
- To verify service availability after an outage
- For monitoring and alerting purposes

**Status Page Links:**
- **NOAA API:**
  - Planned outages: https://weather-gov.github.io/api/planned-outages
  - Service notices: https://www.weather.gov/notification
  - Report issues: https://weather-gov.github.io/api/reporting-issues

- **Open-Meteo API:**
  - Production status: https://open-meteo.com/en/docs/model-updates
  - GitHub issues: https://github.com/open-meteo/open-meteo/issues
  - Documentation: https://open-meteo.com/en/docs
