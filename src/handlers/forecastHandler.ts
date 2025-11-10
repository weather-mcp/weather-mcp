/**
 * Handler for get_forecast tool
 * Supports both NOAA (US) and Open-Meteo (global) forecast sources
 */

import { DateTime } from 'luxon';
import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { NCEIService } from '../services/ncei.js';
import type { GridpointProperties, GridpointDataSeries } from '../types/noaa.js';
import {
  validateCoordinates,
  validateForecastDays,
  validateGranularity,
  validateOptionalBoolean,
} from '../utils/validation.js';
import { logger } from '../utils/logger.js';
import {
  extractSnowfallForecast,
  extractIceAccumulation,
  formatSnowData,
  hasWinterWeather
} from '../utils/snow.js';
import { formatInTimezone, guessTimezoneFromCoords } from '../utils/timezone.js';
import { getClimateNormals, formatNormals, getDateComponents } from '../utils/normals.js';

interface ForecastArgs {
  latitude?: number;
  longitude?: number;
  days?: number;
  granularity?: 'daily' | 'hourly';
  include_precipitation_probability?: boolean;
  include_severe_weather?: boolean;
  include_normals?: boolean;
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
  // IMPORTANT: Work on a local copy to avoid mutating cached data
  let valuesToProcess = series.values;
  if (series.values.length > maxEntries) {
    logger.warn('Gridpoint series exceeds max entries', {
      length: series.values.length,
      maxEntries,
      securityEvent: true
    });
    // Create a local copy with limited entries - do not mutate the original
    valuesToProcess = series.values.slice(0, maxEntries);
  }

  const now = new Date();
  const futureTime = new Date(now.getTime() + hours * 60 * 60 * 1000);

  let maxValue = 0;
  for (const entry of valuesToProcess) {
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
  openMeteoService: OpenMeteoService,
  nceiService?: NCEIService
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
  const include_normals = validateOptionalBoolean(
    (args as ForecastArgs)?.include_normals,
    'include_normals',
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
      openMeteoService,
      nceiService,
      latitude,
      longitude,
      days,
      granularity,
      include_precipitation_probability,
      include_severe_weather,
      include_normals
    );
  } else {
    // Use Open-Meteo for international locations
    return await formatOpenMeteoForecast(
      openMeteoService,
      nceiService,
      latitude,
      longitude,
      days,
      granularity,
      include_precipitation_probability,
      include_normals
    );
  }
}

/**
 * Format NOAA forecast data for display
 */
async function formatNOAAForecast(
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService | undefined,
  latitude: number,
  longitude: number,
  days: number,
  granularity: 'daily' | 'hourly',
  include_precipitation_probability: boolean,
  include_severe_weather: boolean,
  include_normals: boolean
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Get timezone for proper time formatting
  let timezone = guessTimezoneFromCoords(latitude, longitude);
  try {
    const points = await noaaService.getPointData(latitude, longitude);
    if (points.properties.timeZone) {
      timezone = points.properties.timeZone;
    }
  } catch (error) {
    // Use fallback timezone
  }
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
    output += `**Updated:** ${formatInTimezone(forecast.properties.updated, timezone)}\n`;
  }
  output += `**Showing:** ${periods.length} ${granularity === 'hourly' ? 'hours' : 'periods'}\n\n`;

  for (const period of periods) {
    // For hourly forecasts, use the start time as the header since period names are empty
    const periodHeader = granularity === 'hourly' && !period.name
      ? formatInTimezone(period.startTime, timezone, 'short')
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

  // Fetch gridpoint data once for both severe weather and winter weather
  let gridpointData: Awaited<ReturnType<typeof noaaService.getGridpointDataByCoordinates>> | null = null;

  // Add severe weather probabilities if requested
  if (include_severe_weather) {
    try {
      gridpointData = await noaaService.getGridpointDataByCoordinates(latitude, longitude);
      const severeWeatherSection = formatSevereWeather(gridpointData.properties);
      if (severeWeatherSection) {
        output += `\n${severeWeatherSection}`;
      }
    } catch (error) {
      // If severe weather data is unavailable, just note it without failing the whole request
      output += `\n*Note: Severe weather probability data is not available for this location.*\n`;
    }
  }

  // Add winter weather (snowfall/ice) if available
  try {
    // Fetch gridpoint data if we haven't already
    if (!gridpointData) {
      gridpointData = await noaaService.getGridpointDataByCoordinates(latitude, longitude);
    }

    // Calculate time range for forecast period
    const now = new Date();
    const endTime = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // Extract snowfall and ice accumulation
    const snowfall = extractSnowfallForecast(gridpointData.properties, now, endTime);
    const ice = extractIceAccumulation(gridpointData.properties, now, endTime);

    const winterData = {
      snowfallAmount: snowfall,
      iceAccumulation: ice
    };

    if (hasWinterWeather(winterData)) {
      output += formatSnowData(winterData);
    }
  } catch (error) {
    // Winter weather data is optional, silently skip if unavailable
  }

  // Add climate normals if requested and for daily forecasts only
  if (include_normals && granularity === 'daily') {
    try {
      // Get the first forecast day to determine the date
      const firstPeriod = periods[0];
      if (firstPeriod && firstPeriod.startTime) {
        const { month, day } = getDateComponents(firstPeriod.startTime);

        // Fetch climate normals using hybrid strategy
        const normals = await getClimateNormals(
          openMeteoService,
          nceiService,
          latitude,
          longitude,
          month,
          day
        );

        // Get forecasted high/low for comparison (first day)
        let forecastHigh: number | undefined;
        let forecastLow: number | undefined;

        // NOAA gives day/night periods, so we need to find high (day) and low (night)
        for (const period of periods.slice(0, 2)) { // Check first 2 periods (day + night)
          if (period.isDaytime && period.temperature !== undefined) {
            forecastHigh = period.temperature;
          } else if (!period.isDaytime && period.temperature !== undefined) {
            forecastLow = period.temperature;
          }
        }

        const currentTemps = {
          high: forecastHigh,
          low: forecastLow
        };

        output += formatNormals(normals, currentTemps);
      }
    } catch (error) {
      // If normals fetch fails, just skip it (don't error the whole request)
      output += `\n## Climate Normals\n\n`;
      output += `⚠️ Climate normals data not available for this location.\n`;
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
  nceiService: NCEIService | undefined,
  latitude: number,
  longitude: number,
  days: number,
  granularity: 'daily' | 'hourly',
  include_precipitation_probability: boolean,
  include_normals: boolean
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
      output += `## ${formatInTimezone(hourly.time[i], forecast.timezone, 'short')}\n`;

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
      // Use timezone-aware date formatting
      const dt = DateTime.fromISO(daily.time[i], { setZone: false }).setZone(forecast.timezone);
      output += `## ${dt.toLocaleString({ weekday: 'long', month: 'long', day: 'numeric' })}\n`;

      if (daily.temperature_2m_max?.[i] !== undefined && daily.temperature_2m_min?.[i] !== undefined) {
        output += `**Temperature:** High ${Math.round(daily.temperature_2m_max[i])}°F / Low ${Math.round(daily.temperature_2m_min[i])}°F\n`;
      }

      if (daily.apparent_temperature_max?.[i] !== undefined && daily.apparent_temperature_min?.[i] !== undefined) {
        output += `**Feels Like:** High ${Math.round(daily.apparent_temperature_max[i])}°F / Low ${Math.round(daily.apparent_temperature_min[i])}°F\n`;
      }

      // Include sunrise/sunset data with timezone
      if (daily.sunrise?.[i]) {
        const sunrise = DateTime.fromISO(daily.sunrise[i], { setZone: false }).setZone(forecast.timezone);
        output += `**Sunrise:** ${sunrise.toLocaleString(DateTime.TIME_SIMPLE)}\n`;
      }

      if (daily.sunset?.[i]) {
        const sunset = DateTime.fromISO(daily.sunset[i], { setZone: false }).setZone(forecast.timezone);
        output += `**Sunset:** ${sunset.toLocaleString(DateTime.TIME_SIMPLE)}\n`;
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

  // Add climate normals if requested and for daily forecasts only
  if (include_normals && granularity === 'daily' && forecast.daily) {
    try {
      // Get the first forecast day
      const firstDay = forecast.daily.time[0];
      if (firstDay) {
        const { month, day } = getDateComponents(firstDay);

        // Fetch climate normals using hybrid strategy
        const normals = await getClimateNormals(
          openMeteoService,
          nceiService,
          latitude,
          longitude,
          month,
          day
        );

        // Get forecasted high/low for comparison (first day)
        const currentTemps = {
          high: forecast.daily.temperature_2m_max?.[0] !== undefined
            ? Math.round(forecast.daily.temperature_2m_max[0])
            : undefined,
          low: forecast.daily.temperature_2m_min?.[0] !== undefined
            ? Math.round(forecast.daily.temperature_2m_min[0])
            : undefined
        };

        output += formatNormals(normals, currentTemps);
      }
    } catch (error) {
      // If normals fetch fails, just skip it (don't error the whole request)
      output += `\n## Climate Normals\n\n`;
      output += `⚠️ Climate normals data not available for this location.\n`;
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
 * Convert wind direction degrees to cardinal direction
 */
function getWindDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}
