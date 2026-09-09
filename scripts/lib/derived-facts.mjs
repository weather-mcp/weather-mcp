/**
 * The one derivation of the MCP tool count, and the one parse of the Vitest
 * summary line, shared by scripts/check-doc-versions.sh,
 * scripts/update-docs-for-release.sh and scripts/stress-harness.mjs.
 *
 * Before this module each of those three counted a `name: '…' as const` spelling
 * inside src/index.ts privately, so there were three private answers to "how many
 * tools are there" and none of them pointed at the declared source. The declared
 * source is TOOL_NAMES in src/config/tools.ts — CLAUDE.md says so, and
 * tests/unit/tool-name-parity.test.ts already pins the registry and the dispatch
 * to it.
 *
 * Why this parses the source rather than importing the module: an import needs a
 * precondition this has none of. `node --experimental-strip-types` on the .ts
 * needs Node >= 22.6 and the project's floor is Node >= 18; importing
 * dist/config/tools.js needs a build that is present and newer than the source,
 * and check-doc-versions.sh does not build. The parse needs neither.
 *
 * tests/unit/derived-facts.test.ts pins this derivation to TOOL_NAMES itself —
 * same names, same order, same count — so the two cannot drift apart silently.
 *
 * Plain ESM, Node >= 18, no dependencies beyond node:fs / node:url / node:path.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * The declared source, resolved relative to this module rather than to cwd, so
 * every consumer gets the same answer from any working directory.
 */
const TOOLS_TS = new URL('../../src/config/tools.ts', import.meta.url);

/**
 * Locates the `export const TOOL_NAMES = [ … ] as const;` block. The opening
 * anchor tolerates `\r\n`: there is no `.gitattributes`, so an ordinary Windows
 * clone under `core.autocrlf=true` checks the file out with CRLF endings, and a
 * bare `\n` here made the parser throw on that checkout. `ENTRY_RE` needs no
 * change — its `\s*` already absorbs a trailing `\r`.
 */
const BLOCK_RE = /^export const TOOL_NAMES = \[\r?\n([\s\S]*?)^\] as const;/m;

/**
 * One entry per line: a single-quoted name, an optional trailing comma, and an
 * optional trailing comment. Anchored per line so a full-line comment
 * (`// 'get_tides' — not yet`) is never counted, and so the preset arrays
 * elsewhere in the file cannot contribute.
 */
const ENTRY_RE = /^\s*'([a-z_]+)'\s*,?\s*(?:\/\/.*)?$/gm;

/**
 * Parses the TOOL_NAMES entries out of the text of src/config/tools.ts.
 * @param {string} source
 * @returns {string[]} the tool names, in declaration order
 */
export function parseToolNames(source) {
  const block = BLOCK_RE.exec(String(source ?? ''));
  if (block === null) {
    throw new Error('TOOL_NAMES block not found in src/config/tools.ts');
  }
  const names = [];
  ENTRY_RE.lastIndex = 0;
  let match;
  while ((match = ENTRY_RE.exec(block[1])) !== null) {
    names.push(match[1]);
  }
  if (names.length === 0) {
    throw new Error('TOOL_NAMES block is empty');
  }
  return names;
}

/**
 * The declared tool names, read from src/config/tools.ts.
 * @returns {string[]}
 */
export function toolNames() {
  return parseToolNames(readFileSync(TOOLS_TS, 'utf8'));
}

/**
 * The number of declared MCP tools.
 * @returns {number}
 */
export function toolCount() {
  return toolNames().length;
}

/**
 * The test total from a Vitest summary line — the last parenthetical figure,
 * which is the total rather than the `passed` count. On a red suite the first
 * number in the line is the *failed* count; reading it once made one flaky
 * live-network test report a suite of 1 and three phantom doc mismatches.
 * @param {string|undefined} summaryLine
 * @returns {number|null} the total, or null when the line carries none
 */
export function testCount(summaryLine) {
  const matches = String(summaryLine ?? '').match(/\((\d+)\)/g);
  if (matches === null || matches.length === 0) {
    return null;
  }
  return Number(matches[matches.length - 1].slice(1, -1));
}

/**
 * Whether a Vitest summary line reports a red suite.
 * @param {string|undefined} summaryLine
 * @returns {boolean}
 */
export function isRed(summaryLine) {
  return /\b\d+ failed\b/.test(String(summaryLine ?? ''));
}

// --- CLI -------------------------------------------------------------------
// Guarded so an `import` never triggers it. process.argv[1] is tested for
// existence before resolve() sees it: under `node --input-type=module -e`,
// process.argv is ["…/bin/node"] with no index 1, and resolve(undefined) throws
// ERR_INVALID_ARG_TYPE at import time, before any exported function can run.
//
// Every write goes through process.stdout.write — never `node -p`, and never
// console.log of a bare number, because `node -p` colour-wraps values under
// FORCE_COLOR and that is GOTCHAS G38's whole mechanism.

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const [fact, arg] = process.argv.slice(2);

  if (fact === 'tool-count') {
    try {
      process.stdout.write(String(toolCount()) + '\n');
    } catch (err) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
  } else if (fact === 'test-count') {
    const total = testCount(arg);
    if (total === null) {
      process.exit(1);
    }
    process.stdout.write(String(total) + '\n');
  } else if (fact === 'is-red') {
    // grep -q polarity: exit 0 when red, 1 when not, so it reads naturally in `if`.
    process.exit(isRed(arg) ? 0 : 1);
  } else {
    process.stderr.write(
      'usage: node scripts/lib/derived-facts.mjs <tool-count|test-count <line>|is-red <line>>\n'
    );
    process.exit(2);
  }
}
