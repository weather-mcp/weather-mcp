/**
 * `BlitzortungService.disconnect()` succeeds only when `mqtt`'s `end()` callback reports no error
 * (diff-review DR-B1). `mqtt` types that callback `(error?: Error) => void`; ignoring the argument
 * turned a failed close into a resolved promise, a false "Disconnected" line, and a shutdown that
 * reported `failed: false` and exit 0.
 *
 * The service is re-imported from a clean registry under fake timers so the constructor's two
 * housekeeping intervals land on an abandoned clock (G21 rule 3). The broker client is private;
 * a fake one is assigned directly, since `disconnect()` checks `this.client` only and never
 * touches the lazy `mqtt` import.
 *
 * Logs are read off `console.error`, the sink every logger level writes to (G34).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createShutdown } from '../../src/server/shutdown.js';

// Synthetic credential marker: the failure's message must not reach any log line.
const marker = 'pw-disc-hyg';

interface FakeClient {
  end: ReturnType<typeof vi.fn>;
}

function createFakeClient(error?: Error): FakeClient {
  return {
    end: vi.fn((_force: boolean, _opts: object, cb: (error?: Error) => void) => {
      cb(error);
    })
  };
}

function closeFailure(): NodeJS.ErrnoException {
  const failure: NodeJS.ErrnoException = new Error(
    `store close failed for mqtt://u5er-disc:${marker}@broker.example:1883`
  );
  failure.code = 'ESTORECLOSE';
  return failure;
}

async function importFreshService(client: FakeClient | null) {
  // The logger reads LOG_LEVEL when the fresh registry rebuilds it; pin INFO so the lines exist.
  vi.stubEnv('LOG_LEVEL', '1');
  vi.useFakeTimers();
  vi.resetModules();
  try {
    const module = await import('../../src/services/blitzortung.js');
    const service = module.blitzortungService;
    (service as unknown as { client: FakeClient | null }).client = client;
    return service;
  } finally {
    vi.useRealTimers();
  }
}

function emittedLines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((call: unknown[]) => call.map(String).join(' '));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('BlitzortungService.disconnect()', () => {
  it('rejects with the callback error, logs no success line, and drops the client', async () => {
    const failure = closeFailure();
    const client = createFakeClient(failure);
    const service = await importFreshService(client);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service.disconnect()).rejects.toBe(failure);

    expect(client.end).toHaveBeenCalledTimes(1);
    const lines = emittedLines(consoleSpy);
    expect(lines.some((line) => line.includes('Disconnecting from Blitzortung MQTT broker'))).toBe(true);
    expect(lines.some((line) => line.includes('Disconnected from Blitzortung MQTT broker'))).toBe(false);
    expect(lines.join('\n')).not.toContain(marker);
    expect((service as unknown as { client: FakeClient | null }).client).toBeNull();
  });

  it('resolves and logs the success line when the callback reports no error', async () => {
    const client = createFakeClient();
    const service = await importFreshService(client);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service.disconnect()).resolves.toBeUndefined();

    const lines = emittedLines(consoleSpy);
    expect(lines.some((line) => line.includes('Disconnected from Blitzortung MQTT broker'))).toBe(true);
    expect((service as unknown as { client: FakeClient | null }).client).toBeNull();
  });

  it('is a no-op with no client', async () => {
    const service = await importFreshService(null);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service.disconnect()).resolves.toBeUndefined();

    expect(emittedLines(consoleSpy)).toEqual([]);
  });

  it('a failed close makes the shutdown exit 1, runs the later step, and logs name and code only', async () => {
    const failure = closeFailure();
    const service = await importFreshService(createFakeClient(failure));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order: string[] = [];
    const exit = vi.fn();

    const trigger = createShutdown({
      steps: [
        { name: 'mqtt', run: () => service.disconnect() },
        { name: 'server', run: () => { order.push('server'); } }
      ],
      deadlineMs: 1000,
      exit,
      scheduler: { setTimeout: vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>), clearTimeout: vi.fn() }
    });

    await trigger('test');

    expect(order).toEqual(['server']);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    const lines = emittedLines(consoleSpy);
    const failed = lines.filter((line) => line.includes('Shutdown step failed'));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain('"step":"mqtt"');
    expect(failed[0]).toContain('"code":"ESTORECLOSE"');
    expect(lines.join('\n')).not.toContain(marker);
  });
});
