/**
 * Handler for check_service_status tool
 */

import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { CacheConfig } from '../config/cache.js';

export async function handleCheckServiceStatus(
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService,
  serverVersion?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Check status of both services
  const noaaStatus = await noaaService.checkServiceStatus();
  const openMeteoStatus = await openMeteoService.checkServiceStatus();

  // Format the status report
  let output = `# Weather API Service Status\n\n`;
  output += `**Check Time:** ${new Date().toLocaleString()}\n\n`;

  // Server Version Information
  if (serverVersion) {
    output += `## Server Version\n\n`;
    output += `**Installed Version:** ${serverVersion}\n`;
    output += `**Latest Release:** https://github.com/weather-mcp/mcp-server/releases/latest\n`;
    output += `**Changelog:** https://github.com/weather-mcp/mcp-server/blob/main/CHANGELOG.md\n`;
    output += `**Upgrade Instructions:** See README.md "Upgrading to Latest Version" section\n\n`;
    output += `*Tip: Use \`npx -y @dangahagan/weather-mcp@latest\` in your MCP config to always run the newest version.*\n\n`;
  }

  // NOAA Status
  output += `## NOAA Weather API (Forecasts & Current Conditions)\n\n`;
  output += `**Status:** ${noaaStatus.operational ? '✅ Operational' : '❌ Issues Detected'}\n`;
  output += `**Message:** ${noaaStatus.message}\n`;
  output += `**Status Page:** ${noaaStatus.statusPage}\n`;
  output += `**Coverage:** United States locations only\n\n`;

  if (!noaaStatus.operational) {
    output += `**Recommended Actions:**\n`;
    output += `- Check planned outages: https://weather-gov.github.io/api/planned-outages\n`;
    output += `- View service notices: https://www.weather.gov/notification\n`;
    output += `- Report issues: nco.ops@noaa.gov or (301) 683-1518\n\n`;
  }

  // Open-Meteo Status
  output += `## Open-Meteo API (Historical Weather Data)\n\n`;
  output += `**Status:** ${openMeteoStatus.operational ? '✅ Operational' : '❌ Issues Detected'}\n`;
  output += `**Message:** ${openMeteoStatus.message}\n`;
  output += `**Status Page:** ${openMeteoStatus.statusPage}\n`;
  output += `**Coverage:** Global (worldwide locations)\n\n`;

  if (!openMeteoStatus.operational) {
    output += `**Recommended Actions:**\n`;
    output += `- Check production status: https://open-meteo.com/en/docs/model-updates\n`;
    output += `- View GitHub issues: https://github.com/open-meteo/open-meteo/issues\n`;
    output += `- Review documentation: https://open-meteo.com/en/docs\n\n`;
  }

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
    output += `## Overall Status: ✅ All Services Operational\n\n`;
    output += `Both NOAA and Open-Meteo APIs are functioning normally. Weather data requests should succeed.\n`;
  } else if (neitherOperational) {
    output += `## Overall Status: ❌ Multiple Service Issues\n\n`;
    output += `Both weather APIs are experiencing issues. Please check the status pages above for updates.\n`;
  } else {
    output += `## Overall Status: ⚠️ Partial Service Availability\n\n`;
    if (noaaStatus.operational) {
      output += `NOAA API is operational: Forecasts and current conditions for US locations are available.\n`;
      output += `Open-Meteo API has issues: Historical weather data may be unavailable.\n`;
    } else {
      output += `Open-Meteo API is operational: Historical weather data is available globally.\n`;
      output += `NOAA API has issues: Forecasts and current conditions for US locations may be unavailable.\n`;
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };
}
