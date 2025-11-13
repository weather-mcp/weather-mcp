/**
 * Analytics module - Privacy-first usage tracking
 * Implements anonymous, opt-out analytics as defined in docs/ANALYTICS_MCP_PLAN.md
 */

export { analytics } from './config.js';
export { withAnalytics, createMetadataExtractor } from './middleware.js';
export type { AnalyticsLevel, ToolExecutionMetadata } from './types.js';
