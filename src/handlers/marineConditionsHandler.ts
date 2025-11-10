/**
 * Handler for get_marine_conditions tool
 * Supports dual data sources: NOAA (Great Lakes/coastal) and Open-Meteo (oceans)
 */

import { DateTime } from 'luxon';
import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { validateCoordinates, validateOptionalBoolean } from '../utils/validation.js';
import {
  formatWaveHeight,
  formatWavePeriod,
  formatDirection,
  formatCurrentVelocity,
  formatWindSpeed,
  getWaveHeightCategory,
  getSafetyAssessment,
  extractNOAAMarineConditions,
  type NOAAMarineConditions
} from '../utils/marine.js';
import { shouldUseNOAAMarine } from '../utils/geography.js';
import type { OpenMeteoMarineResponse } from '../types/openmeteo.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { formatInTimezone, guessTimezoneFromCoords } from '../utils/timezone.js';

interface MarineConditionsArgs {
  latitude?: number;
  longitude?: number;
  forecast?: boolean;
}

export async function handleGetMarineConditions(
  args: unknown,
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input parameters with runtime checks
  const { latitude, longitude } = validateCoordinates(args);
  const forecast = validateOptionalBoolean(
    (args as MarineConditionsArgs)?.forecast,
    'forecast',
    false
  );

  // Get timezone for proper time formatting
  let timezone = guessTimezoneFromCoords(latitude, longitude); // fallback
  try {
    // Try to get timezone from station (preferred)
    const stations = await noaaService.getStations(latitude, longitude);
    if (stations.features && stations.features.length > 0) {
      const stationTimezone = stations.features[0].properties.timeZone;
      if (stationTimezone) {
        timezone = stationTimezone;
      }
    }
  } catch (error) {
    // Use fallback timezone
  }

  // Check if we should try NOAA first (Great Lakes or major coastal bays)
  const regionDetection = shouldUseNOAAMarine(latitude, longitude);

  if (regionDetection.useNOAA) {
    // Try NOAA first for Great Lakes and coastal bays
    try {
      // Redact coordinates for logging to protect user privacy
      const redacted = redactCoordinatesForLogging(latitude, longitude);
      logger.info('Attempting NOAA marine data', {
        latitude: redacted.lat,
        longitude: redacted.lon,
        region: regionDetection.region,
        source: regionDetection.source
      });

      const gridpointData = await noaaService.getGridpointDataByCoordinates(latitude, longitude);
      const noaaMarineData = extractNOAAMarineConditions(gridpointData);

      if (noaaMarineData) {
        // Format NOAA marine data
        const output = formatNOAAMarineConditions(
          noaaMarineData,
          latitude,
          longitude,
          regionDetection.region || 'Unknown Region',
          timezone,
          forecast
        );

        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };
      } else {
        const redacted2 = redactCoordinatesForLogging(latitude, longitude);
        logger.info('NOAA gridpoint has no marine data, falling back to Open-Meteo', {
          latitude: redacted2.lat,
          longitude: redacted2.lon
        });
      }
    } catch (error) {
      // NOAA failed, fall back to Open-Meteo
      const redacted3 = redactCoordinatesForLogging(latitude, longitude);
      logger.warn('NOAA marine data failed, falling back to Open-Meteo', {
        latitude: redacted3.lat,
        longitude: redacted3.lon,
        error: (error as Error).message
      });
    }
  }

  // Use Open-Meteo (default for oceans, or fallback for NOAA regions)
  const marineData = await openMeteoService.getMarine(
    latitude,
    longitude,
    forecast,
    5 // Default 5-day forecast
  );

  // Format the marine data for display
  const output = formatOpenMeteoMarineConditions(marineData, latitude, longitude, forecast);

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
 * Format NOAA marine conditions data as markdown
 */
function formatNOAAMarineConditions(
  data: NOAAMarineConditions,
  latitude: number,
  longitude: number,
  region: string,
  timezone: string,
  includeForecast: boolean
): string {
  let output = `# Marine Conditions Report - ${region}\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Region:** ${region}\n`;
  output += `**Last Updated:** ${formatInTimezone(data.timestamp, timezone)}\n\n`;

  // Wave Conditions
  output += `## 🌊 Wave Conditions\n\n`;

  if (data.waveHeight !== undefined && data.waveHeight > 0) {
    const waveCategory = getWaveHeightCategory(data.waveHeight);
    output += `**Significant Wave Height:** ${formatWaveHeight(data.waveHeight)}`;
    output += ` (${waveCategory.description})\n`;

    if (data.waveDirection !== undefined) {
      output += `**Wave Direction:** ${formatDirection(data.waveDirection)}\n`;
    }

    if (data.wavePeriod !== undefined) {
      output += `**Wave Period:** ${formatWavePeriod(data.wavePeriod)}\n`;
    }

    output += `\n**Safety:** ${waveCategory.recommendation}\n\n`;
  } else {
    output += `**Wave Height:** Calm or minimal wave activity\n\n`;
  }

  // Wind Conditions
  if (data.windSpeed !== undefined || data.windDirection !== undefined) {
    output += `## 💨 Wind Conditions\n\n`;

    if (data.windSpeed !== undefined) {
      output += `**Wind Speed:** ${formatWindSpeed(data.windSpeed)}\n`;
    }

    if (data.windDirection !== undefined) {
      output += `**Wind Direction:** ${formatDirection(data.windDirection)}\n`;
    }

    if (data.windGust !== undefined && data.windGust > data.windSpeed! * 1.2) {
      output += `**Wind Gusts:** ${formatWindSpeed(data.windGust)}\n`;
    }

    output += `\n`;
  }

  // Forecast note
  if (includeForecast) {
    output += `---\n\n`;
    output += `*Note: NOAA gridpoint data provides current conditions. `;
    output += `For detailed multi-day marine forecasts, NOAA offers zone-based marine forecasts `;
    output += `available through their website.*\n\n`;
  }

  // Footer
  output += `---\n\n`;
  output += `*Data source: NOAA National Weather Service*\n`;
  output += `*Great Lakes and coastal marine conditions from NOAA gridpoint data*\n`;

  return output;
}

/**
 * Format Open-Meteo marine conditions data as markdown
 */
function formatOpenMeteoMarineConditions(
  data: OpenMeteoMarineResponse,
  latitude: number,
  longitude: number,
  includeForecast: boolean
): string {
  let output = `# Marine Conditions Report\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Timezone:** ${data.timezone}\n`;
  output += `\n`;

  // Important disclaimer at the top
  output += `⚠️ **DISCLAIMER:** This data is modeled and may have limited accuracy in coastal areas. `;
  output += `**NOT suitable for coastal navigation.** Always consult official marine forecasts for safety-critical decisions.\n\n`;

  if (!data.current) {
    output += `⚠️ **No current marine conditions data available for this location.**\n`;
    return output;
  }

  const current = data.current;
  output += `**Observation Time:** ${formatInTimezone(current.time, data.timezone)}\n\n`;

  // Overall safety assessment
  const safety = getSafetyAssessment(
    current.wave_height,
    current.wind_wave_height,
    current.swell_wave_height,
    current.wave_period
  );

  const safetyEmoji = safety.level === 'Calm' ? '🟢' :
                      safety.level === 'Moderate' ? '🟡' :
                      safety.level === 'Rough' ? '🟠' :
                      safety.level === 'Very Rough' ? '🔴' : '🟤';

  output += `## ${safetyEmoji} Current Conditions: ${safety.level}\n\n`;
  output += `${safety.description}\n\n`;

  // Wave Height Summary
  output += `## 🌊 Wave Conditions\n\n`;

  if (current.wave_height !== undefined) {
    const waveCategory = getWaveHeightCategory(current.wave_height);
    output += `**Significant Wave Height:** ${formatWaveHeight(current.wave_height)}`;
    output += ` (${waveCategory.description})\n`;
  }

  if (current.wave_direction !== undefined) {
    output += `**Wave Direction:** ${formatDirection(current.wave_direction)}\n`;
  }

  if (current.wave_period !== undefined) {
    output += `**Wave Period:** ${formatWavePeriod(current.wave_period)}\n`;
  }

  output += `\n`;

  // Wind Waves (locally generated)
  if (current.wind_wave_height !== undefined && current.wind_wave_height > 0) {
    output += `### Wind Waves\n\n`;
    output += `**Height:** ${formatWaveHeight(current.wind_wave_height)}\n`;

    if (current.wind_wave_direction !== undefined) {
      output += `**Direction:** ${formatDirection(current.wind_wave_direction)}\n`;
    }

    if (current.wind_wave_period !== undefined) {
      output += `**Period:** ${formatWavePeriod(current.wind_wave_period)}\n`;
    }

    if (current.wind_wave_peak_period !== undefined) {
      output += `**Peak Period:** ${formatWavePeriod(current.wind_wave_peak_period)}\n`;
    }

    output += `\n`;
  }

  // Swell Waves (propagated from distant storms)
  if (current.swell_wave_height !== undefined && current.swell_wave_height > 0) {
    output += `### Swell\n\n`;
    output += `**Height:** ${formatWaveHeight(current.swell_wave_height)}\n`;

    if (current.swell_wave_direction !== undefined) {
      output += `**Direction:** ${formatDirection(current.swell_wave_direction)}\n`;
    }

    if (current.swell_wave_period !== undefined) {
      output += `**Period:** ${formatWavePeriod(current.swell_wave_period)}\n`;
    }

    if (current.swell_wave_peak_period !== undefined) {
      output += `**Peak Period:** ${formatWavePeriod(current.swell_wave_peak_period)}\n`;
    }

    output += `\n`;
  }

  // Ocean Currents
  if (current.ocean_current_velocity !== undefined || current.ocean_current_direction !== undefined) {
    output += `## 🌀 Ocean Currents\n\n`;

    if (current.ocean_current_velocity !== undefined) {
      output += `**Velocity:** ${formatCurrentVelocity(current.ocean_current_velocity)}\n`;
    }

    if (current.ocean_current_direction !== undefined) {
      output += `**Direction:** ${formatDirection(current.ocean_current_direction)}\n`;
    }

    output += `\n`;
  }

  // Add forecast summary if requested
  if (includeForecast && data.daily && data.daily.time && data.daily.time.length > 0) {
    output += `---\n\n`;
    output += `## 📅 Marine Forecast\n\n`;

    const daysToShow = Math.min(5, data.daily.time.length);
    output += `**Next ${daysToShow} days:**\n\n`;

    for (let i = 0; i < daysToShow; i++) {
      const dt = DateTime.fromISO(data.daily.time[i], { setZone: false }).setZone(data.timezone);
      const dayName = dt.toLocaleString({ weekday: 'short', month: 'short', day: 'numeric' });

      output += `**${dayName}:**\n`;

      if (data.daily.wave_height_max?.[i] !== undefined) {
        const maxWaveHeight = data.daily.wave_height_max[i];
        const category = getWaveHeightCategory(maxWaveHeight);
        output += `  • Max Wave Height: ${formatWaveHeight(maxWaveHeight)} (${category.description})\n`;
      }

      if (data.daily.wave_direction_dominant?.[i] !== undefined) {
        output += `  • Wave Direction: ${formatDirection(data.daily.wave_direction_dominant[i])}\n`;
      }

      if (data.daily.wave_period_max?.[i] !== undefined) {
        output += `  • Max Wave Period: ${formatWavePeriod(data.daily.wave_period_max[i])}\n`;
      }

      // Show swell info if significant
      if (data.daily.swell_wave_height_max?.[i] !== undefined && data.daily.swell_wave_height_max[i] > 0.5) {
        output += `  • Swell Height: ${formatWaveHeight(data.daily.swell_wave_height_max[i])}\n`;

        if (data.daily.swell_wave_direction_dominant?.[i] !== undefined) {
          output += `  • Swell Direction: ${formatDirection(data.daily.swell_wave_direction_dominant[i])}\n`;
        }
      }

      output += `\n`;
    }

    // Add hourly forecast note if available
    if (data.hourly && data.hourly.time && data.hourly.time.length > 0) {
      output += `*Hourly forecast data available for ${data.hourly.time.length} hours*\n\n`;
    }
  }

  // Footer with interpretation guidance
  output += `---\n\n`;
  output += `### Interpreting Marine Conditions\n\n`;
  output += `**Significant Wave Height:** The average height of the highest 1/3 of waves\n`;
  output += `**Wind Waves:** Waves generated by local winds (shorter period)\n`;
  output += `**Swell:** Long-period waves from distant weather systems (longer period)\n`;
  output += `**Wave Period:** Time between successive wave crests (longer = more powerful)\n\n`;
  output += `🟢 **Calm** (0-2m): Safe for most vessels\n`;
  output += `🟡 **Moderate** (2-4m): Challenging for small craft\n`;
  output += `🟠 **Rough** (4-6m): Hazardous for small vessels\n`;
  output += `🔴 **Very Rough** (6-9m): Dangerous for most vessels\n`;
  output += `🟤 **High** (>9m): Extremely dangerous\n`;

  return output;
}
