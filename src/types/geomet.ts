/**
 * Type definitions for the MSC GeoMet weather-alerts API (Environment and
 * Climate Change Canada) — https://api.weather.gc.ca/collections/weather-alerts
 *
 * This is a keyless OGC API Features endpoint (`f=json`), **not CAP-shaped**.
 * Live verification (2026-08-13, see "MSC GeoMet (Canada)" in
 * `docs/international-alerts-plan.md`) found the real property set below —
 * there is no severity/urgency/certainty anywhere, so none is typed or
 * invented here. All properties are optional: presence is not guaranteed
 * for every feature, and a live response has been observed with several of
 * them (`risk_colour_en`, `confidence_en`, `impact_en`) set to `null`.
 *
 * `status_en` has been observed with the value `"ended"` — ended items
 * **remain in the collection** and must be filtered client-side (see
 * `filterActiveGeoMetAlerts` in `../services/geomet.js`). French `_fr`
 * twins are typed (present in every live feature) but unused in v1 — see
 * D9 "French output on GeoMet" in the plan doc.
 */

/** A single weather-alerts feature's properties, as returned by GeoMet. */
export interface GeoMetAlertProperties {
  /** e.g. "warning" | "watch" | "advisory" | "statement" (not an enum — render whatever the source sends). */
  alert_type?: string;
  alert_name_en?: string;
  alert_name_fr?: string;
  alert_short_name_en?: string;
  alert_short_name_fr?: string;
  /** The alert body, verbatim — must render unaltered per ECCC terms. */
  alert_text_en?: string;
  alert_text_fr?: string;
  /** The affected area's human-readable name. */
  feature_name_en?: string;
  feature_name_fr?: string;
  /** Two-letter province/territory code, e.g. "SK", "ON". */
  province?: string;
  /** Observed value: "ended" (case varies) — ended items remain in the collection. */
  status_en?: string;
  status_fr?: string;
  risk_colour_en?: string | null;
  risk_colour_fr?: string | null;
  confidence_en?: string | null;
  confidence_fr?: string | null;
  impact_en?: string | null;
  impact_fr?: string | null;
  /** ISO 8601 timestamp of when the alert was published. */
  publication_datetime?: string;
  /** ISO 8601 timestamp of when the alert became valid. */
  validity_datetime?: string;
  /** ISO 8601 timestamp of when the underlying event is expected to end. */
  event_end_datetime?: string;
  /** ISO 8601 timestamp after which the alert record itself expires. */
  expiration_datetime?: string;
  alert_code?: string;
  feature_id?: string;
}

/** GeoJSON-shaped geometry as returned by GeoMet. Coordinates are not consumed in v1 (bbox intersection is server-side; see D4). */
export interface GeoMetGeometry {
  type: string;
  coordinates?: unknown;
}

/** A single OGC API Features feature from the `weather-alerts` collection. */
export interface GeoMetAlertFeature {
  type: 'Feature';
  id?: string;
  geometry?: GeoMetGeometry;
  properties: GeoMetAlertProperties;
}

/** The `weather-alerts/items` collection response. */
export interface GeoMetFeatureCollection {
  type?: 'FeatureCollection';
  features?: GeoMetAlertFeature[];
  /**
   * Total matching feature count for the query. `0` is the documented
   * happy-path empty result (HTTP 200, not an error) — see D4/plan.
   */
  numberMatched?: number;
}
