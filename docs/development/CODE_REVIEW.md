# Weather MCP Server - Comprehensive Code Review Report

## Executive Summary

**Overall Code Quality:** B+ (Good, with opportunities for improvement)

This is a well-structured MCP server for weather data with solid TypeScript usage, proper error handling, and a thoughtful caching implementation. The code demonstrates good architectural decisions and attention to user experience. However, there are several security vulnerabilities, performance optimization opportunities, and code quality improvements that should be addressed.

**Critical Issues Found:** 2
**High Priority Issues:** 8
**Medium Priority Issues:** 15
**Low Priority Issues:** 12

---

## 1. SECURITY VULNERABILITIES

### 1.1 Type Coercion Vulnerability in Cache Key Generation
**File:** `/home/dgahagan/work/personal/weather-mcp/src/utils/cache.ts`
**Lines:** 156-158
**Severity:** CRITICAL

**Issue:**
```typescript
static generateKey(...components: any[]): string {
  return JSON.stringify(components);
}
```

**Problem:**
- Uses `any` type with `JSON.stringify` which can lead to prototype pollution
- No validation of input components
- Could allow cache poisoning attacks if malicious data is passed
- Circular references would cause runtime errors
- `undefined`, `Symbol`, and `Function` values are silently converted

**Recommendation:**
```typescript
static generateKey(...components: (string | number | boolean)[]): string {
  // Validate and sanitize inputs
  const sanitized = components.map(c => {
    if (c === null || c === undefined) return 'null';
    if (typeof c === 'object') {
      throw new Error('Objects not allowed in cache key generation');
    }
    return String(c);
  });
  return sanitized.join(':');
}
```

---

### 1.2 Unsafe Type Assertions in Tool Handlers
**File:** `/home/dgahagan/work/personal/weather-mcp/src/index.ts`
**Lines:** 215-221, 294-297, 482-486, 569-575
**Severity:** HIGH

**Issue:**
```typescript
const { latitude, longitude, days = 7 } = args as {
  latitude: number;
  longitude: number;
  days?: number;
};
```

**Problem:**
- Type assertions bypass TypeScript's type checking
- No runtime validation of input types
- Could allow invalid data types to pass through (e.g., strings instead of numbers)
- User could send malicious payloads

**Recommendation:**
```typescript
// Add runtime validation helper
function validateCoordinates(args: unknown): { latitude: number; longitude: number } {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Invalid arguments: expected object');
  }

  const { latitude, longitude } = args as Record<string, unknown>;

  if (typeof latitude !== 'number' || isNaN(latitude)) {
    throw new Error('Invalid latitude: must be a number');
  }
  if (typeof longitude !== 'number' || isNaN(longitude)) {
    throw new Error('Invalid longitude: must be a number');
  }

  return { latitude, longitude };
}

// Use in handlers
const { latitude, longitude } = validateCoordinates(args);
```

---

### 1.3 Sensitive Information in User-Agent
**File:** `/home/dgahagan/work/personal/weather-mcp/src/services/noaa.ts`
**Lines:** 32
**Severity:** MEDIUM

**Issue:**
```typescript
userAgent = '(weather-mcp, contact@example.com)',
```

**Problem:**
- Hardcoded email address could be harvested
- May not represent actual contact information
- Version information missing from User-Agent

**Recommendation:**
```typescript
// In package.json, read version
import { version } from '../package.json' assert { type: 'json' };

// Construct proper User-Agent
userAgent = `weather-mcp/${version} (https://github.com/dgahagan/weather-mcp)`
```

---

### 1.4 Uncaught Error Exposure
**File:** `/home/dgahagan/work/personal/weather-mcp/src/index.ts`
**Lines:** 917-928
**Severity:** MEDIUM

**Issue:**
```typescript
catch (error) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
  return {
    content: [{ type: 'text', text: `Error: ${errorMessage}` }],
    isError: true
  };
}
```

**Problem:**
- Exposes full error messages to users, which may contain sensitive information
- Stack traces or internal paths could be leaked
- No error sanitization or logging

**Recommendation:**
```typescript
catch (error) {
  // Log full error internally
  console.error('Tool execution error:', error);

  // Return sanitized error to user
  const errorMessage = error instanceof Error
    ? error.message
    : 'An unexpected error occurred';

  // Don't expose internal errors
  const safeMessage = errorMessage.includes('ECONNREFUSED')
    ? 'Service temporarily unavailable'
    : errorMessage;

  return {
    content: [{ type: 'text', text: `Error: ${safeMessage}` }],
    isError: true
  };
}
```

---

## 2. CODE QUALITY & MAINTAINABILITY

### 2.1 Code Duplication in Temperature Conversion
**File:** `/home/dgahagan/work/personal/weather-mcp/src/index.ts`
**Lines:** 304-307, 320-357, 776-780
**Severity:** HIGH

**Issue:**
Temperature conversion logic is duplicated multiple times:
```typescript
const toFahrenheit = (value: number | null, unitCode: string): number | null => {
  if (value === null) return null;
  return unitCode.includes('degC') ? (value * 9/5) + 32 : value;
};
```

**Problem:**
- Same logic repeated in multiple handlers
- Inconsistent with `units.ts` utility functions
- Violates DRY principle
- Makes maintenance difficult

**Recommendation:**
Use existing utility from `units.ts` or create a reusable helper:
```typescript
import { celsiusToFahrenheit } from '../utils/units.js';

function convertTemperature(qv: QuantitativeValue | undefined): number | null {
  if (!qv || qv.value === null) return null;
  return qv.unitCode.includes('degC')
    ? celsiusToFahrenheit(qv.value)
    : qv.value;
}
```

---

### 2.2 Massive Function Size
**File:** `/home/dgahagan/work/personal/weather-mcp/src/index.ts`
**Lines:** 203-929 (726 lines!)
**Severity:** HIGH

**Issue:**
The `CallToolRequestSchema` handler is over 700 lines with multiple nested switch cases.

**Problem:**
- Extremely difficult to test
- High cyclomatic complexity (>50)
- Poor separation of concerns
- Hard to maintain and debug

**Recommendation:**
Refactor into separate handler functions:
```typescript
// Create handlers directory: src/handlers/
// - forecastHandler.ts
// - currentConditionsHandler.ts
// - alertsHandler.ts
// - historicalHandler.ts
// - statusHandler.ts

// src/handlers/forecastHandler.ts
export async function handleGetForecast(
  args: unknown,
  noaaService: NOAAService
): Promise<ToolResponse> {
  // Forecast logic here
}

// src/index.ts
import { handleGetForecast } from './handlers/forecastHandler.js';
import { handleGetCurrentConditions } from './handlers/currentConditionsHandler.js';

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_forecast':
        return await handleGetForecast(args, noaaService);
      case 'get_current_conditions':
        return await handleGetCurrentConditions(args, noaaService);
      // ...
    }
  } catch (error) {
    return handleError(error);
  }
});
```

---

### 2.3 Magic Numbers Throughout Codebase
**File:** `/home/dgahagan/work/personal/weather-mcp/src/index.ts`
**Lines:** 327-338, 379-380, 397-406, etc.
**Severity:** MEDIUM

**Issue:**
```typescript
if (tempF > 80 && heatIndexF > tempF) {
  // Show heat index
}
if (tempF < 50 && windChillF < tempF) {
  // Show wind chill
}
if (gustMph > windMph * 1.2) { // Only show if gusts are 20% higher
```

**Problem:**
- Magic numbers scattered throughout code
- No explanation of thresholds
- Hard to adjust or configure

**Recommendation:**
```typescript
// Create constants file: src/config/displayThresholds.ts
export const DisplayThresholds = {
  temperature: {
    showHeatIndex: 80, // °F
    showWindChill: 50, // °F
  },
  wind: {
    gustSignificanceRatio: 1.2, // Show gusts if 20% higher than wind speed
  },
  visibility: {
    denseFog: 0.25, // miles
    fog: 1.0,
    hazeMist: 3.0,
    clear: 10.0,
  },
} as const;

// Usage
import { DisplayThresholds } from './config/displayThresholds.js';

if (tempF > DisplayThresholds.temperature.showHeatIndex && heatIndexF > tempF) {
  output += `**Feels Like (Heat Index):** ${Math.round(heatIndexF)}°F\n`;
}
```

---

### 2.4 Inconsistent Error Handling
**File:** Multiple files
**Severity:** MEDIUM

**Issue:**
Error handling patterns vary across services:
- Some use try-catch with retry logic
- Some throw directly
- Error messages have different formats

**Example from noaa.ts:**
```typescript
throw new Error(
  `NOAA API rate limit exceeded. Please retry in a few seconds.\n\n` +
  `Details: ${data.detail || 'Too many requests'}\n\n`
);
```

**Example from openmeteo.ts:**
```typescript
throw new Error(
  `Open-Meteo API error: ${reason}\n\n` +
  `Please verify:\n`
);
```

**Recommendation:**
Create a custom error class hierarchy:
```typescript
// src/errors/ApiError.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public service: 'NOAA' | 'OpenMeteo',
    public userMessage: string,
    public helpLinks: string[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class RateLimitError extends ApiError {
  constructor(service: 'NOAA' | 'OpenMeteo', retryAfter?: number) {
    super(
      `Rate limit exceeded for ${service}`,
      429,
      service,
      `Too many requests. Please try again ${retryAfter ? `in ${retryAfter}s` : 'later'}.`,
      [/* relevant links */]
    );
    this.name = 'RateLimitError';
  }
}
```

---

### 2.5 Missing Input Validation
**File:** `/home/dgahagan/work/personal/weather-mcp/src/services/noaa.ts`
**Lines:** 244-271
**Severity:** MEDIUM

**Issue:**
```typescript
async getPointData(latitude: number, longitude: number): Promise<PointsResponse> {
  // Validate coordinates
  if (latitude < -90 || latitude > 90) {
    throw new Error(`Invalid latitude: ${latitude}. Must be between -90 and 90.`);
  }
```

**Problem:**
- Validation only in some methods
- `NaN` values not checked
- `Infinity` values not checked
- Precision not validated (excessive decimal places)

**Recommendation:**
```typescript
function validateLatitude(lat: number): void {
  if (typeof lat !== 'number' || !Number.isFinite(lat)) {
    throw new Error(`Invalid latitude: must be a finite number`);
  }
  if (lat < -90 || lat > 90) {
    throw new Error(`Invalid latitude: ${lat}. Must be between -90 and 90.`);
  }
}

function validateLongitude(lon: number): void {
  if (typeof lon !== 'number' || !Number.isFinite(lon)) {
    throw new Error(`Invalid longitude: must be a finite number`);
  }
  if (lon < -180 || lon > 180) {
    throw new Error(`Invalid longitude: ${lon}. Must be between -180 and 180.`);
  }
}

// Apply to all coordinate inputs
async getPointData(latitude: number, longitude: number): Promise<PointsResponse> {
  validateLatitude(latitude);
  validateLongitude(longitude);
  // ...
}
```

---

### 2.6 Hard-coded Version Number Mismatch
**File:** `/home/dgahagan/work/personal/weather-mcp/src/index.ts`
**Lines:** 25
**Severity:** LOW

**Issue:**
```typescript
const SERVER_VERSION = '0.1.0';
```

**Problem:**
- Version is hardcoded but package.json shows `0.2.0`
- Will get out of sync
- No single source of truth

**Recommendation:**
```typescript
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const SERVER_VERSION = packageJson.version;
```

---

### 2.7 Missing JSDoc for Public APIs
**File:** Multiple files
**Severity:** MEDIUM

**Issue:**
Many public methods lack JSDoc documentation:
```typescript
async getForecastByCoordinates(latitude: number, longitude: number): Promise<ForecastResponse> {
  const pointData = await this.getPointData(latitude, longitude);
  // ...
}
```

**Problem:**
- Unclear parameter requirements
- No usage examples
- Missing return type descriptions
- Poor IDE autocomplete support

**Recommendation:**
```typescript
/**
 * Get weather forecast for a location using latitude/longitude coordinates.
 *
 * This is a convenience method that combines getPointData() and getForecast()
 * to retrieve the 7-day forecast in a single call.
 *
 * @param latitude - Latitude coordinate (-90 to 90)
 * @param longitude - Longitude coordinate (-180 to 180)
 * @returns Promise resolving to forecast response with periods array
 * @throws {Error} If coordinates are invalid or location is outside US coverage
 *
 * @example
 * ```typescript
 * const forecast = await service.getForecastByCoordinates(37.7749, -122.4194);
 * console.log(forecast.properties.periods[0].temperature);
 * ```
 */
async getForecastByCoordinates(
  latitude: number,
  longitude: number
): Promise<ForecastResponse> {
  // ...
}
```

---

### 2.8 Unused Utility Functions
**File:** `/home/dgahagan/work/personal/weather-mcp/src/utils/units.ts`
**Lines:** 69-176
**Severity:** LOW

**Issue:**
Many utility functions in `units.ts` are defined but never used in the codebase:
- `formatTemperature` (lines 69-83)
- `formatWindSpeed` (lines 88-101)
- `formatVisibility` (lines 106-113)
- `formatPressure` (lines 118-125)
- `formatPercentage` (lines 130-135)
- `formatWindDirection` (lines 140-148)
- `formatDateTime` (lines 153-163)
- `formatDate` (lines 168-176)

**Problem:**
- Dead code increases bundle size
- Maintenance burden
- Unclear why functions exist
- May indicate incomplete refactoring

**Recommendation:**
Either use these functions to replace inline formatting in `index.ts`, or remove them:
```typescript
// Option 1: Use them (recommended)
import { formatTemperature, formatWindSpeed } from '../utils/units.js';

// Replace inline formatting
output += `**Temperature:** ${formatTemperature(props.temperature)}\n`;
output += `**Wind:** ${formatWindSpeed(props.windSpeed)}\n`;

// Option 2: Remove if truly unused
// Delete unused functions after verifying no external dependencies
```

---

## 3. PERFORMANCE & OPTIMIZATION

### 3.1 Inefficient Array Operations in Alerts
**File:** `/home/dgahagan/work/personal/weather-mcp/src/index.ts`
**Lines:** 507-513
**Severity:** MEDIUM

**Issue:**
```typescript
const severityOrder = { 'Extreme': 0, 'Severe': 1, 'Moderate': 2, 'Minor': 3, 'Unknown': 4 };
const sortedAlerts = alerts.sort((a, b) => {
  const severityA = severityOrder[a.properties.severity] ?? 4;
  const severityB = severityOrder[b.properties.severity] ?? 4;
  return severityA - severityB;
});
```

**Problem:**
- Uses type assertion without checking property exists
- Creates sorted copy but modifies original array
- Object lookup on every comparison

**Recommendation:**
```typescript
type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

const severityOrder: Record<SeverityLevel, number> = {
  'Extreme': 0,
  'Severe': 1,
  'Moderate': 2,
  'Minor': 3,
  'Unknown': 4
};

// Cache severity values to avoid repeated lookups
const alertsWithSeverity = alerts.map(alert => ({
  alert,
  severityValue: severityOrder[alert.properties.severity as SeverityLevel] ?? 4
}));

const sortedAlerts = alertsWithSeverity
  .sort((a, b) => a.severityValue - b.severityValue)
  .map(item => item.alert);
```

---

### 3.2 Missing Cache for Hourly Forecasts
**File:** `/home/dgahagan/work/personal/weather-mcp/src/services/noaa.ts`
**Lines:** 300-303
**Severity:** MEDIUM

**Issue:**
```typescript
async getHourlyForecast(office: string, gridX: number, gridY: number): Promise<ForecastResponse> {
  const url = `/gridpoints/${office}/${gridX},${gridY}/forecast/hourly`;
  return this.makeRequest<ForecastResponse>(url);
}
```

**Problem:**
- Regular forecasts are cached but hourly forecasts are not
- Results in redundant API calls
- Inconsistent caching strategy

**Recommendation:**
```typescript
async getHourlyForecast(office: string, gridX: number, gridY: number): Promise<ForecastResponse> {
  // Check cache first (if enabled)
  if (CacheConfig.enabled) {
    const cacheKey = Cache.generateKey('hourly-forecast', office, gridX, gridY);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as ForecastResponse;
    }

    const url = `/gridpoints/${office}/${gridX},${gridY}/forecast/hourly`;
    const result = await this.makeRequest<ForecastResponse>(url);

    // Cache with forecast TTL (2 hours)
    this.cache.set(cacheKey, result, CacheConfig.ttl.forecast);
    return result;
  }

  const url = `/gridpoints/${office}/${gridX},${gridY}/forecast/hourly`;
  return this.makeRequest<ForecastResponse>(url);
}
```

---

### 3.3 Redundant Parameter Building
**File:** `/home/dgahagan/work/personal/weather-mcp/src/services/openmeteo.ts`
**Lines:** 289-415
**Severity:** MEDIUM

**Issue:**
Parameter building logic is duplicated when caching is enabled vs disabled:
```typescript
// Lines 289-335: Parameters when cache enabled
// Lines 369-414: Same parameters when cache disabled
```

**Problem:**
- DRY violation
- Maintenance burden
- Increased chance of bugs

**Recommendation:**
```typescript
async getHistoricalWeather(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
  useHourly: boolean = true
): Promise<OpenMeteoHistoricalResponse> {
  // Validate coordinates
  if (latitude < -90 || latitude > 90) {
    throw new Error(`Invalid latitude: ${latitude}. Must be between -90 and 90.`);
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error(`Invalid longitude: ${longitude}. Must be between -180 and 180.`);
  }

  // Build parameters ONCE
  const params = this.buildHistoricalParams(latitude, longitude, startDate, endDate, useHourly);

  // Check cache
  if (CacheConfig.enabled) {
    const cacheKey = Cache.generateKey('openmeteo-historical', latitude, longitude, startDate, endDate, useHourly);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as OpenMeteoHistoricalResponse;
    }

    const response = await this.makeRequest<OpenMeteoHistoricalResponse>('/archive', params);
    this.validateResponse(response, startDate, endDate, useHourly);

    const ttl = getHistoricalDataTTL(startDate);
    this.cache.set(cacheKey, response, ttl);
    return response;
  }

  // No caching
  const response = await this.makeRequest<OpenMeteoHistoricalResponse>('/archive', params);
  this.validateResponse(response, startDate, endDate, useHourly);
  return response;
}

private buildHistoricalParams(/* ... */): Record<string, string | number> {
  // Single source of parameter building
}

private validateResponse(/* ... */): void {
  // Single source of validation
}
```

---

### 3.4 No Request Batching
**File:** `/home/dgahagan/work/personal/weather-mcp/src/services/noaa.ts`
**Lines:** 440-459
**Severity:** LOW

**Issue:**
When getting current conditions, the code tries each station sequentially:
```typescript
for (const station of stations.features) {
  try {
    const stationId = station.properties.stationIdentifier;
    return await this.getLatestObservation(stationId);
  } catch (error) {
    continue;
  }
}
```

**Problem:**
- Sequential requests are slow
- If first station fails, user waits for timeout before trying next
- Could batch requests for better performance

**Recommendation:**
```typescript
async getCurrentConditions(latitude: number, longitude: number): Promise<ObservationResponse> {
  const stations = await this.getStations(latitude, longitude);

  if (!stations.features || stations.features.length === 0) {
    throw new Error('No weather stations found near the specified location.');
  }

  // Try first 3 stations in parallel
  const stationsToTry = stations.features.slice(0, 3);
  const results = await Promise.allSettled(
    stationsToTry.map(station =>
      this.getLatestObservation(station.properties.stationIdentifier)
    )
  );

  // Return first successful result
  for (const result of results) {
    if (result.status === 'fulfilled') {
      return result.value;
    }
  }

  throw new Error('Unable to retrieve current conditions from nearby stations.');
}
```

---

### 3.5 Memory Leak Risk in Cache
**File:** `/home/dgahagan/work/personal/weather-mcp/src/utils/cache.ts`
**Lines:** 84-90
**Severity:** MEDIUM

**Issue:**
```typescript
set(key: string, value: T, ttlMs: number): void {
  const now = Date.now();

  if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
    this.evictLRU();
  }

  const entry: CacheEntry<T> = {
    value,
    expiresAt: ttlMs === Infinity ? Infinity : now + ttlMs,
    lastAccessedAt: now,
  };

  this.cache.set(key, entry);
  this.stats.size = this.cache.size;
}
```

**Problem:**
- No automatic cleanup of expired entries
- `cleanupExpired()` only called in `getStats()`
- Could accumulate expired entries causing memory bloat
- No periodic cleanup timer

**Recommendation:**
```typescript
export class Cache<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private stats: CacheStats;
  private maxSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(maxSize: number = 1000, cleanupIntervalMs: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.stats = { /* ... */ };

    // Automatic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, cleanupIntervalMs);
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}
```

---

## 4. BEST PRACTICES

### 4.1 Missing Environment Variable Validation
**File:** `/home/dgahagan/work/personal/weather-mcp/src/config/cache.ts`
**Lines:** 18-21
**Severity:** MEDIUM

**Issue:**
```typescript
enabled: process.env.CACHE_ENABLED !== 'false',
maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000', 10),
```

**Problem:**
- No validation that `CACHE_MAX_SIZE` is a valid number
- Invalid input could cause `NaN`
- No bounds checking (could be negative or zero)

**Recommendation:**
```typescript
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value !== 'false' && value !== '0';
}

function getEnvNumber(key: string, defaultValue: number, min?: number, max?: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(`Invalid ${key}: "${value}". Using default: ${defaultValue}`);
    return defaultValue;
  }

  if (min !== undefined && parsed < min) {
    console.warn(`${key} too low: ${parsed}. Using minimum: ${min}`);
    return min;
  }

  if (max !== undefined && parsed > max) {
    console.warn(`${key} too high: ${parsed}. Using maximum: ${max}`);
    return max;
  }

  return parsed;
}

export const CacheConfig = {
  enabled: getEnvBoolean('CACHE_ENABLED', true),
  maxSize: getEnvNumber('CACHE_MAX_SIZE', 1000, 100, 10000),
  // ...
};
```

---

### 4.2 Improper Use of Type Casting
**File:** `/home/dgahagan/work/personal/weather-mcp/src/index.ts`
**Lines:** 864, 871
**Severity:** LOW

**Issue:**
```typescript
output += `- Hit Rate: ${(noaaService as any).cache.getHitRate().toFixed(1)}%\n`;
output += `- Hit Rate: ${(openMeteoService as any).cache.getHitRate().toFixed(1)}%\n`;
```

**Problem:**
- Uses `as any` to bypass type checking
- Accesses private property
- Fragile - breaks if implementation changes

**Recommendation:**
```typescript
// Add public method to service classes
class NOAAService {
  // ...

  getHitRate(): number {
    return this.cache.getHitRate();
  }
}

// Usage
output += `- Hit Rate: ${noaaService.getHitRate().toFixed(1)}%\n`;
```

---

### 4.3 Missing Null Checks in Optional Chaining
**File:** `/home/dgahagan/work/personal/weather-mcp/src/index.ts`
**Lines:** 261-263, 268-270
**Severity:** LOW

**Issue:**
```typescript
if (include_precipitation_probability && period.probabilityOfPrecipitation?.value !== null && period.probabilityOfPrecipitation?.value !== undefined) {
  output += `**Precipitation Chance:** ${period.probabilityOfPrecipitation.value}%\n`;
}
```

**Problem:**
- Verbose null checking
- Repeated property access
- Could use nullish coalescing

**Recommendation:**
```typescript
const precipProb = period.probabilityOfPrecipitation?.value;
if (include_precipitation_probability && precipProb != null) {
  output += `**Precipitation Chance:** ${precipProb}%\n`;
}

// Or use nullish coalescing
if (include_precipitation_probability) {
  const prob = period.probabilityOfPrecipitation?.value ?? null;
  if (prob !== null) {
    output += `**Precipitation Chance:** ${prob}%\n`;
  }
}
```

---

### 4.4 No TypeScript Strict Null Checks
**File:** `/home/dgahagan/work/personal/weather-mcp/tsconfig.json`
**Lines:** 8
**Severity:** MEDIUM

**Issue:**
```json
"strict": true,
```

**Problem:**
While `strict: true` is enabled, the code has many manual null checks that could be caught by stricter configuration. Many places use `value !== null && value !== undefined` instead of proper type guards.

**Recommendation:**
Ensure all strict flags are properly utilized:
```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

---

### 4.5 Missing Error Boundary for Main Process
**File:** `/home/dgahagan/work/personal/weather-mcp/src/index.ts`
**Lines:** 942-945
**Severity:** LOW

**Issue:**
```typescript
main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
```

**Problem:**
- Logs to stderr but may not be captured
- No structured logging
- No error reporting/telemetry
- No graceful shutdown

**Recommendation:**
```typescript
async function main() {
  const transport = new StdioServerTransport();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.error(`Received ${signal}, shutting down gracefully...`);

    // Clear caches
    noaaService.clearCache();
    openMeteoService.clearCache();

    // Close connections if any
    await server.close();

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await server.connect(transport);
    console.error('Weather MCP Server running on stdio');
  } catch (error) {
    console.error('Failed to start server:', error);
    throw error;
  }
}

main().catch((error) => {
  console.error('Fatal error in main():', error);

  // Log structured error for monitoring
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'FATAL',
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
  }));

  process.exit(1);
});
```

---

## 5. TESTING & RELIABILITY

### 5.1 No Unit Tests
**File:** Project-wide
**Severity:** CRITICAL

**Issue:**
The package.json shows:
```json
"test": "echo \"Error: no test specified\" && exit 1"
```

**Problem:**
- No automated testing framework
- No unit tests for utilities
- No integration tests for services
- No mocking of external APIs
- Changes could break functionality silently

**Recommendation:**
Set up comprehensive testing:

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

```json
// package.json
{
  "scripts": {
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "test:ui": "vitest --ui"
  }
}
```

```typescript
// tests/unit/cache.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Cache } from '../../src/utils/cache.js';

describe('Cache', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    cache = new Cache<string>(3);
  });

  it('should store and retrieve values', () => {
    cache.set('key1', 'value1', 1000);
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for expired entries', () => {
    vi.useFakeTimers();
    cache.set('key1', 'value1', 1000);

    vi.advanceTimersByTime(1001);
    expect(cache.get('key1')).toBeUndefined();

    vi.useRealTimers();
  });

  it('should evict LRU entry when max size reached', () => {
    cache.set('key1', 'value1', 10000);
    cache.set('key2', 'value2', 10000);
    cache.set('key3', 'value3', 10000);

    // Access key1 to make it recently used
    cache.get('key1');

    // This should evict key2 (least recently used)
    cache.set('key4', 'value4', 10000);

    expect(cache.get('key2')).toBeUndefined();
    expect(cache.get('key1')).toBe('value1');
  });
});

// tests/unit/units.test.ts
import { describe, it, expect } from 'vitest';
import { celsiusToFahrenheit, kphToMph } from '../../src/utils/units.js';

describe('Unit Conversions', () => {
  describe('celsiusToFahrenheit', () => {
    it('should convert 0°C to 32°F', () => {
      expect(celsiusToFahrenheit(0)).toBe(32);
    });

    it('should convert 100°C to 212°F', () => {
      expect(celsiusToFahrenheit(100)).toBe(212);
    });
  });

  describe('kphToMph', () => {
    it('should convert km/h to mph correctly', () => {
      expect(kphToMph(100)).toBeCloseTo(62.1371, 4);
    });
  });
});

// tests/integration/noaa.test.ts
import { describe, it, expect, vi } from 'vitest';
import { NOAAService } from '../../src/services/noaa.js';
import axios from 'axios';

vi.mock('axios');

describe('NOAAService Integration', () => {
  it('should handle rate limits with retry', async () => {
    const mockCreate = vi.mocked(axios.create);
    mockCreate.mockReturnValue({
      get: vi.fn()
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockResolvedValueOnce({ data: { properties: {} } })
    } as any);

    const service = new NOAAService();
    // Test retry logic...
  });
});
```

---

### 5.2 No Error Recovery Testing
**File:** Project-wide
**Severity:** HIGH

**Issue:**
No tests verify error recovery mechanisms work as expected.

**Problem:**
- Retry logic untested
- Fallback behavior unverified
- Error messages not validated
- Recovery from API failures unknown

**Recommendation:**
Add integration tests with mocked failures:

```typescript
// tests/integration/error-recovery.test.ts
import { describe, it, expect, vi } from 'vitest';
import { NOAAService } from '../../src/services/noaa.js';

describe('Error Recovery', () => {
  it('should retry on rate limit and succeed', async () => {
    const service = new NOAAService({ maxRetries: 3 });

    // Mock API to fail twice then succeed
    vi.spyOn(service['client'], 'get')
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockResolvedValueOnce({ data: mockPointsData });

    const result = await service.getPointData(37.7749, -122.4194);
    expect(result).toBeDefined();
  });

  it('should fail after max retries', async () => {
    const service = new NOAAService({ maxRetries: 2 });

    vi.spyOn(service['client'], 'get')
      .mockRejectedValue({ response: { status: 500 } });

    await expect(
      service.getPointData(37.7749, -122.4194)
    ).rejects.toThrow('NOAA API server error');
  });
});
```

---

### 5.3 No Logging Strategy
**File:** Project-wide
**Severity:** MEDIUM

**Issue:**
Only `console.error` is used for logging, and only in a few places.

**Problem:**
- No structured logging
- No log levels (debug, info, warn, error)
- No production logging strategy
- Hard to diagnose issues

**Recommendation:**
Implement proper logging:

```typescript
// src/utils/logger.ts
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  private log(level: LogLevel, message: string, meta?: any) {
    if (level < this.level) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message,
      ...meta,
    };

    // Log to stderr for MCP compatibility
    console.error(JSON.stringify(entry));
  }

  debug(message: string, meta?: any) {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: any) {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: any) {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, meta?: any) {
    this.log(LogLevel.ERROR, message, meta);
  }
}

export const logger = new Logger(
  process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) : LogLevel.INFO
);

// Usage
logger.info('Server starting', { version: SERVER_VERSION });
logger.error('API request failed', {
  service: 'NOAA',
  endpoint: '/points/...',
  error: error.message
});
```

---

## 6. DOCUMENTATION ISSUES

### 6.1 Missing API Documentation
**File:** Project-wide
**Severity:** MEDIUM

**Issue:**
No generated API documentation exists.

**Problem:**
- Developers must read source code to understand APIs
- No searchable documentation
- Hard for contributors to understand codebase

**Recommendation:**
Set up TypeDoc:

```bash
npm install --save-dev typedoc
```

```json
// package.json
{
  "scripts": {
    "docs": "typedoc --out docs/api src/index.ts",
    "docs:serve": "npx serve docs/api"
  }
}
```

```json
// typedoc.json
{
  "entryPoints": ["src"],
  "out": "docs/api",
  "exclude": ["**/*.test.ts", "**/node_modules/**"],
  "excludePrivate": true,
  "plugin": ["typedoc-plugin-markdown"]
}
```

---

### 6.2 Missing Examples in README
**File:** `/home/dgahagan/work/personal/weather-mcp/README.md`
**Severity:** LOW

**Issue:**
While README is comprehensive, it lacks code examples for programmatic usage.

**Recommendation:**
Add programming examples:

```markdown
## Programmatic Usage

While this is primarily an MCP server, you can also use the services directly:

### JavaScript/TypeScript Example

\```typescript
import { NOAAService } from '@dangahagan/weather-mcp';

const service = new NOAAService();

// Get forecast
const forecast = await service.getForecastByCoordinates(37.7749, -122.4194);
console.log(forecast.properties.periods[0].temperature);

// Get current conditions
const conditions = await service.getCurrentConditions(40.7128, -74.0060);
console.log(conditions.properties.temperature.value);
\```
```

---

## 7. ADDITIONAL RECOMMENDATIONS

### 7.1 Add Health Check Endpoint
**Severity:** MEDIUM

**Recommendation:**
Add a simple health check that doesn't require external API calls:

```typescript
{
  name: 'health_check',
  description: 'Check if the MCP server itself is running and responsive',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
}

// Handler
case 'health_check': {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'ok',
        version: SERVER_VERSION,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      }, null, 2)
    }]
  };
}
```

---

### 7.2 Add Rate Limiting
**Severity:** MEDIUM

**Recommendation:**
Implement client-side rate limiting to prevent hitting API limits:

```typescript
// src/utils/rateLimiter.ts
export class RateLimiter {
  private requests: number[] = [];

  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}

  async acquire(): Promise<void> {
    const now = Date.now();

    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.acquire();
    }

    this.requests.push(now);
  }
}

// Usage in services
class NOAAService {
  private rateLimiter = new RateLimiter(50, 60000); // 50 requests per minute

  private async makeRequest<T>(url: string): Promise<T> {
    await this.rateLimiter.acquire();
    // ... existing request logic
  }
}
```

---

### 7.3 Add Metrics Collection
**Severity:** LOW

**Recommendation:**
Track usage metrics for monitoring:

```typescript
// src/utils/metrics.ts
export class Metrics {
  private counters = new Map<string, number>();
  private timings = new Map<string, number[]>();

  increment(metric: string, value: number = 1): void {
    const current = this.counters.get(metric) || 0;
    this.counters.set(metric, current + value);
  }

  timing(metric: string, durationMs: number): void {
    const timings = this.timings.get(metric) || [];
    timings.push(durationMs);
    this.timings.set(metric, timings);
  }

  getStats() {
    const stats: any = { counters: {} };

    this.counters.forEach((value, key) => {
      stats.counters[key] = value;
    });

    this.timings.forEach((values, key) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const max = Math.max(...values);
      const min = Math.min(...values);

      stats[key] = { avg, max, min, count: values.length };
    });

    return stats;
  }
}

export const metrics = new Metrics();

// Usage
const start = Date.now();
await noaaService.getForecast(/* ... */);
metrics.timing('noaa.forecast.duration', Date.now() - start);
metrics.increment('noaa.forecast.success');
```

---

## SUMMARY OF FINDINGS

### By Severity

**Critical (2):**
1. Type coercion vulnerability in cache key generation
2. No unit tests

**High (8):**
1. Unsafe type assertions in tool handlers
2. Code duplication in temperature conversion
3. Massive function size (726 lines)
4. No error recovery testing

**Medium (15):**
5. Sensitive information in User-Agent
6. Uncaught error exposure
7. Magic numbers throughout
8. Inconsistent error handling
9. Missing input validation
10. Missing JSDoc documentation
11. Inefficient array operations
12. Missing cache for hourly forecasts
13. Redundant parameter building
14. Memory leak risk in cache
15. Missing environment variable validation
16. No logging strategy
17. Missing API documentation

**Low (12):**
18. Hard-coded version mismatch
19. Unused utility functions
20. No request batching
21. Improper type casting
22. Missing null checks optimization
23. No TypeScript strict options
24. Missing error boundary
25. Missing examples in README

### Priority Fixes (Recommended Order)

1. **Immediate (Do Now):**
   - Fix cache key generation vulnerability
   - Add input validation to all user-facing functions
   - Implement unit tests for critical paths
   - Fix version mismatch

2. **Short Term (This Sprint):**
   - Refactor large functions into handlers
   - Add comprehensive error handling
   - Implement logging strategy
   - Add caching to hourly forecasts

3. **Medium Term (Next Sprint):**
   - Set up complete test suite
   - Add monitoring and metrics
   - Implement rate limiting
   - Generate API documentation

4. **Long Term (Future):**
   - Optimize performance bottlenecks
   - Add request batching
   - Improve TypeScript strictness
   - Clean up unused code

---

## POSITIVE ASPECTS

Despite the issues identified, this project has many strengths:

1. **Well-Structured Architecture:** Clean separation of concerns with services, types, and utilities
2. **Comprehensive Caching:** Smart TTL-based caching with LRU eviction
3. **Great Error Messages:** Detailed, user-friendly error messages with helpful links
4. **TypeScript Usage:** Proper type definitions for external APIs
5. **Good Documentation:** Comprehensive README with clear usage instructions
6. **Thoughtful UX:** Features like automatic data source selection and intelligent formatting
7. **MCP Compliance:** Proper implementation of the Model Context Protocol
8. **No External Dependencies for APIs:** Works without API keys

---

This code review was conducted on 2025-11-05 for the weather-mcp project (version 0.2.0).
