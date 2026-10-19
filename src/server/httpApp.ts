/**
 * The HTTP entry's express app: an OAuth 2.1 resource server in front of a
 * stateless Streamable HTTP transport.
 *
 * `createHttpApp()` builds the app and returns it. It is side-effect-free: it
 * binds no port, registers no signal handler, starts no timer and reads no
 * environment. `src/http.ts` starts everything, so a test can build the app and
 * bind it to loopback itself (G61).
 *
 * The stages run in this order, and a new middleware goes into this order:
 *
 *   1. GET /healthz          constant body, no upstream probe, ahead of host
 *                            validation so a proxy or container probe that sends
 *                            Host: 127.0.0.1 still gets an answer
 *   2. host validation       the SDK's DNS-rebinding guard: Host must name the
 *                            public URL's host, on every other route
 *   3. metadata router       RFC 9728 protected-resource document (and the
 *                            issuer's RFC 8414 mirror), unauthenticated
 *   4. on the MCP route, every method:
 *      access log            method, status, duration; nothing else
 *      missing-token check   classifies `missing` for the log; the SDK answers
 *      requireBearerAuth     401 with WWW-Authenticate naming the metadata URL,
 *                            403 for a missing required scope
 *   5. POST only: a 256 KB JSON body limit, then a fresh Server and transport
 *      per request (stateless transports are single-use)
 *   6. any other method: 405, after auth, so the route never answers without a token
 *   7. a final error handler, so express never reaches its default handler,
 *      which writes err.stack to stderr through console.error
 *
 * No log line on this path carries the Authorization header, a token, a claim,
 * the subject, a request body, a header or the route path (the path may be an
 * operator's secret-by-obscurity).
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { HttpConfig } from '../config/http.js';
import type { LocationStore } from '../services/locationStore.js';
import { describeErrorForLogging, logger } from '../utils/logger.js';
import { createWeatherServer, type WeatherServerOptions } from './weatherServer.js';
import { logTokenRejection } from './tokenVerifier.js';

/** A tools/call is a few hundred bytes; the SDK's own 4 MiB default is far above any real request. */
export const HTTP_BODY_LIMIT = '256kb';

export interface HttpAppDeps {
  config: HttpConfig;
  verifier: OAuthTokenVerifier;
  /** The issuer's metadata, as `discoverIssuer` returned it. */
  oauthMetadata: OAuthMetadata;
  locationStore: LocationStore;
  /** Defaults to `createWeatherServer`. Injectable so a test can count the Servers built. */
  createServer?: (options: WeatherServerOptions) => Server;
}

function jsonRpcError(code: number, message: string): object {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

/** The SDK middleware's own test (bearerAuth.js): a "Bearer" type and a non-empty token. */
function hasBearerToken(header: string | undefined): boolean {
  if (!header) return false;
  const [type, token] = header.split(' ');
  return type.toLowerCase() === 'bearer' && Boolean(token);
}

/** A client-side body-parser failure carries a string `type` and a 4xx `status`. */
function clientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { type, status } = err as { type?: unknown; status?: unknown };
  if (typeof type !== 'string') return undefined;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

export function createHttpApp(deps: HttpAppDeps): express.Express {
  const { config, verifier, oauthMetadata, locationStore } = deps;
  const createServer = deps.createServer ?? createWeatherServer;
  const route = config.publicUrl.pathname;
  const { requiredScopes } = config;

  const app = express();
  app.disable('x-powered-by');
  // The route is the public URL's exact path: /MCP and /mcp/ are not /mcp.
  app.set('case sensitive routing', true);
  app.set('strict routing', true);

  // 1. Liveness. Answers before host validation; the body is a constant, so a
  //    rebinding read learns nothing.
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // 2. Host validation. URL.hostname keeps IPv6 bracketed, the form the SDK expects (G109).
  app.use(hostHeaderValidation([config.publicUrl.hostname]));

  // 3. Discovery documents, unauthenticated.
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: config.publicUrl,
      scopesSupported: requiredScopes.length > 0 ? requiredScopes : undefined
    })
  );

  // 4. Every method on the MCP route: access log, then auth.
  app.all(
    route,
    (req: Request, res: Response, next: NextFunction) => {
      const started = performance.now();
      // 'close' fires for a completed response and for a client that hung up
      // first, so every request gets exactly one line.
      res.once('close', () => {
        const finished = res.writableFinished;
        logger.info('HTTP request', {
          method: req.method,
          status: finished ? res.statusCode : 'aborted',
          durationMs: Math.round(performance.now() - started)
        });
        // The verifier never sees a scope failure: the SDK decides it after verification.
        const challenge = res.getHeader('WWW-Authenticate');
        if (finished && res.statusCode === 403 && typeof challenge === 'string' && challenge.includes('insufficient_scope')) {
          logTokenRejection('scope');
        }
      });
      next();
    },
    (req: Request, _res: Response, next: NextFunction) => {
      // The SDK writes the 401 itself; this only names the reason once, for the log.
      if (!hasBearerToken(req.headers.authorization)) logTokenRejection('missing');
      next();
    },
    requireBearerAuth({
      verifier,
      requiredScopes,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.publicUrl),
      expectedResource: config.publicUrl
    })
  );

  // 5. One Server and one transport per request, closed when the response closes.
  app.post(route, express.json({ limit: HTTP_BODY_LIMIT }), async (req: Request, res: Response) => {
    const server = createServer({ locationStore });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    // Registered before the first await, so a client that hangs up mid-request
    // still releases both (G20).
    res.on('close', () => {
      void Promise.allSettled([transport.close(), server.close()]);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('HTTP request failed', undefined, { error: describeErrorForLogging(error) });
      if (!res.headersSent) res.status(500).json(jsonRpcError(-32603, 'Internal server error'));
      else res.end();
    }
  });

  // 6. Every other method, after auth.
  app.all(route, (_req: Request, res: Response) => {
    res.set('Allow', 'POST').status(405).json(jsonRpcError(-32000, 'Method not allowed'));
  });

  // 7. The last middleware. Express recognises an error handler by its four
  //    parameters. It never calls next(err), so express's default handler, which
  //    prints err.stack, is never reached.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next;
    const status = clientErrorStatus(err) ?? 500;
    // Class and code only, even under LOG_PII: a body-parser message quotes the request body.
    const { name, code } = describeErrorForLogging(err);
    logger.warn('HTTP request rejected', { status, error: { name, code } });
    if (res.headersSent) {
      res.end();
      return;
    }
    if (status === 413) {
      res.status(413).json(jsonRpcError(-32600, 'Request body too large'));
    } else if (status === 400) {
      res.status(400).json(jsonRpcError(-32700, 'Parse error'));
    } else if (status < 500) {
      res.status(status).json(jsonRpcError(-32600, 'Invalid request'));
    } else {
      res.status(500).json(jsonRpcError(-32603, 'Internal server error'));
    }
  });

  return app;
}
