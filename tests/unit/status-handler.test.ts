/**
 * Unit tests for the check_service_status handler.
 *
 * Locks: the honest both-up verdict (no "all services" / "requests should
 * succeed" coverage claim), the partial and both-not-ok verdicts rendered from
 * each probe's outcome, the not-checked line appended once after every branch,
 * the two probes running concurrently, and the version/cache sections rendering
 * unchanged. Every fixture is a result the real probe emits (pinned in
 * tests/unit/service-status-probes.test.ts).
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
import type { ServiceProbeResult } from '../../src/utils/serviceStatusProbe.js';

// -----------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
}

const NOAA_STATUS_PAGE = 'https://weather-gov.github.io/api/planned-outages';
const OPENMETEO_STATUS_PAGE = 'https://open-meteo.com/en/docs/model-updates';

const TS = '2026-01-01T00:00:00.000Z';

const NOAA_OK: ServiceProbeResult = {
  operational: true,
  outcome: 'ok',
  httpStatus: 200,
  message: 'NOAA Weather API answered normally (HTTP 200)',
  statusPage: NOAA_STATUS_PAGE,
  timestamp: TS,
};
const NOAA_429: ServiceProbeResult = {
  operational: false,
  outcome: 'rate_limited',
  httpStatus: 429,
  message: 'NOAA Weather API answered HTTP 429: it is rate limiting this caller',
  statusPage: NOAA_STATUS_PAGE,
  timestamp: TS,
};
const NOAA_404: ServiceProbeResult = {
  operational: false,
  outcome: 'http_error',
  httpStatus: 404,
  message: 'NOAA Weather API answered with HTTP 404',
  statusPage: NOAA_STATUS_PAGE,
  timestamp: TS,
};
const NOAA_503: ServiceProbeResult = {
  operational: false,
  outcome: 'http_error',
  httpStatus: 503,
  message: 'NOAA Weather API answered with HTTP 503',
  statusPage: NOAA_STATUS_PAGE,
  timestamp: TS,
};
const NOAA_NO_RESPONSE: ServiceProbeResult = {
  operational: false,
  outcome: 'no_response',
  message: 'No HTTP response from the NOAA Weather API',
  statusPage: NOAA_STATUS_PAGE,
  timestamp: TS,
};
const OPENMETEO_OK: ServiceProbeResult = {
  operational: true,
  outcome: 'ok',
  httpStatus: 200,
  message: 'Open-Meteo API answered normally (HTTP 200)',
  statusPage: OPENMETEO_STATUS_PAGE,
  timestamp: TS,
};
const OPENMETEO_429: ServiceProbeResult = {
  operational: false,
  outcome: 'rate_limited',
  httpStatus: 429,
  message: 'Open-Meteo API answered HTTP 429: it is rate limiting this caller',
  statusPage: OPENMETEO_STATUS_PAGE,
  timestamp: TS,
};
const OPENMETEO_400: ServiceProbeResult = {
  operational: false,
  outcome: 'http_error',
  httpStatus: 400,
  message: 'Open-Meteo API answered with HTTP 400',
  statusPage: OPENMETEO_STATUS_PAGE,
  timestamp: TS,
};
const OPENMETEO_503: ServiceProbeResult = {
  operational: false,
  outcome: 'http_error',
  httpStatus: 503,
  message: 'Open-Meteo API answered with HTTP 503',
  statusPage: OPENMETEO_STATUS_PAGE,
  timestamp: TS,
};
const OPENMETEO_NO_RESPONSE: ServiceProbeResult = {
  operational: false,
  outcome: 'no_response',
  message: 'No HTTP response from the Open-Meteo API',
  statusPage: OPENMETEO_STATUS_PAGE,
  timestamp: TS,
};

const DEFAULT_NOAA_CACHE_STATS: CacheStats = { hits: 8, misses: 2, evictions: 1, size: 10, maxSize: 1000 };
const DEFAULT_OPENMETEO_CACHE_STATS: CacheStats = { hits: 17, misses: 3, evictions: 0, size: 20, maxSize: 1000 };

function makeNoaaFake(status: ServiceProbeResult, cacheStats: CacheStats = DEFAULT_NOAA_CACHE_STATS): NOAAService {
  return {
    checkServiceStatus: vi.fn().mockResolvedValue(status),
    getCacheStats: vi.fn().mockReturnValue(cacheStats),
  } as unknown as NOAAService;
}

function makeOpenMeteoFake(
  status: ServiceProbeResult,
  cacheStats: CacheStats = DEFAULT_OPENMETEO_CACHE_STATS
): OpenMeteoService {
  return {
    checkServiceStatus: vi.fn().mockResolvedValue(status),
    getCacheStats: vi.fn().mockReturnValue(cacheStats),
  } as unknown as OpenMeteoService;
}

async function renderStatus(noaaStatus: ServiceProbeResult, openMeteoStatus: ServiceProbeResult): Promise<string> {
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

/**
 * One service's block, from its `## <service> …` header up to (not including)
 * the next `## ` heading (G96) — the verdict and the other service's section
 * also carry status marks and the words NOAA / Open-Meteo, so a per-service
 * pin must never be asserted against the whole report.
 */
function extractServiceSection(text: string, header: string): string {
  const start = text.indexOf(header);
  if (start === -1) {
    throw new Error(`No "${header}" heading found in rendered output`);
  }
  const nextHeadingIdx = text.indexOf('\n## ', start + header.length);
  const end = nextHeadingIdx === -1 ? text.length : nextHeadingIdx + 1;
  return text.slice(start, end);
}

/** The `**Status:**` line alone, matched end-to-end so a malformed section throws rather than passing. */
function extractStatusLine(section: string): string {
  const match = section.match(/^\*\*Status:\*\* .+$/m);
  if (!match) {
    throw new Error('No "**Status:**" line found in section');
  }
  return match[0];
}

const NOAA_HEADER = '## NOAA Weather API (Forecasts & Current Conditions)';
const OPENMETEO_HEADER = '## Open-Meteo API (Historical Weather Data)';

const STATUS_MARKS = ['✅', '❌', '⚠️', '⚪', '❓', '🟢', '🔴'];

// -----------------------------------------------------------------------
// Expected literal copy
// -----------------------------------------------------------------------

const BOTH_UP_VERDICT =
  '## Overall Status: ✅ NOAA and Open-Meteo Reachable\n\n' +
  'Both checked services answered. This confirms they are reachable; it does not confirm that every request will succeed.\n';

const BOTH_NO_RESPONSE_VERDICT =
  '## Overall Status: ❌ Neither Service Answered\n\n' +
  'Neither NOAA nor Open-Meteo returned an HTTP response. Two independent hosts failing at once points at this machine or its network path, not at the APIs: check the connection, DNS, proxy and VPN settings first, then retry.\n';

const BOTH_NOT_OK_MIXED_VERDICT =
  '## Overall Status: ❌ Neither Service Answered Normally\n\n' +
  "NOAA API answered with HTTP 503. Open-Meteo API gave no HTTP response. See each service's section above for what to check.\n";

const PARTIAL_NOAA_UP_VERDICT =
  '## Overall Status: ⚠️ One Service Answered Normally\n\n' +
  'NOAA API answered, so it is reachable. This does not confirm that US forecasts and current conditions will succeed.\n' +
  'Open-Meteo API answered with HTTP 503: Historical weather data may be unavailable.\n';

const PARTIAL_OPENMETEO_UP_VERDICT =
  '## Overall Status: ⚠️ One Service Answered Normally\n\n' +
  'Open-Meteo API answered, so it is reachable. This does not confirm that historical weather requests will succeed.\n' +
  'NOAA API answered with HTTP 503: Forecasts and current conditions for US locations may be unavailable.\n';

const PARTIAL_NOAA_UP_OPENMETEO_429_VERDICT =
  '## Overall Status: ⚠️ One Service Answered Normally\n\n' +
  'NOAA API answered, so it is reachable. This does not confirm that US forecasts and current conditions will succeed.\n' +
  'Open-Meteo API answered HTTP 429 and is rate limiting this caller: Historical weather data may be unavailable.\n';

const PARTIAL_NOAA_UP_OPENMETEO_400_VERDICT =
  '## Overall Status: ⚠️ One Service Answered Normally\n\n' +
  'NOAA API answered, so it is reachable. This does not confirm that US forecasts and current conditions will succeed.\n' +
  'Open-Meteo API answered with HTTP 400: Historical weather data may be unavailable.\n';

const PARTIAL_NOAA_UP_OPENMETEO_NO_RESPONSE_VERDICT =
  '## Overall Status: ⚠️ One Service Answered Normally\n\n' +
  'NOAA API answered, so it is reachable. This does not confirm that US forecasts and current conditions will succeed.\n' +
  'Open-Meteo API gave no HTTP response: Historical weather data may be unavailable.\n';

const PARTIAL_OPENMETEO_UP_NOAA_429_VERDICT =
  '## Overall Status: ⚠️ One Service Answered Normally\n\n' +
  'Open-Meteo API answered, so it is reachable. This does not confirm that historical weather requests will succeed.\n' +
  'NOAA API answered HTTP 429 and is rate limiting this caller: Forecasts and current conditions for US locations may be unavailable.\n';

const PARTIAL_OPENMETEO_UP_NOAA_NO_RESPONSE_VERDICT =
  '## Overall Status: ⚠️ One Service Answered Normally\n\n' +
  'Open-Meteo API answered, so it is reachable. This does not confirm that historical weather requests will succeed.\n' +
  'NOAA API gave no HTTP response: Forecasts and current conditions for US locations may be unavailable.\n';

const BOTH_NOT_OK_MIXED_NORESPONSE_429_VERDICT =
  '## Overall Status: ❌ Neither Service Answered Normally\n\n' +
  "NOAA API gave no HTTP response. Open-Meteo API answered HTTP 429 and is rate limiting this caller. See each service's section above for what to check.\n";

describe('handleCheckServiceStatus', () => {
  describe('no coverage claim', () => {
    it('carries neither retired phrase when both probes succeed', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_OK);
      const verdict = extractVerdictHeadlineAndSentence(text);
      expect(verdict).not.toContain('All Services Operational');
      expect(verdict).not.toContain('requests should succeed');
    });

    it('pins the both-up headline and sentence whole', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_OK);
      expect(extractVerdictHeadlineAndSentence(text)).toBe(BOTH_UP_VERDICT);
    });
  });

  describe('not-checked line', () => {
    it('names every provider in the constant, from the constant, in order', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_OK);
      const line = extractNotCheckedLine(text);
      const listMatch = line.match(/^\*\*Not checked by this tool:\*\* (.+)\. A failure in one of these is not diagnosable here\.$/);
      if (!listMatch) {
        throw new Error('Not-checked line did not match its own shape');
      }
      const rendered = listMatch[1].split('; ');
      expect(rendered).toEqual(STATUS_NOT_CHECKED.map((e) => e.provider));
    });

    it('carries no status mark for an unprobed service', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_OK);
      const line = extractNotCheckedLine(text);
      for (const mark of STATUS_MARKS) {
        expect(line).not.toContain(mark);
      }
    });
  });

  describe('every branch carries the not-checked line exactly once, as the last non-empty line', () => {
    const cases: Array<[string, ServiceProbeResult, ServiceProbeResult]> = [
      ['both up', NOAA_OK, OPENMETEO_OK],
      ['NOAA down only', NOAA_503, OPENMETEO_OK],
      ['Open-Meteo down only', NOAA_OK, OPENMETEO_503],
      ['both no response', NOAA_NO_RESPONSE, OPENMETEO_NO_RESPONSE],
      ['mixed not-ok', NOAA_503, OPENMETEO_NO_RESPONSE],
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

  describe('both not-ok splits on whether either service answered', () => {
    it('both no response', async () => {
      const text = await renderStatus(NOAA_NO_RESPONSE, OPENMETEO_NO_RESPONSE);
      expect(extractVerdictHeadlineAndSentence(text)).toBe(BOTH_NO_RESPONSE_VERDICT);
    });

    it('mixed: NOAA 503, Open-Meteo no response', async () => {
      const text = await renderStatus(NOAA_503, OPENMETEO_NO_RESPONSE);
      expect(extractVerdictHeadlineAndSentence(text)).toBe(BOTH_NOT_OK_MIXED_VERDICT);
    });
  });

  describe('partial verdict claims reachability only', () => {
    it('partial — NOAA up, Open-Meteo 503', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_503);
      expect(extractVerdictHeadlineAndSentence(text)).toBe(PARTIAL_NOAA_UP_VERDICT);
    });

    it('partial — Open-Meteo up, NOAA 503', async () => {
      const text = await renderStatus(NOAA_503, OPENMETEO_OK);
      expect(extractVerdictHeadlineAndSentence(text)).toBe(PARTIAL_OPENMETEO_UP_VERDICT);
    });
  });

  // -----------------------------------------------------------------------
  // T4 — per-service label, actions gating and split-verdict pins.
  // -----------------------------------------------------------------------

  describe('per-service status label, pinned whole (G65)', () => {
    const noaaCases: Array<[string, ServiceProbeResult, string]> = [
      ['NOAA ok', NOAA_OK, '**Status:** ✅ Answered normally'],
      ['NOAA rate_limited', NOAA_429, '**Status:** ⚠️ Rate limited (HTTP 429)'],
      ['NOAA http_error 404', NOAA_404, '**Status:** ❌ Error status (HTTP 404)'],
      ['NOAA http_error 503', NOAA_503, '**Status:** ❌ Error status (HTTP 503)'],
      ['NOAA no_response', NOAA_NO_RESPONSE, '**Status:** ❌ No response'],
    ];
    for (const [label, noaaStatus, expectedLine] of noaaCases) {
      it(label, async () => {
        const text = await renderStatus(noaaStatus, OPENMETEO_OK);
        const section = extractServiceSection(text, NOAA_HEADER);
        expect(extractStatusLine(section)).toBe(expectedLine);
      });
    }

    const openMeteoCases: Array<[string, ServiceProbeResult, string]> = [
      ['Open-Meteo ok', OPENMETEO_OK, '**Status:** ✅ Answered normally'],
      ['Open-Meteo rate_limited', OPENMETEO_429, '**Status:** ⚠️ Rate limited (HTTP 429)'],
      ['Open-Meteo http_error 400', OPENMETEO_400, '**Status:** ❌ Error status (HTTP 400)'],
      ['Open-Meteo http_error 503', OPENMETEO_503, '**Status:** ❌ Error status (HTTP 503)'],
      ['Open-Meteo no_response', OPENMETEO_NO_RESPONSE, '**Status:** ❌ No response'],
    ];
    for (const [label, openMeteoStatus, expectedLine] of openMeteoCases) {
      it(label, async () => {
        const text = await renderStatus(NOAA_OK, openMeteoStatus);
        const section = extractServiceSection(text, OPENMETEO_HEADER);
        expect(extractStatusLine(section)).toBe(expectedLine);
      });
    }
  });

  describe('rate limited is never rendered green (G11)', () => {
    it('NOAA rate_limited section carries no ✅', async () => {
      const text = await renderStatus(NOAA_429, OPENMETEO_OK);
      const section = extractServiceSection(text, NOAA_HEADER);
      expect(section).not.toContain('✅');
    });

    it('Open-Meteo rate_limited section carries no ✅', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_429);
      const section = extractServiceSection(text, OPENMETEO_HEADER);
      expect(section).not.toContain('✅');
    });
  });

  describe('no retired full phrase renders anywhere', () => {
    const RETIRED_PHRASES = [
      '✅ Operational',
      '❌ Issues Detected',
      'Partial Service Availability',
      'Both weather APIs are experiencing issues',
    ];

    const renders: Array<[string, ServiceProbeResult, ServiceProbeResult]> = [
      ['both up', NOAA_OK, OPENMETEO_OK],
      ['partial, NOAA up', NOAA_OK, OPENMETEO_503],
      ['partial, Open-Meteo up', NOAA_429, OPENMETEO_OK],
      ['both no response', NOAA_NO_RESPONSE, OPENMETEO_NO_RESPONSE],
      ['mixed not-ok', NOAA_503, OPENMETEO_NO_RESPONSE],
      ['both http_error', NOAA_404, OPENMETEO_400],
    ];

    for (const [label, noaaStatus, openMeteoStatus] of renders) {
      it(label, async () => {
        const text = await renderStatus(noaaStatus, openMeteoStatus);
        for (const phrase of RETIRED_PHRASES) {
          expect(text).not.toContain(phrase);
        }
      });
    }
  });

  describe('recommended actions gating, pinned whole', () => {
    it('ok renders no Recommended Actions — NOAA', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_OK);
      const section = extractServiceSection(text, NOAA_HEADER);
      expect(section).not.toContain('**Recommended Actions:**');
    });

    it('ok renders no Recommended Actions — Open-Meteo', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_OK);
      const section = extractServiceSection(text, OPENMETEO_HEADER);
      expect(section).not.toContain('**Recommended Actions:**');
    });

    it('rate_limited section equals header, fixed lines and the two-bullet wait block — NOAA', async () => {
      const text = await renderStatus(NOAA_429, OPENMETEO_OK);
      const section = extractServiceSection(text, NOAA_HEADER);
      expect(section).toBe(
        '## NOAA Weather API (Forecasts & Current Conditions)\n\n' +
          '**Status:** ⚠️ Rate limited (HTTP 429)\n' +
          '**Message:** NOAA Weather API answered HTTP 429: it is rate limiting this caller\n' +
          '**Status Page:** https://weather-gov.github.io/api/planned-outages\n' +
          '**Coverage:** United States locations only\n\n' +
          '**Recommended Actions:**\n' +
          '- Wait before retrying: the API answered, but it is rate limiting requests from this caller\n' +
          '- Check planned outages: https://weather-gov.github.io/api/planned-outages\n\n'
      );
    });

    it('rate_limited section equals header, fixed lines and the two-bullet wait block — Open-Meteo', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_429);
      const section = extractServiceSection(text, OPENMETEO_HEADER);
      expect(section).toBe(
        '## Open-Meteo API (Historical Weather Data)\n\n' +
          '**Status:** ⚠️ Rate limited (HTTP 429)\n' +
          '**Message:** Open-Meteo API answered HTTP 429: it is rate limiting this caller\n' +
          '**Status Page:** https://open-meteo.com/en/docs/model-updates\n' +
          '**Coverage:** Global (worldwide locations)\n\n' +
          '**Recommended Actions:**\n' +
          '- Wait before retrying: the API answered, but it is rate limiting requests from this caller\n' +
          '- Check production status: https://open-meteo.com/en/docs/model-updates\n\n'
      );
    });

    it('http_error section contains the existing three-bullet contact block whole — NOAA', async () => {
      const text = await renderStatus(NOAA_404, OPENMETEO_OK);
      const section = extractServiceSection(text, NOAA_HEADER);
      expect(section).toContain(
        '**Recommended Actions:**\n' +
          '- Check planned outages: https://weather-gov.github.io/api/planned-outages\n' +
          '- View service notices: https://www.weather.gov/notification\n' +
          '- Report issues: nco.ops@noaa.gov or (301) 683-1518\n\n'
      );
    });

    it('http_error section contains the existing three-bullet contact block whole — Open-Meteo', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_400);
      const section = extractServiceSection(text, OPENMETEO_HEADER);
      expect(section).toContain(
        '**Recommended Actions:**\n' +
          '- Check production status: https://open-meteo.com/en/docs/model-updates\n' +
          '- View GitHub issues: https://github.com/open-meteo/open-meteo/issues\n' +
          '- Review documentation: https://open-meteo.com/en/docs\n\n'
      );
    });

    it('no_response section equals header, fixed lines and the network-first block, and names no upstream contact — NOAA', async () => {
      const text = await renderStatus(NOAA_NO_RESPONSE, OPENMETEO_OK);
      const section = extractServiceSection(text, NOAA_HEADER);
      expect(section).toBe(
        '## NOAA Weather API (Forecasts & Current Conditions)\n\n' +
          '**Status:** ❌ No response\n' +
          '**Message:** No HTTP response from the NOAA Weather API\n' +
          '**Status Page:** https://weather-gov.github.io/api/planned-outages\n' +
          '**Coverage:** United States locations only\n\n' +
          '**Recommended Actions:**\n' +
          '- No HTTP response reached this machine. Check its network first: connection, DNS, proxy and VPN settings\n' +
          '- Retry once the network is confirmed; the status page above is worth checking only after that\n\n'
      );
      expect(section).not.toContain('nco.ops@noaa.gov');
      expect(section).not.toContain('github.com/open-meteo');
      expect(section).not.toContain('weather.gov/notification');
    });

    it('no_response section equals header, fixed lines and the network-first block, and names no upstream contact — Open-Meteo', async () => {
      const text = await renderStatus(NOAA_OK, OPENMETEO_NO_RESPONSE);
      const section = extractServiceSection(text, OPENMETEO_HEADER);
      expect(section).toBe(
        '## Open-Meteo API (Historical Weather Data)\n\n' +
          '**Status:** ❌ No response\n' +
          '**Message:** No HTTP response from the Open-Meteo API\n' +
          '**Status Page:** https://open-meteo.com/en/docs/model-updates\n' +
          '**Coverage:** Global (worldwide locations)\n\n' +
          '**Recommended Actions:**\n' +
          '- No HTTP response reached this machine. Check its network first: connection, DNS, proxy and VPN settings\n' +
          '- Retry once the network is confirmed; the status page above is worth checking only after that\n\n'
      );
      expect(section).not.toContain('nco.ops@noaa.gov');
      expect(section).not.toContain('github.com/open-meteo');
      expect(section).not.toContain('weather.gov/notification');
    });
  });

  describe("partial verdict names the other side's outcome — all seven pins (G65)", () => {
    const cases: Array<[string, ServiceProbeResult, ServiceProbeResult, string]> = [
      ['NOAA ok, Open-Meteo rate_limited', NOAA_OK, OPENMETEO_429, PARTIAL_NOAA_UP_OPENMETEO_429_VERDICT],
      ['NOAA ok, Open-Meteo http_error 503', NOAA_OK, OPENMETEO_503, PARTIAL_NOAA_UP_VERDICT],
      ['NOAA ok, Open-Meteo http_error 400', NOAA_OK, OPENMETEO_400, PARTIAL_NOAA_UP_OPENMETEO_400_VERDICT],
      ['NOAA ok, Open-Meteo no_response', NOAA_OK, OPENMETEO_NO_RESPONSE, PARTIAL_NOAA_UP_OPENMETEO_NO_RESPONSE_VERDICT],
      ['Open-Meteo ok, NOAA rate_limited', NOAA_429, OPENMETEO_OK, PARTIAL_OPENMETEO_UP_NOAA_429_VERDICT],
      ['Open-Meteo ok, NOAA http_error 503', NOAA_503, OPENMETEO_OK, PARTIAL_OPENMETEO_UP_VERDICT],
      ['Open-Meteo ok, NOAA no_response', NOAA_NO_RESPONSE, OPENMETEO_OK, PARTIAL_OPENMETEO_UP_NOAA_NO_RESPONSE_VERDICT],
    ];

    for (const [label, noaaStatus, openMeteoStatus, expected] of cases) {
      it(label, async () => {
        const text = await renderStatus(noaaStatus, openMeteoStatus);
        const verdict = extractVerdictHeadlineAndSentence(text);
        expect(verdict).toBe(expected);
        expect(verdict).not.toContain('has issues');
      });
    }
  });

  it('both no response: whole output carries neither the retired both-down phrase nor the NOAA operations contact', async () => {
    const text = await renderStatus(NOAA_NO_RESPONSE, OPENMETEO_NO_RESPONSE);
    expect(text).not.toContain('Both weather APIs are experiencing issues');
    expect(text).not.toContain('nco.ops@noaa.gov');
  });

  describe('mixed both-not-ok attributes no cause to either side', () => {
    const cases: Array<[string, ServiceProbeResult, ServiceProbeResult, string]> = [
      ['NOAA 503, Open-Meteo no_response', NOAA_503, OPENMETEO_NO_RESPONSE, BOTH_NOT_OK_MIXED_VERDICT],
      ['NOAA no_response, Open-Meteo 429', NOAA_NO_RESPONSE, OPENMETEO_429, BOTH_NOT_OK_MIXED_NORESPONSE_429_VERDICT],
    ];

    for (const [label, noaaStatus, openMeteoStatus, expected] of cases) {
      it(label, async () => {
        const text = await renderStatus(noaaStatus, openMeteoStatus);
        const verdict = extractVerdictHeadlineAndSentence(text);
        expect(verdict).toBe(expected);
        expect(verdict).not.toContain('network');
        expect(verdict).not.toContain('proxy');
        expect(verdict).not.toContain('VPN');
      });
    }
  });

  it('runs both probes concurrently — both start before either resolves', async () => {
    let resolveNoaa!: (status: ServiceProbeResult) => void;
    let resolveOpenMeteo!: (status: ServiceProbeResult) => void;
    const noaaPromise = new Promise<ServiceProbeResult>((resolve) => {
      resolveNoaa = resolve;
    });
    const openMeteoPromise = new Promise<ServiceProbeResult>((resolve) => {
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

    resolveNoaa(NOAA_OK);
    resolveOpenMeteo(OPENMETEO_OK);

    await resultPromise;
  });

  it('leaves the server-version section unchanged from main', async () => {
    const text = await renderStatus(NOAA_OK, OPENMETEO_OK);
    // Check Time is wall-clock; strip it (and its trailing blank line) before comparing.
    const withoutCheckTime = text.replace(/\*\*Check Time:\*\* .*\n\n/, '');
    const noaaIdx = withoutCheckTime.indexOf('## NOAA Weather API');
    if (noaaIdx === -1) {
      throw new Error('No "## NOAA Weather API" heading found');
    }

    const expected =
      `# Weather API Service Status\n\n` +
      `## Server Version\n\n` +
      `**Installed Version:** 1.31.3-test\n` +
      `**Latest Release:** https://github.com/weather-mcp/weather-mcp/releases/latest\n` +
      `**Changelog:** https://github.com/weather-mcp/weather-mcp/blob/main/CHANGELOG.md\n` +
      `**Upgrade Instructions:** See README.md "Upgrading to Latest Version" section\n\n` +
      `*Tip: Use \`npx -y @dangahagan/weather-mcp@latest\` in your MCP config to always run the newest version.*\n\n`;

    expect(withoutCheckTime.slice(0, noaaIdx)).toBe(expected);
  });

  it('leaves the cache section unchanged from main', async () => {
    const text = await renderStatus(NOAA_OK, OPENMETEO_OK);
    const cacheIdx = text.indexOf('## Cache Statistics');
    const overallStatusIdx = text.indexOf('## Overall Status:');
    if (cacheIdx === -1 || overallStatusIdx === -1) {
      throw new Error('No "## Cache Statistics" or "## Overall Status:" heading found');
    }

    const expected =
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

    expect(text.slice(cacheIdx, overallStatusIdx)).toBe(expected);
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
