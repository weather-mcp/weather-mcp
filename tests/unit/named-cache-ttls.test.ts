/**
 * Named cache TTLs: the three new CacheConfig.ttl entries are pinned by literal,
 * the NIFC perimeter cache expires on the 30-minute clock, and the Open-Meteo
 * forecast / air-quality / marine writes pass the named TTL to Cache.set.
 *
 * Expected values are literals on purpose (G160): a fixture computed from the
 * constant would move with a mutation of it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { CacheConfig } from '../../src/config/cache.js';
import { NIFCService } from '../../src/services/nifc.js';
import { OpenMeteoService } from '../../src/services/openmeteo.js';

describe('CacheConfig.ttl value pins', () => {
  it('firePerimeters is 30 minutes', () => {
    expect(CacheConfig.ttl.firePerimeters).toBe(1_800_000);
  });

  it('airQuality is 1 hour', () => {
    expect(CacheConfig.ttl.airQuality).toBe(3_600_000);
  });

  it('marine is 1 hour', () => {
    expect(CacheConfig.ttl.marine).toBe(3_600_000);
  });

  it('firePerimeters and firmsAreaQuery are separate keys', () => {
    expect(Object.keys(CacheConfig.ttl)).toContain('firePerimeters');
    expect(Object.keys(CacheConfig.ttl)).toContain('firmsAreaQuery');
  });
});

describe('NIFC perimeter cache expiry', () => {
  const T0 = Date.parse('2026-08-01T12:00:00Z');
  const BODY = { features: [{ attributes: { poly_IncidentName: 'TEST' } }] };

  function stubGet(service: NIFCService, body: unknown) {
    return vi
      .spyOn((service as unknown as { client: { get: (...a: unknown[]) => unknown } }).client, 'get')
      .mockResolvedValue({ data: body, status: 200 });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('serves the same bbox from cache at 29 minutes', async () => {
    expect(CacheConfig.enabled).toBe(true);
    const service = new NIFCService();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const get = stubGet(service, BODY);

    await service.queryFirePerimeters(-117, 43, -116, 44);
    vi.setSystemTime(T0 + 29 * 60_000);
    await service.queryFirePerimeters(-117, 43, -116, 44);

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('refetches the same bbox at 31 minutes', async () => {
    expect(CacheConfig.enabled).toBe(true);
    const service = new NIFCService();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const get = stubGet(service, BODY);

    await service.queryFirePerimeters(-117, 43, -116, 44);
    vi.setSystemTime(T0 + 31 * 60_000);
    await service.queryFirePerimeters(-117, 43, -116, 44);

    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('Open-Meteo cache writes use the named TTLs', () => {
  function setSpyOf(service: OpenMeteoService) {
    return vi.spyOn((service as unknown as { cache: { set: (...a: unknown[]) => void } }).cache, 'set');
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getForecast caches for 7_200_000 ms', async () => {
    const service = new OpenMeteoService();
    service.clearCache();
    const setSpy = setSpyOf(service);
    vi.spyOn(service as any, 'makeRequestToForecast').mockResolvedValue({
      latitude: 39.7392,
      longitude: -104.9903,
      timezone: 'America/Denver',
      daily: { time: ['2026-08-16'], temperature_2m_max: [84], temperature_2m_min: [62] }
    });

    await service.getForecast(39.7392, -104.9903);

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][2]).toBe(7_200_000);
  });

  it('getAirQuality caches for 3_600_000 ms', async () => {
    const service = new OpenMeteoService();
    service.clearCache();
    const setSpy = setSpyOf(service);
    vi.spyOn(service as any, 'makeRequestToAirQuality').mockResolvedValue({
      latitude: 39.7392,
      longitude: -104.9903,
      current: { time: '2026-08-16T12:00', us_aqi: 40 }
    });

    await service.getAirQuality(39.7392, -104.9903);

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][2]).toBe(3_600_000);
  });

  it('getMarine caches for 3_600_000 ms', async () => {
    const service = new OpenMeteoService();
    service.clearCache();
    const setSpy = setSpyOf(service);
    vi.spyOn(service as any, 'makeRequestToMarine').mockResolvedValue({
      latitude: 40,
      longitude: -70,
      current: { time: '2026-08-16T12:00', wave_height: 1.2 }
    });

    await service.getMarine(40, -70);

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][2]).toBe(3_600_000);
  });
});
