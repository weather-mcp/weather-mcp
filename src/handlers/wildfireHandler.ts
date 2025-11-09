/**
 * Handler for get_wildfire_info tool
 */

import { NIFCService } from '../services/nifc.js';
import { validateCoordinates } from '../utils/validation.js';
import { guessTimezoneFromCoords } from '../utils/timezone.js';
import { calculateDistance } from '../utils/distance.js';
import type { WildfireInfo } from '../types/wildfire.js';

interface WildfireArgs {
  latitude?: number;
  longitude?: number;
  radius?: number; // search radius in km (default: 100)
}

export async function handleGetWildfireInfo(
  args: unknown,
  nifcService: NIFCService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input parameters with runtime checks
  const { latitude, longitude } = validateCoordinates(args);

  // Validate radius parameter
  let radius = (args as WildfireArgs)?.radius ?? 100; // default 100 km
  if (typeof radius !== 'number' || isNaN(radius) || !isFinite(radius)) {
    radius = 100;
  }
  // Clamp to valid range (1-500 km)
  radius = Math.max(1, Math.min(radius, 500));

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
      output += `\n`;

      // Show details for nearest fires (limit to 5 to avoid overwhelming output)
      const maxFiresToShow = 5;
      const firesToShow = firesWithDistance.slice(0, maxFiresToShow);

      for (const { fire, distance } of firesToShow) {
        output += formatFireDetails(fire, distance, timezone);
      }

      if (firesWithDistance.length > maxFiresToShow) {
        output += `\n*Note: ${firesWithDistance.length - maxFiresToShow} additional fire${firesWithDistance.length - maxFiresToShow > 1 ? 's' : ''} found within radius (showing nearest ${maxFiresToShow} only)*\n`;
      }

      // Safety recommendations based on nearest wildfire
      const nearestWildfire = firesWithDistance.find(f => f.fire.type === 'Wildfire');
      if (nearestWildfire) {
        output += `\n## Safety Assessment\n\n`;
        const dist = nearestWildfire.distance;

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

  return {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };
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
