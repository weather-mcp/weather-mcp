import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Source-text checks: importing an entry would run main() (G61).
const root = resolve(__dirname, '../..');
const lines = (text: string): string[] => text.split(/\r?\n/);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('entry .env loading', () => {
  for (const entry of ['src/index.ts', 'src/http.ts']) {
    describe(entry, () => {
      const text = readFileSync(join(root, entry), 'utf8');
      it('imports the explicit-path loader first', () => {
        const first = lines(text).find((l) => /^import /.test(l));
        expect(first).toBe("import './config/envFile.js';");
      });
      it('does not use dotenv/config', () => {
        expect(text).not.toContain('dotenv/config');
      });
    });
  }

  it('only src/config/envFile.ts imports dotenv', () => {
    const files = walk(join(root, 'src'));
    expect(files.length).toBeGreaterThanOrEqual(100); // non-vacuity floor (G165)
    const offenders = files
      .filter((f) => {
        const t = readFileSync(f, 'utf8');
        return t.includes("from 'dotenv'") || t.includes("'dotenv/config'");
      })
      .map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual(['src/config/envFile.ts']);
  });
});
