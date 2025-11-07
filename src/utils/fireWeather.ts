/**
 * Fire weather utility functions for interpreting fire danger indices
 */

/**
 * Haines Index category information
 * The Haines Index measures atmospheric stability and dryness that affect fire growth potential
 * Scale: 2-6 (Low, Moderate, High fire growth potential)
 */
export interface HainesCategory {
  level: string;
  description: string;
  fireGrowthPotential: string;
  color: string;
}

/**
 * Get Haines Index category
 * Haines Index: 2-6 scale measuring atmospheric contribution to fire growth
 * - Low elevation (< 3,000 ft): 2-3 = Low, 4 = Moderate, 5-6 = High
 * - Mid elevation (3,000-10,000 ft): Same scale
 * - High elevation (> 10,000 ft): Same scale
 */
export function getHainesCategory(hainesValue: number): HainesCategory {
  if (hainesValue <= 3) {
    return {
      level: 'Low',
      description: 'Low fire growth potential',
      fireGrowthPotential: 'Very low likelihood of large plume-dominated fire growth. Fires should remain relatively easy to control.',
      color: 'Green'
    };
  } else if (hainesValue === 4) {
    return {
      level: 'Moderate',
      description: 'Moderate fire growth potential',
      fireGrowthPotential: 'Moderate likelihood of plume-dominated fire growth. Fires may develop rapidly and become difficult to control.',
      color: 'Yellow'
    };
  } else if (hainesValue === 5) {
    return {
      level: 'High',
      description: 'High fire growth potential',
      fireGrowthPotential: 'High likelihood of plume-dominated fire growth. Fires may exhibit extreme behavior and become very difficult to control.',
      color: 'Orange'
    };
  } else {
    return {
      level: 'Very High',
      description: 'Very high fire growth potential',
      fireGrowthPotential: 'Very high likelihood of extreme fire behavior. Fires will likely exhibit blow-up characteristics and be extremely difficult to control.',
      color: 'Red'
    };
  }
}

/**
 * Get grassland fire danger category
 * Scale: 1-4 (Low, Moderate, High, Very High)
 */
export function getGrasslandFireDangerCategory(value: number): {
  level: string;
  description: string;
  color: string;
} {
  if (value <= 1) {
    return {
      level: 'Low',
      description: 'Low fire danger in grassland/rangeland fuels',
      color: 'Green'
    };
  } else if (value === 2) {
    return {
      level: 'Moderate',
      description: 'Moderate fire danger in grassland/rangeland fuels',
      color: 'Yellow'
    };
  } else if (value === 3) {
    return {
      level: 'High',
      description: 'High fire danger in grassland/rangeland fuels',
      color: 'Orange'
    };
  } else {
    return {
      level: 'Very High',
      description: 'Very high fire danger in grassland/rangeland fuels',
      color: 'Red'
    };
  }
}

/**
 * Get red flag threat index category
 * Indicates potential for Red Flag Warning conditions
 */
export function getRedFlagCategory(value: number): {
  level: string;
  description: string;
  color: string;
} {
  if (value < 30) {
    return {
      level: 'Low',
      description: 'Low threat of Red Flag Warning conditions',
      color: 'Green'
    };
  } else if (value < 60) {
    return {
      level: 'Moderate',
      description: 'Moderate threat of Red Flag Warning conditions',
      color: 'Yellow'
    };
  } else if (value < 80) {
    return {
      level: 'High',
      description: 'High threat of Red Flag Warning conditions',
      color: 'Orange'
    };
  } else {
    return {
      level: 'Very High',
      description: 'Very high threat - Red Flag Warning likely',
      color: 'Red'
    };
  }
}

/**
 * Get current fire weather value from gridpoint data series
 * Returns the value for the current time period
 */
export function getCurrentFireWeatherValue(dataSeries: { values: Array<{ validTime: string; value: number }> } | undefined): number | null {
  if (!dataSeries || !dataSeries.values || dataSeries.values.length === 0) {
    return null;
  }

  // Get the first value (most recent/current)
  // NOAA gridpoint data is ordered with current/near-future values first
  return dataSeries.values[0]?.value ?? null;
}

/**
 * Format mixing height value
 * Mixing height indicates how high smoke and pollutants can rise
 * Higher is generally better for smoke dispersion
 */
export function formatMixingHeight(heightFt: number | null): string {
  if (heightFt === null) {
    return 'N/A';
  }

  if (heightFt < 1000) {
    return `${Math.round(heightFt)} ft (very poor dispersion)`;
  } else if (heightFt < 3000) {
    return `${Math.round(heightFt)} ft (poor dispersion)`;
  } else if (heightFt < 6000) {
    return `${Math.round(heightFt)} ft (moderate dispersion)`;
  } else {
    return `${Math.round(heightFt)} ft (good dispersion)`;
  }
}

/**
 * Interpret transport wind speed for fire behavior
 * Transport winds carry smoke and can influence fire spread
 */
export function interpretTransportWind(speedMph: number | null): string {
  if (speedMph === null) {
    return 'N/A';
  }

  if (speedMph < 5) {
    return `${Math.round(speedMph)} mph (light - poor smoke transport)`;
  } else if (speedMph < 15) {
    return `${Math.round(speedMph)} mph (moderate smoke transport)`;
  } else if (speedMph < 25) {
    return `${Math.round(speedMph)} mph (good smoke transport)`;
  } else {
    return `${Math.round(speedMph)} mph (strong - rapid fire spread potential)`;
  }
}
