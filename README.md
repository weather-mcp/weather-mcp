# Weather MCP Server

An MCP (Model Context Protocol) server that provides weather data from NOAA's API to AI systems like Claude Code.

## Features

- **Get Forecast**: Retrieve weather forecasts for any US location (7-day forecast)
- **Current Conditions**: Get real-time weather observations
- **Historical Data**: Access historical weather observations for custom date ranges
  - Recent data (last 7 days): Detailed hourly observations from real-time API
  - Archival data (>7 days old): Daily summaries from NOAA Climate Data Online

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

4. (Optional) Configure CDO API token for archival data:

To access historical weather data older than 7 days, you need a free NOAA Climate Data Online API token:

- Request a token at: https://www.ncdc.noaa.gov/cdo-web/token
- You'll receive the token via email (usually within minutes)

**For local development and testing:**
```bash
# Copy the example file
cp .env.example .env

# Edit .env and add your token
# NOAA_CDO_TOKEN=your_actual_token_here
```

**For use with Claude Code:**
- Add the token as an environment variable in your MCP settings (see configuration examples below)

**Note**: Without a CDO token, the server will still work for forecasts, current conditions, and recent historical data (last 7 days).

## Usage with Claude Code

Add the server to your Claude Code MCP settings:

### macOS/Linux
Edit `~/.config/claude-code/mcp_settings.json`:

**Without CDO token** (forecasts, current conditions, and last 7 days of historical data):
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

**With CDO token** (includes archival data older than 7 days):
```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/absolute/path/to/weather-mcp/dist/index.js"],
      "env": {
        "NOAA_CDO_TOKEN": "your_token_here"
      }
    }
  }
}
```

### Windows
Edit `%APPDATA%\claude-code\mcp_settings.json`:

**Without CDO token**:
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

**With CDO token**:
```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\weather-mcp\\dist\\index.js"],
      "env": {
        "NOAA_CDO_TOKEN": "your_token_here"
      }
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

**Data Source Selection:**
The server automatically chooses the best data source based on your date range:

- **Last 7 days** (Recommended): Uses NOAA real-time API
  - ✓ No token required
  - ✓ Detailed hourly observations
  - ✓ Includes: temperature, conditions, wind speed, humidity, pressure
  - ✓ High reliability and availability

- **Older than 7 days**: Uses Climate Data Online (CDO) API
  - ⚠️ Requires free CDO API token
  - ⚠️ Returns daily summaries (high/low temps, precipitation, snowfall)
  - ⚠️ Data availability varies by location and date
  - ⚠️ Best for major cities and recent years (2010+)
  - ⚠️ Some locations may have limited historical data

**CDO API Limitations:**
- Only covers United States locations
- Data availability varies significantly by location
- Remote areas may have limited or no historical data
- Older dates (before 2000) may have gaps
- Uses FIPS-based station lookup for better reliability

**Examples:**

Recent data (recommended, works reliably):
```
"What was the weather like in Chicago 3 days ago?"
Coordinates: latitude: 41.8781, longitude: -87.6298
Date range: 3 days ago to 2 days ago
```

Archival data (requires token, availability varies):
```
"What was the weather in New York on January 15, 2024?"
Coordinates: latitude: 40.7128, longitude: -74.0060
Date range: 2024-01-15 to 2024-01-15
```

**Troubleshooting:**
If you get "No historical data available":
- For dates within last 7 days: Use more recent dates
- For older dates: Try coordinates of a major city
- Check that your CDO API token is configured (for dates >7 days old)
- Try a shorter date range
- Some locations simply may not have archived data available

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
│   │   ├── noaa.ts        # NOAA real-time API service
│   │   └── cdo.ts         # Climate Data Online API service
│   ├── types/
│   │   ├── noaa.ts        # NOAA TypeScript type definitions
│   │   └── cdo.ts         # CDO TypeScript type definitions
│   └── utils/
│       └── units.ts       # Unit conversion utilities
├── dist/                  # Compiled JavaScript (generated)
├── tests/                 # Test files
└── package.json
```

## API Information

This server uses two NOAA APIs:

### NOAA Weather API (Real-time)
- **Base URL**: https://api.weather.gov
- **Authentication**: None required (User-Agent header only)
- **Rate Limits**: Enforced with 5-second retry window
- **Coverage**: United States locations
- **Use cases**: Forecasts, current conditions, recent observations (last 7 days)

### Climate Data Online (CDO) API v2 (Archival)
- **Base URL**: https://www.ncei.noaa.gov/cdo-web/api/v2
- **Authentication**: Free API token required (get at https://www.ncdc.noaa.gov/cdo-web/token)
- **Rate Limits**: 5 requests/second, 10,000 requests/day
- **Coverage**: United States locations
- **Use cases**: Historical daily summaries (older than 7 days)
- **Data**: High/low temperatures, precipitation, snowfall

For more details, see [NOAA_API_RESEARCH.md](./NOAA_API_RESEARCH.md).

## Limitations

### Geographic Coverage
- All NOAA APIs only cover **United States locations**
- International locations are not supported

### Historical Data (get_historical_weather)

**Recent Data (Last 7 Days)** - Most Reliable:
- ✓ Works without CDO API token
- ✓ Detailed hourly observations
- ⚠️ May have occasional gaps depending on weather station
- ⚠️ Observations may be delayed up to 20 minutes

**Archival Data (Older than 7 Days)** - Limited Availability:
- ⚠️ **Requires free CDO API token** (get at https://www.ncdc.noaa.gov/cdo-web/token)
- ⚠️ Returns daily summaries only (high/low temps, precipitation, snowfall)
- ⚠️ **Data availability varies significantly by location and date**:
  - Major cities: Generally good coverage for recent years (2010+)
  - Rural/remote areas: May have limited or no data
  - Older dates (pre-2000): May have significant gaps
- ⚠️ Station lookup uses FIPS-based search, which works best for populated areas
- ⚠️ Some date ranges may return no data even with a valid token

### Rate Limits
- **NOAA Weather API**: Automatic retry with exponential backoff on rate limit errors
- **CDO API**: 5 requests/second, 10,000 requests/day (enforced by NOAA)

### Recommendations
- **For historical data**: Use dates within the last 7 days when possible for best results
- **For archival data**: Use coordinates of major cities rather than exact/remote locations
- **For troubleshooting**: See the troubleshooting section under `get_historical_weather`

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
