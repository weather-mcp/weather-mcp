#!/usr/bin/env node

/**
 * Weather MCP Server
 * Provides weather data from NOAA API to AI systems via Model Context Protocol
 */

// Load environment variables from .env file (for local development)
import 'dotenv/config';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { NOAAService } from './services/noaa.js';
import { OpenMeteoService } from './services/openmeteo.js';
import { CacheConfig } from './config/cache.js';
import {
  validateCoordinates,
  validateForecastDays,
  validateGranularity,
  validateOptionalBoolean,
  validateHistoricalWeatherParams,
} from './utils/validation.js';
import { logger } from './utils/logger.js';
import { formatErrorForUser } from './errors/ApiError.js';
import { DisplayThresholds, ApiConstants } from './config/displayThresholds.js';

/**
 * Server information
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Read version from package.json to ensure single source of truth
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const SERVER_NAME = 'weather-mcp';
const SERVER_VERSION = packageJson.version;

/**
 * Initialize the NOAA service
 */
const noaaService = new NOAAService({
  userAgent: '(weather-mcp, github.com/weather-mcp)'
});

/**
 * Initialize the Open-Meteo service for historical data
 * No API key required - free for non-commercial use
 */
const openMeteoService = new OpenMeteoService();

/**
 * Create MCP server instance
 */
const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Handler for listing available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_forecast',
        description: 'Get future weather forecast for a location (US only). Use this for upcoming weather predictions (e.g., "tomorrow", "this week", "next 7 days", "hourly forecast"). Returns forecast data including temperature, precipitation, wind, and conditions. Supports both daily and hourly granularity. For current weather, use get_current_conditions. For past weather, use get_historical_weather. If this tool returns an error, check the error message for status page links and consider using check_service_status to verify API availability.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              description: 'Latitude of the location (-90 to 90)',
              minimum: -90,
              maximum: 90
            },
            longitude: {
              type: 'number',
              description: 'Longitude of the location (-180 to 180)',
              minimum: -180,
              maximum: 180
            },
            days: {
              type: 'number',
              description: 'Number of days to include in forecast (1-7, default: 7)',
              minimum: 1,
              maximum: 7,
              default: 7
            },
            granularity: {
              type: 'string',
              description: 'Forecast granularity: "daily" for day/night periods or "hourly" for hour-by-hour detail (default: "daily")',
              enum: ['daily', 'hourly'],
              default: 'daily'
            },
            include_precipitation_probability: {
              type: 'boolean',
              description: 'Include precipitation probability in the forecast output (default: true)',
              default: true
            }
          },
          required: ['latitude', 'longitude']
        }
      },
      {
        name: 'get_current_conditions',
        description: 'Get the most recent weather observation for a location (US only). Use this for current weather or when asking about "today\'s weather", "right now", or recent conditions without a specific historical date range. Returns the latest observation from the nearest weather station. For specific past dates or date ranges, use get_historical_weather instead. If this tool returns an error, check the error message for status page links and consider using check_service_status to verify API availability.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              description: 'Latitude of the location (-90 to 90)',
              minimum: -90,
              maximum: 90
            },
            longitude: {
              type: 'number',
              description: 'Longitude of the location (-180 to 180)',
              minimum: -180,
              maximum: 180
            }
          },
          required: ['latitude', 'longitude']
        }
      },
      {
        name: 'get_alerts',
        description: 'Get active weather alerts, watches, warnings, and advisories for a location (US only). Use this for safety-critical weather information when asked about "any alerts?", "weather warnings?", "is it safe?", "dangerous weather?", or "weather watches?". Returns severity, urgency, certainty, effective/expiration times, and affected areas. For forecast data, use get_forecast instead. If this tool returns an error, check the error message for status page links and consider using check_service_status to verify API availability.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              description: 'Latitude of the location (-90 to 90)',
              minimum: -90,
              maximum: 90
            },
            longitude: {
              type: 'number',
              description: 'Longitude of the location (-180 to 180)',
              minimum: -180,
              maximum: 180
            },
            active_only: {
              type: 'boolean',
              description: 'Whether to show only active alerts (default: true)',
              default: true
            }
          },
          required: ['latitude', 'longitude']
        }
      },
      {
        name: 'get_historical_weather',
        description: 'Get historical weather data for a specific date range in the past. Use this when the user asks about weather on specific past dates (e.g., "yesterday", "last week", "November 4, 2024", "30 years ago"). Automatically uses NOAA API for recent dates (last 7 days, US only) or Open-Meteo API for older dates (worldwide, back to 1940). Do NOT use for current conditions - use get_current_conditions instead. If this tool returns an error, check the error message for status page links and consider using check_service_status to verify API availability.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              description: 'Latitude of the location (-90 to 90)',
              minimum: -90,
              maximum: 90
            },
            longitude: {
              type: 'number',
              description: 'Longitude of the location (-180 to 180)',
              minimum: -180,
              maximum: 180
            },
            start_date: {
              type: 'string',
              description: 'Start date in ISO format (YYYY-MM-DD or ISO 8601 datetime)',
            },
            end_date: {
              type: 'string',
              description: 'End date in ISO format (YYYY-MM-DD or ISO 8601 datetime)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of observations to return (default: 168 for one week of hourly data)',
              minimum: 1,
              maximum: 500,
              default: 168
            }
          },
          required: ['latitude', 'longitude', 'start_date', 'end_date']
        }
      },
      {
        name: 'check_service_status',
        description: 'Check the operational status of the NOAA and Open-Meteo weather APIs. Use this when experiencing errors or to proactively verify service availability before making weather data requests. Returns current status, helpful messages, and links to official status pages.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    ]
  };
});

/**
 * Handler for tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_forecast': {
        // Validate input parameters with runtime checks
        const { latitude, longitude } = validateCoordinates(args);
        const days = validateForecastDays(args);
        const granularity = validateGranularity((args as any)?.granularity);
        const include_precipitation_probability = validateOptionalBoolean(
          (args as any)?.include_precipitation_probability,
          'include_precipitation_probability',
          true
        );

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
        output += `**Location:** ${forecast.properties.elevation.value}m elevation\n`;
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

      case 'get_current_conditions': {
        // Validate input parameters with runtime checks
        const { latitude, longitude } = validateCoordinates(args);

        // Get current observation
        const observation = await noaaService.getCurrentConditions(latitude, longitude);
        const props = observation.properties;

        // Helper function to convert temperature
        const toFahrenheit = (value: number | null, unitCode: string): number | null => {
          if (value === null) return null;
          return unitCode.includes('degC') ? (value * 9/5) + 32 : value;
        };

        // Format current conditions
        let output = `# Current Weather Conditions\n\n`;
        output += `**Station:** ${props.station}\n`;
        output += `**Time:** ${new Date(props.timestamp).toLocaleString()}\n\n`;

        // Main conditions
        if (props.textDescription) {
          output += `**Conditions:** ${props.textDescription}\n`;
        }

        // Temperature section
        const tempF = toFahrenheit(props.temperature.value, props.temperature.unitCode);
        if (tempF !== null) {
          output += `**Temperature:** ${Math.round(tempF)}°F\n`;

          // Show heat index when temperature is high (>80°F) and heat index is available
          if (props.heatIndex) {
            const heatIndexF = toFahrenheit(props.heatIndex.value, props.heatIndex.unitCode);
            if (heatIndexF !== null && tempF > DisplayThresholds.temperature.showHeatIndex && heatIndexF > tempF) {
              output += `**Feels Like (Heat Index):** ${Math.round(heatIndexF)}°F\n`;
            }
          }

          // Show wind chill when temperature is low (<50°F) and wind chill is available
          if (props.windChill) {
            const windChillF = toFahrenheit(props.windChill.value, props.windChill.unitCode);
            if (windChillF !== null && tempF < DisplayThresholds.temperature.showWindChill && windChillF < tempF) {
              output += `**Feels Like (Wind Chill):** ${Math.round(windChillF)}°F\n`;
            }
          }
        }

        // 24-hour temperature range
        const max24F = props.maxTemperatureLast24Hours ? toFahrenheit(props.maxTemperatureLast24Hours.value, props.maxTemperatureLast24Hours.unitCode) : null;
        const min24F = props.minTemperatureLast24Hours ? toFahrenheit(props.minTemperatureLast24Hours.value, props.minTemperatureLast24Hours.unitCode) : null;
        if (max24F !== null || min24F !== null) {
          let range = `**24-Hour Range:**`;
          if (max24F !== null) range += ` High ${Math.round(max24F)}°F`;
          if (max24F !== null && min24F !== null) range += ` /`;
          if (min24F !== null) range += ` Low ${Math.round(min24F)}°F`;
          output += `${range}\n`;
        }

        if (props.dewpoint.value !== null) {
          const dewF = toFahrenheit(props.dewpoint.value, props.dewpoint.unitCode);
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
          if (visibilityMiles < 0.25) {
            output += ` (dense fog)`;
          } else if (visibilityMiles < 1) {
            output += ` (fog)`;
          } else if (visibilityMiles < 3) {
            output += ` (haze/mist)`;
          } else if (visibilityMiles >= 10) {
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

      case 'get_alerts': {
        // Validate input parameters with runtime checks
        const { latitude, longitude } = validateCoordinates(args);
        const active_only = validateOptionalBoolean(
          (args as any)?.active_only,
          'active_only',
          true
        );

        // Get alerts data
        const alertsData = await noaaService.getAlerts(latitude, longitude, active_only);
        const alerts = alertsData.features;

        // Format the alerts for display
        let output = `# Weather Alerts\n\n`;
        output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
        output += `**Status:** ${active_only ? 'Active alerts only' : 'All alerts'}\n`;
        if (alertsData.updated) {
          output += `**Updated:** ${new Date(alertsData.updated).toLocaleString()}\n`;
        }
        output += `\n`;

        if (alerts.length === 0) {
          output += `✅ **No active weather alerts for this location.**\n\n`;
          output += `The area is currently clear of weather warnings, watches, and advisories.\n`;
        } else {
          output += `⚠️ **${alerts.length} active alert${alerts.length > 1 ? 's' : ''} found**\n\n`;

          // Sort alerts by severity (Extreme > Severe > Moderate > Minor > Unknown)
          const severityOrder = { 'Extreme': 0, 'Severe': 1, 'Moderate': 2, 'Minor': 3, 'Unknown': 4 };
          const sortedAlerts = alerts.sort((a, b) => {
            const severityA = severityOrder[a.properties.severity] ?? 4;
            const severityB = severityOrder[b.properties.severity] ?? 4;
            return severityA - severityB;
          });

          for (const alert of sortedAlerts) {
            const props = alert.properties;

            // Severity emoji
            const severityEmoji = props.severity === 'Extreme' ? '🔴' :
                                  props.severity === 'Severe' ? '🟠' :
                                  props.severity === 'Moderate' ? '🟡' :
                                  props.severity === 'Minor' ? '🔵' : '⚪';

            output += `${severityEmoji} **${props.event}**\n`;
            output += `---\n`;

            if (props.headline) {
              output += `**${props.headline}**\n\n`;
            }

            output += `**Severity:** ${props.severity} | **Urgency:** ${props.urgency} | **Certainty:** ${props.certainty}\n`;
            output += `**Area:** ${props.areaDesc}\n`;
            output += `**Effective:** ${new Date(props.effective).toLocaleString()}\n`;
            output += `**Expires:** ${new Date(props.expires).toLocaleString()}\n`;

            if (props.onset && props.onset !== props.effective) {
              output += `**Onset:** ${new Date(props.onset).toLocaleString()}\n`;
            }

            if (props.ends) {
              output += `**Ends:** ${new Date(props.ends).toLocaleString()}\n`;
            }

            output += `\n**Description:**\n${props.description}\n`;

            if (props.instruction) {
              output += `\n**Instructions:**\n${props.instruction}\n`;
            }

            output += `\n**Recommended Response:** ${props.response}\n`;
            output += `**Sender:** ${props.senderName}\n\n`;
          }
        }

        output += `---\n`;
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

      case 'get_historical_weather': {
        // Validate input parameters with runtime checks
        const { latitude, longitude, start_date, end_date, limit = 168 } = validateHistoricalWeatherParams(args);

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
              useHourly
            );

            // Format the response based on data granularity
            if (useHourly && weatherData.hourly) {
              // Format hourly observations
              let output = `# Historical Weather Observations (Hourly)\n\n`;
              output += `**Period:** ${startTime.toLocaleDateString()} to ${endTime.toLocaleDateString()}\n`;
              output += `**Location:** ${weatherData.latitude.toFixed(4)}°N, ${Math.abs(weatherData.longitude).toFixed(4)}°${weatherData.longitude >= 0 ? 'E' : 'W'} (${weatherData.elevation}m elevation)\n`;
              output += `**Number of observations:** ${weatherData.hourly.time.length}\n`;
              output += `**Data source:** Open-Meteo Historical Weather API (Reanalysis)\n\n`;

              const maxObservations = Math.min(limit, weatherData.hourly.time.length);
              for (let i = 0; i < maxObservations; i++) {
                const time = new Date(weatherData.hourly.time[i]);
                output += `## ${time.toLocaleString()}\n`;

                if (weatherData.hourly.temperature_2m?.[i] !== null && weatherData.hourly.temperature_2m?.[i] !== undefined) {
                  output += `- **Temperature:** ${Math.round(weatherData.hourly.temperature_2m[i])}°F\n`;
                }

                if (weatherData.hourly.apparent_temperature?.[i] !== null && weatherData.hourly.apparent_temperature?.[i] !== undefined) {
                  output += `- **Feels Like:** ${Math.round(weatherData.hourly.apparent_temperature[i])}°F\n`;
                }

                if (weatherData.hourly.weather_code?.[i] !== null && weatherData.hourly.weather_code?.[i] !== undefined) {
                  output += `- **Conditions:** ${openMeteoService.getWeatherDescription(weatherData.hourly.weather_code[i])}\n`;
                }

                if (weatherData.hourly.precipitation?.[i] !== null && weatherData.hourly.precipitation?.[i] !== undefined && weatherData.hourly.precipitation[i] > 0) {
                  output += `- **Precipitation:** ${weatherData.hourly.precipitation[i].toFixed(2)} in\n`;
                }

                if (weatherData.hourly.snowfall?.[i] !== null && weatherData.hourly.snowfall?.[i] !== undefined && weatherData.hourly.snowfall[i] > 0) {
                  output += `- **Snowfall:** ${weatherData.hourly.snowfall[i].toFixed(1)} in\n`;
                }

                if (weatherData.hourly.wind_speed_10m?.[i] !== null && weatherData.hourly.wind_speed_10m?.[i] !== undefined) {
                  output += `- **Wind:** ${Math.round(weatherData.hourly.wind_speed_10m[i])} mph`;
                  if (weatherData.hourly.wind_direction_10m?.[i] !== null && weatherData.hourly.wind_direction_10m?.[i] !== undefined) {
                    output += ` from ${Math.round(weatherData.hourly.wind_direction_10m[i])}°`;
                  }
                  output += `\n`;
                }

                if (weatherData.hourly.relative_humidity_2m?.[i] !== null && weatherData.hourly.relative_humidity_2m?.[i] !== undefined) {
                  output += `- **Humidity:** ${Math.round(weatherData.hourly.relative_humidity_2m[i])}%\n`;
                }

                if (weatherData.hourly.pressure_msl?.[i] !== null && weatherData.hourly.pressure_msl?.[i] !== undefined) {
                  const pressureInHg = weatherData.hourly.pressure_msl[i] * 0.02953;
                  output += `- **Pressure:** ${pressureInHg.toFixed(2)} inHg\n`;
                }

                if (weatherData.hourly.cloud_cover?.[i] !== null && weatherData.hourly.cloud_cover?.[i] !== undefined) {
                  output += `- **Cloud Cover:** ${weatherData.hourly.cloud_cover[i]}%\n`;
                }

                output += `\n`;
              }

              return {
                content: [
                  {
                    type: 'text',
                    text: output
                  }
                ]
              };
            } else if (weatherData.daily) {
              // Format daily summaries
              let output = `# Historical Weather Data (Daily Summaries)\n\n`;
              output += `**Period:** ${startTime.toLocaleDateString()} to ${endTime.toLocaleDateString()}\n`;
              output += `**Location:** ${weatherData.latitude.toFixed(4)}°N, ${Math.abs(weatherData.longitude).toFixed(4)}°${weatherData.longitude >= 0 ? 'E' : 'W'} (${weatherData.elevation}m elevation)\n`;
              output += `**Number of days:** ${weatherData.daily.time.length}\n`;
              output += `**Data source:** Open-Meteo Historical Weather API (Reanalysis)\n\n`;

              for (let i = 0; i < weatherData.daily.time.length; i++) {
                const date = new Date(weatherData.daily.time[i]);
                output += `## ${date.toLocaleDateString()}\n`;

                if (weatherData.daily.temperature_2m_max?.[i] !== null && weatherData.daily.temperature_2m_max?.[i] !== undefined) {
                  output += `- **High Temperature:** ${Math.round(weatherData.daily.temperature_2m_max[i])}°F\n`;
                }

                if (weatherData.daily.temperature_2m_min?.[i] !== null && weatherData.daily.temperature_2m_min?.[i] !== undefined) {
                  output += `- **Low Temperature:** ${Math.round(weatherData.daily.temperature_2m_min[i])}°F\n`;
                }

                if (weatherData.daily.temperature_2m_mean?.[i] !== null && weatherData.daily.temperature_2m_mean?.[i] !== undefined) {
                  output += `- **Average Temperature:** ${Math.round(weatherData.daily.temperature_2m_mean[i])}°F\n`;
                }

                if (weatherData.daily.weather_code?.[i] !== null && weatherData.daily.weather_code?.[i] !== undefined) {
                  output += `- **Conditions:** ${openMeteoService.getWeatherDescription(weatherData.daily.weather_code[i])}\n`;
                }

                if (weatherData.daily.precipitation_sum?.[i] !== null && weatherData.daily.precipitation_sum?.[i] !== undefined) {
                  output += `- **Precipitation:** ${weatherData.daily.precipitation_sum[i].toFixed(2)} in\n`;
                }

                if (weatherData.daily.snowfall_sum?.[i] !== null && weatherData.daily.snowfall_sum?.[i] !== undefined && weatherData.daily.snowfall_sum[i] > 0) {
                  output += `- **Snowfall:** ${weatherData.daily.snowfall_sum[i].toFixed(1)} in\n`;
                }

                if (weatherData.daily.wind_speed_10m_max?.[i] !== null && weatherData.daily.wind_speed_10m_max?.[i] !== undefined) {
                  output += `- **Max Wind Speed:** ${Math.round(weatherData.daily.wind_speed_10m_max[i])} mph\n`;
                }

                output += `\n`;
              }

              return {
                content: [
                  {
                    type: 'text',
                    text: output
                  }
                ]
              };
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
            return {
              content: [
                {
                  type: 'text',
                  text: `No historical observations found for the specified date range (${start_date} to ${end_date}).\n\nThis may occur because:\n- The dates are outside the station's available data range\n- There are gaps in the observation records for this location\n- The weather station near this location may not have archived data for these dates\n\nNote: Historical weather data availability varies by location and weather station. Some stations have limited historical records.`
                }
              ]
            };
          }

          // Format the observations
          let output = `# Historical Weather Observations\n\n`;
          output += `**Period:** ${startTime.toLocaleDateString()} to ${endTime.toLocaleDateString()}\n`;
          output += `**Number of observations:** ${observations.features.length}\n`;
          output += `**Data source:** NOAA Real-time API\n\n`;

          for (const obs of observations.features) {
            const props = obs.properties;
            output += `## ${new Date(props.timestamp).toLocaleString()}\n`;

            if (props.temperature.value !== null) {
              const tempF = props.temperature.unitCode.includes('degC')
                ? (props.temperature.value * 9/5) + 32
                : props.temperature.value;
              output += `- **Temperature:** ${Math.round(tempF)}°F\n`;
            }

            if (props.textDescription) {
              output += `- **Conditions:** ${props.textDescription}\n`;
            }

            if (props.windSpeed.value !== null) {
              const windMph = props.windSpeed.unitCode.includes('km_h')
                ? props.windSpeed.value * 0.621371
                : props.windSpeed.value * 2.23694;
              output += `- **Wind:** ${Math.round(windMph)} mph\n`;
            }

            output += `\n`;
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
      }

      case 'check_service_status': {
        // Check status of both services
        const noaaStatus = await noaaService.checkServiceStatus();
        const openMeteoStatus = await openMeteoService.checkServiceStatus();

        // Format the status report
        let output = `# Weather API Service Status\n\n`;
        output += `**Check Time:** ${new Date().toLocaleString()}\n\n`;

        // NOAA Status
        output += `## NOAA Weather API (Forecasts & Current Conditions)\n\n`;
        output += `**Status:** ${noaaStatus.operational ? '✅ Operational' : '❌ Issues Detected'}\n`;
        output += `**Message:** ${noaaStatus.message}\n`;
        output += `**Status Page:** ${noaaStatus.statusPage}\n`;
        output += `**Coverage:** United States locations only\n\n`;

        if (!noaaStatus.operational) {
          output += `**Recommended Actions:**\n`;
          output += `- Check planned outages: https://weather-gov.github.io/api/planned-outages\n`;
          output += `- View service notices: https://www.weather.gov/notification\n`;
          output += `- Report issues: nco.ops@noaa.gov or (301) 683-1518\n\n`;
        }

        // Open-Meteo Status
        output += `## Open-Meteo API (Historical Weather Data)\n\n`;
        output += `**Status:** ${openMeteoStatus.operational ? '✅ Operational' : '❌ Issues Detected'}\n`;
        output += `**Message:** ${openMeteoStatus.message}\n`;
        output += `**Status Page:** ${openMeteoStatus.statusPage}\n`;
        output += `**Coverage:** Global (worldwide locations)\n\n`;

        if (!openMeteoStatus.operational) {
          output += `**Recommended Actions:**\n`;
          output += `- Check production status: https://open-meteo.com/en/docs/model-updates\n`;
          output += `- View GitHub issues: https://github.com/open-meteo/open-meteo/issues\n`;
          output += `- Review documentation: https://open-meteo.com/en/docs\n\n`;
        }

        // Cache Statistics
        if (CacheConfig.enabled) {
          output += `## Cache Statistics\n\n`;

          const noaaStats = noaaService.getCacheStats();
          const openMeteoStats = openMeteoService.getCacheStats();
          const totalHits = noaaStats.hits + openMeteoStats.hits;
          const totalMisses = noaaStats.misses + openMeteoStats.misses;
          const totalRequests = totalHits + totalMisses;
          const overallHitRate = totalRequests > 0 ? ((totalHits / totalRequests) * 100).toFixed(1) : '0.0';

          output += `**Cache Status:** ✅ Enabled\n`;
          output += `**Overall Hit Rate:** ${overallHitRate}%\n`;
          output += `**Total Cache Hits:** ${totalHits}\n`;
          output += `**Total Cache Misses:** ${totalMisses}\n`;
          output += `**Total Requests:** ${totalRequests}\n\n`;

          output += `### NOAA Service Cache\n`;
          output += `- Entries: ${noaaStats.size} / ${noaaStats.maxSize}\n`;
          output += `- Hit Rate: ${(noaaService as any).cache.getHitRate().toFixed(1)}%\n`;
          output += `- Hits: ${noaaStats.hits}\n`;
          output += `- Misses: ${noaaStats.misses}\n`;
          output += `- Evictions: ${noaaStats.evictions}\n\n`;

          output += `### Open-Meteo Service Cache\n`;
          output += `- Entries: ${openMeteoStats.size} / ${openMeteoStats.maxSize}\n`;
          output += `- Hit Rate: ${(openMeteoService as any).cache.getHitRate().toFixed(1)}%\n`;
          output += `- Hits: ${openMeteoStats.hits}\n`;
          output += `- Misses: ${openMeteoStats.misses}\n`;
          output += `- Evictions: ${openMeteoStats.evictions}\n\n`;

          output += `*Cache reduces API calls and improves performance for repeated queries.*\n\n`;
        } else {
          output += `## Cache Statistics\n\n`;
          output += `**Cache Status:** ❌ Disabled\n`;
          output += `*Set CACHE_ENABLED=true in environment to enable caching.*\n\n`;
        }

        // Overall status summary
        const bothOperational = noaaStatus.operational && openMeteoStatus.operational;
        const neitherOperational = !noaaStatus.operational && !openMeteoStatus.operational;

        if (bothOperational) {
          output += `## Overall Status: ✅ All Services Operational\n\n`;
          output += `Both NOAA and Open-Meteo APIs are functioning normally. Weather data requests should succeed.\n`;
        } else if (neitherOperational) {
          output += `## Overall Status: ❌ Multiple Service Issues\n\n`;
          output += `Both weather APIs are experiencing issues. Please check the status pages above for updates.\n`;
        } else {
          output += `## Overall Status: ⚠️ Partial Service Availability\n\n`;
          if (noaaStatus.operational) {
            output += `NOAA API is operational: Forecasts and current conditions for US locations are available.\n`;
            output += `Open-Meteo API has issues: Historical weather data may be unavailable.\n`;
          } else {
            output += `Open-Meteo API is operational: Historical weather data is available globally.\n`;
            output += `NOAA API has issues: Forecasts and current conditions for US locations may be unavailable.\n`;
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    // Log the error with full details
    logger.error('Tool execution error', error as Error, {
      tool: name,
      args: args ? JSON.stringify(args) : undefined,
    });

    // Format error for user display (sanitized)
    const userMessage = formatErrorForUser(error as Error);

    return {
      content: [
        {
          type: 'text',
          text: userMessage
        }
      ],
      isError: true
    };
  }
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();

  // Set up graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      // Clean up resources
      noaaService.clearCache();
      openMeteoService.clearCache();
      logger.info('Cache cleared');

      // Close server connection
      await server.close();
      logger.info('Server closed');

      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error as Error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await server.connect(transport);
    logger.info('Weather MCP Server started', {
      version: SERVER_VERSION,
      cacheEnabled: CacheConfig.enabled,
      logLevel: process.env.LOG_LEVEL || 'INFO',
    });
  } catch (error) {
    logger.error('Failed to start server', error as Error);
    throw error;
  }
}

main().catch((error) => {
  logger.error('Fatal error in main()', error);

  // Log structured error for monitoring
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'FATAL',
    message: 'Application failed to start',
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
  }));

  process.exit(1);
});
