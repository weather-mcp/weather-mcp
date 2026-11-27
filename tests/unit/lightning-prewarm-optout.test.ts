/**
 * `WEATHER_LIGHTNING_PREWARM` is read through the shared `parseEnvBoolean`: false/0 in any
 * case (trimmed) opts out; an unrecognized value warns once, without echoing it, and pre-warms.
 * `prewarmLocation` is always stubbed (GOTCHAS G107).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { LightningPrewarmDeps, LightningPrewarmHandle } from '../../src/server/lightningPrewarm.js';

let startLightningPrewarm: (deps: LightningPrewarmDeps) => LightningPrewarmHandle;
let logger: typeof import('../../src/utils/logger.js')['logger'];

beforeAll(async () => {
  startLightningPrewarm = (await import('../../src/server/lightningPrewarm.js')).startLightningPrewarm;
  logger = (await import('../../src/utils/logger.js')).logger;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function run(optOutValue: string | undefined, toolEnabled = true) {
  const setInterval = vi.fn(() => 1 as unknown as ReturnType<typeof globalThis.setInterval>);
  const readSavedLocations = vi.fn(() => []);
  const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  startLightningPrewarm({
    toolEnabled,
    optOutValue,
    readSavedLocations,
    prewarmLocation: vi.fn().mockResolvedValue(undefined),
    scheduler: { setInterval, clearInterval: vi.fn() }
  });
  return { setInterval, readSavedLocations, warn };
}

describe('WEATHER_LIGHTNING_PREWARM opt-out', () => {
  it.each(['FALSE', ' false ', '0'])('%j opts out: no timer, no store read', (value) => {
    const { setInterval, readSavedLocations, warn } = run(value);
    expect(setInterval).not.toHaveBeenCalled();
    expect(readSavedLocations).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['TRUE', '1', undefined])('%j pre-warms: timer started once', (value) => {
    const { setInterval, warn } = run(value);
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('unrecognized value pre-warms, warns once, and never echoes the value', () => {
    const { setInterval, warn } = run('banana');
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('banana');
  });

  it('unrecognized value with the tool disabled stays silent and starts no timer', () => {
    const { setInterval, warn } = run('banana', false);
    expect(setInterval).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
