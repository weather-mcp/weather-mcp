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

/**
 * Approximate country/region detection from coordinates
 * PRIVACY: Intentionally vague - only major regions for privacy
 * ACCURACY: This is a ROUGH approximation with known inaccuracies:
 *   - Mexico, Caribbean, Central America -> OTHER
 *   - Some border regions may be misclassified
 *   - Alaska and Hawaii have special handling
 *
 * This is called OUTSIDE the analytics module to ensure coordinates
 * never enter the analytics boundary. Trade-off: Privacy (no reverse geocoding)
 * vs Accuracy (bounding boxes)
 *
 * @param lat Latitude (-90 to 90)
 * @param lon Longitude (-180 to 180)
 * @returns ISO 3166-1 alpha-2 region code (US, CA, EU, AP, SA, AF, OC, OTHER)
 */
export function getCountryFromCoordinates(lat: number, lon: number): string {
  // Handle Alaska (49°N+, west of 130°W)
  if (lat >= 49 && lon <= -130 && lon >= -180) {
    return 'US';
  }

  // Handle Hawaii (18-23°N, 154-162°W)
  if (lat >= 18 && lat <= 23 && lon >= -162 && lon <= -154) {
    return 'US';
  }

  // Continental US: Approximately 25-49°N, 125-66°W
  if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) {
    return 'US';
  }

  // Canada: Approximately 42-83°N, 141-52°W
  if (lat >= 41 && lat <= 84 && lon >= -142 && lon <= -52) {
    return 'CA';
  }

  // Europe: Approximately 35-71°N, 10°W-40°E
  if (lat >= 35 && lat <= 72 && lon >= -11 && lon <= 41) {
    return 'EU';
  }

  // Asia-Pacific: Rough approximation
  if (lat >= -10 && lat <= 55 && lon >= 60 && lon <= 180) {
    return 'AP';
  }

  // South America: Approximate
  if (lat >= -56 && lat <= 13 && lon >= -82 && lon <= -34) {
    return 'SA';
  }

  // Africa: Approximate
  if (lat >= -35 && lat <= 38 && lon >= -18 && lon <= 52) {
    return 'AF';
  }

  // Australia/Oceania: Approximate
  if (lat >= -48 && lat <= -10 && lon >= 112 && lon <= 180) {
    return 'OC';
  }

  // Default to OTHER for privacy (intentionally vague)
  return 'OTHER';
}

/**
 * Determine if coordinates are within the United States (including Alaska, Hawaii, and territories)
 * Uses bounding box approach for simplicity
 * @param latitude Latitude coordinate
 * @param longitude Longitude coordinate
 * @returns True if coordinates fall within US bounding boxes (CONUS, Alaska, Hawaii, Puerto Rico)
 */
export function isInUS(latitude: number, longitude: number): boolean {
  // Continental US, Alaska, Hawaii, Puerto Rico, and territories
  const inContinentalUS = latitude >= 24.5 && latitude <= 49.4 && longitude >= -125 && longitude <= -66.9;
  const inAlaska = latitude >= 51 && latitude <= 71.4 && longitude >= -180 && longitude <= -129.9;
  const inHawaii = latitude >= 18.9 && latitude <= 28.5 && longitude >= -178.4 && longitude <= -154.8;
  // Puerto Rico, to the Commonwealth's real extent rather than the main island's populated
  // middle. The earlier 17.9–18.5 N / −67.3 W box cut off the northwest tip (Punta Agujereada
  // reaches 18.5208 N), Isla Caja de Muertos in the south (17.88 N), and both offshore islands
  // (Mona −67.89, Desecheo −67.48). That was tolerable while this predicate only *routed*, but
  // get_river_conditions now renders a coverage disclosure naming Puerto Rico from it, and a
  // point in Puerto Rico must never be told it is outside a service that gauges Puerto Rico.
  // The west edge stops at −67.95, ~39 km east of the Dominican Republic's −68.32 extreme; the
  // east edge stays at −65.2 so St Croix (−64.78) and the BVI remain correctly excluded.
  const inPuertoRico = latitude >= 17.85 && latitude <= 18.55 && longitude >= -67.95 && longitude <= -65.2;

  return inContinentalUS || inAlaska || inHawaii || inPuertoRico;
}

/**
 * Determine if coordinates fall within Great Britain and its surrounding waters,
 * drawn generously — this is a **routing-only** pre-gate, not a coverage claim.
 *
 * It exists to answer one question cheaply: "is a Nominatim reverse-geocode call
 * worth making for this point?" Nominatim is rate-limited to 1 req/sec server-wide,
 * so `get_river_conditions` must not fire one for every non-US point on Earth just
 * to learn the answer is 'not gb' for the vast majority of them. This predicate
 * narrows that down; the country-code lookup that follows it is what actually
 * decides 'gb' vs anything else.
 *
 * This function NEVER renders, and no sentence in any tool output may be derived
 * from it — it must never be promoted to one. The coverage claim the tool actually
 * makes — "the EA river-gauge network" — comes from filtering stations on a
 * non-empty `riverName` field, never from this box and never from the word
 * "England". See GOTCHAS G53: a routing box that is 95% right is fine for "which
 * upstream do I ask" — the wrong 5% costs one extra API call — but the same box
 * behind a rendered sentence becomes a false statement about a named place. Keep
 * this predicate on the routing side of that line.
 *
 * Because a false positive here costs one Nominatim call (cheap) and a false
 * negative silently drops the feature for a real GB point (expensive), the boxes
 * below are drawn wide: they cover the Scottish islands (Outer Hebrides, Orkney,
 * Shetland — Shetland reaches past 60.85N), the southwest tip (Land's End, Isles
 * of Scilly), and are allowed to overlap the near Continent and Atlantic approaches.
 *
 * Ireland is the one neighbor that must be excluded (Dublin must read false), and
 * it cannot be excluded with a single box: Ireland's latitude span (Mizen Head
 * 51.45N to Malin Head 55.38N) and longitude span (Dunmore Head -10.66W to Burr
 * Point, Co. Down, -5.43W) both overlap Great Britain's. So GB is split into three
 * latitude bands here, each clipped only where it actually risks Ireland:
 *   - south of 51.4N (Scilly, Land's End, the Channel coast) — south of Ireland's
 *     southernmost point, so longitude is left wide open
 *   - north of 55.45N (Highlands, Hebrides, Orkney, Shetland) — north of Ireland's
 *     northernmost point, so longitude is left wide open
 *   - the 51.4-55.45N band in between (England, Wales, southern/mid Scotland),
 *     where the west edge is drawn at -5.85: it clears Dublin (-6.26) and the rest
 *     of the Republic, though it also catches the extreme eastern tip of Northern
 *     Ireland (Burr Point, Co. Down, -5.43) — harmless, since NI is still part of
 *     the UK and resolves to 'gb' at the country-code step that follows
 *
 * @param latitude Latitude coordinate
 * @param longitude Longitude coordinate
 * @returns True if coordinates fall within Great Britain's generous routing box
 */
export function isInGreatBritain(latitude: number, longitude: number): boolean {
  // South of Ireland entirely (Mizen Head 51.45N) — longitude left wide open
  const inSouthwestApproaches =
    latitude >= 49.8 && latitude <= 51.4 && longitude >= -6.7 && longitude <= 2.0;
  // Overlaps Ireland's latitude band — west edge clipped east of Dublin (-6.26)
  const inEnglandWalesScotland =
    latitude >= 51.4 && latitude <= 55.45 && longitude >= -5.85 && longitude <= 2.0;
  // North of Ireland entirely (Malin Head 55.38N) — longitude left wide open
  const inNorthernScotlandIsles =
    latitude >= 55.45 && latitude <= 61.05 && longitude >= -9.0 && longitude <= 2.0;

  return inSouthwestApproaches || inEnglandWalesScotland || inNorthernScotlandIsles;
}
