import { describe, it, expect } from 'vitest';
import { WEB_MERCATOR_MAX_LATITUDE, webMercatorTileIndex } from '../../src/utils/webMercator.js';

describe('webMercator', () => {
  it('exposes the Web-Mercator latitude limit as the literal value', () => {
    expect(WEB_MERCATOR_MAX_LATITUDE).toBe(85.05112878);
  });

  describe.each([
    [5, 31],
    [6, 63],
    [10, 1023]
  ])('zoom %i (max index %i)', (zoom, max) => {
    const cases: Array<[number, number]> = [
      [90, 0],
      [-90, 0],
      [89.9, 0],
      [-89.9, 0],
      [85.05112878, 0],
      [-85.05112878, 0],
      [0, 180],
      [0, -180]
    ];
    it.each(cases)('lat %f lon %f gives integer indices inside the grid', (lat, lon) => {
      const { x, y } = webMercatorTileIndex(lat, lon, zoom);
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(max);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(max);
    });
  });

  it('pins the edge rows at zoom 5', () => {
    expect(webMercatorTileIndex(90, 0, 5).y).toBe(0);
    expect(webMercatorTileIndex(-90, 0, 5).y).toBe(31);
    expect(webMercatorTileIndex(0, 180, 5).x).toBe(31);
    expect(webMercatorTileIndex(0, -180, 5).x).toBe(0);
  });

  it('pins the edge rows at zoom 6', () => {
    expect(webMercatorTileIndex(90, 0, 6)).toEqual({ x: 32, y: 0 });
    expect(webMercatorTileIndex(-90, 0, 6).y).toBe(63);
    expect(webMercatorTileIndex(0, 180, 6).x).toBe(63);
  });

  it('pins the edge rows at zoom 10', () => {
    expect(webMercatorTileIndex(90, 0, 10).y).toBe(0);
    expect(webMercatorTileIndex(-90, 0, 10).y).toBe(1023);
    expect(webMercatorTileIndex(0, 180, 10).x).toBe(1023);
  });

  it('keeps on-grid points where the formula puts them', () => {
    expect(webMercatorTileIndex(0, 0, 6)).toEqual({ x: 32, y: 32 });
    expect(webMercatorTileIndex(0, 90, 6).x).toBe(48);
    expect(webMercatorTileIndex(0, -90, 6).x).toBe(16);
  });

  it('treats latitude 90 and the clamp latitude as the same point', () => {
    for (const zoom of [5, 6, 10]) {
      expect(webMercatorTileIndex(90, 0, zoom)).toEqual(webMercatorTileIndex(85.05112878, 0, zoom));
      expect(webMercatorTileIndex(-90, 0, zoom)).toEqual(webMercatorTileIndex(-85.05112878, 0, zoom));
    }
  });
});
