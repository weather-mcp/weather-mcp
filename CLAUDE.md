# CLAUDE.md - AI Assistant Guide for Weather MCP Server

This document provides context and guidelines for AI assistants (Claude, etc.) working with this codebase.

## Project Overview

**Weather MCP Server** is a Model Context Protocol (MCP) server providing weather data from NOAA and Open-Meteo APIs. It enables AI assistants to fetch real-time weather forecasts, current conditions, historical data, air quality, marine conditions, and severe weather alerts.

- **Language:** TypeScript (Node.js)
- **Version:** 1.6.1 (Production Ready)
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

## Key Features (16 MCP Tools)

1. **get_forecast** - 7-day forecasts (NOAA/Open-Meteo, auto-select by location) - Now supports saved locations via `location_name`
2. **get_current_conditions** - Current weather + fire weather indices (NOAA, US only)
3. **get_alerts** - Weather alerts/warnings (NOAA, US only)
4. **get_historical_weather** - Historical data 1940-present (Open-Meteo, global)
5. **check_service_status** - API health check (all services)
6. **search_location** - Location search/geocoding (Nominatim/OSM, better small town coverage)
7. **get_air_quality** - Air quality index + pollutants (Open-Meteo, global)
8. **get_marine_conditions** - Wave height, swell, currents (Open-Meteo, global)
9. **get_weather_imagery** - Weather radar/precipitation imagery (RainViewer, global)
10. **get_lightning_activity** - Real-time lightning detection (Blitzortung.org, global)
11. **get_river_conditions** - River levels and flood monitoring (NOAA/USGS, US only)
12. **get_wildfire_info** - Active wildfire tracking (NIFC, US only)
13. **save_location** - Save frequently used locations with aliases (NEW in v1.7.0)
14. **list_saved_locations** - View all saved locations (NEW in v1.7.0)
15. **get_saved_location** - Get details for a saved location (NEW in v1.7.0)
16. **remove_saved_location** - Delete a saved location (NEW in v1.7.0)

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

# Logging
LOG_LEVEL=1                    # 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR (default: 1)
```

All environment variables are validated with bounds checking in `src/config/cache.ts`.

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

- ✅ `get_forecast` - Full support for `location_name`

**Coming Soon:**
- `get_current_conditions`
- `get_alerts`
- `get_air_quality`
- `get_marine_conditions`
- All other weather tools

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

- **Version:** 1.7.0
- **Status:** Production Ready ✅
- **New in v1.7.0:** Saved locations feature + improved geocoding (Nominatim/OSM)
- **Security Rating:** A- (Excellent, 93/100)
- **Test Coverage:** 1,042 tests, 100% pass rate
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

**Last Updated:** 2025-11-16 (v1.7.0 - saved locations with activities + Nominatim geocoding)

This document should be updated whenever major architectural changes are made or new patterns are introduced.
