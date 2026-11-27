/**
 * The six sites that put a caught error's text into caller-facing output read it
 * through `errorTextForCaller` (plan-http-entry-hardening, design contract 2).
 *
 * Each row reaches its catch through the handler (G45), never by calling the
 * text function alone. A remote caller reads the fixed sentence in place of a
 * runtime error's text; a local caller, and a call with no audience at all,
 * reads the text as before. A fixed-message plain Error passes through for both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleGetWildfireInfo } from '../../src/handlers/wildfireHandler.js';
import { handleGetRiverConditions } from '../../src/handlers/riverConditionsHandler.js';
import { handleGetHistoricalWeather } from '../../src/handlers/historicalWeatherHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import { resolveLocationAsync } from '../../src/utils/locationResolver.js';
import { REMOTE_INTERNAL_ERROR_MESSAGE } from '../../src/errors/ApiError.js';
import { runWithCallerAudience } from '../../src/utils/callerAudience.js';
import { LocationStore } from '../../src/services/locationStore.js';
import { logger } from '../../src/utils/logger.js';
import type { FIRMSService } from '../../src/services/firms.js';
import type { NIFCService } from '../../src/services/nifc.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { NCEIService } from '../../src/services/ncei.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

const SENTINEL = 'zqruntime7731';
const FIXED = 'The zq feed could not be reached. This is not an all-clear.';

const SACRAMENTO = { latitude: 38.58, longitude: -121.49 };
const CANBERRA = { latitude: -35.28, longitude: 149.13 };
const BOSTON = { latitude: 42.3601, longitude: -71.0589 };
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

const noStore = {} as unknown as LocationStore;
const noGeocoding = {} as unknown as GeocodingService;

let tempDir: string;
let savedDefault: string | undefined;

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
  tempDir = mkdtempSync(join(tmpdir(), 'inline-sites-'));
  savedDefault = process.env.WEATHER_DEFAULT_LOCATION;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedDefault === undefined) delete process.env.WEATHER_DEFAULT_LOCATION;
  else process.env.WEATHER_DEFAULT_LOCATION = savedDefault;
  rmSync(tempDir, { recursive: true, force: true });
});

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((block) => block.text ?? '').join('');
}

/** A service whose every member throws the given error when touched. */
function throwingService<T>(error: Error): T {
  return new Proxy({}, { get: () => { throw error; } }) as T;
}

interface Site {
  name: string;
  /** The marker that shows the row reached the catch it is about. */
  marker: string;
  run: (error: Error) => Promise<string>;
}

const SITES: Site[] = [
  {
    name: 'wildfire, NIFC render (wildfireHandler)',
    marker: 'Error details: ',
    run: async (error) =>
      textOf(
        await handleGetWildfireInfo(
          { ...SACRAMENTO },
          { queryFirePerimeters: vi.fn(async () => { throw error; }) } as unknown as NIFCService,
          noStore,
          noGeocoding,
          undefined,
          { reverseCountry: vi.fn(async () => 'us') } as unknown as NominatimService
        )
      )
  },
  {
    name: 'wildfire, FIRMS render (wildfireHandler)',
    marker: 'Error details: ',
    run: async (error) =>
      textOf(
        await handleGetWildfireInfo(
          { ...CANBERRA },
          { queryFirePerimeters: vi.fn(async () => { throw new Error('NIFC must not be called'); }) } as unknown as NIFCService,
          noStore,
          noGeocoding,
          {
            isKeyAvailable: vi.fn(() => false),
            getDetectionsByBbox: vi.fn(async () => { throw new Error('bbox must not be called'); }),
            getDetectionsByRegion: vi.fn(async () => { throw error; }),
            getProductAvailability: vi.fn(async () => undefined)
          } as unknown as FIRMSService,
          { reverseCountry: vi.fn(async () => 'au') } as unknown as NominatimService
        )
      )
  },
  {
    name: 'river, NWPS render (riverConditionsHandler)',
    marker: 'Error details: ',
    run: async (error) =>
      textOf(
        await handleGetRiverConditions(
          { ...BOSTON },
          {
            getNWPSGaugesInBoundingBox: vi.fn(async () => { throw error; }),
            getNWPSGauge: vi.fn(async () => { throw error; }),
            getNWPSStageFlow: vi.fn(async () => { throw error; })
          } as unknown as NOAAService,
          noStore,
          noGeocoding
        )
      )
  },
  {
    name: 'historical wrap (historicalWeatherHandler)',
    marker: 'Unable to retrieve historical data: ',
    run: async (error) => {
      try {
        await handleGetHistoricalWeather(
          { ...LONDON, start_date: '2024-02-01', end_date: '2024-03-15' },
          { getHistoricalObservations: vi.fn().mockResolvedValue({ features: [] }) } as unknown as NOAAService,
          {
            getHistoricalWeather: vi.fn(async () => { throw error; }),
            getWeatherDescription: vi.fn((c: number) => `WX-${c}`)
          } as unknown as OpenMeteoService,
          noStore,
          noGeocoding
        );
      } catch (caught) {
        return (caught as Error).message;
      }
      throw new Error('expected the historical handler to reject');
    }
  },
  {
    name: 'summary section note (weatherSummaryHandler)',
    marker: 'Could not retrieve current data for this location: ',
    run: async (error) =>
      textOf(
        await handleGetWeatherSummary(
          { ...LONDON, include: ['current'] },
          throwingService<NOAAService>(error),
          throwingService<OpenMeteoService>(error),
          throwingService<NCEIService>(error),
          noStore,
          noGeocoding
        )
      )
  },
  {
    name: 'default-location geocode wrap (locationResolver)',
    marker: 'a geocodable place name.\n\n',
    run: async (error) => {
      process.env.WEATHER_DEFAULT_LOCATION = 'Nonexistentville';
      try {
        await resolveLocationAsync(
          {},
          new LocationStore(join(tempDir, 'locations.json')),
          { geocode: vi.fn(async () => { throw error; }) } as unknown as GeocodingService
        );
      } catch (caught) {
        return (caught as Error).message;
      }
      throw new Error('expected the default location to fail to resolve');
    }
  }
];

describe.each(SITES)('$name', ({ marker, run }) => {
  it('a remote caller reads the fixed sentence, not the runtime error text', async () => {
    const text = await runWithCallerAudience(true, () => run(new TypeError(`${SENTINEL} is not a function`)));
    expect(text).toContain(`${marker}${REMOTE_INTERNAL_ERROR_MESSAGE}`);
    expect(text).not.toContain(SENTINEL);
  });

  it('a remote caller is not shown an fs path either', async () => {
    const fsError = Object.assign(new Error(`ENOENT: no such file or directory, open '/srv/${SENTINEL}/x.json'`), {
      code: 'ENOENT',
      syscall: 'open'
    });
    const text = await runWithCallerAudience(true, () => run(fsError));
    expect(text).toContain(`${marker}${REMOTE_INTERNAL_ERROR_MESSAGE}`);
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('/srv/');
  });

  it('a local caller, and a call with no audience, read the text as before', async () => {
    const message = `${SENTINEL} is not a function`;
    const none = await run(new TypeError(message));
    const local = await runWithCallerAudience(false, () => run(new TypeError(message)));
    expect(none).toContain(`${marker}${message}`);
    expect(local).toBe(none);
  });

  it('a fixed-message plain Error reads the same for both audiences', async () => {
    const remote = await runWithCallerAudience(true, () => run(new Error(FIXED)));
    const local = await run(new Error(FIXED));
    expect(remote).toContain(`${marker}${FIXED}`);
    expect(remote).toBe(local);
  });
});
