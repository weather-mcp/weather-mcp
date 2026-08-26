/**
 * Unit tests for LOG_LEVEL parsing (src/utils/logger.ts) — issue #78.
 *
 * Pins every accepted spelling (numeric 0-3, named DEBUG/INFO/WARN/ERROR,
 * case- and whitespace-insensitive), the suppression each level buys, and
 * the fail-loud (never silent, never clamped) fallback for an unusable
 * value. See .devdocs/plan-issue-78-log-level-numeric.md ## Tests, D2, D4.
 *
 * Offline by rule: no network, no HTTP mock. D2 exports a pure
 * `parseLogLevel`, so every contract except the singleton-wiring one is a
 * plain function call — no module resetting needed. The singleton contract
 * is isolated to the file's one and only `vi.resetModules()` epoch, per
 * G21 (see that block below for why).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel, parseLogLevel } from '../../src/utils/logger.js';

describe('parseLogLevel', () => {
  describe('accepted spellings', () => {
    it.each([
      ['0', LogLevel.DEBUG],
      ['1', LogLevel.INFO],
      ['2', LogLevel.WARN],
      ['3', LogLevel.ERROR],
      ['DEBUG', LogLevel.DEBUG],
      ['INFO', LogLevel.INFO],
      ['WARN', LogLevel.WARN],
      ['ERROR', LogLevel.ERROR],
      ['debug', LogLevel.DEBUG],
      ['Warn', LogLevel.WARN],
      [' error ', LogLevel.ERROR],
      [' 2', LogLevel.WARN],
    ])('resolves %j to %i', (raw, expected) => {
      expect(parseLogLevel(raw)).toBe(expected);
    });
  });

  describe('undefined (D4: silent on absent)', () => {
    it('resolves to INFO and does not warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(parseLogLevel(undefined)).toBe(LogLevel.INFO);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('unusable values (D4: loud on wrong, never clamped)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it.each(['4', '-1', '1.9', '3wat', 'TRACE', ''])(
      'resolves %j to INFO and warns exactly once, naming LOG_LEVEL and the offending value',
      (raw) => {
        expect(parseLogLevel(raw)).toBe(LogLevel.INFO);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const message = warnSpy.mock.calls[0][0] as string;
        expect(message).toContain('LOG_LEVEL');
        expect(message).toContain(raw);
      }
    );

    it('preserves whitespace-only input verbatim in the warning message (" 2" is a valid spelling, so a whitespace-only value is used here instead)', () => {
      const raw = '   ';
      expect(parseLogLevel(raw)).toBe(LogLevel.INFO);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0][0] as string;
      expect(message).toContain('LOG_LEVEL');
      expect(message).toContain(`"${raw}"`);
    });

    it('warns on "1.9" rather than silently resolving to INFO the way parseInt("1.9") === 1 would', () => {
      expect(parseLogLevel('1.9')).toBe(LogLevel.INFO);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('does not resolve "3wat" to ERROR the way parseInt("3wat") === 3 would', () => {
      expect(parseLogLevel('3wat')).toBe(LogLevel.INFO);
      expect(parseLogLevel('3wat')).not.toBe(LogLevel.ERROR);
    });
  });
});

// NOTE on how "stderr" is observed below: under this repo's Vitest (v4.1.11,
// default node pool), `globalThis.console` is NOT the real Node console —
// Vitest replaces it at worker startup with its own `Console` instance bound
// to internal `Writable` buffers that forward to the reporter over RPC
// (node_modules/vitest/dist/chunks/console.3WNpx0tS.js:80-119), never to
// `process.stdout`/`process.stderr`. Verified empirically: a bare
// `vi.spyOn(process.stderr, 'write')` around a `console.error()` call records
// zero invocations in this suite. So a literal stream spy cannot observe
// what `src/utils/logger.ts` actually emits here. The load-bearing, always-
// true fact is Node's own documented contract for the *real* console
// (https://nodejs.org/api/console.html#consoleerrordata-args /
// #consolewarndata-args): `console.error`/`console.warn` write to stderr,
// `console.log` writes to stdout. `src/utils/logger.ts` calls exactly
// `console.error` (Logger.log, :99) and `console.warn` (parseLogLevel's
// fallback, :186) and never `console.log`/`console.info`. Spying on those
// three method identities — the same boundary the source code actually
// calls — is therefore the faithful, working stand-in for "reached stderr"
// / "never touched stdout" in this test environment.
describe('Logger suppression by level (the contract the bug broke)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  /** Drives all four log methods and returns the "level" field of every emitted entry, in order. */
  function emittedLevels(logger: Logger): string[] {
    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');
    return errorSpy.mock.calls.map((call) => {
      const line = call[0] as string;
      return (JSON.parse(line) as { level: string }).level;
    });
  }

  it.each([
    ['0', ['DEBUG', 'INFO', 'WARN', 'ERROR']],
    ['1', ['INFO', 'WARN', 'ERROR']],
    ['2', ['WARN', 'ERROR']],
    ['3', ['ERROR']],
    ['DEBUG', ['DEBUG', 'INFO', 'WARN', 'ERROR']],
    ['INFO', ['INFO', 'WARN', 'ERROR']],
    ['WARN', ['WARN', 'ERROR']],
    ['ERROR', ['ERROR']],
  ])('LOG_LEVEL=%s emits exactly %j', (raw, expected) => {
    const testLogger = new Logger(parseLogLevel(raw));
    expect(emittedLevels(testLogger)).toEqual(expected);
  });
});

describe('the fallback warning reaches stderr and never stdout', () => {
  it('calls console.warn (the stderr channel) with the message and never console.log (the stdout channel)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      parseLogLevel('nonsense');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0] as string).toContain('LOG_LEVEL');
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});

describe('the singleton reflects the environment it was constructed under', () => {
  it('picks up LOG_LEVEL=3 at import time', async () => {
    // One reset epoch, for the singleton-wiring contract only. LogLevel must be
    // re-imported *inside* the epoch — a top-of-file import is a different class
    // object per G21, and comparing across epochs silently fails.
    // No vi.useFakeTimers() wrapper: src/utils/logger.ts imports nothing and starts
    // no module-level timer, so this epoch leaks none (unlike mqtt-optional.test.ts,
    // whose helper needs the wrapper because blitzortung.js reaches cache.ts).
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = '3';
    try {
      vi.resetModules();
      const mod = await import('../../src/utils/logger.js');
      expect(mod.logger.getLevel()).toBe(mod.LogLevel.ERROR);
    } finally {
      if (previous === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = previous;
      vi.resetModules();
    }
  });
});
