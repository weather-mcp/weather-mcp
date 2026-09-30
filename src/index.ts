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
import { createWeatherServer, SERVER_VERSION } from './server/weatherServer.js';
import { startLightningPrewarm, type LightningPrewarmHandle } from './server/lightningPrewarm.js';
import { createShutdown, SHUTDOWN_DEADLINE_MS } from './server/shutdown.js';

/**
 * The shutdown flush's own deadline. It must end before the coordinator's, with room for the
 * steps after it: the MQTT disconnect measured 316 ms with a live broker. Half the budget leaves
 * 750 ms for those steps. A constant, not an env var: garnish is not tuned per install.
 */
const ANALYTICS_SHUTDOWN_FLUSH_MS = SHUTDOWN_DEADLINE_MS / 2;

/**
 * Initialize the LocationStore for managing saved/favorite locations
 * Stores locations in ~/.weather-mcp/locations.json
 * No configuration required
 */
const locationStore = new LocationStore();

const server = createWeatherServer({ locationStore });

let lightningPrewarm: LightningPrewarmHandle | undefined;

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();

  // One bounded, run-once shutdown for every way the session can end (src/server/shutdown.ts).
  // Each step reads its target at call time: `lightningPrewarm` is assigned after connect.
  const shutdown = createShutdown({
    deadlineMs: SHUTDOWN_DEADLINE_MS,
    exit: (code) => process.exit(code),
    steps: [
      // No new pre-warm subscriptions during teardown.
      { name: 'lightning-prewarm', run: () => lightningPrewarm?.stop() },
      // Garnish: it flushes under its own deadline, inside the budget, and never reaches the
      // coordinator's — a slow or unreachable analytics endpoint cannot set the exit code.
      { name: 'analytics', run: () => analytics.shutdown({ deadlineMs: ANALYTICS_SHUTDOWN_FLUSH_MS }) },
      // A no-op when no broker connection exists; never touches the lazy mqtt import.
      { name: 'mqtt', run: () => blitzortungService.disconnect() },
      // Fires server.onclose synchronously; the memo returns the in-flight run.
      { name: 'server', run: () => server.close() }
    ]
  });

  // Registered before connect so an early EOF cannot be missed. An 'end' listener does not
  // switch stdin to flowing mode; the transport's 'data' listener does, at connect.
  // Stdin EOF is the MCP stdio client's primary shutdown signal; 'close' covers a pipe
  // destroyed without a clean EOF.
  process.stdin.once('end', () => { void shutdown('stdin end'); });
  process.stdin.once('close', () => { void shutdown('stdin close'); });
  // The SDK closes the transport itself when the read buffer fails; the server is then deaf.
  server.onclose = () => { void shutdown('transport closed'); };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  try {
    await server.connect(transport);
    logger.info('Weather MCP Server started', {
      version: SERVER_VERSION,
      cacheEnabled: CacheConfig.enabled,
      logLevel: LogLevel[logger.getLevel()],
      enabledTools: toolConfig.getEnabledTools().length,
      toolList: toolConfig.getEnabledTools().join(', ')
    });

    // Begin buffering lightning strikes for saved locations so their coverage accumulates
    // before the first query, and keep it subscribed while it stays saved (non-blocking,
    // best-effort).
    lightningPrewarm = startLightningPrewarm({
      toolEnabled: toolConfig.isEnabled('get_lightning_activity'),
      optOutValue: process.env.WEATHER_LIGHTNING_PREWARM,
      readSavedLocations: () => Object.values(locationStore.getAll()),
      prewarmLocation: (lat, lon, r, o) => blitzortungService.prewarmLocation(lat, lon, r, o)
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
