/**
 * Types for NASA FIRMS (Fire Information for Resource Management System)
 * satellite fire-detection data — VIIRS near-real-time hotspots, keyed
 * (Area API) and keyless (regional flat CSV files) paths.
 *
 * See `docs/global-wildfire-plan.md` D4/D5 and the "Live re-verification
 * notes" at the end of that doc: the two ingestion paths emit **different
 * CSV shapes** (Area API adds an `instrument` column and abbreviates
 * `confidence`; flat files omit `instrument`, spell confidence out, and
 * zero-pad `acq_time`). `src/utils/firmsHotspots.ts` normalizes both into
 * the single `FIRMSDetection` shape below, by header name.
 */

/**
 * Detection confidence, normalized from either the abbreviated Area-API
 * values (`l`/`n`/`h`) or the spelled-out flat-file values
 * (`low`/`nominal`/`high`). Anything unrecognized normalizes to `'unknown'`
 * rather than being dropped — a detection with a garbled confidence field
 * is still a real satellite hotspot.
 */
export type FIRMSConfidence = 'low' | 'nominal' | 'high' | 'unknown';

/**
 * Day/night flag from the `daynight` column (`D`/`N` in live data, both
 * paths). `'unknown'` covers anything else the feed might emit — defensive,
 * never observed live.
 */
export type FIRMSDayNight = 'D' | 'N' | 'unknown';

/**
 * A single normalized VIIRS hotspot detection, after header-driven CSV
 * parsing (`parseFIRMSCsv`). Both the Area API and flat-file shapes parse
 * into this same type — column presence/order differences are absorbed at
 * parse time, never leaked to callers.
 *
 * Raw brightness Kelvin (`bright_ti4`/`bright_ti5`) is intentionally not
 * carried past parsing — see D5: it is uninterpretable garnish for a reader
 * and is omitted from cluster output entirely.
 */
export interface FIRMSDetection {
  /** Detection latitude, degrees. */
  latitude: number;
  /** Detection longitude, degrees. */
  longitude: number;
  /** Fire Radiative Power, megawatts — the intensity signal. Defensively parsed; see `parseFIRMSCsv`. */
  frp: number;
  /** Normalized confidence bucket. */
  confidence: FIRMSConfidence;
  /** Acquisition time, assembled from `acq_date` + `acq_time` (UTC), ISO 8601. */
  acquiredAt: string;
  /** Day or night overpass. */
  daynight: FIRMSDayNight;
  /** Satellite identifier, e.g. `"N"` (Suomi NPP). Passed through as-is. */
  satellite: string;
  /** Sensor/processing identifier. Only the Area API's 14-column shape carries this column. */
  instrument?: string;
}

/**
 * A simple rectangular bounding box, degrees, matching the
 * `west,south,east,north` order the FIRMS Area API itself uses.
 */
export interface FIRMSBoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * One of the 12 live-verified FIRMS regional flat-file cuts, or `Global`
 * (the ~10 MB file covering everywhere, used whenever a point does not fall
 * comfortably inside a regional inset — see D3/D4 and `pickRegionFile`).
 */
export type FIRMSRegionFile =
  | 'Alaska'
  | 'Australia_NewZealand'
  | 'Canada'
  | 'Central_America'
  | 'Europe'
  | 'Northern_and_Central_Africa'
  | 'Russia_Asia'
  | 'SouthEast_Asia'
  | 'South_America'
  | 'South_Asia'
  | 'Southern_Africa'
  | 'USA_contiguous_and_Hawaii'
  | 'Global';

/**
 * A regional cut's coverage, expressed as one or more conservative (inset)
 * bounding boxes. Two boxes cover the one case where a single file spans
 * disjoint geography (`USA_contiguous_and_Hawaii` = CONUS + Hawaii).
 */
export interface FIRMSRegionDefinition {
  file: FIRMSRegionFile;
  boxes: FIRMSBoundingBox[];
}

/**
 * A cluster of nearby detections (D5) — the unit `get_wildfire_info`
 * actually renders for non-US points, since raw per-detection rows are
 * unreadable at the volumes a large fire produces.
 */
export interface FIRMSCluster {
  /** Number of detections folded into this cluster. */
  count: number;
  /** Running-mean centroid of all detections in the cluster. */
  centroid: {
    latitude: number;
    longitude: number;
  };
  /** Great-circle distance from the requested point to the centroid, km. */
  distanceKm: number;
  /** 16-point compass bearing from the requested point to the centroid. */
  bearing: string;
  /** Highest FRP (megawatts) among the cluster's detections — the intensity signal. */
  maxFrp: number;
  /** Most recent detection time in the cluster, ISO 8601. */
  newestAcquiredAt: string;
  /** Count of detections acquired during daytime overpasses. */
  dayCount: number;
  /** Count of detections acquired during nighttime overpasses. */
  nightCount: number;
  /** Detection counts per confidence bucket. */
  confidenceCounts: Record<FIRMSConfidence, number>;
  /** Satellite of the cluster's founding (highest-FRP) detection. */
  satellite: string;
}
