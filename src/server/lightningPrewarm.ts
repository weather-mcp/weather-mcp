/**
 * Saved-location lightning pre-warm: subscribe saved locations at startup and keep them
 * subscribed for as long as they stay saved.
 *
 * The Blitzortung feed only buffers strikes for an area while it is subscribed, and the
 * service prunes any subscription idle for longer than `SUBSCRIPTION_IDLE_THRESHOLD_MS`.
 * A single startup pre-warm therefore lapsed after about an hour. This module re-warms
 * every saved location on an interval derived from that threshold, so a saved location's
 * access stamp never ages past it. A location removed from the store is simply not
 * re-warmed, and the ordinary prune drops it.
 *
 * - The timer starts whenever the gate passes, even with an empty or unreadable store, so
 *   a location saved (or a file repaired) later is picked up on the next tick. An empty
 *   store opens no connection: nothing connects until the first `prewarmLocation` call.
 * - The store read is guarded, and only the read: an unreadable file must not stop the
 *   server booting, and a fault anywhere else must not be hidden behind the same catch.
 *   On an unreadable tick nothing is re-warmed, so subscriptions age out rather than being
 *   extended from data that could not be read.
 * - Pre-warm never evicts. The service skips a saved location that does not fit instead of
 *   displacing another subscription; this module reports the skipped count when it changes.
 */

import {
  PREWARM_REFRESH_INTERVAL_MS,
  type PrewarmOutcome
} from '../services/blitzortung.js';
import { logger } from '../utils/logger.js';

export interface PrewarmScheduler {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

export interface LightningPrewarmDeps {
  /** `toolConfig.isEnabled('get_lightning_activity')`. */
  toolEnabled: boolean;
  /** The raw `WEATHER_LIGHTNING_PREWARM` value; `'false'` opts out. */
  optOutValue: string | undefined;
  /** Synchronous store read. May throw when the file is unreadable. */
  readSavedLocations: () => Array<{ latitude: number; longitude: number }>;
  prewarmLocation: (
    latitude: number,
    longitude: number,
    radiusKm?: number,
    outcome?: PrewarmOutcome
  ) => Promise<void>;
  scheduler?: PrewarmScheduler;
  intervalMs?: number;
}

export interface LightningPrewarmHandle {
  stop(): void;
}

const defaultScheduler: PrewarmScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle)
};

export function startLightningPrewarm(deps: LightningPrewarmDeps): LightningPrewarmHandle {
  if (deps.optOutValue === 'false' || !deps.toolEnabled) {
    return { stop: () => {} };
  }

  const scheduler = deps.scheduler ?? defaultScheduler;
  const intervalMs = deps.intervalMs ?? PREWARM_REFRESH_INTERVAL_MS;
  let unreadable = false;
  let lastSkipped = 0;

  // Not `async`: a synchronous throw from `prewarmLocation` must leave this function as a
  // throw, not be converted into a rejected promise nobody reads.
  const runOnce = (startup: boolean): Promise<void> => {
    let savedLocations;
    try {
      savedLocations = deps.readSavedLocations();
    } catch (error) {
      if (!unreadable) {
        logger.warn('Skipping lightning pre-warm: saved locations could not be read', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      unreadable = true;
      return Promise.resolve();
    }
    unreadable = false;

    if (startup && savedLocations.length > 0) {
      logger.info('Pre-warming lightning monitoring for saved locations', {
        count: savedLocations.length
      });
    } else if (!startup) {
      logger.debug('Refreshing lightning pre-warm for saved locations', {
        count: savedLocations.length
      });
    }

    // No await between the read and this loop, and every call is started before any is
    // awaited: the service's single-flight import and `isConnecting` guard are built for
    // concurrent entry. Each call gets its own outcome object.
    const outcomes: PrewarmOutcome[] = [];
    const pending: Promise<void>[] = [];
    for (const location of savedLocations) {
      const outcome: PrewarmOutcome = {};
      outcomes.push(outcome);
      pending.push(deps.prewarmLocation(location.latitude, location.longitude, undefined, outcome));
    }

    return Promise.all(pending).then(() => {
      const skipped = outcomes.filter((o) => o.status === 'skipped-capacity').length;
      if (skipped !== lastSkipped) {
        if (skipped > 0) {
          logger.warn('Lightning pre-warm skipped saved locations: subscription limit reached', {
            skipped,
            total: outcomes.length
          });
        } else {
          logger.debug('Lightning pre-warm no longer skipping saved locations');
        }
        lastSkipped = skipped;
      }
    });
  };

  void runOnce(true);
  const handle = scheduler.setInterval(() => {
    void runOnce(false);
  }, intervalMs);

  let stopped = false;
  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      scheduler.clearInterval(handle);
    }
  };
}
