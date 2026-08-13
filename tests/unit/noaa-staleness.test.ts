/**
 * NOAA current-conditions staleness handling (F2/D2a–c).
 *
 * Exercises handleGetCurrentConditions with plain fake services (no HTTP) to
 * prove the fresher-station retry loop and its rendering:
 *   - D2a: the observation age always renders beside the timestamp
 *   - D2b: a stale-observation warning appears past staleWarningMinutes
 *   - D2c: a stale nearest station is passed over for a fresh neighbor, with
 *     a substitution note; fetch errors keep today's silent-skip behavior
 *   - the retry loop fetches at most maxStationAttempts observations
 *
 * Fake/fixture patterns follow tests/unit/current-conditions-global.test.ts.
 * The clock is pinned (Date only) so observation ages are deterministic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGetCurrentConditions } from '../../src/handlers/currentConditionsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { ObservationResponse, StationCollectionResponse } from '../../src/types/noaa.js';

/** Washington, DC — inside the US routing boxes, so auto routes to NOAA. */
const US_COORDS = { latitude: 38.8951, longitude: -77.0364 };

/** Pinned "now" for deterministic observation ages. */
const NOW = new Date('2026-08-13T12:00:00Z');

/** Minutes-ago helper against the pinned clock. */
function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function buildObservation(stationId: string, timestamp: string): ObservationResponse {
  return {
    properties: {
      '@id': `https://api.weather.gov/stations/${stationId}/observations/${timestamp}`,
      '@type': 'wx:ObservationStation',
      elevation: { unitCode: 'wmoUnit:m', value: 10 },
      station: `https://api.weather.gov/stations/${stationId}`,
      timestamp,
      textDescription: 'Sunny',
      temperature: { unitCode: 'wmoUnit:degC', value: 20 },
      dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
      windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 270 },
      windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 10 },
      relativeHumidity: { unitCode: 'wmoUnit:percent', value: 50 },
    },
  } as unknown as ObservationResponse;
}

function buildStations(ids: Array<[id: string, name: string]>): StationCollectionResponse {
  return {
    type: 'FeatureCollection',
    features: ids.map(([stationIdentifier, name]) => ({
      properties: {
        '@id': `https://api.weather.gov/stations/${stationIdentifier}`,
        '@type': 'wx:ObservationStation',
        elevation: { unitCode: 'wmoUnit:m', value: 10 },
        stationIdentifier,
        name,
        timeZone: 'America/New_York',
      },
    })) as unknown as StationCollectionResponse['features'],
  };
}

/**
 * NOAA fake whose getLatestObservation resolves/rejects per-station.
 * `observations` maps station id -> observation or 'error'.
 */
function buildNoaaFake(
  stations: StationCollectionResponse,
  observations: Record<string, ObservationResponse | 'error'>
) {
  return {
    getStations: vi.fn().mockResolvedValue(stations),
    getLatestObservation: vi.fn().mockImplementation((stationId: string) => {
      const entry = observations[stationId];
      if (entry === undefined || entry === 'error') {
        return Promise.reject(new Error(`fetch failed for ${stationId}`));
      }
      return Promise.resolve(entry);
    }),
    getGridpointDataByCoordinates: vi.fn().mockResolvedValue({ properties: {} }),
  };
}

function buildSupportFakes() {
  return {
    openMeteo: {
      getCurrentConditions: vi.fn(),
      getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
    },
    ncei: { isAvailable: vi.fn().mockReturnValue(false) },
    locationStore: {},
    geocoding: {},
  };
}

function callHandler(noaa: ReturnType<typeof buildNoaaFake>) {
  const support = buildSupportFakes();
  return handleGetCurrentConditions(
    { ...US_COORDS },
    noaa as unknown as NOAAService,
    support.openMeteo as unknown as OpenMeteoService,
    support.ncei as unknown as NCEIService,
    support.locationStore as unknown as LocationStore,
    support.geocoding as unknown as GeocodingService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

const STALE_WARNING = '⚠️ **This observation is';
const SUBSTITUTION = '*Nearest station';

describe('NOAA current-conditions staleness (F2/D2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the age suffix with no warning or retry for a fresh observation', async () => {
    const stations = buildStations([['KAAA', 'Alpha Field'], ['KBBB', 'Bravo Field']]);
    const noaa = buildNoaaFake(stations, {
      KAAA: buildObservation('KAAA', minutesAgo(30)),
    });

    const text = textOf(await callHandler(noaa));

    expect(text).toContain('(30 minutes ago)');
    expect(text).toContain('**Station:** https://api.weather.gov/stations/KAAA');
    expect(text).not.toContain(STALE_WARNING);
    expect(text).not.toContain(SUBSTITUTION);
    expect(noaa.getLatestObservation).toHaveBeenCalledTimes(1);
  });

  it('substitutes a fresh second station for a stale nearest one, with the D2c note', async () => {
    const stations = buildStations([['KAAA', 'Alpha Field'], ['KBBB', 'Bravo Field']]);
    const noaa = buildNoaaFake(stations, {
      KAAA: buildObservation('KAAA', minutesAgo(2 * 24 * 60)), // 2 days old
      KBBB: buildObservation('KBBB', minutesAgo(20)),
    });

    const text = textOf(await callHandler(noaa));

    // Second station's data, with its (fresh) age.
    expect(text).toContain('**Station:** https://api.weather.gov/stations/KBBB');
    expect(text).toContain('(20 minutes ago)');
    // Substitution note names the stale nearest station, its last report time,
    // and the substituted station.
    expect(text).toMatch(
      /\*Nearest station \(KAAA\) has not reported since .+; showing Bravo Field \(KBBB\) instead\.\*/
    );
    // Fresh data means no stale warning.
    expect(text).not.toContain(STALE_WARNING);
    expect(noaa.getLatestObservation).toHaveBeenCalledTimes(2);
  });

  it('falls back to the nearest station with the D2b warning when every station is stale', async () => {
    const stations = buildStations([
      ['KAAA', 'Alpha Field'],
      ['KBBB', 'Bravo Field'],
      ['KCCC', 'Charlie Field'],
    ]);
    const noaa = buildNoaaFake(stations, {
      KAAA: buildObservation('KAAA', minutesAgo(2 * 24 * 60)), // 2 days
      KBBB: buildObservation('KBBB', minutesAgo(3 * 24 * 60)), // 3 days
      KCCC: buildObservation('KCCC', minutesAgo(4 * 24 * 60)), // 4 days
    });

    const text = textOf(await callHandler(noaa));

    // Nearest station's (stale) data with age and warning — no substitution.
    expect(text).toContain('**Station:** https://api.weather.gov/stations/KAAA');
    expect(text).toContain('(2 days ago)');
    expect(text).toContain(
      '⚠️ **This observation is 2 days old** — the station may have stopped reporting. Conditions may have changed substantially.'
    );
    expect(text).not.toContain(SUBSTITUTION);
    expect(noaa.getLatestObservation).toHaveBeenCalledTimes(3);
  });

  it('fetches at most maxStationAttempts observations across five stale stations', async () => {
    const stations = buildStations([
      ['KAAA', 'Alpha Field'],
      ['KBBB', 'Bravo Field'],
      ['KCCC', 'Charlie Field'],
      ['KDDD', 'Delta Field'],
      ['KEEE', 'Echo Field'],
    ]);
    const observations: Record<string, ObservationResponse> = {};
    for (const id of ['KAAA', 'KBBB', 'KCCC', 'KDDD', 'KEEE']) {
      observations[id] = buildObservation(id, minutesAgo(3 * 24 * 60));
    }
    const noaa = buildNoaaFake(stations, observations);

    await callHandler(noaa);

    expect(noaa.getLatestObservation).toHaveBeenCalledTimes(3);
  });

  it('silently skips a nearest station whose fetch errors (today\'s behavior)', async () => {
    const stations = buildStations([['KAAA', 'Alpha Field'], ['KBBB', 'Bravo Field']]);
    const noaa = buildNoaaFake(stations, {
      KAAA: 'error',
      KBBB: buildObservation('KBBB', minutesAgo(20)),
    });

    const text = textOf(await callHandler(noaa));

    expect(text).toContain('**Station:** https://api.weather.gov/stations/KBBB');
    expect(text).toContain('(20 minutes ago)');
    // No staleness was observed, so no substitution note and no warning.
    expect(text).not.toContain(SUBSTITUTION);
    expect(text).not.toContain(STALE_WARNING);
    expect(noaa.getLatestObservation).toHaveBeenCalledTimes(2);
  });

  it('degrades the D2c note to "recently" when the nearest station errors and a later stale one is skipped', async () => {
    const stations = buildStations([
      ['KAAA', 'Alpha Field'],
      ['KBBB', 'Bravo Field'],
      ['KCCC', 'Charlie Field'],
    ]);
    const noaa = buildNoaaFake(stations, {
      KAAA: 'error',
      KBBB: buildObservation('KBBB', minutesAgo(3 * 24 * 60)), // stale
      KCCC: buildObservation('KCCC', minutesAgo(15)), // fresh
    });

    const text = textOf(await callHandler(noaa));

    expect(text).toContain('**Station:** https://api.weather.gov/stations/KCCC');
    expect(text).toContain(
      '*Nearest station (KAAA) has not reported recently; showing Charlie Field (KCCC) instead.*'
    );
    expect(text).not.toContain(STALE_WARNING);
  });

  it('throws today\'s terminal error when every station fetch fails', async () => {
    const stations = buildStations([['KAAA', 'Alpha Field'], ['KBBB', 'Bravo Field']]);
    const noaa = buildNoaaFake(stations, { KAAA: 'error', KBBB: 'error' });

    await expect(callHandler(noaa)).rejects.toThrow(
      'Unable to retrieve current conditions from nearby stations.'
    );
  });
});
