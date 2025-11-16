/**
 * TypeScript type definitions for saved/favorite locations
 */

/**
 * A saved location with coordinates and metadata
 */
export interface SavedLocation {
  /** User-friendly name for the location */
  name: string;
  /** Latitude coordinate */
  latitude: number;
  /** Longitude coordinate */
  longitude: number;
  /** Timezone identifier (e.g., "America/Los_Angeles") */
  timezone?: string;
  /** Country code (e.g., "US", "GB") */
  country_code?: string;
  /** State/province/region */
  admin1?: string;
  /** County or equivalent */
  admin2?: string;
  /** When this location was saved */
  saved_at: string;
  /** When this location was last updated */
  updated_at: string;
}

/**
 * Collection of saved locations keyed by alias
 */
export interface SavedLocationsStore {
  [alias: string]: SavedLocation;
}

/**
 * Result from saving a location
 */
export interface SaveLocationResult {
  success: boolean;
  alias: string;
  location: SavedLocation;
  message: string;
}

/**
 * Result from removing a location
 */
export interface RemoveLocationResult {
  success: boolean;
  alias: string;
  message: string;
}
