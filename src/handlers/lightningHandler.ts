/**
 * Handler for get_lightning_activity tool
 * Provides real-time lightning strike monitoring and safety assessment
 */

import {
  LightningActivityParams,
  LightningActivityResponse,
  LightningStrike,
  LightningStatistics,
  LightningSafetyAssessment,
  LightningSafetyLevel
} from '../types/lightning.js';
import { blitzortungService } from '../services/blitzortung.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { ValidationError } from '../errors/ApiError.js';

/**
 * Validate lightning activity request parameters
 */
function validateLightningParams(params: LightningActivityParams): void {
  // Validate coordinates
  validateLatitude(params.latitude);
  validateLongitude(params.longitude);

  // Validate radius
  if (params.radius !== undefined) {
    if (typeof params.radius !== 'number' || params.radius < 1 || params.radius > 500) {
      throw new ValidationError(
        'radius must be a number between 1 and 500 km',
        'radius',
        params.radius
      );
    }
  }

  // Validate time window
  if (params.timeWindow !== undefined) {
    if (typeof params.timeWindow !== 'number' || params.timeWindow < 5 || params.timeWindow > 120) {
      throw new ValidationError(
        'timeWindow must be a number between 5 and 120 minutes',
        'timeWindow',
        params.timeWindow
      );
    }
  }
}

/**
 * Calculate lightning activity statistics
 */
function calculateStatistics(strikes: LightningStrike[], radiusKm: number, timeWindowMinutes: number): LightningStatistics {
  if (strikes.length === 0) {
    return {
      totalStrikes: 0,
      cloudToGroundStrikes: 0,
      intraCloudStrikes: 0,
      averageDistance: 0,
      nearestDistance: 0,
      strikesPerMinute: 0,
      densityPerSqKm: 0
    };
  }

  // Count cloud-to-ground vs intra-cloud (based on polarity and amplitude)
  // Typically, stronger amplitude indicates cloud-to-ground
  const cloudToGround = strikes.filter(s => Math.abs(s.amplitude) > 20).length;
  const intraCloud = strikes.length - cloudToGround;

  // Calculate average distance
  const totalDistance = strikes.reduce((sum, s) => sum + (s.distance || 0), 0);
  const averageDistance = totalDistance / strikes.length;

  // Nearest distance
  const nearestDistance = strikes[0]?.distance || 0;

  // Strikes per minute
  const strikesPerMinute = strikes.length / timeWindowMinutes;

  // Density per square km (area of search circle)
  const searchArea = Math.PI * radiusKm * radiusKm;
  const densityPerSqKm = strikes.length / searchArea;

  return {
    totalStrikes: strikes.length,
    cloudToGroundStrikes: cloudToGround,
    intraCloudStrikes: intraCloud,
    averageDistance,
    nearestDistance,
    strikesPerMinute,
    densityPerSqKm
  };
}

/**
 * Assess safety level based on lightning activity
 */
function assessSafety(strikes: LightningStrike[], statistics: LightningStatistics): LightningSafetyAssessment {
  const nearestStrike = strikes[0] || null;
  const nearestDistance = nearestStrike?.distance || null;
  const nearestTime = nearestStrike?.timestamp || null;

  // Determine if there's active thunderstorm activity
  // Active if: strikes in last 10 minutes OR high strike rate
  const recentStrikes = strikes.filter(s => {
    const ageMinutes = (Date.now() - s.timestamp.getTime()) / (1000 * 60);
    return ageMinutes <= 10;
  });
  const isActiveThunderstorm = recentStrikes.length > 0 || statistics.strikesPerMinute > 0.5;

  let level: LightningSafetyLevel;
  let message: string;
  const recommendations: string[] = [];

  // Safety assessment based on nearest strike distance
  if (nearestDistance === null || nearestDistance > 50) {
    level = 'safe';
    message = 'No significant lightning activity detected in the area.';
    recommendations.push('Continue to monitor weather conditions.');
    recommendations.push('Lightning can strike from distant storms, so stay alert to changing conditions.');
  } else if (nearestDistance > 16) {
    level = 'elevated';
    message = `Lightning detected ${nearestDistance.toFixed(1)} km away. Thunderstorm in the vicinity.`;
    recommendations.push('Move activities indoors if possible.');
    recommendations.push('Avoid open areas, tall objects, and bodies of water.');
    recommendations.push('If outdoors, seek shelter in a substantial building or hard-topped vehicle.');
    recommendations.push('Monitor conditions closely - storms can move quickly.');
  } else if (nearestDistance > 8) {
    level = 'high';
    message = `Lightning strike detected ${nearestDistance.toFixed(1)} km away. High risk - seek shelter immediately.`;
    recommendations.push('SEEK SHELTER IMMEDIATELY in a substantial building or hard-topped vehicle.');
    recommendations.push('Do NOT shelter under trees or in open-sided structures.');
    recommendations.push('Stay away from windows, doors, and electrical equipment.');
    recommendations.push('If caught outside, crouch low with feet together and hands on knees.');
    recommendations.push('Wait 30 minutes after the last thunder before resuming outdoor activities.');
  } else {
    level = 'extreme';
    message = `EXTREME DANGER: Lightning strike within ${nearestDistance?.toFixed(1)} km. You are in immediate danger.`;
    recommendations.push('⚠️ TAKE IMMEDIATE SHELTER - Lightning is striking nearby!');
    recommendations.push('Get inside a substantial building or hard-topped vehicle NOW.');
    recommendations.push('If no shelter available, crouch low immediately with feet together.');
    recommendations.push('Do NOT lie flat - minimize contact with ground.');
    recommendations.push('Stay away from tall objects, water, and metal objects.');
    recommendations.push('Remain in shelter for 30 minutes after the last thunder.');
  }

  // Add activity-specific recommendations
  if (isActiveThunderstorm) {
    if (level === 'safe') {
      recommendations.unshift('Active thunderstorm detected in the region. Conditions may change rapidly.');
    }
    recommendations.push('Thunderstorm is active - expect continued lightning activity.');
  }

  return {
    level,
    message,
    recommendations,
    nearestStrikeDistance: nearestDistance,
    nearestStrikeTime: nearestTime,
    isActiveThunderstorm
  };
}

/**
 * Get lightning activity for a location
 */
export async function getLightningActivity(params: LightningActivityParams): Promise<LightningActivityResponse> {
  // Validate parameters
  validateLightningParams(params);

  const { latitude, longitude, radius = 100, timeWindow = 60 } = params;

  // Redact coordinates for logging to protect user privacy
  const redacted = redactCoordinatesForLogging(latitude, longitude);
  logger.info('Lightning activity requested', {
    latitude: redacted.lat,
    longitude: redacted.lon,
    radius,
    timeWindow
  });

  // Fetch lightning strikes
  const strikes = await blitzortungService.getLightningStrikes(
    latitude,
    longitude,
    radius,
    timeWindow
  );

  // Calculate statistics
  const statistics = calculateStatistics(strikes, radius, timeWindow);

  // Assess safety
  const safety = assessSafety(strikes, statistics);

  const now = new Date();
  const searchStart = new Date(now.getTime() - timeWindow * 60 * 1000);

  return {
    location: { latitude, longitude },
    searchRadius: radius,
    timeWindow,
    searchPeriod: {
      start: searchStart,
      end: now
    },
    strikes,
    statistics,
    safety,
    source: 'Blitzortung.org',
    generatedAt: now,
    disclaimer: 'Lightning data from Blitzortung.org community network. Data may have 5-15 minute delay. For life-safety decisions, consult official weather services and local emergency management. When thunder roars, go indoors!'
  };
}

/**
 * Format lightning activity response for display
 */
export function formatLightningActivityResponse(response: LightningActivityResponse): string {
  const lines: string[] = [];

  lines.push('# ⚡ Lightning Activity Report');
  lines.push('');
  lines.push(`**Location:** ${response.location.latitude.toFixed(4)}, ${response.location.longitude.toFixed(4)}`);
  lines.push(`**Search Radius:** ${response.searchRadius} km`);
  lines.push(`**Time Window:** ${response.timeWindow} minutes (${response.searchPeriod.start.toISOString()} to ${response.searchPeriod.end.toISOString()})`);
  lines.push('');

  // Safety assessment
  const safetyIcon = {
    safe: '🟢',
    elevated: '🟡',
    high: '🟠',
    extreme: '🔴'
  }[response.safety.level];

  lines.push(`## ${safetyIcon} Safety Status: ${response.safety.level.toUpperCase()}`);
  lines.push('');
  lines.push(response.safety.message);
  lines.push('');

  // Recommendations
  if (response.safety.recommendations.length > 0) {
    lines.push('### Safety Recommendations');
    lines.push('');
    response.safety.recommendations.forEach(rec => {
      lines.push(`- ${rec}`);
    });
    lines.push('');
  }

  // Statistics
  lines.push('## 📊 Lightning Statistics');
  lines.push('');
  lines.push(`**Total Strikes:** ${response.statistics.totalStrikes}`);

  if (response.statistics.totalStrikes > 0) {
    lines.push(`**Cloud-to-Ground:** ${response.statistics.cloudToGroundStrikes}`);
    lines.push(`**Intra-Cloud:** ${response.statistics.intraCloudStrikes}`);
    lines.push(`**Nearest Strike:** ${response.statistics.nearestDistance.toFixed(1)} km away`);
    lines.push(`**Average Distance:** ${response.statistics.averageDistance.toFixed(1)} km`);
    lines.push(`**Strike Rate:** ${response.statistics.strikesPerMinute.toFixed(2)} strikes/minute`);
    lines.push(`**Density:** ${response.statistics.densityPerSqKm.toFixed(4)} strikes/km²`);
    lines.push(`**Active Thunderstorm:** ${response.safety.isActiveThunderstorm ? 'Yes' : 'No'}`);
    lines.push('');

    // Recent strikes (show up to 10 nearest)
    lines.push('## 🌩️ Recent Strikes');
    lines.push('');
    const strikesToShow = response.strikes.slice(0, 10);

    strikesToShow.forEach((strike, index) => {
      const ageMinutes = (response.generatedAt.getTime() - strike.timestamp.getTime()) / (1000 * 60);
      const polaritySymbol = strike.polarity > 0 ? '+' : '−';
      lines.push(`### Strike ${index + 1}`);
      lines.push(`- **Distance:** ${strike.distance?.toFixed(1)} km`);
      lines.push(`- **Time:** ${strike.timestamp.toISOString()} (${ageMinutes.toFixed(1)} minutes ago)`);
      lines.push(`- **Location:** ${strike.latitude.toFixed(4)}, ${strike.longitude.toFixed(4)}`);
      lines.push(`- **Polarity:** ${polaritySymbol} (${strike.polarity > 0 ? 'Positive' : 'Negative'})`);
      lines.push(`- **Amplitude:** ${strike.amplitude.toFixed(1)} kA`);
      if (strike.stationCount) {
        lines.push(`- **Detected by:** ${strike.stationCount} stations`);
      }
      lines.push('');
    });

    if (response.strikes.length > 10) {
      lines.push(`*Showing 10 of ${response.strikes.length} strikes detected*`);
      lines.push('');
    }
  } else {
    lines.push('');
    lines.push('No lightning strikes detected in the search area during the time window.');
    lines.push('');
  }

  // Disclaimer
  if (response.disclaimer) {
    lines.push('---');
    lines.push('');
    lines.push(`⚠️ **DISCLAIMER:** ${response.disclaimer}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated: ${response.generatedAt.toISOString()}*`);
  lines.push(`*Data source: ${response.source}*`);

  return lines.join('\n');
}
