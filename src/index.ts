#!/usr/bin/env node

/**
 * Weather MCP Server
 * Provides weather data from NOAA API to AI systems via Model Context Protocol
 */

// Load environment variables from .env file (for local development)
import 'dotenv/config';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LocationStore } from './services/locationStore.js';
import { blitzortungService } from './services/blitzortung.js';
import { CacheConfig } from './config/cache.js';
import { toolConfig } from './config/tools.js';
import { logger, LogLevel } from './utils/logger.js';
import { analytics } from './analytics/index.js';
import {
  createWeatherServer,
  SERVER_VERSION,
  clearServiceCaches
} from './server/weatherServer.js';

/**
 * Initialize the LocationStore for managing saved/favorite locations
 * Stores locations in ~/.weather-mcp/locations.json
 * No configuration required
 */
const locationStore = new LocationStore();

const server = createWeatherServer({ locationStore });

/**
 * Start the server
 */
/**
 * Pre-warm live lightning monitoring for saved locations at startup.
 *
 * The Blitzortung feed only buffers strikes for an area once it is subscribed, so the
 * first query to a location otherwise reports zero monitoring coverage. Subscribing
 * saved locations at startup lets their coverage accumulate before the user asks.
 * Best-effort and fully non-blocking: it opens a persistent MQTT connection, so it is
 * skipped when the lightning tool is disabled or when WEATHER_LIGHTNING_PREWARM=false.
 * The saved-locations read is guarded too: an unreadable locations file must not stop
 * the server from booting.
 */
function prewarmLightningMonitoring(): void {
  if (process.env.WEATHER_LIGHTNING_PREWARM === 'false') {
    return;
  }
  if (!toolConfig.isEnabled('get_lightning_activity')) {
    return;
  }

  let savedLocations;
  try {
    savedLocations = Object.values(locationStore.getAll());
  } catch (error) {
    logger.warn('Skipping lightning pre-warm: saved locations could not be read', {
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
  if (savedLocations.length === 0) {
    return;
  }

  logger.info('Pre-warming lightning monitoring for saved locations', {
    count: savedLocations.length
  });

  // Fire-and-forget: prewarmLocation swallows its own errors and must never block
  // startup or the stdio transport.
  for (const location of savedLocations) {
    void blitzortungService.prewarmLocation(location.latitude, location.longitude);
  }
}

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
      clearServiceCaches();
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
      logLevel: LogLevel[logger.getLevel()],
      enabledTools: toolConfig.getEnabledTools().length,
      toolList: toolConfig.getEnabledTools().join(', ')
    });

    // Begin buffering lightning strikes for saved locations so their coverage
    // accumulates before the first query (non-blocking, best-effort).
    prewarmLightningMonitoring();

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
