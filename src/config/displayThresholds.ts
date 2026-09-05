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
   * Current-conditions staleness and station-retry thresholds.
   */
  currentConditions: {
    /**
     * Observation age (minutes) at which a reading is flagged stale.
     * NOAA stations report at least hourly, so 2 h means at least 2 missed
     * reporting cycles.
     */
    staleWarningMinutes: 120,
    /**
     * Observation age (minutes) at which a reading is rejected outright.
     * This is METAR's outer acceptance bound, reused here as the trigger
     * for retrying against a fresher station.
     */
    staleAcceptanceMinutes: 360,
    /**
     * Total stations whose observations are fetched for a single request,
     * including the first attempt.
     */
    maxStationAttempts: 3,
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

  /**
   * Thermal stress thresholds
   */
  thermalStress: {
    /**
     * Display gates only. The band boundaries themselves live in
     * `src/utils/thermalStress.ts` (where Fosberg's live), and those functions
     * return null below their own lowest band — so *raising* a gate here
     * suppresses lines as expected, while *lowering* one past the pure
     * module's floor has no effect until that floor moves too.
     */
    /** Render the frostbite line when effective wind chill (°F) is at or below this */
    showFrostbiteAtWindChillF: -18,
    /** Compute/render WBGT only when air temp (°F) is at or above showHeatIndex and rounded WBGT (°F) is at or above this */
    showWbgtF: 80,
  },

  /**
   * Life-threatening alert banner gate
   */
  criticalAlert: {
    /**
     * Display gates only. The predicate that reads them lives in
     * `src/utils/criticalAlert.ts`, which owns the *shape* of the rule — the
     * three-axis leg is an `and`, the response leg stands alone, and the two
     * are `or`ed. Widening a list here loosens the gate; it cannot change that
     * shape.
     *
     * These are membership lists rather than a rank because CAP's severity,
     * urgency and certainty are unordered enums as far as this repo is
     * concerned: `CAP_SEVERITY_ORDER` in `alertsHandler.ts` is a sort rank for
     * display, and reusing it here would tie a safety gate to a presentation
     * decision.
     *
     * Calibrated against the live national feed — see the Verification section
     * of the design plan for the histogram the current values were read from.
     * Tuning is a config change here, deliberately, so re-calibration never
     * needs a code review of the predicate.
     */
    /** CAP `severity` values that can reach the gate's three-axis leg */
    severities: ['Extreme'] as readonly string[],
    /** CAP `urgency` values that can reach the gate's three-axis leg */
    urgencies: ['Immediate'] as readonly string[],
    /** CAP `certainty` values that can reach the gate's three-axis leg */
    certainties: ['Observed', 'Likely'] as readonly string[],
    /** CAP `response` values that fire the gate on their own, whatever the severity */
    responses: ['Evacuate'] as readonly string[],
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
