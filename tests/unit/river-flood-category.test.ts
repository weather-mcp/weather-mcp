import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetRiverConditions } from '../../src/handlers/riverConditionsHandler.js';
import { logger } from '../../src/utils/logger.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { FloodCategories, GaugeStatus, NWPSGauge } from '../../src/types/noaa.js';

/**
 * RF-27 D3: a flood category NOAA did not publish renders a neutral marker and
 * "no category published" — never ✅ and never NO FLOODING — on the observed and the
 * forecast line; and the no-thresholds line has a second form for a gauge that has
 * no published category to cite. Everything else renders exactly as before.
 *
 * All through handleGetRiverConditions (G45), with the service stubbed at method level.
 */

const BOSTON = { latitude: 42.3601, longitude: -71.0589 };
const OBSERVED_TIME = '2026-11-10T11:00:00Z';
const FORECAST_TIME = '2026-11-11T12:00:00Z';

const ABSENT = Symbol('absent');
type Category = string | null | typeof ABSENT;

/** A status block in the live list shape; ABSENT omits the floodCategory key. */
function statusBlock(category: Category, validTime: string, primary = 4.2): GaugeStatus {
  const block: GaugeStatus = { primary, secondary: 0.05, validTime, primaryUnit: 'ft', secondaryUnit: 'kcfs' };
  if (category !== ABSENT) block.floodCategory = category;
  return block;
}

const NO_THRESHOLDS: FloodCategories = {
  action: { stage: -9999 },
  minor: { stage: -9999 },
  moderate: { stage: -9999 },
  major: { stage: -9999 }
};

const PUBLISHED_THRESHOLDS: FloodCategories = {
  action: { stage: 8 },
  minor: { stage: 10 },
  moderate: { stage: 12 },
  major: { stage: 14 }
};

interface GaugeSpec {
  lid: string;
  /** Observed category; `undefined` here means no usable observed block at all. */
  observed: Category | undefined;
  /** Forecast category; `undefined` means no forecast block. */
  forecast: Category | undefined;
  /** Thresholds the detail endpoint returns; `undefined` means no detail `flood`. */
  flood: FloodCategories | undefined;
  offset?: number;
  /** The detail endpoint's live inService object, when the test needs one. */
  detailInService?: { enabled?: boolean; message?: string };
}

function buildGauge(spec: GaugeSpec): NWPSGauge {
  const offset = spec.offset ?? 0.01;
  return {
    lid: spec.lid,
    name: `Gauge ${spec.lid}`,
    latitude: BOSTON.latitude + offset,
    longitude: BOSTON.longitude,
    state: { abbreviation: 'MA', name: 'Massachusetts' },
    status: {
      observed:
        spec.observed === undefined
          ? statusBlock('obs_not_current', '0001-01-01T00:00:00Z', -999)
          : statusBlock(spec.observed, OBSERVED_TIME),
      ...(spec.forecast === undefined ? {} : { forecast: statusBlock(spec.forecast, FORECAST_TIME, 5.1) })
    }
  };
}

function noaaFor(specs: GaugeSpec[], forecastSeriesStage?: number): NOAAService {
  const gauges = specs.map(buildGauge);
  const specByLid = new Map(specs.map(s => [s.lid, s]));
  return {
    getNWPSGaugesInBoundingBox: vi.fn(async () => gauges),
    getNWPSGauge: vi.fn(async (lid: string) => {
      const spec = specByLid.get(lid);
      const categories = spec?.flood;
      return {
        lid,
        ...(categories ? { flood: { stageUnits: 'ft', categories } } : {}),
        ...(spec?.detailInService ? { inService: spec.detailInService } : {})
      };
    }),
    getNWPSStageFlow: vi.fn(async () => ({
      observed: { data: [] },
      forecast: {
        data: forecastSeriesStage === undefined ? [] : [{ validTime: FORECAST_TIME, primary: forecastSeriesStage, secondary: null }]
      }
    }))
  } as unknown as NOAAService;
}

async function render(specs: GaugeSpec[], detail: 'standard' | 'full' = 'standard', forecastSeriesStage?: number): Promise<string> {
  const result = await handleGetRiverConditions(
    { latitude: BOSTON.latitude, longitude: BOSTON.longitude, detail },
    noaaFor(specs, forecastSeriesStage),
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService
  );
  expect(result.isError).toBeUndefined();
  return result.content[0].text;
}

/** The text of one gauge's block, from its heading to its closing rule (G96). */
function gaugeBlock(text: string, lid: string): string {
  const start = text.indexOf(`## Gauge ${lid}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('---\n\n', start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

/** Every line of a block that starts with the given label. */
function linesStarting(block: string, label: string): string[] {
  return block.split('\n').filter(l => l.startsWith(label));
}

const FORM_1 =
  "*NOAA publishes no flood-stage thresholds for this gauge. That is an absence of published thresholds, " +
  "not an absence of flood risk — the **Flood Category:** line above comes from NOAA's own status.*";
const FORM_2 =
  '*NOAA publishes no flood-stage thresholds for this gauge. It publishes no flood category for it either. ' +
  'Neither absence is an all-clear: nothing here says whether this river is in flood.*';

const UNPUBLISHED: Array<[string, Category]> = [
  ['not_defined', 'not_defined'],
  ['null', null],
  ['an absent key', ABSENT],
  ["''", '']
];

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
});

describe('an unpublished observed category renders neutral', () => {
  for (const [label, category] of UNPUBLISHED) {
    it(`observed ${label} → ⚪ no category published, never ✅ or NO FLOODING`, async () => {
      const text = await render([{ lid: 'UNP01', observed: category, forecast: undefined, flood: undefined }]);
      const block = gaugeBlock(text, 'UNP01');
      expect(linesStarting(block, '**Flood Category:**')).toEqual(['**Flood Category:** ⚪ no category published']);
      expect(block).not.toContain('NO FLOODING');
      expect(block).not.toContain('NOT DEFINED');
    });
  }
});

describe('an unpublished forecast category renders neutral', () => {
  for (const [label, category] of UNPUBLISHED) {
    it(`forecast ${label} → ⚪ no category published, never ✅ or NO FLOODING`, async () => {
      const text = await render([{ lid: 'UNP02', observed: 'no_flooding', forecast: category, flood: undefined }]);
      const block = gaugeBlock(text, 'UNP02');
      expect(linesStarting(block, '**Forecasted Category:**')).toEqual([
        '**Forecasted Category:** ⚪ no category published'
      ]);
      expect(block).not.toContain('NOT DEFINED');
    });
  }
});

describe('published categories render exactly as before', () => {
  const CASES: Array<[string, string]> = [
    ['no_flooding', '✅ NO FLOODING'],
    ['action', '🟡 ACTION'],
    ['minor', '🟠 MINOR'],
    ['moderate', '🔴 MODERATE'],
    ['major', '🔴🔴 MAJOR'],
    ['low_threshold', '⚪ LOW THRESHOLD'],
    ['obs_not_current', '⚪ OBS NOT CURRENT'],
    ['out_of_service', '⚪ OUT OF SERVICE']
  ];
  for (const [category, rendered] of CASES) {
    it(`${category} → ${rendered} on both lines`, async () => {
      const text = await render([{ lid: 'PUB01', observed: category, forecast: category, flood: undefined }]);
      const block = gaugeBlock(text, 'PUB01');
      expect(linesStarting(block, '**Flood Category:**')).toEqual([`**Flood Category:** ${rendered}`]);
      expect(linesStarting(block, '**Forecasted Category:**')).toEqual([`**Forecasted Category:** ${rendered}`]);
    });
  }
});

describe('the no-thresholds line has two forms', () => {
  it('form 2 for no thresholds and not_defined', async () => {
    const block = gaugeBlock(await render([{ lid: 'F2A', observed: 'not_defined', forecast: undefined, flood: NO_THRESHOLDS }]), 'F2A');
    expect(block).toContain(`${FORM_2}\n`);
    expect(block).not.toContain('comes from');
  });

  it('form 2 for no thresholds and null', async () => {
    const block = gaugeBlock(await render([{ lid: 'F2B', observed: null, forecast: undefined, flood: NO_THRESHOLDS }]), 'F2B');
    expect(block).toContain(`${FORM_2}\n`);
    expect(block).not.toContain('comes from');
  });

  it('form 2 for no thresholds and no usable observed block', async () => {
    const block = gaugeBlock(await render([{ lid: 'F2C', observed: undefined, forecast: undefined, flood: NO_THRESHOLDS }]), 'F2C');
    expect(block).toContain('*No current observations available*');
    expect(block).not.toContain('**Flood Category:**');
    expect(block).toContain(`${FORM_2}\n`);
    expect(block).not.toContain('comes from');
  });

  it('form 1, unchanged, for no thresholds and no_flooding', async () => {
    const block = gaugeBlock(await render([{ lid: 'F1A', observed: 'no_flooding', forecast: undefined, flood: NO_THRESHOLDS }]), 'F1A');
    expect(block).toContain(`${FORM_1}\n`);
    expect(block).not.toContain('It publishes no flood category');
  });

  it('form 1, unchanged, for no thresholds and minor', async () => {
    const block = gaugeBlock(await render([{ lid: 'F1B', observed: 'minor', forecast: undefined, flood: NO_THRESHOLDS }]), 'F1B');
    expect(block).toContain(`${FORM_1}\n`);
    expect(block).not.toContain('It publishes no flood category');
  });

  it('two gauges in one report each get their own form', async () => {
    const text = await render([
      { lid: 'TWO1', observed: 'no_flooding', forecast: undefined, flood: NO_THRESHOLDS, offset: 0.01 },
      { lid: 'TWO2', observed: 'not_defined', forecast: undefined, flood: NO_THRESHOLDS, offset: 0.02 }
    ]);
    const published = gaugeBlock(text, 'TWO1');
    const unpublished = gaugeBlock(text, 'TWO2');
    expect(published).toContain(FORM_1);
    expect(published).not.toContain(FORM_2);
    expect(published).toContain('**Flood Category:** ✅ NO FLOODING\n');
    expect(unpublished).toContain(FORM_2);
    expect(unpublished).not.toContain(FORM_1);
    expect(unpublished).toContain('**Flood Category:** ⚪ no category published\n');
  });
});

describe('the forecast-series clause keeps its markers', () => {
  it('a series point at the minor stage still renders 🟠 MINOR', async () => {
    const text = await render(
      [{ lid: 'SER01', observed: 'not_defined', forecast: undefined, flood: PUBLISHED_THRESHOLDS }],
      'full',
      11
    );
    const block = gaugeBlock(text, 'SER01');
    const seriesLines = block.split('\n').filter(l => l.startsWith('- **') && l.includes(' ft'));
    expect(seriesLines).toHaveLength(1);
    expect(seriesLines[0].endsWith('11.00 ft 🟠 MINOR')).toBe(true);
  });

  it('a series point below action stage carries no clause', async () => {
    const text = await render(
      [{ lid: 'SER02', observed: 'not_defined', forecast: undefined, flood: PUBLISHED_THRESHOLDS }],
      'full',
      5
    );
    const block = gaugeBlock(text, 'SER02');
    const seriesLines = block.split('\n').filter(l => l.startsWith('- **') && l.includes(' ft'));
    expect(seriesLines).toHaveLength(1);
    expect(seriesLines[0].endsWith('5.00 ft')).toBe(true);
  });
});

describe('the Status line follows the list\'s own observed category (RF-27 D4)', () => {
  it('out_of_service with a real stage → ❌ Out of Service, and the stage block still renders', async () => {
    const block = gaugeBlock(await render([{ lid: 'OOS01', observed: 'out_of_service', forecast: undefined, flood: undefined }]), 'OOS01');
    expect(linesStarting(block, '**Status:**')).toEqual(['**Status:** ❌ Out of Service']);
    expect(block).toContain('**River Stage:** 4.20 ft');
    expect(block).toContain('**Flood Category:** ⚪ OUT OF SERVICE\n');
  });

  it('out_of_service with no usable observation → ❌ Out of Service', async () => {
    const gauge = buildGauge({ lid: 'OOS02', observed: undefined, forecast: undefined, flood: undefined });
    gauge.status.observed = statusBlock('out_of_service', '0001-01-01T00:00:00Z', -999);
    const noaa = {
      getNWPSGaugesInBoundingBox: vi.fn(async () => [gauge]),
      getNWPSGauge: vi.fn(async (lid: string) => ({ lid })),
      getNWPSStageFlow: vi.fn(async () => ({ observed: { data: [] }, forecast: { data: [] } }))
    } as unknown as NOAAService;
    const result = await handleGetRiverConditions(
      { latitude: BOSTON.latitude, longitude: BOSTON.longitude },
      noaa,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService
    );
    const block = gaugeBlock(result.content[0].text, 'OOS02');
    expect(block).toContain('*No current observations available*');
    expect(linesStarting(block, '**Status:**')).toEqual(['**Status:** ❌ Out of Service']);
  });

  for (const category of ['no_flooding', 'not_defined', null, 'obs_not_current', 'low_threshold'] as const) {
    it(`${String(category)} → ✅ Active, unchanged`, async () => {
      const block = gaugeBlock(await render([{ lid: 'ACT01', observed: category, forecast: undefined, flood: undefined }]), 'ACT01');
      expect(linesStarting(block, '**Status:**')).toEqual(['**Status:** ✅ Active']);
    });
  }

  it('a detail response saying out of service does not override the list (D4 rejected alternative)', async () => {
    const block = gaugeBlock(
      await render([
        {
          lid: 'DET01',
          observed: 'no_flooding',
          forecast: undefined,
          flood: NO_THRESHOLDS,
          detailInService: { enabled: false, message: 'Gage is currently out of service.' }
        }
      ]),
      'DET01'
    );
    expect(linesStarting(block, '**Status:**')).toEqual(['**Status:** ✅ Active']);
  });

  it('a forecast of out_of_service does not mark an observed no_flooding gauge out of service', async () => {
    const block = gaugeBlock(await render([{ lid: 'FCO01', observed: 'no_flooding', forecast: 'out_of_service', flood: undefined }]), 'FCO01');
    expect(linesStarting(block, '**Status:**')).toEqual(['**Status:** ✅ Active']);
  });

  it('two gauges in one report each get their own Status', async () => {
    const text = await render([
      { lid: 'TWS1', observed: 'out_of_service', forecast: undefined, flood: undefined, offset: 0.01 },
      { lid: 'TWS2', observed: 'no_flooding', forecast: undefined, flood: undefined, offset: 0.02 }
    ]);
    expect(linesStarting(gaugeBlock(text, 'TWS1'), '**Status:**')).toEqual(['**Status:** ❌ Out of Service']);
    expect(linesStarting(gaugeBlock(text, 'TWS2'), '**Status:**')).toEqual(['**Status:** ✅ Active']);
  });
});
