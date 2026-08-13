import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { OpenMeteoFloodResponse } from '../../src/types/openmeteo.js';

/**
 * OpenMeteoService.getRiverDischarge() Tests
 *
 * Mirrors the mocking approach used in tests/unit/openmeteo-current.test.ts:
 * spy on the private `makeRequestToFlood` method so no live network calls
 * are made.
 */

function buildFloodResponse(
  overrides: Partial<OpenMeteoFloodResponse> = {}
): OpenMeteoFloodResponse {
  return {
    latitude: 35.125,
    longitude: -90.125,
    generationtime_ms: 0.1,
    utc_offset_seconds: -21600,
    timezone: 'America/Chicago',
    timezone_abbreviation: 'CDT',
    daily_units: {
      time: 'iso8601',
      river_discharge: 'm³/s',
      river_discharge_mean: 'm³/s',
      river_discharge_median: 'm³/s',
      river_discharge_max: 'm³/s',
      river_discharge_min: 'm³/s',
      river_discharge_p25: 'm³/s',
      river_discharge_p75: 'm³/s'
    },
    daily: {
      time: ['2026-07-12', '2026-07-13', '2026-07-14'],
      river_discharge: [11600, 11550, 11700],
      river_discharge_mean: [11500, 11500, 11500],
      river_discharge_median: [11500, 11500, 11500],
      river_discharge_max: [11800, 11800, 11800],
      river_discharge_min: [11200, 11200, 11200],
      river_discharge_p25: [11400, 11400, 11400],
      river_discharge_p75: [11650, 11650, 11650]
    },
    ...overrides
  };
}

function buildAllNullFloodResponse(): OpenMeteoFloodResponse {
  return {
    latitude: 0,
    longitude: -140,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'GMT',
    timezone_abbreviation: 'GMT',
    daily_units: {
      time: 'iso8601',
      river_discharge: 'm³/s'
    },
    daily: {
      time: ['2026-07-12', '2026-07-13', '2026-07-14'],
      river_discharge: [null, null, null],
      river_discharge_mean: [null, null, null],
      river_discharge_median: [null, null, null],
      river_discharge_max: [null, null, null],
      river_discharge_min: [null, null, null],
      river_discharge_p25: [null, null, null],
      river_discharge_p75: [null, null, null]
    }
  };
}

describe('OpenMeteoService.getRiverDischarge()', () => {
  let service: OpenMeteoService;

  beforeEach(() => {
    service = new OpenMeteoService();
    service.clearCache();
  });

  describe('Parameter Building', () => {
    it('should comma-join multiple latitude and longitude points', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToFlood')
        .mockResolvedValue([buildFloodResponse(), buildFloodResponse()]);

      await service.getRiverDischarge([35.075, 35.125], [-90.175, -90.125]);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.latitude).toBe('35.075,35.125');
      expect(params.longitude).toBe('-90.175,-90.125');
    });

    it('should set past_days to 31', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToFlood')
        .mockResolvedValue(buildFloodResponse());

      await service.getRiverDischarge([35.125], [-90.125]);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.past_days).toBe(31);
    });

    it('should include all seven river_discharge daily variables', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToFlood')
        .mockResolvedValue(buildFloodResponse());

      await service.getRiverDischarge([35.125], [-90.125]);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.daily).toBe(
        'river_discharge,river_discharge_mean,river_discharge_median,' +
        'river_discharge_max,river_discharge_min,river_discharge_p25,river_discharge_p75'
      );
    });

    it('should set timezone to auto', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToFlood')
        .mockResolvedValue(buildFloodResponse());

      await service.getRiverDischarge([35.125], [-90.125]);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.timezone).toBe('auto');
    });

    it('should default forecast_days to 7', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToFlood')
        .mockResolvedValue(buildFloodResponse());

      await service.getRiverDischarge([35.125], [-90.125]);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.forecast_days).toBe(7);
    });

    it('should pass through an explicit forecast_days value', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToFlood')
        .mockResolvedValue(buildFloodResponse());

      await service.getRiverDischarge([35.125], [-90.125], 30);

      const params = spy.mock.calls[0][1] as Record<string, string | number>;
      expect(params.forecast_days).toBe(30);
    });
  });

  describe('Validation', () => {
    it('should reject forecast_days of 0', async () => {
      await expect(
        service.getRiverDischarge([35.125], [-90.125], 0)
      ).rejects.toThrow(/forecast days must be between 1 and 210/i);
    });

    it('should reject forecast_days of 211', async () => {
      await expect(
        service.getRiverDischarge([35.125], [-90.125], 211)
      ).rejects.toThrow(/forecast days must be between 1 and 210/i);
    });

    it('should accept forecast_days of 1', async () => {
      vi.spyOn(service as any, 'makeRequestToFlood').mockResolvedValue(buildFloodResponse());

      await expect(
        service.getRiverDischarge([35.125], [-90.125], 1)
      ).resolves.toBeDefined();
    });

    it('should accept forecast_days of 210', async () => {
      vi.spyOn(service as any, 'makeRequestToFlood').mockResolvedValue(buildFloodResponse());

      await expect(
        service.getRiverDischarge([35.125], [-90.125], 210)
      ).resolves.toBeDefined();
    });

    it('should reject an invalid latitude', async () => {
      await expect(
        service.getRiverDischarge([91], [-90.125])
      ).rejects.toThrow(/Invalid latitude/i);
    });

    it('should reject an invalid longitude', async () => {
      await expect(
        service.getRiverDischarge([35.125], [181])
      ).rejects.toThrow(/Invalid longitude/i);
    });

    it('should reject mismatched array lengths', async () => {
      await expect(
        service.getRiverDischarge([35.125, 35.075], [-90.125])
      ).rejects.toThrow(/same length/i);
    });

    it('should reject empty coordinate arrays', async () => {
      await expect(
        service.getRiverDischarge([], [])
      ).rejects.toThrow(/at least one coordinate/i);
    });
  });

  describe('Response Normalization', () => {
    it('should normalize a bare object response (single coordinate) to a 1-element array', async () => {
      vi.spyOn(service as any, 'makeRequestToFlood').mockResolvedValue(buildFloodResponse());

      const result = await service.getRiverDischarge([35.125], [-90.125]);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].latitude).toBe(35.125);
    });

    it('should pass through an array response (multi-point) unchanged in shape', async () => {
      const responses = [buildFloodResponse(), buildFloodResponse({ longitude: -90.075 })];
      vi.spyOn(service as any, 'makeRequestToFlood').mockResolvedValue(responses);

      const result = await service.getRiverDischarge([35.125, 35.125], [-90.125, -90.075]);

      expect(result).toHaveLength(2);
      expect(result[1].longitude).toBe(-90.075);
    });

    it('should return an all-null series rather than throwing', async () => {
      vi.spyOn(service as any, 'makeRequestToFlood').mockResolvedValue(buildAllNullFloodResponse());

      const result = await service.getRiverDischarge([0], [-140]);

      expect(result).toHaveLength(1);
      expect(result[0].daily?.river_discharge).toEqual([null, null, null]);
    });
  });

  describe('Cache Behavior', () => {
    it('should cache the response and avoid a second network call on cache hit', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToFlood')
        .mockResolvedValue(buildFloodResponse());

      const first = await service.getRiverDischarge([35.125], [-90.125]);
      const second = await service.getRiverDischarge([35.125], [-90.125]);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('should keep entries for distinct forecast_days separate', async () => {
      const spy = vi
        .spyOn(service as any, 'makeRequestToFlood')
        .mockResolvedValue(buildFloodResponse());

      await service.getRiverDischarge([35.125], [-90.125], 7);
      await service.getRiverDischarge([35.125], [-90.125], 30);

      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
