/**
 * The native-transport connect timeout bounds the connect phase only (plan-native-transport-connect-timeout).
 *
 * `withRequestDeadline` injects a shared keep-alive agent with `timeout: CONNECT_TIMEOUT_MS` (5 s)
 * into a `maxRedirects: 0` request. Node's ClientRequest replaces the agent's socket timeout with
 * axios's `req.setTimeout` once the socket connects, so a connected server that never answers must
 * run to the request's own timeout, not be cut at 5 s. A real axios and a loopback server.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { withRequestDeadline } from '../../src/utils/httpDeadline.js';

const PROXY_VARS = [
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
  'HTTP_PROXY',
  'http_proxy'
] as const;

const REQUEST_TIMEOUT_MS = 6_500;

let server: http.Server;
let origin: string;
const hangRequests: string[] = [];
const heldResponses: http.ServerResponse[] = [];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const name of PROXY_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  server = http.createServer((req, res) => {
    if (req.url === '/hang') {
      hangRequests.push(req.url);
      heldResponses.push(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const name of PROXY_VARS) {
    const value = savedEnv[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client() {
  return axios.create({ adapter: withRequestDeadline(), maxRedirects: 0, timeout: REQUEST_TIMEOUT_MS });
}

describe('native transport agent timeout', () => {
  it('a connected request that gets no response headers runs to its own timeout, not 5 s', async () => {
    const started = performance.now();
    const error = await client()
      .get(`${origin}/hang`)
      .then(
        () => undefined,
        (err: unknown) => err
      );
    const elapsed = performance.now() - started;

    expect(axios.isAxiosError(error)).toBe(true);
    expect((error as { code?: string }).code).toBe('ECONNABORTED');
    expect(elapsed).toBeGreaterThanOrEqual(6_400);
    expect(elapsed).toBeLessThan(8_000);
    expect(hangRequests).toHaveLength(1);
  }, 15_000);

  it('a request the server answers resolves through the same instance', async () => {
    const response = await client().get<{ ok: boolean }>(`${origin}/ok`);
    expect(response.data).toEqual({ ok: true });
  }, 15_000);
});
