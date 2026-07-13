/**
 * Unit tests for the get_weather_summary composite handler.
 *
 * The sub-handlers are mocked so these tests focus on the summary handler's own
 * behavior: section selection, aggregation, single location resolution, and
 * graceful degradation when a section fails.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const currentMock = vi.fn();
const forecastMock = vi.fn();
const alertsMock = vi.fn();
const airQualityMock = vi.fn();
const lightningMock = vi.fn();

vi.mock('../../src/handlers/currentConditionsHandler.js', () => ({
  handleGetCurrentConditions: (...args: unknown[]) => currentMock(...args),
}));
vi.mock('../../src/handlers/forecastHandler.js', () => ({
  handleGetForecast: (...args: unknown[]) => forecastMock(...args),
}));
vi.mock('../../src/handlers/alertsHandler.js', () => ({
  handleGetAlerts: (...args: unknown[]) => alertsMock(...args),
}));
vi.mock('../../src/handlers/airQualityHandler.js', () => ({
  handleGetAirQuality: (...args: unknown[]) => airQualityMock(...args),
}));
vi.mock('../../src/handlers/lightningHandler.js', () => ({
  handleGetLightningActivity: (...args: unknown[]) => lightningMock(...args),
}));

import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';

function textResult(text: string) {
  return { content: [{ type: 'text', text }] };
}

const services = {
  noaa: {} as any,
  openMeteo: {} as any,
  ncei: {} as any,
  // Coordinate input means resolveLocationAsync never touches these
  locationStore: {} as any,
  geocoding: {} as any,
};

function callSummary(args: Record<string, unknown>) {
  return handleGetWeatherSummary(
    args,
    services.noaa,
    services.openMeteo,
    services.ncei,
    services.locationStore,
    services.geocoding
  );
}

describe('handleGetWeatherSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMock.mockResolvedValue(textResult('# Current Weather Conditions\nSunny'));
    forecastMock.mockResolvedValue(textResult('# Weather Forecast (Daily)\nWarm'));
    alertsMock.mockResolvedValue(textResult('# Weather Alerts\nNone'));
    airQualityMock.mockResolvedValue(textResult('# Air Quality Report\nGood'));
    lightningMock.mockResolvedValue(textResult('# Lightning Activity Report\nSafe'));
  });

  it('includes current, forecast, and alerts by default', async () => {
    const result = await callSummary({ latitude: 47.6, longitude: -122.3 });
    const text = result.content[0].text;

    expect(text).toContain('# Weather Summary');
    expect(text).toContain('**Includes:** current, forecast, alerts');
    expect(text).toContain('Current Weather Conditions');
    expect(text).toContain('Weather Forecast');
    expect(text).toContain('Weather Alerts');

    expect(currentMock).toHaveBeenCalledTimes(1);
    expect(forecastMock).toHaveBeenCalledTimes(1);
    expect(alertsMock).toHaveBeenCalledTimes(1);
    expect(airQualityMock).not.toHaveBeenCalled();
    expect(lightningMock).not.toHaveBeenCalled();
  });

  it('honors an explicit include list', async () => {
    const result = await callSummary({
      latitude: 47.6,
      longitude: -122.3,
      include: ['forecast', 'air_quality'],
    });
    const text = result.content[0].text;

    expect(text).toContain('**Includes:** forecast, air_quality');
    expect(forecastMock).toHaveBeenCalledTimes(1);
    expect(airQualityMock).toHaveBeenCalledTimes(1);
    expect(currentMock).not.toHaveBeenCalled();
    expect(alertsMock).not.toHaveBeenCalled();
  });

  it('passes resolved coordinates (not a name) to every sub-handler', async () => {
    await callSummary({ latitude: 47.6, longitude: -122.3 });

    const firstCallArgs = forecastMock.mock.calls[0][0] as Record<string, unknown>;
    expect(firstCallArgs.latitude).toBe(47.6);
    expect(firstCallArgs.longitude).toBe(-122.3);
    // location_name/city_name stripped so no sub-handler re-geocodes
    expect(firstCallArgs.location_name).toBeUndefined();
    expect(firstCallArgs.city_name).toBeUndefined();
  });

  it('degrades gracefully when a section fails', async () => {
    alertsMock.mockRejectedValue(new Error('alerts unavailable outside the US'));

    const result = await callSummary({ latitude: 48.85, longitude: 2.35 });
    const text = result.content[0].text;

    expect(text).toContain('alerts (unavailable)');
    expect(text).toContain('alerts unavailable outside the US');
    // Other sections still render
    expect(text).toContain('Current Weather Conditions');
    expect(text).toContain('Weather Forecast');
  });

  it('rejects an invalid include entry', async () => {
    await expect(
      callSummary({ latitude: 47.6, longitude: -122.3, include: ['forecast', 'bogus'] })
    ).rejects.toThrow(/invalid include/i);
  });

  it('falls back to defaults for an empty include array', async () => {
    await callSummary({ latitude: 47.6, longitude: -122.3, include: [] });

    expect(currentMock).toHaveBeenCalledTimes(1);
    expect(forecastMock).toHaveBeenCalledTimes(1);
    expect(alertsMock).toHaveBeenCalledTimes(1);
  });
});
