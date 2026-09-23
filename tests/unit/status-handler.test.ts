/**
 * Unit tests for the check_service_status handler.
 *
 * Locks: the honest both-up verdict (no "all services" / "requests should
 * succeed" coverage claim), the reachability-only partial verdict (the
 * probes report NOAA 404 and Open-Meteo 400 as up, so "up" proves only
 * that the host answered), the byte-for-byte-unchanged both-down copy, the not-checked line appended once after every branch, the two
 * probes running concurrently, and the version/cache sections rendering
 * unchanged from `main`.
 *
 * The drift guard below reads `src/services/` with `readdirSync` and checks
 * every file is placed in `STATUS_PROBED_SOURCES`, `STATUS_NOT_CHECKED`, or
 * this file's own `NO_UPSTREAM_FILES`. Its scope is `src/services/` only:
 * the handler-level RainViewer tile fetch (`src/handlers/weatherImageryHandler.ts`,
 * a bare `axios.get`) and the opt-in analytics transport (`src/analytics/transport.ts`,
 * core `https`) are both outside `src/services/` and outside this guard.
 */

import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { handleCheckServiceStatus } from '../../src/handlers/statusHandler.js';
import { STATUS_PROBED_SOURCES, STATUS_NOT_CHECKED } from '../../src/utils/serviceStatusCoverage.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';

// -----------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------

interface ServiceStatus {
  operational: boolean;
  message: string;
  statusPage: string;
  timestamp: string;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
}

const NOAA_STATUS_PAGE = 'https://weather-gov.github.io/api/planned-outages';
const OPENMETEO_STATUS_PAGE = 'https://open-meteo.com/en/docs/model-updates';

const NOAA_UP: ServiceStatus = {
  operational: true,
  message: 'NOAA Weather API is operational',
  statusPage: NOAA_STATUS_PAGE,
  timestamp: '2026-01-01T00:00:00.000Z',
};
const NOAA_DOWN: ServiceStatus = {
  operational: false,
  message: 'NOAA API is experiencing server errors (possible outage)',
  statusPage: NOAA_STATUS_PAGE,
  timestamp: '2026-01-01T00:00:00.000Z',
};
const OPENMETEO_UP: ServiceStatus = {
  operational: true,
  message: 'Open-Meteo API is operational',
  statusPage: OPENMETEO_STATUS_PAGE,
  timestamp: '2026-01-01T00:00:00.000Z',
};
const OPENMETEO_DOWN: ServiceStatus = {
  operational: false,
  message: 'Open-Meteo API is experiencing server errors (possible outage)',
  statusPage: OPENMETEO_STATUS_PAGE,
  timestamp: '2026-01-01T00:00:00.000Z',
};

// The real messages the services return for the answers they map to
// `operational: true` without a healthy response (noaa.ts 404 arm,
// openmeteo.ts 400 arm). A reachability probe cannot tell these from a
// healthy answer, so the partial verdict must not claim data is available.
const NOAA_404: ServiceStatus = {
  operational: true,
  message: 'NOAA API is responding (health check endpoint may have changed)',
  statusPage: NOAA_STATUS_PAGE,
  timestamp: '2026-01-01T00:00:00.000Z',
};
const OPENMETEO_400: ServiceStatus = {
  operational: true,
  message: 'Open-Meteo API is responding (health check may need adjustment)',
  statusPage: OPENMETEO_STATUS_PAGE,
  timestamp: '2026-01-01T00:00:00.000Z',
};

const DEFAULT_NOAA_CACHE_STATS: CacheStats = { hits: 8, misses: 2, evictions: 1, size: 10, maxSize: 1000 };
const DEFAULT_OPENMETEO_CACHE_STATS: CacheStats = { hits: 17, misses: 3, evictions: 0, size: 20, maxSize: 1000 };

function makeNoaaFake(status: ServiceStatus, cacheStats: CacheStats = DEFAULT_NOAA_CACHE_STATS): NOAAService {
  return {
    checkServiceStatus: vi.fn().mockResolvedValue(status),
    getCacheStats: vi.fn().mockReturnValue(cacheStats),
  } as unknown as NOAAService;
}

function makeOpenMeteoFake(
  status: ServiceStatus,
  cacheStats: CacheStats = DEFAULT_OPENMETEO_CACHE_STATS
): OpenMeteoService {
  return {
    checkServiceStatus: vi.fn().mockResolvedValue(status),
    getCacheStats: vi.fn().mockReturnValue(cacheStats),
  } as unknown as OpenMeteoService;
}

async function renderStatus(noaaStatus: ServiceStatus, openMeteoStatus: ServiceStatus): Promise<string> {
  const result = await handleCheckServiceStatus(makeNoaaFake(noaaStatus), makeOpenMeteoFake(openMeteoStatus), '1.31.3-test');
  return result.content[0].text;
}

// -----------------------------------------------------------------------
// Parse-then-assert helpers (G96) — never assert a construct against the
// whole rendered string, since NOAA and Open-Meteo are also named in the
// per-service sections above the verdict and would satisfy a whole-string
// check.
// -----------------------------------------------------------------------

/** From `## Overall Status: ` to the end of the string (headline + sentence(s) + not-checked line). */
function extractVerdictTail(text: string): string {
  const match = text.match(/## Overall Status:[\s\S]*$/);
  if (!match) {
    throw new Error('No "## Overall Status:" block found in rendered output');
  }
  return match[0];
}

/** The not-checked line alone, matched end-to-end so a truncated render throws rather than passing. */
function extractNotCheckedLine(text: string): string {
  const match = text.match(
    /^\*\*Not checked by this tool:\*\* (.+)\. A failure in one of these is not diagnosable here\.$/m
  );
  if (!match) {
    throw new Error('No not-checked line found in rendered output');
  }
  return match[0];
}

/** The verdict headline + sentence(s), pinned whole (G65) — the tail with the not-checked line and its leading blank line removed. */
function extractVerdictHeadlineAndSentence(text: string): string {
  const tail = extractVerdictTail(text);
  const notCheckedLine = extractNotCheckedLine(text);
  const boundary = `\n\n${notCheckedLine}`;
  const idx = tail.indexOf(boundary);
  if (idx === -1) {
    throw new Error('Could not locate the boundary between the verdict and the not-checked line');
  }
  return tail.slice(0, idx + 1); // keep exactly one trailing \n (the sentence's own)
}

const STATUS_MARKS = ['✅', '❌', '⚠️', '⚪', '❓', '🟢', '🔴'];

// -----------------------------------------------------------------------
// Expected literal copy
// -----------------------------------------------------------------------

const BOTH_UP_VERDICT =
  '## Overall Status: ✅ NOAA and Open-Meteo Reachable\n\n' +
  'Both checked services answered. This confirms they are reachable; it does not confirm that every request will succeed.\n';

const BOTH_DOWN_VERDICT =
  '## Overall Status: ❌ Multiple Service Issues\n\n' +
  'Both weather APIs are experiencing issues. Please check the status pages above for updates.\n';

const PARTIAL_NOAA_UP_VERDICT =
  '## Overall Status: ⚠️ Partial Service Availability\n\n' +
  'NOAA API answered, so it is reachable. This does not confirm that US forecasts and current conditions will succeed.\n' +
  'Open-Meteo API has issues: Historical weather data may be unavailable.\n';

const PARTIAL_OPENMETEO_UP_VERDICT =
  '## Overall Status: ⚠️ Partial Service Availability\n\n' +
  'Open-Meteo API answered, so it is reachable. This does not confirm that historical weather requests will succeed.\n' +
  'NOAA API has issues: Forecasts and current conditions for US locations may be unavailable.\n';

describe('handleCheckServiceStatus', () => {
  describe('no coverage claim', () => {
    it('carries neither retired phrase when both probes succeed', async () => {
      const text = await renderStatus(NOAA_UP, OPENMETEO_UP);
      const verdict = extractVerdictHeadlineAndSentence(text);
      expect(verdict).not.toContain('All Services Operational');
      expect(verdict).not.toContain('requests should succeed');
    });

    it('pins the both-up headline and sentence whole', async () => {
      const text = await renderStatus(NOAA_UP, OPENMETEO_UP);
      expect(extractVerdictHeadlineAndSentence(text)).toBe(BOTH_UP_VERDICT);
    });
  });

  describe('not-checked line', () => {
    it('names every provider in the constant, from the constant, in order', async () => {
      const text = await renderStatus(NOAA_UP, OPENMETEO_UP);
      const line = extractNotCheckedLine(text);
      const listMatch = line.match(/^\*\*Not checked by this tool:\*\* (.+)\. A failure in one of these is not diagnosable here\.$/);
      if (!listMatch) {
        throw new Error('Not-checked line did not match its own shape');
      }
      const rendered = listMatch[1].split('; ');
      expect(rendered).toEqual(STATUS_NOT_CHECKED.map((e) => e.provider));
    });

    it('carries no status mark for an unprobed service', async () => {
      const text = await renderStatus(NOAA_UP, OPENMETEO_UP);
      const line = extractNotCheckedLine(text);
      for (const mark of STATUS_MARKS) {
        expect(line).not.toContain(mark);
      }
    });
  });

  describe('every branch carries the not-checked line exactly once, as the last non-empty line', () => {
    const cases: Array<[string, ServiceStatus, ServiceStatus]> = [
      ['both up', NOAA_UP, OPENMETEO_UP],
      ['NOAA down only', NOAA_DOWN, OPENMETEO_UP],
      ['Open-Meteo down only', NOAA_UP, OPENMETEO_DOWN],
      ['both down', NOAA_DOWN, OPENMETEO_DOWN],
    ];

    for (const [label, noaaStatus, openMeteoStatus] of cases) {
      it(label, async () => {
        const text = await renderStatus(noaaStatus, openMeteoStatus);
        const notCheckedLine = extractNotCheckedLine(text);

        const occurrences = text.split('**Not checked by this tool:**').length - 1;
        expect(occurrences).toBe(1);

        const nonEmptyLines = text.split('\n').filter((l) => l.trim().length > 0);
        expect(nonEmptyLines[nonEmptyLines.length - 1]).toBe(notCheckedLine);
      });
    }
  });

  describe('both-down copy is unchanged from main', () => {
    it('both down', async () => {
      const text = await renderStatus(NOAA_DOWN, OPENMETEO_DOWN);
      expect(extractVerdictHeadlineAndSentence(text)).toBe(BOTH_DOWN_VERDICT);
    });
  });

  describe('partial verdict claims reachability only', () => {

    it('partial — NOAA up, Open-Meteo down', async () => {
      const text = await renderStatus(NOAA_UP, OPENMETEO_DOWN);
      expect(extractVerdictHeadlineAndSentence(text)).toBe(PARTIAL_NOAA_UP_VERDICT);
    });

    it('partial — Open-Meteo up, NOAA down', async () => {
      const text = await renderStatus(NOAA_DOWN, OPENMETEO_UP);
      expect(extractVerdictHeadlineAndSentence(text)).toBe(PARTIAL_OPENMETEO_UP_VERDICT);
    });

    it('NOAA 404 counts as reachable, never as data available', async () => {
      const text = await renderStatus(NOAA_404, OPENMETEO_DOWN);
      const verdict = extractVerdictHeadlineAndSentence(text);
      expect(verdict).toBe(PARTIAL_NOAA_UP_VERDICT);
      expect(verdict).not.toContain('is operational');
      expect(verdict).not.toContain('are available');
    });

    it('Open-Meteo 400 counts as reachable, never as data available', async () => {
      const text = await renderStatus(NOAA_DOWN, OPENMETEO_400);
      const verdict = extractVerdictHeadlineAndSentence(text);
      expect(verdict).toBe(PARTIAL_OPENMETEO_UP_VERDICT);
      expect(verdict).not.toContain('is operational');
      expect(verdict).not.toContain('is available');
    });
  });

  it('runs both probes concurrently — both start before either resolves', async () => {
    let resolveNoaa!: (status: ServiceStatus) => void;
    let resolveOpenMeteo!: (status: ServiceStatus) => void;
    const noaaPromise = new Promise<ServiceStatus>((resolve) => {
      resolveNoaa = resolve;
    });
    const openMeteoPromise = new Promise<ServiceStatus>((resolve) => {
      resolveOpenMeteo = resolve;
    });

    const noaaCheck = vi.fn().mockReturnValue(noaaPromise);
    const openMeteoCheck = vi.fn().mockReturnValue(openMeteoPromise);
    const noaaFake = {
      checkServiceStatus: noaaCheck,
      getCacheStats: vi.fn().mockReturnValue(DEFAULT_NOAA_CACHE_STATS),
    } as unknown as NOAAService;
    const openMeteoFake = {
      checkServiceStatus: openMeteoCheck,
      getCacheStats: vi.fn().mockReturnValue(DEFAULT_OPENMETEO_CACHE_STATS),
    } as unknown as OpenMeteoService;

    const resultPromise = handleCheckServiceStatus(noaaFake, openMeteoFake, '1.31.3-test');

    // Flush one microtask turn without resolving either deferred promise.
    await Promise.resolve();
    await Promise.resolve();

    expect(noaaCheck).toHaveBeenCalledTimes(1);
    expect(openMeteoCheck).toHaveBeenCalledTimes(1);

    resolveNoaa(NOAA_UP);
    resolveOpenMeteo(OPENMETEO_UP);

    await resultPromise;
  });

  it('leaves the server-version, per-service and cache sections unchanged from main', async () => {
    const text = await renderStatus(NOAA_UP, OPENMETEO_UP);
    // Check Time is wall-clock; strip it (and its trailing blank line) before comparing.
    const withoutCheckTime = text.replace(/\*\*Check Time:\*\* .*\n\n/, '');
    const overallStatusIdx = withoutCheckTime.indexOf('## Overall Status:');
    if (overallStatusIdx === -1) {
      throw new Error('No "## Overall Status:" heading found');
    }
    const upToVerdict = withoutCheckTime.slice(0, overallStatusIdx);

    const expected =
      `# Weather API Service Status\n\n` +
      `## Server Version\n\n` +
      `**Installed Version:** 1.31.3-test\n` +
      `**Latest Release:** https://github.com/weather-mcp/weather-mcp/releases/latest\n` +
      `**Changelog:** https://github.com/weather-mcp/weather-mcp/blob/main/CHANGELOG.md\n` +
      `**Upgrade Instructions:** See README.md "Upgrading to Latest Version" section\n\n` +
      `*Tip: Use \`npx -y @dangahagan/weather-mcp@latest\` in your MCP config to always run the newest version.*\n\n` +
      `## NOAA Weather API (Forecasts & Current Conditions)\n\n` +
      `**Status:** ✅ Operational\n` +
      `**Message:** ${NOAA_UP.message}\n` +
      `**Status Page:** ${NOAA_UP.statusPage}\n` +
      `**Coverage:** United States locations only\n\n` +
      `## Open-Meteo API (Historical Weather Data)\n\n` +
      `**Status:** ✅ Operational\n` +
      `**Message:** ${OPENMETEO_UP.message}\n` +
      `**Status Page:** ${OPENMETEO_UP.statusPage}\n` +
      `**Coverage:** Global (worldwide locations)\n\n` +
      `## Cache Statistics\n\n` +
      `**Cache Status:** ✅ Enabled\n` +
      `**Overall Hit Rate:** 83.3%\n` +
      `**Total Cache Hits:** 25\n` +
      `**Total Cache Misses:** 5\n` +
      `**Total Requests:** 30\n\n` +
      `### NOAA Service Cache\n` +
      `- Entries: 10 / 1000\n` +
      `- Hit Rate: 80.0%\n` +
      `- Hits: 8\n` +
      `- Misses: 2\n` +
      `- Evictions: 1\n\n` +
      `### Open-Meteo Service Cache\n` +
      `- Entries: 20 / 1000\n` +
      `- Hit Rate: 85.0%\n` +
      `- Hits: 17\n` +
      `- Misses: 3\n` +
      `- Evictions: 0\n\n` +
      `*Cache reduces API calls and improves performance for repeated queries.*\n\n`;

    expect(upToVerdict).toBe(expected);
  });

  // -----------------------------------------------------------------------
  // Drift guard — every src/services/ file is placed in STATUS_PROBED_SOURCES,
  // STATUS_NOT_CHECKED, or NO_UPSTREAM_FILES (see the file header comment for
  // the guard's scope).
  // -----------------------------------------------------------------------
  describe('drift guard — src/services/ inventory', () => {
    // Files under src/services/ that make no upstream network call at all.
    // Kept in the test rather than the constant, since it renders nothing.
    const NO_UPSTREAM_FILES = ['gibs.ts', 'locationStore.ts'];

    const serviceFiles = readdirSync(new URL('../../src/services/', import.meta.url)).filter((f) =>
      f.endsWith('.ts')
    );

    function importsNetwork(fileText: string): boolean {
      return (
        fileText.includes(`from 'axios'`) ||
        fileText.includes(`from 'mqtt'`) ||
        fileText.includes(`from 'https'`) ||
        fileText.includes(`from 'node:https'`) ||
        fileText.includes('fetch(') ||
        fileText.includes(`import('mqtt')`)
      );
    }

    it('places every service file as probed, not-checked, or no-upstream', () => {
      const placed = new Set<string>(STATUS_PROBED_SOURCES);
      for (const entryItem of STATUS_NOT_CHECKED) {
        for (const source of entryItem.sources) {
          placed.add(source);
        }
      }
      for (const file of NO_UPSTREAM_FILES) {
        placed.add(file);
      }

      for (const file of serviceFiles) {
        expect(
          placed.has(file),
          `${file} is not in STATUS_PROBED_SOURCES, any STATUS_NOT_CHECKED[].sources, or NO_UPSTREAM_FILES — ` +
            `place it in one of the three (tests/unit/status-handler.test.ts)`
        ).toBe(true);
      }
    });

    it('names no stale or orphan service file', () => {
      const existing = new Set(serviceFiles);
      const named = new Set<string>(STATUS_PROBED_SOURCES);
      for (const entryItem of STATUS_NOT_CHECKED) {
        expect(entryItem.sources.length, `"${entryItem.provider}" names no source files`).toBeGreaterThan(0);
        for (const source of entryItem.sources) {
          named.add(source);
        }
      }
      for (const file of NO_UPSTREAM_FILES) {
        named.add(file);
      }

      for (const name of named) {
        expect(existing.has(name), `"${name}" is named but does not exist in src/services/`).toBe(true);
      }
    });

    it('positive control: the no-network predicate can fail — noaa.ts imports a network client', () => {
      const noaaText = readFileSync(new URL('../../src/services/noaa.ts', import.meta.url), 'utf-8');
      expect(importsNetwork(noaaText)).toBe(true);
    });

    it('keeps NO_UPSTREAM_FILES honest — none of them import a network client', () => {
      for (const file of NO_UPSTREAM_FILES) {
        const text = readFileSync(new URL(`../../src/services/${file}`, import.meta.url), 'utf-8');
        expect(importsNetwork(text), `${file} imports a network client but is listed as no-upstream`).toBe(false);
      }
    });
  });
});
