# CLAUDE.md - AI Assistant Guide for Weather MCP Server

This document provides context and guidelines for AI assistants (Claude, etc.) working with this codebase.

## Project Overview

**Weather MCP Server** is a Model Context Protocol (MCP) server providing weather data from NOAA and Open-Meteo APIs. It enables AI assistants to fetch real-time weather forecasts, current conditions, historical data, air quality, marine conditions, and severe weather alerts.

- **Language:** TypeScript (Node.js)
- **Version:** 1.12.0 (Production Ready)
- **License:** MIT
- **MCP SDK:** @modelcontextprotocol/sdk v1.21.0

## Architecture

### Core Components

```
src/
├── index.ts                 # MCP server entry point, tool registry
├── handlers/                # Tool request handlers (one per MCP tool)
│   ├── forecastHandler.ts
│   ├── currentConditionsHandler.ts
│   ├── alertsHandler.ts
│   ├── historicalWeatherHandler.ts
│   ├── statusHandler.ts
│   ├── locationHandler.ts
│   ├── airQualityHandler.ts
│   ├── marineConditionsHandler.ts
│   ├── riverConditionsHandler.ts
│   ├── wildfireHandler.ts
│   └── savedLocationsHandler.ts  # Saved locations management (v1.7.0)
├── services/                # External API clients
│   ├── noaa.ts             # NOAA Weather API client
│   ├── openmeteo.ts        # Open-Meteo API client
│   ├── nominatim.ts        # Nominatim/OSM geocoding client (v1.7.0)
│   ├── locationStore.ts    # Saved locations storage service (v1.7.0)
│   ├── nifc.ts             # NIFC wildfire API client
│   └── usgs.ts             # USGS water services client
├── types/                   # TypeScript type definitions
│   ├── noaa.ts
│   ├── openmeteo.ts
│   ├── nominatim.ts        # Nominatim API types (v1.7.0)
│   └── savedLocations.ts   # Saved locations types (v1.7.0)
├── utils/                   # Shared utilities
│   ├── cache.ts            # LRU cache with TTL
│   ├── validation.ts       # Input validation
│   ├── units.ts            # Unit conversions
│   ├── logger.ts           # Structured logging
│   ├── locationResolver.ts # Location name/coordinate resolution (v1.7.0)
│   ├── airQuality.ts       # AQI calculations
│   ├── marine.ts           # Wave/ocean utilities
│   ├── fireWeather.ts      # Fire weather indices
│   ├── distance.ts         # Haversine distance calculations
│   └── geohash.ts          # Geohash encoding/decoding
├── config/                  # Configuration
│   ├── cache.ts            # Cache TTL settings
│   └── displayThresholds.ts # Display logic constants
└── errors/                  # Custom error classes
    └── ApiError.ts
```

### Design Patterns

1. **Handler Pattern:** Each MCP tool has a dedicated handler function in `src/handlers/`
2. **Service Layer:** API clients are abstracted into service classes with retry logic
3. **Validation First:** All user inputs validated before processing (see `src/utils/validation.ts`)
4. **Caching Strategy:** LRU cache with TTL based on data volatility (see `src/config/cache.ts`)
5. **Error Hierarchy:** Custom error classes for different failure scenarios

## Key Features (17 MCP Tools)

All location-based tools accept coordinates, a saved `location_name`, or a
free-text `city_name` (geocoded on demand) — see [Currently Supported Tools](#currently-supported-tools).

1. **get_forecast** - 7-day forecasts (NOAA/Open-Meteo, auto-select by location); `detail` output control
2. **get_current_conditions** - Current weather (NOAA stations in the US, Open-Meteo model data elsewhere; auto-select via `source`); fire weather indices are US-only
3. **get_alerts** - Weather alerts/warnings (NOAA, US only); `detail` output control
4. **get_historical_weather** - Historical data 1940-present (Open-Meteo, global)
5. **get_weather_summary** - One-call overview: current + forecast + alerts (+ optional air quality, lightning) (NEW in v1.11.0)
6. **check_service_status** - API health check (all services)
7. **search_location** - Location search/geocoding (Nominatim/OSM, better small town coverage)
8. **get_air_quality** - Air quality index + pollutants (Open-Meteo, global)
9. **get_marine_conditions** - Wave height, swell, currents (Open-Meteo, global)
10. **get_weather_imagery** - Weather radar/precipitation imagery (RainViewer, global); `detail` controls URL vs embedded images
11. **get_lightning_activity** - Real-time lightning detection (Blitzortung.org, global)
12. **get_river_conditions** - River levels and flood monitoring (NOAA/USGS, US only)
13. **get_wildfire_info** - Active wildfire tracking (NIFC, US only)
14. **save_location** - Save frequently used locations with aliases (NEW in v1.7.0)
15. **list_saved_locations** - View all saved locations (NEW in v1.7.0)
16. **get_saved_location** - Get details for a saved location (NEW in v1.7.0)
17. **remove_saved_location** - Delete a saved location (NEW in v1.7.0)

## Development Guidelines

### Code Style

- **TypeScript Strict Mode:** All strict flags enabled (see `tsconfig.json`)
- **No `any` types:** Use proper typing or `unknown` with validation
- **Explicit returns:** All functions must return on all code paths
- **No unused variables:** Compiler enforces `noUnusedLocals` and `noUnusedParameters`

### Adding New Features

1. **Types First:** Define TypeScript interfaces in `src/types/`
2. **Validation:** Add validators to `src/utils/validation.ts`
3. **Handler:** Create handler in `src/handlers/` following existing patterns
4. **Service (if needed):** Add API methods to `src/services/noaa.ts` or `openmeteo.ts`
5. **Tool Registration:** Register in `src/index.ts` (ListToolsRequestSchema and CallToolRequestSchema)
6. **Tests:** Write comprehensive tests (see Testing section below)
7. **Documentation:** Update README.md, CHANGELOG.md

### Error Handling

Always use custom error classes from `src/errors/ApiError.ts`:

```typescript
import { InvalidLocationError, RateLimitError, ServiceUnavailableError } from '../errors/ApiError.js';

// Bad
throw new Error('Invalid coordinates');

// Good
throw new InvalidLocationError('NOAA', 'Coordinates outside US coverage');
```

**Security:** All errors are sanitized via `formatErrorForUser()` before returning to users.

### Logging

Use structured logging from `src/utils/logger.ts`:

```typescript
import { logger } from '../utils/logger.js';

// Security events
logger.warn('Rate limit exceeded', {
  service: 'NOAA',
  securityEvent: true
});

// General logging
logger.info('Cache hit', { key: cacheKey });
logger.error('API request failed', { error: err.message });
```

**Important:** All logs go to `stderr` (MCP protocol requirement). Never log to `stdout`.

## Testing

### Test Structure

```
tests/
├── unit/                    # Unit tests (fast, no I/O)
│   ├── cache.test.ts       # Cache functionality
│   ├── validation.test.ts  # Input validation
│   ├── units.test.ts       # Unit conversions
│   ├── errors.test.ts      # Error classes
│   ├── config.test.ts      # Configuration
│   ├── retry-logic.test.ts # Backoff algorithms
│   ├── security.test.ts    # Security validation
│   ├── bounds-checking.test.ts  # Array bounds
│   ├── alert-sorting.test.ts    # Performance optimizations
│   ├── distance.test.ts    # Haversine distance calculations
│   ├── security-v1.6.test.ts    # v1.6.0 security boundaries
│   └── geohash-neighbors.test.ts # Geohash neighbor API
└── integration/             # Integration tests (with API calls)
    ├── error-recovery.test.ts
    └── safety-hazards.test.ts   # River and wildfire features
```

### Testing Requirements

- **Framework:** Vitest (configured in `package.json`)
- **Coverage Target:** 100% on critical utilities (cache, validation, units, errors)
- **Performance:** All tests must complete in < 2 seconds
- **No Flakiness:** Tests must be deterministic

### Running Tests

```bash
npm test                    # Run all tests
npm run test:watch         # Watch mode
npm run test:coverage      # With coverage report
```

### Writing Tests

Follow existing patterns in `tests/unit/`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('FeatureName', () => {
  beforeEach(() => {
    // Setup
  });

  it('should handle normal case', () => {
    // Arrange
    const input = 'test';

    // Act
    const result = myFunction(input);

    // Assert
    expect(result).toBe('expected');
  });

  it('should handle edge case', () => {
    // Test edge cases, nulls, empty values, boundaries
  });
});
```

## Security Considerations

### Input Validation

**All user inputs must be validated** using functions from `src/utils/validation.ts`:

```typescript
import { validateLatitude, validateLongitude } from '../utils/validation.js';

// Always validate coordinates
validateLatitude(latitude);   // Throws if invalid
validateLongitude(longitude);
```

### Security Event Logging

Log security-relevant events with `securityEvent: true`:

```typescript
logger.warn('Invalid request parameters', {
  service: 'NOAA',
  status: 400,
  securityEvent: true  // Enables security monitoring
});
```

### Bounds Checking

**Defense-in-depth:** Limit array processing to prevent resource exhaustion:

```typescript
// Example from forecastHandler.ts
if (series.values.length > maxEntries) {
  logger.warn('Gridpoint series exceeds max entries', {
    length: series.values.length,
    maxEntries,
    securityEvent: true
  });
  series.values = series.values.slice(0, maxEntries);
}
```

### No Hardcoded Secrets

- No API keys required (all APIs are public)
- Use environment variables for configuration
- Never commit `.env` files

## Configuration

### Environment Variables

```bash
# Cache Configuration
CACHE_ENABLED=true              # Enable/disable caching (default: true)
CACHE_MAX_SIZE=1000            # Max cache entries (100-10000, default: 1000)

# API Configuration
API_TIMEOUT_MS=30000           # API timeout in milliseconds (5000-120000, default: 30000)

# Lightning
WEATHER_LIGHTNING_PREWARM=true # Subscribe saved locations at startup so lightning
                               # coverage accumulates before the first query (default: true).
                               # Set false to skip the startup MQTT connection. No effect
                               # when get_lightning_activity is disabled.

# Units / Localization (v1.10.0)
WEATHER_UNITS=imperial         # imperial | metric (default: imperial)
# Optional per-unit overrides (follow WEATHER_UNITS if unset):
#   WEATHER_TEMPERATURE_UNIT (F|C), WEATHER_WIND_SPEED_UNIT (mph|kmh|ms|kn),
#   WEATHER_PRECIPITATION_UNIT (inch|mm), WEATHER_PRESSURE_UNIT (inHg|hPa),
#   WEATHER_DISTANCE_UNIT (mi|km), WEATHER_TIME_FORMAT (12h|24h)

# Logging
LOG_LEVEL=1                    # 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR (default: 1)
```

Cache/API/logging variables are validated in `src/config/cache.ts`; unit variables
are parsed and validated in `src/config/units.ts`. Per-call unit parameters are
resolved by `src/utils/unitPreferences.ts` and formatted via `src/utils/unitFormat.ts`.

## Caching Strategy

### TTL Values (defined in `src/config/cache.ts`)

- **Grid coordinates:** Infinity (never change)
- **Weather stations:** 24 hours (rarely change)
- **Forecasts:** 2 hours (updated hourly)
- **Current conditions:** 15 minutes (update frequency)
- **Alerts:** 5 minutes (can change rapidly)
- **Historical data (>1 day old):** Infinity (finalized)
- **Recent historical (<1 day):** 1 hour (may be corrected)

### Cache Implementation

- **Algorithm:** LRU (Least Recently Used) eviction
- **Size limits:** Configurable max size (default 1000 entries)
- **Automatic cleanup:** Every 5 minutes
- **Graceful shutdown:** Cleanup on SIGTERM/SIGINT

## Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: Add new feature
fix: Bug fix
perf: Performance improvement
refactor: Code refactoring
test: Add/update tests
docs: Documentation changes
chore: Tooling, dependencies, etc.
security: Security improvements
```

### Commit Message Format

```
<type>: <short description>

<detailed description>

**Changes:**
- Bullet point list of changes
- Implementation details

**Benefits:**
- Why this change was made
- What problems it solves

Addresses <issue/doc reference>.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Saved Locations Feature (v1.7.0)

### Overview

The saved locations feature allows users to save frequently used locations with simple aliases (e.g., "home", "work", "cabin") and reference them by name instead of coordinates in weather tools.

### Architecture

**Components:**
- `LocationStore` service - Manages persistent storage of locations in JSON file
- `locationResolver` utility - Resolves `location_name` or coordinates to lat/long
- `savedLocationsHandler` - Handlers for save/list/get/remove operations
- Storage location: `~/.weather-mcp/locations.json`

**Data Flow:**
1. User saves location → `save_location` tool → Nominatim geocoding (if query provided) → LocationStore → JSON file
2. User queries weather → `location_name` parameter → locationResolver → coordinates → weather API

### Using Location Names in Tools

To add `location_name` support to a weather tool:

```typescript
// 1. Add location_name to Args interface
interface YourToolArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;  // Add this
  // ... other parameters
}

// 2. Import dependencies
import { LocationStore } from '../services/locationStore.js';
import { resolveLocation } from '../utils/locationResolver.js';

// 3. Update function signature
export async function handleYourTool(
  args: unknown,
  // ... other services
  locationStore: LocationStore  // Add this
): Promise<...> {
  // 4. Resolve location
  const { latitude, longitude } = resolveLocation(args as YourToolArgs, locationStore);

  // 5. Use coordinates as normal
  // ... rest of handler logic
}

// 6. Update tool registration in index.ts
case 'your_tool':
  return await withAnalytics('your_tool', async () =>
    handleYourTool(args, otherServices, locationStore)  // Pass locationStore
  );

// 7. Update tool schema in index.ts
your_tool: {
  inputSchema: {
    properties: {
      latitude: {
        description: 'Latitude. Not required if location_name provided.',
        // ... other props
      },
      longitude: {
        description: 'Longitude. Not required if location_name provided.',
        // ... other props
      },
      location_name: {
        type: 'string',
        description: 'Name of saved location (e.g., "home"). Use instead of coordinates.'
      }
    },
    required: []  // Change from ['latitude', 'longitude']
  }
}
```

### Storage Format

`~/.weather-mcp/locations.json`:
```json
{
  "home": {
    "name": "Seattle, WA",
    "latitude": 47.6062,
    "longitude": -122.3321,
    "timezone": "America/Los_Angeles",
    "country_code": "US",
    "admin1": "Washington",
    "saved_at": "2025-01-15T10:30:00.000Z",
    "updated_at": "2025-01-15T10:30:00.000Z"
  },
  "cabin": {
    "name": "Lake Tahoe, CA",
    "latitude": 39.0968,
    "longitude": -120.0324,
    "timezone": "America/Los_Angeles",
    "country_code": "US",
    "admin1": "California",
    "activities": ["boating", "fishing", "hiking"],
    "saved_at": "2025-01-15T11:00:00.000Z",
    "updated_at": "2025-01-15T11:00:00.000Z"
  }
}
```

### Implementation Notes

- **Aliases are normalized**: Always lowercased and trimmed for consistency
- **Max alias length**: 50 characters
- **Validation**: Coordinates validated on save
- **Geocoding**: Uses Nominatim service (rate-limited to 1 req/sec)
- **Error handling**: Helpful messages if location not found or invalid
- **Thread-safe**: LocationStore uses synchronous file I/O with cache invalidation
- **Activities (optional)**:
  - Array of activity strings (e.g., ["boating", "fishing", "hiking"])
  - Normalized to lowercase and trimmed
  - Max 50 characters per activity
  - Helps AI provide contextually relevant weather information
  - Empty/whitespace-only activities are filtered out
- **Smart Updates**:
  - If alias exists AND no location details provided, only update specified fields
  - Allows updating name/activities without re-specifying coordinates
  - Example: `save_location(alias="cabin", activities=["boating", "fishing"])` updates activities while preserving all location data
  - New locations still require location_query or lat/long

### Currently Supported Tools

As of v1.11.0, **every location-based weather tool** accepts `location_name`
(saved) and `city_name` (geocoded on demand) in addition to `latitude`/`longitude`,
via the shared `resolveLocationAsync` helper and the `LOCATION_SCHEMA_PROPERTIES`
schema fragment in `src/index.ts`. Name-based lookups echo the resolved place in a
`**Location:**` header (see `formatLocationLine`/`prependLocationLine` in
`src/utils/locationResolver.ts`):

- ✅ `get_forecast`, `get_current_conditions`, `get_alerts`, `get_historical_weather`
- ✅ `get_air_quality`, `get_marine_conditions`, `get_weather_imagery`
- ✅ `get_lightning_activity`, `get_river_conditions`, `get_wildfire_info`
- ✅ `get_weather_summary` (composite; resolves once, fans out to the above)

## Common Tasks

### Adding a New MCP Tool

1. Create handler: `src/handlers/newFeatureHandler.ts`
2. Define types: `src/types/noaa.ts` or `openmeteo.ts`
3. Add service method if needed: `src/services/`
4. Register tool in `src/index.ts`:
   - Add to `ListToolsRequestSchema` handler
   - Add case to `CallToolRequestSchema` handler
5. Write tests: `tests/unit/` and `tests/integration/`
6. Update documentation: README.md, CHANGELOG.md

### Adding External API Integration

1. Create type definitions in `src/types/`
2. Add client methods to existing service or create new service class
3. Implement retry logic with exponential backoff
4. Add error handling using custom error classes
5. Add caching with appropriate TTL
6. Write integration tests with mocked responses

### Debugging

```bash
# Run in development mode
npm run dev

# Enable debug logging
LOG_LEVEL=0 npm run dev

# Run specific test
npx vitest run tests/unit/cache.test.ts

# Build and check for errors
npm run build
```

## Code Quality Standards

### Must Pass Before Commit

```bash
npm run build          # TypeScript compilation (0 errors)
npm test              # All tests passing (100%)
npm audit             # No critical vulnerabilities
```

### Code Review Checklist

- [ ] TypeScript strict mode compliance
- [ ] Input validation on all user-facing functions
- [ ] Error handling with custom error classes
- [ ] Security event logging where appropriate
- [ ] Tests for new functionality (unit + integration)
- [ ] Documentation updated (inline comments + README)
- [ ] No console.log (use logger instead)
- [ ] No hardcoded values (use config/)

## Project Status

- **Version:** 1.12.0
- **Status:** Production Ready ✅
- **Unreleased (next minor):** Max-range expansion — `get_air_quality` and `get_marine_conditions` gain `forecast_days` (1-7 and 1-16 respectively, day-grouped/null-trimmed full-range output), the historical hourly `limit` ceiling rises to 744 (the full 31-day hourly window; hourly-only semantics documented), `get_weather_imagery` `detail="full"` lists every animation frame, and RainViewer nowcast frames are appended defensively when the feed provides them. Output completeness — AQI forecast day headers add peak UV (hourly fetch trimmed to 3 variables); `detail="full"` on river/wildfire/lightning lifts display caps to 25 with disclosed remainders; wildfire surfaces the ArcGIS truncation caveat; river gauges show an observed rise/fall trend (NWPS stageflow, rate-limit tolerant) plus a multi-point forecast series at `full`; NWPS placeholder observed statuses are suppressed; river footer credits NWPS alone
- **New in v1.12.0:** Global `get_current_conditions` — NOAA station observations in the US (unchanged), Open-Meteo model data elsewhere, auto-selected by the shared `isInUS` helper and overridable with a `source` parameter (`auto`/`noaa`/`openmeteo`). When NOAA rejects an auto-routed point (the US routing boxes overrun the border — Toronto, Vancouver), `get_current_conditions`, `get_forecast`, and `get_historical_weather` fall back to Open-Meteo with a note instead of erroring. `get_historical_weather` also routes recent dates (last 7 days) to NOAA only for US coordinates — international recent dates use the Open-Meteo archive directly. Fixes the `current` section of `get_weather_summary` outside the US. Fire weather indices remain US-only; `get_alerts`, rivers, and wildfire are still US-only (non-US summaries note this cleanly instead of surfacing a NOAA error).
- **New in v1.11.1:** Geocoding fix — `city_name`/`search_location` lookups no longer fail at low result limits (RFC 3986 `%20` encoding + result floor); river forecast no longer prints NWPS `-999`/year-0001 placeholder sentinels; lightning monitoring is pre-warmed for saved locations at startup (`WEATHER_LIGHTNING_PREWARM`)
- **New in v1.11.0:** Universal location resolution (`location_name`/`city_name` on every location-based tool), `get_weather_summary` composite tool, `detail` output control (forecast/alerts/imagery), and a "summary-first" 6-tool default `basic` preset led by `get_weather_summary` (history, air quality, saved-location CRUD, and specialized tools live in `standard`/`full`)
- **New in v1.10.0:** Unit localization — imperial/metric (plus per-unit overrides and 12h/24h) via `WEATHER_UNITS` env or a per-call `units` parameter on forecast/current/historical tools
- **New in v1.9.0:** `city_name` parameter for `get_forecast` — request a forecast by free-text place name (geocoded on demand, with caching)
- **Security Rating:** A- (Excellent, 93/100)
- **Test Coverage:** 1,208 tests, 100% pass rate
- **Code Quality:** A+ (Excellent, 97.5/100)

## Useful References

- **MCP Specification:** https://spec.modelcontextprotocol.io/
- **NOAA API Docs:** https://www.weather.gov/documentation/services-web-api
- **Open-Meteo Docs:** https://open-meteo.com/en/docs
- **Project Docs:**
  - `README.md` - User-facing documentation
  - `CHANGELOG.md` - Version history
  - `docs/development/CODE_REVIEW.md` - Code quality assessment
  - `docs/development/SECURITY_AUDIT.md` - Security analysis
  - `TEST_COVERAGE_REPORT_V1.0.md` - Test coverage details

## Getting Help

- **Issues:** https://github.com/weather-mcp/weather-mcp/issues
- **Discussions:** Use GitHub Discussions for questions
- **Security:** See SECURITY.md for vulnerability reporting

---

**Last Updated:** 2026-07-15 (v1.12.0)

This document should be updated whenever major architectural changes are made or new patterns are introduced.
