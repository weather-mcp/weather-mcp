/**
 * Locks the four `check_service_status` probe outcomes (`ok`, `rate_limited`,
 * `http_error`, `no_response`) for both `NOAAService.checkServiceStatus()` and
 * `OpenMeteoService.checkServiceStatus()`, driven through the *real* axios
 * client and its *real* response interceptor.
 *
 * Why not `vi.spyOn(client, 'get')`: that spy returns before the response
 * interceptor runs, so a probe's `catch` branch looks alive against a fixture
 * that never actually exercises the interceptor. Instead this file installs a
 * stub adapter on `client.defaults.adapter` that calls axios's own `settle`
 * (`axios/unsafe/core/settle.js`) — the same function the real HTTP adapter
 * calls — so `response.config.validateStatus` genuinely decides resolve vs.
 * reject, exactly as it does against the network. See GOTCHAS G45/G70.
 *
 * `src/services/noaa.ts` and `src/services/openmeteo.ts` reach their axios
 * client through a private field; the cast below is not typechecked by the
 * gate (GOTCHAS G103 — `tsconfig.json` excludes `tests/`), so the positive
 * control in the first `describe` block is what actually proves the seam
 * reaches the real interceptor, not the cast's type.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import { AxiosError } from 'axios';
// eslint-disable-next-line import/no-unresolved -- axios's own unsafe subpath export, verified live in node_modules
import settle from 'axios/unsafe/core/settle.js';
import { NOAAService } from '../../src/services/noaa.js';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { DataNotFoundError, ServiceUnavailableError } from '../../src/errors/ApiError.js';
import { classifyProbeStatus, type ServiceProbeResult } from '../../src/utils/serviceStatusProbe.js';
import { logger } from '../../src/utils/logger.js';

// -----------------------------------------------------------------------
// Stub adapter — reaches the real interceptor via axios's own `settle`
// -----------------------------------------------------------------------

type Answer = { status: number; data?: unknown } | { code: string };

function stubAdapter(client: AxiosInstance, answer: Answer): void {
  client.defaults.adapter = (config) =>
    new Promise((resolve, reject) => {
      if ('code' in answer) {
        reject(new AxiosError(`connect ${answer.code}`, answer.code, config));
        return;
      }
      settle(resolve, reject, {
        status: answer.status,
        statusText: '',
        headers: {},
        data: answer.data,
        config,
        request: {},
      });
    });
}

/** An adapter that rejects with a plain, non-axios Error — never a rejection axios itself produces. */
function stubThrowingAdapter(client: AxiosInstance): void {
  client.defaults.adapter = () => Promise.reject(new Error('boom'));
}

function getClient(service: NOAAService | OpenMeteoService): AxiosInstance {
  return (service as unknown as { client: AxiosInstance }).client;
}

// -----------------------------------------------------------------------
// Positive control (GOTCHAS G13/G45/G70): prove the stub reaches the real
// interceptor before trusting any probe contract below.
// -----------------------------------------------------------------------

describe('stub adapter reaches the real interceptor (positive control)', () => {
  it('NOAA client.get rejects with ServiceUnavailableError on a stubbed 503', async () => {
    const service = new NOAAService();
    const client = getClient(service);
    stubAdapter(client, { status: 503 });

    await expect(client.get('/anything')).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('NOAA client.get rejects with DataNotFoundError on a stubbed 404', async () => {
    const service = new NOAAService();
    const client = getClient(service);
    stubAdapter(client, { status: 404, data: {} });

    await expect(client.get('/anything')).rejects.toBeInstanceOf(DataNotFoundError);
  });
});

// -----------------------------------------------------------------------
// classifyProbeStatus — the pure status -> outcome mapping
// -----------------------------------------------------------------------

describe('classifyProbeStatus', () => {
  it('maps 200 to ok', () => {
    expect(classifyProbeStatus(200)).toBe('ok');
  });

  it('maps 429 to rate_limited', () => {
    expect(classifyProbeStatus(429)).toBe('rate_limited');
  });

  it.each([400, 404, 500, 503, 304, 204])('maps %i to http_error', (status) => {
    expect(classifyProbeStatus(status)).toBe('http_error');
  });
});

// -----------------------------------------------------------------------
// Per-service probe contracts
// -----------------------------------------------------------------------

interface ProbeServiceConfig {
  serviceName: 'NOAA' | 'Open-Meteo';
  apiName: 'NOAA Weather API' | 'Open-Meteo API';
  statusPage: string;
  loggerService: 'NOAA' | 'OpenMeteo';
  httpErrorStatus: number;
  createService: () => NOAAService | OpenMeteoService;
}

const NOAA_CONFIG: ProbeServiceConfig = {
  serviceName: 'NOAA',
  apiName: 'NOAA Weather API',
  statusPage: 'https://weather-gov.github.io/api/planned-outages',
  loggerService: 'NOAA',
  httpErrorStatus: 404,
  createService: () => new NOAAService(),
};

const OPENMETEO_CONFIG: ProbeServiceConfig = {
  serviceName: 'Open-Meteo',
  apiName: 'Open-Meteo API',
  statusPage: 'https://open-meteo.com/en/docs/model-updates',
  loggerService: 'OpenMeteo',
  httpErrorStatus: 400,
  createService: () => new OpenMeteoService(),
};

const CONFIGS: ProbeServiceConfig[] = [NOAA_CONFIG, OPENMETEO_CONFIG];

describe.each(CONFIGS)('$serviceName checkServiceStatus()', (config) => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it(`${config.serviceName} 200 with a body -> ok`, async () => {
    const service = config.createService();
    stubAdapter(getClient(service), { status: 200, data: { ok: true } });

    const result = await service.checkServiceStatus();

    expect(result.outcome).toBe('ok');
    expect(result.operational).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.message).toBe(`${config.apiName} answered normally (HTTP 200)`);
  });

  it(`${config.serviceName} 429 -> rate_limited, and logs a rate-limit warning`, async () => {
    const service = config.createService();
    stubAdapter(getClient(service), { status: 429, data: {} });

    const result = await service.checkServiceStatus();

    expect(result.outcome).toBe('rate_limited');
    expect(result.operational).toBe(false);
    expect(result.httpStatus).toBe(429);
    expect(result.message).toBe(`${config.apiName} answered HTTP 429: it is rate limiting this caller`);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Rate limit exceeded',
      expect.objectContaining({ service: config.loggerService, securityEvent: true })
    );
  });

  it(`${config.serviceName} ${config.httpErrorStatus} -> http_error`, async () => {
    const service = config.createService();
    stubAdapter(getClient(service), { status: config.httpErrorStatus, data: {} });

    const result = await service.checkServiceStatus();

    expect(result.outcome).toBe('http_error');
    expect(result.operational).toBe(false);
    expect(result.httpStatus).toBe(config.httpErrorStatus);
    expect(result.message).toBe(`${config.apiName} answered with HTTP ${config.httpErrorStatus}`);
  });

  it(`${config.serviceName} 503 -> http_error`, async () => {
    const service = config.createService();
    stubAdapter(getClient(service), { status: 503, data: {} });

    const result = await service.checkServiceStatus();

    expect(result.outcome).toBe('http_error');
    expect(result.operational).toBe(false);
    expect(result.httpStatus).toBe(503);
    expect(result.message).toBe(`${config.apiName} answered with HTTP 503`);
  });

  it(`${config.serviceName} ECONNREFUSED -> no_response, no httpStatus key`, async () => {
    const service = config.createService();
    stubAdapter(getClient(service), { code: 'ECONNREFUSED' });

    const result = await service.checkServiceStatus();

    expect(result.outcome).toBe('no_response');
    expect(result.operational).toBe(false);
    expect(result).not.toHaveProperty('httpStatus');
    expect(result.message).toBe(`No HTTP response from the ${config.apiName}`);
  });

  it(`${config.serviceName} ECONNABORTED -> no_response, no httpStatus key`, async () => {
    const service = config.createService();
    stubAdapter(getClient(service), { code: 'ECONNABORTED' });

    const result = await service.checkServiceStatus();

    expect(result.outcome).toBe('no_response');
    expect(result.operational).toBe(false);
    expect(result).not.toHaveProperty('httpStatus');
    expect(result.message).toBe(`No HTTP response from the ${config.apiName}`);
  });

  it(`${config.serviceName} a plain thrown Error -> no_response, and the promise resolves`, async () => {
    const service = config.createService();
    stubThrowingAdapter(getClient(service));

    const result = await service.checkServiceStatus();

    expect(result.outcome).toBe('no_response');
    expect(result.operational).toBe(false);
    expect(result).not.toHaveProperty('httpStatus');
    expect(result.message).toBe(`No HTTP response from the ${config.apiName}`);
  });

  it(`${config.serviceName} statusPage is unchanged from main on every outcome`, async () => {
    const service = config.createService();
    stubAdapter(getClient(service), { status: 200, data: {} });
    const ok = await service.checkServiceStatus();

    const service2 = config.createService();
    stubAdapter(getClient(service2), { code: 'ECONNREFUSED' });
    const noResponse = await service2.checkServiceStatus();

    expect(ok.statusPage).toBe(config.statusPage);
    expect(noResponse.statusPage).toBe(config.statusPage);
  });

  it(`${config.serviceName} timestamp parses as a date on the ok and no_response rows`, async () => {
    const service = config.createService();
    stubAdapter(getClient(service), { status: 200, data: {} });
    const ok = await service.checkServiceStatus();

    const service2 = config.createService();
    stubAdapter(getClient(service2), { code: 'ECONNREFUSED' });
    const noResponse = await service2.checkServiceStatus();

    expect(Number.isNaN(Date.parse(ok.timestamp))).toBe(false);
    expect(Number.isNaN(Date.parse(noResponse.timestamp))).toBe(false);
  });

  it(`${config.serviceName} operational === (outcome === 'ok') across every outcome`, async () => {
    const results: ServiceProbeResult[] = [];

    const okService = config.createService();
    stubAdapter(getClient(okService), { status: 200, data: {} });
    results.push(await okService.checkServiceStatus());

    const rateLimitedService = config.createService();
    stubAdapter(getClient(rateLimitedService), { status: 429, data: {} });
    results.push(await rateLimitedService.checkServiceStatus());

    const httpErrorService = config.createService();
    stubAdapter(getClient(httpErrorService), { status: config.httpErrorStatus, data: {} });
    results.push(await httpErrorService.checkServiceStatus());

    const noResponseService = config.createService();
    stubAdapter(getClient(noResponseService), { code: 'ECONNREFUSED' });
    results.push(await noResponseService.checkServiceStatus());

    for (const result of results) {
      expect(result.operational).toBe(result.outcome === 'ok');
    }
  });
});

// -----------------------------------------------------------------------
// Open-Meteo-only: HTTP 200 with a null/undefined body is not usably "ok"
// -----------------------------------------------------------------------

describe('Open-Meteo checkServiceStatus() empty-body handling', () => {
  it('200 with data: undefined -> http_error, httpStatus 200, empty-body message', async () => {
    const service = new OpenMeteoService();
    stubAdapter(getClient(service), { status: 200, data: undefined });

    const result = await service.checkServiceStatus();

    expect(result.outcome).toBe('http_error');
    expect(result.operational).toBe(false);
    expect(result.httpStatus).toBe(200);
    expect(result.message).toBe('Open-Meteo API answered HTTP 200 with an empty body');
  });

  it('200 with data: null -> http_error, httpStatus 200, empty-body message', async () => {
    const service = new OpenMeteoService();
    stubAdapter(getClient(service), { status: 200, data: null });

    const result = await service.checkServiceStatus();

    expect(result.outcome).toBe('http_error');
    expect(result.operational).toBe(false);
    expect(result.httpStatus).toBe(200);
    expect(result.message).toBe('Open-Meteo API answered HTTP 200 with an empty body');
  });
});
