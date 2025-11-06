/**
 * Input validation utilities for API parameters
 * Provides runtime type checking and sanitization
 */

import { FormatConstants } from '../config/displayThresholds.js';

/**
 * Validate that latitude is a valid number within range
 * @param lat - Latitude value to validate
 * @throws {Error} If latitude is invalid
 */
export function validateLatitude(lat: unknown): asserts lat is number {
  if (typeof lat !== 'number' || !Number.isFinite(lat)) {
    throw new Error(`Invalid latitude: must be a finite number, received ${typeof lat}`);
  }
  if (lat < -90 || lat > 90) {
    throw new Error(`Invalid latitude: ${lat}. Must be between -90 and 90.`);
  }
}

/**
 * Validate that longitude is a valid number within range
 * @param lon - Longitude value to validate
 * @throws {Error} If longitude is invalid
 */
export function validateLongitude(lon: unknown): asserts lon is number {
  if (typeof lon !== 'number' || !Number.isFinite(lon)) {
    throw new Error(`Invalid longitude: must be a finite number, received ${typeof lon}`);
  }
  if (lon < -180 || lon > 180) {
    throw new Error(`Invalid longitude: ${lon}. Must be between -180 and 180.`);
  }
}

/**
 * Validate coordinate pair
 * @param args - Arguments object potentially containing coordinates
 * @returns Validated coordinates
 * @throws {Error} If coordinates are invalid
 */
export function validateCoordinates(args: unknown): { latitude: number; longitude: number } {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Invalid arguments: expected object with latitude and longitude');
  }

  const { latitude, longitude } = args as Record<string, unknown>;

  validateLatitude(latitude);
  validateLongitude(longitude);

  return { latitude, longitude };
}

/**
 * Validate a positive integer within optional range
 * @param value - Value to validate
 * @param name - Parameter name for error messages
 * @param min - Minimum allowed value (inclusive)
 * @param max - Maximum allowed value (inclusive)
 * @returns Validated number
 * @throws {Error} If value is invalid
 */
export function validatePositiveInteger(
  value: unknown,
  name: string,
  min: number = 1,
  max: number = Number.MAX_SAFE_INTEGER
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: must be a finite number, received ${typeof value}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid ${name}: must be an integer, received ${value}`);
  }
  if (value < min || value > max) {
    throw new Error(`Invalid ${name}: ${value}. Must be between ${min} and ${max}.`);
  }
  return value;
}

/**
 * Validate a boolean value
 * @param value - Value to validate
 * @param name - Parameter name for error messages
 * @returns Validated boolean
 * @throws {Error} If value is invalid
 */
export function validateBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${name}: must be a boolean, received ${typeof value}`);
  }
  return value;
}

/**
 * Validate a date string in ISO format
 * @param value - Value to validate
 * @param name - Parameter name for error messages
 * @returns Validated date string
 * @throws {Error} If value is invalid
 */
export function validateDateString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${name}: must be a string, received ${typeof value}`);
  }

  // Check if it's a valid date format (YYYY-MM-DD or ISO 8601)
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ${name}: "${value}" is not a valid date format`);
  }

  return value;
}

/**
 * Validate forecast days parameter
 * @param args - Arguments object potentially containing days parameter
 * @returns Validated days value (defaults to 7 if not provided)
 * @throws {Error} If days parameter is invalid
 */
export function validateForecastDays(args: unknown): number {
  if (typeof args !== 'object' || args === null) {
    return FormatConstants.defaultForecastDays;
  }

  const { days } = args as Record<string, unknown>;

  if (days === undefined) {
    return FormatConstants.defaultForecastDays;
  }

  return validatePositiveInteger(days, 'days', 1, FormatConstants.defaultForecastDays);
}

/**
 * Validate granularity parameter
 * @param value - Value to validate
 * @returns Validated granularity ('daily' or 'hourly')
 * @throws {Error} If value is invalid
 */
export function validateGranularity(value: unknown): 'daily' | 'hourly' {
  if (value === undefined) {
    return 'daily'; // default
  }

  if (typeof value !== 'string') {
    throw new Error(`Invalid granularity: must be a string, received ${typeof value}`);
  }

  if (value !== 'daily' && value !== 'hourly') {
    throw new Error(`Invalid granularity: "${value}". Must be either "daily" or "hourly".`);
  }

  return value;
}

/**
 * Validate optional boolean with default
 * @param value - Value to validate
 * @param name - Parameter name for error messages
 * @param defaultValue - Default value if undefined
 * @returns Validated boolean
 * @throws {Error} If value is invalid
 */
export function validateOptionalBoolean(
  value: unknown,
  name: string,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return validateBoolean(value, name);
}

/**
 * Validate historical weather parameters
 * @param args - Arguments object
 * @returns Validated parameters
 * @throws {Error} If parameters are invalid
 */
export function validateHistoricalWeatherParams(args: unknown): {
  latitude: number;
  longitude: number;
  start_date: string;
  end_date: string;
  limit?: number;
} {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Invalid arguments: expected object with coordinates and date range');
  }

  const { latitude, longitude, start_date, end_date, limit } = args as Record<string, unknown>;

  validateLatitude(latitude);
  validateLongitude(longitude);

  const validatedStartDate = validateDateString(start_date, 'start_date');
  const validatedEndDate = validateDateString(end_date, 'end_date');

  // Ensure start_date is before end_date
  if (new Date(validatedStartDate) > new Date(validatedEndDate)) {
    throw new Error('Invalid date range: start_date must be before or equal to end_date');
  }

  const result: {
    latitude: number;
    longitude: number;
    start_date: string;
    end_date: string;
    limit?: number;
  } = {
    latitude,
    longitude,
    start_date: validatedStartDate,
    end_date: validatedEndDate,
  };

  if (limit !== undefined) {
    result.limit = validatePositiveInteger(limit, 'limit', 1, FormatConstants.maxHistoricalLimit);
  }

  return result;
}
