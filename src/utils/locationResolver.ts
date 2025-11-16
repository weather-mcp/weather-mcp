/**
 * Utility for resolving location coordinates from various input formats
 */

import { LocationStore } from '../services/locationStore.js';
import { validateLatitude, validateLongitude } from './validation.js';

export interface LocationInput {
  latitude?: number;
  longitude?: number;
  location_name?: string;
}

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  source: 'coordinates' | 'saved_location';
  location_name?: string;
}

/**
 * Resolve location coordinates from either direct coordinates or a saved location name
 *
 * @param args - Arguments containing either (latitude + longitude) OR location_name
 * @param locationStore - Location store instance
 * @returns Resolved coordinates and metadata
 * @throws Error if neither coordinates nor location_name provided, or if validation fails
 */
export function resolveLocation(
  args: LocationInput,
  locationStore: LocationStore
): ResolvedLocation {
  // Check if location_name is provided
  if (args.location_name && typeof args.location_name === 'string') {
    const locationName = args.location_name.toLowerCase().trim();

    if (locationName.length === 0) {
      throw new Error('location_name cannot be empty');
    }

    const savedLocation = locationStore.get(locationName);

    if (!savedLocation) {
      const available = Object.keys(locationStore.getAll());
      throw new Error(
        `Saved location "${locationName}" not found.\n\n` +
        (available.length > 0
          ? `Available locations: ${available.join(', ')}\n\n`
          : 'No saved locations yet. Use save_location to create one.\n\n') +
        `Use list_saved_locations to see all saved locations.`
      );
    }

    return {
      latitude: savedLocation.latitude,
      longitude: savedLocation.longitude,
      source: 'saved_location',
      location_name: locationName
    };
  }

  // Check if direct coordinates are provided
  if (typeof args.latitude === 'number' && typeof args.longitude === 'number') {
    validateLatitude(args.latitude);
    validateLongitude(args.longitude);

    return {
      latitude: args.latitude,
      longitude: args.longitude,
      source: 'coordinates'
    };
  }

  // Neither location_name nor coordinates provided
  throw new Error(
    'Either location_name OR (latitude + longitude) must be provided.\n\n' +
    'Examples:\n' +
    '  - Using coordinates: latitude=47.6062, longitude=-122.3321\n' +
    '  - Using saved location: location_name="home"\n\n' +
    'Use save_location to save frequently used locations.'
  );
}
