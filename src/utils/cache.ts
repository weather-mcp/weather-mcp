/**
 * In-memory cache with TTL (Time To Live) and LRU (Least Recently Used) eviction
 *
 * Features:
 * - Configurable TTL per cache entry
 * - LRU eviction when max size is reached
 * - Type-safe generic implementation
 * - Cache statistics tracking (hits, misses, evictions)
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // timestamp in milliseconds
  lastAccessedAt: number; // for LRU tracking
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
}

export class Cache<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private stats: CacheStats;
  private maxSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(maxSize: number = 1000, cleanupIntervalMs: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
      maxSize: maxSize,
    };

    // Automatic cleanup of expired entries every 5 minutes by default
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, cleanupIntervalMs);
  }

  /**
   * Get a value from the cache
   * @param key Cache key
   * @returns Cached value or undefined if not found or expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check if expired
    const now = Date.now();
    if (entry.expiresAt < now) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.size = this.cache.size;
      return undefined;
    }

    // Update last accessed time for LRU
    entry.lastAccessedAt = now;
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set a value in the cache with TTL
   * @param key Cache key
   * @param value Value to cache
   * @param ttlMs Time to live in milliseconds (Infinity for no expiration)
   */
  set(key: string, value: T, ttlMs: number): void {
    const now = Date.now();

    // If cache is at max size and key doesn't exist, evict LRU entry
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      value,
      expiresAt: ttlMs === Infinity ? Infinity : now + ttlMs,
      lastAccessedAt: now,
    };

    this.cache.set(key, entry);
    this.stats.size = this.cache.size;
  }

  /**
   * Evict the least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  /**
   * Destroy the cache and clean up resources
   * Call this when the cache is no longer needed to prevent memory leaks
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    // Clean up expired entries before returning stats
    this.cleanupExpired();

    return {
      ...this.stats,
      size: this.cache.size,
    };
  }

  /**
   * Remove expired entries from cache
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
    this.stats.size = this.cache.size;
  }

  /**
   * Generate a cache key from components
   * @param components Parts to combine into a cache key (only primitives allowed)
   * @returns Cache key string
   * @throws {Error} If components contain objects or invalid types
   */
  static generateKey(...components: (string | number | boolean | null | undefined)[]): string {
    // Validate and sanitize inputs to prevent cache poisoning
    const sanitized = components.map((c, index) => {
      if (c === null || c === undefined) {
        return 'null';
      }
      if (typeof c === 'object') {
        throw new Error(`Cache key generation error: Object not allowed at position ${index}. Only primitives (string, number, boolean) are supported.`);
      }
      // Convert to string safely
      return String(c);
    });

    // Use colon separator instead of JSON.stringify to avoid circular reference issues
    return sanitized.join(':');
  }

  /**
   * Calculate hit rate percentage
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return (this.stats.hits / total) * 100;
  }
}
