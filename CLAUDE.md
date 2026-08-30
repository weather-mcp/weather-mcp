# CLAUDE.md - AI Assistant Guide for Weather MCP Server

This document provides context and guidelines for AI assistants (Claude, etc.) working with this codebase.

## Project Overview

**Weather MCP Server** is a Model Context Protocol (MCP) server providing weather data from NOAA, Open-Meteo, and a set of other keyless public APIs. It enables AI assistants to fetch real-time weather forecasts, current conditions, historical data, air quality, marine conditions, severe weather alerts, river levels, wildfire activity, lightning, and radar imagery — worldwide, with the best available authority per country.

- **Language:** TypeScript (Node.js)
- **Version:** 1.25.14 (Production Ready)
- **License:** MIT
- **MCP SDK:** `@modelcontextprotocol/sdk` (see `package.json` for the pinned range)
- **Data model:** zero-cost, zero-key by default — every tool works without any API key; a few optional keys extend coverage (see [Configuration](#configuration))

## Architecture

### Core Components

```
src/
├── index.ts                 # MCP server entry point, TOOL_DEFINITIONS registry, dispatch
├── handlers/                # One handler per MCP tool (saved locations share one file)
│   ├── forecastHandler.ts           # get_forecast (+ compare_models, ensemble_spread, normals, astronomy)
│   ├── currentConditionsHandler.ts  # get_current_conditions (NOAA / Open-Meteo / METAR; fire weather, thermal stress)
│   ├── alertsHandler.ts             # get_alerts — routed by country (NOAA / GeoMet / MeteoAlarm / national CAP IN-PH-ID / Google fallback)
│   ├── historicalWeatherHandler.ts
│   ├── weatherSummaryHandler.ts     # get_weather_summary — composite, fans out to the others
│   ├── statusHandler.ts
│   ├── locationHandler.ts           # search_location
│   ├── airQualityHandler.ts         # get_air_quality (+ CAMS pollen, Google pollen fallback)
│   ├── marineConditionsHandler.ts
│   ├── weatherImageryHandler.ts     # get_weather_imagery (+ composite radar maps)
│   ├── lightningHandler.ts
│   ├── riverConditionsHandler.ts    # NOAA NWPS (US) / Open-Meteo Flood (elsewhere)
│   ├── wildfireHandler.ts           # NIFC (US, PR, VI, GU) / NASA FIRMS (elsewhere)
│   └── savedLocationsHandler.ts     # save/list/get/remove_saved_location
├── services/                # External API clients (one per upstream)
│   ├── noaa.ts              # NOAA Weather API (forecast, observations, alerts, NWPS rivers)
│   ├── openmeteo.ts         # Open-Meteo (forecast, archive, AQ, marine, flood, model comparison, ensemble)
│   ├── nominatim.ts         # Nominatim/OSM geocoding + country-level reverseCountry
│   ├── geocoding.ts         # Multi-provider geocoding with automatic fallback
│   ├── meteoalarm.ts        # EUMETNET MeteoAlarm — European national warnings
│   ├── geomet.ts            # MSC GeoMet — Canadian alerts
│   ├── nationalCap.ts       # National CAP feeds — NDMA SACHET (IN), PAGASA (PH), BMKG (ID); first XML upstream
│   ├── googleWeather.ts     # Google Weather publicAlerts — optional keyed global alerts fallback
│   ├── googlePollen.ts      # Google Pollen API — optional keyed global pollen fallback
│   ├── nifc.ts              # NIFC wildfire incidents (US)
│   ├── firms.ts             # NASA FIRMS satellite fire detections (global)
│   ├── acis.ts              # RCC ACIS — US daily temperature records
│   ├── ncei.ts              # NCEI climate normals (optional token, US)
│   ├── aviationWeather.ts   # aviationweather.gov METAR — worldwide station obs
│   ├── blitzortung.ts       # Blitzortung MQTT lightning
│   ├── rainviewer.ts        # RainViewer radar tiles
│   ├── gibs.ts / basemap.ts # NASA GIBS tiles; base-map fetch + stitch for composites
│   └── locationStore.ts     # Saved locations persistence (~/.weather-mcp/locations.json)
├── types/                   # One file per upstream response shape (all optional fields for 3rd-party JSON)
├── utils/                   # Shared utilities — prefer pure, I/O-free modules here
│   ├── cache.ts             # LRU cache with TTL
│   ├── validation.ts        # Input validation (all user inputs go through here)
│   ├── units.ts / unitPreferences.ts / unitFormat.ts / temperatureConversion.ts
│   ├── displayBanding.ts    # displayValue — round to the render site's precision before banding (pure)
│   ├── finiteSample.ts      # finiteSampleAt — one series sample, or undefined when null/non-finite (pure)
│   ├── logger.ts            # Structured logging to stderr; LOG_LEVEL parsing
│   ├── locationResolver.ts  # location_name / city_name / lat-lon → coordinates; shared country-code resolution
│   ├── geography.ts         # isInUS and region helpers
│   ├── timezone.ts          # Local-time formatting, formatObservationAge
│   ├── normals.ts / records.ts / astronomy.ts        # Climate normals, US records, almanac
│   ├── modelComparison.ts / ensembleSpread.ts        # Forecast agreement + member spread (pure)
│   ├── fireWeather.ts / thermalStress.ts             # Fire indices incl. Fosberg; wind chill, frostbite, WBGT (pure)
│   ├── firmsHotspots.ts / metarStation.ts / riverDischarge.ts  # FIRMS parse+cluster; METAR picker; GloFAS cell snap (pure)
│   ├── capParse.ts / pointInPolygon.ts  # CAP 1.2 XML → records, active filter, feed-URL allowlist; ray-casting point-in-ring (pure)
│   ├── composite.ts         # PNG stitch/blend/marker/encode (pure)
│   ├── airQuality.ts / marine.ts / snow.ts / distance.ts / geohash.ts
│   └── version.ts
├── config/
│   ├── cache.ts             # Cache TTLs + CACHE_*/API_TIMEOUT_MS parsing
│   ├── units.ts             # WEATHER_UNITS and per-unit overrides
│   ├── tools.ts             # ENABLED_TOOLS presets (basic/standard/full) and tool names
│   ├── defaultLocation.ts   # WEATHER_DEFAULT_LOCATION
│   ├── api.ts               # Optional API keys (NCEI, FIRMS, Google)
│   └── displayThresholds.ts # Display logic constants
└── errors/
    └── ApiError.ts          # Custom error hierarchy; ApiServiceName is a closed union
```

### Design Patterns

1. **Handler Pattern:** Each MCP tool has a dedicated handler function in `src/handlers/`
2. **Service Layer:** API clients are abstracted into service classes with retry logic
3. **Validation First:** All user inputs validated before processing (see `src/utils/validation.ts`)
4. **Caching Strategy:** LRU cache with TTL based on data volatility (see `src/config/cache.ts`)
5. **Error Hierarchy:** Custom error classes for different failure scenarios
6. **Three-layer split for computed features:** service fetches → pure zero-I/O util computes → handler renders. The pure module owns constants; the service imports them from the util, never the reverse (e.g. `COMPARISON_MODELS`, `ENSEMBLE_MODEL`)
7. **Route by country, not by bounding box, for jurisdictional data** (alerts, wildfire): `NominatimService.reverseCountry` resolves the country once; saved/geocoded locations carry `country_code` through `ResolvedLocation` and skip the lookup (alerts also route to the national CAP feeds ahead of Google)
8. **A rendered coverage claim needs both signals — country *and* geography.** OSM resolves every US territory to `us` at country zoom, so a country set alone cannot tell Puerto Rico (gauged) from Guam (not), and `isInUS` alone cannot tell the US from Toronto. `get_river_conditions` requires both. Promoting a routing heuristic to a claim the user reads also inherits every edge it was previously allowed to get wrong, so widen the boxes to the jurisdiction's real extent when you do it (`src/utils/geography.ts`, GOTCHAS G53)

## Key Features (17 MCP Tools)

All location-based tools accept coordinates, a saved `location_name`, or a
free-text `city_name` (geocoded on demand) — see [Currently Supported Tools](#currently-supported-tools).
Full per-tool parameter reference: `docs/TOOLS.md`.

1. **get_forecast** - 7-day forecasts (NOAA/Open-Meteo, auto-select by location); `detail` output control; `include_normals` (global) and `include_astronomy`; `compare_models: true` returns a five-model agreement view and `ensemble_spread: true` returns ECMWF ENS member spread instead of a single forecast — the two flags are mutually exclusive and daily-only
2. **get_current_conditions** - Current weather (NOAA stations in the US, Open-Meteo model data elsewhere, or worldwide METAR airport observations via `source="metar"`); `include_fire_weather` gives NOAA's published indices in the US and a server-computed Fosberg index on the Open-Meteo path (not on METAR); automatically adds a frostbite-risk or heat-stress (WBGT) line in extreme conditions — no parameter, gated so moderate output is unchanged
3. **get_alerts** - Weather alerts/warnings routed by country: NOAA (US), MSC GeoMet/ECCC (Canada), EUMETNET MeteoAlarm (38 European countries), and the national CAP feeds of India (NDMA SACHET), the Philippines (PAGASA) and Indonesia (BMKG) — matched by alert polygon where the feed publishes geometry inline (PH/ID), country-level with an explicit note otherwise (IN, whose geometry endpoint is not server-reachable); elsewhere the optional keyed Google Weather fallback (`GOOGLE_WEATHER_API_KEY`) or a clean not-covered message; `detail` output control
4. **get_historical_weather** - Historical data 1940-present (Open-Meteo archive, global; NOAA for recent US dates)
5. **get_weather_summary** - One-call overview: current + forecast + alerts (+ optional air quality, lightning)
6. **check_service_status** - API health check (all services)
7. **search_location** - Location search/geocoding (Nominatim/OSM)
8. **get_air_quality** - AQI + pollutants (Open-Meteo, global); pollen keyless in Europe (CAMS grains/m³), worldwide as a Universal Pollen Index with the optional `GOOGLE_POLLEN_API_KEY`
9. **get_marine_conditions** - Wave height, swell, currents (Open-Meteo, global)
10. **get_weather_imagery** - Radar/precipitation imagery (RainViewer, global); `composite: true` returns a finished radar map over a NASA GIBS base map as an MCP image block
11. **get_lightning_activity** - Real-time lightning detection (Blitzortung.org, global)
12. **get_river_conditions** - NOAA NWPS gauges in the US, Open-Meteo Flood/GloFAS modeled discharge elsewhere; `source` override, no cross-fallback
13. **get_wildfire_info** - NIFC named incidents in the US, NASA FIRMS satellite heat detections elsewhere; `source` override, no cross-fallback
14. **save_location** / 15. **list_saved_locations** / 16. **get_saved_location** / 17. **remove_saved_location** - Saved-location management

## Development Guidelines

### Code Style

- **TypeScript Strict Mode:** All strict flags enabled (see `tsconfig.json`)
- **No `any` types:** Use proper typing or `unknown` with validation
- **Explicit returns:** All functions must return on all code paths
- **No unused variables:** Compiler enforces `noUnusedLocals` and `noUnusedParameters`

### Adding New Features

1. **Types First:** Define TypeScript interfaces in `src/types/` — every field of a third-party response optional
2. **Validation:** Add validators to `src/utils/validation.ts`
3. **Handler:** Create or extend a handler in `src/handlers/` following existing patterns
4. **Service (if needed):** Add API methods to an existing service or create a new one in `src/services/`
5. **Tool Registration:** Register in `src/index.ts` (`TOOL_DEFINITIONS` and the `CallToolRequestSchema` dispatch)
6. **Tests:** Write comprehensive tests (see Testing section below)
7. **Documentation:** `CHANGELOG.md` `[Unreleased]`, `docs/TOOLS.md`, `README.md` feature list, `.devdocs/ROADMAP.md` status row; this file only if architecture or a convention changed

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

`ApiServiceName` is a **closed union**. Newer, peripheral services (FIRMS, Google Pollen, Google Weather, ACIS, NIFC, GeoMet, MeteoAlarm) deliberately stay outside it and throw plain `Error`s with fixed, pre-written messages — see the conventions below for when that is right.

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

## Project Conventions (hard-won rules)

These are the cross-cutting rules that recur across releases. Each was learned the hard way; the per-feature reasoning lives in `.devdocs/archive/completed/<feature>-plan.md` (D-numbered decisions) and `CHANGELOG.md`.

### Scope and output stability

- **Automatic enhancement over parameter proliferation.** If a new piece of context needs no new upstream input, gate it on conditions rather than adding a parameter (thermal stress, stale-observation notes).
- **Existing output must stay byte-identical when a new flag/key is absent.** Add new service parameters **optional and trailing**, so `undefined` ⇒ the old path *by construction*. New request variables get a new cache key; no-flag request URLs must not change.
- **Verify byte-identity by diffing built-dist output against the branch base** (md5 of the rendered text for a US point, a non-US point, imperial and metric), and treat the existing fixture tests for that path as the lock — they should pass **unedited**. Live feeds drift, so run keyed/keyless or before/after spawns back-to-back.
- **One render path per release.** A new computed feature ships on one path (NOAA or Open-Meteo or METAR) and the others get an honest "not available on this source" note; don't spread a half-verified computation across paths.
- **Nothing the caller can't use the regression of:** the `source` parameter (`auto`/`noaa`/`openmeteo`/`metar`/`nifc`/`firms`) never cross-falls-back between authorities that answer *different questions* (gauge vs model, station vs model, incident vs hotspot). An out-of-coverage forced source gets a coverage disclosure, not a fabricated all-clear.

### Garnish vs contract

- **Garnish** (records, normals, composited images, pollen, fire-weather dryness lines): wrapped in one try/catch, degrades silently to "no section" or a one-line note; **no retries** (must not add latency on failure); plain `Error`s. The only garnish failure that *must* surface is a **rejected API key** — silence would hide a misconfiguration from someone who deliberately configured one.
- **Contract** (alerts, model comparison, ensemble spread, river/wildfire routing): failures **propagate** with the service's fixed sanitized message. A fabricated "✅ no alerts" from a failed fetch is a dangerous lie on safety data. Incompatible flag combinations are **validation errors thrown before any request**, never a silent downgrade to a different answer.
- **Distinguish "empty" from "not covered."** HTTP 200 with all-null arrays, HTTP 404 for an uncovered region, and a real empty result mean different things; render them differently (honest-empty with a coverage caveat vs "no coverage here — not an all-clear") and cache the not-covered answer (typed null sentinel) so it isn't re-probed.
- **A runtime dependency may legitimately be absent, and the server must still boot.** A dependency reached by a single tool is declared `optionalDependencies` and loaded through a **memoised, single-flight dynamic `import()` at its one call site** — never statically, because `src/index.ts` imports every service unconditionally above the tool gate, so a static import turns a missing package into a server that cannot start rather than one unavailable tool. Its absence is a **contract** failure: a distinct error naming the package and the remedy, never an empty result. Only the "module not found" code counts as absent — any other import failure is a real fault, propagates unchanged, and is **not** memoised, so it is retried rather than cached as an absence. The resolution must happen before any connection state is touched: an `await` between a synchronously-set in-flight guard and the check that reads it silently lets every concurrent caller past (`mqtt`, v1.25.0).

### Upstream data hygiene

- **Never trust the HTTP 200 alone.** Open-Meteo and others return 200 with all-null series for uncovered points (pollen outside Europe, flood at sea, ensemble probability). Guard with `!= null`, not `!== undefined` — JSON `null` survives `!== undefined` and then coerces to 0 in arithmetic/conversion (the v1.20.0 F1 and normals-averaging bugs). The Open-Meteo series types declare this honestly (`field?: (number | null)[]`), so the compiler now enumerates the guard sites rather than certifying their absence; `finiteSampleAt` (`src/utils/finiteSample.ts`) is the shared accessor for reading one sample.
- **Parse CSV/JSON by field name, never by position.** Two live shapes of the same feed have differed in column order and count.
- **Verify documented shapes live before building on them.** Documented field names, enum casing, duration formats, and error codes have all been wrong upstream (Google Weather: six divergences; FIRMS Area API counts calendar UTC days while flat files are rolling 24 h). Record the verified shape in the plan doc.
- **Bands and categories are computed from the rounded display value** — via `displayValue` (`src/utils/displayBanding.ts`), which mirrors the render site's `toFixed` rather than `Math.round`, because the two disagree on negative halves — so the displayed number and its category can never disagree.
- **When a station publishes a value, band off the published value** (NOAA `windChill`) so the risk line never contradicts the "Feels Like" line above it; when computing, say what basis was used.
- **Heuristic bands are disclosed as project heuristics** (Fosberg categories, model-agreement bands, frostbite times, WBGT) — never presented as official ratings; mandatory inline caveats where the model's assumptions bite (WBGT full-sun).

### Keys, secrets, attribution

- **Key-in-URL services** (FIRMS, Google Pollen, Google Weather): never log or throw URLs or raw axios errors; every thrown error is a fixed pre-written string; logs carry only `{ status, code }`; unit tests assert the key appears in no thrown message and no logger argument.
- **Env vars are permanent and per-feature** — a new Google-backed feature gets its own var (key restrictions make a shared var break silently).
- **Standing key policy:** no tool ever *requires* a key; a keyed feature needs a usable free tier; say plainly when a "free tier" still needs a billing account.
- **Attribution strings that a licence mandates are exact** (`Source: Includes weather data from Google`, `Source: Includes pollen data from Google`) — do not reword. Licensed alert text renders verbatim with issue times as published.
- Persist nothing from Google APIs beyond the in-memory cache (ToS).

### Caching and concurrency

- TTLs live in `CacheConfig.ttl.*` (`src/config/cache.ts`); reuse an existing entry when the data's volatility matches rather than adding one (Google alerts reuse `alerts`), and add a named entry when you'd otherwise hardcode `Infinity`.
- Cache the *table*, not the per-date slice, for anything derived from a bulk pull (normals).
- Dedupe concurrent same-key pulls with a `Map<string, Promise<T>>` deleted in `finally`, so a rejected pull is never cached nor left behind.
- Bound every upstream array (`securityEvent` warn + caveat when the cap trims): 5,000 FIRMS rows, 64 ensemble members, gridpoint series lengths.

### Process

- **Read real output, not just passing tests.** Several shipped-quality bugs were found only by reading rendered text (a percentage contradicting the words it labelled; a quantity mislabelled in a safety line; `**X** (X)` suffix duplication). Run the built dist against live points before tagging.
- Design → plan → run: `/design-plan` drafts `.devdocs/backlog/plan-<name>.md`; promoting it to the `.devdocs/` root (SETTLED) makes it valid input to `/impl-plan` → `/plan-review` → `/run-plan`, whose last step moves the whole plan set to `.devdocs/archive/completed/`. Update `.devdocs/ROADMAP.md` whenever an idea changes state.
- `scripts/update-docs-for-release.sh` rewrites this file's version, tool count, test count, `Last Updated`, and prepends one "New in" line (auto-pruned to the newest three; it refuses to run if no "New in" anchor line exists) — keep those anchors; **do not add per-release narrative here** (it belongs in `CHANGELOG.md` and the plan doc). It also maintains `CHANGELOG.md`'s link-reference block: emitting the new version's compare-link definition and re-pointing `[Unreleased]:` at it.

## Testing

### Test Structure

```
tests/
├── unit/          # ~80 files; fast, no I/O. Fixture-based handler/service tests plus pure-module tests
└── integration/   # ~13 files; some make live network calls and can flake — re-run before blaming a diff
```

Named by subject (`<feature>-handler.test.ts`, `<util>.test.ts`, `<feature>-routing.test.ts`). When a change must leave an existing path untouched, the existing test file for that path is the **lock** — it should pass unedited; if you have to edit it, the path changed.

### Testing Requirements

- **Framework:** Vitest (configured in `package.json`)
- **Coverage Target:** 100% on critical utilities (cache, validation, units, errors)
- **Performance:** Unit tests are fast; the full suite currently takes ~1 minute. Keep new unit tests I/O-free
- **No Flakiness:** Unit tests must be deterministic (pin percentile methods, clustering order, time zones)

### Running Tests

```bash
npm test                    # Run all tests
npm run test:watch         # Watch mode
npm run test:coverage      # With coverage report
npx vitest run tests/unit/cache.test.ts   # One file
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

- No API keys required (all default APIs are public); optional keys come only from environment variables
- Never commit `.env` files

## Configuration

### Environment Variables

```bash
# Cache Configuration
CACHE_ENABLED=true              # Enable/disable caching (default: true)
CACHE_MAX_SIZE=1000            # Max cache entries (100-10000, default: 1000)

# API Configuration
API_TIMEOUT_MS=30000           # API timeout in milliseconds (5000-120000, default: 30000)

# Tool selection
ENABLED_TOOLS=basic            # Preset (basic | standard | full | all) and/or names,
                               # e.g. basic,+air_quality  or  all,-marine  (src/config/tools.ts)

# Default location (used when a tool is called with no location at all)
WEATHER_DEFAULT_LOCATION=home  # saved alias | "lat,lon" | free-text place name

# Lightning
WEATHER_LIGHTNING_PREWARM=true # Subscribe saved locations at startup so lightning
                               # coverage accumulates before the first query (default: true).
                               # Set false to skip the startup MQTT connection. No effect
                               # when get_lightning_activity is disabled.

# Units / Localization
WEATHER_UNITS=imperial         # imperial | metric (default: imperial)
# Optional per-unit overrides (follow WEATHER_UNITS if unset):
#   WEATHER_TEMPERATURE_UNIT (F|C), WEATHER_WIND_SPEED_UNIT (mph|kmh|ms|kn),
#   WEATHER_PRECIPITATION_UNIT (inch|mm), WEATHER_PRESSURE_UNIT (inHg|hPa),
#   WEATHER_DISTANCE_UNIT (mi|km), WEATHER_TIME_FORMAT (12h|24h)

# Optional API keys (all four are optional; every tool works without them —
# see the README "Optional API keys" section for the standing key policy)
# NCEI_API_TOKEN=...           # Free registration — official US climate normals
# FIRMS_MAP_KEY=...            # Free registration — targeted wildfire queries, 1-5 day history
# GOOGLE_POLLEN_API_KEY=...    # NOT a free registration: needs a Google Cloud billing
                               # account (free tier 5,000 lookups/month). Adds pollen
                               # outside Europe. docs/GOOGLE_POLLEN_KEY_SETUP.md
# GOOGLE_WEATHER_API_KEY=...   # Also NOT a free registration (same billing requirement,
                               # separate key — a Pollen-restricted key will not work).
                               # Adds official alerts beyond US/Canada/Europe/India/
                               # Philippines/Indonesia.
                               # docs/GOOGLE_WEATHER_KEY_SETUP.md

# Logging
LOG_LEVEL=1                    # 0/DEBUG, 1/INFO, 2/WARN, 3/ERROR — number or name,
                               # names case-insensitive (default: 1). An unrecognized
                               # value warns on stderr and falls back to INFO.
```

Cache and API variables are validated in `src/config/cache.ts`; `LOG_LEVEL` is parsed
in `src/utils/logger.ts`; unit variables are parsed and validated in
`src/config/units.ts`; optional keys in `src/config/api.ts`.
Per-call unit parameters are resolved by `src/utils/unitPreferences.ts` and formatted
via `src/utils/unitFormat.ts`.

## Caching Strategy

### TTL Values (defined in `src/config/cache.ts`)

- **Grid coordinates:** Infinity (never change)
- **Weather stations:** 24 hours (rarely change)
- **Forecasts:** 2 hours (updated hourly)
- **Current conditions:** 15 minutes (update frequency)
- **Alerts:** 5 minutes (can change rapidly)
- **Historical data (>1 day old):** Infinity (finalized)
- **Recent historical (<1 day):** 1 hour (may be corrected)
- **NWPS gauge detail (flood-stage thresholds):** 24 hours (gauge metadata, revised ~annually)
- Newer entries (normals, Google pollen, FIRMS, tiles, composites) are documented inline in `CacheConfig`

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

Body: a short description, then `**Changes:**` / `**Benefits:**` bullets when the
change warrants it, and `Addresses <issue/plan reference>.` when there is one.
**No `Co-Authored-By` or generated-with trailers.**

## Saved Locations Feature

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

Every location-based tool already accepts `location_name` / `city_name` / `latitude`+`longitude`
via the shared `resolveLocationAsync` helper and the `LOCATION_SCHEMA_PROPERTIES` schema
fragment in `src/index.ts`. A new tool follows the same pattern:

```typescript
// 1. Args interface
interface YourToolArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  // ... other parameters
}

// 2. Resolve once at the top of the handler
import { resolveLocationAsync } from '../utils/locationResolver.js';
const resolved = await resolveLocationAsync(args as YourToolArgs, locationStore, geocodingService);
const { latitude, longitude } = resolved;

// 3. Spread LOCATION_SCHEMA_PROPERTIES into the tool's inputSchema.properties in src/index.ts
//    and leave `required: []`.
```

Name-based lookups echo the resolved place in a `**Location:**` header
(`formatLocationLine`/`prependLocationLine` in `src/utils/locationResolver.ts`).
`ResolvedLocation` also carries `country_code` when known, which country-routed
tools use to skip the reverse-geocode lookup.

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
- **Activities (optional)**: array of strings, lowercased/trimmed, ≤ 50 chars each, empties dropped; helps the AI tailor weather context
- **Smart Updates**: if the alias exists and no location details are provided, only the specified fields change (`description`/`alternateNames`/`notes` preserved when omitted, cleared when explicitly `""`/`[]`); new locations still need `location_query` or lat/long

### Currently Supported Tools

**Every location-based weather tool** accepts `location_name` (saved) and `city_name`
(geocoded on demand) in addition to `latitude`/`longitude`:

- ✅ `get_forecast`, `get_current_conditions`, `get_alerts`, `get_historical_weather`
- ✅ `get_air_quality`, `get_marine_conditions`, `get_weather_imagery`
- ✅ `get_lightning_activity`, `get_river_conditions`, `get_wildfire_info`
- ✅ `get_weather_summary` (composite; resolves once, fans out to the above)

## Common Tasks

### Adding a New MCP Tool

1. Create handler: `src/handlers/newFeatureHandler.ts`
2. Define types: `src/types/<upstream>.ts`
3. Add service method if needed: `src/services/`
4. Register tool in `src/index.ts` (`TOOL_DEFINITIONS` + dispatch) and in `src/config/tools.ts` (`ToolName`, presets)
5. Write tests: `tests/unit/` and `tests/integration/`
6. Update documentation: `docs/TOOLS.md`, `README.md`, `CHANGELOG.md`

### Adding External API Integration

1. Create type definitions in `src/types/` (all fields optional)
2. Add client methods to existing service or create new service class
3. Decide garnish vs contract (see conventions) — that decides retries, error class, and failure rendering
4. Add caching with an appropriate `CacheConfig.ttl` entry
5. Verify the live response shape before writing the parser; record what you saw in the plan doc
6. Write unit tests with fixture responses; never let a unit test hit the network

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

Note: MCP clients spawn `dist/index.js` at session start — a rebuild alone is invisible to an already-running client; restart the session to pick it up.

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
- [ ] Error handling with custom error classes (or fixed-message plain `Error` for garnish/keyed services)
- [ ] Security event logging where appropriate
- [ ] Tests for new functionality (unit + integration); existing lock tests pass unedited
- [ ] Documentation updated (inline comments + README + docs/TOOLS.md + CHANGELOG)
- [ ] No console.log (use logger instead)
- [ ] No hardcoded values (use config/)
- [ ] Rendered output read against live points, not just tests

## Project Status

- **Version:** 1.25.14 — Production Ready ✅
- **Test Coverage:** 2,857 tests, 100% pass rate
- **Security Rating:** A- (Excellent, 93/100) · **Code Quality:** A+ (Excellent, 97.5/100)

Recent releases (one line each; `scripts/update-docs-for-release.sh` prepends the new line and prunes the list to the newest three — detail lives in `CHANGELOG.md` and the plan docs under `.devdocs/archive/completed/`):

- **New in v1.25.14:** A publish run that succeeded is no longer reported as a failed release
- **New in v1.25.13:** US river gauges now render the flood-stage thresholds and historic crests they have always advertised
- **New in v1.25.12:** A forced NOAA river query in a US territory now discloses the NWPS coverage gap, and Puerto Rico is never denied

## Useful References

- **MCP Specification:** https://spec.modelcontextprotocol.io/
- **NOAA API Docs:** https://www.weather.gov/documentation/services-web-api
- **Open-Meteo Docs:** https://open-meteo.com/en/docs
- **Project Docs:**
  - `README.md` - User-facing documentation
  - `docs/TOOLS.md` - Per-tool parameter reference
  - `CHANGELOG.md` - Version history (the single source for what shipped when)
  - `.devdocs/ROADMAP.md` - Planning status index — single source of truth for feature-idea status (idea/planned/shipped/rejected); update it whenever an idea changes state
  - `.devdocs/archive/completed/` - Shipped design + implementation plans: the *why* behind each feature (D-numbered decisions, live-verification notes)
  - `.devdocs/reports/` - Code review, security audit, test coverage reports

## Getting Help

- **Issues:** https://github.com/weather-mcp/weather-mcp/issues
- **Discussions:** Use GitHub Discussions for questions
- **Security:** See SECURITY.md for vulnerability reporting

---

**Last Updated:** 2026-08-30 (v1.25.14)

This document should be updated whenever major architectural changes are made or new patterns are introduced — not for every release.

<!-- devwf:begin -->
## dev-workflow (installed)

This project runs the **dev-workflow** pipeline. `.claude/commands/` and
`.claude/scripts/` are symlinks into a shared checkout, so the slash commands
and the chaining scripts are the same in every project that uses it. The docs
root is **`.devdocs/`** — design plans, implementation plans, reviews, triage
briefs, the playbook (`orchestration-playbook.md`), the project's bindings
(`orchestration-bindings.md`), and a `README.md` that is the folder map.
**Read `.devdocs/README.md` before touching the pipeline**; the playbook is
the methodology and the bindings resolve every project-specific fact it names.

**The stages, in order.** `/design-plan` (a DRAFT in `.devdocs/backlog/`) →
the human promotes it to `.devdocs/` (SETTLED) →
`.claude/scripts/plan-pipeline.sh <plan>` (unattended: `/impl-plan` → reviews
across vendors → `/plan-triage`) → `/run-plan` (interactive, in a session; it
needs the Agent tool) → `.claude/scripts/post-run-pipeline.sh` (unattended
diff reviews + diff triage) → `/test-drive` → `/release`. Beside the chain:
`/quick-fix` for a change whose *risk* is trivial, and `/quota-route` for
deciding where a piece of work should run and whether it should run now.

**Before launching any script** (`plan-pipeline.sh`, `plan-review-multi.sh`,
`post-run-pipeline.sh`):

- Run `/quota-route <the exact invocation>`, or by hand
  `.claude/scripts/plan-budget.sh <plan>`. It reads the live quota of every
  vendor CLI and prints the exact calls per vendor with a verdict. **Every
  percentage those print is used, not remaining.** Never hand-write a vendor
  quota table.
- Review breadth follows the plan's `Weight:` — one routed reviewer for
  `light` and `standard`, every vendor only for `heavy`. Omit `--agents` and
  the scripts apply that rule; `--all` on a standard plan is a choice, and the
  script says so.
- Scripts with interactive pickers need a TTY: run them with the `!` prefix,
  or pass the plan path and flags explicitly. Exit code **3** means the chain
  suspended itself on quota; its closing block carries the exact `--resume`
  command and the time to run it.
- **Launch it with `run_in_background`, then wait once.** Launch the script
  with `run_in_background`. Then run `.claude/scripts/plan-status.sh --wait` in
  the background and do nothing else for this run until it returns. Check on
  progress only with `.claude/scripts/plan-status.sh` — never `ps`, `pgrep`, a
  hand-written Monitor, or an `until` loop; the same script path runs for every
  project on this machine. When `--wait` returns the run is over, and it exits
  with the run's own code: stop any monitor or shell you started for it before
  reading the results.

**Every stage ends with a `NEXT` block** — `PROCEED`, `FIX FIRST`, or `STOP`,
then the exact next action. Follow the verb. A `FIX FIRST` that arrives after
`/plan-triage` is that stage's own verdict (amend the plan, then `/run-plan`),
not a sign that triage was skipped.
<!-- devwf:end -->
