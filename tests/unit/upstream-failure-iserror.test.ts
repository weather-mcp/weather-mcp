/**
 * `isError` on whole-fetch failures of get_wildfire_info and get_river_conditions
 * (upstream-failure-iserror, T3).
 *
 * The in-band `❌` block marks a failed fetch. These tests pin that the result then carries
 * `isError: true`, and that every answer — including the degraded ones that print a note —
 * carries no `isError` key at all (absent, never `false`). Fakes are local; coordinates are
 * passed so no `**Location:**` line is prepended.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import { handleGetRiverConditions } from '../../src/handlers/riverConditionsHandler.js';
import { FIRMSKeyRejectedError } from '../../src/services/firms.js';
import { MAX_RADIUS_DETECTIONS } from '../../src/utils/firmsHotspots.js';
import { logger } from '../../src/utils/logger.js';
import type { FIRMSService } from '../../src/services/firms.js';
import type { NIFCService } from '../../src/services/nifc.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { FIRMSDetection } from '../../src/types/firms.js';
import type { NIFCQueryResponse } from '../../src/types/nifc.js';
import type { NWPSGauge } from '../../src/types/noaa.js';

const NIFC_FAIL = 'zq-nifc-fail-7731';
const FIRMS_REGION_FAIL = 'zq-firms-region-fail-7731';
const FIRMS_BBOX_FAIL = 'zq-firms-bbox-fail-7731';
const FIRMS_KEYLESS_FAIL = 'zq-firms-keyless-fail-7731';
const NWPS_FAIL = 'zq-nwps-fail-7731';
const LOOKUP_FAIL = 'zq-lookup-fail-7731';

const SACRAMENTO = { latitude: 38.58, longitude: -121.49 };
const CANBERRA = { latitude: -35.28, longitude: 149.13 };
const BOSTON = { latitude: 42.3601, longitude: -71.0589 };

const HEADER = '# Wildfire Information Report\n';
const WILDFIRE_ERROR = '❌ **Error retrieving wildfire data**';
const NIFC_FOOTER = '*Data source: NIFC (National Interagency Fire Center) WFIGS*';
const FIRMS_FOOTER = '*Data source: NASA FIRMS (Fire Information for Resource Management System)*';

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Local fakes
// ---------------------------------------------------------------------------

const emptyStore = {} as unknown as LocationStore;
const emptyGeocoding = {} as unknown as GeocodingService;

function nifcFake(impl: () => Promise<NIFCQueryResponse>): NIFCService {
  return { queryFirePerimeters: vi.fn(impl) } as unknown as NIFCService;
}

function firmsFake(opts: {
  keyAvailable: boolean;
  bbox: () => Promise<FIRMSDetection[]>;
  region: () => Promise<FIRMSDetection[]>;
}): FIRMSService {
  return {
    isKeyAvailable: vi.fn(() => opts.keyAvailable),
    getDetectionsByBbox: vi.fn(opts.bbox),
    getDetectionsByRegion: vi.fn(opts.region)
  } as unknown as FIRMSService;
}

function nominatimFake(impl: () => Promise<string | null>): NominatimService {
  return { reverseCountry: vi.fn(impl) } as unknown as NominatimService;
}

function detection(overrides: Partial<FIRMSDetection> = {}): FIRMSDetection {
  return {
    latitude: CANBERRA.latitude,
    longitude: CANBERRA.longitude,
    frp: 10,
    confidence: 'nominal',
    acquiredAt: new Date().toISOString(),
    daynight: 'N',
    satellite: 'N',
    ...overrides
  };
}

const fireFeature = {
  attributes: {
    poly_IncidentName: 'Zq Fire',
    attr_InitialLatitude: SACRAMENTO.latitude + 0.05,
    attr_InitialLongitude: SACRAMENTO.longitude,
    attr_IncidentTypeCategory: 'WF',
    attr_PercentContained: 10,
    poly_GISAcres: 120
  }
} as unknown as NIFCQueryResponse['features'][number];

function wildfire(
  args: Record<string, unknown>,
  nifc: NIFCService,
  firms?: FIRMSService,
  nominatim?: NominatimService
) {
  return handleGetWildfireInfo(args, nifc, emptyStore, emptyGeocoding, firms, nominatim);
}

const neverNifc = () => nifcFake(async () => { throw new Error('NIFC must not be called'); });
const neverFirms = () => firmsFake({
  keyAvailable: false,
  bbox: async () => { throw new Error('FIRMS bbox must not be called'); },
  region: async () => { throw new Error('FIRMS region must not be called'); }
});

// River fakes
function gauge(lid: string): NWPSGauge {
  return {
    lid,
    name: `Gauge ${lid}`,
    latitude: BOSTON.latitude + 0.001,
    longitude: BOSTON.longitude,
    state: { abbreviation: 'MA', name: 'Massachusetts' },
    status: {
      observed: { primary: 4.2, secondary: 0.05, floodCategory: null, validTime: '2026-07-16T14:00:00Z' }
    }
  } as NWPSGauge;
}

function noaaFake(impl: {
  list: () => Promise<NWPSGauge[]>;
  detail: () => Promise<NWPSGauge>;
  stageflow: () => Promise<unknown>;
}): NOAAService {
  return {
    getNWPSGaugesInBoundingBox: vi.fn(impl.list),
    getNWPSGauge: vi.fn(impl.detail),
    getNWPSStageFlow: vi.fn(impl.stageflow)
  } as unknown as NOAAService;
}

function river(noaa: NOAAService) {
  return handleGetRiverConditions(
    { latitude: BOSTON.latitude, longitude: BOSTON.longitude },
    noaa,
    emptyStore,
    emptyGeocoding
  );
}

// ---------------------------------------------------------------------------
// Failures carry isError: true
// ---------------------------------------------------------------------------

describe('get_wildfire_info — whole-fetch failure sets isError', () => {
  it('contract 1: NIFC rejects → error block, footer, isError true', async () => {
    const result = await wildfire(
      { ...SACRAMENTO },
      nifcFake(async () => { throw new Error(NIFC_FAIL); }),
      neverFirms(),
      nominatimFake(async () => 'us')
    );
    const text = result.content[0].text;
    expect(text.startsWith(HEADER)).toBe(true);
    expect(text).toContain(WILDFIRE_ERROR);
    expect(text).toContain(`Error details: ${NIFC_FAIL}\n`);
    expect(text).toContain(NIFC_FOOTER);
    expect(text).toContain('https://inciweb.nwcg.gov/');
    expect(result.isError).toBe(true);
  });

  it('contract 2a: keyless FIRMS region call rejects → isError true', async () => {
    const result = await wildfire(
      { ...CANBERRA },
      neverNifc(),
      firmsFake({
        keyAvailable: false,
        bbox: async () => { throw new Error('bbox must not be called'); },
        region: async () => { throw new Error(FIRMS_REGION_FAIL); }
      }),
      nominatimFake(async () => 'au')
    );
    const text = result.content[0].text;
    expect(text.startsWith(HEADER)).toBe(true);
    expect(text).toContain(WILDFIRE_ERROR);
    expect(text).toContain(`Error details: ${FIRMS_REGION_FAIL}\n`);
    expect(text).toContain(FIRMS_FOOTER);
    expect(result.isError).toBe(true);
  });

  it('contract 2b: keyed FIRMS bbox rejects a plain Error → rethrown to outer catch, isError true', async () => {
    const result = await wildfire(
      { ...CANBERRA },
      neverNifc(),
      firmsFake({
        keyAvailable: true,
        bbox: async () => { throw new Error(FIRMS_BBOX_FAIL); },
        region: async () => { throw new Error('region must not be called'); }
      }),
      nominatimFake(async () => 'au')
    );
    const text = result.content[0].text;
    expect(text.startsWith(HEADER)).toBe(true);
    expect(text).toContain(WILDFIRE_ERROR);
    expect(text).toContain(`Error details: ${FIRMS_BBOX_FAIL}\n`);
    expect(text).toContain(FIRMS_FOOTER);
    expect(result.isError).toBe(true);
  });

  it('contract 2c: key rejected and the keyless fallback then rejects → isError true', async () => {
    const result = await wildfire(
      { ...CANBERRA },
      neverNifc(),
      firmsFake({
        keyAvailable: true,
        bbox: async () => { throw new FIRMSKeyRejectedError(); },
        region: async () => { throw new Error(FIRMS_KEYLESS_FAIL); }
      }),
      nominatimFake(async () => 'au')
    );
    const text = result.content[0].text;
    expect(text.startsWith(HEADER)).toBe(true);
    expect(text).toContain(WILDFIRE_ERROR);
    expect(text).toContain(`Error details: ${FIRMS_KEYLESS_FAIL}\n`);
    expect(text).toContain(FIRMS_FOOTER);
    expect(result.isError).toBe(true);
  });

  it('D2-b: lookup and NIFC both reject → both the note and isError true', async () => {
    const result = await wildfire(
      { ...SACRAMENTO },
      nifcFake(async () => { throw new Error(NIFC_FAIL); }),
      neverFirms(),
      nominatimFake(async () => { throw new Error(LOOKUP_FAIL); })
    );
    const text = result.content[0].text;
    expect(text).toContain(WILDFIRE_ERROR);
    expect(text).toContain(
      '*Note: the country lookup service was unavailable, so routing fell back to coordinate checks.*'
    );
    expect(result.isError).toBe(true);
  });
});

describe('get_river_conditions — whole-fetch failure sets isError', () => {
  it('contract 4: NWPS gauge list rejects → error block, footer, isError true', async () => {
    const result = await river(noaaFake({
      list: async () => { throw new Error(NWPS_FAIL); },
      detail: async () => { throw new Error('detail must not be called'); },
      stageflow: async () => { throw new Error('stageflow must not be called'); }
    }));
    const text = result.content[0].text;
    expect(text).toContain('❌ **Error retrieving river gauge data**');
    expect(text).toContain(`Error details: ${NWPS_FAIL}\n`);
    expect(text).toContain('*Data source: NOAA National Water Prediction Service (NWPS)*');
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Answers carry no isError key
// ---------------------------------------------------------------------------

describe('answers carry no isError key', () => {
  it('contract 3: key rejected, keyless succeeds → note printed, key absent', async () => {
    const result = await wildfire(
      { ...CANBERRA },
      neverNifc(),
      firmsFake({
        keyAvailable: true,
        bbox: async () => { throw new FIRMSKeyRejectedError(); },
        region: async () => [detection()]
      }),
      nominatimFake(async () => 'au')
    );
    expect(result.content[0].text).toContain(
      '*Note: FIRMS_MAP_KEY was rejected; showing keyless 24-hour data.*'
    );
    expect(result).not.toHaveProperty('isError');
  });

  it('contract 5: one gauge detail and stageflow both reject → gauge renders, key absent', async () => {
    const result = await river(noaaFake({
      list: async () => [gauge('ZQ001')],
      detail: async () => { throw new Error('zq-detail-fail-7731'); },
      stageflow: async () => { throw new Error('zq-stageflow-fail-7731'); }
    }));
    const text = result.content[0].text;
    expect(text).toContain('**River Stage:** 4.20 ft');
    expect(text).not.toContain('❌ **Error retrieving river gauge data**');
    expect(result).not.toHaveProperty('isError');
  });

  describe('contract 6: successes have exactly the content key', () => {
    it('NIFC with one fire', async () => {
      const result = await wildfire(
        { ...SACRAMENTO },
        nifcFake(async () => ({ features: [fireFeature] }) as NIFCQueryResponse),
        neverFirms(),
        nominatimFake(async () => 'us')
      );
      expect(result.content[0].text).toContain('🔥 **Found 1 active fire**');
      expect(Object.keys(result)).toEqual(['content']);
    });

    it('NIFC empty (all clear)', async () => {
      const result = await wildfire(
        { ...SACRAMENTO },
        nifcFake(async () => ({ features: [] }) as NIFCQueryResponse),
        neverFirms(),
        nominatimFake(async () => 'us')
      );
      expect(result.content[0].text).toContain('✅ **No active wildfires found within');
      expect(Object.keys(result)).toEqual(['content']);
    });

    it('FIRMS with one detection', async () => {
      const result = await wildfire(
        { ...CANBERRA },
        neverNifc(),
        firmsFake({
          keyAvailable: false,
          bbox: async () => { throw new Error('bbox must not be called'); },
          region: async () => [detection()]
        }),
        nominatimFake(async () => 'au')
      );
      expect(result.content[0].text).toContain('🔥 **1 satellite fire detection in the last 24 h');
      expect(Object.keys(result)).toEqual(['content']);
    });

    it('NWPS with one gauge', async () => {
      const result = await river(noaaFake({
        list: async () => [gauge('ZQ002')],
        detail: async () => gauge('ZQ002'),
        stageflow: async () => ({ data: [] })
      }));
      expect(result.content[0].text).toContain('**River Stage:** 4.20 ft');
      expect(Object.keys(result)).toEqual(['content']);
    });
  });

  it('D2-a: source "nifc" at a non-US point, empty → coverage disclosure, key absent', async () => {
    const result = await wildfire(
      { ...CANBERRA, source: 'nifc' },
      nifcFake(async () => ({ features: [] }) as NIFCQueryResponse),
      neverFirms(),
      nominatimFake(async () => 'au')
    );
    expect(result.content[0].text).toContain('this location appears to be outside that coverage.**');
    expect(result).not.toHaveProperty('isError');
  });

  it('D2-b: the country lookup rejects but NIFC answers → note printed, key absent', async () => {
    const result = await wildfire(
      { ...SACRAMENTO },
      nifcFake(async () => ({ features: [] }) as NIFCQueryResponse),
      neverFirms(),
      nominatimFake(async () => { throw new Error(LOOKUP_FAIL); })
    );
    expect(result.content[0].text).toContain(
      '*Note: the country lookup service was unavailable, so routing fell back to coordinate checks.*'
    );
    expect(result).not.toHaveProperty('isError');
  });

  it('D2-c: FIRMS detections capped inside the radius → caveat printed, key absent', async () => {
    const many = Array.from({ length: MAX_RADIUS_DETECTIONS + 1 }, () => detection());
    const result = await wildfire(
      { ...CANBERRA },
      neverNifc(),
      firmsFake({
        keyAvailable: false,
        bbox: async () => { throw new Error('bbox must not be called'); },
        region: async () => many
      }),
      nominatimFake(async () => 'au')
    );
    expect(result.content[0].text).toContain(
      '*Results may be incomplete — detections were capped at 5000 rows within the search radius.*'
    );
    expect(result).not.toHaveProperty('isError');
  });

  it('D2-d: NIFC exceededTransferLimit on an empty result → truncation caveat, key absent', async () => {
    const result = await wildfire(
      { ...SACRAMENTO },
      nifcFake(async () => ({ features: [], exceededTransferLimit: true }) as NIFCQueryResponse),
      neverFirms(),
      nominatimFake(async () => 'us')
    );
    expect(result.content[0].text).toContain(
      '*Results may be incomplete — the fire data service truncated the response.*'
    );
    expect(result).not.toHaveProperty('isError');
  });
});
