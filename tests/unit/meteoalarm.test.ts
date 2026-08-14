import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the axios instance used by MeteoAlarmService so no real network calls
// are made (reverse-country/metar-service mocking template: `get` routes a
// rejection through the service's registered error interceptor, as real
// axios does internally).
const { mockGet, mockUse } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUse: vi.fn()
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => {
      let errorInterceptor: ((error: unknown) => Promise<never>) | undefined;
      return {
        get: (...args: unknown[]) =>
          mockGet(...args).catch((error: unknown) => {
            if (errorInterceptor) {
              return errorInterceptor(error);
            }
            throw error;
          }),
        interceptors: {
          response: {
            use: (onFulfilled: unknown, onRejected: (error: unknown) => Promise<never>) => {
              errorInterceptor = onRejected;
              mockUse(onFulfilled, onRejected);
            }
          }
        }
      };
    })
  }
}));

import {
  MeteoAlarmService,
  COUNTRY_FEEDS,
  isMeteoAlarmCountry,
  selectEnglishInfo,
  parseAwarenessColour,
  parseReferences,
  filterActiveWarnings
} from '../../src/services/meteoalarm.js';
import type {
  MeteoAlarmCapAlert,
  MeteoAlarmCapInfo,
  MeteoAlarmWarning
} from '../../src/types/meteoalarm.js';

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({ data, status });
}

/** Far-future / long-past instants so fixtures never age out mid-run. */
const FUTURE = '2099-01-01T00:00:00+00:00';
const PAST = '2020-01-01T00:00:00+00:00';

/**
 * Trimmed from the live UK/Germany captures (2026-08-13): the load-bearing
 * CAP shapes with polygons dropped and long prose shortened.
 */
function makeInfo(overrides: Partial<MeteoAlarmCapInfo> = {}): MeteoAlarmCapInfo {
  return {
    language: 'en',
    category: ['Met'],
    event: 'Yellow thunderstorm warning',
    severity: 'Moderate',
    urgency: 'Immediate',
    certainty: 'Possible',
    onset: '2026-08-13T10:00:00+00:00',
    expires: FUTURE,
    headline: 'Showers and thunderstorms bringing some disruption',
    description: 'Scattered heavy showers and thunderstorms.',
    instruction: 'Consider if your location is at risk of flash flooding.',
    senderName: 'UK Met Office',
    web: 'https://www.metoffice.gov.uk/',
    responseType: ['Prepare'],
    area: [{ areaDesc: 'Northern Ireland' }],
    parameter: [
      { valueName: 'awareness_level', value: '2; yellow; Moderate' },
      { valueName: 'awareness_type', value: '3; Thunderstorm' }
    ],
    ...overrides
  };
}

function makeAlert(overrides: Partial<MeteoAlarmCapAlert> = {}): MeteoAlarmCapAlert {
  return {
    identifier: 'TEST-ID-1',
    sender: 'https://www.metoffice.gov.uk/',
    sent: '2026-08-13T09:20:02+00:00',
    status: 'Actual',
    msgType: 'Alert',
    scope: 'Public',
    info: [makeInfo()],
    ...overrides
  };
}

function feedOf(...alerts: MeteoAlarmCapAlert[]) {
  return { warnings: alerts.map((alert, index) => ({ alert, uuid: `uuid-${index}` })) };
}

describe('MeteoAlarm pure helpers', () => {
  describe('selectEnglishInfo', () => {
    it('selects the en-prefixed entry from a multi-language info list (live German order)', () => {
      const info = [
        makeInfo({ language: 'de-DE', event: 'starke Hitze' }),
        makeInfo({ language: 'en', event: 'strong heat' }),
        makeInfo({ language: 'fr', event: 'forte chaleur' })
      ];
      expect(selectEnglishInfo(info)?.event).toBe('strong heat');
    });

    it('matches regional English variants like en-GB', () => {
      const info = [
        makeInfo({ language: 'de-DE', event: 'starke Hitze' }),
        makeInfo({ language: 'en-GB', event: 'Amber extreme_heat warning' })
      ];
      expect(selectEnglishInfo(info)?.event).toBe('Amber extreme_heat warning');
    });

    it('falls back to the first entry when no English variant exists', () => {
      const info = [
        makeInfo({ language: 'de-DE', event: 'starke Hitze' }),
        makeInfo({ language: 'pl', event: 'silny upał' })
      ];
      expect(selectEnglishInfo(info)?.event).toBe('starke Hitze');
    });

    it('returns undefined for an empty or missing list', () => {
      expect(selectEnglishInfo([])).toBeUndefined();
      expect(selectEnglishInfo(undefined)).toBeUndefined();
    });
  });

  describe('parseAwarenessColour', () => {
    it('parses the live "2; yellow; Moderate" form', () => {
      expect(parseAwarenessColour('2; yellow; Moderate')).toBe('yellow');
    });

    it('normalizes capitalized colours (live UK: "3; Orange; Severe")', () => {
      expect(parseAwarenessColour('3; Orange; Severe')).toBe('orange');
    });

    it('returns undefined for malformed values, never throwing', () => {
      expect(parseAwarenessColour(undefined)).toBeUndefined();
      expect(parseAwarenessColour('')).toBeUndefined();
      expect(parseAwarenessColour('nonsense')).toBeUndefined();
      expect(parseAwarenessColour('2;')).toBeUndefined();
      expect(parseAwarenessColour('2; 37; Moderate')).toBeUndefined();
    });
  });

  describe('parseReferences', () => {
    it('extracts identifiers from CAP sender,identifier,sent triples', () => {
      const refs = parseReferences(
        'opendata@dwd.de,2.49.0.0.276.0.DWD.ABC,2026-08-09T14:05:00+02:00'
      );
      expect(refs).toEqual(['2.49.0.0.276.0.DWD.ABC']);
    });

    it('handles multiple space-separated triples', () => {
      const refs = parseReferences('s1,id-1,2026-01-01 s2,id-2,2026-01-02');
      expect(refs).toEqual(['id-1', 'id-2']);
    });

    it('treats a comma-less entry as a bare identifier', () => {
      expect(parseReferences('bare-id')).toEqual(['bare-id']);
    });

    it('returns [] for missing references', () => {
      expect(parseReferences(undefined)).toEqual([]);
      expect(parseReferences('')).toEqual([]);
    });
  });

  describe('COUNTRY_FEEDS / isMeteoAlarmCountry', () => {
    it('carries the three live-verified anchors', () => {
      expect(COUNTRY_FEEDS['de'].slug).toBe('germany');
      expect(COUNTRY_FEEDS['fr'].slug).toBe('france');
      expect(COUNTRY_FEEDS['gb'].slug).toBe('united-kingdom');
    });

    it('answers membership by lowercase ISO code', () => {
      expect(isMeteoAlarmCountry('de')).toBe(true);
      expect(isMeteoAlarmCountry('us')).toBe(false);
      expect(isMeteoAlarmCountry('au')).toBe(false);
    });
  });
});

describe('filterActiveWarnings', () => {
  function warning(overrides: Partial<MeteoAlarmWarning> = {}): MeteoAlarmWarning {
    return {
      identifier: 'W1',
      status: 'Actual',
      msgType: 'Alert',
      references: [],
      severity: 'Moderate',
      expires: FUTURE,
      areaDesc: [],
      ...overrides
    };
  }

  const NOW = new Date('2026-08-13T12:00:00+00:00');

  it('drops expired warnings (the Germany 161→51 behaviour in miniature)', () => {
    const list = [
      warning({ identifier: 'live-1' }),
      warning({ identifier: 'expired-1', expires: PAST }),
      warning({ identifier: 'expired-2', expires: '2026-08-13T11:59:59+00:00' }),
      warning({ identifier: 'live-2', expires: '2026-08-13T12:00:01+00:00' })
    ];
    const result = filterActiveWarnings(list, NOW);
    expect(result.map(w => w.identifier)).toEqual(['live-1', 'live-2']);
  });

  it('drops non-Actual status and Cancel messages', () => {
    const list = [
      warning({ identifier: 'actual' }),
      warning({ identifier: 'test', status: 'Test' }),
      warning({ identifier: 'cancel', msgType: 'Cancel' })
    ];
    expect(filterActiveWarnings(list, NOW).map(w => w.identifier)).toEqual(['actual']);
  });

  it('keeps warnings with no expires or an unparseable expires', () => {
    const list = [
      warning({ identifier: 'no-expiry', expires: undefined }),
      warning({ identifier: 'bad-expiry', expires: 'not-a-date' })
    ];
    expect(filterActiveWarnings(list, NOW)).toHaveLength(2);
  });

  it('drops a warning referenced by a surviving Update (supersession)', () => {
    const list = [
      warning({ identifier: 'original' }),
      warning({ identifier: 'update', msgType: 'Update', references: ['original'] })
    ];
    expect(filterActiveWarnings(list, NOW).map(w => w.identifier)).toEqual(['update']);
  });

  it('references held by an expired Update are inert (expiry runs first)', () => {
    const list = [
      warning({ identifier: 'original' }),
      warning({
        identifier: 'stale-update',
        msgType: 'Update',
        references: ['original'],
        expires: PAST
      })
    ];
    expect(filterActiveWarnings(list, NOW).map(w => w.identifier)).toEqual(['original']);
  });

  it('references to already-expired identifiers change nothing', () => {
    const list = [
      warning({ identifier: 'gone', expires: PAST }),
      warning({ identifier: 'update', msgType: 'Update', references: ['gone'] })
    ];
    expect(filterActiveWarnings(list, NOW).map(w => w.identifier)).toEqual(['update']);
  });
});

describe('MeteoAlarmService.getWarnings', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUse.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches the country slug feed and normalizes to flat warnings', async () => {
    mockGet.mockImplementation(() => jsonResponse(feedOf(makeAlert())));
    const service = new MeteoAlarmService();

    const result = await service.getWarnings('gb');

    expect(mockGet).toHaveBeenCalledWith('/feeds-united-kingdom');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      identifier: 'TEST-ID-1',
      event: 'Yellow thunderstorm warning',
      severity: 'Moderate',
      colour: 'yellow',
      urgency: 'Immediate',
      certainty: 'Possible',
      headline: 'Showers and thunderstorms bringing some disruption',
      senderName: 'UK Met Office',
      areaDesc: ['Northern Ireland'],
      sent: '2026-08-13T09:20:02+00:00'
    });
  });

  it('selects the English info variant from a multi-language warning', async () => {
    const alert = makeAlert({
      info: [
        makeInfo({ language: 'de-DE', event: 'starke Hitze' }),
        makeInfo({ language: 'en', event: 'strong heat' })
      ]
    });
    mockGet.mockImplementation(() => jsonResponse(feedOf(alert)));
    const service = new MeteoAlarmService();

    const result = await service.getWarnings('de');

    expect(result[0].event).toBe('strong heat');
  });

  it('renders a warning with no English variant via its first info entry', async () => {
    const alert = makeAlert({
      info: [makeInfo({ language: 'pl', event: 'silny upał' })]
    });
    mockGet.mockImplementation(() => jsonResponse(feedOf(alert)));
    const service = new MeteoAlarmService();

    const result = await service.getWarnings('pl');

    expect(result[0].event).toBe('silny upał');
  });

  it('filters expired warnings out of a fresh fetch', async () => {
    mockGet.mockImplementation(() =>
      jsonResponse(
        feedOf(
          makeAlert({ identifier: 'live' }),
          makeAlert({ identifier: 'dead', info: [makeInfo({ expires: PAST })] })
        )
      )
    );
    const service = new MeteoAlarmService();

    const result = await service.getWarnings('de');

    expect(result.map(w => w.identifier)).toEqual(['live']);
  });

  it('applies supersession across a fetched feed (Update chain)', async () => {
    mockGet.mockImplementation(() =>
      jsonResponse(
        feedOf(
          makeAlert({ identifier: 'v1' }),
          makeAlert({
            identifier: 'v2',
            msgType: 'Update',
            references: 'sender,v1,2026-08-11T09:32:25+00:00'
          })
        )
      )
    );
    const service = new MeteoAlarmService();

    const result = await service.getWarnings('gb');

    expect(result.map(w => w.identifier)).toEqual(['v2']);
  });

  it('returns [] for an empty feed', async () => {
    mockGet.mockImplementation(() => jsonResponse({ warnings: [] }));
    const service = new MeteoAlarmService();

    expect(await service.getWarnings('fr')).toEqual([]);
  });

  it('throws a clear error for a country with no feed', async () => {
    const service = new MeteoAlarmService();

    await expect(service.getWarnings('au')).rejects.toThrow(
      'No MeteoAlarm feed for country code "au"'
    );
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('serves the second call within the TTL from cache — one HTTP request', async () => {
    mockGet.mockImplementation(() => jsonResponse(feedOf(makeAlert())));
    const service = new MeteoAlarmService();

    const first = await service.getWarnings('gb');
    const second = await service.getWarnings('gb');

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('a fresh read of a stale cache entry still drops newly-expired warnings', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T12:00:00+00:00'));

    mockGet.mockImplementation(() =>
      jsonResponse(
        feedOf(
          makeAlert({ identifier: 'long-lived' }),
          makeAlert({
            identifier: 'expires-soon',
            info: [makeInfo({ expires: '2026-08-13T12:02:00+00:00' })]
          })
        )
      )
    );
    const service = new MeteoAlarmService();

    const first = await service.getWarnings('de');
    expect(first.map(w => w.identifier)).toEqual(['long-lived', 'expires-soon']);

    // 4 minutes later: inside the 5-minute cache TTL, past the warning's expiry.
    vi.setSystemTime(new Date('2026-08-13T12:04:00+00:00'));
    const second = await service.getWarnings('de');

    expect(mockGet).toHaveBeenCalledTimes(1); // cache hit — no refetch
    expect(second.map(w => w.identifier)).toEqual(['long-lived']);
  });

  it('sanitizes upstream HTTP failures into plain errors', async () => {
    mockGet.mockImplementation(() =>
      Promise.reject({ response: { status: 404 } })
    );
    const service = new MeteoAlarmService();

    await expect(service.getWarnings('de')).rejects.toThrow(
      'MeteoAlarm API returned status 404'
    );
  });
});
