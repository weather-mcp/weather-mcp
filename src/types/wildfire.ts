/**
 * Type definitions for wildfire data from NIFC ArcGIS services
 */

/**
 * Fire perimeter feature attributes from NIFC WFIGS
 */
export interface FirePerimeterAttributes {
  // Incident identification
  poly_IncidentName: string; // Fire name
  attr_IncidentName?: string; // Alternate incident identifier
  attr_IncidentTypeCategory?: string; // WF=Wildfire, RX=Prescribed Fire

  // Acreage data
  poly_GISAcres?: number; // GIS-calculated acres
  attr_FinalAcres?: number; // Final incident acreage
  attr_CalculatedAcres?: number; // Calculated size metric

  // Containment & status
  attr_PercentContained?: number; // Containment percentage (0-100)
  attr_ContainmentDateTime?: number; // Containment timestamp (epoch ms)
  poly_FeatureStatus?: string; // Approval status
  attr_FireDiscoveryDateTime?: number; // Discovery timestamp (epoch ms)

  // Location
  attr_InitialLatitude?: number; // Fire origin latitude
  attr_InitialLongitude?: number; // Fire origin longitude
  attr_POOState?: string; // Place of origin - State
  attr_POOCounty?: string; // Place of origin - County
  attr_POOCity?: string; // Place of origin - City

  // Geometry properties
  Shape__Area?: number; // Calculated polygon area
  Shape__Length?: number; // Perimeter length

  // Object ID (unique identifier)
  OBJECTID?: number;
}

/**
 * ArcGIS polygon geometry
 */
export interface ArcGISPolygonGeometry {
  rings: number[][][]; // Array of rings, each ring is array of [x, y] coordinate pairs
  spatialReference?: {
    wkid: number; // Well-known ID (e.g., 4326 for WGS84)
    latestWkid?: number;
  };
}

/**
 * Fire perimeter feature from NIFC ArcGIS REST API
 */
export interface FirePerimeterFeature {
  attributes: FirePerimeterAttributes;
  geometry: ArcGISPolygonGeometry;
}

/**
 * Response from NIFC ArcGIS query endpoint
 */
export interface NIFCQueryResponse {
  objectIdFieldName?: string;
  globalIdFieldName?: string;
  geometryType?: string;
  spatialReference?: {
    wkid: number;
    latestWkid?: number;
  };
  fields?: Array<{
    name: string;
    type: string;
    alias: string;
    sqlType?: string;
    domain?: unknown;
    defaultValue?: unknown;
  }>;
  features: FirePerimeterFeature[];
  exceededTransferLimit?: boolean;
}

/**
 * Processed wildfire information for display
 */
export interface WildfireInfo {
  name: string;
  distance: number; // km from query location
  acres: number;
  containment: number; // percentage 0-100
  discoveryDate: Date;
  latitude?: number;
  longitude?: number;
  state?: string;
  county?: string;
  city?: string;
  type: 'Wildfire' | 'Prescribed Fire' | 'Unknown';
  status: string;
}
