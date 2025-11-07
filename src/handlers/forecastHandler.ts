/**
 * Handler for get_forecast tool
 * Supports both NOAA (US) and Open-Meteo (global) forecast sources
 */

import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import type { GridpointProperties, GridpointDataSeries } from '../types/noaa.js';
import {
  validateCoordinates,
  validateForecastDays,
  validateGranularity,
  validateOptionalBoolean,
} from '../utils/validation.js';
import { logger } from '../utils/logger.js';

interface ForecastArgs {
  latitude?: number;
  longitude?: number;
  days?: number;
  granularity?: 'daily' | 'hourly';
  include_precipitation_probability?: boolean;
  include_severe_weather?: boolean;
  source?: 'auto' | 'noaa' | 'openmeteo';
}

/**
 * Determine if coordinates are within the United States (including Alaska, Hawaii, and territories)
 * Uses bounding box approach for simplicity
 */
function isInUS(latitude: number, longitude: number): boolean {
  // Continental US, Alaska, Hawaii, Puerto Rico, and territories
  const inContinentalUS = latitude >= 24.5 && latitude <= 49.4 && longitude >= -125 && longitude <= -66.9;
  const inAlaska = latitude >= 51 && latitude <= 71.4 && longitude >= -180 && longitude <= -129.9;
  const inHawaii = latitude >= 18.9 && latitude <= 28.5 && longitude >= -178.4 && longitude <= -154.8;
  const inPuertoRico = latitude >= 17.9 && latitude <= 18.5 && longitude >= -67.3 && longitude <= -65.2;

  return inContinentalUS || inAlaska || inHawaii || inPuertoRico;
}

/**
 * Extract maximum value from gridpoint data series for the next 24-48 hours
 * @param series - The gridpoint data series to process
 * @param hours - Number of hours to look ahead (default: 48)
 * @param maxEntries - Maximum number of entries to process for defense-in-depth (default: 500 ~ 1 week hourly data)
 */
function getMaxProbabilityFromSeries(series: GridpointDataSeries | undefined, hours: number = 48, maxEntries: number = 500): number {
  if (!series || !series.values || series.values.length === 0) {
    return 0;
  }

  // Defense-in-depth: Add bounds checking to prevent resource exhaustion
  if (series.values.length > maxEntries) {
    logger.warn('Gridpoint series exceeds max entries', {
      length: series.values.length,
      maxEntries,
      securityEvent: true
    });
    // Slice to limit processing
    series.values = series.values.slice(0, maxEntries);
  }

  const now = new Date();
  const futureTime = new Date(now.getTime() + hours * 60 * 60 * 1000);

  let maxValue = 0;
  for (const entry of series.values) {
    // Parse ISO 8601 interval (e.g., "2025-11-06T15:00:00+00:00/PT1H")
    const validTimeStart = new Date(entry.validTime.split('/')[0]);

    if (validTimeStart >= now && validTimeStart <= futureTime && entry.value !== null) {
      maxValue = Math.max(maxValue, entry.value);
    }
  }

  return maxValue;
}

/**
 * Format severe weather probabilities for display
 */
function formatSevereWeather(properties: GridpointProperties): string | null {
  let output = '';
  let hasData = false;

  output += `\n## ⚠️ Severe Weather Probabilities (Next 48 Hours)\n\n`;

  // Thunder probability
  const thunderProb = getMaxProbabilityFromSeries(properties.probabilityOfThunder);
  if (thunderProb > 0) {
    hasData = true;
    const emoji = thunderProb > 50 ? '🌩️' : thunderProb > 20 ? '⚡' : '🌤️';
    output += `${emoji} **Thunderstorms:** ${thunderProb}% chance\n`;
  }

  // Wind gust probabilities (show highest risk category)
  const windGust60 = getMaxProbabilityFromSeries(properties.potentialOf60mphWindGusts);
  const windGust50 = getMaxProbabilityFromSeries(properties.potentialOf50mphWindGusts);
  const windGust40 = getMaxProbabilityFromSeries(properties.potentialOf40mphWindGusts);
  const windGust30 = getMaxProbabilityFromSeries(properties.potentialOf30mphWindGusts);

  if (windGust60 > 0) {
    hasData = true;
    output += `💨 **Very High Wind Gusts (60+ mph):** ${windGust60}% chance\n`;
  } else if (windGust50 > 0) {
    hasData = true;
    output += `💨 **High Wind Gusts (50+ mph):** ${windGust50}% chance\n`;
  } else if (windGust40 > 0) {
    hasData = true;
    output += `💨 **Strong Wind Gusts (40+ mph):** ${windGust40}% chance\n`;
  } else if (windGust30 > 20) {
    // Only show moderate gusts if probability is significant
    hasData = true;
    output += `💨 **Moderate Wind Gusts (30+ mph):** ${windGust30}% chance\n`;
  }

  // Tropical storm/hurricane winds (if present)
  const tropicalStormProb = getMaxProbabilityFromSeries(properties.probabilityOfTropicalStormWinds);
  const hurricaneProb = getMaxProbabilityFromSeries(properties.probabilityOfHurricaneWinds);

  if (hurricaneProb > 0) {
    hasData = true;
    output += `🌀 **Hurricane-Force Winds (74+ mph):** ${hurricaneProb}% chance\n`;
  } else if (tropicalStormProb > 0) {
    hasData = true;
    output += `🌀 **Tropical Storm Winds (39-73 mph):** ${tropicalStormProb}% chance\n`;
  }

  // Lightning activity
  if (properties.lightningActivityLevel && properties.lightningActivityLevel.values && properties.lightningActivityLevel.values.length > 0) {
    const lightningLevels = properties.lightningActivityLevel.values.filter(v => v.value !== null && v.value > 0);
    if (lightningLevels.length > 0) {
      hasData = true;
      const maxLevel = Math.max(...lightningLevels.map(v => v.value || 0));
      const levelDesc = maxLevel >= 4 ? 'Very High' : maxLevel >= 3 ? 'High' : maxLevel >= 2 ? 'Moderate' : 'Low';
      output += `⚡ **Lightning Activity:** ${levelDesc} (Level ${maxLevel})\n`;
    }
  }

  if (!hasData) {
    return null; // No severe weather data to display
  }

  output += `\n*Note: These are probabilistic forecasts and may change. Always monitor local weather alerts for official warnings.*\n`;

  return output;
}

export async function handleGetForecast(
  args: unknown,
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input parameters with runtime checks
  const { latitude, longitude } = validateCoordinates(args);
  const days = validateForecastDays(args);
  const granularity = validateGranularity((args as ForecastArgs)?.granularity);
  const include_precipitation_probability = validateOptionalBoolean(
    (args as ForecastArgs)?.include_precipitation_probability,
    'include_precipitation_probability',
    true
  );
  const include_severe_weather = validateOptionalBoolean(
    (args as ForecastArgs)?.include_severe_weather,
    'include_severe_weather',
    false
  );

  // Get source preference or auto-detect
  const requestedSource = (args as ForecastArgs)?.source || 'auto';
  let useNOAA: boolean;

  if (requestedSource === 'auto') {
    // Auto-detect based on location (US = NOAA, elsewhere = Open-Meteo)
    useNOAA = isInUS(latitude, longitude);
  } else {
    useNOAA = requestedSource === 'noaa';
  }

  // Use NOAA for US locations or if explicitly requested
  if (useNOAA) {
    return await formatNOAAForecast(
      noaaService,
      latitude,
      longitude,
      days,
      granularity,
      include_precipitation_probability,
      include_severe_weather
    );
  } else {
    // Use Open-Meteo for international locations
    return await formatOpenMeteoForecast(
      openMeteoService,
      latitude,
      longitude,
      days,
      granularity,
      include_precipitation_probability
    );
  }
}

/**
 * Format NOAA forecast data for display
 */
async function formatNOAAForecast(
  noaaService: NOAAService,
  latitude: number,
  longitude: number,
  days: number,
  granularity: 'daily' | 'hourly',
  include_precipitation_probability: boolean,
  include_severe_weather: boolean
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Get forecast data based on granularity
  const forecast = granularity === 'hourly'
    ? await noaaService.getHourlyForecastByCoordinates(latitude, longitude)
    : await noaaService.getForecastByCoordinates(latitude, longitude);

  // Determine how many periods to show
  let periods;
  if (granularity === 'hourly') {
    // For hourly, show up to days * 24 hours
    periods = forecast.properties.periods.slice(0, days * 24);
  } else {
    // For daily, show up to days * 2 (day/night periods)
    periods = forecast.properties.periods.slice(0, days * 2);
  }

  // Format the forecast for display
  let output = `# Weather Forecast (${granularity === 'hourly' ? 'Hourly' : 'Daily'})\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Elevation:** ${forecast.properties.elevation.value}m\n`;
  if (forecast.properties.updated) {
    output += `**Updated:** ${new Date(forecast.properties.updated).toLocaleString()}\n`;
  }
  output += `**Showing:** ${periods.length} ${granularity === 'hourly' ? 'hours' : 'periods'}\n\n`;

  for (const period of periods) {
    // For hourly forecasts, use the start time as the header since period names are empty
    const periodHeader = granularity === 'hourly' && !period.name
      ? new Date(period.startTime).toLocaleString()
      : period.name;
    output += `## ${periodHeader}\n`;
    output += `**Temperature:** ${period.temperature}°${period.temperatureUnit}`;

    // Add temperature trend if available
    if (period.temperatureTrend && period.temperatureTrend.trim()) {
      output += ` (${period.temperatureTrend})`;
    }
    output += `\n`;

    // Add precipitation probability if requested and available
    if (include_precipitation_probability && period.probabilityOfPrecipitation?.value !== null && period.probabilityOfPrecipitation?.value !== undefined) {
      output += `**Precipitation Chance:** ${period.probabilityOfPrecipitation.value}%\n`;
    }

    output += `**Wind:** ${period.windSpeed} ${period.windDirection}\n`;

    // Add humidity if available (more common in hourly forecasts)
    if (period.relativeHumidity?.value !== null && period.relativeHumidity?.value !== undefined) {
      output += `**Humidity:** ${period.relativeHumidity.value}%\n`;
    }

    output += `**Forecast:** ${period.shortForecast}\n\n`;

    // For daily forecasts, include detailed forecast
    if (granularity === 'daily' && period.detailedForecast) {
      output += `${period.detailedForecast}\n\n`;
    }
  }

  output += `---\n`;
  output += `*Data source: NOAA National Weather Service (US)*\n`;

  // Add severe weather probabilities if requested
  if (include_severe_weather) {
    try {
      const gridpointData = await noaaService.getGridpointDataByCoordinates(latitude, longitude);
      const severeWeatherSection = formatSevereWeather(gridpointData.properties);
      if (severeWeatherSection) {
        output += `\n${severeWeatherSection}`;
      }
    } catch (error) {
      // If severe weather data is unavailable, just note it without failing the whole request
      output += `\n*Note: Severe weather probability data is not available for this location.*\n`;
    }
  }

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
 * Format Open-Meteo forecast data for display
 */
async function formatOpenMeteoForecast(
  openMeteoService: OpenMeteoService,
  latitude: number,
  longitude: number,
  days: number,
  granularity: 'daily' | 'hourly',
  include_precipitation_probability: boolean
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Get forecast data from Open-Meteo
  const forecast = await openMeteoService.getForecast(
    latitude,
    longitude,
    days,
    granularity === 'hourly'
  );

  let output = `# Weather Forecast (${granularity === 'hourly' ? 'Hourly' : 'Daily'})\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Elevation:** ${forecast.elevation}m\n`;
  output += `**Timezone:** ${forecast.timezone}\n`;
  output += `**Forecast Days:** ${days}\n\n`;

  if (granularity === 'hourly' && forecast.hourly) {
    // Format hourly data
    const hourly = forecast.hourly;
    const numHours = Math.min(hourly.time.length, days * 24);

    for (let i = 0; i < numHours; i++) {
      const time = new Date(hourly.time[i]);
      output += `## ${time.toLocaleString()}\n`;

      if (hourly.temperature_2m?.[i] !== undefined) {
        output += `**Temperature:** ${Math.round(hourly.temperature_2m[i])}°F`;
        if (hourly.apparent_temperature?.[i] !== undefined) {
          output += ` (feels like ${Math.round(hourly.apparent_temperature[i])}°F)`;
        }
        output += `\n`;
      }

      if (include_precipitation_probability && hourly.precipitation_probability?.[i] !== undefined) {
        output += `**Precipitation Chance:** ${hourly.precipitation_probability[i]}%\n`;
      }

      if (hourly.precipitation?.[i] !== undefined && hourly.precipitation[i] > 0) {
        output += `**Precipitation:** ${hourly.precipitation[i].toFixed(2)} in\n`;
      }

      if (hourly.wind_speed_10m?.[i] !== undefined) {
        const windDir = hourly.wind_direction_10m?.[i] !== undefined
          ? ` ${getWindDirection(hourly.wind_direction_10m[i])}`
          : '';
        output += `**Wind:** ${Math.round(hourly.wind_speed_10m[i])} mph${windDir}\n`;

        if (hourly.wind_gusts_10m?.[i] !== undefined && hourly.wind_gusts_10m[i] > hourly.wind_speed_10m[i] * 1.2) {
          output += `**Wind Gusts:** ${Math.round(hourly.wind_gusts_10m[i])} mph\n`;
        }
      }

      if (hourly.relative_humidity_2m?.[i] !== undefined) {
        output += `**Humidity:** ${hourly.relative_humidity_2m[i]}%\n`;
      }

      if (hourly.weather_code?.[i] !== undefined) {
        output += `**Conditions:** ${openMeteoService.getWeatherDescription(hourly.weather_code[i])}\n`;
      }

      output += `\n`;
    }
  } else if (forecast.daily) {
    // Format daily data with sunrise/sunset
    const daily = forecast.daily;
    const numDays = Math.min(daily.time.length, days);

    for (let i = 0; i < numDays; i++) {
      const date = new Date(daily.time[i]);
      output += `## ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\n`;

      if (daily.temperature_2m_max?.[i] !== undefined && daily.temperature_2m_min?.[i] !== undefined) {
        output += `**Temperature:** High ${Math.round(daily.temperature_2m_max[i])}°F / Low ${Math.round(daily.temperature_2m_min[i])}°F\n`;
      }

      if (daily.apparent_temperature_max?.[i] !== undefined && daily.apparent_temperature_min?.[i] !== undefined) {
        output += `**Feels Like:** High ${Math.round(daily.apparent_temperature_max[i])}°F / Low ${Math.round(daily.apparent_temperature_min[i])}°F\n`;
      }

      // Include sunrise/sunset data
      if (daily.sunrise?.[i]) {
        const sunrise = new Date(daily.sunrise[i]);
        output += `**Sunrise:** ${sunrise.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}\n`;
      }

      if (daily.sunset?.[i]) {
        const sunset = new Date(daily.sunset[i]);
        output += `**Sunset:** ${sunset.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}\n`;
      }

      if (daily.daylight_duration?.[i] !== undefined) {
        const hours = Math.floor(daily.daylight_duration[i] / 3600);
        const minutes = Math.floor((daily.daylight_duration[i] % 3600) / 60);
        output += `**Daylight Duration:** ${hours}h ${minutes}m\n`;
      }

      if (include_precipitation_probability && daily.precipitation_probability_max?.[i] !== undefined) {
        output += `**Precipitation Chance:** ${daily.precipitation_probability_max[i]}%\n`;
      }

      if (daily.precipitation_sum?.[i] !== undefined && daily.precipitation_sum[i] > 0) {
        output += `**Precipitation:** ${daily.precipitation_sum[i].toFixed(2)} in\n`;
      }

      if (daily.wind_speed_10m_max?.[i] !== undefined) {
        const windDir = daily.wind_direction_10m_dominant?.[i] !== undefined
          ? ` ${getWindDirection(daily.wind_direction_10m_dominant[i])}`
          : '';
        output += `**Wind:** ${Math.round(daily.wind_speed_10m_max[i])} mph${windDir}\n`;

        if (daily.wind_gusts_10m_max?.[i] !== undefined && daily.wind_gusts_10m_max[i] > daily.wind_speed_10m_max[i] * 1.2) {
          output += `**Wind Gusts:** ${Math.round(daily.wind_gusts_10m_max[i])} mph\n`;
        }
      }

      if (daily.weather_code?.[i] !== undefined) {
        output += `**Conditions:** ${openMeteoService.getWeatherDescription(daily.weather_code[i])}\n`;
      }

      if (daily.uv_index_max?.[i] !== undefined) {
        output += `**UV Index:** ${daily.uv_index_max[i].toFixed(1)}\n`;
      }

      output += `\n`;
    }
  }

  output += `---\n`;
  output += `*Data source: Open-Meteo (Global)*\n`;

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
 * Convert wind direction degrees to cardinal direction
 */
function getWindDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}
