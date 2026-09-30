/**
 * Read-path contracts for a hand-edited (malformed) saved-location entry,
 * pinned across all three layers that can encounter one — T5 of
 * plan-saved-location-metadata-validation, following T4 (bcc60dd).
 *
 * Every fixture is written as real JSON text with `writeFileSync` into a
 * `mkdtempSync` temp dir (no `fs` mock — GOTCHAS G70), and every store is a
 * real `LocationStore(path)` — never the no-argument constructor, and never a
 * hand-built stub — so `load()`'s real parse sits on the path being tested.
 *
 * Layer 1 (handler): `handleListSavedLocations` / `handleGetSavedLocation` /
 * `handleRemoveSavedLocation` from `src/handlers/savedLocationsHandler.ts`.
 * Layer 2 (resolver): `resolveLocation` / `resolveLocationAsync` /
 * `resolveCountryCode` / `SavedLocationCoordinateError` from
 * `src/utils/locationResolver.ts`.
 * Layer 3 (dispatch): `createWeatherServer` over `InMemoryTransport`
 * (GOTCHAS G61 — never import `src/index.ts`), mirroring
 * `tests/unit/weather-server-factory.test.ts:77-114`.
 *
 * Rendered-text locks assert the full construct, not a bare word (GOTCHAS
 * G62/G96): the warning line is asserted verbatim, and the usage-examples
 * check for one alias's absence is anchored on the exact
 * `get_forecast(location_name="...")` line it would render as.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  handleListSavedLocations,
  handleGetSavedLocation,
  handleRemoveSavedLocation,
} from '../../src/handlers/savedLocationsHandler.js';
import {
  resolveLocation,
  resolveLocationAsync,
  resolveCountryCode,
  SavedLocationCoordinateError,
} from '../../src/utils/locationResolver.js';
import { LocationStore } from '../../src/services/locationStore.js';
import type { NominatimService } from '../../src/services/nominatim.js';
import type { GeocodingService, GeocodingResult } from '../../src/services/geocoding.js';

// Pinned before the factory's static import evaluates (GOTCHAS G61 residue,
// G26): 'standard' is the preset with save_location/list_saved_locations/
// get_saved_location/remove_saved_location IN (src/config/tools.ts), matching
// tests/unit/weather-server-factory.test.ts's own pin. ANALYTICS_ENABLED='false'
// keeps the import off ~/.weather-mcp; ANALYTICS_SALT is a second guard in case a
// developer shell exports an enabled detailed configuration. WEATHER_DEFAULT_LOCATION
// starts empty; the default-location describe block below saves/restores it
// itself before mutating it further.
const BEFORE = vi.hoisted(() => {
  process.env.ENABLED_TOOLS = 'standard';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'saved-locations-malformed-entry-test';
  process.env.WEATHER_DEFAULT_LOCATION = '';
  return {};
});
void BEFORE;

import { createWeatherServer } from '../../src/server/weatherServer.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const TS = '2026-01-01T00:00:00.000Z';

// --- Fixture builders -------------------------------------------------

function validWorkEntry(): Record<string, unknown> {
  return {
    name: 'Office',
    latitude: 47.61,
    longitude: -122.33,
    saved_at: TS,
    updated_at: TS,
  };
}

function badNameEntry(): Record<string, unknown> {
  return { name: 42, latitude: 47.62, longitude: -122.32, saved_at: TS, updated_at: TS };
}

function badLatitudeEntry(): Record<string, unknown> {
  return {
    name: 'Lake Cabin',
    latitude: '47.6',
    longitude: -122.32,
    saved_at: TS,
    updated_at: TS,
  };
}

function badAlternateNamesEntry(): Record<string, unknown> {
  return {
    name: 'Neighbour',
    latitude: 47.63,
    longitude: -122.31,
    alternateNames: 'the cabin',
    saved_at: TS,
    updated_at: TS,
  };
}

function badActivitiesEntry(): Record<string, unknown> {
  return {
    name: 'Cabin',
    latitude: 47.64,
    longitude: -122.3,
    activities: [1],
    saved_at: TS,
    updated_at: TS,
  };
}

function badCountryCodeEntry(): Record<string, unknown> {
  return {
    name: 'Shed',
    latitude: 45.5,
    longitude: -122.6,
    country_code: 42,
    saved_at: TS,
    updated_at: TS,
  };
}

function goodCountryCodeEntry(): Record<string, unknown> {
  return {
    name: 'GB Control',
    latitude: 51.5,
    longitude: -0.12,
    country_code: 'GB',
    saved_at: TS,
    updated_at: TS,
  };
}

/** One defect class per row: alias, the malformed entry, and the field/problem
 * `describeSavedLocationDefect` reports for it (savedLocationShape.ts). */
const DEFECT_FIXTURES = [
  { alias: 'bad_name', entry: badNameEntry(), field: 'name', problem: 'is not text' },
  {
    alias: 'bad_lat',
    entry: badLatitudeEntry(),
    field: 'latitude',
    problem: 'is not a finite number in range',
  },
  {
    alias: 'bad_alt',
    entry: badAlternateNamesEntry(),
    field: 'alternateNames',
    problem: 'is not a list of text',
  },
  {
    alias: 'bad_activities',
    entry: badActivitiesEntry(),
    field: 'activities',
    problem: 'is not a list of text',
  },
  {
    alias: 'bad_country',
    entry: badCountryCodeEntry(),
    field: 'country_code',
    problem: 'is not text',
  },
] as const;

/** escapeMarkdown (savedLocationsHandler.ts:34-51) escapes an alias's `_` to
 * `\_` wherever it renders inside a Markdown heading or bold label; every
 * fixture alias here uses `_` as its only special character, so this mirrors
 * just that one substitution rather than importing the (unexported) escaper. */
function escapedAlias(alias: string): string {
  return alias.replace(/_/g, '\\_');
}

/** The exact warning-line construct rendered by handleListSavedLocations
 * (savedLocationsHandler.ts:399-401) — asserted verbatim per GOTCHAS G62. The
 * heading and prose use the alias unescaped: it is embedded inside the
 * `remove_saved_location(alias="...")` snippet, which is not passed through
 * escapeMarkdown in the source (only stripped of backtick/CR/LF). */
function warningLine(alias: string, field: string, problem: string): string {
  return (
    `⚠️ This entry cannot be shown: \`${field}\` ${problem}. ` +
    `Remove it with \`remove_saved_location(alias="${alias}")\` ` +
    `or repair it in the file below.`
  );
}

/** The exact refusal message rendered by handleGetSavedLocation
 * (savedLocationsHandler.ts:496-499). */
function getDefectMessage(alias: string, field: string, problem: string, storePath: string): string {
  return (
    `Saved location "${alias}" cannot be shown: ${field} ${problem}.\n\n` +
    `Remove it with remove_saved_location or repair it in ${storePath}.`
  );
}

// --- Temp-dir bookkeeping ----------------------------------------------

let tempDirs: string[] = [];

function newStore(entries: Record<string, unknown>): LocationStore {
  const dir = mkdtempSync(join(tmpdir(), 'weather-mcp-malformed-'));
  tempDirs.push(dir);
  const storePath = join(dir, 'locations.json');
  writeFileSync(storePath, JSON.stringify(entries, null, 2));
  return new LocationStore(storePath);
}

beforeEach(() => {
  tempDirs = [];
});

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tempDirs = [];
});

function text(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0].text;
}

// =========================================================================
// Layer 1 — Handler
// =========================================================================

describe('Handler layer — list/get/remove tolerate a malformed entry', () => {
  it.each(DEFECT_FIXTURES)(
    'list names the $field defect on its own alias and renders `work` in full',
    async ({ alias, entry, field, problem }) => {
      const store = newStore({ work: validWorkEntry(), [alias]: entry });

      const result = await handleListSavedLocations(store);
      const rendered = text(result);

      // `work` renders exactly as an unaffected entry would.
      expect(rendered).toContain('## `work`');
      expect(rendered).toMatch(/## `work`\n\n\*\*Name:\*\* Office/);
      expect(rendered).toContain('**Coordinates:** 47.6100°, -122.3300°');

      // The bad alias is named, not rendered — the full warning construct,
      // not a bare field-name substring (GOTCHAS G62).
      expect(rendered).toContain(`## \`${escapedAlias(alias)}\``);
      expect(rendered).toContain(warningLine(alias, field, problem));

      // The count line still counts every entry, healthy or not.
      expect(rendered).toContain('**Total:** 2 locations');

      // Usage examples name only the healthy alias.
      expect(rendered).toContain('get_forecast(location_name="work")');
      expect(rendered).not.toContain(`get_forecast(location_name="${alias}")`);
    }
  );

  it('renders no Usage Examples block when every entry is malformed', async () => {
    const store = newStore({ bad_name: badNameEntry() });

    const rendered = text(await handleListSavedLocations(store));

    expect(rendered).toContain('**Total:** 1 location');
    expect(rendered).toContain(warningLine('bad_name', 'name', 'is not text'));
    expect(rendered).not.toContain('**Usage Examples:**');
  });

  it.each(DEFECT_FIXTURES)(
    'get rejects the $field defect with the fixed message naming the field and the store path',
    async ({ alias, entry, field, problem }) => {
      const store = newStore({ work: validWorkEntry(), [alias]: entry });

      await expect(handleGetSavedLocation({ alias }, store)).rejects.toThrow(
        getDefectMessage(alias, field, problem, store.getStorePath())
      );
    }
  );

  it('get renders a healthy alias normally regardless of a malformed neighbour', async () => {
    const store = newStore({ work: validWorkEntry(), bad_name: badNameEntry() });

    const rendered = text(await handleGetSavedLocation({ alias: 'work' }, store));

    expect(rendered).toContain('**Name:** Office');
  });

  it('remove succeeds on the malformed alias, and the next list has no warning line', async () => {
    const store = newStore({ work: validWorkEntry(), bad_name: badNameEntry() });

    const removeResult = await handleRemoveSavedLocation({ alias: 'bad_name' }, store);
    expect(text(removeResult)).toContain(
      `Successfully removed location: \`${escapedAlias('bad_name')}\``
    );

    const rendered = text(await handleListSavedLocations(store));
    expect(rendered).not.toContain('⚠️');
    expect(rendered).toContain('**Total:** 1 location');
  });
});

// =========================================================================
// Layer 2 — Resolver
// =========================================================================

describe('Resolver layer — resolveLocation / resolveLocationAsync / resolveCountryCode', () => {
  it('resolves a healthy alias past a neighbour with a bad alternateNames, but a miss still reports "not found"', () => {
    const store = newStore({
      work: validWorkEntry(),
      bad_alt: badAlternateNamesEntry(),
    });

    const resolved = resolveLocation({ location_name: 'work' }, store);
    expect(resolved.location_name).toBe('work');
    expect(resolved.latitude).toBeCloseTo(47.61);

    // A genuine miss enters the alternate-names scan (the exact-alias lookup
    // failed), where the malformed neighbour lives — it must be skipped, not
    // thrown from, so the miss still reports the ordinary message.
    expect(() => resolveLocation({ location_name: 'nowhere' }, store)).toThrow(/not found/i);
  });

  it('resolves a healthy alias past a neighbour with a bad (string) latitude', () => {
    const store = newStore({
      work: validWorkEntry(),
      bad_lat: badLatitudeEntry(),
    });

    const resolved = resolveLocation({ location_name: 'work' }, store);
    expect(resolved.location_name).toBe('work');
    expect(resolved.latitude).toBeCloseTo(47.61);
    expect(resolved.longitude).toBeCloseTo(-122.33);
  });

  it('refuses the bad-coordinate alias itself with SavedLocationCoordinateError', () => {
    const store = newStore({
      work: validWorkEntry(),
      bad_lat: badLatitudeEntry(),
    });

    let caught: unknown;
    try {
      resolveLocation({ location_name: 'bad_lat' }, store);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SavedLocationCoordinateError);
    expect((caught as Error).message).toContain(
      'Saved location "bad_lat" has an invalid coordinate'
    );
  });

  it('still resolves a bad-name alias with valid coordinates (Dan\'s decision row)', () => {
    const store = newStore({
      work: validWorkEntry(),
      bad_name: badNameEntry(),
    });

    const resolved = resolveLocation({ location_name: 'bad_name' }, store);
    expect(resolved.location_name).toBe('bad_name');
    expect(resolved.latitude).toBeCloseTo(47.62);
    expect(resolved.longitude).toBeCloseTo(-122.32);
  });

  it('drops a non-string country_code and resolves it through resolveCountryCode via the reverse lookup', async () => {
    const store = newStore({
      work: validWorkEntry(),
      bad_country: badCountryCodeEntry(),
      gb: goodCountryCodeEntry(),
    });

    const resolved = resolveLocation({ location_name: 'bad_country' }, store);
    expect('country_code' in resolved ? resolved.country_code : undefined).toBeUndefined();

    const stub = { reverseCountry: vi.fn(async () => 'us') } as unknown as NominatimService;
    const outcome = await resolveCountryCode(
      resolved.country_code,
      resolved.latitude,
      resolved.longitude,
      stub
    );

    expect(outcome).toEqual({ countryCode: 'us', lookupFailed: false });
    expect(stub.reverseCountry).toHaveBeenCalledTimes(1);
  });

  it('control: a valid string country_code is kept and the reverse lookup is never called', async () => {
    const store = newStore({
      work: validWorkEntry(),
      bad_country: badCountryCodeEntry(),
      gb: goodCountryCodeEntry(),
    });

    const resolved = resolveLocation({ location_name: 'gb' }, store);
    expect(resolved.country_code).toBe('GB');

    const stub = { reverseCountry: vi.fn(async () => 'us') } as unknown as NominatimService;
    const outcome = await resolveCountryCode(
      resolved.country_code,
      resolved.latitude,
      resolved.longitude,
      stub
    );

    expect(outcome).toEqual({ countryCode: 'gb', lookupFailed: false });
    expect(stub.reverseCountry).not.toHaveBeenCalled();
  });

  describe('WEATHER_DEFAULT_LOCATION fallback', () => {
    const ENV_KEY = 'WEATHER_DEFAULT_LOCATION';
    let savedEnv: string | undefined;

    beforeEach(() => {
      savedEnv = process.env[ENV_KEY];
      delete process.env[ENV_KEY];
    });

    afterEach(() => {
      if (savedEnv === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = savedEnv;
      }
    });

    function makeGeoStub(): { service: GeocodingService; geocode: ReturnType<typeof vi.fn> } {
      const result: GeocodingResult = {
        name: 'Home',
        display_name: 'Home, Somewhere',
        latitude: 10,
        longitude: 10,
        confidence: 'high',
        source: 'openmeteo',
      };
      const geocode = vi.fn(async () => [result]);
      return { service: { geocode } as unknown as GeocodingService, geocode };
    }

    it('rejects with the bad-coordinate message and never geocodes, when the default alias is broken', async () => {
      const store = newStore({ home: badLatitudeEntry() });
      process.env[ENV_KEY] = 'home';
      const { service, geocode } = makeGeoStub();

      await expect(resolveLocationAsync({}, store, service)).rejects.toThrow(
        'Saved location "home" has an invalid coordinate'
      );
      expect(geocode).not.toHaveBeenCalled();
    });

    it('control: the same stub answers when the default names no saved alias at all', async () => {
      const store = newStore({ home: badLatitudeEntry() });
      process.env[ENV_KEY] = 'elsewhere';
      const { service, geocode } = makeGeoStub();

      const resolved = await resolveLocationAsync({}, store, service);

      expect(resolved.source).toBe('default');
      expect(geocode).toHaveBeenCalledTimes(1);
    });
  });
});

// =========================================================================
// Layer 3 — Dispatch (createWeatherServer over InMemoryTransport)
// =========================================================================

describe('Dispatch layer — public MCP surface', () => {
  async function connect(store: LocationStore): Promise<{
    client: Client;
    server: ReturnType<typeof createWeatherServer>;
  }> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createWeatherServer({ locationStore: store });
    await server.connect(serverTransport);

    const client = new Client({ name: 'saved-locations-malformed-entry-test', version: '0.0.0' });
    await client.connect(clientTransport);

    return { client, server };
  }

  it('C2 end to end: valid save, refused bad save, list still shows the original name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'weather-mcp-malformed-dispatch-'));
    tempDirs.push(dir);
    const store = new LocationStore(join(dir, 'locations.json'));
    const { client, server } = await connect(store);

    try {
      const saved = await client.callTool({
        name: 'save_location',
        arguments: { alias: 'home', latitude: 47.6062, longitude: -122.3321, name: 'Seattle' },
      });
      expect(saved.isError).toBeFalsy();

      const refused = await client.callTool({
        name: 'save_location',
        arguments: { alias: 'home', name: 42 },
      });
      expect(refused.isError).toBe(true);
      expect(
        text(refused as { content: Array<{ type: string; text: string }> })
      ).toBe('Error: name must be a string');

      const listed = await client.callTool({ name: 'list_saved_locations', arguments: {} });
      expect(listed.isError).toBeFalsy();
      expect(
        text(listed as { content: Array<{ type: string; text: string }> })
      ).toContain('**Name:** Seattle');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('get_saved_location on a hand-written bad entry returns isError with the fixed message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'weather-mcp-malformed-dispatch-'));
    tempDirs.push(dir);
    const storePath = join(dir, 'locations.json');
    writeFileSync(storePath, JSON.stringify({ broken: badNameEntry() }, null, 2));
    const store = new LocationStore(storePath);
    const { client, server } = await connect(store);

    try {
      const result = await client.callTool({
        name: 'get_saved_location',
        arguments: { alias: 'broken' },
      });

      expect(result.isError).toBe(true);
      const rendered = text(result as { content: Array<{ type: string; text: string }> });
      expect(rendered).toContain(
        getDefectMessage('broken', 'name', 'is not text', store.getStorePath())
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
