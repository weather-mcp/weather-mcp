/**
 * Handler for get_air_quality tool
 */

import { OpenMeteoService } from '../services/openmeteo.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateOptionalBoolean, validatePositiveInteger } from '../utils/validation.js';
import {
  getUSAQICategory,
  getEuropeanAQICategory,
  getUVIndexCategory,
  getPollutantInfo,
  formatPollutantConcentration,
  shouldUseUSAQI
} from '../utils/airQuality.js';
import type { OpenMeteoAirQualityResponse, OpenMeteoAirQualityHourlyData } from '../types/openmeteo.js';

interface AirQualityArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  forecast?: boolean;
  forecast_days?: number;
}

const DEFAULT_FORECAST_DAYS = 5;
const MAX_FORECAST_DAYS = 7; // Open-Meteo air quality API limit (168 hours)

export async function handleGetAirQuality(
  args: unknown,
  openMeteoService: OpenMeteoService,
  locationStore: LocationStore,
  geocodingService: GeocodingService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Resolve location from coordinates, a saved location name, or a geocoded city name
  const resolved = await resolveLocationAsync(args as AirQualityArgs, locationStore, geocodingService);
  const { latitude, longitude } = resolved;
  const forecast = validateOptionalBoolean(
    (args as AirQualityArgs)?.forecast,
    'forecast',
    false
  );
  const rawForecastDays = (args as AirQualityArgs)?.forecast_days;
  const forecastDays = rawForecastDays === undefined
    ? DEFAULT_FORECAST_DAYS
    : validatePositiveInteger(rawForecastDays, 'forecast_days', 1, MAX_FORECAST_DAYS);

  // Get air quality data
  const airQualityData = await openMeteoService.getAirQuality(
    latitude,
    longitude,
    forecast,
    forecastDays
  );

  // Format the air quality data for display
  const output = formatAirQuality(airQualityData, latitude, longitude, forecast);

  return prependLocationLine({
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  }, resolved);
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
    output += formatHourlyForecast(data.hourly, useUSAQI, current.time);
  }

  return output;
}

/**
 * Format the hourly AQI forecast grouped by local calendar day, with 6-hour
 * period ranges inside each day. Hours before the current observation time
 * are skipped. Open-Meteo returns location-local ISO timestamps
 * ("YYYY-MM-DDTHH:mm" with timezone=auto), so dates and hours are read
 * directly from the strings instead of being parsed through the server's
 * local timezone.
 */
function formatHourlyForecast(
  hourly: OpenMeteoAirQualityHourlyData,
  useUSAQI: boolean,
  currentTime: string
): string {
  const times = hourly.time;
  let output = '';

  // The declared types say number[], but past the model's real horizon the
  // API pads the arrays with nulls — which would coerce to 0 ("Good") in
  // Math.min/max. Treat anything non-finite as missing.
  const aqiAt = (i: number): number | undefined => {
    const value = useUSAQI ? hourly.us_aqi?.[i] : hourly.european_aqi?.[i];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };

  // Skip hours already past. ISO local timestamps compare lexicographically.
  const nowHour = currentTime.slice(0, 13);
  let startIdx = times.findIndex((t) => t.slice(0, 13) >= nowHour);
  if (startIdx === -1) {
    startIdx = 0;
  }

  // Trim trailing hours with no AQI data (nulls past the model horizon)
  let lastIdx = times.length - 1;
  while (lastIdx >= startIdx && aqiAt(lastIdx) === undefined) {
    lastIdx--;
  }
  if (lastIdx < startIdx) {
    return `*No AQI forecast data available for this location.*\n`;
  }

  // Group remaining hourly indices by local calendar date
  const dayOrder: string[] = [];
  const dayIndices = new Map<string, number[]>();
  for (let i = startIdx; i <= lastIdx; i++) {
    const date = times[i].slice(0, 10);
    let indices = dayIndices.get(date);
    if (!indices) {
      indices = [];
      dayIndices.set(date, indices);
      dayOrder.push(date);
    }
    indices.push(i);
  }

  const aqiScale = useUSAQI ? 'US' : 'EU';

  for (const date of dayOrder) {
    const indices = dayIndices.get(date)!;

    let dayPeak = -Infinity;
    for (const i of indices) {
      const value = aqiAt(i);
      if (value !== undefined) {
        dayPeak = Math.max(dayPeak, value);
      }
    }

    if (dayPeak === -Infinity) {
      output += `### ${formatDayLabel(date)}\n\n*No AQI data available for this day*\n\n`;
      continue;
    }

    const peakCategory = useUSAQI ? getUSAQICategory(dayPeak) : getEuropeanAQICategory(dayPeak);
    output += `### ${formatDayLabel(date)} — peak ${aqiScale} AQI ${Math.round(dayPeak)} (${peakCategory.level})\n\n`;

    // 6-hour periods aligned to the local clock (12 AM / 6 AM / 12 PM / 6 PM)
    const periods = new Map<number, number[]>();
    for (const i of indices) {
      const hour = parseInt(times[i].slice(11, 13), 10);
      const period = Math.floor(hour / 6);
      let periodIndices = periods.get(period);
      if (!periodIndices) {
        periodIndices = [];
        periods.set(period, periodIndices);
      }
      periodIndices.push(i);
    }

    for (const [, periodIndices] of [...periods.entries()].sort((a, b) => a[0] - b[0])) {
      let minAQI = Infinity;
      let maxAQI = -Infinity;
      for (const i of periodIndices) {
        const value = aqiAt(i);
        if (value !== undefined) {
          minAQI = Math.min(minAQI, value);
          maxAQI = Math.max(maxAQI, value);
        }
      }
      if (maxAQI === -Infinity) {
        continue;
      }

      const startHour = parseInt(times[periodIndices[0]].slice(11, 13), 10);
      const endHour = parseInt(times[periodIndices[periodIndices.length - 1]].slice(11, 13), 10);
      const category = useUSAQI ? getUSAQICategory(maxAQI) : getEuropeanAQICategory(maxAQI);
      const range = Math.round(minAQI) === Math.round(maxAQI)
        ? `${Math.round(maxAQI)}`
        : `${Math.round(minAQI)}-${Math.round(maxAQI)}`;

      output += `- **${formatHour(startHour)} – ${formatHour(endHour)}:** ${aqiScale} AQI ${range} (${category.level})\n`;
    }

    output += `\n`;
  }

  const hoursShown = lastIdx - startIdx + 1;
  output += `*Forecast covers ${hoursShown} hours across ${dayOrder.length} day(s). `;
  output += `Each period's category reflects its peak AQI.*\n`;
  if (lastIdx < times.length - 1) {
    const missing = times.length - 1 - lastIdx;
    output += `*The air quality model provided no data for the final ${missing} requested hour(s).*\n`;
  }

  return output;
}

/**
 * Format a local hour (0-23) as a 12-hour clock label
 */
function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * Format a "YYYY-MM-DD" date as a weekday + date label. Anchored to noon UTC
 * so the printed day never shifts with the server's timezone.
 */
function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}
