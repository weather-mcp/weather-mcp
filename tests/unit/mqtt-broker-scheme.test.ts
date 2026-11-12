/**
 * Unit tests for the broker scheme check: ssl://, tls://, wxs:// and alis://
 * are encrypted links to `mqtt`, so they must not draw the plaintext warning.
 *
 * The helpers are local copies of the ones in mqtt-broker-url-hygiene.test.ts
 * (a lock, never edited or imported). Every case `vi.doMock`s 'mqtt'; nothing
 * here opens a socket. Assertions read the lines the logger wrote to
 * `console.error`, never a `logger` spy.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

const USERINFO_MARKER = 'pw-hunter2-hyg';
const USER_MARKER = 'u5er-hyg';

const PLAINTEXT_WARNING = 'SECURITY: Using plaintext MQTT connection (unencrypted)';
const CONNECT_LINE = 'Connecting to Blitzortung MQTT broker';

interface LogLine {
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
}

function createFakeMqttClient() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const client = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(cb);
      if (event === 'connect') {
        queueMicrotask(() => cb());
      }
      return client;
    }),
    subscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => cb(null)),
    unsubscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => cb(null)),
    end: vi.fn((_force: boolean, _opts: unknown, cb: () => void) => cb()),
    emit(event: string, ...args: unknown[]) {
      (handlers[event] ?? []).forEach(h => h(...args));
    }
  };
  return client;
}

async function importFreshBlitzortung() {
  vi.useFakeTimers();
  vi.resetModules();
  try {
    return await import('../../src/services/blitzortung.js');
  } finally {
    vi.useRealTimers();
  }
}

async function setUp(brokerUrl: string) {
  vi.stubEnv('BLITZORTUNG_MQTT_URL', brokerUrl);
  vi.stubEnv('LOG_LEVEL', '0');
  const client = createFakeMqttClient();
  const connect = vi.fn(() => client);
  vi.doMock('mqtt', () => ({ default: { connect } }));
  const mod = await importFreshBlitzortung();
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { ...mod, consoleSpy, connect };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
});

describe('isEncryptedBrokerUrl', () => {
  it.each(['mqtts', 'wss', 'ssl', 'tls', 'wxs', 'alis'])('treats %s as encrypted, in lower and upper case', async scheme => {
    const { isEncryptedBrokerUrl } = await setUp('mqtt://h:1883');
    expect(isEncryptedBrokerUrl(`${scheme}://h:8883`)).toBe(true);
    expect(isEncryptedBrokerUrl(`${scheme.toUpperCase()}://h:8883`)).toBe(true);
  });

  it.each(['mqtt://h:1883', 'tcp://h:1883', 'ws://h/mqtt', 'http://h', '', 'not a url'])(
    'treats %j as not encrypted',
    async url => {
      const { isEncryptedBrokerUrl } = await setUp('mqtt://h:1883');
      expect(isEncryptedBrokerUrl(url)).toBe(false);
    }
  );
});

describe('plaintext warning through the service', () => {
  async function connectLines(url: string) {
    const { blitzortungService, consoleSpy, connect } = await setUp(url);
    vi.useFakeTimers();
    const promise = blitzortungService.getLightningStrikes(15, 15, 100, 60);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;
    const raw = consoleSpy.mock.calls.map(call => String(call[0]));
    return { raw, lines: raw.map(l => JSON.parse(l) as LogLine), connect };
  }

  it.each(['ssl', 'TLS'])('%s:// draws no plaintext warning and logs encrypted: true', async scheme => {
    const { raw, lines, connect } = await connectLines(`${scheme}://${USER_MARKER}:${USERINFO_MARKER}@broker.example:8883`);
    expect(connect).toHaveBeenCalledTimes(1);
    const connectLine = lines.find(l => l.message === CONNECT_LINE);
    expect(connectLine?.metadata?.encrypted).toBe(true);
    expect(lines.some(l => l.message === PLAINTEXT_WARNING)).toBe(false);
    for (const line of raw) {
      expect(line).not.toContain(USERINFO_MARKER);
      expect(line).not.toContain(USER_MARKER);
    }
  });

  it('tcp:// draws the plaintext warning and logs encrypted: false', async () => {
    const { raw, lines } = await connectLines(`tcp://${USER_MARKER}:${USERINFO_MARKER}@broker.example:1883`);
    const connectLine = lines.find(l => l.message === CONNECT_LINE);
    expect(connectLine?.metadata?.encrypted).toBe(false);
    expect(lines.filter(l => l.message === PLAINTEXT_WARNING)).toHaveLength(1);
    for (const line of raw) {
      expect(line).not.toContain(USERINFO_MARKER);
      expect(line).not.toContain(USER_MARKER);
    }
  });
});
