/**
 * The NOAA alert path's render order and its all-clear text, driven through
 * the real `handleGetAlerts`.
 *
 * Replaces `alert-sorting.test.ts`, which sorted with a local copy of the
 * algorithm and imported nothing from `src/`. Here the order is read from the
 * rendered output of `handleNoaaAlerts` (`src/handlers/alertsHandler.ts`),
 * reached with four arguments and a US point: no country code and no
 * Nominatim, so `isInUS` routes to NOAA and no banner fetch runs.
 *
 * Event names are distinct and none is a substring of another or of any
 * header text, so each `**<event>**` occurs once (G96). No fixture carries a
 * `headline`, which would render the name a second time.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

interface AlertSpec {
  event: string;
  severity?: string;
}

function buildFeature(spec: AlertSpec): unknown {
  const properties: Record<string, unknown> = {
    event: spec.event,
    urgency: 'Expected',
    certainty: 'Likely',
    areaDesc: 'Test County',
    effective: '2026-07-13T12:00:00Z',
    expires: '2026-07-13T18:00:00Z',
    response: 'Monitor',
    senderName: 'NWS Test Office',
  };
  if (spec.severity !== undefined) {
    properties.severity = spec.severity;
  }
  return { properties };
}

function makeNoaaStub(specs: AlertSpec[]): NOAAService {
  return {
    getStations: vi.fn(async () => ({ features: [] })),
    getAlerts: vi.fn(async () => ({
      updated: '2026-07-13T12:00:00Z',
      features: specs.map(buildFeature),
    })),
  } as unknown as NOAAService;
}

const store = {} as unknown as LocationStore;
const geocoding = {} as unknown as GeocodingService;

async function renderAlerts(specs: AlertSpec[]): Promise<string> {
  const result = await handleGetAlerts(
    { latitude: 40, longitude: -100 },
    makeNoaaStub(specs),
    store,
    geocoding
  );
  return result.content[0].text;
}

/** Positions of each `**<event>**` in the text; every name must occur exactly once. */
function positions(text: string, events: string[]): number[] {
  return events.map(event => {
    const marker = `**${event}**`;
    const first = text.indexOf(marker);
    expect(first, `${marker} missing`).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(marker, first + 1), `${marker} occurs twice`).toBe(-1);
    return first;
  });
}

function expectStrictlyIncreasing(values: number[]): void {
  for (let i = 1; i < values.length; i++) {
    expect(values[i]).toBeGreaterThan(values[i - 1]);
  }
}

describe('get_alerts NOAA path — render order', () => {
  it('renders Extreme, Severe, Moderate, Minor, then the rank-4 alerts, from a scrambled feed', async () => {
    const text = await renderAlerts([
      { event: 'Minor Mike', severity: 'Minor' },
      { event: 'Unknown Uma', severity: 'Unknown' },
      { event: 'Severe Sam', severity: 'Severe' },
      { event: 'Extreme Eve', severity: 'Extreme' },
      { event: 'Moderate Mo', severity: 'Moderate' },
      { event: 'Severe Sue', severity: 'Severe' },
      { event: 'Catastrophic Cat', severity: 'Catastrophic' },
    ]);

    expect(text).toContain('⚠️ **7 active alerts found**');
    expectStrictlyIncreasing(
      positions(text, [
        'Extreme Eve',
        'Severe Sam',
        'Severe Sue',
        'Moderate Mo',
        'Minor Mike',
        'Unknown Uma',
        'Catastrophic Cat',
      ])
    );
  });

  it('keeps feed order among alerts of equal severity', async () => {
    const text = await renderAlerts([
      { event: 'Charlie Storm', severity: 'Severe' },
      { event: 'Alpha Storm', severity: 'Severe' },
      { event: 'Bravo Storm', severity: 'Severe' },
    ]);

    expectStrictlyIncreasing(positions(text, ['Charlie Storm', 'Alpha Storm', 'Bravo Storm']));
  });

  it('sorts an out-of-table or absent severity after Minor without throwing', async () => {
    const text = await renderAlerts([
      { event: 'Catastrophic Cat', severity: 'Catastrophic' },
      { event: 'Absent Abe' },
      { event: 'Minor Mike', severity: 'Minor' },
    ]);

    const [minor, catastrophic, absent] = positions(text, [
      'Minor Mike',
      'Catastrophic Cat',
      'Absent Abe',
    ]);
    expect(catastrophic).toBeGreaterThan(minor);
    expect(absent).toBeGreaterThan(minor);
    // Both rank 4, so they keep feed order between themselves.
    expect(absent).toBeGreaterThan(catastrophic);
  });
});

describe('get_alerts NOAA path — all-clear', () => {
  it('renders both all-clear lines whole for an empty feed, and no alert header', async () => {
    const text = await renderAlerts([]);

    expect(text).toContain(
      '✅ **No active weather alerts for this location.**\n\n' +
        'The area is currently clear of weather warnings, watches, and advisories.\n'
    );
    expect(text).not.toContain('active alert');
  });
});
