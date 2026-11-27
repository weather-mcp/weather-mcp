/**
 * CACHE_ENABLED=false reaches the EA, JMA and MET Norway caches
 * (RF-36, plan-cache-config-eviction T2a; plan-review codex R1).
 *
 * These were the only production `new Cache` sites with no `CacheConfig.enabled`
 * read, so turning caching off still served cached GB river levels, Japanese
 * warnings and met.no fallback forecasts. Each service is exercised twice in a
 * row with the cache disabled (two upstream requests, nothing retained, no
 * conditional-request validator), and once enabled as the control (the second
 * call is served from cache).
 *
 * `CacheConfig` is computed at import, so each block stubs the env, resets the
 * module registry and re-imports the service. Per G21, the service class is
 * taken only from that re-import, so it reads the matching `CacheConfig`.
 * The axios double is the hoisted `default.create` → `{ get }` scaffold the
 * three services' own test files use; `vi.mock` survives `vi.resetModules()`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn()
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: (...args: unknown[]) => mockGet(...args)
    }))
  }
}));

type MockCall = [string, ({ headers?: Record<string, string> } | undefined)?];

function calls(): MockCall[] {
  return mockGet.mock.calls as unknown as MockCall[];
}

function cacheSize(service: unknown): number {
  return (service as { cache: { getStats(): { size: number } } }).cache.getStats().size;
}

async function withCacheEnabled(value: 'true' | 'false'): Promise<void> {
  vi.stubEnv('CACHE_ENABLED', value);
  vi.resetModules();
  const { logger } = await import('../../src/utils/logger.js');
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  vi.spyOn(logger, 'info').mockImplementation(() => undefined);
}

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Environment Agency
// ---------------------------------------------------------------------------

const EA_MEASURE = 'http://environment.data.gov.uk/flood-monitoring/id/measures/L2402-level-stage-i-15_min-m';

function eaReadings() {
  return Promise.resolve({
    status: 200,
    data: { items: [{ measure: EA_MEASURE, dateTime: '2026-09-02T19:15:00Z', value: 0.562 }] }
  });
}

describe('EnvironmentAgencyService', () => {
  it('CACHE_ENABLED=false: two calls make two requests and retain nothing', async () => {
    await withCacheEnabled('false');
    const { EnvironmentAgencyService } = await import('../../src/services/environmentAgency.js');
    mockGet.mockImplementation(eaReadings);
    const service = new EnvironmentAgencyService();

    await service.getLatestLevelReadings();
    const second = await service.getLatestLevelReadings();

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(second.readings.get(EA_MEASURE)?.value).toBe(0.562);
    expect(cacheSize(service)).toBe(0);
  });

  it('control, CACHE_ENABLED=true: the second call is served from cache', async () => {
    await withCacheEnabled('true');
    const { EnvironmentAgencyService } = await import('../../src/services/environmentAgency.js');
    mockGet.mockImplementation(eaReadings);
    const service = new EnvironmentAgencyService();

    await service.getLatestLevelReadings();
    await service.getLatestLevelReadings();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(cacheSize(service)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// JMA
// ---------------------------------------------------------------------------

const JMA_DOC = 'https://www.data.jma.go.jp/developer/xml/data/20260903042854_0_VPWW53_180000.xml';
const JMA_NOW = Date.parse('2026-09-03T05:00:00Z');

const JMA_INDEX_XML =
  '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>長期（随時）</title>' +
  '<updated>2026-09-03T13:29:22+09:00</updated>' +
  `<entry><title>気象特別警報・警報・注意報</title><id>${JMA_DOC}</id><updated>2026-09-03T04:30:00Z</updated>` +
  `<link type="application/xml" href="${JMA_DOC}"/></entry></feed>`;

const JMA_DOC_XML = `<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象特別警報・警報・注意報</Title><PublishingOffice>Test Office</PublishingOffice></Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>Test</Title><ReportDateTime>2026-09-03T13:28:00+09:00</ReportDateTime><InfoType>発表</InfoType></Head>
<Body><Warning type="気象警報・注意報（一次細分区域等）"><Item><Kind><Name>大雨注意報</Name><Code>10</Code><Status>継続</Status></Kind><Area><Name>嶺北</Name><Code>180010</Code></Area></Item></Warning></Body>
</Report>`;

function jmaTransport(indexUrl: string) {
  return (url: string) => {
    if (url === indexUrl) {
      return Promise.resolve({ status: 200, data: JMA_INDEX_XML, headers: { etag: '"jma-etag-1"' } });
    }
    if (url === JMA_DOC) return Promise.resolve({ status: 200, data: JMA_DOC_XML, headers: {} });
    return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
  };
}

describe('JmaService', () => {
  it('CACHE_ENABLED=false: index and document are both fetched twice, with no If-None-Match', async () => {
    await withCacheEnabled('false');
    const { JmaService, JMA_INDEX_URL } = await import('../../src/services/jma.js');
    mockGet.mockImplementation(jmaTransport(JMA_INDEX_URL));
    const service = new JmaService({ now: () => JMA_NOW });

    await service.getWarnings('180000');
    const second = await service.getWarnings('180000');

    expect(second.documentUrl).toBe(JMA_DOC);
    const indexCalls = calls().filter((c) => c[0] === JMA_INDEX_URL);
    expect(indexCalls).toHaveLength(2);
    expect(calls().filter((c) => c[0] === JMA_DOC)).toHaveLength(2);
    for (const [, config] of indexCalls) {
      expect(config?.headers?.['If-None-Match']).toBeUndefined();
    }
    expect(cacheSize(service)).toBe(0);
  });

  it('control, CACHE_ENABLED=true: the second call fetches nothing', async () => {
    await withCacheEnabled('true');
    const { JmaService, JMA_INDEX_URL } = await import('../../src/services/jma.js');
    mockGet.mockImplementation(jmaTransport(JMA_INDEX_URL));
    const service = new JmaService({ now: () => JMA_NOW });

    await service.getWarnings('180000');
    await service.getWarnings('180000');

    expect(mockGet).toHaveBeenCalledTimes(2); // index + document, once each
    expect(cacheSize(service)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// MET Norway
// ---------------------------------------------------------------------------

const METNO_NOW = Date.parse('2026-09-11T01:00:00Z');

function metnoBody() {
  const timeseries = [];
  for (let h = 0; h <= 72; h++) {
    timeseries.push({
      time: new Date(Date.parse('2026-09-11T00:00:00Z') + h * 3_600_000).toISOString().replace('.000Z', 'Z'),
      data: {
        instant: { details: { air_temperature: 10 + (h % 24), wind_speed: 3, wind_from_direction: 200 } },
        next_1_hours: {
          summary: { symbol_code: 'clearsky_day' },
          details: { precipitation_amount: 0, probability_of_precipitation: 5, probability_of_thunder: 0 }
        },
        next_6_hours: {
          summary: { symbol_code: 'clearsky_day' },
          details: { air_temperature_max: 14, air_temperature_min: 8, precipitation_amount: 0.2, probability_of_precipitation: 10 }
        }
      }
    });
  }
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10.7522, 59.9139] },
    properties: { meta: { updated_at: '2026-09-11T00:00:00Z' }, timeseries }
  };
}

function metnoOk() {
  return Promise.resolve({
    status: 200,
    data: metnoBody(),
    headers: { 'last-modified': 'Fri, 11 Sep 2026 00:00:00 GMT' }
  });
}

describe('MetnoService', () => {
  it('CACHE_ENABLED=false: two calls make two requests, with no If-Modified-Since', async () => {
    await withCacheEnabled('false');
    const { MetnoService } = await import('../../src/services/metno.js');
    mockGet.mockImplementation(metnoOk);
    const service = new MetnoService({ now: () => METNO_NOW });

    await service.getForecast(59.9139, 10.7522, 'Europe/Oslo');
    await service.getForecast(59.9139, 10.7522, 'Europe/Oslo');

    expect(mockGet).toHaveBeenCalledTimes(2);
    for (const [, config] of calls()) {
      expect(config?.headers?.['If-Modified-Since']).toBeUndefined();
    }
    expect(cacheSize(service)).toBe(0);
  });

  it('control, CACHE_ENABLED=true: the second call is served from cache', async () => {
    await withCacheEnabled('true');
    const { MetnoService } = await import('../../src/services/metno.js');
    mockGet.mockImplementation(metnoOk);
    const service = new MetnoService({ now: () => METNO_NOW });

    await service.getForecast(59.9139, 10.7522, 'Europe/Oslo');
    await service.getForecast(59.9139, 10.7522, 'Europe/Oslo');

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(cacheSize(service)).toBe(1);
  });
});
