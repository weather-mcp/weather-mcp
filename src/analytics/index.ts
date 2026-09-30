/**
 * Analytics module - Privacy-first usage tracking
 * Implements anonymous, opt-in analytics as defined in docs/analytics/LOCAL_ANALYTICS_GUIDE.md
 */

export { analytics } from './config.js';
export { withAnalytics, createMetadataExtractor } from './middleware.js';
export type { AnalyticsLevel, ToolExecutionMetadata } from './types.js';
