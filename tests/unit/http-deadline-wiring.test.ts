import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// Tripwire: every axios.create( call in src/ must pass the wall-clock deadline adapter, and
// every direct axios.<method>( call must pass a named config constant whose literal does.

const REQUIRED = 'adapter: withRequestDeadline()';
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

/** True when `name` is declared in `source` as an object literal that carries the adapter. */
function configHasDeadline(source: string, name: string): boolean {
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
        return source.slice(start, i + 1).includes(REQUIRED);
      }
    }
  }
  return false;
}

function hasDeadline(site: CreateSite): boolean {
  return site.text.includes(REQUIRED);
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

describe('http deadline wiring', () => {
  const srcRoot = new URL('../../src/', import.meta.url);
  const files = listTs(srcRoot);

  it('every axios.create call passes the deadline adapter', () => {
    const missing: string[] = [];
    let total = 0;
    for (const file of files) {
      const rel = `src/${file.href.slice(srcRoot.href.length)}`;
      for (const site of findCreateSites(readFileSync(file, 'utf-8'))) {
        total++;
        if (!hasDeadline(site)) {
          missing.push(`${rel}:${site.line}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // Non-vacuity: the scan found the sites the tree had when this was written.
    expect(total).toBeGreaterThanOrEqual(29);
  });

  it('every direct axios.<method> call passes a config constant that carries the deadline adapter', () => {
    const missing: string[] = [];
    let total = 0;
    for (const file of files) {
      const rel = `src/${file.href.slice(srcRoot.href.length)}`;
      const source = readFileSync(file, 'utf-8');
      for (const site of findDirectSites(source)) {
        total++;
        if (site.configName === undefined || !configHasDeadline(source, site.configName)) {
          missing.push(`${rel}:${site.line}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // Non-vacuity: the radar tile fetch in src/handlers/weatherImageryHandler.ts.
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('positive control: the direct-call predicate needs a named config with the key', () => {
    const decl = (body: string): string => `const CFG: AxiosRequestConfig = {\n  timeout: 1,\n${body}};\n`;
    const call = 'const r = await axios.get<ArrayBuffer>(url, CFG);';
    const withKey = decl(`  ${REQUIRED}\n`) + call;
    const without = decl('') + call;
    const inline = `const r = await axios.get(url, { ${REQUIRED} });`;

    const [site] = findDirectSites(withKey);
    expect(site.configName).toBe('CFG');
    expect(configHasDeadline(withKey, 'CFG')).toBe(true);
    expect(configHasDeadline(without, 'CFG')).toBe(false);
    expect(findDirectSites(inline)[0].configName).toBeUndefined();
  });

  it('positive control: the predicate rejects a literal without the key and accepts one with it', () => {
    const without = findCreateSites(`const c = axios.create({\n  baseURL: 'x',\n  headers: { a: 'b' }\n});`);
    const withKey = findCreateSites(
      `const c = axios.create({\n  baseURL: 'x',\n  headers: { a: 'b' },\n  ${REQUIRED},\n});`
    );
    expect(without).toHaveLength(1);
    expect(withKey).toHaveLength(1);
    expect(hasDeadline(without[0])).toBe(false);
    expect(hasDeadline(withKey[0])).toBe(true);
  });
});
