/**
 * Unit tests for GRIB grid nearest-point lookup
 */

import { describe, it, expect } from 'vitest';
import { findNearestGridIndex } from '../../src/utils/gribGrid.js';

describe('findNearestGridIndex', () => {
  describe('separable / rectilinear grids (e.g. GFS)', () => {
    // latitude has one entry per row, longitude has one entry per column —
    // the two axes are independent, so row * cols + col is a valid flat index.
    const gridShape = { rows: 4, cols: 3 };
    const latlng = {
      latitude: [38, 39, 40, 41],
      longitude: [264, 265, 267], // 0-360 convention, like GFS's global grid
    };
    // Row-major: data[row * 3 + col]
    const data = [0, 1, 2, 10, 11, 12, 20, 21, 22, 30, 31, 32];

    it('finds the correct flat index for a target inside the grid', () => {
      // Nearest latitude: 39 (row 1). Nearest longitude: -94.5 -> normalized to
      // 265.5 -> nearest is 265 (col 1). Expected flat index: 1*3 + 1 = 4.
      const index = findNearestGridIndex(latlng, gridShape, 39.2, -94.5);

      expect(index).toBe(4);
      expect(data[index as number]).toBe(11);
    });

    it('normalizes a negative target longitude to the grid\'s 0-360 convention', () => {
      // Target longitude -96 -> normalized to 264 -> nearest is col 0.
      const index = findNearestGridIndex(latlng, gridShape, 38.1, -96);

      expect(index).toBe(0);
      expect(data[index as number]).toBe(0);
    });
  });

  describe('curvilinear / projected grids (e.g. NAM Lambert Conformal Conic)', () => {
    // Every grid point has its own unique (lat, lon) pair; both arrays are flat
    // and length rows * cols. Row/column indices found independently cannot be
    // recombined with row * cols + col.
    const gridShape = { rows: 3, cols: 2 };
    const latlng = {
      latitude: [40.0, 40.5, 41.0, 39.0, 39.5, 40.0],
      longitude: [-95.0, -94.0, -93.0, -95.2, -94.2, -93.2],
    };
    const data = [0, 1, 2, 3, 14, 5];

    it('finds the true nearest point instead of recombining per-axis indices', () => {
      // True nearest point to (39.7, -94.3) is index 4 (39.5, -94.2).
      //
      // The old buggy implementation searched the flat latitude array and flat
      // longitude array independently (each returning index 4 here, since both
      // happen to be closest along their own axis too) and then computed
      // 4 * cols(2) + 4 = 12 — an index past the end of a 6-entry data array,
      // so it always read back `undefined`.
      const index = findNearestGridIndex(latlng, gridShape, 39.7, -94.3);

      expect(index).toBe(4);
      expect(data[index as number]).toBe(14);

      // Confirm the old formula really was out of bounds for this fixture.
      const buggyFlatIndex = 4 * gridShape.cols + 4;
      expect(buggyFlatIndex).toBeGreaterThanOrEqual(data.length);
    });

    it('handles a target longitude already in -180/180 convention without misnormalizing it', () => {
      const index = findNearestGridIndex(latlng, gridShape, 41.0, -93.0);

      expect(index).toBe(2);
      expect(data[index as number]).toBe(2);
    });
  });

  describe('malformed or missing grid data', () => {
    it('returns undefined when latlng is missing', () => {
      expect(findNearestGridIndex(undefined, { rows: 2, cols: 2 }, 40, -95)).toBeUndefined();
    });

    it('returns undefined when gridShape is missing', () => {
      const latlng = { latitude: [40, 41], longitude: [-95, -94] };
      expect(findNearestGridIndex(latlng, undefined, 40, -95)).toBeUndefined();
    });

    it('returns undefined when latitude/longitude arrays are empty', () => {
      const latlng = { latitude: [], longitude: [] };
      expect(findNearestGridIndex(latlng, { rows: 2, cols: 2 }, 40, -95)).toBeUndefined();
    });

    it('returns undefined when array lengths do not match rows*cols or a separable layout', () => {
      // Neither rows-length/cols-length (separable) nor rows*cols/rows*cols (curvilinear).
      const latlng = { latitude: [40, 41, 42], longitude: [-95, -94] };
      expect(findNearestGridIndex(latlng, { rows: 2, cols: 2 }, 40, -95)).toBeUndefined();
    });
  });
});
