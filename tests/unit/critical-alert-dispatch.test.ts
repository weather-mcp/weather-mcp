/**
 * Enablement lock for the life-threatening alert banner on the public MCP
 * dispatch (codex-MAJOR-2, diff review 2026-09-03).
 *
 * The banner is opt-in per call site: every handler takes a trailing
 * `criticalAlertBanner?: boolean` and does nothing at all when it is absent.
 * The ONLY thing that turns the feature on for real callers is the literal
 * `true` passed at three arms of the `switch (name)` dispatch in
 * `src/index.ts`. Every handler-level suite passes that flag directly, and
 * `tool-name-parity.test.ts` reads only `case` labels — so before this file,
 * flipping all three literals to `false` disabled the feature for every real
 * caller with the whole suite still green.
 *
 * Why a text scrape, again: a `switch` statement has no runtime
 * representation, so no amount of importing `src/index.ts` lets a test
 * enumerate its arms structurally (the same trade-off `tool-name-parity.test.ts`
 * documents and accepts). This file does not regex the argument list, though —
 * it matches parentheses, so reformatting the call across lines does not break
 * it while removing or negating the flag does.
 *
 * Scope: this asserts the wiring, not the rendering. What the banner looks like
 * and when it fires is covered by criticalAlert.test.ts and the three
 * critical-alert-*.test.ts handler suites.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const SOURCE = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');

/**
 * The full argument text of the first call to `fnName` in `source`, found by
 * matching parentheses rather than by regex, so nested calls and newlines in
 * the argument list are handled.
 */
function argumentsOf(source: string, fnName: string): string {
  const open = source.indexOf(`${fnName}(`);
  if (open === -1) {
    throw new Error(`no call to ${fnName} found in src/index.ts`);
  }
  let depth = 0;
  const start = open + fnName.length;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  throw new Error(`unbalanced parentheses in the call to ${fnName}`);
}

/** The last comma-separated argument, trimmed of whitespace and comments. */
function lastArgumentOf(source: string, fnName: string): string {
  const args = argumentsOf(source, fnName)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const parts = args.split(',');
  return (parts[parts.length - 1] ?? '').trim();
}

/**
 * The three weather-answering tools, and the only three. `get_alerts` serves
 * the same data under full contract rules and must NOT carry the banner —
 * a banner there would be a second rendering of what the tool already returns.
 */
const BANNER_ENABLED_HANDLERS = [
  'handleGetForecast',
  'handleGetCurrentConditions',
  'handleGetWeatherSummary',
] as const;

describe('critical-alert banner enablement on the public dispatch (MAJOR-2)', () => {
  it.each(BANNER_ENABLED_HANDLERS)(
    '%s is called with the banner flag enabled',
    handler => {
      expect(lastArgumentOf(SOURCE, handler)).toBe('true');
    }
  );

  it('reads a real dispatch — the scrape itself is not vacuous', () => {
    // The inverse half of the assertion above (G10): three identical `true`s
    // prove nothing if `argumentsOf` silently returned an empty string. A
    // handler that is deliberately NOT banner-enabled must come back different.
    expect(lastArgumentOf(SOURCE, 'handleGetAlerts')).not.toBe('true');
    expect(argumentsOf(SOURCE, 'handleGetForecast')).toContain('noaaService');
  });

  it('throws rather than passing when a handler is absent from the dispatch', () => {
    // Pins the failure mode: a renamed handler must fail loudly here, not
    // quietly return an empty last argument that happens not to equal 'true'.
    expect(() => argumentsOf(SOURCE, 'handleGetNonexistentThing')).toThrow(
      /no call to handleGetNonexistentThing/
    );
  });
});
