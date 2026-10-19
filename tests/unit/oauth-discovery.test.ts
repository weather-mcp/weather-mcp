import { describe, it, expect } from 'vitest';
import {
  discoverIssuer,
  ERR_DISCOVERY_UNREADABLE,
  ERR_DISCOVERY_ISSUER_MISMATCH,
  ERR_DISCOVERY_NO_JWKS_URI,
  ERR_DISCOVERY_JWKS_URI_HTTPS,
} from '../../src/server/oauthDiscovery.js';

const HOST = 'https://auth.example.test';
const LEAK = 'zqfetch7731';
const LEAK_ISSUER = 'https://zqissuer7731.example.test';

function doc(issuer: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    response_types_supported: ['code'],
    jwks_uri: `${issuer}/jwks`,
    ...extra,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Routes = Record<string, () => Response | Promise<Response>>;

function router(routes: Routes): { fetchFn: (u: string | URL) => Promise<Response>; seen: string[] } {
  const seen: string[] = [];
  const fetchFn = async (u: string | URL): Promise<Response> => {
    const href = String(u);
    seen.push(href);
    const h = routes[href];
    return h ? h() : new Response('nope', { status: 404 });
  };
  return { fetchFn, seen };
}

async function run(issuer: string, routes: Routes) {
  const r = router(routes);
  const result = await discoverIssuer(new URL(issuer), issuer, r.fetchFn);
  return { result, seen: r.seen };
}

function expectRefusal(result: Awaited<ReturnType<typeof discoverIssuer>>, message: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBe(message);
  expect(result.error).not.toContain(LEAK);
  expect(result.error).not.toContain('zqissuer7731');
}

describe('discoverIssuer', () => {
  it('accepts an RFC 8414 document', async () => {
    const { result } = await run(HOST, {
      [`${HOST}/.well-known/oauth-authorization-server`]: () => json(doc(HOST)),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jwksUri).toBeInstanceOf(URL);
    expect(result.jwksUri.href).toBe(`${HOST}/jwks`);
    expect(result.metadata.issuer).toBe(HOST);
  });

  it('accepts an OIDC-only issuer when the 8414 path answers 404', async () => {
    const { result, seen } = await run(HOST, {
      [`${HOST}/.well-known/openid-configuration`]: () =>
        json(doc(HOST, { subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] })),
    });
    expect(seen[0]).toBe(`${HOST}/.well-known/oauth-authorization-server`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jwksUri.href).toBe(`${HOST}/jwks`);
    expect(result.metadata.token_endpoint).toBe(`${HOST}/token`);
  });

  it('requests the path-form well-known URLs for an issuer with a path', async () => {
    const issuer = `${HOST}/realms/home`;
    const { result, seen } = await run(issuer, {
      [`${HOST}/.well-known/openid-configuration/realms/home`]: () =>
        json(doc(issuer, { subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] })),
    });
    expect(seen).toEqual([
      `${HOST}/.well-known/oauth-authorization-server/realms/home`,
      `${HOST}/.well-known/openid-configuration/realms/home`,
    ]);
    expect(result.ok).toBe(true);
  });

  it('requests the issuer-relative OIDC URL last', async () => {
    const issuer = `${HOST}/realms/home`;
    const { result, seen } = await run(issuer, {
      [`${issuer}/.well-known/openid-configuration`]: () =>
        json(doc(issuer, { subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] })),
    });
    expect(seen[2]).toBe(`${issuer}/.well-known/openid-configuration`);
    expect(result.ok).toBe(true);
  });

  it('refuses an issuer mismatch', async () => {
    const { result } = await run(LEAK_ISSUER, {
      [`${LEAK_ISSUER}/.well-known/oauth-authorization-server`]: () => json(doc('https://other.example.test')),
    });
    expectRefusal(result, ERR_DISCOVERY_ISSUER_MISMATCH);
  });

  it('refuses a trailing-slash difference as a mismatch', async () => {
    const issuer = `${HOST}/realms/home`;
    const r = router({
      [`${HOST}/.well-known/oauth-authorization-server/realms/home`]: () => json(doc(`${issuer}/`)),
    });
    const result = await discoverIssuer(new URL(issuer), issuer, r.fetchFn);
    expectRefusal(result, ERR_DISCOVERY_ISSUER_MISMATCH);
  });

  it('refuses a document with no jwks_uri', async () => {
    const d = doc(HOST);
    delete d['jwks_uri'];
    const { result } = await run(HOST, { [`${HOST}/.well-known/oauth-authorization-server`]: () => json(d) });
    expectRefusal(result, ERR_DISCOVERY_NO_JWKS_URI);
  });

  it('refuses an http jwks_uri on a public host', async () => {
    const { result } = await run(HOST, {
      [`${HOST}/.well-known/oauth-authorization-server`]: () => json(doc(HOST, { jwks_uri: 'http://auth.example.test/jwks' })),
    });
    expectRefusal(result, ERR_DISCOVERY_JWKS_URI_HTTPS);
  });

  it('accepts an http jwks_uri on localhost', async () => {
    const { result } = await run(HOST, {
      [`${HOST}/.well-known/oauth-authorization-server`]: () => json(doc(HOST, { jwks_uri: 'http://localhost:8080/jwks' })),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jwksUri.href).toBe('http://localhost:8080/jwks');
  });

  it('accepts an http jwks_uri on bracketed [::1]', async () => {
    const { result } = await run(HOST, {
      [`${HOST}/.well-known/oauth-authorization-server`]: () => json(doc(HOST, { jwks_uri: 'http://[::1]:8080/jwks' })),
    });
    expect(result.ok).toBe(true);
  });

  it('refuses an unparseable jwks_uri (the OAuth schema leaves it unchecked, so this check is first)', async () => {
    const { result } = await run(HOST, {
      [`${HOST}/.well-known/oauth-authorization-server`]: () => json(doc(HOST, { jwks_uri: 'not a url' })),
    });
    expectRefusal(result, ERR_DISCOVERY_JWKS_URI_HTTPS);
  });

  it('refuses a non-http scheme for jwks_uri', async () => {
    const { result } = await run(HOST, {
      [`${HOST}/.well-known/oauth-authorization-server`]: () => json(doc(HOST, { jwks_uri: 'ftp://auth.example.test/jwks' })),
    });
    expectRefusal(result, ERR_DISCOVERY_JWKS_URI_HTTPS);
  });

  it('refuses a fetch that throws with a code', async () => {
    const fetchFn = async (): Promise<Response> => {
      throw Object.assign(new Error(LEAK), { code: 'ECONNREFUSED' });
    };
    const result = await discoverIssuer(new URL(LEAK_ISSUER), LEAK_ISSUER, fetchFn);
    expectRefusal(result, ERR_DISCOVERY_UNREADABLE);
  });

  it("refuses a fetch that throws TypeError('fetch failed')", async () => {
    const fetchFn = async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    };
    const result = await discoverIssuer(new URL(LEAK_ISSUER), LEAK_ISSUER, fetchFn);
    expectRefusal(result, ERR_DISCOVERY_UNREADABLE);
  });

  it('refuses a 500', async () => {
    const { result } = await run(LEAK_ISSUER, {
      [`${LEAK_ISSUER}/.well-known/oauth-authorization-server`]: () => new Response('boom', { status: 500 }),
    });
    expectRefusal(result, ERR_DISCOVERY_UNREADABLE);
  });

  it('refuses invalid JSON', async () => {
    const { result } = await run(HOST, {
      [`${HOST}/.well-known/oauth-authorization-server`]: () => new Response('{not json', { status: 200 }),
    });
    expectRefusal(result, ERR_DISCOVERY_UNREADABLE);
  });

  it('refuses a 200 whose body fails the schema', async () => {
    const { result } = await run(HOST, {
      [`${HOST}/.well-known/oauth-authorization-server`]: () => json({ issuer: HOST }),
    });
    expectRefusal(result, ERR_DISCOVERY_UNREADABLE);
  });

  it('refuses when every well-known URL answers 404', async () => {
    const { result } = await run(HOST, {});
    expectRefusal(result, ERR_DISCOVERY_UNREADABLE);
  });
});
