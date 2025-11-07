# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/dgahagan/weather-mcp/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/dgahagan/weather-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dgahagan/weather-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/dgahagan/weather-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/dgahagan/weather-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dgahagan/weather-mcp/releases/tag/v0.1.0
