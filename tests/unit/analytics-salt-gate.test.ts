/**
 * Locks the salt gate in `loadAnalyticsConfig` (src/analytics/config.ts): the
 * analytics salt is generated, and ~/.weather-mcp/analytics-salt written, only
 * for an enabled detailed-level config. Every other configuration creates no
 * file and returns a config with no own `salt` key.
 *
 * GOTCHAS applied:
 *   G21/G61 — import src/analytics/config.js once, statically; never
 *     vi.resetModules(). Hoisted pins keep the import-time singleton off the
 *     real home directory.
 *   G26 — every ANALYTICS_* variable is stubbed per case.
 *   G41 — case 2 is the control that proves the negatives in case 1 are not
 *     vacuous; case 5 proves the HOME stub is honoured by os.homedir().
 *   G103 — this file is outside tsconfig.json's `include`; no casts.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BEFORE = vi.hoisted(() => {
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'analytics-salt-gate-test';
  delete process.env.ANALYTICS_ENDPOINT;
  delete process.env.ANALYTICS_LEVEL;
  return true;
});
void BEFORE;

import { loadAnalyticsConfig } from '../../src/analytics/config.js';
import { logger } from '../../src/utils/logger.js';

const ENDPOINT = 'https://analytics.example.com/v1/events';
const GENERATED = 'Generated new analytics salt';
const LOADED = 'Analytics configuration loaded';

interface Env {
  enabled?: string;
  endpoint?: string;
  level?: string;
  salt?: string;
}

describe('analytics salt gate', () => {
  let tmp: string;
  let infoSpy: MockInstance<typeof logger.info>;

  function stub(env: Env): void {
    vi.stubEnv('ANALYTICS_ENABLED', env.enabled);
    vi.stubEnv('ANALYTICS_ENDPOINT', env.endpoint);
    vi.stubEnv('ANALYTICS_LEVEL', env.level);
    vi.stubEnv('ANALYTICS_SALT', env.salt);
  }

  function infoMessages(): unknown[] {
    return infoSpy.mock.calls.map((c) => c[0]);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmcp-salt-'));
    vi.stubEnv('HOME', tmp);
    vi.stubEnv('ANALYTICS_SALT', undefined);
    infoSpy = vi.spyOn(logger, 'info');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('os.homedir() honours the HOME stub', () => {
    expect(os.homedir()).toBe(tmp);
  });

  it.each<[string, Env]>([
    ['every ANALYTICS_* unset', {}],
    ['enabled, no endpoint', { enabled: 'true' }],
    ['enabled + endpoint at minimal', { enabled: 'true', endpoint: ENDPOINT, level: 'minimal' }],
    ['enabled + endpoint at standard', { enabled: 'true', endpoint: ENDPOINT, level: 'standard' }],
    ['disabled + endpoint at detailed', { enabled: 'false', endpoint: ENDPOINT, level: 'detailed' }],
  ])('creates no salt file when the salt is not read: %s', (_name, env) => {
    stub(env);
    const config = loadAnalyticsConfig();
    expect(fs.readdirSync(tmp)).toEqual([]);
    expect(Object.hasOwn(config, 'salt')).toBe(false);
    expect(infoMessages()).not.toContain(GENERATED);
  });

  it('control: enabled detailed generates the salt and writes the file', () => {
    stub({ enabled: 'true', endpoint: ENDPOINT, level: 'detailed' });
    const config = loadAnalyticsConfig();
    const dir = path.join(tmp, '.weather-mcp');
    const file = path.join(dir, 'analytics-salt');
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    const st = fs.statSync(file);
    expect(st.mode & 0o777).toBe(0o600);
    expect(st.size).toBe(64);
    expect(config.salt).toBe(fs.readFileSync(file, 'utf8').trim());
    const msgs = infoMessages();
    expect(msgs).toContain(GENERATED);
    expect(msgs.indexOf(GENERATED)).toBeLessThan(msgs.indexOf(LOADED));
  });

  it('reads an existing salt file without overwriting it', () => {
    const dir = path.join(tmp, '.weather-mcp');
    const file = path.join(dir, 'analytics-salt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, 'known-salt-value');
    stub({ enabled: 'true', endpoint: ENDPOINT, level: 'detailed' });
    const config = loadAnalyticsConfig();
    expect(config.salt).toBe('known-salt-value');
    expect(fs.readFileSync(file, 'utf8')).toBe('known-salt-value');
    expect(infoMessages()).not.toContain(GENERATED);
  });

  it('uses ANALYTICS_SALT from the environment without touching the filesystem', () => {
    stub({ enabled: 'true', endpoint: ENDPOINT, level: 'detailed', salt: 'env-salt' });
    const config = loadAnalyticsConfig();
    expect(config.salt).toBe('env-salt');
    expect(fs.readdirSync(tmp)).toEqual([]);
  });
});
