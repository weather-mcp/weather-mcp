/**
 * Upstream response bounds against the real axios adapter.
 *
 * This file makes NO external network call. Two HTTP servers listen on 127.0.0.1
 * (port 0): `origin`, which the service under test is pointed at, and `target`,
 * which a redirect names. A redirect that is followed shows up as a `target` hit;
 * a retry shows up as a second `origin` hit. No test passes `maxRetries: 0`, so the
 * one-request counts prove the retry ladder is off for these failure classes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NOAAService } from '../../src/services/noaa.js';
import { MeteoAlarmService } from '../../src/services/meteoalarm.js';
import { OpenMeteoService, OPENMETEO_MAX_RESPONSE_BYTES } from '../../src/services/openmeteo.js';
import { NCEIService, NCEI_MAX_RESPONSE_BYTES } from '../../src/services/ncei.js';
import { formatErrorForUser, type ApiError } from '../../src/errors/ApiError.js';
import { CacheConfig } from '../../src/config/cache.js';
import { logger, LogLevel } from '../../src/utils/logger.js';

const PROXY_VARS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'
] as const;

// Synthetic, and spelled so a leak-scan hit on this file is recognisable (G112).
const NCEI_FIXTURE_TOKEN = 'tk-ncei-hyg-7731';

type Mode = 'redirect' | 'oversize' | 'exact' | 'ncei-oversize';

interface Fixture {
  server: http.Server;
  url: string;
  hits: number;
}

let origin: Fixture;
let target: Fixture;
let mode: Mode = 'redirect';
let savedEnv: Record<string, string | undefined> = {};
let savedCache = true;
let savedLevel: LogLevel;

function jsonPadded(totalBytes: number): string {
  const head = '{"pad":0}';
  return head + ' '.repeat(totalBytes - head.length);
}

async function listen(handler: http.RequestListener): Promise<Fixture> {
  const fixture = { hits: 0, url: '' } as Fixture;
  fixture.server = http.createServer((req, res) => {
    fixture.hits++;
    handler(req, res);
  });
  await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  fixture.url = `http://127.0.0.1:${(fixture.server.address() as AddressInfo).port}`;
  return fixture;
}

async function close(fixture: Fixture): Promise<void> {
  fixture.server.closeAllConnections();
  await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a rejection, the call resolved');
}

function expectCleanRender(error: Error, fixed: string): void {
  const rendered = formatErrorForUser(error);
  expect(rendered).toContain(fixed);
  expect(rendered).not.toContain('maxContentLength');
  expect(rendered).not.toContain('127.0.0.1');
}

beforeAll(async () => {
  savedEnv = {};
  for (const name of PROXY_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  savedCache = CacheConfig.enabled;
  (CacheConfig as { enabled: boolean }).enabled = false;
  savedLevel = logger.getLevel();
  logger.setLevel(LogLevel.ERROR + 1);

  target = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  origin = await listen((_req, res) => {
    if (mode === 'redirect') {
      res.writeHead(301, { location: `${target.url}/points/39.7456,-97.0892` });
      res.end();
      return;
    }
    const size = mode === 'ncei-oversize' ? NCEI_MAX_RESPONSE_BYTES + 1 : mode === 'oversize' ? OPENMETEO_MAX_RESPONSE_BYTES + 1 : OPENMETEO_MAX_RESPONSE_BYTES;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(jsonPadded(size));
  });
});

afterAll(async () => {
  await close(origin);
  await close(target);
  for (const name of PROXY_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  (CacheConfig as { enabled: boolean }).enabled = savedCache;
  logger.setLevel(savedLevel);
});

beforeEach(() => {
  origin.hits = 0;
  target.hits = 0;
});

describe('upstream response bounds on the real transport', () => {
  it('(a) NOAA does not follow a 301 and ends in the fixed status text', async () => {
    mode = 'redirect';
    const service = new NOAAService({ baseURL: origin.url });
    const error = await rejection(service.getPointData(39.7456, -97.0892));
    expect(error.message).toBe('NOAA returned status 301');
    expect(origin.hits).toBe(1);
    expect(target.hits).toBe(0);
    expectCleanRender(error, 'NOAA returned status 301');
  });

  it('(b) MeteoAlarm does not follow a 301 and ends in the fixed status text', async () => {
    mode = 'redirect';
    const service = new MeteoAlarmService({ baseURL: origin.url });
    const error = await rejection(service.getWarnings('de'));
    expect(error.message).toBe('MeteoAlarm API returned status 301');
    expect(origin.hits).toBe(1);
    expect(target.hits).toBe(0);
    expectCleanRender(error, 'MeteoAlarm API returned status 301');
  });

  it('(c) Open-Meteo rejects a body one byte over the cap, once', async () => {
    mode = 'oversize';
    const service = new OpenMeteoService({ forecastURL: origin.url });
    const error = await rejection(service.getForecast(39.7456, -97.0892));
    expect(error.message).toContain('Open-Meteo response too large');
    expect(origin.hits).toBe(1);
    expectCleanRender(error, 'Open-Meteo response too large');
  });

  it('(d) Open-Meteo does not call a body of exactly the cap too large', async () => {
    mode = 'exact';
    const service = new OpenMeteoService({ forecastURL: origin.url });
    const outcome = await service.getForecast(39.7456, -97.0892).then(
      () => null,
      (error: Error) => error
    );
    if (outcome !== null) {
      expect(outcome.message).not.toContain('too large');
    }
    expect(origin.hits).toBe(1);
  });

  it('(e) NCEI does not follow a 301 and ends in the fixed status text', async () => {
    mode = 'redirect';
    const service = new NCEIService({ baseURL: origin.url, token: NCEI_FIXTURE_TOKEN });
    const error = await rejection(service.getClimateNormals(39.7456, -97.0892, 7, 15));
    expect((error as ApiError).userMessage).toBe('NCEI API returned status 301');
    expect(origin.hits).toBe(1);
    expect(target.hits).toBe(0);
    expectCleanRender(error, 'NCEI API returned status 301');
    expect(formatErrorForUser(error)).not.toContain(NCEI_FIXTURE_TOKEN);
  });

  it('(f) NCEI rejects a body one byte over its cap, once', async () => {
    mode = 'ncei-oversize';
    const service = new NCEIService({ baseURL: origin.url, token: NCEI_FIXTURE_TOKEN });
    const error = await rejection(service.getClimateNormals(39.7456, -97.0892, 7, 15));
    expect((error as ApiError).userMessage).toBe('NCEI response too large');
    expect(origin.hits).toBe(1);
    expectCleanRender(error, 'NCEI response too large');
    expect(formatErrorForUser(error)).not.toContain(NCEI_FIXTURE_TOKEN);
  });
});
