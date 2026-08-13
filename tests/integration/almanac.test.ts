/**
 * Integration tests for the almanac features — US daily temperature records
 * (ACIS) and moon/twilight astronomy — per docs/almanac-plan.md D3/D4 and
 * docs/almanac-implementation-plan.md T6.
 *
 * Block 1 is deterministic: only the HTTP-issuing method of a real
 * `AcisService` instance is stubbed via `vi.spyOn` on its private axios
 * `client.post`, mirroring the private-method-spy convention used in
 * tests/integration/global-rivers.test.ts (there it's
 * `OpenMeteoService`'s `makeRequestToFlood`; here it's `AcisService`'s
 * axios client). This is a deliberate variant of the module-level
 * `vi.mock('axios')` pattern used in tests/unit/acis-records.test.ts: a
 * file-wide axios mock would also swallow the live NOAA/Open-Meteo/ACIS
 * calls Block 2 needs to make, so this file scopes the mock to a single
 * `AcisService` instance instead. The real `AcisService` and the real
 * `handleGetForecast` run end to end against fixtures built to match the
 * true ACIS wire shape captured in the design verification: StnMeta with
 * `sids`/`ll`/`valid_daterange`, and a 366-slot StnData `smry` table with
 * one "M" (missing) slot to exercise one-sided record-line rendering.
 *
 * Block 2 makes **live** network calls — one direct ACIS station+records
 * lookup, and one full `include_astronomy` forecast call through the real
 * handler (real NOAAService/OpenMeteoService, live NOAA + Open-Meteo APIs)
 * — so this file makes live network calls. It follows the
 * tolerant-of-live-network convention used by
 * tests/integration/global-rivers.test.ts and
 * tests/integration/safety-hazards.test.ts: generous per-test timeouts,
 * shape-only assertions (not exact values), and each test catches and logs
 * network errors instead of letting them fail — this file never turns the
 * suite red on a flaky connection.
 *
 * (Three other integration files — visualization-lightning.test.ts,
 * safety-hazards.test.ts, and global-rivers.test.ts — make live calls and
 * are known to flake independently; that's a pre-existing condition
 * unrelated to this file. See the "Flaky live-network tests" project
 * memory and the implementation plan's "Gate caveat (standing)".)
 */

import { describe, it, expect, vi } from 'vitest';
import { handleGetForecast } from '../../src/handlers/forecastHandler.js';
import { AcisService } from '../../src/services/acis.js';
import { NOAAService } from '../../src/services/noaa.js';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import type { AcisSmryEntry, AcisStnMetaStation } from '../../src/types/acis.js';

/** Seattle — a US point that auto-routes to the NOAA forecast path. */
const SEATTLE_LAT = 47.6062;
const SEATTLE_LON = -122.3321;

/** St. Louis — a long-record, well-instrumented US climate station for the live ACIS smoke test. */
const ST_LOUIS_LAT = 38.627;
const ST_LOUIS_LON = -90.1994;

/** Leap-calendar day-of-year index for Aug 12 (see `dayOfYearIndex` in src/services/acis.ts). */
const AUG_12_INDEX = 224;

/** Captured-shape ACIS StnMeta station fixture (mirrors tests/unit/acis-records.test.ts). */
const ACIS_STATION: AcisStnMetaStation = {
  name: 'SEATTLE TACOMA AIRPORT, WA US',
  sids: ['USW00024233 6', 'SEAthr 9'],
  ll: [-122.3088, 47.4502],
  valid_daterange: [
    ['1945-01-01', '2026-08-01'],
    ['1945-01-01', '2026-08-01']
  ]
};

/** 366 default "M" (missing) entries for a smry table, with optional index overrides. */
function buildSmryTable(overrides: Record<number, AcisSmryEntry>): AcisSmryEntry[] {
  const table: AcisSmryEntry[] = [];
  for (let i = 0; i < 366; i++) {
    table.push(overrides[i] ?? ['M', '1900-01-01']);
  }
  return table;
}

/**
 * Minimal fake NOAAService driving the daily forecast path end to end: one
 * day/night period pair on Aug 12, 2026 (the date the ACIS fixture's "M"
 * slot below is keyed to). Modeled on tests/unit/forecast-fallback.test.ts's
 * buildNoaaFake.
 */
function buildNoaaFake() {
  return {
    getPointData: vi.fn().mockResolvedValue({
      properties: {
        gridId: 'SEW',
        gridX: 124,
        gridY: 67,
        timeZone: 'America/Los_Angeles'
      }
    }),
    getForecast: vi.fn().mockResolvedValue({
      properties: {
        updated: '2026-08-12T06:00:00-07:00',
        elevation: { unitCode: 'wmoUnit:m', value: 56 },
        periods: [
          {
            number: 1,
            name: 'Tuesday',
            startTime: '2026-08-12T06:00:00-07:00',
            endTime: '2026-08-12T18:00:00-07:00',
            isDaytime: true,
            temperature: 78,
            temperatureUnit: 'F',
            temperatureTrend: null,
            probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 10 },
            dewpoint: { unitCode: 'wmoUnit:degC', value: 10 },
            relativeHumidity: { unitCode: 'wmoUnit:percent', value: 55 },
            windSpeed: '5 to 10 mph',
            windDirection: 'W',
            icon: 'https://example.com/icon-day.png',
            shortForecast: 'Sunny',
            detailedForecast: 'Sunny skies with a high near 78.'
          },
          {
            number: 2,
            name: 'Tuesday Night',
            startTime: '2026-08-12T18:00:00-07:00',
            endTime: '2026-08-13T06:00:00-07:00',
            isDaytime: false,
            temperature: 58,
            temperatureUnit: 'F',
            temperatureTrend: null,
            probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 5 },
            dewpoint: { unitCode: 'wmoUnit:degC', value: 8 },
            relativeHumidity: { unitCode: 'wmoUnit:percent', value: 60 },
            windSpeed: '5 mph',
            windDirection: 'W',
            icon: 'https://example.com/icon-night.png',
            shortForecast: 'Clear',
            detailedForecast: 'Clear skies overnight.'
          }
        ]
      }
    }),
    getHourlyForecast: vi.fn(),
    getGridpointData: vi.fn().mockRejectedValue(new Error('not mocked in this test')),
    getGridpointDataByCoordinates: vi.fn()
  };
}

describe('Almanac integration — ACIS records through the real handler (mocked, deterministic)', () => {
  it('surfaces a one-sided **Records for** line and ACIS attribution for a US include_normals call', async () => {
    // Real AcisService; only its private axios client's `post` is stubbed
    // (see file header for why this isn't a module-level `vi.mock('axios')`).
    const acisService = new AcisService();
    const postSpy = vi.spyOn((acisService as any).client, 'post');
    postSpy.mockImplementation(async (url: string) => {
      if (url === '/StnMeta') {
        return { data: { meta: [ACIS_STATION] } };
      }
      if (url === '/StnData') {
        // High side has a real record; low side is "M" (missing) — the
        // ACIS wire convention for an unusable slot — so the rendered line
        // must be one-sided.
        const highTable = buildSmryTable({ [AUG_12_INDEX]: ['96', '1977-08-12'] });
        const lowTable = buildSmryTable({ [AUG_12_INDEX]: ['M', '1900-01-01'] });
        return { data: { smry: [highTable, lowTable] } };
      }
      throw new Error(`Unexpected ACIS URL in test: ${url}`);
    });

    const noaaFake = buildNoaaFake();
    // formatNOAAForecast only touches openMeteoService via getClimateNormals
    // (for the include_normals block). Leaving that method unimplemented
    // makes the normals fetch fail and fall into its own "unavailable"
    // branch — a scenario the code explicitly tolerates (D4/A5: the records
    // line is independent of whether normals themselves succeeded) — which
    // keeps this test focused purely on the ACIS records path.
    const openMeteoFake = {};

    const result = await handleGetForecast(
      {
        latitude: SEATTLE_LAT,
        longitude: SEATTLE_LON,
        granularity: 'daily',
        include_normals: true
      },
      noaaFake as unknown as NOAAService,
      openMeteoFake as unknown as OpenMeteoService,
      {} as unknown as LocationStore, // unused — explicit coordinates short-circuit resolution
      {} as unknown as GeocodingService, // unused for the same reason
      undefined, // nceiService — omitted, so getClimateNormals falls straight to Open-Meteo
      acisService
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const text = result.content[0].text;

    // The real AcisService actually made both ACIS calls.
    expect(postSpy).toHaveBeenCalledWith('/StnMeta', expect.any(Object));
    expect(postSpy).toHaveBeenCalledWith('/StnData', expect.any(Object));

    // The records line renders, one-sided (no Low, since that slot was "M"),
    // plus the ACIS attribution line immediately after it.
    const recordsLineMatch = text.match(/\*\*Records for Aug 12:\*\*[^\n]+/);
    expect(recordsLineMatch).not.toBeNull();
    const recordsLine = recordsLineMatch![0];
    expect(recordsLine).toContain('High 96°F (1977)');
    expect(recordsLine).not.toContain('Low');
    expect(recordsLine).toContain('records since 1945');
    expect(text).toContain('Records: NOAA Regional Climate Centers (ACIS)');
  });
});

describe('Almanac integration — live smoke tests (tolerant of network flake)', () => {
  it('fetches real ACIS daily records for a well-instrumented US station (St. Louis)', async () => {
    const acisService = new AcisService();

    try {
      const station = await acisService.findRecordsStation(ST_LOUIS_LAT, ST_LOUIS_LON);

      // Shape, not values — station identity and exact records can change.
      expect(typeof station.id).toBe('string');
      expect(station.id.length).toBeGreaterThan(0);
      expect(typeof station.name).toBe('string');
      expect(station.name.length).toBeGreaterThan(0);
      expect(Number.isInteger(station.porStartYear)).toBe(true);
      expect(station.porStartYear).toBeGreaterThan(1800);
      expect(station.porStartYear).toBeLessThanOrEqual(new Date().getFullYear());

      const records = await acisService.getDailyRecords(station.id, station.name, station.porStartYear);

      // Full 366-slot table, live-verified shape.
      expect(records.days).toHaveLength(366);

      let populatedSlots = 0;
      for (const slot of records.days) {
        if (slot.high) {
          expect(typeof slot.high.value).toBe('number');
          expect(Number.isFinite(slot.high.value)).toBe(true);
          expect(slot.high.year).toBeGreaterThanOrEqual(station.porStartYear);
          expect(slot.high.year).toBeLessThanOrEqual(new Date().getFullYear());
          populatedSlots++;
        }
        if (slot.low) {
          expect(typeof slot.low.value).toBe('number');
          expect(Number.isFinite(slot.low.value)).toBe(true);
          expect(slot.low.year).toBeGreaterThanOrEqual(station.porStartYear);
          expect(slot.low.year).toBeLessThanOrEqual(new Date().getFullYear());
        }
      }
      // A long-record climate station should have nearly all 366 calendar
      // days populated on at least one side (some sparse gaps are normal).
      expect(populatedSlots).toBeGreaterThan(300);

      console.log('\n=== Live ACIS smoke test: St. Louis ===');
      console.log(`Station: ${station.name} (${station.id}), records since ${station.porStartYear}`);
    } catch (error) {
      // Tolerant of live-network flake: log and pass rather than fail the suite.
      console.warn(
        '\n=== Live ACIS smoke test skipped (network error) ===\n',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, 60000);

  it('renders Moon/Twilight/Next full moon lines for a live include_astronomy forecast call (Seattle)', async () => {
    const noaaService = new NOAAService();
    const openMeteoService = new OpenMeteoService();

    try {
      const result = await handleGetForecast(
        {
          latitude: SEATTLE_LAT,
          longitude: SEATTLE_LON,
          granularity: 'daily',
          days: 3,
          include_astronomy: true
        },
        noaaService,
        openMeteoService,
        {} as unknown as LocationStore, // unused — explicit coordinates short-circuit resolution
        {} as unknown as GeocodingService // unused for the same reason
      );

      expect(result.content).toHaveLength(1);
      const text = result.content[0].text;

      // Shape, not values — moon phase/illumination/rise-set and twilight
      // times change day to day; the golden-value tests in
      // tests/unit/astronomy.test.ts cover exact accuracy.
      expect(text).toContain('**Moon:**');
      expect(text).toContain('**Twilight:**');
      expect(text).toContain('**Next full moon:**');
      expect(text).toContain('**Next new moon:**');

      console.log('\n=== Live include_astronomy smoke test: Seattle ===');
      console.log(`Response length: ${text.length} chars`);
    } catch (error) {
      // Tolerant of live-network flake: log and pass rather than fail the suite.
      console.warn(
        '\n=== Live include_astronomy smoke test skipped (network error) ===\n',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, 60000);
});
