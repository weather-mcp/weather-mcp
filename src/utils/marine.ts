/**
 * Utility functions for marine conditions data formatting and interpretation
 */

import { displayValue } from './displayBanding.js';
import type { GridpointResponse, GridpointDataSeries } from '../types/noaa.js';

/**
 * NOAA Marine Conditions extracted from gridpoint data
 */
export interface NOAAMarineConditions {
  waveHeight?: number; // meters
  wavePeriod?: number; // seconds
  waveDirection?: number; // degrees
  windSpeed?: number; // km/h
  windDirection?: number; // degrees
  windGust?: number; // km/h
  timestamp: string; // ISO 8601
}

/**
 * Extract current value from a gridpoint data series
 */
function extractCurrentValue(series: GridpointDataSeries | undefined): number | undefined {
  if (!series || !series.values || series.values.length === 0) {
    return undefined;
  }

  // Find the first valid value (gridpoint data is time-ordered)
  for (const entry of series.values) {
    const value = entry.value;
    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return undefined;
}

/**
 * Extract marine conditions from NOAA gridpoint response
 */
export function extractNOAAMarineConditions(gridpoint: GridpointResponse): NOAAMarineConditions | null {
  const props = gridpoint.properties;

  // Extract marine data
  const waveHeight = extractCurrentValue(props.waveHeight);
  const wavePeriod = extractCurrentValue(props.wavePeriod);
  const waveDirection = extractCurrentValue(props.waveDirection);
  const windSpeed = extractCurrentValue(props.windSpeed);
  const windDirection = extractCurrentValue(props.windDirection);
  const windGust = extractCurrentValue(props.windGust);

  // Check if we have any marine data
  if (waveHeight === undefined && wavePeriod === undefined && waveDirection === undefined) {
    return null;
  }

  return {
    waveHeight,
    wavePeriod,
    waveDirection,
    windSpeed,
    windDirection,
    windGust,
    timestamp: props.updateTime
  };
}

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
 * Format wind speed with units (converts km/h to knots for marine)
 */
export function formatWindSpeed(kmh: number | undefined): string {
  if (kmh === undefined || kmh === null) {
    return 'N/A';
  }

  // Convert km/h to knots (1 km/h = 0.539957 knots)
  const knots = kmh * 0.539957;
  return `${knots.toFixed(1)} knots (${kmh.toFixed(1)} km/h)`;
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
 * Sea state — one ordered table, and everything that names a sea state derives from it.
 *
 * WMO Code Table 3700 (State of the sea; the Douglas sea scale), read 2026-09-01 from
 * NOAA/NODC's GTSPP transcription and the UK Met Office coast-and-sea glossary, which agree
 * on every term and bound. The rung names are the code table's terms in its capitalisation.
 * The thresholds are the code table's bounds and are locked at every seam by
 * tests/unit/marine-band-rounding.test.ts (v1.25.6) — do not move them.
 *
 * Codes 0 (Calm (glassy), 0 m) and 1 (Calm (rippled), 0–0.1 m) share the lowest rung: the
 * band keys on the one-decimal display value, and `shown < 0.1` means the report prints
 * `0.0m`, which is 0 m at render precision — code 0.
 *
 * Boundary convention: an exact bound bands into the HIGHER rung (`shown < upperBound`, the
 * cautious side, as v1.25.6 locked it), whereas the code table's own coding rule assigns an
 * exact bounding height to the lower code figure. docs/TOOLS.md states this.
 *
 * Recommendations belong to the threshold RANGE, not to the name — a rung renamed by this
 * table keeps the advice its range always carried.
 */
export const SEA_STATE_TIERS = {
  calm: { marker: '🟢', blurb: 'Safe for most vessels' },
  moderate: { marker: '🟡', blurb: 'Challenging for small craft' },
  rough: { marker: '🟠', blurb: 'Hazardous for small vessels' },
  veryRough: { marker: '🔴', blurb: 'Dangerous for most vessels' },
  extreme: { marker: '🟣', blurb: 'Extremely dangerous' }
} as const;

/** Severity tiers, in declaration order = severity order. */
export type SeaStateTier = keyof typeof SEA_STATE_TIERS;

interface SeaStateRung {
  /** WMO 3700 code figure(s) the rung covers. */
  wmoCode: string;
  /** The code table's descriptive term. */
  name: string;
  /** Exclusive upper bound in metres on the displayed (one-decimal) value; `Infinity` for the top rung. */
  upperBound: number;
  /** Required on every rung: this is what makes a rung without a marker a build error. */
  tier: SeaStateTier;
  recommendation: string;
}

export const SEA_STATE_SCALE = [
  { wmoCode: '0–1', name: 'Calm (glassy)', upperBound: 0.1, tier: 'calm', recommendation: 'Ideal for all water activities' },
  { wmoCode: '2', name: 'Smooth (wavelets)', upperBound: 0.5, tier: 'calm', recommendation: 'Excellent conditions for all vessels' },
  { wmoCode: '3', name: 'Slight', upperBound: 1.25, tier: 'calm', recommendation: 'Good conditions for most activities' },
  { wmoCode: '4', name: 'Moderate', upperBound: 2.5, tier: 'moderate', recommendation: 'Safe for experienced boaters' },
  { wmoCode: '5', name: 'Rough', upperBound: 4.0, tier: 'rough', recommendation: 'Use caution, especially for small craft' },
  { wmoCode: '6', name: 'Very rough', upperBound: 6.0, tier: 'veryRough', recommendation: 'Hazardous for small vessels, secure all gear' },
  { wmoCode: '7', name: 'High', upperBound: 9.0, tier: 'veryRough', recommendation: 'Dangerous conditions, avoid non-essential travel' },
  { wmoCode: '8', name: 'Very high', upperBound: 14.0, tier: 'extreme', recommendation: 'Very dangerous, only experienced vessels should be out' },
  { wmoCode: '9', name: 'Phenomenal', upperBound: Infinity, tier: 'extreme', recommendation: 'Extremely dangerous, all vessels should seek shelter' }
] as const satisfies readonly SeaStateRung[];

/** The rung names, derived from the table — the only vocabulary a sea-state `level` can carry. */
export type SeaStateLevel = (typeof SEA_STATE_SCALE)[number]['name'];

/** The level a report carries when it has no wave-height data. Not a severity. */
export const NO_DATA_LEVEL = 'Unknown' as const;
/** The marker for `NO_DATA_LEVEL`. Appears in no severity row of the legend. */
export const NO_DATA_MARKER = '⚪';

/**
 * The severity marker for a level. Found by name in the table, so the names are never
 * copied; an unknown name is a thrown error, never a fallback colour.
 */
export function seaStateMarker(level: SeaStateLevel | typeof NO_DATA_LEVEL): string {
  if (level === NO_DATA_LEVEL) {
    return NO_DATA_MARKER;
  }
  const rung = SEA_STATE_SCALE.find((entry) => entry.name === level);
  if (rung === undefined) {
    throw new Error(`Sea-state level "${level}" is not in SEA_STATE_SCALE`);
  }
  return SEA_STATE_TIERS[rung.tier].marker;
}

/**
 * The legend: one row per severity tier, generated from the table so the marker, the rung
 * names and the range can never disagree with the header that used them. The ranges are the
 * true union of each tier's rungs; the top row is open-ended.
 */
export function formatSeaStateLegend(): string {
  let output = '';
  let lowerBound = 0;
  for (const tier of Object.keys(SEA_STATE_TIERS) as SeaStateTier[]) {
    const rungs = SEA_STATE_SCALE.filter((entry) => entry.tier === tier);
    const tierLower = lowerBound;
    const tierUpper = rungs[rungs.length - 1].upperBound;
    const range = tierUpper === Infinity ? `≥${tierLower} m` : `${tierLower}–${tierUpper} m`;
    const names = rungs.map((entry) => entry.name).join(' / ');
    output += `${SEA_STATE_TIERS[tier].marker} **${names}** (${range}): ${SEA_STATE_TIERS[tier].blurb}\n`;
    lowerBound = tierUpper;
  }
  output += `\n${NO_DATA_MARKER} marks a report with no wave-height data. `;
  output += `Markers describe the sea state at the point, not a hazard forecast — consult official marine warnings.\n`;
  return output;
}

/**
 * Categorize wave height
 */
export interface WaveHeightCategory {
  description: string;
  level: SeaStateLevel | typeof NO_DATA_LEVEL;
  recommendation: string;
}

export function getWaveHeightCategory(meters: number | undefined): WaveHeightCategory {
  if (meters === undefined || meters === null) {
    return {
      description: 'Unknown',
      level: NO_DATA_LEVEL,
      recommendation: 'No data available'
    };
  }

  // Band on the figure `formatWaveHeight` prints (`toFixed(1)`), so the label can
  // never disagree with the number beside it.
  const shown = displayValue(meters, 1);

  // First rung whose exclusive upper bound the displayed value is under; the top rung's
  // bound is Infinity, so every finite value lands somewhere.
  const rung = SEA_STATE_SCALE.find((entry) => shown < entry.upperBound);
  if (rung === undefined) {
    throw new Error(`No sea-state rung for a displayed wave height of ${shown} m`);
  }
  return {
    description: rung.name,
    level: rung.name,
    recommendation: rung.recommendation
  };
}

/**
 * Overall safety assessment based on multiple factors
 */
export interface SafetyAssessment {
  level: SeaStateLevel | typeof NO_DATA_LEVEL;
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
      level: NO_DATA_LEVEL,
      description: 'Marine conditions data not available',
      recommendation: 'Consult local marine forecast'
    };
  }

  const waveCategory = getWaveHeightCategory(totalWaveHeight);

  // Band on the figures `formatWaveHeight` and `formatWavePeriod` print (both
  // `toFixed(1)`), so the clause can never disagree with the numbers beside it.
  const shownHeight = displayValue(totalWaveHeight, 1);
  const shownPeriod = wavePeriod === undefined ? undefined : displayValue(wavePeriod, 1);

  // Adjust based on wave period (short period = choppy/uncomfortable)
  let adjustedDescription = waveCategory.description;
  if (shownPeriod !== undefined && shownPeriod < 6 && shownHeight > 1.0) {
    adjustedDescription += ' and choppy (short period)';
  } else if (shownPeriod !== undefined && shownPeriod > 12 && shownHeight > 2.0) {
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

