/**
 * Handler for get_alerts tool.
 *
 * Routed by country (see docs/plans/international-alerts-plan.md D1):
 *   US → NOAA (the original path, byte-identical output),
 *   Canada → MSC GeoMet (Environment and Climate Change Canada),
 *   MeteoAlarm member countries → the country's MeteoAlarm feed,
 *   elsewhere → a clean not-covered message.
 *
 * Country resolution order: a `country_code` already carried by the resolved
 * location (saved location or geocoded city_name), else a cached
 * country-level Nominatim reverse lookup, else the `isInUS` bounding-box
 * fallback (which preserves NOAA marine alerts for US coastal waters, where
 * reverse geocoding returns no country). The reverse answer wins over
 * `isInUS` — the CONUS box deliberately overruns into Canada (Toronto,
 * Vancouver), and alert authority is jurisdictional.
 */

import { NOAAService } from '../services/noaa.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import {
  MeteoAlarmService,
  COUNTRY_FEEDS,
  isMeteoAlarmCountry
} from '../services/meteoalarm.js';
import { GeoMetService } from '../services/geomet.js';
import { NominatimService } from '../services/nominatim.js';
import type { MeteoAlarmWarning } from '../types/meteoalarm.js';
import {
  resolveLocationAsync,
  prependLocationLine,
  ResolvedLocation
} from '../utils/locationResolver.js';
import { validateOptionalBoolean, validateDetail } from '../utils/validation.js';
import { formatInTimezone, guessTimezoneFromCoords } from '../utils/timezone.js';
import { isInUS } from '../utils/geography.js';
import { logger } from '../utils/logger.js';

interface AlertsArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  active_only?: boolean;
  detail?: 'summary' | 'standard' | 'full';
}

type Detail = 'summary' | 'standard' | 'full';

type HandlerResult = { content: Array<{ type: string; text: string }> };

/** Display caps for the international renderers (country feeds routinely carry 50+ warnings). */
const STANDARD_DISPLAY_CAP = 10;
const FULL_DISPLAY_CAP = 25;

export async function handleGetAlerts(
  args: unknown,
  noaaService: NOAAService,
  locationStore: LocationStore,
  geocodingService: GeocodingService,
  meteoAlarmService?: MeteoAlarmService,
  geoMetService?: GeoMetService,
  nominatimService?: NominatimService
): Promise<HandlerResult> {
  // Resolve location from coordinates, a saved location name, or a geocoded city name
  const resolved = await resolveLocationAsync(args as AlertsArgs, locationStore, geocodingService);
  const { latitude, longitude } = resolved;
  const active_only = validateOptionalBoolean(
    (args as AlertsArgs)?.active_only,
    'active_only',
    true
  );
  // Output verbosity: 'full' includes the complete NWS description text.
  const detail = validateDetail((args as AlertsArgs)?.detail);

  // --- Country routing (D1) ---
  // 1. A country the resolution path already knows (saved location /
  //    geocoded city). Sources vary in casing; normalize to lowercase once.
  let countryCode: string | null = resolved.country_code
    ? resolved.country_code.toLowerCase()
    : null;

  // 2. Coordinates only: cached country-level reverse lookup. A missing
  //    service (test harnesses) skips this silently; only a *failed* lookup
  //    earns the one-line fallback note.
  let reverseLookupFailed = false;
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
  //    bounding boxes so US coastal waters keep their NOAA marine alerts.
  if (countryCode === 'us') {
    return handleNoaaAlerts(resolved, noaaService, active_only, detail);
  }

  if (countryCode === 'ca' && geoMetService) {
    return handleGeoMetAlerts(resolved, geoMetService, active_only, detail);
  }

  if (countryCode && isMeteoAlarmCountry(countryCode) && meteoAlarmService) {
    return handleMeteoAlarmAlerts(resolved, meteoAlarmService, countryCode, active_only, detail);
  }

  if (!countryCode && isInUS(latitude, longitude)) {
    return handleNoaaAlerts(resolved, noaaService, active_only, detail);
  }

  return notCoveredResult(resolved, countryCode, reverseLookupFailed);
}

/**
 * The original US path — prologue (station timezone side-call) and renderer
 * preserved verbatim so US output stays byte-identical
 * (locked by tests/unit/alerts-detail.test.ts passing unedited).
 */
async function handleNoaaAlerts(
  resolved: ResolvedLocation,
  noaaService: NOAAService,
  active_only: boolean,
  detail: Detail
): Promise<HandlerResult> {
  const { latitude, longitude } = resolved;

  // Get timezone for proper time formatting
  let timezone = guessTimezoneFromCoords(latitude, longitude); // fallback
  try {
    // Try to get timezone from station (preferred)
    const stations = await noaaService.getStations(latitude, longitude);
    if (stations.features && stations.features.length > 0) {
      const stationTimezone = stations.features[0].properties.timeZone;
      if (stationTimezone) {
        timezone = stationTimezone;
      }
    }
  } catch (error) {
    // Use fallback timezone
  }

  // Get alerts data
  const alertsData = await noaaService.getAlerts(latitude, longitude, active_only);
  const alerts = alertsData.features;

  // Format the alerts for display
  let output = `# Weather Alerts\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Status:** ${active_only ? 'Active alerts only' : 'All alerts'}\n`;
  if (alertsData.updated) {
    output += `**Updated:** ${formatInTimezone(alertsData.updated, timezone)}\n`;
  }
  output += `\n`;

  if (alerts.length === 0) {
    output += `✅ **No active weather alerts for this location.**\n\n`;
    output += `The area is currently clear of weather warnings, watches, and advisories.\n`;
  } else {
    output += `⚠️ **${alerts.length} active alert${alerts.length > 1 ? 's' : ''} found**\n\n`;

    // Sort alerts by severity (Extreme > Severe > Moderate > Minor > Unknown)
    type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
    const severityOrder: Record<SeverityLevel, number> = {
      'Extreme': 0,
      'Severe': 1,
      'Moderate': 2,
      'Minor': 3,
      'Unknown': 4
    };

    // Cache severity values to avoid repeated lookups during sort
    const alertsWithSeverity = alerts.map(alert => ({
      alert,
      severityValue: severityOrder[alert.properties.severity as SeverityLevel] ?? 4
    }));

    const sortedAlerts = alertsWithSeverity
      .sort((a, b) => a.severityValue - b.severityValue)
      .map(item => item.alert);

    for (const alert of sortedAlerts) {
      const props = alert.properties;

      // Severity emoji
      const severityEmoji = props.severity === 'Extreme' ? '🔴' :
                            props.severity === 'Severe' ? '🟠' :
                            props.severity === 'Moderate' ? '🟡' :
                            props.severity === 'Minor' ? '🔵' : '⚪';

      output += `${severityEmoji} **${props.event}**\n`;
      output += `---\n`;

      if (props.headline) {
        output += `**${props.headline}**\n\n`;
      }

      output += `**Severity:** ${props.severity} | **Urgency:** ${props.urgency} | **Certainty:** ${props.certainty}\n`;
      output += `**Area:** ${props.areaDesc}\n`;
      output += `**Effective:** ${formatInTimezone(props.effective, timezone)}\n`;
      output += `**Expires:** ${formatInTimezone(props.expires, timezone)}\n`;

      if (props.onset && props.onset !== props.effective) {
        output += `**Onset:** ${formatInTimezone(props.onset, timezone)}\n`;
      }

      if (props.ends) {
        output += `**Ends:** ${formatInTimezone(props.ends, timezone)}\n`;
      }

      // Full NWS description text is verbose; include it only at detail=full.
      if (detail === 'full' && props.description) {
        output += `\n**Description:**\n${props.description}\n`;
      }

      // Actionable instructions are surfaced at standard and full (not summary).
      if (detail !== 'summary' && props.instruction) {
        output += `\n**Instructions:**\n${props.instruction}\n`;
      }

      output += `\n**Recommended Response:** ${props.response}\n`;
      output += `**Sender:** ${props.senderName}\n\n`;
    }

    if (detail !== 'full') {
      output += `*Showing ${detail === 'summary' ? 'a condensed summary' : 'standard detail'}. `;
      output += `Use detail="full" for complete alert descriptions.*\n\n`;
    }
  }

  output += `---\n`;
  output += `*Data source: NOAA National Weather Service*\n`;

  return prependLocationLine({
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  }, resolved);
}

/**
 * Render a source-published ISO 8601 timestamp in the offset it was
 * published with (`2026-08-13T09:21:00+02:00` → `2026-08-13 09:21 (+02:00)`)
 * — the licence terms favour times as issued, and it skips the NOAA
 * station-timezone side-call entirely. Unparseable strings render raw.
 */
function formatPublishedTime(iso: string | undefined): string | undefined {
  if (!iso) {
    return undefined;
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(iso);
  if (!match) {
    return iso;
  }
  const [, date, time, offset] = match;
  const zone = !offset || offset === 'Z' ? 'UTC' : offset;
  return `${date} ${time} (${zone})`;
}

/** Human-readable region name from an ISO code ("au" → "Australia"), falling back to the uppercased code. */
function regionDisplayName(countryCode: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode.toUpperCase());
    return name ?? countryCode.toUpperCase();
  } catch {
    return countryCode.toUpperCase();
  }
}

/** Shared severity rank/emoji conventions (the NOAA ordering, reused where a source supplies CAP severity). */
const CAP_SEVERITY_ORDER: Record<string, number> = {
  'Extreme': 0,
  'Severe': 1,
  'Moderate': 2,
  'Minor': 3,
  'Unknown': 4
};

function capSeverityRank(severity: string | undefined): number {
  return CAP_SEVERITY_ORDER[severity ?? 'Unknown'] ?? 4;
}

function capSeverityEmoji(severity: string | undefined): string {
  return severity === 'Extreme' ? '🔴' :
         severity === 'Severe' ? '🟠' :
         severity === 'Moderate' ? '🟡' :
         severity === 'Minor' ? '🔵' : '⚪';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "…and N more warnings, mostly Minor" remainder line for capped lists. */
function remainderNote(remainder: MeteoAlarmWarning[]): string {
  const counts = new Map<string, number>();
  for (const warning of remainder) {
    const severity = warning.severity ?? 'Unknown';
    counts.set(severity, (counts.get(severity) ?? 0) + 1);
  }
  let top = 'Unknown';
  let topCount = -1;
  for (const [severity, count] of counts) {
    if (count > topCount) {
      top = severity;
      topCount = count;
    }
  }
  const plural = remainder.length > 1 ? 's' : '';
  return `*…and ${remainder.length} more warning${plural}, mostly ${top}. Use detail="full" to see more.*\n\n`;
}

/**
 * MeteoAlarm (Europe) renderer — CAP-shaped, so visually close to the NOAA
 * blocks. Licence terms honoured here: CAP text verbatim, the issue time
 * always shown, EUMETNET – MeteoAlarm + national service attribution.
 */
async function handleMeteoAlarmAlerts(
  resolved: ResolvedLocation,
  meteoAlarmService: MeteoAlarmService,
  countryCode: string,
  active_only: boolean,
  detail: Detail
): Promise<HandlerResult> {
  const feed = COUNTRY_FEEDS[countryCode];
  const countryName = feed?.name ?? regionDisplayName(countryCode);

  const warnings = await meteoAlarmService.getWarnings(countryCode);

  let output = `# Weather Alerts — ${countryName}\n\n`;
  output += `**Location:** ${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)}\n`;
  output += `**Coverage note:** European alerts are matched at country level — regional filtering is not yet available. Warnings below may not affect ${resolved.location_name ?? 'your exact location'}.\n\n`;

  if (!active_only) {
    output += `*Note: historical alerts are not available for this region — showing current warnings only.*\n\n`;
  }

  if (warnings.length === 0) {
    output += `✅ **No active weather alerts for ${countryName}.**\n\n`;
  } else {
    output += `⚠️ **${warnings.length} active warning${warnings.length > 1 ? 's' : ''} for ${countryName}**\n\n`;

    // Sort by CAP severity (the NOAA Extreme→Unknown order), then by expiry.
    const sorted = [...warnings].sort((a, b) => {
      const bySeverity = capSeverityRank(a.severity) - capSeverityRank(b.severity);
      if (bySeverity !== 0) {
        return bySeverity;
      }
      const aExpires = a.expires ? new Date(a.expires).getTime() : Infinity;
      const bExpires = b.expires ? new Date(b.expires).getTime() : Infinity;
      return aExpires - bExpires;
    });

    if (detail === 'summary') {
      // Counts by severity and colour only.
      const bySeverity = new Map<string, number>();
      const byColour = new Map<string, number>();
      for (const warning of sorted) {
        const severity = warning.severity ?? 'Unknown';
        bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);
        if (warning.colour) {
          byColour.set(warning.colour, (byColour.get(warning.colour) ?? 0) + 1);
        }
      }
      output += `**By severity:** ${[...bySeverity.entries()]
        .map(([severity, count]) => `${severity}: ${count}`)
        .join(' | ')}\n`;
      if (byColour.size > 0) {
        output += `**By colour:** ${[...byColour.entries()]
          .map(([colour, count]) => `${capitalize(colour)}: ${count}`)
          .join(' | ')}\n`;
      }
      output += `\n*Counts only at detail="summary". Use detail="standard" or detail="full" for the warnings themselves.*\n\n`;
    } else {
      const cap = detail === 'full' ? FULL_DISPLAY_CAP : STANDARD_DISPLAY_CAP;
      const shown = sorted.slice(0, cap);
      const remainder = sorted.slice(cap);

      for (const warning of shown) {
        const colourSuffix = warning.colour
          ? ` — ${capitalize(warning.colour)}${warning.severity ? ` (${warning.severity})` : ''}`
          : '';
        output += `${capSeverityEmoji(warning.severity)} **${warning.event ?? 'Weather warning'}**${colourSuffix}\n`;
        output += `---\n`;

        if (warning.headline) {
          output += `**Headline:** ${warning.headline}\n`;
        }
        output += `**Severity:** ${warning.severity ?? 'Unknown'} | **Urgency:** ${warning.urgency ?? 'Unknown'} | **Certainty:** ${warning.certainty ?? 'Unknown'}\n`;
        if (warning.areaDesc.length > 0) {
          output += `**Area:** ${warning.areaDesc.join('; ')}\n`;
        }
        // The issue time is always shown — a MeteoAlarm licence term.
        output += `**Issued:** ${formatPublishedTime(warning.sent) ?? 'not stated'}\n`;
        if (warning.onset) {
          output += `**Onset:** ${formatPublishedTime(warning.onset)}\n`;
        }
        if (warning.expires) {
          output += `**Expires:** ${formatPublishedTime(warning.expires)}\n`;
        }

        // CAP text renders verbatim (licence term): description at full only,
        // instruction at standard+full — the NOAA detail contract.
        if (detail === 'full' && warning.description) {
          output += `\n**Description:**\n${warning.description}\n`;
        }
        if (warning.instruction) {
          output += `\n**Instructions:**\n${warning.instruction}\n`;
        }
        if (warning.senderName) {
          output += `\n**Sender:** ${warning.senderName}\n`;
        }
        output += `\n`;
      }

      if (remainder.length > 0) {
        output += remainderNote(remainder);
      }
      if (detail !== 'full') {
        output += `*Showing standard detail. Use detail="full" for complete warning descriptions.*\n\n`;
      }
    }
  }

  const serviceSuffix = feed?.service ? ` (national warnings: ${feed.service})` : '';
  output += `---\n`;
  output += `*Data source: EUMETNET – MeteoAlarm${serviceSuffix}. Alerts shown unmodified as issued; times as published.*\n`;

  return prependLocationLine({
    content: [{ type: 'text', text: output }]
  }, resolved);
}

/** GeoMet alert_type display rank: warning > watch > advisory > statement. */
const GEOMET_TYPE_ORDER: Record<string, number> = {
  'warning': 0,
  'watch': 1,
  'advisory': 2,
  'statement': 3
};

function geoMetTypeRank(alertType: string | undefined): number {
  return GEOMET_TYPE_ORDER[(alertType ?? '').toLowerCase()] ?? 4;
}

function geoMetTypeEmoji(alertType: string | undefined): string {
  switch ((alertType ?? '').toLowerCase()) {
    case 'warning':
      return '🔶';
    case 'watch':
      return '🟡';
    case 'advisory':
      return '🔵';
    default:
      return '⚪';
  }
}

/**
 * MSC GeoMet (Canada) renderer — not CAP-shaped; renders what ECCC provides
 * and invents nothing (no severity/urgency/certainty lines). `alert_text_en`
 * renders verbatim — an ECCC licence term.
 */
async function handleGeoMetAlerts(
  resolved: ResolvedLocation,
  geoMetService: GeoMetService,
  active_only: boolean,
  detail: Detail
): Promise<HandlerResult> {
  const alerts = await geoMetService.getAlerts(resolved.latitude, resolved.longitude);

  let output = `# Weather Alerts — Canada\n\n`;
  output += `**Location:** ${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)}\n\n`;

  if (!active_only) {
    output += `*Note: historical alerts are not available for this region — showing current alerts only.*\n\n`;
  }

  if (alerts.length === 0) {
    output += `✅ **No active weather alerts for this area.**\n\n`;
  } else {
    output += `⚠️ **${alerts.length} active alert${alerts.length > 1 ? 's' : ''} found**\n\n`;

    // Sort by alert_type rank (warning > watch > advisory > statement), then recency.
    const sorted = [...alerts].sort((a, b) => {
      const byType = geoMetTypeRank(a.properties.alert_type) - geoMetTypeRank(b.properties.alert_type);
      if (byType !== 0) {
        return byType;
      }
      const aPublished = a.properties.publication_datetime
        ? new Date(a.properties.publication_datetime).getTime()
        : 0;
      const bPublished = b.properties.publication_datetime
        ? new Date(b.properties.publication_datetime).getTime()
        : 0;
      return bPublished - aPublished;
    });

    if (detail === 'summary') {
      const byType = new Map<string, number>();
      for (const alert of sorted) {
        const alertType = (alert.properties.alert_type ?? 'other').toLowerCase();
        byType.set(alertType, (byType.get(alertType) ?? 0) + 1);
      }
      output += `**By type:** ${[...byType.entries()]
        .map(([alertType, count]) => `${capitalize(alertType)}: ${count}`)
        .join(' | ')}\n`;
      output += `\n*Counts only at detail="summary". Use detail="standard" or detail="full" for the alerts themselves.*\n\n`;
    } else {
      const cap = detail === 'full' ? FULL_DISPLAY_CAP : STANDARD_DISPLAY_CAP;
      const shown = sorted.slice(0, cap);
      const remainder = sorted.length - shown.length;

      for (const alert of shown) {
        const props = alert.properties;
        const name = props.alert_name_en ?? props.alert_short_name_en ?? 'Weather alert';
        const typeSuffix = props.alert_type ? ` (${props.alert_type})` : '';
        output += `${geoMetTypeEmoji(props.alert_type)} **${name}**${typeSuffix}\n`;
        output += `---\n`;

        if (props.feature_name_en) {
          output += `**Area:** ${props.feature_name_en}${props.province ? `, ${props.province}` : ''}\n`;
        }
        const riskParts: string[] = [];
        if (props.risk_colour_en) {
          riskParts.push(`**Risk:** ${props.risk_colour_en}`);
        }
        if (props.confidence_en) {
          riskParts.push(`**Confidence:** ${props.confidence_en}`);
        }
        if (riskParts.length > 0) {
          output += `${riskParts.join(' | ')}\n`;
        }
        const timeParts: string[] = [];
        const issued = formatPublishedTime(props.publication_datetime);
        const ends = formatPublishedTime(props.event_end_datetime);
        if (issued) {
          timeParts.push(`**Issued:** ${issued}`);
        }
        if (ends) {
          timeParts.push(`**Ends:** ${ends}`);
        }
        if (timeParts.length > 0) {
          output += `${timeParts.join(' | ')}\n`;
        }

        // The alert body renders verbatim at standard and full (ECCC terms:
        // content unaltered).
        if (props.alert_text_en) {
          output += `\n${props.alert_text_en}\n`;
        }
        output += `\n`;
      }

      if (remainder > 0) {
        output += `*…and ${remainder} more alert${remainder > 1 ? 's' : ''}. Use detail="full" to see more.*\n\n`;
      }
    }
  }

  output += `---\n`;
  output += `*Data source: Environment and Climate Change Canada (MSC GeoMet). Alert content shown unaltered.*\n`;

  return prependLocationLine({
    content: [{ type: 'text', text: output }]
  }, resolved);
}

/**
 * The clean not-covered message (D1): names the region, states the current
 * coverage, and never surfaces a wrong-country upstream error. The one-line
 * note appears only when a real reverse lookup *failed* — an absent lookup
 * service falls back silently.
 */
function notCoveredResult(
  resolved: ResolvedLocation,
  countryCode: string | null,
  reverseLookupFailed: boolean
): HandlerResult {
  const region = countryCode ? regionDisplayName(countryCode) : 'this location';

  let output = `# Weather Alerts\n\n`;
  output += `**Location:** ${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)}\n\n`;
  output += `Weather alerts are not yet available for ${region}.\n\n`;
  output += `Current alert coverage: the United States (NOAA National Weather Service), `;
  output += `Canada (Environment and Climate Change Canada), and the European MeteoAlarm `;
  output += `member countries (matched at country level).\n`;

  if (reverseLookupFailed) {
    output += `\n*Note: the country lookup service was unavailable, so routing fell back to coordinate checks.*\n`;
  }

  return prependLocationLine({
    content: [{ type: 'text', text: output }]
  }, resolved);
}
