import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocationStore } from '../../src/services/locationStore.js';
import { handleSaveLocation } from '../../src/handlers/savedLocationsHandler.js';
import type { NominatimService } from '../../src/services/nominatim.js';

/**
 * Pins the write-path name/metadata contracts added in 30a2d39 (T2):
 *   - a non-string `name` is refused on every save_location branch, before the
 *     one `await` and before anything is written (contract 1);
 *   - the pre-existing wrong-type checks for description/notes/alternateNames/
 *     activities still refuse before any write (contract 2);
 *   - an empty or whitespace-only `name` is treated as "not supplied", and
 *     each branch decides what that means (contract 4);
 *   - `LocationStore.set()` refuses a bad record directly, as the last line of
 *     defence for any writer (contract 5).
 *
 * All I/O is real (a temp-dir store, real fs reads) per G70 — no mocked fs.
 * The Nominatim geocoder is stubbed so the file stays offline.
 */

function bytesOf(path: string): Buffer {
  return readFileSync(path);
}

function tmpResidue(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.tmp'));
}

describe('Saved Locations - name/metadata write-path contracts', () => {
  let tempDir: string;
  let storePath: string;
  let locationStore: LocationStore;
  let geocoderCalls: number;
  let nominatimStub: NominatimService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-test-'));
    storePath = join(tempDir, 'locations.json');
    locationStore = new LocationStore(storePath);
    geocoderCalls = 0;
    nominatimStub = {
      searchLocation: async () => {
        geocoderCalls++;
        return {
          results: [
            {
              id: 1,
              name: 'Geocoded Town',
              latitude: 47.6,
              longitude: -122.3,
              country_code: 'US',
              admin1: 'Washington'
            }
          ]
        };
      }
    } as unknown as NominatimService;
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /** Seed a populated store: alias "home", direct branch, name "Seattle". */
  async function seedHome(): Promise<void> {
    await handleSaveLocation(
      { alias: 'home', latitude: 47.6062, longitude: -122.3321, name: 'Seattle' },
      locationStore,
      nominatimStub
    );
  }

  describe('contract 1: a non-string name is refused on every branch, before any write', () => {
    const badNames: Array<[string, unknown]> = [
      ['a number', 42],
      ['null', null],
      ['an object', {}]
    ];

    for (const [label, badName] of badNames) {
      it(`partial branch: name is ${label} -> rejects, bytes unchanged, no temp residue`, async () => {
        await seedHome();
        const before = bytesOf(storePath);

        await expect(
          handleSaveLocation({ alias: 'home', name: badName }, locationStore, nominatimStub)
        ).rejects.toThrow('name must be a string');

        expect(bytesOf(storePath).equals(before)).toBe(true);
        expect(tmpResidue(tempDir)).toEqual([]);
      });

      it(`geocode branch: name is ${label} -> rejects before the geocoder is called, bytes unchanged, no temp residue`, async () => {
        await seedHome();
        const before = bytesOf(storePath);

        await expect(
          handleSaveLocation(
            { alias: 'home', location_query: 'somewhere', name: badName },
            locationStore,
            nominatimStub
          )
        ).rejects.toThrow('name must be a string');

        expect(geocoderCalls).toBe(0);
        expect(bytesOf(storePath).equals(before)).toBe(true);
        expect(tmpResidue(tempDir)).toEqual([]);
      });

      it(`direct branch: name is ${label} -> rejects, bytes unchanged, no temp residue`, async () => {
        await seedHome();
        const before = bytesOf(storePath);

        await expect(
          handleSaveLocation(
            { alias: 'home', latitude: 47.6062, longitude: -122.3321, name: badName },
            locationStore,
            nominatimStub
          )
        ).rejects.toThrow('name must be a string');

        expect(bytesOf(storePath).equals(before)).toBe(true);
        expect(tmpResidue(tempDir)).toEqual([]);
      });
    }

    it('direct branch: an omitted name still rejects with the "required" message', async () => {
      await seedHome();
      const before = bytesOf(storePath);

      await expect(
        handleSaveLocation(
          { alias: 'home', latitude: 47.6062, longitude: -122.3321 },
          locationStore,
          nominatimStub
        )
      ).rejects.toThrow('name parameter is required when providing coordinates directly');

      expect(bytesOf(storePath).equals(before)).toBe(true);
      expect(tmpResidue(tempDir)).toEqual([]);
    });
  });

  describe('contract 2: wrong-typed metadata fields are refused on the partial branch, before any write', () => {
    it('description: 42 -> rejects with the existing message', async () => {
      await seedHome();
      const before = bytesOf(storePath);

      await expect(
        handleSaveLocation({ alias: 'home', description: 42 }, locationStore, nominatimStub)
      ).rejects.toThrow('description must be a string');

      expect(bytesOf(storePath).equals(before)).toBe(true);
      expect(tmpResidue(tempDir)).toEqual([]);
    });

    it('notes: 42 -> rejects with the existing message', async () => {
      await seedHome();
      const before = bytesOf(storePath);

      await expect(
        handleSaveLocation({ alias: 'home', notes: 42 }, locationStore, nominatimStub)
      ).rejects.toThrow('notes must be a string');

      expect(bytesOf(storePath).equals(before)).toBe(true);
      expect(tmpResidue(tempDir)).toEqual([]);
    });

    it('alternateNames: "x" -> rejects with the existing message', async () => {
      await seedHome();
      const before = bytesOf(storePath);

      await expect(
        handleSaveLocation({ alias: 'home', alternateNames: 'x' }, locationStore, nominatimStub)
      ).rejects.toThrow('alternateNames must be an array of strings');

      expect(bytesOf(storePath).equals(before)).toBe(true);
      expect(tmpResidue(tempDir)).toEqual([]);
    });

    it('activities: "boating" -> rejects with the existing message', async () => {
      await seedHome();
      const before = bytesOf(storePath);

      await expect(
        handleSaveLocation({ alias: 'home', activities: 'boating' }, locationStore, nominatimStub)
      ).rejects.toThrow('activities must be an array of strings');

      expect(bytesOf(storePath).equals(before)).toBe(true);
      expect(tmpResidue(tempDir)).toEqual([]);
    });
  });

  describe('contract 4: an empty or whitespace-only name is treated as not supplied, per branch', () => {
    it('partial branch: name "" keeps the stored name', async () => {
      await seedHome();
      await handleSaveLocation({ alias: 'home', name: '' }, locationStore, nominatimStub);
      expect(locationStore.get('home')?.name).toBe('Seattle');
    });

    it('partial branch: name "   " keeps the stored name', async () => {
      await seedHome();
      await handleSaveLocation({ alias: 'home', name: '   ' }, locationStore, nominatimStub);
      expect(locationStore.get('home')?.name).toBe('Seattle');
    });

    it('geocode branch: name "" uses the geocoded name', async () => {
      await seedHome();
      await handleSaveLocation(
        { alias: 'home', location_query: 'somewhere', name: '' },
        locationStore,
        nominatimStub
      );
      expect(locationStore.get('home')?.name).toBe('Geocoded Town');
    });

    it('geocode branch: name "   " uses the geocoded name', async () => {
      await seedHome();
      await handleSaveLocation(
        { alias: 'home', location_query: 'somewhere', name: '   ' },
        locationStore,
        nominatimStub
      );
      expect(locationStore.get('home')?.name).toBe('Geocoded Town');
    });

    it('direct branch: name "" rejects with the "required" message, bytes unchanged', async () => {
      await seedHome();
      const before = bytesOf(storePath);

      await expect(
        handleSaveLocation(
          { alias: 'home', latitude: 47.6062, longitude: -122.3321, name: '' },
          locationStore,
          nominatimStub
        )
      ).rejects.toThrow('name parameter is required when providing coordinates directly');

      expect(bytesOf(storePath).equals(before)).toBe(true);
    });

    it('direct branch: name "   " rejects with the "required" message, bytes unchanged', async () => {
      await seedHome();
      const before = bytesOf(storePath);

      await expect(
        handleSaveLocation(
          { alias: 'home', latitude: 47.6062, longitude: -122.3321, name: '   ' },
          locationStore,
          nominatimStub
        )
      ).rejects.toThrow('name parameter is required when providing coordinates directly');

      expect(bytesOf(storePath).equals(before)).toBe(true);
    });

    it('partial branch: name "  Portland  " stores the trimmed name', async () => {
      await seedHome();
      await handleSaveLocation({ alias: 'home', name: '  Portland  ' }, locationStore, nominatimStub);
      expect(locationStore.get('home')?.name).toBe('Portland');
    });
  });

  describe('contract 5: LocationStore.set() refuses a bad record directly', () => {
    it('a non-string name throws "name must be a string" on a fresh store; no file is created', () => {
      expect(() =>
        locationStore.set('x', {
          name: 42 as unknown as string,
          latitude: 47.6,
          longitude: -122.3
        })
      ).toThrow('name must be a string');

      expect(existsSync(storePath)).toBe(false);
    });

    it('a non-array activities throws "activities must be an array of strings" on a fresh store; no file is created', () => {
      expect(() =>
        locationStore.set('x', {
          name: 'X',
          latitude: 47.6,
          longitude: -122.3,
          activities: 'boating' as unknown as string[]
        })
      ).toThrow('activities must be an array of strings');

      expect(existsSync(storePath)).toBe(false);
    });

    it('on a populated store, a bad direct set() call leaves the bytes identical', async () => {
      await seedHome();
      const before = bytesOf(storePath);

      expect(() =>
        locationStore.set('home', {
          name: 42 as unknown as string,
          latitude: 47.6,
          longitude: -122.3
        })
      ).toThrow('name must be a string');

      expect(bytesOf(storePath).equals(before)).toBe(true);
    });
  });
});
