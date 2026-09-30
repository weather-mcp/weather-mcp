/**
 * Failure attribution for the multi-provider GeocodingService.
 *
 * A provider either answers (a result list, possibly empty; a 4xx other than 429
 * counts as declining the input) or fails (timeout, 429, 5xx, no response, a body
 * it cannot parse). The cascade reports GeocodingNotFoundError when at least one
 * provider answered, and GeocodingServiceUnavailableError when every provider
 * failed. Each provider's outcome is fixed text naming that provider.
 *
 * Uses the real axios module and real AxiosError instances so axios.isAxiosError
 * behaves as in production. Each provider's `client.get` is stubbed on the
 * instance; a missed stub fails with EUNITNET (tests/setup/no-network.ts).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import {
  GeocodingService,
  GeocodingNotFoundError,
  GeocodingServiceUnavailableError,
  GeocodingProviderFailure,
} from '../../src/services/geocoding.js';
import { formatErrorForUser } from '../../src/errors/ApiError.js';
import { logger } from '../../src/utils/logger.js';

type ProviderKey = 'census' | 'nominatim' | 'openmeteo';
type Provider = { name: string; client: AxiosInstance; spacer?: { reserve: () => Promise<void> } };
type Stub = () => Promise<unknown>;

const US_QUERY = 'Springfield, IL';

function config(): InternalAxiosRequestConfig {
  return { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
}

function httpError(status: number, message = `Request failed with status code ${status}`): AxiosError {
  const cfg = config();
  const response = { status, statusText: '', headers: {}, config: cfg, data: {} } as AxiosResponse;
  return new AxiosError(message, AxiosError.ERR_BAD_RESPONSE, cfg, {}, response);
}

function codeError(code: string, message = `${code} error`): AxiosError {
  return new AxiosError(message, code, config(), {});
}

const reject = (err: unknown): Stub => () => Promise.reject(err);
const resolve = (data: unknown): Stub => () => Promise.resolve({ data });

/** Live no-match shapes for each provider. */
const EMPTY: Record<ProviderKey, unknown> = {
  census: { result: { addressMatches: [] } },
  nominatim: [],
  openmeteo: {},
};

/**
 * Build a service whose providers answer per `stubs`. Spacers resolve at once, so no
 * timer runs. Returns the `client.get` spies for call-count assertions.
 */
function serviceWith(stubs: Partial<Record<ProviderKey, Stub>>): {
  svc: GeocodingService;
  gets: Record<ProviderKey, ReturnType<typeof vi.spyOn>>;
  providers: Record<ProviderKey, Provider>;
} {
  const svc = new GeocodingService();
  const providers = svc as unknown as Record<ProviderKey, Provider>;
  for (const k of ['census', 'nominatim'] as const) {
    vi.spyOn(providers[k].spacer as { reserve: () => Promise<void> }, 'reserve').mockResolvedValue();
  }
  const gets = {} as Record<ProviderKey, ReturnType<typeof vi.spyOn>>;
  for (const k of ['census', 'nominatim', 'openmeteo'] as const) {
    const stub = stubs[k] ?? (() => Promise.reject(new Error(`unexpected call to ${k}`)));
    gets[k] = vi.spyOn(providers[k].client, 'get').mockImplementation(stub as never);
  }
  return { svc, gets, providers };
}

async function caught(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the lookup to throw');
}

/** The "Tried N provider(s): …" line of a cascade message. */
function triedLine(message: string): string {
  const line = message.split('\n').find((l) => l.startsWith('Tried '));
  expect(line, 'message has a tried-line').toBeDefined();
  return line as string;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GeocodingService failure attribution', () => {
  it('1. names each provider that failed, with its own cause, and no Open-Meteo prefix', async () => {
    const { svc } = serviceWith({
      census: reject(httpError(429)),
      nominatim: reject(httpError(503)),
      openmeteo: reject(codeError('ECONNABORTED', 'timeout of 10000ms exceeded')),
    });
    const err = await caught(svc.geocode(US_QUERY, 1));

    expect(err).toBeInstanceOf(GeocodingServiceUnavailableError);
    expect(err.message).toContain('Census.gov rate-limited the request');
    expect(err.message).toContain('Nominatim is unavailable');
    expect(err.message).toContain('Open-Meteo timed out');
    const rendered = formatErrorForUser(err);
    expect(rendered.startsWith('Error: ')).toBe(true);
    expect(rendered).toContain('Location lookup is unavailable right now');
    expect(rendered).not.toContain('OpenMeteo');
    expect(rendered).not.toContain('API Error:');
    expect(rendered).not.toContain('Check spelling');
  });

  describe('2. every provider failing, one cause class at a time, is unavailable', () => {
    const cases: Array<{ label: string; stubs: Record<ProviderKey, Stub>; cause: string }> = [
      {
        label: 'ECONNABORTED',
        stubs: { census: reject(codeError('ECONNABORTED')), nominatim: reject(codeError('ECONNABORTED')), openmeteo: reject(codeError('ECONNABORTED')) },
        cause: 'timed out',
      },
      {
        label: 'ETIMEDOUT',
        stubs: { census: reject(codeError('ETIMEDOUT')), nominatim: reject(codeError('ETIMEDOUT')), openmeteo: reject(codeError('ETIMEDOUT')) },
        cause: 'timed out',
      },
      {
        label: 'HTTP 429',
        stubs: { census: reject(httpError(429)), nominatim: reject(httpError(429)), openmeteo: reject(httpError(429)) },
        cause: 'rate-limited the request',
      },
      {
        label: 'HTTP 500',
        stubs: { census: reject(httpError(500)), nominatim: reject(httpError(500)), openmeteo: reject(httpError(500)) },
        cause: 'is unavailable',
      },
      {
        label: 'no response (ENOTFOUND)',
        stubs: { census: reject(codeError('ENOTFOUND')), nominatim: reject(codeError('ENOTFOUND')), openmeteo: reject(codeError('ENOTFOUND')) },
        cause: 'is unavailable',
      },
      {
        label: 'unparseable bodies',
        stubs: { census: resolve('<html>'), nominatim: resolve({ not: 'an array' }), openmeteo: resolve(null) },
        cause: 'is unavailable',
      },
      {
        label: 'wrong-typed result lists',
        stubs: {
          census: resolve({ result: { addressMatches: 'x' } }),
          nominatim: resolve('x'),
          openmeteo: resolve({ results: { name: 'x' } }),
        },
        cause: 'is unavailable',
      },
      {
        label: 'mapper TypeError (Nominatim row with no type)',
        stubs: {
          census: reject(httpError(503)),
          nominatim: resolve([{ lat: '1', lon: '2', display_name: 'x' }]),
          openmeteo: reject(httpError(503)),
        },
        cause: 'is unavailable',
      },
    ];

    for (const c of cases) {
      it(c.label, async () => {
        const { svc } = serviceWith(c.stubs);
        const err = await caught(svc.geocode(US_QUERY, 1));
        expect(err).toBeInstanceOf(GeocodingServiceUnavailableError);
        expect(err.message).toContain(`Nominatim ${c.cause}`);
        expect(err.message).toContain('Tried 3 provider(s)');
        expect(err.message).not.toContain('Check spelling');
        expect(err.message).not.toContain('found no match');
      });
    }
  });

  it('3. every provider answering empty is not-found, with spelling advice', async () => {
    const { svc } = serviceWith({
      census: resolve(EMPTY.census),
      nominatim: resolve(EMPTY.nominatim),
      openmeteo: resolve(EMPTY.openmeteo),
    });
    const err = await caught(svc.geocode(US_QUERY, 1));

    expect(err).toBeInstanceOf(GeocodingNotFoundError);
    expect(err.message.startsWith(`No locations found matching "${US_QUERY}".`)).toBe(true);
    expect(err.message).toContain('Check spelling');
    expect(triedLine(err.message)).toBe(
      'Tried 3 provider(s): Census.gov found no match; Nominatim found no match; Open-Meteo found no match'
    );
  });

  it('4. a declined query (HTTP 400) counts as an answer, so the outcome is not-found', async () => {
    const { svc } = serviceWith({
      census: reject(httpError(400)),
      nominatim: reject(httpError(503)),
      openmeteo: reject(httpError(503)),
    });
    const err = await caught(svc.geocode(US_QUERY, 1));

    expect(err).toBeInstanceOf(GeocodingNotFoundError);
    expect(triedLine(err.message)).toBe(
      'Tried 3 provider(s): Census.gov found no match; Nominatim is unavailable; Open-Meteo is unavailable'
    );
  });

  it('5. a failure beside an empty answer is not-found, and the failures stay listed', async () => {
    const { svc } = serviceWith({
      census: reject(codeError('ECONNABORTED')),
      nominatim: reject(httpError(429)),
      openmeteo: resolve(EMPTY.openmeteo),
    });
    const err = await caught(svc.geocode(US_QUERY, 1));

    expect(err).toBeInstanceOf(GeocodingNotFoundError);
    expect(triedLine(err.message)).toBe(
      'Tried 3 provider(s): Census.gov timed out; Nominatim rate-limited the request; Open-Meteo found no match'
    );
  });

  it('6. an international query tries two providers and never calls Census', async () => {
    const { svc, gets } = serviceWith({
      nominatim: reject(httpError(502)),
      openmeteo: reject(codeError('ECONNRESET')),
    });
    const err = await caught(svc.geocode('Paris, France', 1));

    expect(gets.nominatim).toHaveBeenCalledTimes(1);
    expect(gets.census).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(GeocodingServiceUnavailableError);
    expect(triedLine(err.message)).toBe(
      'Tried 2 provider(s): Nominatim is unavailable; Open-Meteo is unavailable'
    );
  });

  describe('7. no upstream text, URL or query reaches a provider outcome', () => {
    const SENTINEL_MSG = 'https://secret.example/?q=SENTINEL';
    const QUERY = 'SENTINELQUERY';

    it('attribution row', async () => {
      const failures: GeocodingProviderFailure[] = [];
      const { svc, providers } = serviceWith({
        census: reject(httpError(429, SENTINEL_MSG)),
        nominatim: reject(httpError(503, SENTINEL_MSG)),
        openmeteo: reject(codeError('ECONNABORTED', SENTINEL_MSG)),
      });
      // Uncertain query order: all three providers, same as the US order.
      const err = await caught(svc.geocode(QUERY, 1));
      expect(err).toBeInstanceOf(GeocodingServiceUnavailableError);
      // Positive control: the query is in the first line (user-facing, as today).
      expect(err.message).toContain(QUERY);
      const tried = triedLine(err.message);
      expect(tried).toContain('Census.gov rate-limited the request');
      expect(tried).not.toContain('SENTINEL');

      // Each provider's own thrown failure carries no sentinel either.
      for (const k of ['census', 'nominatim', 'openmeteo'] as const) {
        const f = await caught(
          (providers[k] as unknown as { geocode: (q: string, l: number) => Promise<unknown> }).geocode(QUERY, 5)
        );
        expect(f).toBeInstanceOf(GeocodingProviderFailure);
        failures.push(f as GeocodingProviderFailure);
      }
      expect(failures.map((f) => f.message)).toEqual([
        'Census.gov rate-limited the request',
        'Nominatim is unavailable',
        'Open-Meteo timed out',
      ]);
      for (const f of failures) expect(f.message).not.toContain('SENTINEL');
    });

    it('all-failed matrix rows', async () => {
      const errs = [
        codeError('ECONNABORTED', SENTINEL_MSG),
        codeError('ETIMEDOUT', SENTINEL_MSG),
        httpError(429, SENTINEL_MSG),
        httpError(500, SENTINEL_MSG),
        codeError('ENOTFOUND', SENTINEL_MSG),
        new TypeError(SENTINEL_MSG),
      ];
      for (const e of errs) {
        const { svc } = serviceWith({ census: reject(e), nominatim: reject(e), openmeteo: reject(e) });
        const err = await caught(svc.geocode(QUERY, 1));
        expect(err).toBeInstanceOf(GeocodingServiceUnavailableError);
        const tried = triedLine(err.message);
        expect(tried).toContain('Nominatim');
        expect(tried).not.toContain('SENTINEL');
        vi.restoreAllMocks();
      }
    });
  });

  it('7c. default logs carry no upstream error text from the provider catches', async () => {
    const SENTINEL_MSG = 'https://secret.example/?q=SENTINELQUERY';
    const savedPii = process.env.LOG_PII;
    delete process.env.LOG_PII;
    try {
      const calls: unknown[][] = [];
      for (const level of ['debug', 'info', 'warn', 'error'] as const) {
        vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
          calls.push(args);
        });
      }
      const { svc } = serviceWith({
        census: reject(codeError('ECONNABORTED', SENTINEL_MSG)),
        nominatim: reject(httpError(429, SENTINEL_MSG)),
        openmeteo: reject(httpError(503, SENTINEL_MSG)),
      });
      const err = await caught(svc.geocode('Springfield, IL', 1));
      expect(err).toBeInstanceOf(GeocodingServiceUnavailableError);

      // Positive control: each provider catch logged, with class and code.
      const catchLines = calls.filter((c) => typeof c[0] === 'string' && / error$/.test(c[0] as string));
      expect(catchLines.map((c) => c[0])).toEqual(['Census.gov error', 'Nominatim error', 'Open-Meteo error']);
      expect(catchLines[0][1]).toMatchObject({ name: 'AxiosError', code: 'ECONNABORTED' });
      expect(JSON.stringify(calls)).not.toContain('SENTINEL');
    } finally {
      if (savedPii === undefined) delete process.env.LOG_PII;
      else process.env.LOG_PII = savedPii;
    }
  });

  it('8. a later provider with a match still wins after an earlier failure', async () => {
    const { svc, gets } = serviceWith({
      census: reject(httpError(503)),
      nominatim: resolve([
        { lat: '39.78', lon: '-89.65', name: 'Springfield', display_name: 'Springfield, Illinois', importance: 0.7, type: 'city', address: { country_code: 'us' } },
      ]),
    });
    const results = await svc.geocode(US_QUERY, 1);

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('nominatim');
    expect(results[0].latitude).toBeCloseTo(39.78);
    expect(gets.openmeteo).not.toHaveBeenCalled();
  });

  it('9. a spacer rejection is reported as fixed text, never the raw error', async () => {
    const { svc, providers } = serviceWith({
      census: reject(httpError(503)),
      openmeteo: reject(httpError(503)),
    });
    vi.spyOn(providers.nominatim.spacer as { reserve: () => Promise<void> }, 'reserve')
      .mockRejectedValue(new Error('RAWTEXT'));
    const err = await caught(svc.geocode(US_QUERY, 1));

    expect(err).toBeInstanceOf(GeocodingServiceUnavailableError);
    expect(err.message).toContain('Nominatim is unavailable');
    expect(err.message).not.toContain('RAWTEXT');
  });
});
