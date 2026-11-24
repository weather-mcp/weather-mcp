/**
 * Handler for get_wildfire_info tool.
 *
 * Routed by country (see docs/plans/global-wildfire-plan.md D1/D2):
 *   US → NIFC/WFIGS named incidents, each measured to its mapped perimeter
 *   (the reported point of origin only when no usable perimeter is
 *   published), elsewhere → NASA FIRMS satellite fire detections (VIIRS, near
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
import { resolveCountryCode, resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateDetail } from '../utils/validation.js';
import { guessTimezoneFromCoords, formatObservationAge } from '../utils/timezone.js';
import { calculateDistance, kmToMiles } from '../utils/distance.js';
import { distanceToPerimeterKm } from '../utils/firePerimeter.js';
import { displayValue } from '../utils/displayBanding.js';
import { isInUS } from '../utils/geography.js';
import { logger } from '../utils/logger.js';
import {
  FIRMS_PRODUCTS,
  satelliteDisplayName,
  classifyLastModified,
  classifyMaxDate
} from '../utils/firmsProducts.js';
import {
  pickRegionFile,
  filterByRadius,
  clusterDetections,
  MAX_RADIUS_DETECTIONS
} from '../utils/firmsHotspots.js';
import type { FIRMSDetection, FIRMSCluster, FIRMSProduct } from '../types/firms.js';
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

type HandlerResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

/** A rendered report plus whether its data fetch failed as a whole. */
type RenderOutcome = { text: string; failed: boolean };

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

/**
 * Parse NIFC's `attr_PercentContained` into a containment percentage, or
 * `null` meaning "NIFC published no usable containment for this incident".
 *
 * `0` is a real reading and `null` is a sentinel. Both occur live — 11 and 50
 * rows respectively in a 200-feature sample of the current perimeters layer —
 * and only the second is absence. A truthy guard suppresses both, which is the
 * defect this replaces.
 *
 * Out-of-range values take the same path as absent ones, and are not clamped.
 * A `150` is not a containment percentage; clamping it would print a figure
 * NIFC never published *and* exclude the fire from the assessment — the less
 * cautious reading of garbage.
 *
 * A `null` containment drives the danger tier as uncontained. An unknown
 * containment is not evidence of containment.
 */
function parseContainment(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100
    ? raw
    : null;
}

/**
 * Render the containment line, bar included.
 *
 * The whole indicator is gated on the value, not just the number: a bar beside
 * "not reported" would delegate the judgement the code just declined to make.
 *
 * The bar is the completed tenths of the *printed* figure, so a full bar means
 * the printed figure is `100%`, an empty bar means it is below `10%`, and each
 * cell is a completed ten percent. `repeat` receives `0..10` by construction,
 * because parseContainment has already confined the value to [0, 100].
 */
function formatContainmentLine(containment: number | null): string {
  if (containment === null) {
    return `**Containment:** not reported\n`;
  }
  const shown = displayValue(containment, 0);
  const cells = Math.floor(shown / 10);
  const visual = '█'.repeat(cells) + '░'.repeat(10 - cells);
  return `**Containment:** ${shown.toFixed(0)}% ${visual}\n`;
}

/**
 * Render the `X km (Y mi)` distance fragment — the fragment only, so a caller
 * that appends a bearing keeps its own separator.
 *
 * The miles figure is derived from the *displayed* kilometres, not the raw
 * measurement, so two fires printing the same km print the same miles.
 *
 * Two decimals is what makes the miles figure an injective function of the
 * displayed kilometres: adjacent displayed km differ by 0.1 km = 0.0621 mi,
 * and a 0.01 mi grid cannot collapse two values 0.062 apart. Since the danger
 * tier is also a function of the displayed km, no printed miles figure can
 * span two tiers — at every seam, by construction. One decimal fails exactly
 * this: `50.0` and `50.1 km` both print `31.1 mi`, under CAUTION and
 * AWARENESS respectively.
 */
function formatDistanceFigure(km: number): string {
  const shownKm = displayValue(km, 1);
  return `${shownKm.toFixed(1)} km (${kmToMiles(shownKm).toFixed(2)} mi)`;
}

/**
 * Parse NIFC's reported point of origin, or `null` when either coordinate is
 * unusable.
 *
 * Usable means finite, in coordinate range, and **non-zero**. No incident in
 * NIFC's covered set (US, PR, VI, GU) can sit on the equator or the prime
 * meridian, so a `0` is a second "not recorded" encoding beside `null`
 * (GOTCHAS G56), not a coordinate. Treating it as one would measure the fire
 * thousands of km away and drop it at the radius filter; treating it as absent
 * keeps the fire listed as unlocated, the cautious direction.
 */
function parseOrigin(rawLat: unknown, rawLon: unknown): { latitude: number; longitude: number } | null {
  if (typeof rawLat !== 'number' || typeof rawLon !== 'number') return null;
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLon)) return null;
  if (rawLat === 0 || rawLon === 0) return null;
  if (rawLat < -90 || rawLat > 90 || rawLon < -180 || rawLon > 180) return null;
  return { latitude: rawLat, longitude: rawLon };
}

/**
 * The first acreage field that is a finite number greater than zero, or `null`
 * meaning "NIFC published no size". Zero is absent here, unlike containment: a
 * mapped perimeter of zero area is not a reading, it is a second "not
 * recorded" encoding (GOTCHAS G56). The old `|| 0` printed `0 acres`.
 */
function parseAcres(candidates: unknown[]): number | null {
  for (const raw of candidates) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  }
  return null;
}

/**
 * NIFC's discovery timestamp (epoch ms) as a `Date`, or `null` meaning "NIFC
 * published no discovery date". Epoch `0` is absent, not 1 January 1970: no
 * current incident was discovered then. A finite value outside the `Date`
 * range (e.g. `Number.MAX_VALUE`) is absent too. The old fallback was
 * `new Date()`, which printed today's date and `Days Active: 0`.
 */
function parseDiscoveryDate(raw: unknown): Date | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The line beneath `**Distance:**` naming what the distance was measured to. */
function formatDistanceBasisLine(fire: WildfireInfo): string {
  switch (fire.distanceBasis) {
    case 'perimeter':
      return fire.distance === 0
        ? `**Measured to:** the mapped fire perimeter — this location is inside it\n`
        : `**Measured to:** nearest edge of the mapped fire perimeter\n`;
    case 'origin':
      return `**Measured to:** reported point of origin (NIFC published no usable perimeter)\n`;
    case 'unlocated':
      return `**Measured to:** not available — NIFC published neither a perimeter nor a point of origin\n`;
  }
}

/**
 * The Safety Assessment line for wildfires with no published location. They
 * select no tier, because a tier is a claim about a distance, so the section
 * must say they exist and that it is not an all-clear.
 */
function formatUnlocatedWildfireLine(names: string[]): string {
  const n = names.length;
  const shown = names.slice(0, 5).join(', ');
  const more = n > 5 ? ` and ${n - 5} more` : '';
  const one = n === 1;
  return `⚠️ ${n} wildfire${one ? '' : 's'} in this search area ${one ? 'has' : 'have'} no published location (${shown}${more}). ` +
    `${one ? 'Its' : 'Their'} distance is unknown and is not reflected in any tier above. ` +
    `Do not read this section as an all-clear.\n`;
}

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
  // Only meaningful on a NIFC render: does this point look like somewhere
  // NIFC/WFIGS has no coverage at all? Drives the empty-result disclosure
  // instead of an affirmative all-clear (F3/D3).
  let outsideNifcCoverage = false;

  if (source === 'firms') {
    // Explicit override — works anywhere, including the US (satellite
    // detections often appear before an incident is catalogued in WFIGS).
    useFirms = true;
  } else if (source === 'nifc') {
    // Explicit override — honoured as asked (no cross-fallback), but the
    // point may be somewhere WFIGS simply does not track incidents. Resolve
    // the country anyway (cached, country-level) so an empty result can
    // disclose that rather than print a green checkmark over a live fire.
    useFirms = false;
    const { countryCode, lookupFailed } = await resolveCountryCode(
      resolved.country_code,
      latitude,
      longitude,
      nominatimService
    );
    reverseLookupFailed = lookupFailed;
    outsideNifcCoverage = countryCode
      ? !NIFC_COVERED_COUNTRIES.has(countryCode)
      : !isInUS(latitude, longitude);
  } else {
    const { countryCode, lookupFailed } = await resolveCountryCode(
      resolved.country_code,
      latitude,
      longitude,
      nominatimService
    );
    reverseLookupFailed = lookupFailed;

    // Route. The reverse answer wins over isInUS; "no country" (open
    // water, absent service, or a failed lookup) falls back to the
    // bounding boxes.
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

  const { text: output, failed } = useFirms && firmsService
    ? await formatFIRMSWildfire(firmsService, latitude, longitude, radius, dayRange, detail)
    : await formatNIFCWildfire(nifcService, latitude, longitude, radius, detail, outsideNifcCoverage);

  const result = prependLocationLine({
    content: [
      {
        type: 'text',
        text: output
      }
    ],
    ...(failed ? { isError: true } : {})
  }, resolved);

  if (reverseLookupFailed) {
    result.content[0].text +=
      `\n*Note: the country lookup service was unavailable, so routing fell back to coordinate checks.*\n`;
  }

  return result;
}

/**
 * The US path: NIFC/WFIGS named incidents with acreage, containment, and the
 * containment-aware safety assessment. Each fire is measured to its mapped
 * perimeter (zero inside it), else to its reported point of origin, else it is
 * listed as unlocated with no distance; the line beneath `**Distance:**` names
 * which. `failed` is true only when the catch replaced the fire list with the
 * error block.
 */
async function formatNIFCWildfire(
  nifcService: NIFCService,
  latitude: number,
  longitude: number,
  radius: number,
  detail: 'summary' | 'standard' | 'full',
  /**
   * True only when `source: "nifc"` was forced at a point NIFC does not
   * cover. Changes the empty-result branch alone (F3/D3): an all-clear must
   * never stand in for "this authority has no data here". Optional and
   * trailing so every existing caller and test harness is unaffected.
   */
  outsideCoverage = false
): Promise<RenderOutcome> {
  // Get timezone for proper time formatting
  const timezone = guessTimezoneFromCoords(latitude, longitude);

  let output = `# Wildfire Information Report\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Search Radius:** ${radius} km (${(radius * 0.621371).toFixed(1)} miles)\n\n`;

  let failed = false;
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

    // Measure and filter first, then branch on the filtered list (D3): a
    // response whose every feature lies beyond the radius is the no-fires
    // case (or the coverage disclosure), never a "Found 0 active fire" count.
    const firesWithDistance: Array<{ fire: WildfireInfo; distance: number | null }> = [];

    for (const feature of features) {
      const attrs = feature.attributes;

      // Basis order: mapped perimeter → reported point of origin → unlocated.
      // A fire is an area; the origin is a coordinate entered once and is
      // sometimes far from the fire, so it is only the fallback. `null` is
      // a refusal to measure, never a number (GOTCHAS G68).
      const origin = parseOrigin(attrs.attr_InitialLatitude, attrs.attr_InitialLongitude);
      const perimeterKm = distanceToPerimeterKm(latitude, longitude, feature.geometry?.rings);
      let fireDistance: number | null;
      let distanceBasis: WildfireInfo['distanceBasis'];
      if (perimeterKm !== null) {
        fireDistance = perimeterKm;
        distanceBasis = 'perimeter';
      } else if (origin !== null) {
        fireDistance = calculateDistance(latitude, longitude, origin.latitude, origin.longitude);
        distanceBasis = 'origin';
      } else {
        fireDistance = null;
        distanceBasis = 'unlocated';
      }

      // Keep a located fire within the radius, and every unlocated fire:
      // an unknown distance is not evidence that the fire is far away.
      if (fireDistance === null || fireDistance <= radius) {
        if (fireDistance === null) {
          logger.warn('NIFC published no usable location for an incident', {
            incident: attrs.poly_IncidentName
          });
        }
        // Parsed before the literal so the warn can be guarded on the result.
        // Warn only when the value is present but unusable — a plain
        // null/undefined is the normal wire shape for a quarter of live rows,
        // and warning on it would emit ~50 lines per request on a healthy
        // feed. This is a data-quality event, not a security one, so no
        // securityEvent flag (unlike the FIRMS row cap below).
        const containment = parseContainment(attrs.attr_PercentContained);
        if (attrs.attr_PercentContained != null && containment === null) {
          logger.warn('NIFC published an unusable containment value', {
            incident: attrs.poly_IncidentName,
            value: attrs.attr_PercentContained
          });
        }

        const fireInfo: WildfireInfo = {
          name: attrs.poly_IncidentName || 'Unknown Fire',
          distance: fireDistance,
          distanceBasis,
          acres: parseAcres([attrs.poly_GISAcres, attrs.attr_FinalAcres, attrs.attr_CalculatedAcres]),
          containment,
          discoveryDate: parseDiscoveryDate(attrs.attr_FireDiscoveryDateTime),
          latitude: origin?.latitude,
          longitude: origin?.longitude,
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

    // Sort by distance (nearest first), unlocated fires last. The sort is
    // stable, so unlocated fires keep the upstream order among themselves.
    firesWithDistance.sort((a, b) => {
      if (a.distance === null) return b.distance === null ? 0 : 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });

    if (firesWithDistance.length === 0 && outsideCoverage) {
      // Forced `source: "nifc"` outside NIFC coverage. An empty result here
      // means "this authority does not track fires at this location", which
      // is emphatically not an all-clear — so no ✅ and no "currently clear"
      // sentence (F3/D3). The override is deliberate, so disclose rather
      // than error or silently swap sources.
      output += `**NIFC/WFIGS tracks wildfire incidents in the United States and its `;
      output += `territories only, and this location appears to be outside that coverage.**\n\n`;
      output += `No incidents were returned — but that is an absence of coverage, not an `;
      output += `all-clear. There may be active fires here that NIFC does not report.\n\n`;
      output += `Use \`source: "firms"\` (or omit \`source\`) for NASA FIRMS satellite fire `;
      output += `detections, which are global.\n`;
    } else if (firesWithDistance.length === 0) {
      output += `✅ **No active wildfires found within ${radius} km**\n\n`;
      if (response.exceededTransferLimit) {
        output += `*Results may be incomplete — the fire data service truncated the response.*\n\n`;
      }
      output += `The area is currently clear of reported wildfire activity.\n\n`;
      output += `**Note:** This data includes active wildfires and prescribed burns tracked by the National Interagency Fire Center. Small fires or very recent ignitions may not yet be included.\n`;
    } else {
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

      for (const { fire } of firesToShow) {
        output += formatFireDetails(fire, timezone);
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
      // A fire whose containment *displays* as fully contained — however close —
      // no longer drives the escalation tier (F3: a 100%-contained fire was
      // producing EXTREME DANGER wording).
      //
      // Exclude on the *displayed* containment: formatFireDetails prints
      // `toFixed(0)`, so a fire at 99.6% renders `100%` and must not drive the
      // tier — otherwise the report shows `**Containment:** 100%` and
      // `EXTREME DANGER` together, the incoherence F3 was introduced to remove,
      // surviving at the rounding edge. This is deliberately the one
      // less-cautious edge in the band-rounding sequence (design plan,
      // "Containment").
      const wildfires = firesWithDistance.filter(f => f.fire.type === 'Wildfire');
      // A null containment drives the tier as uncontained, exactly as the
      // old `|| 0` made it: an unknown containment is not evidence of
      // containment. displayValue does not accept null, so the case is
      // spelled out rather than coerced.
      const isDisplayedUncontained = (f: { fire: WildfireInfo }): boolean =>
        f.fire.containment === null || displayValue(f.fire.containment, 0) < 100;
      // Only a located fire can select a tier: a tier is a claim about a
      // distance, and an unlocated fire has none (GOTCHAS G68).
      const nearestWildfire = wildfires.find(
        (f): f is { fire: WildfireInfo; distance: number } =>
          f.distance !== null && isDisplayedUncontained(f)
      );
      const unlocatedWildfires = wildfires.filter(f => f.distance === null);
      const unlocatedUncontained = unlocatedWildfires.some(isDisplayedUncontained);

      if (wildfires.length > 0) {
        output += `\n## Safety Assessment\n\n`;

        if (nearestWildfire) {
          // Band on the number the report prints, not the raw measurement:
          // formatFireDetails renders `distance.toFixed(1)`, so banding on the
          // raw value lets two reports show the same `5.0 km` under different
          // tiers. `<=` rather than `<` because rounding down toward the
          // displayed figure would otherwise move a fire *out* of the more
          // dangerous tier. It fires only where the raw distance has reached a
          // threshold but still displays at it: `[5, 5.05]`, `[25, 25.05)` and
          // `[50, 50.05]` km. The three windows are deliberately written
          // asymmetric — `toFixed` disagrees with itself on exact halves, so
          // 5.05 and 50.05 display low while 25.05 displays high (G36). Derive
          // them, do not assume symmetry. And because the sentence printed
          // beneath says "within 5 km", which includes 5.0.
          const dist = displayValue(nearestWildfire.distance, 1);
          // Located fires sort first, so whenever a located nearestWildfire
          // exists, wildfires[0] is located too; the null check narrows the
          // type and is never the deciding term.
          const nearestOverall = wildfires[0];
          if (nearestOverall !== nearestWildfire && nearestOverall.distance !== null) {
            output += `ℹ️ Nearest fire (${nearestOverall.fire.name}, ${nearestOverall.distance.toFixed(1)} km) is 100% contained and excluded from the danger assessment.\n\n`;
          }

          if (dist <= 5) {
            output += `⚠️ **EXTREME DANGER** - Wildfire within 5 km\n`;
            output += `- Evacuate immediately if advised by authorities\n`;
            output += `- Monitor local emergency alerts\n`;
            output += `- Have evacuation plan ready\n`;
          } else if (dist <= 25) {
            output += `🟠 **HIGH ALERT** - Wildfire within 25 km\n`;
            output += `- Monitor fire conditions closely\n`;
            output += `- Prepare for possible evacuation\n`;
            output += `- Watch for smoke and changing conditions\n`;
          } else if (dist <= 50) {
            output += `🟡 **CAUTION** - Wildfire within 50 km\n`;
            output += `- Be aware of smoke and air quality impacts\n`;
            output += `- Monitor local news and fire updates\n`;
          } else {
            output += `ℹ️ **AWARENESS** - Wildfire detected within ${radius} km\n`;
            output += `- Stay informed about fire progression\n`;
            output += `- Air quality may be affected by smoke\n`;
          }
        } else if (!unlocatedUncontained) {
          // Wildfires are present but every one is 100% contained. Still
          // surface the section — omitting it would hide that fires exist
          // nearby — pinned at the lowest (AWARENESS) tier.
          output += `ℹ️ **AWARENESS**\n`;
          output += `ℹ️ All fires within radius are 100% contained.\n`;
          output += `- Stay informed about fire progression\n`;
          output += `- Air quality may be affected by smoke\n`;
        }
        // Otherwise an unlocated wildfire is not displayed-contained: no
        // tier and no all-contained line. The line below names it.
        if (unlocatedWildfires.length > 0) {
          const blockAbove = nearestWildfire !== undefined || !unlocatedUncontained;
          if (blockAbove) output += `\n`;
          output += formatUnlocatedWildfireLine(unlocatedWildfires.map(f => f.fire.name));
        }
        output += `\n`;
      }
    }
  } catch (error) {
    failed = true;
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

  return { text: output, failed };
}

/**
 * The global path: NASA FIRMS satellite heat detections, clustered and
 * framed honestly (D5) — these are hotspots, not managed incidents, so there
 * are no fire names, sizes, or containment percentages, and a no-detections
 * result never reads as all-clear. `failed` is true only when the outer catch
 * replaced the detection list with the error block; a rejected key whose
 * keyless fallback answers is a success.
 */
async function formatFIRMSWildfire(
  firmsService: FIRMSService,
  latitude: number,
  longitude: number,
  radius: number,
  dayRange: number,
  detail: 'summary' | 'standard' | 'full'
): Promise<RenderOutcome> {
  let output = `# Wildfire Information Report\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Search Radius:** ${radius} km (${(radius * 0.621371).toFixed(1)} miles)\n`;
  output += `**Source:** NASA FIRMS satellite fire detections (VIIRS, near real-time)\n`;
  // The `**Satellites:**` line needs the fetch outcome, so the warning
  // paragraph that follows it is appended once the products have answered
  // (or, on the error path, by the catch).
  const warning =
    `⚠️ Satellite heat detections — not managed incident data. No fire names, ` +
    `sizes, or containment are available; detections may include industrial ` +
    `heat sources, gas flares, or agricultural burns.\n\n`;
  let preambleDone = false;

  let failed = false;
  try {
    const collected = await collectFirmsDetections(
      firmsService, latitude, longitude, radius, dayRange
    );

    if (collected.contributing.length === 0) {
      if (collected.failed.length > 0) {
        // No product answered and at least one failed: today's error block.
        throw collected.failed[0].error;
      }
      // Every product stale: a distinct state from "unreachable", not an answer.
      const dates = collected.stale
        .map(s => `${s.product.displayName}: last data ${s.lastDataDate}`)
        .join('; ');
      throw new Error(`NASA FIRMS satellite feeds are not currently updating (${dates}).`);
    }

    output += `**Satellites:** ${collected.contributing.map(p => p.displayName).join(', ')} (VIIRS)\n`;
    output += `\n${warning}`;
    preambleDone = true;

    const { keyRejected } = collected;
    // Effective window actually served: dayRange on the keyed path, 24 h keyless.
    const servedDays = collected.keyed ? dayRange : 1;
    // Rolling-window filter on both paths, over the window the report names.
    // Keyed: the request asks for one extra calendar day (see
    // collectFirmsDetections). Keyless: a `_24h` flat file is "recent
    // acquisitions", not a 24 h window — measured holding 25-45 h (G168).
    const cutoffMs = Date.now() - servedDays * 24 * 60 * 60 * 1000;
    const rows = collected.raw.filter(d => new Date(d.acquiredAt).getTime() >= cutoffMs);
    // filterByRadius sorts by distance before its row cap, so the cap never
    // drops one satellite's detections as a block.
    const { detections, truncated } = filterByRadius(rows, latitude, longitude, radius);

    if (collected.stale.length > 0 || collected.failed.length > 0) {
      const parts = [
        ...collected.stale.map(s => `${s.product.displayName}: no new data since ${s.lastDataDate} (UTC)`),
        ...collected.failed.map(f => `${f.product.displayName}: request failed`)
      ];
      output += `*Note: not every satellite is included — ${parts.join('; ')}.*\n\n`;
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
      // Band on the displayed distance with `<=`, exactly as the NIFC ladder
      // above does and for the same reasons — see the comment there.
      // formatClusterDetails renders `cluster.distanceKm.toFixed(1)`.
      const nearestShown = displayValue(nearest.distanceKm, 1);
      output += `\n## Safety Assessment\n\n`;
      if (nearestShown <= 5) {
        output += `⚠️ **EXTREME DANGER** - Satellite fire detections within 5 km\n`;
        output += `- Evacuate immediately if advised by authorities\n`;
        output += `- Monitor local emergency alerts\n`;
        output += `- Have evacuation plan ready\n`;
      } else if (nearestShown <= 25) {
        output += `🟠 **HIGH ALERT** - Satellite fire detections within 25 km\n`;
        output += `- Monitor fire conditions closely\n`;
        output += `- Prepare for possible evacuation\n`;
        output += `- Watch for smoke and changing conditions\n`;
      } else if (nearestShown <= 50) {
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
    failed = true;
    if (!preambleDone) {
      output += `\n${warning}`;
    }
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

  return { text: output, failed };
}

/** One FIRMS call's per-product outcome, before radius filtering. */
interface FirmsCollection {
  /** Rows from every contributing product, concatenated (no dedup across satellites). */
  raw: FIRMSDetection[];
  /** Current products that answered, in table order — zero rows is still an answer. */
  contributing: FIRMSProduct[];
  /** Products excluded as stale, in table order. */
  stale: Array<{ product: FIRMSProduct; lastDataDate: string }>;
  /** Products whose request failed (other than a key rejection), in table order. */
  failed: Array<{ product: FIRMSProduct; error: unknown }>;
  /** The keyed path's key was rejected and the keyless path answered instead (D3). */
  keyRejected: boolean;
  /** True when the rows came from the keyed Area API (multi-day, rolling-window filter applies). */
  keyed: boolean;
}

/**
 * Fetch every product in `FIRMS_PRODUCTS`, judge each one's freshness by the
 * clock, and sort the products into contributing / stale / failed.
 *
 * Keyed: `data_availability` first (garnish, fails open); a product whose
 * `max_date` is stale is not fetched. The rest run concurrently, each walking
 * its longitude slices in sequence. A `FIRMSKeyRejectedError` from any product
 * discards the keyed results and runs the keyless branch (D3).
 *
 * Keyless: every product's regional file concurrently; a fulfilled product is
 * judged by its `Last-Modified` header (missing ⇒ current).
 */
async function collectFirmsDetections(
  firmsService: FIRMSService,
  latitude: number,
  longitude: number,
  radius: number,
  dayRange: number
): Promise<FirmsCollection> {
  const nowMs = Date.now();

  if (firmsService.isKeyAvailable()) {
    // Same bbox math as the NIFC path. Latitude is clamped to valid
    // coordinate range (the pole genuinely ends at ±90). Longitude is
    // *sliced*, not clamped (F6): clamping truncated the query near the
    // antimeridian instead of wrapping it, silently dropping detections
    // across the dateline that the keyless path (whole-region haversine
    // filter) found fine. See docs/release-review-hardening-plan.md D6.
    const latOffset = radius / 111;
    const lonOffset = radius / (111 * Math.cos(latitude * Math.PI / 180));
    const south = Math.max(-90, latitude - latOffset);
    const north = Math.min(90, latitude + latOffset);

    // Upstream semantics (live-verified 2026-08-14): the Area API's day
    // range counts calendar UTC days *including today*, while the keyless
    // flat files serve a rolling 24 h window — so a day-range-1 query at
    // midday would silently miss yesterday evening's detections that the
    // keyless path shows. Request one extra calendar day (the API caps at
    // 5) and the caller filters to the true rolling window, keeping the
    // "last N days" label honest and the two paths comparable. At day_range
    // 5 the request can't widen further, so the tail of the window may fall
    // up to a day short — acceptable for multi-day history.
    const fetchDays = Math.min(dayRange + 1, 5);

    // Longitude slices: near the poles cos(latitude) blows up and
    // lonOffset can reach or exceed 180 (including Infinity) — one query
    // spanning the full longitude range. Otherwise, if the raw ±lonOffset
    // window crosses the antimeridian, two disjoint slices that meet at
    // ±180. Otherwise, a single-query window.
    const rawWest = longitude - lonOffset;
    const rawEast = longitude + lonOffset;
    let lonSlices: Array<[west: number, east: number]>;
    if (lonOffset >= 180) {
      lonSlices = [[-180, 180]];
    } else if (rawWest < -180) {
      lonSlices = [[rawWest + 360, 180], [-180, rawEast]];
    } else if (rawEast > 180) {
      lonSlices = [[rawWest, 180], [-180, rawEast - 360]];
    } else {
      lonSlices = [[rawWest, rawEast]];
    }

    const availability = await firmsService.getProductAvailability();
    const stale: FirmsCollection['stale'] = [];
    const toFetch: FIRMSProduct[] = [];
    for (const product of FIRMS_PRODUCTS) {
      const freshness = classifyMaxDate(availability?.get(product.id), nowMs);
      if (freshness.state === 'stale') {
        logger.warn('FIRMS product feed is stale', { product: product.id, path: 'keyed' });
        stale.push({ product, lastDataDate: freshness.lastDataDate });
      } else {
        toFetch.push(product);
      }
    }

    // Slices are disjoint, so a product's slices are concatenated without
    // dedup, awaited in sequence.
    const settled = await Promise.allSettled(
      toFetch.map(async product => {
        let rows: FIRMSDetection[] = [];
        for (const [west, east] of lonSlices) {
          const slice = await firmsService.getDetectionsByBbox(west, south, east, north, fetchDays, product);
          rows = rows.concat(slice);
        }
        return rows;
      })
    );

    const keyRejected = settled.some(
      r => r.status === 'rejected' && r.reason instanceof FIRMSKeyRejectedError
    );
    if (!keyRejected) {
      const collection: FirmsCollection = {
        raw: [], contributing: [], stale, failed: [], keyRejected: false, keyed: true
      };
      settled.forEach((result, i) => {
        const product = toFetch[i];
        if (result.status === 'fulfilled') {
          collection.contributing.push(product);
          collection.raw = collection.raw.concat(result.value);
        } else {
          collection.failed.push({ product, error: result.reason });
        }
      });
      return collection;
    }
    // Key rejected → keyless fallback with a disclosure note (D3): the tool
    // keeps working while surfacing the misconfiguration. The keyless path
    // applies its own freshness rules; the keyed verdicts are discarded.
    const fallback = await collectKeyless(firmsService, latitude, longitude, nowMs);
    return { ...fallback, keyRejected: true };
  }

  return collectKeyless(firmsService, latitude, longitude, nowMs);
}

async function collectKeyless(
  firmsService: FIRMSService,
  latitude: number,
  longitude: number,
  nowMs: number
): Promise<FirmsCollection> {
  const regionFile = pickRegionFile(latitude, longitude);
  const settled = await Promise.allSettled(
    FIRMS_PRODUCTS.map(product => firmsService.getDetectionsByRegion(regionFile, product))
  );
  const collection: FirmsCollection = {
    raw: [], contributing: [], stale: [], failed: [], keyRejected: false, keyed: false
  };
  settled.forEach((result, i) => {
    const product = FIRMS_PRODUCTS[i];
    if (result.status === 'rejected') {
      collection.failed.push({ product, error: result.reason });
      return;
    }
    const freshness = classifyLastModified(result.value.lastModified, nowMs);
    if (freshness.state === 'stale') {
      logger.warn('FIRMS product feed is stale', { product: product.id, path: 'keyless' });
      collection.stale.push({ product, lastDataDate: freshness.lastDataDate });
      return;
    }
    collection.contributing.push(product);
    collection.raw = collection.raw.concat(result.value.detections);
  });
  return collection;
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

  output += `**Distance:** ${formatDistanceFigure(cluster.distanceKm)} ${cluster.bearing}\n`;
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
  output += `**Satellite:** ${cluster.satellites.map(satelliteDisplayName).join(', ') || 'Unknown'}\n`;

  output += `\n---\n\n`;
  return output;
}

/**
 * Format detailed information for a single wildfire
 */
function formatFireDetails(fire: WildfireInfo, timezone: string): string {
  let output = `## ${fire.name}\n\n`;

  // Fire type emoji
  const typeEmoji = fire.type === 'Wildfire' ? '🔥' :
                    fire.type === 'Prescribed Fire' ? '🟦' : '⚪';

  output += `**Type:** ${typeEmoji} ${fire.type}\n`;
  output += fire.distance === null
    ? `**Distance:** not reported\n`
    : `**Distance:** ${formatDistanceFigure(fire.distance)}\n`;
  output += formatDistanceBasisLine(fire);

  if (fire.state) {
    let location = fire.state;
    if (fire.county) location += `, ${fire.county} County`;
    if (fire.city) location += ` near ${fire.city}`;
    output += `**Location:** ${location}\n`;
  }

  // Set only when parseOrigin found both coordinates usable. Labelled as the
  // reported origin because, once distance is measured to the perimeter, an
  // unlabelled coordinate far from the printed distance reads as a contradiction.
  if (fire.latitude !== undefined && fire.longitude !== undefined) {
    output += `**Point of Origin (reported):** ${fire.latitude.toFixed(4)}, ${fire.longitude.toFixed(4)}\n`;
  }

  output += `\n`;

  // Fire statistics
  output += `### Status\n`;
  output += fire.acres === null
    ? `**Size:** not reported\n`
    : `**Size:** ${fire.acres.toFixed(0)} acres (${(fire.acres * 0.404686).toFixed(0)} hectares)\n`;

  // The bar is the completed tenths of the printed figure: a full bar means
  // the printed figure is `100%`, an empty bar means it is below `10%`, and
  // each cell is a completed ten percent. A fire NIFC published no usable
  // containment for reads `not reported`, with no bar at all.
  output += formatContainmentLine(fire.containment);

  // A day count derived from a date nobody published has no honest value, so
  // Days Active is omitted, not zeroed, when the date is absent.
  if (fire.discoveryDate === null) {
    output += `**Discovery Date:** not reported\n`;
  } else {
    const now = new Date();
    const daysActive = Math.floor((now.getTime() - fire.discoveryDate.getTime()) / (1000 * 60 * 60 * 24));
    output += `**Discovery Date:** ${fire.discoveryDate.toLocaleDateString('en-US', { timeZone: timezone })}\n`;
    output += `**Days Active:** ${daysActive}\n`;
  }

  output += `\n---\n\n`;
  return output;
}
