/**
 * Unit tests for LocationStore durability.
 *
 * Covers the design plan's contracts 1-4:
 *   1. Interleave        — two instances on one file see each other's writes.
 *   2. Unreadable refused — every read and write throws, and the file is untouched.
 *   3. Heals              — a repair takes effect with no restart.
 *   4. ENOENT is empty    — a missing file is an empty store, and the first set creates it.
 *
 * Contract 5 (a failed write changes nothing) and contract 6 (replace preserves the
 * entry's nature) need an `fs` mock and live in the atomic-write task's tests.
 *
 * Every store here is constructed on a `mkdtempSync` path. The no-argument
 * constructor resolves to the real home directory, which live server instances share.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  statSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
});
