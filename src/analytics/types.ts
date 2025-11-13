/**
 * Analytics type definitions for Weather MCP Server
 * Implements privacy-first analytics as defined in docs/ANALYTICS_MCP_PLAN.md
 */

export type AnalyticsLevel = 'minimal' | 'standard' | 'detailed';
export type EventStatus = 'success' | 'error';

/**
 * Base analytics event (minimal level)
 */
export interface BaseAnalyticsEvent {
  version: string;
  tool: string;
  status: EventStatus;
  timestamp_hour: string; // ISO 8601, rounded to hour
  analytics_level: AnalyticsLevel;
  error_type?: string; // Only for error status
}

/**
 * Standard level analytics event
 * Includes performance and service metrics
 */
export interface StandardAnalyticsEvent extends BaseAnalyticsEvent {
  analytics_level: 'standard' | 'detailed';
  response_time_ms?: number;
  service?: 'noaa' | 'openmeteo' | 'nifc' | 'usgs' | 'blitzortung' | 'rainviewer';
  cache_hit?: boolean;
  retry_count?: number;
  country?: string; // ISO 3166-1 alpha-2 code
}

/**
 * Detailed level analytics event
 * Includes anonymized workflow patterns
 */
export interface DetailedAnalyticsEvent extends StandardAnalyticsEvent {
  analytics_level: 'detailed';
  parameters?: Record<string, unknown>; // Anonymized parameters
  session_id?: string; // Hashed session ID
  sequence_number?: number;
}

/**
 * Union type for all analytics events
 */
export type AnalyticsEvent =
  | BaseAnalyticsEvent
  | StandardAnalyticsEvent
  | DetailedAnalyticsEvent;

/**
 * Analytics configuration
 */
export interface AnalyticsConfig {
  enabled: boolean;
  level: AnalyticsLevel;
  endpoint: string;
  version: string;
  salt?: string; // For session ID hashing
}

/**
 * Event batch for transport
 */
export interface EventBatch {
  events: AnalyticsEvent[];
}

/**
 * Metadata collected during tool execution
 */
export interface ToolExecutionMetadata {
  response_time_ms?: number;
  service?: string;
  cache_hit?: boolean;
  retry_count?: number;
  country?: string;
  parameters?: Record<string, unknown>;
  error_type?: string;
  session_id?: string;
  sequence_number?: number;
}
