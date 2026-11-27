/**
 * Process guards (plan-http-entry-hardening, §3): an unhandled rejection is
 * logged and the process continues; an uncaught exception is logged and the
 * entry is told to shut down. Neither line carries the error's message or
 * stack by default.
 *
 * The entries cannot be imported (G61), so their wiring is read as text, as
 * `http-deadline-wiring.test.ts` reads the axios clients.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installProcessGuards,
  UNCAUGHT_EXCEPTION_LOG,
  UNHANDLED_REJECTION_LOG
} from '../../src/server/processGuards.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');

type Listener = (value: unknown) => void;

function fakeEmitter(): { emitter: Pick<NodeJS.Process, 'on'>; listeners: Map<string, Listener[]> } {
  const listeners = new Map<string, Listener[]>();
  const emitter = {
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return emitter;
    }
  } as unknown as Pick<NodeJS.Process, 'on'>;
  return { emitter, listeners };
}

/** A message and a stack that would both be a leak if either reached a log line. */
function sentinelError(): Error {
  const error = new TypeError('zqguard7731 could not read "Springfield"');
  error.stack = 'TypeError: zqguard7731\n    at handler (/opt/app/zqframe7731.js:10:5)';
  return error;
}

let consoleError: ReturnType<typeof vi.spyOn>;
let savedPii: string | undefined;

beforeEach(() => {
  savedPii = process.env.LOG_PII;
  delete process.env.LOG_PII;
  // Vitest replaces globalThis.console, so the logger's line is seen here and
  // not on process.stderr (G34).
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (savedPii === undefined) delete process.env.LOG_PII;
  else process.env.LOG_PII = savedPii;
  vi.restoreAllMocks();
});

function logged(): Array<{ level?: string; message?: string; metadata?: Record<string, unknown> }> {
  return consoleError.mock.calls.map((call) => JSON.parse(String(call[0])) as { message?: string });
}

describe('installProcessGuards', () => {
  it('registers exactly one listener for each of the two events', () => {
    const { emitter, listeners } = fakeEmitter();
    installProcessGuards({ emitter, onFatal: vi.fn() });
    expect([...listeners.keys()].sort()).toEqual(['uncaughtException', 'unhandledRejection']);
    expect(listeners.get('unhandledRejection')).toHaveLength(1);
    expect(listeners.get('uncaughtException')).toHaveLength(1);
  });

  it('an unhandled rejection is logged once and the process is left running', () => {
    const { emitter, listeners } = fakeEmitter();
    const onFatal = vi.fn();
    installProcessGuards({ emitter, onFatal });

    listeners.get('unhandledRejection')?.[0]?.(sentinelError());

    expect(onFatal).not.toHaveBeenCalled();
    const lines = logged();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('ERROR');
    expect(lines[0]?.message).toBe(UNHANDLED_REJECTION_LOG);
    expect(lines[0]?.metadata).toEqual({ securityEvent: true, error: { name: 'TypeError' } });
  });

  it('an uncaught exception is logged once and the entry is told, once', () => {
    const { emitter, listeners } = fakeEmitter();
    const onFatal = vi.fn();
    installProcessGuards({ emitter, onFatal });

    listeners.get('uncaughtException')?.[0]?.(Object.assign(sentinelError(), { code: 'ERR_ZQ' }));

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledWith('uncaughtException');
    const lines = logged();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toBe(UNCAUGHT_EXCEPTION_LOG);
    expect(lines[0]?.metadata).toEqual({ securityEvent: true, error: { name: 'TypeError', code: 'ERR_ZQ' } });
  });

  it('neither line carries the message or the stack by default', () => {
    const { emitter, listeners } = fakeEmitter();
    installProcessGuards({ emitter, onFatal: vi.fn() });

    listeners.get('unhandledRejection')?.[0]?.(sentinelError());
    listeners.get('uncaughtException')?.[0]?.(sentinelError());

    const everything = consoleError.mock.calls.map((call) => JSON.stringify(call)).join('\n');
    // Non-vacuous: both lines were written.
    expect(everything).toContain(UNHANDLED_REJECTION_LOG);
    expect(everything).toContain(UNCAUGHT_EXCEPTION_LOG);
    for (const needle of ['zqguard7731', 'Springfield', 'zqframe7731', '/opt/app']) {
      expect(everything).not.toContain(needle);
    }
  });

  it('a rejection with something that is not an Error is still one clean line', () => {
    const { emitter, listeners } = fakeEmitter();
    const onFatal = vi.fn();
    installProcessGuards({ emitter, onFatal });

    listeners.get('unhandledRejection')?.[0]?.('zqstring7731');
    listeners.get('unhandledRejection')?.[0]?.(undefined);

    expect(onFatal).not.toHaveBeenCalled();
    expect(logged()).toHaveLength(2);
    expect(consoleError.mock.calls.map((call) => JSON.stringify(call)).join('\n')).not.toContain('zqstring7731');
  });
});

describe('both entries install the guards and own the exit code', () => {
  it.each(['index.ts', 'http.ts'])('src/%s', (file) => {
    const source = readFileSync(join(SRC, file), 'utf8');

    expect(source).toContain("from './server/processGuards.js'");
    expect(source.match(/installProcessGuards\(/g)).toHaveLength(1);
    // The coordinator exits 0 when every step completes. After a crash the
    // entry turns that into 1.
    expect(source).toMatch(/exit: \(code\) => process\.exit\(crashed \? 1 : code\)/);
    expect(source).toMatch(/onFatal: \(reason\) => \{\s*crashed = true;\s*void shutdown\(reason\);\s*\}/);

    // Installed after the coordinator exists and before the first await in main().
    const main = source.slice(source.indexOf('async function main()'));
    const install = main.indexOf('installProcessGuards(');
    expect(install).toBeGreaterThan(main.indexOf('createShutdown('));
    expect(install).toBeLessThan(main.indexOf('await '));
  });

  it('the express app still registers no process listener', () => {
    expect(readFileSync(join(SRC, 'server/httpApp.ts'), 'utf8')).not.toContain('installProcessGuards');
  });
});
