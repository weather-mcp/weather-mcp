/**
 * Service for managing saved/favorite locations
 * Stores locations in ~/.weather-mcp/locations.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
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
      writeFileSync(this.storePath, data, 'utf-8');
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
