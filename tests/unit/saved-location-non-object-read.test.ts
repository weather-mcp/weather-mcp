/**
 * Read-side contracts for a saved alias whose stored value is not an object
 * (`null`, `0`, `""`, `false`, `"abc"`, `[]`) — T3 of plan-saved-location-null-entry-bounds.
 *
 * The matrix is all six values every time: a truthy guard hides the four falsy ones and a
 * bare `typeof === 'object'` passes `[]` (GOTCHAS G56). Every fixture is RAW JSON TEXT
 * written with `writeFileSync` into a `mkdtempSync` directory, read by a real
 * `LocationStore(path)` — never the no-argument constructor, no `fs` mock (G70, G117).
 *
 * The list golden was captured from the BASE build (before the fix) with TZ=UTC. The
 * "Saved:" line is locale- and time-zone-rendered by the handler, so the test pins TZ to
 * UTC and computes the date text with the same expression the handler uses.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  handleListSavedLocations,
  handleGetSavedLocation,
} from '../../src/handlers/savedLocationsHandler.js';
import {
  resolveLocation,
  resolveLocationAsync,
  SavedLocationCoordinateError,
} from '../../src/utils/locationResolver.js';
import { LocationStore } from '../../src/services/locationStore.js';
import { startLightningPrewarm } from '../../src/server/lightningPrewarm.js';
import type { PrewarmScheduler } from '../../src/server/lightningPrewarm.js';
import { logger } from '../../src/utils/logger.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

/** The six bad values, as RAW JSON text (the form they take in the file). */
const BAD_VALUES: ReadonlyArray<{ label: string; raw: string }> = [
  { label: 'null', raw: 'null' },
  { label: '0', raw: '0' },
  { label: '""', raw: '""' },
  { label: 'false', raw: 'false' },
  { label: '"abc"', raw: '"abc"' },
  { label: '[]', raw: '[]' },
];

const HOME_RAW =
  '{"name":"Seattle, WA","latitude":47.6062,"longitude":-122.3321,"timezone":"America/Los_Angeles","country_code":"US","admin1":"Washington","alternateNames":["emerald city"],"saved_at":"2025-01-15T10:30:00.000Z","updated_at":"2025-01-15T10:30:00.000Z"}';
const ZURICH_RAW =
  '{"name":"Zurich, Switzerland","latitude":47.3769,"longitude":8.5417,"timezone":"Europe/Zurich","country_code":"CH","alternateNames":["zueri"],"saved_at":"2025-01-15T11:00:00.000Z","updated_at":"2025-01-15T11:00:00.000Z"}';

const REFUSAL =
  'Saved location "x" cannot be used: the entry is not an object. ' +
  'Replace it with save_location, or remove it with remove_saved_location.';

const tempDirs: string[] = [];

/** Write the entries (alias, raw JSON text) in the given order and open a real store. */
function newStore(entries: ReadonlyArray<readonly [string, string]>): LocationStore {
  const dir = mkdtempSync(join(tmpdir(), 'wmcp-nonobj-'));
  tempDirs.push(dir);
  const file = join(dir, 'locations.json');
  const body = entries.map(([alias, raw]) => `  ${JSON.stringify(alias)}: ${raw}`).join(',\n');
  writeFileSync(file, `{\n${body}\n}\n`, 'utf-8');
  return new LocationStore(file);
}

const standardFixture = (raw: string): LocationStore =>
  newStore([['home', HOME_RAW], ['x', raw], ['zurich', ZURICH_RAW]]);

function text(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0].text;
}

/** A geocoder that WOULD resolve any name, and counts how often it is asked. */
function geocoderStub() {
  const geocode = vi.fn(async () => [
    {
      latitude: 1.5,
      longitude: 2.5,
      display_name: 'Geocoded X',
      country_code: 'XX',
    },
  ]);
  return { stub: { geocode } as unknown as GeocodingService, geocode };
}

let savedTz: string | undefined;
let savedDefault: string | undefined;

beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'UTC';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});
beforeEach(() => {
  savedDefault = process.env.WEATHER_DEFAULT_LOCATION;
});
afterEach(() => {
  if (savedDefault === undefined) delete process.env.WEATHER_DEFAULT_LOCATION;
  else process.env.WEATHER_DEFAULT_LOCATION = savedDefault;
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolving a non-object alias', () => {
  it.each(BAD_VALUES)('refuses $label with SavedLocationCoordinateError and the whole message', ({ raw }) => {
    const store = standardFixture(raw);
    let caught: unknown;
    try {
      resolveLocation({ location_name: 'x' }, store);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SavedLocationCoordinateError);
    expect(caught).not.toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe(REFUSAL);
  });

  it.each(BAD_VALUES)('async resolve of $label refuses the same way', async ({ raw }) => {
    const store = standardFixture(raw);
    const { stub, geocode } = geocoderStub();
    const error = await resolveLocationAsync({ location_name: 'x' }, store, stub).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SavedLocationCoordinateError);
    expect((error as Error).message).toBe(REFUSAL);
    expect(geocode).not.toHaveBeenCalled();
  });
});

describe('alternate-name lookup past a non-object neighbour', () => {
  it.each(BAD_VALUES)('$label BEFORE the match in file order still resolves the neighbour', ({ raw }) => {
    const store = newStore([['x', raw], ['home', HOME_RAW], ['zurich', ZURICH_RAW]]);
    const home = resolveLocation({ location_name: 'Emerald City' }, store);
    expect(home.location_name).toBe('home');
    expect(home.latitude).toBe(47.6062);
    expect(home.country_code).toBe('US');
    const zurich = resolveLocation({ location_name: 'zueri' }, store);
    expect(zurich.location_name).toBe('zurich');
    expect(zurich.longitude).toBe(8.5417);
  });

  it.each(BAD_VALUES)('$label AFTER the match in file order still resolves the neighbour', ({ raw }) => {
    const store = newStore([['home', HOME_RAW], ['zurich', ZURICH_RAW], ['x', raw]]);
    expect(resolveLocation({ location_name: 'emerald city' }, store).location_name).toBe('home');
    expect(resolveLocation({ location_name: 'zueri' }, store).location_name).toBe('zurich');
  });

  it.each(BAD_VALUES)('a miss with $label present gives the ordinary not-found message', ({ raw }) => {
    const store = newStore([['x', raw], ['home', HOME_RAW], ['zurich', ZURICH_RAW]]);
    let caught: unknown;
    try {
      resolveLocation({ location_name: 'nowhere' }, store);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(TypeError);
    expect(caught).not.toBeInstanceOf(SavedLocationCoordinateError);
    expect((caught as Error).message).toBe(
      'Saved location "nowhere" not found.\n\n' +
      'Available locations: x, home, zurich\n\n' +
      'Use list_saved_locations to see all saved locations.'
    );
  });
});

describe('WEATHER_DEFAULT_LOCATION naming a non-object alias', () => {
  it.each(BAD_VALUES)('$label is refused and never geocoded', async ({ raw }) => {
    process.env.WEATHER_DEFAULT_LOCATION = 'x';
    const store = standardFixture(raw);
    const { stub, geocode } = geocoderStub();
    const error = await resolveLocationAsync({}, store, stub).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SavedLocationCoordinateError);
    expect((error as Error).message).toBe(REFUSAL);
    expect(geocode).toHaveBeenCalledTimes(0);
  });
});

describe('get_saved_location on a non-object alias', () => {
  it.each(BAD_VALUES)('$label is named as broken, never "not found"', async ({ raw }) => {
    const store = standardFixture(raw);
    const error = await handleGetSavedLocation({ alias: 'x' }, store).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    const message = (error as Error).message;
    expect(message.split('\n')[0]).toBe('Saved location "x" cannot be shown: entry is not an object.');
    expect(message).not.toContain('not found');
  });
});

describe('list_saved_locations with a non-object alias', () => {
  // Golden captured from the BASE build under TZ=UTC; all six values rendered the same text.
  // `<STORE>` is the storage path; `${saved}` is the handler's own date expression.
  const goldenFor = (storePath: string): string => {
    const home = new Date('2025-01-15T10:30:00.000Z').toLocaleDateString();
    const zurich = new Date('2025-01-15T11:00:00.000Z').toLocaleDateString();
    return [
      '# Saved Locations',
      '',
      '**Total:** 3 locations',
      '',
      '---',
      '',
      '## `home`',
      '',
      '**Name:** Seattle, WA',
      '**Coordinates:** 47.6062°, -122.3321°',
      '**Alternate Names:** emerald city',
      '**Timezone:** America/Los_Angeles',
      '**Country:** US',
      '**Region:** Washington',
      `**Saved:** ${home}`,
      '',
      '## `x`',
      '',
      '⚠️ This entry cannot be shown: `entry` is not an object. Remove it with `remove_saved_location(alias="x")` or repair it in the file below.',
      '',
      '## `zurich`',
      '',
      '**Name:** Zurich, Switzerland',
      '**Coordinates:** 47.3769°, 8.5417°',
      '**Alternate Names:** zueri',
      '**Timezone:** Europe/Zurich',
      '**Country:** CH',
      `**Saved:** ${zurich}`,
      '',
      '---',
      '',
      '**Usage Examples:**',
      '',
      '```',
      'get_forecast(location_name="home")',
      'get_forecast(location_name="zurich")',
      '```',
      '',
      `*Storage location: ${storePath}*`,
      '',
    ].join('\n');
  };

  it.each(BAD_VALUES)('renders $label exactly as the base build did', async ({ raw }) => {
    const store = standardFixture(raw);
    const rendered = text(await handleListSavedLocations(store));
    expect(rendered).toBe(goldenFor(store.getStorePath()));
  });
});

describe('lightning pre-warm over non-object and malformed entries', () => {
  const VALID_A = { name: 'A', latitude: 10, longitude: 20 };
  const VALID_B = { name: 'B', latitude: -30, longitude: 40 };

  function run(entries: readonly unknown[]) {
    const prewarmLocation = vi.fn(async () => {});
    const setInterval = vi.fn(() => 1 as unknown as ReturnType<typeof globalThis.setInterval>);
    const clearInterval = vi.fn();
    const scheduler: PrewarmScheduler = { setInterval, clearInterval };
    const spies = [
      vi.spyOn(logger, 'info').mockImplementation(() => {}),
      vi.spyOn(logger, 'warn').mockImplementation(() => {}),
      vi.spyOn(logger, 'debug').mockImplementation(() => {}),
      vi.spyOn(logger, 'error').mockImplementation(() => {}),
    ];
    const handle = startLightningPrewarm({
      toolEnabled: true,
      optOutValue: undefined,
      readSavedLocations: () => entries,
      prewarmLocation,
      scheduler,
    });
    handle.stop();
    return { prewarmLocation, setInterval, clearInterval, logger: { info: spies[0], all: spies } };
  }

  function loggedArgs(spies: ReturnType<typeof vi.spyOn>[]): string {
    return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
  }

  it.each(BAD_VALUES)('skips $label between two valid entries without throwing', ({ raw }) => {
    const bad: unknown = JSON.parse(raw);
    const { prewarmLocation, logger: log, setInterval, clearInterval } = run([VALID_A, bad, VALID_B]);

    expect(prewarmLocation).toHaveBeenCalledTimes(2);
    expect(prewarmLocation.mock.calls.map((c) => [c[0], c[1]])).toEqual([[10, 20], [-30, 40]]);
    expect(log.info).toHaveBeenCalledWith(
      'Pre-warming lightning monitoring for saved locations',
      { count: 2 }
    );
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(clearInterval).toHaveBeenCalledTimes(1);
  });

  it('skips an entry with a non-numeric latitude', () => {
    const { prewarmLocation, logger: log } = run([
      VALID_A,
      { latitude: 'abc', longitude: 2 },
      VALID_B,
    ]);
    expect(prewarmLocation).toHaveBeenCalledTimes(2);
    expect(prewarmLocation.mock.calls.map((c) => [c[0], c[1]])).toEqual([[10, 20], [-30, 40]]);
    expect(log.info).toHaveBeenCalledWith(
      'Pre-warming lightning monitoring for saved locations',
      { count: 2 }
    );
  });

  it('pre-warms an entry whose name is not text, because only coordinates matter', () => {
    const { prewarmLocation, logger: log } = run([
      VALID_A,
      { name: 42, latitude: 1, longitude: 2 },
      VALID_B,
    ]);
    expect(prewarmLocation).toHaveBeenCalledTimes(3);
    expect(prewarmLocation.mock.calls.map((c) => [c[0], c[1]])).toEqual([[10, 20], [1, 2], [-30, 40]]);
    expect(log.info).toHaveBeenCalledWith(
      'Pre-warming lightning monitoring for saved locations',
      { count: 3 }
    );
  });

  it('logs no alias or fixture name for any of the bad entries', () => {
    const named = [
      { name: 'Fixture Name Sentinel', latitude: 'abc', longitude: 2 },
      { name: 42, latitude: 1, longitude: 2 },
    ];
    for (const entries of [
      [VALID_A, ...BAD_VALUES.map((b) => JSON.parse(b.raw) as unknown), VALID_B],
      [VALID_A, ...named, VALID_B],
    ]) {
      const { logger: log } = run(entries);
      const logged = loggedArgs(log.all as unknown as ReturnType<typeof vi.spyOn>[]);
      expect(logged).not.toContain('Fixture Name Sentinel');
      expect(logged).not.toContain('"x"');
      expect(logged).not.toContain('Seattle');
      expect(logged).not.toContain('Zurich');
      vi.restoreAllMocks();
    }
  });
});
