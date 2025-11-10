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
│   └── wildfireHandler.ts
├── services/                # External API clients
│   ├── noaa.ts             # NOAA Weather API client
│   ├── openmeteo.ts        # Open-Meteo API client
│   ├── nifc.ts             # NIFC wildfire API client
│   └── usgs.ts             # USGS water services client
├── types/                   # TypeScript type definitions
│   ├── noaa.ts
│   └── openmeteo.ts
├── utils/                   # Shared utilities
│   ├── cache.ts            # LRU cache with TTL
│   ├── validation.ts       # Input validation
│   ├── units.ts            # Unit conversions
│   ├── logger.ts           # Structured logging
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

## Key Features (12 MCP Tools)

1. **get_forecast** - 7-day forecasts (NOAA/Open-Meteo, auto-select by location)
2. **get_current_conditions** - Current weather + fire weather indices (NOAA, US only)
3. **get_alerts** - Weather alerts/warnings (NOAA, US only)
4. **get_historical_weather** - Historical data 1940-present (Open-Meteo, global)
5. **check_service_status** - API health check (all services)
6. **search_location** - Location search/geocoding (Open-Meteo)
7. **get_air_quality** - Air quality index + pollutants (Open-Meteo, global)
8. **get_marine_conditions** - Wave height, swell, currents (Open-Meteo, global)
9. **get_weather_imagery** - Weather radar/precipitation imagery (RainViewer, global)
10. **get_lightning_activity** - Real-time lightning detection (Blitzortung.org, global)
11. **get_river_conditions** - River levels and flood monitoring (NOAA/USGS, US only)
12. **get_wildfire_info** - Active wildfire tracking (NIFC, US only)

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

- **Version:** 1.6.1
- **Status:** Production Ready ✅
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

- **Issues:** https://github.com/dgahagan/weather-mcp/issues
- **Discussions:** Use GitHub Discussions for questions
- **Security:** See SECURITY.md for vulnerability reporting

---

**Last Updated:** 2025-11-10 (v1.6.1 release)

This document should be updated whenever major architectural changes are made or new patterns are introduced.
