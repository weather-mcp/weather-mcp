/**
 * Service for managing saved/favorite locations
 * Stores locations in ~/.weather-mcp/locations.json
 */

import {
  readFileSync,
  mkdirSync,
  existsSync,
  lstatSync,
  readlinkSync,
  statSync,
  openSync,
  writeSync,
  fsyncSync,
  fchmodSync,
  closeSync,
  renameSync,
  unlinkSync
} from 'fs';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { join, dirname, basename, resolve, isAbsolute } from 'path';
import type { SavedLocation, SavedLocationsStore } from '../types/savedLocations.js';
import { logger } from '../utils/logger.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';

/**
 * Thrown when `~/.weather-mcp/locations.json` exists but cannot be read, parsed,
 * or does not hold a plain JSON object at the top level.
 *
 * The store is **contract**, not garnish: it is user data that only this server
 * writes, so "empty" and "unreadable" must never render as the same answer. An
 * unreadable file is refused by every read and every write — it is never renamed,
 * copied, or overwritten. `ENOENT`, and only `ENOENT`, means an empty store.
 *
 * The message is fixed apart from the path. The underlying cause goes to the log,
 * never into the message.
 */
export class LocationStoreUnreadableError extends Error {
  readonly storePath: string;

  constructor(storePath: string) {
    super(
      `Saved locations file could not be read: ${storePath}\n\n` +
      'The file was not modified. To recover, either repair it so it contains a valid JSON object,\n' +
      'or move it aside (rename or delete it) to start with an empty list. No restart is needed.'
    );
    this.name = 'LocationStoreUnreadableError';
    this.storePath = storePath;
  }
}

/** Most symlink hops followed when resolving the write target. A cycle must not spin. */
const MAX_SYMLINK_HOPS = 32;

export class LocationStore {
  private readonly storePath: string;
  private readonly storeDir: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.storePath = customPath;
      this.storeDir = join(customPath, '..');
    } else {
      this.storeDir = join(homedir(), '.weather-mcp');
      this.storePath = join(this.storeDir, 'locations.json');
    }
  }

  /**
   * Ensure the storage directory exists
   * @private
   */
  private ensureDirectoryExists(): void {
    if (!existsSync(this.storeDir)) {
      try {
        mkdirSync(this.storeDir, { recursive: true });
        logger.info('Created locations storage directory', { path: this.storeDir });
      } catch (error) {
        logger.error('Failed to create storage directory', error as Error, {
          path: this.storeDir
        });
        throw new Error(`Failed to create storage directory at ${this.storeDir}`);
      }
    }
  }

  /**
   * Load all saved locations from disk.
   *
   * Reads the file on **every** call — there is no cache. Two clients on one
   * machine share this file, so a cached copy written back whole silently deletes
   * the other client's saves. Every call returns a fresh object.
   *
   * @throws {LocationStoreUnreadableError} when the file exists but cannot be
   *   read, cannot be parsed, or is not a plain JSON object at the top level.
   *   A zero-byte or whitespace-only file is a parse failure like any other.
   */
  load(): SavedLocationsStore {
    let data: string;
    try {
      data = readFileSync(this.storePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug('No saved locations file found, starting fresh', {
          path: this.storePath
        });
        return {};
      }
      // Any other read failure (EISDIR, EACCES, EIO, ENOTDIR) is unreadable, not empty.
      logger.error('Failed to read saved locations', error as Error, {
        path: this.storePath
      });
      throw new LocationStoreUnreadableError(this.storePath);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      logger.error('Failed to parse saved locations', error as Error, {
        path: this.storePath
      });
      throw new LocationStoreUnreadableError(this.storePath);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      logger.error('Saved locations file is not a JSON object', undefined, {
        path: this.storePath
      });
      throw new LocationStoreUnreadableError(this.storePath);
    }

    logger.debug('Loaded saved locations', {
      count: Object.keys(parsed).length,
      path: this.storePath
    });

    return parsed as SavedLocationsStore;
  }

  /**
   * Save all locations to disk
   * @private
   */
  private save(locations: SavedLocationsStore): void {
    this.ensureDirectoryExists();

    try {
      const data = JSON.stringify(locations, null, 2);
      this.writeAtomically(data);
      logger.info('Saved locations to disk', {
        count: Object.keys(locations).length,
        path: this.storePath
      });
    } catch (error) {
      logger.error('Failed to save locations', error as Error, {
        path: this.storePath
      });
      throw new Error(`Failed to save locations to ${this.storePath}`);
    }
  }

  /**
   * Resolve the pathname this store should actually write, by walking the symlink
   * chain from `storePath`.
   *
   * `realpathSync` cannot be used here: it reports `ENOENT` both for a path that is
   * absent and for a symlink whose target is absent, so falling back to the literal
   * path on `ENOENT` renames **over the symlink**, destroying it and writing the
   * JSON at the link's own pathname. Dotfile managers and synced folders make a
   * not-yet-created link target an ordinary first-run state.
   *
   * @private
   */
  private resolveWriteTarget(): string {
    let current = this.storePath;

    for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop++) {
      let stats;
      try {
        stats = lstatSync(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Absent: a fresh install, or the intended target of a dangling link.
          return current;
        }
        throw error;
      }

      if (!stats.isSymbolicLink()) {
        return current;
      }

      const link = readlinkSync(current);
      current = isAbsolute(link) ? link : resolve(dirname(current), link);
    }

    throw new Error(`Symlink chain too deep at ${this.storePath}`);
  }

  /**
   * Replace the store file atomically: write a uniquely named temp file in the same
   * directory, fsync it, then rename it over the target. A reader sees the old file
   * or the new one, never a partial — today's in-place write truncates first, and a
   * reader landing in that window destroys the file through the parse-failure path.
   *
   * On any failure the temp file is removed and the target is left untouched. There
   * is deliberately **no** fallback to an in-place write: that would reintroduce the
   * truncation window exactly where the environment is already unusual.
   *
   * @private
   */
  private writeAtomically(data: string): void {
    const target = this.resolveWriteTarget();

    // A rename replaces the directory entry, where an in-place write goes through
    // it — so the mode has to be carried over explicitly or a user's 0600 is lost.
    // A file that does not exist yet keeps the process default, as before.
    let mode: number | undefined;
    try {
      mode = statSync(target).mode & 0o777;
    } catch {
      mode = undefined;
    }

    const tmp = join(
      dirname(target),
      `.${basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    );

    let fd: number | undefined;
    try {
      fd = openSync(tmp, 'wx');
      if (mode !== undefined) {
        // The open mode is masked by umask, so set it explicitly.
        fchmodSync(fd, mode);
      }

      // writeSync returns the number of bytes written and is NOT documented to
      // write the buffer whole. A short write under ENOSPC or a signal, followed
      // by fsync and rename, would durably and atomically publish truncated JSON
      // as a successful save — the exact unreadable state this replace exists to
      // prevent. Loop to completion and treat no progress as a failure.
      const buf = Buffer.from(data, 'utf8');
      for (let off = 0; off < buf.length; ) {
        const written = writeSync(fd, buf, off, buf.length - off);
        if (!(written > 0)) {
          throw new Error(`Write made no progress at offset ${off} of ${buf.length}`);
        }
        off += written;
      }

      // Only after the whole buffer is written.
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;

      renameSync(tmp, target);
    } catch (error) {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // Ignore: the original error is what matters.
        }
      }
      try {
        unlinkSync(tmp);
      } catch {
        // Ignore: the temp file may never have been created.
      }
      throw error;
    }
  }

  /**
   * Get a saved location by alias
   */
  get(alias: string): SavedLocation | undefined {
    const locations = this.load();
    const normalized = alias.toLowerCase().trim();
    return locations[normalized];
  }

  /**
   * Get all saved locations
   */
  getAll(): SavedLocationsStore {
    return this.load();
  }

  /**
   * Save or update a location
   */
  set(alias: string, location: Omit<SavedLocation, 'saved_at' | 'updated_at'>): SavedLocation {
    // Validate alias
    const normalized = alias.toLowerCase().trim();
    if (!normalized || normalized.length === 0) {
      throw new Error('Location alias cannot be empty');
    }

    if (normalized.length > 50) {
      throw new Error('Location alias must be 50 characters or less');
    }

    // Validate coordinates
    validateLatitude(location.latitude);
    validateLongitude(location.longitude);

    const locations = this.load();
    const isUpdate = normalized in locations;
    const now = new Date().toISOString();

    const savedLocation: SavedLocation = {
      ...location,
      saved_at: isUpdate ? locations[normalized].saved_at : now,
      updated_at: now
    };

    locations[normalized] = savedLocation;
    this.save(locations);

    logger.info(isUpdate ? 'Updated saved location' : 'Created new saved location', {
      alias: normalized,
      name: location.name
    });

    return savedLocation;
  }

  /**
   * Remove a saved location
   */
  remove(alias: string): boolean {
    const locations = this.load();
    const normalized = alias.toLowerCase().trim();

    if (!(normalized in locations)) {
      return false;
    }

    delete locations[normalized];
    this.save(locations);

    logger.info('Removed saved location', { alias: normalized });
    return true;
  }

  /**
   * Check if a location exists
   */
  has(alias: string): boolean {
    const locations = this.load();
    const normalized = alias.toLowerCase().trim();
    return normalized in locations;
  }

  /**
   * Get the number of saved locations
   */
  count(): number {
    const locations = this.load();
    return Object.keys(locations).length;
  }

  /**
   * Clear all saved locations
   */
  clear(): void {
    // Load first so clear() refuses an unreadable file like every other operation.
    this.load();
    this.save({});
    logger.info('Cleared all saved locations');
  }

  /**
   * Get the storage file path
   */
  getStorePath(): string {
    return this.storePath;
  }
}
