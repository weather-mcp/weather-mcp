/**
 * Geographic utility functions for location detection and classification
 */

/**
 * Bounding box for a geographic region
 */
interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * Geographic region with bounding box and metadata
 */
interface GeographicRegion {
  name: string;
  bbox: BoundingBox;
  description?: string;
}

/**
 * Great Lakes bounding boxes (approximate)
 * Source: NOAA Great Lakes Environmental Research Laboratory
 */
const GREAT_LAKES_REGIONS: GeographicRegion[] = [
  {
    name: 'Lake Superior',
    bbox: {
      minLat: 46.4,
      maxLat: 49.0,
      minLon: -92.2,
      maxLon: -84.3
    },
    description: 'Largest Great Lake by surface area'
  },
  {
    name: 'Lake Michigan',
    bbox: {
      minLat: 41.6,
      maxLat: 46.0,
      minLon: -87.8,
      maxLon: -84.8
    },
    description: 'Third largest Great Lake, only one entirely in US'
  },
  {
    name: 'Lake Huron',
    bbox: {
      minLat: 43.0,
      maxLat: 46.5,
      minLon: -84.8,
      maxLon: -79.8
    },
    description: 'Second largest Great Lake by surface area'
  },
  {
    name: 'Lake Erie',
    bbox: {
      minLat: 41.3,
      maxLat: 42.9,
      minLon: -83.5,
      maxLon: -78.9
    },
    description: 'Shallowest of the Great Lakes'
  },
  {
    name: 'Lake Ontario',
    bbox: {
      minLat: 43.2,
      maxLat: 44.3,
      minLon: -79.8,
      maxLon: -76.1
    },
    description: 'Smallest Great Lake by surface area'
  }
];

/**
 * Major US coastal bays and large inland lakes with NOAA marine forecasts
 * These locations have NOAA marine zone forecasts available
 */
const MAJOR_COASTAL_BAYS: GeographicRegion[] = [
  {
    name: 'Chesapeake Bay',
    bbox: {
      minLat: 36.9,
      maxLat: 39.6,
      minLon: -76.6,
      maxLon: -75.9
    },
    description: 'Largest estuary in the United States'
  },
  {
    name: 'San Francisco Bay',
    bbox: {
      minLat: 37.4,
      maxLat: 38.2,
      minLon: -122.6,
      maxLon: -121.8
    },
    description: 'West Coast major bay area'
  },
  {
    name: 'Tampa Bay',
    bbox: {
      minLat: 27.5,
      maxLat: 28.0,
      minLon: -82.8,
      maxLon: -82.4
    },
    description: 'Gulf Coast major bay'
  },
  {
    name: 'Puget Sound',
    bbox: {
      minLat: 47.0,
      maxLat: 48.5,
      minLon: -122.9,
      maxLon: -122.2
    },
    description: 'Pacific Northwest inland sea'
  },
  {
    name: 'Lake Okeechobee',
    bbox: {
      minLat: 26.7,
      maxLat: 27.2,
      minLon: -81.0,
      maxLon: -80.6
    },
    description: 'Largest freshwater lake in Florida'
  }
];

/**
 * Check if a point is within a bounding box
 */
function isInBoundingBox(lat: number, lon: number, bbox: BoundingBox): boolean {
  return (
    lat >= bbox.minLat &&
    lat <= bbox.maxLat &&
    lon >= bbox.minLon &&
    lon <= bbox.maxLon
  );
}

/**
 * Check if coordinates are within the Great Lakes region
 * @param latitude Latitude coordinate
 * @param longitude Longitude coordinate
 * @returns The Great Lake name if in region, null otherwise
 */
export function getGreatLakeRegion(latitude: number, longitude: number): string | null {
  for (const region of GREAT_LAKES_REGIONS) {
    if (isInBoundingBox(latitude, longitude, region.bbox)) {
      return region.name;
    }
  }
  return null;
}

/**
 * Check if coordinates are within a major US coastal bay or large inland lake
 * @param latitude Latitude coordinate
 * @param longitude Longitude coordinate
 * @returns The bay/lake name if in region, null otherwise
 */
export function getMajorCoastalBayRegion(latitude: number, longitude: number): string | null {
  for (const region of MAJOR_COASTAL_BAYS) {
    if (isInBoundingBox(latitude, longitude, region.bbox)) {
      return region.name;
    }
  }
  return null;
}

/**
 * Check if coordinates should use NOAA marine data (Great Lakes or major coastal bays)
 * @param latitude Latitude coordinate
 * @param longitude Longitude coordinate
 * @returns Object with detection results
 */
export function shouldUseNOAAMarine(latitude: number, longitude: number): {
  useNOAA: boolean;
  region: string | null;
  source: 'great-lakes' | 'coastal-bay' | 'ocean';
} {
  // Check Great Lakes first
  const greatLake = getGreatLakeRegion(latitude, longitude);
  if (greatLake) {
    return {
      useNOAA: true,
      region: greatLake,
      source: 'great-lakes'
    };
  }

  // Check major coastal bays
  const coastalBay = getMajorCoastalBayRegion(latitude, longitude);
  if (coastalBay) {
    return {
      useNOAA: true,
      region: coastalBay,
      source: 'coastal-bay'
    };
  }

  // Default to Open-Meteo for oceans and other locations
  return {
    useNOAA: false,
    region: null,
    source: 'ocean'
  };
}

/**
 * Get a human-readable description of the marine region
 * @param latitude Latitude coordinate
 * @param longitude Longitude coordinate
 * @returns Description string
 */
export function getMarineRegionDescription(latitude: number, longitude: number): string {
  const detection = shouldUseNOAAMarine(latitude, longitude);

  if (detection.region) {
    return `${detection.region} (${detection.source === 'great-lakes' ? 'Great Lakes' : 'Coastal Bay'})`;
  }

  return 'Open ocean or coastal waters';
}

/**
 * Get all Great Lakes regions (for testing and documentation)
 */
export function getGreatLakesRegions(): GeographicRegion[] {
  return GREAT_LAKES_REGIONS;
}

/**
 * Get all major coastal bay regions (for testing and documentation)
 */
export function getMajorCoastalBayRegions(): GeographicRegion[] {
  return MAJOR_COASTAL_BAYS;
}
