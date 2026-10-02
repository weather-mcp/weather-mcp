import { describe, it, expect } from 'vitest';
import {
  ApiError,
  RateLimitError,
  ServiceUnavailableError,
  InvalidLocationError,
  DataNotFoundError,
  ValidationError,
  isRetryableError,
  formatErrorForUser,
} from '../../src/errors/ApiError.js';
import { describeErrorForLogging } from '../../src/utils/logger.js';

describe('Custom Error Classes', () => {
  describe('ApiError', () => {
    it('should create an error with all properties', () => {
      const error = new ApiError(
        'Test error',
        500,
        'NOAA',
        'User friendly message',
        ['https://example.com'],
        true
      );

      expect(error.name).toBe('ApiError');
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.service).toBe('NOAA');
      expect(error.userMessage).toBe('User friendly message');
      expect(error.helpLinks).toEqual(['https://example.com']);
      expect(error.isRetryable).toBe(true);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
    });

    it('should set default values for optional parameters', () => {
      const error = new ApiError(
        'Test error',
        400,
        'OpenMeteo',
        'User message'
      );

      expect(error.helpLinks).toEqual([]);
      expect(error.isRetryable).toBe(false);
    });

    it('should format error message for users', () => {
      const error = new ApiError(
        'Internal error',
        500,
        'NOAA',
        'Service is down',
        ['https://help.example.com', 'https://status.example.com']
      );

      const formatted = error.toUserMessage();

      expect(formatted).toContain('NOAA API Error');
      expect(formatted).toContain('Service is down');
      expect(formatted).toContain('For more information:');
      expect(formatted).toContain('https://help.example.com');
      expect(formatted).toContain('https://status.example.com');
    });

    it('should format error message without help links', () => {
      const error = new ApiError(
        'Internal error',
        400,
        'OpenMeteo',
        'Bad request'
      );

      const formatted = error.toUserMessage();

      expect(formatted).toBe('OpenMeteo API Error: Bad request');
      expect(formatted).not.toContain('For more information');
    });

    it('should capture stack trace on V8 engines', () => {
      const error = new ApiError('Test', 500, 'NOAA', 'Test message');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ApiError');
    });
  });

  describe('RateLimitError', () => {
    it('should create rate limit error for NOAA', () => {
      const error = new RateLimitError('NOAA');

      expect(error.name).toBe('RateLimitError');
      expect(error.statusCode).toBe(429);
      expect(error.service).toBe('NOAA');
      expect(error.isRetryable).toBe(true);
      expect(error.retryAfter).toBeUndefined();
      expect(error.userMessage).toContain('Rate limit exceeded');
      expect(error.userMessage).toContain('retry in a few seconds');
      expect(error.helpLinks.length).toBeGreaterThan(0);
    });

    it('should create rate limit error for OpenMeteo', () => {
      const error = new RateLimitError('OpenMeteo');

      expect(error.service).toBe('OpenMeteo');
      expect(error.statusCode).toBe(429);
    });

    it('should include retryAfter when provided', () => {
      const error = new RateLimitError('NOAA', 60);

      expect(error.retryAfter).toBe(60);
      expect(error.userMessage).toContain('retry after 60 seconds');
    });

    it('should be an instance of ApiError', () => {
      const error = new RateLimitError('NOAA');
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toBeInstanceOf(RateLimitError);
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should create service unavailable error', () => {
      const error = new ServiceUnavailableError('NOAA');

      expect(error.name).toBe('ServiceUnavailableError');
      expect(error.statusCode).toBe(503);
      expect(error.service).toBe('NOAA');
      expect(error.isRetryable).toBe(true);
      expect(error.userMessage).toContain('temporarily unavailable');
      expect(error.helpLinks.length).toBeGreaterThan(0);
    });

    it('should include original error stack', () => {
      const originalError = new Error('Connection refused');
      const error = new ServiceUnavailableError('OpenMeteo', originalError);

      expect(error.stack).toContain('ServiceUnavailableError');
      expect(error.stack).toContain('Caused by:');
      expect(error.stack).toContain('Connection refused');
    });

    it('should handle missing original error', () => {
      const error = new ServiceUnavailableError('NOAA');
      expect(error.stack).toBeDefined();
      expect(error.stack).not.toContain('Caused by:');
    });

    it('should use correct help link for each service', () => {
      const noaaError = new ServiceUnavailableError('NOAA');
      expect(noaaError.helpLinks[0]).toContain('weather.gov');

      const meteoError = new ServiceUnavailableError('OpenMeteo');
      expect(meteoError.helpLinks[0]).toContain('open-meteo.com');
    });

    describe('causeCode', () => {
      const withCode = (code: unknown): Error => Object.assign(new Error('boom'), { code });

      it('should take the string code of an Error passed as the second argument', () => {
        const error = new ServiceUnavailableError('OpenMeteo', withCode('ECONNABORTED'));
        expect(error.causeCode).toBe('ECONNABORTED');
      });

      it('should take the code from the third argument when a message is given', () => {
        const error = new ServiceUnavailableError('NCEI', 'msg', withCode('ECONNABORTED'));
        expect(error.causeCode).toBe('ECONNABORTED');
      });

      it('should leave causeCode undefined when no string code is available', () => {
        expect(new ServiceUnavailableError('NOAA', 'only a message').causeCode).toBeUndefined();
        expect(new ServiceUnavailableError('NOAA', new Error('no code')).causeCode).toBeUndefined();
        expect(new ServiceUnavailableError('NOAA', withCode(503)).causeCode).toBeUndefined();
        expect(new ServiceUnavailableError('NOAA').causeCode).toBeUndefined();
      });

      it('should not store the error object', () => {
        const error = new ServiceUnavailableError('OpenMeteo', withCode('ECONNABORTED'));
        expect(typeof error.causeCode).toBe('string');
        expect(Object.values(error).some((v) => v instanceof Error)).toBe(false);
      });

      it('should leave message, status, retryability and user message unchanged by a code', () => {
        const cases: Array<[() => ServiceUnavailableError, () => ServiceUnavailableError]> = [
          [
            () => new ServiceUnavailableError('OpenMeteo', withCode('ECONNABORTED')),
            () => new ServiceUnavailableError('OpenMeteo', withCode(undefined)),
          ],
          [
            () => new ServiceUnavailableError('NCEI', 'msg', withCode('ECONNABORTED')),
            () => new ServiceUnavailableError('NCEI', 'msg', withCode(undefined)),
          ],
          [
            () => new ServiceUnavailableError('NOAA', withCode(503)),
            () => new ServiceUnavailableError('NOAA', withCode(undefined)),
          ],
        ];
        for (const [coded, plain] of cases) {
          const a = coded();
          const b = plain();
          expect(a.message).toBe(b.message);
          expect(a.statusCode).toBe(503);
          expect(a.isRetryable).toBe(true);
          expect(a.toUserMessage()).toBe(b.toUserMessage());
        }
      });

      it('should not change describeErrorForLogging output', () => {
        const coded = new ServiceUnavailableError('OpenMeteo', withCode('ECONNABORTED'));
        const plain = new ServiceUnavailableError('OpenMeteo', withCode(undefined));
        expect(describeErrorForLogging(coded)).toEqual(describeErrorForLogging(plain));
      });
    });
  });

  describe('InvalidLocationError', () => {
    it('should create invalid location error', () => {
      const error = new InvalidLocationError(
        'NOAA',
        'Invalid coordinates',
        37.7749,
        -122.4194
      );

      expect(error.name).toBe('InvalidLocationError');
      expect(error.statusCode).toBe(400);
      expect(error.service).toBe('NOAA');
      expect(error.isRetryable).toBe(false);
      expect(error.userMessage).toBe('Invalid coordinates');
      expect(error.latitude).toBe(37.7749);
      expect(error.longitude).toBe(-122.4194);
    });

    it('should work without coordinates', () => {
      const error = new InvalidLocationError('OpenMeteo', 'Invalid location');

      expect(error.latitude).toBeUndefined();
      expect(error.longitude).toBeUndefined();
    });

    it('should not be retryable', () => {
      const error = new InvalidLocationError('NOAA', 'Bad location');
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('DataNotFoundError', () => {
    it('should create data not found error', () => {
      const error = new DataNotFoundError('NOAA', 'Station not found');

      expect(error.name).toBe('DataNotFoundError');
      expect(error.statusCode).toBe(404);
      expect(error.service).toBe('NOAA');
      expect(error.isRetryable).toBe(false);
      expect(error.userMessage).toBe('Station not found');
    });

    it('should not be retryable', () => {
      const error = new DataNotFoundError('OpenMeteo', 'Data not available');
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with all fields', () => {
      const error = new ValidationError('Invalid value', 'latitude', 100);

      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Invalid value');
      expect(error.field).toBe('latitude');
      expect(error.value).toBe(100);
      expect(error).toBeInstanceOf(Error);
    });

    it('should work without field and value', () => {
      const error = new ValidationError('Invalid input');

      expect(error.field).toBeUndefined();
      expect(error.value).toBeUndefined();
    });

    it('should capture stack trace', () => {
      const error = new ValidationError('Test error');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ValidationError');
    });

    it('should handle various value types', () => {
      const error1 = new ValidationError('Test', 'field', null);
      expect(error1.value).toBeNull();

      const error2 = new ValidationError('Test', 'field', { foo: 'bar' });
      expect(error2.value).toEqual({ foo: 'bar' });

      const error3 = new ValidationError('Test', 'field', [1, 2, 3]);
      expect(error3.value).toEqual([1, 2, 3]);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for retryable API errors', () => {
      const error = new RateLimitError('NOAA');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for non-retryable API errors', () => {
      const error = new InvalidLocationError('NOAA', 'Bad coords');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return true for ECONNREFUSED errors', () => {
      const error = new Error('ECONNREFUSED');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for ETIMEDOUT errors', () => {
      const error = new Error('Request ETIMEDOUT');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for ENOTFOUND errors', () => {
      const error = new Error('getaddrinfo ENOTFOUND');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for generic errors', () => {
      const error = new Error('Something went wrong');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should handle ValidationError as non-retryable', () => {
      const error = new ValidationError('Invalid input');
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('formatErrorForUser', () => {
    it('should format ApiError using toUserMessage', () => {
      const error = new RateLimitError('NOAA', 60);
      const formatted = formatErrorForUser(error);

      expect(formatted).toContain('NOAA API Error');
      expect(formatted).toContain('Rate limit exceeded');
      expect(formatted).toContain('60 seconds');
    });

    it('should format ValidationError', () => {
      const error = new ValidationError('Invalid latitude', 'latitude', 100);
      const formatted = formatErrorForUser(error);

      expect(formatted).toBe('Validation Error: Invalid latitude');
    });

    it('should sanitize ECONNREFUSED errors', () => {
      const error = new Error('ECONNREFUSED to api.weather.gov');
      const formatted = formatErrorForUser(error);

      expect(formatted).toContain('Connection refused');
      expect(formatted).not.toContain('ECONNREFUSED');
    });

    it('should sanitize ETIMEDOUT errors', () => {
      const error = new Error('Request ETIMEDOUT after 30000ms');
      const formatted = formatErrorForUser(error);

      expect(formatted).toContain('Connection timed out');
      expect(formatted).not.toContain('ETIMEDOUT');
    });

    it('should sanitize ENOTFOUND errors', () => {
      const error = new Error('getaddrinfo ENOTFOUND api.weather.gov');
      const formatted = formatErrorForUser(error);

      expect(formatted).toContain('Service not found');
      expect(formatted).not.toContain('ENOTFOUND');
      // Note: getaddrinfo is currently not sanitized, only ENOTFOUND is replaced
    });

    it('should handle generic errors', () => {
      const error = new Error('Something unexpected happened');
      const formatted = formatErrorForUser(error);

      expect(formatted).toBe('Error: Something unexpected happened');
    });

    it('should handle errors without messages', () => {
      const error = new Error();
      const formatted = formatErrorForUser(error);

      expect(formatted).toBe('Error: ');
    });
  });

  describe('Error Inheritance', () => {
    it('should maintain proper instanceof chain for RateLimitError', () => {
      const error = new RateLimitError('NOAA');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toBeInstanceOf(RateLimitError);
    });

    it('should maintain proper instanceof chain for ServiceUnavailableError', () => {
      const error = new ServiceUnavailableError('NOAA');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toBeInstanceOf(ServiceUnavailableError);
    });

    it('should distinguish between different error types', () => {
      const rateLimitError = new RateLimitError('NOAA');
      const locationError = new InvalidLocationError('NOAA', 'Bad coords');

      expect(rateLimitError).not.toBeInstanceOf(InvalidLocationError);
      expect(locationError).not.toBeInstanceOf(RateLimitError);
      expect(rateLimitError).toBeInstanceOf(ApiError);
      expect(locationError).toBeInstanceOf(ApiError);
    });
  });

  describe('Error Scenarios', () => {
    it('should create appropriate error for 429 status', () => {
      const error = new RateLimitError('NOAA', 30);

      expect(error.statusCode).toBe(429);
      expect(error.isRetryable).toBe(true);
      expect(error.retryAfter).toBe(30);
    });

    it('should create appropriate error for 503 status', () => {
      const error = new ServiceUnavailableError('OpenMeteo');

      expect(error.statusCode).toBe(503);
      expect(error.isRetryable).toBe(true);
    });

    it('should create appropriate error for 404 status', () => {
      const error = new DataNotFoundError('NOAA', 'Endpoint not found');

      expect(error.statusCode).toBe(404);
      expect(error.isRetryable).toBe(false);
    });

    it('should create appropriate error for 400 status', () => {
      const error = new InvalidLocationError('OpenMeteo', 'Invalid params');

      expect(error.statusCode).toBe(400);
      expect(error.isRetryable).toBe(false);
    });
  });
});
