/**
 * Handler for get_alerts tool
 */

import { NOAAService } from '../services/noaa.js';
import { validateCoordinates, validateOptionalBoolean } from '../utils/validation.js';

interface AlertsArgs {
  latitude?: number;
  longitude?: number;
  active_only?: boolean;
}

export async function handleGetAlerts(
  args: unknown,
  noaaService: NOAAService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input parameters with runtime checks
  const { latitude, longitude } = validateCoordinates(args);
  const active_only = validateOptionalBoolean(
    (args as AlertsArgs)?.active_only,
    'active_only',
    true
  );

  // Get alerts data
  const alertsData = await noaaService.getAlerts(latitude, longitude, active_only);
  const alerts = alertsData.features;

  // Format the alerts for display
  let output = `# Weather Alerts\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Status:** ${active_only ? 'Active alerts only' : 'All alerts'}\n`;
  if (alertsData.updated) {
    output += `**Updated:** ${new Date(alertsData.updated).toLocaleString()}\n`;
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
      output += `**Effective:** ${new Date(props.effective).toLocaleString()}\n`;
      output += `**Expires:** ${new Date(props.expires).toLocaleString()}\n`;

      if (props.onset && props.onset !== props.effective) {
        output += `**Onset:** ${new Date(props.onset).toLocaleString()}\n`;
      }

      if (props.ends) {
        output += `**Ends:** ${new Date(props.ends).toLocaleString()}\n`;
      }

      output += `\n**Description:**\n${props.description}\n`;

      if (props.instruction) {
        output += `\n**Instructions:**\n${props.instruction}\n`;
      }

      output += `\n**Recommended Response:** ${props.response}\n`;
      output += `**Sender:** ${props.senderName}\n\n`;
    }
  }

  output += `---\n`;
  output += `*Data source: NOAA National Weather Service*\n`;

  return {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };
}
