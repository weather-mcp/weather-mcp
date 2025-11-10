/**
 * Blitzortung.org MQTT client for real-time lightning detection
 * Community-operated global lightning detection network (free, no API key required)
 *
 * Data access via public MQTT broker maintained for homeassistant-blitzortung integration
 * @see https://github.com/mrk-its/homeassistant-blitzortung
 * @see https://www.blitzortung.org/
 */

import mqtt, { MqttClient } from 'mqtt';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { LightningStrike } from '../types/lightning.js';
import { calculateGeohashSubscriptions } from '../utils/geohash.js';

/**
 * Raw lightning strike data from MQTT
 */
interface MQTTLightningStrike {
  lat: number;
  lon: number;
  time: number; // Unix timestamp in milliseconds
  pol?: number; // Polarity
  mcs?: number; // Amplitude (milli-coulomb-seconds, or kA)
  stat?: number; // Number of stations that detected the strike
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export class BlitzortungService {
  private client: MqttClient | null = null;
  // SECURITY WARNING: Default broker uses PLAINTEXT MQTT (port 1883)
  // The public Blitzortung community broker (blitzortung.ha.sed.pl) does not support TLS.
  // While lightning strike data is public information, plaintext connections allow:
  //   - Network observers to see which regions you're monitoring (via MQTT subscriptions)
  //   - Potential message tampering (injecting false lightning data)
  //
  // RECOMMENDED MITIGATIONS:
  //   1. Set BLITZORTUNG_MQTT_URL to a TLS-enabled broker (mqtts:// or wss://)
  //   2. Run a local MQTT proxy with TLS termination
  //   3. Deploy in a trusted network environment
  //
  // Location privacy: Geohash subscriptions have ~4-40km precision (limited tracking risk)
  private readonly brokerUrl = process.env.BLITZORTUNG_MQTT_URL || 'mqtt://blitzortung.ha.sed.pl:1883';
  private readonly topicPrefix = 'blitzortung/1.1';
  private readonly reconnectPeriod = 5000; // 5 seconds
  private readonly connectTimeout = 30000; // 30 seconds

  // Rolling buffer of recent strikes (last 2 hours)
  private strikeBuffer: Map<string, LightningStrike> = new Map();
  private readonly bufferDuration = 120 * 60 * 1000; // 2 hours in milliseconds
  private readonly maxBufferSize = 10000; // Maximum strikes to buffer (safety limit)

  // Subscription management with LRU tracking
  private subscribedGeohashes: Map<string, number> = new Map(); // geohash -> last access timestamp
  private readonly maxSubscriptions = 50; // Limit concurrent subscriptions to prevent unbounded growth
  private isConnecting = false;
  private isConnected = false;

  constructor() {
    // Start cleanup interval
    this.startCleanupInterval();
    // Start subscription pruning interval
    this.startSubscriptionPruning();
  }

  /**
   * Connect to MQTT broker if not already connected
   */
  private async ensureConnected(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }

    if (this.isConnecting) {
      // Wait for existing connection attempt
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.isConnected || !this.isConnecting) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }

    this.isConnecting = true;

    try {
      // Security warning for plaintext connections
      const isPlaintext = this.brokerUrl.startsWith('mqtt://') ||
                         (!this.brokerUrl.startsWith('mqtts://') && !this.brokerUrl.startsWith('wss://'));

      if (isPlaintext) {
        logger.warn('SECURITY: Using plaintext MQTT connection (unencrypted)', {
          broker: this.brokerUrl,
          securityEvent: true,
          recommendation: 'Use BLITZORTUNG_MQTT_URL environment variable to configure TLS broker (mqtts:// or wss://)'
        });
      }

      logger.info('Connecting to Blitzortung MQTT broker', {
        broker: this.brokerUrl,
        encrypted: !isPlaintext
      });

      this.client = mqtt.connect(this.brokerUrl, {
        reconnectPeriod: this.reconnectPeriod,
        connectTimeout: this.connectTimeout,
        clientId: `weather-mcp-${Math.random().toString(16).slice(2, 10)}`
      });

      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('MQTT connection timeout'));
        }, this.connectTimeout);

        this.client!.on('connect', () => {
          clearTimeout(timeoutId);
          this.isConnected = true;
          this.isConnecting = false;
          logger.info('Connected to Blitzortung MQTT broker');
          resolve();
        });

        this.client!.on('error', (error) => {
          clearTimeout(timeoutId);
          this.isConnecting = false;
          logger.error('MQTT connection error', error);
          reject(error);
        });

        this.client!.on('close', () => {
          this.isConnected = false;
          logger.warn('MQTT connection closed');
        });

        this.client!.on('message', this.handleMessage.bind(this));
      });
    } catch (error) {
      this.isConnecting = false;
      throw error;
    }
  }

  /**
   * Handle incoming MQTT message
   */
  private handleMessage(topic: string, payload: Buffer): void {
    try {
      const payloadStr = payload.toString();
      const data: MQTTLightningStrike = JSON.parse(payloadStr);

      // Validate required fields
      if (!data.lat || !data.lon || !data.time) {
        logger.warn('Lightning strike missing required fields', {
          topic,
          hasLat: !!data.lat,
          hasLon: !!data.lon,
          hasTime: !!data.time
        });
        return;
      }

      // Convert timestamp - Blitzortung sends nanoseconds, convert to milliseconds
      // Example: 1762715394083570200 nanoseconds -> 1731178800000 milliseconds
      let timestampMs = data.time;
      if (data.time > 10000000000000) {
        // If timestamp is > year 2286 in milliseconds, it's probably in nanoseconds
        timestampMs = Math.floor(data.time / 1000000);
      }

      // Convert to our LightningStrike format
      const strike: LightningStrike = {
        timestamp: new Date(timestampMs),
        latitude: data.lat,
        longitude: data.lon,
        polarity: data.pol || 0,
        amplitude: data.mcs || 0,
        stationCount: data.stat,
        distance: 0 // Will be calculated when filtering
      };

      // Validate timestamp
      if (isNaN(strike.timestamp.getTime())) {
        logger.warn('Invalid timestamp in lightning strike', {
          topic,
          time: data.time,
          converted: timestampMs
        });
        return;
      }

      // Check buffer size limit before adding (safety bounds checking)
      if (this.strikeBuffer.size >= this.maxBufferSize) {
        logger.warn('Lightning strike buffer at capacity, removing oldest entries', {
          currentSize: this.strikeBuffer.size,
          maxSize: this.maxBufferSize,
          securityEvent: true
        });

        // Remove oldest 10% of entries to make room
        const entriesToRemove = Math.floor(this.maxBufferSize * 0.1);
        const iterator = this.strikeBuffer.keys();
        for (let i = 0; i < entriesToRemove; i++) {
          const result = iterator.next();
          if (!result.done) {
            this.strikeBuffer.delete(result.value);
          }
        }
      }

      // Add to buffer with unique key
      const key = `${data.time}_${data.lat}_${data.lon}`;
      this.strikeBuffer.set(key, strike);

      // Log strikes at DEBUG level with coordinate redaction for privacy
      // Strike coordinates are rounded to ~1km precision to prevent tracking individual locations
      const redacted = redactCoordinatesForLogging(strike.latitude, strike.longitude);
      logger.debug('Lightning strike added to buffer', {
        bufferSize: this.strikeBuffer.size,
        strike: {
          lat: redacted.lat,
          lon: redacted.lon,
          time: strike.timestamp.toISOString(),
          topic
        }
      });
    } catch (error) {
      logger.warn('Failed to parse lightning strike message', {
        error: (error as Error).message,
        topic
      });
    }
  }

  /**
   * Subscribe to geohash topics for a location
   */
  private async subscribeToLocation(
    latitude: number,
    longitude: number,
    radiusKm: number
  ): Promise<void> {
    await this.ensureConnected();

    if (!this.client) {
      throw new Error('MQTT client not connected');
    }

    // Calculate required geohashes
    const geohashes = calculateGeohashSubscriptions(latitude, longitude, radiusKm);

    // Redact coordinates for logging to protect user privacy
    const redacted = redactCoordinatesForLogging(latitude, longitude);
    logger.info('Subscribing to geohash topics', {
      latitude: redacted.lat,
      longitude: redacted.lon,
      radiusKm,
      geohashCount: geohashes.size,
      geohashes: Array.from(geohashes)
    });

    const now = Date.now();

    // Check if we need to evict old subscriptions before adding new ones
    const potentialNewSubs = Array.from(geohashes).filter(g => !this.subscribedGeohashes.has(g));
    if (this.subscribedGeohashes.size + potentialNewSubs.length > this.maxSubscriptions) {
      await this.evictOldestSubscriptions(potentialNewSubs.length);
    }

    // Subscribe to each geohash and track access time
    const subscriptions: string[] = [];
    for (const geohash of geohashes) {
      if (!this.subscribedGeohashes.has(geohash)) {
        // IMPORTANT: Geohash characters must be separated by slashes in the topic
        // Example: "dhv" becomes "blitzortung/1.1/d/h/v/#"
        const geohashPath = geohash.split('').join('/');
        const topic = `${this.topicPrefix}/${geohashPath}/#`;
        subscriptions.push(topic);
      }
      // Update access time for all geohashes in this request (LRU tracking)
      this.subscribedGeohashes.set(geohash, now);
    }

    if (subscriptions.length > 0) {
      await new Promise<void>((resolve, reject) => {
        this.client!.subscribe(subscriptions, (error) => {
          if (error) {
            logger.error('Failed to subscribe to topics', error, {
              topics: subscriptions
            });
            reject(error);
          } else {
            logger.info('Subscribed to geohash topics', {
              count: subscriptions.length,
              totalSubscriptions: this.subscribedGeohashes.size
            });
            resolve();
          }
        });
      });
    } else {
      logger.debug('All required geohashes already subscribed', {
        totalSubscriptions: this.subscribedGeohashes.size
      });
    }
  }

  /**
   * Evict oldest subscriptions to make room for new ones (LRU eviction)
   */
  private async evictOldestSubscriptions(slotsNeeded: number): Promise<void> {
    if (!this.client || slotsNeeded <= 0) {
      return;
    }

    // Sort by access time (oldest first)
    const sorted = Array.from(this.subscribedGeohashes.entries())
      .sort((a, b) => a[1] - b[1]);

    // Evict oldest entries
    const toEvict = sorted.slice(0, slotsNeeded);
    const topics = toEvict.map(([geohash]) => {
      const geohashPath = geohash.split('').join('/');
      return `${this.topicPrefix}/${geohashPath}/#`;
    });

    logger.info('Evicting old geohash subscriptions (LRU)', {
      count: toEvict.length,
      slotsNeeded,
      currentSize: this.subscribedGeohashes.size,
      maxSubscriptions: this.maxSubscriptions,
      securityEvent: true
    });

    // Unsubscribe from topics
    await new Promise<void>((resolve) => {
      this.client!.unsubscribe(topics, (error) => {
        if (error) {
          logger.warn('Failed to unsubscribe from topics', {
            error: error.message,
            topics: topics.slice(0, 3) // Log first 3 for debugging
          });
        }
        resolve(); // Always resolve to avoid blocking
      });
    });

    // Remove from tracking map
    for (const [geohash] of toEvict) {
      this.subscribedGeohashes.delete(geohash);
    }

    logger.debug('Eviction complete', {
      remainingSubscriptions: this.subscribedGeohashes.size
    });
  }

  /**
   * Periodically prune stale subscriptions (not accessed in last hour)
   */
  private startSubscriptionPruning(): void {
    // Prune every 15 minutes
    setInterval(async () => {
      if (!this.client || this.subscribedGeohashes.size === 0) {
        return;
      }

      const now = Date.now();
      const staleThreshold = 60 * 60 * 1000; // 1 hour
      const staleGeohashes: string[] = [];

      for (const [geohash, lastAccess] of this.subscribedGeohashes.entries()) {
        if (now - lastAccess > staleThreshold) {
          staleGeohashes.push(geohash);
        }
      }

      if (staleGeohashes.length > 0) {
        logger.info('Pruning stale geohash subscriptions', {
          count: staleGeohashes.length,
          totalBefore: this.subscribedGeohashes.size
        });

        const topics = staleGeohashes.map(geohash => {
          const geohashPath = geohash.split('').join('/');
          return `${this.topicPrefix}/${geohashPath}/#`;
        });

        // Unsubscribe from stale topics
        await new Promise<void>((resolve) => {
          this.client!.unsubscribe(topics, (error) => {
            if (error) {
              logger.warn('Failed to unsubscribe from stale topics', {
                error: error.message
              });
            }
            resolve();
          });
        });

        // Remove from tracking
        for (const geohash of staleGeohashes) {
          this.subscribedGeohashes.delete(geohash);
        }

        logger.debug('Pruning complete', {
          remainingSubscriptions: this.subscribedGeohashes.size
        });
      }
    }, 15 * 60 * 1000); // Every 15 minutes
  }

  /**
   * Get recent lightning strikes from buffer
   */
  async getLightningStrikes(
    latitude: number,
    longitude: number,
    radiusKm: number = 100,
    timeWindowMinutes: number = 60
  ): Promise<LightningStrike[]> {
    try {
      // Redact coordinates for logging to protect user privacy
      const redacted = redactCoordinatesForLogging(latitude, longitude);
      logger.info('Fetching lightning data from Blitzortung MQTT', {
        latitude: redacted.lat,
        longitude: redacted.lon,
        radiusKm,
        timeWindowMinutes
      });

      // Subscribe to the location
      await this.subscribeToLocation(latitude, longitude, radiusKm);

      // Wait for strikes to accumulate in buffer after subscription
      // This allows time for MQTT messages to arrive and be processed
      // 10 seconds provides good coverage for active lightning areas
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Filter strikes from buffer
      const strikes = this.filterStrikes(
        latitude,
        longitude,
        radiusKm,
        timeWindowMinutes
      );

      logger.info('Lightning data retrieved successfully', {
        totalStrikes: strikes.length,
        bufferSize: this.strikeBuffer.size
      });

      return strikes;
    } catch (error) {
      logger.error('Failed to fetch lightning data', error as Error);
      // Return empty array on error to allow graceful degradation
      return [];
    }
  }

  /**
   * Filter strikes from buffer based on location and time window
   */
  private filterStrikes(
    centerLat: number,
    centerLon: number,
    radiusKm: number,
    timeWindowMinutes: number
  ): LightningStrike[] {
    const now = Date.now();
    const cutoffTime = now - timeWindowMinutes * 60 * 1000;
    const strikes: LightningStrike[] = [];

    for (const strike of this.strikeBuffer.values()) {
      // Check time window
      if (strike.timestamp.getTime() < cutoffTime) {
        continue;
      }

      // Calculate distance
      const distance = calculateDistance(
        centerLat,
        centerLon,
        strike.latitude,
        strike.longitude
      );

      // Check if within radius
      if (distance <= radiusKm) {
        strikes.push({
          ...strike,
          distance
        });
      }
    }

    // Sort by distance (nearest first)
    strikes.sort((a, b) => (a.distance || 0) - (b.distance || 0));

    return strikes;
  }

  /**
   * Clean up old strikes from buffer
   */
  private cleanupBuffer(): void {
    const now = Date.now();
    const cutoffTime = now - this.bufferDuration;
    let removedCount = 0;

    for (const [key, strike] of this.strikeBuffer.entries()) {
      if (strike.timestamp.getTime() < cutoffTime) {
        this.strikeBuffer.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.debug('Cleaned up old lightning strikes from buffer', {
        removed: removedCount,
        remaining: this.strikeBuffer.size
      });
    }
  }

  /**
   * Start periodic buffer cleanup
   */
  private startCleanupInterval(): void {
    // Clean up every 5 minutes
    setInterval(() => {
      this.cleanupBuffer();
    }, 5 * 60 * 1000);
  }

  /**
   * Disconnect from MQTT broker
   * This method is available for graceful shutdown scenarios
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      logger.info('Disconnecting from Blitzortung MQTT broker', {
        activeSubscriptions: this.subscribedGeohashes.size
      });

      await new Promise<void>((resolve) => {
        this.client!.end(false, {}, () => {
          this.isConnected = false;
          this.subscribedGeohashes.clear();
          logger.info('Disconnected from Blitzortung MQTT broker');
          resolve();
        });
      });
      this.client = null;
    }
  }
}

// Singleton instance
export const blitzortungService = new BlitzortungService();
