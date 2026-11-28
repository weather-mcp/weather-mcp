import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import { AxiosHeaders } from 'axios';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { CONNECT_TIMEOUT_MS, withRequestDeadline } from '../../src/utils/httpDeadline.js';
import { runWithToolBudget } from '../../src/utils/toolBudget.js';

/**
 * The deadline seam pins the native transport's agent (design plan
 * `plan-native-transport-connect-timeout`): a non-tunnelled `maxRedirects: 0` request whose caller
 * set no agent for the target's protocol reaches the inner adapter with a shared keep-alive agent
 * whose socket timeout is CONNECT_TIMEOUT_MS. Every other request reaches it unchanged. The inner
 * adapter is injected and never settles, so nothing connects. That the cut stops at the connect
 * phase is proven in tests/integration/http-deadline-native-agent.test.ts.
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
    url: 'https://upstream.example/path',
    method: 'get',
    timeout: 3000,
    headers: new AxiosHeaders({ Accept: 'application/json' }),
    ...extra
  } as InternalAxiosRequestConfig;
}

type Seen = { config?: InternalAxiosRequestConfig };

/** Never settles and never reads its signal. */
function hang(seen: Seen): AxiosAdapter {
  return (config) => {
    seen.config = config;
    return new Promise<AxiosResponse>(() => {});
  };
}

/** Run one request through the wrapper and return what the inner adapter saw. */
function seenFor(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const seen: Seen = {};
  withRequestDeadline(hang(seen))(config).catch(() => undefined);
  expect(seen.config).toBeDefined();
  return seen.config as InternalAxiosRequestConfig;
}

function own(config: InternalAxiosRequestConfig, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(config, key);
}

describe('native-transport agent injection', () => {
  it('(a) https: maxRedirects 0 gets a keep-alive https.Agent with a 5 s socket timeout', () => {
    const seen = seenFor(makeConfig({ maxRedirects: 0 }));
    expect(seen.httpsAgent).toBeInstanceOf(https.Agent);
    const agent = seen.httpsAgent as https.Agent & { keepAlive?: boolean };
    expect(agent.options.keepAlive).toBe(true);
    expect(agent.options.timeout).toBe(CONNECT_TIMEOUT_MS);
    expect(agent.options.timeout).toBe(5000);
    expect(CONNECT_TIMEOUT_MS).toBe(5000);
    expect(own(seen, 'httpAgent')).toBe(false);
  });

  it('(b) http: maxRedirects 0 gets an http.Agent on httpAgent, and no httpsAgent', () => {
    const seen = seenFor(makeConfig({ url: 'http://upstream.example/path', maxRedirects: 0 }));
    expect(seen.httpAgent).toBeInstanceOf(http.Agent);
    expect(seen.httpAgent).not.toBeInstanceOf(https.Agent);
    const agent = seen.httpAgent as http.Agent & { options: { keepAlive?: boolean; timeout?: number } };
    expect(agent.options.keepAlive).toBe(true);
    expect(agent.options.timeout).toBe(5000);
    expect(own(seen, 'httpsAgent')).toBe(false);
  });

  it('(c) resolves the target from baseURL plus a relative url', () => {
    const seen = seenFor(
      makeConfig({ baseURL: 'https://upstream.example', url: '/path', maxRedirects: 0 })
    );
    expect(seen.httpsAgent).toBeInstanceOf(https.Agent);
  });

  it('(d) the agents are shared per protocol, and the two protocols differ', () => {
    const first = seenFor(makeConfig({ maxRedirects: 0 })).httpsAgent;
    const second = seenFor(makeConfig({ maxRedirects: 0 })).httpsAgent;
    const plain = seenFor(makeConfig({ url: 'http://upstream.example/x', maxRedirects: 0 })).httpAgent;
    expect(first).toBe(second);
    expect(plain).not.toBe(first);
  });

  describe('(e) left untouched', () => {
    const callerHttps = new https.Agent();
    const callerHttp = new http.Agent();
    const cases: Array<[string, InternalAxiosRequestConfig]> = [
      ['maxRedirects absent', makeConfig()],
      ['maxRedirects 5', makeConfig({ maxRedirects: 5 })],
      ['maxRedirects 0 with a caller httpsAgent', makeConfig({ maxRedirects: 0, httpsAgent: callerHttps })],
      [
        'maxRedirects 0 http: with a caller httpAgent',
        makeConfig({ url: 'http://upstream.example/path', maxRedirects: 0, httpAgent: callerHttp })
      ],
      ['an unparseable url', makeConfig({ url: 'http://[bad', maxRedirects: 0 })]
    ];
    for (const [name, config] of cases) {
      it(name, () => {
        const { signal, ...rest } = seenFor(config);
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(rest).toEqual(config);
        expect(own(rest, 'httpAgent')).toBe(own(config, 'httpAgent'));
        expect(own(rest, 'httpsAgent')).toBe(own(config, 'httpsAgent'));
        if (config.httpsAgent !== undefined) expect(rest.httpsAgent).toBe(config.httpsAgent);
        if (config.httpAgent !== undefined) expect(rest.httpAgent).toBe(config.httpAgent);
      });
    }
  });

  it('(f) a caller httpAgent on an https: target does not block the https injection', () => {
    const callerHttp = new http.Agent();
    const seen = seenFor(makeConfig({ maxRedirects: 0, httpAgent: callerHttp }));
    expect(seen.httpAgent).toBe(callerHttp);
    expect(seen.httpsAgent).toBeInstanceOf(https.Agent);
    expect((seen.httpsAgent as https.Agent).options.timeout).toBe(5000);
  });

  it('(g) a tunnelled request keeps its tunnel agent, not the native one', () => {
    const native = seenFor(makeConfig({ maxRedirects: 0 })).httpsAgent;
    process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
    const seen = seenFor(makeConfig({ maxRedirects: 0 }));
    expect(seen.proxy).toBe(false);
    expect(seen.httpsAgent).toBeInstanceOf(https.Agent);
    expect(seen.httpsAgent).not.toBe(native);
  });

  it('(h) no timeout outside a tool budget: the same config object, no agent', () => {
    const config = makeConfig({ timeout: 0, maxRedirects: 0 });
    const seen = seenFor(config);
    expect(seen).toBe(config);
    expect(own(seen, 'httpsAgent')).toBe(false);
  });

  it('(i) inside a tool budget with no own timeout: injected', async () => {
    const seen: Seen = {};
    const config = makeConfig({ timeout: 0, maxRedirects: 0 });
    runWithToolBudget(55_000, async () => withRequestDeadline(hang(seen))(config), {
      now: () => 0
    }).catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen.config?.httpsAgent).toBeInstanceOf(https.Agent);
    expect((seen.config?.httpsAgent as https.Agent).options.timeout).toBe(5000);
  });
});
