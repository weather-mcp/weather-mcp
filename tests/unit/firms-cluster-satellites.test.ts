/**
 * Handler-level check that a cluster seen by two satellites names both,
 * through handleGetWildfireInfo (G45), not by handing a cluster to the formatter.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import type { FIRMSService } from '../../src/services/firms.js';
import type { NIFCService } from '../../src/services/nifc.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { FIRMSDetection } from '../../src/types/firms.js';

const POINT = { latitude: 38.72, longitude: -9.14 };

function detection(satellite: string): FIRMSDetection {
  return {
    latitude: POINT.latitude,
    longitude: POINT.longitude,
    frp: 10,
    confidence: 'nominal',
    acquiredAt: new Date().toISOString(),
    daynight: 'D',
    satellite
  };
}

describe('get_wildfire_info — satellites per cluster', () => {
  it('names every satellite that saw the cluster, never a raw code', async () => {
    // Each product answers with its own satellite's row.
    const n20 = [detection('N20')];
    const n21 = [detection('N21')];
    const firms = {
      isKeyAvailable: vi.fn(() => false),
      getDetectionsByBbox: vi.fn(async () => []),
      getDetectionsByRegion: vi.fn(async (_r: string, product: { id: string }) => ({
        detections: product.id === 'VIIRS_NOAA20_NRT' ? n20 : n21,
        lastModified: undefined
      })),
      getProductAvailability: vi.fn(async () => undefined)
    } as unknown as FIRMSService;

    const result = await handleGetWildfireInfo(
      { ...POINT, source: 'firms' },
      { queryFirePerimeters: vi.fn() } as unknown as NIFCService,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService,
      firms
    );

    const text = result.content[0].text;
    expect(text).toContain('**Satellite:** NOAA-20 (VIIRS), NOAA-21 (VIIRS)');
    expect(text).not.toContain('N20');
  });
});
