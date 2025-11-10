/**
 * Type definitions for lightning strike data
 * Supports Blitzortung.org and other lightning detection networks
 */

/**
 * Safety risk levels based on lightning proximity
 */
export type LightningSafetyLevel = 'safe' | 'elevated' | 'high' | 'extreme';

/**
 * Lightning strike data from detection network
 */
export interface LightningStrike {
  timestamp: Date;
  latitude: number;
  longitude: number;
  polarity: number;      // Positive or negative charge
  amplitude: number;     // Peak current in kA (kiloamperes)
  stationCount?: number; // Number of stations that detected this strike
  distance?: number;     // Distance from query point in km
}

/**
 * Lightning activity request parameters
 */
export interface LightningActivityParams {
  latitude: number;
  longitude: number;
  radius?: number;      // Search radius in km (default: 100)
  timeWindow?: number;  // Minutes of history (default: 60)
}

/**
 * Lightning activity statistics
 */
export interface LightningStatistics {
  totalStrikes: number;
  cloudToGroundStrikes: number;
  intraCloudStrikes: number;
  averageDistance: number;
  nearestDistance: number;
  strikesPerMinute: number;
  densityPerSqKm: number;
}

/**
 * Lightning safety assessment
 */
export interface LightningSafetyAssessment {
  level: LightningSafetyLevel;
  message: string;
  recommendations: string[];
  nearestStrikeDistance: number | null;
  nearestStrikeTime: Date | null;
  isActiveThunderstorm: boolean;
}

/**
 * Lightning activity response
 */
export interface LightningActivityResponse {
  location: {
    latitude: number;
    longitude: number;
  };
  searchRadius: number;
  timeWindow: number;
  searchPeriod: {
    start: Date;
    end: Date;
  };
  strikes: LightningStrike[];
  statistics: LightningStatistics;
  safety: LightningSafetyAssessment;
  source: string;
  generatedAt: Date;
  disclaimer?: string;
}

/**
 * Blitzortung.org API response types
 */
export interface BlitzortungStrike {
  time: number;        // Unix timestamp in milliseconds
  lat: number;         // Latitude
  lon: number;         // Longitude
  alt: number;         // Altitude (not always available)
  pol: number;         // Polarity (-1 or 1)
  mcs: number;         // Signal strength/amplitude
  stat: number;        // Number of stations
}

export interface BlitzortungResponse {
  strikes: BlitzortungStrike[];
}
