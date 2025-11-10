# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.1] - 2025-11-10

### Fixed

#### Security Fixes
- **Blitzortung MQTT Security** - Added TLS warnings and security guidance for lightning feed
  - Added runtime warning when using plaintext MQTT connections
  - Enhanced documentation about security implications
  - Recommended mitigations for production deployments (TLS proxy, trusted networks)
  - Environment variable `BLITZORTUNG_MQTT_URL` for TLS-enabled brokers
- **Coordinate Privacy** - Implemented coordinate redaction in logging to protect user privacy
  - Added `redactCoordinatesForLogging()` utility that rounds coordinates to ~1.1km precision (2 decimal places)
  - Updated all handlers to use redacted coordinates in logs (lightning, marine, imagery)
  - Environment variable `LOG_PII=true` to enable full precision logging (not recommended for production)
  - Complies with GDPR/CPRA data minimization requirements
- **Markdown Injection Prevention** - Fixed vulnerability in location search results
  - Added `escapeMarkdown()` function to sanitize user input
  - Prevents injection of malicious Markdown (links, images, scripts)
  - Normalizes whitespace to prevent structure injection

#### Performance & Reliability Fixes
- **River Conditions Performance** - Implemented bounding box queries to avoid downloading entire gauge catalog
  - Added `getNWPSGaugesInBoundingBox()` method with server-side filtering
  - Calculates efficient bounding box based on search radius and latitude
  - Falls back to client-side filtering if API doesn't support bbox queries
  - Reduces bandwidth and latency by orders of magnitude for location-specific queries
- **Cached Data Mutation** - Fixed forecast handler mutating cached NOAA data
  - Changed `getMaxProbabilityFromSeries()` to work on local copies
  - Prevents severe weather calculations from affecting other formatters using same cached object
  - Eliminates intermittent "missing probability" bugs
- **Blitzortung Subscription Management** - Implemented LRU-based subscription cleanup
  - Changed subscription tracking from Set to Map with timestamps
  - Added automatic eviction when exceeding 50 concurrent subscriptions
  - Added stale subscription pruning (1-hour inactivity threshold, checked every 15 min)
  - Prevents unbounded memory and CPU growth from subscription accumulation
- **RainViewer Polar Coordinate Handling** - Fixed tile generation for extreme latitudes
  - Added Web Mercator latitude clamping (±85.05112878°) to prevent NaN coordinates
  - Prevents division by zero in tile calculations at polar regions
  - Logs warning when clamping occurs
- **Timezone Fallback** - Changed international timezone fallback from server timezone to UTC
  - Provides predictable, unambiguous timestamps for all users
  - Eliminates misleading timestamps for international queries (e.g., Sydney users seeing Chicago times)
  - US timezone heuristic unchanged (America/New_York, Chicago, Denver, Los_Angeles)

### Added
- **Comprehensive Test Coverage** - Added 28 unit tests for v1.6.1 fixes
  - Coordinate redaction privacy tests
  - Markdown injection prevention tests
  - RainViewer polar coordinate clamping tests
  - Timezone fallback behavior tests
  - Cache immutability tests
  - NWPS bounding box calculation tests

### Changed
- **Dependencies** - Updated to latest versions (integrated Dependabot PRs #5, #6)
  - `@modelcontextprotocol/sdk` 1.21.0 → 1.21.1
  - `vitest` 4.0.7 → 4.0.8
  - `@vitest/coverage-v8` 4.0.7 → 4.0.8

## [1.6.0] - 2025-11-09

### Added

#### Safety & Hazards - River Monitoring and Wildfire Tracking
- **NEW: `get_river_conditions` Tool** - Monitor river levels and flood status for safety and recreation
  - **Current Water Levels** from nearest NOAA and USGS gauges
    - Automatic gauge discovery within customizable radius (default: 50km)
    - Distance calculation to each gauge using Haversine formula
    - River and location names for context
  - **Flood Stage Information** - Critical safety data
    - Action, minor, moderate, and major flood thresholds
    - Current flood status with color-coded warnings
    - Forecast conditions when available
  - **Streamflow Data** from USGS Water Services
    - Real-time discharge in cubic feet per second (CFS)
    - Flow rate trends and comparisons
  - **Historical Context**
    - Historic flood crests when available
    - Recent crest data for context
  - **Safety Assessment** for recreational activities
    - Boating and kayaking safety guidance
    - Flood warnings and evacuation context
  - **US Coverage** via NOAA NWPS and USGS APIs
  - **1-Hour Cache** for gauge data
  - **User Queries**:
    - "What are the river conditions near me?"
    - "Is the river flooding?"
    - "Safe to kayak on the river today?"
    - "Check Mississippi River levels"

- **NEW: `get_wildfire_info` Tool** - Monitor active wildfires and fire perimeters for safety planning
  - **Active Fire Detection** from NIFC WFIGS
    - Wildfire locations and prescribed burns
    - Automatic filtering within customizable radius (default: 100km)
    - Distance-based sorting (nearest fires first)
  - **Fire Attributes**:
    - Fire size in acres and hectares
    - Containment percentage with visual progress bar
    - Discovery date and days active
    - Fire type classification (Wildfire vs Prescribed Fire)
    - Location details (state, county, city)
    - Coordinates of fire origin
  - **4-Level Safety Assessment** - Proximity-based warnings
    - **EXTREME DANGER** (<5km): Evacuate immediately if advised
    - **HIGH ALERT** (5-25km): Prepare for possible evacuation
    - **CAUTION** (25-50km): Monitor conditions, air quality impacts
    - **AWARENESS** (>50km): Stay informed about fire progression
  - **Comprehensive Fire Details** - Up to 5 nearest fires displayed
    - Detailed statistics for each fire
    - Visual containment indicators
    - State/county/city location information
  - **Safety Recommendations** based on distance to nearest wildfire
  - **30-Minute Cache** for fire data (updates frequently)
  - **Data Source**: NIFC WFIGS (Wildland Fire Interagency Geospatial Services)
  - **User Queries**:
    - "Are there wildfires near Los Angeles?"
    - "Check for active fires in Colorado"
    - "How close is the nearest wildfire?"
    - "Show me fire containment status"

### Technical Changes
- **New Type Definitions**:
  - Extended `src/types/noaa.ts` with NWPS river gauge types
    - `NWPSGauge`, `GaugeStatus`, `FloodCategories`
    - `HistoricCrest`, `USGSIVResponse`, `USGSSite`
  - Created `src/types/wildfire.ts` for NIFC ArcGIS data
    - `FirePerimeterAttributes`, `FirePerimeterFeature`
    - `NIFCQueryResponse`, `WildfireInfo`

- **New Service Clients**:
  - Enhanced `src/services/noaa.ts` with NWPS and USGS clients
    - `nwpsClient`: NOAA National Water Prediction Service
    - `usgsClient`: USGS Water Services API
    - `getNWPSGauge()`: Fetch individual gauge data
    - `getAllNWPSGauges()`: Fetch all available gauges
    - `getUSGSStreamflow()`: Real-time streamflow by bounding box
  - Created `src/services/nifc.ts` - NIFC ArcGIS REST API client
    - `queryFirePerimeters()`: Bounding box fire queries
    - `checkServiceStatus()`: NIFC service health check
    - ArcGIS Feature Server integration
    - 30-minute cache for fire perimeter data

- **New Utility**:
  - Created `src/utils/distance.ts`
    - `calculateDistance()`: Haversine formula for lat/lon distances
    - Used by both river and wildfire tools for proximity filtering

- **New Handlers**:
  - `src/handlers/riverConditionsHandler.ts`
    - Validates coordinates and radius parameters
    - Fetches all NWPS gauges and filters by distance
    - Queries USGS for streamflow data
    - Formats comprehensive river condition reports
  - `src/handlers/wildfireHandler.ts`
    - Converts center point + radius to bounding box
    - Queries NIFC for fire perimeters
    - Filters by actual distance and sorts by proximity
    - Provides 4-level safety assessment
    - Distinguishes wildfires from prescribed burns

- **Tool Configuration Updates**:
  - Added `get_river_conditions` and `get_wildfire_info` to `ToolName` type
  - Both tools added to 'all' preset (now 12 tools total)
  - New aliases: 'river', 'rivers', 'flood', 'streamflow', 'wildfire', 'wildfires', 'fire', 'fires', 'smoke'
  - Basic preset unchanged (5 tools) - minimal impact on typical users

- **Caching Strategy**:
  - River conditions: 1-hour TTL (gauge data updates frequently)
  - Wildfire information: 30-minute TTL (fire data changes rapidly)

### Testing
- **NEW**: `tests/integration/safety-hazards.test.ts` (17 comprehensive tests)
  - River Conditions: 7 tests covering gauge queries, validation, error handling
    - St. Louis, MO (Mississippi River) gauge discovery
    - Houston, TX multi-river area testing
    - Nevada desert (no gauges) edge case
    - Radius parameter validation and clamping
    - Coordinate validation
  - Wildfire Information: 10 tests covering fire detection, safety assessment, validation
    - Los Angeles (high fire risk area) wildfire queries
    - Denver, CO fire detection
    - Boston (low fire risk) edge case
    - Radius parameter validation and clamping
    - Coordinate validation
    - Safety assessment verification
  - NIFC service health checks

### Documentation
- Updated README.md with v1.6.0 features
  - Added tools 11 and 12 to Available Tools section
  - Updated Features section with river and wildfire monitoring
  - Added cache strategy for new tools
- Updated ROADMAP.md
  - Marked v1.6.0 as COMPLETE
  - Updated tool inventory and cumulative totals

### Implementation Notes
- **NOAA NWPS API**: Temporarily unavailable during initial testing (service downtime)
  - Error handling confirmed working correctly
  - Graceful degradation with user-friendly messages
  - Tests will be re-run when API is back online
- **NIFC WFIGS API**: Operational and tested successfully
  - Detected real "La Plata" wildfire in Colorado during testing
  - 133 acres, 92% contained, discovered August 17, 2025

## [1.5.0] - 2025-11-09

### Added

#### Weather Visualization & Lightning Safety - Visual Analysis and Real-Time Strike Monitoring
- **NEW: `get_weather_imagery` Tool** - Access weather radar and precipitation maps
  - **Precipitation Radar** from RainViewer API (free, global coverage)
    - Static radar images showing current precipitation
    - Animated radar loops (up to 2 hours of history)
    - Tile URLs for efficient rendering
    - Automatic coordinate-to-tile calculation
    - Timestamp metadata for each frame
  - **Global Coverage** - Works anywhere in the world
  - **15-Minute Cache** for radar data to reduce API load
  - **Graceful Degradation** when imagery unavailable
  - **Future-Ready**: Satellite imagery deferred to future release
  - **User Queries**:
    - "Show me the current radar"
    - "Is there precipitation nearby on radar?"
    - "Show animated radar for the last hour"

- **NEW: `get_lightning_activity` Tool** - Real-time lightning strike detection and safety assessment
  - **Real-Time Strike Detection** from Blitzortung.org (free, no API key required)
    - Lightning strikes within customizable radius (default: 100km)
    - Time window for historical strikes (default: 60 minutes)
    - Distance calculation using Haversine formula
    - Strike polarity (cloud-to-ground vs intra-cloud)
    - Strike amplitude in kiloamperes (kA)
  - **4-Level Safety Assessment** - Critical for outdoor safety
    - **Safe** (>50km): No immediate lightning threat
    - **Elevated** (16-50km): Monitor conditions, plan indoor access
    - **High** (8-16km): Seek shelter immediately
    - **Extreme** (<8km): Active thunderstorm, dangerous conditions
  - **Comprehensive Statistics**:
    - Total strikes and strike density (per sq km)
    - Strikes per minute rate
    - Nearest strike distance
    - Average distance of all strikes
    - Cloud-to-ground vs intra-cloud classification
  - **Safety Recommendations** - Context-aware guidance based on proximity
  - **Geographic Region Detection** - Optimizes API endpoints for best coverage
  - **5-Minute Cache** for strike data
  - **Graceful Degradation** - Returns empty array if API unavailable
  - **User Queries**:
    - "Are there lightning strikes nearby?"
    - "How close is the lightning?"
    - "Is it safe to be outside?" (lightning risk assessment)
    - "Show recent lightning activity"

### Technical Changes
- **New Type Definitions**:
  - `src/types/imagery.ts` - Weather imagery types
    - `ImageryType`: 'radar' | 'satellite' | 'precipitation'
    - `WeatherImageryParams`, `WeatherImageryResponse`
    - `ImageFrame`, `RainViewerResponse`
  - `src/types/lightning.ts` - Lightning strike types
    - `LightningSafetyLevel`: 'safe' | 'elevated' | 'high' | 'extreme'
    - `LightningStrike`, `LightningStatistics`, `LightningSafety`
    - `LightningActivityResponse`

- **New Service Clients**:
  - `src/services/rainviewer.ts` - RainViewer API client
    - `getRadarData()`: Fetch available radar timestamps
    - `getPrecipitationRadar()`: Get radar imagery for location
    - `buildCoordinateTileUrl()`: Calculate tile URLs from coordinates
    - Tile coordinate conversion (lat/lon to tile x/y/z)
  - `src/services/blitzortung.ts` - Blitzortung.org API client
    - `getLightningStrikes()`: Fetch recent strikes in radius
    - `calculateDistance()`: Haversine distance calculation
    - `parseStrikes()`: Parse and filter strike data
    - `determineRegion()`: Geographic region detection
    - `generateMockData()`: Development/fallback data

- **New Handlers**:
  - `src/handlers/weatherImageryHandler.ts`
    - `getWeatherImagery()`: Validates and processes imagery requests
    - `formatWeatherImageryResponse()`: Formats imagery data for MCP response
    - Validation for imagery type, animated flag, coordinates
  - `src/handlers/lightningHandler.ts`
    - `getLightningActivity()`: Processes lightning activity requests
    - `assessSafety()`: Calculates safety level from strike distances
    - `calculateStatistics()`: Computes comprehensive strike statistics
    - `formatLightningActivityResponse()`: Formats for MCP response

- **Tool Configuration Updates**:
  - Added `get_weather_imagery` and `get_lightning_activity` to `ToolName` type
  - Both tools added to 'all' preset (now 10 tools total)
  - New aliases: 'imagery', 'radar', 'satellite', 'lightning', 'strikes', 'thunderstorm'
  - Basic preset unchanged (5 tools) - minimal impact on typical users

- **Error Handling**:
  - Extended `ApiError` service types to include 'RainViewer'
  - Updated help link logic for RainViewer service

### Testing
- **15 new integration tests** added (764 total):
  - Weather imagery tests (7 tests) - `tests/integration/visualization-lightning.test.ts`
    - Precipitation radar retrieval (New York, London, Tokyo)
    - Animated vs static radar
    - Radar type alias handling
    - Validation (invalid type, coordinates, satellite not implemented)
  - Lightning activity tests (8 tests) - `tests/integration/visualization-lightning.test.ts`
    - Lightning detection (Miami, New York, London, Tokyo, Sydney, Austin)
    - Default and custom search parameters
    - Safety assessment and statistics calculation
    - Strike details validation
    - Validation (invalid radius, time window, coordinates)
- **Updated unit tests**:
  - Tool configuration tests updated for 10 tools (was 8)
  - All 764 tests passing with 100% pass rate

### Documentation
- Updated ROADMAP.md to mark v1.5.0 as complete
- Updated FUTURE_ENHANCEMENTS.md:
  - Section 8.1 (Real-Time Lightning Data) marked as implemented
  - Section 12.1 (Radar & Satellite Image URLs) marked as partially implemented
- Tool inventory now shows 10 total tools

### Configuration Impact
With v1.4.0 tool configuration system, users have full control:
- **Typical user**: `ENABLED_TOOLS=basic` (5 tools, no change)
- **Power user**: `ENABLED_TOOLS=all` (all 10 tools including imagery and lightning)
- **Lightning safety focus**: `ENABLED_TOOLS=basic,+lightning`
- **Visual analysis**: `ENABLED_TOOLS=standard,+imagery,+lightning`
- **Weather enthusiast**: `ENABLED_TOOLS=full,+imagery,+lightning`

### Benefits
- ✅ **Weather Visualization**: Visual confirmation of precipitation via radar imagery
- ✅ **Lightning Safety**: Critical real-time safety information for outdoor activities
- ✅ **Global Coverage**: Both tools work worldwide
- ✅ **Free APIs**: No API keys or costs required (RainViewer, Blitzortung.org)
- ✅ **Safety-Critical**: 4-level assessment helps users make informed decisions
- ✅ **Minimal Overhead**: Both tools only in 'all' preset, doesn't affect basic users
- ✅ **Zero Breaking Changes**: Existing configurations continue to work

### Use Cases
- **Outdoor Safety**: Check for nearby lightning before outdoor activities
- **Weather Analysis**: Visual confirmation of approaching precipitation
- **Emergency Planning**: Real-time lightning threat assessment
- **Education**: Understand storm structure through radar and strike patterns
- **Recreation**: Boaters, hikers, golfers can check safety conditions

**Token Overhead**: ~400 tokens added (total: ~1,400 with all tools, ~600 with basic preset)

## [1.4.0] - 2025-11-08

### Added

#### Tool Configuration System - Reduce Context Overhead & Customize Functionality
- **NEW: Configurable Tool Loading** - Control which MCP tools are exposed via `ENABLED_TOOLS` environment variable
  - **4 Presets** for easy configuration:
    - `basic` (default): Essential 5 tools - forecast, current_conditions, alerts, search_location, check_service_status
    - `standard`: Basic + historical_weather (6 tools)
    - `full`: Standard + air_quality (7 tools)
    - `all`: All 8 tools including marine_conditions
  - **Flexible Syntax** for fine-grained control:
    - Use presets: `ENABLED_TOOLS=full`
    - Select specific tools: `ENABLED_TOOLS=forecast,current,alerts`
    - Add to presets: `ENABLED_TOOLS=basic,+historical,+air_quality`
    - Remove from presets: `ENABLED_TOOLS=all,-marine`
    - Complex combinations: `ENABLED_TOOLS=standard,+air_quality,-alerts`
  - **Tool Aliases** - Short names for convenience:
    - `forecast`, `current`, `conditions`, `alerts`, `warnings`
    - `historical`, `history`, `status`, `location`, `search`
    - `air_quality`, `aqi`, `marine`, `ocean`, `waves`
  - **Smart Defaults**: Only `basic` tools enabled by default (5 of 8 tools)
  - **Runtime Validation**: Prevents disabled tools from being called
  - **Startup Logging**: Shows which tools are enabled on server start

### Technical Changes
- New configuration module: `src/config/tools.ts`
  - `ToolConfig` class with singleton pattern
  - `parseEnabledTools()`: Parses complex configuration syntax
  - `resolveToolName()`: Handles tool aliases and full names
  - `isEnabled()`: Check if specific tool is enabled
  - `getEnabledTools()`: Get list of all enabled tools
- Updated `src/index.ts`:
  - Tool definitions moved to `TOOL_DEFINITIONS` constant
  - `ListToolsRequestSchema` handler filters by enabled tools
  - `CallToolRequestSchema` handler validates tool is enabled before execution
  - Enhanced startup logging with enabled tool count and list
- Environment variable: `ENABLED_TOOLS` (optional, defaults to `basic`)

### Testing
- **27 new unit tests** added (749 total, 100% pass rate):
  - Tool configuration tests: 27 tests (`tests/unit/tool-config.test.ts`)
    - Preset parsing (basic, standard, full, all)
    - Individual tool selection
    - Addition syntax (+tool)
    - Removal syntax (-tool)
    - Combination syntax (presets + additions + removals)
    - Alias resolution
    - Edge cases (whitespace, invalid names, duplicates, case insensitivity)
    - Static method tests (preset/alias definitions)

### Documentation
- Updated README.md with "Tool Selection" configuration section
- Updated .env.example with comprehensive tool configuration examples
- All configuration examples and benefits documented

### Benefits
- ✅ **Reduced Context Overhead**: Load only needed tools (basic = 5 tools vs all = 8 tools)
- ✅ **Better Security**: Only expose necessary functionality
- ✅ **Easy Customization**: Mix and match with flexible syntax
- ✅ **Backwards Compatible**: Defaults to `basic` preset if not configured
- ✅ **Zero Breaking Changes**: Existing deployments continue to work
- ✅ **Minimal Token Impact**: Tool filtering happens at registration, not per-request

### Use Cases
- **Typical Weather User**: `ENABLED_TOOLS=basic` (5 tools, minimal overhead)
- **Power User**: `ENABLED_TOOLS=all` (all 8 tools, maximum functionality)
- **Specific Needs**: `ENABLED_TOOLS=forecast,current,air_quality` (custom selection)
- **Air Quality Focus**: `ENABLED_TOOLS=basic,+air_quality` (core + AQI monitoring)
- **No Marine Data**: `ENABLED_TOOLS=all,-marine` (everything except ocean conditions)

## [1.3.0] - 2025-11-07

### Enhanced

#### Version Management & User Updates - Keep Users on Latest Version
- **NEW: Version Information in Status Check** - `check_service_status` tool now displays version info
  - Shows installed version number
  - Links to latest release on GitHub
  - Links to CHANGELOG and upgrade instructions
  - Recommends `@latest` tag for automatic updates
  - Helps users discover when they're running outdated versions
- **NEW: Startup Version Logging** - Server logs version info on startup
  - Displays installed version in structured logs
  - Includes links to latest release and upgrade instructions
  - Provides tip for automatic updates via `npx @latest`
  - Visible in MCP client logs for awareness
- **Updated Installation Instructions** - README now recommends `@latest` tag
  - All npx examples updated to use `@dangahagan/weather-mcp@latest`
  - Ensures new users automatically get latest version on each run
  - Reduces version drift across user base
  - Addresses issue where several hundred users may be on older versions

### Documentation
- Updated README.md with `@latest` in all npx installation examples
- Enhanced "Upgrading to Latest Version" section with clearer instructions
- Updated "Quick Start: Claude Code" section with recommended configuration
- Clarified npx caching behavior and upgrade workflow

### Benefits
- **Automatic Updates**: Users with `@latest` config stay current automatically
- **Version Visibility**: Users can easily check their version via status tool
- **Reduced Support**: Fewer issues from outdated versions
- **Better UX**: Users discover new features and bug fixes faster

**Migration Note**: Existing users should update their MCP configuration to use `@latest`:
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

## [1.2.1] - 2025-11-07

### Enhanced

#### Fire Weather Intelligence - Contextual Messaging
- **Intelligent Fire Weather Explanations** - Smart contextual messages when fire weather indices unavailable
  - **NEW: `getFireWeatherContext()`** utility - Provides region, season, and weather-aware explanations
  - **Geographic Detection**: Identifies Western US, California, Southern states, Eastern US regions
  - **Seasonal Awareness**: Differentiates winter vs. fire season with appropriate messaging
  - **Humidity-Based Context**: Recognizes high humidity conditions that suppress fire risk
  - **User Education**: Explains when and why fire danger indices are calculated
  - **Improved UX**: Replaces confusing empty fields with clear, helpful information
  - **Atmospheric Monitoring Section**: Always displays mixing height and transport wind data
  - **Zero Breaking Changes**: All existing functionality preserved

### Technical Changes
- New utility function: `getFireWeatherContext()` in `src/utils/fireWeather.ts`
  - Detects geographic region from coordinates
  - Determines current season and date context
  - Analyzes weather conditions (humidity, temperature)
  - Generates tailored explanatory messages
- Updated `currentConditionsHandler.ts`: Enhanced fire weather display logic with contextual messaging
- Improved test organization: Moved test scripts from root to `tests/` directory

### Testing
- **29 new unit tests** added (722 total, 100% pass rate):
  - Fire weather context detection: 29 tests (`tests/unit/fireWeatherContext.test.ts`)
    - Geographic region detection (Western US, California, Southern, Eastern)
    - Seasonal context (winter, fire season, shoulder months)
    - Humidity-based messaging
    - Temperature-based context
    - Edge cases and boundary conditions

### Documentation
- Enhanced user experience with contextual fire weather explanations
- Improved inline code documentation for fire weather utilities

## [1.2.0] - 2025-11-07

### Enhanced

#### Climate Normals - Historical Context for Weather
- **NEW: Climate Normals Support** - Compare current and forecasted weather to 30-year averages (1991-2020)
  - **Optional Parameter**: `include_normals=true` for `get_current_conditions` and `get_forecast`
  - **Hybrid Data Strategy**:
    - **Primary**: Open-Meteo computed normals (global, zero setup, completely free)
    - **Optional**: NOAA NCEI official normals (US only, requires free API token)
    - Automatically selects best source: tries NCEI first for US locations with token, falls back to Open-Meteo
  - **Displays**:
    - Normal high/low temperatures for the date
    - Normal precipitation amount
    - **Departure from normal**: "+8°F warmer than normal" or "-5°F cooler than normal"
    - Helps answer "Is this weather unusual?"
  - **Data Source**:
    - Open-Meteo: Computed from 30 years (1991-2020) of ERA5 reanalysis data
    - NCEI: Official NOAA climate normals (requires `NCEI_API_TOKEN` env variable)
  - **Caching**: Normals cached indefinitely (static historical data)
  - **No Token Required**: Default implementation uses completely free Open-Meteo API

#### Snow and Ice Data - Winter Weather Tracking
- **Enhanced Winter Weather Display** - Automatic snow/ice data extraction and formatting
  - **Snow Depth**: Current snow on ground (inches)
  - **Snowfall Forecast**: Expected accumulation over forecast period
  - **Ice Accumulation**: Freezing rain accumulation forecast
  - **Smart Display**: Only shows when winter weather is present
  - **Unit Conversion**: Automatically converts from metric (mm/cm) to US units (inches)
  - **Integration**:
    - Current conditions: Shows current snow depth
    - Forecasts: Shows expected snowfall and ice for forecast period
  - **Data Source**: NOAA gridpoint data and observations

#### Timezone-Aware Time Display - Local Time Context
- **Enhanced Time Formatting** - All timestamps now display in local timezone
  - **Automatic Detection**: Uses timezone from NOAA station data or geographic coordinates
  - **Formatted Display**: "Nov 7, 2025, 2:30 PM EST" instead of ISO 8601
  - **Applied To**:
    - Current conditions observation time
    - Forecast update times
    - Weather alert effective/expiration times
    - Marine conditions observation time
    - Forecast period headers (hourly forecasts)
  - **Timezone Support**:
    - IANA timezone identifiers (e.g., "America/New_York")
    - Automatic DST handling
    - Fallback to geographic guess if API timezone unavailable
  - **Format Styles**: Short, medium, long, and full format options

### Technical Changes

#### Climate Normals Infrastructure
- New services:
  - `src/services/ncei.ts`: NCEI Climate Data Online (CDO) API client (placeholder for future full implementation)
  - `src/config/api.ts`: Optional NCEI API token configuration
- New utilities (`src/utils/normals.ts`):
  - `computeNormalsFrom30YearData()`: Computes 30-year averages from historical data
  - `getClimateNormals()`: Hybrid selection logic (NCEI → Open-Meteo fallback)
  - `formatNormals()`: Markdown formatting with departure calculations
  - `calculateDeparture()`: Computes +/- from normal
  - `isLocationInUS()`: Geographic detection for NCEI eligibility
  - `getNormalsCacheKey()`: Cache key generation
- Enhanced Open-Meteo service:
  - `getClimateNormals()`: Fetches 30 years of historical data (1991-2020)
  - Optimized to fetch only target month ±1 (75% data reduction)
  - Returns computed ClimateNormals object
- Updated error types: Added 'NCEI' to service union in all error classes
- Handler updates:
  - `currentConditionsHandler`: Added `include_normals` parameter and display logic
  - `forecastHandler`: Added `include_normals` parameter (daily forecasts only)

#### Snow/Ice Utilities
- Comprehensive snow utilities (`src/utils/snow.ts`):
  - `extractSnowDepth()`: Extract current snow on ground from observations
  - `extractSnowfallForecast()`: Aggregate snowfall from gridpoint forecasts
  - `extractIceAccumulation()`: Aggregate ice accumulation from gridpoint forecasts
  - `formatSnowData()`: Markdown formatting for winter weather section
  - `hasWinterWeather()`: Check if any winter weather data present
- Unit conversion: Automatic mm/cm → inches
- Time filtering: Extract data for specific forecast periods
- Threshold handling: Skip trace amounts (< 0.1" snow, < 0.05" ice)

#### Timezone Infrastructure
- Comprehensive timezone utilities (`src/utils/timezone.ts`):
  - `formatInTimezone()`: Format ISO datetime in specific timezone (4 styles)
  - `formatDateInTimezone()`: Date-only formatting
  - `formatTimeInTimezone()`: Time-only formatting with abbreviation
  - `getTimezoneAbbreviation()`: Get timezone abbreviation (EST/EDT/PST/etc.)
  - `guessTimezoneFromCoords()`: Geographic fallback for missing timezone data
  - `formatTimeRangeInTimezone()`: Format time ranges with timezone context
  - `isValidTimezone()`: Validate IANA timezone identifiers
- Uses Luxon library for robust timezone handling
- Fallback chain: NOAA station timezone → geographic guess → system timezone → UTC

### Testing
- **340 new unit tests** added (693 total, 100% pass rate):
  - Climate normals utilities: 31 tests (`tests/unit/normals.test.ts`)
    - 30-year average computation
    - Cache key generation
    - Departure calculation
    - Formatting with/without current temps
    - Date component extraction
    - US location detection
  - Snow/ice utilities: 29 tests (`tests/unit/snow.test.ts`)
    - Snow depth extraction (multiple units)
    - Snowfall forecast aggregation
    - Ice accumulation tracking
    - Time-based filtering
    - Formatting and display logic
  - Timezone utilities: 33 tests (`tests/unit/timezone.test.ts`)
    - Multi-format datetime display
    - Timezone abbreviation handling
    - Geographic coordinate guessing
    - Time range formatting
    - IANA timezone validation
  - **Fire weather utilities: 92 tests** (`tests/unit/fireWeather.test.ts`) - **SAFETY-CRITICAL**
    - Haines Index categorization (all thresholds validated)
    - Grassland fire danger levels
    - Red Flag Warning threat assessment
    - Fire weather data extraction
    - Mixing height dispersion context
    - Transport wind interpretation
  - **Air quality utilities: 114 tests** (`tests/unit/airQuality.test.ts`) - **HEALTH-CRITICAL**
    - US EPA AQI categorization (all 6 categories, exact thresholds)
    - European EAQI categorization (all 6 categories)
    - UV Index categorization (WHO standards)
    - Pollutant information (7 pollutants)
    - Concentration formatting with precision
    - Geographic AQI selection (US territories)
  - **NCEI service: 41 tests** (`tests/unit/ncei.test.ts`)
    - Service initialization and configuration
    - Token validation and availability
    - Error handling interceptor
    - Climate normals placeholder implementation
- All existing 353 tests continue to pass
- Comprehensive edge case coverage including safety/health-critical calculations

### Documentation
- Updated `CLAUDE.md` with implementation patterns
- Created `docs/development/CLIMATE_NORMALS_PLAN.md` - comprehensive planning document
- Updated README.md with new feature descriptions
- Updated ROADMAP.md - moved Tier 1 items to completed

### Benefits
- ✅ **Climate Context**: Users can assess if weather is unusual for the date
- ✅ **Winter Awareness**: Automatic snow/ice alerts in forecasts and conditions
- ✅ **Time Clarity**: All times displayed in familiar local format instead of UTC
- ✅ **Zero Setup**: Default implementation requires no API tokens
- ✅ **Opt-In Design**: New features are optional parameters (backward compatible)
- ✅ **Global Coverage**: Climate normals work worldwide via Open-Meteo
- ✅ **US Enhancement**: Optional NCEI integration for official US climate normals

### API Changes
- **Backward Compatible**: All new features are opt-in via optional parameters
- New optional parameters:
  - `get_current_conditions`: `include_normals` (boolean, default false)
  - `get_forecast`: `include_normals` (boolean, default false)
- New environment variable:
  - `NCEI_API_TOKEN`: Optional NCEI API token for US climate normals

### Performance
- Climate normals cached indefinitely (static data)
- Optimized historical data fetching (75% reduction by fetching only ±1 month)
- No performance impact when normals not requested
- Timezone formatting adds negligible overhead (<1ms)

## [1.1.0] - 2025-11-07

### Enhanced

#### Marine Conditions - Great Lakes & Coastal Bay Support
- **Enhanced `get_marine_conditions`** with dual-source support for inland lakes
  - **NOAA Data Integration**: Automatically uses NOAA gridpoint data for:
    - All 5 Great Lakes (Superior, Michigan, Huron, Erie, Ontario)
    - Major US coastal bays (Chesapeake Bay, San Francisco Bay, Tampa Bay, Puget Sound)
    - Lake Okeechobee and other large navigable inland waters
  - **Automatic Source Selection**: Intelligent geographic detection
    - Detects Great Lakes coordinates and uses NOAA marine data
    - Falls back to Open-Meteo for ocean locations and when NOAA data unavailable
    - Zero token overhead - no new parameters required
  - **Marine Data from NOAA**:
    - Wave height, wave period, wave direction (from gridpoint forecasts)
    - Wind speed, wind direction, wind gusts (in knots for marine use)
    - Current conditions with safety assessments
  - **Enhanced Coverage**: Addresses previous limitation where Great Lakes locations returned "N/A"
    - Traverse City, MI (Grand Traverse Bay) - now provides wave/wind data
    - Duluth, MN (Lake Superior) - full marine conditions
    - Cleveland, OH (Lake Erie) - complete wind/wave information
  - **Graceful Degradation**: Falls back to Open-Meteo if NOAA data unavailable
  - **Clear Data Source Attribution**: Output indicates whether data is from NOAA or Open-Meteo

### Technical Changes
- Added geographic detection utilities (`src/utils/geography.ts`):
  - `shouldUseNOAAMarine()`: Detects Great Lakes and coastal bay locations
  - `getGreatLakeRegion()`: Identifies which Great Lake contains coordinates
  - `getMajorCoastalBayRegion()`: Detects major US coastal bays
  - Bounding box definitions for all 5 Great Lakes and 5 major coastal areas
- Enhanced NOAA type definitions with marine forecast properties:
  - New interface: `GridpointMarineForecast` with 9 marine data fields
  - Added to `GridpointProperties`: waveHeight, wavePeriod, waveDirection, windWaveHeight, swellHeight/Direction
- Enhanced marine utilities (`src/utils/marine.ts`):
  - `extractNOAAMarineConditions()`: Extracts marine data from gridpoint response
  - `formatWindSpeed()`: Converts km/h to knots for marine display
  - New interface: `NOAAMarineConditions` for NOAA-sourced marine data
- Updated `marineConditionsHandler`:
  - Dual-source logic: tries NOAA first for Great Lakes/bays, falls back to Open-Meteo
  - Separate formatters: `formatNOAAMarineConditions()` and `formatOpenMeteoMarineConditions()`
  - Enhanced logging for source selection and fallback scenarios
- Updated service injection: handler now receives both `noaaService` and `openMeteoService`

### Testing
- Added comprehensive integration test suite (`tests/integration/great-lakes-marine.test.ts`):
  - Geographic detection validation (15 tests total)
  - NOAA marine data retrieval for all Great Lakes
  - Coastal bay detection (San Francisco Bay, Chesapeake Bay)
  - Open-Meteo fallback for ocean locations
  - Error handling and graceful degradation
  - Marine data format validation
- Added unit tests for geography utilities (`tests/unit/geography.test.ts`):
  - Bounding box validation for all regions (26 tests)
  - Edge case handling and boundary testing
  - No overlaps between Great Lakes and coastal bay regions

### Documentation
- Updated ROADMAP.md with v1.1.0 completion status
- No changes to tool descriptions (maintains lean design philosophy)
- Zero token overhead - existing tool description unchanged

### Benefits
- ✅ Great Lakes boaters/sailors now get accurate marine forecasts
- ✅ Addresses user feedback about N/A data for inland lakes
- ✅ No new tools added (maintains 8-tool count from v1.0.0)
- ✅ Zero token overhead (smart routing, no new parameters)
- ✅ Backward compatible (Open-Meteo remains default for ocean locations)
- ✅ Improves existing tool quality without API proliferation

## [0.6.0] - 2025-11-06

### Added

#### Marine Conditions Tool
- **NEW TOOL: `get_marine_conditions`** - Comprehensive marine weather for coastal and ocean areas
  - Global coverage via Open-Meteo Marine API
  - Current marine conditions:
    - **Significant Wave Height**: Average height of highest 1/3 of waves (meters and feet)
    - **Wave Direction**: Cardinal direction of wave propagation
    - **Wave Period**: Time between successive wave crests (longer = more powerful)
    - **Wind Waves**: Locally generated waves from current winds
      - Height, direction, period, and peak period
    - **Swell**: Long-period waves from distant weather systems
      - Height, direction, period, and peak period
    - **Ocean Currents**: Velocity and direction (m/s and knots)
  - Safety assessment with color-coded conditions:
    - 🟢 Calm (0-2m): Safe for most vessels
    - 🟡 Moderate (2-4m): Challenging for small craft
    - 🟠 Rough (4-6m): Hazardous for small vessels
    - 🔴 Very Rough (6-9m): Dangerous for most vessels
    - 🟤 High (>9m): Extremely dangerous
  - Optional 5-day marine forecast with daily summaries
  - Wave height categorization based on Douglas Sea Scale
  - Interpretation guidance for wave types and periods
  - Important disclaimer about coastal accuracy limitations
  - 1-hour cache for marine data

#### Severe Weather Probabilities
- **Enhanced `get_forecast`** with severe weather forecasting (US only)
  - New parameter: `include_severe_weather` (boolean, default: false)
  - Probabilistic severe weather data from NOAA gridpoint forecasts:
    - **Thunderstorm Probability**: Likelihood of thunder in next 48 hours
    - **Wind Gust Probabilities**: Categorized by intensity
      - 20+ mph, 30+ mph, 40+ mph, 50+ mph, 60+ mph thresholds
      - Shows highest risk category with percentage
    - **Tropical Storm Winds**: Probability of 39-73 mph winds
    - **Hurricane-Force Winds**: Probability of 74+ mph winds
    - **Lightning Activity Level**: 1-5 scale with qualitative description
  - Smart display logic:
    - Only shows significant probabilities (filters low-risk data)
    - Prioritizes highest wind gust category
    - Includes emoji indicators for quick visual assessment
  - Works with both daily and hourly forecast granularities
  - Graceful fallback if severe weather data unavailable
  - Maximum probability extraction over next 48 hours

### Technical Changes
- Added Open-Meteo Marine API integration
  - New service client for `marine-api.open-meteo.com`
  - Support for current, hourly, and daily marine data
  - Comprehensive wave, swell, and current parameters
- Enhanced NOAA gridpoint data with severe weather fields
  - New type definitions: `GridpointSevereWeather` interface
  - Added 11 new severe weather probability fields
  - Lightning activity level support
- New utility modules:
  - `src/utils/marine.ts`: Wave height categorization, safety assessment, activity suitability
  - Helper functions for wave/current formatting with unit conversions
- New handler: `src/handlers/marineConditionsHandler.ts`
- Enhanced forecast handler with severe weather formatting
  - `formatSevereWeather()`: Extracts and formats gridpoint probabilities
  - `getMaxProbabilityFromSeries()`: Time-windowed probability analysis
- Comprehensive test coverage:
  - `tests/test_marine_conditions.ts`: 7 integration tests for marine weather
  - `tests/test_severe_weather.ts`: 5 integration tests for severe forecasts
  - `tests/test_noaa_gridpoint.ts`: Gridpoint API exploration
- Updated version to 0.6.0 across all service user-agents

### Documentation
- Updated tool descriptions with marine and severe weather capabilities
- Added semantic trigger phrases for AI tool selection:
  - Marine: "ocean conditions", "wave height", "surf conditions", "safe to boat"
  - Severe weather: "thunderstorm chance", "wind gusts", "tropical storm"
- Enhanced safety disclaimers for marine navigation
- Added interpretation guides for wave conditions and severe weather probabilities

## [0.5.0] - 2025-11-06

### Added

#### Air Quality Tool
- **NEW TOOL: `get_air_quality`** - Comprehensive air quality monitoring with global coverage
  - Air Quality Index (AQI) with automatic region detection:
    - US AQI for United States locations (0-500 scale)
    - European EAQI for international locations (0-100+ scale)
  - Health recommendations based on AQI levels:
    - Categorized as Good, Moderate, Unhealthy for Sensitive Groups, Unhealthy, Very Unhealthy, or Hazardous
    - Specific cautionary statements for sensitive populations
    - Activity recommendations based on air quality
  - Pollutant concentrations:
    - PM2.5 (Fine Particulate Matter)
    - PM10 (Coarse Particulate Matter)
    - Ozone (O₃)
    - Nitrogen Dioxide (NO₂)
    - Sulfur Dioxide (SO₂)
    - Carbon Monoxide (CO)
    - Ammonia (NH₃) when available
    - Aerosol Optical Depth (atmospheric haze indicator)
  - UV Index with protection recommendations:
    - Categorized as Low, Moderate, High, Very High, or Extreme
    - Specific sun protection guidance
    - Clear sky UV index comparison
  - Optional hourly air quality forecasts (5-day outlook)
  - Smart AQI display prioritizing relevant index for location
  - 1-hour cache for current conditions

#### Fire Weather Enhancement
- **Enhanced `get_current_conditions`** with optional fire weather data (US only)
  - New parameter: `include_fire_weather` (boolean, default: false)
  - Fire danger indices from NOAA gridpoint data:
    - **Haines Index** (2-6 scale): Atmospheric stability and dryness affecting fire growth potential
      - Categorized as Low, Moderate, High, or Very High
      - Detailed fire behavior implications
    - **Grassland Fire Danger Index** (1-4 scale): Fire risk in grassland/rangeland fuels
    - **Red Flag Threat Index** (0-100 scale): Likelihood of Red Flag Warning conditions
  - Smoke dispersion metrics:
    - **Mixing Height**: Vertical extent of atmospheric mixing (affects smoke dispersion)
    - **Transport Wind Speed**: Wind speed for smoke transport and fire spread
  - Color-coded risk levels (Green, Yellow, Orange, Red)
  - Graceful degradation when fire weather data unavailable
  - 2-hour cache for gridpoint data

### Technical Changes
- Added Open-Meteo Air Quality API integration
  - New service client for `air-quality-api.open-meteo.com`
  - Support for current and forecast air quality data
  - Comprehensive pollutant and AQI parameter requests
- Added NOAA gridpoint data API integration
  - New methods: `getGridpointData()` and `getGridpointDataByCoordinates()`
  - Access to 60+ gridpoint forecast variables
  - Fire weather indices extraction and formatting
- New utility modules:
  - `src/utils/airQuality.ts`: AQI interpretation and health recommendations
  - `src/utils/fireWeather.ts`: Fire danger index interpretation
- New type definitions:
  - `OpenMeteoAirQualityResponse` and related types
  - `GridpointResponse` and fire weather property types
- Comprehensive test coverage:
  - `tests/test_air_quality.ts`: 10 integration tests for air quality
  - `tests/test_fire_weather.ts`: 6 integration tests for fire weather
- Updated version to 0.5.0 across all service user-agents

### Documentation
- Updated tool descriptions with air quality and fire weather capabilities
- Enhanced semantic trigger phrases for AI tool selection
- Added health and safety use case documentation

## [0.4.0] - 2025-11-06

### Added
- **NEW TOOL: `search_location`** - Geocoding for natural language location queries
  - Convert location names to coordinates (e.g., "Paris", "Tokyo", "San Francisco, CA")
  - Returns multiple results with relevance ranking
  - Location metadata: timezone, elevation, population, country, administrative regions
  - Feature type classification (capital, city, airport, etc.)
  - 30-day cache for location searches
  - Enables conversational queries like "What's the weather in London?"

- **Enhanced `get_forecast`** - Global coverage and extended forecasts
  - NEW parameter: `source` - Manual data source selection
    - `"auto"` (default): Intelligent routing based on location
    - `"noaa"`: Force NOAA API (US only, more detailed)
    - `"openmeteo"`: Force Open-Meteo API (global)
  - Extended forecast range: Up to 16 days (was 7 days)
  - Global forecast support via Open-Meteo Forecast API
  - Automatic US location detection (Continental, Alaska, Hawaii, territories)
  - Sunrise/sunset times with daylight duration
  - UV index for international locations
  - Wind direction conversion (degrees to cardinal directions)
  - Unified response format across data sources

- Open-Meteo service expansion
  - Added Forecast API client (`getForecast()` method)
  - Added Geocoding API client (`searchLocation()` method)
  - Multiple Axios clients for different Open-Meteo endpoints
  - Proper error handling and caching per endpoint

### Technical Changes
- Comprehensive location metadata in geocoding responses
- Smart data source routing based on coordinates
- Extended daily forecast support (16 days maximum)
- 2-hour cache for forecast data
- 30-day cache for location searches
- New integration tests:
  - `tests/test_search_location.ts`: 8 tests
  - `tests/test_global_forecasts.ts`: 9 tests

### Fixed
- Improved forecast accuracy for international locations
- Better error messages for out-of-range forecast requests

## [0.3.0] - 2025-11-05

### Added
- **NEW TOOL: `get_alerts`** - Weather alerts, watches, and warnings (US only)
  - Active weather alerts from NOAA
  - Severity levels: Extreme, Severe, Moderate, Minor
  - Urgency and certainty indicators
  - Effective/expiration times and affected areas
  - Automatic sorting by severity (most severe first)
  - Detailed instructions and recommended responses
  - 5-minute cache TTL for timely alert updates

- **Enhanced `get_forecast`** - Hourly forecasts and precipitation probability
  - NEW parameter: `granularity` - Choose forecast detail level
    - `"daily"` (default): Day/night forecast periods
    - `"hourly"`: Hour-by-hour detailed forecasts (up to 156 hours)
  - NEW parameter: `include_precipitation_probability` (default: true)
    - Shows chance of precipitation for each period
    - Helps users plan around rain/snow
  - Temperature trends in hourly forecasts
  - Humidity display for comfort assessment

- **Enhanced `get_current_conditions`** - Comprehensive weather details
  - **Heat Index**: Automatically shown when temperature > 80°F
  - **Wind Chill**: Automatically shown when temperature < 50°F
  - **24-Hour Temperature Range**: High and low from last 24 hours
  - **Wind Gusts**: Shown when 20%+ higher than sustained wind
  - **Enhanced Visibility**: Descriptive categories (clear, haze, fog, dense fog)
  - **Detailed Cloud Cover**: Cloud types and heights (e.g., "Scattered clouds at 3,500 ft")
  - **Recent Precipitation History**: Last 1, 3, and 6 hours
  - Intelligent display thresholds via `DisplayThresholds` config

### Technical Changes
- New NOAA endpoints:
  - `/alerts/active` with coordinate-based filtering
- Forecast period parsing for hourly data
- Smart display logic based on weather conditions
- Configurable display thresholds in `src/config/displayThresholds.ts`
- Enhanced type definitions for alerts and detailed observations

### Documentation
- Updated README with v0.3.0 features
- Tool descriptions enhanced for better AI understanding
- Added safety and planning use cases

## [0.2.0] - 2025-11-04

### Added
- Historical weather data support
- NOAA observation stations integration
- Open-Meteo Historical Weather API integration
- Caching system with configurable TTL
- Error handling and retry logic

## [0.1.0] - 2025-11-03

### Added
- Initial release
- Basic forecast support (NOAA API)
- Current conditions support
- MCP server implementation
- Claude Code integration

[Unreleased]: https://github.com/dgahagan/weather-mcp/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/dgahagan/weather-mcp/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/dgahagan/weather-mcp/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/dgahagan/weather-mcp/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/dgahagan/weather-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dgahagan/weather-mcp/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/dgahagan/weather-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/dgahagan/weather-mcp/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/dgahagan/weather-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dgahagan/weather-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/dgahagan/weather-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/dgahagan/weather-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dgahagan/weather-mcp/releases/tag/v0.1.0
