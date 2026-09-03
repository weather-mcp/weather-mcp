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

/**
 * Google Pollen API key
 *
 * OPTIONAL: Create a key in the Google Cloud console
 * (https://console.cloud.google.com/). Unlike the NCEI and FIRMS keys above,
 * this one is **not a free registration**: it has a free usage tier, but
 * **requires a Google Cloud billing account** (credit card on file).
 *
 * Benefits of providing a key:
 * - Global pollen data for 65+ countries including the US
 * - Grass/Tree/Weed Universal Pollen Index (UPI 0–5)
 *
 * If not provided:
 * - European pollen via CAMS model continues to work
 * - Pollen outside Europe is unavailable
 * - No setup required
 *
 * Rate limits with key:
 * - 5,000 lookups per month (free tier)
 * - ~$10 per 1,000 lookups after free tier
 *
 * Setup guide: docs/GOOGLE_POLLEN_KEY_SETUP.md
 */
export const GOOGLE_POLLEN_API_KEY = process.env.GOOGLE_POLLEN_API_KEY;

/**
 * Check if Google Pollen API key is available (key configured)
 */
export function isGooglePollenKeyAvailable(): boolean {
  return !!GOOGLE_POLLEN_API_KEY && GOOGLE_POLLEN_API_KEY.trim().length > 0;
}

/**
 * Google Weather API key
 *
 * OPTIONAL: Create a key in the Google Cloud console
 * (https://console.cloud.google.com/). Unlike the NCEI and FIRMS keys above,
 * this one is **not a free registration**: it has a free usage tier, but
 * **requires a Google Cloud billing account** (credit card on file).
 * The **Weather API** must be enabled on the project.
 *
 * Benefits of providing a key:
 * - Official weather alerts for ~45+ additional territories (Australia,
 *   Brazil, Mexico, and others) via the Google Weather API
 *
 * If not provided:
 * - US, Canadian, European, Indian, Philippine, Indonesian and Japanese alerts
 *   continue to work keyless
 * - Alerts outside these regions are unavailable
 * - No setup required
 *
 * Rate limits with key:
 * - Per Google's Weather API free tier
 *
 * Setup guide: docs/GOOGLE_WEATHER_KEY_SETUP.md
 */
export const GOOGLE_WEATHER_API_KEY = process.env.GOOGLE_WEATHER_API_KEY;

/**
 * Check if Google Weather API key is available (key configured)
 */
export function isGoogleWeatherKeyAvailable(): boolean {
  return !!GOOGLE_WEATHER_API_KEY && GOOGLE_WEATHER_API_KEY.trim().length > 0;
}
