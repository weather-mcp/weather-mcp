/**
 * Unit tests for pollen in get_air_quality current conditions (FE §6.1,
 * Europe-only via the CAMS model on the same Open-Meteo air-quality endpoint).
 *
 * Coverage contract, per the 2026-08-13 live viability check: European points
 * return real grains/m³ values; everywhere else returns HTTP 200 with every
 * species null — so the section must render only when at least one species
 * carries a real number, and the hourly fetch must stay trimmed to the three
 * variables the forecast formatter reads (v1.13).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetAirQuality } from '../../src/handlers/airQualityHandler.js';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { OpenMeteoAirQualityResponse } from '../../src/types/openmeteo.js';

const getAirQualityMock = vi.fn();

const openMeteoService = { getAirQuality: getAirQualityMock } as never;
const locationStore = {} as never;
const geocodingService = {} as never;

function buildResponse(pollen: Record<string, number | null | undefined>): OpenMeteoAirQualityResponse {
  return {
    latitude: 52.52,
    longitude: 13.405,
    generationtime_ms: 0.1,
    utc_offset_seconds: 7200,
    timezone: 'Europe/Berlin',
    timezone_abbreviation: 'CEST',
    elevation: 38,
    current_units: { time: 'iso8601', interval: 'seconds', us_aqi: '', pm2_5: 'μg/m³' },
    current: {
      time: '2026-08-13T15:00',
      interval: 3600,
      us_aqi: 42,
      european_aqi: 30,
      pm2_5: 8,
      ...pollen
    }
  } as OpenMeteoAirQualityResponse;
}

function callHandler() {
  return handleGetAirQuality(
    { latitude: 52.52, longitude: 13.405 },
    openMeteoService,
    locationStore,
    geocodingService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

describe('get_air_quality — pollen section (Europe-only, CAMS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the section with all species carrying values', async () => {
    getAirQualityMock.mockResolvedValue(buildResponse({
      alder_pollen: 0.5,
      birch_pollen: 12.3,
      grass_pollen: 45,
      mugwort_pollen: 3.14,
      olive_pollen: 0,
      ragweed_pollen: 88.88
    }));

    const text = textOf(await callHandler());

    expect(text).toContain('## 🌾 Pollen');
    expect(text).toContain('**Alder:** 0.5 grains/m³');
    expect(text).toContain('**Birch:** 12.3 grains/m³');
    expect(text).toContain('**Grass:** 45 grains/m³');
    expect(text).toContain('**Mugwort:** 3.1 grains/m³');
    // Zero is meaningful in-season ("none detected") and must render.
    expect(text).toContain('**Olive:** 0 grains/m³');
    expect(text).toContain('**Ragweed:** 88.9 grains/m³');
    expect(text).toContain(
      '*Pollen from the CAMS European forecast — available for European locations only.*'
    );
  });

  it('renders only the non-null species when the model covers a subset', async () => {
    getAirQualityMock.mockResolvedValue(buildResponse({
      grass_pollen: 30,
      birch_pollen: null,
      alder_pollen: null
    }));

    const text = textOf(await callHandler());

    expect(text).toContain('## 🌾 Pollen');
    expect(text).toContain('**Grass:** 30 grains/m³');
    expect(text).not.toContain('**Birch:**');
    expect(text).not.toContain('**Alder:**');
  });

  it('renders no section when every species is null (non-European point, HTTP 200)', async () => {
    getAirQualityMock.mockResolvedValue(buildResponse({
      alder_pollen: null,
      birch_pollen: null,
      grass_pollen: null,
      mugwort_pollen: null,
      olive_pollen: null,
      ragweed_pollen: null
    }));

    const text = textOf(await callHandler());

    expect(text).not.toContain('Pollen');
    expect(text).not.toContain('grains/m³');
  });

  it('renders no section when the pollen fields are absent entirely', async () => {
    getAirQualityMock.mockResolvedValue(buildResponse({}));

    const text = textOf(await callHandler());

    expect(text).not.toContain('Pollen');
  });
});

describe('OpenMeteoService.getAirQuality() pollen params', () => {
  function buildMinimalResponse(): OpenMeteoAirQualityResponse {
    return {
      latitude: 52.52,
      longitude: 13.405,
      generationtime_ms: 0.1,
      utc_offset_seconds: 7200,
      timezone: 'Europe/Berlin',
      timezone_abbreviation: 'CEST',
      elevation: 38,
      current_units: { time: 'iso8601', interval: 'seconds', us_aqi: '' },
      current: { time: '2026-08-13T15:00', interval: 3600, us_aqi: 42 },
      hourly_units: { time: 'iso8601', us_aqi: '' },
      hourly: { time: ['2026-08-13T00:00'], us_aqi: [40], european_aqi: [20], uv_index: [1] }
    } as OpenMeteoAirQualityResponse;
  }

  it('requests all six pollen species in the current block', async () => {
    const service = new OpenMeteoService();
    service.clearCache();
    const spy = vi
      .spyOn(service as unknown as { makeRequestToAirQuality: () => void }, 'makeRequestToAirQuality')
      .mockResolvedValue(buildMinimalResponse() as never);

    await service.getAirQuality(52.52, 13.405, false, 5);

    const params = (spy.mock.calls[0] as unknown as [string, Record<string, string | number>])[1];
    const current = String(params.current);
    for (const species of [
      'alder_pollen', 'birch_pollen', 'grass_pollen',
      'mugwort_pollen', 'olive_pollen', 'ragweed_pollen'
    ]) {
      expect(current).toContain(species);
    }
  });

  it('keeps the hourly fetch trimmed to the three forecast variables (v1.13)', async () => {
    const service = new OpenMeteoService();
    service.clearCache();
    const spy = vi
      .spyOn(service as unknown as { makeRequestToAirQuality: () => void }, 'makeRequestToAirQuality')
      .mockResolvedValue(buildMinimalResponse() as never);

    await service.getAirQuality(52.52, 13.405, true, 5);

    const params = (spy.mock.calls[0] as unknown as [string, Record<string, string | number>])[1];
    expect(params.hourly).toBe('us_aqi,european_aqi,uv_index');
  });
});
