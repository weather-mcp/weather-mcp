# Weather MCP Server

An MCP (Model Context Protocol) server that provides weather data from NOAA's API to AI systems like Claude Code.

## Features

- **Get Forecast**: Retrieve weather forecasts for any US location (7-day forecast)
- **Current Conditions**: Get real-time weather observations
- **Historical Data**: Access historical weather observations for custom date ranges

## Installation

### Prerequisites
- Node.js 18 or higher
- npm or yarn

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
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

## Usage with Claude Code

Add the server to your Claude Code MCP settings:

### macOS/Linux
Edit `~/.config/claude-code/mcp_settings.json`:

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

### Windows
Edit `%APPDATA%\claude-code\mcp_settings.json`:

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\weather-mcp\\dist\\index.js"]
    }
  }
}
```

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

### 1. get_forecast
Get weather forecast for a location.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `days` (optional): Number of days in forecast (1-7, default: 7)

**Example:**
```
Get the weather forecast for San Francisco (latitude: 37.7749, longitude: -122.4194)
```

### 2. get_current_conditions
Get current weather conditions for a location.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)

**Example:**
```
What are the current weather conditions in New York? (latitude: 40.7128, longitude: -74.0060)
```

### 3. get_historical_weather
Get historical weather observations for a location.

**Parameters:**
- `latitude` (required): Latitude coordinate (-90 to 90)
- `longitude` (required): Longitude coordinate (-180 to 180)
- `start_date` (required): Start date in ISO format (YYYY-MM-DD)
- `end_date` (required): End date in ISO format (YYYY-MM-DD)
- `limit` (optional): Max observations to return (1-500, default: 168)

**Example:**
```
Get historical weather data for Chicago from January 1-7, 2024 (latitude: 41.8781, longitude: -87.6298)
```

## Testing

### Quick Test

Verify NOAA API connectivity:
```bash
npx tsx test_noaa_api.ts
```

This runs 5 tests covering all major functionality with real NOAA API calls.

### Manual Testing with Claude Code

See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for comprehensive testing instructions including:
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
- `npx tsx test_noaa_api.ts` - Run API connectivity tests

### Project Structure

```
weather-mcp/
├── src/
│   ├── index.ts           # Main MCP server
│   ├── services/
│   │   └── noaa.ts        # NOAA API service
│   ├── types/
│   │   └── noaa.ts        # TypeScript type definitions
│   └── utils/
│       └── units.ts       # Unit conversion utilities
├── dist/                  # Compiled JavaScript (generated)
├── tests/                 # Test files
└── package.json
```

## API Information

This server uses the NOAA Weather API:
- **Base URL**: https://api.weather.gov
- **Authentication**: None required (User-Agent header only)
- **Rate Limits**: Enforced with 5-second retry window
- **Coverage**: United States locations

For more details, see [NOAA_API_RESEARCH.md](./NOAA_API_RESEARCH.md).

## Limitations

- NOAA API only covers United States locations
- Historical data availability depends on weather station records
- Observations may be delayed up to 20 minutes
- Rate limits apply (typically retry after 5 seconds)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
