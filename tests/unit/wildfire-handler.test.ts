/**
 * Handler-level tests for get_wildfire_info: the detail="full" cap lift (D2) and the
 * ArcGIS exceededTransferLimit caveat (D3). Coordinates are passed directly so
 * resolveLocationAsync short-circuits on the coordinate branch and never touches
 * locationStore/geocodingService — both are inert stubs here, mirroring
 * tests/unit/riverConditions.test.ts's handleGetRiverConditions block.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import type { FirePerimeterFeature, NIFCQueryResponse } from '../../src/types/wildfire.js';

const BASE_LAT = 38.5816;
const BASE_LON = -121.4944;

const queryFirePerimetersMock = vi.fn();
const nifcService = { queryFirePerimeters: queryFirePerimetersMock } as never;
const locationStore = {} as never;
const geocodingService = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Build `n` fires with strictly increasing distance from BASE_LAT/BASE_LON (small
 * increasing latitude offsets), so sort-by-nearest ordering is deterministic: fire
 * index 0 is nearest, index n-1 is farthest.
 */
function buildFires(n: number): FirePerimeterFeature[] {
  return Array.from({ length: n }, (_, i) => ({
    attributes: {
      poly_IncidentName: `Fire ${i}`,
      attr_IncidentTypeCategory: 'WF',
      poly_GISAcres: 100 + i,
      attr_PercentContained: 25,
      attr_FireDiscoveryDateTime: Date.parse('2026-07-10T00:00:00Z'),
      attr_InitialLatitude: BASE_LAT + i * 0.001,
      attr_InitialLongitude: BASE_LON,
      attr_POOState: 'CA'
    },
    geometry: {
      rings: [[[BASE_LON, BASE_LAT + i * 0.001]]]
    }
  }));
}

function buildResponse(n: number, exceededTransferLimit = false): NIFCQueryResponse {
  return {
    features: buildFires(n),
    exceededTransferLimit
  };
}

function callHandler(args: Record<string, unknown>) {
  return handleGetWildfireInfo(
    { latitude: BASE_LAT, longitude: BASE_LON, ...args },
    nifcService,
    locationStore,
    geocodingService
  );
}

describe('handleGetWildfireInfo detail cap (D2)', () => {
  it('defaults to showing the nearest 5 of 30 fires with a detail="full" pointer', async () => {
    queryFirePerimetersMock.mockResolvedValue(buildResponse(30));

    const result = await callHandler({});
    const text = result.content[0].text;

    for (let i = 0; i < 5; i++) {
      expect(text).toContain(`Fire ${i}`);
    }
    expect(text).not.toContain('Fire 5\n');
    expect(text).toContain(
      '*Note: 25 additional fires found within radius (showing nearest 5 only — use detail="full" for more)*'
    );
  });

  it('shows the nearest 25 of 30 fires at detail="full" with an accurate, pointer-free note', async () => {
    queryFirePerimetersMock.mockResolvedValue(buildResponse(30));

    const result = await callHandler({ detail: 'full' });
    const text = result.content[0].text;

    for (let i = 0; i < 25; i++) {
      expect(text).toContain(`Fire ${i}`);
    }
    expect(text).not.toContain('Fire 25\n');
    expect(text).toContain('*Note: 5 additional fires found within radius (showing nearest 25)*');
    expect(text).not.toContain('use detail="full" for more');
  });

  it('omits the remainder note at any detail level when fire count is at or below the cap', async () => {
    queryFirePerimetersMock.mockResolvedValue(buildResponse(5));

    const summaryResult = await callHandler({ detail: 'summary' });
    const fullResult = await callHandler({ detail: 'full' });

    expect(summaryResult.content[0].text).not.toContain('additional fire');
    expect(fullResult.content[0].text).not.toContain('additional fire');
  });

  it('rejects an invalid detail value', async () => {
    queryFirePerimetersMock.mockResolvedValue(buildResponse(1));

    await expect(callHandler({ detail: 'bogus' })).rejects.toThrow(
      'Invalid detail: "bogus". Must be one of "summary", "standard", or "full".'
    );
  });
});

describe('handleGetWildfireInfo exceededTransferLimit caveat (D3)', () => {
  const CAVEAT = '*Results may be incomplete — the fire data service truncated the response.*';

  it.each(['summary', 'standard', 'full'] as const)(
    'renders the caveat at detail="%s" when the upstream response was truncated',
    async (detail) => {
      queryFirePerimetersMock.mockResolvedValue(buildResponse(3, true));

      const result = await callHandler({ detail });

      expect(result.content[0].text).toContain(CAVEAT);
    }
  );

  it('omits the caveat when exceededTransferLimit is false', async () => {
    queryFirePerimetersMock.mockResolvedValue(buildResponse(3, false));

    const result = await callHandler({});

    expect(result.content[0].text).not.toContain(CAVEAT);
  });

  it('omits the caveat when exceededTransferLimit is absent', async () => {
    const response: NIFCQueryResponse = { features: buildFires(3) };
    queryFirePerimetersMock.mockResolvedValue(response);

    const result = await callHandler({});

    expect(result.content[0].text).not.toContain(CAVEAT);
  });

  it('renders the caveat in the zero-fires branch if the flag is set with no features', async () => {
    const response: NIFCQueryResponse = { features: [], exceededTransferLimit: true };
    queryFirePerimetersMock.mockResolvedValue(response);

    const result = await callHandler({});

    expect(result.content[0].text).toContain(CAVEAT);
    expect(result.content[0].text).toContain('No active wildfires found');
  });
});
