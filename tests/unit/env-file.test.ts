import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The entries read a `.env` only from the path `DOTENV_CONFIG_PATH` names
 * (src/config/envFile.ts). The working directory is never searched: the first
 * row puts a `.env` in the directory `process.cwd()` reports and expects
 * nothing from it.
 */

const SENTINEL = 'WEATHER_ENV_FILE_TEST_SENTINEL';

let dir: string;
let savedPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'weather-mcp-envfile-'));
  savedPath = process.env.DOTENV_CONFIG_PATH;
  delete process.env.DOTENV_CONFIG_PATH;
  delete process.env[SENTINEL];
  vi.resetModules();
});

afterEach(() => {
  if (savedPath === undefined) {
    delete process.env.DOTENV_CONFIG_PATH;
  } else {
    process.env.DOTENV_CONFIG_PATH = savedPath;
  }
  delete process.env[SENTINEL];
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('opt-in .env loading', () => {
  it('a .env in the working directory is not read', async () => {
    writeFileSync(join(dir, '.env'), `${SENTINEL}=from-cwd\n`);
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    await import('../../src/config/envFile.js');
    expect(process.env[SENTINEL]).toBeUndefined();
  });

  it('the file DOTENV_CONFIG_PATH names is read', async () => {
    const file = join(dir, 'custom.env');
    writeFileSync(file, `${SENTINEL}=from-path\n`);
    process.env.DOTENV_CONFIG_PATH = file;
    await import('../../src/config/envFile.js');
    expect(process.env[SENTINEL]).toBe('from-path');
  });

  it('a variable already set is not overridden', async () => {
    const file = join(dir, 'custom.env');
    writeFileSync(file, `${SENTINEL}=from-path\n`);
    process.env.DOTENV_CONFIG_PATH = file;
    process.env[SENTINEL] = 'from-launcher';
    await import('../../src/config/envFile.js');
    expect(process.env[SENTINEL]).toBe('from-launcher');
  });

  it('a path that names no file is not an error', async () => {
    process.env.DOTENV_CONFIG_PATH = join(dir, 'absent.env');
    await expect(import('../../src/config/envFile.js')).resolves.toBeDefined();
    expect(process.env[SENTINEL]).toBeUndefined();
  });

  it.each(['src/index.ts', 'src/http.ts'])('%s loads no implicit .env', (file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    expect(source).not.toContain('dotenv/config');
    expect(source).toContain("import './config/envFile.js';");
  });
});
