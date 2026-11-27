/**
 * CACHE_ENABLED / CACHE_MAX_SIZE / API_TIMEOUT_MS parsing in src/config/cache.ts
 * (RF-36, plan-cache-config-eviction T2).
 *
 * `CacheConfig` is computed once at import, so every row stubs the env, resets
 * the module registry and re-imports. Per G21 the config is read only from the
 * re-imported module — never from a top-level import, which is a different
 * epoch. Per G34 the warning is observed on `console.warn`, the identity the
 * config parser calls, not on `process.stderr.write`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type CacheConfigType = (typeof import('../../src/config/cache.js'))['CacheConfig'];

let warnSpy: ReturnType<typeof vi.spyOn>;

async function load(env: Record<string, string | undefined>): Promise<CacheConfigType> {
  // Unset all three first, so a value in the developer's shell or .env cannot leak in.
  for (const key of ['CACHE_ENABLED', 'CACHE_MAX_SIZE', 'API_TIMEOUT_MS']) {
    vi.stubEnv(key, undefined);
  }
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  const mod = await import('../../src/config/cache.js');
  return mod.CacheConfig;
}

function warnings(): string[] {
  return warnSpy.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('CACHE_ENABLED', () => {
  it.each(['false', 'FALSE', ' False ', '0'])('%j turns caching off, silently', async (raw) => {
    const config = await load({ CACHE_ENABLED: raw });
    expect(config.enabled).toBe(false);
    expect(warnings()).toEqual([]);
  });

  it.each(['true', 'TRUE', '1'])('%j leaves caching on, silently', async (raw) => {
    const config = await load({ CACHE_ENABLED: raw });
    expect(config.enabled).toBe(true);
    expect(warnings()).toEqual([]);
  });

  it('unset leaves caching on, silently', async () => {
    const config = await load({});
    expect(config.enabled).toBe(true);
    expect(warnings()).toEqual([]);
  });

  it.each(['banana', ''])('%j leaves caching on and warns once, naming the variable', async (raw) => {
    const config = await load({ CACHE_ENABLED: raw });
    expect(config.enabled).toBe(true);
    const w = warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('CACHE_ENABLED');
    expect(w[0]).toContain('Using default: true');
  });
});

describe('CACHE_MAX_SIZE', () => {
  it.each(['1000abc', '1.9', '1e4', '0x10', ''])(
    '%j is rejected: the default and one "Invalid" warning',
    async (raw) => {
      const config = await load({ CACHE_MAX_SIZE: raw });
      expect(config.maxSize).toBe(1000);
      const w = warnings();
      expect(w).toHaveLength(1);
      expect(w[0]).toMatch(/^Invalid CACHE_MAX_SIZE: /);
    }
  );

  it.each([
    ['500', 500],
    [' 500 ', 500],
    ['+500', 500],
  ])('%j is accepted as %i, silently', async (raw, expected) => {
    const config = await load({ CACHE_MAX_SIZE: raw });
    expect(config.maxSize).toBe(expected);
    expect(warnings()).toEqual([]);
  });

  it.each([
    ['50', 100, 'too low: 50'],
    ['-5', 100, 'too low: -5'],
    ['20000', 10000, 'too high: 20000'],
  ])('%j clamps to %i with the existing warning', async (raw, expected, text) => {
    const config = await load({ CACHE_MAX_SIZE: raw });
    expect(config.maxSize).toBe(expected);
    const w = warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain(text);
  });
});

describe('API_TIMEOUT_MS', () => {
  it('1e5 is rejected outright, not truncated to 1 and clamped to 5000', async () => {
    const config = await load({ API_TIMEOUT_MS: '1e5' });
    expect(config.apiTimeoutMs).toBe(30000);
    const w = warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^Invalid API_TIMEOUT_MS: "1e5"/);
  });

  it('45000 is accepted, silently', async () => {
    const config = await load({ API_TIMEOUT_MS: '45000' });
    expect(config.apiTimeoutMs).toBe(45000);
    expect(warnings()).toEqual([]);
  });
});
