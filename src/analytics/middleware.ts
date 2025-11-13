/**
 * Analytics middleware for tool handlers
 * Automatically tracks tool executions with performance metrics
 */

import { logger } from '../utils/logger.js';
import { analytics } from './config.js';
import { ToolExecutionMetadata } from './types.js';

/**
 * Wrapper function that adds analytics tracking to tool handlers
 * Captures execution time, errors, and custom metadata
 *
 * @param toolName - Name of the MCP tool being executed
 * @param handler - The tool handler function to wrap
 * @param metadataExtractor - Optional function to extract metadata from handler result
 * @returns Wrapped handler with analytics tracking
 *
 * @example
 * ```typescript
 * export async function getForecastHandler(args: ForecastArgs) {
 *   return withAnalytics('get_forecast', async () => {
 *     // ... handler implementation
 *     return result;
 *   }, (result) => ({
 *     service: result.source,
 *     cache_hit: result.cached,
 *   }));
 * }
 * ```
 */
export async function withAnalytics<T>(
  toolName: string,
  handler: () => Promise<T>,
  metadataExtractor?: (result: T) => Partial<ToolExecutionMetadata>
): Promise<T> {
  const startTime = Date.now();
  let metadata: ToolExecutionMetadata = {};

  try {
    // Execute the handler
    const result = await handler();

    // Calculate response time
    const responseTimeMs = Date.now() - startTime;
    metadata.response_time_ms = responseTimeMs;

    // Extract additional metadata from result if extractor provided
    if (metadataExtractor) {
      try {
        const extracted = metadataExtractor(result);
        metadata = { ...metadata, ...extracted };
      } catch (error) {
        logger.warn('Analytics metadata extraction error', {
          tool: toolName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Track successful execution
    await analytics.trackToolCall(toolName, 'success', metadata);

    return result;
  } catch (error) {
    // Calculate response time even for errors
    const responseTimeMs = Date.now() - startTime;
    metadata.response_time_ms = responseTimeMs;

    // Categorize error type
    let errorType = 'unknown';
    if (error instanceof Error) {
      const errorName = error.constructor.name;
      // Map error classes to analytics categories
      if (errorName.includes('Validation') || errorName.includes('Invalid')) {
        errorType = 'validation';
      } else if (errorName.includes('NotFound') || errorName.includes('404')) {
        errorType = 'not_found';
      } else if (errorName.includes('RateLimit')) {
        errorType = 'rate_limit';
      } else if (errorName.includes('Timeout')) {
        errorType = 'timeout';
      } else if (errorName.includes('Network') || errorName.includes('Connection')) {
        errorType = 'network';
      } else if (errorName.includes('Service') || errorName.includes('API')) {
        errorType = 'service_error';
      } else {
        errorType = errorName.toLowerCase().replace('error', '').trim() || 'unknown';
      }
    }

    metadata.error_type = errorType;

    // Track error execution
    await analytics.trackToolCall(toolName, 'error', metadata);

    // Re-throw the error to maintain normal error handling flow
    throw error;
  }
}

/**
 * Helper to create metadata extractor for common patterns
 */
export function createMetadataExtractor<T>(
  extractor: (result: T) => Partial<ToolExecutionMetadata>
): (result: T) => Partial<ToolExecutionMetadata> {
  return extractor;
}
