/**
 * Typed Open-Meteo errors must stay typed on the historical path, so the
 * dispatch's formatErrorForUser renders the service's own message. Anything
 * else is wrapped with the historical prefix. Driven through
 * handleGetHistoricalWeather (G45).
 */
import { describe, it, expect, vi } from 'vitest';
import { handleGetHistoricalWeather } from '../../src/handlers/historicalWeatherHandler.js';
import {
  ApiError,
  DataNotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  formatErrorForUser,
} from '../../src/errors/ApiError.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

const LONDON = { latitude: 51.5074, longitude: -0.1278 }; // outside NOAA coverage
const ARGS = { ...LONDON, start_date: '2024-02-01', end_date: '2024-03-15' };

async function run(open: () => Promise<unknown>): Promise<unknown> {
  const noaa = { getHistoricalObservations: vi.fn().mockResolvedValue({ features: [] }) };
  const openMeteo = {
    getHistoricalWeather: vi.fn(open),
    getWeatherDescription: vi.fn((c: number) => `WX-${c}`),
  };
  try {
    await handleGetHistoricalWeather(
      ARGS,
      noaa as unknown as NOAAService,
      openMeteo as unknown as OpenMeteoService,
      {} as unknown as LocationStore,
      {} as unknown as GeocodingService
    );
  } catch (e) {
    return e;
  }
  throw new Error('handler did not reject');
}

const TYPED: Array<[string, () => ApiError]> = [
  ['RateLimitError', () => new RateLimitError('Open-Meteo', 60)],
  ['ServiceUnavailableError', () => new ServiceUnavailableError('Open-Meteo', 'down')],
  ['DataNotFoundError', () => new DataNotFoundError('Open-Meteo', 'no archive for that range')],
];

describe('historical Open-Meteo error class', () => {
  it.each(TYPED)('%s passes through as the same instance', async (_n, make) => {
    const err = make();
    const caught = await run(() => Promise.reject(err));
    expect(caught).toBe(err);
  });

  it.each(TYPED)('%s renders its own user message', async (_n, make) => {
    const err = make();
    const caught = await run(() => Promise.reject(err));
    expect(formatErrorForUser(caught as Error)).toBe(err.toUserMessage());
  });

  it('wraps a plain Error with the historical prefix', async () => {
    const caught = await run(() => Promise.reject(new Error('boom')));
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Unable to retrieve historical data: boom');
  });

  it('wraps the no-data response with the historical prefix', async () => {
    const caught = await run(() => Promise.resolve({
      latitude: LONDON.latitude, longitude: LONDON.longitude, timezone: 'Etc/UTC',
    }));
    expect((caught as Error).message).toBe(
      'Unable to retrieve historical data: No weather data available in response'
    );
  });
});
