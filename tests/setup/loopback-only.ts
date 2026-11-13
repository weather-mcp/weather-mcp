/**
 * Integration tests are offline except for loopback — this file makes that
 * rule executable.
 *
 * Loaded by the `integration` project in vitest.config.ts. A connection to a
 * loopback destination proceeds; every other outbound connection fails with
 * code `ENONLOOPBACK`. Live-network tests belong in tests/live/, which runs
 * under no guard and only through `npm run test:live`.
 *
 * Same seam as tests/setup/no-network.ts: a patch on
 * `net.Socket.prototype.connect`, below axios, `fetch`, `mqtt` and `tls`, and
 * before DNS. A refused socket is destroyed with an `'error'` on the next tick,
 * so code under test takes its real connection-failure path. The one
 * difference from no-network.ts is the loopback exemption: integration files
 * open local servers.
 *
 * Allowed: a host in 127.0.0.0/8, `::1`, `localhost`; a Unix socket or pipe
 * `path` with no host; and a port with no host, which Node sends to
 * `localhost`. The guard does no DNS: any other hostname is refused, even one
 * that would resolve to loopback. It does not read proxy variables. If it
 * cannot find a destination in the arguments, it refuses (fail closed).
 *
 * Limit: the patch is in-process. A child the test spawns is not guarded.
 */

import net from 'node:net';

const originalConnect = net.Socket.prototype.connect;

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  if (net.isIPv4(h)) return h.split('.')[0] === '127';
  return false;
}

/** true when the destination is loopback; false when it is not or cannot be read. */
function isLoopbackDestination(args: unknown[]): boolean {
  // Node's internal callers pass one normalized array: [options, cb].
  const first: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];

  // connect(port[, host][, cb]). Node reads a numeric string as a port, so test it before the path arm.
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    const host = args[1];
    if (host === undefined || typeof host === 'function') return true; // Node's default host
    return typeof host === 'string' && isLoopbackHost(host);
  }
  if (typeof first === 'string') {
    // connect(path) — a Unix socket or pipe, never a network host.
    return first !== '';
  }
  if (first !== null && typeof first === 'object') {
    const opts = first as { host?: unknown; path?: unknown; port?: unknown };
    if (opts.host === undefined || opts.host === null || opts.host === '') {
      if (typeof opts.path === 'string' && opts.path !== '') return true;
      // No host: Node connects to localhost — but only if a port names a TCP destination.
      return opts.port !== undefined && opts.port !== null;
    }
    return typeof opts.host === 'string' && isLoopbackHost(opts.host);
  }
  return false;
}

const guarded = function (this: net.Socket, ...args: unknown[]): net.Socket {
  if (isLoopbackDestination(args)) {
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  }
  const err = Object.assign(
    new Error(
      'integration tests may only connect to loopback (tests/setup/loopback-only.ts) — live tests belong in tests/live/'
    ),
    { code: 'ENONLOOPBACK' }
  );
  process.nextTick(() => this.destroy(err));
  return this;
};

net.Socket.prototype.connect = guarded as unknown as typeof net.Socket.prototype.connect;
