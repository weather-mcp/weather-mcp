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
import { NCEIService } from './services/ncei.js';
import { NIFCService } from './services/nifc.js';
import { CacheConfig } from './config/cache.js';
import { toolConfig } from './config/tools.js';
import { logger } from './utils/logger.js';
import { formatErrorForUser } from './errors/ApiError.js';
import { handleGetForecast } from './handlers/forecastHandler.js';
import { handleGetCurrentConditions } from './handlers/currentConditionsHandler.js';
import { handleGetAlerts } from './handlers/alertsHandler.js';
import { handleGetHistoricalWeather } from './handlers/historicalWeatherHandler.js';
import { handleCheckServiceStatus } from './handlers/statusHandler.js';
import { handleSearchLocation } from './handlers/locationHandler.js';
import { handleGetAirQuality } from './handlers/airQualityHandler.js';
import { handleGetMarineConditions } from './handlers/marineConditionsHandler.js';
import { getWeatherImagery, formatWeatherImageryResponse } from './handlers/weatherImageryHandler.js';
import { getLightningActivity, formatLightningActivityResponse } from './handlers/lightningHandler.js';
import { handleGetRiverConditions } from './handlers/riverConditionsHandler.js';
import { handleGetWildfireInfo } from './handlers/wildfireHandler.js';
import { withAnalytics, analytics } from './analytics/index.js';

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
 * Redact sensitive fields from tool arguments before logging
 * Removes PII like coordinates, location names, addresses
 */
function redactSensitiveFields(args: unknown): unknown {
  if (typeof args !== 'object' || args === null) {
    return args;
  }

  const redacted: Record<string, unknown> = {};
  const sensitiveFields = [
    'latitude', 'longitude', 'lat', 'lon',
    'location', 'city', 'state', 'address', 'query',
    'zipcode', 'postalCode', 'place', 'coordinates'
  ];

  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (sensitiveFields.includes(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveFields(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Initialize the NOAA service
 */
const noaaService = new NOAAService({
  userAgent: `weather-mcp/${SERVER_VERSION} (https://github.com/weather-mcp/weather-mcp)`
});

/**
 * Initialize the Open-Meteo service for historical data
 * No API key required - free for non-commercial use
 */
const openMeteoService = new OpenMeteoService();

/**
 * Initialize the NCEI service for climate normals (optional)
 * Requires free API token from https://www.ncdc.noaa.gov/cdo-web/token
 * Falls back to Open-Meteo computed normals if not configured
 */
const nceiService = new NCEIService();

/**
 * Initialize the NIFC service for wildfire data
 * No API key required - uses public ArcGIS REST API
 */
const nifcService = new NIFCService();

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
 * Tool definitions - each tool defined separately for conditional registration
 */
const TOOL_DEFINITIONS = {
  get_forecast: {
    name: 'get_forecast' as const,
    description: 'Get future weather forecast for a location (global coverage). Use this for upcoming weather predictions (e.g., "tomorrow", "this week", "next 7 days", "hourly forecast"). Returns forecast data including temperature, precipitation, wind, conditions, and sunrise/sunset times. Supports both daily and hourly granularity. Automatically selects best data source: NOAA for US locations (more detailed), Open-Meteo for international locations. For current weather, use get_current_conditions. For past weather, use get_historical_weather. If this tool returns an error, check the error message for status page links and consider using check_service_status to verify API availability.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latitude: {
          type: 'number' as const,
          description: 'Latitude of the location (-90 to 90)',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude of the location (-180 to 180)',
          minimum: -180,
          maximum: 180
        },
        days: {
          type: 'number' as const,
          description: 'Number of days to include in forecast (1-16 for global, 1-7 for US NOAA, default: 7)',
          minimum: 1,
          maximum: 16,
          default: 7
        },
        granularity: {
          type: 'string' as const,
          description: 'Forecast granularity: "daily" for day/night periods or "hourly" for hour-by-hour detail (default: "daily")',
          enum: ['daily', 'hourly'],
          default: 'daily'
        },
        include_precipitation_probability: {
          type: 'boolean' as const,
          description: 'Include precipitation probability in the forecast output (default: true)',
          default: true
        },
        include_severe_weather: {
          type: 'boolean' as const,
          description: 'Include severe weather probabilities such as thunderstorm chance, wind gust probabilities, and tropical storm/hurricane risks (default: false, US/NOAA only)',
          default: false
        },
        include_normals: {
          type: 'boolean' as const,
          description: 'Include climate normals (30-year averages) for comparison with forecasted temperatures (default: false, daily forecasts only). Shows normal high/low and departure from normal for the first forecast day.',
          default: false
        },
        source: {
          type: 'string' as const,
          description: 'Data source: "auto" (default, selects NOAA for US or Open-Meteo for international), "noaa" (US only), or "openmeteo" (global)',
          enum: ['auto', 'noaa', 'openmeteo'],
          default: 'auto'
        }
      },
      required: ['latitude', 'longitude']
    }
  },

  get_current_conditions: {
    name: 'get_current_conditions' as const,
    description: 'Get the most recent weather observation for a location (US only). Use this for current weather or when asking about "today\'s weather", "right now", or recent conditions without a specific historical date range. Returns the latest observation from the nearest weather station. Optionally includes fire weather indices (Haines Index, Grassland Fire Danger, Red Flag Threat) when requested. For specific past dates or date ranges, use get_historical_weather instead. If this tool returns an error, check the error message for status page links and consider using check_service_status to verify API availability.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latitude: {
          type: 'number' as const,
          description: 'Latitude of the location (-90 to 90)',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude of the location (-180 to 180)',
          minimum: -180,
          maximum: 180
        },
        include_fire_weather: {
          type: 'boolean' as const,
          description: 'Include fire weather indices (Haines Index, Grassland Fire Danger, Red Flag Threat) in the response (default: false, US only)',
          default: false
        },
        include_normals: {
          type: 'boolean' as const,
          description: 'Include climate normals (30-year averages) for comparison with current conditions (default: false). Shows normal high/low temperatures and precipitation, with departure from normal.',
          default: false
        }
      },
      required: ['latitude', 'longitude']
    }
  },

  get_alerts: {
    name: 'get_alerts' as const,
    description: 'Get active weather alerts, watches, warnings, and advisories for a location (US only). Use this for safety-critical weather information when asked about "any alerts?", "weather warnings?", "is it safe?", "dangerous weather?", or "weather watches?". Returns severity, urgency, certainty, effective/expiration times, and affected areas. For forecast data, use get_forecast instead. If this tool returns an error, check the error message for status page links and consider using check_service_status to verify API availability.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latitude: {
          type: 'number' as const,
          description: 'Latitude of the location (-90 to 90)',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude of the location (-180 to 180)',
          minimum: -180,
          maximum: 180
        },
        active_only: {
          type: 'boolean' as const,
          description: 'Whether to show only active alerts (default: true)',
          default: true
        }
      },
      required: ['latitude', 'longitude']
    }
  },

  get_historical_weather: {
    name: 'get_historical_weather' as const,
    description: 'Get historical weather data for a specific date range in the past. Use this when the user asks about weather on specific past dates (e.g., "yesterday", "last week", "November 4, 2024", "30 years ago"). Automatically uses NOAA API for recent dates (last 7 days, US only) or Open-Meteo API for older dates (worldwide, back to 1940). Do NOT use for current conditions - use get_current_conditions instead. If this tool returns an error, check the error message for status page links and consider using check_service_status to verify API availability.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latitude: {
          type: 'number' as const,
          description: 'Latitude of the location (-90 to 90)',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude of the location (-180 to 180)',
          minimum: -180,
          maximum: 180
        },
        start_date: {
          type: 'string' as const,
          description: 'Start date in ISO format (YYYY-MM-DD or ISO 8601 datetime)',
        },
        end_date: {
          type: 'string' as const,
          description: 'End date in ISO format (YYYY-MM-DD or ISO 8601 datetime)',
        },
        limit: {
          type: 'number' as const,
          description: 'Maximum number of observations to return (default: 168 for one week of hourly data)',
          minimum: 1,
          maximum: 500,
          default: 168
        }
      },
      required: ['latitude', 'longitude', 'start_date', 'end_date']
    }
  },

  check_service_status: {
    name: 'check_service_status' as const,
    description: 'Check the operational status of the NOAA and Open-Meteo weather APIs. Use this when experiencing errors or to proactively verify service availability before making weather data requests. Returns current status, helpful messages, and links to official status pages.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },

  search_location: {
    name: 'search_location' as const,
    description: 'Search for locations by name to get coordinates for weather queries. Use this when the user provides a location name instead of coordinates (e.g., "Paris", "New York", "Tokyo", "San Francisco, CA"). Returns location matches with coordinates, timezone, elevation, and other metadata. Enables natural language location queries like "What\'s the weather in Paris?" by converting location names to coordinates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string' as const,
          description: 'Location name to search for (e.g., "Paris", "New York, NY", "Tokyo")'
        },
        limit: {
          type: 'number' as const,
          description: 'Maximum number of results to return (1-100, default: 5)',
          minimum: 1,
          maximum: 100,
          default: 5
        }
      },
      required: ['query']
    }
  },

  get_air_quality: {
    name: 'get_air_quality' as const,
    description: 'Get air quality data including AQI (Air Quality Index), pollutant concentrations, and UV index for a location (global coverage). Use this when asked about "air quality", "pollution", "AQI", "UV index", "safe to exercise outside", or health-related environmental conditions. Returns current conditions and optional hourly forecast. Shows appropriate AQI scale (US AQI for US locations, European EAQI elsewhere) with health recommendations. Pollutants include PM2.5, PM10, ozone, NO2, SO2, and CO.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latitude: {
          type: 'number' as const,
          description: 'Latitude of the location (-90 to 90)',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude of the location (-180 to 180)',
          minimum: -180,
          maximum: 180
        },
        forecast: {
          type: 'boolean' as const,
          description: 'Include hourly air quality forecast for next 5 days (default: false, shows current only)',
          default: false
        }
      },
      required: ['latitude', 'longitude']
    }
  },

  get_marine_conditions: {
    name: 'get_marine_conditions' as const,
    description: 'Get marine conditions including wave height, swell, ocean currents, and sea state for a location (global coverage). Use this when asked about "ocean conditions", "wave height", "surf conditions", "safe to boat", "marine forecast", "swell", or "sea state". Returns current conditions and optional daily/hourly forecast. Includes significant wave height, wind waves, swell, wave period, and ocean currents. Shows safety assessment for maritime activities. NOTE: Data has limited accuracy in coastal areas and is NOT suitable for coastal navigation - always consult official marine forecasts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latitude: {
          type: 'number' as const,
          description: 'Latitude of the location (-90 to 90)',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude of the location (-180 to 180)',
          minimum: -180,
          maximum: 180
        },
        forecast: {
          type: 'boolean' as const,
          description: 'Include marine forecast for next 5 days (default: false, shows current only)',
          default: false
        }
      },
      required: ['latitude', 'longitude']
    }
  },

  get_weather_imagery: {
    name: 'get_weather_imagery' as const,
    description: 'Get weather imagery including radar, satellite, and precipitation maps for a location (global coverage). Use this when asked about "show radar", "satellite image", "precipitation map", "weather map", "animated radar", or "what does radar show". Returns image URLs with timestamps for current or animated weather visualization. Supports precipitation radar (global via RainViewer). Includes disclaimer about data delays and official forecast consultation. For numerical forecast data, use get_forecast instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latitude: {
          type: 'number' as const,
          description: 'Latitude of the location (-90 to 90)',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude of the location (-180 to 180)',
          minimum: -180,
          maximum: 180
        },
        type: {
          type: 'string' as const,
          description: 'Type of imagery: "radar", "satellite", or "precipitation" (default: "precipitation")',
          enum: ['radar', 'satellite', 'precipitation'],
          default: 'precipitation'
        },
        animated: {
          type: 'boolean' as const,
          description: 'Return animated frames showing progression over time (default: false)',
          default: false
        },
        layers: {
          type: 'array' as const,
          description: 'Optional layers to include in imagery (future enhancement)',
          items: {
            type: 'string' as const
          }
        }
      },
      required: ['latitude', 'longitude', 'type']
    }
  },

  get_lightning_activity: {
    name: 'get_lightning_activity' as const,
    description: 'Get real-time lightning strike activity and safety assessment for a location (global coverage). Use this when asked about "lightning nearby", "lightning strikes", "thunderstorm activity", "is it safe from lightning", or "lightning danger". Returns recent strikes within specified radius and time window, including distance, polarity, intensity, and critical safety recommendations. Provides 4-level safety assessment (safe/elevated/high/extreme) based on proximity. SAFETY-CRITICAL tool for outdoor activities and severe weather monitoring.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latitude: {
          type: 'number' as const,
          description: 'Latitude of the location (-90 to 90)',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude of the location (-180 to 180)',
          minimum: -180,
          maximum: 180
        },
        radius: {
          type: 'number' as const,
          description: 'Search radius in kilometers (1-500, default: 100)',
          minimum: 1,
          maximum: 500,
          default: 100
        },
        timeWindow: {
          type: 'number' as const,
          description: 'Time window in minutes for historical strikes (5-120, default: 60)',
          minimum: 5,
          maximum: 120,
          default: 60
        }
      },
      required: ['latitude', 'longitude']
    }
  },

  get_river_conditions: {
    name: 'get_river_conditions' as const,
    description: 'Monitor river levels and flood status for a location (US only). Use this when asked about "river flooding", "river level", "flood stage", "streamflow", "safe to kayak", or "river conditions". Returns current river gauge data within specified radius including river stage, flow rate, flood category levels (action/minor/moderate/major), and forecasted conditions. Provides safety assessment based on flood stages. SAFETY-CRITICAL tool for flood-prone areas and water recreation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latitude: {
          type: 'number' as const,
          description: 'Latitude of the location (-90 to 90)',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude of the location (-180 to 180)',
          minimum: -180,
          maximum: 180
        },
        radius: {
          type: 'number' as const,
          description: 'Search radius in kilometers (1-500, default: 50)',
          minimum: 1,
          maximum: 500,
          default: 50
        }
      },
      required: ['latitude', 'longitude']
    }
  },

  get_wildfire_info: {
    name: 'get_wildfire_info' as const,
    description: 'Monitor active wildfires and fire perimeters for a location (US focus). Use this when asked about "wildfires nearby", "fire danger", "active fires", "wildfire smoke", "fire perimeters", or "evacuation risk". Returns active wildfire information within specified radius including fire name, size, containment percentage, distance from location, and safety assessment. Provides critical evacuation awareness and air quality impact information. SAFETY-CRITICAL tool for wildfire-prone areas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        latitude: {
          type: 'number' as const,
          description: 'Latitude of the location (-90 to 90)',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude of the location (-180 to 180)',
          minimum: -180,
          maximum: 180
        },
        radius: {
          type: 'number' as const,
          description: 'Search radius in kilometers (1-500, default: 100)',
          minimum: 1,
          maximum: 500,
          default: 100
        }
      },
      required: ['latitude', 'longitude']
    }
  }
};

/**
 * Handler for listing available tools
 * Only returns tools that are enabled in the configuration
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const enabledTools = toolConfig.getEnabledTools();
  const tools = enabledTools
    .map(toolName => TOOL_DEFINITIONS[toolName])
    .filter(Boolean); // Filter out any undefined tools

  return { tools };
});

/**
 * Handler for tool execution
 * Validates that tools are enabled before execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Check if tool is enabled
    if (!toolConfig.isEnabled(name as any)) {
      throw new Error(`Tool '${name}' is not enabled. Please check your ENABLED_TOOLS configuration.`);
    }

    switch (name) {
      case 'get_forecast':
        return await withAnalytics('get_forecast', async () =>
          handleGetForecast(args, noaaService, openMeteoService, nceiService)
        );

      case 'get_current_conditions':
        return await withAnalytics('get_current_conditions', async () =>
          handleGetCurrentConditions(args, noaaService, openMeteoService, nceiService)
        );

      case 'get_alerts':
        return await withAnalytics('get_alerts', async () =>
          handleGetAlerts(args, noaaService)
        );

      case 'get_historical_weather':
        return await withAnalytics('get_historical_weather', async () =>
          handleGetHistoricalWeather(args, noaaService, openMeteoService)
        );

      case 'check_service_status':
        return await withAnalytics('check_service_status', async () =>
          handleCheckServiceStatus(noaaService, openMeteoService, SERVER_VERSION)
        );

      case 'search_location':
        return await withAnalytics('search_location', async () =>
          handleSearchLocation(args, openMeteoService)
        );

      case 'get_air_quality':
        return await withAnalytics('get_air_quality', async () =>
          handleGetAirQuality(args, openMeteoService)
        );

      case 'get_marine_conditions':
        return await withAnalytics('get_marine_conditions', async () =>
          handleGetMarineConditions(args, noaaService, openMeteoService)
        );

      case 'get_weather_imagery':
        return await withAnalytics('get_weather_imagery', async () => {
          const result = await getWeatherImagery(args as any);
          const formatted = formatWeatherImageryResponse(result);
          return {
            content: [
              {
                type: 'text',
                text: formatted
              }
            ]
          };
        });

      case 'get_lightning_activity':
        return await withAnalytics('get_lightning_activity', async () => {
          const result = await getLightningActivity(args as any);
          const formatted = formatLightningActivityResponse(result);
          return {
            content: [
              {
                type: 'text',
                text: formatted
              }
            ]
          };
        });

      case 'get_river_conditions':
        return await withAnalytics('get_river_conditions', async () =>
          handleGetRiverConditions(args, noaaService)
        );

      case 'get_wildfire_info':
        return await withAnalytics('get_wildfire_info', async () =>
          handleGetWildfireInfo(args, nifcService)
        );

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    // Redact sensitive fields from args before logging
    const redactedArgs = args ? redactSensitiveFields(args) : undefined;

    // Log the error with redacted details
    logger.error('Tool execution error', error as Error, {
      tool: name,
      args: redactedArgs ? JSON.stringify(redactedArgs) : undefined,
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
      // 1. Flush analytics first (fast)
      await analytics.shutdown();
      logger.info('Analytics flushed');

      // 2. Clean up resources
      noaaService.clearCache();
      openMeteoService.clearCache();
      logger.info('Cache cleared');

      // 3. Close server connection
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
      enabledTools: toolConfig.getEnabledTools().length,
      toolList: toolConfig.getEnabledTools().join(', ')
    });

    // Inform users about version and upgrade options
    logger.info('Version check', {
      installedVersion: SERVER_VERSION,
      latestRelease: 'https://github.com/weather-mcp/weather-mcp/releases/latest',
      upgradeInstructions: 'https://github.com/weather-mcp/weather-mcp#upgrading-to-latest-version',
      autoUpdateTip: 'Use npx -y @dangahagan/weather-mcp@latest in MCP config for automatic updates'
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
