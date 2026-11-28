/**
 * NCEI's error mapper gives an oversize answer and a 3xx fixed text (plan-ncei-oversize-text,
 * run-order row 108), the v1.36.6 house pattern: the oversize test sits before the `response`
 * branch and is gated on the code *and* the message; a 3xx is decided before any read of the body
 * and is never a token rejection. Neither is remembered, and the token travels in neither.
 *
 * Assertions read `userMessage` and `formatErrorForUser`, never `.message` alone: `.message` is the
 * class's fixed sentence and would pass against the unfixed mapper.
 *
 * Harness copied from tests/unit/ncei-token-rejected.test.ts (a lock; not imported).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGet, mockUse, mockCreate } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockUse = vi.fn();
  const mockCreate = vi.fn(() => ({
    get: mockGet,
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { response: { use: mockUse } }
  }));
  return { mockGet, mockUse, mockCreate };
});

vi.mock('axios', () => ({ default: { create: mockCreate } }));

import { NCEIService, NceiTokenRejectedError } from '../../src/services/ncei.js';
import { ApiError, ServiceUnavailableError, formatErrorForUser } from '../../src/errors/ApiError.js';
import { logger } from '../../src/utils/logger.js';

/** Synthetic, and spelled so a leak-scan hit on this file is recognisable (G112). */
const FIXTURE_TOKEN = 'tk-ncei-hyg-7731';

const OVERSIZE = { code: 'ERR_BAD_RESPONSE', message: 'maxContentLength size of 1048576 exceeded' };

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

function redirect(status: number): unknown {
  return {
    message: `Request failed with status code ${status}`,
    response: { status, data: { message: 'zqbody7731 moved' } }
  };
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

function expectNoToken(error: unknown): void {
  const e = error as ApiError;
  for (const text of [e.message, e.userMessage, formatErrorForUser(e), String(e.stack)]) {
    expect(text).not.toContain(FIXTURE_TOKEN);
  }
  for (const spy of logSpies) {
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(FIXTURE_TOKEN);
    }
  }
}

describe('NCEI oversize answer', () => {
  it('is unavailable with the fixed text, not axios text', async () => {
    const { onRejected } = build();
    const error = await rejectionOf(onRejected(OVERSIZE));

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).not.toBeInstanceOf(NceiTokenRejectedError);
    expect((error as ApiError).service).toBe('NCEI');
    expect((error as ApiError).userMessage).toBe('NCEI response too large');
    expect(formatErrorForUser(error as ApiError)).not.toContain('maxContentLength');
    expectNoToken(error);
  });

  it('a 5xx carrying ERR_BAD_RESPONSE keeps its own branch', async () => {
    const { onRejected } = build();
    const error = await rejectionOf(
      onRejected({
        code: 'ERR_BAD_RESPONSE',
        message: 'Request failed with status code 503',
        response: { status: 503, data: { message: 'zqcdo7731 down' } }
      })
    );

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as ApiError).userMessage).toBe('zqcdo7731 down');
  });

  it('maxContentLength text without the code falls through unchanged (two-clause gate)', async () => {
    const { onRejected } = build();
    const error = await rejectionOf(onRejected({ message: 'maxContentLength size of 1048576 exceeded' }));

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as ApiError).userMessage).toBe('maxContentLength size of 1048576 exceeded');
  });
});

describe('NCEI 3xx answer', () => {
  it.each([301, 302, 307, 308])('%i is unavailable with the fixed status text and the body unread', async status => {
    const { onRejected } = build();
    const error = await rejectionOf(onRejected(redirect(status)));

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).not.toBeInstanceOf(NceiTokenRejectedError);
    expect((error as ApiError).userMessage).toBe(`NCEI API returned status ${status}`);
    expect(formatErrorForUser(error as ApiError)).not.toContain('zqbody7731');
    expectNoToken(error);
  });
});

describe('neither answer is remembered', () => {
  it.each([
    ['a 302', redirect(302)],
    ['an oversize answer', OVERSIZE]
  ])('after %s the next call still requests', async (_name, failure) => {
    const { service, onRejected } = build();
    await rejectionOf(onRejected(failure));

    mockGet.mockResolvedValue({ data: { results: [] } });
    await rejectionOf(service.getClimateNormals(47.6062, -122.3321, 7, 15));
    expect(mockGet).toHaveBeenCalled();
  });
});
