/**
 * Analytics configuration and singleton collector instance
 * Loads settings from environment variables with secure defaults
 */

import { logger } from '../utils/logger.js';
import { AnalyticsCollector } from './collector.js';
import { AnalyticsConfig, AnalyticsLevel } from './types.js';

/**
 * Default analytics endpoint (production analytics server)
 */
const DEFAULT_ENDPOINT = 'https://analytics.weather-mcp.com/v1/events';

/**
 * Load and validate analytics configuration from environment variables
 */
function loadAnalyticsConfig(): AnalyticsConfig {
  // Analytics enabled by default (users can opt-out)
  const enabled = process.env.ANALYTICS_ENABLED !== 'false';

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

  // Validate endpoint is a valid URL
  try {
    new URL(endpoint);
  } catch (error) {
    logger.warn('Invalid ANALYTICS_ENDPOINT, using default', {
      provided: endpoint,
      default: DEFAULT_ENDPOINT,
      securityEvent: true,
    });
    return {
      enabled,
      level,
      endpoint: DEFAULT_ENDPOINT,
      version: '1.6.1',
    };
  }

  // Salt for session ID hashing (optional)
  const salt = process.env.ANALYTICS_SALT;

  const config: AnalyticsConfig = {
    enabled,
    level,
    endpoint,
    version: '1.6.1',
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
