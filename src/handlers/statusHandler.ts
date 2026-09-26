/**
 * Handler for check_service_status tool
 */

import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { CacheConfig } from '../config/cache.js';
import { formatNotCheckedLine } from '../utils/serviceStatusCoverage.js';
import type { ServiceProbeResult } from '../utils/serviceStatusProbe.js';

type ProbedService = 'NOAA' | 'Open-Meteo';

/** The HTTP status of a probe that answered; `no_response` never reaches here. */
function answeredStatus(result: ServiceProbeResult): number {
  if (result.httpStatus === undefined) {
    throw new Error(`Probe outcome ${result.outcome} carries no HTTP status`);
  }
  return result.httpStatus;
}

/** The per-service `**Status:**` label, read from the outcome alone. */
function statusLabel(result: ServiceProbeResult): string {
  switch (result.outcome) {
    case 'ok':
      return '✅ Answered normally';
    case 'rate_limited':
      return '⚠️ Rate limited (HTTP 429)';
    case 'http_error':
      return `❌ Error status (HTTP ${answeredStatus(result)})`;
    case 'no_response':
      return '❌ No response';
  }
}

/**
 * The Recommended Actions block for one service, or '' for a normal answer.
 * The upstream's contacts render only when it answered with an error; with no
 * HTTP response the block points at this machine's network instead.
 */
function recommendedActions(result: ServiceProbeResult, service: ProbedService): string {
  switch (result.outcome) {
    case 'ok':
      return '';
    case 'rate_limited':
      return (
        `**Recommended Actions:**\n` +
        `- Wait before retrying: the API answered, but it is rate limiting requests from this caller\n` +
        (service === 'NOAA'
          ? `- Check planned outages: https://weather-gov.github.io/api/planned-outages\n\n`
          : `- Check production status: https://open-meteo.com/en/docs/model-updates\n\n`)
      );
    case 'http_error':
      return service === 'NOAA'
        ? `**Recommended Actions:**\n` +
            `- Check planned outages: https://weather-gov.github.io/api/planned-outages\n` +
            `- View service notices: https://www.weather.gov/notification\n` +
            `- Report issues: nco.ops@noaa.gov or (301) 683-1518\n\n`
        : `**Recommended Actions:**\n` +
            `- Check production status: https://open-meteo.com/en/docs/model-updates\n` +
            `- View GitHub issues: https://github.com/open-meteo/open-meteo/issues\n` +
            `- Review documentation: https://open-meteo.com/en/docs\n\n`;
    case 'no_response':
      return (
        `**Recommended Actions:**\n` +
        `- No HTTP response reached this machine. Check its network first: connection, DNS, proxy and VPN settings\n` +
        `- Retry once the network is confirmed; the status page above is worth checking only after that\n\n`
      );
  }
}

/** What a service that did not answer normally did, for the verdict. A normal answer never needs one. */
function outcomePhrase(result: ServiceProbeResult): string {
  switch (result.outcome) {
    case 'ok':
      throw new Error('outcomePhrase called for a normal answer');
    case 'rate_limited':
      return 'answered HTTP 429 and is rate limiting this caller';
    case 'http_error':
      return `answered with HTTP ${answeredStatus(result)}`;
    case 'no_response':
      return 'gave no HTTP response';
  }
}

export async function handleCheckServiceStatus(
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService,
  serverVersion?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Probes run concurrently; neither rejects (each catches and returns a status object).
  const [noaaStatus, openMeteoStatus] = await Promise.all([
    noaaService.checkServiceStatus(),
    openMeteoService.checkServiceStatus(),
  ]);

  // Format the status report
  let output = `# Weather API Service Status\n\n`;
  output += `**Check Time:** ${new Date().toLocaleString()}\n\n`;

  // Server Version Information
  if (serverVersion) {
    output += `## Server Version\n\n`;
    output += `**Installed Version:** ${serverVersion}\n`;
    output += `**Latest Release:** https://github.com/weather-mcp/weather-mcp/releases/latest\n`;
    output += `**Changelog:** https://github.com/weather-mcp/weather-mcp/blob/main/CHANGELOG.md\n`;
    output += `**Upgrade Instructions:** See README.md "Upgrading to Latest Version" section\n\n`;
    output += `*Tip: Use \`npx -y @dangahagan/weather-mcp@latest\` in your MCP config to always run the newest version.*\n\n`;
  }

  // NOAA Status
  output += `## NOAA Weather API (Forecasts & Current Conditions)\n\n`;
  output += `**Status:** ${statusLabel(noaaStatus)}\n`;
  output += `**Message:** ${noaaStatus.message}\n`;
  output += `**Status Page:** ${noaaStatus.statusPage}\n`;
  output += `**Coverage:** United States locations only\n\n`;

  output += recommendedActions(noaaStatus, 'NOAA');

  // Open-Meteo Status
  output += `## Open-Meteo API (Historical Weather Data)\n\n`;
  output += `**Status:** ${statusLabel(openMeteoStatus)}\n`;
  output += `**Message:** ${openMeteoStatus.message}\n`;
  output += `**Status Page:** ${openMeteoStatus.statusPage}\n`;
  output += `**Coverage:** Global (worldwide locations)\n\n`;

  output += recommendedActions(openMeteoStatus, 'Open-Meteo');

  // Cache Statistics
  if (CacheConfig.enabled) {
    output += `## Cache Statistics\n\n`;

    const noaaStats = noaaService.getCacheStats();
    const openMeteoStats = openMeteoService.getCacheStats();
    const totalHits = noaaStats.hits + openMeteoStats.hits;
    const totalMisses = noaaStats.misses + openMeteoStats.misses;
    const totalRequests = totalHits + totalMisses;
    const overallHitRate = totalRequests > 0 ? ((totalHits / totalRequests) * 100).toFixed(1) : '0.0';

    output += `**Cache Status:** ✅ Enabled\n`;
    output += `**Overall Hit Rate:** ${overallHitRate}%\n`;
    output += `**Total Cache Hits:** ${totalHits}\n`;
    output += `**Total Cache Misses:** ${totalMisses}\n`;
    output += `**Total Requests:** ${totalRequests}\n\n`;

    const noaaHitRate = (noaaStats.hits + noaaStats.misses) > 0
      ? ((noaaStats.hits / (noaaStats.hits + noaaStats.misses)) * 100).toFixed(1)
      : '0.0';
    const openMeteoHitRate = (openMeteoStats.hits + openMeteoStats.misses) > 0
      ? ((openMeteoStats.hits / (openMeteoStats.hits + openMeteoStats.misses)) * 100).toFixed(1)
      : '0.0';

    output += `### NOAA Service Cache\n`;
    output += `- Entries: ${noaaStats.size} / ${noaaStats.maxSize}\n`;
    output += `- Hit Rate: ${noaaHitRate}%\n`;
    output += `- Hits: ${noaaStats.hits}\n`;
    output += `- Misses: ${noaaStats.misses}\n`;
    output += `- Evictions: ${noaaStats.evictions}\n\n`;

    output += `### Open-Meteo Service Cache\n`;
    output += `- Entries: ${openMeteoStats.size} / ${openMeteoStats.maxSize}\n`;
    output += `- Hit Rate: ${openMeteoHitRate}%\n`;
    output += `- Hits: ${openMeteoStats.hits}\n`;
    output += `- Misses: ${openMeteoStats.misses}\n`;
    output += `- Evictions: ${openMeteoStats.evictions}\n\n`;

    output += `*Cache reduces API calls and improves performance for repeated queries.*\n\n`;
  } else {
    output += `## Cache Statistics\n\n`;
    output += `**Cache Status:** ❌ Disabled\n`;
    output += `*Set CACHE_ENABLED=true in environment to enable caching.*\n\n`;
  }

  // Overall status summary
  const bothOperational = noaaStatus.operational && openMeteoStatus.operational;
  const neitherOperational = !noaaStatus.operational && !openMeteoStatus.operational;

  if (bothOperational) {
    output += `## Overall Status: ✅ NOAA and Open-Meteo Reachable\n\n`;
    output += `Both checked services answered. This confirms they are reachable; it does not confirm that every request will succeed.\n`;
  } else if (neitherOperational) {
    if (noaaStatus.outcome === 'no_response' && openMeteoStatus.outcome === 'no_response') {
      // Two independent hosts failing at the transport layer at once: the likelier cause is shared, and local
      output += `## Overall Status: ❌ Neither Service Answered\n\n`;
      output += `Neither NOAA nor Open-Meteo returned an HTTP response. Two independent hosts failing at once points at this machine or its network path, not at the APIs: check the connection, DNS, proxy and VPN settings first, then retry.\n`;
    } else {
      output += `## Overall Status: ❌ Neither Service Answered Normally\n\n`;
      output += `NOAA API ${outcomePhrase(noaaStatus)}. Open-Meteo API ${outcomePhrase(openMeteoStatus)}. See each service's section above for what to check.\n`;
    }
  } else {
    output += `## Overall Status: ⚠️ One Service Answered Normally\n\n`;
    if (noaaStatus.operational) {
      output += `NOAA API answered, so it is reachable. This does not confirm that US forecasts and current conditions will succeed.\n`;
      output += `Open-Meteo API ${outcomePhrase(openMeteoStatus)}: Historical weather data may be unavailable.\n`;
    } else {
      output += `Open-Meteo API answered, so it is reachable. This does not confirm that historical weather requests will succeed.\n`;
      output += `NOAA API ${outcomePhrase(noaaStatus)}: Forecasts and current conditions for US locations may be unavailable.\n`;
    }
  }

  output += `\n${formatNotCheckedLine()}`;

  return {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };
}
