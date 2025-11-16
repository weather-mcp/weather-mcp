import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocationStore } from '../../src/services/locationStore.js';
import { handleSaveLocation, handleGetSavedLocation, handleListSavedLocations } from '../../src/handlers/savedLocationsHandler.js';
import { NominatimService } from '../../src/services/nominatim.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Saved Locations - Activities Feature', () => {
  let locationStore: LocationStore;
  let nominatimService: NominatimService;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for test storage
    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-test-'));
    const storePath = join(tempDir, 'locations.json');
    locationStore = new LocationStore(storePath);
    nominatimService = new NominatimService();
  });

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Save location with activities', () => {
    it('should save location with single activity', async () => {
      const result = await handleSaveLocation(
        {
          alias: 'lake_house',
          latitude: 39.0968,
          longitude: -120.0324,
          name: 'Lake Tahoe',
          activities: ['boating']
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('lake_house');
      expect(savedLocation).toBeDefined();
      expect(savedLocation?.activities).toEqual(['boating']);
      expect(result.content[0].text).toContain('boating');
    });

    it('should save location with multiple activities', async () => {
      const result = await handleSaveLocation(
        {
          alias: 'cabin',
          latitude: 45.5,
          longitude: -122.5,
          name: 'Mountain Cabin',
          activities: ['hiking', 'camping', 'fishing']
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('cabin');
      expect(savedLocation).toBeDefined();
      expect(savedLocation?.activities).toEqual(['hiking', 'camping', 'fishing']);
      expect(result.content[0].text).toContain('hiking');
      expect(result.content[0].text).toContain('camping');
      expect(result.content[0].text).toContain('fishing');
    });

    it('should normalize activities to lowercase', async () => {
      await handleSaveLocation(
        {
          alias: 'beach',
          latitude: 34.0,
          longitude: -118.0,
          name: 'Beach House',
          activities: ['SURFING', 'Swimming', 'BeachVolleyball']
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('beach');
      expect(savedLocation?.activities).toEqual(['surfing', 'swimming', 'beachvolleyball']);
    });

    it('should trim whitespace from activities', async () => {
      await handleSaveLocation(
        {
          alias: 'park',
          latitude: 40.0,
          longitude: -105.0,
          name: 'City Park',
          activities: ['  running  ', ' cycling ', 'photography']
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('park');
      expect(savedLocation?.activities).toEqual(['running', 'cycling', 'photography']);
    });

    it('should skip empty activity strings', async () => {
      await handleSaveLocation(
        {
          alias: 'trail',
          latitude: 39.0,
          longitude: -106.0,
          name: 'Hiking Trail',
          activities: ['hiking', '', '  ', 'backpacking']
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('trail');
      expect(savedLocation?.activities).toEqual(['hiking', 'backpacking']);
    });

    it('should save location without activities', async () => {
      await handleSaveLocation(
        {
          alias: 'home',
          latitude: 47.6062,
          longitude: -122.3321,
          name: 'Seattle, WA'
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('home');
      expect(savedLocation).toBeDefined();
      expect(savedLocation?.activities).toBeUndefined();
    });

    it('should handle empty activities array', async () => {
      await handleSaveLocation(
        {
          alias: 'office',
          latitude: 37.7749,
          longitude: -122.4194,
          name: 'San Francisco Office',
          activities: []
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('office');
      expect(savedLocation?.activities).toBeUndefined();
    });
  });

  describe('Activities validation', () => {
    it('should reject non-array activities', async () => {
      await expect(
        handleSaveLocation(
          {
            alias: 'test',
            latitude: 40.0,
            longitude: -105.0,
            name: 'Test Location',
            activities: 'boating' as any
          },
          locationStore,
          nominatimService
        )
      ).rejects.toThrow('activities must be an array of strings');
    });

    it('should reject non-string activity items', async () => {
      await expect(
        handleSaveLocation(
          {
            alias: 'test',
            latitude: 40.0,
            longitude: -105.0,
            name: 'Test Location',
            activities: [123, 'boating'] as any
          },
          locationStore,
          nominatimService
        )
      ).rejects.toThrow('Each activity must be a string');
    });

    it('should reject activities longer than 50 characters', async () => {
      await expect(
        handleSaveLocation(
          {
            alias: 'test',
            latitude: 40.0,
            longitude: -105.0,
            name: 'Test Location',
            activities: ['a'.repeat(51)]
          },
          locationStore,
          nominatimService
        )
      ).rejects.toThrow('Each activity must be 50 characters or less');
    });

    it('should accept activities with exactly 50 characters', async () => {
      const fiftyCharActivity = 'a'.repeat(50);
      await handleSaveLocation(
        {
          alias: 'test',
          latitude: 40.0,
          longitude: -105.0,
          name: 'Test Location',
          activities: [fiftyCharActivity]
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('test');
      expect(savedLocation?.activities).toEqual([fiftyCharActivity]);
    });
  });

  describe('List and get with activities', () => {
    it('should display activities in get_saved_location', async () => {
      await handleSaveLocation(
        {
          alias: 'river',
          latitude: 45.0,
          longitude: -110.0,
          name: 'River Bend',
          activities: ['kayaking', 'fishing']
        },
        locationStore,
        nominatimService
      );

      const result = await handleGetSavedLocation(
        { alias: 'river' },
        locationStore
      );

      expect(result.content[0].text).toContain('kayaking');
      expect(result.content[0].text).toContain('fishing');
    });

    it('should display activities in list_saved_locations', async () => {
      await handleSaveLocation(
        {
          alias: 'lake',
          latitude: 45.0,
          longitude: -110.0,
          name: 'Lake View',
          activities: ['swimming', 'boating']
        },
        locationStore,
        nominatimService
      );

      const result = await handleListSavedLocations(locationStore);

      expect(result.content[0].text).toContain('swimming');
      expect(result.content[0].text).toContain('boating');
    });

    it('should not display activities section when none exist', async () => {
      await handleSaveLocation(
        {
          alias: 'city',
          latitude: 40.0,
          longitude: -105.0,
          name: 'City Center'
        },
        locationStore,
        nominatimService
      );

      const result = await handleGetSavedLocation(
        { alias: 'city' },
        locationStore
      );

      expect(result.content[0].text).not.toContain('**Activities:**');
    });
  });

  describe('Update location with activities', () => {
    it('should update activities for existing location', async () => {
      // Initial save
      await handleSaveLocation(
        {
          alias: 'spot',
          latitude: 45.0,
          longitude: -110.0,
          name: 'Favorite Spot',
          activities: ['hiking']
        },
        locationStore,
        nominatimService
      );

      // Update with new activities
      await handleSaveLocation(
        {
          alias: 'spot',
          latitude: 45.0,
          longitude: -110.0,
          name: 'Favorite Spot',
          activities: ['hiking', 'camping', 'photography']
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('spot');
      expect(savedLocation?.activities).toEqual(['hiking', 'camping', 'photography']);
    });

    it('should remove activities when updating with empty array', async () => {
      // Initial save
      await handleSaveLocation(
        {
          alias: 'place',
          latitude: 45.0,
          longitude: -110.0,
          name: 'Some Place',
          activities: ['skiing']
        },
        locationStore,
        nominatimService
      );

      // Update with empty array
      await handleSaveLocation(
        {
          alias: 'place',
          latitude: 45.0,
          longitude: -110.0,
          name: 'Some Place',
          activities: []
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('place');
      expect(savedLocation?.activities).toBeUndefined();
    });
  });

  describe('Partial updates (smart updates)', () => {
    it('should update only activities without re-specifying location', async () => {
      // Initial save
      await handleSaveLocation(
        {
          alias: 'campsite',
          latitude: 37.8651,
          longitude: -119.5383,
          name: 'Yosemite Valley',
          activities: ['camping']
        },
        locationStore,
        nominatimService
      );

      // Partial update: just add more activities
      await handleSaveLocation(
        {
          alias: 'campsite',
          activities: ['camping', 'grilling', 'hiking', 'mountain biking']
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('campsite');
      expect(savedLocation).toBeDefined();
      expect(savedLocation?.name).toBe('Yosemite Valley');
      expect(savedLocation?.latitude).toBe(37.8651);
      expect(savedLocation?.longitude).toBe(-119.5383);
      expect(savedLocation?.activities).toEqual(['camping', 'grilling', 'hiking', 'mountain biking']);
    });

    it('should update only name without re-specifying location', async () => {
      // Initial save
      await handleSaveLocation(
        {
          alias: 'beach',
          latitude: 34.0,
          longitude: -118.0,
          name: 'Beach Spot',
          activities: ['surfing']
        },
        locationStore,
        nominatimService
      );

      // Partial update: just change name
      await handleSaveLocation(
        {
          alias: 'beach',
          name: 'Santa Monica Beach'
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('beach');
      expect(savedLocation?.name).toBe('Santa Monica Beach');
      expect(savedLocation?.latitude).toBe(34.0);
      expect(savedLocation?.longitude).toBe(-118.0);
      expect(savedLocation?.activities).toEqual(['surfing']);
    });

    it('should update both name and activities without re-specifying location', async () => {
      // Initial save
      await handleSaveLocation(
        {
          alias: 'park',
          latitude: 40.0,
          longitude: -105.0,
          name: 'City Park',
          activities: ['running']
        },
        locationStore,
        nominatimService
      );

      // Partial update: change both name and activities
      await handleSaveLocation(
        {
          alias: 'park',
          name: 'Central Park',
          activities: ['running', 'cycling', 'photography']
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('park');
      expect(savedLocation?.name).toBe('Central Park');
      expect(savedLocation?.latitude).toBe(40.0);
      expect(savedLocation?.longitude).toBe(-105.0);
      expect(savedLocation?.activities).toEqual(['running', 'cycling', 'photography']);
    });

    it('should preserve existing activities when updating only name', async () => {
      // Initial save
      await handleSaveLocation(
        {
          alias: 'lake',
          latitude: 39.0968,
          longitude: -120.0324,
          name: 'Lake Location',
          activities: ['boating', 'fishing']
        },
        locationStore,
        nominatimService
      );

      // Partial update: only change name, don't specify activities
      await handleSaveLocation(
        {
          alias: 'lake',
          name: 'Lake Tahoe'
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('lake');
      expect(savedLocation?.name).toBe('Lake Tahoe');
      expect(savedLocation?.activities).toEqual(['boating', 'fishing']);
    });

    it('should require location details for new locations', async () => {
      // Trying to create a new location without coordinates should fail
      await expect(
        handleSaveLocation(
          {
            alias: 'newspot',
            activities: ['hiking']
          },
          locationStore,
          nominatimService
        )
      ).rejects.toThrow('Either location_query OR (latitude + longitude + name) must be provided');
    });

    it('should remove activities when partial update has empty array', async () => {
      // Initial save
      await handleSaveLocation(
        {
          alias: 'trail',
          latitude: 45.0,
          longitude: -110.0,
          name: 'Mountain Trail',
          activities: ['hiking', 'backpacking']
        },
        locationStore,
        nominatimService
      );

      // Partial update: remove all activities
      await handleSaveLocation(
        {
          alias: 'trail',
          activities: []
        },
        locationStore,
        nominatimService
      );

      const savedLocation = locationStore.get('trail');
      expect(savedLocation?.name).toBe('Mountain Trail');
      expect(savedLocation?.activities).toBeUndefined();
    });
  });
});
