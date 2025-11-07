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
