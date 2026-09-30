/**
 * HTTPS transport layer for analytics events
 * Sends batched events to analytics collection server
 *
 * Lifecycle contract (design plan `plan-analytics-transport-deadline`):
 * - One absolute deadline bounds the whole request — connect, TLS, write, headers and the body
 *   drain. Node's per-request idle option is a socket-inactivity timer that every byte resets, so
 *   a server trickling its body would never trip it.
 * - The promise settles once, at the response headers: the status line is the batch's fate and
 *   nothing reads the body, which is drained to nowhere.
 * - Every way the request can end settles it — headers, a request error, the deadline, or a
 *   close with neither.
 */

import https from 'https';
import { logger } from '../utils/logger.js';
import { AnalyticsEvent } from './types.js';

/** The absolute deadline for one upload while the server is serving. */
export const REQUEST_DEADLINE_MS = 5000;

export interface SendBatchOptions {
  /** Absolute wall-clock bound on the whole request: connect, TLS, write, headers, drain. */
  deadlineMs?: number;
  /** `https.request` in production; a fake in tests. */
  request?: typeof https.request;
}

/**
 * Send batch of analytics events to collection server
 * Fails silently - analytics should never break the application
 */
export async function sendBatch(
  events: AnalyticsEvent[],
  endpoint: string,
  version: string,
  options: SendBatchOptions = {}
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const deadlineMs = options.deadlineMs ?? REQUEST_DEADLINE_MS;
  const request = options.request ?? https.request;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ events });

    // Every path settles through here, so a request that fails twice (the deadline, then the
    // socket's own reset) rejects and logs once. The flag is set before any call (G20).
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      fn();
    };

    try {
      const url = new URL(endpoint);

      // SECURITY: Only allow HTTPS for analytics transmission (H-1)
      if (url.protocol !== 'https:') {
        const error = new Error(`Analytics endpoint must use HTTPS for secure transmission (got ${url.protocol})`);
        logger.error('Analytics endpoint must use HTTPS', error);
        reject(error);
        return;
      }

      const requestOptions: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': `weather-mcp/${version}`,
        },
        // SECURITY: Explicitly require valid certificates (H-2)
        rejectUnauthorized: true,
      };

      const req = request(requestOptions, (res) => {
        // Attached so a connection dropped mid-body is handled here rather than relying on Node
        // suppressing the error when nobody listens. The batch has already settled by then.
        res.on('error', (err) => {
          logger.debug('Analytics response error after settle', {
            code: (err as NodeJS.ErrnoException).code,
          });
        });
        // Nothing reads the body: drain it to nowhere. The deadline below still bounds the drain.
        res.resume();

        settle(() => {
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
            });
            reject(error);
          }
        });
      });

      // Ref'd on purpose (G114): this timer is what guarantees the request ends, so it must hold
      // the process while the request is live. Cleared on 'close', not on settle, so it also
      // bounds the body drain after the promise has resolved.
      const deadline = setTimeout(() => {
        req.destroy(Object.assign(new Error('Request deadline exceeded'), { code: 'ETIMEDOUT' }));
      }, deadlineMs);

      req.on('close', () => {
        clearTimeout(deadline);
        // A close with neither a response nor an error would otherwise leave the promise pending.
        settle(() => {
          logger.warn('Analytics request closed before a response', { count: events.length });
          reject(new Error('Request closed before a response'));
        });
      });

      req.on('error', (err) => {
        // Code only, never the message: a socket error's message embeds the endpoint's hostname
        // (`getaddrinfo ENOTFOUND <host>`).
        settle(() => {
          logger.warn('Analytics request error', {
            code: (err as NodeJS.ErrnoException).code,
            count: events.length,
          });
          reject(err);
        });
      });

      req.write(data);
      req.end();
    } catch (error) {
      settle(() => {
        logger.warn('Analytics transport error', {
          error: error instanceof Error ? error.message : 'Unknown error',
          count: events.length,
        });
        reject(error);
      });
    }
  });
}
