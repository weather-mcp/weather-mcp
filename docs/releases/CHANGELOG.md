# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2025-11-10

### Added

#### 🌊 Safety & Hazards Monitoring

- **River Conditions** - NEW `get_river_conditions` MCP tool for flood monitoring
  - Monitor river levels and streamflow at NOAA/USGS gauges
  - Real-time flood stage assessment (action, minor, moderate, major flooding)
  - Search gauges by location with configurable radius (1-500 km, default 50 km)
  - Displays up to 5 nearest gauges with distance sorting
  - Data includes: current level, streamflow, flood stages, gauge status
  - Timezone-aware timestamps
  - 1-hour cache TTL
  - Uses NOAA National Water Prediction Service (NWPS) + USGS Water Services APIs
  - Coverage: United States only

- **Wildfire Information** - NEW `get_wildfire_info` MCP tool for wildfire tracking
  - Track active wildfires and prescribed burns
  - Real-time fire perimeter data from NIFC (National Interagency Fire Center)
  - Search fires by location with configurable radius (1-500 km, default 100 km)
  - 4-level proximity-based safety assessment:
    - ⚠️ EXTREME DANGER (< 5 km)
    - 🟠 HIGH ALERT (< 25 km)
    - 🟡 CAUTION (< 50 km)
    - 🔵 AWARENESS (< 100 km)
  - Fire details: name, type, size (acres), containment %, discovery date, incident URL
  - Distinction between wildfires and prescribed burns
  - Links to official incident management resources
  - 30-minute cache TTL
  - Uses NIFC ArcGIS REST API
  - Coverage: United States only

#### 🧪 Testing Enhancements

- **111 new comprehensive tests** added for release quality assurance:
  - `distance.test.ts`: 34 tests for Haversine distance calculations
  - `security-v1.6.test.ts`: 44 tests for security boundaries and resource limits
  - `geohash-neighbors.test.ts`: 33 tests for geohash neighbor API
  - Integration tests for river conditions (7 tests)
  - Integration tests for wildfire information (10 tests)
- **Total test count: 1,042 tests** (100% pass rate)
- Increased timeouts for NOAA API integration tests (30s → 60s)
- Enhanced security boundary testing:
  - MQTT buffer overflow protection (10,000 strike limit)
  - Geohash tile calculation safety limit (10,000 max)
  - Radius parameter clamping (1-500 km)
  - Bounding box validation

#### 📚 Code Quality & Documentation

- **Code Review Report**: A+ grade (97.5/100) - Zero critical/high issues
- **Security Audit Report**: A- grade (93/100) - Zero critical/high vulnerabilities
- **Publishing Workflow Improvements**:
  - Parallel execution support for code-reviewer and security-auditor agents
  - Explicit agent report management (delete/recreate behavior)
  - Detailed "Review and Fix Findings" workflow step
  - Agent configuration enhancements for output requirements

### Changed

- Tool configuration tests updated for 12 total MCP tools (was 10)
- Integration test robustness improved (less brittle assertions for changing NOAA data)
- Documentation version check script passes with all docs in sync

### Technical Details

- **New Services**: NIFCService for wildfire data, enhanced NOAAService for river gauges
- **New Utilities**: distance.ts for Haversine calculations
- **New Type Definitions**: NIFC API response types, USGS API types
- **API Integration**: NIFC ArcGIS REST API, NOAA NWPS API, USGS Water Services API
- **Zero new runtime dependencies** (excellent supply chain hygiene)

## [0.4.0] - 2025-11-06

### Added

#### 🌍 Global Weather Coverage
- **Location Search** - NEW `search_location` MCP tool for geocoding
  - Convert location names to coordinates ("Paris" → 48.8534°, 2.3488°)
  - Support for any location worldwide (cities, airports, landmarks, regions)
  - Returns multiple matches with detailed metadata
  - Metadata includes: coordinates, timezone, elevation, population, country, admin regions
  - Feature type classification (capital, city, airport, etc.)
  - 30-day cache TTL for location searches
  - Enables natural language queries: "What's the weather in Tokyo?"
  - Uses Open-Meteo Geocoding API (no API key required)

#### 🚀 Enhanced Global Forecasts
- **Global Forecast Coverage** - ENHANCED `get_forecast` tool now works worldwide
  - Automatic source selection: NOAA (US) or Open-Meteo (international)
  - NEW `source` parameter for manual override ("auto", "noaa", "openmeteo")
  - US locations: Uses NOAA API (more detailed with narratives)
  - International locations: Uses Open-Meteo Forecast API (reliable global data)
  - Intelligent location detection using bounding boxes (includes Alaska, Hawaii, territories)

- **Extended Forecasts** - Support for up to 16 days (was 7)
  - US NOAA: 1-7 days (detailed narratives)
  - Open-Meteo: 1-16 days (global coverage)
  - Maximum forecast days validation updated to 16
  - Backward compatible with existing 7-day default

- **Sunrise/Sunset Data** - NEW in daily forecasts
  - Sunrise and sunset times (with timezone awareness)
  - Daylight duration calculation (hours and minutes)
  - Sunshine duration (actual vs. possible daylight)
  - Automatically included in all Open-Meteo daily forecasts

- **UV Index** - NEW in international forecasts
  - Daily maximum UV index
  - Included in Open-Meteo forecast responses

#### 🔧 Service Layer Improvements
- **Open-Meteo Service Expansion**
  - Added forecast API client (`getForecast()` method)
  - Added geocoding API client (`searchLocation()` method)
  - Multiple Axios clients for different Open-Meteo endpoints
  - Proper error handling for each API type
  - Unified caching strategy across all Open-Meteo services

- **Forecast Handler Refactoring**
  - Dual-source support (NOAA and Open-Meteo)
  - Automatic source selection based on location
  - Separate formatting functions for each source
  - Wind direction conversion (degrees to cardinal)
  - Consistent output format across sources

#### 📝 Type Definitions
- NEW TypeScript types for Open-Meteo Forecast API
  - `OpenMeteoForecastResponse`
  - `OpenMeteoForecastHourlyData`
  - `OpenMeteoForecastDailyData`
  - `OpenMeteoForecastHourlyUnits`
  - `OpenMeteoForecastDailyUnits`
- NEW TypeScript types for Geocoding API
  - `GeocodingResponse`
  - `GeocodingLocation`

#### 🧪 Testing
- NEW integration test: `test_search_location.ts` (8 test cases)
  - Tests for major cities (Paris, Tokyo, London, New York)
  - Tests for edge cases (empty query, single character)
  - Multiple result handling
  - Error validation
- NEW integration test: `test_global_forecasts.ts` (9 test cases)
  - US vs. international source selection
  - Extended forecasts (10-day, 16-day)
  - Hourly forecasts (US and international)
  - Sunrise/sunset data verification
  - Manual source override testing
- Updated unit tests for 16-day forecast support
  - `validation.test.ts` updated to accept days 1-16
- All 247 automated tests passing

#### 📚 Documentation
- Updated README.md with v0.4.0 features
  - Global coverage highlighted in intro
  - New Features section with search_location and enhanced forecasts
  - Updated Finding Coordinates section to promote search_location
  - Updated Available Tools section with new/enhanced tools
  - Updated API Information with 3 Open-Meteo APIs
  - Updated Limitations to reflect global forecast support
  - International city coordinates added to reference table
- Caching section updated with location search TTL

### Changed
- **get_forecast tool** now supports global locations (was US-only)
  - Automatically selects best API based on coordinates
  - Extended maximum days from 7 to 16
  - Added sunrise/sunset times to output
  - Added UV index for international locations
- **FormatConstants.maxForecastDays** increased from 7 to 16
- Tool count increased from 5 to 6 tools (within roadmap target of 8-10)

### Technical Details
- **Token Efficiency**: ~200 tokens added (within v0.4.0 budget)
- **Backward Compatibility**: Maintained 100% (all existing queries work unchanged)
- **Geographic Coverage**: Now truly global for forecasts
- **API Integration**: 3 Open-Meteo APIs (Geocoding, Forecast, Historical)
- **Cache Strategy**: Smart TTLs for each data type (30d location, 2h forecast)
- **Test Coverage**: 247 tests (unit + integration)
- **Build Status**: Clean compilation, zero errors

### Roadmap Progress
v0.4.0 implementation complete as specified in ROADMAP.md:
- ✅ search_location tool (geocoding)
- ✅ Global forecast support (Open-Meteo integration)
- ✅ Extended forecasts (16 days)
- ✅ Sunrise/sunset data in forecasts
- ✅ Automatic source selection (NOAA vs Open-Meteo)
- ✅ Comprehensive testing
- ✅ Documentation updates

**Value Delivered**: Natural language location queries + global forecast coverage + extended forecasts
**Effort**: ~1.5 weeks as estimated
**Tools**: 6 total (was 5), on track for v1.0.0 target of 7-8 tools

## [0.1.0] - 2025-11-05

### Added

#### Core Features
- **Weather Forecasts** - 7-day forecasts for US locations via NOAA API
- **Current Conditions** - Real-time weather observations for US locations via NOAA API
- **Historical Weather Data** - Access to historical weather from 1940-present
  - Recent data (last 7 days): NOAA real-time API with hourly observations (US only)
  - Archival data (>7 days): Open-Meteo API with hourly/daily data (global coverage)

#### Enhanced Error Handling & Service Status
- **Service Status Checking** - New `check_service_status` MCP tool for proactive health monitoring
- **Enhanced Error Messages** - All errors include:
  - Clear problem descriptions
  - Contextual help specific to error type
  - Direct links to official status pages
  - Recommended actions for resolution
- **Service Status Methods** - Health check APIs for both NOAA and Open-Meteo services
- **Enhanced Tool Descriptions** - Guide AI clients on error handling and recovery strategies

#### Multi-Client Support
- Support for 8+ MCP clients: Claude Code, Claude Desktop, Cline, Cursor, Zed, VS Code (Copilot), LM Studio, Postman
- Comprehensive client setup documentation

#### API Integration
- NOAA Weather API integration (no API key required)
  - Forecasts endpoint
  - Current conditions endpoint
  - Historical observations (last 7 days)
- Open-Meteo Historical Weather API integration (no API key required)
  - Historical data from 1940 to 5 days ago
  - Hourly data for ranges up to 31 days
  - Daily summaries for longer periods
  - Global coverage

#### Tools
- `get_forecast` - Get weather forecasts for US locations
- `get_current_conditions` - Get current weather observations for US locations
- `get_historical_weather` - Get historical weather data (automatically selects NOAA or Open-Meteo based on date range)
- `check_service_status` - Check operational status of both weather APIs

#### Documentation
- Comprehensive README with installation and usage instructions
- CLIENT_SETUP.md with setup guides for 8 different MCP clients
- ERROR_HANDLING.md documenting enhanced error handling features
- MCP_BEST_PRACTICES.md guide for service status communication
- TESTING_GUIDE.md for manual testing procedures
- API research documentation (NOAA_API_RESEARCH.md)

#### Testing
- Service status checking tests
- MCP tool integration tests
- NOAA API connectivity tests

#### Developer Experience
- TypeScript implementation with full type definitions
- Modular architecture with separate service classes
- Unit conversion utilities (Celsius to Fahrenheit, etc.)
- Retry logic with exponential backoff
- Automatic service selection based on date range

### Infrastructure
- MIT License
- Node.js 18+ support
- No API keys or tokens required
- Public GitHub repository

### Status Page Links Integrated
- NOAA API: Planned outages, service notices, issue reporting
- Open-Meteo API: Production status, GitHub issues

## [0.3.0] - TBD

### Added

#### New Tools
- **Weather Alerts** - NEW `get_alerts` MCP tool for safety-critical weather information
  - Active watches, warnings, and advisories for US locations
  - Severity levels (Extreme, Severe, Moderate, Minor)
  - Urgency and certainty indicators
  - Effective and expiration times
  - Affected areas and event types
  - Instructions and recommended responses
  - Automatic sorting by severity
  - 5-minute cache TTL (alerts change rapidly)

#### Enhanced get_forecast Tool
- **Hourly Forecasts** - NEW `granularity` parameter
  - Options: "daily" (default) or "hourly"
  - Hourly provides up to 156 hours of detailed forecasts
  - Daily maintains backward compatibility
- **Precipitation Probability** - NEW `include_precipitation_probability` parameter
  - Shows chance of rain/snow for each period
  - Enabled by default
  - Available in both daily and hourly forecasts
- **Enhanced Output Formatting**
  - Temperature trends when available
  - Humidity display (especially in hourly forecasts)
  - Clear granularity indication in headers

#### Enhanced get_current_conditions Tool
- **Feels-Like Temperature** - Intelligent display of comfort indices
  - Heat Index shown when temperature >80°F
  - Wind Chill shown when temperature <50°F
  - Only displayed when significantly different from actual temperature
- **24-Hour Temperature Range** - Historical context
  - High temperature in last 24 hours
  - Low temperature in last 24 hours
  - Provides daily context for current conditions
- **Wind Gusts** - Enhanced wind information
  - Gust speed shown when 20%+ higher than sustained wind
  - Helps identify potentially hazardous conditions
- **Enhanced Visibility** - Descriptive categories
  - Dense fog (<0.25 mi)
  - Fog (0.25-1 mi)
  - Haze/mist (1-3 mi)
  - Clear (≥10 mi)
- **Cloud Cover Details** - Detailed sky conditions
  - Cloud layer heights in feet AGL
  - Descriptive categories (Few, Scattered, Broken, Overcast)
  - Multiple cloud layers displayed
- **Recent Precipitation** - Historical precipitation data
  - Last 1 hour accumulation
  - Last 3 hours accumulation
  - Last 6 hours accumulation
  - Displayed in inches

#### New Service Methods
- `NOAAService.getAlerts()` - Fetch weather alerts for coordinates
- `NOAAService.getHourlyForecastByCoordinates()` - Convenience method for hourly forecasts

#### Testing
- Comprehensive integration test suite for v0.3.0 features
- Individual feature tests for alerts, forecasts, and conditions
- Multi-location testing across different climates
- Test coverage for all enhanced display logic

### Changed
- Updated tool descriptions to reflect new capabilities
- Enhanced error messages for alerts endpoint
- Improved output formatting consistency across all tools
- Better handling of optional/missing data fields

### Infrastructure
- Added cache configuration for alerts (5-minute TTL)
- Extended TypeScript types for alert responses
- Improved null/undefined handling for optional fields

## [0.4.0] - 2025-11-06

### Security Improvements

#### Critical Security Fixes
- **Enhanced Input Validation** - Comprehensive NaN and Infinity checks for all coordinate inputs
  - Prevents edge case failures with invalid numeric values
  - Validates latitude (-90 to 90) and longitude (-180 to 180) ranges
  - Runtime type checking with `Number.isFinite()` validation
  - Applied to all service methods in NOAA and Open-Meteo services

#### Automated Security Monitoring
- **Dependency Scanning** - Integrated npm audit for continuous vulnerability monitoring
  - Added `npm run audit` and `npm run audit:fix` scripts
  - Configured GitHub Dependabot for automated dependency updates
  - Weekly security checks with automatic PR creation
  - Zero vulnerabilities detected in current dependencies
- **Security Policy** - Comprehensive SECURITY.md with vulnerability reporting process
  - Responsible disclosure guidelines
  - Response timeline commitments (48hr acknowledgment, 7-day assessment)
  - Security best practices for users
  - Supported versions and update policy

#### Error Handling Improvements
- **Custom Error Class Hierarchy** - Replaced generic errors with typed error classes
  - `RateLimitError` for 429 rate limit responses with retry guidance
  - `ServiceUnavailableError` for network/timeout failures with status page links
  - `InvalidLocationError` for invalid coordinates or parameters
  - `DataNotFoundError` for 404 responses (location outside coverage area)
  - `ApiError` base class with service attribution and help links
  - `ValidationError` for input validation failures
- **Error Sanitization** - Prevents information leakage in error messages
  - Network errors (ECONNREFUSED, ETIMEDOUT) sanitized to user-friendly messages
  - Stack traces properly handled and not exposed to users
  - Retryable errors clearly identified with `isRetryable` flag
- **Consistent Error Format** - All errors include contextual help and official status page links

### Reliability Improvements

#### Retry Logic Enhancement
- **Exponential Backoff with Jitter** - Prevents thundering herd during service recovery
  - 50-100% randomized jitter added to retry delays
  - Base delays: 1s, 2s, 4s for successive retries
  - Distributes retry attempts over time to reduce service load spikes
  - Applied to both NOAA and Open-Meteo service layers

### Testing Infrastructure

#### Comprehensive Test Suite Expansion
- **247 Total Tests** (up from 131, +89% increase)
  - Unit tests: 228 tests across 6 test files
  - Integration tests: 19 tests for error recovery scenarios
  - All tests passing with ~1 second execution time

#### New Test Coverage
- **Error Classes** - `tests/unit/errors.test.ts` (43 tests)
  - 100% coverage on custom error hierarchy
  - Tests for error message formatting, retryability, and inheritance
  - Validation of error sanitization functions
- **Cache Configuration** - `tests/unit/config.test.ts` (21 tests)
  - TTL strategy validation for different data types
  - Historical data aging logic tests
  - Environment variable parsing and bounds checking
- **Retry Logic** - `tests/unit/retry-logic.test.ts` (19 tests)
  - Mathematical validation of exponential backoff algorithm
  - Statistical distribution testing for jitter effectiveness
  - Boundary condition and overflow protection tests
- **Enhanced Units Tests** - `tests/unit/units.test.ts` (+33 tests, now 64 total)
  - 100% coverage on all formatting functions
  - Temperature, wind, visibility, pressure conversions
  - Date/time formatting with locale support
  - Cardinal direction mapping (16 directions)

#### Coverage Achievements
- **ApiError.ts**: 100% coverage (up from 0%)
- **units.ts**: 100% coverage (up from 19.6%)
- **cache.ts**: 100% coverage (maintained)
- **validation.ts**: 100% coverage (maintained)
- **Overall**: 54% statement coverage with 100% on critical utilities

### Documentation

#### Security Documentation
- **SECURITY.md** - Comprehensive security policy
  - Vulnerability reporting procedures
  - Response timeline commitments
  - Security best practices for users and developers
  - Dependencies security guidance
  - CI/CD security recommendations
- **Security Audit Report** - `SECURITY_AUDIT.md`
  - Overall security posture: B+ (Good)
  - Risk level: LOW
  - Zero critical or high-severity vulnerabilities
  - Detailed findings and recommendations

#### Code Quality Documentation
- **Code Review Report** - Updated `CODE_REVIEW.md`
  - All critical issues resolved
  - High and medium priority items completed
  - Comprehensive issue tracking with before/after analysis
  - Security and maintainability improvements documented

### Changed
- Updated service error handling to use custom error classes
- Enhanced coordinate validation in all API methods
- Improved retry logic with jitter for better failure recovery

### Infrastructure
- Added Dependabot configuration (`.github/dependabot.yml`)
- Integrated npm audit into development workflow
- Enhanced test infrastructure with vitest coverage reporting
- Added CI/CD readiness with fast, reliable test suite

### Developer Experience
- Improved error debugging with typed error classes
- Better test organization with logical grouping
- Comprehensive test coverage for critical code paths
- Clear security guidelines for contributors

---

## [Unreleased]

### Planned
- Location search by city name (geocoding)
- Global forecast support (via Open-Meteo)
- Extended forecast periods (up to 16 days)
- Air quality data
- Marine conditions
- Fire weather indices
- GitHub Actions for CI/CD
- Service integration tests (handlers and MCP lifecycle)

---

## Version History

- **[0.4.0]** - 2025-11-06 - Security & Quality Improvements (enhanced validation, error handling, testing)
- **[0.3.0]** - TBD - Enhanced Core Tools (alerts, hourly forecasts, enhanced conditions)
- **[0.2.0]** - 2025-11-05 - Added caching support
- **[0.1.0]** - 2025-11-05 - Initial public release

[0.4.0]: https://github.com/dgahagan/weather-mcp/releases/tag/v0.4.0
[0.3.0]: https://github.com/dgahagan/weather-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/dgahagan/weather-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/dgahagan/weather-mcp/releases/tag/v0.1.0
