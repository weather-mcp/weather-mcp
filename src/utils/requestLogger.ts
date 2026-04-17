/**
 * High-level MCP request lifecycle logger.
 * Writes one plain-text line per event to ~/.weather-mcp/requests.log.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from './logger.js';

export type RequestLogStatus = 'start' | 'success' | 'error';

interface RequestLogEvent {
  timestamp: string;
  requestId: string;
  tool: string;
  status: RequestLogStatus;
  durationMs?: number;
}

const REQUEST_LOG_DIR = join(homedir(), '.weather-mcp');
const REQUEST_LOG_PATH = join(REQUEST_LOG_DIR, 'requests.log');

function ensureRequestLogDirectoryExists(): void {
  if (existsSync(REQUEST_LOG_DIR)) {
    return;
  }

  mkdirSync(REQUEST_LOG_DIR, { recursive: true });
}

function formatRequestLogLine(event: RequestLogEvent): string {
  const duration = event.durationMs !== undefined ? String(event.durationMs) : 'NA';
  return `${event.timestamp} request_id=${event.requestId} tool=${event.tool} status=${event.status} duration_ms=${duration}\n`;
}

/**
 * Append a request lifecycle event to the plain text request log.
 * Failures are non-fatal and only reported to stderr logger.
 */
export function logRequestLifecycle(event: RequestLogEvent): void {
  try {
    ensureRequestLogDirectoryExists();
    appendFileSync(REQUEST_LOG_PATH, formatRequestLogLine(event), 'utf-8');
  } catch (error) {
    logger.warn('Failed to write request lifecycle log', {
      path: REQUEST_LOG_PATH,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
