/**
 * Utility functions for computing climate normals from historical data
 *
 * Climate normals are 30-year averages (1991-2020) used to provide
 * context for current weather conditions.
 *
 * Hybrid Strategy:
 * 1. Try NCEI (US only, requires token) for official normals
 * 2. Fall back to Open-Meteo (global, no token) computed normals
 */

import type { OpenMeteoHistoricalResponse, ClimateNormals } from '../types/openmeteo.js';
import { celsiusToFahrenheit } from './units.js';
import type { OpenMeteoService } from '../services/openmeteo.js';
import type { NCEIService } from '../services/ncei.js';
import { logger } from './logger.js';

/**
 * Convert millimeters to inches
 */
function millimetersToInches(mm: number): number {
  return mm / 25.4;
}

/**
 * Compute climate normals from 30 years of historical data
 *
 * @param historicalData - 30 years of daily historical weather data from Open-Meteo
 * @param targetMonth - Month (1-12) to compute normals for
 * @param targetDay - Day of month (1-31) to compute normals for
 * @returns Climate normals (30-year averages) for the specified date
 */
export function computeNormalsFrom30YearData(
  historicalData: OpenMeteoHistoricalResponse,
  targetMonth: number,
  targetDay: number
): ClimateNormals {
  if (!historicalData.daily || !historicalData.daily.time) {
    throw new Error('Historical data does not contain daily data');
  }

  const daily = historicalData.daily;
  const targetMonthDay = `${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;

  // Find all occurrences of this month/day across the 30-year period
  const matchingDays: {
    tempHigh?: number;
    tempLow?: number;
    precipitation?: number;
  }[] = [];

  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i]; // Format: "YYYY-MM-DD"
    const monthDay = date.substring(5); // Extract "MM-DD"

    if (monthDay === targetMonthDay) {
      matchingDays.push({
        tempHigh: daily.temperature_2m_max?.[i],
        tempLow: daily.temperature_2m_min?.[i],
        precipitation: daily.precipitation_sum?.[i]
      });
    }
  }

  if (matchingDays.length === 0) {
    throw new Error(`No historical data found for ${targetMonth}/${targetDay}`);
  }

  // Calculate averages
  const tempHighValues = matchingDays.filter(d => d.tempHigh !== undefined).map(d => d.tempHigh!);
  const tempLowValues = matchingDays.filter(d => d.tempLow !== undefined).map(d => d.tempLow!);
  const precipitationValues = matchingDays.filter(d => d.precipitation !== undefined).map(d => d.precipitation!);

  const avgTempHighC = tempHighValues.reduce((sum, val) => sum + val, 0) / tempHighValues.length;
  const avgTempLowC = tempLowValues.reduce((sum, val) => sum + val, 0) / tempLowValues.length;
  const avgPrecipitationMm = precipitationValues.reduce((sum, val) => sum + val, 0) / precipitationValues.length;

  // Convert to US units (Fahrenheit, inches)
  const tempHigh = Math.round(celsiusToFahrenheit(avgTempHighC));
  const tempLow = Math.round(celsiusToFahrenheit(avgTempLowC));
  const precipitation = Math.round(millimetersToInches(avgPrecipitationMm) * 100) / 100; // Round to 2 decimals

  return {
    tempHigh,
    tempLow,
    precipitation,
    source: 'Open-Meteo',
    month: targetMonth,
    day: targetDay
  };
}

/**
 * Generate a cache key for climate normals
 *
 * @param latitude - Latitude (rounded to 2 decimals)
 * @param longitude - Longitude (rounded to 2 decimals)
 * @param month - Month (1-12)
 * @param day - Day of month (1-31)
 * @returns Cache key string
 */
export function getNormalsCacheKey(
  latitude: number,
  longitude: number,
  month: number,
  day: number
): string {
  // Round coordinates to 2 decimals to increase cache hit rate
  const lat = Math.round(latitude * 100) / 100;
  const lon = Math.round(longitude * 100) / 100;
  return `normals:${lat}:${lon}:${month}:${day}`;
}

/**
 * Calculate departure from normal
 *
 * @param actual - Actual temperature value
 * @param normal - Normal (average) temperature value
 * @returns Departure with sign (e.g., +10, -5)
 */
export function calculateDeparture(actual: number, normal: number): string {
  const departure = Math.round(actual - normal);
  return departure >= 0 ? `+${departure}` : `${departure}`;
}

/**
 * Format climate normals for display
 *
 * @param normals - Climate normals data
 * @param currentTemp - Optional current temperature for comparison
 * @returns Formatted markdown string
 */
export function formatNormals(
  normals: ClimateNormals,
  currentTemp?: { high?: number; low?: number }
): string {
  let output = `\n## 📊 Climate Context\n\n`;
  output += `**Normal High:** ${normals.tempHigh}°F\n`;
  output += `**Normal Low:** ${normals.tempLow}°F\n`;
  output += `**Normal Precipitation:** ${normals.precipitation}" \n`;

  if (currentTemp) {
    if (currentTemp.high !== undefined) {
      const departure = calculateDeparture(currentTemp.high, normals.tempHigh);
      output += `**High Departure:** ${departure}°F`;
      if (departure.startsWith('+')) {
        output += ` (warmer than normal)`;
      } else if (departure.startsWith('-')) {
        output += ` (cooler than normal)`;
      }
      output += `\n`;
    }

    if (currentTemp.low !== undefined) {
      const departure = calculateDeparture(currentTemp.low, normals.tempLow);
      output += `**Low Departure:** ${departure}°F`;
      if (departure.startsWith('+')) {
        output += ` (warmer than normal)`;
      } else if (departure.startsWith('-')) {
        output += ` (cooler than normal)`;
      }
      output += `\n`;
    }
  }

  output += `\n*Climate normals based on 1991-2020 data*\n`;
  output += `*Source: ${normals.source}*\n`;

  return output;
}

/**
 * Get date components from Date object or ISO string
 *
 * @param date - Date object or ISO string
 * @returns Object with month (1-12) and day (1-31)
 */
export function getDateComponents(date: Date | string): { month: number; day: number } {
  const d = typeof date === 'string' ? new Date(date) : date;
  return {
    month: d.getMonth() + 1, // JavaScript months are 0-indexed
    day: d.getDate()
  };
}

/**
 * Check if coordinates are within the contiguous United States
 *
 * @param latitude - Latitude
 * @param longitude - Longitude
 * @returns true if location is in contiguous US
 */
export function isLocationInUS(latitude: number, longitude: number): boolean {
  // Contiguous US bounding box (approximate)
  // Latitude: ~25°N (Florida) to ~49°N (Canada border)
  // Longitude: ~-125°W (Pacific) to ~-66°W (Atlantic)
  return (
    latitude >= 24 &&
    latitude <= 50 &&
    longitude >= -125 &&
    longitude <= -66
  );
}

/**
 * Get climate normals using hybrid strategy
 *
 * Strategy:
 * 1. If location is in US and NCEI token available, try NCEI first
 * 2. Fall back to Open-Meteo computed normals (always works)
 *
 * @param openMeteoService - Open-Meteo service instance
 * @param nceiService - NCEI service instance (optional)
 * @param latitude - Latitude
 * @param longitude - Longitude
 * @param month - Month (1-12)
 * @param day - Day of month (1-31)
 * @returns Climate normals with source indication
 */
export async function getClimateNormals(
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService | undefined,
  latitude: number,
  longitude: number,
  month: number,
  day: number
): Promise<ClimateNormals> {
  // Try NCEI if available and location is in US
  if (nceiService && nceiService.isAvailable() && isLocationInUS(latitude, longitude)) {
    try {
      logger.info('Attempting to fetch climate normals from NCEI', {
        latitude,
        longitude,
        month,
        day
      });

      const normals = await nceiService.getClimateNormals(latitude, longitude, month, day);
      logger.info('Successfully retrieved climate normals from NCEI', {
        latitude,
        longitude,
        month,
        day
      });

      return normals;
    } catch (error) {
      // NCEI failed, fall back to Open-Meteo
      logger.warn('NCEI climate normals failed, falling back to Open-Meteo', {
        latitude,
        longitude,
        month,
        day,
        error: (error as Error).message
      });
    }
  }

  // Use Open-Meteo (default, always works)
  logger.info('Using Open-Meteo for climate normals', {
    latitude,
    longitude,
    month,
    day,
    reason: nceiService && nceiService.isAvailable()
      ? 'NCEI fallback'
      : !isLocationInUS(latitude, longitude)
        ? 'Location outside US'
        : 'NCEI token not configured'
  });

  return await openMeteoService.getClimateNormals(latitude, longitude, month, day);
}
