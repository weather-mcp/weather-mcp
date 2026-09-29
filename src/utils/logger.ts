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

/**
 * Accepted spellings of LOG_LEVEL, in enum order — index N is LogLevel value N.
 * The list is what the parser matches against: never index LogLevel by a runtime
 * string. LogLevel is a *numeric* enum, so it carries reverse mappings: the `in`
 * operator treats "3" as one of its keys, and the lookup then yields the *string*
 * "ERROR" — which compares as NaN against a number and suppresses nothing.
 * That was issue #78.
 */
const LOG_LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

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
   * The level currently in force. Used by the startup log line so it reports the
   * effective level rather than the raw environment string.
   */
  getLevel(): LogLevel {
    return this.level;
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
 * Resolve a raw LOG_LEVEL value to a level. Accepts `0`-`3` and the four names,
 * case- and whitespace-insensitively. Anything else warns on stderr and falls
 * back to INFO. Exported for reuse by the tests: pure, no I/O beyond the warning,
 * no environment read.
 */
export function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined) return LogLevel.INFO;

  const value = raw.trim().toUpperCase();

  // Exact match on the four legal digits rather than parseInt, which would take
  // "1.9" as 1 and "3wat" as 3. The domain has four members; exactness is free,
  // and a typo should be told rather than rounded.
  if (/^[0-3]$/.test(value)) return Number(value) as LogLevel;

  const named = LOG_LEVEL_NAMES.indexOf(value as (typeof LOG_LEVEL_NAMES)[number]);
  if (named >= 0) return named as LogLevel;

  // Do not clamp an out-of-range value the way src/config/cache.ts does: clamping
  // LOG_LEVEL=4 to ERROR would let a typo *silence* the server. Fall back to INFO,
  // loudly, so a misconfiguration cannot hide its own diagnosis. console.warn, not
  // logger.warn: the singleton is mid-construction here, and console.warn goes to
  // stderr, the only stream an MCP server may use.
  // Echo the value through JSON.stringify rather than between literal quotes, and
  // bound it. Showing it verbatim is the whole point of the diagnostic — "" and
  // "  " are invisible any other way, and stringify keeps both the quoting and the
  // whitespace — but this is the one unstructured line on a stream where every
  // other line is a single JSON record (Logger.log, :99). An embedded newline
  // would therefore let a mistyped LOG_LEVEL forge a log entry for anything
  // reading that stream by line; stringify escapes it. The cap stops a pasted
  // file from becoming the entire warning. Ordinary typos are untouched:
  // JSON.stringify('4') is "4", byte for byte what this line printed before.
  const MAX_ECHO = 64;
  const echoed = JSON.stringify(raw.slice(0, MAX_ECHO));
  const truncated = raw.length > MAX_ECHO ? ` (truncated from ${raw.length} characters)` : '';
  console.warn(
    `Invalid LOG_LEVEL: ${echoed}${truncated}. Expected 0-3 or DEBUG/INFO/WARN/ERROR. Using default: INFO`
  );
  return LogLevel.INFO;
}

/**
 * Create the default logger instance.
 * The level comes from the LOG_LEVEL environment variable, which accepts either
 * `0`-`3` or `DEBUG`/`INFO`/`WARN`/`ERROR` (case- and whitespace-insensitively).
 * An unusable value warns on stderr and falls back to INFO — it does not clamp.
 */
function createDefaultLogger(): Logger {
  return new Logger(parseLogLevel(process.env.LOG_LEVEL));
}

// Export singleton instance
export const logger = createDefaultLogger();

/**
 * The one read site for `LOG_PII`.
 *
 * Read per call, so a test flips the variable without re-importing the module.
 * The flag lifts coordinate precision, geocoding queries, saved-location aliases
 * and error text from user-driven paths, all at once. It does not lift the broker
 * URL (`redactUrlForLogging` stays ungated) and it does not lift the saved `name`.
 *
 * @returns true only when `LOG_PII` is exactly the string `true`
 */
export function isPiiLoggingEnabled(): boolean {
  return process.env.LOG_PII === 'true';
}

/**
 * Describe an error for a log line without echoing what the user typed.
 *
 * By default a log line may say an error's class and code. The message and stack
 * ride along only under `LOG_PII`, because every message that reaches a
 * user-driven catch block embeds what the user typed.
 *
 * Total: never throws, so it is safe inside a catch block. A hostile getter
 * yields `{ name: 'unknown' }`.
 *
 * @param error - Anything a catch block can receive
 * @returns `name`, plus `code` when it is a string or finite number, plus
 *          `message` and `stack` under `LOG_PII`
 */
export function describeErrorForLogging(error: unknown): {
  name: string;
  code?: string;
  message?: string;
  stack?: string;
} {
  try {
    const isError = error instanceof Error;
    const described: { name: string; code?: string; message?: string; stack?: string } = {
      name: isError ? error.name : typeof error
    };

    if (typeof error === 'object' && error !== null) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' || (typeof code === 'number' && Number.isFinite(code))) {
        described.code = String(code);
      }
    }

    if (isPiiLoggingEnabled()) {
      described.message = isError ? error.message : String(error);
      if (isError && typeof error.stack === 'string') {
        described.stack = error.stack;
      }
    }

    return described;
  } catch {
    return { name: 'unknown' };
  }
}

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
  const logPII = isPiiLoggingEnabled();

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

/**
 * Reduce a URL to its scheme, host and port for logging.
 *
 * Returns only `<protocol>//<host>` — never the username, password, path, query
 * or fragment. Userinfo and the query string are both credential channels for a
 * broker URL (e.g. `mqtt`'s client forwards both to the connection), so either
 * one reaching a log line is a leak, not just the password.
 *
 * Deliberately **not** gated on `LOG_PII`: that flag exists to trade coordinate
 * precision for debuggability, and credentials are not PII. Gating this on it
 * would mean flipping `LOG_PII=true` to debug a location bug also puts a broker
 * password on stderr.
 *
 * Never throws — this runs in a field initializer of a module-load singleton,
 * where a throw over a malformed env var would take the whole server down. An
 * unparseable input renders as the fixed string `<unparseable>`.
 *
 * Built from `protocol` and `host`, never `url.origin`: WHATWG gives `origin`
 * as the literal string `"null"` for non-special schemes (`mqtt:`, `mqtts:`,
 * `tcp:`), which is exactly what a broker URL uses. Note also that the WHATWG
 * URL parser drops a *default* port only on special schemes (e.g.
 * `wss://host:443` renders as `wss://host`), so the displayed endpoint is the
 * URL standard's spelling, not necessarily the operator's original bytes.
 *
 * @param raw - The URL to redact (e.g. an MQTT broker URL from an env var)
 * @returns `<protocol>//<host>`, or `<unparseable>` if `raw` is not a valid URL
 */
export function redactUrlForLogging(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '<unparseable>';
  }
}
