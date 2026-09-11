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
 * The second half of this module (DOC_SITES and the three site verbs) is the one
 * list of places in the docs that publish either count. See the block comment
 * above DOC_SITES for what is in the table, what is deliberately out of it, and
 * why it enumerates sites rather than facts.
 *
 * Plain ESM, Node >= 18, no dependencies beyond node:fs / node:url / node:path.
 */

import { readFileSync, writeFileSync } from 'node:fs';
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

/**
 * ---------------------------------------------------------------------------
 * DOC_SITES — the one list of doc count sites
 * ---------------------------------------------------------------------------
 *
 * Every place in the repository's documentation that publishes the tool count
 * or the full-suite test count, one row per **site**. Both release scripts read
 * this table and nothing else: scripts/check-doc-versions.sh validates every row
 * and scripts/update-docs-for-release.sh rewrites every row. The checker cannot
 * silently cover less ground than the writer because there is one list.
 *
 * **Every row must match exactly once.** A row that matches zero times means the
 * site was reworded out from under the table; a row that matches twice means a
 * site was copied. Either is reported as a failure of that row — never silently
 * skipped, never "first match wins". That is what makes the table self-checking:
 * a reworded site fails the checker instead of escaping it, and
 * tests/unit/derived-facts.test.ts pins the invariant against the real tree.
 *
 * **Why this enumerates sites and not facts.** A per-fact pattern like
 * `\b[0-9]+ tools\b` cannot tell a total from a preset count. docs/TOOLS.md:5
 * says the `basic` preset is `6 tools`, and .env.example names the `basic` and
 * `standard` sizes the same way; a global substitution keyed on the fact
 * rewrites all three to the total. That is not hypothetical — it shipped. At
 * v1.14.0 the writer's global README substitution turned a correct preset count
 * into the tool total on the project's front page, and it stood for fifteen
 * releases (GOTCHAS G12, Evidence). A per-site anchor names the sentence it
 * lives in, so a preset count is unreachable **by construction** rather than by
 * one file's pattern happening to be narrow enough.
 *
 * **Four count-shaped strings are deliberately not sites**, recorded here so the
 * next survey does not re-file them:
 *   - docs/testing/HARNESS_REPORT.md — emitted by scripts/stress-harness.mjs
 *     from toolCount(), so it is already derived from the declared source.
 *   - CLAUDE.md's `- **New in vX.Y.Z:**` lines — release narrative the writer
 *     prepends and prunes, never edits.
 *   - SECURITY.md's `1,042 tests` — a dated audit statement inside a dated
 *     paragraph, true of the audit rather than of the tree.
 *   - docs/releases/CHANGELOG.md — the frozen historical copy, never written to.
 *
 * **Two near-miss families were cleared rather than managed** (2026-09-09, T1 of
 * this plan), and they must not be re-filed as sites either:
 *   - The unit and integration *subtotals* that used to sit in
 *     docs/testing/TEST_SUITE_README.md (`1,008` / `62`). A different fact from
 *     the suite total, with no declared source to derive them from — testCount()
 *     does not produce them. The stale numbers were deleted, not tracked.
 *   - SECURITY.md's former `Comprehensive test coverage (131+ tests)`, a
 *     qualitative control claim rather than the total. Its number was removed.
 *
 * **How rows 19-21 were found, because it is the lesson.** They are one link out
 * from row 14: README.md's test badge links docs/testing/TEST_SUITE_README.md,
 * and docs/README.md links it twice more. Nothing managed them, nobody re-read
 * them, and they had drifted to `1,070` and `446` against a real 3,339 while
 * every surveyed page stayed correct. Re-deriving the site list from the writer
 * — the standing advice of the entry this table retires — would still have
 * missed all three, because the writer never wrote them.
 * **A page linked from a managed site is part of the consumer surface.**
 *
 * **Two constraints on every pattern**, both pinned by
 * tests/unit/derived-facts.test.ts:
 *   - It never carries the `g` flag. siteMatches adds `g` and `d` itself.
 *   - It never ends in `$`. There is no .gitattributes here, so an ordinary
 *     Windows clone under core.autocrlf=true has `\r` before every `\n`, and
 *     `$` under the `m` flag would then match nothing (GOTCHAS G87, one file
 *     over). `^` with `m` is fine — it is unaffected by the preceding `\r`.
 *
 * `format` is how the number is spelled at that site: `raw` (17), `en-us`
 * (3,339) or `badge` (3%2C339 — shields.io URL-encodes the comma).
 */
export const DOC_SITES = Object.freeze([
  // --- tool count (13 rows, 8 files) ---
  { file: 'README.md', fact: 'tool-count', format: 'raw', pattern: /real weather data — (\d+) tools/ },
  { file: 'README.md', fact: 'tool-count', format: 'raw', pattern: /\*\*Breadth\*\* — (\d+) tools/ },
  { file: 'README.md', fact: 'tool-count', format: 'raw', pattern: /^All (\d+) tools, documented/m },
  { file: 'README.md', fact: 'tool-count', format: 'raw', pattern: /\| `all` \| all (\d+) tools \|/ },
  { file: 'README.md', fact: 'tool-count', format: 'raw', pattern: /Every one of the (\d+) tools/ },
  { file: 'README.md', fact: 'tool-count', format: 'raw', pattern: /— all (\d+) tools: parameters/ },
  { file: 'CLAUDE.md', fact: 'tool-count', format: 'raw', pattern: /^## Key Features \((\d+) MCP Tools\)/m },
  { file: 'docs/TOOLS.md', fact: 'tool-count', format: 'raw', pattern: /reference for all (\d+) MCP tools/ },
  { file: 'package.json', fact: 'tool-count', format: 'raw', pattern: /(\d+) weather tools/ },
  { file: 'server.json', fact: 'tool-count', format: 'raw', pattern: /(\d+) weather tools/ },
  { file: '.github/social-preview.html', fact: 'tool-count', format: 'raw', pattern: /<b>(\d+) weather tools/ },
  { file: 'examples/README.md', fact: 'tool-count', format: 'raw', pattern: /^All (\d+) tools appear/m },
  { file: '.env.example', fact: 'tool-count', format: 'raw', pattern: /All (\d+) tools including/ },
  // --- test count (8 rows, 5 files) ---
  { file: 'README.md', fact: 'test-count', format: 'badge', pattern: /tests-([0-9]+(?:%2C[0-9]+)*)%20passing/ },
  { file: 'README.md', fact: 'test-count', format: 'en-us', pattern: /TypeScript, ([0-9,]+) tests/ },
  { file: 'README.md', fact: 'test-count', format: 'en-us', pattern: /Run all ([0-9,]+) tests/ },
  { file: 'CLAUDE.md', fact: 'test-count', format: 'en-us', pattern: /^- \*\*Test Coverage:\*\* ([0-9,]+) tests/m },
  { file: 'docs/README.md', fact: 'test-count', format: 'en-us', pattern: /^- \*\*Test Coverage:\*\* ([0-9,]+) tests/m },
  { file: 'docs/testing/TEST_SUITE_README.md', fact: 'test-count', format: 'en-us', pattern: /^\| \*\*Total Tests\*\* \| ([0-9,]+) \|/m },
  { file: 'docs/testing/TEST_SUITE_README.md', fact: 'test-count', format: 'en-us', pattern: /^- ✅ ([0-9,]+) total tests/m },
  { file: 'docs/publishing/PUBLISHING.md', fact: 'test-count', format: 'en-us', pattern: /Verify test counts are accurate \(([0-9,]+) tests\)/ },
].map(Object.freeze));

/**
 * The repository root, resolved relative to this module rather than to cwd, so
 * every consumer gets the same answer from any working directory — the same
 * rule TOOLS_TS follows.
 */
const REPO_ROOT = new URL('../../', import.meta.url);

/** Default reader: a repo-relative path. */
function readRepoFile(file) {
  return readFileSync(new URL(file, REPO_ROOT), 'utf8');
}

/** Default writer: a repo-relative path. */
function writeRepoFile(file, text) {
  writeFileSync(new URL(file, REPO_ROOT), text);
}

/** How a fact's name is spelled in the report lines. */
function factLabel(fact) {
  return fact === 'tool-count' ? 'tool count' : 'test count';
}

/**
 * Renders a count in the spelling a site uses.
 * @param {number} n
 * @param {'raw'|'en-us'|'badge'} format
 * @returns {string}
 */
export function renderCount(n, format) {
  if (format === 'raw') {
    return String(n);
  }
  const grouped = Number(n).toLocaleString('en-US');
  return format === 'badge' ? grouped.replace(/,/g, '%2C') : grouped;
}

/**
 * The inverse of renderCount: the integer a site's captured text spells.
 * Both separators are stripped regardless of the declared format, so a site
 * that changes spelling is a value the table can still read rather than a
 * parse failure that reads like a missing site.
 * @param {string} text
 * @param {'raw'|'en-us'|'badge'} _format
 * @returns {number|null} null when the text is not a plain integer
 */
export function parseCount(text, _format) {
  const stripped = String(text ?? '').replace(/%2C/gi, '').replace(/,/g, '');
  if (!/^[0-9]+$/.test(stripped)) {
    return null;
  }
  const n = Number(stripped);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Every match of a row's pattern in `source`.
 *
 * The capture's own [start, end] come from `match.indices[1]` (the `d` flag),
 * never from indexOf: a prefix that happens to contain the same digits would
 * misplace the write. The line number is 1-based and is what the report prints.
 *
 * @param {string} source
 * @param {{pattern: RegExp}} row
 * @returns {{captured: string, start: number, end: number, line: number}[]}
 */
export function siteMatches(source, row) {
  const text = String(source ?? '');
  const re = new RegExp(row.pattern.source, row.pattern.flags + 'gd');
  const out = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) {
      // A zero-length match cannot advance lastIndex on its own; nudge it so a
      // degenerate pattern loops finitely rather than hanging the checker.
      re.lastIndex += 1;
      continue;
    }
    const span = match.indices?.[1];
    if (span === undefined) {
      continue;
    }
    let line = 1;
    for (let i = 0; i < match.index; i += 1) {
      if (text.charCodeAt(i) === 10) {
        line += 1;
      }
    }
    out.push({ captured: match[1], start: span[0], end: span[1], line });
  }
  return out;
}

/**
 * Exactly-once only, no values. Every row is reported; none is skipped.
 * @param {{read?: (file: string) => string}} [options]
 * @returns {{failures: {row: object, count: number, reason: string}[]}}
 */
export function validateSites({ read = readRepoFile } = {}) {
  const failures = [];
  for (const row of DOC_SITES) {
    const count = siteMatches(read(row.file), row).length;
    if (count !== 1) {
      failures.push({
        row,
        count,
        reason: count === 0 ? 'not found' : `matched ${count} times`,
      });
    }
  }
  return { failures };
}

/**
 * Exactly-once, then the value at every row.
 *
 * A test-count row with no test count is `skipped` rather than failed — today's
 * posture, where tool counts are still checked when the suite could not report.
 *
 * @param {{read?: (file: string) => string, toolCount?: number, testCount?: number|null}} [options]
 */
export function checkSites({
  read = readRepoFile,
  toolCount: expectedTools,
  testCount: expectedTests,
} = {}) {
  const tools = expectedTools ?? toolCount();
  const rows = [];
  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of DOC_SITES) {
    if (row.fact === 'test-count' && expectedTests == null) {
      rows.push({ row, status: 'skipped' });
      skipped += 1;
      continue;
    }
    const expected = row.fact === 'tool-count' ? tools : expectedTests;
    const matches = siteMatches(read(row.file), row);
    if (matches.length !== 1) {
      rows.push({
        row,
        count: matches.length,
        expected,
        status: 'failed',
        reason: matches.length === 0 ? 'not found' : `matched ${matches.length} times`,
      });
      failed += 1;
      continue;
    }
    const found = parseCount(matches[0].captured, row.format);
    const entry = {
      row,
      line: matches[0].line,
      count: 1,
      found,
      expected,
      status: found === expected ? 'ok' : 'failed',
    };
    if (entry.status === 'ok') {
      ok += 1;
    } else {
      entry.reason = 'value mismatch';
      failed += 1;
    }
    rows.push(entry);
  }

  return { ok, failed, skipped, rows };
}

/**
 * Two-phase. Phase 1 is validateSites over every row; on any failure nothing is
 * written at all. Phase 2 groups the rows by file, applies each row's
 * replacement to the file text in memory, and writes only the files whose text
 * actually changed.
 *
 * The replacement splices at the capture's own indices (GOTCHAS G35). A string
 * replacement would interpret `$$`, `` $` ``, `$'`, `$&` and `$1`-`$9` in the
 * inserted text; a slice interprets nothing at all. The value being written is a
 * number today, so nothing could go wrong — the rule exists precisely so the
 * safety does not depend on anyone auditing the value.
 *
 * A missing test count throws rather than skipping rows: the writer has already
 * aborted by the time it has no count (update-docs-for-release.sh), and a
 * release that silently leaves eight sites stale is the failure this table
 * exists to prevent.
 *
 * @param {{read?: (file: string) => string, write?: (file: string, text: string) => void,
 *          toolCount?: number, testCount?: number|null}} [options]
 */
export function writeSites({
  read = readRepoFile,
  write = writeRepoFile,
  toolCount: expectedTools,
  testCount: expectedTests,
} = {}) {
  if (expectedTests == null) {
    throw new Error(
      'writeSites requires a test count — refusing to leave the test-count sites stale.'
    );
  }

  const { failures } = validateSites({ read });
  if (failures.length > 0) {
    return { failures, changed: [], unchanged: [], counts: new Map() };
  }

  const tools = expectedTools ?? toolCount();
  const byFile = new Map();
  for (const row of DOC_SITES) {
    if (!byFile.has(row.file)) {
      byFile.set(row.file, []);
    }
    byFile.get(row.file).push(row);
  }

  const changed = [];
  const unchanged = [];
  const counts = new Map();

  for (const [file, rows] of byFile) {
    const original = read(file);
    let text = original;
    let updated = 0;

    for (const row of rows) {
      // Re-match against the CURRENT text: an earlier row on the same file may
      // have changed length, which moves every offset after it.
      const matches = siteMatches(text, row);
      if (matches.length !== 1) {
        throw new Error(
          `${file} ${factLabel(row.fact)}: ${matches.length} matches after an earlier replacement`
        );
      }
      const replacement = renderCount(
        row.fact === 'tool-count' ? tools : expectedTests,
        row.format
      );
      if (matches[0].captured === replacement) {
        continue;
      }
      text = text.slice(0, matches[0].start) + replacement + text.slice(matches[0].end);
      updated += 1;
    }

    counts.set(file, updated);
    if (text === original) {
      unchanged.push(file);
    } else {
      write(file, text);
      changed.push(file);
    }
  }

  return { failures: [], changed, unchanged, counts };
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
  } else if (fact === 'validate-sites') {
    const { failures } = validateSites();
    for (const f of failures) {
      const what = f.count === 0
        ? 'site not found'
        : `site matched ${f.count} times (expected exactly once)`;
      process.stdout.write(
        `❌ ${f.row.file} ${factLabel(f.row.fact)}: ${what} — ${f.row.pattern}\n`
      );
    }
    process.stdout.write(
      `📊 Doc count sites: ${DOC_SITES.length} rows — `
      + `${DOC_SITES.length - failures.length} ok, ${failures.length} failed\n`
    );
    process.exit(failures.length === 0 ? 0 : 1);
  } else if (fact === 'check-sites') {
    // An empty or missing argument means "no test count" — the tool counts are
    // still checked, which is the posture this replaced.
    const given = arg === undefined || arg === '' ? null : parseCount(arg, 'raw');
    const report = checkSites({ testCount: given });
    for (const r of report.rows) {
      if (r.status === 'skipped') {
        process.stdout.write(`⚠️  ${r.row.file} test count: skipped (no test count)\n`);
      } else if (r.status === 'ok') {
        process.stdout.write(`✅ ${r.row.file}:${r.line} ${factLabel(r.row.fact)}: ${r.found}\n`);
      } else if (r.reason === 'value mismatch') {
        process.stdout.write(
          `❌ ${r.row.file}:${r.line} ${factLabel(r.row.fact)}: ${r.found} (expected ${r.expected})\n`
        );
      } else {
        const what = r.count === 0
          ? 'site not found'
          : `site matched ${r.count} times (expected exactly once)`;
        process.stdout.write(
          `❌ ${r.row.file} ${factLabel(r.row.fact)}: ${what} — ${r.row.pattern}\n`
        );
      }
    }
    process.stdout.write(
      `📊 Doc count sites: ${DOC_SITES.length} rows — `
      + `${report.ok} ok, ${report.failed} failed, ${report.skipped} skipped\n`
    );
    process.exit(report.failed === 0 ? 0 : 1);
  } else if (fact === 'write-sites') {
    const given = arg === undefined || arg === '' ? null : parseCount(arg, 'raw');
    if (given === null) {
      process.stderr.write('usage: node scripts/lib/derived-facts.mjs write-sites <test-count>\n');
      process.exit(2);
    }
    const result = writeSites({ testCount: given });
    if (result.failures.length > 0) {
      for (const f of result.failures) {
        const what = f.count === 0
          ? 'site not found'
          : `site matched ${f.count} times (expected exactly once)`;
        process.stdout.write(
          `❌ ${f.row.file} ${factLabel(f.row.fact)}: ${what} — ${f.row.pattern}\n`
        );
      }
      process.stdout.write(
        `❌ Doc count sites: ${result.failures.length} row(s) failed validation — nothing written\n`
      );
      process.exit(1);
    }
    for (const file of result.changed) {
      process.stdout.write(`📝 ${file}: ${result.counts.get(file)} site(s) updated\n`);
    }
    for (const file of result.unchanged) {
      const n = DOC_SITES.filter((r) => r.file === file).length;
      process.stdout.write(`   ${file}: ${n} site(s) already current\n`);
    }
    // The machine line the release writer parses. Plain, and last.
    process.stdout.write(
      `changed: ${result.changed.length === 0 ? 'none' : result.changed.join(' ')}\n`
    );
    process.exit(0);
  } else {
    process.stderr.write(
      'usage: node scripts/lib/derived-facts.mjs <tool-count|test-count <line>|is-red <line>\n'
      + '       |validate-sites|check-sites [<test-count>]|write-sites <test-count>>\n'
    );
    process.exit(2);
  }
}
