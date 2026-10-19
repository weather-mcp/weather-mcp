/**
 * HTTP entry configuration.
 *
 * The one read site of the five variables the HTTP entry (`src/http.ts`,
 * `weather-mcp-http`) takes:
 *
 *   WEATHER_HTTP_HOST             bind address (default 127.0.0.1)
 *   WEATHER_HTTP_PORT             bind port, 1-65535 (default 3939)
 *   WEATHER_HTTP_PUBLIC_URL       required; the externally visible MCP endpoint URL
 *   WEATHER_OAUTH_ISSUER          required; the OAuth authorization server issuer
 *   WEATHER_OAUTH_REQUIRED_SCOPES comma-separated scopes (default none)
 *
 * The module is pure. It takes `env` as a parameter, reads each key by name,
 * and makes no console or logger call. It returns a result instead of warning
 * and falling back, because this server fails closed: a missing or malformed
 * value must stop startup, never degrade to a default that exposes the server
 * differently from what the operator meant. The caller decides how to report
 * the error.
 *
 * Every error message is fixed text that names the variable and never echoes
 * its value: a URL may carry a path the operator treats as secret.
 */

export interface HttpConfig {
  host: string;
  port: number;
  publicUrl: URL;
  /** The configured issuer string, trimmed. */
  issuer: string;
  issuerUrl: URL;
  requiredScopes: string[];
}

export type HttpConfigResult =
  | { ok: true; config: HttpConfig }
  | { ok: false; error: string };

export const DEFAULT_HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PORT = 3939;

export const ERR_PORT = 'WEATHER_HTTP_PORT must be an integer from 1 to 65535';
export const ERR_PUBLIC_URL_REQUIRED = 'WEATHER_HTTP_PUBLIC_URL is required';
export const ERR_ISSUER_REQUIRED = 'WEATHER_OAUTH_ISSUER is required';
export const ERR_PUBLIC_URL_INVALID = 'WEATHER_HTTP_PUBLIC_URL is not a valid URL';
export const ERR_ISSUER_INVALID = 'WEATHER_OAUTH_ISSUER is not a valid URL';
export const ERR_PUBLIC_URL_HTTPS =
  'WEATHER_HTTP_PUBLIC_URL must be an https URL (http is allowed only for localhost, 127.0.0.1 and [::1])';
export const ERR_ISSUER_HTTPS =
  'WEATHER_OAUTH_ISSUER must be an https URL (http is allowed only for localhost and 127.0.0.1)';
export const ERR_PUBLIC_URL_QUERY = 'WEATHER_HTTP_PUBLIC_URL must not carry a query or fragment';
export const ERR_ISSUER_QUERY = 'WEATHER_OAUTH_ISSUER must not carry a query or fragment';
export const ERR_PUBLIC_URL_PATH =
  'WEATHER_HTTP_PUBLIC_URL path may contain only letters, digits, and . _ ~ - /';
export const ERR_PUBLIC_URL_USERINFO = 'WEATHER_HTTP_PUBLIC_URL must not carry a username or password';
export const ERR_ISSUER_USERINFO = 'WEATHER_OAUTH_ISSUER must not carry a username or password';
export const ERR_PUBLIC_URL_CANONICAL =
  'WEATHER_HTTP_PUBLIC_URL must be in canonical form (lowercase host, no default port, a path of at least "/")';

// URL.hostname keeps IPv6 literals bracketed (GOTCHAS G109).
const PUBLIC_URL_LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
// Mirrors the SDK's checkIssuerUrl exemption list (server/auth/router.js).
const ISSUER_LOOPBACK = new Set(['localhost', '127.0.0.1']);

const PATH_PATTERN = /^[A-Za-z0-9._~/-]*$/;

function read(env: NodeJS.ProcessEnv, name: string): string {
  const raw = env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

interface UrlMessages {
  required: string;
  invalid: string;
  https: string;
  query: string;
}

function parseUrl(
  raw: string,
  loopback: Set<string>,
  msg: UrlMessages
): { ok: true; url: URL } | { ok: false; error: string } {
  if (raw === '') return { ok: false, error: msg.required };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: msg.invalid };
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback.has(url.hostname))) {
    return { ok: false, error: msg.https };
  }
  // A bare trailing "?" or "#" leaves search/hash empty, so check the raw string too.
  if (url.search !== '' || url.hash !== '' || raw.includes('?') || raw.includes('#')) {
    return { ok: false, error: msg.query };
  }
  return { ok: true, url };
}

export function parseHttpConfig(env: NodeJS.ProcessEnv): HttpConfigResult {
  const host = read(env, 'WEATHER_HTTP_HOST') || DEFAULT_HTTP_HOST;

  const rawPort = read(env, 'WEATHER_HTTP_PORT');
  let port = DEFAULT_HTTP_PORT;
  if (rawPort !== '') {
    // Digits only: Number() alone would accept "0x10" and "1e2".
    const n = /^[0-9]+$/.test(rawPort) ? Number(rawPort) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 65535) return { ok: false, error: ERR_PORT };
    port = n;
  }

  const publicRaw = read(env, 'WEATHER_HTTP_PUBLIC_URL');
  const pub = parseUrl(publicRaw, PUBLIC_URL_LOOPBACK, {
    required: ERR_PUBLIC_URL_REQUIRED,
    invalid: ERR_PUBLIC_URL_INVALID,
    https: ERR_PUBLIC_URL_HTTPS,
    query: ERR_PUBLIC_URL_QUERY,
  });
  if (!pub.ok) return pub;
  if (pub.url.username !== '' || pub.url.password !== '') {
    return { ok: false, error: ERR_PUBLIC_URL_USERINFO };
  }
  // Express 5 reads anything else as path-to-regexp syntax (e.g. "/mcp:v2").
  if (!PATH_PATTERN.test(pub.url.pathname)) return { ok: false, error: ERR_PUBLIC_URL_PATH };
  // The token audience is compared as an exact string against publicUrl.href. A
  // configured value that the URL parser rewrites (mixed-case host, explicit :443,
  // no path) would make every token fail the audience check, so refuse it here and
  // keep "exactly as configured" true. PATH_PATTERN keeps the path free of
  // percent-encoding, so href equality is a clean test.
  if (pub.url.href !== publicRaw) return { ok: false, error: ERR_PUBLIC_URL_CANONICAL };

  const issuerRaw = read(env, 'WEATHER_OAUTH_ISSUER');
  const iss = parseUrl(issuerRaw, ISSUER_LOOPBACK, {
    required: ERR_ISSUER_REQUIRED,
    invalid: ERR_ISSUER_INVALID,
    https: ERR_ISSUER_HTTPS,
    query: ERR_ISSUER_QUERY,
  });
  if (!iss.ok) return iss;
  // Discovery fetches from this URL, and the startup line logs its origin.
  if (iss.url.username !== '' || iss.url.password !== '') {
    return { ok: false, error: ERR_ISSUER_USERINFO };
  }

  const requiredScopes = read(env, 'WEATHER_OAUTH_REQUIRED_SCOPES')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    ok: true,
    config: {
      host,
      port,
      publicUrl: pub.url,
      issuer: issuerRaw,
      issuerUrl: iss.url,
      requiredScopes,
    },
  };
}
