/**
 * The completeness lock for scripts/lib/derived-facts.mjs.
 *
 * That module is the one shared derivation of the MCP tool count and the one
 * shared parse of the Vitest summary line, used by check-doc-versions.sh,
 * update-docs-for-release.sh and stress-harness.mjs. Nothing previously
 * pinned that derivation to the declared source it claims to read
 * (TOOL_NAMES in src/config/tools.ts) — this file is that pin. Contract 1 is
 * the lock itself: the parsed names must deep-equal TOOL_NAMES, same order,
 * same count. Contracts 3-4 pin the parser against fixtures shaped to be
 * wrong under the regexes this module deliberately rejected (a loose
 * `/'[a-z_]+'/g` over the whole file, or a regex without the trailing-comment
 * allowance) — see GOTCHAS G13/G32: a fixture that cannot expose a rejected
 * alternative is not a lock.
 */

import { describe, it, expect } from 'vitest';
import { parseToolNames, toolNames, toolCount, testCount, isRed } from '../../scripts/lib/derived-facts.mjs';
import { TOOL_NAMES } from '../../src/config/tools.js';

describe('derived-facts', () => {
  describe('toolNames / toolCount pinned to TOOL_NAMES', () => {
    it('toolNames() deep-equals TOOL_NAMES, same names and order', () => {
      expect(toolNames()).toEqual([...TOOL_NAMES]);
    });

    it('toolCount() equals TOOL_NAMES.length', () => {
      expect(toolCount()).toBe(TOOL_NAMES.length);
    });
  });

  describe('parseToolNames', () => {
    // Shaped like the real file: a doc comment, the TOOL_NAMES block with one
    // plain entry, one entry with a trailing comment, and a full-line comment
    // between them, then a TOOL_PRESETS block after it. Five single-quoted
    // names total (confirmed below) so a loose /'[a-z_]+'/g over the whole
    // string returns 5 rather than the correct 2, and a regex without the
    // trailing-comment allowance returns 1 rather than 2.
    const FIXTURE = `/**
 * Doc comment above the block, not part of it.
 */
export const TOOL_NAMES = [
  'get_forecast',
  // 'get_tides' — planned
  'get_alerts', // life-threatening
] as const;

const TOOL_PRESETS = {
  basic: [ 'a', 'b' ]
};
`;

    it('the fixture actually carries five single-quoted names', () => {
      const quoted = FIXTURE.match(/'[a-z_]+'/g) ?? [];
      expect(quoted.length).toBe(5);
    });

    it('discriminates the TOOL_NAMES block from its neighbours', () => {
      expect(parseToolNames(FIXTURE)).toEqual(['get_forecast', 'get_alerts']);
    });

    it('throws the fixed message when the block is not found', () => {
      expect(() => parseToolNames('export const SOMETHING_ELSE = [];')).toThrow(
        'TOOL_NAMES block not found in src/config/tools.ts'
      );
    });

    it('throws the fixed message when the block is empty (comment-only)', () => {
      const emptyBlock = `export const TOOL_NAMES = [
  // 'get_tides' — planned
] as const;
`;
      expect(() => parseToolNames(emptyBlock)).toThrow('TOOL_NAMES block is empty');
    });
  });

  describe('testCount', () => {
    it('reads the parenthetical total on a green line', () => {
      expect(testCount('Tests  3313 passed (3313)')).toBe(3313);
    });

    it('reads the parenthetical total, not the leading failed count, on a red line', () => {
      expect(testCount('Tests  1 failed | 3312 passed (3313)')).toBe(3313);
    });

    it('reads the parenthetical total on a skipped line', () => {
      expect(testCount('Tests  3312 passed | 1 skipped (3313)')).toBe(3313);
    });

    it('returns null for an empty string', () => {
      expect(testCount('')).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(testCount(undefined)).toBeNull();
    });
  });

  describe('isRed', () => {
    it('is true for a red line', () => {
      expect(isRed('Tests  1 failed | 3312 passed (3313)')).toBe(true);
    });

    it('is false for a green line', () => {
      expect(isRed('Tests  3313 passed (3313)')).toBe(false);
    });

    it('is false for a skipped line', () => {
      expect(isRed('Tests  3312 passed | 1 skipped (3313)')).toBe(false);
    });

    it('is false for an empty string', () => {
      expect(isRed('')).toBe(false);
    });

    it('is false for undefined', () => {
      expect(isRed(undefined)).toBe(false);
    });
  });
});
