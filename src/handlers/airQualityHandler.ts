/**
 * Handler for get_air_quality tool
 */

import { OpenMeteoService } from '../services/openmeteo.js';
import { validateCoordinates, validateOptionalBoolean } from '../utils/validation.js';
import {
  getUSAQICategory,
  getEuropeanAQICategory,
  getUVIndexCategory,
  getPollutantInfo,
  formatPollutantConcentration,
  shouldUseUSAQI
} from '../utils/airQuality.js';
import type { OpenMeteoAirQualityResponse } from '../types/openmeteo.js';

interface AirQualityArgs {
  latitude?: number;
  longitude?: number;
  forecast?: boolean;
}

export async function handleGetAirQuality(
  args: unknown,
  openMeteoService: OpenMeteoService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input parameters with runtime checks
  const { latitude, longitude } = validateCoordinates(args);
  const forecast = validateOptionalBoolean(
    (args as AirQualityArgs)?.forecast,
    'forecast',
    false
  );

  // Get air quality data
  const airQualityData = await openMeteoService.getAirQuality(
    latitude,
    longitude,
    forecast,
    5 // Default 5-day forecast
  );

  // Format the air quality data for display
  const output = formatAirQuality(airQualityData, latitude, longitude, forecast);

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
 * Format air quality data as markdown
 */
function formatAirQuality(
  data: OpenMeteoAirQualityResponse,
  latitude: number,
  longitude: number,
  includeForecast: boolean
): string {
  let output = `# Air Quality Report\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Timezone:** ${data.timezone}\n`;
  output += `**Elevation:** ${Math.round(data.elevation)}m\n`;
  output += `\n`;

  // Determine which AQI to show primarily based on location
  const useUSAQI = shouldUseUSAQI(latitude, longitude);

  if (!data.current) {
    output += `⚠️ **No current air quality data available for this location.**\n`;
    return output;
  }

  const current = data.current;
  const currentTime = new Date(current.time);
  output += `**Observation Time:** ${currentTime.toLocaleString()}\n\n`;

  // Display primary AQI with health information
  if (useUSAQI && current.us_aqi !== undefined) {
    const category = getUSAQICategory(current.us_aqi);
    const emoji = category.level === 'Good' ? '🟢' :
                  category.level === 'Moderate' ? '🟡' :
                  category.level === 'Unhealthy for Sensitive Groups' ? '🟠' :
                  category.level === 'Unhealthy' ? '🔴' :
                  category.level === 'Very Unhealthy' ? '🟣' : '🟤';

    output += `## ${emoji} US Air Quality Index: ${Math.round(current.us_aqi)}\n\n`;
    output += `**Category:** ${category.level} (${category.color})\n`;
    output += `**Description:** ${category.description}\n\n`;
    output += `**Health Implications:**\n${category.healthImplications}\n\n`;
    if (category.cautionaryStatement !== 'None') {
      output += `⚠️ **Caution:** ${category.cautionaryStatement}\n\n`;
    }
  } else if (current.european_aqi !== undefined) {
    const category = getEuropeanAQICategory(current.european_aqi);
    const emoji = category.level === 'Good' ? '🟢' :
                  category.level === 'Fair' ? '🟢' :
                  category.level === 'Moderate' ? '🟡' :
                  category.level === 'Poor' ? '🟠' :
                  category.level === 'Very Poor' ? '🔴' : '🟣';

    output += `## ${emoji} European Air Quality Index: ${Math.round(current.european_aqi)}\n\n`;
    output += `**Category:** ${category.level} (${category.color})\n`;
    output += `**Description:** ${category.description}\n\n`;
    output += `**Health Implications:**\n${category.healthImplications}\n\n`;
    if (category.cautionaryStatement !== 'None') {
      output += `⚠️ **Caution:** ${category.cautionaryStatement}\n\n`;
    }
  }

  // UV Index
  if (current.uv_index !== undefined) {
    const uvCategory = getUVIndexCategory(current.uv_index);
    const uvEmoji = uvCategory.level === 'Low' ? '🟢' :
                    uvCategory.level === 'Moderate' ? '🟡' :
                    uvCategory.level === 'High' ? '🟠' :
                    uvCategory.level === 'Very High' ? '🔴' : '🟣';

    output += `## ${uvEmoji} UV Index: ${current.uv_index.toFixed(1)}\n\n`;
    output += `**Level:** ${uvCategory.level}\n`;
    output += `**Description:** ${uvCategory.description}\n`;
    output += `**Recommendation:** ${uvCategory.recommendation}\n\n`;

    if (current.uv_index_clear_sky !== undefined && Math.abs(current.uv_index_clear_sky - current.uv_index) > 1) {
      output += `*Note: UV index under clear sky would be ${current.uv_index_clear_sky.toFixed(1)}*\n\n`;
    }
  }

  // Pollutant Concentrations
  output += `## Pollutant Concentrations\n\n`;

  const pollutants = [
    { key: 'pm2_5', value: current.pm2_5, units: data.current_units?.pm2_5 },
    { key: 'pm10', value: current.pm10, units: data.current_units?.pm10 },
    { key: 'ozone', value: current.ozone, units: data.current_units?.ozone },
    { key: 'nitrogen_dioxide', value: current.nitrogen_dioxide, units: data.current_units?.nitrogen_dioxide },
    { key: 'sulphur_dioxide', value: current.sulphur_dioxide, units: data.current_units?.sulphur_dioxide },
    { key: 'carbon_monoxide', value: current.carbon_monoxide, units: data.current_units?.carbon_monoxide }
  ];

  for (const pollutant of pollutants) {
    if (pollutant.value !== undefined) {
      const info = getPollutantInfo(pollutant.key);
      const concentration = formatPollutantConcentration(pollutant.value, pollutant.units);

      output += `**${info.name}:** ${concentration}\n`;
    }
  }

  if (current.ammonia !== undefined && data.current_units?.ammonia) {
    const info = getPollutantInfo('ammonia');
    const concentration = formatPollutantConcentration(current.ammonia, data.current_units.ammonia);
    output += `**${info.name}:** ${concentration}\n`;
  }

  if (current.aerosol_optical_depth !== undefined) {
    output += `**Aerosol Optical Depth:** ${current.aerosol_optical_depth.toFixed(3)} (atmospheric haze indicator)\n`;
  }

  output += `\n`;

  // Show secondary AQI for reference
  if (useUSAQI && current.european_aqi !== undefined) {
    output += `*European AQI: ${Math.round(current.european_aqi)} (${getEuropeanAQICategory(current.european_aqi).level})*\n\n`;
  } else if (!useUSAQI && current.us_aqi !== undefined) {
    output += `*US AQI: ${Math.round(current.us_aqi)} (${getUSAQICategory(current.us_aqi).level})*\n\n`;
  }

  // Add forecast summary if requested
  if (includeForecast && data.hourly && data.hourly.time && data.hourly.time.length > 0) {
    output += `---\n\n`;
    output += `## Air Quality Forecast\n\n`;

    // Show next 24 hours
    const hoursToShow = Math.min(24, data.hourly.time.length);
    output += `**Next ${hoursToShow} hours:**\n\n`;

    // Group by 6-hour periods for readability
    const periods = Math.ceil(hoursToShow / 6);
    for (let i = 0; i < periods; i++) {
      const startIdx = i * 6;
      const endIdx = Math.min(startIdx + 6, hoursToShow);

      const startTime = new Date(data.hourly.time[startIdx]);
      const endTime = new Date(data.hourly.time[endIdx - 1]);

      // Get AQI range for this period
      let minAQI = Infinity;
      let maxAQI = -Infinity;

      for (let j = startIdx; j < endIdx; j++) {
        const aqiValue = useUSAQI ? data.hourly.us_aqi?.[j] : data.hourly.european_aqi?.[j];
        if (aqiValue !== undefined) {
          minAQI = Math.min(minAQI, aqiValue);
          maxAQI = Math.max(maxAQI, aqiValue);
        }
      }

      const avgAQI = (minAQI + maxAQI) / 2;
      const aqiCategory = useUSAQI ? getUSAQICategory(avgAQI) : getEuropeanAQICategory(avgAQI);

      output += `**${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()}:** `;
      output += `${useUSAQI ? 'US' : 'EU'} AQI ${Math.round(minAQI)}-${Math.round(maxAQI)} (${aqiCategory.level})\n`;
    }

    output += `\n*Forecast includes ${data.hourly.time.length} hours of data*\n`;
  }

  return output;
}
