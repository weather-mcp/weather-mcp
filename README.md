# Weather MCP Server

[![npm version](https://badge.fury.io/js/@dangahagan%2Fweather-mcp.svg)](https://www.npmjs.com/package/@dangahagan/weather-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-1%2C084%20passing-brightgreen)](./docs/testing/TEST_SUITE_README.md)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)

**Give your AI assistant real weather data — 16 tools, zero API keys, zero signup, zero cost.**

Weather MCP is a [Model Context Protocol](https://modelcontextprotocol.io) server that connects AI assistants (Claude, Cursor, Cline, Zed, and any other MCP client) to live weather data: forecasts, current conditions, alerts, air quality, marine conditions, lightning, radar, rivers, wildfires, and 85+ years of historical weather. It's built entirely on free public data sources — NOAA, Open-Meteo, USGS, NIFC, RainViewer, and Blitzortung.org — so there is nothing to sign up for and no key to paste in.

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
> *"What was the weather in Paris on June 6, 1944?"*

📦 Listed in the [Official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp) as `io.github.dgahagan/weather-mcp`.

## Why this server?

There are excellent commercial weather MCPs backed by paid APIs and full-time teams. If you need SLA-backed data, minute-level nowcasting, or premium global station coverage, they're worth a look — this project won't pretend otherwise.

Choose this one if you want:

- **Genuinely free** — every data source is a free public API. No trial that expires, no credit card, no rate-limited "free tier" bait.
- **No API keys** — install to first forecast in under a minute. Nothing to configure, nothing to leak into a repo.
- **Fully open source** — MIT licensed, readable TypeScript, 1,084 tests. Audit it, fork it, fix it.
- **Privacy-respecting** — your queries go directly from your machine to public weather APIs. No middleman server, no telemetry.
- **Breadth** — 16 tools covering weather, safety hazards (lightning, floods, wildfires), marine conditions, air quality, and historical data back to 1940. Most weather MCPs stop at forecasts.

The tradeoff is honest: US data (NOAA) is richer than international data (Open-Meteo), some tools are US-only, and free APIs come with fair-use rate limits. See [Coverage & Limitations](#coverage--limitations).

## Tools

All 16 tools, documented in detail in **[docs/TOOLS.md](./docs/TOOLS.md)**:

| Tool | What it does | Coverage |
|------|-------------|----------|
| `get_forecast` | Daily/hourly forecasts up to 16 days, sunrise/sunset, UV, precipitation probability, optional climate-normals comparison | 🌍 Global |
| `get_current_conditions` | Real-time observations: temperature, wind, heat index/wind chill, snow depth, optional fire-weather indices | 🇺🇸 US |
| `get_alerts` | Active watches, warnings, and advisories sorted by severity | 🇺🇸 US |
| `get_historical_weather` | Hourly/daily observations from 1940 to present | 🌍 Global |
| `search_location` | Geocode place names to coordinates ("Paris" → 48.85, 2.35) | 🌍 Global |
| `get_air_quality` | AQI (US/European scales), pollutants, UV index, health guidance | 🌍 Global |
| `get_marine_conditions` | Wave height, swell, ocean currents, Douglas Sea Scale — includes Great Lakes and major US bays | 🌍 Global |
| `get_weather_imagery` | Precipitation radar (static or 2-hour animated loops) + GOES satellite imagery | 🌍 Global |
| `get_lightning_activity` | Real-time strike detection with 4-level proximity safety assessment | 🌍 Global |
| `get_river_conditions` | River gauge levels, flood stages, streamflow | 🇺🇸 US |
| `get_wildfire_info` | Active fires, containment, size, proximity-based safety guidance | 🇺🇸 US |
| `check_service_status` | Health checks for all upstream APIs plus cache statistics | — |
| `save_location` | Save places as aliases ("home", "cabin") with optional activity tags | — |
| `list_saved_locations` | List all saved locations | — |
| `get_saved_location` | Details for one saved location | — |
| `remove_saved_location` | Delete a saved location | — |

> **Default preset:** to keep your AI's context lean, the server exposes 5 essential tools by default (`forecast`, `current_conditions`, `alerts`, `search_location`, `check_service_status`). Enable everything with one environment variable — see [Tool Selection](#tool-selection).

## Feature highlights

- **Smart source selection** — US queries use NOAA (detailed, includes forecaster narratives); everywhere else uses Open-Meteo. You never pick; it just works.
- **Saved locations** — save "home", "work", or "cabin" once, then ask *"what's the weather at home?"* Locations persist in `~/.weather-mcp/locations.json` and can be tagged with activities ("boating", "skiing") so the AI highlights what matters to you.
- **Climate context** — optional 30-year climate normals show how today compares: *"10°F warmer than normal for this date."*
- **Safety-aware output** — lightning, wildfire, flood, and marine tools include graded safety assessments and plain-language recommendations, not just raw numbers.
- **Winter weather** — snow depth, snowfall accumulation, and ice accumulation forecasts with sensible trace-amount filtering.
- **Timezone-aware** — every timestamp is rendered in the location's local time with DST handled correctly.
- **Built-in caching** — an LRU cache with per-data-type TTLs (5 minutes for alerts, 2 hours for forecasts, forever for finalized historical data) makes repeat queries return in <10ms and cuts upstream API calls by 50–80%.
- **Actionable errors** — failures explain what happened and link to the upstream status page instead of dumping a stack trace.

## Data sources

All free, all public, no authentication required:

| Source | Provides | Coverage |
|--------|----------|----------|
| [NOAA Weather API](https://www.weather.gov/documentation/services-web-api) | US forecasts, current conditions, alerts, fire weather | US |
| [Open-Meteo](https://open-meteo.com/) | Global forecasts, historical data (1940+), air quality, marine, geocoding, climate normals | Global |
| [USGS Water Services](https://waterservices.usgs.gov/) + [NOAA NWPS](https://water.noaa.gov/) | River levels, streamflow, flood stages | US |
| [NIFC WFIGS](https://data-nifc.opendata.arcgis.com/) | Active wildfire perimeters and incidents | US |
| [RainViewer](https://www.rainviewer.com/api.html) | Precipitation radar imagery | Global |
| [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) | GOES GeoColor satellite imagery | Western Hemisphere |
| [Blitzortung.org](https://www.blitzortung.org/) | Community lightning detection network | Global |

Open-Meteo allows 10,000 requests/day for non-commercial use; caching keeps typical AI usage far below that. Please respect the upstream providers' fair-use terms.

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

Requires Node.js 18+. No API keys, tokens, or accounts needed.

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
| `basic` (default) | forecast, current_conditions, alerts, search_location, check_service_status |
| `standard` | basic + historical_weather |
| `full` | standard + air_quality |
| `all` | everything — all 16 tools including marine, imagery, lightning, rivers, wildfire, and saved locations |

```bash
ENABLED_TOOLS=all                               # Use a preset
ENABLED_TOOLS=forecast,current,alerts,aqi       # Specific tools only
ENABLED_TOOLS=basic,+historical,+air_quality    # Add to a preset
ENABLED_TOOLS=all,-marine                       # Remove from a preset
```

Short aliases are supported: `forecast`, `current`, `alerts`, `historical`, `status`, `search`, `aqi`, `marine`, `radar`, `lightning`, and more.

### Other settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENABLED_TOOLS` | `basic` | Tool preset or list (see above) |
| `CACHE_ENABLED` | `true` | Enable/disable response caching |
| `CACHE_MAX_SIZE` | `1000` | Max cache entries (100–10000) |
| `API_TIMEOUT_MS` | `30000` | Upstream API timeout (5000–120000) |
| `LOG_LEVEL` | `1` | 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR (logs go to stderr) |
| `NCEI_API_TOKEN` | — | Optional [free NCEI token](https://www.ncdc.noaa.gov/cdo-web/token) for official NOAA climate normals (US); falls back to Open-Meteo automatically |

For caching architecture details, see [.github/CACHING.md](./.github/CACHING.md).

## Coverage & Limitations

Being honest about what free public data can and can't do:

| Capability | Global | US-only |
|-----------|--------|---------|
| Forecasts (up to 16 days) | ✅ | Richer detail via NOAA |
| Historical weather (1940+) | ✅ (>7 days old) | Station-level detail for last 7 days |
| Air quality, marine, radar, lightning | ✅ | — |
| Current conditions | ❌ | ✅ |
| Weather alerts | ❌ | ✅ |
| River conditions, wildfires | ❌ | ✅ |

- Historical data older than 7 days comes from reanalysis models (9–25km grid), not direct station observations, and trails real time by ~5 days.
- Marine data has limited coastal accuracy and is **not suitable for navigation**.
- Lightning coverage varies by region (community-operated detector network).
- Open-Meteo's fair-use limit is 10,000 requests/day; the built-in cache makes this hard to hit in normal use.

## Development

```bash
npm run build          # Compile TypeScript
npm run dev            # Run in development mode
npm test               # Run all 1,084 tests (~2 seconds)
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
- Independent security audit: see [docs/development/SECURITY_AUDIT.md](./docs/development/SECURITY_AUDIT.md)

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## Documentation

- **[Tool Reference](./docs/TOOLS.md)** — all 16 tools: parameters, examples, sample output
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
