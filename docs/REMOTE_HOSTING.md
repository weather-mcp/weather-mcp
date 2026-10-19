# Remote Hosting (Streamable HTTP)

The package ships two commands. `weather-mcp` is the usual stdio server: your MCP client starts it
as a local process. `weather-mcp-http` serves the same tools over
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http),
so a client on another machine can reach it: a claude.ai custom connector, Claude Code on a laptop,
or an agent on another host.

`weather-mcp-http` is for **self-hosters**: you run it for yourself or your household, behind your
own reverse proxy and your own OAuth authorization server. There is no public hosted instance.

The stdio server is not changed by any of this. It does not load the HTTP code.

## How access works

`weather-mcp-http` is an OAuth 2.1 **resource server**. It never issues, refreshes or revokes a
token, and it keeps no client list. An authorization server you already run (Keycloak, Authentik,
Auth0, Okta, Entra ID and so on) does all of that.

On each request to the MCP endpoint the server checks the bearer access token that the client
sends in the `Authorization` header. It accepts the token only when every check below passes.

- The token is a JWT signed with an asymmetric algorithm: `RS256`, `RS384`, `RS512`, `PS256`,
  `PS384`, `PS512`, `ES256`, `ES384`, `ES512` or `EdDSA`. Symmetric `HS*` tokens are refused.
- The signature verifies against a key in the authorization server's JWKS.
- `iss` equals `WEATHER_OAUTH_ISSUER`.
- `aud` equals `WEATHER_HTTP_PUBLIC_URL`, **exactly** as you configured it (RFC 8707 audience
  binding). On a shared authorization server this is what stops a token issued for another app
  from working here.
- `exp` is present and in the future.
- If `WEATHER_OAUTH_REQUIRED_SCOPES` is set, the token carries every scope in it (from a
  space-separated `scope` claim, or an `scp` array).

There is no anonymous mode and no static-token mode. The server refuses to start without an
authorization-server configuration, whatever address it binds.

A token stays valid until its `exp`; the server cannot see a revocation. **Keep access-token
lifetimes short** (minutes). A revoked session then stops working at the client's next refresh.

## Authorization-server requirements

Your authorization server must:

1. Publish metadata at the issuer, as [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)
   (`/.well-known/oauth-authorization-server`) or OpenID Connect Discovery
   (`/.well-known/openid-configuration`). The document's `issuer` must be **identical** to
   `WEATHER_OAUTH_ISSUER`, character for character. A trailing slash counts.
2. Publish a `jwks_uri` in that document. It must be `https`, or `http` on a loopback host.
3. Issue **JWT** access tokens. Opaque tokens that need introspection are not supported.
4. Put `WEATHER_HTTP_PUBLIC_URL` in the token's `aud`. Many servers do this through the RFC 8707
   `resource` parameter that MCP clients send. Others need an audience mapper or a dedicated API
   or resource definition with that URL as its identifier. Check what yours needs.
5. Let your MCP client register. Some clients use dynamic client registration; others need a
   client you create by hand. See your client's documentation.

## Configuration

These five variables apply to `weather-mcp-http` only. Every other variable (`ENABLED_TOOLS`,
`WEATHER_UNITS`, `WEATHER_DEFAULT_LOCATION`, `LOG_LEVEL`, `LOG_PII`, cache settings, the optional
API keys) works the same way as for the stdio server, and applies to every caller.

| Variable | Default | Purpose |
|---|---|---|
| `WEATHER_HTTP_HOST` | `127.0.0.1` | Address to bind. Keep the default behind a reverse proxy. `0.0.0.0` is allowed, because every request needs a valid token |
| `WEATHER_HTTP_PORT` | `3939` | Port to bind, 1–65535 |
| `WEATHER_HTTP_PUBLIC_URL` | **required** | The URL clients connect to, for example `https://weather.example.net/mcp`. It is the MCP endpoint, the token audience, and the host that requests must name |
| `WEATHER_OAUTH_ISSUER` | **required** | Your authorization server's issuer URL |
| `WEATHER_OAUTH_REQUIRED_SCOPES` | none | Comma-separated scopes every token must carry |

Rules for the two URLs:

- `https`, except on a loopback host for local testing. The public URL may be `http` on
  `localhost`, `127.0.0.1` or `[::1]`. The issuer may be `http` on `localhost` or `127.0.0.1` only
  (the MCP SDK refuses an `http` issuer on any other host).
- No query string, no fragment, no username or password.
- The public URL's path may contain only letters, digits, and `. _ ~ - /`. The server answers on
  that exact path, so `https://weather.example.net/mcp` serves `/mcp`. Pick any path you like.
  The match is case-sensitive, and a trailing slash is significant: `/mcp/` and `/MCP` are not
  `/mcp`.
- The public URL must be written in canonical form, because it is compared to the token's `aud`
  character for character: a lowercase host, no default port (`:443` for https, `:80` for http),
  and at least `/` as the path. Write `https://weather.example.net/`, not
  `https://weather.example.net`.

Node.js **20 or newer** is required, for `weather-mcp-http` and for the stdio server alike.

## Running it

```bash
npm install -g @dangahagan/weather-mcp

WEATHER_HTTP_PUBLIC_URL=https://weather.example.net/mcp \
WEATHER_OAUTH_ISSUER=https://auth.example.net/realms/home \
weather-mcp-http
```

From a source checkout, `npm run build && npm run start:http` does the same.

At startup the server reads the issuer's metadata **before** it binds the port. When it is ready it
logs one line, `Weather MCP HTTP server listening`, with the host, port and issuer origin.

It stops on `SIGTERM` or `SIGINT`. It does not watch stdin, so it is safe to run in a container
started without `-i`. On shutdown it stops accepting connections, gives in-flight requests 400 ms,
then closes the rest. The whole shutdown is bounded at 1.5 seconds.

## Behind a reverse proxy

Terminate TLS at the proxy and forward to `127.0.0.1:3939`. Three things matter:

- **Pass the path through unchanged.** If the public URL is `https://weather.example.net/mcp`, the
  server must receive `/mcp`.
- **Preserve the `Host` header** (or set it to the public URL's host). Requests whose `Host` does not
  name the public URL's host are refused with `403` before the token is checked. This blocks
  DNS-rebinding attacks from a browser on your network.
- **Forward `/.well-known/oauth-protected-resource/...`** to the server too. MCP clients read it
  to find your authorization server.

Example (Caddy):

```
weather.example.net {
    reverse_proxy 127.0.0.1:3939
}
```

Caddy preserves the path and the `Host` header by default. With nginx, use `proxy_pass` without a
trailing URI part and `proxy_set_header Host $host;`.

## Endpoints

| Path | Auth | Answer |
|---|---|---|
| `GET /healthz` | none | `200 {"status":"ok"}`. Any `Host` is accepted. Probes no upstream service (use the `check_service_status` tool for that). For proxy and container liveness checks |
| `GET /.well-known/oauth-protected-resource<path>` | none | The [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) protected-resource document: the public URL as `resource` and your issuer under `authorization_servers` |
| `GET /.well-known/oauth-authorization-server` | none | A copy of the issuer's metadata, as read at startup |
| `POST <path>` | token | The MCP endpoint |
| any other method on `<path>` | token | `405`, `Allow: POST` |

The two metadata documents are served with permissive CORS (the MCP SDK's default, for
browser-based clients). The MCP endpoint itself sends no CORS headers.

The server is **stateless**: each POST is handled on its own, and no session ID is issued. Server
push (the `GET` event stream) is not offered. No tool sends server-initiated messages.

### Status codes on the MCP endpoint

| Status | When |
|---|---|
| `401` | No token, an `Authorization` header that does not start `Bearer <token>`, or a token that fails any check above. The `WWW-Authenticate` header carries `resource_metadata="…"`, which MCP clients follow to log in |
| `403` | The token lacks a scope in `WEATHER_OAUTH_REQUIRED_SCOPES` (the header carries `scope="…"`). Also any request whose `Host` is not the public URL's host |
| `500` | The authorization server's JWKS could not be read (it timed out, refused the connection, or answered with an error). This is deliberately not a `401`, so clients do not loop through logins during an outage |
| `413` | The request body is larger than 256 KB |
| `400` | The request body is not valid JSON |
| `405` | A method other than `POST`, after the token check |

The JWKS is fetched on the **first request**, not at startup, and is then cached (`jose` defaults:
a 5-second fetch timeout, at most one refetch per 30 seconds). So a JWKS that is unreachable at boot
gives a running server that answers `500`, not a refusal to start.

## Saved locations are shared

Every authenticated caller uses the same saved-location store, `~/.weather-mcp/locations.json` of
the account that runs the server. A location one caller saves, another can read and remove. Only
give access to people who should share that list.

## What is logged

All logs go to stderr as JSON lines. The HTTP server adds:

- One line per request: method, status and duration. The status is `aborted` when the client
  hung up before the response was sent. **No** path, header, query, body or IP address.
- One `Access token rejected` security warning per refused request, with a fixed reason:
  `missing`, `invalid`, `expired`, `audience`, `scope` or `jwks_unavailable`.
- The startup line: version, host, port, the issuer's origin (scheme, host, port) and the number of
  enabled tools. **Not** the public URL's path, which you may want to keep private.

**No log line carries the `Authorization` header, a token, any token claim, or the token's
subject**, at any `LOG_LEVEL`, including with `LOG_PII=true`. A rejected request is never logged
with the verification library's error text, which can quote claim values.

## Startup refusals

The server logs one `HTTP entry refused to start` error with one of these reasons, and exits with
code 1. Nothing is bound when this happens.

| Reason | Fix |
|---|---|
| `The HTTP entry needs Node.js 20 or newer (WebCrypto is unavailable)` | Upgrade Node.js |
| `WEATHER_HTTP_PUBLIC_URL is required` | Set it |
| `WEATHER_OAUTH_ISSUER is required` | Set it |
| `WEATHER_HTTP_PORT must be an integer from 1 to 65535` | Digits only |
| `WEATHER_HTTP_PUBLIC_URL is not a valid URL` | |
| `WEATHER_OAUTH_ISSUER is not a valid URL` | |
| `WEATHER_HTTP_PUBLIC_URL must be an https URL (http is allowed only for localhost, 127.0.0.1 and [::1])` | |
| `WEATHER_OAUTH_ISSUER must be an https URL (http is allowed only for localhost and 127.0.0.1)` | |
| `WEATHER_HTTP_PUBLIC_URL must not carry a query or fragment` | Remove `?…` and `#…` |
| `WEATHER_OAUTH_ISSUER must not carry a query or fragment` | Remove `?…` and `#…` |
| `WEATHER_HTTP_PUBLIC_URL must not carry a username or password` | |
| `WEATHER_OAUTH_ISSUER must not carry a username or password` | |
| `WEATHER_HTTP_PUBLIC_URL path may contain only letters, digits, and . _ ~ - /` | Choose a simpler path |
| `WEATHER_HTTP_PUBLIC_URL must be in canonical form (lowercase host, no default port, a path of at least "/")` | Lowercase the host, drop `:443` or `:80`, and end a bare host with `/`. Configure the same string as the token audience |
| `could not read the authorization server's metadata from WEATHER_OAUTH_ISSUER` | The issuer is unreachable, did not answer within 10 seconds, answered an error, or published a document that does not parse. Check the URL and that the server can reach it |
| `the authorization server's metadata names a different issuer than WEATHER_OAUTH_ISSUER` | Copy the `issuer` value from the metadata document exactly, including any trailing slash |
| `the authorization server publishes no jwks_uri; JWT access tokens cannot be verified` | The authorization server must publish signing keys |
| `the authorization server's jwks_uri must be an https URL` | |
| `could not listen on WEATHER_HTTP_HOST:WEATHER_HTTP_PORT` | The port is in use, or the address is not on this machine |

No message repeats the value you configured.

## Connecting a client

See [CLIENT_SETUP.md — Remote server](./CLIENT_SETUP.md#remote-server-streamable-http).

## Security notes

See [SECURITY.md](../SECURITY.md#remote-hosting-weather-mcp-http) for the threat model and how
dependency advisories are triaged for HTTP deployments.
