/**
 * API configuration for external weather services
 *
 * Most APIs used by this server are free and require no authentication.
 * Optional API tokens can be configured for enhanced features.
 */

/**
 * NCEI (National Centers for Environmental Information) API token
 *
 * OPTIONAL: Get a free token at https://www.ncdc.noaa.gov/cdo-web/token
 *
 * Benefits of providing a token:
 * - Access to official NOAA climate normals for US locations
 * - More accurate than computed normals from reanalysis data
 *
 * If not provided:
 * - Climate normals will be computed from Open-Meteo historical data
 * - Works globally (not just US)
 * - No setup required
 *
 * Rate limits with token:
 * - 5 requests per second
 * - 10,000 requests per day
 */
export const NCEI_API_TOKEN = process.env.NCEI_API_TOKEN;

/**
 * Check if NCEI API is available (token configured)
 */
export function isNCEIAvailable(): boolean {
  return !!NCEI_API_TOKEN && NCEI_API_TOKEN.trim().length > 0;
}

/**
 * FIRMS (Fire Information for Resource Management System) API map key
 *
 * OPTIONAL: Get a free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/
 *
 * Benefits of providing a key:
 * - Access to targeted NASA FIRMS Area-API bbox queries
 * - Query wildfire data with custom day_range (1–5 days)
 *
 * If not provided:
 * - Keyless 24-hour regional flat CSV files
 * - Tool still works globally without the key
 * - No setup required
 *
 * Rate limits with key:
 * - 5,000 transactions per 10 minutes
 */
export const FIRMS_MAP_KEY = process.env.FIRMS_MAP_KEY;

/**
 * Check if FIRMS API key is available (key configured)
 */
export function isFIRMSKeyAvailable(): boolean {
  return !!FIRMS_MAP_KEY && FIRMS_MAP_KEY.trim().length > 0;
}
