/**
 * Unit tests for the pure Blitzortung message parser and bounded strike buffer.
 *
 * Reject rows ported from weather-mcp/weather-mcp#132 by MagicCactus42
 * (restated as contracts: each names its reject reason).
 */

import { describe, it, expect } from 'vitest';
import {
  parseStrike,
  StrikeBuffer,
  STRIKE_PAYLOAD_MAX_BYTES,
  STRIKE_FUTURE_SKEW_MS
} from '../../src/utils/strikeBuffer.js';
import type { LightningStrike } from '../../src/types/lightning.js';

// now * 1e6 round-trips through float to the exact ms value (asserted below).
const now = 1762715394083;
const nsTime = now * 1e6;

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function body(fields: Record<string, unknown>): Uint8Array {
  return encode(JSON.stringify(fields));
}

function strikeAt(timestampMs: number, latitude: number, longitude: number): LightningStrike {
  return {
    timestamp: new Date(timestampMs),
    latitude,
    longitude,
    polarity: 0,
    amplitude: 0,
    stationCount: undefined,
    distance: 0
  };
}

describe('parseStrike', () => {
  describe('ported reject rows (PR #132)', () => {
    it('rejects a string latitude as bad_coordinate', () => {
      expect(parseStrike(body({ lat: '40', lon: -100, time: now }), now)).toEqual({ ok: false, reason: 'bad_coordinate' });
    });

    it('rejects an array latitude as bad_coordinate', () => {
      expect(parseStrike(body({ lat: [40], lon: -100, time: now }), now)).toEqual({ ok: false, reason: 'bad_coordinate' });
    });

    it('rejects an object longitude as bad_coordinate', () => {
      expect(parseStrike(body({ lat: 40, lon: { v: -100 }, time: now }), now)).toEqual({ ok: false, reason: 'bad_coordinate' });
    });

    it('rejects a string time as bad_time', () => {
      expect(parseStrike(body({ lat: 40, lon: -100, time: String(now) }), now)).toEqual({ ok: false, reason: 'bad_time' });
    });

    it('rejects a 1e999 latitude (parses to Infinity) as bad_coordinate', () => {
      const payload = encode(`{"lat":1e999,"lon":-100,"time":${now}}`);
      expect(parseStrike(payload, now)).toEqual({ ok: false, reason: 'bad_coordinate' });
    });

    it('rejects latitude 91 as bad_coordinate', () => {
      expect(parseStrike(body({ lat: 91, lon: -100, time: now }), now)).toEqual({ ok: false, reason: 'bad_coordinate' });
    });

    it('rejects longitude -181 as bad_coordinate', () => {
      expect(parseStrike(body({ lat: 40, lon: -181, time: now }), now)).toEqual({ ok: false, reason: 'bad_coordinate' });
    });

    it('accepts wrong-typed optional fields with defaults', () => {
      const r = parseStrike(body({ lat: 40, lon: -100, time: now, pol: 'x', mcs: '12', stat: '9' }), now);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.strike.polarity).toBe(0);
        expect(r.strike.amplitude).toBe(0);
        expect(r.strike.stationCount).toBeUndefined();
      }
    });
  });

  describe('accepts', () => {
    it('accepts the live sample shape: a nanosecond time converts to the exact ms timestamp', () => {
      expect(Math.floor(nsTime / 1000000)).toBe(now);
      const r = parseStrike(encode(`{"time":${nsTime},"lat":40.5,"lon":-100.25,"alt":0,"sig":[]}`), now);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.strike.timestamp.getTime()).toBe(now);
        expect(r.strike.latitude).toBe(40.5);
        expect(r.strike.longitude).toBe(-100.25);
      }
    });

    it('accepts a millisecond time unchanged', () => {
      const r = parseStrike(body({ lat: 40, lon: -100, time: now - 1000 }), now);
      expect(r.ok && r.strike.timestamp.getTime()).toBe(now - 1000);
    });

    it('accepts latitude 0', () => {
      const r = parseStrike(body({ lat: 0, lon: -100, time: now }), now);
      expect(r.ok && r.strike.latitude).toBe(0);
    });

    it('accepts longitude 0', () => {
      const r = parseStrike(body({ lat: 40, lon: 0, time: now }), now);
      expect(r.ok && r.strike.longitude).toBe(0);
    });

    it.each([
      [90, 180], [-90, -180], [90, -180], [-90, 180]
    ])('accepts the exact bounds lat %d lon %d', (lat, lon) => {
      expect(parseStrike(body({ lat, lon, time: now }), now).ok).toBe(true);
    });

    it('keeps numeric pol, mcs and stat as sent', () => {
      const r = parseStrike(body({ lat: 40, lon: -100, time: now, pol: -1, mcs: 12.5, stat: 9 }), now);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.strike.polarity).toBe(-1);
        expect(r.strike.amplitude).toBe(12.5);
        expect(r.strike.stationCount).toBe(9);
      }
    });

    it('has the base key order with stationCount present and distance 0', () => {
      const r = parseStrike(body({ lat: 40, lon: -100, time: now }), now);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(Object.keys(r.strike)).toEqual([
          'timestamp', 'latitude', 'longitude', 'polarity', 'amplitude', 'stationCount', 'distance'
        ]);
        expect(r.strike.distance).toBe(0);
      }
    });

    it('accepts a time exactly at the future skew', () => {
      expect(STRIKE_FUTURE_SKEW_MS).toBe(300000);
      expect(parseStrike(body({ lat: 40, lon: -100, time: now + 300000 }), now).ok).toBe(true);
    });
  });

  describe('rejects', () => {
    it('rejects an oversize payload before decoding it', () => {
      // The cap is pinned to its literal: the rows below build from the constant, so a changed value
      // would move them with it (G160).
      expect(STRIKE_PAYLOAD_MAX_BYTES).toBe(4096);
      // 0xff is never valid UTF-8; a decode-then-parse order would yield not_json instead.
      const payload = new Uint8Array(STRIKE_PAYLOAD_MAX_BYTES + 1).fill(0xff);
      expect(parseStrike(payload, now)).toEqual({ ok: false, reason: 'oversize' });
    });

    it('rejects an oversize payload of valid-looking JSON', () => {
      const pad = ' '.repeat(STRIKE_PAYLOAD_MAX_BYTES);
      const payload = encode(`{"lat":40,"lon":-100,"time":${now}}${pad}`);
      expect(payload.byteLength).toBeGreaterThan(STRIKE_PAYLOAD_MAX_BYTES);
      expect(parseStrike(payload, now)).toEqual({ ok: false, reason: 'oversize' });
    });

    it('accepts a payload of exactly the maximum size', () => {
      const core = `{"lat":40,"lon":-100,"time":${now}}`;
      const payload = encode(core + ' '.repeat(STRIKE_PAYLOAD_MAX_BYTES - core.length));
      expect(payload.byteLength).toBe(STRIKE_PAYLOAD_MAX_BYTES);
      expect(parseStrike(payload, now).ok).toBe(true);
    });

    it('rejects truncated JSON as not_json', () => {
      expect(parseStrike(encode('{'), now)).toEqual({ ok: false, reason: 'not_json' });
    });

    it.each(['null', '[]', '42', '"s"'])('rejects %s as not_object', (text) => {
      expect(parseStrike(encode(text), now)).toEqual({ ok: false, reason: 'not_object' });
    });

    it('rejects a missing lat as bad_coordinate', () => {
      expect(parseStrike(body({ lon: -100, time: now }), now)).toEqual({ ok: false, reason: 'bad_coordinate' });
    });

    it('rejects lat null as bad_coordinate', () => {
      expect(parseStrike(body({ lat: null, lon: -100, time: now }), now)).toEqual({ ok: false, reason: 'bad_coordinate' });
    });

    it.each([0, -5])('rejects time %d as bad_time', (time) => {
      expect(parseStrike(body({ lat: 40, lon: -100, time }), now)).toEqual({ ok: false, reason: 'bad_time' });
    });

    it('rejects a missing time as bad_time', () => {
      expect(parseStrike(body({ lat: 40, lon: -100 }), now)).toEqual({ ok: false, reason: 'bad_time' });
    });

    it('rejects a time one ms past the future skew', () => {
      expect(parseStrike(body({ lat: 40, lon: -100, time: now + 300000 + 1 }), now))
        .toEqual({ ok: false, reason: 'future' });
    });

    it('carries only the reason: no parse text escapes', () => {
      const r = parseStrike(encode('secret-token-abc {'), now);
      expect(Object.keys(r)).toEqual(['ok', 'reason']);
      expect(JSON.stringify(r)).not.toContain('secret-token-abc');
    });
  });

  describe('key', () => {
    it('is time_lat_lon from the raw fields for a ms time', () => {
      const r = parseStrike(body({ lat: 40.5, lon: -100.25, time: now }), now);
      expect(r.ok && r.key).toBe(`${now}_40.5_-100.25`);
    });

    it('uses the nanosecond form for a nanosecond time', () => {
      const r = parseStrike(encode(`{"time":${nsTime},"lat":40.5,"lon":-100.25}`), now);
      expect(r.ok && r.key).toBe(`${nsTime}_40.5_-100.25`);
      expect(r.ok && r.key).not.toBe(`${now}_40.5_-100.25`);
    });
  });
});

describe('StrikeBuffer', () => {
  const retentionMs = 60 * 60 * 1000;

  it('trims nothing below the cap', () => {
    const buf = new StrikeBuffer({ maxSize: 10, retentionMs });
    for (let i = 0; i < 9; i++) {
      expect(buf.add(`k${i}`, strikeAt(now, 40, -100)).trimmed).toBe(0);
    }
    expect(buf.size).toBe(9);
  });

  it('trims the oldest 10% by insertion order at the cap and keeps the newest', () => {
    const buf = new StrikeBuffer({ maxSize: 20, retentionMs });
    for (let i = 0; i < 20; i++) {
      buf.add(`k${i}`, strikeAt(now, 40, -100));
    }
    const result = buf.add('newest', strikeAt(now, 40, -100));
    expect(result.trimmed).toBe(Math.floor(20 * 0.1));
    expect(buf.size).toBe(19);
    expect(buf.has('k0')).toBe(false);
    expect(buf.has('k1')).toBe(false);
    expect(buf.has('k2')).toBe(true);
    expect(buf.has('newest')).toBe(true);
  });

  it('still trims when the key at the cap is a duplicate', () => {
    const buf = new StrikeBuffer({ maxSize: 20, retentionMs });
    for (let i = 0; i < 20; i++) {
      buf.add(`k${i}`, strikeAt(now, 40, -100));
    }
    const result = buf.add('k19', strikeAt(now, 41, -100));
    expect(result.trimmed).toBe(2);
    expect(buf.size).toBe(18);
  });

  describe('query', () => {
    it('excludes strikes before the cutoff, includes one exactly at it', () => {
      const buf = new StrikeBuffer({ maxSize: 100, retentionMs });
      const windowMinutes = 30;
      const cutoff = now - windowMinutes * 60 * 1000;
      buf.add('before', strikeAt(cutoff - 1, 40, -100));
      buf.add('at', strikeAt(cutoff, 40, -100));
      const r = buf.query(40, -100, 50, windowMinutes, now);
      expect(r).toHaveLength(1);
      expect(r[0].timestamp.getTime()).toBe(cutoff);
    });

    it('excludes strikes beyond the radius and sorts the rest by distance', () => {
      const buf = new StrikeBuffer({ maxSize: 100, retentionMs });
      buf.add('mid', strikeAt(now, 40, -99));    // about 85 km
      buf.add('far', strikeAt(now, 42, -100));   // about 222 km
      buf.add('near', strikeAt(now, 40.1, -100)); // about 11 km
      const r = buf.query(40, -100, 100, 60, now);
      expect(r.map(s => s.latitude)).toEqual([40.1, 40]);
      expect(r[0].distance).toBeGreaterThan(0);
      expect(r[0].distance).toBeLessThan(r[1].distance as number);
      expect(r[1].distance).toBeLessThanOrEqual(100);
    });

    it('does not mutate the stored strike', () => {
      const buf = new StrikeBuffer({ maxSize: 100, retentionMs });
      buf.add('a', strikeAt(now, 40.1, -100));
      buf.query(40, -100, 100, 60, now);
      const again = buf.query(40, -100, 100, 60, now);
      expect(again).toHaveLength(1);
    });
  });

  describe('prune', () => {
    it('removes exactly the strikes older than now - retentionMs and returns the count', () => {
      const buf = new StrikeBuffer({ maxSize: 100, retentionMs });
      const cutoff = now - retentionMs;
      buf.add('old1', strikeAt(cutoff - 2, 40, -100));
      buf.add('old2', strikeAt(cutoff - 1, 40, -100));
      buf.add('edge', strikeAt(cutoff, 40, -100));
      buf.add('new', strikeAt(now, 40, -100));
      expect(buf.prune(now)).toBe(2);
      expect(buf.size).toBe(2);
      expect(buf.has('edge')).toBe(true);
      expect(buf.has('new')).toBe(true);
      expect(buf.prune(now)).toBe(0);
    });
  });
});
