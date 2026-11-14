/**
 * The Open-Meteo historical headings name a wall-clock day or hour, not an
 * instant. They must render identically in every process zone, and equal to
 * what the old expression printed on a UTC server. Driven through
 * handleGetHistoricalWeather (G45). Expectations are computed under TZ=UTC
 * with the old expression, never pasted (G75).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleGetHistoricalWeather } from '../../src/handlers/historicalWeatherHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
});
function inZone<T>(zone: string, fn: () => T): T {
  process.env.TZ = zone;
  return fn();
}
async function inZoneAsync<T>(zone: string, fn: () => Promise<T>): Promise<T> {
  process.env.TZ = zone;
  return fn();
}

const ZONES = ['UTC', 'America/New_York', 'Pacific/Auckland'];
const LONDON = { latitude: 51.5074, longitude: -0.1278 }; // outside NOAA coverage

const DAILY_TIMES = ['2024-03-05', '2024-03-06'];
const HOURLY_TIMES = ['2024-03-10T01:00', '2024-03-10T02:00', '2024-03-10T03:00'];

function response(kind: 'daily' | 'hourly') {
  const base = {
    latitude: LONDON.latitude,
    longitude: LONDON.longitude,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'Etc/UTC',
    timezone_abbreviation: 'UTC',
    elevation: 11,
  };
  return kind === 'daily'
    ? { ...base, daily: { time: DAILY_TIMES, temperature_2m_max: [10, 11], temperature_2m_min: [1, 2] } }
    : { ...base, hourly: { time: HOURLY_TIMES, temperature_2m: [5, 6, 7] } };
}

async function render(kind: 'daily' | 'hourly'): Promise<string> {
  const noaa = { getHistoricalObservations: vi.fn().mockResolvedValue({ features: [] }) };
  const openMeteo = {
    getHistoricalWeather: vi.fn().mockResolvedValue(response(kind)),
    getWeatherDescription: vi.fn((c: number) => `WX-${c}`),
  };
  const args = kind === 'daily'
    ? { ...LONDON, start_date: '2024-02-01', end_date: '2024-03-15' }
    : { ...LONDON, start_date: '2024-03-09', end_date: '2024-03-11' };
  const result = await handleGetHistoricalWeather(
    args,
    noaa as unknown as NOAAService,
    openMeteo as unknown as OpenMeteoService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService
  );
  return result.content.map(b => b.text).join('\n');
}

function headings(text: string): string[] {
  return text.split('\n').filter(l => l.startsWith('## ')).map(l => l.slice(3));
}

const DAILY_REFERENCE = inZone('UTC', () => DAILY_TIMES.map(s => new Date(s).toLocaleDateString()));
const HOURLY_REFERENCE = inZone('UTC', () => HOURLY_TIMES.map(h => new Date(h).toLocaleString()));

describe('historical Open-Meteo headings are zone independent', () => {
  it.each(ZONES)('daily headings equal the TZ=UTC reference in %s', async zone => {
    const text = await inZoneAsync(zone, () => render('daily'));
    if (zone === 'America/New_York') {
      expect(new Date('2024-03-05').getDate()).toBe(4); // sentinel: the zone switch took (G41)
    }
    expect(headings(text)).toEqual(DAILY_REFERENCE);
    expect(DAILY_REFERENCE).toHaveLength(2);
  });

  it.each(ZONES)('hourly headings equal the TZ=UTC reference in %s', async zone => {
    const text = await inZoneAsync(zone, () => render('hourly'));
    if (zone === 'America/New_York') {
      expect(new Date('2024-03-05').getDate()).toBe(4);
    }
    expect(headings(text)).toEqual(HOURLY_REFERENCE);
  });

  it('hourly headings stay pairwise distinct in America/New_York (spring-forward hour)', async () => {
    const text = await inZoneAsync('America/New_York', () => render('hourly'));
    expect(new Date('2024-03-05').getDate()).toBe(4);
    const h = headings(text);
    expect(h).toHaveLength(3);
    expect(new Set(h).size).toBe(3);
  });
});
