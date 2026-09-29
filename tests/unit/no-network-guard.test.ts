/**
 * Lock for tests/setup/no-network.ts. Both tests go red if the setup file is
 * removed from the `unit` project in vitest.config.ts — that is what proves
 * the guard is wired, not merely present.
 *
 * 192.0.2.1 is TEST-NET-1 (RFC 5737): a literal address, so no DNS lookup,
 * and never routed, so a missing guard cannot reach anything real.
 */

import { describe, it, expect } from 'vitest';
import net from 'node:net';
import axios from 'axios';

describe('no-network guard (unit project)', () => {
  it('refuses a raw socket connect with EUNITNET', async () => {
    const socket = net.connect({ host: '192.0.2.1', port: 443 });
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      socket.once('error', resolve);
    });
    expect(err.code).toBe('EUNITNET');
  });

  it('refuses an axios request through the same guard', async () => {
    const client = axios.create({ baseURL: 'https://192.0.2.1', timeout: 2000 });
    await expect(client.get('/')).rejects.toThrow('unit tests must not open network connections');
  });
});
