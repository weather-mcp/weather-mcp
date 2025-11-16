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

### 3.4 Tool: geocode_location (Helper) - PLANNED
**Purpose**: Convert location string to coordinates using multi-service fallback strategy

**Rationale**: Users often have difficulty looking up coordinates manually. A built-in geocoding tool with automatic fallback across multiple services provides better reliability and user experience.

**Input Parameters**:
- `location` (string): City, State, address, or place name
  - Examples: "Seattle", "New York, NY", "Paris, France", "1600 Pennsylvania Ave, Washington DC"

**Output**:
- `latitude` (number): Latitude coordinate
- `longitude` (number): Longitude coordinate
- `display_name` (string): Formatted location name
- `country` (string): Country name
- `confidence` (string): "high", "medium", or "low"
- `source` (string): Which service found the result ("census", "nominatim")

**Multi-Service Fallback Strategy**:

The geocoding service will try multiple providers in order, with automatic fallback:

1. **Primary: Census.gov Geocoding API** (US locations)
   - ✅ Free, no API key required
   - ✅ Fast, reliable for US addresses
   - ✅ Official government service
   - ⚠️ US-only coverage
   - Endpoint: `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress`
   - Format preference: "City, State" or full address

2. **Fallback: OpenStreetMap Nominatim** (Worldwide)
   - ✅ Free, no API key required
   - ✅ Worldwide coverage
   - ✅ Good with natural language queries
   - ⚠️ Rate limited: 1 request/second
   - ⚠️ Requires User-Agent header
   - Endpoint: `https://nominatim.openstreetmap.org/search`
   - Format: Accepts various formats

**Implementation Tasks**:
- [ ] Create GeocodingService class (`src/services/geocoding.ts`)
  - [ ] Implement Census.gov provider
  - [ ] Implement Nominatim provider
  - [ ] Add automatic fallback logic
  - [ ] Implement rate limiting per service
  - [ ] Add result caching (reduce redundant API calls)
  - [ ] Add retry logic with exponential backoff
  - [ ] Country/region detection (skip Census.gov for non-US)
- [ ] Define tool schema for MCP
- [ ] Implement geocode_location tool handler
- [ ] Add type definitions (GeocodingResult, GeocodingProvider)
- [ ] Handle ambiguous locations (return multiple results if needed)
- [ ] Format results for AI consumption
- [ ] Add comprehensive error handling with helpful suggestions

**Smart Features**:
- **Caching**: Cache successful geocoding results (avoid re-geocoding "New York" repeatedly)
- **Rate Limiting**: Track requests per service, queue requests for Nominatim
- **Confidence Scoring**: Return confidence level based on result quality
- **Result Validation**: Verify coordinates are reasonable (lat: -90 to 90, lon: -180 to 180)
- **Helpful Errors**: Suggest improvements when location not found

**Example Usage Flow**:
```
User: "Get weather for Seattle"
  ↓
1. Try Census.gov for "Seattle"
   → Found: Seattle, WA (47.6062, -122.3321) ✅
  ↓
Return coordinates to weather tools
```

```
User: "Get weather for Paris"
  ↓
1. Try Census.gov for "Paris"
   → Found: Paris, TX (US city) ⚠️
  ↓
2. Detect non-US intent, try Nominatim
   → Found: Paris, France (48.8566, 2.3522) ✅
  ↓
Return coordinates to weather tools
```

**Error Handling**:
```
Location not found after all services tried:
"Could not find coordinates for 'XYZ'. Try:
- Adding state/country (e.g., 'Seattle, WA' or 'Paris, France')
- Using full name (e.g., 'New York City' instead of 'NYC')
- Checking spelling
- Providing coordinates directly (latitude, longitude)"
```

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

## Phase 5: Documentation & Configuration ✅ COMPLETED

### 5.1 Documentation
- [x] Create comprehensive README.md:
  - Project description
  - Installation instructions
  - Configuration guide
  - Usage examples
  - API reference
- [ ] Add inline code documentation (JSDoc) - DEFERRED (code is self-documenting with clear naming)
- [x] Create CONTRIBUTING.md for open source
- [x] Add LICENSE file (MIT License)
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

**High Priority** (Addresses known user pain points):
- [ ] **Implement geocode_location tool** (See Phase 3.4)
  - Multi-service fallback (Census.gov → Nominatim)
  - Automatic caching and rate limiting
  - Solves coordinate lookup difficulty
  - **Estimated time**: 6-8 hours

**Medium Priority**:
- [ ] Add weather alerts/warnings tool
- [ ] Add radar/satellite data integration
- [ ] Implement caching strategy for repeated queries
- [ ] Add weather comparison tool (compare multiple locations)

**Low Priority**:
- [ ] Add support for international locations in NOAA tools (limited - NOAA is US-only)

### 6.2 Developer Experience
- [ ] Add development mode with hot reload
- [ ] Create debug logging with different levels
- [ ] Add health check/status endpoint
- [ ] Create CLI tool for testing server without MCP client

### 6.3 Analytics & Observability (Optional)
**Purpose**: Add optional, privacy-focused usage analytics to help improve the service

**Documentation**:
- [x] Create comprehensive security guide (MCP_ANALYTICS_SECURITY_GUIDE.md)

**Analytics Server Implementation**:
- [ ] Set up analytics database (PostgreSQL)
  - API keys table with rate limiting
  - Events table with indexes
  - Rate limits table
- [ ] Implement API key generation service
- [ ] Build analytics server API
  - POST /v1/events - Record usage events
  - Middleware: API key validation
  - Middleware: Rate limiting (global + per-key)
  - Middleware: Payload validation (Zod schema)
  - Request signing validation (optional, advanced)
- [ ] Deploy analytics server with HTTPS
- [ ] Create user dashboard for API key management
- [ ] Set up monitoring and abuse detection

**MCP Server Integration**:
- [ ] Implement AnalyticsService class
  - Fire-and-forget event tracking
  - Graceful failure (never breaks functionality)
  - Timeout handling (5 second max)
  - Error categorization
- [ ] Add analytics to tool handlers
  - Track success/failure for each tool
  - Categorize error types
  - No PII collection (no coordinates, queries, etc.)
- [ ] Update environment variable configuration
  - Add ANALYTICS_API_KEY (optional)
  - Add ANALYTICS_ENDPOINT (optional)
- [ ] Update documentation
  - Explain opt-in analytics in README
  - Document what data is collected
  - Privacy policy compliance
  - Instructions to enable/disable

**Security Requirements**:
- [ ] User-provided API keys only (no embedded secrets)
- [ ] Rate limiting: 1000 requests/day per free tier key
- [ ] Global IP-based rate limiting: 100 requests/15 minutes
- [ ] Request timestamp validation (within 60 seconds)
- [ ] Payload schema validation (reject malformed data)
- [ ] Automated abuse detection and key blocking
- [ ] GDPR compliance (data export, deletion, retention policy)

**Privacy Principles**:
- ✅ Opt-in only (disabled by default)
- ✅ No PII collected (no coordinates, location names, queries)
- ✅ Minimal data: tool name, success/failure, error type, timestamp
- ✅ Transparent documentation of what's collected
- ✅ User can disable at any time

**Reference**: See `MCP_ANALYTICS_SECURITY_GUIDE.md` for complete implementation details

## Technical Decisions & Notes

### Geocoding Strategy
**Decision**: Implement multi-service fallback strategy

**Services Used** (in priority order):
1. **Census.gov Geocoding API** (Primary for US locations)
   - Free, no API key required
   - Fast and reliable for US addresses
   - Official government service
   - Best for: US cities, states, addresses

2. **OpenStreetMap Nominatim** (Fallback for worldwide)
   - Free, no API key required
   - Worldwide coverage
   - Good with natural language
   - Best for: International locations, landmarks
   - Rate limit: 1 request/second (must implement queuing)

**Why Multi-Service Approach**:
- **Reliability**: If one service is down, automatically fallback to another
- **Coverage**: Census.gov handles US well, Nominatim handles international
- **Better Results**: Try multiple services increases success rate
- **Rate Limit Mitigation**: Spread load across services
- **User Experience**: Transparent fallback - user doesn't need to know which service is used

**Implementation Details**:
- Automatic fallback (no user configuration needed)
- Result caching to reduce API calls
- Per-service rate limiting
- Country detection to skip inappropriate services
- Confidence scoring based on result quality

**Alternative Considered and Rejected**:
- ❌ NOAA's built-in location search: Limited/undocumented
- ❌ Google Maps Geocoding API: Requires API key and billing
- ❌ Manual coordinates only: Poor user experience

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
