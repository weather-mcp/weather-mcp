/**
 * TypeScript type definitions for Nominatim Geocoding API
 * API Documentation: https://nominatim.org/release-docs/latest/api/Search/
 */

/**
 * Address components from Nominatim response
 */
export interface NominatimAddress {
  house_number?: string;
  road?: string;
  suburb?: string;
  village?: string;
  town?: string;
  city?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

/**
 * Single location result from Nominatim Search API
 */
export interface NominatimLocation {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: NominatimAddress;
  boundingbox?: string[];
  class?: string;
  type?: string;
  importance?: number;
  icon?: string;
}

/**
 * Error response from Nominatim API
 */
export interface NominatimErrorResponse {
  error: string;
}

/**
 * Mapped location result for compatibility with existing GeocodingLocation interface
 */
export interface MappedGeocodingLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  feature_code?: string;
  country_code?: string;
  country?: string;
  timezone?: string;
  population?: number;
  admin1?: string;
  admin2?: string;
  admin3?: string;
  admin4?: string;
}

/**
 * Response format compatible with existing GeocodingResponse interface
 */
export interface MappedGeocodingResponse {
  results?: MappedGeocodingLocation[];
  generationtime_ms?: number;
}
