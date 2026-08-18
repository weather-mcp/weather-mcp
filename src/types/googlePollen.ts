/**
 * Google Pollen API response types
 *
 * Subset-only TypeScript interfaces for the Google Pollen API `v1/forecast:lookup`
 * response. All fields are optional as a defensive measure.
 *
 * Important: `indexInfo` is **omitted entirely** for out-of-season pollen types
 * (upstream design D3/C). Every use of `indexInfo` must guard against undefined.
 *
 * Field casing is web-verified (2026-08-18). Exact casing is on the T6
 * live-verification to-verify list.
 *
 * Reference: https://developers.google.com/maps/documentation/pollen/overview
 */

/**
 * Top-level response from the Google Pollen API
 */
export interface GooglePollenResponse {
  dailyInfo?: GooglePollenDailyInfo[];
}

/**
 * Daily pollen information for a single date
 */
export interface GooglePollenDailyInfo {
  date?: GooglePollenDate;
  pollenTypeInfo?: GooglePollenTypeInfo[];
  plantInfo?: GooglePollenPlantInfo[];
}

/**
 * Date representation matching Google's Date message format
 */
export interface GooglePollenDate {
  year?: number;
  month?: number;
  day?: number;
}

/**
 * Pollen type information (GRASS, TREE, WEED)
 */
export interface GooglePollenTypeInfo {
  code?: string; // e.g., "GRASS", "TREE", "WEED"
  displayName?: string;
  inSeason?: boolean;
  indexInfo?: GooglePollenIndexInfo;
}

/**
 * Universal Pollen Index (UPI) information
 *
 * `value` is a number 0-5 indicating pollen levels.
 * `category` is a human-readable string like "Low", "Moderate", "High", "Very High".
 *
 * Note: This field is omitted entirely for out-of-season pollen types.
 * All uses must guard: `if (typeInfo.indexInfo?.value !== undefined)`
 */
export interface GooglePollenIndexInfo {
  value?: number;
  category?: string;
}

/**
 * Plant-specific pollen information
 */
export interface GooglePollenPlantInfo {
  displayName?: string;
  inSeason?: boolean;
  indexInfo?: GooglePollenIndexInfo;
}
