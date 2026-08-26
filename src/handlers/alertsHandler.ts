/**
 * Handler for get_alerts tool.
 *
 * Routed by country (see .devdocs/archive/completed/international-alerts-plan.md D1):
 *   US → NOAA (the original path, byte-identical output),
 *   Canada → MSC GeoMet (Environment and Climate Change Canada),
 *   MeteoAlarm member countries → the country's MeteoAlarm feed,
 *   Philippines / Indonesia → their national CAP feeds (PAGASA, BMKG), matched
 *     to the requested point by the alert's own polygon; India → NDMA SACHET,
 *     listed at country level, because SACHET serves geometry from a separate
 *     endpoint that returns 403 to server-side clients
 *     (see .devdocs/archive/completed/plan-national-cap-alerts.md D1),
 *   elsewhere → the optional keyed Google Weather API fallback when a
 *     `GOOGLE_WEATHER_API_KEY` is configured, else a clean not-covered
 *     message (see .devdocs/archive/completed/global-alerts-fallback-plan.md D1).
 *
 * The branch order is the invariant: a US, Canadian, MeteoAlarm-country, or
 * national-CAP-country request never contacts Google, key or no key — those
 * are jurisdictional authorities and stay first-choice. Without a key the
 * elsewhere branch is byte-identical to before the fallback existed.
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
import { GoogleWeatherService } from '../services/googleWeather.js';
import {
  NationalCapService,
  NATIONAL_CAP_FEEDS,
  isNationalCapCountry
} from '../services/nationalCap.js';
import type { GoogleWeatherAlert } from '../types/googleWeather.js';
import type { NationalCapWarning } from '../types/cap.js';
import { pointInAnyRing } from '../utils/pointInPolygon.js';
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
  nominatimService?: NominatimService,
  googleWeatherService?: GoogleWeatherService,
  nationalCapService?: NationalCapService
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

  // 3b. National CAP feeds (India, the Philippines, Indonesia): keyless
  //     jurisdictional authorities, so they sit ahead of Google exactly as
  //     NOAA/ECCC/MeteoAlarm do. Unlike Europe these carry polygon geometry,
  //     so warnings are matched to the requested point.
  if (countryCode && isNationalCapCountry(countryCode) && nationalCapService) {
    return handleNationalCapAlerts(resolved, nationalCapService, countryCode, active_only, detail);
  }

  // 4. Elsewhere (D1): the optional keyed Google Weather API fallback. No
  //    client-side country allowlist — Google answers the coverage question
  //    per request, and a hardcoded list would drift and mis-gate border
  //    regions. Reaching this line already proves the point is not US,
  //    Canadian, or MeteoAlarm-covered.
  if (googleWeatherService && googleWeatherService.isKeyAvailable()) {
    return handleGoogleAlerts(
      resolved,
      googleWeatherService,
      countryCode,
      active_only,
      detail,
      reverseLookupFailed
    );
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

/**
 * "…and N more warnings, mostly Minor" remainder line for capped lists.
 * Typed on the only field it reads so every CAP-shaped renderer can share it.
 * `detail` is required rather than defaulted so a renderer that forgets it is a
 * compile error: at detail="full" the cap cannot be raised any further, so the
 * "use detail=full" hint would tell the reader to do what they have already done.
 */
function remainderNote(
  remainder: Array<{ severity?: string }>,
  noun: string,
  detail: Detail
): string {
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
  const hint = detail !== 'full' ? ` Use detail="full" to see more.` : '';
  return `*…and ${remainder.length} more ${noun}${plural}, mostly ${top}.${hint}*\n\n`;
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
        output += remainderNote(remainder, 'warning', detail);
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

/**
 * National CAP renderer (India, the Philippines, Indonesia) — the fifth
 * CAP-shaped renderer, built from the same helpers as the MeteoAlarm and
 * Google ones rather than forking them.
 *
 * What is different here: these feeds publish **polygon geometry**, so
 * warnings are split into those whose rings contain the requested point and
 * those with no usable geometry at all. A warning whose rings exclude the
 * point is for somewhere else and is not shown; a warning with no rings is
 * never dropped — it falls back to a country-level block carrying the same
 * caveat Europe gets, because dropping it would be a fabricated all-clear.
 *
 * Failures propagate (contract, D9): `getWarnings` is deliberately not
 * wrapped in a try/catch. A ✅ produced by a failed fetch is a dangerous lie
 * on safety data.
 */
async function handleNationalCapAlerts(
  resolved: ResolvedLocation,
  nationalCapService: NationalCapService,
  countryCode: string,
  active_only: boolean,
  detail: Detail
): Promise<HandlerResult> {
  const feed = NATIONAL_CAP_FEEDS[countryCode];
  const countryName = feed?.name ?? regionDisplayName(countryCode);
  // Prose needs the article ("in the Philippines"); the header does not.
  const countryPhrase = withArticle(countryName);
  const publisher = feed?.publisher ?? countryName;

  const { warnings, unavailableCount, indexTrimmed } =
    await nationalCapService.getWarnings(countryCode);

  // Split by geometry, in the one order that is safe on safety data:
  //   1. inside a published ring        -> matched, however partial the set;
  //   2. no usable/complete geometry    -> country-level, with the caveat;
  //   3. outside a *complete* ring set  -> genuinely elsewhere, not shown.
  //
  // Only a ring set that parsed in full may answer "this does not cover you".
  // `polygonUnavailable` marks a set that lost rings (unparseable siblings, a
  // failed linked fetch, or the ring cap), and such a warning falls to the
  // country-level block rather than being dropped — dropping it would be a
  // fabricated all-clear for a point the publisher may well have drawn inside.
  const matched: NationalCapWarning[] = [];
  const countryLevel: NationalCapWarning[] = [];
  for (const warning of warnings) {
    if (
      warning.polygons.length > 0 &&
      pointInAnyRing(resolved.latitude, resolved.longitude, warning.polygons)
    ) {
      matched.push(warning);
    } else if (warning.polygonUnavailable || warning.polygons.length === 0) {
      countryLevel.push(warning);
    }
  }

  const bySeverityThenExpiry = (a: NationalCapWarning, b: NationalCapWarning): number => {
    const bySeverity = capSeverityRank(a.severity) - capSeverityRank(b.severity);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const aExpires = a.expires ? new Date(a.expires).getTime() : Infinity;
    const bExpires = b.expires ? new Date(b.expires).getTime() : Infinity;
    return aExpires - bExpires;
  };
  matched.sort(bySeverityThenExpiry);
  countryLevel.sort(bySeverityThenExpiry);

  let output = `# Weather Alerts — ${countryName}\n\n`;
  output += `**Location:** ${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)}\n\n`;

  if (!active_only) {
    output += `*Note: historical alerts are not available for this region — showing current warnings only.*\n\n`;
  }

  if (indexTrimmed) {
    output += `*Note: the ${publisher} feed listed more than 200 alerts; only the first 200 were checked.*\n\n`;
  }
  if (unavailableCount > 0) {
    output += `⚠️ *${unavailableCount} alert${unavailableCount > 1 ? 's' : ''} in the ${publisher} feed `;
    output += `could not be loaded and ${unavailableCount > 1 ? 'are' : 'is'} not shown — this is not an all-clear for those alerts.*\n\n`;
  }

  if (warnings.length === 0 && unavailableCount > 0) {
    // Nothing loaded at all. A ✅ here would be a green check contradicted by
    // the caveat directly above it, so there is deliberately no ✅.
    output += `ℹ️ **The ${publisher} alert list could not be loaded for your location.**\n\n`;
  } else if (matched.length === 0 && countryLevel.length === 0 && unavailableCount > 0) {
    // A *partial* load with nothing covering this point. The alerts that
    // could not be read have unknown areas, so a green check would claim an
    // all-clear the feed never supported — the same contradiction the
    // nothing-loaded branch above avoids, one threshold further along.
    output += `ℹ️ **No alert covering your location among those that could be read.**\n\n`;
    output += `*Checked against ${publisher}'s public CAP feed — ${warnings.length} active warning${warnings.length > 1 ? 's' : ''} elsewhere in ${countryPhrase}. `;
    output += `The ${unavailableCount} alert${unavailableCount > 1 ? 's' : ''} above could not be read, so this is not a full all-clear.*\n\n`;
  } else if (matched.length === 0 && countryLevel.length === 0) {
    // Honest empty: the whole feed was read, nothing covers this point. The
    // scope line says what was actually checked.
    output += `✅ **No active weather alerts for your location in ${countryPhrase}.**\n\n`;
    output += warnings.length > 0
      ? `*Checked against ${publisher}'s public CAP feed — ${warnings.length} active warning${warnings.length > 1 ? 's' : ''} elsewhere in ${countryPhrase}, none covering this point.*\n\n`
      : `*Checked against ${publisher}'s public CAP feed — no active warnings nationwide.*\n\n`;
  } else {
    if (matched.length > 0) {
      output += `⚠️ **${matched.length} active warning${matched.length > 1 ? 's' : ''} matched to your location**\n\n`;
    }

    if (detail === 'summary') {
      output += renderNationalCapCounts('Matched to your location', matched);
      output += renderNationalCapCounts('Country-level (no usable geometry)', countryLevel);
      output += `\n*Counts only at detail="summary". Use detail="standard" or detail="full" for the warnings themselves.*\n\n`;
    } else {
      // The display cap is combined across both blocks, so a long
      // country-level list cannot push the matched warnings off the page.
      const cap = detail === 'full' ? FULL_DISPLAY_CAP : STANDARD_DISPLAY_CAP;
      const shownMatched = matched.slice(0, cap);
      const countryLevelBudget = Math.max(0, cap - shownMatched.length);
      const shownCountryLevel = countryLevel.slice(0, countryLevelBudget);
      const remainder = [
        ...matched.slice(shownMatched.length),
        ...countryLevel.slice(shownCountryLevel.length)
      ];

      for (const warning of shownMatched) {
        output += renderNationalCapWarning(warning, detail);
      }

      // The count is computed from the block itself, never from the service's
      // total, so this line can never disagree with the warnings printed
      // beneath it. The country-level *block* is the whole `countryLevel` set —
      // the alerts the display cap pushed into the remainder are part of the
      // block this sentence describes, not separate from it. Computing over
      // `shownCountryLevel` made the number change with `detail` and contradict
      // the remainder line beneath it.
      const lostGeometry = countryLevel.filter(warning => warning.polygonUnavailable).length;

      if (shownCountryLevel.length > 0) {
        if (lostGeometry > 0) {
          // "treated as", not "listed at": the claim is about how the alert was
          // routed — country-level rather than matched — and stays true for the
          // ones the display cap pushed into the remainder, which are counted
          // here but printed nowhere on this page.
          output += `*Area geometry for ${lostGeometry} alert${lostGeometry > 1 ? 's' : ''} could not be loaded or parsed, `;
          output += `so ${lostGeometry > 1 ? 'they are' : 'it is'} treated as country-level rather than matched to your point.*\n\n`;
        }
        output += `**Country-level warnings** — *matched at country level (no usable area geometry for these alerts) — they may not affect your exact location:*\n\n`;
        for (const warning of shownCountryLevel) {
          output += renderNationalCapWarning(warning, detail);
        }
      } else if (countryLevel.length > 0) {
        // The matched block consumed the whole display cap, so the
        // country-level block never renders. Its alerts are still counted in
        // the remainder note below, but without this line the fact that they
        // have no usable geometry would vanish silently.
        if (lostGeometry > 0) {
          output += `*${lostGeometry} further alert${lostGeometry > 1 ? 's' : ''} had no usable area geometry `;
          output += `and ${lostGeometry > 1 ? 'are' : 'is'} counted in the remainder below rather than matched to your point.*\n\n`;
        }
      }

      if (remainder.length > 0) {
        output += remainderNote(remainder, 'warning', detail);
      }
      if (detail !== 'full') {
        output += `*Showing standard detail. Use detail="full" for complete warning descriptions.*\n\n`;
      }
    }
  }

  output += `---\n`;
  output += `*Data source: ${feed?.attribution ?? publisher}; alerts shown unmodified as issued, times as published.*\n`;

  return prependLocationLine({
    content: [{ type: 'text', text: output }]
  }, resolved);
}

/**
 * Country names that read naturally only with a definite article, so prose
 * says "in the Philippines" rather than "in Philippines". The block headers
 * keep the bare name, which is correct in title position.
 */
const COUNTRY_NAMES_NEEDING_ARTICLE = new Set([
  'Philippines',
  'Netherlands',
  'United States',
  'United Kingdom',
  'Czech Republic'
]);

function withArticle(countryName: string): string {
  return COUNTRY_NAMES_NEEDING_ARTICLE.has(countryName) ? `the ${countryName}` : countryName;
}

/** Severity counts for one national-CAP block at detail="summary". */
function renderNationalCapCounts(label: string, warnings: NationalCapWarning[]): string {
  if (warnings.length === 0) {
    return '';
  }
  const bySeverity = new Map<string, number>();
  for (const warning of warnings) {
    const severity = warning.severity ?? 'Unknown';
    bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);
  }
  return `**${label}:** ${[...bySeverity.entries()]
    .map(([severity, count]) => `${severity}: ${count}`)
    .join(' | ')}\n`;
}

/** One national-CAP warning block, shared by the matched and country-level lists. */
function renderNationalCapWarning(warning: NationalCapWarning, detail: Detail): string {
  let output = `${capSeverityEmoji(warning.severity)} **${warning.event ?? warning.headline ?? 'Weather warning'}**\n`;
  output += `---\n`;

  if (warning.headline && warning.headline !== warning.event) {
    output += `**Headline:** ${warning.headline}\n`;
  }
  // Publishers that omit all three CAP fields would otherwise render
  // "Unknown | Unknown | Unknown", which is noise (the Google precedent).
  if (warning.severity || warning.urgency || warning.certainty) {
    output += `**Severity:** ${warning.severity ?? 'Unknown'} | **Urgency:** ${warning.urgency ?? 'Unknown'} | **Certainty:** ${warning.certainty ?? 'Unknown'}\n`;
  }
  if (warning.areaDesc.length > 0) {
    output += `**Area:** ${warning.areaDesc.join('; ')}\n`;
  }
  output += `**Issued:** ${formatPublishedTime(warning.sent) ?? 'not stated'}\n`;
  if (warning.onset) {
    output += `**Onset:** ${formatPublishedTime(warning.onset)}\n`;
  }
  if (warning.effective && warning.effective !== warning.onset) {
    output += `**Effective:** ${formatPublishedTime(warning.effective)}\n`;
  }
  if (warning.expires) {
    output += `**Expires:** ${formatPublishedTime(warning.expires)}\n`;
  }

  // CAP text renders verbatim: description at full only, instruction at
  // standard and full — the NOAA detail contract.
  if (detail === 'full' && warning.description) {
    output += `\n**Description:**\n${warning.description}\n`;
  }
  if (warning.instruction) {
    output += `\n**Instructions:**\n${warning.instruction}\n`;
  }
  if (detail === 'full' && warning.web) {
    output += `\n**More info:** ${warning.web}\n`;
  }
  if (warning.senderName) {
    output += `\n**Sender:** ${warning.senderName}\n`;
  }
  return output + `\n`;
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
        const hint = detail !== 'full' ? ` Use detail="full" to see more.` : '';
        output += `*…and ${remainder} more alert${remainder > 1 ? 's' : ''}.${hint}*\n\n`;
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
 * Coverage caveat shown on **both** empty and non-empty Google results (D5/D6).
 * One constant serves both so the two paths cannot drift apart, and it does
 * double duty: it explains why an alert may not match the exact point, and why
 * an empty answer is "none found" rather than a guarantee of coverage.
 */
const GOOGLE_COVERAGE_CAVEAT =
  `*Coverage note: Google aggregates official national alert feeds across ~45+ territories and ` +
  `matches them by provider polygon, so country and region coverage alignment may not be exact — ` +
  `warnings may not correspond to your exact point, and an empty result means no alerts were ` +
  `found rather than a guarantee that this location is covered.*\n\n`;

/**
 * Coverage caveat for the uncovered-region answer (HTTP 404). The shared
 * caveat above is written for a location Google *does* serve, and its closing
 * clause ("an empty result means no alerts were found") would be actively
 * misleading here — nothing was searched at all.
 */
const GOOGLE_UNCOVERED_CAVEAT =
  `*Coverage note: Google aggregates official national alert feeds across ~45+ territories, ` +
  `and this location falls outside that aggregation. Alerts for this area may still be ` +
  `published directly by the responsible national weather service.*\n\n`;

/**
 * Google Weather API footer. The final sentence is the **exact mandatory
 * attribution string** required by the Weather API policies — do not reword it
 * (layer 1 of the two-layer attribution; layer 2 is the per-alert `dataSource`
 * line rendered above).
 */
const GOOGLE_FOOTER =
  `---\n` +
  `*Data source: official national weather services, aggregated by the Google Weather API. ` +
  `Alert text is shown in its source language, as issued. ` +
  `Source: Includes weather data from Google*\n`;

/**
 * `alertTitle` is documented as an object but its exact shape is a live
 * to-verify (design upstream (g)), so both a plain string and a `{ text }`
 * object are accepted. Anything else falls through to the caller's fallback.
 */
function googleAlertTitle(alert: GoogleWeatherAlert): string {
  const title = alert.alertTitle;
  if (typeof title === 'string' && title.trim().length > 0) {
    return title;
  }
  if (title && typeof title === 'object' && typeof title.text === 'string' && title.text.trim().length > 0) {
    return title.text;
  }
  return humanizeEventType(alert.eventType) ?? 'Weather alert';
}

/**
 * Google publishes CAP-family enums in SCREAMING_CASE (`"MINOR"`,
 * `"EXPECTED"`, `"POSSIBLE"`) — **live-verified 2026-08-18**, and contrary to
 * the design's assumption that "Google's severity enum is exactly NOAA's".
 * It is the same vocabulary in different casing, so it is normalized to the
 * project's title-case form once, here, before it reaches `capSeverityRank`
 * or `capSeverityEmoji` — which would otherwise rank every alert `Unknown`
 * and mark every one ⚪.
 */
function capEnumValue(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  const cleaned = value.trim().toLowerCase().replace(/_/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** `FLASH_FLOOD` → `Flash Flood`. Returns undefined for an absent/blank enum value. */
function humanizeEventType(eventType: string | undefined): string | undefined {
  if (!eventType || eventType.trim().length === 0) {
    return undefined;
  }
  return eventType
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(part => part.length > 0)
    .map(capitalize)
    .join(' ');
}

/**
 * Parse Google's `timezoneOffset` into minutes east of UTC.
 *
 * **Live-verified 2026-08-18:** it is a protobuf *Duration in seconds*
 * (`"28800s"` for UTC+08:00), not the `±HH:MM` the design plan assumed. The
 * `±HH:MM` form is still accepted defensively, since misreading an offset
 * silently shifts a safety-critical expiry time rather than failing loudly.
 */
function parseTimezoneOffsetMinutes(timezoneOffset: string | undefined): number | undefined {
  if (!timezoneOffset) {
    return undefined;
  }
  const raw = timezoneOffset.trim();

  const secondsMatch = /^(-?\d+)s$/.exec(raw);
  if (secondsMatch) {
    return Number(secondsMatch[1]) / 60;
  }

  const hhmmMatch = /^([+-])(\d{2}):?(\d{2})$/.exec(raw);
  if (hhmmMatch) {
    const [, sign, hours, minutes] = hhmmMatch;
    return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
  }

  return undefined;
}

/**
 * Render a UTC instant in the alert's own timezone offset — the "times as
 * issued" doctrine applied to a source that publishes the instant and the
 * offset in separate fields. Falls back to `formatPublishedTime` (which
 * renders the instant as published) when the offset is absent or unparseable.
 * Deliberately does all arithmetic in UTC so the rendered string never depends
 * on the server's own timezone.
 */
function formatGoogleAlertTime(
  iso: string | undefined | null,
  timezoneOffset: string | undefined
): string | undefined {
  if (!iso) {
    return undefined;
  }

  const offsetMinutes = parseTimezoneOffsetMinutes(timezoneOffset);
  const instant = Date.parse(iso);
  if (offsetMinutes === undefined || Number.isNaN(instant)) {
    return formatPublishedTime(iso);
  }

  const shifted = new Date(instant + offsetMinutes * 60_000);
  const pad = (value: number): string => String(value).padStart(2, '0');

  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const label = `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;

  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  const time = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  return `${date} ${time} (${label})`;
}

/**
 * Google Weather API renderer (D5) — the fourth CAP-shaped renderer, kept
 * deliberately close to the MeteoAlarm one and reusing the same severity rank,
 * emoji, display caps, and remainder note (Google's severity enum is exactly
 * NOAA's).
 *
 * **Failure posture is contract, not garnish (D6):** alerts *are* this tool's
 * whole answer, so nothing here catches a service error. A rejected key, a
 * timeout, a 429, or a network failure propagates with the service's fixed
 * sanitized message, exactly as a GeoMet or MeteoAlarm failure surfaces today.
 * A silent "✅ no alerts" produced by a failed fetch would be a dangerous lie
 * on safety data.
 */
async function handleGoogleAlerts(
  resolved: ResolvedLocation,
  googleWeatherService: GoogleWeatherService,
  countryCode: string | null,
  active_only: boolean,
  detail: Detail,
  reverseLookupFailed: boolean
): Promise<HandlerResult> {
  const { alerts, covered } = await googleWeatherService.getPublicAlerts(
    resolved.latitude,
    resolved.longitude
  );

  const regionName = countryCode ? regionDisplayName(countryCode) : null;

  let output = regionName ? `# Weather Alerts — ${regionName}\n\n` : `# Weather Alerts\n\n`;
  output += `**Location:** ${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)}\n\n`;

  if (reverseLookupFailed) {
    output += `*Note: the country lookup service was unavailable, so routing fell back to coordinate checks.*\n\n`;
  }

  if (!active_only) {
    output += `*Note: historical alerts are not available for this region — showing current alerts only.*\n\n`;
  }

  if (alerts.length === 0 && !covered) {
    // Google answered "I do not cover this place" (HTTP 404). Nothing was
    // checked, so there is nothing to be reassured by: no ✅, and the text
    // says out loud that this is not an all-clear. The premise behind the
    // original single message — that Google returns the same shape for
    // "quiet" and "uncovered" — was falsified by live testing.
    output += `ℹ️ **No alert coverage for this location.**\n\n`;
    output += `The Google Weather API does not cover this area, so **this is not an all-clear** — `;
    output += `no check for active weather could be made here. A national or local weather service `;
    output += `may still be issuing warnings.\n\n`;
  } else if (alerts.length === 0) {
    // Honest empty (D6): a covered region with nothing active. The message
    // still credits the source rather than claiming a bare all-clear — the
    // FIRMS empty-result framing.
    output += `✅ **No active weather alerts found for this location via the Google Weather API.**\n\n`;
  } else {
    output += `⚠️ **${alerts.length} active alert${alerts.length > 1 ? 's' : ''} found**\n\n`;

    // Sort by CAP severity (the NOAA Extreme→Unknown order), then by expiry.
    const sorted = [...alerts].sort((a, b) => {
      const bySeverity = capSeverityRank(capEnumValue(a.severity)) - capSeverityRank(capEnumValue(b.severity));
      if (bySeverity !== 0) {
        return bySeverity;
      }
      const aExpires = a.expirationTime ? new Date(a.expirationTime).getTime() : Infinity;
      const bExpires = b.expirationTime ? new Date(b.expirationTime).getTime() : Infinity;
      return aExpires - bExpires;
    });

    if (detail === 'summary') {
      const bySeverity = new Map<string, number>();
      const byEvent = new Map<string, number>();
      for (const alert of sorted) {
        const severity = capEnumValue(alert.severity) ?? 'Unknown';
        bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);
        const event = humanizeEventType(alert.eventType);
        if (event) {
          byEvent.set(event, (byEvent.get(event) ?? 0) + 1);
        }
      }
      output += `**By severity:** ${[...bySeverity.entries()]
        .map(([severity, count]) => `${severity}: ${count}`)
        .join(' | ')}\n`;
      if (byEvent.size > 0) {
        output += `**By type:** ${[...byEvent.entries()]
          .map(([event, count]) => `${event}: ${count}`)
          .join(' | ')}\n`;
      }
      output += `\n*Counts only at detail="summary". Use detail="standard" or detail="full" for the alerts themselves.*\n\n`;
    } else {
      const cap = detail === 'full' ? FULL_DISPLAY_CAP : STANDARD_DISPLAY_CAP;
      const shown = sorted.slice(0, cap);
      const remainder = sorted.slice(cap);

      for (const alert of shown) {
        // The event-type suffix renders only when it says something the title
        // does not already say — publishers routinely title an alert
        // "Severe Thunderstorm Warning", and "(Severe Thunderstorm)" beside it
        // is noise. (Found by reading real rendered output, not a failing test.)
        const title = googleAlertTitle(alert);
        const event = humanizeEventType(alert.eventType);
        const eventSuffix =
          event && !title.toLowerCase().includes(event.toLowerCase()) ? ` (${event})` : '';
        const severity = capEnumValue(alert.severity);
        const urgency = capEnumValue(alert.urgency);
        const certainty = capEnumValue(alert.certainty);

        output += `${capSeverityEmoji(severity)} **${title}**${eventSuffix}\n`;
        output += `---\n`;

        // Live sampling found publishers that omit all three CAP fields; a line
        // reading "Unknown | Unknown | Unknown" is noise, so it renders only
        // when at least one is actually supplied.
        if (severity || urgency || certainty) {
          output += `**Severity:** ${severity ?? 'Unknown'} | **Urgency:** ${urgency ?? 'Unknown'} | **Certainty:** ${certainty ?? 'Unknown'}\n`;
        }
        if (alert.areaName) {
          output += `**Area:** ${alert.areaName}\n`;
        }

        // Times render in the alert's own offset; a null expirationTime
        // (documented as possible) simply omits its line.
        const effective = formatGoogleAlertTime(alert.startTime, alert.timezoneOffset);
        const expires = formatGoogleAlertTime(alert.expirationTime, alert.timezoneOffset);
        if (effective) {
          output += `**Effective:** ${effective}\n`;
        }
        if (expires) {
          output += `**Expires:** ${expires}\n`;
        }

        // Source text renders verbatim, in the publisher's language: the full
        // description at full only, instructions at standard+full, safety
        // recommendations at full — the NOAA detail contract.
        if (detail === 'full' && alert.description) {
          output += `\n**Description:**\n${alert.description}\n`;
        }
        if (alert.instruction && alert.instruction.length > 0) {
          output += `\n**Instructions:**\n${alert.instruction.map(line => `- ${line}`).join('\n')}\n`;
        }
        // Live-verified as objects (`{ directive, subtext }`), not strings.
        // The subtext is the publisher's own expansion of the directive, so it
        // renders alongside rather than being dropped.
        if (detail === 'full' && alert.safetyRecommendations && alert.safetyRecommendations.length > 0) {
          const recommendations = alert.safetyRecommendations
            .map(item => {
              const directive = item?.directive?.trim();
              const subtext = item?.subtext?.trim();
              if (!directive && !subtext) {
                return undefined;
              }
              if (directive && subtext) {
                return `- ${directive} ${subtext}`;
              }
              return `- ${directive ?? subtext}`;
            })
            .filter((line): line is string => line !== undefined);
          if (recommendations.length > 0) {
            output += `\n**Safety recommendations:**\n${recommendations.join('\n')}\n`;
          }
        }

        // Layer 2 of the mandatory attribution (upstream (d)): the original
        // publisher of this alert, with its authority URI.
        // Live-verified shape: `{ publisher, name, authorityUri }` — there is no
        // `fullName`. `name` is the human-readable short form ("PAGASA");
        // `publisher` is the enum form, used only as a fallback.
        const publisher = alert.dataSource?.name ?? alert.dataSource?.publisher;
        if (publisher) {
          const uri = alert.dataSource?.authorityUri ? ` (${alert.dataSource.authorityUri})` : '';
          output += `\n**Source:** ${publisher}${uri}\n`;
        }
        output += `\n`;
      }

      if (remainder.length > 0) {
        // Normalized here too, so the remainder line reads "mostly Minor"
        // rather than echoing Google's raw "MINOR".
        output += remainderNote(
          remainder.map(alert => ({ severity: capEnumValue(alert.severity) })),
          'alert',
          detail
        );
      }
      if (detail !== 'full') {
        output += `*Showing standard detail. Use detail="full" for complete alert descriptions.*\n\n`;
      }
    }
  }

  output += covered ? GOOGLE_COVERAGE_CAVEAT : GOOGLE_UNCOVERED_CAVEAT;
  output += GOOGLE_FOOTER;

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
  output += `Canada (Environment and Climate Change Canada), the European MeteoAlarm `;
  output += `member countries (matched at country level), and — via their national CAP feeds — `;
  output += `the Philippines (PAGASA) and Indonesia (BMKG), matched by alert polygon, and `;
  output += `India (NDMA SACHET), matched at country level.\n`;

  if (reverseLookupFailed) {
    output += `\n*Note: the country lookup service was unavailable, so routing fell back to coordinate checks.*\n`;
  }

  return prependLocationLine({
    content: [{ type: 'text', text: output }]
  }, resolved);
}
