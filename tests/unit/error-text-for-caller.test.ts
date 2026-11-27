import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DataNotFoundError,
  REMOTE_INTERNAL_ERROR_MESSAGE,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
  errorTextForCaller,
  formatErrorForUser,
} from '../../src/errors/ApiError.js';
import { runWithCallerAudience } from '../../src/utils/callerAudience.js';
import { FIRMSKeyRejectedError } from '../../src/services/firms.js';

const remote = <T>(fn: () => T): T => runWithCallerAudience(true, fn);
const local = <T>(fn: () => T): T => runWithCallerAudience(false, fn);

/** A real fs error: own keys errno, code, syscall, path. Never under a home directory (G151). */
const MISSING_PATH = '/srv/zq-missing-7731/nope.json';
function fsError(): Error {
  try {
    readFileSync(MISSING_PATH);
  } catch (error) {
    return error as Error;
  }
  throw new Error('fixture path unexpectedly exists');
}

function typeError(): Error {
  try {
    (undefined as unknown as { zqprop7731: number }).zqprop7731.toFixed();
  } catch (error) {
    return error as Error;
  }
  throw new Error('unreachable');
}

/** The peripheral services' convention: a plain Error with a fixed, pre-written message. */
const FEED_MESSAGE =
  'The MeteoAlarm warning feed could not be reached, so current warnings are unknown. This is not an all-clear.';

describe('errorTextForCaller', () => {
  describe('remote caller: runtime and library errors become one fixed sentence', () => {
    const cases: Array<[string, () => unknown, string[]]> = [
      ['a TypeError', typeError, ['zqprop7731', 'undefined']],
      ['an fs ENOENT error', fsError, [MISSING_PATH, 'ENOENT', 'zq-missing-7731']],
      [
        'an AggregateError',
        () => new AggregateError([new Error('zqinner7731')], 'zqouter7731'),
        ['zqinner7731', 'zqouter7731'],
      ],
      [
        'a module-load error',
        () => Object.assign(new Error("Cannot find module '/opt/app/zqmod7731.js'"), { code: 'ERR_MODULE_NOT_FOUND' }),
        ['/opt/app', 'zqmod7731'],
      ],
      [
        'a raw socket error',
        () => Object.assign(new Error('connect ECONNREFUSED 10.9.8.7:3128'), { code: 'ECONNREFUSED', syscall: 'connect' }),
        ['10.9.8.7', '3128'],
      ],
      ['a RangeError', () => new RangeError('zqrange7731'), ['zqrange7731']],
      ['a SyntaxError', () => new SyntaxError('Unexpected token z in "zqjson7731"'), ['zqjson7731']],
      ['a thrown string', () => 'zqstring7731 at /opt/app/x.js', ['zqstring7731', '/opt/app']],
      ['a thrown plain object', () => ({ detail: 'zqobject7731' }), ['zqobject7731']],
      ['undefined', () => undefined, []],
    ];

    it.each(cases)('%s', (_name, make, forbidden) => {
      const error = make();
      const text = remote(() => errorTextForCaller(error));
      expect(text).toBe(REMOTE_INTERNAL_ERROR_MESSAGE);
      for (const fragment of forbidden) {
        expect(text).not.toContain(fragment);
      }
    });

    it('formatErrorForUser carries the same sentence under its prefix', () => {
      const text = remote(() => formatErrorForUser(fsError()));
      expect(text).toBe(`Error: ${REMOTE_INTERNAL_ERROR_MESSAGE}`);
      expect(text).not.toContain('/srv/');
    });

    it('a hostile getter cannot throw out of the function', () => {
      const hostile = new Error('zqhostile7731');
      Object.defineProperty(hostile, 'code', { get() { throw new Error('getter'); } });
      Object.defineProperty(hostile, 'remoteMessage', { get() { throw new Error('getter'); } });
      expect(() => remote(() => errorTextForCaller(hostile))).not.toThrow();
    });

    it('the fixed sentence names no class, path or value', () => {
      expect(REMOTE_INTERNAL_ERROR_MESSAGE).not.toMatch(/Error:|TypeError|\/|\\/);
    });
  });

  describe('remote caller: messages this project wrote pass through unchanged', () => {
    const cases: Array<[string, () => Error]> = [
      ['a plain Error with a fixed message', () => new Error(FEED_MESSAGE)],
      ['a key-rejected error', () => new FIRMSKeyRejectedError()],
      ['a ValidationError', () => new ValidationError('Invalid latitude', 'latitude', 100)],
      ['a RateLimitError', () => new RateLimitError('NOAA', 60)],
      ['a ServiceUnavailableError', () => new ServiceUnavailableError('OpenMeteo')],
      ['a DataNotFoundError', () => new DataNotFoundError('NCEI', 'No NCEI normals stations found near this location')],
      // An ApiError keeps its own rendering even when it carries the cause's socket code.
      [
        'a ServiceUnavailableError with a causeCode',
        () => new ServiceUnavailableError('NOAA', Object.assign(new Error('socket'), { code: 'ECONNRESET' })),
      ],
    ];

    it.each(cases)('%s: errorTextForCaller', (_name, make) => {
      const error = make();
      expect(remote(() => errorTextForCaller(error))).toBe(local(() => errorTextForCaller(error)));
      expect(remote(() => errorTextForCaller(error))).toBe(error.message);
    });

    it.each(cases)('%s: formatErrorForUser', (_name, make) => {
      const error = make();
      expect(remote(() => formatErrorForUser(error))).toBe(local(() => formatErrorForUser(error)));
    });
  });

  describe('remoteMessage', () => {
    const error = Object.assign(new Error('Could not read /srv/zqstore7731/locations.json'), {
      remoteMessage: 'The server could not read its saved locations file.',
    });

    it('is what a remote caller reads', () => {
      expect(remote(() => errorTextForCaller(error))).toBe('The server could not read its saved locations file.');
      expect(remote(() => formatErrorForUser(error))).toBe('Error: The server could not read its saved locations file.');
    });

    it('is ignored for a local caller', () => {
      expect(local(() => errorTextForCaller(error))).toBe('Could not read /srv/zqstore7731/locations.json');
    });

    it('wins over the runtime-class rule, so a typed error can still explain itself', () => {
      const typed = Object.assign(new TypeError('zqtyped7731'), { remoteMessage: 'A path-free explanation.' });
      expect(remote(() => errorTextForCaller(typed))).toBe('A path-free explanation.');
    });

    it('an empty or non-string remoteMessage is not used', () => {
      const empty = Object.assign(new Error('fixed text'), { remoteMessage: '' });
      const wrong = Object.assign(new Error('fixed text'), { remoteMessage: 42 });
      expect(remote(() => errorTextForCaller(empty))).toBe('fixed text');
      expect(remote(() => errorTextForCaller(wrong))).toBe('fixed text');
    });
  });

  describe('local caller, and no scope at all: today\'s text', () => {
    const cases: Array<[string, () => unknown, string]> = [
      ['a TypeError', typeError, typeError().message],
      ['an fs error', fsError, fsError().message],
      ['a plain Error', () => new Error(FEED_MESSAGE), FEED_MESSAGE],
      ['a thrown string', () => 'zqstring7731', 'zqstring7731'],
      ['undefined', () => undefined, 'undefined'],
    ];

    it.each(cases)('%s', (_name, make, expected) => {
      expect(errorTextForCaller(make())).toBe(expected);
      expect(local(() => errorTextForCaller(make()))).toBe(expected);
    });

    it('formatErrorForUser is unchanged, including its three replacements', () => {
      const refused = new Error('connect ECONNREFUSED somewhere');
      expect(formatErrorForUser(refused)).toBe('Error: connect Connection refused somewhere');
      expect(formatErrorForUser(fsError())).toBe(`Error: ${fsError().message}`);
      expect(formatErrorForUser(typeError())).toBe(`Error: ${typeError().message}`);
    });
  });
});
