# CLAUDE.md - AI Assistant Guide for Weather MCP Server

This document provides context and guidelines for AI assistants (Claude, etc.) working with this codebase.

## Project Overview

**Weather MCP Server** is a Model Context Protocol (MCP) server providing weather data from NOAA and Open-Meteo APIs. It enables AI assistants to fetch real-time weather forecasts, current conditions, historical data, air quality, marine conditions, and severe weather alerts.

- **Language:** TypeScript (Node.js)
- **Version:** 1.19.0 (Production Ready)
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
│   ├── nominatim.ts        # Nominatim/OSM geocoding client (v1.7.0); country-level reverseCountry lookup (v1.19.0)
│   ├── meteoalarm.ts       # EUMETNET MeteoAlarm country warning feeds — European alerts (v1.19.0)
│   ├── geomet.ts           # MSC GeoMet weather-alerts client — Canadian alerts (v1.19.0)
│   ├── locationStore.ts    # Saved locations storage service (v1.7.0)
│   ├── basemap.ts          # NASA GIBS base-map tile fetch + stitch (composited radar)
│   ├── nifc.ts             # NIFC wildfire API client (US incidents)
│   ├── firms.ts            # NASA FIRMS satellite fire detections — global wildfire (v1.20.0)
│   ├── acis.ts             # RCC ACIS client — US daily temperature records (v1.16.0)
│   ├── aviationWeather.ts  # aviationweather.gov METAR client — worldwide station obs (v1.17.0)
│   └── usgs.ts             # USGS water services client
├── types/                   # TypeScript type definitions
│   ├── noaa.ts
│   ├── openmeteo.ts
│   ├── aviationWeather.ts  # METAR observation shape (v1.17.0)
│   ├── nominatim.ts        # Nominatim API types (v1.7.0)
│   ├── firms.ts            # FIRMS detection/cluster/region shapes (v1.20.0)
│   └── savedLocations.ts   # Saved locations types (v1.7.0)
├── utils/                   # Shared utilities
│   ├── cache.ts            # LRU cache with TTL
│   ├── validation.ts       # Input validation
│   ├── units.ts            # Unit conversions
│   ├── logger.ts           # Structured logging
│   ├── locationResolver.ts # Location name/coordinate resolution (v1.7.0)
│   ├── astronomy.ts        # Moon phase, rise/set, twilight — pure local math (v1.16.0)
│   ├── firmsHotspots.ts    # FIRMS CSV parsing, region picker, clustering — pure, no I/O (v1.20.0)
│   ├── records.ts          # US record high/low line orchestration (v1.16.0)
│   ├── metarStation.ts     # METAR station picker + field parsers — pure, no I/O (v1.17.0)
│   ├── composite.ts        # PNG stitch/blend/marker/encode — pure, no I/O
│   ├── airQuality.ts       # AQI calculations
│   ├── marine.ts           # Wave/ocean utilities
│   ├── fireWeather.ts      # NOAA index interpretation + computed Fosberg FFWI (v1.20.0)
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
2. **get_current_conditions** - Current weather (NOAA stations in the US, Open-Meteo model data elsewhere, or worldwide METAR airport observations via `source="metar"`; auto-select via `source`); `include_fire_weather` gives NOAA's published indices in the US and a server-computed Fosberg index with dryness context on the Open-Meteo path (v1.20.0) — not available on the METAR source
3. **get_alerts** - Weather alerts/warnings, routed by country: NOAA (US), MSC GeoMet/ECCC (Canada), EUMETNET MeteoAlarm national warnings (38 European countries, matched at country level); elsewhere a clean not-covered message; `detail` output control
4. **get_historical_weather** - Historical data 1940-present (Open-Meteo, global)
5. **get_weather_summary** - One-call overview: current + forecast + alerts (+ optional air quality, lightning) (NEW in v1.11.0)
6. **check_service_status** - API health check (all services)
7. **search_location** - Location search/geocoding (Nominatim/OSM, better small town coverage)
8. **get_air_quality** - Air quality index + pollutants (Open-Meteo, global)
9. **get_marine_conditions** - Wave height, swell, currents (Open-Meteo, global)
10. **get_weather_imagery** - Weather radar/precipitation imagery (RainViewer, global); `detail` controls URL vs embedded images; `composite: true` returns a finished radar map over a NASA GIBS base map as an MCP image content block (radar/precipitation only, latest frame only)
11. **get_lightning_activity** - Real-time lightning detection (Blitzortung.org, global)
12. **get_river_conditions** - River levels and flood monitoring (NOAA NWPS gauges in the US, Open-Meteo Flood/GloFAS modeled discharge elsewhere; auto-select via `source`)
13. **get_wildfire_info** - Active wildfire tracking, routed by country: NIFC named incidents in the US, NASA FIRMS satellite heat detections elsewhere (v1.20.0); `source` override, no cross-fallback
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

- **Version:** 1.19.0 — international weather alerts (MeteoAlarm + MSC GeoMet) and composited radar maps. (The v1.15–v1.17 content further below was developed against internal version targets and first shipped in the v1.18.0 consolidated release.)
- **Status:** Production Ready ✅
- **New in v1.20.0 (unreleased, on `feat/global-fire-weather`, forked off `feat/global-wildfire`):** Global **fire weather** — `include_fire_weather` on `get_current_conditions` computes a **Fosberg Fire Weather Index** on the Open-Meteo path (non-US via `auto`, anywhere via `source: "openmeteo"`), per `docs/plans/global-fire-weather-plan.md` (D1–D7). **Corrected premise:** `src/utils/fireWeather.ts` had no formulas to reuse — it *interprets* five series NOAA pre-computes on the gridpoint API — so the global path computes the index in-house from current temperature/RH/sustained wind, the three inputs verified non-null worldwide. D2 appends four pure functions to that zero-import module (`calculateFosbergIndex` — three-branch EMC piecewise, η damping clamped ≥ 0, clamped 0–100, `NaN` on any non-finite input; `getFosbergCategory`; `describeVpd`; `describeTopsoilMoisture`), with the bands disclosed as project heuristics. D3 gives `OpenMeteoService.getCurrentConditions` an **optional trailing** `includeFireWeather` flag that appends `soil_moisture_0_to_1cm,vapour_pressure_deficit` to the `current=` list and keys the cache, so a no-flag request URL is byte-identical to before. **D4 is the verified gotcha:** the response carries the *caller's* units (`openMeteoUnitParams`), so temperature/wind normalize back to fixed °F/mph in the handler (`knotsToMph` added to `units.ts`) — no second fetch, and the index is identical in metric and imperial (live-verified in Milan). D5/D6 render the section — emoji/level line mirroring the NOAA block, computed-from sentence, optional `**Dryness context:**` lines, and the derivation disclosure ("*not an official fire-danger rating*") — and **never call `getFireWeatherContext`**, whose US geography boxes and northern-hemisphere seasonality would be wrong outside the US; the index is hemisphere-proof by construction. Null dryness drops its line (open ocean: HTTP 200 with nulls, Flood-API precedent), a missing core input renders `⚠️ Fire weather inputs unavailable…`, and NaN never reaches output. The US NOAA path is byte-for-byte unchanged (locked by `tests/unit/fireWeatherContext.test.ts` unedited, verified against the branch base with and without the flag), as is the METAR note (`metar-handler.test.ts` unedited). Descoped: global Haines via pressure levels, METAR-path Fosberg.
- **New in v1.20.0 (unreleased, on `feat/global-wildfire`):** Global `get_wildfire_info` — routed by country like alerts (`src/handlers/wildfireHandler.ts`): US → NIFC byte-identical (locked by `tests/unit/wildfire-handler.test.ts` unedited), elsewhere → **NASA FIRMS** VIIRS satellite heat detections, per `docs/plans/global-wildfire-plan.md` (D1–D8). **Keyless-first**: with no key the tool fetches FIRMS' keyless 24 h regional flat CSVs (conservative inset region picker in `src/utils/firmsHotspots.ts` — the US–Canada border band and Middle East gap deliberately fall to the ~10 MB `Global` file; parsed rows cached per region, 30 min); the optional free `FIRMS_MAP_KEY` (`src/config/api.ts`, NCEI shape) upgrades to Area-API bbox queries with `day_range` 1–5. **The Area API counts calendar UTC days while the flat files are rolling 24 h** (live-verified — a midday day-1 query missed yesterday evening's fires), so the keyed path requests one extra day (capped at the API max of 5) and filters to the true rolling window. A rejected key (`FIRMSKeyRejectedError`, fixed sanitized message) falls back keyless with a note; the key lives in the URL, so `src/services/firms.ts` never logs/throws URLs and every error is a fixed pre-written string (key-hygiene unit-tested). FIRMS returns *hotspots, not incidents* — no names/acreage/containment — so D5 clusters them (greedy FRP-descending, 2 km, deterministic; pure module, no I/O) and frames honestly: header disclosure (industrial heat/gas flares/agricultural burns), per-cluster count/distance/bearing/peak-FRP/age/day-night/confidence/satellite, not-all-clear caveat on empty results, NIFC distance tiers on the nearest cluster with **no containment logic**. `source` (`auto`/`nifc`/`firms`) with no cross-fallback (rivers doctrine); `firms` works in the US (pre-WFIGS signal). Both live CSV shapes (Area 14-col `l/n/h`/unpadded, flat 13-col spelled-out/zero-padded) parsed by header name, never position. 5,000-row cap with `securityEvent` warn + caveat. Wildfire was the last US-only safety tool.
- **New in v1.19.0 (composited imagery):** `composite: true` on `get_weather_imagery` returns a finished picture — the RainViewer overlay rendered onto a NASA GIBS base map with a location crosshair — as an MCP image content block alongside the text (`[text, image]`), per `docs/plans/composited-imagery-plan.md` (D1–D7 settled and upstream-verified). Two new modules: `src/utils/composite.ts` (pure stitch/blend/marker/encode, ported from `scripts/capture-examples.mjs`) and `src/services/basemap.ts` (GIBS fetch + stitch). **GIBS tile matrix sets are layer-specific** — `OSM_Land_Water_Map` needs `GoogleMapsCompatible_Level9` and `Reference_Features_15m` needs `Level13`; the GeoColor `Level7` constant in `gibs.ts` returns HTTP 400 for them, so each layer carries its own. Composites are **centered on the requested coordinates**, not tile-aligned (live testing found a location landing 36px from its own map's edge). Everything works in one shared global pixel space — RainViewer's 512px tiles at zoom z and the GIBS 256px tiles at zoom z+1 are the same grid, `512 * 2^z` px across — so `latLonToGlobalPixel` → `centeredWindowOrigin` → `planTileWindow` picks the covering tiles (2×2–3×3 per base layer, 1–4 radar), `assembleTiles` stitches them and `cropTo` cuts the window. Columns wrap at the antimeridian; rows clamp at the poles (marker goes off-center there, correctly). `assembleTiles` **preserves alpha** because the features layer is transparent — opacity-forcing is the separate `flattenOpaque`, base layer only. `pngjs` is now a runtime dependency (pure JS, zero transitive deps; `@types/pngjs` supplies the declarations it ships without). Scope limits: radar/precipitation only (satellite gets a note — GeoColor is already a full picture), latest *observed* frame only (nowcast frames are forecasts), no in-image attribution text (would need a font rasterizer). **The composite is garnish, not contract** (ACIS/NIFC precedent): plain `Error`s throughout, and the handler catches everything to return the normal URL-based text with a one-line note — a request without `composite` is byte-for-byte unchanged (verified against `main`, and locked by `tests/unit/imagery-handler.test.ts` passing unedited). Tile cache 24 h, composite cache 10 min. Live-measured payloads 30–97 KB PNG / 40–129 KB base64, against a 1 MB defensive cap.
- **New in v1.19.0 (international alerts):** `get_alerts` routes by **country** (`src/handlers/alertsHandler.ts`): US → NOAA byte-identical (locked by `tests/unit/alerts-detail.test.ts`/`alert-sorting.test.ts` unedited), Canada → MSC GeoMet (`src/services/geomet.ts`, ±0.25° bbox, `status_en: "ended"` + expiry filtered at read time), 38 MeteoAlarm member countries → the country's keyless CAP JSON feed (`src/services/meteoalarm.ts`; every slug live-verified 2026-08-13 — `mk` is `republic-of-north-macedonia`), elsewhere → a not-covered message naming the region. Coordinate-only requests resolve their country via `NominatimService.reverseCountry` (`zoom=3`, permanent cache on 2-decimal rounding, `null` = open ocean cached too); saved/geocoded locations carry `country_code` through `ResolvedLocation` and skip the lookup. The reverse answer **wins over `isInUS`** (Toronto/Vancouver → ECCC), while a no-country answer falls back to `isInUS` to preserve NOAA marine alerts offshore; a *failed* lookup adds a one-line note, an *absent* `nominatimService` (test harnesses — the three new handler parameters are optional and trailing) falls back silently. MeteoAlarm warnings select the `en`-prefixed `info` variant (fallback: first), and `filterActiveWarnings` applies status/Cancel → expiry → `Update`-references supersession **on every read** — a 4-minute-old cache entry never serves a warning that expired 3 minutes ago (feeds are 2.76 MB worst case, parsed once, cached 5 min). Renderers honour licence terms: verbatim text, issue times always shown as published (both new paths skip the NOAA `getStations` timezone side-call), EUMETNET/national-service and ECCC attribution footers, country-level coverage note, 10/25/summary display caps, `active_only: false` → a "historical alerts not available" note. `get_weather_summary` dropped its US-only short-circuit — alerts dispatch everywhere. Rest-of-world (WMO SWIC) verified not production-usable; no `source` override (authorities don't overlap); both new services throw plain sanitized `Error`s (ACIS/NIFC precedent).
- **New in v1.20.0:** Global wildfire detection (NASA FIRMS) and global fire weather (computed Fosberg FFWI) — the last two US-only pieces of the fire-safety story
- **New in v1.19.0:** International weather alerts (MeteoAlarm + MSC GeoMet) and composited radar maps
- **New in v1.18.0 (hardening + pollen):** Live-test hardening — five pre-existing findings plus a re-test follow-up from the 2026-08-13 full-suite live test (see `docs/plans/live-test-hardening-plan.md`). `save_location` updates now preserve `description`/`alternateNames`/`notes` (omitted keeps, explicit `""`/`[]` clears). The NOAA current-conditions path always renders the observation's age, retries up to `maxStationAttempts` (3) gridpoint stations when the nearest observation exceeds `staleAcceptanceMinutes` (6 h, with a substitution note), and warns past `staleWarningMinutes` (2 h) — thresholds in `DisplayThresholds.currentConditions`, age strings via the shared `formatObservationAge` helper (`src/utils/timezone.ts`, extracted from the METAR path plus a ≥ 48 h days band); the handler drives `getStations`/`getLatestObservation` directly and the `noaa.ts` `getCurrentConditions` wrapper is no longer handler-called. NOAA recent historical appends an early-end note when observations stop more than the stale threshold before the requested end. The wildfire assessment tier comes from the nearest wildfire with containment < 100% (contained fires disclosed, all-contained renders AWARENESS). NOAA marine output always discloses the reported water body; `get_historical_weather` documents its UTC date interpretation. Also rides this release: **current pollen levels on `get_air_quality`** for European locations (six CAMS species in grains/m³ on the endpoint the tool already calls, current block only; non-European points return all-null and render no section — never trust the HTTP 200 alone).
- **New in v1.17.0 (internal milestone, first published in v1.18.0):** Worldwide station observations — `source: 'metar'` on `get_current_conditions` returns real airport instrument readings anywhere on earth, from NOAA's keyless Aviation Weather Center METAR feed (`src/services/aviationWeather.ts`). This closes the server's largest data-quality gap: outside the US the tool previously returned only model-interpolated values. **`auto` is byte-for-byte unchanged** (verified by diffing built-dist output against `main` for a US and a non-US point) — a METAR measures conditions *at an airport* while Open-Meteo estimates them *at the caller's coordinates*, so the two answer different questions and the choice stays explicit, mirroring the global-rivers no-cross-fallback precedent. Station selection is an isolated pure module (`src/utils/metarStation.ts`): freshness gates first (≤90 min preferred, ≤6 h accepted with a `stale` flag), then nearest wins, with banding at 100 km (`far` caveat) and 250 km (no usable station). The handler drives the ±0.5°/±2.0°/±5.0° bbox tier ladder the module exports, keeping the picker I/O-free. Output always states station, distance, 16-point bearing, elevation, and observation age, since those are what make the reading interpretable; absent fields are omitted (gusts appear in 14% of reports, present-weather in 8%) and `visib: "10+"` keeps its qualifier. Units convert from METAR-native knots/hPa/statute miles. `include_normals` is supported; `include_fire_weather` renders an unavailable note (Haines needs NOAA gridpoint inputs). TAF, a dedicated aviation tool, and `get_weather_summary` pass-through are out of scope. Attribution: "NOAA Aviation Weather Center (aviationweather.gov) — METAR station observation".
- **New in v1.16.0 (internal milestone, first published in v1.18.0):** Almanac — `include_astronomy` on `get_forecast` adds per-day moon phase/illumination/moonrise/moonset and civil/nautical/astronomical twilight, plus one next-full/new-moon line per response; computed locally by `src/utils/astronomy.ts` on top of `astronomy-engine` (the project's **first computational runtime dependency** — MIT, zero transitive deps, ±1 arcminute; it is not a data source, so the zero-cost/zero-key data model is preserved). Works on both provider paths (NOAA: one block per calendar date, "Tonight"-first safe; Open-Meteo: after the Sunset line); polar cases render "none (polar day)"/"none (polar night)"; daily-only like `include_normals`. US records — for US locations, `include_normals` on `get_forecast` (day 1) and `get_current_conditions` also appends `**Records for <date>:** High/Low (year) — records since <year>` from the keyless RCC ACIS API (`src/services/acis.ts`: bbox station search widened once on empty, longest period-of-record preferring threaded `…thr` ids; one POST fetches the full 366-slot leap-calendar table; cached 7d/30d). Records are garnish — any ACIS failure warns and omits the line, independent of the normals fetch (either can render without the other); non-US makes no ACIS request. Attribution: "Records: NOAA Regional Climate Centers (ACIS)".
- **New in v1.15.0 (internal milestone, first published in v1.18.0):** Global `get_river_conditions` — NOAA NWPS gauges in the US (unchanged), Open-Meteo Flood API (GloFAS v4) modeled discharge elsewhere, auto-selected by `isInUS` and overridable with `source` (`auto`/`noaa`/`openmeteo`); no cross-fallback, since gauge observations and model discharge are different claims. Because GloFAS discharge is per ~0.05° cell and an off-channel cell reports runoff rather than the river (Memphis: 0.63 vs 11,640 m³/s one cell apart), each request probes a 3×3 neighborhood in one multi-coordinate call and snaps to the highest past-31-day mean, disclosing the move when the winner is not the requested point (`src/utils/riverDischarge.ts`). Model output is framed against its own history and ensemble rather than flood categories (GloFAS publishes none): trend, 31-day-mean ratio, and a median/p25–p75 forecast, with `forecast_days` (1-210, default 7) and `detail="full"` for the min/max envelope and full range. `radius` stays NOAA-only. (Alerts went international in v1.19.0, wildfire in v1.20.0.)
- **New in v1.14.0:** Configurable default location (WEATHER_DEFAULT_LOCATION) with server-default disclosure, CI workflow for PRs, US timezone fallback band fix
- **New in v1.13.0:** Max-range expansion — `get_air_quality` and `get_marine_conditions` gain `forecast_days` (1-7 and 1-16 respectively, day-grouped/null-trimmed full-range output), the historical hourly `limit` ceiling rises to 744 (the full 31-day hourly window; hourly-only semantics documented), `get_weather_imagery` `detail="full"` lists every animation frame, and RainViewer nowcast frames are appended defensively when the feed provides them. Output completeness — AQI forecast day headers add peak UV (hourly fetch trimmed to 3 variables); `detail="full"` on river/wildfire/lightning lifts display caps to 25 with disclosed remainders; wildfire surfaces the ArcGIS truncation caveat; river gauges show an observed rise/fall trend (NWPS stageflow, rate-limit tolerant) plus a multi-point forecast series at `full`; NWPS placeholder observed statuses are suppressed; river footer credits NWPS alone
- **New in v1.12.0:** Global `get_current_conditions` — NOAA station observations in the US (unchanged), Open-Meteo model data elsewhere, auto-selected by the shared `isInUS` helper and overridable with a `source` parameter (`auto`/`noaa`/`openmeteo`). When NOAA rejects an auto-routed point (the US routing boxes overrun the border — Toronto, Vancouver), `get_current_conditions`, `get_forecast`, and `get_historical_weather` fall back to Open-Meteo with a note instead of erroring. `get_historical_weather` also routes recent dates (last 7 days) to NOAA only for US coordinates — international recent dates use the Open-Meteo archive directly. Fixes the `current` section of `get_weather_summary` outside the US. At the time, fire weather, `get_alerts`, rivers, and wildfire were all still US-only (rivers went global in v1.18.0, alerts in v1.19.0, wildfire and fire weather in v1.20.0).
- **New in v1.11.1:** Geocoding fix — `city_name`/`search_location` lookups no longer fail at low result limits (RFC 3986 `%20` encoding + result floor); river forecast no longer prints NWPS `-999`/year-0001 placeholder sentinels; lightning monitoring is pre-warmed for saved locations at startup (`WEATHER_LIGHTNING_PREWARM`)
- **New in v1.11.0:** Universal location resolution (`location_name`/`city_name` on every location-based tool), `get_weather_summary` composite tool, `detail` output control (forecast/alerts/imagery), and a "summary-first" 6-tool default `basic` preset led by `get_weather_summary` (history, air quality, saved-location CRUD, and specialized tools live in `standard`/`full`)
- **New in v1.10.0:** Unit localization — imperial/metric (plus per-unit overrides and 12h/24h) via `WEATHER_UNITS` env or a per-call `units` parameter on forecast/current/historical tools
- **New in v1.9.0:** `city_name` parameter for `get_forecast` — request a forecast by free-text place name (geocoded on demand, with caching)
- **Security Rating:** A- (Excellent, 93/100)
- **Test Coverage:** 1,930 tests, 100% pass rate
- **Code Quality:** A+ (Excellent, 97.5/100)

## Useful References

- **MCP Specification:** https://spec.modelcontextprotocol.io/
- **NOAA API Docs:** https://www.weather.gov/documentation/services-web-api
- **Open-Meteo Docs:** https://open-meteo.com/en/docs
- **Project Docs:**
  - `README.md` - User-facing documentation
  - `CHANGELOG.md` - Version history
  - `docs/planning/README.md` - Planning status index — single source of truth for feature-idea status (idea/planned/shipped/rejected); update it whenever an idea changes state
  - `docs/development/CODE_REVIEW.md` - Code quality assessment
  - `docs/development/SECURITY_AUDIT.md` - Security analysis
  - `TEST_COVERAGE_REPORT_V1.0.md` - Test coverage details

## Getting Help

- **Issues:** https://github.com/weather-mcp/weather-mcp/issues
- **Discussions:** Use GitHub Discussions for questions
- **Security:** See SECURITY.md for vulnerability reporting

---

**Last Updated:** 2026-08-14 (v1.20.0 in development — global wildfire + global fire weather)

This document should be updated whenever major architectural changes are made or new patterns are introduced.
