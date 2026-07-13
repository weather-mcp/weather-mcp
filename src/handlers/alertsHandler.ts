/**
 * Handler for get_alerts tool
 */

import { NOAAService } from '../services/noaa.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateOptionalBoolean, validateDetail } from '../utils/validation.js';
import { formatInTimezone, guessTimezoneFromCoords } from '../utils/timezone.js';

interface AlertsArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  active_only?: boolean;
  detail?: 'summary' | 'standard' | 'full';
}

export async function handleGetAlerts(
  args: unknown,
  noaaService: NOAAService,
  locationStore: LocationStore,
  geocodingService: GeocodingService
): Promise<{ content: Array<{ type: string; text: string }> }> {
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
