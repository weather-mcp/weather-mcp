/**
 * Handler for get_weather_summary tool
 *
 * A composite tool that answers broad "what's the weather like?" questions in a
 * single call by aggregating several specialized tools (current conditions,
 * forecast, alerts, and optionally air quality and lightning) for one location.
 * Location is resolved once and the resolved coordinates are passed to each
 * sub-handler so there is no repeated geocoding.
 */

import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { NCEIService } from '../services/ncei.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, formatLocationLine } from '../utils/locationResolver.js';
import { validateDetail, validateForecastDays, DetailLevel } from '../utils/validation.js';
import { logger } from '../utils/logger.js';
import { handleGetCurrentConditions } from './currentConditionsHandler.js';
import { handleGetForecast } from './forecastHandler.js';
import { handleGetAlerts } from './alertsHandler.js';
import { handleGetAirQuality } from './airQualityHandler.js';
import { handleGetLightningActivity } from './lightningHandler.js';

/**
 * Sections that can be included in a weather summary.
 */
export type SummarySection = 'current' | 'forecast' | 'alerts' | 'air_quality' | 'lightning';

const VALID_SECTIONS: SummarySection[] = ['current', 'forecast', 'alerts', 'air_quality', 'lightning'];
const DEFAULT_SECTIONS: SummarySection[] = ['current', 'forecast', 'alerts'];

interface WeatherSummaryArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  include?: unknown;
  detail?: DetailLevel;
  days?: number;
}

/**
 * Validate and normalize the `include` array.
 * Defaults to current + forecast + alerts; unknown entries are rejected.
 */
function validateInclude(value: unknown): SummarySection[] {
  if (value === undefined) {
    return DEFAULT_SECTIONS;
  }

  if (!Array.isArray(value)) {
    throw new Error('include must be an array of section names');
  }

  const sections: SummarySection[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !VALID_SECTIONS.includes(entry as SummarySection)) {
      throw new Error(
        `Invalid include entry "${entry}". Valid sections: ${VALID_SECTIONS.join(', ')}.`
      );
    }
    if (!sections.includes(entry as SummarySection)) {
      sections.push(entry as SummarySection);
    }
  }

  // Empty array falls back to the default set rather than producing an empty report
  return sections.length > 0 ? sections : DEFAULT_SECTIONS;
}

/**
 * Extract the text payload from a sub-handler result.
 */
function textOf(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

export async function handleGetWeatherSummary(
  args: unknown,
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService,
  locationStore: LocationStore,
  geocodingService: GeocodingService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const typedArgs = (args ?? {}) as WeatherSummaryArgs;

  // Resolve location once; sub-handlers receive the resolved coordinates so they
  // never re-geocode (coordinates take precedence in resolveLocationAsync).
  const resolved = await resolveLocationAsync(typedArgs, locationStore, geocodingService);
  const include = validateInclude(typedArgs.include);
  const detail = validateDetail(typedArgs.detail, 'summary');
  const days = validateForecastDays(typedArgs);

  // Shared args for every sub-handler: resolved coordinates plus pass-through of
  // unit preferences and detail. Coordinates override any name so no geocoding.
  const subArgs = {
    ...(typeof args === 'object' && args !== null ? args : {}),
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    location_name: undefined,
    city_name: undefined,
    detail
  };

  let body = `# Weather Summary\n\n`;
  const locationLine = formatLocationLine(resolved);
  if (locationLine) {
    body += locationLine;
  } else {
    body += `**Location:** ${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)}\n\n`;
  }
  body += `**Includes:** ${include.join(', ')}\n\n`;
  body += `---\n\n`;

  // Run each requested section. A section failure (e.g. alerts outside the US)
  // degrades to a note instead of failing the whole summary.
  for (const section of include) {
    try {
      let sectionResult: { content: Array<{ type: string; text: string }> };
      switch (section) {
        case 'current':
          sectionResult = await handleGetCurrentConditions(
            subArgs, noaaService, openMeteoService, nceiService, locationStore, geocodingService
          );
          break;
        case 'forecast':
          sectionResult = await handleGetForecast(
            { ...subArgs, days }, noaaService, openMeteoService, locationStore, geocodingService, nceiService
          );
          break;
        case 'alerts':
          sectionResult = await handleGetAlerts(subArgs, noaaService, locationStore, geocodingService);
          break;
        case 'air_quality':
          sectionResult = await handleGetAirQuality(subArgs, openMeteoService, locationStore, geocodingService);
          break;
        case 'lightning':
          sectionResult = await handleGetLightningActivity(subArgs, locationStore, geocodingService);
          break;
        default:
          continue;
      }
      body += textOf(sectionResult).trim();
      body += `\n\n---\n\n`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Weather summary section failed', { section, error: message });
      body += `## ${section} (unavailable)\n\n`;
      body += `⚠️ Could not retrieve ${section} data for this location: ${message}\n\n`;
      body += `---\n\n`;
    }
  }

  body += `*Composite summary. Use the individual tools (get_forecast, get_current_conditions, get_alerts, ...) for deeper detail.*\n`;

  return {
    content: [
      {
        type: 'text',
        text: body
      }
    ]
  };
}
