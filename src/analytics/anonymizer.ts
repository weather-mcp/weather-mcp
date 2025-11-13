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
  level: AnalyticsLevel
): AnalyticsEvent {
  // Base event (minimal level) - always included
  const baseEvent: AnalyticsEvent = {
    version: rawData.version!,
    tool: rawData.tool,
    status: rawData.status,
    timestamp_hour: rawData.timestamp_hour!,
    analytics_level: level,
  };

  // Add error type for error events (all levels)
  if (rawData.status === 'error' && rawData.error_type) {
    baseEvent.error_type = rawData.error_type;
  }

  // Return minimal level (no additional data)
  if (level === 'minimal') {
    return baseEvent;
  }

  // Standard level - add performance metrics
  const standardEvent: AnalyticsEvent = {
    ...baseEvent,
    analytics_level: level,
  };

  if (rawData.response_time_ms !== undefined) {
    (standardEvent as any).response_time_ms = rawData.response_time_ms;
  }
  if (rawData.service) {
    (standardEvent as any).service = rawData.service;
  }
  if (rawData.cache_hit !== undefined) {
    (standardEvent as any).cache_hit = rawData.cache_hit;
  }
  if (rawData.retry_count !== undefined) {
    (standardEvent as any).retry_count = rawData.retry_count;
  }
  if (rawData.country) {
    (standardEvent as any).country = rawData.country;
  }

  // Return standard level
  if (level === 'standard') {
    return standardEvent;
  }

  // Detailed level - add anonymized workflow data
  const detailedEvent: AnalyticsEvent = {
    ...standardEvent,
    analytics_level: 'detailed',
  };

  if (rawData.parameters) {
    (detailedEvent as any).parameters = sanitizeParameters(rawData.parameters);
  }
  if (rawData.session_id) {
    (detailedEvent as any).session_id = hashSessionId(rawData.session_id);
  }
  if (rawData.sequence_number !== undefined) {
    (detailedEvent as any).sequence_number = rawData.sequence_number;
  }

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
  // Use environment salt or generate a consistent one
  const sessionSalt = salt || process.env.ANALYTICS_SALT || 'weather-mcp-default-salt';

  return crypto
    .createHash('sha256')
    .update(sessionId + sessionSalt)
    .digest('hex')
    .substring(0, 16); // Shortened for storage efficiency
}

/**
 * Approximate country detection from coordinates
 * PRIVACY: Intentionally vague - only major regions
 * This is only called once during session initialization, not per-event
 */
export function getCountryFromCoordinates(lat: number, lon: number): string {
  // US: Approximately 25-49°N, 125-66°W
  if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) {
    return 'US';
  }

  // Canada: Approximately 42-83°N, 141-52°W
  if (lat >= 41 && lat <= 84 && lon >= -142 && lon <= -52) {
    return 'CA';
  }

  // Europe: Approximately 35-71°N, 10°W-40°E
  if (lat >= 35 && lat <= 72 && lon >= -11 && lon <= 41) {
    return 'EU';
  }

  // Asia-Pacific: Rough approximation
  if (lat >= -10 && lat <= 55 && lon >= 60 && lon <= 180) {
    return 'AP';
  }

  // South America: Approximate
  if (lat >= -56 && lat <= 13 && lon >= -82 && lon <= -34) {
    return 'SA';
  }

  // Africa: Approximate
  if (lat >= -35 && lat <= 38 && lon >= -18 && lon <= 52) {
    return 'AF';
  }

  // Australia/Oceania: Approximate
  if (lat >= -48 && lat <= -10 && lon >= 112 && lon <= 180) {
    return 'OC';
  }

  // Default to OTHER for privacy (intentionally vague)
  return 'OTHER';
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
