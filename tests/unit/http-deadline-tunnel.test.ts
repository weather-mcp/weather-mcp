import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import https from 'node:https';
import { AxiosHeaders } from 'axios';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { withRequestDeadline } from '../../src/utils/httpDeadline.js';

/**
 * The deadline's hand-off to the tunnel agent (design plan `plan-proxy-socket-release`, §1): an
 * `https:` request that `proxy-from-env` routes through a proxy reaches the inner adapter with
 * `proxy: false` and a per-request agent hooked on the deadline's own signal; every other request
 * reaches it as before. The inner adapter is injected and never settles, so nothing connects. The
 * socket behaviour (the release, the 407 replay) is proven in
 * tests/integration/http-deadline-proxy.test.ts.
 */

const PROXY_VARS = [
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
  'HTTP_PROXY',
  'http_proxy'
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.useFakeTimers();
  savedEnv = {};
  for (const name of PROXY_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  vi.useRealTimers();
  for (const name of PROXY_VARS) {
    const value = savedEnv[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function makeConfig(extra: Partial<InternalAxiosRequestConfig> = {}): InternalAxiosRequestConfig {
  return {
    baseURL: 'https://api.weather.gov',
    url: '/points/1,2',
    method: 'get',
    timeout: 3000,
    headers: new AxiosHeaders({ Accept: 'application/json' }),
    ...extra
  } as InternalAxiosRequestConfig;
}

type Seen = { config?: InternalAxiosRequestConfig };

/** Never settles and never reads its signal. */
function hangIgnoringSignal(seen: Seen = {}): AxiosAdapter {
  return (config) => {
    seen.config = config;
    return new Promise<AxiosResponse>(() => {});
  };
}

/** Start a request through the wrapper and swallow its eventual deadline rejection. */
function start(config: InternalAxiosRequestConfig, seen: Seen): void {
  withRequestDeadline(hangIgnoringSignal(seen))(config).catch(() => undefined);
}

function useProxy(): void {
  process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
}

describe('(k) a proxied https: request gets the tunnel', () => {
  it('proxy: false, a TunnelAgent, and the agent fails ECONNABORTED once the deadline fires', async () => {
    useProxy();
    const seen: Seen = {};
    start(makeConfig(), seen);
    const inner = seen.config;
    expect(inner?.proxy).toBe(false);
    const agent = inner?.httpsAgent as https.Agent;
    expect(agent).toBeInstanceOf(https.Agent);
    expect(agent.constructor.name).toBe('TunnelAgent');
    expect(inner?.signal?.aborted).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(inner?.signal?.aborted).toBe(true);

    // The agent was built on that same signal: it refuses to dial once it has aborted.
    const result = await new Promise<{ err: (Error & { code?: string }) | null }>((resolve) => {
      agent.createConnection({ host: 'api.weather.gov', port: 443 }, (err: Error | null) =>
        resolve({ err })
      );
    });
    expect(result.err?.code).toBe('ECONNABORTED');
  });
});

describe('requests that keep the existing path', () => {
  function expectUntouched(input: InternalAxiosRequestConfig, seen: Seen): void {
    expect(seen.config).not.toHaveProperty('httpsAgent');
    const { signal, ...rest } = seen.config as InternalAxiosRequestConfig;
    expect(signal).toBeDefined();
    expect(rest).toEqual(input);
  }

  it('(l) no proxy variable', () => {
    const input = makeConfig();
    const seen: Seen = {};
    start(input, seen);
    expect(seen.config).not.toHaveProperty('proxy');
    expectUntouched(input, seen);
  });

  it('(m) an http: target under HTTPS_PROXY', () => {
    useProxy();
    const input = makeConfig({ baseURL: 'http://api.weather.gov' });
    const seen: Seen = {};
    start(input, seen);
    expect(seen.config).not.toHaveProperty('proxy');
    expectUntouched(input, seen);
  });

  it('(n) a caller-set proxy survives as given', () => {
    useProxy();
    const input = makeConfig({ proxy: { host: 'p', port: 1 } });
    const seen: Seen = {};
    start(input, seen);
    expect(seen.config?.proxy).toEqual({ host: 'p', port: 1 });
    expectUntouched(input, seen);
  });

  it('(o) NO_PROXY naming the host', () => {
    useProxy();
    process.env.NO_PROXY = 'api.weather.gov';
    const input = makeConfig();
    const seen: Seen = {};
    start(input, seen);
    expect(seen.config).not.toHaveProperty('proxy');
    expectUntouched(input, seen);
  });

  it('(o) NO_PROXY=*', () => {
    useProxy();
    process.env.NO_PROXY = '*';
    const input = makeConfig();
    const seen: Seen = {};
    start(input, seen);
    expect(seen.config).not.toHaveProperty('proxy');
    expectUntouched(input, seen);
  });

  it('(p) no timeout: the same config object, by identity, with neither key added', () => {
    useProxy();
    const input = makeConfig({ timeout: 0 });
    const seen: Seen = {};
    start(input, seen);
    expect(seen.config).toBe(input);
    expect(seen.config).not.toHaveProperty('proxy');
    expect(seen.config).not.toHaveProperty('httpsAgent');
  });
});

describe('(q) the agent is per request', () => {
  it('two requests get two distinct agents', () => {
    useProxy();
    const first: Seen = {};
    const second: Seen = {};
    const adapter = withRequestDeadline(
      ((config: InternalAxiosRequestConfig) => {
        (first.config === undefined ? first : second).config = config;
        return new Promise<AxiosResponse>(() => {});
      }) as AxiosAdapter
    );
    adapter(makeConfig()).catch(() => undefined);
    adapter(makeConfig()).catch(() => undefined);
    expect(first.config?.httpsAgent).toBeInstanceOf(https.Agent);
    expect(second.config?.httpsAgent).toBeInstanceOf(https.Agent);
    expect(first.config?.httpsAgent).not.toBe(second.config?.httpsAgent);
  });
});
