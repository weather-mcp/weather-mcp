/**
 * NOAA alert times name their zone (plan-noaa-alert-time-zone, run-order row 106).
 *
 * Every time the NOAA `get_alerts` path prints — `**Updated:**`, `**Effective:**`,
 * `**Expires:**`, `**Onset:**`, `**Ends:**` — ends in the zone abbreviation for that
 * instant (`formatInTimezoneWithZone`). A DST straddle labels each end on its own,
 * the label follows the zone the render actually used (station zone, else the
 * coordinate fallback), and the omission rules are unchanged. Also pinned through
 * `get_weather_summary`'s alerts section (G19).
 *
 * Fixture seams are copied from tests/unit/alerts-territory-routing.test.ts and
 * tests/unit/dateline-timezone-render.test.ts, never imported: those files are locks.
 * Lines are extracted with an anchored regex and their AM/PM separator normalised
 * before comparison (G96, G75).
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { NationalCapService } from '../../src/services/nationalCap.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHICAGO = { latitude: 41.88, longitude: -87.63 };
const HAGATNA = { latitude: 13.47, longitude: 144.75 };

function normalise(s: string): string {
  return s.replace(/[  ]/g, ' ');
}

/** Every line carrying `label`, captured to end of line (anchored, multi-line). */
function lines(text: string, label: string): string[] {
  const re = new RegExp(`^\\*\\*${label}:\\*\\* (.+)$`, 'gm');
  return [...text.matchAll(re)].map(m => m[1]);
}

/** The single line carrying `label`; throws when it is absent or repeated. */
function line(text: string, label: string): string {
  const found = lines(text, label);
  if (found.length !== 1) {
    throw new Error(`expected one ${label} line, found ${found.length} in: ${JSON.stringify(text)}`);
  }
  return found[0];
}

function alert(properties: Record<string, unknown>) {
  return {
    properties: {
      event: 'Winter Storm Warning',
      severity: 'Severe',
      urgency: 'Expected',
      certainty: 'Likely',
      response: 'Prepare',
      senderName: 'NWS Chicago IL',
      areaDesc: 'Cook',
      headline: 'Winter Storm Warning issued',
      ...properties
    }
  };
}

function makeNoaaFake(options: {
  stationZone?: string;
  updated?: string;
  features?: Array<ReturnType<typeof alert>>;
}): NOAAService {
  const stationFeatures = options.stationZone
    ? [{ properties: { timeZone: options.stationZone } }]
    : [];
  return {
    getStations: vi.fn(async () => ({ features: stationFeatures })),
    getAlerts: vi.fn(async () => ({
      ...(options.updated !== undefined ? { updated: options.updated } : {}),
      features: options.features ?? []
    }))
  } as unknown as NOAAService;
}

const emptyStore = { get: vi.fn(() => undefined) } as unknown as LocationStore;
const emptyGeocoding = { search: vi.fn(async () => []) } as unknown as GeocodingService;

async function alertsText(point: { latitude: number; longitude: number }, noaa: NOAAService): Promise<string> {
  const result = await handleGetAlerts(
    { ...point },
    noaa,
    emptyStore,
    emptyGeocoding,
    undefined,
    undefined,
    undefined,
    undefined
  );
  expect(noaa.getAlerts).toHaveBeenCalledOnce();
  return normalise(result.content[0].text);
}

function nationalFake(): NationalCapService {
  return {
    getWarnings: vi.fn(async () => ({
      warnings: [],
      unavailableCount: 0,
      polygonUnavailableCount: 0,
      indexTrimmed: false
    }))
  } as unknown as NationalCapService;
}

async function summaryAlerts(point: { latitude: number; longitude: number }, noaa: NOAAService): Promise<string> {
  const result = await handleGetWeatherSummary(
    { ...point, include: ['alerts'] },
    noaa,
    {} as unknown as OpenMeteoService,
    {} as unknown as NCEIService,
    emptyStore,
    emptyGeocoding,
    undefined,
    undefined,
    undefined,
    undefined,
    nationalFake()
  );
  return normalise(result.content[0].text);
}

// ---------------------------------------------------------------------------
// get_alerts, NOAA path
// ---------------------------------------------------------------------------

describe('NOAA alert times carry the zone of each instant', () => {
  it('labels each end of a DST straddle on its own (CDT, then CST)', async () => {
    // US DST ends 2026-11-01 at 2:00 AM CDT (07:00Z).
    const noaa = makeNoaaFake({
      stationZone: 'America/Chicago',
      features: [alert({ effective: '2026-11-01T05:30:00Z', expires: '2026-11-01T09:00:00Z' })]
    });

    const text = await alertsText(CHICAGO, noaa);

    expect(line(text, 'Effective')).toBe('Nov 1, 2026, 12:30 AM CDT');
    expect(line(text, 'Expires')).toBe('Nov 1, 2026, 3:00 AM CST');
  });

  it('labels all five time lines, each exactly once', async () => {
    const noaa = makeNoaaFake({
      stationZone: 'America/Chicago',
      updated: '2026-11-28T15:00:00Z',
      features: [
        alert({
          effective: '2026-11-28T15:00:00Z',
          onset: '2026-11-28T18:00:00Z',
          expires: '2026-11-29T12:00:00Z',
          ends: '2026-11-29T18:00:00Z'
        })
      ]
    });

    const text = await alertsText(CHICAGO, noaa);

    for (const label of ['Updated', 'Effective', 'Expires', 'Onset', 'Ends']) {
      expect(line(text, label)).toMatch(/ C[SD]T$/);
    }
  });

  it('keeps the omission rules: no Onset when it equals Effective, no Ends or Updated when absent', async () => {
    const noaa = makeNoaaFake({
      stationZone: 'America/Chicago',
      features: [alert({ effective: '2026-11-28T15:00:00Z', onset: '2026-11-28T15:00:00Z', expires: '2026-11-29T12:00:00Z' })]
    });

    const text = await alertsText(CHICAGO, noaa);

    expect(lines(text, 'Onset')).toHaveLength(0);
    expect(lines(text, 'Ends')).toHaveLength(0);
    expect(lines(text, 'Updated')).toHaveLength(0);
    expect(line(text, 'Effective')).toMatch(/ CST$/);
    expect(line(text, 'Expires')).toMatch(/ CST$/);
  });

  it('follows the station zone over the coordinate fallback', async () => {
    const noaa = makeNoaaFake({
      stationZone: 'America/Denver',
      updated: '2026-11-28T15:00:00Z',
      features: [alert({ effective: '2026-11-28T15:00:00Z', expires: '2026-11-29T12:00:00Z' })]
    });

    const text = await alertsText(CHICAGO, noaa);

    for (const label of ['Updated', 'Effective', 'Expires']) {
      expect(line(text, label)).toMatch(/ M[SD]T$/);
    }
  });

  it('labels the Guam fallback zone with its GMT offset (G130: correct ICU output)', async () => {
    const noaa = makeNoaaFake({
      updated: '2026-11-28T00:00:00Z',
      features: [alert({ senderName: 'NWS Tiyan GU', effective: '2026-11-28T00:00:00Z', expires: '2026-11-28T12:00:00Z' })]
    });

    const text = await alertsText(HAGATNA, noaa);

    for (const label of ['Updated', 'Effective', 'Expires']) {
      expect(line(text, label)).toMatch(/ GMT\+10$/);
    }
  });

  it('labels the Updated line when there are no alerts, and leaves the none-found text unchanged', async () => {
    const noaa = makeNoaaFake({ stationZone: 'America/Chicago', updated: '2026-11-28T15:00:00Z' });

    const text = await alertsText(CHICAGO, noaa);

    expect(line(text, 'Updated')).toBe('Nov 28, 2026, 9:00 AM CST');
    expect(text).toContain(
      '✅ **No active weather alerts for this location.**\n\nThe area is currently clear of weather warnings, watches, and advisories.\n'
    );
  });
});

// ---------------------------------------------------------------------------
// get_weather_summary, alerts section (G19)
// ---------------------------------------------------------------------------

describe('get_weather_summary carries the labelled NOAA alert times', () => {
  it('renders the Effective line with its zone inside the alerts section', async () => {
    const noaa = makeNoaaFake({
      stationZone: 'America/Chicago',
      features: [alert({ effective: '2026-11-28T15:00:00Z', expires: '2026-11-29T12:00:00Z' })]
    });

    const text = await summaryAlerts(CHICAGO, noaa);

    expect(noaa.getAlerts).toHaveBeenCalledOnce();
    expect(line(text, 'Effective')).toBe('Nov 28, 2026, 9:00 AM CST');
    expect(line(text, 'Expires')).toBe('Nov 29, 2026, 6:00 AM CST');
  });
});
