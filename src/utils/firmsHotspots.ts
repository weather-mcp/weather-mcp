/**
 * NASA FIRMS hotspot parsing, region selection, and clustering — pure
 * functions, no I/O. Mirrors the `metarStation.ts`/`composite.ts` precedent:
 * fetching (the Area API bbox call, the regional flat-file GET) is the
 * service's job; every judgement call about what the rows mean lives here,
 * unit-tested without HTTP.
 *
 * See `docs/global-wildfire-plan.md` D4 (parsing) and D5 (output framing —
 * clustering is the load-bearing decision that keeps hundreds of raw
 * detections from a large fire unreadable).
 *
 * ## Why parse by header name
 *
 * FIRMS' two ingestion paths emit different CSV shapes (live-verified
 * 2026-08-14, see the plan's "Live re-verification notes"):
 *
 * - Area API (keyed): 14 columns, includes `instrument`, abbreviates
 *   `confidence` to `l`/`n`/`h`, unpadded `acq_time` (`215`).
 * - Flat files (keyless): 13 columns, no `instrument`, spells confidence
 *   out (`low`/`nominal`/`high`), zero-pads `acq_time` (`0048`).
 *
 * Column *positions* differ between the two paths, so indexing by position
 * would silently misalign fields on whichever shape wasn't tested last.
 * FIRMS CSV is unquoted (no embedded commas), so a per-line `split(',')` is
 * safe — the header row is what's authoritative, not position.
 */

import { calculateDistance, bearingDegrees } from './distance.js';
import { windDirectionFromDegrees } from './units.js';
import type {
  FIRMSDetection,
  FIRMSConfidence,
  FIRMSDayNight,
  FIRMSCluster,
  FIRMSRegionFile,
  FIRMSRegionDefinition,
  FIRMSBoundingBox
} from '../types/firms.js';

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/** Normalize a raw `confidence` field to the project's enum. */
function normalizeConfidence(raw: string | undefined): FIRMSConfidence {
  const value = (raw ?? '').trim().toLowerCase();
  switch (value) {
    case 'l':
    case 'low':
      return 'low';
    case 'n':
    case 'nominal':
      return 'nominal';
    case 'h':
    case 'high':
      return 'high';
    default:
      return 'unknown';
  }
}

/** Normalize a raw `daynight` field. Live data only ever emits `D`/`N`; anything else is defensive. */
function normalizeDayNight(raw: string | undefined): FIRMSDayNight {
  const value = (raw ?? '').trim().toUpperCase();
  if (value === 'D') return 'D';
  if (value === 'N') return 'N';
  return 'unknown';
}

/**
 * Parse `frp` defensively: a non-numeric or missing value keeps the row
 * (a hotspot detection is still meaningful without a usable FRP — dropping
 * it would discard real satellite data over one malformed field) but
 * reports `frp: 0` rather than `NaN`, so downstream max/sort logic never
 * has to special-case a non-finite number.
 */
function parseFrpDefensive(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : 0;
}

/** Parse a required numeric field strictly; `undefined` signals "drop this row". */
function parseRequiredNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Assemble `acq_date` (`YYYY-MM-DD`) + `acq_time` (unpadded like `215` or
 * zero-padded like `0048`, both UTC) into an ISO 8601 timestamp. Padding to
 * 4 digits before slicing is what makes both shapes parse identically:
 * `"215"` -> `"0215"` -> hour `02`, minute `15`.
 *
 * Returns `undefined` for anything that doesn't match the expected shapes,
 * signaling the row should be dropped — a hotspot with no usable timestamp
 * can't be aged, sorted, or clustered by recency.
 */
function assembleAcquiredAt(acqDate: string | undefined, acqTime: string | undefined): string | undefined {
  if (acqDate === undefined || acqTime === undefined) return undefined;

  const date = acqDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;

  const paddedTime = acqTime.trim().padStart(4, '0');
  if (!/^\d{4}$/.test(paddedTime)) return undefined;

  const hours = paddedTime.slice(0, 2);
  const minutes = paddedTime.slice(2, 4);
  if (Number(hours) > 23 || Number(minutes) > 59) return undefined;

  const iso = `${date}T${hours}:${minutes}:00.000Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return undefined;

  return iso;
}

/** Split CSV text into non-empty lines, tolerating CRLF and trailing blank lines. */
function splitCsvLines(csv: string): string[] {
  return csv
    .split(/\r\n|\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/**
 * Parse a FIRMS CSV payload (either the Area API or a flat-file shape) into
 * normalized detections, resolving every field by header name.
 *
 * Rows with a missing/non-numeric latitude or longitude, or an unparseable
 * acquisition timestamp, are dropped — those fields are load-bearing for
 * every downstream use (radius filtering, clustering, display) and a
 * detection without them isn't usable. `frp` is the one field parsed
 * defensively (see `parseFrpDefensive`): a bad FRP still leaves a real
 * detection worth showing.
 */
export function parseFIRMSCsv(csv: string): FIRMSDetection[] {
  const lines = splitCsvLines(csv);
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const indexOf = (name: string): number => headers.indexOf(name);

  const idx = {
    latitude: indexOf('latitude'),
    longitude: indexOf('longitude'),
    frp: indexOf('frp'),
    acqDate: indexOf('acq_date'),
    acqTime: indexOf('acq_time'),
    satellite: indexOf('satellite'),
    instrument: indexOf('instrument'),
    confidence: indexOf('confidence'),
    daynight: indexOf('daynight')
  };

  const field = (cols: string[], index: number): string | undefined =>
    index >= 0 && index < cols.length ? cols[index] : undefined;

  const detections: FIRMSDetection[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');

    const latitude = parseRequiredNumber(field(cols, idx.latitude));
    const longitude = parseRequiredNumber(field(cols, idx.longitude));
    if (latitude === undefined || longitude === undefined) continue;

    const acquiredAt = assembleAcquiredAt(field(cols, idx.acqDate), field(cols, idx.acqTime));
    if (acquiredAt === undefined) continue;

    const instrument = field(cols, idx.instrument);

    detections.push({
      latitude,
      longitude,
      frp: parseFrpDefensive(field(cols, idx.frp)),
      confidence: normalizeConfidence(field(cols, idx.confidence)),
      acquiredAt,
      daynight: normalizeDayNight(field(cols, idx.daynight)),
      satellite: (field(cols, idx.satellite) ?? '').trim(),
      ...(instrument !== undefined && instrument.trim().length > 0
        ? { instrument: instrument.trim() }
        : {})
    });
  }

  return detections;
}

// ---------------------------------------------------------------------------
// Region selection
// ---------------------------------------------------------------------------

/**
 * Conservative (inset) bounding boxes for the 12 live-verified FIRMS
 * regional flat-file cuts. **Correctness never depends on this table** — it
 * exists purely to avoid fetching the ~10 MB Global file when a smaller
 * regional cut (9 KB-5.2 MB) obviously covers the point. Every box is
 * deliberately shrunk well inside the region's real geographic coverage:
 * a point near a region's true edge, or in a known gap between regions
 * (e.g. the Middle East, between Europe/Africa/Asia), simply falls through
 * to `Global`. That is by design, not a bug — see D3/D4.
 *
 * Boxes are checked in array order and the first match wins, so the boxes
 * below are kept mutually disjoint (with a margin) rather than relying on
 * a particular scan order to break ties. The US–Canada border band
 * (roughly 47–50°N in the west, 41–50°N around the Great Lakes and east)
 * belongs to no inset at all: regional cuts stop at the border, and a
 * rectangle cannot separate southern Ontario from the US Northeast, so the
 * whole band takes Global.
 */
const REGION_DEFINITIONS: FIRMSRegionDefinition[] = [
  { file: 'Alaska', boxes: [{ west: -165, south: 55, east: -135, north: 70 }] },
  {
    // South bound sits at 50°N so the whole US–Canada border band —
    // including southern Ontario/Quebec (Toronto, Montreal), where the
    // border dips to ~42°N — falls to Global rather than risking the wrong
    // regional cut. Border cities pay a bandwidth cost, never a data cost.
    file: 'Canada',
    boxes: [{ west: -128, south: 50, east: -55, north: 72 }]
  },
  {
    file: 'USA_contiguous_and_Hawaii',
    boxes: [
      // CONUS west of the Great Lakes: the border is a clean 49°N line, so
      // the box can rise to 47°N with margin.
      { west: -124, south: 27, east: -95, north: 47 },
      // CONUS east of -95°: the border dips to ~41.7°N at Lake Erie, and
      // southern Ontario interleaves with US states — cap at 41°N and let
      // the Great Lakes / Northeast band fall to Global.
      { west: -95, south: 27, east: -70, north: 41 },
      // Hawaii
      { west: -159, south: 19, east: -155, north: 22 }
    ]
  },
  {
    file: 'Central_America',
    boxes: [{ west: -103, south: 8, east: -78, north: 22 }]
  },
  {
    file: 'South_America',
    boxes: [{ west: -78, south: -50, east: -38, north: 5 }]
  },
  {
    file: 'Europe',
    // Eastern edge stops well short of the Middle East / western Russia —
    // that gap is intentional (falls to Global).
    boxes: [{ west: -12, south: 36, east: 40, north: 70 }]
  },
  {
    file: 'Northern_and_Central_Africa',
    boxes: [{ west: -15, south: 0, east: 45, north: 35 }]
  },
  {
    file: 'Southern_Africa',
    boxes: [{ west: 12, south: -33, east: 40, north: -8 }]
  },
  {
    file: 'Russia_Asia',
    // Inset well short of the antimeridian (Chukotka) to keep this a
    // simple non-wrapping rectangle; that sliver falls to Global.
    boxes: [{ west: 50, south: 40, east: 179, north: 75 }]
  },
  {
    file: 'South_Asia',
    boxes: [{ west: 65, south: 7, east: 90, north: 33 }]
  },
  {
    file: 'SouthEast_Asia',
    boxes: [{ west: 95, south: -8, east: 138, north: 22 }]
  },
  {
    file: 'Australia_NewZealand',
    boxes: [{ west: 113, south: -45, east: 177, north: -12 }]
  }
];

/** True when `(lat, lon)` falls within a box, edges inclusive. */
function inBox(lat: number, lon: number, box: FIRMSBoundingBox): boolean {
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/**
 * Choose the regional flat-file cut for a point, or `Global` when the point
 * doesn't fall comfortably inside any region's conservative inset. This is
 * a bandwidth optimization only (see `REGION_DEFINITIONS` doc comment) —
 * never a correctness gate.
 */
export function pickRegionFile(lat: number, lon: number): FIRMSRegionFile {
  for (const region of REGION_DEFINITIONS) {
    if (region.boxes.some(box => inBox(lat, lon, box))) {
      return region.file;
    }
  }
  return 'Global';
}

// ---------------------------------------------------------------------------
// Radius filtering
// ---------------------------------------------------------------------------

/** Row cap applied to in-radius results — defense-in-depth against the ~10 MB Global-file worst case. */
export const MAX_RADIUS_DETECTIONS = 5000;

export interface RadiusFilterResult {
  detections: FIRMSDetection[];
  /** True when more than `MAX_RADIUS_DETECTIONS` fell within the radius and the result was capped. */
  truncated: boolean;
}

/**
 * Filter detections to those within `radiusKm` of `(lat, lon)` (haversine,
 * via `calculateDistance`), then cap the result at `MAX_RADIUS_DETECTIONS`.
 *
 * When capping, the nearest detections are kept — sorted by distance
 * ascending before the slice — since proximity is what the caller actually
 * cares about, and this module's job is a deterministic, useful truncation.
 * The truncation *caveat* and any `securityEvent` warn log are the caller's
 * job (this module has no I/O and does no logging).
 */
export function filterByRadius(
  detections: FIRMSDetection[],
  lat: number,
  lon: number,
  radiusKm: number
): RadiusFilterResult {
  const withinRadius = detections
    .map(detection => ({
      detection,
      distanceKm: calculateDistance(lat, lon, detection.latitude, detection.longitude)
    }))
    .filter(({ distanceKm }) => distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(({ detection }) => detection);

  const truncated = withinRadius.length > MAX_RADIUS_DETECTIONS;

  return {
    detections: truncated ? withinRadius.slice(0, MAX_RADIUS_DETECTIONS) : withinRadius,
    truncated
  };
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

/** Default clustering radius, km — see D5. */
export const DEFAULT_CLUSTER_RADIUS_KM = 2;

interface MutableCluster {
  count: number;
  centroidLat: number;
  centroidLon: number;
  maxFrp: number;
  newestAcquiredAt: string;
  dayCount: number;
  nightCount: number;
  confidenceCounts: Record<FIRMSConfidence, number>;
  /** Satellite of the founding (highest-FRP) detection — see module doc comment. */
  satellite: string;
}

function emptyConfidenceCounts(): Record<FIRMSConfidence, number> {
  return { low: 0, nominal: 0, high: 0, unknown: 0 };
}

/**
 * Cluster nearby detections into groups a reader can actually parse — a
 * single large fire produces dozens-to-hundreds of raw rows, which are
 * unreadable one-by-one (D5).
 *
 * **Algorithm (deterministic by construction):**
 * 1. Sort a *copy* of `detections` by FRP descending (ties keep original
 *    array order — `Array.prototype.sort` is stable in the runtimes this
 *    project targets).
 * 2. Walk the sorted list. For each detection, find the nearest *existing*
 *    cluster centroid within `radiusKm`; if one qualifies, assign to it and
 *    recompute the centroid as the running mean. Otherwise start a new
 *    cluster with this detection as its founder. Ties in distance-to-
 *    centroid resolve to whichever cluster was created first.
 * 3. Because detections are processed FRP-descending, a cluster's founder
 *    always holds the cluster's `maxFrp` and supplies its `satellite`.
 * 4. Once all detections are assigned, compute each cluster's `distanceKm`
 *    and `bearing` from `(lat, lon)` to its final centroid.
 * 5. Return clusters **sorted nearest-first** by `distanceKm` — that's the
 *    order the renderer wants (D5: nearest cluster drives the safety
 *    assessment), so sorting here keeps the caller simple.
 *
 * `(lat, lon)` is the point the caller queried around; it is only used to
 * compute `distanceKm`/`bearing` on the output, not for clustering itself.
 */
export function clusterDetections(
  detections: FIRMSDetection[],
  lat: number,
  lon: number,
  radiusKm: number = DEFAULT_CLUSTER_RADIUS_KM
): FIRMSCluster[] {
  if (detections.length === 0) return [];

  const sorted = [...detections].sort((a, b) => b.frp - a.frp);
  const clusters: MutableCluster[] = [];

  for (const detection of sorted) {
    let nearestIndex = -1;
    let nearestDistance = Infinity;

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const distance = calculateDistance(
        detection.latitude,
        detection.longitude,
        cluster.centroidLat,
        cluster.centroidLon
      );
      if (distance <= radiusKm && distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    if (nearestIndex === -1) {
      // New cluster; this detection is its founder (highest FRP seen so far
      // in FRP-descending order, so it's the cluster's max by construction).
      const confidenceCounts = emptyConfidenceCounts();
      confidenceCounts[detection.confidence] += 1;

      clusters.push({
        count: 1,
        centroidLat: detection.latitude,
        centroidLon: detection.longitude,
        maxFrp: detection.frp,
        newestAcquiredAt: detection.acquiredAt,
        dayCount: detection.daynight === 'D' ? 1 : 0,
        nightCount: detection.daynight === 'N' ? 1 : 0,
        confidenceCounts,
        satellite: detection.satellite
      });
      continue;
    }

    const cluster = clusters[nearestIndex];
    const newCount = cluster.count + 1;
    cluster.centroidLat = (cluster.centroidLat * cluster.count + detection.latitude) / newCount;
    cluster.centroidLon = (cluster.centroidLon * cluster.count + detection.longitude) / newCount;
    cluster.count = newCount;
    // ISO 8601 UTC strings of this fixed shape compare lexicographically
    // the same as chronologically.
    if (detection.acquiredAt > cluster.newestAcquiredAt) {
      cluster.newestAcquiredAt = detection.acquiredAt;
    }
    if (detection.daynight === 'D') cluster.dayCount += 1;
    if (detection.daynight === 'N') cluster.nightCount += 1;
    cluster.confidenceCounts[detection.confidence] += 1;
    // maxFrp/satellite stay as the founder's — FRP-descending processing
    // guarantees no later member exceeds the founder's FRP.
  }

  const results: FIRMSCluster[] = clusters.map(cluster => {
    const distanceKm = calculateDistance(lat, lon, cluster.centroidLat, cluster.centroidLon);
    const bearing = windDirectionFromDegrees(
      bearingDegrees(lat, lon, cluster.centroidLat, cluster.centroidLon)
    );

    return {
      count: cluster.count,
      centroid: { latitude: cluster.centroidLat, longitude: cluster.centroidLon },
      distanceKm,
      bearing,
      maxFrp: cluster.maxFrp,
      newestAcquiredAt: cluster.newestAcquiredAt,
      dayCount: cluster.dayCount,
      nightCount: cluster.nightCount,
      confidenceCounts: cluster.confidenceCounts,
      satellite: cluster.satellite
    };
  });

  return results.sort((a, b) => a.distanceKm - b.distanceKm);
}
