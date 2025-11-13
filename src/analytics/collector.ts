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

  private readonly MAX_BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: AnalyticsConfig) {
    this.config = config;
    this.sessionId = this.generateSessionId();

    if (this.config.enabled) {
      this.startFlushTimer();
      this.setupGracefulShutdown();
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
        ...metadata,
      };

      // Add session tracking for detailed level
      if (this.config.level === 'detailed') {
        (rawData as any).session_id = this.sessionId;
        (rawData as any).sequence_number = this.sequenceNumber;
      }

      // Anonymize event based on configured level
      const event = anonymizeEvent(rawData, this.config.level);

      // Add to buffer
      this.buffer.push(event);

      logger.debug('Analytics event tracked', {
        tool,
        status,
        bufferSize: this.buffer.length,
      });

      // Flush if buffer is full
      if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
        await this.flush();
      }
    } catch (error) {
      // Fail silently - analytics should never break the application
      logger.warn('Analytics tracking error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tool,
      });
    }
  }

  /**
   * Flush buffered events to analytics server
   * Called automatically on timer or when buffer is full
   */
  public async flush(): Promise<void> {
    if (!this.config.enabled || this.buffer.length === 0) {
      return;
    }

    const eventsToSend = [...this.buffer];
    this.buffer = [];

    try {
      logger.debug('Flushing analytics batch', {
        count: eventsToSend.length,
      });

      await sendBatch(eventsToSend, this.config.endpoint, this.config.version);

      logger.debug('Analytics batch sent successfully', {
        count: eventsToSend.length,
      });
    } catch (error) {
      // Fail silently - analytics should never break the application
      logger.warn('Analytics batch send failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        count: eventsToSend.length,
      });
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
   * Setup graceful shutdown handlers
   * Ensures buffered events are sent before process exits
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) {
        return;
      }

      this.isShuttingDown = true;

      logger.debug('Analytics graceful shutdown', {
        signal,
        bufferSize: this.buffer.length,
      });

      this.stopFlushTimer();

      // Flush remaining events
      if (this.buffer.length > 0) {
        await this.flush();
      }
    };

    // Register shutdown handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
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
