import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Enforces the CLAUDE.md convention that every cache TTL is a `CacheConfig.ttl` entry: a
 * `<something>Cache.set(key, value, ttl)` call in `src/` must not pass a numeric literal, a
 * literal-only expression, or `Infinity` as its TTL. Scans by call (parenthesis-matched, arguments
 * split at top level), so a call spread over nine lines is seen like a one-liner.
 *
 * One reviewed exception: `fetchSearch` in `src/services/nominatim.ts`, reached only from
 * `searchLocation`. ROADMAP row 105 deletes it and must delete the allowlist entry too (a stale
 * entry fails this test).
 *
 * Known limit: a literal passed to a `pull(cacheKey, ttlMs, ...)` wrapper (`environmentAgency.ts`,
 * `jma.ts`) is not seen, because the wrapper is not a `.cache.set(` call. Today every caller passes
 * `CacheConfig.ttl.*`.
 *
 * The scan runs on `codeOnly` text (comments removed, string contents blanked), so a commented-out
 * literal never fires. The allowlist compares against that same stripped text: the allowlisted TTL
 * is a pure numeric expression and contains no string, so stripping cannot change it.
 */

function listTs(dir: URL): URL[] {
  const found: URL[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...listTs(new URL(`${entry.name}/`, dir)));
    } else if (entry.name.endsWith('.ts')) {
      found.push(new URL(entry.name, dir));
    }
  }
  return found;
}

/**
 * The span with comments removed and string contents blanked (copied from http-bounds-wiring.test.ts;
 * a block comment keeps its newlines here so reported line numbers stay true).
 */
function codeOnly(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? text.length : close + 2;
      out += ' ' + text.slice(i, end).replace(/[^\n]/g, '');
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ch;
      i++;
      while (i < text.length && text[i] !== ch) {
        i += text[i] === '\\' ? 2 : 1;
      }
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Top-level arguments of the call whose `(` is at `open`, trimmed. Input is already codeOnly. */
function splitArgs(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  let i = open + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) {
        break;
      }
      depth--;
    } else if (ch === ',' && depth === 0) {
      args.push(src.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  const last = src.slice(start, i).trim();
  if (last !== '') {
    args.push(last);
  }
  return args;
}

interface CacheWrite {
  file: string;
  line: number;
  args: string[];
}

// `cache.set(` and `cache?.set(` both count; a write spelled any other way is out of scope.
const CALL_HEAD = /\b(?:this\.)?\w*[cC]ache\??\.set\s*\(/g;

function findCacheWrites(file: string, rawSource: string): CacheWrite[] {
  const src = codeOnly(rawSource.replace(/\r\n/g, '\n'));
  const writes: CacheWrite[] = [];
  for (const head of src.matchAll(CALL_HEAD)) {
    const open = head.index + head[0].length - 1;
    writes.push({
      file,
      line: src.slice(0, head.index).split('\n').length,
      args: splitArgs(src, open),
    });
  }
  return writes;
}

const LITERAL_ONLY = /^[\d_\s+\-*/().]+$/;

/** The third argument is `Infinity` or arithmetic on numeric literals only. */
function isHardcodedTtl(ttl: string): boolean {
  return (
    ttl === 'Infinity' ||
    ttl === 'Number.POSITIVE_INFINITY' ||
    (LITERAL_ONLY.test(ttl) && /\d/.test(ttl))
  );
}

interface AllowEntry {
  file: string;
  ttl: string;
  reason: string;
}

// Reviewed exceptions: a literal TTL that is not (yet) a CacheConfig entry.
const ALLOWLIST: AllowEntry[] = [
  {
    file: 'src/services/nominatim.ts',
    ttl: '30 * 24 * 60 * 60 * 1000',
    reason:
      'fetchSearch, reached only from searchLocation; ROADMAP row 105 deletes it and must delete this entry',
  },
];

/** Every rule violation in `writes` against `allowlist`, one readable line each. */
function violations(writes: CacheWrite[], allowlist: AllowEntry[]): string[] {
  const problems: string[] = [];
  for (const w of writes) {
    if (w.args.length < 2) {
      problems.push(`${w.file}:${w.line} cache write with ${w.args.length} argument(s): unparseable`);
      continue;
    }
    if (w.args.length === 2) {
      continue; // a Map.set (src/utils/cache.ts), not a TTL write
    }
    const ttl = w.args[2] ?? '';
    if (!isHardcodedTtl(ttl)) {
      continue;
    }
    if (allowlist.some((e) => e.file === w.file && e.ttl === ttl)) {
      continue;
    }
    problems.push(
      `${w.file}:${w.line} cache write passes a hardcoded TTL (${ttl}). ` +
        'Add a CacheConfig.ttl entry and use it, or add an ALLOWLIST entry with a reason.'
    );
  }
  for (const e of allowlist) {
    const hits = writes.filter((w) => w.file === e.file && w.args[2] === e.ttl).length;
    if (hits === 0) {
      problems.push(`stale allowlist entry: ${e.file} ttl ${e.ttl} matches no cache write`);
    } else if (hits > 1) {
      problems.push(`ambiguous allowlist entry: ${e.file} ttl ${e.ttl} matches ${hits} cache writes`);
    }
  }
  return problems;
}

/**
 * A class member declaration at two-space indent: `  async getForecast(`, `  private foo<T>(`.
 * The nearest one above a write names the method that write belongs to.
 */
const MEMBER_DECL = /^ {2}(?:(?:private|public|protected|static)\s+)*(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\(/;

function enclosingMember(rawSource: string, line: number): string | undefined {
  const lines = rawSource.replace(/\r\n/g, '\n').split('\n').slice(0, line);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = MEMBER_DECL.exec(lines[i] ?? '');
    if (m) return m[1];
  }
  return undefined;
}

/**
 * The five writes named-cache-ttls rewired, each pinned to its own entry. Two entries can hold
 * the same number (`firePerimeters` and `firmsAreaQuery`, `airQuality` and `marine`), so a value
 * pin cannot see one swapped for the other; this can.
 */
const PINNED_TTLS: { file: string; member: string; ttl: string }[] = [
  { file: 'src/services/nifc.ts', member: 'queryFirePerimeters', ttl: 'CacheConfig.ttl.firePerimeters' },
  { file: 'src/services/openmeteo.ts', member: 'getForecast', ttl: 'CacheConfig.ttl.forecast' },
  { file: 'src/services/openmeteo.ts', member: 'getAirQuality', ttl: 'CacheConfig.ttl.airQuality' },
  { file: 'src/services/openmeteo.ts', member: 'getMarine', ttl: 'CacheConfig.ttl.marine' },
  { file: 'src/services/ncei.ts', member: 'getClimateNormals', ttl: 'CacheConfig.ttl.normals' },
];

const SRC = new URL('../../src/', import.meta.url);
const sources = listTs(SRC).map((url) => ({
  file: `src/${url.href.slice(SRC.href.length)}`,
  text: readFileSync(url, 'utf8'),
}));
const allWrites = sources.flatMap((s) => findCacheWrites(s.file, s.text));

describe('cache TTL wiring', () => {
  it('finds the cache writes (the scan is not vacuous)', () => {
    // Real count is recorded in the task report. The floor sits below it on purpose, so ROADMAP
    // row 105 deleting one site does not trip it.
    expect(allWrites.length).toBeGreaterThanOrEqual(40);
  });

  it('agrees with an independent line count in every file (no scanner blind spot)', () => {
    // A regex literal such as /'/ can make a string-aware scanner swallow later calls (G121).
    const head = /\b(?:this\.)?\w*[cC]ache\??\.set\s*\(/;
    const mismatches: string[] = [];
    for (const s of sources) {
      const scanned = allWrites.filter((w) => w.file === s.file).length;
      const lines = s.text
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && head.test(l)).length;
      if (scanned !== lines) {
        mismatches.push(`${s.file}: scanner ${scanned}, line match ${lines}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('has no hardcoded TTL at a cache write outside the allowlist', () => {
    expect(violations(allWrites, ALLOWLIST)).toEqual([]);
  });

  it('classifies synthetic writes correctly', () => {
    const w = (ttl: string): CacheWrite[] => [
      { file: 'src/x.ts', line: 1, args: ['k', 'v', ttl] },
    ];
    expect(violations(w('1800000'), [])).toHaveLength(1);
    expect(violations(w('Infinity'), [])).toHaveLength(1);
    expect(violations(w('Number.POSITIVE_INFINITY'), [])).toHaveLength(1);
    expect(violations(w('24 * 60 * 1_000'), [])).toHaveLength(1);
    expect(violations(w('CacheConfig.ttl.alerts'), [])).toEqual([]);
    expect(violations(w('ttl'), [])).toEqual([]);
    expect(violations([{ file: 'src/x.ts', line: 1, args: ['k', 'v'] }], [])).toEqual([]);
    expect(violations([{ file: 'src/x.ts', line: 1, args: ['k'] }], [])).toHaveLength(1);
  });

  it('reports a stale and an ambiguous allowlist entry', () => {
    const entry: AllowEntry = { file: 'src/x.ts', ttl: '1000', reason: 'test' };
    expect(violations([], [entry]).join()).toContain('stale allowlist entry');
    const two: CacheWrite[] = [
      { file: 'src/x.ts', line: 1, args: ['k', 'v', '1000'] },
      { file: 'src/x.ts', line: 9, args: ['k', 'v', '1000'] },
    ];
    expect(violations(two, [entry]).join()).toContain('ambiguous allowlist entry');
  });

  it('each rewired write reads its own named entry, not a same-valued sibling', () => {
    const problems: string[] = [];
    for (const pin of PINNED_TTLS) {
      const text = sources.find((s) => s.file === pin.file)?.text ?? '';
      const ttls = allWrites
        .filter((w) => w.file === pin.file && w.args.length >= 3)
        .filter((w) => enclosingMember(text, w.line) === pin.member)
        .map((w) => w.args[2]);
      if (ttls.length !== 1 || ttls[0] !== pin.ttl) {
        problems.push(`${pin.file} ${pin.member}: expected one write with ${pin.ttl}, found [${ttls.join(', ')}]`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('sees an optional-chained write', () => {
    const found = findCacheWrites('src/x.ts', 'this.cache?.set(k, v, 1800000);');
    expect(found).toHaveLength(1);
    expect(violations(found, [])).toHaveLength(1);
  });

  it('does not match in-flight maps and sees multi-line calls', () => {
    const src = [
      'inFlight.set(a, b, 5);',
      'this.searchInFlight.set(a, b, 5);',
      'this.cache.set(',
      '  a,',
      '  b,',
      '  1000',
      ');',
    ].join('\n');
    const found = findCacheWrites('src/x.ts', src);
    expect(found).toHaveLength(1);
    expect(found[0]?.args[2]).toBe('1000');
  });
});
