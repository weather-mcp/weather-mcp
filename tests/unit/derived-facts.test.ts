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
import { readFileSync } from 'node:fs';
import {
  parseToolNames,
  toolNames,
  toolCount,
  testCount,
  isRed,
  DOC_SITES,
  renderCount,
  parseCount,
  siteMatches,
  validateSites,
  checkSites,
  writeSites,
} from '../../scripts/lib/derived-facts.mjs';
import { TOOL_NAMES } from '../../src/config/tools.js';

// Reads a repo-tracked file relative to this test file, so the DOC_SITES
// contracts below run correctly from any cwd. Reads committed content only
// (GOTCHAS G79) — no gitignored path, no generated artifact.
const readRepoFile = (file: string) =>
  readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

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

    // No .gitattributes, so an ordinary Windows clone under core.autocrlf=true
    // checks src/config/tools.ts out with CRLF endings and this module reads it
    // back through toolNames(). The pre-centralization `grep -cE` derivation was
    // line-ending agnostic; this pins that the shared parse is too.
    it('parses the same names from a CRLF checkout', () => {
      expect(parseToolNames(FIXTURE.replace(/\n/g, '\r\n'))).toEqual([
        'get_forecast',
        'get_alerts',
      ]);
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

/**
 * DOC_SITES contracts — the one table both release scripts read.
 *
 * Real-tree contracts read only committed, tracked files (GOTCHAS G79). No
 * network, no timers, no `.claude/` paths. Nothing here copies a published
 * count out of this test file into the docs, or a published count out of a
 * prompt into this test file (GOTCHAS G22) — every expected value is derived
 * from toolCount(), from a row's own real match, or is an arbitrary offset
 * applied to one of those at runtime.
 */
describe('DOC_SITES', () => {
  it('contract 1: shape — 21 rows, 13 tool-count + 8 test-count across 11 files, one capture group per pattern, no g flag, no trailing $', () => {
    expect(DOC_SITES.length).toBe(21);

    const toolCountRows = DOC_SITES.filter((row) => row.fact === 'tool-count');
    const testCountRows = DOC_SITES.filter((row) => row.fact === 'test-count');
    expect(toolCountRows.length).toBe(13);
    expect(testCountRows.length).toBe(8);

    const files = new Set(DOC_SITES.map((row) => row.file));
    expect(files.size).toBe(11);

    for (const row of DOC_SITES) {
      expect(new RegExp(row.pattern.source + '|').exec('')!.length).toBe(2);
      expect(row.pattern.flags.includes('g')).toBe(false);
      expect(row.pattern.source.endsWith('$')).toBe(false);
    }
  });

  it('contract 2: every row matches its real file exactly once', () => {
    for (const row of DOC_SITES) {
      const matches = siteMatches(readRepoFile(row.file), row);
      expect(matches.length, `${row.file} ${row.pattern}`).toBe(1);
    }
  });

  it('contract 3: every tool-count row parses to toolCount() — no literal 17 in this file', () => {
    const expected = toolCount();
    for (const row of DOC_SITES.filter((r) => r.fact === 'tool-count')) {
      const [match] = siteMatches(readRepoFile(row.file), row);
      expect(parseCount(match.captured, row.format), `${row.file} ${row.pattern}`).toBe(expected);
    }
  });

  it('contract 4: every test-count row parses to the same integer, and renderCount reproduces its captured text exactly', () => {
    const testRows = DOC_SITES.filter((r) => r.fact === 'test-count');
    expect(testRows.length).toBe(8);

    const captures = testRows.map((row) => {
      const [match] = siteMatches(readRepoFile(row.file), row);
      return { row, captured: match.captured, parsed: parseCount(match.captured, row.format) };
    });

    const first = captures[0].parsed;
    expect(first).not.toBeNull();
    expect(Number.isInteger(first)).toBe(true);
    expect(first as number).toBeGreaterThan(0);

    for (const c of captures) {
      expect(c.parsed, `${c.row.file} ${c.row.pattern}`).toBe(first);
      expect(renderCount(first as number, c.row.format), `${c.row.file} ${c.row.pattern}`).toBe(c.captured);
    }
  });

  it('contract 5: the trap sites are unreachable, for both facts', () => {
    // docs/TOOLS.md — the basic-preset "6 tools" note is a real match for the
    // per-fact pattern, but no DOC_SITES row for this file captures '6'.
    const toolsSource = readRepoFile('docs/TOOLS.md');
    const toolsTrap = [...toolsSource.matchAll(/\b(\d+) tools\b/g)];
    expect(toolsTrap.length).toBeGreaterThanOrEqual(1);
    for (const row of DOC_SITES.filter((r) => r.file === 'docs/TOOLS.md')) {
      const [match] = siteMatches(toolsSource, row);
      expect(match.captured).not.toBe('6');
    }

    // .env.example — the per-fact pattern matches all three presets (basic,
    // standard, all), while the single row matches once and captures the
    // `all` count — the tool total.
    const envSource = readRepoFile('.env.example');
    const envTrap = [...envSource.matchAll(/\b(\d+) tools\b/g)];
    expect(envTrap.length).toBe(3);
    const envRows = DOC_SITES.filter((r) => r.file === '.env.example');
    expect(envRows.length).toBe(1);
    const [envMatch] = siteMatches(envSource, envRows[0]);
    expect(parseCount(envMatch.captured, envRows[0].format)).toBe(toolCount());

    // docs/testing/TEST_SUITE_README.md — four "N tests" phrases the per-fact
    // pattern reaches (a caveat and three dated history lines), none of which
    // overlap either of this file's two rows (a table cell and a bullet).
    const suiteSource = readRepoFile('docs/testing/TEST_SUITE_README.md');
    const suiteTrap = [...suiteSource.matchAll(/\b[0-9][0-9,]* tests\b/g)];
    expect(suiteTrap.length).toBe(4);
    const suiteRows = DOC_SITES.filter((r) => r.file === 'docs/testing/TEST_SUITE_README.md');
    expect(suiteRows.length).toBe(2);
    const siteSpans = suiteRows.flatMap((row) => siteMatches(suiteSource, row));
    for (const trap of suiteTrap) {
      const idx = trap.index as number;
      for (const site of siteSpans) {
        expect(idx >= site.start && idx < site.end).toBe(false);
      }
    }
  });

  it('contract 6: renderCount / parseCount round-trip for 17, 3339 and 999 across all formats', () => {
    const formats = ['raw', 'en-us', 'badge'] as const;
    for (const n of [17, 3339, 999]) {
      for (const format of formats) {
        expect(parseCount(renderCount(n, format), format)).toBe(n);
      }
    }
    expect(renderCount(3339, 'badge')).toBe('3%2C339');
    expect(renderCount(999, 'en-us')).toBe('999');
    expect(renderCount(999, 'badge')).toBe('999');
    expect(parseCount('abc', 'raw')).toBeNull();
  });

  describe('validateSites / checkSites / writeSites', () => {
    it('contract 7: validateSites reports a reworded site and a duplicated site, and no others', () => {
      const rewordRow = DOC_SITES.find(
        (r) => r.file === 'README.md' && r.pattern.source.includes('real weather data')
      )!;
      const dupRow = DOC_SITES.find((r) => r.file === 'CLAUDE.md' && r.fact === 'tool-count')!;

      const rewordedReadme = readRepoFile('README.md').replace(
        `real weather data — ${toolCount()} tools`,
        `solid weather data — ${toolCount()} tools`
      );
      const heading = `## Key Features (${toolCount()} MCP Tools)`;
      const realClaude = readRepoFile('CLAUDE.md');
      expect(realClaude.split(heading).length - 1).toBe(1);
      const duplicatedClaude = realClaude.replace(heading, () => `${heading}\n\n${heading}`);

      const fakeRead = (file: string) => {
        if (file === 'README.md') return rewordedReadme;
        if (file === 'CLAUDE.md') return duplicatedClaude;
        return readRepoFile(file);
      };

      const { failures } = validateSites({ read: fakeRead });
      expect(failures.length).toBe(2);

      const rewordFailure = failures.find((f) => f.row === rewordRow);
      const dupFailure = failures.find((f) => f.row === dupRow);
      expect(rewordFailure?.reason).toBe('not found');
      expect(dupFailure?.reason).toBe('matched 2 times');
    });

    it('contract 8: checkSites reports a value mismatch for every tool-count row under an injected toolCount, and skips every test-count row when testCount is null', () => {
      const injectedTools = toolCount() + 1;
      const report = checkSites({ toolCount: injectedTools, testCount: null });

      expect(report.rows.length).toBe(21);

      const toolFailures = report.rows.filter((r) => r.row.fact === 'tool-count');
      expect(toolFailures.length).toBe(13);
      for (const r of toolFailures) {
        expect(r.status).toBe('failed');
        expect(r.expected).toBe(injectedTools);
      }

      const skippedRows = report.rows.filter((r) => r.status === 'skipped');
      expect(skippedRows.length).toBe(8);
      expect(skippedRows.every((r) => r.row.fact === 'test-count')).toBe(true);

      expect(report.failed).toBe(13);
      expect(report.skipped).toBe(8);
    });

    it('contract 9: writeSites is two-phase — a failing read writes nothing, and a clean tree writes only the files whose value actually changed', () => {
      let writeCalls = 0;
      const countingWrite = (_file: string, _text: string) => {
        writeCalls += 1;
      };
      const rewordRow = DOC_SITES.find(
        (r) => r.file === 'README.md' && r.pattern.source.includes('real weather data')
      )!;
      const rewordedReadme = readRepoFile('README.md').replace(
        `real weather data — ${toolCount()} tools`,
        `solid weather data — ${toolCount()} tools`
      );
      const badRead = (file: string) => (file === 'README.md' ? rewordedReadme : readRepoFile(file));

      const phase1 = writeSites({ read: badRead, write: countingWrite, testCount: 1 });
      expect(writeCalls).toBe(0);
      expect(phase1.changed).toEqual([]);
      expect(phase1.failures.some((f) => f.row === rewordRow)).toBe(true);

      const files = [...new Set(DOC_SITES.map((r) => r.file))];
      const store = new Map(files.map((f) => [f, readRepoFile(f)]));
      const memRead = (file: string) => store.get(file)!;
      const memWrite = (file: string, text: string) => {
        store.set(file, text);
      };

      const testRow = DOC_SITES.find((r) => r.fact === 'test-count')!;
      const [beforeTestMatch] = siteMatches(store.get(testRow.file)!, testRow);
      const currentTestTotal = parseCount(beforeTestMatch.captured, testRow.format)!;

      const injectedTools = toolCount() + 5;
      const phase2 = writeSites({
        read: memRead,
        write: memWrite,
        toolCount: injectedTools,
        testCount: currentTestTotal,
      });

      expect(phase2.failures).toEqual([]);
      const toolFiles = new Set(DOC_SITES.filter((r) => r.fact === 'tool-count').map((r) => r.file));
      expect(new Set(phase2.changed)).toEqual(toolFiles);
      expect(new Set(phase2.unchanged)).toEqual(
        new Set(files.filter((f) => !toolFiles.has(f)))
      );

      for (const row of DOC_SITES.filter((r) => r.fact === 'tool-count')) {
        const [match] = siteMatches(store.get(row.file)!, row);
        expect(parseCount(match.captured, row.format)).toBe(injectedTools);
      }
      for (const row of DOC_SITES.filter((r) => r.fact === 'test-count')) {
        const [match] = siteMatches(store.get(row.file)!, row);
        expect(parseCount(match.captured, row.format)).toBe(currentTestTotal);
      }
    });

    it('contract 10: writeSites splices at the capture offsets, so a neighbouring $` / $& in the text survives untouched (GOTCHAS G35)', () => {
      // The fixture itself is built with a FUNCTION replacement — a string
      // replacement here would let JS interpret $` / $& in weirdSentence and
      // silently duplicate a slab of the file into the fixture (G35 applies to
      // this fixture, not only to production code).
      const weirdSentence = 'Note the literal tokens $` and $& sit right here.';
      const heading = `## Key Features (${toolCount()} MCP Tools)`;
      const realClaude = readRepoFile('CLAUDE.md');
      expect(realClaude.split(heading).length - 1).toBe(1);
      const claudeFixture = realClaude.replace(heading, () => `${weirdSentence}\n${heading}`);
      expect(claudeFixture).toContain(weirdSentence);
      expect(claudeFixture.length).toBe(realClaude.length + weirdSentence.length + 1);

      const files = [...new Set(DOC_SITES.map((r) => r.file))];
      const store = new Map(files.map((f) => [f, f === 'CLAUDE.md' ? claudeFixture : readRepoFile(f)]));
      const memRead = (file: string) => store.get(file)!;
      const memWrite = (file: string, text: string) => {
        store.set(file, text);
      };

      const testRow = DOC_SITES.find((r) => r.fact === 'test-count')!;
      const [beforeTestMatch] = siteMatches(readRepoFile(testRow.file), testRow);
      const currentTestTotal = parseCount(beforeTestMatch.captured, testRow.format)!;
      const injectedTools = toolCount() + 7;

      const result = writeSites({
        read: memRead,
        write: memWrite,
        toolCount: injectedTools,
        testCount: currentTestTotal,
      });

      expect(result.failures).toEqual([]);
      expect(result.changed).toContain('CLAUDE.md');

      const after = store.get('CLAUDE.md')!;
      expect(after.split(weirdSentence).length - 1).toBe(1);
      const claudeToolRow = DOC_SITES.find((r) => r.file === 'CLAUDE.md' && r.fact === 'tool-count')!;
      const [match] = siteMatches(after, claudeToolRow);
      expect(parseCount(match.captured, claudeToolRow.format)).toBe(injectedTools);
    });

    it('contract 11: checkSites returns all 21 row results, and writeSites over an all-stale fixture changes every one of the 11 files', () => {
      const report = checkSites({ testCount: null });
      expect(report.rows.length).toBe(21);

      const files = [...new Set(DOC_SITES.map((r) => r.file))];
      expect(files.length).toBe(11);
      const store = new Map(files.map((f) => [f, readRepoFile(f)]));
      const memRead = (file: string) => store.get(file)!;
      const memWrite = (file: string, text: string) => {
        store.set(file, text);
      };

      const testRow = DOC_SITES.find((r) => r.fact === 'test-count')!;
      const [beforeTestMatch] = siteMatches(readRepoFile(testRow.file), testRow);
      const currentTestTotal = parseCount(beforeTestMatch.captured, testRow.format)!;

      const injectedTools = toolCount() + 11;
      const injectedTests = currentTestTotal + 11;

      const result = writeSites({
        read: memRead,
        write: memWrite,
        toolCount: injectedTools,
        testCount: injectedTests,
      });

      expect(result.failures).toEqual([]);
      expect(new Set(result.changed)).toEqual(new Set(files));
      expect(result.changed.length).toBe(11);
    });
  });
});
