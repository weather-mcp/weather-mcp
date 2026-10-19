/**
 * Key material and a signer for tests that stand in for an OAuth authorization
 * server. Loopback only: nothing here opens a socket.
 *
 * The signer sets only the claims it is given (G95): no defaulted `iss`, `aud`,
 * `exp` or `sub`, so an "absent claim" fixture is really absent.
 *
 * The public JWK, the key pair and `getKey` are exported so a loopback issuer
 * HTTP server (T8: `/.well-known/oauth-authorization-server` plus a JWKS) can
 * serve `publicJwks()` without a second key set. That server is not built here.
 */

import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  type JWTVerifyGetKey
} from 'jose';

export type TestAlg = 'ES256' | 'HS256';

export interface SignOptions {
  /** Exactly the claims to sign; nothing is added. */
  claims: JWTPayload;
  alg?: TestAlg;
  /** The `kid` header. Defaults to the issuer's published key id. */
  kid?: string;
  /** Sign with the unpublished second key, for a bad-signature fixture. */
  withOtherKey?: boolean;
}

export interface TestIssuer {
  kid: string;
  /** The published public key. */
  publicJwk: JWK;
  /** The JWKS document body an issuer would serve. */
  publicJwks(): { keys: JWK[] };
  /** A local resolver over the published key. */
  getKey: JWTVerifyGetKey;
  sign(options: SignOptions): Promise<string>;
}

const HS256_KEY = new TextEncoder().encode('a-shared-secret-of-at-least-32-bytes!!');

export async function createTestIssuer(kid = 'test-kid-1'): Promise<TestIssuer> {
  const primary = await generateKeyPair('ES256');
  const other = await generateKeyPair('ES256');
  const publicJwk: JWK = { ...(await exportJWK(primary.publicKey)), kid, alg: 'ES256', use: 'sig' };

  return {
    kid,
    publicJwk,
    publicJwks: () => ({ keys: [publicJwk] }),
    getKey: createLocalJWKSet({ keys: [publicJwk] }),
    async sign({ claims, alg = 'ES256', kid: headerKid = kid, withOtherKey = false }: SignOptions): Promise<string> {
      const jwt = new SignJWT(claims).setProtectedHeader({ alg, kid: headerKid });
      if (alg === 'HS256') return jwt.sign(HS256_KEY);
      return jwt.sign(withOtherKey ? other.privateKey : primary.privateKey);
    }
  };
}
