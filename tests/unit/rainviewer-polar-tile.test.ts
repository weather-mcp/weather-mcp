/**
 * RainViewerService.buildCoordinateTileUrl — Web Mercator latitude clamp.
 * Drives the real method; nothing is copied from src/.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RainViewerService } from '../../src/services/rainviewer.js';
import { logger } from '../../src/utils/logger.js';
import { parseRadarTileUrl } from '../../src/utils/composite.js';

const FRAME = { time: 1699999999, path: '/v2/radar/1699999999' };
const CLAMP_MESSAGE = 'Latitude clamped to Web Mercator safe range';

function parseTile(url: string): { z: number; x: number; y: number } {
  const match = /\/512\/(\d+)\/(-?\d+)\/(-?\d+)\/4\/1_1\.png$/.exec(url);
  if (!match) {
    throw new Error(`Unexpected tile URL shape: ${url}`);
  }
  return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

describe('RainViewerService.buildCoordinateTileUrl polar latitudes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const zoom of [6, 10]) {
    for (const latitude of [90, -90, 89.9, -89.9, 85.05112878, -85.05112878]) {
      it(`keeps lat ${latitude} inside the tile grid at zoom ${zoom}`, () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const service = new RainViewerService();
        const { z, x, y } = parseTile(service.buildCoordinateTileUrl(FRAME, latitude, 0, zoom));
        expect(z).toBe(zoom);
        expect(Number.isInteger(x)).toBe(true);
        expect(Number.isInteger(y)).toBe(true);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(2 ** zoom - 1);
      });
    }

    for (const [longitude, column] of [[180, 2 ** zoom - 1], [-180, 0]] as const) {
      it(`keeps lon ${longitude} on column ${column} at zoom ${zoom}`, () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const service = new RainViewerService();
        const { x } = parseTile(service.buildCoordinateTileUrl(FRAME, 0, longitude, zoom));
        expect(x).toBe(column);
      });
    }

    it(`clamps lat 90 to exactly 85.05112878 at zoom ${zoom}`, () => {
      vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const service = new RainViewerService();
      expect(service.buildCoordinateTileUrl(FRAME, 90, 0, zoom)).toBe(
        service.buildCoordinateTileUrl(FRAME, 85.05112878, 0, zoom)
      );
    });
  }

  it('warns when the latitude is clamped', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    new RainViewerService().buildCoordinateTileUrl(FRAME, 90, 0, 6);
    expect(warn.mock.calls.filter(c => c[0] === CLAMP_MESSAGE)).toHaveLength(1);
  });

  it('does not warn for an in-range latitude', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    new RainViewerService().buildCoordinateTileUrl(FRAME, 40, 0, 6);
    expect(warn.mock.calls.filter(c => c[0] === CLAMP_MESSAGE)).toHaveLength(0);
  });

  it('builds a polar URL that parseRadarTileUrl accepts', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const service = new RainViewerService();
    expect(parseRadarTileUrl(service.buildCoordinateTileUrl(FRAME, 90, 0, 6))).toEqual({
      z: 6,
      x: 32,
      y: 0
    });
  });
});
