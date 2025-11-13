/**
 * Data anonymization utilities for privacy-first analytics
 * Ensures no PII is collected as per docs/ANALYTICS_MCP_PLAN.md
 */

import crypto from 'crypto';
import { AnalyticsEvent, AnalyticsLevel } from './types.js';

/**
 * Raw event data before anonymization
 * Includes all possible fields that might be collected
 */
interface RawEventData {
  version: string;
  tool: string;
  status: 'success' | 'error';
  timestamp_hour: string;
  analytics_level?: AnalyticsLevel;
  error_type?: string;
  response_time_ms?: number;
  service?: string;
  cache_hit?: boolean;
  retry_count?: number;
  country?: string;
  parameters?: Record<string, unknown>;
  session_id?: string;
  sequence_number?: number;
}

/**
 * Anonymize event data based on analytics level
 * Strips sensitive information and ensures privacy compliance
 */
export function anonymizeEvent(
  rawData: RawEventData,
  level: AnalyticsLevel,
  salt?: string
): AnalyticsEvent {
  // Base event (minimal level) - always included
  const baseEvent = {
    version: rawData.version,
    tool: rawData.tool,
    status: rawData.status,
    timestamp_hour: rawData.timestamp_hour,
    analytics_level: 'minimal' as const,
    ...(rawData.status === 'error' && rawData.error_type ? { error_type: rawData.error_type } : {}),
  };

  // Return minimal level (no additional data)
  if (level === 'minimal') {
    return baseEvent;
  }

  // Standard level - add performance metrics
  const standardEvent = {
    ...baseEvent,
    analytics_level: 'standard' as const,
    ...(rawData.response_time_ms !== undefined && { response_time_ms: rawData.response_time_ms }),
    ...(rawData.service && { service: rawData.service }),
    ...(rawData.cache_hit !== undefined && { cache_hit: rawData.cache_hit }),
    ...(rawData.retry_count !== undefined && { retry_count: rawData.retry_count }),
    ...(rawData.country && { country: rawData.country }),
  };

  // Return standard level
  if (level === 'standard') {
    return standardEvent;
  }

  // Detailed level - add anonymized workflow data
  const detailedEvent = {
    ...standardEvent,
    analytics_level: 'detailed' as const,
    ...(rawData.parameters && { parameters: sanitizeParameters(rawData.parameters) }),
    ...(rawData.session_id && { session_id: hashSessionId(rawData.session_id, salt) }),
    ...(rawData.sequence_number !== undefined && { sequence_number: rawData.sequence_number }),
  };

  return detailedEvent;
}

/**
 * Sanitize tool parameters - ONLY keep safe, non-identifying values
 * NEVER include: coordinates, location names, user input
 */
function sanitizeParameters(params: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};

  // Allowlist of safe parameters that don't contain PII
  const allowedParams = [
    'days',
    'granularity',
    'source',
    'forecast_type',
    'include_normals',
    'include_fire_weather',
    'include_severe_weather',
    'active_only',
    'limit',
    'radius',
    'units',
    'hourly',
    'daily',
  ];

  for (const key of allowedParams) {
    if (params[key] !== undefined) {
      // Only include primitive values (no objects/arrays that might contain PII)
      const value = params[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        safe[key] = value;
      }
    }
  }

  // NEVER include these (blocklist for extra safety):
  // - latitude, longitude, lat, lon
  // - location, address, city, state, zip, postal_code
  // - user, name, email, phone
  // - any user-provided strings

  return safe;
}

/**
 * Create one-way hash of session ID
 * Cannot be reversed to identify users
 */
function hashSessionId(sessionId: string, salt?: string): string {
  // Salt should always be provided by config (auto-generated)
  // Fallback to environment variable if somehow not provided
  const sessionSalt = salt || process.env.ANALYTICS_SALT || '';

  if (!sessionSalt) {
    throw new Error('Analytics salt must be provided for session ID hashing');
  }

  return crypto
    .createHash('sha256')
    .update(sessionId + sessionSalt)
    .digest('hex')
    .substring(0, 16); // Shortened for storage efficiency
}

/**
 * Round timestamp to nearest hour for privacy
 * Prevents precise user tracking
 */
export function roundToHour(date: Date): string {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  return rounded.toISOString();
}
