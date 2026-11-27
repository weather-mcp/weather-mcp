/**
 * A rejected NCEI token is its own error, is remembered for the process, and
 * never travels in an error or a log line (plan-http-entry-hardening, §2).
 *
 * CDO answers a rejected token with HTTP 400, not 401 or 403 — live-verified
 * 2026-11-27. The two bodies below are the ones it sent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGet, mockUse, mockCreate } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockUse = vi.fn();
  // The config is recorded by the mock and read back in the bounds test.
  const mockCreate = vi.fn((...config: [Record<string, unknown>?]) => {
    void config;
    return {
      get: mockGet,
      defaults: { headers: { common: {} as Record<string, string> } },
      interceptors: { response: { use: mockUse } }
    };
  });
  return { mockGet, mockUse, mockCreate };
});

vi.mock('axios', () => ({ default: { create: mockCreate } }));

import { NCEIService, NceiTokenRejectedError } from '../../src/services/ncei.js';
import { ApiError, ServiceUnavailableError, formatErrorForUser } from '../../src/errors/ApiError.js';
import { CONNECTION_FAILURE_CODES } from '../../src/utils/connectionFailure.js';
import { logger } from '../../src/utils/logger.js';

/** Synthetic, and spelled so a leak-scan hit on this file is recognisable (G112). */
const FIXTURE_TOKEN = 'tk-ncei-hyg-7731';

const BODY_INVALID = { status: '400', message: 'The token parameter provided is not valid.' };
const BODY_REQUIRED = { status: '400', message: 'Token parameter is required.' };
const RAW_INVALID = '{"status" : "400", "message" : "The token parameter provided is not valid."}';
const RAW_REQUIRED = '{"status" : "400", "message" : "Token parameter is required."}';

type Interceptor = (error: unknown) => Promise<never>;

function build(): { service: NCEIService; onRejected: Interceptor } {
  const service = new NCEIService({ token: FIXTURE_TOKEN });
  const onRejected = mockUse.mock.calls[mockUse.mock.calls.length - 1][1] as Interceptor;
  return { service, onRejected };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => { throw new Error('expected a rejection'); },
    (error: unknown) => error
  );
}

let logSpies: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  mockGet.mockReset();
  mockUse.mockClear();
  mockCreate.mockClear();
  logSpies = [
    vi.spyOn(logger, 'info').mockImplementation(() => {}),
    vi.spyOn(logger, 'warn').mockImplementation(() => {}),
    vi.spyOn(logger, 'error').mockImplementation(() => {}),
    vi.spyOn(logger, 'debug').mockImplementation(() => {})
  ];
});

describe('NCEI token rejection', () => {
  const REJECTIONS: Array<[string, { status: number; data: unknown }]> = [
    ['400, "not valid", object body', { status: 400, data: BODY_INVALID }],
    ['400, "is required", object body', { status: 400, data: BODY_REQUIRED }],
    ['400, "not valid", raw text body', { status: 400, data: RAW_INVALID }],
    ['400, "is required", raw text body', { status: 400, data: RAW_REQUIRED }],
    ['401', { status: 401, data: {} }],
    ['403', { status: 403, data: '' }]
  ];

  it.each(REJECTIONS)('%s rejects with NceiTokenRejectedError', async (_name, response) => {
    const { onRejected } = build();
    const error = await rejectionOf(onRejected({ response }));
    expect(error).toBeInstanceOf(NceiTokenRejectedError);
    // Still the class a rejected token has always been reported as.
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as ApiError).service).toBe('NCEI');
    expect((error as Error).name).toBe('NceiTokenRejectedError');
  });

  const NOT_REJECTIONS: Array<[string, { status: number; data: unknown }]> = [
    ['400 about a parameter', { status: 400, data: { status: '400', message: 'Invalid datasetid' } }],
    ['400 with an empty body', { status: 400, data: '' }],
    ['400 with no body', { status: 400, data: undefined }],
    ['302 (a redirect that is not followed)', { status: 302, data: '' }],
    ['503', { status: 503, data: {} }]
  ];

  it.each(NOT_REJECTIONS)('%s is unavailable, not a token rejection', async (_name, response) => {
    const { service, onRejected } = build();
    const error = await rejectionOf(onRejected({ response, message: 'Request failed' }));
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).not.toBeInstanceOf(NceiTokenRejectedError);

    // Nothing was remembered: the next call still asks CDO.
    mockGet.mockResolvedValue({ data: { results: [] } });
    await rejectionOf(service.getClimateNormals(47.6062, -122.3321, 7, 15));
    expect(mockGet).toHaveBeenCalled();
  });

  it('is remembered: the next call rejects the same way and makes no request', async () => {
    const { service, onRejected } = build();
    await rejectionOf(onRejected({ response: { status: 400, data: BODY_INVALID } }));
    expect(mockGet).not.toHaveBeenCalled();

    const first = await rejectionOf(service.getClimateNormals(47.6062, -122.3321, 7, 15));
    const second = await rejectionOf(service.getClimateNormals(40.7128, -74.006, 1, 2));

    expect(first).toBeInstanceOf(NceiTokenRejectedError);
    expect(second).toBeInstanceOf(NceiTokenRejectedError);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('one service remembering does not affect another', async () => {
    const rejected = build();
    await rejectionOf(rejected.onRejected({ response: { status: 401, data: {} } }));

    const fresh = build();
    mockGet.mockResolvedValue({ data: { results: [] } });
    await rejectionOf(fresh.service.getClimateNormals(47.6062, -122.3321, 7, 15));
    expect(mockGet).toHaveBeenCalled();
  });

  it('the token is in no thrown message and no logger argument', async () => {
    const { service, onRejected } = build();
    const thrown = [
      await rejectionOf(onRejected({ response: { status: 400, data: BODY_INVALID } })),
      await rejectionOf(service.getClimateNormals(47.6062, -122.3321, 7, 15))
    ] as ApiError[];

    for (const error of thrown) {
      expect(error.message).not.toContain(FIXTURE_TOKEN);
      expect(error.userMessage).not.toContain(FIXTURE_TOKEN);
      expect(formatErrorForUser(error)).not.toContain(FIXTURE_TOKEN);
      expect(String(error.stack)).not.toContain(FIXTURE_TOKEN);
    }
    const logged = logSpies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call))).join('\n');
    expect(logged).not.toContain(FIXTURE_TOKEN);
  });
});

describe('NCEI client bounds', () => {
  it('never follows a redirect and bounds the response size', () => {
    build();
    const config = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(config.maxRedirects).toBe(0);
    expect(config.maxContentLength).toBe(1024 * 1024);
    expect(typeof config.adapter).toBe('function');
  });
});

describe('NCEI connection failures (G138)', () => {
  it.each([...CONNECTION_FAILURE_CODES])('%s is "Unable to connect to NCEI API"', async (code) => {
    const { onRejected } = build();
    const error = (await rejectionOf(onRejected({ code, message: `zqsocket7731 ${code}` }))) as ApiError;
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).not.toBeInstanceOf(NceiTokenRejectedError);
    expect(error.userMessage).toBe('Unable to connect to NCEI API');
    expect(error.userMessage).not.toContain('zqsocket7731');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT'])('%s is still a timeout, classified first', async (code) => {
    const { onRejected } = build();
    const error = (await rejectionOf(onRejected({ code, message: 'zqsocket7731' }))) as ApiError;
    expect(error.userMessage).toBe('Request timed out');
  });
});
