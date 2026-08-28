/**
 * Blitzortung.org MQTT client for real-time lightning detection
 * Community-operated global lightning detection network (free, no API key required)
 *
 * Data access via public MQTT broker maintained for homeassistant-blitzortung integration
 * @see https://github.com/mrk-its/homeassistant-blitzortung
 * @see https://www.blitzortung.org/
 */

import type { MqttClient } from 'mqtt';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { LightningStrike, LightningFeedFailure, LightningFeedFailureReason } from '../types/lightning.js';
import { calculateGeohashSubscriptions } from '../utils/geohash.js';
import { MqttLoadFailedError, MqttUnavailableError } from '../errors/ApiError.js';

/**
 * The `mqtt` package is an **optional** dependency: it is the only dependency
 * reached by a single tool, and `get_lightning_activity` is absent from the
 * default `basic` preset. Declaring it optional lets an installer drop 38
 * packages with `--omit=optional`.
 *
 * That only works if nothing imports it at module load. The import below is
 * type-only (it erases at compile time), and the value half is resolved lazily
 * at the one call site that needs it — `ensureConnected`. A static import here
 * would take the whole server down at startup when the package is absent, not
 * just this tool: `src/index.ts` imports this module unconditionally, above the
 * tool gate.
 *
 * Note that `import type` still requires the package at **build** time — `tsc`
 * must resolve its declarations even though the emitted JavaScript never loads
 * it. The opt-out is therefore a property of the published package, not of a
 * source build.
 */
type MqttModule = (typeof import('mqtt'))['default'];

/**
 * Three-state resolution memo. `undefined` = not yet attempted, a module =
 * loaded, `null` = attempted and confirmed absent. Without it, an absent module
 * re-throws and re-logs on every query and every prewarmed location.
 */
let mqttModule: MqttModule | null | undefined;

/**
 * Single-flight guard for an import already in progress.
 *
 * The value memo alone does not close the startup race: `prewarmLightningMonitoring`
 * fires `void prewarmLocation(...)` per saved location without awaiting the
 * previous one, so with two saved locations both callers can observe
 * `mqttModule === undefined` before either import settles, both start an import,
 * and both emit the supposedly once-per-process warning.
 */
let mqttLoadPromise: Promise<MqttModule> | undefined;

/**
 * Resolve the optional `mqtt` package, at most once per process.
 *
 * Throws `MqttUnavailableError` when the package is genuinely absent, and
 * `MqttLoadFailedError` when it resolved but failed to load. Both are contract
 * failures; only the first is memoised. A load failure leaves the memo
 * `undefined` so it is retried rather than cached as an absence for the life of
 * the process.
 *
 * That retry is worth having for a transient failure, but note it cannot heal a
 * genuinely broken package: Node caches the failed module, so re-importing the
 * same specifier in the same process replays the same rejection even after the
 * files on disk are repaired. Verified against the built dist — repairing
 * `mqtt` under a running server still errors until it is restarted. The unit
 * mock is more forgiving than Node here, so the suite cannot show this.
 */
async function loadMqtt(): Promise<MqttModule> {
  // Explicit three-state discrimination: `null` and `undefined` mean different
  // things here, so these checks are deliberately not a `!= null` test.
  if (mqttModule === null) {
    throw new MqttUnavailableError();
  }
  if (mqttModule !== undefined) {
    return mqttModule;
  }
  if (mqttLoadPromise !== undefined) {
    return mqttLoadPromise;
  }

  // Assigned synchronously, before the first await, or the race above is
  // unchanged. Every concurrent caller receives this same promise, so the
  // classification and the warning below happen exactly once.
  mqttLoadPromise = import('mqtt').then(
    (loaded) => {
      mqttModule = loaded.default;
      mqttLoadPromise = undefined;
      return mqttModule;
    },
    (error: unknown) => {
      mqttLoadPromise = undefined;

      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ERR_MODULE_NOT_FOUND') {
        mqttModule = null;
        // Said once per process, on the transition to `null`. Callers must not
        // repeat it: prewarm runs this path once per saved location.
        logger.warn('Lightning detection unavailable: the optional mqtt package is not installed', {
          package: 'mqtt',
          tool: 'get_lightning_activity',
          remedy: 'Reinstall without --omit=optional'
        });
        throw new MqttUnavailableError();
      }

      // A real fault, not an absence. The memo stays `undefined` so the next
      // caller retries, and the message stays distinct from the absent one —
      // telling someone to reinstall without --omit=optional when they never
      // omitted it sends them after the wrong fix.
      //
      // It is still a **contract** failure. Letting the raw error propagate put
      // it through `getLightningStrikes`'s generic catch to `return []`, which
      // renders a green safety verdict built from a module that never loaded.
      // Note a corrupt CommonJS package reports `MODULE_NOT_FOUND`, not
      // `ERR_MODULE_NOT_FOUND`, so it lands here and not in the branch above.
      const failure = error as NodeJS.ErrnoException | undefined;
      // The `Error` slot is deliberately left empty — the logger would serialise
      // its message and stack, and the underlying failure can carry a
      // `Require stack:` of absolute paths. Only its name and code are kept.
      logger.error('Lightning detection unavailable: the optional mqtt package failed to load', undefined, {
        package: 'mqtt',
        tool: 'get_lightning_activity',
        name: failure?.name,
        code: failure?.code
      });
      throw new MqttLoadFailedError();
    }
  );

  return mqttLoadPromise;
}

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
  // Strikes only accumulate for a geohash while it is subscribed, so a query's real
  // monitoring coverage starts at the newest first-subscription among its geohashes —
  // not at the requested time window. Tracked so results can disclose limited coverage.
  private geohashFirstSubscribed: Map<string, number> = new Map(); // geohash -> first subscribed timestamp
  private readonly maxSubscriptions = 50; // Limit concurrent subscriptions to prevent unbounded growth
  private isConnecting = false;
  private isConnected = false;

  // A query's transport outcome is bound to the array that query returns, never held in a
  // "last failure" field. `getLightningStrikes` suspends for 10s at the accumulation wait, and
  // the MCP SDK starts each tools/call on its own promise chain, so overlapping queries would
  // read each other's outcome through any shared field - rendering a successful query as an
  // outage, or erasing a real one. A WeakMap lets a returned array take its entry with it.
  private readonly feedFailures = new WeakMap<LightningStrike[], LightningFeedFailure>();

  // Bumped on every connection loss (the `close` event, and the post-connect `error` event).
  // A close after subscribe resolves rejects nothing, so the catch below never sees it, and
  // mqtt's own reconnect can restore `isConnected` before the query returns - a final boolean
  // check would miss the gap entirely. Comparing the counter across the collection window is
  // what makes a mid-query outage distinguishable from a first-query cold start.
  private connectionLossGeneration = 0;

  constructor() {
    // Start cleanup interval
    this.startCleanupInterval();
    // Start subscription pruning interval
    this.startSubscriptionPruning();
  }

  /**
   * Connect to MQTT broker if not already connected
   */
  private async ensureConnected(mqtt: MqttModule): Promise<void> {
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

    // NOTHING may await between the `isConnecting` check above and the
    // assignment below. That flag is the only guard against concurrent callers
    // each opening their own broker connection, and it works precisely because
    // it is set in the same synchronous run as the check that reads it.
    //
    // This is why the resolved `mqtt` module arrives as a parameter rather than
    // being awaited here: `subscribeToLocation` resolves it before calling this
    // method. An `await loadMqtt()` in this window let all three startup
    // prewarms past the guard and opened three connections, orphaning two
    // clients that stayed connected with live message handlers.
    //
    // Invariant: `isConnecting` is false on every path out of this method that
    // did not connect — the catch at the foot of the try restores it.
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
          this.connectionLossGeneration++;
          logger.error('MQTT connection error', error);
          reject(error);
        });

        this.client!.on('close', () => {
          this.isConnected = false;
          this.connectionLossGeneration++;
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
    radiusKm: number,
    // Invocation-local, so a caller can tell which transport phase its own failure came from.
    // Deliberately an out-parameter rather than an instance field: pre-warm and overlapping
    // queries all share this method, and a shared phase field would let one of them describe
    // another's failure. Trailing and optional, so omitting it is exactly the old behaviour.
    phase?: { current: 'connect' | 'subscribe' }
  ): Promise<void> {
    // Resolved here, outside `ensureConnected`, so that method contains no
    // await before it sets `isConnecting` (see the comment there). An absent
    // package therefore throws before any connection state is touched, and
    // concurrent callers all reject from the one shared import promise.
    const mqtt = await loadMqtt();
    if (phase) {
      phase.current = 'connect';
    }
    await this.ensureConnected(mqtt);

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
    // The geohashes THIS call is the first to stamp. Both maps are written before the broker has
    // accepted anything, so a failed subscribe must undo them: a geohash left behind is treated
    // as subscribed forever after, which makes the next query for the same area compute an empty
    // `potentialNewSubs`, skip `subscribe` entirely, and read a coverage start for a topic no one
    // is listening to - a green LIMITED DATA verdict and "re-check shortly" while the feed is
    // down, which is exactly the cold-start story this feature exists to stop telling. Only what
    // this call staged is rolled back, so a geohash another call subscribed successfully is
    // never dropped.
    const staged: string[] = [];
    for (const geohash of geohashes) {
      if (!this.subscribedGeohashes.has(geohash)) {
        // IMPORTANT: Geohash characters must be separated by slashes in the topic
        // Example: "dhv" becomes "blitzortung/1.1/d/h/v/#"
        const geohashPath = geohash.split('').join('/');
        const topic = `${this.topicPrefix}/${geohashPath}/#`;
        subscriptions.push(topic);
        this.geohashFirstSubscribed.set(geohash, now);
        staged.push(geohash);
      }
      // Update access time for all geohashes in this request (LRU tracking)
      this.subscribedGeohashes.set(geohash, now);
    }

    if (subscriptions.length > 0) {
      if (phase) {
        phase.current = 'subscribe';
      }
      await new Promise<void>((resolve, reject) => {
        this.client!.subscribe(subscriptions, (error) => {
          if (error) {
            for (const geohash of staged) {
              this.subscribedGeohashes.delete(geohash);
              this.geohashFirstSubscribed.delete(geohash);
            }
            // The `Error` slot is deliberately left empty, as in the loader above: the logger
            // serialises message and stack, and mqtt's own errors carry the broker host and port
            // in both (`connect ECONNREFUSED <host>:<port>`). Only the name and code are kept —
            // enough to say which leg failed, without naming where it connected.
            const failure = error as NodeJS.ErrnoException;
            logger.error('Failed to subscribe to topics', undefined, {
              topics: subscriptions,
              name: failure.name,
              code: failure.code
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
      this.geohashFirstSubscribed.delete(geohash);
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
          this.geohashFirstSubscribed.delete(geohash);
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
    // Local to this invocation - see subscribeToLocation's `phase` parameter.
    const phase: { current: 'connect' | 'subscribe' } = { current: 'connect' };

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
      await this.subscribeToLocation(latitude, longitude, radiusKm, phase);

      // Captured AFTER the transport work succeeds, not before it: an initial connect that
      // mqtt retries internally bumps the counter on its way to succeeding, and comparing
      // against a pre-transport reading would flag that query as degraded after it had in
      // fact connected. From here on, any bump is a loss during OUR collection window.
      const generationAtSubscribe = this.connectionLossGeneration;

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

      // A broker that drops after we subscribed rejects nothing, so the catch below never
      // runs and the report would explain a real outage as a first-query cold start - the
      // exact dishonesty this whole path exists to remove. Buffered strikes still carry their
      // verdict; what changes is that the report stops claiming the coverage gap is benign.
      if (this.connectionLossGeneration !== generationAtSubscribe || !this.isConnected) {
        this.feedFailures.set(strikes, { at: new Date(), reason: 'connection_error' });
        logger.warn('Lightning feed connection lost during collection', {
          reason: 'connection_error'
        });
      }

      logger.info('Lightning data retrieved successfully', {
        totalStrikes: strikes.length,
        bufferSize: this.strikeBuffer.size
      });

      return strikes;
    } catch (error) {
      // An unusable optional package is a contract failure, not an empty feed —
      // whether it is absent or merely broken. Falling through to `return []`
      // would render "no strikes" and a green safety verdict, a fabricated
      // all-clear built from a packaging state rather than from anything the
      // detection network said. Rethrown before the generic logger.error below
      // so an unusable module does not log a line per query; the loader already
      // said it for this resolution.
      if (error instanceof MqttUnavailableError || error instanceof MqttLoadFailedError) {
        throw error;
      }

      // Classify by the phase this invocation reached, never by the error's identity: only the
      // connect timeout is ours (`new Error('MQTT connection timeout')`); the broker `error`
      // event and the subscribe callback both reject with mqtt's own object unchanged. The
      // reason never reaches rendered output - it exists so the stderr log can say which leg
      // failed without carrying a broker URL or a raw upstream error into either surface.
      const reason: LightningFeedFailureReason =
        (error as Error).message === 'MQTT connection timeout'
          ? 'connect_timeout'
          : phase.current === 'subscribe'
            ? 'subscribe_failed'
            : 'connection_error';

      // The `Error` slot is deliberately left empty, as in the loader and the subscribe callback
      // above: `reason` is the sanitized classification, and passing mqtt's own object alongside
      // it would serialise the message and stack that name the broker host and port — undoing
      // the whole point of classifying by phase.
      const failure = error as NodeJS.ErrnoException;
      logger.error('Failed to fetch lightning data', undefined, {
        reason,
        name: failure.name,
        code: failure.code
      });

      // Degrading (rather than throwing) is the settled classification: a transport failure is a
      // degraded report, not a contract failure - get_weather_summary must keep its lightning
      // section, and what was dishonest was the explanation, not the presence of a report.
      //
      // Read the buffer rather than returning `[]`. A failure to reach the feed says nothing about
      // the strikes already in hand: they were detected, they are inside the requested window, and
      // discarding them turns a stale report into an empty one - "no strikes could be observed"
      // over a strike this server holds, which is the same shape of lie as the cold-start story
      // this whole path exists to stop telling. A connection lost mid-collection already renders
      // from the buffer (the generation check above returns `strikes`); reading it here is what
      // makes the four transport-failure shapes agree instead of two of them silently dropping an
      // EXTREME verdict. `filterStrikes` touches no network and returns a fresh array per call, so
      // the distinct-array property below is preserved: two concurrent failures can never share one
      // WeakMap entry.
      const degraded = this.filterStrikes(latitude, longitude, radiusKm, timeWindowMinutes);
      this.feedFailures.set(degraded, { at: new Date(), reason });
      return degraded;
    }
  }

  /**
   * Begin buffering strikes for a location without waiting for or returning results.
   *
   * Subscribes the area's geohashes so the rolling buffer starts filling immediately.
   * Intended for startup pre-warming of known locations (e.g. saved locations) so that
   * later queries have real monitoring coverage instead of starting from zero. Best-effort:
   * failures are swallowed and must never block or crash startup.
   */
  async prewarmLocation(
    latitude: number,
    longitude: number,
    radiusKm: number = 100
  ): Promise<void> {
    try {
      await this.subscribeToLocation(latitude, longitude, radiusKm);
      const redacted = redactCoordinatesForLogging(latitude, longitude);
      logger.info('Pre-warmed lightning monitoring for location', {
        latitude: redacted.lat,
        longitude: redacted.lon,
        radiusKm
      });
    } catch (error) {
      // The loader's own line is the whole of "say it once". This catch runs
      // once per saved location, so repeating it here would produce exactly the
      // per-location spam the memo and the single-flight promise exist to
      // prevent — for a broken package as much as for an absent one.
      if (error instanceof MqttUnavailableError || error instanceof MqttLoadFailedError) {
        return;
      }
      // Same rule as the two `logger.error` sites above: mqtt's own message names the broker
      // host and port, so only the name and code are kept.
      const failure = error as NodeJS.ErrnoException;
      logger.warn('Failed to pre-warm lightning monitoring for location', {
        name: failure.name,
        code: failure.code
      });
    }
  }

  /**
   * The transport outcome of the query that produced `strikes`.
   *
   * Null when that query reached the broker, subscribed, and stayed connected for its whole
   * collection window; otherwise the moment and sanitized cause of the transport failure it
   * swallowed. Keyed on the returned array rather than held as a "last failure" field, so
   * overlapping queries cannot exchange outcomes and a pre-warm - which has no result array -
   * cannot set one at all. The returned object is never mutated after construction, so no
   * defensive copy is made.
   */
  getFeedFailure(strikes: LightningStrike[]): LightningFeedFailure | null {
    return this.feedFailures.get(strikes) ?? null;
  }

  /**
   * Get the moment from which the entire queried area has been continuously
   * monitored, or null if any part of it is not currently subscribed (or the
   * broker is disconnected). Callers use this to detect that a "0 strikes"
   * result covers less than the requested time window.
   */
  getCoverageStart(latitude: number, longitude: number, radiusKm: number): Date | null {
    if (!this.isConnected) {
      return null;
    }

    const geohashes = calculateGeohashSubscriptions(latitude, longitude, radiusKm);
    let coverageStart = 0;

    for (const geohash of geohashes) {
      const firstSubscribed = this.geohashFirstSubscribed.get(geohash);
      if (firstSubscribed === undefined) {
        return null;
      }
      if (firstSubscribed > coverageStart) {
        coverageStart = firstSubscribed;
      }
    }

    return coverageStart > 0 ? new Date(coverageStart) : null;
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
          this.geohashFirstSubscribed.clear();
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
