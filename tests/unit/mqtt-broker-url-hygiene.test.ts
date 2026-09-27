/**
 * Unit tests for the MQTT broker URL's log hygiene (RF-08): a
 * `BLITZORTUNG_MQTT_URL` carrying credentials — in userinfo or in the query —
 * reaches the broker unchanged and reaches no log line.
 *
 * Drives the REAL BlitzortungService through a fresh module re-import per
 * test, with `mqtt` replaced by a fake client. The helpers are local copies of
 * the ones in tests/unit/lightning-feed-outage.test.ts (`createFakeMqttClient`
 * `:54-90`, `createPresentMqttModule` `:93-96`, `importFreshBlitzortung`
 * `:107-120`), trimmed to what this file needs; that file is a lock and is not
 * edited to export them.
 *
 * Every assertion reads the lines the logger emitted at `console.error`, never
 * a `logger` spy: an `Error` has no enumerable own properties, so a spied call
 * serialises it as `{}` and passes against code that leaks its message.
 *
 * Determinism: nothing here opens a socket. Every case `vi.doMock`s 'mqtt'.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// Tokens that cannot collide with a scheme, a host, or any word the log lines
// use on their own, so an absence assertion on them cannot pass by accident.
const USERNAME = 'u5er-hyg';
const PASSWORD = 'pw-hunter2-hyg';
const QUERY_TOKEN = 'qt0ken-hyg';
const CREDENTIAL_TOKENS = [USERNAME, PASSWORD, QUERY_TOKEN];

const BROKERS = [
  {
    url: `mqtts://${USERNAME}:${PASSWORD}@broker.example:8883`,
    display: 'mqtts://broker.example:8883',
    encrypted: true
  },
  {
    url: `wss://${USERNAME}:${PASSWORD}@broker.example/mqtt?token=${QUERY_TOKEN}`,
    display: 'wss://broker.example',
    encrypted: true
  },
  {
    url: `mqtt://${USERNAME}:${PASSWORD}@127.0.0.1:1883`,
    display: 'mqtt://127.0.0.1:1883',
    encrypted: false
  }
];

const PLAINTEXT_WARNING = 'SECURITY: Using plaintext MQTT connection (unencrypted)';
const CONNECT_LINE = 'Connecting to Blitzortung MQTT broker';

interface LogLine {
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
  error?: unknown;
}

/**
 * A fake `MqttClient`. `connect: 'immediate'` fires the 'connect' handler on a
 * microtask; 'never' leaves the handshake pending so a test can `emit('error')`
 * by hand. `subscribeErrors` is consumed one entry per `subscribe()` call; the
 * last entry repeats once exhausted.
 */
function createFakeMqttClient(
  opts: {
    connect?: 'immediate' | 'never';
    subscribeErrors?: Array<Error | null>;
  } = {}
) {
  const { connect = 'immediate', subscribeErrors = [] } = opts;
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  let subscribeCallIndex = 0;

  const client = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(cb);
      if (event === 'connect' && connect === 'immediate') {
        queueMicrotask(() => cb());
      }
      return client;
    }),
    subscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => {
      const behavior =
        subscribeCallIndex < subscribeErrors.length
          ? subscribeErrors[subscribeCallIndex]
          : subscribeErrors[subscribeErrors.length - 1] ?? null;
      subscribeCallIndex += 1;
      cb(behavior);
    }),
    unsubscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => cb(null)),
    end: vi.fn((_force: boolean, _opts: unknown, cb: () => void) => cb()),
    emit(event: string, ...args: unknown[]) {
      (handlers[event] ?? []).forEach(h => h(...args));
    }
  };
  return client;
}

/** A present `mqtt` module stub whose `connect()` returns the given fake client. */
function createPresentMqttModule(client: ReturnType<typeof createFakeMqttClient>) {
  const connect = vi.fn(() => client);
  return { esModule: { default: { connect } }, connect };
}

/**
 * Re-import blitzortung.js from a clean module registry, so the singleton's
 * field initializers read the stubbed `BLITZORTUNG_MQTT_URL` and the logger is
 * rebuilt at the stubbed `LOG_LEVEL`. Fake timers around the import only, so
 * the constructor's intervals land on a clock that is abandoned (G21 rule 3).
 */
async function importFreshBlitzortung() {
  vi.useFakeTimers();
  vi.resetModules();
  try {
    return await import('../../src/services/blitzortung.js');
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Stub the environment, mock `mqtt`, import fresh, then spy on `console.error`
 * — the sink every log level writes to. The spy is taken after the import so
 * nothing the import itself logs is mistaken for a leg's output.
 */
async function setUp(brokerUrl: string, client: ReturnType<typeof createFakeMqttClient>) {
  vi.stubEnv('BLITZORTUNG_MQTT_URL', brokerUrl);
  vi.stubEnv('LOG_LEVEL', '0');
  const mqttModule = createPresentMqttModule(client);
  vi.doMock('mqtt', () => mqttModule.esModule);
  const { blitzortungService } = await importFreshBlitzortung();
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { blitzortungService, consoleSpy, connect: mqttModule.connect };
}

function emittedLines(consoleSpy: { mock: { calls: unknown[][] } }): string[] {
  return consoleSpy.mock.calls.map(call => String(call[0]));
}

function parsedLines(consoleSpy: { mock: { calls: unknown[][] } }): LogLine[] {
  return emittedLines(consoleSpy).map(line => JSON.parse(line) as LogLine);
}

function expectNoCredential(lines: string[]): void {
  for (const line of lines) {
    for (const token of CREDENTIAL_TOKENS) {
      expect(line).not.toContain(token);
    }
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
});

describe.each(BROKERS)('MQTT broker URL log hygiene — $display', ({ url, display, encrypted }) => {
  it('contract 1: the connection-error line keeps name and code and drops the transport\'s message', async () => {
    const client = createFakeMqttClient({ connect: 'never' });
    const { blitzortungService, consoleSpy } = await setUp(url, client);

    vi.useFakeTimers();
    const promise = blitzortungService.getLightningStrikes(15, 15, 100, 60);
    await vi.advanceTimersByTimeAsync(100);
    // The fixture carries the whole credentialed URL in its message, as ws's
    // `Invalid URL: ${address}` would, so the assertion is that the handler
    // dropped it — not that the fake never had it.
    client.emit(
      'error',
      Object.assign(new Error(`connect ECONNREFUSED ${url}`), { code: 'ECONNREFUSED' })
    );
    await vi.advanceTimersByTimeAsync(9900);
    const result = await promise;
    expect(blitzortungService.getFeedFailure(result)?.reason).toBe('connection_error');

    const lines = emittedLines(consoleSpy);
    const errorLines = lines.filter(line => (JSON.parse(line) as LogLine).message === 'MQTT connection error');
    // Positive control: without the line every absence below is vacuous.
    expect(errorLines).toHaveLength(1);
    const errorLine = JSON.parse(errorLines[0]) as LogLine;
    expect(errorLine.metadata).toEqual({ name: 'Error', code: 'ECONNREFUSED' });
    expect(errorLine.error).toBeUndefined();
    expect(errorLines[0]).not.toContain(url);
    expect(errorLines[0]).not.toContain('"stack"');
    expectNoCredential(errorLines);

    const fetchLine = parsedLines(consoleSpy).find(line => line.message === 'Failed to fetch lightning data');
    expect(fetchLine?.metadata?.reason).toBe('connection_error');
  });

  it('contract 2: no emitted line on any leg carries a credential', async () => {
    // Connection-error leg.
    {
      const client = createFakeMqttClient({ connect: 'never' });
      const { blitzortungService, consoleSpy } = await setUp(url, client);
      vi.useFakeTimers();
      const promise = blitzortungService.getLightningStrikes(15, 15, 100, 60);
      await vi.advanceTimersByTimeAsync(100);
      client.emit(
        'error',
        Object.assign(new Error(`connect ECONNREFUSED ${url}`), { code: 'ECONNREFUSED' })
      );
      await vi.advanceTimersByTimeAsync(9900);
      await promise;
      const lines = emittedLines(consoleSpy);
      expect(lines.length).toBeGreaterThan(0);
      expectNoCredential(lines);
      vi.useRealTimers();
      vi.restoreAllMocks();
    }

    // Close leg: connected, then the broker drops mid-window.
    {
      const client = createFakeMqttClient();
      const { blitzortungService, consoleSpy } = await setUp(url, client);
      vi.useFakeTimers();
      const promise = blitzortungService.getLightningStrikes(15, 15, 100, 60);
      await vi.advanceTimersByTimeAsync(100);
      client.emit('close');
      await vi.advanceTimersByTimeAsync(9900);
      await promise;
      const lines = emittedLines(consoleSpy);
      expect(lines.some(line => line.includes('MQTT connection closed'))).toBe(true);
      expectNoCredential(lines);
      vi.useRealTimers();
      vi.restoreAllMocks();
    }

    // Subscribe-failure leg: mqtt's own error names the broker in its message.
    {
      const client = createFakeMqttClient({
        subscribeErrors: [new Error(`connect ECONNREFUSED ${url}`)]
      });
      const { blitzortungService, consoleSpy } = await setUp(url, client);
      vi.useFakeTimers();
      const promise = blitzortungService.getLightningStrikes(15, 15, 100, 60);
      await vi.advanceTimersByTimeAsync(10000);
      await promise;
      const lines = emittedLines(consoleSpy);
      expect(lines.some(line => line.includes('Failed to subscribe to topics'))).toBe(true);
      expectNoCredential(lines);
      vi.useRealTimers();
      vi.restoreAllMocks();
    }

    // Disconnect leg: a successful query, then a graceful shutdown.
    {
      const client = createFakeMqttClient();
      const { blitzortungService, consoleSpy } = await setUp(url, client);
      vi.useFakeTimers();
      const promise = blitzortungService.getLightningStrikes(15, 15, 100, 60);
      await vi.advanceTimersByTimeAsync(10000);
      await promise;
      await blitzortungService.disconnect();
      const lines = emittedLines(consoleSpy);
      expect(lines.some(line => line.includes('Disconnected from Blitzortung MQTT broker'))).toBe(true);
      expectNoCredential(lines);
    }
  });

  it('contract 3: the connect line — and the plaintext warning where it fires — still name the endpoint', async () => {
    const client = createFakeMqttClient();
    const { blitzortungService, consoleSpy } = await setUp(url, client);

    vi.useFakeTimers();
    const promise = blitzortungService.getLightningStrikes(15, 15, 100, 60);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    const lines = parsedLines(consoleSpy);
    const connectLines = lines.filter(line => line.message === CONNECT_LINE);
    expect(connectLines).toHaveLength(1);
    expect(connectLines[0].metadata?.broker).toBe(display);
    expect(connectLines[0].metadata?.encrypted).toBe(encrypted);

    const warnings = lines.filter(line => line.message === PLAINTEXT_WARNING);
    if (encrypted) {
      expect(warnings).toHaveLength(0);
    } else {
      expect(warnings).toHaveLength(1);
      expect(warnings[0].metadata).toEqual({
        broker: display,
        securityEvent: true,
        recommendation: 'Use BLITZORTUNG_MQTT_URL environment variable to configure TLS broker (mqtts:// or wss://)'
      });
    }
  });

  it('contract 4: the broker still receives the raw URL, credentials included', async () => {
    const client = createFakeMqttClient();
    const { blitzortungService, connect } = await setUp(url, client);

    vi.useFakeTimers();
    const promise = blitzortungService.getLightningStrikes(15, 15, 100, 60);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    expect(connect).toHaveBeenCalledTimes(1);
    expect((connect.mock.calls[0] as unknown[])[0]).toBe(url);
  });
});

describe('MQTT broker URL log hygiene — default broker', () => {
  it('contract 5: with BLITZORTUNG_MQTT_URL empty, the connect line names the default broker unchanged', async () => {
    const client = createFakeMqttClient();
    const { blitzortungService, consoleSpy } = await setUp('', client);

    vi.useFakeTimers();
    const promise = blitzortungService.getLightningStrikes(15, 15, 100, 60);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    const connectLine = parsedLines(consoleSpy).find(line => line.message === CONNECT_LINE);
    expect(connectLine?.metadata?.broker).toBe('mqtt://blitzortung.ha.sed.pl:1883');
  });
});
