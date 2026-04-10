# Application Flow

This document explains how the Weather MCP Server works internally, from startup through request execution and graceful shutdown.

## 1. High-Level Overview

The server is a Model Context Protocol (MCP) application that exposes weather tools over stdio transport.

At runtime, the flow is:

1. Initialize services and configuration.
2. Register enabled tools and request handlers with MCP SDK.
3. Receive tool calls from an MCP client.
4. Route to a specific handler.
5. Call one or more services (NOAA, Open-Meteo, Nominatim, etc.).
6. Format a text response and return it through MCP.
7. Track analytics and log structured events.

Primary entrypoint: `src/index.ts`.

## 2. Startup Sequence

On process start, `src/index.ts` performs the following:

1. Loads environment variables via `dotenv/config`.
2. Reads package version from `package.json`.
3. Instantiates core services:
   - `NOAAService`
   - `OpenMeteoService`
   - `NOMADSService`
   - `ModelComparisonService`
   - `NominatimService`
   - `NCEIService`
   - `NIFCService`
   - `GeocodingService`
   - `LocationStore`
4. Creates MCP server instance via `new Server(...)`.
5. Defines all tool schemas in `TOOL_DEFINITIONS`.
6. Registers `ListToolsRequestSchema` and `CallToolRequestSchema` handlers.
7. Connects the server to `StdioServerTransport`.

## 3. Tool Exposure and Configuration

Tool exposure is dynamic and controlled by `ENABLED_TOOLS` in `src/config/tools.ts`.

- Default preset: `basic`
- Presets: `basic`, `standard`, `full`, `all`
- Supports explicit include/exclude syntax (for example: `basic,+air_quality,-alerts`)
- Supports short aliases (`forecast`, `current`, `aqi`, `marine`, etc.)

At list-tools time, only enabled tool definitions are returned to the client.

## 4. Request Lifecycle

Every MCP tool call follows the same pipeline.

1. MCP client sends a `CallTool` request.
2. `src/index.ts` receives request in `server.setRequestHandler(CallToolRequestSchema, ...)`.
3. `name` and `arguments` are extracted.
4. `switch (name)` routes to the matching tool case.
5. The tool execution is wrapped in `withAnalytics(...)` from `src/analytics/middleware.ts`.
6. A handler is called (for example `handleGetForecast(...)`).
7. Handler validates input, resolves location, calls downstream services, and formats output text.
8. Handler returns MCP response payload:
   - `content: [{ type: 'text', text: '...' }]`
9. If an exception occurs:
   - arguments are redacted for logs
   - error is logged with structured metadata
   - `formatErrorForUser(...)` creates user-safe message
   - response is returned with `isError: true`

## 5. Architecture Layers

## 5.1 MCP Server Layer

Location: `src/index.ts`

Responsibilities:

- Define tool schemas (`TOOL_DEFINITIONS`)
- Return enabled tools (`ListToolsRequestSchema`)
- Route calls to handlers (`CallToolRequestSchema`)
- Wrap calls with analytics
- Perform graceful shutdown

## 5.2 Handler Layer

Location: `src/handlers/`

Responsibilities:

- Parse and validate tool arguments
- Orchestrate service calls
- Apply formatting and display rules
- Return MCP text content

Pattern: one handler per MCP tool.

## 5.3 Service Layer

Location: `src/services/`

Responsibilities:

- External API communication
- Retry/backoff and timeout behavior
- Service-specific error mapping
- Caching of API results where appropriate

Examples:

- `NOAAService` for US forecasts, alerts, current conditions, and river data.
- `OpenMeteoService` for global forecast/historical/marine/air quality data.
- `NOMADSService` for GFS and NAM deterministic model-run forecasts.
- `ModelComparisonService` for side-by-side GFS/NAM/ECMWF-proxy daily alignment.
- `NominatimService` and `GeocodingService` for location search.
- `LocationStore` for saved-location persistence.

## 5.4 Utilities and Error Model

Locations:

- `src/utils/`
- `src/errors/ApiError.ts`

Responsibilities:

- Coordinate and argument validation
- Unit conversions and formatting helpers
- Caching infrastructure and TTL policy
- Typed error hierarchy and sanitization

## 5.5 Analytics Layer

Location: `src/analytics/`

`withAnalytics(...)` wraps each tool call and records:

- success or error status
- response time
- categorized error type (validation, not_found, rate_limit, timeout, etc.)

Analytics failure does not replace tool behavior; handler errors are still re-thrown and processed by normal error handling.

## 6. Data Source Selection

Some handlers choose services dynamically.

Example: `get_forecast` in `src/handlers/forecastHandler.ts`:

- If `source=auto`, it checks if coordinates are in US bounds.
- US coordinates use NOAA.
- Non-US coordinates use Open-Meteo.
- Explicit `source=noaa|openmeteo` overrides auto mode.

This keeps one tool interface while optimizing regional data quality.

## 7. Saved Locations Flow

Saved locations are persisted to:

- `~/.weather-mcp/locations.json`

Key components:

- Storage service: `src/services/locationStore.ts`
- Resolver utility: `src/utils/locationResolver.ts`

Resolution behavior:

1. If `location_name` is provided, resolve alias (and alternate names).
2. Otherwise, require valid `latitude` and `longitude`.
3. Return normalized coordinates to the handler.

`LocationStore` uses in-memory cache plus synchronous file I/O for deterministic persistence behavior.

## 8. Caching and Performance

Cache policy is defined in `src/config/cache.ts` and implemented by `src/utils/cache.ts`.

Highlights:

- LRU cache with configurable max size.
- TTL values based on data volatility:
  - Forecast: 2 hours
  - Current conditions: 15 minutes
  - Alerts: 5 minutes
  - Grid coordinates: Infinity
  - Historical older data: Infinity
- `CACHE_ENABLED` can disable caching globally.
- `API_TIMEOUT_MS` and `CACHE_MAX_SIZE` are validated with bounds.

## 9. Error Handling and Reliability

Errors are modeled through typed classes in `src/errors/ApiError.ts`:

- `RateLimitError`
- `ServiceUnavailableError`
- `InvalidLocationError`
- `DataNotFoundError`
- `ValidationError`

Response behavior:

1. Service/handler throws typed error.
2. Top-level request handler catches it.
3. Sensitive fields in args are redacted for logs.
4. `formatErrorForUser(...)` sanitizes output.
5. MCP response returns safe text with `isError: true`.

Retry behavior is implemented in service clients (for example `NOAAService.makeRequest(...)`) using exponential backoff with jitter.

## 10. Logging and Observability

Structured logging is centralized in `src/utils/logger.ts`.

Important MCP rule:

- Logs must go to stderr (`console.error`) so stdout remains reserved for MCP protocol traffic.

Logs include timestamp, level, message, optional context, error details, and metadata.

## 11. Graceful Shutdown

`src/index.ts` registers signal handlers for:

- `SIGTERM`
- `SIGINT`

Shutdown order:

1. Flush analytics (`analytics.shutdown()`).
2. Clear service caches.
3. Close MCP server.
4. Exit process.

This minimizes lost analytics events and leaves resources in a clean state.

## 12. End-to-End Example (Forecast)

A typical `get_forecast` request path:

1. Client calls `get_forecast` with `location_name` or coordinates.
2. `CallToolRequestSchema` routes to `handleGetForecast(...)` under `withAnalytics(...)`.
3. Handler resolves location via `resolveLocation(...)`.
4. Handler validates options (`days`, `granularity`, booleans).
5. Handler selects NOAA or Open-Meteo path.
6. Service call returns raw weather data.
7. Handler formats weather into readable markdown-style text.
8. MCP returns `content` with one text block.
9. Analytics records response time and outcome.

## 13. Contributor Quick Trace

To trace behavior quickly:

1. Start at `src/index.ts` (`ListToolsRequestSchema`, `CallToolRequestSchema`).
2. Follow a single tool case to its handler in `src/handlers/`.
3. Follow service calls in `src/services/`.
4. Check utilities used by that handler in `src/utils/`.
5. Review error classes in `src/errors/ApiError.ts`.
6. Review analytics wrapper in `src/analytics/middleware.ts`.

This path is the fastest way to understand any tool end to end.
