/**
 * Type definitions for the NOAA NCEI Climate Data Online (CDO) API v2.
 *
 * Documentation: https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation
 */

/**
 * Pagination/result metadata returned by CDO list endpoints.
 */
export interface NCEIResultMetadata {
  resultset?: {
    offset: number;
    count: number;
    limit: number;
  };
}

/**
 * A weather station as returned by the CDO /stations endpoint.
 */
export interface NCEIStation {
  id: string; // e.g. "GHCND:USW00024233"
  name: string; // e.g. "SEATTLE TACOMA AIRPORT, WA US"
  latitude: number;
  longitude: number;
  elevation?: number;
  datacoverage?: number; // 0..1 fraction of available data
  mindate?: string; // ISO date
  maxdate?: string; // ISO date
}

/**
 * Response from the CDO /stations endpoint.
 */
export interface NCEIStationsResponse {
  metadata?: NCEIResultMetadata;
  results?: NCEIStation[];
}

/**
 * A single climate-normals data value from the CDO /data endpoint.
 */
export interface NCEIDataPoint {
  date: string; // ISO datetime (reference year, e.g. "2010-07-15T00:00:00")
  datatype: string; // e.g. "DLY-TMAX-NORMAL"
  station: string;
  attributes?: string;
  value: number;
}

/**
 * Response from the CDO /data endpoint.
 */
export interface NCEIDataResponse {
  metadata?: NCEIResultMetadata;
  results?: NCEIDataPoint[];
}

/**
 * A station annotated with its distance (km) from a query point.
 */
export interface NCEIStationWithDistance extends NCEIStation {
  distanceKm: number;
}
