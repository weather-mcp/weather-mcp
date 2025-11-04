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

/**
 * Server information
 */
const SERVER_NAME = 'weather-mcp';
const SERVER_VERSION = '0.1.0';

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
        description: 'Get weather forecast for a location. Provide either a location name or coordinates (latitude and longitude).',
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
            }
          },
          required: ['latitude', 'longitude']
        }
      },
      {
        name: 'get_current_conditions',
        description: 'Get current weather conditions for a location. Provide coordinates (latitude and longitude).',
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
        name: 'get_historical_weather',
        description: 'Get historical weather observations for a location. Provide coordinates and a date range.',
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
        const { latitude, longitude, days = 7 } = args as {
          latitude: number;
          longitude: number;
          days?: number;
        };

        // Get forecast data
        const forecast = await noaaService.getForecastByCoordinates(latitude, longitude);
        const periods = forecast.properties.periods.slice(0, days * 2); // Each day typically has 2 periods (day/night)

        // Format the forecast for display
        let output = `# Weather Forecast\n\n`;
        output += `**Location:** ${forecast.properties.elevation.value}m elevation\n`;
        output += `**Updated:** ${new Date(forecast.properties.updated).toLocaleString()}\n\n`;

        for (const period of periods) {
          output += `## ${period.name}\n`;
          output += `**Temperature:** ${period.temperature}°${period.temperatureUnit}\n`;
          output += `**Wind:** ${period.windSpeed} ${period.windDirection}\n`;
          output += `**Forecast:** ${period.shortForecast}\n\n`;
          if (period.detailedForecast) {
            output += `${period.detailedForecast}\n\n`;
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

      case 'get_current_conditions': {
        const { latitude, longitude } = args as {
          latitude: number;
          longitude: number;
        };

        // Get current observation
        const observation = await noaaService.getCurrentConditions(latitude, longitude);
        const props = observation.properties;

        // Format current conditions
        let output = `# Current Weather Conditions\n\n`;
        output += `**Station:** ${props.station}\n`;
        output += `**Time:** ${new Date(props.timestamp).toLocaleString()}\n\n`;

        if (props.textDescription) {
          output += `**Conditions:** ${props.textDescription}\n`;
        }

        if (props.temperature.value !== null) {
          const tempF = props.temperature.unitCode.includes('degC')
            ? (props.temperature.value * 9/5) + 32
            : props.temperature.value;
          output += `**Temperature:** ${Math.round(tempF)}°F\n`;
        }

        if (props.dewpoint.value !== null) {
          const dewF = props.dewpoint.unitCode.includes('degC')
            ? (props.dewpoint.value * 9/5) + 32
            : props.dewpoint.value;
          output += `**Dewpoint:** ${Math.round(dewF)}°F\n`;
        }

        if (props.relativeHumidity.value !== null) {
          output += `**Humidity:** ${Math.round(props.relativeHumidity.value)}%\n`;
        }

        if (props.windSpeed.value !== null) {
          const windMph = props.windSpeed.unitCode.includes('km_h')
            ? props.windSpeed.value * 0.621371
            : props.windSpeed.value * 2.23694; // m/s to mph
          const windDir = props.windDirection.value;
          output += `**Wind:** ${Math.round(windMph)} mph`;
          if (windDir !== null) {
            output += ` from ${Math.round(windDir)}°`;
          }
          output += `\n`;
        }

        if (props.barometricPressure.value !== null) {
          const pressureInHg = props.barometricPressure.value * 0.0002953;
          output += `**Pressure:** ${pressureInHg.toFixed(2)} inHg\n`;
        }

        if (props.visibility.value !== null) {
          const visibilityMiles = props.visibility.value * 0.000621371;
          output += `**Visibility:** ${visibilityMiles.toFixed(1)} miles\n`;
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

      case 'get_historical_weather': {
        const { latitude, longitude, start_date, end_date, limit = 168 } = args as {
          latitude: number;
          longitude: number;
          start_date: string;
          end_date: string;
          limit?: number;
        };

        // Parse dates
        const startTime = new Date(start_date);
        const endTime = new Date(end_date);

        // Validate date parsing
        if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
          throw new Error('Invalid date format. Please use ISO format (YYYY-MM-DD or full ISO 8601 datetime).');
        }

        // Validate date range
        if (startTime > endTime) {
          throw new Error(`Invalid date range: start date (${start_date}) must be before end date (${end_date}).`);
        }

        // Validate dates are not in the future
        const now = new Date();
        if (startTime > now) {
          throw new Error(`Start date (${start_date}) cannot be in the future. Current date is ${now.toISOString().split('T')[0]}.`);
        }
        if (endTime > now) {
          throw new Error(`End date (${end_date}) cannot be in the future. Current date is ${now.toISOString().split('T')[0]}.`);
        }

        // Determine which API to use based on date range
        // If start date is more than 7 days old, use CDO API for archival data
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const useArchivalData = startTime < sevenDaysAgo;

        if (useArchivalData) {
          // Use Open-Meteo API for historical/archival data
          try {
            // Determine whether to use hourly or daily data based on date range
            const daysDiff = Math.ceil((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24));
            const useHourly = daysDiff <= 31; // Use hourly for up to 31 days

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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`
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
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP communication
  console.error('Weather MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
