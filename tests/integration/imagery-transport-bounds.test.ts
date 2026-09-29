/**
 * Imagery transport bounds against the real axios adapter.
 *
 * This file makes NO external network calls. It starts one HTTP server on
 * 127.0.0.1 (port 0) and points the three imagery clients at it, so it is not
 * one of the live-network integration files and cannot flake a release.
 *
 * Why it exists: an assertion on the option object passes even if the option does
 * nothing. Here the real adapter must refuse a redirect (the target is never hit)
 * and an over-cap body (declared or streamed), and must let an exactly-cap body
 * through the transport. Each row has a positive control.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { RainViewerService, RAINVIEWER_MAX_METADATA_BYTES } from '../../src/services/rainviewer.js';
import { RADAR_TILE_REQUEST_CONFIG } from '../../src/handlers/weatherImageryHandler.js';
import { basemapService } from '../../src/services/basemap.js';
import {
  RADAR_TILE_MAX_BYTES,
  BASEMAP_TILE_MAX_BYTES,
  assertTileHeader,
  PNG,
  encodePng
} from '../../src/utils/composite.js';
import { ServiceUnavailableError } from '../../src/errors/ApiError.js';

const FEED = JSON.stringify({
  version: '2.0',
  generated: 1700000000,
  host: 'https://tilecache.rainviewer.com',
  radar: { past: [{ time: 1700000000, path: '/v2/radar/1700000000' }], nowcast: [] }
});

function pngOf(size: number): Buffer {
  return encodePng(new PNG({ width: size, height: size }));
}

let server: http.Server;
let origin: string;
let targetHits = 0;
const png512 = pngOf(512);
const png256 = pngOf(256);

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = url.pathname.split('/')[1];
    const n = Number(url.searchParams.get('n') ?? 0);
    switch (route) {
      case 'ok-json':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(FEED);
        return;
      case 'ok-empty':
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end();
        return;
      case 'ok-png-512':
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(png512);
        return;
      case 'ok-png-256':
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(png256);
        return;
      case 'redirect':
        res.writeHead(302, { location: '/target' });
        res.end();
        return;
      case 'target':
        targetHits += 1;
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(png256);
        return;
      case 'pad':
      case 'pad-chunked': {
        // A valid feed padded with trailing spaces to exactly n bytes.
        const body = Buffer.concat([Buffer.from(FEED), Buffer.alloc(n - Buffer.byteLength(FEED), 0x20)]);
        const headers: http.OutgoingHttpHeaders = { 'content-type': 'application/json' };
        if (route === 'pad') {
          headers['content-length'] = body.length;
        }
        res.writeHead(200, headers);
        res.write(body);
        res.end();
        return;
      }
      case 'big':
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': n });
        res.end(Buffer.alloc(n));
        return;
      case 'big-chunked':
        // No Content-Length: the cap must bite while streaming, not on the header.
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.write(Buffer.alloc(n));
        res.end();
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  targetHits = 0;
});

describe('RainViewer metadata transport', () => {
  function serviceAt(route: string): RainViewerService {
    const svc = new RainViewerService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).client.defaults.baseURL = `${origin}/${route}`;
    return svc;
  }

  it('control: a valid feed resolves', async () => {
    const data = await serviceAt('ok-json').getRadarData();
    expect(data.radar.past).toHaveLength(1);
  });

  it('refuses a redirect and never requests the target', async () => {
    await expect(serviceAt('redirect').getRadarData()).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(targetHits).toBe(0);
  });

  for (const route of ['big', 'big-chunked']) {
    it(`/${route}: cap+1 is rejected by the transport`, async () => {
      // A valid feed padded to cap+1: without the cap it would resolve, so a
      // rejection can only come from the transport.
      const svc = new RainViewerService();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).client.defaults.baseURL = `${origin}/${route === 'big' ? 'pad' : 'pad-chunked'}`;
      // The query rides on the fixed suffix: /public/weather-maps.json?n=...
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).client.defaults.params = { n: RAINVIEWER_MAX_METADATA_BYTES + 1 };
      // The service sanitizes the axios message, so the rejection type is the signal.
      await expect(svc.getRadarData()).rejects.toBeInstanceOf(ServiceUnavailableError);
    });

    it(`/${route}: exactly the cap is not refused by the transport`, async () => {
      // A valid feed padded to exactly the cap resolves; only the size differs from cap+1.
      const svc = new RainViewerService();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).client.defaults.baseURL = `${origin}/${route === 'big' ? 'pad' : 'pad-chunked'}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).client.defaults.params = { n: RAINVIEWER_MAX_METADATA_BYTES };
      const data = await svc.getRadarData();
      expect(data.radar.past).toHaveLength(1);
    });
  }
});

describe('radar tile transport (RADAR_TILE_REQUEST_CONFIG)', () => {
  it('control: a valid 512px PNG resolves and passes the header check', async () => {
    const res = await axios.get<ArrayBuffer>(`${origin}/ok-png-512`, RADAR_TILE_REQUEST_CONFIG);
    const buf = Buffer.from(res.data);
    expect(buf.length).toBe(png512.length);
    expect(() => assertTileHeader(buf, 512)).not.toThrow();
  });

  it('refuses a redirect and never requests the target', async () => {
    await expect(axios.get(`${origin}/redirect`, RADAR_TILE_REQUEST_CONFIG)).rejects.toMatchObject({
      response: { status: 302 }
    });
    expect(targetHits).toBe(0);
  });

  for (const route of ['big', 'big-chunked']) {
    it(`/${route}: cap+1 rejects`, async () => {
      await expect(
        axios.get(`${origin}/${route}?n=${RADAR_TILE_MAX_BYTES + 1}`, RADAR_TILE_REQUEST_CONFIG)
      ).rejects.toThrow(/maxContentLength/);
    });

    it(`/${route}: exactly the cap resolves`, async () => {
      const res = await axios.get<ArrayBuffer>(
        `${origin}/${route}?n=${RADAR_TILE_MAX_BYTES}`,
        RADAR_TILE_REQUEST_CONFIG
      );
      expect(Buffer.from(res.data).length).toBe(RADAR_TILE_MAX_BYTES);
    });
  }
});

describe('GIBS basemap transport (basemapService client)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = (path: string) => (basemapService as any).client.get(`${origin}${path}`, { responseType: 'arraybuffer' });

  it('control: a valid 256px PNG resolves', async () => {
    const res = await get('/ok-png-256');
    expect(Buffer.from(res.data).length).toBe(png256.length);
  });

  it('refuses a redirect and never requests the target', async () => {
    await expect(get('/redirect')).rejects.toMatchObject({ response: { status: 302 } });
    expect(targetHits).toBe(0);
  });

  it('/big: cap+1 rejects', async () => {
    await expect(get(`/big?n=${BASEMAP_TILE_MAX_BYTES + 1}`)).rejects.toThrow(/maxContentLength/);
  });

  it('/big: exactly the cap resolves', async () => {
    const res = await get(`/big?n=${BASEMAP_TILE_MAX_BYTES}`);
    expect(Buffer.from(res.data).length).toBe(BASEMAP_TILE_MAX_BYTES);
  });

  it('/big-chunked: cap+1 rejects while streaming', async () => {
    await expect(get(`/big-chunked?n=${BASEMAP_TILE_MAX_BYTES + 1}`)).rejects.toThrow(/maxContentLength/);
  });
});

describe('empty body (G111)', () => {
  it('a bodiless 200 arrives as a zero-length buffer and fails the header check', async () => {
    const res = await axios.get<ArrayBuffer>(`${origin}/ok-empty`, RADAR_TILE_REQUEST_CONFIG);
    const buf = Buffer.from(res.data);
    expect(buf.length).toBe(0);
    expect(() => assertTileHeader(buf, 512)).toThrow(/512px non-interlaced PNG/);
  });
});
