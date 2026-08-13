import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocationStore } from '../../src/services/locationStore.js';
import { handleSaveLocation } from '../../src/handlers/savedLocationsHandler.js';
import { NominatimService } from '../../src/services/nominatim.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Saved Locations - Metadata preservation on update (bug fix F1)', () => {
  let locationStore: LocationStore;
  let nominatimService: NominatimService;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-test-'));
    const storePath = join(tempDir, 'locations.json');
    locationStore = new LocationStore(storePath);
    nominatimService = new NominatimService();
  });

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  describe('New location save persists all provided fields (regression guard)', () => {
    it('should persist description, alternateNames, and notes on initial save', async () => {
      const result = await handleSaveLocation(
        {
          alias: 'auntlisa',
          latitude: 41.8781,
          longitude: -87.6298,
          name: "Aunt Lisa's House",
          description: "My sister's house",
          alternateNames: ["sister's place", "Lisa's house"],
          notes: 'Bring an umbrella, always rains there'
        },
        locationStore,
        nominatimService
      );

      const saved = locationStore.get('auntlisa');
      expect(saved?.description).toBe("My sister's house");
      expect(saved?.alternateNames).toEqual(["sister's place", "Lisa's house"]);
      expect(saved?.notes).toBe('Bring an umbrella, always rains there');

      expect(result.content[0].text).toContain("My sister's house");
      expect(result.content[0].text).toContain("sister's place");
      expect(result.content[0].text).toContain('Bring an umbrella');
    });
  });

  describe('Partial update preserves metadata (the exact live repro for F1)', () => {
    it('should keep description, alternateNames, and notes intact after an activities-only update', async () => {
      // Initial save with full metadata
      await handleSaveLocation(
        {
          alias: 'cabin',
          latitude: 39.0968,
          longitude: -120.0324,
          name: 'Lake Tahoe Cabin',
          description: 'The lake house',
          alternateNames: ['the cabin', 'tahoe place'],
          notes: 'Winterize by November'
        },
        locationStore,
        nominatimService
      );

      // Partial update: only touch activities
      const result = await handleSaveLocation(
        {
          alias: 'cabin',
          activities: ['boating', 'fishing']
        },
        locationStore,
        nominatimService
      );

      const saved = locationStore.get('cabin');
      expect(saved?.name).toBe('Lake Tahoe Cabin');
      expect(saved?.latitude).toBe(39.0968);
      expect(saved?.longitude).toBe(-120.0324);
      expect(saved?.activities).toEqual(['boating', 'fishing']);

      // The bug: these used to be silently dropped (set to undefined) on any update
      expect(saved?.description).toBe('The lake house');
      expect(saved?.alternateNames).toEqual(['the cabin', 'tahoe place']);
      expect(saved?.notes).toBe('Winterize by November');

      // Confirmation output should reflect the effective (post-merge) values
      expect(result.content[0].text).toContain('The lake house');
      expect(result.content[0].text).toContain('the cabin');
      expect(result.content[0].text).toContain('Winterize by November');
    });

    it('should preserve metadata when updating only the name', async () => {
      await handleSaveLocation(
        {
          alias: 'office',
          latitude: 37.7749,
          longitude: -122.4194,
          name: 'SF Office',
          description: 'Downtown office',
          notes: 'Badge required'
        },
        locationStore,
        nominatimService
      );

      await handleSaveLocation(
        {
          alias: 'office',
          name: 'San Francisco HQ'
        },
        locationStore,
        nominatimService
      );

      const saved = locationStore.get('office');
      expect(saved?.name).toBe('San Francisco HQ');
      expect(saved?.description).toBe('Downtown office');
      expect(saved?.notes).toBe('Badge required');
    });
  });

  describe('Explicit clear vs omit semantics', () => {
    it('should clear description with an explicit empty string while omitted fields are kept', async () => {
      await handleSaveLocation(
        {
          alias: 'trailhead',
          latitude: 45.0,
          longitude: -110.0,
          name: 'Mountain Trailhead',
          description: 'Start of the loop trail',
          alternateNames: ['the trailhead'],
          notes: 'Parking fills up early'
        },
        locationStore,
        nominatimService
      );

      await handleSaveLocation(
        {
          alias: 'trailhead',
          description: ''
        },
        locationStore,
        nominatimService
      );

      const saved = locationStore.get('trailhead');
      expect(saved?.description).toBeUndefined();
      // Omitted fields remain untouched
      expect(saved?.alternateNames).toEqual(['the trailhead']);
      expect(saved?.notes).toBe('Parking fills up early');
    });

    it('should clear alternateNames with an explicit empty array', async () => {
      await handleSaveLocation(
        {
          alias: 'park',
          latitude: 40.0,
          longitude: -105.0,
          name: 'City Park',
          alternateNames: ['the park', 'central green']
        },
        locationStore,
        nominatimService
      );

      await handleSaveLocation(
        {
          alias: 'park',
          alternateNames: []
        },
        locationStore,
        nominatimService
      );

      const saved = locationStore.get('park');
      expect(saved?.alternateNames).toBeUndefined();
    });

    it('should clear notes with an explicit empty string', async () => {
      await handleSaveLocation(
        {
          alias: 'river',
          latitude: 45.0,
          longitude: -110.0,
          name: 'River Bend',
          notes: 'Watch for high water in spring'
        },
        locationStore,
        nominatimService
      );

      await handleSaveLocation(
        {
          alias: 'river',
          notes: ''
        },
        locationStore,
        nominatimService
      );

      const saved = locationStore.get('river');
      expect(saved?.notes).toBeUndefined();
    });

    it('should never persist empty strings or arrays — cleared fields normalize to undefined', async () => {
      await handleSaveLocation(
        {
          alias: 'lot',
          latitude: 40.0,
          longitude: -105.0,
          name: 'Parking Lot',
          description: '   ', // whitespace-only should also normalize to undefined
          alternateNames: ['', '   '],
          notes: '\t\n'
        },
        locationStore,
        nominatimService
      );

      const saved = locationStore.get('lot');
      expect(saved?.description).toBeUndefined();
      expect(saved?.alternateNames).toBeUndefined();
      expect(saved?.notes).toBeUndefined();
    });
  });

  describe('Full re-save with new coordinates preserves omitted metadata', () => {
    it('should keep description, alternateNames, and notes when re-saving with new coordinates', async () => {
      await handleSaveLocation(
        {
          alias: 'movedspot',
          latitude: 34.0,
          longitude: -118.0,
          name: 'Old Spot',
          description: 'A favorite hangout',
          alternateNames: ['the spot'],
          notes: 'Great sunsets'
        },
        locationStore,
        nominatimService
      );

      // Full re-save: new coordinates + name provided, metadata omitted
      const result = await handleSaveLocation(
        {
          alias: 'movedspot',
          latitude: 34.5,
          longitude: -118.5,
          name: 'New Spot'
        },
        locationStore,
        nominatimService
      );

      const saved = locationStore.get('movedspot');
      expect(saved?.name).toBe('New Spot');
      expect(saved?.latitude).toBe(34.5);
      expect(saved?.longitude).toBe(-118.5);

      // The bug: full re-save also silently dropped these
      expect(saved?.description).toBe('A favorite hangout');
      expect(saved?.alternateNames).toEqual(['the spot']);
      expect(saved?.notes).toBe('Great sunsets');

      expect(result.content[0].text).toContain('A favorite hangout');
      expect(result.content[0].text).toContain('the spot');
      expect(result.content[0].text).toContain('Great sunsets');
    });

    it('should allow overriding metadata during a full re-save while other fields stay preserved', async () => {
      await handleSaveLocation(
        {
          alias: 'campsite',
          latitude: 37.8651,
          longitude: -119.5383,
          name: 'Yosemite Valley',
          description: 'Base camp',
          alternateNames: ['the valley'],
          notes: 'Bear boxes provided'
        },
        locationStore,
        nominatimService
      );

      await handleSaveLocation(
        {
          alias: 'campsite',
          latitude: 37.9,
          longitude: -119.6,
          name: 'Yosemite Valley',
          description: 'New base camp location'
          // alternateNames and notes omitted -> preserved
        },
        locationStore,
        nominatimService
      );

      const saved = locationStore.get('campsite');
      expect(saved?.description).toBe('New base camp location');
      expect(saved?.alternateNames).toEqual(['the valley']);
      expect(saved?.notes).toBe('Bear boxes provided');
    });
  });

  describe('Validation', () => {
    it('should reject non-string description', async () => {
      await expect(
        handleSaveLocation(
          {
            alias: 'test',
            latitude: 40.0,
            longitude: -105.0,
            name: 'Test Location',
            description: 123 as any
          },
          locationStore,
          nominatimService
        )
      ).rejects.toThrow('description must be a string');
    });

    it('should reject non-array alternateNames', async () => {
      await expect(
        handleSaveLocation(
          {
            alias: 'test',
            latitude: 40.0,
            longitude: -105.0,
            name: 'Test Location',
            alternateNames: 'nope' as any
          },
          locationStore,
          nominatimService
        )
      ).rejects.toThrow('alternateNames must be an array of strings');
    });

    it('should reject non-string alternateNames entries', async () => {
      await expect(
        handleSaveLocation(
          {
            alias: 'test',
            latitude: 40.0,
            longitude: -105.0,
            name: 'Test Location',
            alternateNames: [123] as any
          },
          locationStore,
          nominatimService
        )
      ).rejects.toThrow('Each alternate name must be a string');
    });

    it('should reject non-string notes', async () => {
      await expect(
        handleSaveLocation(
          {
            alias: 'test',
            latitude: 40.0,
            longitude: -105.0,
            name: 'Test Location',
            notes: 123 as any
          },
          locationStore,
          nominatimService
        )
      ).rejects.toThrow('notes must be a string');
    });
  });
});
