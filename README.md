# Weather MCP Server

[![npm version](https://badge.fury.io/js/@dangahagan%2Fweather-mcp.svg)](https://www.npmjs.com/package/@dangahagan/weather-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-2%2C518%20passing-brightgreen)](./docs/testing/TEST_SUITE_README.md)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)

**Give your AI assistant real weather data — 17 tools, zero API keys, zero signup, zero cost.**

Weather MCP is a [Model Context Protocol](https://modelcontextprotocol.io) server that connects AI assistants (Claude, Cursor, Cline, Zed, and any other MCP client) to live weather data: forecasts, current conditions, alerts, air quality, marine conditions, lightning, radar, rivers, wildfires, and 85+ years of historical weather. It's built entirely on free public data sources — NOAA, Open-Meteo, USGS, NIFC, NASA FIRMS, RainViewer, and Blitzortung.org — so there is nothing to sign up for and no key to paste in. (A few optional keys unlock extras — see [Optional API keys](#optional-api-keys) — but no tool ever requires one.)

```bash
claude mcp add weather -- npx -y @dangahagan/weather-mcp@latest
```

That's the whole install for Claude Code. For any other MCP client, add this to its MCP config:

```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@dangahagan/weather-mcp@latest"]
    }
  }
}
```

Then just ask:

> *"What's the weather in Tokyo this weekend?"*
> *"Is there any lightning near the lake right now?"*
> *"How does today compare to normal for this time of year?"*
> *"Are there wildfires within 50 miles of my cabin?"*
> *"Will there be a full moon this weekend?"*
> *"Is this a record high for today?"*
> *"How bad is the pollen in Berlin today?"*
> *"What was the weather in Paris on June 6, 1944?"*

👉 **[See it in action](./examples/)** — real prompts like these with the answers they produced, and the raw server output behind them.

📦 Listed in the [Official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp) as `io.github.dgahagan/weather-mcp`.

✅ **The official package is [`@dangahagan/weather-mcp`](https://www.npmjs.com/package/@dangahagan/weather-mcp)**, published from this repository via npm [trusted publishing](https://docs.npmjs.com/trusted-publishers). Every release carries a signed provenance attestation tying the tarball to the exact commit and workflow that built it — verify any version without installing it:

```bash
npm view @dangahagan/weather-mcp@latest dist.attestations
```

Republished copies of this server exist under other npm scopes. They are MIT-licensed forks, which the license permits, but they are not maintained here and are usually many versions behind. This issue tracker covers `@dangahagan/weather-mcp` only — for anything installed from another scope, please report it to that package's publisher.

## Why this server?

There are excellent commercial weather MCPs backed by paid APIs and full-time teams. If you need SLA-backed data, minute-level nowcasting, or premium global station coverage, they're worth a look — this project won't pretend otherwise.

Choose this one if you want:

- **Genuinely free** — every data source is a free public API. No trial that expires, no credit card, no rate-limited "free tier" bait.
- **No API keys** — install to first forecast in under a minute. Nothing to configure, nothing to leak into a repo. ([Three optional keys](#optional-api-keys) add extras if you want them; the default configuration needs none.)
- **Fully open source** — MIT licensed, readable TypeScript, 2,518 tests. Audit it, fork it, fix it.
- **Privacy-respecting** — your queries go directly from your machine to public weather APIs. No middleman server, no telemetry.
- **Breadth** — 17 tools covering weather, safety hazards (lightning, floods, wildfires), marine conditions, air quality, and historical data back to 1940. Most weather MCPs stop at forecasts.

The tradeoff is honest: US data (NOAA) is richer than international data (Open-Meteo), some tools are US-only, and free APIs come with fair-use rate limits. See [Coverage & Limitations](#coverage--limitations).

## Tools

All 17 tools, documented in detail in **[docs/TOOLS.md](./docs/TOOLS.md)**:

| Tool | What it does | Coverage |
|------|-------------|----------|
| `get_forecast` | Daily/hourly forecasts up to 16 days by coordinates, saved location, or city name; sunrise/sunset, UV, precipitation probability, optional climate-normals comparison, optional moon phase & twilight almanac, optional five-model agreement comparison | 🌍 Global |
| `get_current_conditions` | Current weather: temperature, wind, humidity, pressure; NOAA station observations in the US (plus heat index/wind chill, snow depth, optional NOAA fire-weather indices), Open-Meteo model data elsewhere (with an optional computed Fosberg fire-weather index), or real airport station observations worldwide with `source="metar"`. Always states the observation's age, and automatically falls back to a fresher nearby station when the nearest one has gone dark. In extreme conditions automatically adds frostbite time-to-onset (computed wind chill) or heat-stress context (estimated WBGT) | 🌍 Global |
| `get_alerts` | Active watches, warnings, and advisories sorted by severity; official national warnings for the US (NOAA), Canada (ECCC), 38 European countries (MeteoAlarm), India (NDMA SACHET), the Philippines (PAGASA), and Indonesia (BMKG) | 🇺🇸 🇨🇦 🇪🇺 🇮🇳 🇵🇭 🇮🇩 |
| `get_historical_weather` | Hourly/daily observations from 1940 to present | 🌍 Global |
| `get_weather_summary` | One-call overview combining current conditions, forecast, and alerts (optionally air quality and lightning) | 🌍 Global |
| `search_location` | Geocode place names to coordinates ("Paris" → 48.85, 2.35) | 🌍 Global |
| `get_air_quality` | AQI (US/European scales), pollutants, UV index, health guidance; current pollen levels for European locations (or worldwide with an optional key); optional day-grouped forecast up to 7 days with per-day peak AQI and UV | 🌍 Global |
| `get_marine_conditions` | Wave height, swell, ocean currents, Douglas Sea Scale — includes Great Lakes and major US bays; forecast up to 16 days | 🌍 Global |
| `get_weather_imagery` | Precipitation radar (static or 2-hour animated loops) + GOES satellite imagery; `composite: true` returns a finished radar map over a base map as an image | 🌍 Global |
| `get_lightning_activity` | Real-time strike detection with 4-level proximity safety assessment | 🌍 Global |
| `get_river_conditions` | US: NWPS gauge levels, flood stages, streamflow, rise/fall trends, forecast series. Elsewhere: GloFAS modeled discharge snapped to the nearest river channel, with ensemble forecast | 🌍 Global |
| `get_wildfire_info` | US: named incidents with containment, size, and safety guidance from the nearest *uncontained* fire. Elsewhere: NASA FIRMS satellite heat detections (VIIRS, near real-time), clustered with distance, bearing, and intensity | 🌍 Global |
| `check_service_status` | Health checks for all upstream APIs plus cache statistics | — |
| `save_location` | Save places as aliases ("home", "cabin") with optional activity tags | — |
| `list_saved_locations` | List all saved locations | — |
| `get_saved_location` | Details for one saved location | — |
| `remove_saved_location` | Delete a saved location | — |

> **Default preset:** with no configuration, the server exposes 17 tools led by `get_weather_summary` (one call covers most "what's the weather?" questions), plus `forecast`, `current_conditions`, `alerts`, `search_location`, and `check_service_status`. Enable everything with one environment variable — see [Tool Selection](#tool-selection).

> **Consistent location input:** every location-based tool accepts the same three forms — `latitude`+`longitude`, a saved `location_name` (e.g. `"home"`), or a free-text `city_name` (e.g. `"Bend, Oregon"`, geocoded automatically). When a name is used, the response echoes the resolved place and coordinates.

> **Output verbosity:** high-volume tools (`get_forecast`, `get_alerts`, `get_weather_imagery`, `get_river_conditions`, `get_wildfire_info`, `get_lightning_activity`) accept `detail: "summary" | "standard" | "full"` (default `standard`) to trade completeness for token cost — e.g. `full` returns the complete alert text, uncapped hourly forecast, every radar animation frame, and up to 25 nearby gauges/fires/strikes instead of the default 5-10.

## Feature highlights

- **Smart source selection** — US queries use NOAA (detailed, includes forecaster narratives); everywhere else uses Open-Meteo. You never pick; it just works.
- **International weather alerts** — `get_alerts` routes by country: NOAA in the US, Environment and Climate Change Canada alerts in Canada, the official national warnings of 38 European countries via EUMETNET MeteoAlarm, and the national CAP feeds of India (NDMA SACHET), the Philippines (PAGASA) and Indonesia (BMKG) — shown unmodified, with the issuing service credited. Where a feed publishes geometry inline, warnings are matched to your exact point by the alert's own polygon rather than to the whole country (the Philippines and Indonesia today; Europe remains country-level). Border cities like Toronto get the right country's alerts, not the nearest bounding box's.
- **Real observations worldwide** — ask for what a station is *actually reporting* and `get_current_conditions` will read the nearest airport's METAR (`source="metar"`): a genuine instrument reading anywhere on earth, with the station, its distance, and the observation age always stated. Outside the US this is the difference between a measurement and a model estimate.
- **Model agreement** — ask *"how confident is this forecast?"* and `compare_models=true` compares five global models (GFS, ECMWF, ICON, GEM, UKMO) in one request, summarizing where they agree and where they split rather than dumping five forecasts. Spread across models is a proxy for uncertainty, not a guarantee — a tight spread can still be wrong, and the output says so.
- **Ensemble spread** — the sibling question: *"how confident is the model itself?"* `ensemble_spread=true` summarizes ECMWF ENS's 50 perturbed members — per-day High/Moderate/Low confidence, interquartile temperature bands, and how many members produce rain — instead of one deterministic forecast. Member fractions are raw model output, **not calibrated probabilities**: a confident ensemble can still be wrong, and the output says so. Mutually exclusive with `compare_models`; the two answer different questions.
- **Saved locations** — save "home", "work", or "cabin" once, then ask *"what's the weather at home?"* Locations persist in `~/.weather-mcp/locations.json` and can be tagged with activities ("boating", "skiing") so the AI highlights what matters to you.
- **Climate context** — optional 30-year climate normals show how today compares: *"10°F warmer than normal for this date."* For US locations the normals also carry the record high/low for the date and the year it was set: *"is this a record high?"*
- **Astronomy almanac** — opt-in moon phase, illumination, moonrise/moonset, civil/nautical/astronomical twilight, and next full/new moon dates on daily forecasts (`include_astronomy`). Computed locally — accurate to the arcminute, works at the poles, costs zero API calls: *"when does it get fully dark?"*
- **Safety-aware output** — lightning, wildfire, flood, and marine tools include graded safety assessments and plain-language recommendations, not just raw numbers.
- **Winter weather** — snow depth, snowfall accumulation, and ice accumulation forecasts with sensible trace-amount filtering.
- **Timezone-aware** — every timestamp is rendered in the location's local time with DST handled correctly.
- **Imperial or metric** — pick your units server-wide (`WEATHER_UNITS`) or per request (`units: "metric"`), with fine-grained overrides (wind in knots, pressure in hPa, 24-hour clock). Defaults to imperial. See [Units & Localization](#units--localization).
- **Built-in caching** — an LRU cache with per-data-type TTLs (5 minutes for alerts, 2 hours for forecasts, forever for finalized historical data) makes repeat queries return in <10ms and cuts upstream API calls by 50–80%.
- **Actionable errors** — failures explain what happened and link to the upstream status page instead of dumping a stack trace.

## Data sources

All free, all public, no authentication required:

| Source | Provides | Coverage |
|--------|----------|----------|
| [NOAA Weather API](https://www.weather.gov/documentation/services-web-api) | US forecasts, current conditions, alerts, fire weather | US |
| [Open-Meteo](https://open-meteo.com/) | Global forecasts, historical data (1940+), air quality, marine, geocoding, climate normals, fire-weather inputs | Global |
| [NOAA NWPS](https://water.noaa.gov/) | River levels, streamflow, flood stages | US |
| [RCC ACIS](https://www.rcc-acis.org/) | Daily record high/low temperatures | US |
| [EUMETNET MeteoAlarm](https://meteoalarm.org/) | Official national weather warnings (38 European countries) | Europe |
| [MSC GeoMet](https://api.weather.gc.ca/) | Environment and Climate Change Canada weather alerts | Canada |
| [NDMA SACHET](https://sachet.ndma.gov.in/) | Official Indian warnings (CAP, polygon geometry) — public domain | India |
| [PAGASA](https://publicalert.pagasa.dost.gov.ph/) | Official Philippine warnings (CAP, inline polygons) — CC BY 4.0 | Philippines |
| [BMKG](https://www.bmkg.go.id/) | Official Indonesian nowcast warnings (CAP, inline polygons) — attribution required | Indonesia |
| [NIFC WFIGS](https://data-nifc.opendata.arcgis.com/) | Active wildfire perimeters and incidents | US |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) | Satellite fire detections (VIIRS, near real-time) | Global |
| [RainViewer](https://www.rainviewer.com/api.html) | Precipitation radar imagery | Global |
| [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) | GOES GeoColor satellite imagery; base map for composited radar | Western Hemisphere (satellite), Global (base map) |
| [Blitzortung.org](https://www.blitzortung.org/) | Community lightning detection network | Global |

Open-Meteo allows 10,000 requests/day for non-commercial use; caching keeps typical AI usage far below that. Please respect the upstream providers' fair-use terms.

Composited radar maps (`get_weather_imagery` with `composite: true`) carry the acknowledgment NASA requests for GIBS imagery, alongside the RainViewer radar credit:

> Imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).

## Installation

**Recommended — npx (always latest, nothing to manage):**

```bash
# Claude Code
claude mcp add weather -- npx -y @dangahagan/weather-mcp@latest
```

Or in any MCP client's configuration:

```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@dangahagan/weather-mcp@latest"]
    }
  }
}
```

**Global install:**

```bash
npm install -g @dangahagan/weather-mcp
```

**From source:**

```bash
git clone https://github.com/weather-mcp/weather-mcp.git
cd weather-mcp
npm install
npm run build
```

Then point your MCP client at `node /absolute/path/to/weather-mcp/dist/index.js`.

Requires Node.js 18+. No API keys, tokens, or accounts needed — see [Optional API keys](#optional-api-keys) for the three that add optional extras.

### Works with

Claude Desktop, Claude Code, Cline, Cursor, Zed, VS Code (GitHub Copilot), LM Studio, Postman — any client that speaks MCP. Per-client setup instructions: **[docs/CLIENT_SETUP.md](./docs/CLIENT_SETUP.md)**.

### Upgrading

- **npx users:** nothing to do — `@latest` always fetches the newest version.
- **Global install:** `npm install -g @dangahagan/weather-mcp@latest`
- **From source:** `git pull && npm install && npm run build`

Restart your MCP client after upgrading. See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## Configuration

**Most users need zero configuration.** Everything below is optional.

Settings can go in a `.env` file (see [`.env.example`](./.env.example)) or directly in your MCP client config:

```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@dangahagan/weather-mcp@latest"],
      "env": {
        "ENABLED_TOOLS": "all",
        "CACHE_MAX_SIZE": "2000",
        "LOG_LEVEL": "1"
      }
    }
  }
}
```

### Tool Selection

Control which tools are exposed to reduce context overhead:

| Preset | Tools |
|--------|-------|
| `basic` (default) | weather_summary, forecast, current_conditions, alerts, search_location, check_service_status |
| `standard` | basic + historical_weather, air_quality, and saved-location tools |
| `full` | everything — standard + marine, imagery, lightning, rivers, wildfire (same as `all`) |
| `all` | all 17 tools |

```bash
ENABLED_TOOLS=all                               # Use a preset
ENABLED_TOOLS=forecast,current,alerts,aqi       # Specific tools only
ENABLED_TOOLS=basic,+historical,+air_quality    # Add to a preset
ENABLED_TOOLS=all,-marine                       # Remove from a preset
```

Short aliases are supported: `forecast`, `current`, `alerts`, `historical`, `status`, `search`, `aqi`, `marine`, `radar`, `lightning`, and more.

### Units & Localization

Output defaults to **imperial** (°F, mph, inHg, miles) and can be switched to **metric** (°C, km/h, hPa, km) server-wide or per request. Precedence: a per-call parameter beats a per-unit env override, which beats the `WEATHER_UNITS` system default.

```bash
WEATHER_UNITS=metric            # switch everything to metric
WEATHER_WIND_SPEED_UNIT=kn      # ...but wind in knots
WEATHER_TIME_FORMAT=24h         # 24-hour clock
```

Or per call — the AI can honor "in Celsius" on the fly:

```jsonc
{ "latitude": 47.6, "longitude": -122.3, "units": "metric" }
{ "latitude": 47.6, "longitude": -122.3, "wind_speed_unit": "kn", "pressure_unit": "hPa" }
```

Supported on `get_forecast`, `get_current_conditions`, and `get_historical_weather`. Wind accepts `mph`/`kmh`/`ms`/`kn`; pressure `inHg`/`hPa`. Domain-specialized readings (fire-weather heights, river gauge stage, and the marine tool's dual-unit wave output) keep their conventional units.

### Other settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENABLED_TOOLS` | `basic` | Tool preset or list (see above) |
| `WEATHER_UNITS` | `imperial` | Default unit system: `imperial` or `metric` |
| `WEATHER_TEMPERATURE_UNIT` … | — | Per-unit overrides: `_TEMPERATURE_`(F/C), `_WIND_SPEED_`(mph/kmh/ms/kn), `_PRECIPITATION_`(inch/mm), `_PRESSURE_`(inHg/hPa), `_DISTANCE_`(mi/km), `_TIME_FORMAT`(12h/24h) |
| `CACHE_ENABLED` | `true` | Enable/disable response caching |
| `CACHE_MAX_SIZE` | `1000` | Max cache entries (100–10000) |
| `API_TIMEOUT_MS` | `30000` | Upstream API timeout (5000–120000) |
| `WEATHER_LIGHTNING_PREWARM` | `true` | Subscribe saved locations' geohashes at startup so `get_lightning_activity` has coverage before the first query. Set `false` to skip this and avoid the persistent MQTT connection at startup. No effect when the lightning tool is disabled. |
| `LOG_LEVEL` | `1` | 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR (logs go to stderr) |
| `NCEI_API_TOKEN` | — | Optional [free NCEI token](https://www.ncdc.noaa.gov/cdo-web/token) for official NOAA climate normals (US); falls back to Open-Meteo automatically. See [Optional API keys](#optional-api-keys) |
| `FIRMS_MAP_KEY` | — | Optional [free FIRMS key](https://firms.modaps.eosdis.nasa.gov/api/map_key/) for targeted wildfire queries and up to 5 days of detection history. See [Optional API keys](#optional-api-keys) |
| `GOOGLE_POLLEN_API_KEY` | — | Optional key for pollen outside Europe (incl. the US). **Requires a Google Cloud billing account** — free tier is 5,000 lookups/month. See [Optional API keys](#optional-api-keys) and [the setup guide](./docs/GOOGLE_POLLEN_KEY_SETUP.md) |
| `GOOGLE_WEATHER_API_KEY` | — | Optional key for official weather alerts beyond the US, Canada, Europe, India, the Philippines, and Indonesia (~45+ more territories). **Requires a Google Cloud billing account.** See [Optional API keys](#optional-api-keys) and [the setup guide](./docs/GOOGLE_WEATHER_KEY_SETUP.md) |

For caching architecture details, see [.github/CACHING.md](./.github/CACHING.md).

## Optional API keys

**The default is the product.** Every one of the 17 tools works with zero keys,
zero signup, and zero cost — that is the configuration this project is built
around and the one most people should use. If that's you, you can skip this
section entirely.

Four optional keys each unlock one extra. Without them the corresponding tool
still works; it just returns the keyless answer.

| Variable | What it costs | What it adds | Without it |
|----------|---------------|--------------|------------|
| [`NCEI_API_TOKEN`](https://www.ncdc.noaa.gov/cdo-web/token) | Free registration (email) | Official NOAA station climate normals for US locations | Normals are computed from the Open-Meteo reanalysis archive — global, and the path virtually every user is already on |
| [`FIRMS_MAP_KEY`](https://firms.modaps.eosdis.nasa.gov/api/map_key/) | Free registration (email) | Targeted wildfire bbox queries with 1–5 days of detection history | Keyless 24-hour regional detection files — `get_wildfire_info` still works globally |
| `GOOGLE_POLLEN_API_KEY` | **Free tier, but requires a Google Cloud billing account (credit card on file)** — 5,000 lookups/month free, ~$10/1,000 after. [Setup guide](./docs/GOOGLE_POLLEN_KEY_SETUP.md) | Grass/tree/weed Universal Pollen Index outside Europe, including the US (65+ countries) | European pollen via CAMS still works keyless; elsewhere no pollen section renders |
| `GOOGLE_WEATHER_API_KEY` | **Free tier, but requires a Google Cloud billing account (credit card on file)** — the Weather API bills under a Maps Platform Essentials SKU; check Google's current allowance. [Setup guide](./docs/GOOGLE_WEATHER_KEY_SETUP.md) | Official weather alerts for ~45+ more territories — Australia, Japan, Brazil, Mexico and others ([Google's coverage list](https://developers.google.com/maps/documentation/weather/coverage) is authoritative) | US, Canadian, European, Indian, Philippine, and Indonesian alerts still work keyless; elsewhere `get_alerts` returns today's not-covered message |

The NCEI and FIRMS keys are true free registrations. **The two Google keys are
not** — each has a free usage tier, but Google requires a billing account with
a payment method to issue them at all. That's why they aren't described as
simply "free" anywhere in these docs, and why they stay strictly optional. They
are separate variables on purpose: the recommended console restriction ties a
key to one specific API, so a Pollen-restricted key cannot serve alerts and
vice versa. If you prefer one unrestricted key, put the same string in both.

### Standing key policy

So the "genuinely free" promise above stays meaningful, this project holds to
three rules:

1. **Optional keys must always have a usable free tier.** A key that only makes
   sense once you're paying doesn't belong here.
2. **No tool will ever *require* a key.** Every feature has a keyless path, even
   if that path is "this data isn't available for your region".
3. **Features that would require a *paid* key are out of scope** unless there's
   significant user demand for that specific service.

## Coverage & Limitations

Being honest about what free public data can and can't do:

| Capability | Global | US-only |
|-----------|--------|---------|
| Forecasts (up to 16 days) | ✅ | Richer detail via NOAA |
| Historical weather (1940+) | ✅ (>7 days old) | Station-level detail for last 7 days |
| Air quality, marine, radar, lightning | ✅ | — |
| Current conditions | ✅ (model data, or real station observations via `source="metar"`) | Station observations via NOAA (richer detail) |
| Weather alerts | ✅ US, Canada, 38 European countries, India, the Philippines, and Indonesia keyless; ~45+ more territories with an optional key | NWS zone-level precision; Europe and India country-level; Philippines and Indonesia polygon-level |
| River conditions | ✅ (GloFAS modeled discharge) | Gauge observations + official flood stages via NWPS |
| Wildfires | ✅ (FIRMS satellite detections) | Named incidents with acreage + containment via NIFC |
| Fire weather | ✅ (computed Fosberg index + dryness context) | NOAA-published Haines, grassland, red-flag indices |
| Pollen | 🇪🇺 Europe keyless (CAMS, grains/m³); elsewhere needs an optional key | Universal Pollen Index with `GOOGLE_POLLEN_API_KEY` |

- European alerts are matched at **country level** — the keyless MeteoAlarm feeds carry no region polygons, so warnings for a large country may not affect the requested point; the output says so. Canadian alerts use a real bbox query with polygon-backed features.
- **Philippine and Indonesian alerts are matched by the alert's own polygon**, so a warning is shown only when it actually covers the requested point — finer than Europe's country-level matching. **Indian alerts are currently country-level**: SACHET publishes each alert's geometry from a separate endpoint that is not reliably reachable from servers, so Indian warnings are listed with an explicit note that they may not affect your exact location, exactly as Europe's are. Any alert whose geometry cannot be loaded is always listed rather than dropped — never silently treated as "not near you".
- Outside the US, Canada, Europe, India, the Philippines, and Indonesia, alerts need an optional [`GOOGLE_WEATHER_API_KEY`](#optional-api-keys); without one `get_alerts` says plainly that the region isn't covered rather than guessing. With a key, Google aggregates official national feeds for roughly 45 more territories — Australia, Japan, Brazil and Mexico among them, with [Google's coverage page](https://developers.google.com/maps/documentation/weather/coverage) as the authoritative list. Matching is by **provider polygon**, so coverage alignment may not be exact and an empty answer means "no alerts found", not a guarantee of coverage; the output says so both ways. Alert text appears in the publisher's source language. **The US, Canada, Europe, India, the Philippines, and Indonesia never contact Google** — those authorities stay first choice, key or no key — and a key failure surfaces loudly rather than degrading to a possibly-false all-clear.
- International current conditions default to **model-interpolated** values at the exact coordinates. `source="metar"` returns a **real instrument reading** instead — but from the nearest airport, which may be tens of km away and up to an hour old. The output always names the station, its distance and bearing, and the observation age, so the tradeoff is visible rather than assumed. METAR coverage follows airports, so remote land and open ocean have real gaps.
- Historical data older than 7 days comes from reanalysis models (9–25km grid), not direct station observations, and trails real time by ~5 days.
- Non-US wildfire results are **satellite heat detections, not managed incidents** — no fire names, sizes, or containment percentages exist in the data, detections can include industrial heat sources or agricultural burns, and a clear result is not an all-clear (cloud cover hides fires; small or new fires evade detection). The output frames all of this explicitly. Keyless data covers the last 24 hours; an optional free [`FIRMS_MAP_KEY`](https://firms.modaps.eosdis.nasa.gov/api/map_key/) unlocks targeted queries and up to 5 days of detection history (`day_range`).
- Frostbite-risk and heat-stress (WBGT) lines are **computed by this server** from temperature, humidity, and wind — not agency-published ratings. The wind chill is the standard 2001 North American model; the frostbite time bands are adapted from Environment Canada's published categories and the WBGT is the Australian Bureau of Meteorology's *simplified* estimate, which assumes full sun and light wind and so can overestimate in shade or overcast. Exertion thresholds also genuinely shift with acclimatization. Treat both as context, not as an occupational-safety determination.
- Non-US fire weather is a **Fosberg Fire Weather Index computed by this server** from current model values, not an agency-published rating — US locations get NOAA's own Haines/grassland/red-flag indices instead. The output says which it is and defers to national fire authorities; its category bands are a project heuristic.
- Non-US river discharge is **modeled**, not observed, and has no official flood-stage thresholds — levels are shown relative to recent history and the forecast ensemble. The ~5km model grid means the reported channel may be a few km from the requested point; the output says so when it is.
- Pollen is **Europe-only without a key**: it rides the CAMS European model on the air-quality endpoint, which returns real grains/m³ in Europe and nothing anywhere else. An optional [`GOOGLE_POLLEN_API_KEY`](#optional-api-keys) fills the gap for 65+ countries including the US, as a grass/tree/weed Universal Pollen Index (0–5) rather than per-species counts. Europe keeps the richer keyless data and never contacts Google.
- Marine data has limited coastal accuracy and is **not suitable for navigation**.
- Lightning coverage varies by region (community-operated detector network).
- Open-Meteo's fair-use limit is 10,000 requests/day; the built-in cache makes this hard to hit in normal use.

## Development

```bash
npm run build          # Compile TypeScript
npm run dev            # Run in development mode
npm test               # Run all 2,518 tests
npm run test:coverage  # Coverage report
npm run audit          # Dependency vulnerability scan
```

**Quality bar:** TypeScript strict mode, no `any` types, 100% test coverage on critical utilities (cache, validation, unit conversion, errors), 100% pass rate, minimal runtime dependencies.

Project structure, patterns, and contribution guidance:
- [CONTRIBUTING.md](./CONTRIBUTING.md) — how to contribute
- [CLAUDE.md](./CLAUDE.md) — architecture and development guide
- [docs/README.md](./docs/README.md) — complete documentation index

## Security

- All inputs validated (coordinates, dates, ranges) before any API call
- Error messages sanitized — no internal details leak to output
- Zero secrets by design: no keys means nothing to steal or misconfigure
- Automated dependency scanning (npm audit + Dependabot), minimal dependency footprint
- Security policy and supported versions: see [SECURITY.md](./SECURITY.md)

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## Documentation

- **[Examples](./examples/)** — realistic sessions in cities around the world: prompt → assistant answer → verbatim server output
- **[Tool Reference](./docs/TOOLS.md)** — all 17 tools: parameters, examples, sample output
- **[Client Setup](./docs/CLIENT_SETUP.md)** — step-by-step for 8 MCP clients
- **[Error Handling](./docs/ERROR_HANDLING.md)** — how failures are reported
- **[Testing Guide](./docs/testing/TESTING_GUIDE.md)** — manual testing procedures
- **[Changelog](./CHANGELOG.md)** — version history
- **[Full documentation index](./docs/README.md)**

## Contributing

Contributions are welcome — this is a single-maintainer project and issues, PRs, and feedback genuinely help. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) — free to use, modify, and distribute.

---

*Weather data provided by NOAA, Open-Meteo, USGS, NIFC, RainViewer, and Blitzortung.org. This project is not affiliated with or endorsed by any of these providers. Do not rely on this server as your sole source for safety-critical decisions — always consult official warnings and forecasts.*
