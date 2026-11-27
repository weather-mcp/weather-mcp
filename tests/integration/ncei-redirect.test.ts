/**
 * The NCEI token never follows a redirect (plan-http-entry-hardening, §2d).
 *
 * The token rides a request header named `token`. follow-redirects strips
 * `Authorization`, `Proxy-Authorization` and `Cookie` when a redirect changes
 * host, and nothing else, so a followed redirect would hand the token to the
 * redirect's target. The client sets `maxRedirects: 0`: a 3xx is an error, and
 * the normals fall back.
 *
 * A real `NCEIService` and real axios, against two loopback servers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NCEIService, NceiTokenRejectedError } from '../../src/services/ncei.js';
import { ServiceUnavailableError } from '../../src/errors/ApiError.js';

/** Synthetic, and spelled so a leak-scan hit on this file is recognisable (G112). */
const FIXTURE_TOKEN = 'tk-ncei-hyg-7731';

interface Recorded {
  url: string;
  tokenHeader: string | undefined;
}

interface Fixture {
  base: string;
  requests: Recorded[];
  close: () => Promise<void>;
}

async function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<Fixture> {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const header = req.headers.token;
    requests.push({ url: req.url ?? '', tokenHeader: Array.isArray(header) ? header[0] : header });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}

function json(res: http.ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** A CDO that answers the three requests one normals lookup makes. */
function healthyCdo(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/stations') {
    json(res, {
      results: [{ id: 'GHCND:USW00024233', name: 'SEATTLE TACOMA AIRPORT, WA US', latitude: 47.4502, longitude: -122.3088, datacoverage: 1 }]
    });
  } else if (url.searchParams.get('datasetid') === 'NORMAL_DLY') {
    json(res, { results: [{ datatype: 'DLY-TMAX-NORMAL', value: 76 }, { datatype: 'DLY-TMIN-NORMAL', value: 55.7 }] });
  } else {
    json(res, { results: [{ datatype: 'MLY-PRCP-NORMAL', value: 0.7 }] });
  }
}

const fixtures: Fixture[] = [];

beforeEach(() => {
  fixtures.length = 0;
});

afterEach(async () => {
  for (const fixture of fixtures) await fixture.close();
});

async function fixture(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<Fixture> {
  const made = await serve(handler);
  fixtures.push(made);
  return made;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => { throw new Error('expected a rejection'); },
    (error: unknown) => error
  );
}

describe('NCEI client and redirects', () => {
  it('control: the service reaches a loopback CDO and sends its token there', async () => {
    const cdo = await fixture(healthyCdo);
    const service = new NCEIService({ baseURL: cdo.base, token: FIXTURE_TOKEN });

    const normals = await service.getClimateNormals(47.6062, -122.3321, 7, 15);

    expect(normals.source).toBe('NCEI');
    expect(cdo.requests.length).toBe(3);
    for (const request of cdo.requests) expect(request.tokenHeader).toBe(FIXTURE_TOKEN);
  });

  it('a 302 to another host is not followed: the target sees no request and no token', async () => {
    const target = await fixture(healthyCdo);
    const redirecting = await fixture((req, res) => {
      res.writeHead(302, { Location: `${target.base}${req.url ?? '/'}` });
      res.end();
    });
    const service = new NCEIService({ baseURL: redirecting.base, token: FIXTURE_TOKEN });

    const error = await rejectionOf(service.getClimateNormals(47.6062, -122.3321, 7, 15));

    expect(redirecting.requests.length).toBe(1);
    expect(target.requests).toEqual([]);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    // A redirect is an outage for this call, not a verdict on the token.
    expect(error).not.toBeInstanceOf(NceiTokenRejectedError);
    expect(String((error as Error).message)).not.toContain(FIXTURE_TOKEN);
  });

  it('a real 400 token refusal, as CDO words it, is a token rejection', async () => {
    const refusing = await fixture((_req, res) => {
      // Byte-for-byte the body CDO sent on 2026-11-27, spaces before the colons included.
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"status" : "400", "message" : "The token parameter provided is not valid."}');
    });
    const service = new NCEIService({ baseURL: refusing.base, token: FIXTURE_TOKEN });

    const first = await rejectionOf(service.getClimateNormals(47.6062, -122.3321, 7, 15));
    const second = await rejectionOf(service.getClimateNormals(47.6062, -122.3321, 7, 15));

    expect(first).toBeInstanceOf(NceiTokenRejectedError);
    expect(second).toBeInstanceOf(NceiTokenRejectedError);
    // Remembered: the second call never left the process.
    expect(refusing.requests.length).toBe(1);
  });
});
