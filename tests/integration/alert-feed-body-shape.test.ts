/**
 * Alert-feed body-shape refusal against the real axios adapter.
 *
 * This file makes NO external network calls. It starts one HTTP server on
 * 127.0.0.1 (port 0) and points MeteoAlarmService and GeoMetService at it.
 *
 * Why it exists: a real bodiless 200 reaches the envelope guard as '' (G111), not
 * null, and no stubbed adapter proves that. Each refusal row asserts the exact
 * fixed message and that the server saw exactly one request (never retried).
 * Each service has an honest-empty control that resolves [].
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MeteoAlarmService } from '../../src/services/meteoalarm.js';
import { GeoMetService } from '../../src/services/geomet.js';

type Mode = 'empty-json' | 'html' | 'honest-meteoalarm' | 'honest-geomet';

let server: http.Server;
let origin: string;
let mode: Mode = 'empty-json';
let requests = 0;
const savedNoProxy = { upper: process.env.NO_PROXY, lower: process.env.no_proxy };

beforeAll(async () => {
  // Loopback must bypass any proxy in the environment (G119), or axios sends it to the proxy.
  process.env.NO_PROXY = '127.0.0.1,localhost';
  process.env.no_proxy = '127.0.0.1,localhost';
  server = http.createServer((_req, res) => {
    requests += 1;
    switch (mode) {
      case 'empty-json':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end();
        return;
      case 'html':
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>Maintenance</body></html>');
        return;
      case 'honest-meteoalarm':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"warnings":[]}');
        return;
      case 'honest-geomet':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"type":"FeatureCollection","features":[],"numberMatched":0}');
        return;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const [key, value] of [['NO_PROXY', savedNoProxy.upper], ['no_proxy', savedNoProxy.lower]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  requests = 0;
});

const METEOALARM_MESSAGE = 'MeteoAlarm feed returned an unexpected shape';
const GEOMET_MESSAGE = 'GeoMet API returned an unexpected shape';

describe('alert feeds refuse a wrong-shaped 200 over real axios', () => {
  const refusals: Array<{ service: string; mode: Mode; message: string; call: () => Promise<unknown> }> = [
    {
      service: 'MeteoAlarm',
      mode: 'empty-json',
      message: METEOALARM_MESSAGE,
      call: () => new MeteoAlarmService({ baseURL: origin }).getWarnings('de')
    },
    {
      service: 'MeteoAlarm',
      mode: 'html',
      message: METEOALARM_MESSAGE,
      call: () => new MeteoAlarmService({ baseURL: origin }).getWarnings('de')
    },
    {
      service: 'GeoMet',
      mode: 'empty-json',
      message: GEOMET_MESSAGE,
      call: () => new GeoMetService({ baseURL: origin, maxRetries: 0 }).getAlerts(43.6532, -79.3832)
    },
    {
      service: 'GeoMet',
      mode: 'html',
      message: GEOMET_MESSAGE,
      call: () => new GeoMetService({ baseURL: origin, maxRetries: 0 }).getAlerts(43.6532, -79.3832)
    }
  ];

  for (const row of refusals) {
    it(`${row.service}: ${row.mode} 200 rejects with the fixed message after one request`, async () => {
      mode = row.mode;
      await expect(row.call()).rejects.toThrow(row.message);
      expect(requests).toBe(1);
    });
  }

  it('control: MeteoAlarm honest-empty envelope resolves []', async () => {
    mode = 'honest-meteoalarm';
    await expect(new MeteoAlarmService({ baseURL: origin }).getWarnings('de')).resolves.toEqual([]);
    expect(requests).toBe(1);
  });

  it('control: GeoMet honest-empty collection resolves []', async () => {
    mode = 'honest-geomet';
    await expect(
      new GeoMetService({ baseURL: origin, maxRetries: 0 }).getAlerts(43.6532, -79.3832)
    ).resolves.toEqual([]);
    expect(requests).toBe(1);
  });
});
