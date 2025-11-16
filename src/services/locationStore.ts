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

export class LocationStore {
  private readonly storePath: string;
  private readonly storeDir: string;
  private cache: SavedLocationsStore | null = null;

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
   * Load all saved locations from disk
   */
  load(): SavedLocationsStore {
    // Return cached data if available
    if (this.cache !== null) {
      return this.cache;
    }

    // If file doesn't exist, return empty store
    if (!existsSync(this.storePath)) {
      logger.info('No saved locations file found, starting fresh', {
        path: this.storePath
      });
      this.cache = {};
      return this.cache;
    }

    try {
      const data = readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(data) as SavedLocationsStore;

      // Validate the structure
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        logger.warn('Invalid locations file format, resetting to empty', {
          path: this.storePath
        });
        this.cache = {};
        return this.cache;
      }

      logger.info('Loaded saved locations', {
        count: Object.keys(parsed).length,
        path: this.storePath
      });

      this.cache = parsed;
      return this.cache;
    } catch (error) {
      logger.error('Failed to load saved locations', error as Error, {
        path: this.storePath
      });
      // Return empty store on error rather than failing
      this.cache = {};
      return this.cache;
    }
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
      this.cache = locations; // Update cache
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
    this.save({});
    logger.info('Cleared all saved locations');
  }

  /**
   * Get the storage file path
   */
  getStorePath(): string {
    return this.storePath;
  }

  /**
   * Invalidate the cache, forcing reload on next access
   */
  invalidateCache(): void {
    this.cache = null;
  }
}
