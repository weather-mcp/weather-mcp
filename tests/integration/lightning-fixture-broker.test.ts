/**
 * get_lightning_activity against an in-process MQTT broker.
 *
 * The real `mqtt` client connects, subscribes and receives from an `aedes`
 * broker on an ephemeral loopback port, so the whole path runs offline under
 * tests/setup/loopback-only.ts. The fixture publishes known strikes, so this
 * file can pin what the live broker test never could: strikes inside the
 * radius are counted, strikes outside are not, the nearest distance and age
 * are rendered, and the safety level follows the nearest distance.
 *
 * Order matters. `BlitzortungService` reads `BLITZORTUNG_MQTT_URL` once, as a
 * class field, and the module exports a singleton built at import. So the
 * broker starts and the variable is set before the first import of anything
 * that reaches src/services/blitzortung.ts. This file has no static import of
 * such a module; types come in through `import type` only.
 *
 * Each query waits the service's fixed 10 s collection window, so the file
 * runs two queries, one after the other, on real timers. A loopback `mqtt://`
 * URL makes the service log its plaintext-broker SECURITY warning. That is
 * expected here.
 */

import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { Aedes } from 'aedes';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type * as LightningHandlerModule from '../../src/handlers/lightningHandler.js';
import type * as BlitzortungModule from '../../src/services/blitzortung.js';

/** One degree of latitude in km, close enough for strikes planted due north. */
const KM_PER_DEG_LAT = 111.195;

interface PlantedStrike {
  northKm: number;
  ageMinutes: number;
}

let broker: Aedes;
let server: net.Server;
let handler: typeof LightningHandlerModule;
let service: typeof BlitzortungModule;

/** What to publish on the next SUBSCRIBE: one scenario's strikes, relative to its centre. */
let pending: { lat: number; lon: number; strikes: PlantedStrike[] } | null = null;

function publishPlanted(topic: string): void {
  if (!pending) return;
  const { lat, lon, strikes } = pending;
  pending = null;
  // Built at publish time, never at module load, so no strike has aged out (G67).
  for (const s of strikes) {
    const payload = {
      lat: lat + s.northKm / KM_PER_DEG_LAT,
      lon,
      time: (Date.now() - s.ageMinutes * 60_000) * 1e6, // nanoseconds, as Blitzortung sends
      pol: 0,
      mcs: 0,
      stat: 9
    };
    broker.publish(
      { cmd: 'publish', topic, payload: Buffer.from(JSON.stringify(payload)), qos: 0, retain: false, dup: false },
      () => undefined
    );
  }
}

beforeAll(async () => {
  broker = await Aedes.createBroker();
  // The service never filters by topic, so every strike goes to the first subscribed topic,
  // with its `#` replaced by a concrete level.
  broker.on('subscribe', (subs, client) => {
    if (!client) return;
    const first = subs[0]?.topic;
    if (first === undefined) return;
    setImmediate(() => publishPlanted(first.replace(/#$/, '0')));
  });
  server = net.createServer(broker.handle);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  vi.stubEnv('BLITZORTUNG_MQTT_URL', `mqtt://127.0.0.1:${port}`);
  handler = await import('../../src/handlers/lightningHandler.js');
  service = await import('../../src/services/blitzortung.js');
});

afterAll(async () => {
  await service?.blitzortungService.disconnect();
  await new Promise<void>(resolve => broker.close(() => resolve()));
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

describe('get_lightning_activity against a fixture broker', () => {
  it('counts only strikes inside the radius and bands on the nearest one', async () => {
    const lat = 35.0;
    const lon = -97.0;
    pending = {
      lat,
      lon,
      strikes: [
        { northKm: 5, ageMinutes: 3 },
        { northKm: 20, ageMinutes: 6 },
        { northKm: 40, ageMinutes: 9 },
        { northKm: 110, ageMinutes: 4 }, // outside the 100 km radius
        { northKm: 300, ageMinutes: 4 } // outside the 100 km radius
      ]
    };

    const result = await handler.getLightningActivity({ latitude: lat, longitude: lon, radius: 100, timeWindow: 60 });

    expect(result.statistics.totalStrikes).toBe(3);
    expect(result.statistics.nearestDistance).not.toBeNull();
    expect(Math.abs((result.statistics.nearestDistance ?? NaN) - 5)).toBeLessThan(0.5);
    expect(result.safety.level).toBe('extreme');

    const text = handler.formatLightningActivityResponse(result);
    expect(text).toContain('**Total Strikes:** 3');
    const ages = [...text.matchAll(/\((\d+\.\d) minutes ago\)/g)].map(m => Number(m[1]));
    expect(ages.length).toBeGreaterThan(0);
    // Strikes are listed nearest first; the nearest was planted 3 minutes old.
    expect(Math.abs(ages[0] - 3)).toBeLessThanOrEqual(1);
  }, 30_000);

  it('bands a single strike at about 30 km as elevated, on another continent', async () => {
    const lat = 48.0;
    const lon = 11.0;
    pending = { lat, lon, strikes: [{ northKm: 30, ageMinutes: 5 }] };

    const result = await handler.getLightningActivity({ latitude: lat, longitude: lon, radius: 100, timeWindow: 60 });

    expect(result.statistics.totalStrikes).toBe(1);
    expect(result.safety.level).toBe('elevated');
  }, 30_000);

  describe('Validation', () => {
    it('should reject invalid radius', async () => {
      await expect(
        handler.getLightningActivity({
          latitude: 40.7128,
          longitude: -74.006,
          radius: 600 // Exceeds max
        })
      ).rejects.toThrow();
    });

    it('should reject invalid time window', async () => {
      await expect(
        handler.getLightningActivity({
          latitude: 40.7128,
          longitude: -74.006,
          timeWindow: 200 // Exceeds max
        })
      ).rejects.toThrow();
    });

    it('should reject invalid coordinates', async () => {
      await expect(
        handler.getLightningActivity({
          latitude: -95, // Invalid
          longitude: -74.006
        })
      ).rejects.toThrow();
    });
  });
});
