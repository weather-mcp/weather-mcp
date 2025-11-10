/**
 * Handler for get_river_conditions tool
 */

import { NOAAService } from '../services/noaa.js';
import { validateCoordinates } from '../utils/validation.js';
import { formatInTimezone, guessTimezoneFromCoords } from '../utils/timezone.js';
import { calculateDistance } from '../utils/distance.js';
import type { NWPSGauge } from '../types/noaa.js';

interface RiverConditionsArgs {
  latitude?: number;
  longitude?: number;
  radius?: number; // search radius in km (default: 50)
}

export async function handleGetRiverConditions(
  args: unknown,
  noaaService: NOAAService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input parameters with runtime checks
  const { latitude, longitude } = validateCoordinates(args);

  // Validate radius parameter
  let radius = (args as RiverConditionsArgs)?.radius ?? 50; // default 50 km
  if (typeof radius !== 'number' || isNaN(radius) || !isFinite(radius)) {
    radius = 50;
  }
  // Clamp to valid range (1-500 km)
  radius = Math.max(1, Math.min(radius, 500));

  // Get timezone for proper time formatting
  const timezone = guessTimezoneFromCoords(latitude, longitude);

  let output = `# River Conditions Report\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Search Radius:** ${radius} km (${(radius * 0.621371).toFixed(1)} miles)\n\n`;

  try {
    // Calculate bounding box for the search radius
    // 1 degree of latitude ≈ 111 km, 1 degree of longitude varies by latitude
    const latDelta = radius / 111; // Convert radius from km to degrees latitude
    const lonDelta = radius / (111 * Math.cos(latitude * Math.PI / 180)); // Adjust for latitude

    const west = Math.max(-180, longitude - lonDelta);
    const east = Math.min(180, longitude + lonDelta);
    const south = Math.max(-90, latitude - latDelta);
    const north = Math.min(90, latitude + latDelta);

    // Get gauges within bounding box (much more efficient than downloading all gauges)
    const gaugesInBox = await noaaService.getNWPSGaugesInBoundingBox(west, south, east, north);

    // Calculate precise distance to each gauge and filter by radius
    // (bounding box is a square, but we want a circle)
    const gaugesWithDistance = gaugesInBox
      .map(gauge => ({
        gauge,
        distance: calculateDistance(latitude, longitude, gauge.latitude, gauge.longitude)
      }))
      .filter(item => item.distance <= radius)
      .sort((a, b) => a.distance - b.distance); // Sort by nearest first

    if (gaugesWithDistance.length === 0) {
      output += `ℹ️ **No river gauges found within ${radius} km**\n\n`;
      output += `Try expanding the search radius or choosing a location closer to rivers or streams.\n\n`;
      output += `**Tip:** River gauges are typically located along major rivers and waterways.\n`;
    } else {
      output += `📊 **Found ${gaugesWithDistance.length} river gauge${gaugesWithDistance.length > 1 ? 's' : ''}**\n\n`;

      // Show details for nearest gauges (limit to 5 to avoid overwhelming output)
      const maxGaugesToShow = 5;
      const gaugesToShow = gaugesWithDistance.slice(0, maxGaugesToShow);

      for (const { gauge, distance } of gaugesToShow) {
        output += formatGaugeDetails(gauge, distance, timezone);
      }

      if (gaugesWithDistance.length > maxGaugesToShow) {
        output += `\n*Note: ${gaugesWithDistance.length - maxGaugesToShow} additional gauge${gaugesWithDistance.length - maxGaugesToShow > 1 ? 's' : ''} found within radius (showing nearest ${maxGaugesToShow} only)*\n`;
      }
    }
  } catch (error) {
    output += `❌ **Error retrieving river gauge data**\n\n`;
    output += `Unable to fetch river conditions. This may be due to:\n`;
    output += `- Temporary service unavailability\n`;
    output += `- Network connectivity issues\n`;
    output += `- Location outside NOAA coverage area (US only)\n\n`;
    output += `Error details: ${error instanceof Error ? error.message : String(error)}\n`;
  }

  output += `\n---\n`;
  output += `*Data sources: NOAA National Water Prediction Service (NWPS), USGS Water Services*\n`;
  output += `*River conditions are updated hourly. Always consult official sources for critical decisions.*\n`;

  return {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };
}

/**
 * Format detailed information for a single river gauge
 */
function formatGaugeDetails(gauge: NWPSGauge, distance: number, timezone: string): string {
  let output = `## ${gauge.name}\n\n`;
  output += `**Distance:** ${distance.toFixed(1)} km (${(distance * 0.621371).toFixed(1)} mi)\n`;
  output += `**Location:** ${gauge.state}${gauge.county ? `, ${gauge.county} County` : ''}\n`;
  output += `**Coordinates:** ${gauge.latitude.toFixed(4)}, ${gauge.longitude.toFixed(4)}\n`;
  output += `**Gauge ID:** ${gauge.lid}${gauge.usgsId ? ` (USGS: ${gauge.usgsId})` : ''}\n`;
  output += `**Status:** ${gauge.inService ? '✅ Active' : '❌ Out of Service'}\n\n`;

  // Current conditions
  if (gauge.status.observed) {
    const obs = gauge.status.observed;
    output += `### Current Conditions\n`;
    output += `**Observed:** ${formatInTimezone(obs.validTime, timezone)}\n`;

    if (obs.primary !== null) {
      output += `**River Stage:** ${obs.primary.toFixed(2)} ft\n`;
    }

    if (obs.secondary !== null) {
      output += `**Flow Rate:** ${obs.secondary.toFixed(2)} kcfs (${(obs.secondary * 1000).toFixed(0)} cfs)\n`;
    }

    // Flood category with emoji
    const floodEmoji = getFloodEmoji(obs.floodCategory);
    const floodText = obs.floodCategory ? obs.floodCategory.toUpperCase() : 'NO FLOODING';
    output += `**Flood Category:** ${floodEmoji} ${floodText}\n\n`;
  } else {
    output += `### Current Conditions\n`;
    output += `*No current observations available*\n\n`;
  }

  // Flood stages
  if (gauge.flood?.categories) {
    const cat = gauge.flood.categories;
    output += `### Flood Stages\n`;
    output += `**Action Stage:** ${cat.action.toFixed(1)} ft\n`;
    output += `**Minor Flood:** ${cat.minor.toFixed(1)} ft\n`;
    output += `**Moderate Flood:** ${cat.moderate.toFixed(1)} ft\n`;
    output += `**Major Flood:** ${cat.major.toFixed(1)} ft\n\n`;

    // Show stage relative to flood levels if we have current stage
    if (gauge.status.observed?.primary !== null && gauge.status.observed?.primary !== undefined) {
      const currentStage = gauge.status.observed.primary;
      const pctToAction = ((currentStage / cat.action) * 100).toFixed(0);
      output += `**Current stage is ${pctToAction}% of action stage**\n\n`;
    }
  }

  // Forecast (if available)
  if (gauge.status.forecast) {
    const forecast = gauge.status.forecast;
    output += `### Forecast\n`;
    output += `**Valid Time:** ${formatInTimezone(forecast.validTime, timezone)}\n`;

    if (forecast.primary !== null) {
      output += `**Forecasted Stage:** ${forecast.primary.toFixed(2)} ft\n`;
    }

    if (forecast.secondary !== null) {
      output += `**Forecasted Flow:** ${forecast.secondary.toFixed(2)} kcfs\n`;
    }

    const forecastFloodEmoji = getFloodEmoji(forecast.floodCategory);
    const forecastFloodText = forecast.floodCategory ? forecast.floodCategory.toUpperCase() : 'NO FLOODING';
    output += `**Forecasted Category:** ${forecastFloodEmoji} ${forecastFloodText}\n\n`;
  }

  // Historic crests (if available and significant)
  if (gauge.flood?.crests?.recent && gauge.flood.crests.recent.length > 0) {
    output += `### Recent Historic Crests\n`;
    const recentCrests = gauge.flood.crests.recent.slice(0, 3); // Show top 3
    for (const crest of recentCrests) {
      const crestDate = new Date(crest.date);
      output += `- **${crestDate.getFullYear()}:** ${crest.value.toFixed(2)} ft`;
      if (crest.flow) {
        output += ` (${crest.flow.toFixed(0)} cfs)`;
      }
      if (crest.description) {
        output += ` - ${crest.description}`;
      }
      output += `\n`;
    }
    output += `\n`;
  }

  output += `---\n\n`;
  return output;
}

/**
 * Get emoji for flood category
 */
function getFloodEmoji(category: string | null | undefined): string {
  if (!category || category === 'no flooding') return '✅';
  if (category === 'action') return '🟡';
  if (category === 'minor') return '🟠';
  if (category === 'moderate') return '🔴';
  if (category === 'major') return '🔴🔴';
  return '⚪';
}
