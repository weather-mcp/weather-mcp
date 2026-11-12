/**
 * Blitzortung message parser and bounded strike buffer (pure: no logger, no clock, no timer).
 *
 * Invariant: the buffer holds only strikes with finite, in-range coordinates and a time no later
 * than ingest time plus STRIKE_FUTURE_SKEW_MS. `parseStrike` is the only way in.
 *
 * Latitude 0 and longitude 0 are valid and admitted, with no sentinel: the live sample (96 of 96
 * messages carry numeric lat/lon/time, none carries pol/mcs/stat) is the only evidence of the
 * feed's encodings of "missing" (GOTCHAS G56).
 */

import type { LightningStrike } from '../types/lightning.js';
import { calculateDistance } from './distance.js';

export type StrikeRejectReason =
  | 'oversize' | 'not_json' | 'not_object' | 'bad_coordinate' | 'bad_time' | 'future';

export type ParsedStrike =
  | { ok: true; key: string; strike: LightningStrike }
  | { ok: false; reason: StrikeRejectReason };

/** Observed 82-83 bytes; about 50x margin. */
export const STRIKE_PAYLOAD_MAX_BYTES = 4096;
export const STRIKE_FUTURE_SKEW_MS = 5 * 60 * 1000;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Parse one feed payload into a strike. A reject carries only its reason: nothing from the
 * payload or from a caught error leaves this function.
 */
export function parseStrike(payload: Uint8Array, now: number): ParsedStrike {
  if (payload.byteLength > STRIKE_PAYLOAD_MAX_BYTES) {
    return { ok: false, reason: 'oversize' };
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return { ok: false, reason: 'not_json' };
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'not_object' };
  }
  const data = value as Record<string, unknown>;
  const { lat, lon, time, pol, mcs, stat } = data;

  if (
    !isFiniteNumber(lat) || !isFiniteNumber(lon) ||
    Math.abs(lat) > 90 || Math.abs(lon) > 180
  ) {
    return { ok: false, reason: 'bad_coordinate' };
  }

  if (!isFiniteNumber(time) || !(time > 0)) {
    return { ok: false, reason: 'bad_time' };
  }

  // Blitzortung sends nanoseconds; convert to milliseconds.
  let timestampMs = time;
  if (time > 10000000000000) {
    // If timestamp is > year 2286 in milliseconds, it's probably in nanoseconds
    timestampMs = Math.floor(time / 1000000);
  }

  if (timestampMs > now + STRIKE_FUTURE_SKEW_MS) {
    return { ok: false, reason: 'future' };
  }

  const strike: LightningStrike = {
    timestamp: new Date(timestampMs),
    latitude: lat,
    longitude: lon,
    polarity: isFiniteNumber(pol) ? pol : 0,
    amplitude: isFiniteNumber(mcs) ? mcs : 0,
    stationCount: isFiniteNumber(stat) ? stat : undefined,
    distance: 0
  };

  return { ok: true, key: `${time}_${lat}_${lon}`, strike };
}

export class StrikeBuffer {
  private readonly strikes = new Map<string, LightningStrike>();
  private readonly maxSize: number;
  private readonly retentionMs: number;

  constructor(options: { maxSize: number; retentionMs: number }) {
    this.maxSize = options.maxSize;
    this.retentionMs = options.retentionMs;
  }

  get size(): number {
    return this.strikes.size;
  }

  has(key: string): boolean {
    return this.strikes.has(key);
  }

  /**
   * Add a strike; at capacity, first drop the oldest 10% by insertion order (also on a duplicate key).
   * At least one entry is dropped, so a cap below 10 still holds.
   */
  add(key: string, strike: LightningStrike): { trimmed: number } {
    let trimmed = 0;
    if (this.strikes.size >= this.maxSize) {
      const entriesToRemove = Math.max(1, Math.floor(this.maxSize * 0.1));
      const iterator = this.strikes.keys();
      for (let i = 0; i < entriesToRemove; i++) {
        const result = iterator.next();
        if (!result.done) {
          this.strikes.delete(result.value);
          trimmed++;
        }
      }
    }
    this.strikes.set(key, strike);
    return { trimmed };
  }

  query(
    centerLat: number,
    centerLon: number,
    radiusKm: number,
    windowMinutes: number,
    now: number
  ): LightningStrike[] {
    const cutoffTime = now - windowMinutes * 60 * 1000;
    const results: LightningStrike[] = [];

    for (const strike of this.strikes.values()) {
      if (strike.timestamp.getTime() < cutoffTime) {
        continue;
      }
      const distance = calculateDistance(centerLat, centerLon, strike.latitude, strike.longitude);
      if (distance <= radiusKm) {
        results.push({ ...strike, distance });
      }
    }

    results.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    return results;
  }

  /** Delete strikes older than the retention window; return how many. */
  prune(now: number): number {
    const cutoffTime = now - this.retentionMs;
    let removed = 0;
    for (const [key, strike] of this.strikes.entries()) {
      if (strike.timestamp.getTime() < cutoffTime) {
        this.strikes.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
