/**
 * TypeScript type definitions for the Nominatim error and Reverse API responses
 * API Documentation: https://nominatim.org/release-docs/latest/api/Reverse/
 */

/**
 * Error response from Nominatim API
 */
export interface NominatimErrorResponse {
  error: string;
}

/**
 * Address fields used from the Nominatim Reverse API (jsonv2), country
 * resolution only — a minimal subset of the full jsonv2 address shape.
 */
export interface NominatimReverseAddress {
  country_code?: string;
}

/**
 * Response shape from the Nominatim Reverse API (jsonv2), country
 * resolution only.
 *
 * Open ocean / unresolvable coordinates return HTTP 200 with only `error`
 * set (e.g. `{"error": "Unable to geocode"}`) — a result, not a failure.
 */
export interface NominatimReverseResponse {
  error?: string;
  address?: NominatimReverseAddress;
}
