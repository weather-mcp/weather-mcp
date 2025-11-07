/**
 * Cache configuration for weather data
 *
 * TTL (Time To Live) values are set based on data volatility:
 * - Historical data: Never changes once recorded
 * - Geographic data: Static (grid coordinates, station locations)
 * - Forecasts: Updated approximately hourly
 * - Current conditions: Observations typically update every 20-60 minutes
 */

// Time constants in milliseconds
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Parse a boolean environment variable
 * @param key Environment variable key
 * @param defaultValue Default value if not set
 * @returns Boolean value
 */
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value !== 'false' && value !== '0';
}

/**
 * Parse a number environment variable with validation
 * @param key Environment variable key
 * @param defaultValue Default value if not set or invalid
 * @param min Minimum allowed value (optional)
 * @param max Maximum allowed value (optional)
 * @returns Validated number value
 */
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
  // Enable/disable caching globally
  enabled: getEnvBoolean('CACHE_ENABLED', true),

  // Maximum number of entries in cache before LRU eviction
  // Min: 100, Max: 10000, Default: 1000
  maxSize: getEnvNumber('CACHE_MAX_SIZE', 1000, 100, 10000),

  // API timeout configuration
  // Min: 5000ms (5 seconds), Max: 120000ms (2 minutes), Default: 30000ms (30 seconds)
  apiTimeoutMs: getEnvNumber('API_TIMEOUT_MS', 30000, 5000, 120000),

  // TTL values for different data types
  ttl: {
    // Grid coordinate lookups (lat/lon -> grid mapping)
    // These are geographic and never change
    gridCoordinates: Infinity,

    // Weather station lists
    // Stations rarely change
    stations: 24 * HOUR,

    // 7-day forecasts
    // NOAA updates forecasts approximately hourly
    forecast: 2 * HOUR,

    // Current weather conditions
    // Observations typically update every 20-60 minutes
    currentConditions: 15 * MINUTE,

    // Weather alerts
    // Alerts can change rapidly, cache for shorter period
    alerts: 5 * MINUTE,

    // Recent historical data (< 7 days old)
    // Recent data may still be updated/corrected
    recentHistorical: 1 * HOUR,

    // Historical data (> 1 day old from current time)
    // Historical data beyond 1 day is finalized and won't change
    historicalData: Infinity,

    // Service health check status
    // Check freshness periodically
    serviceStatus: 5 * MINUTE,
  },
} as const;

/**
 * Determine appropriate TTL for historical weather data based on date
 * @param startDate Start date of the historical query
 * @returns TTL in milliseconds
 */
export function getHistoricalDataTTL(startDate: string | Date): number {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const now = new Date();
  const daysDiff = (now.getTime() - start.getTime()) / DAY;

  if (daysDiff > 1) {
    // Data is more than 1 day old - it's finalized and won't change
    return CacheConfig.ttl.historicalData;
  } else {
    // Recent data may still be updated
    return CacheConfig.ttl.recentHistorical;
  }
}
