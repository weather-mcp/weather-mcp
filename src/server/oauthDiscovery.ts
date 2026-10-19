/**
 * Issuer discovery for the HTTP entry's fail-closed startup.
 *
 * Contract, not garnish: the entry reads the authorization server's metadata
 * before it listens, and refuses to start if the answer is missing or wrong. An
 * auth layer that degraded silently to "no verification" would be an open
 * instance, so every problem here becomes a refusal.
 *
 * The module wraps the SDK's `discoverAuthorizationServerMetadata` (RFC 8414,
 * then OpenID Connect Discovery) and adds three checks the SDK does not make:
 * the metadata names exactly the configured issuer (RFC 8414 section 3.3, a
 * byte-for-byte compare with no trailing-slash normalisation), it publishes a
 * `jwks_uri`, and that URI is https (http only for a loopback host).
 *
 * The whole discovery runs under one deadline (`DISCOVERY_TIMEOUT_MS`). The SDK
 * sets none, so an issuer that accepts the connection and never answers would
 * otherwise hold startup, unbound and silent, for undici's 300 s. The deadline
 * races each fetch rather than only signalling it, so a fetch that ignores its
 * signal cannot hold startup either. A timeout is `ERR_DISCOVERY_UNREADABLE`.
 *
 * `discoverIssuer` never throws. The SDK throws on a 5xx and on a schema
 * failure, and those errors embed the endpoint URL, so no thrown text is passed
 * on. Each failure maps to one fixed message that quotes neither the URL, the
 * issuer value nor the upstream error (GOTCHAS G123). The messages are exported
 * because the docs copy them verbatim.
 */

import { discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { OAuthMetadataSchema, type OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';

export const ERR_DISCOVERY_UNREADABLE =
  "could not read the authorization server's metadata from WEATHER_OAUTH_ISSUER";
export const ERR_DISCOVERY_ISSUER_MISMATCH =
  "the authorization server's metadata names a different issuer than WEATHER_OAUTH_ISSUER";
export const ERR_DISCOVERY_NO_JWKS_URI =
  'the authorization server publishes no jwks_uri; JWT access tokens cannot be verified';
export const ERR_DISCOVERY_JWKS_URI_HTTPS = "the authorization server's jwks_uri must be an https URL";

// URL.hostname keeps IPv6 literals bracketed (GOTCHAS G109).
const JWKS_LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Upper bound on the whole discovery, every well-known URL included. */
export const DISCOVERY_TIMEOUT_MS = 10_000;

/** `base`, with every call aborted and rejected once `deadline` fires. */
function underDeadline(base: FetchLike, deadline: AbortSignal): FetchLike {
  return (url, init) => {
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<Response>((resolve, reject) => {
      const onAbort = (): void => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      base(url, { ...init, signal }).then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  };
}

export type DiscoveryResult =
  | { ok: true; metadata: OAuthMetadata; jwksUri: URL }
  | { ok: false; error: string };

function refuse(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export async function discoverIssuer(
  issuerUrl: URL,
  issuer: string,
  fetchFn?: FetchLike,
  timeoutMs: number = DISCOVERY_TIMEOUT_MS
): Promise<DiscoveryResult> {
  try {
    let found;
    try {
      const deadlined = underDeadline(fetchFn ?? fetch, AbortSignal.timeout(timeoutMs));
      found = await discoverAuthorizationServerMetadata(issuerUrl, { fetchFn: deadlined });
    } catch {
      return refuse(ERR_DISCOVERY_UNREADABLE);
    }
    if (found === undefined) return refuse(ERR_DISCOVERY_UNREADABLE);

    // Project through the OAuth schema so the type is exact for the SDK router.
    const parsed = OAuthMetadataSchema.safeParse(found);
    if (!parsed.success) return refuse(ERR_DISCOVERY_UNREADABLE);
    const metadata = parsed.data;

    if (metadata.issuer !== issuer) return refuse(ERR_DISCOVERY_ISSUER_MISMATCH);

    const rawJwks = metadata['jwks_uri'];
    if (rawJwks === undefined || rawJwks === null) return refuse(ERR_DISCOVERY_NO_JWKS_URI);
    if (typeof rawJwks !== 'string') return refuse(ERR_DISCOVERY_JWKS_URI_HTTPS);

    let jwksUri: URL;
    try {
      jwksUri = new URL(rawJwks);
    } catch {
      return refuse(ERR_DISCOVERY_JWKS_URI_HTTPS);
    }
    const secure =
      jwksUri.protocol === 'https:' ||
      (jwksUri.protocol === 'http:' && JWKS_LOOPBACK.has(jwksUri.hostname));
    if (!secure) return refuse(ERR_DISCOVERY_JWKS_URI_HTTPS);

    return { ok: true, metadata, jwksUri };
  } catch {
    return refuse(ERR_DISCOVERY_UNREADABLE);
  }
}
