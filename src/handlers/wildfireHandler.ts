/**
 * Handler for get_wildfire_info tool.
 *
 * Routed by country (see docs/plans/global-wildfire-plan.md D1/D2):
 *   US → NIFC/WFIGS named incidents (the original path, byte-identical
 *   output), elsewhere → NASA FIRMS satellite fire detections (VIIRS, near
 *   real-time, global). An explicit `source` forces the branch; there is
 *   deliberately no cross-fallback — managed incidents (names, acreage,
 *   containment) and satellite heat detections are different claims, and
 *   silently swapping one for the other would misrepresent the data.
 *
 * Country resolution order matches get_alerts: a `country_code` already
 * carried by the resolved location (saved location or geocoded city_name),
 * else a cached country-level Nominatim reverse lookup, else the `isInUS`
 * bounding-box fallback. The reverse answer wins over `isInUS` — the CONUS
 * box deliberately overruns into Canada (Toronto, Vancouver), and fire
 * authority is jurisdictional.
 */

import { NIFCService } from '../services/nifc.js';
import { FIRMSService, FIRMSKeyRejectedError } from '../services/firms.js';
import { NominatimService } from '../services/nominatim.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateDetail } from '../utils/validation.js';
import { guessTimezoneFromCoords, formatObservationAge } from '../utils/timezone.js';
import { calculateDistance } from '../utils/distance.js';
import { isInUS } from '../utils/geography.js';
import { logger } from '../utils/logger.js';
import {
  pickRegionFile,
  filterByRadius,
  clusterDetections,
  MAX_RADIUS_DETECTIONS
} from '../utils/firmsHotspots.js';
import type { FIRMSDetection, FIRMSCluster } from '../types/firms.js';
import type { WildfireInfo } from '../types/wildfire.js';

interface WildfireArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  radius?: number; // search radius in km (default: 100)
  source?: 'auto' | 'nifc' | 'firms';
  day_range?: number; // FIRMS keyed path only: days of detection history (1-5, default 1)
  detail?: 'summary' | 'standard' | 'full';
}

type HandlerResult = { content: Array<{ type: string; text: string }> };

/**
 * Country codes NIFC/WFIGS actually publishes incidents for — the criterion
 * is WFIGS *coverage*, not political status, so this is evidence-gated
 * rather than "every US territory".
 *
 * Verified live against the WFIGS ArcGIS services on 2026-08-14. Distinct
 * `POOState` values over the all-years layers
 * (`WFIGS_Interagency_Perimeters`, `WFIGS_Incident_Locations`) carry
 * `US-PR` (4 perimeters), `US-VI` (5) and `US-GU` (90); `US-AS` (American
 * Samoa) and `US-MP` (Northern Mariana Islands) return **zero** rows in
 * either layer, so they are deliberately excluded and route to FIRMS
 * satellite detections, which is the honest answer where WFIGS has nothing
 * to say.
 */
const NIFC_COVERED_COUNTRIES = new Set(['us', 'pr', 'vi', 'gu']);

export async function handleGetWildfireInfo(
  args: unknown,
  nifcService: NIFCService,
  locationStore: LocationStore,
  geocodingService: GeocodingService,
  firmsService?: FIRMSService,
  nominatimService?: NominatimService
): Promise<HandlerResult> {
  // Resolve location from coordinates, a saved location name, or a geocoded city name
  const resolved = await resolveLocationAsync(args as WildfireArgs, locationStore, geocodingService);
  const { latitude, longitude } = resolved;

  // Output verbosity: 'full' lifts the fire display cap to 25 (not unbounded).
  const detail = validateDetail((args as WildfireArgs)?.detail);

  // Validate radius parameter
  let radius = (args as WildfireArgs)?.radius ?? 100; // default 100 km
  if (typeof radius !== 'number' || isNaN(radius) || !isFinite(radius)) {
    radius = 100;
  }
  // Clamp to valid range (1-500 km)
  radius = Math.max(1, Math.min(radius, 500));

  // Validate day_range (FIRMS keyed path only; the NIFC path ignores it).
  // Same tolerant clamping contract as radius: invalid → default.
  let dayRange = (args as WildfireArgs)?.day_range ?? 1;
  if (typeof dayRange !== 'number' || isNaN(dayRange) || !isFinite(dayRange)) {
    dayRange = 1;
  }
  dayRange = Math.max(1, Math.min(Math.round(dayRange), 5));

  // Validate source (rivers contract: anything unrecognized → 'auto')
  const rawSource = (args as WildfireArgs)?.source;
  const source = rawSource === 'nifc' || rawSource === 'firms' ? rawSource : 'auto';

  // --- Country routing (D1/D2) ---
  let reverseLookupFailed = false;
  let useFirms: boolean;

  if (source === 'firms') {
    // Explicit override — works anywhere, including the US (satellite
    // detections often appear before an incident is catalogued in WFIGS).
    useFirms = true;
  } else if (source === 'nifc') {
    // Explicit override — outside the US this finds nothing; documented.
    useFirms = false;
  } else {
    // 1. A country the resolution path already knows (saved location /
    //    geocoded city). Sources vary in casing; normalize to lowercase once.
    let countryCode: string | null = resolved.country_code
      ? resolved.country_code.toLowerCase()
      : null;

    // 2. Coordinates only: cached country-level reverse lookup. A missing
    //    service (test harnesses) skips this silently; only a *failed* lookup
    //    earns the one-line fallback note.
    if (!countryCode && nominatimService) {
      try {
        countryCode = await nominatimService.reverseCountry(latitude, longitude);
      } catch (error) {
        reverseLookupFailed = true;
        logger.warn('Reverse country lookup failed; falling back to coordinate routing', {
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }

    // 3. Route. The reverse answer wins over isInUS; "no country" (open
    //    water, absent service, or a failed lookup) falls back to the
    //    bounding boxes.
    if (countryCode) {
      // NIFC covers the US *and* the territories WFIGS publishes for
      // (Puerto Rico, the US Virgin Islands, Guam) — testing `!== 'us'`
      // regressed those to anonymous satellite hotspots even though WFIGS
      // carries named incidents there.
      useFirms = !NIFC_COVERED_COUNTRIES.has(countryCode);
    } else {
      useFirms = !isInUS(latitude, longitude);
    }
  }

  // A FIRMS route without an injected FIRMSService (test harnesses) falls
  // through to the NIFC path — today's behavior, so no harness can crash.
  if (useFirms && !firmsService) {
    useFirms = false;
  }

  const output = useFirms && firmsService
    ? await formatFIRMSWildfire(firmsService, latitude, longitude, radius, dayRange, detail)
    : await formatNIFCWildfire(nifcService, latitude, longitude, radius, detail);

  const result = prependLocationLine({
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  }, resolved);

  if (reverseLookupFailed) {
    result.content[0].text +=
      `\n*Note: the country lookup service was unavailable, so routing fell back to coordinate checks.*\n`;
  }

  return result;
}

/**
 * The original US path: NIFC/WFIGS named incidents with acreage,
 * containment, and the containment-aware safety assessment. Byte-identical
 * to the pre-global behavior (locked by tests/unit/wildfire-handler.test.ts
 * passing unedited).
 */
async function formatNIFCWildfire(
  nifcService: NIFCService,
  latitude: number,
  longitude: number,
  radius: number,
  detail: 'summary' | 'standard' | 'full'
): Promise<string> {
  // Get timezone for proper time formatting
  const timezone = guessTimezoneFromCoords(latitude, longitude);

  let output = `# Wildfire Information Report\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Search Radius:** ${radius} km (${(radius * 0.621371).toFixed(1)} miles)\n\n`;

  try {
    // Calculate bounding box from center point and radius
    // Approximate: 1 degree latitude ≈ 111 km
    const latOffset = radius / 111;
    const lonOffset = radius / (111 * Math.cos(latitude * Math.PI / 180));

    const west = longitude - lonOffset;
    const south = latitude - latOffset;
    const east = longitude + lonOffset;
    const north = latitude + latOffset;

    // Query NIFC for fire perimeters
    const response = await nifcService.queryFirePerimeters(west, south, east, north);
    const features = response.features || [];

    if (features.length === 0) {
      output += `✅ **No active wildfires found within ${radius} km**\n\n`;
      if (response.exceededTransferLimit) {
        output += `*Results may be incomplete — the fire data service truncated the response.*\n\n`;
      }
      output += `The area is currently clear of reported wildfire activity.\n\n`;
      output += `**Note:** This data includes active wildfires and prescribed burns tracked by the National Interagency Fire Center. Small fires or very recent ignitions may not yet be included.\n`;
    } else {
      // Process and filter fires by actual distance
      const firesWithDistance: Array<{ fire: WildfireInfo; distance: number }> = [];

      for (const feature of features) {
        const attrs = feature.attributes;

        // Calculate distance from center point to fire origin
        let fireDistance = radius; // default if no coordinates

        if (attrs.attr_InitialLatitude && attrs.attr_InitialLongitude) {
          fireDistance = calculateDistance(
            latitude,
            longitude,
            attrs.attr_InitialLatitude,
            attrs.attr_InitialLongitude
          );
        } else if (feature.geometry?.rings?.[0]?.[0]) {
          // Use first point of fire perimeter if no origin coordinates
          const [fireLon, fireLat] = feature.geometry.rings[0][0];
          fireDistance = calculateDistance(latitude, longitude, fireLat, fireLon);
        }

        // Only include fires within radius
        if (fireDistance <= radius) {
          const fireInfo: WildfireInfo = {
            name: attrs.poly_IncidentName || 'Unknown Fire',
            distance: fireDistance,
            acres: attrs.poly_GISAcres || attrs.attr_FinalAcres || attrs.attr_CalculatedAcres || 0,
            containment: attrs.attr_PercentContained || 0,
            discoveryDate: attrs.attr_FireDiscoveryDateTime
              ? new Date(attrs.attr_FireDiscoveryDateTime)
              : new Date(),
            latitude: attrs.attr_InitialLatitude,
            longitude: attrs.attr_InitialLongitude,
            state: attrs.attr_POOState,
            county: attrs.attr_POOCounty,
            city: attrs.attr_POOCity,
            type: attrs.attr_IncidentTypeCategory === 'WF' ? 'Wildfire' :
                  attrs.attr_IncidentTypeCategory === 'RX' ? 'Prescribed Fire' : 'Unknown',
            status: attrs.poly_FeatureStatus || 'Active'
          };

          firesWithDistance.push({ fire: fireInfo, distance: fireDistance });
        }
      }

      // Sort by distance (nearest first)
      firesWithDistance.sort((a, b) => a.distance - b.distance);

      const fireCount = firesWithDistance.length;
      const wildfireCount = firesWithDistance.filter(f => f.fire.type === 'Wildfire').length;
      const prescribedCount = firesWithDistance.filter(f => f.fire.type === 'Prescribed Fire').length;

      output += `🔥 **Found ${fireCount} active fire${fireCount > 1 ? 's' : ''}**\n`;
      if (wildfireCount > 0) {
        output += `   - ${wildfireCount} wildfire${wildfireCount > 1 ? 's' : ''}\n`;
      }
      if (prescribedCount > 0) {
        output += `   - ${prescribedCount} prescribed burn${prescribedCount > 1 ? 's' : ''}\n`;
      }
      if (response.exceededTransferLimit) {
        output += `\n*Results may be incomplete — the fire data service truncated the response.*\n`;
      }
      output += `\n`;

      // Show details for nearest fires. detail="full" lifts the cap to 25 (still
      // capped, not unbounded — see D2 in docs/output-completeness-plan.md); the
      // remainder note stays accurate at every level, including full.
      const maxFiresToShow = detail === 'full' ? 25 : 5;
      const firesToShow = firesWithDistance.slice(0, maxFiresToShow);

      for (const { fire, distance } of firesToShow) {
        output += formatFireDetails(fire, distance, timezone);
      }

      if (firesWithDistance.length > maxFiresToShow) {
        const remaining = firesWithDistance.length - maxFiresToShow;
        const plural = remaining > 1 ? 's' : '';
        if (detail === 'full') {
          output += `\n*Note: ${remaining} additional fire${plural} found within radius (showing nearest ${maxFiresToShow})*\n`;
        } else {
          output += `\n*Note: ${remaining} additional fire${plural} found within radius (showing nearest ${maxFiresToShow} only — use detail="full" for more)*\n`;
        }
      }

      // Safety recommendations based on the nearest ACTIVE (uncontained) wildfire.
      // A fully-contained fire — however close — no longer drives the escalation
      // tier (F3: a 100%-contained fire was producing EXTREME DANGER wording).
      const wildfires = firesWithDistance.filter(f => f.fire.type === 'Wildfire');
      const nearestWildfire = wildfires.find(f => f.fire.containment < 100);

      if (wildfires.length > 0) {
        output += `\n## Safety Assessment\n\n`;

        if (nearestWildfire) {
          const dist = nearestWildfire.distance;
          const nearestOverall = wildfires[0];
          if (nearestOverall !== nearestWildfire) {
            output += `ℹ️ Nearest fire (${nearestOverall.fire.name}, ${nearestOverall.distance.toFixed(1)} km) is 100% contained and excluded from the danger assessment.\n\n`;
          }

          if (dist < 5) {
            output += `⚠️ **EXTREME DANGER** - Wildfire within 5 km\n`;
            output += `- Evacuate immediately if advised by authorities\n`;
            output += `- Monitor local emergency alerts\n`;
            output += `- Have evacuation plan ready\n`;
          } else if (dist < 25) {
            output += `🟠 **HIGH ALERT** - Wildfire within 25 km\n`;
            output += `- Monitor fire conditions closely\n`;
            output += `- Prepare for possible evacuation\n`;
            output += `- Watch for smoke and changing conditions\n`;
          } else if (dist < 50) {
            output += `🟡 **CAUTION** - Wildfire within 50 km\n`;
            output += `- Be aware of smoke and air quality impacts\n`;
            output += `- Monitor local news and fire updates\n`;
          } else {
            output += `ℹ️ **AWARENESS** - Wildfire detected within ${radius} km\n`;
            output += `- Stay informed about fire progression\n`;
            output += `- Air quality may be affected by smoke\n`;
          }
        } else {
          // Wildfires are present but every one is 100% contained. Still
          // surface the section — omitting it would hide that fires exist
          // nearby — pinned at the lowest (AWARENESS) tier.
          output += `ℹ️ **AWARENESS**\n`;
          output += `ℹ️ All fires within radius are 100% contained.\n`;
          output += `- Stay informed about fire progression\n`;
          output += `- Air quality may be affected by smoke\n`;
        }
        output += `\n`;
      }
    }
  } catch (error) {
    output += `❌ **Error retrieving wildfire data**\n\n`;
    output += `Unable to fetch fire information. This may be due to:\n`;
    output += `- Temporary service unavailability\n`;
    output += `- Network connectivity issues\n`;
    output += `- Service maintenance\n\n`;
    output += `Error details: ${error instanceof Error ? error.message : String(error)}\n`;
  }

  output += `\n---\n`;
  output += `*Data source: NIFC (National Interagency Fire Center) WFIGS*\n`;
  output += `*Wildfire data is updated throughout the day. Always consult official sources for evacuation orders and emergency information.*\n`;
  output += `*For active incidents and evacuation orders, visit: https://inciweb.nwcg.gov/*\n`;

  return output;
}

/**
 * The global path: NASA FIRMS satellite heat detections, clustered and
 * framed honestly (D5) — these are hotspots, not managed incidents, so there
 * are no fire names, sizes, or containment percentages, and a no-detections
 * result never reads as all-clear.
 */
async function formatFIRMSWildfire(
  firmsService: FIRMSService,
  latitude: number,
  longitude: number,
  radius: number,
  dayRange: number,
  detail: 'summary' | 'standard' | 'full'
): Promise<string> {
  let output = `# Wildfire Information Report\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Search Radius:** ${radius} km (${(radius * 0.621371).toFixed(1)} miles)\n`;
  output += `**Source:** NASA FIRMS satellite fire detections (VIIRS, near real-time)\n\n`;
  output += `⚠️ Satellite heat detections — not managed incident data. No fire names, `;
  output += `sizes, or containment are available; detections may include industrial `;
  output += `heat sources, gas flares, or agricultural burns.\n\n`;

  try {
    let detections: FIRMSDetection[];
    let truncated: boolean;
    let keyRejected = false;
    // Effective window actually served: dayRange on the keyed path, 24 h keyless.
    let servedDays = dayRange;

    if (firmsService.isKeyAvailable()) {
      try {
        // Same bbox math as the NIFC path, clamped to valid coordinate
        // ranges (the Area API rejects out-of-range corners; near the poles
        // or the antimeridian the clamp just widens the post-filter's job).
        const latOffset = radius / 111;
        const lonOffset = radius / (111 * Math.cos(latitude * Math.PI / 180));
        const west = Math.max(-180, longitude - lonOffset);
        const south = Math.max(-90, latitude - latOffset);
        const east = Math.min(180, longitude + lonOffset);
        const north = Math.min(90, latitude + latOffset);

        // Upstream semantics (live-verified 2026-08-14): the Area API's day
        // range counts calendar UTC days *including today*, while the keyless
        // flat files serve a rolling 24 h window — so a day-range-1 query at
        // midday would silently miss yesterday evening's detections that the
        // keyless path shows. Request one extra calendar day (the API caps at
        // 5) and filter to the true rolling window, keeping the "last N days"
        // label honest and the two paths comparable. At day_range 5 the
        // request can't widen further, so the tail of the window may fall up
        // to a day short — acceptable for multi-day history.
        const fetchDays = Math.min(dayRange + 1, 5);
        const raw = await firmsService.getDetectionsByBbox(west, south, east, north, fetchDays);
        const cutoffMs = Date.now() - dayRange * 24 * 60 * 60 * 1000;
        const withinWindow = raw.filter(
          d => new Date(d.acquiredAt).getTime() >= cutoffMs
        );
        ({ detections, truncated } = filterByRadius(withinWindow, latitude, longitude, radius));
      } catch (error) {
        if (!(error instanceof FIRMSKeyRejectedError)) {
          throw error;
        }
        // Key rejected → keyless fallback with a disclosure note (D3): the
        // tool keeps working while surfacing the misconfiguration.
        keyRejected = true;
        const regionFile = pickRegionFile(latitude, longitude);
        const raw = await firmsService.getDetectionsByRegion(regionFile);
        ({ detections, truncated } = filterByRadius(raw, latitude, longitude, radius));
        servedDays = 1;
      }
    } else {
      const regionFile = pickRegionFile(latitude, longitude);
      const raw = await firmsService.getDetectionsByRegion(regionFile);
      ({ detections, truncated } = filterByRadius(raw, latitude, longitude, radius));
      servedDays = 1;
    }

    if (keyRejected) {
      output += `*Note: FIRMS_MAP_KEY was rejected; showing keyless 24-hour data.*\n\n`;
    } else if (dayRange > 1 && !firmsService.isKeyAvailable()) {
      output += `*Multi-day detection history requires a free FIRMS_MAP_KEY; showing the last 24 hours.*\n\n`;
    }

    if (truncated) {
      logger.warn('FIRMS in-radius detections exceeded row cap', {
        cap: MAX_RADIUS_DETECTIONS,
        securityEvent: true
      });
      output += `*Results may be incomplete — detections were capped at ${MAX_RADIUS_DETECTIONS} rows within the search radius.*\n\n`;
    }

    const windowText = servedDays > 1 ? `last ${servedDays} days` : `last 24 h`;

    if (detections.length === 0) {
      output += `**No satellite fire detections in the ${windowText} within ${radius} km.**\n\n`;
      output += `*Note: absence of detections is not an all-clear — cloud cover can hide `;
      output += `fires from satellites, and small or new fires may evade detection.*\n`;
    } else {
      const clusters = clusterDetections(detections, latitude, longitude);

      const detectionPlural = detections.length > 1 ? 's' : '';
      const clusterPlural = clusters.length > 1 ? 's' : '';
      output += `🔥 **${detections.length} satellite fire detection${detectionPlural} in the ${windowText}, `;
      output += `grouped into ${clusters.length} cluster${clusterPlural} within ${radius} km**\n\n`;

      // Same display-cap discipline as the NIFC branch: 5 clusters,
      // detail="full" lifts to 25, remainder disclosed.
      const maxClustersToShow = detail === 'full' ? 25 : 5;
      const clustersToShow = clusters.slice(0, maxClustersToShow);

      clustersToShow.forEach((cluster, index) => {
        output += formatClusterDetails(cluster, index + 1);
      });

      if (clusters.length > maxClustersToShow) {
        const remaining = clusters.length - maxClustersToShow;
        const plural = remaining > 1 ? 's' : '';
        if (detail === 'full') {
          output += `\n*Note: ${remaining} additional cluster${plural} found within radius (showing nearest ${maxClustersToShow})*\n`;
        } else {
          output += `\n*Note: ${remaining} additional cluster${plural} found within radius (showing nearest ${maxClustersToShow} only — use detail="full" for more)*\n`;
        }
      }

      // Safety assessment keyed on the nearest cluster, same distance tiers
      // as the NIFC path, wording adjusted for detections. No containment
      // logic — FIRMS has none (D5).
      const nearest = clusters[0];
      output += `\n## Safety Assessment\n\n`;
      if (nearest.distanceKm < 5) {
        output += `⚠️ **EXTREME DANGER** - Satellite fire detections within 5 km\n`;
        output += `- Evacuate immediately if advised by authorities\n`;
        output += `- Monitor local emergency alerts\n`;
        output += `- Have evacuation plan ready\n`;
      } else if (nearest.distanceKm < 25) {
        output += `🟠 **HIGH ALERT** - Satellite fire detections within 25 km\n`;
        output += `- Monitor fire conditions closely\n`;
        output += `- Prepare for possible evacuation\n`;
        output += `- Watch for smoke and changing conditions\n`;
      } else if (nearest.distanceKm < 50) {
        output += `🟡 **CAUTION** - Satellite fire detections within 50 km\n`;
        output += `- Be aware of smoke and air quality impacts\n`;
        output += `- Monitor local news and fire updates\n`;
      } else {
        output += `ℹ️ **AWARENESS** - Satellite fire detections within ${radius} km\n`;
        output += `- Stay informed about fire activity in the area\n`;
        output += `- Air quality may be affected by smoke\n`;
      }
      output += `\n`;
    }
  } catch (error) {
    output += `❌ **Error retrieving wildfire data**\n\n`;
    output += `Unable to fetch fire information. This may be due to:\n`;
    output += `- Temporary service unavailability\n`;
    output += `- Network connectivity issues\n`;
    output += `- Service maintenance\n\n`;
    output += `Error details: ${error instanceof Error ? error.message : String(error)}\n`;
  }

  output += `\n---\n`;
  output += `*Data source: NASA FIRMS (Fire Information for Resource Management System)*\n`;
  output += `*We acknowledge the use of data from NASA FIRMS (https://firms.modaps.eosdis.nasa.gov/), part of NASA's Earth Science Data and Information System (ESDIS).*\n`;
  output += `*Satellite detections update with each polar overpass. Always consult official sources for evacuation orders and emergency information.*\n`;

  return output;
}

/** Human-readable satellite name from the FIRMS satellite code. */
function formatSatellite(code: string): string {
  switch (code) {
    case 'N':
      return 'Suomi NPP (VIIRS)';
    case '1':
      return 'NOAA-20 (VIIRS)';
    case '2':
      return 'NOAA-21 (VIIRS)';
    default:
      return code || 'Unknown';
  }
}

/** Non-zero confidence buckets, highest first — e.g. "3 high, 12 nominal". */
function formatConfidenceSummary(cluster: FIRMSCluster): string {
  const parts: string[] = [];
  if (cluster.confidenceCounts.high > 0) parts.push(`${cluster.confidenceCounts.high} high`);
  if (cluster.confidenceCounts.nominal > 0) parts.push(`${cluster.confidenceCounts.nominal} nominal`);
  if (cluster.confidenceCounts.low > 0) parts.push(`${cluster.confidenceCounts.low} low`);
  if (cluster.confidenceCounts.unknown > 0) parts.push(`${cluster.confidenceCounts.unknown} unknown`);
  return parts.join(', ');
}

/**
 * Format one detection cluster (D5): count, distance + bearing, peak FRP as
 * the intensity signal, newest detection age, day/night mix, confidence
 * summary, satellite. Raw brightness Kelvin is deliberately absent.
 */
function formatClusterDetails(cluster: FIRMSCluster, ordinal: number): string {
  let output = `## Detection Cluster ${ordinal}\n\n`;

  const detectionPlural = cluster.count > 1 ? 's' : '';
  output += `**Detections:** ${cluster.count} hotspot${detectionPlural}`;
  if (cluster.dayCount > 0 || cluster.nightCount > 0) {
    output += ` (${cluster.dayCount} day / ${cluster.nightCount} night)`;
  }
  output += `\n`;

  output += `**Distance:** ${cluster.distanceKm.toFixed(1)} km (${(cluster.distanceKm * 0.621371).toFixed(1)} mi) ${cluster.bearing}\n`;
  output += `**Center:** ${cluster.centroid.latitude.toFixed(4)}, ${cluster.centroid.longitude.toFixed(4)}\n`;
  output += `**Peak intensity:** ${cluster.maxFrp.toFixed(1)} MW (fire radiative power)\n`;

  const ageMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(cluster.newestAcquiredAt).getTime()) / 60000)
  );
  output += `**Newest detection:** ${formatObservationAge(ageMinutes)}\n`;

  const confidenceSummary = formatConfidenceSummary(cluster);
  if (confidenceSummary.length > 0) {
    output += `**Confidence:** ${confidenceSummary}\n`;
  }
  output += `**Satellite:** ${formatSatellite(cluster.satellite)}\n`;

  output += `\n---\n\n`;
  return output;
}

/**
 * Format detailed information for a single wildfire
 */
function formatFireDetails(fire: WildfireInfo, distance: number, timezone: string): string {
  let output = `## ${fire.name}\n\n`;

  // Fire type emoji
  const typeEmoji = fire.type === 'Wildfire' ? '🔥' :
                    fire.type === 'Prescribed Fire' ? '🟦' : '⚪';

  output += `**Type:** ${typeEmoji} ${fire.type}\n`;
  output += `**Distance:** ${distance.toFixed(1)} km (${(distance * 0.621371).toFixed(1)} mi)\n`;

  if (fire.state) {
    let location = fire.state;
    if (fire.county) location += `, ${fire.county} County`;
    if (fire.city) location += ` near ${fire.city}`;
    output += `**Location:** ${location}\n`;
  }

  if (fire.latitude && fire.longitude) {
    output += `**Coordinates:** ${fire.latitude.toFixed(4)}, ${fire.longitude.toFixed(4)}\n`;
  }

  output += `\n`;

  // Fire statistics
  output += `### Status\n`;
  output += `**Size:** ${fire.acres.toFixed(0)} acres (${(fire.acres * 0.404686).toFixed(0)} hectares)\n`;

  // Containment with visual indicator
  const containmentBars = Math.round(fire.containment / 10);
  const containmentVisual = '█'.repeat(containmentBars) + '░'.repeat(10 - containmentBars);
  output += `**Containment:** ${fire.containment.toFixed(0)}% ${containmentVisual}\n`;

  const now = new Date();
  const daysActive = Math.floor((now.getTime() - fire.discoveryDate.getTime()) / (1000 * 60 * 60 * 24));
  output += `**Discovery Date:** ${fire.discoveryDate.toLocaleDateString('en-US', { timeZone: timezone })}\n`;
  output += `**Days Active:** ${daysActive}\n`;

  output += `\n---\n\n`;
  return output;
}
