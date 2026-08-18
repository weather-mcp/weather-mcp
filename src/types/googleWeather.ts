/**
 * Google Weather API response types
 *
 * Subset-only TypeScript interfaces for the Google Weather API
 * `v1/publicAlerts:lookup` response. All fields are optional as a defensive
 * measure — live sampling found alerts that omit times, severity, and
 * instructions entirely.
 *
 * **Live-verified 2026-08-18** against a real key (T6), which corrected six
 * things the published documentation got wrong or left ambiguous:
 *
 * 1. The array field is **`weatherAlerts`**, not `alerts`.
 * 2. `severity` / `urgency` / `certainty` are **SCREAMING_CASE** (`"MINOR"`,
 *    `"EXPECTED"`, `"POSSIBLE"`), not CAP/NOAA title case.
 * 3. `timezoneOffset` is a **seconds duration string** (`"28800s"`), not the
 *    `±HH:MM` the docs implied.
 * 4. `safetyRecommendations` holds **objects** (`{ directive, subtext }`),
 *    while `instruction` holds plain strings.
 * 5. `dataSource` carries `publisher` / `name` / `authorityUri` — there is no
 *    `fullName`.
 * 6. The response carries a `nextPageToken` (empty string when there are no
 *    further pages); the docs listed no pagination at all.
 *
 * `polygon` is present in the payload (a GeoJSON *string*) but deliberately
 * not typed — it is never read.
 *
 * Reference: https://developers.google.com/maps/documentation/weather/overview
 */

/**
 * Top-level response from the Google Weather API public alerts endpoint.
 *
 * A covered region with nothing active returns `weatherAlerts: []` with its
 * `regionCode`. A region Google does not cover answers HTTP 404 instead — see
 * `isLocationUnsupported` in the service.
 */
export interface GoogleWeatherAlertsResponse {
  weatherAlerts?: GoogleWeatherAlert[];
  regionCode?: string;
  /** Empty string when there are no further pages. Paging is not implemented. */
  nextPageToken?: string;
}

/**
 * A single public weather alert.
 *
 * Field presence varies widely by publisher: a live PAGASA typhoon alert
 * carried no `instruction` entries, and an earlier sample of the same feed
 * carried no `severity` or time fields at all. Every field is optional and
 * every renderer line is individually guarded.
 */
export interface GoogleWeatherAlert {
  alertId?: string;
  /**
   * Live-verified as an object (`{ text, languageCode }`). The string form is
   * tolerated defensively in case a publisher or a future revision supplies
   * one; `googleAlertTitle` in the handler accepts both.
   */
  alertTitle?: string | { text?: string; languageCode?: string };
  /** ~60-value SCREAMING_CASE enum: `TYPHOON`, `FLOOD`, `TORNADO`, … */
  eventType?: string;
  areaName?: string;
  description?: string;
  /** SCREAMING_CASE: `EXTREME` | `SEVERE` | `MODERATE` | `MINOR` | `UNKNOWN`. */
  severity?: string;
  /** SCREAMING_CASE: `IMMEDIATE` | `EXPECTED` | `FUTURE` | `PAST` | `UNKNOWN`. */
  urgency?: string;
  /** SCREAMING_CASE: `OBSERVED` | `LIKELY` | `POSSIBLE` | `UNLIKELY` | `UNKNOWN`. */
  certainty?: string;
  /** Plain strings (live-verified), often an empty array. */
  instruction?: string[];
  /** Objects, not strings (live-verified). */
  safetyRecommendations?: GoogleWeatherSafetyRecommendation[];
  /** UTC instant, e.g. `2026-08-18T14:55:24Z`. Absent on some alerts. */
  startTime?: string;
  /** UTC instant; may be absent or null. */
  expirationTime?: string | null;
  /** Seconds duration string, e.g. `"28800s"` for UTC+08:00. */
  timezoneOffset?: string;
  dataSource?: GoogleWeatherDataSource;
  regionCode?: string;
}

/** One safety recommendation: a directive with optional explanatory subtext. */
export interface GoogleWeatherSafetyRecommendation {
  directive?: string;
  subtext?: string;
}

/**
 * Publisher attribution for an alert — layer 2 of the Weather API's mandatory
 * two-layer attribution. `name` is the short form ("PAGASA") and `publisher`
 * the enum form ("PHILIPPINES_PAGASA"); there is no `fullName` field.
 */
export interface GoogleWeatherDataSource {
  publisher?: string;
  name?: string;
  authorityUri?: string;
}
