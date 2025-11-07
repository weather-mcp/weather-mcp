/**
 * Utility functions for extracting and formatting snow data
 * from NOAA API responses
 */

import { GridpointProperties, ObservationProperties } from '../types/noaa.js';

/**
 * Snow data extracted from observations or gridpoint forecasts
 */
export interface SnowData {
  snowDepth?: {
    value: number; // in inches
    unit: string; // "in"
  };
  snowfallAmount?: {
    value: number; // in inches
    unit: string; // "in"
    period?: string; // time period (e.g., "Next 6 hours", "Today")
  };
  iceAccumulation?: {
    value: number; // in inches
    unit: string; // "in"
    period?: string;
  };
}

/**
 * Convert millimeters to inches
 */
function mmToInches(mm: number): number {
  return mm / 25.4;
}

/**
 * Extract current snow depth from observation data
 */
export function extractSnowDepth(observation: ObservationProperties): SnowData['snowDepth'] | undefined {
  if (!observation.snowDepth || observation.snowDepth.value === null) {
    return undefined;
  }

  // NOAA returns snow depth in various units, but typically centimeters or meters
  const value = observation.snowDepth.value;
  const unit = observation.snowDepth.unitCode;

  let inches: number;
  if (unit?.includes('cm') || unit?.includes('centimeter')) {
    inches = value / 2.54; // cm to inches
  } else if (unit?.includes('m') && !unit?.includes('mm')) {
    inches = value * 39.3701; // meters to inches
  } else if (unit?.includes('mm') || unit?.includes('millimeter')) {
    inches = mmToInches(value);
  } else {
    // Assume centimeters if unit unclear
    inches = value / 2.54;
  }

  // Only return if there's actually snow on the ground
  if (inches < 0.1) {
    return undefined;
  }

  return {
    value: Math.round(inches * 10) / 10, // Round to 1 decimal
    unit: 'in'
  };
}

/**
 * Extract snowfall forecast from gridpoint data for a specific time period
 */
export function extractSnowfallForecast(
  gridpoint: GridpointProperties,
  startTime?: Date,
  endTime?: Date
): SnowData['snowfallAmount'] | undefined {
  if (!gridpoint.snowfallAmount || gridpoint.snowfallAmount.values.length === 0) {
    return undefined;
  }

  let totalSnowfall = 0;
  const snowfallSeries = gridpoint.snowfallAmount;

  for (const entry of snowfallSeries.values) {
    if (entry.value === null || entry.value === undefined) {
      continue;
    }

    // Parse the time interval (e.g., "2025-11-07T12:00:00+00:00/PT6H")
    const [validTimeStr] = entry.validTime.split('/');
    const validTime = new Date(validTimeStr);

    // If we have a time range filter, check if this entry is within it
    if (startTime && validTime < startTime) {
      continue;
    }
    if (endTime && validTime > endTime) {
      continue;
    }

    totalSnowfall += entry.value;
  }

  // NOAA returns snowfall in millimeters
  const inches = mmToInches(totalSnowfall);

  // Only return if there's meaningful snowfall
  if (inches < 0.1) {
    return undefined;
  }

  return {
    value: Math.round(inches * 10) / 10, // Round to 1 decimal
    unit: 'in',
    period: startTime && endTime ?
      `${startTime.toLocaleDateString()} - ${endTime.toLocaleDateString()}` :
      undefined
  };
}

/**
 * Extract ice accumulation forecast from gridpoint data
 */
export function extractIceAccumulation(
  gridpoint: GridpointProperties,
  startTime?: Date,
  endTime?: Date
): SnowData['iceAccumulation'] | undefined {
  if (!gridpoint.iceAccumulation || gridpoint.iceAccumulation.values.length === 0) {
    return undefined;
  }

  let totalIce = 0;
  const iceSeries = gridpoint.iceAccumulation;

  for (const entry of iceSeries.values) {
    if (entry.value === null || entry.value === undefined) {
      continue;
    }

    const [validTimeStr] = entry.validTime.split('/');
    const validTime = new Date(validTimeStr);

    if (startTime && validTime < startTime) {
      continue;
    }
    if (endTime && validTime > endTime) {
      continue;
    }

    totalIce += entry.value;
  }

  // NOAA returns ice accumulation in millimeters
  const inches = mmToInches(totalIce);

  // Only return if there's meaningful ice accumulation
  if (inches < 0.05) {
    return undefined;
  }

  return {
    value: Math.round(inches * 100) / 100, // Round to 2 decimals (ice is often small amounts)
    unit: 'in',
    period: startTime && endTime ?
      `${startTime.toLocaleDateString()} - ${endTime.toLocaleDateString()}` :
      undefined
  };
}

/**
 * Format snow data for display
 */
export function formatSnowData(snowData: SnowData): string {
  const parts: string[] = [];

  if (snowData.snowDepth) {
    parts.push(`**Snow Depth:** ${snowData.snowDepth.value}${snowData.snowDepth.unit} on ground`);
  }

  if (snowData.snowfallAmount) {
    const period = snowData.snowfallAmount.period ? ` (${snowData.snowfallAmount.period})` : '';
    parts.push(`**Snowfall Forecast:** ${snowData.snowfallAmount.value}${snowData.snowfallAmount.unit}${period}`);
  }

  if (snowData.iceAccumulation) {
    const period = snowData.iceAccumulation.period ? ` (${snowData.iceAccumulation.period})` : '';
    parts.push(`**Ice Accumulation:** ${snowData.iceAccumulation.value}${snowData.iceAccumulation.unit}${period}`);
  }

  return parts.length > 0 ? `\n## ❄️ Winter Weather\n\n${parts.join('\n')}\n` : '';
}

/**
 * Check if there's any significant winter weather to report
 */
export function hasWinterWeather(snowData: SnowData): boolean {
  return !!(snowData.snowDepth || snowData.snowfallAmount || snowData.iceAccumulation);
}
