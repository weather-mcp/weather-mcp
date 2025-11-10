/**
 * Structured logging utility for MCP server
 *
 * IMPORTANT: MCP servers use stdio for communication, so all logging MUST go to stderr
 * (console.error) to avoid interfering with the MCP protocol on stdout.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: string;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  metadata?: Record<string, any>;
}

export class Logger {
  private level: LogLevel;
  private context?: string;

  constructor(level: LogLevel = LogLevel.INFO, context?: string) {
    this.level = level;
    this.context = context;
  }

  /**
   * Create a child logger with a specific context
   */
  child(context: string): Logger {
    return new Logger(this.level, context);
  }

  /**
   * Set the logging level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Internal logging method
   */
  private log(level: LogLevel, message: string, metadata?: Record<string, any>, error?: Error): void {
    // Skip if below current log level
    if (level < this.level) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message,
    };

    if (this.context) {
      entry.context = this.context;
    }

    if (error) {
      entry.error = {
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      };
    }

    if (metadata) {
      entry.metadata = metadata;
    }

    // Output to stderr for MCP compatibility
    console.error(JSON.stringify(entry));
  }

  /**
   * Log debug message (detailed information for diagnosing problems)
   */
  debug(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  /**
   * Log info message (general informational messages)
   */
  info(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Log warning message (warning messages for potentially harmful situations)
   */
  warn(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * Log error message (error events that might still allow the application to continue)
   */
  error(message: string, error?: Error, metadata?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, metadata, error);
  }

  /**
   * Log API request
   */
  logApiRequest(service: string, endpoint: string, metadata?: Record<string, any>): void {
    this.debug(`API request to ${service}`, {
      service,
      endpoint,
      ...metadata,
    });
  }

  /**
   * Log API response
   */
  logApiResponse(service: string, endpoint: string, success: boolean, duration?: number): void {
    const level = success ? LogLevel.DEBUG : LogLevel.WARN;
    this.log(level, `API response from ${service}`, {
      service,
      endpoint,
      success,
      duration,
    });
  }

  /**
   * Log cache operation
   */
  logCacheOperation(operation: 'hit' | 'miss' | 'set' | 'evict', key: string): void {
    this.debug(`Cache ${operation}`, { operation, key });
  }
}

/**
 * Create the default logger instance
 * Level is controlled by LOG_LEVEL environment variable
 */
function createDefaultLogger(): Logger {
  const levelStr = process.env.LOG_LEVEL?.toUpperCase();
  let level = LogLevel.INFO; // Default to INFO

  if (levelStr && levelStr in LogLevel) {
    level = LogLevel[levelStr as keyof typeof LogLevel] as LogLevel;
  }

  return new Logger(level);
}

// Export singleton instance
export const logger = createDefaultLogger();

/**
 * Round coordinates for logging to protect user privacy
 * Reduces precision to ~1.1km accuracy (2 decimal places)
 * Set LOG_PII=true environment variable to log full precision (not recommended for production)
 *
 * Privacy rationale: Precise coordinates can reveal sensitive locations (homes, workplaces).
 * Rounded coordinates provide sufficient context for debugging while protecting user privacy.
 *
 * @param latitude - Original latitude
 * @param longitude - Original longitude
 * @returns Rounded coordinates object
 */
export function redactCoordinatesForLogging(latitude: number, longitude: number): { lat: number; lon: number } {
  // Check if PII logging is explicitly enabled (not recommended)
  const logPII = process.env.LOG_PII === 'true';

  if (logPII) {
    return { lat: latitude, lon: longitude };
  }

  // Round to 2 decimal places (~1.1km precision at equator)
  // This balances GDPR/CPRA data minimization with operational observability
  return {
    lat: Math.round(latitude * 100) / 100,
    lon: Math.round(longitude * 100) / 100
  };
}
