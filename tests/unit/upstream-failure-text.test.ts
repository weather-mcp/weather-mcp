/**
 * Fixed user text for NIFC and RainViewer failures (error-object-log-channel, contract 3).
 *
 * Each failure class — timeout, connection failure, HTTP status, fallback — throws a
 * fixed message. Neither the upstream response body nor the axios/Node message ever
 * reaches the user. The stub sits on the instance `client.get`, the seam both
 * services really call (G70), and rejects with a real `AxiosError`, because
 * `axios.isAxiosError` reads the instance flag.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { NIFCService } from '../../src/services/nifc.js';
import { RainViewerService } from '../../src/services/rainviewer.js';
import { ServiceUnavailableError, formatErrorForUser } from '../../src/errors/ApiError.js';
import { CONNECTION_FAILURE_CODES } from '../../src/utils/connectionFailure.js';
import { logger } from '../../src/utils/logger.js';

const BODY_SENTINEL = 'zqbody8841';
const TRANSPORT_SENTINEL = 'zqtransport8841';

const NIFC_TIMEOUT = 'NIFC service request timed out. The service may be temporarily unavailable.';
const NIFC_CONNECT = 'Unable to connect to the NIFC service. The service may be unreachable from this network.';
const NIFC_400 = 'Invalid query parameters for NIFC service.';
const NIFC_503 = 'NIFC service is temporarily unavailable. Please try again later.';
const NIFC_FALLBACK = 'Failed to query NIFC fire perimeters.';

const RV_TIMEOUT = 'Failed to fetch radar data: the request timed out';
const RV_CONNECT = 'Failed to fetch radar data: unable to connect to RainViewer';
const RV_FALLBACK = 'Failed to fetch radar data';

const CONNECTION_CODES = [...CONNECTION_FAILURE_CODES];

function axiosError(code: string | undefined, status?: number, body?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  const response =
    status === undefined
      ? undefined
      : ({ status, statusText: '', headers: {}, config, data: body } as AxiosResponse);
  return new AxiosError(`${TRANSPORT_SENTINEL} failure`, code, config, {}, response);
}

function stubGet(target: object, rejection: unknown) {
  return vi
    .spyOn((target as { client: { get: (...a: unknown[]) => unknown } }).client, 'get')
    .mockRejectedValue(rejection);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e
  );
}

function expectClean(text: string): void {
  expect(text).not.toContain(BODY_SENTINEL);
  expect(text).not.toContain(TRANSPORT_SENTINEL);
}

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NIFC failure text', () => {
  // A fresh service per test, so the NIFC cache cannot serve a hit.
  async function nifcMessage(rejection: unknown): Promise<string> {
    const service = new NIFCService();
    const get = stubGet(service, rejection);
    const err = await rejectionOf(service.queryFirePerimeters(-86, 42, -85, 43));
    expect(err).toBeInstanceOf(Error);
    expect(get).toHaveBeenCalledTimes(1);
    const message = (err as Error).message;
    expectClean(message);
    return message;
  }

  it.each(['ECONNABORTED', 'ETIMEDOUT'])('%s → the timeout message', async (code) => {
    expect(await nifcMessage(axiosError(code))).toBe(NIFC_TIMEOUT);
  });

  it.each(CONNECTION_CODES)('%s → the connection message', async (code) => {
    expect(await nifcMessage(axiosError(code))).toBe(NIFC_CONNECT);
  });

  it('500 with a body → the HTTP-status message', async () => {
    expect(await nifcMessage(axiosError('ERR_BAD_RESPONSE', 500, { message: BODY_SENTINEL }))).toBe(
      'NIFC service returned HTTP 500.'
    );
  });

  it('500 with an empty body → the HTTP-status message', async () => {
    expect(await nifcMessage(axiosError('ERR_BAD_RESPONSE', 500, ''))).toBe('NIFC service returned HTTP 500.');
  });

  it('400 → the existing message, byte for byte', async () => {
    expect(await nifcMessage(axiosError('ERR_BAD_REQUEST', 400, { message: BODY_SENTINEL }))).toBe(NIFC_400);
  });

  it('503 → the existing message, byte for byte', async () => {
    expect(await nifcMessage(axiosError('ERR_BAD_RESPONSE', 503, { message: BODY_SENTINEL }))).toBe(NIFC_503);
  });

  it('an oversized-body AxiosError with no response → the fallback', async () => {
    expect(await nifcMessage(axiosError('ERR_BAD_RESPONSE'))).toBe(NIFC_FALLBACK);
  });

  it('a non-axios error → the fallback, with nothing interpolated', async () => {
    expect(await nifcMessage(new TypeError(TRANSPORT_SENTINEL))).toBe(NIFC_FALLBACK);
  });
});

describe('RainViewer failure text', () => {
  async function radarError(rejection: unknown): Promise<ServiceUnavailableError> {
    const service = new RainViewerService();
    const get = stubGet(service, rejection);
    const err = await rejectionOf(service.getRadarData());
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(get).toHaveBeenCalledTimes(1);
    const sue = err as ServiceUnavailableError;
    expectClean(sue.userMessage);
    const rendered = formatErrorForUser(sue);
    expectClean(rendered);
    expect(rendered.startsWith('RainViewer API Error: Failed to fetch radar data')).toBe(true);
    return sue;
  }

  it.each(['ECONNABORTED', 'ETIMEDOUT'])('%s → the timeout message', async (code) => {
    expect((await radarError(axiosError(code))).userMessage).toBe(RV_TIMEOUT);
  });

  it.each(CONNECTION_CODES)('%s → the connection message', async (code) => {
    expect((await radarError(axiosError(code))).userMessage).toBe(RV_CONNECT);
  });

  it('500 with a body → the HTTP-status message', async () => {
    const sue = await radarError(axiosError('ERR_BAD_RESPONSE', 500, { message: BODY_SENTINEL }));
    expect(sue.userMessage).toBe('Failed to fetch radar data: RainViewer returned HTTP 500');
  });

  it('500 with an empty body → the HTTP-status message', async () => {
    const sue = await radarError(axiosError('ERR_BAD_RESPONSE', 500, ''));
    expect(sue.userMessage).toBe('Failed to fetch radar data: RainViewer returned HTTP 500');
  });

  it('a redirect (maxRedirects: 0) → the HTTP-status message', async () => {
    const sue = await radarError(axiosError('ERR_FR_TOO_MANY_REDIRECTS', 301, { message: BODY_SENTINEL }));
    expect(sue.userMessage).toBe('Failed to fetch radar data: RainViewer returned HTTP 301');
  });

  it('an oversized-body AxiosError with no response → the bare message', async () => {
    expect((await radarError(axiosError('ERR_BAD_RESPONSE'))).userMessage).toBe(RV_FALLBACK);
  });
});
