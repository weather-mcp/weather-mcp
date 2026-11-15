/**
 * The composite cache holds a fixed number of entries, a byte bound that does not
 * move with CACHE_MAX_SIZE (src/handlers/weatherImageryHandler.ts `compositeCache`).
 *
 * Everything upstream is mocked, as in imagery-composite.test.ts: rainviewer, the base-map
 * service and the overlay tile fetch. No fake timers (G133).
 *
 * `compositeCache` is a module singleton, so each test uses its own frame URL
 * (G158): a key from one test can never be served to another.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { PNG } from 'pngjs';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ImageryFrame } from '../../src/types/imagery.js';

// CacheConfig reads these at import, so they are set before any import (G21).
// CACHE_MAX_SIZE=10000 is the maximum: with the count tied to it, 33 entries all stay.
const { savedEnv } = vi.hoisted(() => {
  const saved = {
    CACHE_MAX_SIZE: process.env.CACHE_MAX_SIZE,
    CACHE_ENABLED: process.env.CACHE_ENABLED,
  };
  process.env.CACHE_MAX_SIZE = '10000';
  process.env.CACHE_ENABLED = 'true';
  return { savedEnv: saved };
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const { mockAxiosGet } = vi.hoisted(() => ({ mockAxiosGet: vi.fn() }));
vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => mockAxiosGet(...args) },
}));

const { mockGetPrecipitationRadar } = vi.hoisted(() => ({ mockGetPrecipitationRadar: vi.fn() }));
vi.mock('../../src/services/rainviewer.js', () => ({
  rainViewerService: {
    getPrecipitationRadar: (...args: unknown[]) => mockGetPrecipitationRadar(...args),
  },
}));

const { mockGetBaseWindow } = vi.hoisted(() => ({ mockGetBaseWindow: vi.fn() }));
vi.mock('../../src/services/basemap.js', () => ({
  basemapService: {
    getBaseWindow: (...args: unknown[]) => mockGetBaseWindow(...args),
  },
}));

import { handleGetWeatherImagery } from '../../src/handlers/weatherImageryHandler.js';
import { CacheConfig } from '../../src/config/cache.js';
import {
  COMPOSITE_CACHE_MAX_ENTRIES,
  COMPOSITE_CACHE_BYTE_BUDGET,
} from '../../src/utils/composite.js';

const locationStore = {} as unknown as LocationStore;
const geocodingService = {} as unknown as GeocodingService;

const NOW = new Date('2024-06-01T12:00:00Z');
const LATITUDE = 25.7617;

function solidPng(rgba: [number, number, number, number]): PNG {
  const png = new PNG({ width: 512, height: 512 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return png;
}

function frameFor(id: string): ImageryFrame {
  return {
    url: `https://tilecache.rainviewer.com/v2/radar/${id}/512/6/17/27/2/1_1.png`,
    timestamp: new Date(NOW.getTime() - 5 * 60_000),
    description: 'Test frame',
  };
}

/** Coordinate `index` of a series: 2 degrees of longitude apart, so each has its own window origin. */
function longitudeAt(index: number): number {
  return -170 + index * 2;
}

async function composite(index: number): Promise<void> {
  const result = await handleGetWeatherImagery(
    { latitude: LATITUDE, longitude: longitudeAt(index), type: 'precipitation', composite: true },
    locationStore,
    geocodingService
  );
  // A degraded composite carries no image block and would pass as a cache event.
  expect(result.content.some((block) => block.type === 'image')).toBe(true);
}

beforeEach(() => {
  mockAxiosGet.mockReset();
  mockAxiosGet.mockResolvedValue({
    data: PNG.sync.write(solidPng([0, 0, 0, 0])),
  });
  mockGetPrecipitationRadar.mockReset();
  mockGetBaseWindow.mockReset();
  mockGetBaseWindow.mockImplementation(() => Promise.resolve(solidPng([40, 120, 180, 255])));
});

describe('composite cache byte bound', () => {
  it('pins the entry count and byte budget at their literals', () => {
    expect(COMPOSITE_CACHE_MAX_ENTRIES).toBe(32);
    expect(COMPOSITE_CACHE_BYTE_BUDGET).toBe(32_000_000);
  });

  it('runs with CACHE_MAX_SIZE=10000, so the fixed count is what bounds the cache', () => {
    expect(CacheConfig.maxSize).toBe(10000);
    expect(CacheConfig.enabled).toBe(true);
  });

  it('evicts the first of 33 distinct windows and keeps the last', async () => {
    mockGetPrecipitationRadar.mockResolvedValue([frameFor('evict-33')]);

    for (let i = 0; i < 33; i++) await composite(i);
    expect(mockGetBaseWindow).toHaveBeenCalledTimes(33);

    mockGetBaseWindow.mockClear();
    await composite(32); // coordinate 33: still cached
    expect(mockGetBaseWindow).not.toHaveBeenCalled();

    await composite(0); // coordinate 1: evicted, rebuilt
    expect(mockGetBaseWindow).toHaveBeenCalledTimes(1);
  });

  it('control: 32 distinct windows evict nothing', async () => {
    mockGetPrecipitationRadar.mockResolvedValue([frameFor('control-32')]);

    for (let i = 0; i < 32; i++) await composite(i);
    expect(mockGetBaseWindow).toHaveBeenCalledTimes(32);

    mockGetBaseWindow.mockClear();
    await composite(0);
    expect(mockGetBaseWindow).not.toHaveBeenCalled();
  });
});
