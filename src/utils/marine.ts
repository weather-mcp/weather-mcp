/**
 * Utility functions for marine conditions data formatting and interpretation
 */

/**
 * Format wave height with appropriate units and precision
 */
export function formatWaveHeight(meters: number | undefined): string {
  if (meters === undefined || meters === null) {
    return 'N/A';
  }

  const feet = meters * 3.28084;
  return `${meters.toFixed(1)}m (${feet.toFixed(1)}ft)`;
}

/**
 * Format wave period with units
 */
export function formatWavePeriod(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null) {
    return 'N/A';
  }

  return `${seconds.toFixed(1)}s`;
}

/**
 * Format ocean current velocity
 */
export function formatCurrentVelocity(metersPerSecond: number | undefined): string {
  if (metersPerSecond === undefined || metersPerSecond === null) {
    return 'N/A';
  }

  // Convert m/s to knots (1 m/s = 1.94384 knots)
  const knots = metersPerSecond * 1.94384;
  return `${metersPerSecond.toFixed(2)} m/s (${knots.toFixed(2)} knots)`;
}

/**
 * Convert degrees to cardinal/ordinal direction
 */
export function formatDirection(degrees: number | undefined): string {
  if (degrees === undefined || degrees === null) {
    return 'N/A';
  }

  const directions = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW'
  ];

  // Normalize to 0-360
  const normalized = ((degrees % 360) + 360) % 360;

  // Calculate index (16 directions, each 22.5 degrees)
  const index = Math.round(normalized / 22.5) % 16;

  return `${directions[index]} (${Math.round(normalized)}°)`;
}

/**
 * Categorize wave height
 */
export interface WaveHeightCategory {
  description: string;
  level: string;
  recommendation: string;
}

export function getWaveHeightCategory(meters: number | undefined): WaveHeightCategory {
  if (meters === undefined || meters === null) {
    return {
      description: 'Unknown',
      level: 'Unknown',
      recommendation: 'No data available'
    };
  }

  // Based on WMO Sea State Code and Douglas Sea Scale
  if (meters < 0.1) {
    return {
      description: 'Calm (glassy)',
      level: 'Calm',
      recommendation: 'Ideal for all water activities'
    };
  } else if (meters < 0.5) {
    return {
      description: 'Calm (rippled)',
      level: 'Calm',
      recommendation: 'Excellent conditions for all vessels'
    };
  } else if (meters < 1.25) {
    return {
      description: 'Smooth',
      level: 'Slight',
      recommendation: 'Good conditions for most activities'
    };
  } else if (meters < 2.5) {
    return {
      description: 'Slight',
      level: 'Moderate',
      recommendation: 'Safe for experienced boaters'
    };
  } else if (meters < 4.0) {
    return {
      description: 'Moderate',
      level: 'Moderate',
      recommendation: 'Use caution, especially for small craft'
    };
  } else if (meters < 6.0) {
    return {
      description: 'Rough',
      level: 'Rough',
      recommendation: 'Hazardous for small vessels, secure all gear'
    };
  } else if (meters < 9.0) {
    return {
      description: 'Very Rough',
      level: 'Very Rough',
      recommendation: 'Dangerous conditions, avoid non-essential travel'
    };
  } else if (meters < 14.0) {
    return {
      description: 'High',
      level: 'High',
      recommendation: 'Very dangerous, only experienced vessels should be out'
    };
  } else {
    return {
      description: 'Very High',
      level: 'Extreme',
      recommendation: 'Extremely dangerous, all vessels should seek shelter'
    };
  }
}

/**
 * Overall safety assessment based on multiple factors
 */
export interface SafetyAssessment {
  level: string;
  description: string;
  recommendation: string;
}

export function getSafetyAssessment(
  totalWaveHeight: number | undefined,
  windWaveHeight: number | undefined,
  swellHeight: number | undefined,
  wavePeriod: number | undefined
): SafetyAssessment {
  if (totalWaveHeight === undefined || totalWaveHeight === null) {
    return {
      level: 'Unknown',
      description: 'Marine conditions data not available',
      recommendation: 'Consult local marine forecast'
    };
  }

  const waveCategory = getWaveHeightCategory(totalWaveHeight);

  // Adjust based on wave period (short period = choppy/uncomfortable)
  let adjustedDescription = waveCategory.description;
  if (wavePeriod !== undefined && wavePeriod < 6 && totalWaveHeight > 1.0) {
    adjustedDescription += ' and choppy (short period)';
  } else if (wavePeriod !== undefined && wavePeriod > 12 && totalWaveHeight > 2.0) {
    adjustedDescription += ' with long-period swell (powerful)';
  }

  // Add context about wind vs swell
  let context = '';
  if (windWaveHeight !== undefined && swellHeight !== undefined) {
    if (windWaveHeight > swellHeight * 1.5) {
      context = ' Conditions dominated by local wind waves.';
    } else if (swellHeight > windWaveHeight * 1.5) {
      context = ' Conditions dominated by swell from distant systems.';
    } else {
      context = ' Mixed wind and swell conditions.';
    }
  }

  return {
    level: waveCategory.level,
    description: adjustedDescription + context,
    recommendation: waveCategory.recommendation
  };
}

