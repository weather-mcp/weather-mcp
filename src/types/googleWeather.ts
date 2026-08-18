/**
 * Google Weather API response types
 *
 * Subset-only TypeScript interfaces for the Google Weather API `v1/publicAlerts:lookup`
 * response. All fields are optional as a defensive measure.
 *
 * Important: `polygon` is deliberately not typed—it is never read by the renderer.
 *
 * Field casing and the exact shape of `alertTitle` are web-verified (2026-08-18).
 * The exact `alertTitle` object shape and all field casing are on the T-live
 * live-verification to-verify list.
 *
 * Reference: https://developers.google.com/maps/documentation/weather/overview
 */

/**
 * Top-level response from the Google Weather API public alerts endpoint
 */
export interface GoogleWeatherAlertsResponse {
  alerts?: GoogleWeatherAlert[];
  regionCode?: string;
}

/**
 * A single public weather alert
 */
export interface GoogleWeatherAlert {
  alertId?: string;
  /**
   * Alert title. Documented as an object by Google; exact shape is T-live-verified.
   * Can be a string, an object with `text` and `languageCode`, or undefined.
   * Renderer guards against all shapes.
   */
  alertTitle?: string | { text?: string; languageCode?: string } | undefined;
  eventType?: string;
  areaName?: string;
  /**
   * Alert polygon boundary. Deliberately not typed—never read by the renderer.
   * Provider polygon coverage alignment may not be exact.
   */
  // polygon?: unknown;
  description?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  instruction?: string[];
  safetyRecommendations?: string[];
  startTime?: string;
  expirationTime?: string | null;
  timezoneOffset?: string;
  dataSource?: GoogleWeatherDataSource;
  regionCode?: string;
}

/**
 * Data source attribution for an alert
 */
export interface GoogleWeatherDataSource {
  name?: string;
  fullName?: string;
  authorityUri?: string;
}
