#!/usr/bin/env node

/**
 * Weather MCP Server — the Streamable HTTP entry (`weather-mcp-http`).
 *
 * A second process entry beside the stdio one (`src/index.ts`), never a mode of
 * it: express and jose stay out of the stdio entry's import graph. Both are
 * imported statically here, so a broken install fails at boot (G24).
 *
 * Fail closed. Every check below runs before the port is bound, and any
 * failure logs one fixed reason and exits 1:
 *   1. WebCrypto present (jose needs it; Node 20+)
 *   2. the WEATHER_HTTP_* / WEATHER_OAUTH_* configuration parses
 *   3. the authorization server's metadata is readable and names this issuer
 *
 * Shutdown is SIGTERM and SIGINT only. A container started without `-i` has
 * stdin at EOF from the first tick, so the stdio entry's stdin triggers would
 * stop this server the moment it booted.
 */

// Load environment variables from .env file (for local development)
import 'dotenv/config';

import { createServer as createNodeHttpServer, type Server as NodeHttpServer } from 'node:http';
import { createRemoteJWKSet } from 'jose';
import { LocationStore } from './services/locationStore.js';
import { blitzortungService } from './services/blitzortung.js';
import { toolConfig } from './config/tools.js';
import { parseHttpConfig } from './config/http.js';
import { describeErrorForLogging, logger, redactUrlForLogging } from './utils/logger.js';
import { analytics } from './analytics/index.js';
import { SERVER_VERSION } from './server/weatherServer.js';
import { createHttpApp } from './server/httpApp.js';
import { createTokenVerifier } from './server/tokenVerifier.js';
import { discoverIssuer } from './server/oauthDiscovery.js';
import { startLightningPrewarm, type LightningPrewarmHandle } from './server/lightningPrewarm.js';
import { createShutdown, SHUTDOWN_DEADLINE_MS } from './server/shutdown.js';

/** As in src/index.ts: half the budget, leaving room for the MQTT disconnect after it. */
const ANALYTICS_SHUTDOWN_FLUSH_MS = SHUTDOWN_DEADLINE_MS / 2;

/**
 * How long `server.close()` may wait for in-flight requests before every
 * connection is destroyed. 400 + the analytics flush (750) + the measured MQTT
 * disconnect (~316) fits the 1500 ms deadline, which still bounds a hung step.
 */
const HTTP_FORCE_CLOSE_MS = 400;

const WEBCRYPTO_REFUSAL = 'The HTTP entry needs Node.js 20 or newer (WebCrypto is unavailable)';
const LISTEN_REFUSAL = 'could not listen on WEATHER_HTTP_HOST:WEATHER_HTTP_PORT';

let httpServer: NodeHttpServer | undefined;
let lightningPrewarm: LightningPrewarmHandle | undefined;

/** Log one fixed reason and exit 1. Nothing has been bound when this runs. */
function refuse(reason: string, metadata?: Record<string, unknown>): never {
  logger.error('HTTP entry refused to start', undefined, { reason, ...metadata });
  process.exit(1);
}

/** Stop accepting connections; force the rest closed if they outlast the grace period. */
function closeHttpServer(): Promise<void> {
  const server = httpServer;
  if (!server) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const force = setTimeout(() => server.closeAllConnections(), HTTP_FORCE_CLOSE_MS);
    server.close(() => {
      clearTimeout(force);
      resolve();
    });
    server.closeIdleConnections();
  });
}

function listen(server: NodeHttpServer, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve();
    });
    server.listen(port, host);
  });
}

async function main(): Promise<void> {
  const shutdown = createShutdown({
    deadlineMs: SHUTDOWN_DEADLINE_MS,
    exit: (code) => process.exit(code),
    steps: [
      { name: 'http', run: closeHttpServer },
      { name: 'lightning-prewarm', run: () => lightningPrewarm?.stop() },
      { name: 'analytics', run: () => analytics.shutdown({ deadlineMs: ANALYTICS_SHUTDOWN_FLUSH_MS }) },
      { name: 'mqtt', run: () => blitzortungService.disconnect() }
    ]
  });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  if (!globalThis.crypto?.subtle) refuse(WEBCRYPTO_REFUSAL);

  const parsed = parseHttpConfig(process.env);
  if (!parsed.ok) refuse(parsed.error);
  const { config } = parsed;

  const discovered = await discoverIssuer(config.issuerUrl, config.issuer);
  if (!discovered.ok) refuse(discovered.error);

  // jose's defaults: a 5 s fetch timeout and a 30 s cooldown between refetches.
  // The first fetch happens on the first request, not here.
  const getKey = createRemoteJWKSet(discovered.jwksUri);

  // One store for every authenticated caller (the design's tenancy decision).
  const locationStore = new LocationStore();
  const verifier = createTokenVerifier({ issuer: config.issuer, audience: config.publicUrl.href, getKey });
  const app = createHttpApp({ config, verifier, oauthMetadata: discovered.metadata, locationStore });

  const server = createNodeHttpServer(app);
  try {
    await listen(server, config.port, config.host);
  } catch (error) {
    refuse(LISTEN_REFUSAL, { error: describeErrorForLogging(error) });
  }
  httpServer = server;
  server.on('error', (error) => {
    logger.error('HTTP server error', undefined, { error: describeErrorForLogging(error) });
  });

  // The public URL's path is never logged: an operator may treat it as a secret.
  logger.info('Weather MCP HTTP server listening', {
    version: SERVER_VERSION,
    host: config.host,
    port: config.port,
    issuerOrigin: redactUrlForLogging(config.issuer),
    enabledTools: toolConfig.getEnabledTools().length
  });

  // Once per process, after listen — never per request.
  lightningPrewarm = startLightningPrewarm({
    toolEnabled: toolConfig.isEnabled('get_lightning_activity'),
    optOutValue: process.env.WEATHER_LIGHTNING_PREWARM,
    readSavedLocations: () => Object.values(locationStore.getAll()),
    prewarmLocation: (lat, lon, r, o) => blitzortungService.prewarmLocation(lat, lon, r, o)
  });
}

main().catch((error: unknown) => {
  logger.error('HTTP entry failed', undefined, { error: describeErrorForLogging(error) });
  process.exit(1);
});
