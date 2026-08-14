/**
 * Types for the MeteoAlarm country warning feeds
 * (https://feeds.meteoalarm.org/api/v1/warnings/feeds-<country>).
 *
 * MeteoAlarm aggregates the official warnings of ~35 European national
 * meteorological services as per-country CAP JSON feeds. The feed shape was
 * live-verified 2026-08-13: `{ warnings: [{ alert: <CAP>, uuid }] }`, where
 * `alert` is a CAP 1.2-shaped object whose `info[]` entries are duplicated
 * per language (Germany carries up to 8 language variants per warning).
 *
 * Fields are optional wherever presence is not guaranteed by observation —
 * feeds differ per national service.
 */

/** A single named area within a CAP `info` block. */
export interface MeteoAlarmCapArea {
  areaDesc?: string;
  /** EMMA_ID / WARNCELLID geocodes; some feeds also carry polygons. Unused in v1. */
  geocode?: unknown;
  polygon?: unknown;
}

/** A CAP `parameter` entry (`awareness_level`, `awareness_type`, etc.). */
export interface MeteoAlarmCapParameter {
  valueName?: string;
  value?: string;
}

/**
 * One language variant of a warning's content. Feeds duplicate this block per
 * language (`de-DE`, `en`, `fr`, …); consumers select the `en`-prefixed entry
 * and fall back to the first.
 */
export interface MeteoAlarmCapInfo {
  language?: string;
  category?: string[];
  event?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  onset?: string;
  effective?: string;
  expires?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  senderName?: string;
  web?: string;
  responseType?: string[];
  area?: MeteoAlarmCapArea[];
  parameter?: MeteoAlarmCapParameter[];
}

/** The CAP-shaped `alert` object carried by each feed entry. */
export interface MeteoAlarmCapAlert {
  identifier?: string;
  sender?: string;
  sent?: string;
  status?: string;
  msgType?: string;
  scope?: string;
  /**
   * Present only on `msgType: "Update"` — a space-separated list of CAP
   * `sender,identifier,sent` triples naming the warnings this one replaces.
   */
  references?: string;
  info?: MeteoAlarmCapInfo[];
}

/** One entry in the feed's `warnings` array. */
export interface MeteoAlarmFeedWarning {
  alert?: MeteoAlarmCapAlert;
  uuid?: string;
}

/** Top-level country feed response. */
export interface MeteoAlarmFeedResponse {
  warnings?: MeteoAlarmFeedWarning[];
}

/**
 * A warning normalized to a single language variant and a flat shape — the
 * internal currency of `MeteoAlarmService` and the alerts renderer.
 */
export interface MeteoAlarmWarning {
  identifier: string;
  status?: string;
  msgType?: string;
  /** Identifiers parsed out of the CAP `references` triples (Updates only). */
  references: string[];
  event?: string;
  /** CAP severity vocabulary: Minor / Moderate / Severe / Extreme. */
  severity?: string;
  /** MeteoAlarm awareness colour (green/yellow/orange/red), when parseable. */
  colour?: string;
  urgency?: string;
  certainty?: string;
  onset?: string;
  expires?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  senderName?: string;
  /** Affected area descriptions (one per CAP `area` entry). */
  areaDesc: string[];
  sent?: string;
}

/** An entry in the MeteoAlarm membership map (country → feed). */
export interface MeteoAlarmCountryFeed {
  /** Feed slug: hyphenated lowercase English country name (`united-kingdom`). */
  slug: string;
  /** Display name for headings ("Germany"). */
  name: string;
  /** National meteorological service, for the attribution footer, where known. */
  service?: string;
}
