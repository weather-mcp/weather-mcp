/**
 * Handler for get_current_conditions tool
 */

import { NOAAService } from '../services/noaa.js';
import { validateCoordinates, validateOptionalBoolean } from '../utils/validation.js';
import { convertToFahrenheit } from '../utils/temperatureConversion.js';
import { DisplayThresholds } from '../config/displayThresholds.js';
import {
  getHainesCategory,
  getGrasslandFireDangerCategory,
  getRedFlagCategory,
  getCurrentFireWeatherValue,
  formatMixingHeight,
  interpretTransportWind
} from '../utils/fireWeather.js';

interface CurrentConditionsArgs {
  latitude?: number;
  longitude?: number;
  include_fire_weather?: boolean;
}

export async function handleGetCurrentConditions(
  args: unknown,
  noaaService: NOAAService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input parameters with runtime checks
  const { latitude, longitude } = validateCoordinates(args);
  const includeFireWeather = validateOptionalBoolean(
    (args as CurrentConditionsArgs)?.include_fire_weather,
    'include_fire_weather',
    false
  );

  // Get current observation
  const observation = await noaaService.getCurrentConditions(latitude, longitude);
  const props = observation.properties;

  // Format current conditions
  let output = `# Current Weather Conditions\n\n`;
  output += `**Station:** ${props.station}\n`;
  output += `**Time:** ${new Date(props.timestamp).toLocaleString()}\n\n`;

  // Main conditions
  if (props.textDescription) {
    output += `**Conditions:** ${props.textDescription}\n`;
  }

  // Temperature section
  const tempF = convertToFahrenheit(props.temperature.value, props.temperature.unitCode);
  if (tempF !== null) {
    output += `**Temperature:** ${Math.round(tempF)}°F\n`;

    // Show heat index when temperature is high and heat index is available
    if (props.heatIndex) {
      const heatIndexF = convertToFahrenheit(props.heatIndex.value, props.heatIndex.unitCode);
      if (heatIndexF !== null && tempF > DisplayThresholds.temperature.showHeatIndex && heatIndexF > tempF) {
        output += `**Feels Like (Heat Index):** ${Math.round(heatIndexF)}°F\n`;
      }
    }

    // Show wind chill when temperature is low and wind chill is available
    if (props.windChill) {
      const windChillF = convertToFahrenheit(props.windChill.value, props.windChill.unitCode);
      if (windChillF !== null && tempF < DisplayThresholds.temperature.showWindChill && windChillF < tempF) {
        output += `**Feels Like (Wind Chill):** ${Math.round(windChillF)}°F\n`;
      }
    }
  }

  // 24-hour temperature range
  const max24F = props.maxTemperatureLast24Hours ? convertToFahrenheit(props.maxTemperatureLast24Hours.value, props.maxTemperatureLast24Hours.unitCode) : null;
  const min24F = props.minTemperatureLast24Hours ? convertToFahrenheit(props.minTemperatureLast24Hours.value, props.minTemperatureLast24Hours.unitCode) : null;
  if (max24F !== null || min24F !== null) {
    let range = `**24-Hour Range:**`;
    if (max24F !== null) range += ` High ${Math.round(max24F)}°F`;
    if (max24F !== null && min24F !== null) range += ` /`;
    if (min24F !== null) range += ` Low ${Math.round(min24F)}°F`;
    output += `${range}\n`;
  }

  if (props.dewpoint.value !== null) {
    const dewF = convertToFahrenheit(props.dewpoint.value, props.dewpoint.unitCode);
    if (dewF !== null) {
      output += `**Dewpoint:** ${Math.round(dewF)}°F\n`;
    }
  }

  if (props.relativeHumidity.value !== null) {
    output += `**Humidity:** ${Math.round(props.relativeHumidity.value)}%\n`;
  }

  // Wind section
  if (props.windSpeed && props.windSpeed.value !== null) {
    const windMph = props.windSpeed.unitCode.includes('km_h')
      ? props.windSpeed.value * 0.621371
      : props.windSpeed.value * 2.23694; // m/s to mph
    const windDir = props.windDirection?.value ?? null;
    output += `**Wind:** ${Math.round(windMph)} mph`;
    if (windDir !== null) {
      output += ` from ${Math.round(windDir)}°`;
    }

    // Add wind gust if available and significant
    if (props.windGust && props.windGust.value !== null) {
      const gustMph = props.windGust.unitCode.includes('km_h')
        ? props.windGust.value * 0.621371
        : props.windGust.value * 2.23694;
      if (gustMph > windMph * DisplayThresholds.wind.gustSignificanceRatio) {
        output += `, gusting to ${Math.round(gustMph)} mph`;
      }
    }
    output += `\n`;
  }

  if (props.barometricPressure && props.barometricPressure.value !== null) {
    const pressureInHg = props.barometricPressure.value * 0.0002953;
    output += `**Pressure:** ${pressureInHg.toFixed(2)} inHg\n`;
  }

  // Enhanced visibility and cloud cover
  if (props.visibility && props.visibility.value !== null) {
    const visibilityMiles = props.visibility.value * 0.000621371;
    output += `**Visibility:** ${visibilityMiles.toFixed(1)} miles`;

    // Add descriptive text for visibility
    if (visibilityMiles < DisplayThresholds.visibility.denseFog) {
      output += ` (dense fog)`;
    } else if (visibilityMiles < DisplayThresholds.visibility.fog) {
      output += ` (fog)`;
    } else if (visibilityMiles < DisplayThresholds.visibility.hazeMist) {
      output += ` (haze/mist)`;
    } else if (visibilityMiles >= DisplayThresholds.visibility.clear) {
      output += ` (clear)`;
    }
    output += `\n`;
  }

  // Cloud cover details
  if (props.cloudLayers && props.cloudLayers.length > 0) {
    const cloudDescriptions: { [key: string]: string } = {
      'FEW': 'Few clouds',
      'SCT': 'Scattered clouds',
      'BKN': 'Broken clouds',
      'OVC': 'Overcast',
      'CLR': 'Clear',
      'SKC': 'Sky clear'
    };

    const clouds = props.cloudLayers
      .filter(layer => layer.amount)
      .map(layer => {
        const desc = cloudDescriptions[layer.amount] || layer.amount;
        if (layer.base?.value !== null && layer.base?.value !== undefined) {
          const heightFt = layer.base.unitCode.includes('m')
            ? layer.base.value * 3.28084
            : layer.base.value;
          return `${desc} at ${Math.round(heightFt).toLocaleString()} ft`;
        }
        return desc;
      });

    if (clouds.length > 0) {
      output += `**Cloud Cover:** ${clouds.join(', ')}\n`;
    }
  }

  // Precipitation section
  const precip1h = props.precipitationLastHour?.value ?? null;
  const precip3h = props.precipitationLast3Hours?.value ?? null;
  const precip6h = props.precipitationLast6Hours?.value ?? null;

  if (precip1h !== null || precip3h !== null || precip6h !== null) {
    output += `\n## Recent Precipitation\n`;

    if (precip1h !== null && props.precipitationLastHour) {
      const precipIn = props.precipitationLastHour.unitCode.includes('mm')
        ? precip1h * 0.0393701
        : precip1h;
      output += `**Last Hour:** ${precipIn.toFixed(2)} inches\n`;
    }

    if (precip3h !== null && props.precipitationLast3Hours) {
      const precipIn = props.precipitationLast3Hours.unitCode.includes('mm')
        ? precip3h * 0.0393701
        : precip3h;
      output += `**Last 3 Hours:** ${precipIn.toFixed(2)} inches\n`;
    }

    if (precip6h !== null && props.precipitationLast6Hours) {
      const precipIn = props.precipitationLast6Hours.unitCode.includes('mm')
        ? precip6h * 0.0393701
        : precip6h;
      output += `**Last 6 Hours:** ${precipIn.toFixed(2)} inches\n`;
    }
  }

  // Fire Weather section (optional)
  if (includeFireWeather) {
    try {
      const gridpointData = await noaaService.getGridpointDataByCoordinates(latitude, longitude);
      const fireProps = gridpointData.properties;

      // Check if any fire weather data is available
      const hainesValue = getCurrentFireWeatherValue(fireProps.hainesIndex);
      const grasslandValue = getCurrentFireWeatherValue(fireProps.grasslandFireDangerIndex);
      const redFlagValue = getCurrentFireWeatherValue(fireProps.redFlagThreatIndex);
      const mixingHeightValue = getCurrentFireWeatherValue(fireProps.mixingHeight);
      const transportWindValue = getCurrentFireWeatherValue(fireProps.transportWindSpeed);

      if (hainesValue !== null || grasslandValue !== null || redFlagValue !== null || mixingHeightValue !== null) {
        output += `\n## Fire Weather\n\n`;

        // Haines Index
        if (hainesValue !== null) {
          const hainesCategory = getHainesCategory(hainesValue);
          const emoji = hainesCategory.level === 'Low' ? '🟢' :
                        hainesCategory.level === 'Moderate' ? '🟡' :
                        hainesCategory.level === 'High' ? '🟠' : '🔴';

          output += `**${emoji} Haines Index:** ${hainesValue} (${hainesCategory.level})\n`;
          output += `${hainesCategory.fireGrowthPotential}\n\n`;
        }

        // Grassland Fire Danger Index
        if (grasslandValue !== null) {
          const grasslandCategory = getGrasslandFireDangerCategory(grasslandValue);
          const emoji = grasslandCategory.level === 'Low' ? '🟢' :
                        grasslandCategory.level === 'Moderate' ? '🟡' :
                        grasslandCategory.level === 'High' ? '🟠' : '🔴';

          output += `**${emoji} Grassland Fire Danger:** ${grasslandValue} (${grasslandCategory.level})\n`;
          output += `${grasslandCategory.description}\n\n`;
        }

        // Red Flag Threat Index
        if (redFlagValue !== null) {
          const redFlagCategory = getRedFlagCategory(redFlagValue);
          const emoji = redFlagCategory.level === 'Low' ? '🟢' :
                        redFlagCategory.level === 'Moderate' ? '🟡' :
                        redFlagCategory.level === 'High' ? '🟠' : '🔴';

          output += `**${emoji} Red Flag Threat:** ${Math.round(redFlagValue)} (${redFlagCategory.level})\n`;
          output += `${redFlagCategory.description}\n\n`;
        }

        // Mixing Height (important for smoke dispersion)
        if (mixingHeightValue !== null) {
          const mixingHeightFt = mixingHeightValue; // Already in feet from API
          output += `**Mixing Height:** ${formatMixingHeight(mixingHeightFt)}\n`;
        }

        // Transport Wind Speed (smoke transport)
        if (transportWindValue !== null) {
          output += `**Transport Wind:** ${interpretTransportWind(transportWindValue)}\n`;
        }
      } else {
        output += `\n## Fire Weather\n\n`;
        output += `No fire weather data available for this location.\n`;
      }
    } catch (error) {
      // If fire weather data fetch fails, just skip it (don't error the whole request)
      output += `\n## Fire Weather\n\n`;
      output += `⚠️ Fire weather data not available for this location.\n`;
    }
  }

  output += `\n---\n`;
  output += `*Data source: NOAA National Weather Service*\n`;

  return {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };
}
