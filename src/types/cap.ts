/**
 * Types for CAP 1.2 alert feeds shared by the NDMA SACHET (India),
 * PAGASA (Philippines), and BMKG (Indonesia) national alert services.
 *
 * CAP (Common Alerting Protocol) is an international XML standard for
 * emergency alerts. These types model the XML structure as parsed by
 * fast-xml-parser into a JavaScript object.
 *
 * Fields are optional wherever presence is not guaranteed by observation —
 * national implementations vary in the fields they populate.
 */

/** One entry from a CAP index (RSS/Atom feed). */
export interface CapIndexEntry {
  /**
   * The index entry's own id — RSS `<guid>`, Atom `<id>`. This is the *index*
   * identifier and is **not** necessarily the CAP document's `identifier`:
   * SACHET's guid is the alert thread id (the document is `IN-<guid>_<n>`) and
   * PAGASA's is `urn:uuid:<uuid>` to the document's bare uuid. Never assert
   * equality between the two.
   */
  identifier?: string;
  /** URL of the CAP document this entry points at (RSS `<link>`, Atom `cap+xml` link). */
  documentUrl?: string;
  /** Timestamp of when this feed entry was published. */
  published?: string;
  /** Author or publisher name. */
  author?: string;
}

/** A validated (normalized) CAP index entry with required fields guaranteed. */
export interface NormalizedCapIndexEntry {
  /** The index entry's own id (see `CapIndexEntry.identifier`) — guaranteed non-empty. */
  identifier: string;
  /** CAP document URL — guaranteed non-empty, and allowlist-checked before any fetch. */
  documentUrl: string;
  /** Timestamp of when this feed entry was published. */
  published?: string;
  /** Author or publisher name. */
  author?: string;
}

/** One geographic area affected by an alert (CAP `<area>` block). */
export interface CapAlertArea {
  /** Human-readable area description. */
  areaDesc?: string;
  /** Array of polygon strings (WKT or lat,lon space-separated coordinate pairs). */
  polygon?: string[];
  /** Geocodes (EMMA_ID, WARNCELLID, etc.). */
  geocode?: unknown;
}

/** One key-value pair in a CAP alert's parameters (CAP `<parameter>` block). */
export interface CapAlertParameter {
  /** Parameter name (e.g. "Fosberg Index", "Wind Speed Gust"). */
  valueName?: string;
  /** Parameter value. */
  value?: string;
}

/**
 * One language variant of an alert's content (CAP `<info>` block).
 * National feeds duplicate this per language; consumers select the preferred
 * language variant and fall back to the first.
 */
export interface CapAlertInfo {
  /** Language code (e.g., "en", "tl", "id"). */
  language?: string;
  /** Alert event type (e.g., "Flood Warning", "Typhoon Warning"). */
  event?: string;
  /** Recommended response action types (e.g., "Execute", "Shelter", "Evacuate"). */
  responseType?: string[];
  /** Urgency (Expected/Future/Past/Immediate). */
  urgency?: string;
  /** Severity (Extreme/Severe/Moderate/Minor). */
  severity?: string;
  /** Certainty of the alert (Observed/Likely/Possible/Unknown). */
  certainty?: string;
  /** Time alert becomes effective. */
  effective?: string;
  /** Time alert is expected to begin (may differ from effective). */
  onset?: string;
  /** Time alert expires. */
  expires?: string;
  /** Name/title of the issuing sender/agency. */
  senderName?: string;
  /** Short alert headline. */
  headline?: string;
  /** Longer description of the alert. */
  description?: string;
  /** Recommended action or instruction. */
  instruction?: string;
  /** URL with more information. */
  web?: string;
  /** Array of key-value parameters. */
  parameter?: CapAlertParameter[];
  /** Array of affected geographic areas. */
  area?: CapAlertArea[];
}

/** The parsed CAP alert document (namespace-stripped). */
export interface CapAlertDocument {
  /** Unique identifier for this alert (URI). */
  identifier?: string;
  /** Identifier of the issuer. */
  sender?: string;
  /** Timestamp when this alert was sent. */
  sent?: string;
  /** Status of the alert (Actual/Exercise/System/Test). */
  status?: string;
  /** Message type (Alert/Update/Cancel/Ack). */
  msgType?: string;
  /** Scope (Public/Restricted/Private). */
  scope?: string;
  /** Space-separated references (for msgType: "Update" or "Cancel"). */
  references?: string;
  /** Array of info blocks (one per language). */
  info?: CapAlertInfo[];
}

/**
 * A warning normalized to a single language variant and flat shape —
 * the internal currency of the CAP service and the alerts renderer.
 * Shares most fields with MeteoAlarmWarning but omits `colour` and
 * adds CAP-specific fields (`responseType`, `web`, `polygons`).
 */
export interface NationalCapWarning {
  /** Unique identifier for this alert (required). */
  identifier: string;
  /** Status (Actual/Exercise/System/Test). */
  status?: string;
  /** Message type (Alert/Update/Cancel/Ack). */
  msgType?: string;
  /** Alert identifiers referenced by this one (Updates/Cancellations). */
  references: string[];
  /** Event type (e.g., "Flood Warning"). */
  event?: string;
  /** Severity (Extreme/Severe/Moderate/Minor). */
  severity?: string;
  /** Urgency (Immediate/Expected/Future/Past). */
  urgency?: string;
  /** Certainty (Observed/Likely/Possible/Unknown). */
  certainty?: string;
  /** Time alert is expected to begin. */
  onset?: string;
  /** Time alert becomes effective. */
  effective?: string;
  /** Time alert expires. */
  expires?: string;
  /** Timestamp when alert was sent. */
  sent?: string;
  /** Short headline. */
  headline?: string;
  /** Full description. */
  description?: string;
  /** Recommended action/instruction. */
  instruction?: string;
  /** Issuing agency or authority. */
  senderName?: string;
  /** Affected area descriptions (one per CAP area block). */
  areaDesc: string[];
  /** Recommended response actions. */
  responseType?: string[];
  /** URL with additional information. */
  web?: string;
  /** Polygons as rings of [lat, lon] coordinate pairs. */
  polygons: Array<Array<[number, number]>>;
  /** True if polygon geometry was expected but could not be fetched/parsed. */
  polygonUnavailable?: boolean;
  /** URL to the linked polygon (SACHET "Polygon URL" parameter). */
  linkedPolygonUrl?: string;
  /** True if the polygon set was trimmed due to size limits. */
  geometryTrimmed?: boolean;
  /**
   * Count of `<polygon>` elements that were published but could not be
   * parsed. Any value above zero means the ring set is **incomplete**, so it
   * may be used to include a point but never to exclude one — see
   * `polygonUnavailable`, which is always set alongside it.
   */
  ringsDropped?: number;
  /** Language code of this variant. */
  language?: string;
  /** ISO 3166-1 alpha-2 country code of the issuing authority. */
  countryCode: string;
}

/** Configuration for one national CAP alert feed. */
export interface NationalCapFeed {
  /** Display name (e.g., "India NDMA Alerts"). */
  name: string;
  /** URL to the feed index (RSS/Atom). */
  indexUrl: string;
  /** Feed format ('rss' | 'atom'). */
  indexKind: 'rss' | 'atom';
  /** Polygon source ('inline' = within CAP doc, 'linked-parameter' = via Parameter URL). */
  polygonSource: 'inline' | 'linked-parameter';
  /** Preferred language code (e.g., "en", "tl", "id") for flattening. */
  preferLanguage: string;
  /** Attribution string for licensing/credit. */
  attribution: string;
  /** Publisher name. */
  publisher: string;
  /**
   * Exact hostnames this feed may be fetched from. Required — a feed cannot be
   * added without an allowlist. Applied to **every** feed-supplied URL: index
   * links, CAP document URLs, and SACHET `Polygon URL` parameters alike.
   */
  allowedHosts: string[];
  /** Allowed URL path prefixes, checked alongside `allowedHosts` on every feed-supplied URL. */
  allowedPathPrefixes: string[];
  /** Optional rate limit (requests per minute) for the feed. */
  requestsPerMinute?: number;
}

/** Result of fetching and parsing a national CAP feed. */
export interface NationalCapResult {
  /** Array of normalized warnings from the feed. */
  warnings: NationalCapWarning[];
  /** Count of alerts that could not be fetched or parsed. */
  unavailableCount: number;
  /** Count of alerts whose polygons could not be fetched/parsed. */
  polygonUnavailableCount: number;
  /** True if the warning list was trimmed due to size limits. */
  indexTrimmed: boolean;
}
