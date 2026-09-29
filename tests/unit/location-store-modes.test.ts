/**
 * Unit tests for the file modes LocationStore gives new saved-location files.
 *
 *   - A directory the store creates is 0700; a file it creates is 0600.
 *   - An existing file or directory is NEVER migrated: its mode is carried over.
 *   - The temp file is created 0600, and the carried mode is applied only when
 *     the target already existed.
 *
 * The process umask is pinned to 022 so the assertions cannot pass vacuously on a
 * machine whose umask is already 077. Every store here sits on a `mkdtempSync` path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocationStore } from '../../src/services/locationStore.js';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  chmodSync,
  openSync,
  fchmodSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Mock the bare `'fs'` specifier the store imports (G70): a mock on `'node:fs'`
 * would be inert. Spies pass through to the real implementation.
 */
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    statSync: vi.fn(actual.statSync),
    openSync: vi.fn(actual.openSync),
    fchmodSync: vi.fn(actual.fchmodSync)
  };
});

const actualFs = await vi.importActual<typeof import('fs')>('fs');

function resetFsSpies(): void {
  vi.mocked(statSync).mockReset().mockImplementation(actualFs.statSync);
  vi.mocked(openSync).mockReset().mockImplementation(actualFs.openSync);
  vi.mocked(fchmodSync).mockReset().mockImplementation(actualFs.fchmodSync);
}

const POSIX_ONLY = process.platform === 'win32';

const SEATTLE = {
  name: 'Seattle, WA',
  latitude: 47.6062,
  longitude: -122.3321
};

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('LocationStore file modes', () => {
  let tempDir: string;
  let prevUmask: number;

  beforeEach(() => {
    resetFsSpies();
    prevUmask = process.umask(0o022);
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-modes-'));
  });

  afterEach(() => {
    process.umask(prevUmask);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /** Store path whose directory does not exist yet. */
  function freshStorePath(): string {
    return join(tempDir, 'home', '.weather-mcp', 'locations.json');
  }

  it.skipIf(POSIX_ONLY)('creates a fresh storage directory 0700', () => {
    const storePath = freshStorePath();
    new LocationStore(storePath).set('home', SEATTLE);
    expect(modeOf(join(tempDir, 'home', '.weather-mcp'))).toBe(0o700);
  });

  it.skipIf(POSIX_ONLY)('creates a fresh store file 0600', () => {
    const storePath = freshStorePath();
    new LocationStore(storePath).set('home', SEATTLE);
    expect(modeOf(storePath)).toBe(0o600);
  });

  it.skipIf(POSIX_ONLY)('does not migrate: an existing 0644 file stays 0644 after a set', () => {
    const storePath = join(tempDir, 'locations.json');
    writeFileSync(storePath, '{}');
    chmodSync(storePath, 0o644);

    new LocationStore(storePath).set('home', SEATTLE);

    expect(modeOf(storePath)).toBe(0o644);
  });

  it.skipIf(POSIX_ONLY)('does not migrate: an existing 0755 directory stays 0755 across a first set', () => {
    const dir = join(tempDir, 'existing');
    mkdirSync(dir);
    chmodSync(dir, 0o755);

    new LocationStore(join(dir, 'locations.json')).set('home', SEATTLE);

    expect(modeOf(dir)).toBe(0o755);
  });

  it.skipIf(POSIX_ONLY)('creates the target of a dangling symlink 0600', () => {
    const targetDir = join(tempDir, 'synced');
    mkdirSync(targetDir);
    const target = join(targetDir, 'real.json');
    const link = join(tempDir, 'locations.json');
    symlinkSync(target, link);

    new LocationStore(link).set('home', SEATTLE);

    expect(modeOf(target)).toBe(0o600);
  });

  it.skipIf(POSIX_ONLY)('keeps 0644 on the existing target of a symlinked store', () => {
    const target = join(tempDir, 'real.json');
    writeFileSync(target, '{}');
    chmodSync(target, 0o644);
    const link = join(tempDir, 'locations.json');
    symlinkSync(target, link);

    new LocationStore(link).set('home', SEATTLE);

    expect(modeOf(target)).toBe(0o644);
  });

  it.skipIf(POSIX_ONLY)('opens the temp 0600 and skips fchmod when no target existed', () => {
    const storePath = freshStorePath();
    new LocationStore(storePath).set('home', SEATTLE);

    const tmpCalls = vi.mocked(openSync).mock.calls.filter(
      ([p]) => typeof p === 'string' && /\.tmp$/.test(p)
    );
    expect(tmpCalls).toHaveLength(1);
    expect(tmpCalls[0][1]).toBe('wx');
    expect(tmpCalls[0][2]).toBe(0o600);
    expect(fchmodSync).not.toHaveBeenCalled();
  });

  it.skipIf(POSIX_ONLY)('opens the temp 0600 and fchmods to the carried mode when a target existed', () => {
    const storePath = join(tempDir, 'locations.json');
    writeFileSync(storePath, '{}');
    chmodSync(storePath, 0o644);

    new LocationStore(storePath).set('home', SEATTLE);

    const tmpCalls = vi.mocked(openSync).mock.calls.filter(
      ([p]) => typeof p === 'string' && /\.tmp$/.test(p)
    );
    expect(tmpCalls).toHaveLength(1);
    expect(tmpCalls[0][1]).toBe('wx');
    expect(tmpCalls[0][2]).toBe(0o600);
    expect(fchmodSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fchmodSync).mock.calls[0][1]).toBe(0o644);
  });

  it.skipIf(POSIX_ONLY)('refuses to save, and leaves the file alone, when the existing file cannot be stat-ed', () => {
    const storePath = join(tempDir, 'locations.json');
    writeFileSync(storePath, '{}');
    chmodSync(storePath, 0o644);

    // Only the store's own stat of the target fails, with something other than ENOENT.
    vi.mocked(statSync).mockImplementation(((path: Parameters<typeof statSync>[0], ...rest: unknown[]) => {
      if (path === storePath) {
        throw Object.assign(new Error('EIO: i/o error, stat'), { code: 'EIO' });
      }
      return (actualFs.statSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof statSync);

    expect(() => new LocationStore(storePath).set('home', SEATTLE)).toThrow(
      /Failed to save locations/
    );

    vi.mocked(statSync).mockImplementation(actualFs.statSync);
    expect(readFileSync(storePath, 'utf-8')).toBe('{}');
    expect(modeOf(storePath)).toBe(0o644);
    expect(readdirSync(tempDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(openSync).not.toHaveBeenCalled();
  });
});
