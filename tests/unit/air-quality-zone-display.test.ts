/**
 * The air-quality `**Observation Time:**` line prints Open-Meteo's naive
 * wall-clock `current.time`. It must not move with the process zone (a DST
 * gap hour in the server's zone used to shift it). Driven through both
 * handleGetAirQuality and handleGetWeatherSummary (G19, G45). Expectations
 * are computed under TZ=UTC with the old expression (G75).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleGetAirQuality } from '../../src/handlers/airQualityHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
});

const ZONES = ['UTC', 'America/New_York', 'Pacific/Auckland'];
const POINT = { latitude: 52.52, longitude: 13.405 };
const CURRENT_TIME = '2024-03-10T02:00';

function airQualityResponse() {
  return {
    latitude: POINT.latitude,
    longitude: POINT.longitude,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'Europe/Berlin',
    timezone_abbreviation: 'CET',
    elevation: 34,
    current_units: { time: 'iso8601', interval: 'seconds' },
    current: { time: CURRENT_TIME, interval: 3600, european_aqi: 20, us_aqi: 30, pm10: 5, pm2_5: 3 },
    hourly_units: { time: 'iso8601' },
    hourly: { time: [] },
  };
}

function openMeteoFake() {
  return { getAirQuality: vi.fn().mockResolvedValue(airQualityResponse()) };
}

function observationLine(text: string): string {
  const line = text.split('\n').find(l => l.startsWith('**Observation Time:**'));
  if (!line) throw new Error('no Observation Time line');
  return line;
}

async function direct(): Promise<string> {
  const result = await handleGetAirQuality(
    { ...POINT, forecast: false },
    openMeteoFake() as never,
    {} as never,
    {} as never
  );
  return result.content.map(b => b.text).join('\n');
}

async function viaSummary(): Promise<string> {
  const result = await handleGetWeatherSummary(
    { ...POINT, include: ['air_quality'] },
    {} as never,
    openMeteoFake() as never,
    {} as never,
    {} as never,
    {} as never
  );
  return result.content.map(b => b.text).join('\n');
}

process.env.TZ = 'UTC';
const REFERENCE = `**Observation Time:** ${new Date(CURRENT_TIME).toLocaleString()}`;
if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;

describe.each([
  ['handleGetAirQuality', direct],
  ['handleGetWeatherSummary (include air_quality)', viaSummary],
])('Observation Time via %s', (_name, run) => {
  it.each(ZONES)('equals the TZ=UTC reference in %s', async zone => {
    process.env.TZ = zone;
    if (zone === 'America/New_York') {
      expect(new Date('2024-03-05').getDate()).toBe(4); // sentinel (G41)
    }
    const text = await run();
    expect(observationLine(text)).toBe(REFERENCE);
  });
});
