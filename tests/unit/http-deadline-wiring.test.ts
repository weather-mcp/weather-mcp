import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// Tripwire: every axios.create( call in src/ must pass the wall-clock deadline adapter.
// Deliberately outside the scan: src/handlers/weatherImageryHandler.ts:141 is a global
// axios.get with maxRedirects: 0, bounded by axios's native connect-phase timer and
// proven by tests/integration/imagery-transport-bounds.test.ts.

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
