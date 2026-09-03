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

    // City name -> coordinates geocoding lookups
    // A place's coordinates are effectively static
    geocoding: Infinity,

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

    // Climate normals (1991–2020 baseline)
    // Climate normals are static reference data that never change; the cached
    // value is one full-year 366-slot table per location
    normals: Infinity,

    // Service health check status
    // Check freshness periodically
    serviceStatus: 5 * MINUTE,

    // River discharge (Open-Meteo Flood API / GloFAS v4)
    // GloFAS updates once daily; 6h balances freshness against the cost of
    // the 9-point channel-snapping probe (a single lookup fans out to 9
    // grid cells in one request, so caching keeps repeat queries cheap).
    floodDischarge: 6 * HOUR,

    // NWPS per-gauge detail (GET /gauges/{lid}) — read only for its flood-stage
    // thresholds and crests, which are gauge metadata NOAA revises on the order
    // of once a year. 24h keeps the ~31 KB mean payload a cold-start cost rather
    // than an hourly one. The per-refresh status on the same payload is
    // deliberately not read (see riverConditionsHandler's fresh-copy merge).
    nwpsGaugeDetail: 24 * HOUR,

    // Google Pollen API (optional global pollen fallback)
    // Pollen models update ~daily; 6h matches the daily-model posture and
    // shields the 5,000/month free-tier quota once the 1h air-quality cache
    // expires. In-memory only — nothing is persisted per Google Maps Platform ToS.
    googlePollen: 6 * HOUR,

    // US daily temperature records (RCC ACIS) — the full 366-slot per-station
    // table. ACIS publishes no rate limits or ToS, so be a good citizen and
    // cache hard: a record changes at most when it is broken, so a stale
    // week is acceptable for trivia context.
    records: 7 * DAY,

    // US daily temperature records — station selection (RCC ACIS StnMeta).
    // A location's nearest qualifying station essentially never changes.
    recordsStation: 30 * DAY,

    // Worldwide METAR station observations (aviationweather.gov). METARs are
    // issued hourly near :53, with SPECIs between; 10 minutes collapses a
    // burst of calls into one fetch without ever serving a response across a
    // reporting cycle.
    metarObservations: 10 * MINUTE,

    // NASA GIBS basemap tiles (OSM_Land_Water_Map, Reference_Features_15m),
    // cached individually by raw tile buffer. These are near-static
    // reference layers — land/water boundaries and coastline/border outlines
    // don't move on any timescale that matters to a weather query — so cache
    // aggressively; 24h balances that staticness against not holding stale
    // tiles indefinitely if a layer is ever revised upstream.
    basemapTiles: 24 * HOUR,

    // Composited radar-on-basemap output, keyed on frame path + tile +
    // marker pixel. Radar frames are immutable once published under their
    // timestamp, so this isn't about staleness — it's about not re-fetching
    // and re-compositing on every call within a feed cycle; RainViewer's
    // nowcast cadence is ~10 minutes, so a repeat call inside that window is
    // still looking at the same latest frame.
    compositeImage: 10 * MINUTE,

    // Nominatim reverse geocoding — country resolution only (zoom=3). Keyed
    // on coordinates rounded to ~1.1km; countries don't move, so once
    // resolved (including a "no country" open-ocean result) it's permanent.
    reverseCountry: Infinity,

    // NASA FIRMS Area API bbox query (keyed path). NRT detections land
    // within ~3 h of overpass; 30 min matches the NIFC perimeter refresh
    // cadence.
    firmsAreaQuery: 30 * MINUTE,

    // NASA FIRMS regional flat-file fetch (keyless path). Caches the parsed
    // rows per region file (not per request), so repeated queries anywhere
    // in a region cost one fetch per half hour.
    firmsRegionalFile: 30 * MINUTE,

    // National CAP documents and polygon documents, keyed on (index identifier,
    // index published stamp). SACHET re-serves a thread's latest version under
    // one GUID; the stamp (not the identifier) makes the key immutable. A named
    // 24h entry rather than Infinity so a long-running server's LRU is not
    // pinned with dead alerts.
    capDocument: 24 * HOUR,

    // JMA Atom index (feed/extra_l.xml) — **retention**, not freshness.
    //
    // These are two different clocks and the entry needs both. Freshness is how
    // long the server will answer without asking JMA at all, and that reuses
    // `alerts` (5 minutes) as an interval checked *inside* the entry. Retention
    // is how long the parsed index is kept so that a conditional revalidation
    // has something to reuse — because a 304 carries zero bytes, and reusing a
    // cached parse is the entire point of sending `If-None-Match`. Holding both
    // on one 5-minute TTL would discard the parse at exactly the moment the
    // ETag became useful, so the revalidation could never fire.
    //
    // An hour is safe at any age: a 304 means JMA itself says the parse is
    // current. It bounds the LRU instead — the parsed index is ~8,600 small
    // entry objects covering seven days of bulletins.
    jmaIndex: 1 * HOUR,

    // UK Environment Agency bulk latest-readings pull (GET /data/readings?latest&
    // parameter=level). Every EA gauge measure publishes on a 15-minute period
    // (period: 900), so a shorter TTL buys nothing real — the value cannot
    // change between now and the next 15-minute tick.
    eaLatestReadings: 15 * MINUTE,

    // EA per-station detail (GET /id/stations/{ref}?_view=full) — mirrors
    // nwpsGaugeDetail: read only for its stageScale threshold fields
    // (datum, typicalRangeHigh/Low, scaleMax, min/maxOnRecord), which are
    // gauge metadata revised on the order of years. This entry MUST carry the
    // threshold fields only and never a reading — the same response body also
    // carries each measure's 15-minute-volatile latestReading, and caching
    // that whole would serve a day-old river level as current on a
    // safety-critical output surface (see G7). The service builds a fresh
    // copy each refresh and merges the volatile reading into that copy;
    // only the threshold projection is cached at this TTL.
    eaStationDetail: 24 * HOUR,
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
