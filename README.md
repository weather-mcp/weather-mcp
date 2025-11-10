# Weather MCP Server

[![npm version](https://badge.fury.io/js/@dangahagan%2Fweather-mcp.svg)](https://www.npmjs.com/package/@dangahagan/weather-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that provides **global weather data** to AI systems like Claude Code. Uses NOAA's API for detailed US weather, plus Open-Meteo for international forecasts and historical weather data worldwide.

**📦 Available in the [Official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp)** as `io.github.dgahagan/weather-mcp`

**No API keys required!** All APIs (NOAA, Open-Meteo) are free to use with no authentication needed.

## Features

- **Global Weather Forecasts**: Get forecasts for any location worldwide (ENHANCED in v0.4.0)
  - Automatic source selection: NOAA (US, more detailed) or Open-Meteo (international)
  - Extended forecasts up to 16 days (was 7)
  - Sunrise/sunset times with daylight duration
  - Daily or hourly granularity
  - Precipitation probability display
  - Temperature trends, humidity, wind, and UV index
- **Current Conditions**: Get enhanced real-time weather observations for US locations
  - Heat index and wind chill when relevant
  - 24-hour temperature range
  - Wind gusts and detailed cloud cover
  - Recent precipitation history
  - Optional fire weather indices (see below)
- **Location Search**: Find coordinates for any location worldwide (v0.4.0)
  - Convert location names to coordinates ("Paris" → 48.8534°, 2.3488°)
  - Support for cities, airports, landmarks, and regions globally
  - Detailed metadata: timezone, elevation, population, country
  - Enables natural language queries: "What's the weather in Tokyo?"
- **Climate Normals - Historical Context**: Compare weather to 30-year averages (NEW in v1.2.0)
  - **Optional enhancement** for current conditions and forecasts (`include_normals=true`)
  - Shows normal high/low temperatures and precipitation for comparison
  - Displays departure from normal ("10°F warmer than normal")
  - **Hybrid data strategy**: Open-Meteo computed normals (global, free) or optional NOAA NCEI official normals (US only, requires free API token)
  - Based on 1991-2020 climate normals period
  - Helps understand if weather is unusual for the time of year
- **Snow and Ice Data**: Enhanced winter weather information (NEW in v1.2.0)
  - Snow depth on ground (current conditions, US only)
  - Snowfall accumulation forecasts with time periods
  - Ice accumulation forecasts for freezing rain events
  - Smart threshold-based display (filters trace amounts)
  - Unit conversions from metric to imperial
- **Timezone-Aware Display**: All timestamps in local time (NEW in v1.2.0)
  - Automatic timezone detection from coordinates
  - All times displayed in location's local timezone
  - Includes timezone abbreviations (EST, PDT, etc.)
  - Handles daylight saving time transitions
  - Formatted time ranges for forecast periods
- **Weather Alerts**: Get active weather watches, warnings, and advisories for US locations
  - Severity levels (Extreme, Severe, Moderate, Minor)
  - Urgency and certainty indicators
  - Effective and expiration times
  - Instructions and recommended responses
- **Historical Data**: Access historical weather observations for any location worldwide
  - Recent data (last 7 days): Detailed hourly observations from NOAA real-time API (US only)
  - Archival data (>7 days old): Hourly/daily weather data from 1940-present via Open-Meteo (global coverage)
- **Air Quality Monitoring**: Comprehensive air quality data for any location worldwide (v0.5.0)
  - Air Quality Index (AQI) with automatic region detection (US AQI or European EAQI)
  - Health recommendations based on AQI levels
  - Pollutant concentrations (PM2.5, PM10, O₃, NO₂, SO₂, CO, NH₃)
  - UV Index with sun protection recommendations
  - Optional hourly air quality forecasts (5-day outlook)
  - Categorized health risk levels (Good, Moderate, Unhealthy, etc.)
  - Activity recommendations for sensitive populations
- **Severe Weather Probabilities**: Probabilistic severe weather forecasting (NEW in v0.6.0)
  - US locations only (NOAA gridpoint data)
  - Optional enhancement to forecasts (`include_severe_weather` parameter)
  - Thunderstorm probability for next 48 hours
  - Wind gust probabilities (20-60+ mph categories)
  - Tropical storm and hurricane wind probabilities
  - Lightning activity levels
  - Smart display showing only significant threats
  - Works with both daily and hourly forecasts
- **Fire Weather Data**: Fire danger indices for US locations (v0.5.0)
  - Haines Index (atmospheric fire growth potential)
  - Grassland Fire Danger Index
  - Red Flag Threat Index
  - Mixing Height (smoke dispersion indicator)
  - Transport Wind Speed (smoke transport)
  - Optional enhancement to current conditions
- **Marine Conditions**: Comprehensive marine weather for coastal and ocean areas (NEW in v0.6.0)
  - Global coverage for waves, swell, and ocean currents
  - Significant wave height with safety categorization (Calm to Extreme)
  - Wind waves (locally generated) and swell (distant systems) separation
  - Wave period and direction for planning
  - Ocean current velocity and direction
  - Optional 5-day marine forecast with daily summaries
  - Safety assessment for maritime activities (sailing, boating, surfing)
  - Wave interpretation guide based on Douglas Sea Scale
  - Important: Data has limited coastal accuracy - NOT for navigation
- **Weather Imagery**: Visual weather radar and precipitation maps (NEW in v1.5.0)
  - Global precipitation radar from RainViewer API
  - Static radar images showing current precipitation
  - Animated radar loops (up to 2 hours of history)
  - Tile URLs for efficient rendering
  - Automatic coordinate-to-tile calculation
  - Visual confirmation of approaching weather
  - Free, no API key required
- **Lightning Activity**: Real-time lightning strike detection and safety monitoring (NEW in v1.5.0)
  - Real-time strike detection from Blitzortung.org network
  - Strikes within customizable radius (default: 100km)
  - 4-level safety assessment (Safe, Elevated, High, Extreme)
  - Distance to nearest strike with comprehensive statistics
  - Strike polarity and amplitude information
  - Safety recommendations based on proximity
  - Critical for outdoor activity safety planning
  - Free, no API key required
- **River Conditions**: Monitor river levels and flood status for safety and recreation (NEW in v1.6.0)
  - Current water levels from NOAA and USGS gauges
  - Flood stage thresholds (action, minor, moderate, major)
  - Streamflow data in cubic feet per second
  - Distance-based gauge filtering within customizable radius
  - Safety assessment for boating and recreation
  - Historical flood crest data when available
  - US coverage via NOAA NWPS and USGS Water Services
- **Wildfire Information**: Track active wildfires and fire perimeters (NEW in v1.6.0)
  - Active wildfire locations and prescribed burns
  - Fire size, containment status, and discovery date
  - Distance-based proximity filtering
  - 4-level safety assessment (Extreme Danger, High Alert, Caution, Awareness)
  - Evacuation recommendations based on proximity
  - Detailed fire attributes (type, location, status)
  - Data from NIFC WFIGS (National Interagency Fire Center)
- **Service Status Checking**: Proactively verify API availability with health checks
- **Enhanced Error Handling**: Detailed, actionable error messages with status page links
- **Intelligent Caching**: Built-in in-memory cache reduces API calls and improves performance

## Caching

The Weather MCP server includes an intelligent in-memory caching system that significantly improves performance for AI-driven weather queries.

### Benefits

- **Faster Responses**: Cached queries return in <10ms vs 200-1000ms for API calls
- **Reduced API Load**: 50-80% fewer API calls for typical AI conversation patterns
- **Rate Limit Protection**: Prevents hitting API rate limits during heavy usage
- **Automatic Management**: Smart TTL-based expiration with LRU eviction

### How It Works

The cache automatically stores and retrieves weather data with intelligent expiration:

- **Location Searches**: Cached for 30 days (locations don't move)
- **Climate Normals**: Cached indefinitely (30-year averages are static) - NEW in v1.2.0
- **Weather Imagery**: Cached for 15 minutes (radar updates frequently) - NEW in v1.5.0
- **Lightning Strikes**: Cached for 5 minutes (real-time safety data) - NEW in v1.5.0
- **River Conditions**: Cached for 1 hour (gauge data updates frequently) - NEW in v1.6.0
- **Wildfire Information**: Cached for 30 minutes (fire data changes rapidly) - NEW in v1.6.0
- **Marine Conditions**: Cached for 1 hour (marine data updates hourly) - NEW in v0.6.0
- **Air Quality Data**: Cached for 1 hour (air quality updates hourly) - v0.5.0
- **Fire Weather Data**: Cached for 2 hours (gridpoint data updates ~hourly) - v0.5.0
- **Weather Alerts**: Cached for 5 minutes (alerts can change rapidly)
- **Forecasts**: Cached for 2 hours (updated approximately hourly)
- **Current Conditions**: Cached for 15 minutes (observations update every 20-60 minutes)
- **Historical Data (>1 day old)**: Cached indefinitely (finalized data never changes)
- **Recent Historical (<1 day)**: Cached for 1 hour (may still be updated)
- **Grid Coordinates**: Cached indefinitely (geographic mappings are static)

### Configuration

#### Tool Selection (NEW in v1.4.0)

Control which MCP tools are exposed to reduce context overhead and customize functionality. By default, only **basic** tools are enabled.

**Available Presets:**
- `basic` (default): Essential weather tools (5 tools) - forecast, current_conditions, alerts, search_location, check_service_status
- `standard`: Basic + historical_weather (6 tools)
- `full`: Standard + air_quality (7 tools)
- `all`: All available tools (12 tools) - includes marine_conditions, weather_imagery, lightning_activity, river_conditions, wildfire_info

**Configuration Examples:**

```bash
# Use a preset
export ENABLED_TOOLS=full

# Select specific tools
export ENABLED_TOOLS=forecast,current,alerts,air_quality

# Add tools to a preset
export ENABLED_TOOLS=basic,+historical,+air_quality

# Remove tools from a preset
export ENABLED_TOOLS=all,-marine

# Complex combinations
export ENABLED_TOOLS=standard,+air_quality,-alerts
```

**Tool Aliases:**
Short names are supported: `forecast`, `current`, `conditions`, `alerts`, `warnings`, `historical`, `history`, `status`, `location`, `search`, `air_quality`, `aqi`, `marine`, `ocean`, `waves`, `imagery`, `radar`, `satellite`, `lightning`, `strikes`, `thunderstorm`

**Benefits:**
- **Reduced Context**: Load only needed tools to reduce initial MCP context
- **Better Security**: Only expose necessary functionality
- **Customization**: Tailor the server to your specific use case

#### Cache Configuration

Caching is **enabled by default** with sensible settings. To customize:

```bash
# Disable caching (not recommended)
export CACHE_ENABLED=false

# Adjust maximum cache size (default: 1000 entries)
export CACHE_MAX_SIZE=1500

# Optional: NOAA NCEI API token for official climate normals (US only, NEW in v1.2.0)
# Falls back to Open-Meteo computed normals if not configured
export NCEI_API_TOKEN=your_token_here
```

**Note on Climate Normals (v1.2.0):**
- By default, climate normals use Open-Meteo's computed 30-year averages (completely free, global coverage, zero setup)
- Optionally, you can configure a free NCEI API token to use official NOAA climate normals for US locations
- Get a free token at: https://www.ncdc.noaa.gov/cdo-web/token
- If NCEI token is configured but unavailable, the system automatically falls back to Open-Meteo

### Monitoring

Use the `check_service_status` tool to view cache statistics including:
- Hit rate percentage
- Cache size and utilization
- API call reduction metrics

For detailed information about caching architecture and configuration, see [.github/CACHING.md](./.github/CACHING.md).

## Installation

### Quick Install (Recommended)

**Via npm:**
```bash
npm install -g @dangahagan/weather-mcp
```

**Via npx (no installation, always uses latest):**
```bash
npx -y @dangahagan/weather-mcp@latest
```

Then configure in your MCP client using:
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

### From Source

If you prefer to build from source:

**Prerequisites:**
- Node.js 18 or higher
- npm or yarn
- **No API keys or tokens required**

**Setup:**

1. Clone the repository:
```bash
git clone https://github.com/dgahagan/weather-mcp.git
cd weather-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Upgrading to Latest Version

### Upgrading npm Installation

If you installed via npm globally:

```bash
# Check your current version
npm list -g @dangahagan/weather-mcp

# Update to latest version
npm update -g @dangahagan/weather-mcp

# Or reinstall to ensure latest version
npm install -g @dangahagan/weather-mcp@latest
```

**For npx users:** If you're using `@latest` (recommended), no upgrade needed! The `npx -y @dangahagan/weather-mcp@latest` command always fetches the newest version.

### Upgrading from Source

If you cloned the repository:

```bash
# Navigate to your installation directory
cd /path/to/weather-mcp

# Fetch latest changes
git fetch origin

# Check current version
git describe --tags

# Update to latest release
git checkout main
git pull origin main

# Reinstall dependencies and rebuild
npm install
npm run build
```

**After upgrading:**
- Restart your MCP client (Claude Desktop, Claude Code, etc.)
- Check the changelog at [CHANGELOG.md](./CHANGELOG.md) for breaking changes
- Verify the new version with the latest features

**Version Check:**
You can verify your installed version by checking:
- npm: `npm list -g @dangahagan/weather-mcp`
- Source: `git describe --tags` or check `package.json`
- Latest release: https://github.com/dgahagan/weather-mcp/releases

## Usage with AI Assistants

This MCP server works with any client that supports the Model Context Protocol, including:

- **Claude Desktop** - Official Claude desktop application
- **Claude Code** - Official Claude CLI tool
- **Cline** - VS Code extension for AI-assisted coding
- **Cursor** - AI-powered code editor
- **Zed** - High-performance code editor with AI features
- **VS Code (GitHub Copilot)** - With MCP support enabled
- **LM Studio** - Local AI model interface
- **Postman** - API platform with MCP integration

For detailed setup instructions for each client, see **[CLIENT_SETUP.md](./docs/CLIENT_SETUP.md)**.

### Quick Start: Claude Code

Edit `~/.config/claude-code/mcp_settings.json` (macOS/Linux) or `%APPDATA%\claude-code\mcp_settings.json` (Windows):

**Recommended (npx, always latest):**
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

**Alternative (from source):**
```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/absolute/path/to/weather-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Code and the weather tools will be available.

## Finding Coordinates

**NEW in v0.4.0**: Use the built-in `search_location` tool to find coordinates automatically!

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

## Available Tools

### 1. get_forecast (ENHANCED in v0.4.0, v1.2.0)
Get weather forecast for any location worldwide.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `days` (optional): Number of days in forecast (1-16, default: 7)
- `granularity` (optional): "daily" or "hourly" (default: "daily")
- `include_precipitation_probability` (optional): Include rain chances (default: true)
- `include_normals` (optional): Include climate normals for comparison (default: false, NEW in v1.2.0)
- `source` (optional): "auto" (default), "noaa" (US only), or "openmeteo" (global)

**Description:**
Automatically selects the best data source: NOAA for US locations (more detailed) or Open-Meteo for international locations. Supports extended forecasts up to 16 days. Includes sunrise/sunset times, daylight duration, temperature, precipitation, wind, and UV index.

**Examples:**
```
"Get a 7-day forecast for Paris (48.8534, 2.3488)"
"Hourly forecast for Tokyo for the next 3 days"
"16-day extended forecast for Sydney, Australia"
```

**Returns:**
- Temperature (high/low, feels like)
- Sunrise and sunset times with daylight duration (NEW in v0.4.0)
- Precipitation chances and amounts
- Wind speed, direction, and gusts
- Weather conditions and descriptions
- UV index (for international locations)
- Humidity and atmospheric conditions
- Climate normals comparison (when `include_normals=true`, NEW in v1.2.0)
- Snow and ice accumulation forecasts (when available, NEW in v1.2.0)
- All timestamps in local timezone (NEW in v1.2.0)

### 2. get_current_conditions (ENHANCED in v1.2.0)
Get current weather conditions for a location (US only).

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `include_fire_weather` (optional): Include fire weather indices (default: false)
- `include_normals` (optional): Include climate normals for comparison (default: false, NEW in v1.2.0)

**Example:**
```
What are the current weather conditions in New York? (latitude: 40.7128, longitude: -74.0060)
```

**Returns:**
- Current temperature, humidity, wind, pressure
- Heat index or wind chill (when applicable)
- 24-hour temperature range
- Recent precipitation
- Cloud cover and visibility
- Snow depth on ground (when available, NEW in v1.2.0)
- Climate normals comparison (when `include_normals=true`, NEW in v1.2.0)
- Fire weather indices (when `include_fire_weather=true`)
- All timestamps in local timezone (NEW in v1.2.0)

### 3. search_location (NEW in v0.4.0)
Find coordinates for any location worldwide by name.

**Parameters:**
- `query` (required): Location name to search for (e.g., "Paris", "New York, NY", "Tokyo")
- `limit` (optional): Maximum number of results to return (1-100, default: 5)

**Description:**
Converts location names to coordinates using the Open-Meteo Geocoding API. Returns multiple matches with detailed metadata including coordinates, timezone, elevation, population, and administrative regions. Enables natural language weather queries by finding coordinates automatically.

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

### 4. get_alerts
Get active weather alerts, watches, warnings, and advisories for US locations.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `active_only` (optional): Show only active alerts (default: true)

**Description:**
Retrieves current weather alerts from the NOAA API for safety-critical weather information. Returns severity levels (Extreme, Severe, Moderate, Minor), urgency indicators, effective/expiration times, and affected areas. Alerts are automatically sorted by severity with the most critical first.

**Examples:**
```
"Are there any weather alerts for Miami, Florida?"
"Check for severe weather warnings in Oklahoma City"
"What weather watches are active in my area?" (latitude: 40.7128, longitude: -74.0060)
```

**Returns:**
- Alert type and severity (Extreme → Severe → Moderate → Minor)
- Urgency, certainty, and response type
- Event description and instructions
- Effective and expiration times
- Affected geographic areas
- Recommended actions and safety information

### 5. get_historical_weather
Get historical weather observations for a location.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `start_date` (required): Start date in ISO format (YYYY-MM-DD)
- `end_date` (required): End date in ISO format (YYYY-MM-DD)
- `limit` (optional): Max observations to return (1-500, default: 168)

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

### 6. get_air_quality (NEW in v0.5.0)
Get comprehensive air quality data for any location worldwide.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `forecast` (optional): Include hourly forecast for next 5 days (default: false)

**Description:**
Provides current air quality conditions using the Open-Meteo Air Quality API with automatic AQI scale selection (US AQI for US locations, European EAQI elsewhere). Includes health recommendations, pollutant concentrations, and UV index.

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
- Activity recommendations for sensitive groups
- Optional 5-day hourly forecast

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

### 8. get_marine_conditions (NEW in v0.6.0, Enhanced in v1.1.0)
Get marine weather conditions including wave height, swell, ocean currents, and sea state with automatic source selection for Great Lakes and coastal bays.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `forecast` (optional): Include 5-day marine forecast (default: false)

**Description:**
Provides comprehensive marine weather data with intelligent dual-source support:
- **Great Lakes & Coastal Bays (NEW in v1.1.0)**: Automatically uses NOAA gridpoint data for all 5 Great Lakes (Superior, Michigan, Huron, Erie, Ontario) and major US coastal bays (Chesapeake Bay, San Francisco Bay, Tampa Bay, Puget Sound, Lake Okeechobee). Provides wave height, wave period, wave direction, and wind conditions.
- **Ocean Coverage**: Uses Open-Meteo Marine API for global ocean coverage, including significant wave height with Douglas Sea Scale categorization, wind waves vs swell separation, wave period/direction, ocean currents, and safety assessment for maritime activities.
- **Automatic Selection**: Intelligent geographic detection automatically selects the best data source with zero configuration required.

**Important:** Data has limited accuracy in coastal areas and is NOT suitable for coastal navigation - always consult official marine forecasts.

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
- Sea state interpretation (Calm → Phenomenal based on Douglas Sea Scale)
- Safety assessment for maritime activities
- Wave period for planning and safety
- Optional 5-day forecast with daily summaries

### 9. get_weather_imagery (NEW in v1.5.0)
Get weather radar and precipitation imagery for visual weather analysis.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `type` (required): Imagery type - "precipitation", "radar", or "satellite" (Note: satellite not yet implemented)
- `animated` (optional): Return animated loop vs static image (default: false)
- `layers` (optional): Additional map layers (reserved for future use)

**Description:**
Provides access to weather radar and precipitation imagery from RainViewer API with global coverage. Returns tile URLs for efficient rendering of current precipitation or animated radar loops showing up to 2 hours of history. Perfect for visual confirmation of approaching weather systems.

**Examples:**
```
"Show me the current radar for New York"
"Get animated precipitation radar for London for the last 2 hours"
"Is there any precipitation showing on radar near me?"
```

**Returns:**
- Precipitation radar imagery (static or animated)
- Tile URLs for efficient rendering
- Frame timestamps for animated sequences
- Coverage area and resolution information
- Automatic coordinate-to-tile calculation
- Up to 2 hours of historical radar frames when animated

**Note:** Satellite imagery is planned for a future release. Precipitation radar provides global coverage via the free RainViewer API.

### 10. get_lightning_activity (NEW in v1.5.0)
Get real-time lightning strike detection and safety assessment for outdoor activity planning.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `radius` (optional): Search radius in kilometers (1-500, default: 100)
- `timeWindow` (optional): Historical time window in minutes (1-180, default: 60)

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
- 4-level safety assessment:
  - **Safe** (>50km): No immediate lightning threat
  - **Elevated** (16-50km): Monitor conditions, plan indoor access
  - **High** (8-16km): Seek shelter immediately
  - **Extreme** (<8km): Active thunderstorm, dangerous conditions
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

### 11. get_river_conditions (NEW in v1.6.0)
Monitor river levels and flood status using NOAA and USGS data sources.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `radius` (optional): Search radius in kilometers (1-500, default: 50)

**Description:**
Provides comprehensive river and streamflow monitoring for flood safety and recreation planning. Automatically finds the nearest river gauges within the specified radius and reports current water levels, flood stages, and flow rates. Uses NOAA National Water Prediction Service (NWPS) for gauge locations and USGS Water Services for real-time streamflow data.

**Examples:**
```
"What are the river conditions near St. Louis?" (latitude: 38.6270, longitude: -90.1994)
"Check for flooding on the Mississippi River"
"Is the river level safe for kayaking?"
"Show me nearby river gauge readings"
```

**Returns:**
- Nearest river gauges with current water levels
- Flood stage thresholds (action, minor, moderate, major)
- Current flood status and forecast
- Streamflow data (cubic feet per second)
- Distance to each gauge from query location
- River and location names
- Safety assessment for recreation
- Historical context (flood crests if available)

**Note:** US coverage only. Data provided by NOAA National Water Prediction Service and USGS Water Services.

### 12. get_wildfire_info (NEW in v1.6.0)
Monitor active wildfires and fire perimeters for safety and evacuation planning.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `radius` (optional): Search radius in kilometers (1-500, default: 100)

**Description:**
Provides critical wildfire monitoring and safety information using NIFC (National Interagency Fire Center) data. Reports active wildfires and prescribed burns within the specified radius, including fire size, containment status, and proximity-based safety assessments. Essential for residents in fire-prone regions and outdoor activity planning.

**Examples:**
```
"Are there any wildfires near Los Angeles?" (latitude: 34.0522, longitude: -118.2437)
"Check for active fires in Colorado"
"How close is the nearest wildfire?"
"Show me fire perimeters and containment status"
```

**Returns:**
- Active wildfire locations within search radius
- Fire size in acres and hectares
- Containment percentage with visual indicator
- Distance from query location to each fire
- Discovery date and days active
- Fire type (Wildfire vs Prescribed Fire)
- Location details (state, county, city)
- 4-level safety assessment:
  - **EXTREME DANGER** (<5km): Evacuate if advised
  - **HIGH ALERT** (5-25km): Prepare for evacuation
  - **CAUTION** (25-50km): Monitor conditions
  - **AWARENESS** (>50km): Stay informed
- Evacuation recommendations and safety guidance

**Note:** Data from NIFC WFIGS (Wildland Fire Interagency Geospatial Services). Always consult official sources for evacuation orders at https://inciweb.nwcg.gov/

## Error Handling & Service Status

### Enhanced Error Messages

This MCP server provides detailed, actionable error messages when issues occur. All error messages include:

- **Clear problem description** - What went wrong and why
- **Contextual help** - Specific guidance based on the error type
- **Status page links** - Direct links to official service status pages
- **Recommended actions** - Concrete steps to resolve or investigate the issue

**Example Error Messages:**

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

```
# Query example
"Check if the weather services are working"

# Returns:
- ✅/❌ Status for NOAA API (US forecasts & current conditions)
- ✅/❌ Status for Open-Meteo API (global historical data)
- Links to official status pages
- Recommended actions if issues detected
- Overall service availability summary
```

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

## Testing

### Automated Test Suite

This project includes a comprehensive test suite with 1,042 automated tests:

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode (during development)
npm run test:watch

# Run tests with interactive UI
npm run test:ui
```

**Test Coverage:**
- **1,042 tests** across unit and integration test suites (111 new tests in v1.6.0)
- **100% coverage** on critical utilities (cache, validation, units, errors, normals, snow, timezone, distance, geohash, security)
- **100% pass rate** with comprehensive security and boundary validation
- All tests execute in ~2 seconds

**Test Categories:**
- **Unit Tests** (965 tests) - Cache, validation, units, errors, config, retry logic, normals, snow, timezone, distance, security, geohash
- **Integration Tests** (77 tests) - Error recovery, service status checks, safety & hazards features

### Quick API Connectivity Test

Verify NOAA API connectivity with a quick integration test:
```bash
npx tsx tests/test_noaa_api.ts
```

### Manual Testing with Claude Code

See [TESTING_GUIDE.md](./docs/TESTING_GUIDE.md) for comprehensive manual testing instructions including:
- Setup steps for MCP clients
- Test cases for all tools
- Error handling verification
- Performance testing
- Debugging tips

## Development

### Available Scripts

**Build & Run:**
- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run the server in development mode with tsx
- `npm start` - Run the compiled server

**Testing:**
- `npm test` - Run all automated tests
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:watch` - Run tests in watch mode
- `npm run test:ui` - Run tests with interactive UI
- `npx tsx tests/test_noaa_api.ts` - Quick API connectivity test

**Security & Maintenance:**
- `npm run audit` - Check for dependency vulnerabilities
- `npm run audit:fix` - Automatically fix dependency vulnerabilities

### Project Structure

```
weather-mcp/
├── src/
│   ├── index.ts                 # Main MCP server
│   ├── config/
│   │   ├── api.ts               # API configuration (NCEI token) - NEW in v1.2.0
│   │   ├── cache.ts             # Cache configuration and TTL strategies
│   │   └── displayThresholds.ts # Display thresholds for weather conditions
│   ├── errors/
│   │   └── ApiError.ts          # Custom error class hierarchy
│   ├── handlers/
│   │   ├── alertsHandler.ts     # Weather alerts tool handler
│   │   ├── currentConditionsHandler.ts  # Current conditions handler
│   │   ├── forecastHandler.ts   # Forecast tool handler
│   │   ├── historicalWeatherHandler.ts  # Historical weather handler
│   │   ├── airQualityHandler.ts # Air quality handler
│   │   ├── marineConditionsHandler.ts   # Marine conditions handler
│   │   ├── locationHandler.ts   # Location search handler
│   │   └── statusHandler.ts     # Service status handler
│   ├── services/
│   │   ├── noaa.ts              # NOAA API service
│   │   ├── openmeteo.ts         # Open-Meteo API service
│   │   └── ncei.ts              # NCEI climate normals service - NEW in v1.2.0
│   ├── types/
│   │   ├── noaa.ts              # NOAA TypeScript type definitions
│   │   └── openmeteo.ts         # Open-Meteo TypeScript type definitions
│   └── utils/
│       ├── cache.ts             # LRU cache implementation
│       ├── logger.ts            # Structured logging utilities
│       ├── temperatureConversion.ts  # Temperature conversion helpers
│       ├── units.ts             # Unit conversion utilities
│       ├── validation.ts        # Input validation functions
│       ├── normals.ts           # Climate normals utilities - NEW in v1.2.0
│       ├── snow.ts              # Snow and ice data utilities - NEW in v1.2.0
│       └── timezone.ts          # Timezone-aware formatting - NEW in v1.2.0
├── tests/
│   ├── unit/                    # Unit tests (427 tests) - 93 new tests in v1.2.0
│   └── integration/             # Integration tests (19 tests)
├── dist/                        # Compiled JavaScript (generated)
├── docs/                        # Documentation
└── package.json
```

## API Information

This server uses three weather APIs:

### NOAA Weather API (Real-time, US)
- **Base URL**: https://api.weather.gov
- **Authentication**: None required (User-Agent header only)
- **Rate Limits**: Enforced with 5-second retry window
- **Coverage**: United States locations only
- **Use cases**: US forecasts (detailed), current conditions, recent observations (last 7 days)
- **Data**: Detailed hourly observations from weather stations

### Open-Meteo Forecast API (Global) - NEW in v0.4.0
- **Base URL**: https://api.open-meteo.com/v1
- **Authentication**: None required (no API token needed)
- **Rate Limits**: 10,000 requests/day for non-commercial use
- **Coverage**: Global (worldwide locations)
- **Use cases**: International forecasts, extended forecasts (up to 16 days)
- **Data**: Temperature, precipitation, wind, humidity, UV index, sunrise/sunset
- **Resolution**: 11km global grid resolution

### Open-Meteo Geocoding API (Global) - NEW in v0.4.0
- **Base URL**: https://geocoding-api.open-meteo.com/v1
- **Authentication**: None required (no API token needed)
- **Coverage**: Global (worldwide locations)
- **Use cases**: Location name to coordinates conversion
- **Data**: Coordinates, timezone, elevation, population, administrative regions
- **Cache**: 30-day TTL (locations don't move)

### Open-Meteo Historical Weather API (Global, Archival)
- **Base URL**: https://archive-api.open-meteo.com/v1
- **Authentication**: None required (no API token needed)
- **Rate Limits**: 10,000 requests/day for non-commercial use
- **Coverage**: Global (worldwide locations)
- **Use cases**: Historical weather data from 1940 to present
- **Data**: Hourly or daily temperature, precipitation, wind, humidity, pressure, cloud cover
- **Resolution**: 9-25km grid resolution from reanalysis models
- **Delay**: 5-day delay for most recent data

For more details on NOAA APIs, see [NOAA_API_RESEARCH.md](./docs/NOAA_API_RESEARCH.md).

## Limitations

### Geographic Coverage

**Forecasts:** (UPDATED in v0.4.0)
- **Global coverage** via automatic source selection
- US locations: Uses NOAA API (more detailed, includes narratives)
- International locations: Uses Open-Meteo API (reliable global forecasts)
- Extended forecasts (>7 days, up to 16 days): Open-Meteo only

**Current Conditions:**
- **US locations only** (NOAA API)
- International real-time conditions not yet supported

**Historical Data:**
- Recent data (last 7 days): **US locations only** (NOAA API)
- Archival data (>7 days old): **Global coverage** (Open-Meteo API)

### Historical Data (get_historical_weather)

**Recent Data (Last 7 Days)** - US Only, High Detail:
- ✓ Detailed hourly observations from weather stations
- ✓ No API token required
- ⚠️ US locations only
- ⚠️ May have occasional gaps depending on weather station
- ⚠️ Observations may be delayed up to 20 minutes

**Archival Data (Older than 7 Days)** - Global, Reanalysis-Based:
- ✓ Global coverage (any location worldwide)
- ✓ No API token required
- ✓ Reliable data from 1940 to present
- ✓ Hourly data for date ranges up to 31 days
- ✓ Daily summaries for longer periods
- ⚠️ Most recent data has a 5-day delay
- ⚠️ Reanalysis-based (grid model, not direct station observations)

### Rate Limits
- **NOAA Weather API**: Automatic retry with exponential backoff on rate limit errors
- **Open-Meteo API**: 10,000 requests/day for non-commercial use

### Recommendations
- **For recent US weather**: Use dates within the last 7 days for detailed station observations
- **For historical analysis**: Open-Meteo provides reliable global coverage back to 1940
- **For international locations**: Only historical data (>7 days old) is supported

## Security

This project takes security seriously and implements multiple layers of protection:

### Security Features

**Input Validation:**
- Comprehensive runtime validation for all user inputs
- NaN and Infinity checks for numeric coordinates
- Range validation for latitude (-90 to 90) and longitude (-180 to 180)
- Type checking with TypeScript strict mode

**Error Handling:**
- Custom error class hierarchy with typed errors
- Error message sanitization to prevent information leakage
- Retryable errors clearly identified for graceful recovery
- Network errors sanitized before display

**Dependency Security:**
- Automated dependency scanning via `npm audit`
- GitHub Dependabot configured for weekly security updates
- Minimal dependency footprint (3 runtime dependencies)
- Zero known vulnerabilities in current dependencies

**Reliability:**
- Exponential backoff with jitter prevents thundering herd problems
- Comprehensive test suite (247 tests) with 100% coverage on critical utilities
- Memory-safe cache with automatic cleanup
- Graceful shutdown handling

### Security Audit

The project has undergone a comprehensive security audit:
- **Overall Security Posture:** B+ (Good)
- **Risk Level:** LOW
- **Vulnerabilities:** Zero critical or high-severity issues
- See [SECURITY_AUDIT.md](./docs/development/SECURITY_AUDIT.md) for full audit report

### Reporting Security Issues

To report a security vulnerability, please see our [Security Policy](./SECURITY.md) which includes:
- Vulnerability reporting procedures
- Response timeline commitments (48hr acknowledgment, 7-day assessment)
- Security best practices for users and developers

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

For information about code quality, security considerations, and development best practices, see:
- [CODE_REVIEW.md](./docs/development/CODE_REVIEW.md) - Comprehensive code quality analysis
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [SECURITY.md](./SECURITY.md) - Security policy and vulnerability reporting
