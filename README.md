# Weather MCP Server

[![npm version](https://badge.fury.io/js/@dangahagan%2Fweather-mcp.svg)](https://www.npmjs.com/package/@dangahagan/weather-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that provides weather data to AI systems like Claude Code. Uses NOAA's API for US weather forecasts and current conditions, plus Open-Meteo for global historical weather data.

**📦 Available in the [Official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp)** as `io.github.dgahagan/weather-mcp`

**No API keys required!** Both NOAA and Open-Meteo APIs are free to use with no authentication needed.

## Features

- **Get Forecast**: Retrieve weather forecasts for any US location (7-day forecast)
- **Current Conditions**: Get real-time weather observations for US locations
- **Historical Data**: Access historical weather observations for any location worldwide
  - Recent data (last 7 days): Detailed hourly observations from NOAA real-time API (US only)
  - Archival data (>7 days old): Hourly/daily weather data from 1940-present via Open-Meteo (global coverage)
- **Service Status Checking**: Proactively verify API availability with health checks
- **Enhanced Error Handling**: Detailed, actionable error messages with status page links

## Installation

### Quick Install (Recommended)

**Via npm:**
```bash
npm install -g @dangahagan/weather-mcp
```

**Via npx (no installation):**
```bash
npx -y @dangahagan/weather-mcp
```

Then configure in your MCP client using:
```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@dangahagan/weather-mcp"]
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

All tools require latitude and longitude coordinates. You can find coordinates for any location by:
- Asking Claude Code: "What are the coordinates for [city name]?"
- Using Google Maps: Right-click a location and select the coordinates
- Using a geocoding service like geocode.maps.co or nominatim.org

### Common US City Coordinates

| City | Latitude | Longitude |
|------|----------|-----------|
| San Francisco, CA | 37.7749 | -122.4194 |
| New York, NY | 40.7128 | -74.0060 |
| Chicago, IL | 41.8781 | -87.6298 |
| Los Angeles, CA | 34.0522 | -118.2437 |
| Denver, CO | 39.7392 | -104.9903 |
| Miami, FL | 25.7617 | -80.1918 |
| Seattle, WA | 47.6062 | -122.3321 |
| Austin, TX | 30.2672 | -97.7431 |

## Available Tools

### 1. check_service_status
Check the operational status of weather APIs.

**Parameters:** None

**Description:**
Performs health checks on both NOAA and Open-Meteo APIs to verify they are operational. Use this tool when experiencing errors or to proactively verify service availability before making weather data requests. Returns current status, helpful messages, and links to official status pages.

**Example:**
```
Check if the weather services are operational
```

**Returns:**
- Operational status for NOAA API (forecasts & current conditions)
- Operational status for Open-Meteo API (historical data)
- Status page links and recommended actions if issues are detected
- Overall service availability summary

### 2. get_forecast
Get weather forecast for a location.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `days` (optional): Number of days in forecast (1-7, default: 7)

**Example:**
```
Get the weather forecast for San Francisco (latitude: 37.7749, longitude: -122.4194)
```

### 3. get_current_conditions
Get current weather conditions for a location.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)

**Example:**
```
What are the current weather conditions in New York? (latitude: 40.7128, longitude: -74.0060)
```

### 4. get_historical_weather
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

### Quick Test

Verify NOAA API connectivity:
```bash
npx tsx tests/test_noaa_api.ts
```

This runs 5 tests covering all major functionality with real NOAA API calls.

### Manual Testing with Claude Code

See [TESTING_GUIDE.md](./docs/TESTING_GUIDE.md) for comprehensive testing instructions including:
- Setup steps
- Test cases for all tools
- Error handling verification
- Performance testing
- Debugging tips

## Development

### Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run the server in development mode with tsx
- `npm start` - Run the compiled server
- `npx tsx tests/test_noaa_api.ts` - Run API connectivity tests

### Project Structure

```
weather-mcp/
├── src/
│   ├── index.ts           # Main MCP server
│   ├── services/
│   │   ├── noaa.ts        # NOAA real-time API service
│   │   └── openmeteo.ts   # Open-Meteo historical weather API service
│   ├── types/
│   │   ├── noaa.ts        # NOAA TypeScript type definitions
│   │   └── openmeteo.ts   # Open-Meteo TypeScript type definitions
│   └── utils/
│       └── units.ts       # Unit conversion utilities
├── dist/                  # Compiled JavaScript (generated)
├── tests/                 # Test files
└── package.json
```

## API Information

This server uses two weather APIs:

### NOAA Weather API (Real-time)
- **Base URL**: https://api.weather.gov
- **Authentication**: None required (User-Agent header only)
- **Rate Limits**: Enforced with 5-second retry window
- **Coverage**: United States locations only
- **Use cases**: Forecasts, current conditions, recent observations (last 7 days)
- **Data**: Detailed hourly observations from weather stations

### Open-Meteo Historical Weather API (Archival)
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

**Forecasts and Current Conditions:**
- NOAA APIs only cover **United States locations**
- International locations are not supported for forecasts and current conditions

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

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
