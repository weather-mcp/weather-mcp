/**
 * Tests for METAR station selection (src/utils/metarStation.ts).
 *
 * Pure, deterministic, no mocks and no I/O — the picker takes whatever
 * stations it is given and an injectable clock, so tier widening can be
 * exercised without HTTP.
 */

import { describe, it, expect } from 'vitest';
import {
  pickNearestStation,
  SEARCH_TIERS,
  FRESH_MAX_AGE_MINUTES,
  STALE_MAX_AGE_MINUTES,
  NEAR_MAX_KM,
  FAR_MAX_KM
} from '../../src/utils/metarStation.js';
import type { MetarObservation } from '../../src/types/aviationWeather.js';

/** Fixed clock so every age in these tests is exact. */
const NOW = new Date('2026-08-13T15:00:00Z');

/** Kilometres per degree of latitude for the Haversine radius the project uses (R = 6371 km). */
const KM_PER_DEGREE_LAT = (6371 * Math.PI) / 180;

/** Latitude offset that places a station a given great-circle distance due north. */
function latOffsetForKm(km: number): number {
  return km / KM_PER_DEGREE_LAT;
}

interface StationSpec {
  id: string;
  /** Distance due north of the requested point, in km. */
  km?: number;
  /** Observation age at NOW, in minutes. */
  ageMinutes: number;
  /** Explicit coordinates, overriding `km`. */
  lat?: number;
  lon?: number;
}

const ORIGIN_LAT = 0;
const ORIGIN_LON = 0;

function station(spec: StationSpec): MetarObservation {
  const lat = spec.lat ?? ORIGIN_LAT + latOffsetForKm(spec.km ?? 0);
  const lon = spec.lon ?? ORIGIN_LON;
  const obsTime = Math.round((NOW.getTime() - spec.ageMinutes * 60000) / 1000);

  return {
    icaoId: spec.id,
    name: `${spec.id} Field`,
    lat,
    lon,
    elev: 100,
    obsTime,
    reportTime: new Date(obsTime * 1000).toISOString(),
    receiptTime: new Date(obsTime * 1000).toISOString(),
    rawOb: `METAR ${spec.id} 131453Z 19006KT 10SM FEW250 18/12 A2994`,
    metarType: 'METAR',
    qcField: 0
  };
}

describe('METAR station selection', () => {
  describe('search tiers', () => {
    it('should expose the documented widening ladder for the caller to iterate', () => {
      expect(SEARCH_TIERS).toEqual([0.5, 2.0, 5.0]);
    });

    it('should record the tier that produced the station when the caller supplies one', () => {
      const pick = pickNearestStation([station({ id: 'AAAA', km: 20, ageMinutes: 30 })],
        ORIGIN_LAT, ORIGIN_LON, NOW, 2.0);

      expect(pick?.tierDegrees).toBe(2.0);
    });

    it('should omit the tier when the caller does not supply one', () => {
      const pick = pickNearestStation([station({ id: 'AAAA', km: 20, ageMinutes: 30 })],
        ORIGIN_LAT, ORIGIN_LON, NOW);

      expect(pick?.tierDegrees).toBeUndefined();
    });
  });

  describe('distance preference', () => {
    it('should prefer the nearest station over a fresher but farther one', () => {
      const stations = [
        station({ id: 'FRESH', km: 80, ageMinutes: 5 }),
        station({ id: 'NEAR', km: 10, ageMinutes: 60 })
      ];

      const pick = pickNearestStation(stations, ORIGIN_LAT, ORIGIN_LON, NOW);

      expect(pick?.observation.icaoId).toBe('NEAR');
      expect(pick?.stale).toBe(false);
    });

    it('should resolve an exact distance tie to the first station in input order', () => {
      const stations = [
        station({ id: 'FIRST', km: 25, ageMinutes: 20 }),
        station({ id: 'SECOND', km: 25, ageMinutes: 10 })
      ];

      expect(pickNearestStation(stations, ORIGIN_LAT, ORIGIN_LON, NOW)?.observation.icaoId)
        .toBe('FIRST');
    });
  });

  describe('freshness', () => {
    it('should never pass over a fresh station for a nearer stale one', () => {
      const stations = [
        station({ id: 'STALE', km: 5, ageMinutes: 200 }),
        station({ id: 'FRESH', km: 60, ageMinutes: 40 })
      ];

      const pick = pickNearestStation(stations, ORIGIN_LAT, ORIGIN_LON, NOW);

      expect(pick?.observation.icaoId).toBe('FRESH');
      expect(pick?.stale).toBe(false);
    });

    it('should fall back to the stale pool only when nothing is fresh, and flag it', () => {
      const stations = [
        station({ id: 'FAROLD', km: 90, ageMinutes: 300 }),
        station({ id: 'NEAROLD', km: 20, ageMinutes: 200 })
      ];

      const pick = pickNearestStation(stations, ORIGIN_LAT, ORIGIN_LON, NOW);

      expect(pick?.observation.icaoId).toBe('NEAROLD');
      expect(pick?.stale).toBe(true);
      expect(pick?.ageMinutes).toBe(200);
    });

    it('should treat an observation exactly at the freshness bound as fresh', () => {
      const pick = pickNearestStation(
        [station({ id: 'EDGE', km: 10, ageMinutes: FRESH_MAX_AGE_MINUTES })],
        ORIGIN_LAT, ORIGIN_LON, NOW
      );

      expect(pick?.stale).toBe(false);
    });

    it('should treat an observation just past the freshness bound as stale', () => {
      const pick = pickNearestStation(
        [station({ id: 'EDGE', km: 10, ageMinutes: FRESH_MAX_AGE_MINUTES + 1 })],
        ORIGIN_LAT, ORIGIN_LON, NOW
      );

      expect(pick?.stale).toBe(true);
    });

    it('should accept an observation exactly at the staleness bound', () => {
      const pick = pickNearestStation(
        [station({ id: 'EDGE', km: 10, ageMinutes: STALE_MAX_AGE_MINUTES })],
        ORIGIN_LAT, ORIGIN_LON, NOW
      );

      expect(pick?.observation.icaoId).toBe('EDGE');
      expect(pick?.stale).toBe(true);
    });

    it('should return null when every station is older than six hours', () => {
      const stations = [
        station({ id: 'OLD1', km: 5, ageMinutes: STALE_MAX_AGE_MINUTES + 1 }),
        station({ id: 'OLD2', km: 15, ageMinutes: 1440 })
      ];

      expect(pickNearestStation(stations, ORIGIN_LAT, ORIGIN_LON, NOW)).toBeNull();
    });

    it('should treat a future-dated observation as current rather than discarding it', () => {
      const pick = pickNearestStation(
        [station({ id: 'SKEW', km: 10, ageMinutes: -5 })],
        ORIGIN_LAT, ORIGIN_LON, NOW
      );

      expect(pick?.observation.icaoId).toBe('SKEW');
      expect(pick?.ageMinutes).toBe(0);
      expect(pick?.stale).toBe(false);
    });
  });

  describe('distance banding', () => {
    it('should not flag a station at 99 km as far', () => {
      const pick = pickNearestStation(
        [station({ id: 'NEAR', km: 99, ageMinutes: 30 })],
        ORIGIN_LAT, ORIGIN_LON, NOW
      );

      expect(pick?.far).toBe(false);
      expect(pick?.distanceKm).toBeCloseTo(99, 1);
    });

    it('should flag a station at 101 km as far', () => {
      const pick = pickNearestStation(
        [station({ id: 'FAR', km: 101, ageMinutes: 30 })],
        ORIGIN_LAT, ORIGIN_LON, NOW
      );

      expect(pick?.far).toBe(true);
    });

    it('should not flag a station exactly at the near bound as far', () => {
      const pick = pickNearestStation(
        [station({ id: 'EDGE', km: NEAR_MAX_KM, ageMinutes: 30 })],
        ORIGIN_LAT, ORIGIN_LON, NOW
      );

      expect(pick?.far).toBe(false);
    });

    it('should still return a station at 249 km, flagged far', () => {
      const pick = pickNearestStation(
        [station({ id: 'EDGE', km: 249, ageMinutes: 30 })],
        ORIGIN_LAT, ORIGIN_LON, NOW
      );

      expect(pick?.observation.icaoId).toBe('EDGE');
      expect(pick?.far).toBe(true);
    });

    it('should return null for a station at 251 km however fresh it is', () => {
      const pick = pickNearestStation(
        [station({ id: 'TOOFAR', km: 251, ageMinutes: 1 })],
        ORIGIN_LAT, ORIGIN_LON, NOW
      );

      expect(pick).toBeNull();
    });

    it('should accept a station exactly at the far bound', () => {
      const pick = pickNearestStation(
        [station({ id: 'EDGE', km: FAR_MAX_KM, ageMinutes: 30 })],
        ORIGIN_LAT, ORIGIN_LON, NOW
      );

      expect(pick?.observation.icaoId).toBe('EDGE');
    });

    it('should return null when the only nearby station is beyond the band and the rest are stale-old', () => {
      const stations = [
        station({ id: 'TOOFAR', km: 400, ageMinutes: 10 }),
        station({ id: 'ANCIENT', km: 5, ageMinutes: 2000 })
      ];

      expect(pickNearestStation(stations, ORIGIN_LAT, ORIGIN_LON, NOW)).toBeNull();
    });
  });

  describe('empty input', () => {
    it('should return null for no stations at all', () => {
      expect(pickNearestStation([], ORIGIN_LAT, ORIGIN_LON, NOW)).toBeNull();
    });
  });

  describe('bearing', () => {
    it('should render a due-north station as N', () => {
      const pick = pickNearestStation(
        [station({ id: 'NORTH', lat: 0.5, lon: 0, ageMinutes: 30 })],
        0, 0, NOW
      );

      expect(pick?.bearing).toBe('N');
    });

    it('should render a due-east station as E', () => {
      const pick = pickNearestStation(
        [station({ id: 'EAST', lat: 0, lon: 0.5, ageMinutes: 30 })],
        0, 0, NOW
      );

      expect(pick?.bearing).toBe('E');
    });

    it('should render a due-south station as S', () => {
      const pick = pickNearestStation(
        [station({ id: 'SOUTH', lat: -0.5, lon: 0, ageMinutes: 30 })],
        0, 0, NOW
      );

      expect(pick?.bearing).toBe('S');
    });

    it('should render a due-west station as W', () => {
      const pick = pickNearestStation(
        [station({ id: 'WEST', lat: 0, lon: -0.5, ageMinutes: 30 })],
        0, 0, NOW
      );

      expect(pick?.bearing).toBe('W');
    });

    it('should use the 16-point compass, not the 8-point one', () => {
      // Due north-north-east of the origin: bearing ~22.5 degrees.
      const pick = pickNearestStation(
        [station({ id: 'NNE', lat: 0.4619, lon: 0.1913, ageMinutes: 30 })],
        0, 0, NOW
      );

      expect(pick?.bearing).toBe('NNE');
    });
  });

  describe('result shape', () => {
    it('should pass the winning observation through unchanged', () => {
      const winner = station({ id: 'KSEA', km: 12, ageMinutes: 41 });

      const pick = pickNearestStation([winner], ORIGIN_LAT, ORIGIN_LON, NOW);

      expect(pick?.observation).toBe(winner);
      expect(pick?.ageMinutes).toBe(41);
      expect(pick?.distanceKm).toBeCloseTo(12, 1);
    });
  });
});
