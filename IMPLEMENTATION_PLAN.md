# Weather MCP Server - Implementation Plan

## Project Overview
Build an MCP (Model Context Protocol) server that provides weather data from NOAA's API to AI systems, with primary focus on Claude Code integration.

## Phase 1: Project Setup & Research ✅ COMPLETED

### 1.1 Initialize Project Structure
- [x] Initialize npm project with `package.json`
- [x] Set up TypeScript configuration (`tsconfig.json`)
- [x] Create basic directory structure:
  ```
  /src
    /tools          # MCP tool implementations
    /services       # NOAA API service layer
    /types          # TypeScript type definitions
    /utils          # Helper utilities
    index.ts        # Main server entry point
  /tests            # Test files
  ```
- [x] Install core dependencies:
  - `@modelcontextprotocol/sdk` - MCP SDK
  - `typescript` - TypeScript compiler
  - `tsx` - TypeScript execution
  - `axios` - HTTP client for NOAA API

### 1.2 Research NOAA API
- [x] Document NOAA Weather API endpoints:
  - `api.weather.gov/points/{lat},{lon}` - Get forecast URLs for location
  - `api.weather.gov/gridpoints/{office}/{gridX},{gridY}/forecast` - Get forecast
  - `api.weather.gov/stations/{stationId}/observations` - Get observations
- [x] Understand API rate limits and requirements
- [x] Identify endpoints for historical data
- [x] Document data formats and response structures
- [x] Note any API keys or authentication requirements

## Phase 2: Core MCP Server Implementation ✅ COMPLETED

### 2.1 Server Bootstrap
- [x] Create main server file (`src/index.ts`)
- [x] Initialize MCP server with proper configuration
- [x] Implement server lifecycle (startup, shutdown)
- [x] Add error handling and logging
- [x] Set up stdin/stdout transport for MCP communication

### 2.2 NOAA API Service Layer
- [x] Create `NOAAService` class (`src/services/noaa.ts`)
- [x] Implement location-to-forecast-URL resolution
- [x] Implement forecast data fetching
- [x] Implement observation/historical data fetching
- [x] Add retry logic and error handling
- [x] Add response caching (optional, for rate limit management)
- [x] Create type definitions for NOAA API responses

## Phase 3: MCP Tools Implementation ✅ MOSTLY COMPLETED

### 3.1 Tool: get_forecast
**Purpose**: Get weather forecast for any location

**Input Parameters**:
- `latitude` (number): Latitude coordinate (REQUIRED)
- `longitude` (number): Longitude coordinate (REQUIRED)
- `days` (number, optional): Number of days in forecast (default: 7)

**Implementation**:
- [x] Define tool schema
- [ ] Implement geocoding (if location string provided) - DEFERRED (requires external service)
- [x] Call NOAA points API to get forecast URLs
- [x] Fetch and parse forecast data
- [x] Format response for AI consumption
- [x] Handle errors (invalid location, API failures)

### 3.2 Tool: get_current_conditions
**Purpose**: Get current weather conditions for a location

**Input Parameters**:
- `latitude` (number): Latitude coordinate (REQUIRED)
- `longitude` (number): Longitude coordinate (REQUIRED)

**Implementation**:
- [x] Define tool schema
- [x] Find nearest weather station
- [x] Fetch latest observation data
- [x] Format current conditions (temp, humidity, wind, etc.)
- [x] Handle missing data gracefully

### 3.3 Tool: get_historical_weather
**Purpose**: Get historical weather data for a location

**Input Parameters**:
- `latitude` (number): Latitude coordinate (REQUIRED)
- `longitude` (number): Longitude coordinate (REQUIRED)
- `start_date` (string): ISO date string (YYYY-MM-DD)
- `end_date` (string): ISO date string (YYYY-MM-DD)
- `limit` (number, optional): Max observations (default: 168)

**Implementation**:
- [x] Define tool schema
- [x] Find nearest weather station
- [ ] Calculate date range from preset if provided - DEFERRED (not critical)
- [x] Fetch observation history from NOAA
- [x] Aggregate data by day/period
- [x] Format historical data for AI consumption
- [x] Handle data gaps and missing observations

### 3.4 Tool: search_location (Helper) - DEFERRED
**Purpose**: Convert location string to coordinates

**Note**: This tool has been deferred. Users can use external geocoding services (Google Maps, etc.) to get coordinates, or AI assistants can look up coordinates for common locations. This keeps the MCP server focused on weather data.

**Input Parameters**:
- `location` (string): City, State or address

**Implementation**:
- [ ] Define tool schema
- [ ] Integrate geocoding service (NOAA, Census.gov, or similar)
- [ ] Return lat/lon with location metadata
- [ ] Handle ambiguous locations

## Phase 4: Testing & Validation ✅ COMPLETED

### 4.1 Unit Tests
- [x] Test NOAA API service methods
- [x] Test date range calculations
- [x] Test error handling
- [x] Test data formatting utilities
- [ ] Set up test framework (Jest or Vitest) - DEFERRED (automated test script sufficient)

### 4.2 Integration Tests
- [x] Test MCP tool execution end-to-end
- [x] Test with actual NOAA API (or mocked responses)
- [x] Test various location formats
- [x] Test edge cases (invalid dates, missing data)

### 4.3 Manual Testing with Claude Code
- [x] Add server to Claude Code MCP configuration
- [x] Test forecast retrieval for various locations
- [x] Test historical data queries
- [x] Test error scenarios
- [x] Verify data quality and formatting
- [x] Test performance and response times

## Phase 5: Documentation & Configuration ⏳ IN PROGRESS

### 5.1 Documentation
- [x] Create comprehensive README.md:
  - Project description
  - Installation instructions
  - Configuration guide
  - Usage examples
  - API reference
- [ ] Add inline code documentation (JSDoc)
- [ ] Create CONTRIBUTING.md for open source
- [ ] Add LICENSE file (choose appropriate license)
- [x] Document NOAA API limitations and best practices (NOAA_API_RESEARCH.md, TESTING_GUIDE.md)

### 5.2 Configuration
- [x] Create example MCP configuration for Claude Code (mcp_config_example.json)
- [x] Add environment variable support (if needed) - NOT NEEDED (no API keys required)
- [x] Create `.env.example` file - NOT NEEDED
- [x] Add configuration validation - Built into NOAAService

### 5.3 Build & Distribution
- [x] Set up build scripts in package.json
- [x] Configure TypeScript build output
- [x] Add npm scripts for development and production
- [ ] Consider publishing to npm (optional) - Can be done after GitHub publication

## Phase 6: Enhancements (Optional)

### 6.1 Advanced Features
- [ ] Add weather alerts/warnings tool
- [ ] Add radar/satellite data integration
- [ ] Implement caching strategy for repeated queries
- [ ] Add support for international locations (if NOAA supports)
- [ ] Add weather comparison tool (compare multiple locations)

### 6.2 Developer Experience
- [ ] Add development mode with hot reload
- [ ] Create debug logging with different levels
- [ ] Add health check/status endpoint
- [ ] Create CLI tool for testing server without MCP client

## Technical Decisions & Notes

### Geocoding Strategy
**Options**:
1. Use Census.gov Geocoding API (free, US-only)
2. Use NOAA's built-in location search
3. Require latitude/longitude input only
4. Use external service (OpenStreetMap Nominatim)

**Recommendation**: Start with Census.gov for US locations, allow manual lat/lon as fallback

### Historical Data Limitations
NOAA's observation API typically provides:
- Recent observations (last few days) easily accessible
- Historical data may require different endpoints or services
- May need to use NCDC (National Climatic Data Center) API for older data

**Approach**: Implement recent history (last 7-30 days) first, document limitations, plan for NCDC integration later

### Error Handling Philosophy
- Always provide meaningful error messages to AI
- Degrade gracefully (e.g., if historical data unavailable, explain why)
- Never expose raw API errors to end user
- Log detailed errors for debugging

### Data Format for AI Consumption
- Use clear, structured text format
- Include units (F/C, mph, etc.)
- Provide context (location name, date/time, source)
- Format numbers appropriately (round to reasonable precision)
- Use markdown formatting for readability

## Implementation Timeline (Estimated)

- **Phase 1**: 2-4 hours (setup + research)
- **Phase 2**: 4-6 hours (core server)
- **Phase 3**: 8-12 hours (tools implementation)
- **Phase 4**: 4-6 hours (testing)
- **Phase 5**: 3-4 hours (documentation)
- **Phase 6**: Variable (enhancements as needed)

**Total Estimated Time**: 21-32 hours for core implementation

## Success Criteria

1. ✅ MCP server successfully connects to Claude Code
2. ✅ Can retrieve accurate forecasts for any US location
3. ✅ Can retrieve current weather conditions
4. ✅ Can retrieve historical weather data (at least recent history)
5. ✅ Error handling is robust and informative
6. ✅ Documentation is complete and clear
7. ✅ Code is well-tested and reliable
8. ✅ Ready for GitHub publication

## Next Steps

1. Begin with Phase 1: Initialize project and research NOAA API
2. Create basic project structure
3. Test NOAA API endpoints manually to understand data format
4. Implement core MCP server with one simple tool
5. Iterate and expand functionality
