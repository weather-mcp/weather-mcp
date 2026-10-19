import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  SignJWT,
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  type JWTVerifyGetKey
} from 'jose';
import { InvalidTokenError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { createTokenVerifier } from '../../src/server/tokenVerifier.js';
import { logger, LogLevel } from '../../src/utils/logger.js';

// No socket: the JWKS is local (createLocalJWKSet), so this file runs under the
// unit project's no-network guard.

const ISSUER = 'https://auth.example.test/realms/home';
const AUDIENCE = 'https://weather.example.test/mcp';
const KID = 'kid-1';

// One distinct sentinel per channel, so a hit names its source (G62).
const SUB = 'zqsub7731';
const CLIENT = 'zqclient7731';
const CLAIM = 'zqclaim7731';
const JOSE_MSG = 'zqjosemsg7731';
const JWKS_MSG = 'zqjwks7731';

type KeyLike = CryptoKey;

let signingKey: KeyLike;
let otherKey: KeyLike;
let getKey: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  const other = await generateKeyPair('ES256');
  signingKey = pair.privateKey;
  otherKey = other.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
  getKey = createLocalJWKSet({ keys: [jwk] });
});

const now = (): number => Math.floor(Date.now() / 1000);

/** Sign exactly the claims given; nothing is defaulted (G95). */
async function sign(
  claims: JWTPayload,
  { key = signingKey, kid = KID }: { key?: KeyLike; kid?: string } = {}
): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid }).sign(key);
}

function goodClaims(extra: JWTPayload = {}): JWTPayload {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: SUB,
    exp: now() + 300,
    iat: now(),
    ...extra
  };
}

/** HS256 over a shared secret, built by hand so no symmetric key enters the JWKS. */
async function signHs256(claims: JWTPayload): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', kid: KID })
    .sign(new TextEncoder().encode('a-shared-secret-of-at-least-32-bytes!!'));
}

describe('createTokenVerifier', () => {
  let warn: Mock<(message: string, metadata?: Record<string, unknown>) => void>;

  beforeEach(() => {
    warn = vi.fn();
  });

  function verifier(key: JWTVerifyGetKey = getKey) {
    return createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, getKey: key, logger: { warn } });
  }

  async function expectRejection(
    marker: string,
    key: JWTVerifyGetKey,
    cls: typeof InvalidTokenError | typeof ServerError,
    message: string,
    reason: string
  ): Promise<void> {
    const err = await verifier(key).verifyAccessToken(marker).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(cls);
    expect((err as Error).message).toBe(message);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Access token rejected', { reason, securityEvent: true });
  }

  const invalid = (marker: string, key: JWTVerifyGetKey = getKey) =>
    expectRejection(marker, key, InvalidTokenError, 'Invalid access token', 'invalid');

  describe('row 1: a valid token maps to AuthInfo (D7)', () => {
    it('maps a space-separated scope string and client_id', async () => {
      const exp = now() + 300;
      const marker = await sign(goodClaims({ exp, scope: 'weather:read  weather:write', client_id: CLIENT }));
      const info = await verifier().verifyAccessToken(marker);
      expect(info.token).toBe(marker);
      expect(info.clientId).toBe(CLIENT);
      expect(info.scopes).toEqual(['weather:read', 'weather:write']);
      expect(info.expiresAt).toBe(exp);
      expect(info.resource).toBeInstanceOf(URL);
      expect(info.resource?.href).toBe(new URL(AUDIENCE).href);
      expect(info.extra).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    });

    it('maps an scp array and falls back to azp', async () => {
      const marker = await sign(goodClaims({ scp: ['a', 'b'], azp: CLIENT }));
      const info = await verifier().verifyAccessToken(marker);
      expect(info.clientId).toBe(CLIENT);
      expect(info.scopes).toEqual(['a', 'b']);
    });

    it('prefers client_id over azp, and gives empty defaults when neither is present', async () => {
      const both = await verifier().verifyAccessToken(await sign(goodClaims({ client_id: 'c', azp: 'a' })));
      expect(both.clientId).toBe('c');
      const none = await verifier().verifyAccessToken(await sign(goodClaims({ scp: ['a', 7] })));
      expect(none.clientId).toBe('');
      expect(none.scopes).toEqual([]);
    });

    it('accepts an aud array that contains the resource', async () => {
      const marker = await sign(goodClaims({ aud: ['https://other.example.test', AUDIENCE] }));
      await expect(verifier().verifyAccessToken(marker)).resolves.toMatchObject({ clientId: '' });
    });

    it('returns a fresh resource URL per call', async () => {
      const v = verifier();
      const marker = await sign(goodClaims());
      const a = await v.verifyAccessToken(marker);
      const b = await v.verifyAccessToken(marker);
      expect(a.resource).not.toBe(b.resource);
    });
  });

  it('row 2: a bad signature (a second key under the same kid) is invalid', async () => {
    await invalid(await sign(goodClaims(), { key: otherKey }));
  });

  it('row 3: a wrong iss is invalid', async () => {
    await invalid(await sign(goodClaims({ iss: 'https://evil.example.test/' })));
  });

  it('row 4: a wrong aud is an audience rejection', async () => {
    await expectRejection(
      await sign(goodClaims({ aud: 'https://other.example.test/mcp' })),
      getKey,
      InvalidTokenError,
      'Token was not issued for this resource',
      'audience'
    );
  });

  it('row 5: an absent aud is an audience rejection', async () => {
    const claims = goodClaims();
    delete claims.aud;
    await expectRejection(
      await sign(claims),
      getKey,
      InvalidTokenError,
      'Token was not issued for this resource',
      'audience'
    );
  });

  it('row 6: an expired token is an expired rejection', async () => {
    await expectRejection(
      await sign(goodClaims({ exp: now() - 600 })),
      getKey,
      InvalidTokenError,
      'Token has expired',
      'expired'
    );
  });

  it('row 7: an absent exp is invalid', async () => {
    const claims = goodClaims();
    delete claims.exp;
    await invalid(await sign(claims));
  });

  it('row 8: an HS256 token is invalid', async () => {
    await invalid(await signHs256(goodClaims()));
  });

  it('row 9: a kid not in the set is invalid', async () => {
    await invalid(await sign(goodClaims(), { kid: 'kid-unknown' }));
  });

  it('a malformed token is invalid', async () => {
    await invalid('not.a.jwt');
  });

  describe('a JWKS that cannot be read is a 500, never a 401 (D10)', () => {
    const unavailable = (key: JWTVerifyGetKey, marker: string) =>
      expectRejection(marker, key, ServerError, 'Token verification is temporarily unavailable', 'jwks_unavailable');

    it('row 10: a getKey that throws a plain Error', async () => {
      await unavailable(() => {
        throw new Error(JOSE_MSG);
      }, await sign(goodClaims()));
    });

    it('row 11: a getKey that throws JWKSTimeout', async () => {
      await unavailable(() => {
        throw new errors.JWKSTimeout();
      }, await sign(goodClaims()));
    });

    it('row 12: a getKey that throws the bare JOSEError (non-200 or unparseable JWKS)', async () => {
      await unavailable(() => {
        throw new errors.JOSEError(JWKS_MSG);
      }, await sign(goodClaims()));
      expect(JSON.stringify(warn.mock.calls)).not.toContain(JWKS_MSG);
    });
  });
});

describe('token verifier log sentinel (G123, G112)', () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  let savedLevel: LogLevel;

  beforeEach(() => {
    savedLevel = logger.getLevel();
    logger.setLevel(LogLevel.DEBUG);
    vi.stubEnv('LOG_PII', 'true');
    // console identities, never process.stderr.write (G34); installed before the
    // verifier is constructed and never cleared after.
    for (const name of ['error', 'warn', 'log', 'info', 'debug'] as const) {
      spies.push(vi.spyOn(console, name).mockImplementation(() => {}));
    }
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
    logger.setLevel(savedLevel);
    vi.unstubAllEnvs();
  });

  it('logs no token, claim, subject or jose message, valid or rejected, under LOG_PII and DEBUG', async () => {
    // Uses the real logger singleton, not an injected one.
    const v = createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, getKey });
    const throwing = createTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      getKey: () => {
        throw new Error(JOSE_MSG);
      }
    });

    const claims = goodClaims({ client_id: CLIENT, custom: CLAIM });
    const marker = await sign(claims);
    const markers = [
      marker,
      await sign(goodClaims({ client_id: CLIENT, custom: CLAIM, aud: 'https://other.example.test/' })),
      await sign(goodClaims({ client_id: CLIENT, custom: CLAIM, exp: now() - 600 })),
      await sign(goodClaims({ client_id: CLIENT, custom: CLAIM }), { key: otherKey }),
      await sign(goodClaims({ client_id: CLIENT, custom: CLAIM, iss: 'https://evil.example.test/' }))
    ];

    await v.verifyAccessToken(marker);
    for (const m of markers.slice(1)) {
      await v.verifyAccessToken(m).catch(() => undefined);
    }
    await throwing.verifyAccessToken(marker).catch(() => undefined);

    const recorded = spies.flatMap(spy => spy.mock.calls.map((call: unknown[]) => JSON.stringify(call)));
    // The rejections did log, so the empty-hit assertions below are not vacuous.
    expect(recorded.filter(line => line.includes('Access token rejected'))).toHaveLength(5);
    const forbidden = [SUB, CLIENT, CLAIM, JOSE_MSG, ...markers.flatMap(m => [m.slice(0, 16), m.slice(-16)])];
    for (const line of recorded) {
      for (const f of forbidden) {
        expect(line.includes(f), `log line carries ${f}`).toBe(false);
      }
    }
    const reasons = recorded
      .filter(line => line.includes('Access token rejected'))
      .map(line => (JSON.parse(JSON.parse(line)[0]) as { metadata: { reason: string } }).metadata.reason);
    expect(reasons).toEqual(['audience', 'expired', 'invalid', 'invalid', 'jwks_unavailable']);
  });
});
