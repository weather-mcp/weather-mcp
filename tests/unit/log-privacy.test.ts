import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logger,
  LogLevel,
  isPiiLoggingEnabled,
  describeErrorForLogging,
  redactCoordinatesForLogging
} from '../../src/utils/logger.js';
import { DataNotFoundError } from '../../src/errors/ApiError.js';

describe('log-privacy helpers', () => {
  let savedLevel: LogLevel;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    savedLevel = logger.getLevel();
    logger.setLevel(LogLevel.DEBUG);
    vi.stubEnv('LOG_PII', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logger.setLevel(savedLevel);
    errorSpy.mockRestore();
  });

  const typed = () =>
    Object.assign(new Error('zqquery Street 7731 not found'), { code: 'ENOENT' });

  describe('isPiiLoggingEnabled', () => {
    it('is false when unset', () => {
      vi.unstubAllEnvs();
      delete process.env.LOG_PII;
      expect(isPiiLoggingEnabled()).toBe(false);
    });

    it.each(['1', 'TRUE', ''])('is false for %j', (value) => {
      vi.stubEnv('LOG_PII', value);
      expect(isPiiLoggingEnabled()).toBe(false);
    });

    it("is true only for 'true'", () => {
      vi.stubEnv('LOG_PII', 'true');
      expect(isPiiLoggingEnabled()).toBe(true);
    });
  });

  describe('describeErrorForLogging', () => {
    it('reports only class and code by default', () => {
      expect(describeErrorForLogging(typed())).toEqual({ name: 'Error', code: 'ENOENT' });
    });

    it('reports the class of a typed error with no code', () => {
      expect(describeErrorForLogging(new DataNotFoundError('NOAA', 'zqquery Street 7731 missing')))
        .toEqual({ name: 'DataNotFoundError' });
    });

    it('stringifies a numeric code', () => {
      expect(describeErrorForLogging(Object.assign(new Error('x'), { code: 503 })))
        .toEqual({ name: 'Error', code: '503' });
    });

    it('omits a non-finite numeric code', () => {
      const result = describeErrorForLogging(Object.assign(new Error('x'), { code: NaN }));
      expect(result).toEqual({ name: 'Error' });
      expect('code' in result).toBe(false);
    });

    it('omits an object code, with no code key', () => {
      const result = describeErrorForLogging(Object.assign(new Error('x'), { code: { a: 1 } }));
      expect(result).toEqual({ name: 'Error' });
      expect(Object.keys(result)).toEqual(['name']);
    });

    it('reports a thrown string as its type', () => {
      expect(describeErrorForLogging('zqquery Street 7731')).toEqual({ name: 'string' });
    });

    it('reports undefined as its type', () => {
      expect(describeErrorForLogging(undefined)).toEqual({ name: 'undefined' });
    });

    it('reports null as object', () => {
      expect(describeErrorForLogging(null)).toEqual({ name: 'object' });
    });

    it('never throws on a hostile getter', () => {
      const hostile = new Proxy({}, {
        get() {
          throw new Error('boom');
        }
      });
      let result: unknown;
      expect(() => {
        result = describeErrorForLogging(hostile);
      }).not.toThrow();
      expect(result).toEqual({ name: 'unknown' });
    });

    it('adds message and stack under LOG_PII', () => {
      vi.stubEnv('LOG_PII', 'true');
      const result = describeErrorForLogging(typed());
      expect(result.name).toBe('Error');
      expect(result.code).toBe('ENOENT');
      expect(result.message).toBe('zqquery Street 7731 not found');
      expect(typeof result.stack).toBe('string');
    });

    it('adds a stringified message but no stack for a non-Error under LOG_PII', () => {
      vi.stubEnv('LOG_PII', 'true');
      expect(describeErrorForLogging('zqraw7731')).toEqual({ name: 'string', message: 'zqraw7731' });
    });
  });

  describe('redactCoordinatesForLogging', () => {
    it('rounds to 2 dp when LOG_PII is off', () => {
      expect(redactCoordinatesForLogging(47.618273, -122.351946)).toEqual({ lat: 47.62, lon: -122.35 });
    });

    it('passes full precision under LOG_PII', () => {
      vi.stubEnv('LOG_PII', 'true');
      expect(redactCoordinatesForLogging(47.618273, -122.351946)).toEqual({ lat: 47.618273, lon: -122.351946 });
    });
  });
});
