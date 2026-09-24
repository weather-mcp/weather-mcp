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
import { MeteoAlarmService } from '../services/meteoalarm.js';
import { GeoMetService } from '../services/geomet.js';
import { NominatimService } from '../services/nominatim.js';
import { GoogleWeatherService } from '../services/googleWeather.js';
import { NationalCapService } from '../services/nationalCap.js';
import { resolveLocationAsync, formatLocationLine } from '../utils/locationResolver.js';
import { validateDetail, validateForecastDays, DetailLevel } from '../utils/validation.js';
import { UnitArgs } from '../utils/unitPreferences.js';
import { logger } from '../utils/logger.js';
import { handleGetCurrentConditions } from './currentConditionsHandler.js';
import { handleGetForecast } from './forecastHandler.js';
import { handleGetAlerts } from './alertsHandler.js';
import { JmaService } from '../services/jma.js';
import { MetnoService } from '../services/metno.js';
import { handleGetAirQuality } from './airQualityHandler.js';
import { handleGetLightningActivity } from './lightningHandler.js';
import { resolveCriticalAlertBanner } from './criticalAlertBanner.js';
import { guessTimezoneFromCoords } from '../utils/timezone.js';

/**
 * Sections that can be included in a weather summary.
 */
export type SummarySection = 'current' | 'forecast' | 'alerts' | 'air_quality' | 'lightning';

const VALID_SECTIONS: SummarySection[] = ['current', 'forecast', 'alerts', 'air_quality', 'lightning'];
const DEFAULT_SECTIONS: SummarySection[] = ['current', 'forecast', 'alerts'];

/**
 * Sources the summary accepts for its current and forecast sections. `metar`
 * is deliberately absent: the forecast handler has no METAR arm, so a METAR
 * current section would silently pair with an Open-Meteo forecast.
 */
type SummarySource = 'auto' | 'noaa' | 'openmeteo';

const VALID_SOURCES: SummarySource[] = ['auto', 'noaa', 'openmeteo'];

/**
 * The unit keys the summary declares and forwards. They mirror
 * `UNIT_SCHEMA_PROPERTIES` in `src/server/weatherServer.ts`, which this module
 * cannot import (that file imports this handler, so the import would be a
 * cycle). `tests/unit/weather-summary-allowlist.test.ts` derives its expected
 * key set from the declared schema, so the two cannot drift apart unnoticed.
 */
const SUMMARY_UNIT_KEYS = [
  'units',
  'temperature_unit',
  'wind_speed_unit',
  'precipitation_unit',
  'pressure_unit',
  'distance_unit',
  'time_format'
] as const;

interface WeatherSummaryArgs extends UnitArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  include?: unknown;
  detail?: DetailLevel;
  days?: number;
  source?: unknown;
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
 * Validate the optional `source`. Absent stays absent (not `'auto'`): both
 * sub-handlers apply their own `|| 'auto'`, so forwarding nothing keeps the
 * default path identical by construction. `metar` and any other value are
 * refused before any upstream call.
 */
function validateSummarySource(value: unknown): SummarySource | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string' && VALID_SOURCES.includes(value as SummarySource)) {
    return value as SummarySource;
  }

  throw new Error(
    `Invalid source "${String(value)}". Valid sources for get_weather_summary: ${VALID_SOURCES.join(', ')}.`
  );
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
  geocodingService: GeocodingService,
  meteoAlarmService?: MeteoAlarmService,
  geoMetService?: GeoMetService,
  nominatimService?: NominatimService,
  googleWeatherService?: GoogleWeatherService,
  nationalCapService?: NationalCapService,
  // Trailing and optional, exactly as on `handleGetAlerts`, so every
  // pre-existing 11-argument call site passes `undefined` and is unchanged.
  //
  // Routing reaches the summary automatically; the *dependency* does not. A new
  // service parameter on `handleGetAlerts` arrives `undefined` from here unless
  // it is threaded explicitly, which would silently render a Japanese point
  // through Google or the not-covered sentence — a fabricated all-clear on
  // safety data (G19, and both prep-review legs filed it).
  jmaService?: JmaService,
  // The critical-alert banner runs the hazard the other way round. Every other
  // trailing parameter here has to be threaded *down* or its feature is missing
  // from the summary; this one must NOT be, because the summary already renders
  // the forecast and current-conditions sections through the same handlers that
  // now carry the flag. Thread it into either of those two calls below and the
  // banner renders three times in one response — a safety element repeated is a
  // safety element people stop reading.
  //
  // The summary therefore resolves the banner **once, here**, and prepends it to
  // its own assembled body. Two facts already keep the sub-handlers quiet: the
  // two calls below never pass the banner flag positionally; and `subArgs` is
  // built from a fixed allowlist of declared keys, while this is a function
  // parameter and not on that list. Neither survives a future edit
  // unnoticed, which is why `tests/unit/critical-alert-summary.test.ts` counts
  // the banner's occurrences rather than merely asserting it is present.
  criticalAlertBanner?: boolean,
  // Threaded *down*, like every trailing parameter above except the banner: the
  // summary renders its forecast section through `handleGetForecast`, so the
  // Open-Meteo outage fallback is dead on this path unless the service arrives
  // here and is forwarded. This is the path a default install actually
  // exercises, so "the summary inherits it through the shared formatter" is the
  // exact assumption G19 exists to refuse.
  metnoService?: MetnoService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const typedArgs = (args ?? {}) as WeatherSummaryArgs;

  // First, before resolveLocationAsync: a `city_name` is geocoded there, which
  // is itself an upstream call, and a refused source must cost none.
  const source = validateSummarySource(typedArgs.source);

  // Resolve location once; sub-handlers receive the resolved coordinates so they
  // never re-geocode (coordinates take precedence in resolveLocationAsync).
  const resolved = await resolveLocationAsync(typedArgs, locationStore, geocodingService);
  const include = validateInclude(typedArgs.include);
  const detail = validateDetail(typedArgs.detail, 'summary');
  const days = validateForecastDays(typedArgs);

  // The invariant: the summary forwards only what it declares. A sub-tool
  // parameter reaches a section only if it is declared on get_weather_summary
  // (G85). This is an allowlist, not a spread, so a parameter added to a
  // sub-handler later does not leak through by default.
  //
  // - Resolved coordinates, so no sub-handler re-geocodes. `location_name` and
  //   `city_name` are consumed here and never copied.
  // - `detail`, as validated for the summary.
  // - The declared unit keys and `source`, each copied only when the caller
  //   sent it, so no key arrives with an `undefined` value.
  //
  // Deliberately not forwarded: `granularity` (an hourly table is the wrong
  // shape inside a one-call overview; use get_forecast), and `compare_models` /
  // `ensemble_spread` (D9: a comparison or spread view is the wrong shape inside
  // a summary). `days` goes to the forecast section only, below.
  const subArgs: Record<string, unknown> = {
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    detail
  };
  for (const key of SUMMARY_UNIT_KEYS) {
    if (typedArgs[key] !== undefined) {
      subArgs[key] = typedArgs[key];
    }
  }
  if (source !== undefined) {
    subArgs.source = source;
  }

  // Resolved once for the whole summary and prepended outermost, so the reader
  // meets the warning before the heading. The summary builds a string rather
  // than mutating `content[0].text`, so this is plain concatenation and
  // `prependCriticalAlertBanner` is not used at this site.
  //
  // The falsy flag short-circuits before the `await`, so the no-flag path gains
  // no latency at all.
  const criticalBanner = criticalAlertBanner
    ? await resolveCriticalAlertBanner(
        noaaService,
        resolved,
        guessTimezoneFromCoords(resolved.latitude, resolved.longitude)
      )
    : '';

  let body = `${criticalBanner}# Weather Summary\n\n`;
  const locationLine = formatLocationLine(resolved);
  if (locationLine) {
    body += locationLine;
  } else {
    body += `**Location:** ${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)}\n\n`;
  }
  body += `**Includes:** ${include.join(', ')}\n\n`;
  body += `---\n\n`;

  // Run each requested section. A section failure (e.g. an upstream error)
  // degrades to a note instead of failing the whole summary. Alerts are no
  // longer US-only here — handleGetAlerts routes by country itself and
  // produces its own graceful "not covered" message where needed.
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
          // **The two `undefined`s are load-bearing and are not padding.**
          // This call deliberately drops `acisService` (7th) and
          // `criticalAlertBanner` (8th) — the banner because the summary
          // renders it once itself, above its own header. `metnoService` is
          // the 9th parameter, so appending it here would bind it to
          // `acisService` instead: a strict-type failure at best, and a
          // service handed to the wrong slot at worst. Count the omitted
          // parameters rather than trusting the tail.
          sectionResult = await handleGetForecast(
            { ...subArgs, days }, noaaService, openMeteoService, locationStore, geocodingService,
            nceiService, undefined, undefined, metnoService
          );
          break;
        case 'alerts':
          sectionResult = await handleGetAlerts(
            subArgs, noaaService, locationStore, geocodingService,
            meteoAlarmService, geoMetService, nominatimService, googleWeatherService,
            nationalCapService, jmaService
          );
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
