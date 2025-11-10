/**
 * Custom error classes for better error handling and logging
 */

/**
 * Base error class for API-related errors
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly service: 'NOAA' | 'OpenMeteo' | 'NCEI' | 'RainViewer';
  public readonly userMessage: string;
  public readonly helpLinks: string[];
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    statusCode: number,
    service: 'NOAA' | 'OpenMeteo' | 'NCEI' | 'RainViewer',
    userMessage: string,
    helpLinks: string[] = [],
    isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.service = service;
    this.userMessage = userMessage;
    this.helpLinks = helpLinks;
    this.isRetryable = isRetryable;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Format error for display to user
   */
  toUserMessage(): string {
    let message = `${this.service} API Error: ${this.userMessage}`;

    if (this.helpLinks.length > 0) {
      message += '\n\nFor more information:\n';
      this.helpLinks.forEach(link => {
        message += `- ${link}\n`;
      });
    }

    return message;
  }
}

/**
 * Rate limit error - too many requests
 */
export class RateLimitError extends ApiError {
  public readonly retryAfter?: number;

  constructor(service: 'NOAA' | 'OpenMeteo' | 'NCEI' | 'RainViewer', messageOrRetryAfter?: string | number, retryAfter?: number) {
    // Handle backwards compatibility: if second param is number, treat it as retryAfter
    let message: string | undefined;
    let retry: number | undefined;

    if (typeof messageOrRetryAfter === 'number') {
      message = undefined;
      retry = messageOrRetryAfter;
    } else if (typeof messageOrRetryAfter === 'string') {
      message = messageOrRetryAfter;
      retry = retryAfter;
    }

    const userMessage = message || (retry
      ? `Rate limit exceeded. Please retry after ${retry} seconds.`
      : 'Rate limit exceeded. Please retry in a few seconds.');

    super(
      `Rate limit exceeded for ${service}`,
      429,
      service,
      userMessage,
      [
        'https://weather.gov/documentation/services-web-api',
        'https://open-meteo.com/en/features#api-documentation',
        'https://www.ncdc.noaa.gov/cdo-web/webservices'
      ],
      true // Retryable after waiting
    );

    this.name = 'RateLimitError';
    this.retryAfter = retry;
  }
}

/**
 * Service unavailable error - API is down or timing out
 */
export class ServiceUnavailableError extends ApiError {
  constructor(service: 'NOAA' | 'OpenMeteo' | 'NCEI' | 'RainViewer', messageOrError?: string | Error, originalError?: Error) {
    // Handle backwards compatibility: if second param is Error, treat it as originalError
    let message: string | undefined;
    let error: Error | undefined;

    if (typeof messageOrError === 'string') {
      message = messageOrError;
      error = originalError;
    } else if (messageOrError instanceof Error) {
      message = undefined;
      error = messageOrError;
    }

    const userMessage = message || `The ${service} weather service is temporarily unavailable. Please try again in a few minutes.`;
    const helpLink = service === 'NOAA' ? 'https://www.weather.gov/'
      : service === 'NCEI' ? 'https://www.ncei.noaa.gov/'
      : service === 'RainViewer' ? 'https://www.rainviewer.com/'
      : 'https://open-meteo.com/';

    super(
      `${service} API is currently unavailable`,
      503,
      service,
      userMessage,
      [helpLink],
      true // Retryable
    );

    this.name = 'ServiceUnavailableError';

    if (error && error.stack) {
      this.stack = `${this.stack}\nCaused by: ${error.stack}`;
    }
  }
}

/**
 * Invalid location error - coordinates not supported or out of range
 */
export class InvalidLocationError extends ApiError {
  public readonly latitude?: number;
  public readonly longitude?: number;

  constructor(
    service: 'NOAA' | 'OpenMeteo' | 'NCEI' | 'RainViewer',
    message: string,
    latitude?: number,
    longitude?: number
  ) {
    super(
      message,
      400,
      service,
      message,
      [],
      false // Not retryable
    );

    this.name = 'InvalidLocationError';
    this.latitude = latitude;
    this.longitude = longitude;
  }
}

/**
 * Data not found error - requested data doesn't exist
 */
export class DataNotFoundError extends ApiError {
  constructor(service: 'NOAA' | 'OpenMeteo' | 'NCEI' | 'RainViewer', message: string) {
    super(
      message,
      404,
      service,
      message,
      [],
      false // Not retryable
    );

    this.name = 'DataNotFoundError';
  }
}

/**
 * Validation error - invalid input parameters
 */
export class ValidationError extends Error {
  public readonly field?: string;
  public readonly value?: any;

  constructor(message: string, field?: string, value?: any) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  if (error instanceof ApiError) {
    return error.isRetryable;
  }

  // Network errors are generally retryable
  if (
    error.message.includes('ECONNREFUSED') ||
    error.message.includes('ETIMEDOUT') ||
    error.message.includes('ENOTFOUND')
  ) {
    return true;
  }

  return false;
}

/**
 * Format error for user display
 */
export function formatErrorForUser(error: Error): string {
  if (error instanceof ApiError) {
    return error.toUserMessage();
  }

  if (error instanceof ValidationError) {
    return `Validation Error: ${error.message}`;
  }

  // Sanitize generic errors to avoid leaking sensitive information
  const sanitizedMessage = error.message
    .replace(/ECONNREFUSED/, 'Connection refused')
    .replace(/ETIMEDOUT/, 'Connection timed out')
    .replace(/ENOTFOUND/, 'Service not found');

  return `Error: ${sanitizedMessage}`;
}
