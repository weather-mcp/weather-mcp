/**
 * Analytics event collector and batch manager
 * Buffers events in memory and periodically flushes to analytics server
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { anonymizeEvent, roundToHour } from './anonymizer.js';
import { sendBatch } from './transport.js';
import { AnalyticsConfig, AnalyticsEvent, ToolExecutionMetadata } from './types.js';

/**
 * AnalyticsCollector - Manages event buffering and batch sending
 * Implements privacy-first analytics with automatic flushing
 */
export class AnalyticsCollector {
  private buffer: AnalyticsEvent[] = [];
  private config: AnalyticsConfig;
  private flushTimer: NodeJS.Timeout | null = null;
  private sessionId: string;
  private sequenceNumber = 0;
  private isShuttingDown = false;

  // Rate limiting state
  private consecutiveFailures = 0;
  private circuitOpen = false;
  private circuitOpenUntil: Date | null = null;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;
  private readonly CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000; // 5 minutes

  // Error tracking for health monitoring
  private errorCount = 0;
  private successCount = 0;
  private readonly ERROR_THRESHOLD = 10; // Alert after 10 consecutive failures

  // Rate limiting for event collection
  private lastFlushTime = 0;
  private flushCount = 0;
  private readonly MIN_FLUSH_INTERVAL_MS = 30000; // 30 seconds minimum between flushes
  private readonly MAX_FLUSHES_PER_HOUR = 20;
  private readonly MAX_EVENTS_PER_MINUTE = 60;
  private recentEventTimestamps: number[] = [];

  private readonly MAX_BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: AnalyticsConfig) {
    this.config = config;
    this.sessionId = this.generateSessionId();

    if (this.config.enabled) {
      this.startFlushTimer();
      logger.debug('Analytics collector initialized', {
        level: this.config.level,
        endpoint: this.config.endpoint,
      });
    }
  }

  /**
   * Track a tool execution event
   * Fails silently - analytics should never break the application
   */
  public async trackToolCall(
    tool: string,
    status: 'success' | 'error',
    metadata: ToolExecutionMetadata = {}
  ): Promise<void> {
    if (!this.config.enabled || this.isShuttingDown) {
      return;
    }

    try {
      // SECURITY: Rate limit event collection (M-3)
      const now = Date.now();
      this.recentEventTimestamps.push(now);

      // Remove timestamps older than 1 minute
      this.recentEventTimestamps = this.recentEventTimestamps.filter(
        ts => now - ts < 60000
      );

      // Check rate limit
      if (this.recentEventTimestamps.length > this.MAX_EVENTS_PER_MINUTE) {
        logger.warn('Analytics rate limit exceeded, dropping event', {
          tool,
          eventsPerMinute: this.recentEventTimestamps.length,
          securityEvent: true
        });
        return;
      }

      // Increment sequence number for detailed level
      if (this.config.level === 'detailed') {
        this.sequenceNumber++;
      }

      // Build raw event data
      const rawData = {
        version: this.config.version,
        tool,
        status,
        timestamp_hour: roundToHour(new Date()),
        analytics_level: this.config.level,
        error_type: metadata.error_type,
        response_time_ms: metadata.response_time_ms,
        service: metadata.service,
        cache_hit: metadata.cache_hit,
        retry_count: metadata.retry_count,
        country: metadata.country,
        parameters: metadata.parameters,
        session_id: undefined as string | undefined,
        sequence_number: undefined as number | undefined,
      };

      // Add session tracking for detailed level
      if (this.config.level === 'detailed') {
        rawData.session_id = this.sessionId;
        rawData.sequence_number = this.sequenceNumber;
      }

      // Anonymize event based on configured level (pass salt for session hashing)
      const event = anonymizeEvent(rawData, this.config.level, this.config.salt);

      // Add to buffer
      this.buffer.push(event);

      this.successCount++;
      this.errorCount = 0; // Reset on success (L-2)

      logger.debug('Analytics event tracked', {
        tool,
        status,
        bufferSize: this.buffer.length,
      });

      // Flush if buffer is full (with rate limiting)
      // Flush asynchronously to avoid blocking tool requests
      if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
        const timeSinceLastFlush = now - this.lastFlushTime;
        if (timeSinceLastFlush < this.MIN_FLUSH_INTERVAL_MS) {
          logger.warn('Analytics flush rate limit hit, delaying', {
            timeSinceLastFlush,
            bufferSize: this.buffer.length,
            securityEvent: true
          });
          return; // Don't flush, will be picked up by timer
        }
        // Schedule flush asynchronously to not block the tool request
        setImmediate(() => {
          this.flush().catch((err) => {
            logger.warn('Async analytics flush error', {
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          });
        });
      }
    } catch (error) {
      // Fail silently - analytics should never break the application
      this.errorCount++;

      logger.warn('Analytics tracking error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tool,
        consecutiveErrors: this.errorCount
      });

      // MONITORING: Alert on persistent failures (L-2)
      if (this.errorCount >= this.ERROR_THRESHOLD) {
        logger.error('Analytics system appears to be failing consistently', undefined, {
          consecutiveErrors: this.errorCount,
          successCount: this.successCount,
          securityEvent: true
        });
      }
    }
  }

  /**
   * Flush buffered events to analytics server
   * Called automatically on timer or when buffer is full
   * Implements circuit breaker pattern (3.7)
   */
  public async flush(): Promise<void> {
    if (!this.config.enabled || this.buffer.length === 0) {
      return;
    }

    // Check circuit breaker (3.7)
    if (this.circuitOpen) {
      if (this.circuitOpenUntil && new Date() < this.circuitOpenUntil) {
        logger.debug('Analytics circuit breaker open, skipping flush', {
          resetAt: this.circuitOpenUntil.toISOString(),
        });
        this.buffer = []; // Drop buffered events to prevent memory leak
        return;
      } else {
        // Try to close circuit
        logger.info('Analytics circuit breaker attempting reset');
        this.circuitOpen = false;
        this.circuitOpenUntil = null;
        this.consecutiveFailures = 0;
      }
    }

    const eventsToSend = [...this.buffer];
    this.buffer = [];

    // Track flush for rate limiting (M-3)
    const now = Date.now();
    this.lastFlushTime = now;
    this.flushCount++;

    // Reset counter every hour
    if (this.flushCount > this.MAX_FLUSHES_PER_HOUR) {
      logger.warn('Analytics flush count exceeded hourly limit', {
        flushCount: this.flushCount,
        securityEvent: true
      });
      // Continue but log for monitoring
    }

    try {
      logger.debug('Flushing analytics batch', {
        count: eventsToSend.length,
      });

      await sendBatch(eventsToSend, this.config.endpoint, this.config.version);

      logger.debug('Analytics batch sent successfully', {
        count: eventsToSend.length,
      });

      // Reset failure counter on success (3.7)
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures++;

      logger.warn('Analytics batch send failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        count: eventsToSend.length,
        consecutiveFailures: this.consecutiveFailures,
      });

      // Open circuit if too many failures (3.7)
      if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        this.circuitOpen = true;
        this.circuitOpenUntil = new Date(Date.now() + this.CIRCUIT_BREAKER_RESET_MS);

        logger.error('Analytics circuit breaker opened', undefined, {
          consecutiveFailures: this.consecutiveFailures,
          resetAt: this.circuitOpenUntil.toISOString(),
          securityEvent: true,
        });
      }

      // Don't re-queue events to avoid memory buildup
    }
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        logger.warn('Analytics flush timer error', {
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }, this.FLUSH_INTERVAL_MS);

    // Don't prevent process exit
    this.flushTimer.unref();
  }

  /**
   * Stop flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Generate unique session ID
   * Used for tracking tool call sequences in detailed mode
   */
  private generateSessionId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Public shutdown method called by main shutdown handler
   * Ensures buffered events are sent before process exits
   */
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    logger.debug('Analytics shutdown initiated', {
      bufferSize: this.buffer.length,
    });

    this.stopFlushTimer();

    // Flush remaining events
    if (this.buffer.length > 0) {
      await this.flush();
    }
  }

  /**
   * Get current buffer size (for testing)
   */
  public getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Get session ID (for testing)
   */
  public getSessionId(): string {
    return this.sessionId;
  }
}
