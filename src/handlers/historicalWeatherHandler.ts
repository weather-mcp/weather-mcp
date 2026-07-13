/**
 * Handler for get_historical_weather tool
 */

import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateHistoricalWeatherParams } from '../utils/validation.js';
import { resolveUnitPreferences, UnitArgs } from '../utils/unitPreferences.js';
import {
  temperatureLabel,
  windSpeedLabel,
  precipitationLabel,
  formatElevationFromM,
  formatTemperatureQV,
  formatWindSpeedQV,
  formatPressureFromPa,
} from '../utils/unitFormat.js';
import { ApiConstants, FormatConstants } from '../config/displayThresholds.js';

export async function handleGetHistoricalWeather(
  args: unknown,
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService,
  locationStore: LocationStore,
  geocodingService: GeocodingService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Resolve location first (coordinates, saved name, or geocoded city), then
  // validate the date range. Coordinates from resolution are re-validated by
  // validateHistoricalWeatherParams alongside the dates.
  const resolved = await resolveLocationAsync(args as { latitude?: number; longitude?: number; location_name?: string; city_name?: string }, locationStore, geocodingService);
  const { latitude, longitude, start_date, end_date, limit = FormatConstants.defaultHistoricalLimit } = validateHistoricalWeatherParams({
    ...(args as Record<string, unknown>),
    latitude: resolved.latitude,
    longitude: resolved.longitude
  });
  const prefs = resolveUnitPreferences(args as UnitArgs);
  const tempU = temperatureLabel(prefs);
  const windU = windSpeedLabel(prefs);
  const precipU = precipitationLabel(prefs);

  // Parse dates
  const startTime = new Date(start_date);
  const endTime = new Date(end_date);

  // Validate dates are not in the future
  const now = new Date();
  if (startTime > now) {
    throw new Error(`Start date (${start_date}) cannot be in the future. Current date is ${now.toISOString().split('T')[0]}.`);
  }
  if (endTime > now) {
    throw new Error(`End date (${end_date}) cannot be in the future. Current date is ${now.toISOString().split('T')[0]}.`);
  }

  // Determine which API to use based on date range
  // If start date is older than threshold, use archival API
  const thresholdDate = new Date(now.getTime() - ApiConstants.historicalDataThresholdDays * 24 * 60 * 60 * 1000);
  const useArchivalData = startTime < thresholdDate;

  if (useArchivalData) {
    // Use Open-Meteo API for historical/archival data
    try {
      // Determine whether to use hourly or daily data based on date range
      const daysDiff = Math.ceil((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24));
      const useHourly = daysDiff <= ApiConstants.maxHourlyHistoricalDays;

      const weatherData = await openMeteoService.getHistoricalWeather(
        latitude,
        longitude,
        start_date.split('T')[0], // Ensure YYYY-MM-DD format
        end_date.split('T')[0],
        useHourly,
        prefs
      );

      // Format the response based on data granularity
      if (useHourly && weatherData.hourly) {
        // Format hourly observations
        const maxObservations = Math.min(limit, weatherData.hourly.time.length);
        let output = `# Historical Weather Observations (Hourly)\n\n`;
        // Use the requested date strings directly; constructing a Date and calling
        // toLocaleDateString() would shift the displayed day in non-UTC server zones.
        output += `**Period:** ${start_date.split('T')[0]} to ${end_date.split('T')[0]}\n`;
        output += `**Location:** ${weatherData.latitude.toFixed(4)}°N, ${Math.abs(weatherData.longitude).toFixed(4)}°${weatherData.longitude >= 0 ? 'E' : 'W'} (${formatElevationFromM(weatherData.elevation, prefs)} elevation)\n`;
        output += `**Number of observations:** ${maxObservations}${maxObservations < weatherData.hourly.time.length ? ` (of ${weatherData.hourly.time.length} available)` : ''}\n`;
        output += `**Data source:** Open-Meteo Historical Weather API (Reanalysis)\n\n`;

        for (let i = 0; i < maxObservations; i++) {
          const time = new Date(weatherData.hourly.time[i]);
          output += `## ${time.toLocaleString()}\n`;

          if (weatherData.hourly.temperature_2m?.[i] !== null && weatherData.hourly.temperature_2m?.[i] !== undefined) {
            output += `- **Temperature:** ${Math.round(weatherData.hourly.temperature_2m[i])}${tempU}\n`;
          }

          if (weatherData.hourly.apparent_temperature?.[i] !== null && weatherData.hourly.apparent_temperature?.[i] !== undefined) {
            output += `- **Feels Like:** ${Math.round(weatherData.hourly.apparent_temperature[i])}${tempU}\n`;
          }

          if (weatherData.hourly.weather_code?.[i] !== null && weatherData.hourly.weather_code?.[i] !== undefined) {
            output += `- **Conditions:** ${openMeteoService.getWeatherDescription(weatherData.hourly.weather_code[i])}\n`;
          }

          if (weatherData.hourly.precipitation?.[i] !== null && weatherData.hourly.precipitation?.[i] !== undefined && weatherData.hourly.precipitation[i] > 0) {
            output += `- **Precipitation:** ${weatherData.hourly.precipitation[i].toFixed(2)} ${precipU}\n`;
          }

          if (weatherData.hourly.snowfall?.[i] !== null && weatherData.hourly.snowfall?.[i] !== undefined && weatherData.hourly.snowfall[i] > 0) {
            output += `- **Snowfall:** ${weatherData.hourly.snowfall[i].toFixed(1)} ${precipU}\n`;
          }

          if (weatherData.hourly.wind_speed_10m?.[i] !== null && weatherData.hourly.wind_speed_10m?.[i] !== undefined) {
            output += `- **Wind:** ${Math.round(weatherData.hourly.wind_speed_10m[i])} ${windU}`;
            if (weatherData.hourly.wind_direction_10m?.[i] !== null && weatherData.hourly.wind_direction_10m?.[i] !== undefined) {
              output += ` from ${Math.round(weatherData.hourly.wind_direction_10m[i])}°`;
            }
            output += `\n`;
          }

          if (weatherData.hourly.relative_humidity_2m?.[i] !== null && weatherData.hourly.relative_humidity_2m?.[i] !== undefined) {
            output += `- **Humidity:** ${Math.round(weatherData.hourly.relative_humidity_2m[i])}%\n`;
          }

          if (weatherData.hourly.pressure_msl?.[i] !== null && weatherData.hourly.pressure_msl?.[i] !== undefined) {
            // Open-Meteo returns pressure_msl in hPa regardless of unit params
            output += `- **Pressure:** ${formatPressureFromPa(weatherData.hourly.pressure_msl[i] * 100, prefs)}\n`;
          }

          if (weatherData.hourly.cloud_cover?.[i] !== null && weatherData.hourly.cloud_cover?.[i] !== undefined) {
            output += `- **Cloud Cover:** ${weatherData.hourly.cloud_cover[i]}%\n`;
          }

          output += `\n`;
        }

        return prependLocationLine({
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        }, resolved);
      } else if (weatherData.daily) {
        // Format daily summaries
        let output = `# Historical Weather Data (Daily Summaries)\n\n`;
        output += `**Period:** ${start_date.split('T')[0]} to ${end_date.split('T')[0]}\n`;
        output += `**Location:** ${weatherData.latitude.toFixed(4)}°N, ${Math.abs(weatherData.longitude).toFixed(4)}°${weatherData.longitude >= 0 ? 'E' : 'W'} (${formatElevationFromM(weatherData.elevation, prefs)} elevation)\n`;
        output += `**Number of days:** ${weatherData.daily.time.length}\n`;
        output += `**Data source:** Open-Meteo Historical Weather API (Reanalysis)\n\n`;

        for (let i = 0; i < weatherData.daily.time.length; i++) {
          const date = new Date(weatherData.daily.time[i]);
          output += `## ${date.toLocaleDateString()}\n`;

          if (weatherData.daily.temperature_2m_max?.[i] !== null && weatherData.daily.temperature_2m_max?.[i] !== undefined) {
            output += `- **High Temperature:** ${Math.round(weatherData.daily.temperature_2m_max[i])}${tempU}\n`;
          }

          if (weatherData.daily.temperature_2m_min?.[i] !== null && weatherData.daily.temperature_2m_min?.[i] !== undefined) {
            output += `- **Low Temperature:** ${Math.round(weatherData.daily.temperature_2m_min[i])}${tempU}\n`;
          }

          if (weatherData.daily.temperature_2m_mean?.[i] !== null && weatherData.daily.temperature_2m_mean?.[i] !== undefined) {
            output += `- **Average Temperature:** ${Math.round(weatherData.daily.temperature_2m_mean[i])}${tempU}\n`;
          }

          if (weatherData.daily.weather_code?.[i] !== null && weatherData.daily.weather_code?.[i] !== undefined) {
            output += `- **Conditions:** ${openMeteoService.getWeatherDescription(weatherData.daily.weather_code[i])}\n`;
          }

          if (weatherData.daily.precipitation_sum?.[i] !== null && weatherData.daily.precipitation_sum?.[i] !== undefined) {
            output += `- **Precipitation:** ${weatherData.daily.precipitation_sum[i].toFixed(2)} ${precipU}\n`;
          }

          if (weatherData.daily.snowfall_sum?.[i] !== null && weatherData.daily.snowfall_sum?.[i] !== undefined && weatherData.daily.snowfall_sum[i] > 0) {
            output += `- **Snowfall:** ${weatherData.daily.snowfall_sum[i].toFixed(1)} ${precipU}\n`;
          }

          if (weatherData.daily.wind_speed_10m_max?.[i] !== null && weatherData.daily.wind_speed_10m_max?.[i] !== undefined) {
            output += `- **Max Wind Speed:** ${Math.round(weatherData.daily.wind_speed_10m_max[i])} ${windU}\n`;
          }

          output += `\n`;
        }

        return prependLocationLine({
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        }, resolved);
      } else {
        throw new Error('No weather data available in response');
      }
    } catch (error) {
      // If Open-Meteo API fails, provide helpful error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Unable to retrieve historical data: ${errorMessage}`);
    }
  } else {
    // Use real-time NOAA API for recent data (last 7 days)
    const observations = await noaaService.getHistoricalObservations(
      latitude,
      longitude,
      startTime,
      endTime,
      limit
    );

    if (!observations.features || observations.features.length === 0) {
      return prependLocationLine({
        content: [
          {
            type: 'text',
            text: `No historical observations found for the specified date range (${start_date} to ${end_date}).\n\nThis may occur because:\n- The dates are outside the station's available data range\n- There are gaps in the observation records for this location\n- The weather station near this location may not have archived data for these dates\n\nNote: Historical weather data availability varies by location and weather station. Some stations have limited historical records.`
          }
        ]
      }, resolved);
    }

    // Format the observations
    let output = `# Historical Weather Observations\n\n`;
    output += `**Period:** ${start_date.split('T')[0]} to ${end_date.split('T')[0]}\n`;
    output += `**Number of observations:** ${observations.features.length}\n`;
    output += `**Data source:** NOAA Real-time API\n\n`;

    for (const obs of observations.features) {
      const props = obs.properties;
      output += `## ${new Date(props.timestamp).toLocaleString()}\n`;

      if (props.temperature.value !== null) {
        output += `- **Temperature:** ${formatTemperatureQV(props.temperature, prefs)}\n`;
      }

      if (props.textDescription) {
        output += `- **Conditions:** ${props.textDescription}\n`;
      }

      if (props.windSpeed.value !== null) {
        output += `- **Wind:** ${formatWindSpeedQV(props.windSpeed, prefs)}\n`;
      }

      output += `\n`;
    }

    return prependLocationLine({
      content: [
        {
          type: 'text',
          text: output
        }
      ]
    }, resolved);
  }
}
