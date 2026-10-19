/**
 * Loopback contract tests for the HTTP app (`createHttpApp`).
 *
 * The app is built with the real token verifier over a local JWKS, listens on
 * 127.0.0.1 port 0, and is driven with Node's fetch. Nothing here leaves the
 * machine, so the file also passes under a dead proxy with NO_PROXY set (G119).
 *
 * Rows 7 and 9 need a foreign `Host`. undici drops a caller-supplied `Host`, so
 * those requests go through node:http, the one client here that honours it.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeJwt, errors, type JWTVerifyGetKey } from 'jose';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';

// Pinned before the factory import evaluates (tests/unit/log-privacy.test.ts):
// toolConfig is built from ENABLED_TOOLS at import time (G26), and
// ANALYTICS_ENABLED='false' keeps the import off ~/.weather-mcp.
vi.hoisted(() => {
  process.env.ENABLED_TOOLS = 'all';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'http-app-test';
  process.env.WEATHER_DEFAULT_LOCATION = '';
});

// Import only the modules under test, never src/index.ts or src/http.ts (G61).
import { createHttpApp } from '../../src/server/httpApp.js';
import { createTokenVerifier } from '../../src/server/tokenVerifier.js';
import { createWeatherServer } from '../../src/server/weatherServer.js';
import { parseHttpConfig, type HttpConfig } from '../../src/config/http.js';
import { LocationStore } from '../../src/services/locationStore.js';
import { logger, LogLevel } from '../../src/utils/logger.js';
import { createTestIssuer, type TestIssuer } from '../helpers/oauthTestIssuer.js';

const ISSUER = 'http://localhost/issuer';
const PUBLIC_URL = 'http://127.0.0.1/mcp';
const MCP_HEADERS = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
const SCOPE = 'weather:read';

const now = (): number => Math.floor(Date.now() / 1000);

function configFor(env: Record<string, string>): HttpConfig {
  const parsed = parseHttpConfig({ WEATHER_HTTP_PUBLIC_URL: PUBLIC_URL, WEATHER_OAUTH_ISSUER: ISSUER, ...env });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.config;
}

function metadataFor(issuer: string): OAuthMetadata {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    response_types_supported: ['code']
  };
}

let issuer: TestIssuer;
let storeDir: string;
let locationStore: LocationStore;
const listening: HttpServer[] = [];

// Row 5 and row 9 drive the verifier's key resolver through these.
let keyBehavior: JWTVerifyGetKey;
const getKeySpy = vi.fn(((...args: Parameters<JWTVerifyGetKey>) => keyBehavior(...args)) as JWTVerifyGetKey);

// Row 12 counts the Servers the app builds and the ones whose onclose fired.
let built = 0;
let closed = 0;
function countingCreateServer(options: Parameters<typeof createWeatherServer>[0]): McpServer {
  const server = createWeatherServer(options);
  built++;
  const previous = server.onclose;
  server.onclose = () => {
    closed++;
    previous?.();
  };
  return server;
}

function buildApp(config: HttpConfig, key: JWTVerifyGetKey, createServer = countingCreateServer) {
  const verifier = createTokenVerifier({ issuer: ISSUER, audience: config.publicUrl.href, getKey: key });
  return createHttpApp({ config, verifier, oauthMetadata: metadataFor(ISSUER), locationStore, createServer });
}

async function listen(app: ReturnType<typeof createHttpApp>): Promise<{ base: string; port: number }> {
  const srv = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => srv.once('listening', () => resolve()));
  listening.push(srv);
  const { port } = srv.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, port };
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** node:http, because it honours a caller-supplied Host and fetch does not. */
function rawRequest(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string }
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: options.headers, agent: false },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-app-test', version: '1' } }
};
const LIST_TOOLS = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
const CALL_LIST_SAVED = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_saved_locations', arguments: {} } };

function goodClaims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { iss: ISSUER, aud: PUBLIC_URL, sub: 'user-1', exp: now() + 300, ...extra };
}

async function mcpPost(base: string, body: unknown, bearer?: string): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { ...MCP_HEADERS, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

async function waitFor(predicate: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
}

let main: { base: string; port: number };
let scoped: { base: string; port: number };
let mainConfig: HttpConfig;

beforeAll(async () => {
  issuer = await createTestIssuer();
  keyBehavior = issuer.getKey;
  storeDir = mkdtempSync(join(tmpdir(), 'http-app-test-'));
  locationStore = new LocationStore(join(storeDir, 'locations.json'));

  mainConfig = configFor({});
  main = await listen(buildApp(mainConfig, getKeySpy));
  scoped = await listen(buildApp(configFor({ WEATHER_OAUTH_REQUIRED_SCOPES: SCOPE }), issuer.getKey));
});

afterEach(() => {
  keyBehavior = issuer.getKey;
  getKeySpy.mockClear();
});

afterAll(async () => {
  for (const srv of listening) {
    srv.closeAllConnections();
    await new Promise<void>(resolve => srv.close(() => resolve()));
  }
  rmSync(storeDir, { recursive: true, force: true });
});

describe('http app: authentication', () => {
  it('1. no Authorization header gives 401 naming the protected-resource metadata URL', async () => {
    const res = await mcpPost(main.base, {});
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('resource_metadata="');
    expect(challenge).toContain(getOAuthProtectedResourceMetadataUrl(mainConfig.publicUrl));
  });

  it('2. a non-Bearer Authorization header gives 401', async () => {
    const res = await fetch(`${main.base}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, Authorization: 'Basic dXNlcjpwdw==' },
      body: '{}'
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate') ?? '').toContain('resource_metadata="');
  });

  describe('3. each verifier failure arrives as 401 with the header', () => {
    const cases: Array<[string, () => Promise<string>, string[]]> = [
      ['bad signature', () => issuer.sign({ claims: goodClaims(), withOtherKey: true }), []],
      ['wrong iss', () => issuer.sign({ claims: goodClaims({ iss: 'http://localhost/other' }) }), []],
      ['wrong aud', () => issuer.sign({ claims: goodClaims({ aud: 'http://127.0.0.1/elsewhere' }) }), []],
      ['absent aud', () => issuer.sign({ claims: { iss: ISSUER, sub: 'user-1', exp: now() + 300 } }), ['aud']],
      ['expired', () => issuer.sign({ claims: goodClaims({ exp: now() - 600 }) }), []],
      ['absent exp', () => issuer.sign({ claims: { iss: ISSUER, aud: PUBLIC_URL, sub: 'user-1' } }), ['exp']]
    ];
    for (const [name, make, absent] of cases) {
      it(name, async () => {
        const marker = await make();
        // The fixture really lacks the claim; the signer added nothing (G95).
        for (const claim of absent) expect(decodeJwt(marker)).not.toHaveProperty(claim);
        const res = await mcpPost(main.base, INITIALIZE, marker);
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate') ?? '').toContain('resource_metadata="');
      });
    }

    it('control: the same shape with every claim present is accepted', async () => {
      const marker = await issuer.sign({ claims: goodClaims() });
      expect((await mcpPost(main.base, INITIALIZE, marker)).status).toBe(200);
    });
  });

  it('4. a missing required scope gives 403 with scope="..." in the header', async () => {
    const without = await issuer.sign({ claims: goodClaims() });
    const res = await mcpPost(scoped.base, INITIALIZE, without);
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate') ?? '').toContain(`scope="${SCOPE}"`);

    const withScope = await issuer.sign({ claims: goodClaims({ scope: SCOPE }) });
    expect((await mcpPost(scoped.base, INITIALIZE, withScope)).status).toBe(200);
  });

  describe('5. a key resolver that throws gives 500 and no challenge', () => {
    it('a plain Error', async () => {
      keyBehavior = async () => {
        throw new Error('network down');
      };
      const res = await mcpPost(main.base, INITIALIZE, await issuer.sign({ claims: goodClaims() }));
      expect(res.status).toBe(500);
      expect(res.headers.get('www-authenticate')).toBeNull();
    });

    it('a bare JOSEError (a non-200 JWKS)', async () => {
      keyBehavior = async () => {
        throw new errors.JOSEError('unexpected JWKS response');
      };
      const res = await mcpPost(main.base, INITIALIZE, await issuer.sign({ claims: goodClaims() }));
      expect(res.status).toBe(500);
      expect(res.headers.get('www-authenticate')).toBeNull();
    });
  });
});

describe('5a. construction accepts every issuer form the config parser accepts', () => {
  const stubVerifier = {
    verifyAccessToken() {
      return Promise.reject(new Error('unused'));
    }
  };
  function construct(issuerUrl: string): void {
    createHttpApp({
      config: configFor({ WEATHER_OAUTH_ISSUER: issuerUrl }),
      verifier: stubVerifier,
      oauthMetadata: metadataFor(issuerUrl),
      locationStore
    });
  }

  for (const form of ['https://auth.example.test/issuer', 'http://localhost/issuer', 'http://127.0.0.1/issuer']) {
    it(form, () => {
      expect(() => construct(form)).not.toThrow();
    });
  }

  it('negative control: the router itself refuses http://[::1]/issuer', () => {
    // The parser refuses [::1] for the issuer, so it is no wider than the router.
    // This shows the row can go red: construction does throw for a form outside the domain.
    expect(parseHttpConfig({ WEATHER_HTTP_PUBLIC_URL: PUBLIC_URL, WEATHER_OAUTH_ISSUER: 'http://[::1]/issuer' }).ok).toBe(false);
    expect(() =>
      createHttpApp({
        config: mainConfig,
        verifier: stubVerifier,
        oauthMetadata: metadataFor('http://[::1]/issuer'),
        locationStore
      })
    ).toThrow();
  });
});

describe('http app: routes', () => {
  it('6. a valid bearer runs initialize, tools/list and tools/call, statelessly', async () => {
    const marker = await issuer.sign({ claims: goodClaims() });

    const init = await mcpPost(main.base, INITIALIZE, marker);
    expect(init.status).toBe(200);
    expect(init.headers.get('mcp-session-id')).toBeNull();
    const initBody = (await init.json()) as { result?: { serverInfo?: unknown } };
    expect(initBody.result?.serverInfo).toBeDefined();

    const list = await mcpPost(main.base, LIST_TOOLS, marker);
    expect(list.status).toBe(200);
    expect(list.headers.get('mcp-session-id')).toBeNull();
    const listBody = (await list.json()) as { result?: { tools?: Array<{ name: string }> } };
    const names = (listBody.result?.tools ?? []).map(t => t.name);
    expect(names).toContain('list_saved_locations');

    const call = await mcpPost(main.base, CALL_LIST_SAVED, marker);
    expect(call.status).toBe(200);
    expect(call.headers.get('mcp-session-id')).toBeNull();
    const callBody = (await call.json()) as { result?: { content?: unknown[]; isError?: boolean } };
    expect(callBody.result?.isError).not.toBe(true);
    expect(callBody.result?.content?.length ?? 0).toBeGreaterThan(0);
  });

  it('7. GET /healthz needs no bearer and no matching Host', async () => {
    const plain = await fetch(`${main.base}/healthz`);
    expect(plain.status).toBe(200);
    expect(await plain.json()).toEqual({ status: 'ok' });

    const foreign = await rawRequest(main.port, { path: '/healthz', headers: { host: 'evil.example' } });
    expect(foreign.status).toBe(200);
    expect(JSON.parse(foreign.body)).toEqual({ status: 'ok' });
  });

  it('8. the protected-resource document is public and names the public URL', async () => {
    const res = await fetch(`${main.base}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { resource?: string };
    expect(doc.resource).toBe(mainConfig.publicUrl.href);
  });

  it('9. a foreign Host with a valid bearer is refused before the key resolver runs', async () => {
    const marker = await issuer.sign({ claims: goodClaims() });
    const headers = { ...MCP_HEADERS, Authorization: `Bearer ${marker}` };
    const body = JSON.stringify(INITIALIZE);

    // Control through the same client path, loopback Host: accepted, and the resolver ran.
    const control = await rawRequest(main.port, { method: 'POST', path: '/mcp', headers, body });
    expect(control.status).toBe(200);
    expect(getKeySpy).toHaveBeenCalled();
    getKeySpy.mockClear();

    const foreign = await rawRequest(main.port, { method: 'POST', path: '/mcp', headers: { ...headers, host: 'evil.example' }, body });
    expect(foreign.status).toBe(403);
    expect(getKeySpy).not.toHaveBeenCalled();
  });

  it('10. GET and DELETE on the MCP route: 401 without a bearer, 405 with Allow: POST with one', async () => {
    const marker = await issuer.sign({ claims: goodClaims() });
    for (const method of ['GET', 'DELETE']) {
      const anon = await fetch(`${main.base}/mcp`, { method });
      expect(anon.status).toBe(401);
      const authed = await fetch(`${main.base}/mcp`, { method, headers: { Authorization: `Bearer ${marker}` } });
      expect(authed.status).toBe(405);
      expect(authed.headers.get('allow')).toBe('POST');
    }
  });

  it('11. an oversize body gives 413 and malformed JSON gives 400, neither echoing the body', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const marker = await issuer.sign({ claims: goodClaims() });

      const big = await mcpPost(main.base, JSON.stringify({ x: 'a'.repeat(300_000) }), marker);
      expect(big.status).toBe(413);
      expect(big.headers.get('content-type') ?? '').toContain('application/json');
      expect(await big.text()).not.toContain('zqbody7731');

      const bad = await mcpPost(main.base, '{"zqbody7731": ', marker);
      expect(bad.status).toBe(400);
      expect(bad.headers.get('content-type') ?? '').toContain('application/json');
      const badBody = await bad.text();
      expect(badBody).not.toContain('zqbody7731');
      expect(JSON.parse(badBody)).toMatchObject({ jsonrpc: '2.0', error: { code: -32700 } });

      // Cannot go red under Vitest: NODE_ENV=test already silences express's default
      // logger. The response-body assertions above are the ones a mutation can redden.
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('zqbody7731');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('12. every request builds and closes its own Server, and leaks no handlers', async () => {
    const marker = await issuer.sign({ claims: goodClaims() });
    // Warm-up, so the client's connection pool is already open when counting starts.
    await (await mcpPost(main.base, CALL_LIST_SAVED, marker)).text();
    await waitFor(() => built === closed);

    const events = ['SIGTERM', 'SIGINT', 'exit', 'uncaughtException'] as const;
    const listenersBefore = events.map(e => process.listenerCount(e));
    const builtBefore = built;
    const closedBefore = closed;
    const resourcesBefore = process.getActiveResourcesInfo().length;

    for (let i = 0; i < 20; i++) {
      const res = await mcpPost(main.base, { ...CALL_LIST_SAVED, id: 100 + i }, marker);
      expect(res.status).toBe(200);
      await res.text();
    }

    // res.on('close') closes the Server asynchronously.
    await waitFor(() => closed - closedBefore >= 20);
    expect(built - builtBefore).toBe(20);
    expect(closed - closedBefore).toBe(20);
    expect(events.map(e => process.listenerCount(e))).toEqual(listenersBefore);
    // Give or take the test client's own sockets and timers.
    expect(Math.abs(process.getActiveResourcesInfo().length - resourcesBefore)).toBeLessThanOrEqual(3);
  });
});

describe('http app: exact route and access log', () => {
  it('14. the route is case-sensitive and strict: /MCP and /mcp/ answer 404 with a valid bearer', async () => {
    const marker = await issuer.sign({ claims: goodClaims() });
    const control = await mcpPost(main.base, INITIALIZE, marker);
    expect(control.status).toBe(200);
    await control.text();
    for (const path of ['/MCP', '/mcp/']) {
      const res = await fetch(`${main.base}${path}`, {
        method: 'POST',
        headers: { ...MCP_HEADERS, Authorization: `Bearer ${marker}` },
        body: JSON.stringify(INITIALIZE)
      });
      expect(res.status).toBe(404);
      await res.text();
    }
  });

  it('15. a client that hangs up before the response still gets one access line, status aborted', async () => {
    const marker = await issuer.sign({ claims: goodClaims() });
    const info = vi.spyOn(logger, 'info');
    try {
      // Promise a body it never finishes, so express.json is still reading when the socket dies.
      await new Promise<void>(resolve => {
        const req = http.request({
          host: '127.0.0.1',
          port: main.port,
          method: 'POST',
          path: '/mcp',
          agent: false,
          headers: { ...MCP_HEADERS, Authorization: `Bearer ${marker}`, 'Content-Length': '1000' }
        });
        req.on('error', () => resolve());
        req.on('close', () => resolve());
        req.write('{"jsonrpc":');
        setTimeout(() => req.destroy(), 150);
      });
      const accessLines = () => info.mock.calls.filter(call => call[0] === 'HTTP request');
      await waitFor(() => accessLines().length > 0);
      expect(accessLines()).toHaveLength(1);
      expect(accessLines()[0][1]).toMatchObject({ method: 'POST', status: 'aborted' });
    } finally {
      info.mockRestore();
    }
  });
});

describe('13. whole-path log sentinel (G123)', () => {
  let spies: Array<ReturnType<typeof vi.spyOn>> = [];
  const PATH_MARKER = 'zqpath7731';
  let base = '';

  beforeAll(async () => {
    // Installed here, not at collection time (Vitest rebinds console after collection),
    // and before createHttpApp runs. No mockClear afterwards (G123).
    spies = (['error', 'warn', 'log', 'info', 'debug'] as const).map(name =>
      vi.spyOn(console, name).mockImplementation(() => undefined)
    );
    vi.stubEnv('LOG_PII', 'true');
    logger.setLevel(LogLevel.DEBUG);
    const config = configFor({ WEATHER_HTTP_PUBLIC_URL: `http://127.0.0.1/${PATH_MARKER}` });
    ({ base } = await listen(buildApp(config, issuer.getKey)));
  });

  afterAll(() => {
    logger.setLevel(LogLevel.INFO);
    vi.unstubAllEnvs();
    for (const spy of spies) spy.mockRestore();
  });

  it('no console argument carries a claim, a bearer, or the route path', async () => {
    const audience = `http://127.0.0.1/${PATH_MARKER}`;
    const claims = { iss: ISSUER, aud: audience, sub: 'zqsub7731', client_id: 'zqclient7731', exp: now() + 300 };
    const valid = await issuer.sign({ claims });
    const wrongAudience = await issuer.sign({ claims: { ...claims, aud: 'http://127.0.0.1/elsewhere' } });
    const badSignature = await issuer.sign({ claims, withOtherKey: true });
    const send = (path: string, authorization?: string) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { ...MCP_HEADERS, ...(authorization ? { Authorization: authorization } : {}) },
        body: JSON.stringify(INITIALIZE)
      }).then(r => r.text());

    await send(`/${PATH_MARKER}`, `Bearer ${valid}`);
    await send(`/${PATH_MARKER}`, `Bearer ${wrongAudience}`);
    await send(`/${PATH_MARKER}`, `Bearer ${badSignature}`);
    await send(`/${PATH_MARKER}`, 'Bearer zqraw7731');
    await send(`/${PATH_MARKER}`);

    const everything = spies.flatMap(spy => spy.mock.calls.map((call: unknown[]) => JSON.stringify(call))).join('\n');

    // Non-vacuous: the rejection and access lines did log.
    expect(everything).toContain('Access token rejected');
    expect(everything).toContain('HTTP request');

    const forbidden = [
      'zqsub7731',
      'zqclient7731',
      'zqraw7731',
      PATH_MARKER,
      valid,
      wrongAudience,
      badSignature,
      valid.split('.')[1] ?? 'unreachable-payload-segment'
    ];
    for (const needle of forbidden) expect(everything).not.toContain(needle);
  });
});
