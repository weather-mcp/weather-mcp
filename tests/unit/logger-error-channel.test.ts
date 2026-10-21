import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// Ratchet: `Logger.error(message, error?, metadata?)` copies error.message and error.stack into
// the log line, so the second argument is a privacy channel. Every `logger.error(` call in src/
// must pass `undefined` there (and route the error through describeErrorForLogging in the
// metadata), unless it is on the reviewed allowlist below. Source is read as text and never
// imported (src/index.ts runs main() on import, G61).

interface ErrorCall {
  file: string;
  line: number;
  firstArg: string;
  secondArg: string | undefined;
}

/** If `src[i]` starts a string, template or comment, the index just past it; otherwise undefined. */
function skipNonCode(src: string, i: number): number | undefined {
  const ch = src[i];
  const next = src[i + 1];
  if (ch === '/' && next === '/') {
    const eol = src.indexOf('\n', i);
    return eol === -1 ? src.length : eol;
  }
  if (ch === '/' && next === '*') {
    const end = src.indexOf('*/', i + 2);
    return end === -1 ? src.length : end + 2;
  }
  if (ch === "'" || ch === '"') {
    let j = i + 1;
    while (j < src.length && src[j] !== ch) {
      j += src[j] === '\\' ? 2 : 1;
    }
    return j + 1;
  }
  if (ch === '`') {
    let j = i + 1;
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') {
        j += 2;
      } else if (src[j] === '$' && src[j + 1] === '{') {
        j = skipTemplateExpression(src, j + 2);
      } else {
        j++;
      }
    }
    return j + 1;
  }
  return undefined;
}

/** From just after `${`, the index just past the matching `}`; nested strings and templates are skipped. */
function skipTemplateExpression(src: string, from: number): number {
  let depth = 1;
  let j = from;
  while (j < src.length) {
    const skipped = skipNonCode(src, j);
    if (skipped !== undefined) {
      j = skipped;
      continue;
    }
    if (src[j] === '{') {
      depth++;
    } else if (src[j] === '}') {
      depth--;
      if (depth === 0) {
        return j + 1;
      }
    }
    j++;
  }
  return j;
}

/** Top-level arguments of the call whose `(` is at `open`, trimmed. */
function splitArgs(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  let i = open + 1;
  while (i < src.length) {
    const skipped = skipNonCode(src, i);
    if (skipped !== undefined) {
      i = skipped;
      continue;
    }
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

const CALL_HEAD = /logger\.error\s*\(/y;

/** Every `logger.error(` call in code position (never inside a string or comment). */
function findErrorCalls(file: string, rawSource: string): ErrorCall[] {
  const src = rawSource.replace(/\r\n/g, '\n');
  const calls: ErrorCall[] = [];
  let i = 0;
  while (i < src.length) {
    const skipped = skipNonCode(src, i);
    if (skipped !== undefined) {
      i = skipped;
      continue;
    }
    if (src[i] === 'l' && !/[\w$.]/.test(src[i - 1] ?? '')) {
      CALL_HEAD.lastIndex = i;
      const head = CALL_HEAD.exec(src);
      if (head !== null) {
        const open = i + head[0].length - 1;
        const args = splitArgs(src, open);
        calls.push({
          file,
          line: src.slice(0, i).split('\n').length,
          firstArg: args[0] ?? '',
          secondArg: args[1],
        });
        i = open + 1;
        continue;
      }
    }
    i++;
  }
  return calls;
}

interface AllowEntry {
  file: string;
  message: string;
  reason: string;
  prefix?: boolean;
}

// Reviewed exceptions: the second argument is an Error whose message cannot carry user input.
const ALLOWLIST: AllowEntry[] = [
  {
    file: 'src/services/locationStore.ts',
    message: 'Failed to create storage directory',
    reason: 'Node fs error: names the syscall and path, never file content',
  },
  {
    file: 'src/services/locationStore.ts',
    message: 'Failed to read saved locations',
    reason: 'Node fs error: names the syscall and path, never file content',
  },
  {
    file: 'src/services/locationStore.ts',
    message: 'Failed to save locations',
    reason: 'Node fs error: names the syscall and path, never file content',
  },
  {
    file: 'src/index.ts',
    message: 'Failed to start server',
    reason: 'startup: no user input exists yet; the stack is the only diagnosis',
  },
  {
    file: 'src/index.ts',
    message: 'Fatal error in main()',
    reason: 'startup: no user input exists yet; the stack is the only diagnosis',
  },
  {
    file: 'src/analytics/transport.ts',
    message: 'Analytics endpoint must use HTTPS',
    reason: 'operator config: the message names the configured protocol',
  },
  {
    file: 'src/analytics/config.ts',
    message: 'Invalid ANALYTICS_ENDPOINT configuration: ',
    reason: 'operator config: the message names the configured protocol',
    prefix: true,
  },
];

function matchesEntry(call: ErrorCall, entry: AllowEntry): boolean {
  if (call.file !== entry.file) {
    return false;
  }
  if (entry.prefix === true) {
    return call.firstArg.startsWith(`\`${entry.message}`);
  }
  return call.firstArg === `'${entry.message}'` || call.firstArg === `"${entry.message}"`;
}

function isClean(call: ErrorCall): boolean {
  return call.secondArg === undefined || call.secondArg === 'undefined';
}

/** Every rule violation in `calls` against `allowlist`, one readable line each. */
function violations(calls: ErrorCall[], allowlist: AllowEntry[]): string[] {
  const problems: string[] = [];
  for (const call of calls) {
    if (isClean(call) || allowlist.some((entry) => matchesEntry(call, entry))) {
      continue;
    }
    problems.push(
      `${call.file}:${call.line} logger.error(${call.firstArg}, ${call.secondArg ?? ''}, ...) passes an Error as its second argument. ` +
        'Pass `undefined` and put describeErrorForLogging(error) in the metadata, or add an ALLOWLIST entry with a reason.'
    );
  }
  for (const entry of allowlist) {
    const hits = calls.filter((call) => !isClean(call) && matchesEntry(call, entry)).length;
    if (hits === 0) {
      problems.push(`stale allowlist entry (matches no call): ${entry.file} "${entry.message}"`);
    } else if (hits > 1) {
      problems.push(`ambiguous allowlist entry (matches ${hits} calls): ${entry.file} "${entry.message}"`);
    }
  }
  return problems;
}

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

describe('scanner', () => {
  const scan = (source: string): ErrorCall[] => findErrorCalls('src/x.ts', source);

  it('reads a single-line call with one argument', () => {
    const [call] = scan("logger.error('boom');");
    expect(call.firstArg).toBe("'boom'");
    expect(call.secondArg).toBeUndefined();
    expect(call.line).toBe(1);
  });

  it('reads a multi-line house-style call with the second argument on its own line', () => {
    const calls = scan("const a = 1;\nlogger.error(\n  'Failed',\n  error as Error,\n  {\n    path: p\n  }\n);");
    expect(calls).toHaveLength(1);
    expect(calls[0].line).toBe(2);
    expect(calls[0].firstArg).toBe("'Failed'");
    expect(calls[0].secondArg).toBe('error as Error');
  });

  it('is not fooled by ")" and "," inside the message string', () => {
    const [call] = scan("logger.error('failed (a, b)', err, { x: 1 });");
    expect(call.firstArg).toBe("'failed (a, b)'");
    expect(call.secondArg).toBe('err');
  });

  it('handles a template literal message with a nested call', () => {
    const [call] = scan('logger.error(`bad ${fn(a, b)} and ${`n${c(")")}`}`, err);');
    expect(call.firstArg).toBe('`bad ${fn(a, b)} and ${`n${c(")")}`}`');
    expect(call.secondArg).toBe('err');
  });

  it('reads an undefined second argument beside a metadata object with nested parens', () => {
    const [call] = scan("logger.error('x', undefined, { a: f(g(1, 2)), b: [1, 2] });");
    expect(call.secondArg).toBe('undefined');
    expect(violations([call], [])).toEqual([]);
  });

  it('ignores a call inside a line comment, a block comment or a string', () => {
    expect(scan("// logger.error('x', e)\n")).toEqual([]);
    expect(scan("/* logger.error('x', e) */")).toEqual([]);
    expect(scan('const s = "logger.error(\'x\', e)";')).toEqual([]);
    expect(scan('const s = `logger.error(\'x\', e)`;')).toEqual([]);
  });

  it('normalises CRLF', () => {
    const [call] = scan("a;\r\nlogger.error(\r\n  'x',\r\n  e\r\n);");
    expect(call.line).toBe(2);
    expect(call.secondArg).toBe('e');
  });

  it('flags an Error second argument and a stale or ambiguous allowlist entry', () => {
    const calls = scan("logger.error('x', e);\nlogger.error('y', undefined);");
    expect(violations(calls, [])).toHaveLength(1);
    const entry: AllowEntry = { file: 'src/x.ts', message: 'x', reason: 'r' };
    expect(violations(calls, [entry])).toEqual([]);
    expect(violations(calls, [entry, { ...entry, message: 'gone' }])[0]).toContain('stale');
    expect(violations([...calls, ...calls], [entry])[0]).toContain('ambiguous');
  });
});

describe('logger.error second-argument channel', () => {
  const srcRoot = new URL('../../src/', import.meta.url);
  const calls: ErrorCall[] = [];
  for (const file of listTs(srcRoot)) {
    const rel = `src/${file.href.slice(srcRoot.href.length)}`;
    calls.push(...findErrorCalls(rel, readFileSync(file, 'utf-8')));
  }

  it('no call passes an Error object except the reviewed allowlist, and every entry matches exactly one call', () => {
    expect(violations(calls, ALLOWLIST)).toEqual([]);
  });

  // The tokenizer does not model regex literals, so a quote inside one could swallow every
  // later call in that file and let it pass unseen. A line count outside comments is the
  // independent witness: the scanner must see every call a plain line match sees.
  it('non-vacuity: per file, the scanner sees every call a line match sees', () => {
    const lineMatch = /^(?!\s*(?:\/\/|\/\*|\*)).*\blogger\.error\s*\(/gm;
    for (const file of listTs(srcRoot)) {
      const rel = `src/${file.href.slice(srcRoot.href.length)}`;
      const expected = readFileSync(file, 'utf-8').replace(/\r\n/g, '\n').match(lineMatch)?.length ?? 0;
      expect(calls.filter((call) => call.file === rel).length, rel).toBe(expected);
    }
  });

  it('non-vacuity: the scanner finds calls in the four fixed services', () => {
    for (const file of [
      'src/services/nifc.ts',
      'src/services/rainviewer.ts',
      'src/services/openmeteo.ts',
      'src/services/locationStore.ts',
    ]) {
      expect(calls.filter((call) => call.file === file).length, file).toBeGreaterThanOrEqual(1);
    }
  });

  it('non-vacuity: each fixed message is found exactly once with an undefined second argument', () => {
    const fixed: Array<[string, string]> = [
      ['src/services/nifc.ts', 'NIFC query failed'],
      ['src/services/rainviewer.ts', 'RainViewer API request failed'],
      ['src/services/openmeteo.ts', 'Failed to compute climate normals table'],
      ['src/services/locationStore.ts', 'Failed to parse saved locations'],
    ];
    for (const [file, message] of fixed) {
      const hits = calls.filter((call) => call.file === file && call.firstArg === `'${message}'`);
      expect(hits, message).toHaveLength(1);
      expect(hits[0].secondArg, message).toBe('undefined');
    }
  });
});
