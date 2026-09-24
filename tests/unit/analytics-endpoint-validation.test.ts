/**
 * Locks `validateAnalyticsEndpoint` and `loadAnalyticsConfig`'s SSRF guard
 * against `ANALYTICS_ENDPOINT` (src/analytics/config.ts).
 *
 * This is T1 of .devdocs/plan-analytics-endpoint-hardening-impl.md: a lock
 * test written against the UNFIXED guard. `url.hostname` brackets IPv6
 * (`[::1]`), so the one clause written with IPv6 in mind —
 * `hostname === '::1'` at config.ts:51 — can never match, and every IPv6
 * literal currently reaches the "IP addresses not allowed" ban's else
 * branch undetected, i.e. passes the guard entirely. The IPv6 rows below
 * are written with `it.fails` because they pass (no throw) on today's code;
 * T2 fixes the guard and flips them to plain `it`.
 *
 * GOTCHAS applied:
 *   G21/G61 — never import src/index.ts (runs main()); import only
 *     src/analytics/config.js, once, statically; no vi.resetModules().
 *   G26 — pin ANALYTICS_ENABLED/ANALYTICS_SALT/ANALYTICS_ENDPOINT/
 *     ANALYTICS_LEVEL via vi.hoisted before the static import evaluates,
 *     so a developer shell's exported vars (or the repo .env, though
 *     Vitest doesn't load it) can't change the configuration under test.
 *   G65 — assert every thrown message WHOLE (toThrow with the full
 *     string), never a prefix.
 *   G103 — this file is outside tsconfig.json's `include`, so nothing
 *     here is typechecked by `npm run build`; no casts that would hide a
 *     wrong shape.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

const BEFORE = vi.hoisted(() => {
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'analytics-endpoint-validation-test';
  delete process.env.ANALYTICS_ENDPOINT;
  delete process.env.ANALYTICS_LEVEL;
  return true;
});
void BEFORE;

// Import the module exactly once, statically. Importing it constructs the
// `analytics` singleton (src/analytics/config.ts:193) via
// loadAnalyticsConfig() -> getOrGenerateAnalyticsSalt(), which is why
// ANALYTICS_SALT must already be pinned above.
import {
  validateAnalyticsEndpoint,
  loadAnalyticsConfig,
} from '../../src/analytics/config.js';
import { logger } from '../../src/utils/logger.js';

const DEFAULT_ENDPOINT = 'https://analytics.weather-mcp.com/v1/events';

// Vitest's toThrow('<string>') is a substring match. Pin every message whole
// (G65), so a suffix appended to a message turns the row red.
function exactly(message: string): RegExp {
  return new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

describe('validateAnalyticsEndpoint', () => {
  describe('accepted (no throw)', () => {
    const accepted = [
      'https://analytics.example.com/v1/events',
      'https://analytics.example.com:443/v1/events',
      'https://analytics.example.com:8443/v1/events',
      'https://analytics.weather-mcp.com/v1/events',
    ];

    it.each(accepted)('%s does not throw', (endpoint) => {
      expect(() => validateAnalyticsEndpoint(endpoint)).not.toThrow();
    });
  });

  describe('blocked: cannot point to internal network', () => {
    const blocked = [
      'https://localhost/',
      'https://127.0.0.1/',
      'https://10.0.0.1/',
      'https://172.16.0.1/',
      'https://172.31.255.1/',
      'https://192.168.1.1/',
      'https://169.254.1.1/',
      'https://printer.local/',
    ];

    it.each(blocked)('%s throws the internal-network message', (endpoint) => {
      expect(() => validateAnalyticsEndpoint(endpoint)).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: cannot point to internal network'));
    });
  });

  describe('blocked: IP addresses not allowed (IPv4)', () => {
    const blockedIpv4 = ['https://0.0.0.0/', 'https://8.8.8.8/'];

    it.each(blockedIpv4)('%s throws the IP-literal message', (endpoint) => {
      expect(() => validateAnalyticsEndpoint(endpoint)).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name'));
    });
  });

  describe('IPv6 literals — should be blocked, but reach the network today (locked to fail)', () => {
    // url.hostname brackets IPv6 ("[::1]"), so config.ts:51's
    // `hostname === '::1'` never matches and these all pass the guard
    // as written. Each row is written with it.fails: it must fail today
    // (no throw is raised, so the toThrow assertion itself fails) and T2
    // flips these to plain `it` once the guard rejects bracketed hosts.
    it.fails('https://[::1]/ throws the IP-literal message', () => {
      expect(() => validateAnalyticsEndpoint('https://[::1]/')).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name'));
    });

    it.fails('https://[fd00::1]/ throws the IP-literal message', () => {
      expect(() => validateAnalyticsEndpoint('https://[fd00::1]/')).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name'));
    });

    it.fails('https://[fe80::1]/ throws the IP-literal message', () => {
      expect(() => validateAnalyticsEndpoint('https://[fe80::1]/')).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name'));
    });

    it.fails('https://[::ffff:127.0.0.1]/ throws the IP-literal message', () => {
      expect(() =>
        validateAnalyticsEndpoint('https://[::ffff:127.0.0.1]/')
      ).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name'));
    });

    it.fails('https://[::]/ throws the IP-literal message', () => {
      expect(() => validateAnalyticsEndpoint('https://[::]/')).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name'));
    });

    it.fails('https://[0:0:0:0:0:0:0:1]/ throws the IP-literal message', () => {
      expect(() =>
        validateAnalyticsEndpoint('https://[0:0:0:0:0:0:0:1]/')
      ).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name'));
    });

    it.fails('https://[2606:4700:4700::1111]/ (public IPv6) throws the IP-literal message', () => {
      expect(() =>
        validateAnalyticsEndpoint('https://[2606:4700:4700::1111]/')
      ).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name'));
    });

    it.fails('https://[::1]:8443/v1/events throws the IP-literal message', () => {
      expect(() =>
        validateAnalyticsEndpoint('https://[::1]:8443/v1/events')
      ).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name'));
    });
  });

  describe('other validation errors', () => {
    it('not a url throws the must-be-a-valid-url message', () => {
      expect(() => validateAnalyticsEndpoint('not a url')).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: must be a valid URL'));
    });

    it('http:// throws the must-use-https message', () => {
      expect(() =>
        validateAnalyticsEndpoint('http://analytics.example.com/')
      ).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: must use HTTPS protocol'));
    });

    it('port 80 throws the invalid-port message', () => {
      expect(() =>
        validateAnalyticsEndpoint('https://analytics.example.com:80/')
      ).toThrow(exactly('Invalid ANALYTICS_ENDPOINT: invalid port number'));
    });
  });
});

describe('loadAnalyticsConfig — fail-safe fallback', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('defaults to disabled with the default endpoint when unset, and does not log an error', () => {
    vi.stubEnv('ANALYTICS_ENABLED', undefined);
    vi.stubEnv('ANALYTICS_ENDPOINT', undefined);
    vi.stubEnv('ANALYTICS_SALT', 'analytics-endpoint-validation-test');
    const errorSpy = vi.spyOn(logger, 'error');

    const config = loadAnalyticsConfig();

    expect(config.enabled).toBe(false);
    expect(config.endpoint).toBe(DEFAULT_ENDPOINT);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('falls back to disabled and the default endpoint when ANALYTICS_ENDPOINT is a rejected IPv4 literal', () => {
    vi.stubEnv('ANALYTICS_ENABLED', 'true');
    vi.stubEnv('ANALYTICS_ENDPOINT', 'https://10.0.0.1/v1/events');
    vi.stubEnv('ANALYTICS_SALT', 'analytics-endpoint-validation-test');
    const errorSpy = vi.spyOn(logger, 'error');

    let config;
    expect(() => {
      config = loadAnalyticsConfig();
    }).not.toThrow();

    expect(config!.enabled).toBe(false);
    expect(config!.endpoint).toBe(DEFAULT_ENDPOINT);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe(
      'Invalid ANALYTICS_ENDPOINT configuration: Invalid ANALYTICS_ENDPOINT: cannot point to internal network'
    );
  });

  it.fails(
    'falls back to disabled and the default endpoint when ANALYTICS_ENDPOINT is a rejected IPv6 literal',
    () => {
      vi.stubEnv('ANALYTICS_ENABLED', 'true');
      vi.stubEnv('ANALYTICS_ENDPOINT', 'https://[::1]/v1/events');
      vi.stubEnv('ANALYTICS_SALT', 'analytics-endpoint-validation-test');
      const errorSpy = vi.spyOn(logger, 'error');

      let config;
      expect(() => {
        config = loadAnalyticsConfig();
      }).not.toThrow();

      expect(config!.enabled).toBe(false);
      expect(config!.endpoint).toBe(DEFAULT_ENDPOINT);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toBe(
        'Invalid ANALYTICS_ENDPOINT configuration: Invalid ANALYTICS_ENDPOINT: IP addresses not allowed, use domain name'
      );
    }
  );

  it('accepts and enables a valid custom endpoint', () => {
    vi.stubEnv('ANALYTICS_ENABLED', 'true');
    vi.stubEnv('ANALYTICS_ENDPOINT', 'https://analytics.example.com/v1/events');
    vi.stubEnv('ANALYTICS_SALT', 'analytics-endpoint-validation-test');

    const config = loadAnalyticsConfig();

    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe('https://analytics.example.com/v1/events');
  });
});
