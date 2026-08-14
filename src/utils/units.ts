/**
 * Utility functions for unit conversion and formatting
 */

import { QuantitativeValue } from '../types/noaa.js';

/**
 * Extract numeric value from QuantitativeValue, handling null values
 */
export function extractValue(qv: QuantitativeValue | undefined): number | null {
  if (!qv || qv.value === null || qv.value === undefined) {
    return null;
  }
  return qv.value;
}

/**
 * Convert Celsius to Fahrenheit
 */
export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9/5) + 32;
}

/**
 * Convert meters per second to miles per hour
 */
export function mpsToMph(mps: number): number {
  return mps * 2.23694;
}

/**
 * Convert kilometers per hour to miles per hour
 */
export function kphToMph(kph: number): number {
  return kph * 0.621371;
}

/**
 * Convert knots to miles per hour
 */
export function knotsToMph(knots: number): number {
  return knots * 1.15078;
}

/**
 * Convert meters to miles
 */
export function metersToMiles(meters: number): number {
  return meters * 0.000621371;
}

/**
 * Convert meters to feet
 */
export function metersToFeet(meters: number): number {
  return meters * 3.28084;
}

/**
 * Convert cubic meters per second to cubic feet per second
 */
export function cubicMetersPerSecondToCubicFeetPerSecond(cms: number): number {
  return cms * 35.3147;
}

/**
 * Convert Pascals to inches of mercury
 */
export function pascalsToInHg(pa: number): number {
  return pa * 0.0002953;
}

/**
 * Convert Pascals to millibars/hectopascals
 */
export function pascalsToMb(pa: number): number {
  return pa / 100;
}

/**
 * Format temperature with unit
 */
export function formatTemperature(qv: QuantitativeValue | undefined, preferFahrenheit = true): string {
  const value = extractValue(qv);
  if (value === null) return 'N/A';

  // NOAA returns temperature in Celsius in unitCode format "wmoUnit:degC"
  if (qv?.unitCode?.includes('degC')) {
    if (preferFahrenheit) {
      return `${Math.round(celsiusToFahrenheit(value))}°F`;
    }
    return `${Math.round(value)}°C`;
  }

  // If already in Fahrenheit
  return `${Math.round(value)}°F`;
}

/**
 * Format wind speed with unit
 */
export function formatWindSpeed(qv: QuantitativeValue | undefined): string {
  const value = extractValue(qv);
  if (value === null) return 'Calm';

  // Convert to mph if needed
  let mph = value;
  if (qv?.unitCode?.includes('km_h')) {
    mph = kphToMph(value);
  } else if (qv?.unitCode?.includes('m_s')) {
    mph = mpsToMph(value);
  }

  return `${Math.round(mph)} mph`;
}

/**
 * Format visibility with unit
 */
export function formatVisibility(qv: QuantitativeValue | undefined): string {
  const value = extractValue(qv);
  if (value === null) return 'N/A';

  // Convert meters to miles
  const miles = metersToMiles(value);
  return `${miles.toFixed(1)} miles`;
}

/**
 * Format pressure with unit
 */
export function formatPressure(qv: QuantitativeValue | undefined): string {
  const value = extractValue(qv);
  if (value === null) return 'N/A';

  // Convert Pascals to inHg
  const inHg = pascalsToInHg(value);
  return `${inHg.toFixed(2)} inHg`;
}

/**
 * Format a percentage value
 */
export function formatPercentage(qv: QuantitativeValue | undefined): string {
  const value = extractValue(qv);
  if (value === null) return 'N/A';

  return `${Math.round(value)}%`;
}

/**
 * Reduce a bearing in degrees to one of sixteen compass points.
 */
export function windDirectionFromDegrees(deg: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(deg / 22.5) % 16;
  return directions[index];
}

/**
 * Format wind direction from degrees to cardinal direction
 */
export function formatWindDirection(qv: QuantitativeValue | undefined): string {
  const degrees = extractValue(qv);
  if (degrees === null) return 'Variable';

  return windDirectionFromDegrees(degrees);
}

/**
 * Format date/time in readable format
 */
export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

/**
 * Format date only
 */
export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Relative humidity from temperature and dew point, via the Magnus formula.
 * METAR carries no humidity field; this restores it from the two it does
 * report. Returns whole percent, clamped to 0-100.
 */
export function relativeHumidityFromDewpoint(tempC: number, dewpC: number): number {
  const a = 17.625;
  const b = 243.04;
  const gamma = (a * dewpC) / (b + dewpC) - (a * tempC) / (b + tempC);
  const rh = 100 * Math.exp(gamma);
  return Math.min(100, Math.max(0, Math.round(rh)));
}
