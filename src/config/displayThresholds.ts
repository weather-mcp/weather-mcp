/**
 * Display thresholds and constants for weather data formatting
 *
 * These values determine when certain weather metrics are shown or highlighted
 */

export const DisplayThresholds = {
  /**
   * Temperature thresholds (in Fahrenheit)
   */
  temperature: {
    /** Show heat index when temperature is above this value */
    showHeatIndex: 80,
    /** Show wind chill when temperature is below this value */
    showWindChill: 50,
    /**
     * Minimum apparent-vs-actual temperature gap before "Feels Like" is shown.
     *
     * Keyed by unit because Open-Meteo returns values already in the caller's
     * unit — a single Fahrenheit gap would silently become a ~1.8x stricter
     * rule in Celsius.
     */
    feelsLikeGap: {
      F: 3,
      C: 2,
    },
  },

  /**
   * Wind thresholds
   */
  wind: {
    /** Show gusts if they are this ratio higher than sustained wind speed (1.2 = 20% higher) */
    gustSignificanceRatio: 1.2,
  },

  /**
   * Visibility thresholds (in miles)
   */
  visibility: {
    /** Dense fog */
    denseFog: 0.25,
    /** Fog */
    fog: 1.0,
    /** Haze or mist */
    hazeMist: 3.0,
    /** Clear visibility */
    clear: 10.0,
  },

  /**
   * Precipitation thresholds
   */
  precipitation: {
    /** Light precipitation (inches per hour) */
    light: 0.1,
    /** Moderate precipitation (inches per hour) */
    moderate: 0.3,
    /** Heavy precipitation (inches per hour) */
    heavy: 0.5,
    /**
     * Minimum precipitation before the "Recent Precipitation" section (and
     * its breakout lines) is shown — half of the smallest displayed
     * increment. Without this, trace drizzle renders an all-zero section
     * (e.g. "**Current:** 0.00 in") because the gate used to be `> 0` while
     * display rounds to 2 decimals (imperial) / 1 decimal (metric).
     *
     * Keyed by unit because Open-Meteo returns values already in the
     * caller's unit — same rationale as `temperature.feelsLikeGap`.
     */
    traceFloor: {
      inch: 0.005,
      mm: 0.05,
    },
  },
} as const;

/**
 * API-related constants
 */
export const ApiConstants = {
  /**
   * Historical data threshold (in days)
   * Data older than this uses archival API instead of recent observations
   */
  historicalDataThresholdDays: 7,

  /**
   * Maximum date range for hourly historical data (in days)
   */
  maxHourlyHistoricalDays: 31,
} as const;

/**
 * Formatting constants
 */
export const FormatConstants = {
  /**
   * Default forecast periods to show
   */
  defaultForecastDays: 7,

  /**
   * Maximum forecast days (Open-Meteo supports up to 16 days)
   */
  maxForecastDays: 16,

  /**
   * Default observation limit for historical data
   */
  defaultHistoricalLimit: 168, // One week of hourly data

  /**
   * Maximum observations to return.
   * 744 = 31 days x 24 h — the largest hourly window
   * ApiConstants.maxHourlyHistoricalDays allows, so a full 31-day hourly
   * range can display without silent tail loss.
   */
  maxHistoricalLimit: 744,
} as const;
