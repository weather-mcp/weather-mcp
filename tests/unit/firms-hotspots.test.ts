/**
 * Tests for NASA FIRMS hotspot parsing, region selection, radius filtering,
 * and clustering (src/utils/firmsHotspots.ts).
 *
 * Pure, deterministic, no I/O and no mocks. CSV fixtures are small inline
 * excerpts that preserve the shape of both live-captured header variants
 * (see docs/plans/global-wildfire-plan.md "Live re-verification notes") — never
 * multi-MB payloads.
 */

import { describe, it, expect } from 'vitest';
import {
  parseFIRMSCsv,
  pickRegionFile,
  filterByRadius,
  clusterDetections,
  MAX_RADIUS_DETECTIONS
} from '../../src/utils/firmsHotspots.js';
import type { FIRMSDetection } from '../../src/types/firms.js';

/** Area API shape: 14 columns, `instrument` present, abbreviated confidence, unpadded acq_time. */
const AREA_API_CSV =
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n' +
  '40.1,-3.5,335.2,0.38,0.36,2026-08-13,215,N,VIIRS,n,2.0NRT,297.6,15.3,D\n' +
  '40.2,-3.6,310.0,0.39,0.37,2026-08-13,215,N,VIIRS,h,2.0NRT,290.1,42.7,D\n';

/** Flat-file shape: 13 columns, no `instrument`, spelled-out confidence, zero-padded acq_time. */
const FLAT_FILE_CSV =
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n' +
  '40.1,-3.5,335.2,0.38,0.36,2026-08-13,0048,N,nominal,2.0NRT,297.6,15.3,N\n' +
  '40.2,-3.6,310.0,0.39,0.37,2026-08-13,0048,N,low,2.0NRT,290.1,8.4,N\n';

describe('parseFIRMSCsv', () => {
  describe('Area API shape (14 columns, with instrument)', () => {
    it('should parse every column by header name, including instrument', () => {
      const rows = parseFIRMSCsv(AREA_API_CSV);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        latitude: 40.1,
        longitude: -3.5,
        frp: 15.3,
        satellite: 'N',
        instrument: 'VIIRS',
        daynight: 'D'
      });
    });

    it('should normalize abbreviated confidence values', () => {
      const rows = parseFIRMSCsv(AREA_API_CSV);

      expect(rows[0].confidence).toBe('nominal'); // 'n'
      expect(rows[1].confidence).toBe('high'); // 'h'
    });

    it('should assemble an unpadded acq_time into the correct UTC timestamp', () => {
      const rows = parseFIRMSCsv(AREA_API_CSV);

      // "215" -> padded "0215" -> 02:15 UTC
      expect(rows[0].acquiredAt).toBe('2026-08-13T02:15:00.000Z');
    });
  });

  describe('flat-file shape (13 columns, no instrument)', () => {
    it('should parse every column by header name and omit instrument', () => {
      const rows = parseFIRMSCsv(FLAT_FILE_CSV);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        latitude: 40.1,
        longitude: -3.5,
        frp: 15.3,
        satellite: 'N',
        daynight: 'N'
      });
      expect(rows[0].instrument).toBeUndefined();
    });

    it('should pass spelled-out confidence values through unchanged', () => {
      const rows = parseFIRMSCsv(FLAT_FILE_CSV);

      expect(rows[0].confidence).toBe('nominal');
      expect(rows[1].confidence).toBe('low');
    });

    it('should assemble a zero-padded acq_time into the correct UTC timestamp', () => {
      const rows = parseFIRMSCsv(FLAT_FILE_CSV);

      // "0048" -> 00:48 UTC
      expect(rows[0].acquiredAt).toBe('2026-08-13T00:48:00.000Z');
    });
  });

  describe('confidence normalization', () => {
    it('should normalize an unrecognized confidence value to unknown', () => {
      const csv =
        'latitude,longitude,acq_date,acq_time,satellite,confidence,frp,daynight\n' +
        '10,20,2026-08-13,1200,N,garbled,5,D\n';

      expect(parseFIRMSCsv(csv)[0].confidence).toBe('unknown');
    });

    it('should normalize a missing confidence column to unknown', () => {
      const csv =
        'latitude,longitude,acq_date,acq_time,satellite,frp,daynight\n' +
        '10,20,2026-08-13,1200,N,5,D\n';

      expect(parseFIRMSCsv(csv)[0].confidence).toBe('unknown');
    });
  });

  describe('defensive frp parsing', () => {
    it('should keep the row with frp: 0 when frp is non-numeric', () => {
      const csv =
        'latitude,longitude,acq_date,acq_time,satellite,confidence,frp,daynight\n' +
        '10,20,2026-08-13,1200,N,nominal,not-a-number,D\n';

      const rows = parseFIRMSCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].frp).toBe(0);
    });

    it('should keep the row with frp: 0 when the frp column is absent', () => {
      const csv =
        'latitude,longitude,acq_date,acq_time,satellite,confidence,daynight\n' +
        '10,20,2026-08-13,1200,N,nominal,D\n';

      const rows = parseFIRMSCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].frp).toBe(0);
    });
  });

  describe('row dropping', () => {
    it('should drop a row with a missing latitude', () => {
      const csv =
        'latitude,longitude,acq_date,acq_time,satellite,confidence,frp,daynight\n' +
        ',20,2026-08-13,1200,N,nominal,5,D\n' +
        '10,20,2026-08-13,1200,N,nominal,5,D\n';

      expect(parseFIRMSCsv(csv)).toHaveLength(1);
    });

    it('should drop a row with a non-numeric longitude', () => {
      const csv =
        'latitude,longitude,acq_date,acq_time,satellite,confidence,frp,daynight\n' +
        '10,not-a-number,2026-08-13,1200,N,nominal,5,D\n';

      expect(parseFIRMSCsv(csv)).toHaveLength(0);
    });

    it('should drop a row with an unparseable acquisition timestamp', () => {
      const csv =
        'latitude,longitude,acq_date,acq_time,satellite,confidence,frp,daynight\n' +
        '10,20,not-a-date,1200,N,nominal,5,D\n';

      expect(parseFIRMSCsv(csv)).toHaveLength(0);
    });
  });

  describe('malformed input tolerance', () => {
    it('should tolerate CRLF line endings', () => {
      const csv = AREA_API_CSV.replace(/\n/g, '\r\n');
      expect(parseFIRMSCsv(csv)).toHaveLength(2);
    });

    it('should tolerate trailing blank lines', () => {
      const csv = FLAT_FILE_CSV + '\n\n\n';
      expect(parseFIRMSCsv(csv)).toHaveLength(2);
    });

    it('should return an empty array for a header-only payload', () => {
      const csv = 'latitude,longitude,acq_date,acq_time,satellite,confidence,frp,daynight\n';
      expect(parseFIRMSCsv(csv)).toEqual([]);
    });

    it('should return an empty array for empty input', () => {
      expect(parseFIRMSCsv('')).toEqual([]);
    });
  });
});

describe('pickRegionFile', () => {
  it('should route a central-Europe point to Europe', () => {
    // Berlin
    expect(pickRegionFile(52.5, 13.4)).toBe('Europe');
  });

  it('should route a CONUS point to USA_contiguous_and_Hawaii', () => {
    // Denver
    expect(pickRegionFile(39.7, -104.9)).toBe('USA_contiguous_and_Hawaii');
  });

  it('should route a Hawaii point to USA_contiguous_and_Hawaii via its second box', () => {
    // Honolulu
    expect(pickRegionFile(21.3, -157.8)).toBe('USA_contiguous_and_Hawaii');
  });

  it('should route a Middle East gap point to Global by design', () => {
    // Riyadh — sits between the Europe, Africa, and Russia_Asia insets
    expect(pickRegionFile(24.7, 46.7)).toBe('Global');
  });

  it('should route a mid-ocean point to Global', () => {
    // South Pacific, far from any coastline
    expect(pickRegionFile(0, -140)).toBe('Global');
  });

  it('should route a clearly-Canadian point to Canada', () => {
    // Edmonton — well north of the 50°N conservative bound
    expect(pickRegionFile(53.5, -113.5)).toBe('Canada');
  });

  it('should route US–Canada border-band cities to Global, never a cross-border cut', () => {
    // The border band belongs to no inset: a wrong regional file would
    // silently miss detections (regional cuts stop at the border), so
    // ambiguous points pay the Global-file bandwidth cost instead.
    expect(pickRegionFile(43.65, -79.38)).toBe('Global'); // Toronto
    expect(pickRegionFile(49.28, -123.12)).toBe('Global'); // Vancouver
    expect(pickRegionFile(47.61, -122.33)).toBe('Global'); // Seattle
    expect(pickRegionFile(42.36, -71.06)).toBe('Global'); // Boston
  });
});

describe('filterByRadius', () => {
  const ORIGIN_LAT = 0;
  const ORIGIN_LON = 0;
  const KM_PER_DEGREE_LAT = (6371 * Math.PI) / 180;

  function detectionAt(kmNorth: number, frp = 10): FIRMSDetection {
    return {
      latitude: ORIGIN_LAT + kmNorth / KM_PER_DEGREE_LAT,
      longitude: ORIGIN_LON,
      frp,
      confidence: 'nominal',
      acquiredAt: '2026-08-14T00:00:00.000Z',
      daynight: 'D',
      satellite: 'N'
    };
  }

  it('should keep only detections within the radius', () => {
    const detections = [detectionAt(10), detectionAt(200)];
    const result = filterByRadius(detections, ORIGIN_LAT, ORIGIN_LON, 100);

    expect(result.detections).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it('should cap results at MAX_RADIUS_DETECTIONS and flag truncation', () => {
    const detections: FIRMSDetection[] = [];
    for (let i = 0; i < MAX_RADIUS_DETECTIONS + 500; i++) {
      // Spread over 0-49.9 km, all comfortably inside a 100 km radius.
      detections.push(detectionAt(i / 100));
    }

    const result = filterByRadius(detections, ORIGIN_LAT, ORIGIN_LON, 100);

    expect(result.detections).toHaveLength(MAX_RADIUS_DETECTIONS);
    expect(result.truncated).toBe(true);
  });

  it('should not flag truncation when the count is exactly at the cap', () => {
    const detections: FIRMSDetection[] = [];
    for (let i = 0; i < MAX_RADIUS_DETECTIONS; i++) {
      detections.push(detectionAt(i / 100));
    }

    const result = filterByRadius(detections, ORIGIN_LAT, ORIGIN_LON, 100);

    expect(result.detections).toHaveLength(MAX_RADIUS_DETECTIONS);
    expect(result.truncated).toBe(false);
  });
});

describe('clusterDetections', () => {
  const ORIGIN_LAT = 0;
  const ORIGIN_LON = 0;
  const KM_PER_DEGREE_LAT = (6371 * Math.PI) / 180;

  function detectionAt(kmNorth: number, frp: number, overrides: Partial<FIRMSDetection> = {}): FIRMSDetection {
    return {
      latitude: kmNorth / KM_PER_DEGREE_LAT,
      longitude: 0,
      frp,
      confidence: 'nominal',
      acquiredAt: '2026-08-14T00:00:00.000Z',
      daynight: 'D',
      satellite: 'N',
      ...overrides
    };
  }

  it('should return an empty array for empty input', () => {
    expect(clusterDetections([], ORIGIN_LAT, ORIGIN_LON)).toEqual([]);
  });

  it('should fold many nearby rows into a single cluster', () => {
    const detections = [
      detectionAt(0.1, 5),
      detectionAt(0.2, 8),
      detectionAt(0.3, 3),
      detectionAt(0.4, 12),
      detectionAt(0.5, 1)
    ];

    const clusters = clusterDetections(detections, ORIGIN_LAT, ORIGIN_LON);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(5);
    expect(clusters[0].maxFrp).toBe(12);
  });

  it('should keep two detections just over 2 km apart as separate clusters', () => {
    const detections = [detectionAt(0, 10), detectionAt(2.5, 10)];

    const clusters = clusterDetections(detections, ORIGIN_LAT, ORIGIN_LON);

    expect(clusters).toHaveLength(2);
  });

  it('should merge two detections just under 2 km apart into one cluster', () => {
    const detections = [detectionAt(0, 10), detectionAt(1.5, 10)];

    const clusters = clusterDetections(detections, ORIGIN_LAT, ORIGIN_LON);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
  });

  it('should assign the founding (highest-FRP) detection deterministically regardless of input order', () => {
    // Two far-apart pairs so each becomes its own cluster; each pair's
    // highest-FRP row should become that cluster's founder no matter which
    // order the rows arrive in.
    const original = [
      detectionAt(0, 5, { satellite: 'LOW' }),
      detectionAt(0.1, 40, { satellite: 'HIGH' }),
      detectionAt(500, 5, { satellite: 'FAR-LOW' }),
      detectionAt(500.1, 40, { satellite: 'FAR-HIGH' })
    ];
    const reversed = [...original].reverse();

    const fromOriginal = clusterDetections(original, ORIGIN_LAT, ORIGIN_LON);
    const fromReversed = clusterDetections(reversed, ORIGIN_LAT, ORIGIN_LON);

    expect(fromOriginal).toEqual(fromReversed);
    // Nearest cluster (near-origin pair) always founded by its own highest-FRP
    // member, regardless of the traversal order used to discover it.
    expect(fromOriginal[0].satellite).toBe('HIGH');
    expect(fromOriginal[0].maxFrp).toBe(40);
  });

  it('should sort returned clusters nearest-first', () => {
    const detections = [detectionAt(300, 10), detectionAt(10, 10), detectionAt(150, 10)];

    const clusters = clusterDetections(detections, ORIGIN_LAT, ORIGIN_LON);

    expect(clusters.map(c => Math.round(c.distanceKm))).toEqual([10, 150, 300]);
  });

  it('should report day/night mix and confidence summary correctly', () => {
    const detections = [
      detectionAt(0, 10, { daynight: 'D', confidence: 'high' }),
      detectionAt(0.1, 5, { daynight: 'N', confidence: 'low' }),
      detectionAt(0.2, 1, { daynight: 'N', confidence: 'unknown' })
    ];

    const clusters = clusterDetections(detections, ORIGIN_LAT, ORIGIN_LON);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].dayCount).toBe(1);
    expect(clusters[0].nightCount).toBe(2);
    expect(clusters[0].confidenceCounts).toEqual({ low: 1, nominal: 0, high: 1, unknown: 1 });
  });

  it('should report the newest acquiredAt in the cluster', () => {
    const detections = [
      detectionAt(0, 10, { acquiredAt: '2026-08-14T01:00:00.000Z' }),
      detectionAt(0.1, 5, { acquiredAt: '2026-08-14T03:00:00.000Z' }),
      detectionAt(0.2, 1, { acquiredAt: '2026-08-14T02:00:00.000Z' })
    ];

    const clusters = clusterDetections(detections, ORIGIN_LAT, ORIGIN_LON);

    expect(clusters[0].newestAcquiredAt).toBe('2026-08-14T03:00:00.000Z');
  });

  it('should compute a 16-point bearing from the requested point to the cluster centroid', () => {
    const detections = [detectionAt(50, 10)]; // due north
    const clusters = clusterDetections(detections, ORIGIN_LAT, ORIGIN_LON);

    expect(clusters[0].bearing).toBe('N');
  });

  it('should not include raw brightness fields in cluster output', () => {
    const detections = [detectionAt(0, 10)];
    const clusters = clusterDetections(detections, ORIGIN_LAT, ORIGIN_LON);

    expect(clusters[0]).not.toHaveProperty('bright_ti4');
    expect(clusters[0]).not.toHaveProperty('bright_ti5');
  });
});
