/**
 * The saved-location store's errors name the file path to the machine's owner
 * and never to a remote caller.
 *
 * Every row reaches its throw site through the public operation, on a real
 * temp directory with no fs mock, and asserts the thrown class, the local text
 * and the remote text. There are three caller-visible sites: the unreadable
 * file, the directory creation, and the save. An inner write failure (a
 * symlink chain, a short write) is always re-thrown by the save site.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  LocationStore,
  LocationStoreUnreadableError,
  LocationStoreWriteError
} from '../../src/services/locationStore.js';
import { formatErrorForUser } from '../../src/errors/ApiError.js';
import { runWithCallerAudience } from '../../src/utils/callerAudience.js';

const SEATTLE = { name: 'Seattle, WA', latitude: 47.6062, longitude: -122.3321 };

let tempDir: string;
const lockedDirs: string[] = [];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'store-remote-msg-'));
});

afterEach(() => {
  for (const dir of lockedDirs.splice(0)) {
    chmodSync(dir, 0o700);
  }
  rmSync(tempDir, { recursive: true, force: true });
});

function lock(dir: string): void {
  chmodSync(dir, 0o500);
  lockedDirs.push(dir);
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to throw');
}

/** No part of where the store lives may appear in text a remote caller reads. */
function expectNoPath(text: string, storePath: string): void {
  expect(text).not.toContain(storePath);
  expect(text).not.toContain(dirname(storePath));
  expect(text).not.toContain(basename(tempDir));
  expect(text).not.toContain(tmpdir());
}

describe('saved-location store errors: local text and remote text', () => {
  it('runs as a user the permission bits bind (the write rows depend on it)', () => {
    expect(process.getuid?.()).not.toBe(0);
  });

  it('an unreadable file: LocationStoreUnreadableError', () => {
    const storePath = join(tempDir, 'locations.json');
    writeFileSync(storePath, 'not json');
    const store = new LocationStore(storePath);

    const error = caught(() => store.getAll());

    expect(error).toBeInstanceOf(LocationStoreUnreadableError);
    const typed = error as LocationStoreUnreadableError;
    expect(typed.message).toBe(
      `Saved locations file could not be read: ${storePath}\n\n` +
      'The file was not modified. To recover, either repair it so it contains a valid JSON object,\n' +
      'or move it aside (rename or delete it) to start with an empty list. No restart is needed.'
    );
    expectNoPath(typed.remoteMessage, storePath);
    expect(typed.remoteMessage).toContain('could not be read');
    expect(typed.remoteMessage).toContain('was not modified');

    const remote = runWithCallerAudience(true, () => formatErrorForUser(typed));
    expect(remote).toBe(`Error: ${typed.remoteMessage}`);
    expectNoPath(remote, storePath);
    expect(runWithCallerAudience(false, () => formatErrorForUser(typed))).toBe(`Error: ${typed.message}`);
    expect(formatErrorForUser(typed)).toBe(`Error: ${typed.message}`);
  });

  it('a directory that cannot be created: LocationStoreWriteError', () => {
    const parent = join(tempDir, 'parent');
    mkdirSync(parent);
    const storeDir = join(parent, 'store');
    const storePath = join(storeDir, 'locations.json');
    const store = new LocationStore(storePath);
    // The load sees ENOENT (an empty store); the save then has to create the directory.
    expect(store.count()).toBe(0);
    lock(parent);

    const error = caught(() => store.set('home', SEATTLE));

    expect(error).toBeInstanceOf(LocationStoreWriteError);
    const typed = error as LocationStoreWriteError;
    expect(typed.message).toBe(`Failed to create storage directory at ${storeDir}`);
    expect(typed.storePath).toBe(storePath);
    expectNoPath(typed.remoteMessage, storePath);

    const remote = runWithCallerAudience(true, () => formatErrorForUser(typed));
    expect(remote).toBe(`Error: ${typed.remoteMessage}`);
    expectNoPath(remote, storePath);
    expect(formatErrorForUser(typed)).toBe(`Error: ${typed.message}`);
  });

  it('a save that cannot write: LocationStoreWriteError', () => {
    const storePath = join(tempDir, 'locations.json');
    const store = new LocationStore(storePath);
    store.set('home', SEATTLE);
    // The file stays readable; the directory no longer accepts the temp file.
    lock(tempDir);

    const error = caught(() => store.set('work', { ...SEATTLE, name: 'Work' }));

    expect(error).toBeInstanceOf(LocationStoreWriteError);
    const typed = error as LocationStoreWriteError;
    expect(typed.message).toBe(`Failed to save locations to ${storePath}`);
    expect(typed.storePath).toBe(storePath);
    expectNoPath(typed.remoteMessage, storePath);
    expect(typed.remoteMessage).toContain('nothing was changed');

    const remote = runWithCallerAudience(true, () => formatErrorForUser(typed));
    expect(remote).toBe(`Error: ${typed.remoteMessage}`);
    expectNoPath(remote, storePath);
    expect(formatErrorForUser(typed)).toBe(`Error: ${typed.message}`);

    // The failed save changed nothing.
    expect(store.has('work')).toBe(false);
    expect(store.get('home')?.name).toBe('Seattle, WA');
  });

  it('a write error is still an Error whose message matches the old pattern', () => {
    const error = new LocationStoreWriteError('Failed to save locations to /srv/x/locations.json', '/srv/x/locations.json');
    expect(error).toBeInstanceOf(Error);
    expect(() => { throw error; }).toThrow(/Failed to save locations/);
  });
});
