/**
 * Unit tests for LocationStore durability.
 *
 * Covers the design plan's contracts 1-4:
 *   1. Interleave        — two instances on one file see each other's writes.
 *   2. Unreadable refused — every read and write throws, and the file is untouched.
 *   3. Heals              — a repair takes effect with no restart.
 *   4. ENOENT is empty    — a missing file is an empty store, and the first set creates it.
 *
 *   5. Failed write changes nothing — target bytes intact, no temp residue, no phantom.
 *   6. Replace preserves the entry's nature — mode and symlink survive the rename.
 *  10. A short write never publishes — the buffer is written whole before fsync/rename.
 *
 * Every store here is constructed on a `mkdtempSync` path. The no-argument
 * constructor resolves to the real home directory, which live server instances share.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LocationStore,
  LocationStoreUnreadableError
} from '../../src/services/locationStore.js';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  statSync,
  lstatSync,
  symlinkSync,
  chmodSync,
  renameSync,
  fsyncSync,
  writeSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Mock the **bare `'fs'` specifier** — the one `src/services/locationStore.ts`
 * imports. A mock applied to `'node:fs'` here would be inert and every test below
 * would silently exercise the real filesystem while passing (G70). The happy-path
 * seam test asserts all three spies were called, so a divergence between the
 * store's specifier and this one goes red here instead of disappearing.
 *
 * Everything passes through to the real implementation by default; individual
 * tests override one call.
 */
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    fsyncSync: vi.fn(actual.fsyncSync),
    writeSync: vi.fn(actual.writeSync)
  };
});

const actualFs = await vi.importActual<typeof import('fs')>('fs');

/** Restore every spy to its pass-through implementation. */
function resetFsSpies(): void {
  vi.mocked(renameSync).mockReset().mockImplementation(actualFs.renameSync);
  vi.mocked(fsyncSync).mockReset().mockImplementation(actualFs.fsyncSync);
  vi.mocked(writeSync).mockReset().mockImplementation(
    actualFs.writeSync as typeof writeSync
  );
}

const POSIX_ONLY = process.platform === 'win32';

/** A valid location payload — coordinates are validated before the store is read. */
const SEATTLE = {
  name: 'Seattle, WA',
  latitude: 47.6062,
  longitude: -122.3321
};

const PORTLAND = {
  name: 'Portland, OR',
  latitude: 45.5152,
  longitude: -122.6784
};

describe('LocationStore durability', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(() => {
    resetFsSpies();
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-store-'));
    storePath = join(tempDir, 'locations.json');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ---------------------------------------------------------------------------
  // Contract 1 — two instances on one file see each other's writes
  // ---------------------------------------------------------------------------

  describe('contract 1: interleaved instances', () => {
    it("shows one instance's save to another, and does not delete it on the next write", () => {
      const a = new LocationStore(storePath);
      const b = new LocationStore(storePath);

      // Both instances load first — this is what a stale cache would freeze.
      expect(a.count()).toBe(0);
      expect(b.count()).toBe(0);

      a.set('home', SEATTLE);

      // B loaded before A's write and must still see it.
      expect(b.has('home')).toBe(true);

      b.set('work', PORTLAND);

      // B's write must not have deleted A's entry.
      const onDisk = JSON.parse(readFileSync(storePath, 'utf-8'));
      expect(Object.keys(onDisk).sort()).toEqual(['home', 'work']);
      expect(a.has('work')).toBe(true);
      expect(a.count()).toBe(2);
    });

    it('returns a fresh object from every load, so a mutation of one result cannot leak', () => {
      const store = new LocationStore(storePath);
      store.set('home', SEATTLE);

      const first = store.getAll();
      const second = store.getAll();

      expect(first).not.toBe(second);

      delete first['home'];
      expect(store.has('home')).toBe(true);
      expect(Object.keys(store.getAll())).toEqual(['home']);
    });
  });

  // ---------------------------------------------------------------------------
  // Contract 2 — an unreadable file is refused by every operation, and untouched
  // ---------------------------------------------------------------------------

  describe('contract 2: an unreadable file is refused, never replaced', () => {
    /**
     * Each case makes the store path unreadable in a different way, then asserts
     * that every public method throws and that nothing on disk moved.
     */
    const cases: { name: string; make: () => void; isDirectory?: boolean }[] = [
      {
        name: 'truncated JSON',
        make: () => writeFileSync(storePath, '{"home": {"name": "Seattle", "lat', 'utf-8')
      },
      {
        name: 'a top-level array',
        make: () => writeFileSync(storePath, '[{"name": "Seattle"}]', 'utf-8')
      },
      {
        name: 'a zero-byte file',
        make: () => writeFileSync(storePath, '', 'utf-8')
      },
      {
        name: 'the store path is a directory (EISDIR)',
        make: () => mkdirSync(storePath),
        isDirectory: true
      }
    ];

    for (const testCase of cases) {
      describe(testCase.name, () => {
        beforeEach(() => {
          testCase.make();
        });

        it('throws LocationStoreUnreadableError from every read and every write', () => {
          const store = new LocationStore(storePath);

          expect(() => store.get('home')).toThrow(LocationStoreUnreadableError);
          expect(() => store.getAll()).toThrow(LocationStoreUnreadableError);
          expect(() => store.has('home')).toThrow(LocationStoreUnreadableError);
          expect(() => store.count()).toThrow(LocationStoreUnreadableError);
          expect(() => store.set('home', SEATTLE)).toThrow(LocationStoreUnreadableError);
          expect(() => store.remove('home')).toThrow(LocationStoreUnreadableError);
          expect(() => store.clear()).toThrow(LocationStoreUnreadableError);
        });

        it('leaves the file exactly as it was and creates no sibling', () => {
          const before = testCase.isDirectory ? null : readFileSync(storePath);
          const dirBefore = readdirSync(tempDir).sort();

          const store = new LocationStore(storePath);
          for (const call of [
            () => store.get('home'),
            () => store.getAll(),
            () => store.has('home'),
            () => store.count(),
            () => store.set('home', SEATTLE),
            () => store.remove('home'),
            () => store.clear()
          ]) {
            expect(call).toThrow(LocationStoreUnreadableError);
          }

          if (testCase.isDirectory) {
            expect(statSync(storePath).isDirectory()).toBe(true);
          } else {
            const after = readFileSync(storePath);
            expect(after.equals(before as Buffer)).toBe(true);
          }

          // No quarantine copy, no temp residue, nothing renamed.
          expect(readdirSync(tempDir).sort()).toEqual(dirBefore);
        });

        it('names the path and says the file was not modified', () => {
          const store = new LocationStore(storePath);

          let thrown: unknown;
          try {
            store.count();
          } catch (error) {
            thrown = error;
          }

          expect(thrown).toBeInstanceOf(LocationStoreUnreadableError);
          const err = thrown as LocationStoreUnreadableError;
          expect(err.name).toBe('LocationStoreUnreadableError');
          expect(err.storePath).toBe(storePath);
          expect(err.message).toContain(storePath);
          expect(err.message).toContain('The file was not modified.');
        });
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Contract 3 — a repair takes effect with no restart
  // ---------------------------------------------------------------------------

  describe('contract 3: heals without a restart', () => {
    it('serves the repaired file from the same instance that refused it', () => {
      writeFileSync(storePath, '{"home": {"name": "Seattle", "lat', 'utf-8');
      const store = new LocationStore(storePath);

      expect(() => store.count()).toThrow(LocationStoreUnreadableError);

      // Repair by hand, as the error message tells the user to.
      writeFileSync(
        storePath,
        JSON.stringify(
          {
            home: {
              ...SEATTLE,
              saved_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z'
            }
          },
          null,
          2
        ),
        'utf-8'
      );

      // Same instance, no restart.
      expect(store.count()).toBe(1);
      expect(store.get('home')?.name).toBe('Seattle, WA');
      expect(store.has('home')).toBe(true);
    });

    it('refuses again if the file is corrupted a second time', () => {
      const store = new LocationStore(storePath);
      store.set('home', SEATTLE);
      expect(store.count()).toBe(1);

      writeFileSync(storePath, 'not json at all', 'utf-8');
      expect(() => store.count()).toThrow(LocationStoreUnreadableError);
    });
  });

  // ---------------------------------------------------------------------------
  // Contract 4 — ENOENT, and only ENOENT, is an empty store
  // ---------------------------------------------------------------------------

  describe('contract 4: a missing file is an empty store', () => {
    it('reports an empty store when the file does not exist', () => {
      const store = new LocationStore(storePath);

      expect(existsSync(storePath)).toBe(false);
      expect(store.count()).toBe(0);
      expect(store.getAll()).toEqual({});
      expect(store.has('home')).toBe(false);
      expect(store.get('home')).toBeUndefined();
      expect(store.remove('home')).toBe(false);

      // A read must not create the file.
      expect(existsSync(storePath)).toBe(false);
    });

    it('creates the directory and the file on the first set', () => {
      const nestedDir = join(tempDir, 'nested');
      const nestedPath = join(nestedDir, 'locations.json');
      const store = new LocationStore(nestedPath);

      expect(existsSync(nestedDir)).toBe(false);

      store.set('home', SEATTLE);

      expect(existsSync(nestedDir)).toBe(true);
      expect(existsSync(nestedPath)).toBe(true);
      expect(store.count()).toBe(1);

      const onDisk = JSON.parse(readFileSync(nestedPath, 'utf-8'));
      expect(onDisk.home.name).toBe('Seattle, WA');
    });
  });
  // ---------------------------------------------------------------------------
  // Contracts 5, 6 and 10 — the atomic replace
  // ---------------------------------------------------------------------------

  describe('atomic replace', () => {
    /** Temp files are `.locations.json.<pid>.<hex>.tmp` beside the target. */
    const tmpResidue = (dir: string): string[] =>
      readdirSync(dir).filter((entry) => entry.endsWith('.tmp'));

    it('the fs mock seam is live: a successful set calls writeSync, fsyncSync and renameSync', () => {
      const store = new LocationStore(storePath);
      store.set('home', SEATTLE);

      // If the store's import specifier and this file's `vi.mock` ever diverge, the
      // spies record nothing and this goes red — instead of the whole suite quietly
      // running un-mocked (G70).
      expect(vi.mocked(writeSync)).toHaveBeenCalled();
      expect(vi.mocked(fsyncSync)).toHaveBeenCalled();
      expect(vi.mocked(renameSync)).toHaveBeenCalled();
    });

    // -- contract 5 (remainder): a failed write changes nothing --------------

    it('(a) a failed rename leaves the target untouched, no temp residue, and no phantom save', () => {
      const store = new LocationStore(storePath);
      store.set('home', SEATTLE);
      const before = readFileSync(storePath);

      vi.mocked(renameSync).mockImplementationOnce(() => {
        const err: NodeJS.ErrnoException = new Error('cross-device link');
        err.code = 'EXDEV';
        throw err;
      });

      expect(() => store.set('work', PORTLAND)).toThrow(/Failed to save locations/);

      // Target bytes identical.
      expect(readFileSync(storePath).equals(before)).toBe(true);
      // The temp file was cleaned up.
      expect(tmpResidue(tempDir)).toEqual([]);
      // No phantom: the instance must not believe a save that never reached disk.
      expect(store.has('work')).toBe(false);
      expect(store.has('home')).toBe(true);
    });

    it('(b) a successful set leaves no temp file behind', () => {
      const store = new LocationStore(storePath);
      store.set('home', SEATTLE);
      store.set('work', PORTLAND);

      expect(tmpResidue(tempDir)).toEqual([]);
      expect(store.count()).toBe(2);
    });

    // -- contract 6: the replace preserves the entry's nature ----------------

    it.skipIf(POSIX_ONLY)("(c) the file's inode changes across a set — it was replaced, not written in place", () => {
      const store = new LocationStore(storePath);
      store.set('home', SEATTLE);
      const inodeBefore = statSync(storePath).ino;

      store.set('work', PORTLAND);
      const inodeAfter = statSync(storePath).ino;

      expect(inodeAfter).not.toBe(inodeBefore);
    });

    it.skipIf(POSIX_ONLY)('(d) a 0600 file is still 0600 after a set', () => {
      writeFileSync(storePath, '{}', 'utf-8');
      chmodSync(storePath, 0o600);
      expect(statSync(storePath).mode & 0o777).toBe(0o600);

      const store = new LocationStore(storePath);
      store.set('home', SEATTLE);

      expect(statSync(storePath).mode & 0o777).toBe(0o600);
      expect(store.has('home')).toBe(true);
    });

    it.skipIf(POSIX_ONLY)('(e) a symlinked store path stays a symlink and its target gets the content', () => {
      const realDir = join(tempDir, 'real');
      mkdirSync(realDir);
      const realPath = join(realDir, 'actual-locations.json');
      writeFileSync(realPath, '{}', 'utf-8');

      const linkPath = join(tempDir, 'link.json');
      symlinkSync(realPath, linkPath);

      const store = new LocationStore(linkPath);
      store.set('home', SEATTLE);

      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      const onTarget = JSON.parse(readFileSync(realPath, 'utf-8'));
      expect(onTarget.home.name).toBe('Seattle, WA');
      expect(tmpResidue(tempDir)).toEqual([]);
      expect(tmpResidue(realDir)).toEqual([]);
    });

    it.skipIf(POSIX_ONLY)('(g) a DANGLING symlink is resolved through, not replaced', () => {
      // The link's target does not exist yet, but its parent directory does — a
      // dotfile manager or synced folder on first run. `realpathSync` reports
      // ENOENT here exactly as it does for an absent path, which is why this
      // store walks the chain with lstatSync/readlinkSync instead.
      const targetDir = join(tempDir, 'target');
      mkdirSync(targetDir);
      const targetPath = join(targetDir, 'not-yet-created.json');
      expect(existsSync(targetPath)).toBe(false);

      const linkPath = join(tempDir, 'link.json');
      symlinkSync(targetPath, linkPath);

      const store = new LocationStore(linkPath);
      store.set('home', SEATTLE);

      // The symlink survived — it was not renamed over.
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      // The formerly absent target now holds the JSON.
      expect(existsSync(targetPath)).toBe(true);
      const onTarget = JSON.parse(readFileSync(targetPath, 'utf-8'));
      expect(onTarget.home.name).toBe('Seattle, WA');
      // Nothing was written at the link's own pathname.
      expect(tmpResidue(tempDir)).toEqual([]);
      expect(tmpResidue(targetDir)).toEqual([]);
    });

    it('(f) fsyncSync runs before renameSync', () => {
      const store = new LocationStore(storePath);
      store.set('home', SEATTLE);

      const fsyncOrder = vi.mocked(fsyncSync).mock.invocationCallOrder;
      const renameOrder = vi.mocked(renameSync).mock.invocationCallOrder;

      expect(fsyncOrder.length).toBeGreaterThan(0);
      expect(renameOrder.length).toBeGreaterThan(0);
      expect(fsyncOrder[fsyncOrder.length - 1]).toBeLessThan(renameOrder[renameOrder.length - 1]);
    });

    // -- contract 10: a short write never publishes --------------------------

    it('(h) a short write is written to completion before any fsync or rename', () => {
      const store = new LocationStore(storePath);

      let firstCall = true;
      vi.mocked(writeSync).mockImplementation(((
        fd: number,
        buffer: NodeJS.ArrayBufferView,
        offset: number,
        length: number
      ) => {
        if (firstCall) {
          firstCall = false;
          // Report only a prefix, exactly as a partial write(2) would.
          const short = Math.max(1, Math.floor(length / 3));
          return actualFs.writeSync(fd, buffer, offset, short);
        }
        return actualFs.writeSync(fd, buffer, offset, length);
      }) as typeof writeSync);

      store.set('home', SEATTLE);

      // The loop went round more than once.
      expect(vi.mocked(writeSync).mock.calls.length).toBeGreaterThan(1);

      // The published file is the whole payload, not the prefix.
      const written = readFileSync(storePath, 'utf-8');
      const parsed = JSON.parse(written);
      expect(parsed.home.name).toBe('Seattle, WA');

      const expected = JSON.stringify(
        { home: parsed.home },
        null,
        2
      );
      expect(written).toBe(expected);

      // And it is readable through the store afterwards.
      expect(store.get('home')?.name).toBe('Seattle, WA');
      expect(tmpResidue(tempDir)).toEqual([]);
    });

    it('(i) a write that makes no progress fails the save and publishes nothing', () => {
      const store = new LocationStore(storePath);
      store.set('home', SEATTLE);
      const before = readFileSync(storePath);

      vi.mocked(writeSync).mockImplementation((() => 0) as unknown as typeof writeSync);

      expect(() => store.set('work', PORTLAND)).toThrow(/Failed to save locations/);

      expect(readFileSync(storePath).equals(before)).toBe(true);
      expect(tmpResidue(tempDir)).toEqual([]);

      resetFsSpies();
      expect(store.has('work')).toBe(false);
      expect(store.has('home')).toBe(true);
    });
  });
});
