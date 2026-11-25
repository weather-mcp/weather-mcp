import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { NOAAService } from '../../src/services/noaa.js';
import { Cache } from '../../src/utils/cache.js';
import { CacheConfig } from '../../src/config/cache.js';
import { IMPERIAL_PREFERENCES } from '../../src/config/units.js';

/**
 * Historical cache TTL is chosen from the END of the requested range (G7):
 * a range whose recent days are still being revised must not be cached forever.
 * Only Date is faked; HTTP is stubbed on the instance, so no timers or sockets.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 25, 18);

describe('historical cache TTL follows the end of the range', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('OpenMeteoService.getHistoricalWeather', () => {
    function setup() {
      const service = new OpenMeteoService();
      service.clearCache();
      const setSpy = vi.spyOn((service as any).cache, 'set');
      vi.spyOn(service as any, 'makeRequest').mockResolvedValue({
        latitude: 39.74,
        longitude: -104.99,
        hourly: { time: ['2026-10-26T00:00'], temperature_2m: [50] }
      });
      return { service, setSpy };
    }

    it('range of 30 days ending today uses recentHistorical', async () => {
      const { service, setSpy } = setup();
      await service.getHistoricalWeather(39.74, -104.99, '2026-10-26', '2026-11-25');
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][2]).toBe(CacheConfig.ttl.recentHistorical);
    });

    it('range ended 10 days ago uses Infinity', async () => {
      const { service, setSpy } = setup();
      await service.getHistoricalWeather(39.74, -104.99, '2026-10-26', '2026-11-15');
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][2]).toBe(Infinity);
    });

    it('keeps the cache key unchanged', async () => {
      const { service, setSpy } = setup();
      const p = IMPERIAL_PREFERENCES;
      await service.getHistoricalWeather(39.74, -104.99, '2026-10-26', '2026-11-25', true, p);
      const expected = Cache.generateKey(
        'openmeteo-historical', 39.74, -104.99, '2026-10-26', '2026-11-25', true,
        `${p.temperature}-${p.windSpeed}-${p.precipitation}`
      );
      expect(setSpy.mock.calls[0][0]).toBe(expected);
    });
  });

  describe('NOAAService.getObservations', () => {
    function setup() {
      const service = new NOAAService();
      service.clearCache();
      const setSpy = vi.spyOn((service as any).cache, 'set');
      vi.spyOn(service as any, 'makeRequest').mockResolvedValue({ features: [] });
      return { service, setSpy };
    }
    const ago = (days: number) => new Date(NOW - days * DAY);

    it('start 3 days ago, end now uses recentHistorical', async () => {
      const { service, setSpy } = setup();
      await service.getObservations('KDEN', ago(3), new Date(NOW));
      expect(setSpy.mock.calls[0][2]).toBe(CacheConfig.ttl.recentHistorical);
    });

    it('start 10 days ago, end now uses recentHistorical (end decides, not start)', async () => {
      const { service, setSpy } = setup();
      await service.getObservations('KDEN', ago(10), new Date(NOW));
      expect(setSpy.mock.calls[0][2]).toBe(CacheConfig.ttl.recentHistorical);
    });

    it('start 3 days ago, no end uses recentHistorical', async () => {
      const { service, setSpy } = setup();
      await service.getObservations('KDEN', ago(3));
      expect(setSpy.mock.calls[0][2]).toBe(CacheConfig.ttl.recentHistorical);
    });

    it('start and end both about 10 days ago uses Infinity', async () => {
      const { service, setSpy } = setup();
      await service.getObservations('KDEN', ago(11), ago(10));
      expect(setSpy.mock.calls[0][2]).toBe(Infinity);
    });

    it('keeps the cache key unchanged', async () => {
      const { service, setSpy } = setup();
      const start = ago(11);
      const end = ago(10);
      await service.getObservations('KDEN', start, end, 50);
      const expected = Cache.generateKey('observations', 'KDEN', start.toISOString(), end.toISOString(), 50);
      expect(setSpy.mock.calls[0][0]).toBe(expected);
    });
  });
});
