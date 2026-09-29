/**
 * Unit tests are offline — this file makes that rule executable.
 *
 * Loaded by the `unit` project in vitest.config.ts (never by `integration`).
 * Every outbound connection a unit test attempts fails with code `EUNITNET`.
 *
 * The patch sits on `net.Socket.prototype.connect`, below every transport the
 * codebase uses — axios over `http`/`https`, `mqtt` over `net`/`tls`, and
 * Node's `fetch` — and it fires before DNS, so an online machine and an
 * offline one behave the same. The socket is destroyed with an `'error'` on
 * the next tick rather than a synchronous throw, so code under test takes the
 * same path it takes for a real connection failure.
 *
 * There is no loopback exemption: no unit test opens a local server. A test
 * that must reach a real socket belongs in tests/integration/.
 */

import net from 'node:net';

const refuse = function (this: net.Socket): net.Socket {
  const err = Object.assign(
    new Error('unit tests must not open network connections (tests/setup/no-network.ts)'),
    { code: 'EUNITNET' }
  );
  process.nextTick(() => this.destroy(err));
  return this;
};

net.Socket.prototype.connect = refuse as unknown as typeof net.Socket.prototype.connect;
