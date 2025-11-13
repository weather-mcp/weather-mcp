/**
 * HTTPS transport layer for analytics events
 * Sends batched events to analytics collection server
 */

import http from 'http';
import https from 'https';
import { logger } from '../utils/logger.js';
import { AnalyticsEvent } from './types.js';

/**
 * Send batch of analytics events to collection server
 * Fails silently - analytics should never break the application
 */
export async function sendBatch(
  events: AnalyticsEvent[],
  endpoint: string,
  version: string
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ events });

    try {
      const url = new URL(endpoint);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': `weather-mcp/${version}`,
        },
        timeout: 5000, // 5 second timeout
      };

      const req = lib.request(options, (res) => {
        let responseData = '';

        // Consume response data
        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            logger.debug('Analytics batch sent successfully', {
              count: events.length,
              statusCode: res.statusCode,
            });
            resolve();
          } else {
            const error = new Error(`HTTP ${res.statusCode}`);
            logger.warn('Analytics batch failed', {
              statusCode: res.statusCode,
              count: events.length,
              error: error.message,
            });
            reject(error);
          }
        });
      });

      req.on('error', (err) => {
        logger.warn('Analytics request error', {
          error: err.message,
          count: events.length,
        });
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        const error = new Error('Request timeout');
        logger.warn('Analytics request timeout', {
          count: events.length,
        });
        reject(error);
      });

      req.write(data);
      req.end();
    } catch (error) {
      logger.warn('Analytics transport error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        count: events.length,
      });
      reject(error);
    }
  });
}
