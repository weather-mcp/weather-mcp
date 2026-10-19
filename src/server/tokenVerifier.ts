/**
 * OAuth 2.1 resource-server token verification for the HTTP entry.
 *
 * The HTTP entry never issues a token. It checks a JWT access token against the
 * authorization server's JWKS and maps the result into the SDK's `AuthInfo`, so
 * `requireBearerAuth` (the SDK middleware) writes every 401/403 itself.
 *
 * Three SDK behaviours shape this module (bearerAuth.js, SDK 1.32.1):
 * - Only an `InvalidTokenError` becomes a 401 with `WWW-Authenticate`, and only a
 *   `ServerError` a clean 500. Any other error is a 500 with a generic body, so every
 *   failure here is wrapped in one of the two.
 * - The error's message is written into `WWW-Authenticate` unescaped, so every
 *   message here is a fixed literal. A `jose` message can quote claim values.
 * - The middleware compares `authInfo.resource` with its `expectedResource` and
 *   requires a numeric `expiresAt`, so both are always set.
 *
 * A `jose` error is classified by class and `.claim`, never by message (G123).
 */

import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { InvalidTokenError, ServerError, type OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { logger as defaultLogger, type Logger } from '../utils/logger.js';

/**
 * Asymmetric algorithms only. The resource server holds no shared secret, and an
 * `HS256` token "signed" with a public key is the classic key-confusion attack.
 */
export const ACCEPTED_TOKEN_ALGORITHMS = [
  'RS256', 'RS384', 'RS512',
  'PS256', 'PS384', 'PS512',
  'ES256', 'ES384', 'ES512',
  'EdDSA'
] as const;

/**
 * Why a request's token was refused. `missing` and `scope` are decided by the
 * HTTP app (`src/server/httpApp.ts`); the other four here.
 */
export type TokenRejectionReason =
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'audience'
  | 'jwks_unavailable'
  | 'scope';

/**
 * Log one rejected request. The one site of the message, so every reason class
 * reads the same. The record carries the reason and nothing else: no token, no
 * claim, no subject, no error text, at any level and under `LOG_PII` too.
 */
export function logTokenRejection(reason: TokenRejectionReason, log: Pick<Logger, 'warn'> = defaultLogger): void {
  log.warn('Access token rejected', { reason, securityEvent: true });
}

export interface TokenVerifierOptions {
  /** The issuer every token's `iss` must equal. */
  issuer: string;
  /** The public URL, exactly as configured. Every token's `aud` must contain it (RFC 8707). */
  audience: string;
  /** `createRemoteJWKSet(jwksUri)` in production, `createLocalJWKSet(...)` in tests. */
  getKey: JWTVerifyGetKey;
  logger?: Pick<Logger, 'warn'>;
}

interface Rejection {
  reason: TokenRejectionReason;
  error: OAuthError;
}

const UNAVAILABLE_MESSAGE = 'Token verification is temporarily unavailable';

function classify(error: unknown): Rejection {
  if (error instanceof errors.JWTExpired) {
    return { reason: 'expired', error: new InvalidTokenError('Token has expired') };
  }
  if (error instanceof errors.JWTClaimValidationFailed && error.claim === 'aud') {
    return { reason: 'audience', error: new InvalidTokenError('Token was not issued for this resource') };
  }
  // The JWKS could not be read. A 401 here would send every client into a
  // re-login loop during an authorization-server outage, so it is a 500.
  // - JWKSTimeout: the fetch outlived jose's timeout.
  // - Not a JOSEError at all: the fetch itself failed (DNS, refused, reset).
  // - The bare JOSEError class: jose throws it only for a non-200 or an
  //   unparseable JWKS response (jwks/remote.js). Matched by exact class.
  if (
    error instanceof errors.JWKSTimeout ||
    !(error instanceof errors.JOSEError) ||
    error.constructor === errors.JOSEError
  ) {
    return { reason: 'jwks_unavailable', error: new ServerError(UNAVAILABLE_MESSAGE) };
  }
  // Signature, iss, missing exp, alg, no matching kid, malformed.
  return { reason: 'invalid', error: new InvalidTokenError('Invalid access token') };
}

function clientIdOf(payload: JWTPayload): string {
  if (typeof payload.client_id === 'string') return payload.client_id;
  if (typeof payload.azp === 'string') return payload.azp;
  return '';
}

function scopesOf(payload: JWTPayload): string[] {
  // Always an array: the SDK's scope check calls .includes on it.
  if (typeof payload.scope === 'string') return payload.scope.split(' ').filter(s => s.length > 0);
  const scp = payload.scp;
  if (Array.isArray(scp) && scp.every((s): s is string => typeof s === 'string')) return [...scp];
  return [];
}

/**
 * Build the verifier `requireBearerAuth` calls once per request.
 *
 * Scope enforcement is not here: it stays in the SDK middleware, so the 403 and
 * its `scope=` hint are the SDK's.
 */
export function createTokenVerifier(options: TokenVerifierOptions): OAuthTokenVerifier {
  const { issuer, audience, getKey } = options;
  const log = options.logger ?? defaultLogger;
  // Parsed once, so a bad audience fails at construction rather than per request.
  const resourceHref = new URL(audience).href;

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, getKey, {
          issuer,
          audience,
          algorithms: [...ACCEPTED_TOKEN_ALGORITHMS],
          requiredClaims: ['exp']
        }));
      } catch (error) {
        const rejection = classify(error);
        logTokenRejection(rejection.reason, log);
        throw rejection.error;
      }

      // requiredClaims makes jose refuse a token without a numeric exp, so this
      // only narrows the type.
      if (typeof payload.exp !== 'number') {
        logTokenRejection('invalid', log);
        throw new InvalidTokenError('Invalid access token');
      }

      return {
        token,
        clientId: clientIdOf(payload),
        scopes: scopesOf(payload),
        expiresAt: payload.exp,
        // A fresh URL per call: AuthInfo reaches tool handlers, and URL is mutable.
        resource: new URL(resourceHref)
      };
    }
  };
}
