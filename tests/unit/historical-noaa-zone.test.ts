/**
 * NOAA historical observation times are instants. They print in the
 * location's zone (not the server's) with the same format as before, and the
 * zone is named under the data source. Driven through
 * handleGetHistoricalWeather (G45). References are computed under the
 * location's own zone with the old expression, never pasted (G75), and are
 * compared with U+202F / U+00A0 normalised on both sides.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleGetHistoricalWeather } from '../../src/handlers/historicalWeatherHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import { isInUS } from '../../src/utils/geography.js';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
});

const ZONES = ['UTC', 'America/New_York', 'Pacific/Auckland'];
const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };
const HONOLULU = { latitude: 21.3069, longitude: -157.8583 };
const GAMBELL = { latitude: 63.78, longitude: -171.74 };

const norm = (s: string): string => s.replace(/[  ]/g, ' ');

/** The old expression, evaluated with the process zone set to `zone`. */
function oldExpression(zone: string, ts: string): string {
  process.env.TZ = zone;
  return norm(new Date(ts).toLocaleString());
}

function noaaFeature(timestamp: string) {
  return {
    properties: {
      timestamp,
      temperature: { unitCode: 'wmoUnit:degC', value: 20 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 10 },
      textDescription: 'Clear',
    },
  };
}

async function run(
  processZone: string,
  coords: { latitude: number; longitude: number },
  timestamps: string[],
  range: { start_date: string; end_date: string },
  clock: string
): Promise<string> {
  process.env.TZ = processZone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(clock));
  const noaa = {
    getHistoricalObservations: vi.fn().mockResolvedValue({ features: timestamps.map(noaaFeature) }),
  };
  const openMeteo = { getHistoricalWeather: vi.fn(), getWeatherDescription: vi.fn() };
  const result = await handleGetHistoricalWeather(
    { ...coords, ...range },
    noaa as unknown as NOAAService,
    openMeteo as unknown as OpenMeteoService,
    {} as unknown as LocationStore,
    {} as unknown as GeocodingService
  );
  expect(openMeteo.getHistoricalWeather).not.toHaveBeenCalled();
  return norm(result.content.map(b => b.text).join('\n'));
}

const NEWEST = '2025-11-08T03:00:00Z'; // 7 PM Nov 7 in Los Angeles
const OLDER = '2025-11-07T20:00:00Z';
const SEATTLE_RANGE = { start_date: '2025-11-07T00:00:00Z', end_date: '2025-11-09T12:00:00Z' };
const CLOCK = '2025-11-09T12:00:00Z';

function noteLine(text: string): string {
  const line = text.split('\n').find(l => l.startsWith('*Observations end '));
  expect(line).toBeDefined();
  return line as string;
}

describe('NOAA historical instants print in the location zone', () => {
  it('fixture can tell the zones apart (non-vacuity)', () => {
    const la = oldExpression('America/Los_Angeles', NEWEST);
    expect(oldExpression('UTC', NEWEST)).not.toBe(la);
    expect(oldExpression('Pacific/Auckland', NEWEST)).not.toBe(la);
  });

  describe.each(ZONES)('(a) Seattle, process zone %s', zone => {
    it('prints headings, stale note and zone line in America/Los_Angeles', async () => {
      const refNewest = oldExpression('America/Los_Angeles', NEWEST);
      const refOlder = oldExpression('America/Los_Angeles', OLDER);
      process.env.TZ = zone;
      if (zone === 'America/New_York') {
        expect(new Date('2024-03-05').getDate()).toBe(4); // sentinel (G41, G162)
      }
      const text = await run(zone, SEATTLE, [NEWEST, OLDER], SEATTLE_RANGE, CLOCK);
      expect(text).toContain(`## ${refNewest}\n`);
      expect(text).toContain(`## ${refOlder}\n`);
      expect(noteLine(text)).toBe(
        `*Observations end ${refNewest}; the reporting station may have gone offline.*`
      );
      expect(text).toContain('**Data source:** NOAA Real-time API\n**Timezone:** America/Los_Angeles\n\n');
    });
  });

  describe.each(ZONES)('(b) Honolulu, process zone %s', zone => {
    it('prints in Pacific/Honolulu, not a hard-coded zone', async () => {
      expect(isInUS(HONOLULU.latitude, HONOLULU.longitude)).toBe(true);
      const ref = oldExpression('Pacific/Honolulu', NEWEST);
      expect(ref).not.toBe(oldExpression('America/Los_Angeles', NEWEST));
      const text = await run(zone, HONOLULU, [NEWEST], SEATTLE_RANGE, CLOCK);
      expect(text).toContain(`## ${ref}\n`);
      expect(text).toContain('**Timezone:** Pacific/Honolulu\n');
    });
  });

  describe.each(ZONES)('(c) byte-identity, process zone %s', zone => {
    it('headings equal the old expression under the location zone', async () => {
      const text = await run(zone, SEATTLE, [NEWEST, OLDER], SEATTLE_RANGE, CLOCK);
      const headings = text.split('\n').filter(l => l.startsWith('## '));
      expect(headings).toEqual([
        `## ${oldExpression('America/Los_Angeles', NEWEST)}`,
        `## ${oldExpression('America/Los_Angeles', OLDER)}`,
      ]);
      const stripped = text.replace(/\*\*Timezone:\*\* [^\n]*\n/, '');
      expect(stripped).toContain('**Data source:** NOAA Real-time API\n\n');
    });
  });

  it('(c) under TZ=America/Los_Angeles the whole output equals the old expressions', async () => {
    const text = await run('America/Los_Angeles', SEATTLE, [NEWEST, OLDER], SEATTLE_RANGE, CLOCK);
    const newest = oldExpression('America/Los_Angeles', NEWEST);
    expect(text).toContain(`## ${newest}\n`);
    expect(noteLine(text)).toBe(
      `*Observations end ${newest}; the reporting station may have gone offline.*`
    );
  });

  describe.each(ZONES)('(d) Gambell, process zone %s', zone => {
    it('uses America/Nome (the point the plain tz-lookup answer gets wrong)', async () => {
      expect(isInUS(GAMBELL.latitude, GAMBELL.longitude)).toBe(true);
      const ref = oldExpression('America/Nome', NEWEST);
      const text = await run(zone, GAMBELL, [NEWEST], SEATTLE_RANGE, CLOCK);
      expect(text).toContain('**Timezone:** America/Nome\n');
      expect(text).toContain(`## ${ref}\n`);
    });
  });
});
