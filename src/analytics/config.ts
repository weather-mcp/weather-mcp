/**
 * Analytics configuration and singleton collector instance
 * Loads settings from environment variables with secure defaults
 */

import crypto from 'crypto';
import { readFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';
import { AnalyticsCollector } from './collector.js';
import { AnalyticsConfig, AnalyticsLevel } from './types.js';

// Read version from package.json to ensure single source of truth
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
);

/**
 * Default analytics endpoint (production analytics server)
 */
const DEFAULT_ENDPOINT = 'https://analytics.weather-mcp.com/v1/events';

/**
 * Validate analytics endpoint for security
 * Prevents SSRF attacks and enforces HTTPS
 */
export function validateAnalyticsEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch (error) {
    throw new Error('Invalid ANALYTICS_ENDPOINT: must be a valid URL');
  }

  // SECURITY: Only allow HTTPS
  if (url.protocol !== 'https:') {
    throw new Error('Invalid ANALYTICS_ENDPOINT: must use HTTPS protocol');
  }

  // SECURITY: Prevent SSRF to internal networks
  // URL.hostname keeps a trailing dot ("localhost."), which still resolves to
  // the same host, so drop every trailing dot before the name checks.
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.16.') ||
    hostname.startsWith('172.17.') ||
    hostname.startsWith('172.18.') ||
    hostname.startsWith('172.19.') ||
    hostname.startsWith('172.20.') ||
    hostname.startsWith('172.21.') ||
    hostname.startsWith('172.22.') ||
    hostname.startsWith('172.23.') ||
    hostname.startsWith('172.24.') ||
    hostname.startsWith('172.25.') ||
    hostname.startsWith('172.26.') ||
    hostname.startsWith('172.27.') ||
    hostname.startsWith('172.28.') ||
    hostname.startsWith('172.29.') ||
    hostname.startsWith('172.30.') ||
    hostname.startsWith('172.31.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.') || // Link-local
    hostname.endsWith('.local')
  ) {
    throw new Error('Invalid ANALYTICS_ENDPOINT: cannot point to internal network');
  }

  // SECURITY: Require domain name (not IP address), in both families.
  // URL.hostname keeps IPv6 literals bracketed ("[::1]"), so a leading "["
  // is exactly the set of IPv6 literals, in every spelling.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith('[')) {
    throw new Error('Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name');
  }

  // SECURITY: Validate port range
  const port = url.port ? parseInt(url.port) : 443;
  if (port < 1 || port > 65535 || (port !== 443 && port < 1024)) {
    throw new Error('Invalid ANALYTICS_ENDPOINT: invalid port number');
  }
}

/**
 * Get or generate analytics salt for session ID hashing
 * Generates a unique salt per installation and persists it
 */
function getOrGenerateAnalyticsSalt(): string {
  // Check environment variable first
  if (process.env.ANALYTICS_SALT) {
    return process.env.ANALYTICS_SALT;
  }

  // Store in user's config directory (NOT in project directory)
  const configDir = path.join(os.homedir(), '.weather-mcp');
  const saltFile = path.join(configDir, 'analytics-salt');

  try {
    if (fs.existsSync(saltFile)) {
      return fs.readFileSync(saltFile, 'utf8').trim();
    }
  } catch (err) {
    logger.warn('Could not read analytics salt file', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  // Generate new random salt
  const newSalt = crypto.randomBytes(32).toString('hex');

  try {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(saltFile, newSalt, { mode: 0o600 });
    logger.info('Generated new analytics salt');
  } catch (err) {
    logger.warn('Could not persist analytics salt', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    // Continue with in-memory salt (regenerates each restart)
  }

  return newSalt;
}

/**
 * Load and validate analytics configuration from environment variables
 */
export function loadAnalyticsConfig(): AnalyticsConfig {
  // Analytics disabled by default (users must opt-in)
  const enabled = process.env.ANALYTICS_ENABLED === 'true';

  // Analytics level: minimal (default), standard, detailed
  let level: AnalyticsLevel = 'minimal';
  const levelEnv = process.env.ANALYTICS_LEVEL?.toLowerCase();
  if (levelEnv === 'standard' || levelEnv === 'detailed') {
    level = levelEnv;
  } else if (levelEnv && levelEnv !== 'minimal') {
    logger.warn('Invalid ANALYTICS_LEVEL, using minimal', {
      provided: levelEnv,
      securityEvent: true,
    });
  }

  // Analytics endpoint (custom server or default)
  const endpoint = process.env.ANALYTICS_ENDPOINT || DEFAULT_ENDPOINT;

  // Validate endpoint for security
  try {
    validateAnalyticsEndpoint(endpoint);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Invalid ANALYTICS_ENDPOINT configuration: ${errorMsg}`, error instanceof Error ? error : new Error(String(error)));
    // Disable analytics if endpoint is invalid (fail-safe)
    return {
      enabled: false,
      level: 'minimal',
      endpoint: DEFAULT_ENDPOINT,
      version: packageJson.version,
    };
  }

  // Salt for session ID hashing (auto-generated if not provided)
  const salt = getOrGenerateAnalyticsSalt();

  const config: AnalyticsConfig = {
    enabled,
    level,
    endpoint,
    version: packageJson.version,
    salt,
  };

  if (enabled) {
    logger.info('Analytics configuration loaded', {
      level,
      endpoint: endpoint === DEFAULT_ENDPOINT ? 'default' : 'custom',
    });
  } else {
    logger.info('Analytics disabled by user preference');
  }

  return config;
}

/**
 * Singleton analytics collector instance
 * Exported for use throughout the application
 */
export const analytics = new AnalyticsCollector(loadAnalyticsConfig());

/**
 * Re-export types for convenience
 */
export type { AnalyticsLevel, ToolExecutionMetadata } from './types.js';
