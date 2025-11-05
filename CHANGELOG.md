# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [Unreleased]

### Planned
- Automated testing suite
- GitHub Actions for CI/CD
- Additional weather data sources
- Extended forecast periods
- Weather alerts and warnings
- Location search by city name

---

## Version History

- **[0.1.0]** - 2025-11-05 - Initial public release

[0.1.0]: https://github.com/dgahagan/weather-mcp/releases/tag/v0.1.0
