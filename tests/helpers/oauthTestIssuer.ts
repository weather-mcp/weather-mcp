/**
 * Key material and a signer for tests that stand in for an OAuth authorization
 * server, plus `startIssuerServer`, a loopback HTTP server that serves the RFC 8414
 * metadata and the JWKS. Loopback only: the one socket opened is on 127.0.0.1.
 *
 * The signer sets only the claims it is given (G95): no defaulted `iss`, `aud`,
 * `exp` or `sub`, so an "absent claim" fixture is really absent.
 *
 * The issuer server serves `publicJwks()`, so the signer and the server share one key set.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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

export interface IssuerServerOptions {
  /** Answer the metadata request with HTTP 500. */
  metadataStatus500?: boolean;
  /** Name this issuer in the metadata instead of the server's own origin. */
  namedIssuer?: string;
  /** Hold the metadata answer this long, so a test can probe the child while discovery is pending. */
  metadataDelayMs?: number;
}

export interface IssuerServer {
  /** `http://127.0.0.1:<port>`, the issuer the metadata names (unless overridden). */
  origin: string;
  port: number;
  /** Resolves when the first metadata request arrives. */
  metadataSeen: Promise<void>;
  close(): Promise<void>;
}

/** A loopback authorization server: RFC 8414 metadata at the well-known path, and a JWKS. */
export async function startIssuerServer(issuer: TestIssuer, options: IssuerServerOptions = {}): Promise<IssuerServer> {
  let markSeen: () => void = () => undefined;
  const metadataSeen = new Promise<void>((resolve) => {
    markSeen = resolve;
  });
  const server: Server = createServer((req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/.well-known/oauth-authorization-server') {
      markSeen();
      const answer = (): void => {
        if (options.metadataStatus500) {
          res.statusCode = 500;
          res.end('{}');
          return;
        }
        res.end(
          JSON.stringify({
            issuer: options.namedIssuer ?? origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            response_types_supported: ['code'],
            jwks_uri: `${origin}/jwks`
          })
        );
      };
      if (options.metadataDelayMs) setTimeout(answer, options.metadataDelayMs).unref();
      else answer();
      return;
    }
    if (req.url === '/jwks') {
      res.end(JSON.stringify(issuer.publicJwks()));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    metadataSeen,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      })
  };
}
