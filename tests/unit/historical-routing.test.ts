/**
 * Routing and fallback tests for get_historical_weather (v1.12.0 hardening,
 * verification findings N1/N2).
 *
 * N1: recent-date requests (inside the NOAA threshold window) used to route
 * to NOAA unconditionally, hard-failing for every international location.
 * Routing now checks isInUS, and US-box points NOAA rejects (border cities —
 * the boxes overrun the border) fall back to the Open-Meteo archive with the
 * same note/error contract as get_current_conditions and get_forecast.
 *
 * N2: the Open-Meteo location line hardcoded °N for latitude; southern
 * latitudes now render °S.
 *
 * See docs/global-conditions-hardening-verification.md.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetHistoricalWeather } from '../../src/handlers/historicalWeatherHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { OpenMeteoHistoricalResponse } from '../../src/types/openmeteo.js';
import {
  DataNotFoundError,
  InvalidLocationError,
  ServiceUnavailableError,
} from '../../src/errors/ApiError.js';

const LONDON = { latitude: 51.5074, longitude: -0.1278 }; // outside US boxes
const SEATTLE = { latitude: 47.6062, longitude: -122.3321 }; // inside US boxes, NOAA-covered
const TORONTO = { latitude: 43.6532, longitude: -79.3832 }; // inside US boxes, NOAA rejects

const FALLBACK_NOTE =
  '*NOAA does not cover this location; showing Open-Meteo model data instead.*';

/** YYYY-MM-DD for `daysAgo` days before now — always inside the recent window. */
function recentDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function buildHourlyResponse(
  coords: { latitude: number; longitude: number } = { latitude: 51.5, longitude: -0.13 }
): OpenMeteoHistoricalResponse {
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'Etc/UTC',
    timezone_abbreviation: 'UTC',
    elevation: 11,
    hourly: {
      time: ['2026-07-14T00:00'],
      temperature_2m: [15],
    },
  };
}

function buildFakes(overrides?: {
  noaaError?: Error;
  openMeteoResponse?: OpenMeteoHistoricalResponse;
}) {
  const noaa = {
    getHistoricalObservations: overrides?.noaaError
      ? vi.fn().mockRejectedValue(overrides.noaaError)
      : vi.fn().mockResolvedValue({ features: [] }),
  };
  const openMeteo = {
    getHistoricalWeather: vi
      .fn()
      .mockResolvedValue(overrides?.openMeteoResponse ?? buildHourlyResponse()),
    getWeatherDescription: vi.fn((code: number) => `TESTWX-${code}`),
  };
  return { noaa, openMeteo };
}

function callHistorical(
  args: Record<string, unknown>,
  fakes: ReturnType<typeof buildFakes>
) {
  const locationStore = {}; // Coordinate-only args: never touched.
  const geocoding = {}; // Coordinate-only args: never touched.

  return handleGetHistoricalWeather(
    args,
    fakes.noaa as unknown as NOAAService,
    fakes.openMeteo as unknown as OpenMeteoService,
    locationStore as unknown as LocationStore,
    geocoding as unknown as GeocodingService
  );
}

function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map(b => b.text).join('\n');
}

describe('handleGetHistoricalWeather — recent-date routing (N1)', () => {
  it('routes recent international dates to Open-Meteo without touching NOAA', async () => {
    const fakes = buildFakes();

    const result = await callHistorical(
      { ...LONDON, start_date: recentDate(2), end_date: recentDate(1) },
      fakes
    );
    const text = textOf(result);

    expect(fakes.openMeteo.getHistoricalWeather).toHaveBeenCalledOnce();
    expect(fakes.noaa.getHistoricalObservations).not.toHaveBeenCalled();
    expect(text).toContain('Open-Meteo Historical Weather API');
    expect(text).not.toContain(FALLBACK_NOTE); // natural source, no note
  });

  it('still routes recent US dates to NOAA', async () => {
    const fakes = buildFakes();

    const result = await callHistorical(
      { ...SEATTLE, start_date: recentDate(2), end_date: recentDate(1) },
      fakes
    );
    const text = textOf(result);

    expect(fakes.noaa.getHistoricalObservations).toHaveBeenCalledOnce();
    expect(fakes.openMeteo.getHistoricalWeather).not.toHaveBeenCalled();
    expect(text).toContain('No historical observations found');
  });

  it('falls back to Open-Meteo with a note when NOAA rejects a US-box point (DataNotFoundError)', async () => {
    const fakes = buildFakes({
      noaaError: new DataNotFoundError('NOAA', 'Unable to provide data for requested point'),
    });

    const result = await callHistorical(
      { ...TORONTO, start_date: recentDate(2), end_date: recentDate(1) },
      fakes
    );
    const text = textOf(result);

    expect(fakes.noaa.getHistoricalObservations).toHaveBeenCalledOnce();
    expect(fakes.openMeteo.getHistoricalWeather).toHaveBeenCalledOnce();
    expect(text).toContain(FALLBACK_NOTE);
    expect(text).toContain('Open-Meteo Historical Weather API');
    // The note sits directly under the top heading.
    expect(text.indexOf('# Historical Weather Observations')).toBeLessThan(
      text.indexOf(FALLBACK_NOTE)
    );
  });

  it('falls back on InvalidLocationError too', async () => {
    const fakes = buildFakes({
      noaaError: new InvalidLocationError('NOAA', 'Invalid point'),
    });

    const result = await callHistorical(
      { ...TORONTO, start_date: recentDate(2), end_date: recentDate(1) },
      fakes
    );

    expect(fakes.openMeteo.getHistoricalWeather).toHaveBeenCalledOnce();
    expect(textOf(result)).toContain(FALLBACK_NOTE);
  });

  it('propagates transient NOAA failures instead of masking them with a source switch', async () => {
    const fakes = buildFakes({
      noaaError: new ServiceUnavailableError('NOAA', 'NOAA is down'),
    });

    await expect(
      callHistorical({ ...TORONTO, start_date: recentDate(2), end_date: recentDate(1) }, fakes)
    ).rejects.toThrow(ServiceUnavailableError);
    expect(fakes.openMeteo.getHistoricalWeather).not.toHaveBeenCalled();
  });

  it('keeps routing archival dates to Open-Meteo for US locations', async () => {
    const fakes = buildFakes({
      openMeteoResponse: {
        ...buildHourlyResponse(),
        hourly: { time: ['2020-01-01T00:00'], temperature_2m: [5] },
      },
    });

    await callHistorical(
      { ...SEATTLE, start_date: '2020-01-01', end_date: '2020-01-02' },
      fakes
    );

    expect(fakes.openMeteo.getHistoricalWeather).toHaveBeenCalledOnce();
    expect(fakes.noaa.getHistoricalObservations).not.toHaveBeenCalled();
  });
});

describe('handleGetHistoricalWeather — coordinate hemisphere labels (N2)', () => {
  it('renders southern/western coordinates as °S/°W', async () => {
    const fakes = buildFakes({
      openMeteoResponse: buildHourlyResponse({ latitude: -32.8647, longitude: -70.1714 }),
    });

    const result = await callHistorical(
      { latitude: -32.835, longitude: -70.129, start_date: '2020-07-01', end_date: '2020-07-02' },
      fakes
    );
    const text = textOf(result);

    expect(text).toContain('**Location:** 32.8647°S, 70.1714°W');
    expect(text).not.toContain('-32.8647');
  });

  it('renders northern/eastern coordinates as °N/°E', async () => {
    const fakes = buildFakes({
      openMeteoResponse: buildHourlyResponse({ latitude: 35.6762, longitude: 139.6503 }),
    });

    const result = await callHistorical(
      { latitude: 35.6762, longitude: 139.6503, start_date: '2020-07-01', end_date: '2020-07-02' },
      fakes
    );

    expect(textOf(result)).toContain('**Location:** 35.6762°N, 139.6503°E');
  });
});
