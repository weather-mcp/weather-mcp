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
import { handleGetForecast } from './handlers/forecastHandler.js';
import { handleGetCurrentConditions } from './handlers/currentConditionsHandler.js';
import { handleGetAlerts } from './handlers/alertsHandler.js';
import { handleGetHistoricalWeather } from './handlers/historicalWeatherHandler.js';
import { handleCheckServiceStatus } from './handlers/statusHandler.js';
import { handleSearchLocation } from './handlers/locationHandler.js';
import { handleGetAirQuality } from './handlers/airQualityHandler.js';

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
  userAgent: `weather-mcp/${SERVER_VERSION} (https://github.com/dgahagan/weather-mcp)`
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
        description: 'Get future weather forecast for a location (global coverage). Use this for upcoming weather predictions (e.g., "tomorrow", "this week", "next 7 days", "hourly forecast"). Returns forecast data including temperature, precipitation, wind, conditions, and sunrise/sunset times. Supports both daily and hourly granularity. Automatically selects best data source: NOAA for US locations (more detailed), Open-Meteo for international locations. For current weather, use get_current_conditions. For past weather, use get_historical_weather. If this tool returns an error, check the error message for status page links and consider using check_service_status to verify API availability.',
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
              description: 'Number of days to include in forecast (1-16 for global, 1-7 for US NOAA, default: 7)',
              minimum: 1,
              maximum: 16,
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
            },
            source: {
              type: 'string',
              description: 'Data source: "auto" (default, selects NOAA for US or Open-Meteo for international), "noaa" (US only), or "openmeteo" (global)',
              enum: ['auto', 'noaa', 'openmeteo'],
              default: 'auto'
            }
          },
          required: ['latitude', 'longitude']
        }
      },
      {
        name: 'get_current_conditions',
        description: 'Get the most recent weather observation for a location (US only). Use this for current weather or when asking about "today\'s weather", "right now", or recent conditions without a specific historical date range. Returns the latest observation from the nearest weather station. Optionally includes fire weather indices (Haines Index, Grassland Fire Danger, Red Flag Threat) when requested. For specific past dates or date ranges, use get_historical_weather instead. If this tool returns an error, check the error message for status page links and consider using check_service_status to verify API availability.',
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
            include_fire_weather: {
              type: 'boolean',
              description: 'Include fire weather indices (Haines Index, Grassland Fire Danger, Red Flag Threat) in the response (default: false, US only)',
              default: false
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
      },
      {
        name: 'search_location',
        description: 'Search for locations by name to get coordinates for weather queries. Use this when the user provides a location name instead of coordinates (e.g., "Paris", "New York", "Tokyo", "San Francisco, CA"). Returns location matches with coordinates, timezone, elevation, and other metadata. Enables natural language location queries like "What\'s the weather in Paris?" by converting location names to coordinates.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Location name to search for (e.g., "Paris", "New York, NY", "Tokyo")'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (1-100, default: 5)',
              minimum: 1,
              maximum: 100,
              default: 5
            }
          },
          required: ['query']
        }
      },
      {
        name: 'get_air_quality',
        description: 'Get air quality data including AQI (Air Quality Index), pollutant concentrations, and UV index for a location (global coverage). Use this when asked about "air quality", "pollution", "AQI", "UV index", "safe to exercise outside", or health-related environmental conditions. Returns current conditions and optional hourly forecast. Shows appropriate AQI scale (US AQI for US locations, European EAQI elsewhere) with health recommendations. Pollutants include PM2.5, PM10, ozone, NO2, SO2, and CO.',
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
            forecast: {
              type: 'boolean',
              description: 'Include hourly air quality forecast for next 5 days (default: false, shows current only)',
              default: false
            }
          },
          required: ['latitude', 'longitude']
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
      case 'get_forecast':
        return await handleGetForecast(args, noaaService, openMeteoService);

      case 'get_current_conditions':
        return await handleGetCurrentConditions(args, noaaService);

      case 'get_alerts':
        return await handleGetAlerts(args, noaaService);

      case 'get_historical_weather':
        return await handleGetHistoricalWeather(args, noaaService, openMeteoService);

      case 'check_service_status':
        return await handleCheckServiceStatus(noaaService, openMeteoService);

      case 'search_location':
        return await handleSearchLocation(args, openMeteoService);

      case 'get_air_quality':
        return await handleGetAirQuality(args, openMeteoService);

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
