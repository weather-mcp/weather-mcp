import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Tripwire: every axios.create( call in src/ must pass `maxRedirects: 0` and a `maxContentLength:`,
// and every direct axios.<method>( call must pass a named config constant whose literal does.
//
// The scanners (findCreateSites, findDirectSites, listTs and the brace-matched config-literal scan)
// are copied from tests/unit/http-deadline-wiring.test.ts, which is a lock and is not edited.

const MARKER = 'axios.create(';

interface CreateSite {
  line: number;
  text: string;
}

/** Every axios.create( call in `source`, from the marker to its matching close paren. */
function findCreateSites(source: string): CreateSite[] {
  const sites: CreateSite[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(MARKER, from);
    if (start === -1) {
      break;
    }
    let depth = 0;
    let end = source.length;
    for (let i = start + MARKER.length - 1; i < source.length; i++) {
      const ch = source[i];
      if (ch === '(' || ch === '{') {
        depth++;
      } else if (ch === ')' || ch === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    sites.push({ line: source.slice(0, start).split('\n').length, text: source.slice(start, end) });
    from = start + MARKER.length;
  }
  return sites;
}

/** Direct calls on the default instance: `axios.get(url, CONFIG)` and its siblings. */
const DIRECT_CALL = /\baxios\.(get|post|put|patch|delete|head|options|request)\s*(?:<[^>(]*>)?\(/g;

interface DirectSite {
  line: number;
  /** The last argument, when it is a bare identifier; otherwise undefined. */
  configName: string | undefined;
}

/** Every direct axios.<method>( call in `source`, with the identifier it passes as config. */
function findDirectSites(source: string): DirectSite[] {
  const sites: DirectSite[] = [];
  for (const match of source.matchAll(DIRECT_CALL)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    let end = source.length;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (ch === '(' || ch === '{' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const args = source.slice(open + 1, end);
    const last = /,\s*([A-Za-z_$][\w$]*)\s*,?\s*$/.exec(args);
    sites.push({ line: source.slice(0, match.index).split('\n').length, configName: last?.[1] });
  }
  return sites;
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

/** `maxRedirects: 0` as literal text only: not a constant, not `5`, not `01` or `0x`. */
const REDIRECTS_OFF = /\bmaxRedirects: 0(?![\w.])/;
const SIZE_CAP = /\bmaxContentLength:/;

/**
 * The span with comments removed and string contents blanked, so a key that is commented out, or
 * that appears only inside a string, never counts as set (diff review codex-C1). Quotes are kept, so
 * a `//` inside a URL string is not mistaken for a comment.
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
      i = close === -1 ? text.length : close + 2;
      out += ' ';
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

function literalHasBounds(text: string): boolean {
  const code = codeOnly(text);
  return REDIRECTS_OFF.test(code) && SIZE_CAP.test(code);
}

/** True when `name` is declared in `source` as an object literal that carries both bounds. */
function configHasBounds(source: string, name: string): boolean {
  const decl = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*\\{`).exec(source);
  if (decl === null) {
    return false;
  }
  const start = decl.index + decl[0].length - 1;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return literalHasBounds(source.slice(start, i + 1));
      }
    }
  }
  return false;
}

function hasBounds(site: CreateSite): boolean {
  return literalHasBounds(site.text);
}

/** The scanned root: HTTP_BOUNDS_SOURCE_ROOT (a directory) when set, else this repo's src/. */
function scanRoot(): URL {
  const override = process.env.HTTP_BOUNDS_SOURCE_ROOT;
  if (override !== undefined && override !== '') {
    const href = pathToFileURL(override).href;
    return new URL(href.endsWith('/') ? href : `${href}/`);
  }
  return new URL('../../src/', import.meta.url);
}

describe('http bounds wiring', () => {
  const srcRoot = scanRoot();
  const files = listTs(srcRoot);

  it('every axios.create call passes maxRedirects: 0 and maxContentLength', () => {
    const missing: string[] = [];
    let total = 0;
    for (const file of files) {
      const rel = `src/${file.href.slice(srcRoot.href.length)}`;
      for (const site of findCreateSites(readFileSync(file, 'utf-8'))) {
        total++;
        if (!hasBounds(site)) {
          missing.push(`${rel}:${site.line}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // Non-vacuity: the scan found the sites the tree had when this was written.
    expect(total).toBeGreaterThanOrEqual(27);
  });

  it('every direct axios.<method> call passes a config constant that carries both bounds', () => {
    const missing: string[] = [];
    let total = 0;
    for (const file of files) {
      const rel = `src/${file.href.slice(srcRoot.href.length)}`;
      const source = readFileSync(file, 'utf-8');
      for (const site of findDirectSites(source)) {
        total++;
        if (site.configName === undefined || !configHasBounds(source, site.configName)) {
          missing.push(`${rel}:${site.line}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // Non-vacuity: the radar tile fetch in src/handlers/weatherImageryHandler.ts.
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('positive control: the create predicate needs both keys, and only maxRedirects: 0', () => {
    const make = (keys: string): CreateSite[] =>
      findCreateSites(`const c = axios.create({\n  baseURL: 'x',\n${keys}});`);
    const neither = make('');
    const onlyRedirects = make('  maxRedirects: 0,\n');
    const onlySize = make('  maxContentLength: 1024,\n');
    const both = make('  maxRedirects: 0,\n  maxContentLength: 1024,\n');
    const five = make('  maxRedirects: 5,\n  maxContentLength: 1024,\n');
    const octalish = make('  maxRedirects: 01,\n  maxContentLength: 1024,\n');
    const hex = make('  maxRedirects: 0x0,\n  maxContentLength: 1024,\n');
    expect(hasBounds(neither[0])).toBe(false);
    expect(hasBounds(onlyRedirects[0])).toBe(false);
    expect(hasBounds(onlySize[0])).toBe(false);
    expect(hasBounds(both[0])).toBe(true);
    expect(hasBounds(five[0])).toBe(false);
    expect(hasBounds(octalish[0])).toBe(false);
    expect(hasBounds(hex[0])).toBe(false);
  });

  it('positive control: a key that is commented out or only inside a string does not count (codex-C1)', () => {
    const make = (keys: string): CreateSite[] =>
      findCreateSites(`const c = axios.create({\n  baseURL: 'https://x.example//path',\n${keys}});`);
    const lineComment = make('  // maxRedirects: 0,\n  maxContentLength: 1024,\n');
    const blockComment = make('  maxRedirects: 0,\n  /* maxContentLength: 1024, */\n');
    const inString = make("  note: 'maxRedirects: 0',\n  maxContentLength: 1024,\n");
    const realWithUrl = make('  maxRedirects: 0,\n  maxContentLength: 1024, // design sweep\n');
    expect(hasBounds(lineComment[0])).toBe(false);
    expect(hasBounds(blockComment[0])).toBe(false);
    expect(hasBounds(inString[0])).toBe(false);
    expect(hasBounds(realWithUrl[0])).toBe(true);
    expect(configHasBounds("const CFG = {\n  // maxRedirects: 0,\n  maxContentLength: 1,\n};", 'CFG')).toBe(false);
  });

  it('positive control: the direct-call predicate needs a named config with both keys', () => {
    const decl = (body: string): string => `const CFG: AxiosRequestConfig = {\n  timeout: 1,\n${body}};\n`;
    const call = 'const r = await axios.get<ArrayBuffer>(url, CFG);';
    const both = decl('  maxRedirects: 0,\n  maxContentLength: 1024,\n') + call;
    const neither = decl('') + call;
    const onlyRedirects = decl('  maxRedirects: 0,\n') + call;
    const onlySize = decl('  maxContentLength: 1024,\n') + call;
    const inline = 'const r = await axios.get(url, { maxRedirects: 0, maxContentLength: 1 });';

    expect(findDirectSites(both)[0].configName).toBe('CFG');
    expect(configHasBounds(both, 'CFG')).toBe(true);
    expect(configHasBounds(neither, 'CFG')).toBe(false);
    expect(configHasBounds(onlyRedirects, 'CFG')).toBe(false);
    expect(configHasBounds(onlySize, 'CFG')).toBe(false);
    expect(findDirectSites(inline)[0].configName).toBeUndefined();
  });
});
