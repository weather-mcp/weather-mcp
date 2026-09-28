/**
 * Pins RF-03: aliases and tool names named after `Object.prototype` members
 * ("constructor", "__proto__") must resolve as ordinary, independent aliases
 * — never as a phantom "already exists" entry and never by silently
 * discarding a write.
 *
 * Covers the design plan's Verification contracts 1, 2, 3 and 6
 * (.devdocs/plan-own-key-lookups.md), driven through the handlers per G45
 * (a store-only check cannot see the handler's "Successfully removed"
 * rendering), with a real temp-dir LocationStore and real fs reads per G70
 * (no 'fs' mock — the store's own atomic-write path must actually run).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocationStore } from '../../src/services/locationStore.js';
import type { SavedLocationsStore } from '../../src/types/savedLocations.js';
import {
  handleSaveLocation,
  handleGetSavedLocation,
  handleListSavedLocations,
  handleRemoveSavedLocation
} from '../../src/handlers/savedLocationsHandler.js';
import {
  resolveLocation,
  resolveLocationAsync,
  clearCityGeocodeCache
} from '../../src/utils/locationResolver.js';
import type { GeocodingService } from '../../src/services/geocoding.js';
import { NominatimService } from '../../src/services/nominatim.js';

// The two reserved names this plan fixes, plus a lowercase-but-not-on-the-
// prototype control. `tostring` lowercases from "toString" the same way the
// two reserved names lowercase from themselves — it is the design's control
// column, and every reserved-name assertion below has a `tostring` row that
// must behave identically to a never-broken alias like "home".
const RESERVED_ALIASES = ['constructor', '__proto__', 'tostring'] as const;

describe('Saved location reserved aliases (RF-03)', () => {
  let tempDir: string;
  let storePath: string;
  let store: LocationStore;
  let nominatimService: NominatimService;
  const originalDefaultLocation = process.env.WEATHER_DEFAULT_LOCATION;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-reserved-alias-'));
    storePath = join(tempDir, 'locations.json');
    store = new LocationStore(storePath);
    nominatimService = new NominatimService();
    clearCityGeocodeCache();
  });

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    if (originalDefaultLocation === undefined) {
      delete process.env.WEATHER_DEFAULT_LOCATION;
    } else {
      process.env.WEATHER_DEFAULT_LOCATION = originalDefaultLocation;
    }
    clearCityGeocodeCache();
  });

  /** Write a file holding only `home`, well-formed, bypassing the store's own writer. */
  function writeHomeOnlyFile(): void {
    writeFileSync(
      storePath,
      JSON.stringify(
        {
          home: {
            name: 'Seattle, WA',
            latitude: 47.6062,
            longitude: -122.3321,
            saved_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z'
          }
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  describe.each(RESERVED_ALIASES)('alias "%s"', (alias) => {
    describe.each([
      ['an absent file', false],
      ['a file holding only home', true]
    ] as const)('Contract 1 — not found, on %s', (_label, startWithHome) => {
      beforeEach(() => {
        if (startWithHome) writeHomeOnlyFile();
      });

      it('has/get/remove all report not-found, and nothing is written', () => {
        const before = startWithHome ? readFileSync(storePath) : undefined;
        const existedBefore = existsSync(storePath);

        expect(store.has(alias)).toBe(false);
        expect(store.get(alias)).toBeUndefined();
        expect(store.remove(alias)).toBe(false);

        if (startWithHome) {
          // Byte-identical: has/get/remove read-only, they must not touch the file.
          expect(Buffer.compare(readFileSync(storePath), before as Buffer)).toBe(0);
        } else {
          expect(existsSync(storePath)).toBe(existedBefore);
          expect(existsSync(storePath)).toBe(false);
        }
      });

      it('handleGetSavedLocation rejects with the ordinary not-found message', async () => {
        await expect(handleGetSavedLocation({ alias }, store)).rejects.toThrow(
          `Location "${alias}" not found.`
        );
      });

      it('handleRemoveSavedLocation rejects with the ordinary not-found message', async () => {
        await expect(handleRemoveSavedLocation({ alias }, store)).rejects.toThrow(
          `Location "${alias}" not found.`
        );
      });

      it('resolveLocation rejects with saved-location-not-found, never invalid-coordinate', () => {
        let thrown: unknown;
        try {
          resolveLocation({ location_name: alias }, store);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain(`Saved location "${alias}" not found.`);
        expect((thrown as Error).message).not.toMatch(/invalid coordinate/i);
      });
    });

    describe.each([
      ['an absent file', false],
      ['a file holding only home', true]
    ] as const)('Contract 2 — save (new), then update, then remove, on %s', (_label, startWithHome) => {
      beforeEach(() => {
        if (startWithHome) writeHomeOnlyFile();
      });

      it('renders a correct new save, round-trips through disk, lists, and updates cleanly', async () => {
        const homeBefore = startWithHome ? store.get('home') : undefined;

        const firstSave = await handleSaveLocation(
          { alias, name: 'Reserved Alias Test', latitude: 10, longitude: 20 },
          store,
          nominatimService
        );
        // Anchor on the heading construct only (G116): the alias itself renders
        // inside backticks via escapeMarkdown elsewhere in this output, and
        // escapeMarkdown inside a code span is a known pre-existing rendering
        // defect (a literal alias like "__proto__" would show a stray
        // backslash) — this contract is about the save/update distinction, not
        // that rendering, so it never asserts on the alias-bearing lines.
        expect(firstSave.content[0].text.startsWith('# Saved Location')).toBe(true);

        const parsedAfterFirstSave = JSON.parse(readFileSync(storePath, 'utf-8')) as Record<
          string,
          { saved_at?: unknown }
        >;
        expect(Object.hasOwn(parsedAfterFirstSave, alias)).toBe(true);
        expect(typeof parsedAfterFirstSave[alias].saved_at).toBe('string');

        // A fresh store instance (no in-process state) reads the same record back.
        const freshStore = new LocationStore(storePath);
        const reread = freshStore.get(alias);
        expect(reread).toBeDefined();
        expect(reread?.name).toBe('Reserved Alias Test');

        const listing = await handleListSavedLocations(store);
        expect(listing.content[0].text).toContain('**Name:** Reserved Alias Test');

        const secondSave = await handleSaveLocation(
          { alias, name: 'Reserved Alias Test Renamed', latitude: 10, longitude: 20 },
          store,
          nominatimService
        );
        expect(secondSave.content[0].text.startsWith('# Updated Location')).toBe(true);
        const afterSecondSave = store.get(alias);
        expect(afterSecondSave?.saved_at).toBe(reread?.saved_at);
        expect(afterSecondSave?.name).toBe('Reserved Alias Test Renamed');

        const resolved = resolveLocation({ location_name: alias }, store);
        expect(resolved.latitude).toBe(10);
        expect(resolved.longitude).toBe(20);

        expect(store.remove(alias)).toBe(true);
        expect(store.has(alias)).toBe(false);
        const afterRemove = JSON.parse(readFileSync(storePath, 'utf-8')) as Record<string, unknown>;
        expect(Object.hasOwn(afterRemove, alias)).toBe(false);

        if (startWithHome) {
          expect(store.get('home')).toEqual(homeBefore);
        }
      });
    });
  });

  // Contract 3 is specifically about a hand-edited "__proto__" already on disk
  // — it is not parameterized over RESERVED_ALIASES.
  describe('Contract 3 — a hand-edited __proto__ entry already on disk', () => {
    // Fixture trap: JSON.stringify({ __proto__: { ... } }) does NOT serialize
    // a "__proto__" field. The object-literal key `__proto__:` is special
    // ECMAScript grammar that sets the *literal's own prototype*, not an
    // ordinary own property, so JSON.stringify walks past it and emits
    // nothing for that entry. A hand-edited file on disk has no such
    // special-casing — it is just JSON text — so the fixture must be written
    // as a raw JSON *string*, never built by round-tripping a JS object
    // literal through JSON.stringify.
    const RAW_FILE =
      '{"__proto__":{"name":"P","latitude":1,"longitude":2,' +
      '"saved_at":"2026-01-01T00:00:00.000Z","updated_at":"2026-01-01T00:00:00.000Z"},' +
      '"home":{"name":"Seattle, WA","latitude":47.6062,"longitude":-122.3321,' +
      '"saved_at":"2026-01-01T00:00:00.000Z","updated_at":"2026-01-01T00:00:00.000Z"}}';

    beforeEach(() => {
      writeFileSync(storePath, RAW_FILE, 'utf-8');
    });

    it('reads back correctly: get() finds it, count() sees both entries', () => {
      expect(store.get('__proto__')?.name).toBe('P');
      expect(store.count()).toBe(2);
    });

    it('survives an unrelated set() on a different alias', () => {
      store.set('home', { name: 'Seattle Updated', latitude: 47.6062, longitude: -122.3321 });

      const rewritten = JSON.parse(readFileSync(storePath, 'utf-8')) as Record<
        string,
        { name?: unknown }
      >;
      expect(Object.hasOwn(rewritten, '__proto__')).toBe(true);
      expect(rewritten.__proto__.name).toBe('P');
      expect(store.count()).toBe(2);
    });
  });

  // The redundancy case: load() is spied to return an ORDINARY object (the
  // design's hypothetical third return path), so this proves the own-key
  // checks in get/has/remove hold on their own, independent of load()'s
  // null-prototype fix.
  describe('Redundancy — get/has/remove refuse "constructor" even when load() hands back an ordinary object', () => {
    it('has, get and remove all still refuse the inherited name', () => {
      const spy = vi.spyOn(store, 'load').mockReturnValue({} as SavedLocationsStore);
      try {
        expect(store.has('constructor')).toBe(false);
        expect(store.get('constructor')).toBeUndefined();
        expect(store.remove('constructor')).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // Default-location (G115): WEATHER_DEFAULT_LOCATION falling through from
  // "try the saved alias" to "geocode it as a place name" must only happen
  // when the alias is genuinely absent, never when it is a phantom found-but-
  // broken entry.
  describe('WEATHER_DEFAULT_LOCATION="constructor" (G115)', () => {
    function countingGeocodingStub(results: unknown[]): { service: GeocodingService; calls: string[] } {
      const calls: string[] = [];
      const service = {
        geocode: async (query: string) => {
          calls.push(query);
          return results;
        }
      } as unknown as GeocodingService;
      return { service, calls };
    }

    it('on an empty store, is genuinely not-found and reaches the geocoder exactly once', async () => {
      process.env.WEATHER_DEFAULT_LOCATION = 'constructor';
      const { service, calls } = countingGeocodingStub([
        {
          name: 'Geocoded Constructor',
          display_name: 'Geocoded Constructor',
          latitude: 5,
          longitude: 6,
          confidence: 'medium',
          source: 'openmeteo'
        }
      ]);

      const resolved = await resolveLocationAsync({}, store, service);

      expect(calls).toEqual(['constructor']);
      expect(resolved.source).toBe('default');
      expect(resolved.latitude).toBe(5);
      expect(resolved.longitude).toBe(6);
    });

    it('once "constructor" is saved, resolves to it with zero geocoder calls', async () => {
      process.env.WEATHER_DEFAULT_LOCATION = 'constructor';
      await handleSaveLocation(
        { alias: 'constructor', name: 'X', latitude: 10, longitude: 20 },
        store,
        nominatimService
      );
      const { service, calls } = countingGeocodingStub([]);

      const resolved = await resolveLocationAsync({}, store, service);

      expect(calls).toEqual([]);
      expect(resolved.source).toBe('default');
      expect(resolved.latitude).toBe(10);
      expect(resolved.longitude).toBe(20);
    });
  });
});
