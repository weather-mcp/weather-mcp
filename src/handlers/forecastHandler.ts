/**
 * Handler for get_forecast tool
 * Supports both NOAA (US) and Open-Meteo (global) forecast sources
 */

import { DateTime } from 'luxon';
import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { NCEIService } from '../services/ncei.js';
import { AcisService } from '../services/acis.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import type { GridpointProperties, GridpointDataSeries } from '../types/noaa.js';
import {
  validateForecastDays,
  validateGranularity,
  validateOptionalBoolean,
  validateDetail,
  DetailLevel,
} from '../utils/validation.js';
import { resolveLocationAsync, formatLocationLine } from '../utils/locationResolver.js';
import { resolveUnitPreferences, UnitArgs } from '../utils/unitPreferences.js';
import { UnitPreferences } from '../config/units.js';
import {
  temperatureLabel,
  windSpeedLabel,
  precipitationLabel,
  noaaUnitsParam,
  formatElevationFromM,
  formatLuxonTime,
} from '../utils/unitFormat.js';
import { logger } from '../utils/logger.js';
import {
  extractSnowfallForecast,
  extractIceAccumulation,
  formatSnowData,
  hasWinterWeather
} from '../utils/snow.js';
import { formatInTimezone, guessTimezoneFromCoords } from '../utils/timezone.js';
import { renderNormalsSection, getDateComponents } from '../utils/normals.js';
import { getRecordsLine } from '../utils/records.js';
import {
  computeDayAstronomy,
  nextMoonQuarters,
  formatAstronomyBlock,
  formatNextQuarters,
} from '../utils/astronomy.js';
import { isInUS } from '../utils/geography.js';
import {
  COMPARISON_MODELS,
  buildModelComparison,
  weatherCodeBucket,
} from '../utils/modelComparison.js';
import type {
  ModelComparisonResult,
  DayComparison,
  WeatherCodeBucket,
} from '../utils/modelComparison.js';
import {
  ENSEMBLE_MODEL_LABEL,
  buildEnsembleSpread,
} from '../utils/ensembleSpread.js';
import type {
  EnsembleSpreadResult,
  EnsembleDay,
} from '../utils/ensembleSpread.js';
import { DataNotFoundError, InvalidLocationError } from '../errors/ApiError.js';

/** Note shown when an auto-routed NOAA request falls back to Open-Meteo. */
const NOAA_FALLBACK_NOTE =
  '*NOAA does not cover this location; showing Open-Meteo model data instead.*';

/**
 * Insert a note line directly under the output's top heading (first line),
 * keeping the heading itself as the first thing the client renders.
 */
function insertNoteAfterHeading(text: string, note: string): string {
  const newline = text.indexOf('\n');
  if (newline === -1) {
    return `${text}\n\n${note}\n`;
  }
  // The remainder starts with the original newline(s), so no trailing \n here.
  return `${text.slice(0, newline)}\n\n${note}${text.slice(newline)}`;
}

interface ForecastArgs extends UnitArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  days?: number;
  granularity?: 'daily' | 'hourly';
  include_precipitation_probability?: boolean;
  include_severe_weather?: boolean;
  include_normals?: boolean;
  include_astronomy?: boolean;
  compare_models?: boolean;
  ensemble_spread?: boolean;
  source?: 'auto' | 'noaa' | 'openmeteo';
  detail?: DetailLevel;
}

/**
 * Cap the number of hourly forecast entries by verbosity level.
 * Hourly forecasts can emit up to days*24 entries (384 at 16 days), which is
 * expensive for assistant contexts. Unless the user asks for detail="full",
 * cap to a short horizon; the daily view still covers the full requested range.
 *
 * @param detail - Requested verbosity
 * @param days - Number of forecast days requested
 * @returns Maximum hourly entries to emit
 */
function hourlyEntryCap(detail: DetailLevel, days: number): number {
  const maxHours = days * 24;
  if (detail === 'full') return maxHours;
  if (detail === 'summary') return Math.min(24, maxHours);
  return Math.min(48, maxHours); // standard default
}

/**
 * Extract maximum value from gridpoint data series for the next 24-48 hours
 * @param series - The gridpoint data series to process
 * @param hours - Number of hours to look ahead (default: 48)
 * @param maxEntries - Maximum number of entries to process for defense-in-depth (default: 500 ~ 1 week hourly data)
 */
function getMaxProbabilityFromSeries(series: GridpointDataSeries | undefined, hours: number = 48, maxEntries: number = 500): number {
  if (!series || !series.values || series.values.length === 0) {
    return 0;
  }

  // Defense-in-depth: Add bounds checking to prevent resource exhaustion
  // IMPORTANT: Work on a local copy to avoid mutating cached data
  let valuesToProcess = series.values;
  if (series.values.length > maxEntries) {
    logger.warn('Gridpoint series exceeds max entries', {
      length: series.values.length,
      maxEntries,
      securityEvent: true
    });
    // Create a local copy with limited entries - do not mutate the original
    valuesToProcess = series.values.slice(0, maxEntries);
  }

  const now = new Date();
  const futureTime = new Date(now.getTime() + hours * 60 * 60 * 1000);

  let maxValue = 0;
  for (const entry of valuesToProcess) {
    // Parse ISO 8601 interval (e.g., "2025-11-06T15:00:00+00:00/PT1H")
    const validTimeStart = new Date(entry.validTime.split('/')[0]);

    if (validTimeStart >= now && validTimeStart <= futureTime && entry.value !== null) {
      maxValue = Math.max(maxValue, entry.value);
    }
  }

  return maxValue;
}

/**
 * Format severe weather probabilities for display
 */
function formatSevereWeather(properties: GridpointProperties): string | null {
  let output = '';
  let hasData = false;

  output += `\n## ⚠️ Severe Weather Probabilities (Next 48 Hours)\n\n`;

  // Thunder probability
  const thunderProb = getMaxProbabilityFromSeries(properties.probabilityOfThunder);
  if (thunderProb > 0) {
    hasData = true;
    const emoji = thunderProb > 50 ? '🌩️' : thunderProb > 20 ? '⚡' : '🌤️';
    output += `${emoji} **Thunderstorms:** ${thunderProb}% chance\n`;
  }

  // Wind gust probabilities (show highest risk category)
  const windGust60 = getMaxProbabilityFromSeries(properties.potentialOf60mphWindGusts);
  const windGust50 = getMaxProbabilityFromSeries(properties.potentialOf50mphWindGusts);
  const windGust40 = getMaxProbabilityFromSeries(properties.potentialOf40mphWindGusts);
  const windGust30 = getMaxProbabilityFromSeries(properties.potentialOf30mphWindGusts);

  if (windGust60 > 0) {
    hasData = true;
    output += `💨 **Very High Wind Gusts (60+ mph):** ${windGust60}% chance\n`;
  } else if (windGust50 > 0) {
    hasData = true;
    output += `💨 **High Wind Gusts (50+ mph):** ${windGust50}% chance\n`;
  } else if (windGust40 > 0) {
    hasData = true;
    output += `💨 **Strong Wind Gusts (40+ mph):** ${windGust40}% chance\n`;
  } else if (windGust30 > 20) {
    // Only show moderate gusts if probability is significant
    hasData = true;
    output += `💨 **Moderate Wind Gusts (30+ mph):** ${windGust30}% chance\n`;
  }

  // Tropical storm/hurricane winds (if present)
  const tropicalStormProb = getMaxProbabilityFromSeries(properties.probabilityOfTropicalStormWinds);
  const hurricaneProb = getMaxProbabilityFromSeries(properties.probabilityOfHurricaneWinds);

  if (hurricaneProb > 0) {
    hasData = true;
    output += `🌀 **Hurricane-Force Winds (74+ mph):** ${hurricaneProb}% chance\n`;
  } else if (tropicalStormProb > 0) {
    hasData = true;
    output += `🌀 **Tropical Storm Winds (39-73 mph):** ${tropicalStormProb}% chance\n`;
  }

  // Lightning activity
  if (properties.lightningActivityLevel && properties.lightningActivityLevel.values && properties.lightningActivityLevel.values.length > 0) {
    const lightningLevels = properties.lightningActivityLevel.values.filter(v => v.value !== null && v.value > 0);
    if (lightningLevels.length > 0) {
      hasData = true;
      const maxLevel = Math.max(...lightningLevels.map(v => v.value || 0));
      const levelDesc = maxLevel >= 4 ? 'Very High' : maxLevel >= 3 ? 'High' : maxLevel >= 2 ? 'Moderate' : 'Low';
      output += `⚡ **Lightning Activity:** ${levelDesc} (Level ${maxLevel})\n`;
    }
  }

  if (!hasData) {
    return null; // No severe weather data to display
  }

  output += `\n*Note: These are probabilistic forecasts and may change. Always monitor local weather alerts for official warnings.*\n`;

  return output;
}

export async function handleGetForecast(
  args: unknown,
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService,
  locationStore: LocationStore,
  geocodingService: GeocodingService,
  nceiService?: NCEIService,
  acisService?: AcisService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Resolve location from coordinates, a saved location name, or a geocoded city name
  const resolved = await resolveLocationAsync(args as ForecastArgs, locationStore, geocodingService);
  const { latitude, longitude } = resolved;
  const days = validateForecastDays(args);
  const granularity = validateGranularity((args as ForecastArgs)?.granularity);
  const include_precipitation_probability = validateOptionalBoolean(
    (args as ForecastArgs)?.include_precipitation_probability,
    'include_precipitation_probability',
    true
  );
  const include_severe_weather = validateOptionalBoolean(
    (args as ForecastArgs)?.include_severe_weather,
    'include_severe_weather',
    false
  );
  const include_normals = validateOptionalBoolean(
    (args as ForecastArgs)?.include_normals,
    'include_normals',
    false
  );
  // Moon phase, moonrise/set, and twilight blocks (daily granularity only,
  // like include_normals — silently ignored for hourly forecasts)
  const include_astronomy = validateOptionalBoolean(
    (args as ForecastArgs)?.include_astronomy,
    'include_astronomy',
    false
  );
  // Multi-model agreement view (D1). Unlike include_astronomy/include_normals,
  // this is not garnish — it replaces the forecast product entirely, so its
  // parameter conflicts are errors rather than silent no-ops (see below).
  const compare_models = validateOptionalBoolean(
    (args as ForecastArgs)?.compare_models,
    'compare_models',
    false
  );
  // Single-model member spread (D1). Like compare_models — and unlike the
  // include_* garnish flags — this replaces the forecast product entirely,
  // so its parameter conflicts are errors rather than silent no-ops.
  const ensemble_spread = validateOptionalBoolean(
    (args as ForecastArgs)?.ensemble_spread,
    'ensemble_spread',
    false
  );
  // Output verbosity: caps hourly output unless detail="full" (see hourlyEntryCap)
  const detail = validateDetail((args as ForecastArgs)?.detail);

  // Resolve unit preferences (per-call params over the server default)
  const prefs = resolveUnitPreferences(args as ForecastArgs);

  // Get source preference or auto-detect
  const requestedSource = (args as ForecastArgs)?.source || 'auto';

  // Comparison interactions, thrown before any service call (D1). Silently
  // returning a plain forecast to someone who asked "do the models agree?"
  // would be dishonest, so these conflicts fail loudly instead of degrading.
  // The two spread views answer different questions — "do the models agree?"
  // versus "how confident is this one model?" — from different endpoints, and
  // neither is a superset of the other, so asking for both is a request we
  // cannot honour rather than one we should silently pick a winner for (D1).
  if (compare_models && ensemble_spread) {
    throw new Error('ensemble_spread and compare_models are mutually exclusive; request one view at a time');
  }

  if (compare_models) {
    if (granularity === 'hourly') {
      throw new Error('compare_models requires daily granularity');
    }
    if (requestedSource === 'noaa') {
      throw new Error('compare_models uses Open-Meteo model data; use source "auto" or "openmeteo"');
    }
  }

  // Same posture as the comparison guards above: silently returning a plain
  // forecast to someone who asked how certain the forecast is would be
  // dishonest, so these conflicts fail loudly instead of degrading (D1).
  if (ensemble_spread) {
    if (granularity === 'hourly') {
      throw new Error('ensemble_spread requires daily granularity');
    }
    if (requestedSource === 'noaa') {
      throw new Error('ensemble_spread uses Open-Meteo ensemble data; use source "auto" or "openmeteo"');
    }
  }

  let useNOAA: boolean;

  if (requestedSource === 'auto') {
    // Auto-detect based on location (US = NOAA, elsewhere = Open-Meteo)
    useNOAA = isInUS(latitude, longitude);
  } else {
    useNOAA = requestedSource === 'noaa';
  }

  // Use NOAA for US locations or if explicitly requested
  let result: { content: Array<{ type: string; text: string }> };
  if (ensemble_spread) {
    // The spread short-circuits routing exactly as the comparison does (D2):
    // NOAA is never called, so none of the auto-fallback logic below applies.
    // US points still get a spread, with the NWS-not-the-model-shown
    // disclosure in the footer.
    result = await formatEnsembleSpreadForecast(
      openMeteoService,
      latitude,
      longitude,
      days,
      prefs,
      detail
    );
  } else if (compare_models) {
    // The comparison short-circuits routing entirely (D2): NOAA is never
    // called, so none of the auto-fallback logic below applies — there is
    // nothing to fall back from. US points still get a comparison, with the
    // NWS-not-compared disclosure in the footer.
    result = await formatModelComparisonForecast(
      openMeteoService,
      latitude,
      longitude,
      days,
      include_precipitation_probability,
      prefs,
      detail
    );
  } else if (useNOAA) {
    try {
      result = await formatNOAAForecast(
        noaaService,
        openMeteoService,
        nceiService,
        latitude,
        longitude,
        days,
        granularity,
        include_precipitation_probability,
        include_severe_weather,
        include_normals,
        include_astronomy,
        prefs,
        detail,
        acisService
      );
    } catch (error) {
      // The US bounding boxes overrun the border (Toronto, Vancouver, Windsor
      // all sit inside them), so auto-routed points NOAA rejects fall back to
      // Open-Meteo instead of erroring. NOAA maps the coverage 404 ("Unable to
      // provide data for requested point") to DataNotFoundError and other 4xx
      // to InvalidLocationError — both are non-retryable "NOAA can't serve
      // this request" failures, so both fall back. Transient failures
      // (RateLimitError, ServiceUnavailableError, network) still propagate,
      // and explicit source="noaa" keeps its error contract.
      if (
        requestedSource !== 'auto' ||
        !(error instanceof DataNotFoundError || error instanceof InvalidLocationError)
      ) {
        throw error;
      }
      logger.warn('NOAA rejected auto-routed location; falling back to Open-Meteo', {
        latitude,
        longitude,
        fallback: true
      });
      result = await formatOpenMeteoForecast(
        openMeteoService,
        nceiService,
        latitude,
        longitude,
        days,
        granularity,
        include_precipitation_probability,
        include_normals,
        include_astronomy,
        prefs,
        detail,
        acisService
      );
      if (result.content.length > 0 && result.content[0]?.type === 'text' && result.content[0].text) {
        result.content[0].text = insertNoteAfterHeading(result.content[0].text, NOAA_FALLBACK_NOTE);
      }
    }
  } else {
    // Use Open-Meteo for international locations
    result = await formatOpenMeteoForecast(
      openMeteoService,
      nceiService,
      latitude,
      longitude,
      days,
      granularity,
      include_precipitation_probability,
      include_normals,
      include_astronomy,
      prefs,
      detail,
      acisService
    );
  }

  // If the location was resolved from a name (saved or geocoded), show the user
  // what it matched so an ambiguous city name is transparent.
  const locationLine = formatLocationLine(resolved);
  if (locationLine && result.content.length > 0 && result.content[0]?.type === 'text') {
    result.content[0].text = locationLine + result.content[0].text;
  }

  return result;
}

/**
 * Format NOAA forecast data for display
 */
async function formatNOAAForecast(
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService | undefined,
  latitude: number,
  longitude: number,
  days: number,
  granularity: 'daily' | 'hourly',
  include_precipitation_probability: boolean,
  include_severe_weather: boolean,
  include_normals: boolean,
  include_astronomy: boolean,
  prefs: UnitPreferences,
  detail: DetailLevel,
  acisService?: AcisService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const noaaUnits = noaaUnitsParam(prefs);
  // Fetch point data once. It yields both the timezone AND the grid coordinates,
  // so downstream forecast/gridpoint calls use the grid-based methods directly
  // instead of re-resolving the point (avoids duplicate upstream lookups on a
  // cold cache). A point-data failure here propagates — the forecast can't be
  // built without it anyway.
  const points = await noaaService.getPointData(latitude, longitude);
  const { gridId, gridX, gridY } = points.properties;
  const timezone = points.properties.timeZone || guessTimezoneFromCoords(latitude, longitude);

  // Get forecast data based on granularity (units=us|si controls NWS output units)
  const forecast = granularity === 'hourly'
    ? await noaaService.getHourlyForecast(gridId, gridX, gridY, noaaUnits)
    : await noaaService.getForecast(gridId, gridX, gridY, noaaUnits);

  // Determine how many periods to show
  let periods;
  if (granularity === 'hourly') {
    // Hourly output is capped by verbosity (see hourlyEntryCap) unless full
    periods = forecast.properties.periods.slice(0, hourlyEntryCap(detail, days));
  } else {
    // For daily, show up to days * 2 (day/night periods)
    periods = forecast.properties.periods.slice(0, days * 2);
  }

  // Format the forecast for display
  let output = `# Weather Forecast (${granularity === 'hourly' ? 'Hourly' : 'Daily'})\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Elevation:** ${formatElevationFromM(forecast.properties.elevation.value, prefs)}\n`;
  if (forecast.properties.updated) {
    output += `**Updated:** ${formatInTimezone(forecast.properties.updated, timezone, 'medium', prefs.timeFormat)}\n`;
  }
  output += `**Showing:** ${periods.length} ${granularity === 'hourly' ? 'hours' : 'periods'}\n\n`;
  if (granularity === 'hourly' && detail !== 'full' && forecast.properties.periods.length > periods.length) {
    output += `*Hourly output capped at ${periods.length} hours (detail="${detail}"). Use detail="full" for the full ${days}-day hourly forecast.*\n\n`;
  }

  // NOAA daily output renders day/night *periods* with no sun lines, so the
  // astronomy block anchors to calendar dates instead: one block per date,
  // emitted at the end of the first period belonging to that date (which
  // handles a "Tonight"-first response cleanly).
  const astronomyDatesRendered = new Set<string>();

  for (const period of periods) {
    // For hourly forecasts, use the start time as the header since period names are empty
    const periodHeader = granularity === 'hourly' && !period.name
      ? formatInTimezone(period.startTime, timezone, 'short', prefs.timeFormat)
      : period.name;
    output += `## ${periodHeader}\n`;
    output += `**Temperature:** ${period.temperature}°${period.temperatureUnit}`;

    // Add temperature trend if available
    if (period.temperatureTrend && period.temperatureTrend.trim()) {
      output += ` (${period.temperatureTrend})`;
    }
    output += `\n`;

    // Add precipitation probability if requested and available
    if (include_precipitation_probability && period.probabilityOfPrecipitation?.value !== null && period.probabilityOfPrecipitation?.value !== undefined) {
      output += `**Precipitation Chance:** ${period.probabilityOfPrecipitation.value}%\n`;
    }

    output += `**Wind:** ${period.windSpeed} ${period.windDirection}\n`;

    // Add humidity if available (more common in hourly forecasts)
    if (period.relativeHumidity?.value !== null && period.relativeHumidity?.value !== undefined) {
      output += `**Humidity:** ${period.relativeHumidity.value}%\n`;
    }

    output += `**Forecast:** ${period.shortForecast}\n\n`;

    // For daily forecasts, include the long detailed forecast (omitted at summary)
    if (granularity === 'daily' && detail !== 'summary' && period.detailedForecast) {
      output += `${period.detailedForecast}\n\n`;
    }

    // Astronomy block: once per calendar date, after the date's first period
    if (include_astronomy && granularity === 'daily' && period.startTime) {
      const periodDate = DateTime.fromISO(period.startTime, { zone: timezone });
      const isoDate = periodDate.toISODate();
      if (isoDate && !astronomyDatesRendered.has(isoDate)) {
        astronomyDatesRendered.add(isoDate);
        output += formatAstronomyBlock(
          computeDayAstronomy(latitude, longitude, periodDate),
          prefs
        );
        output += `\n`;
      }
    }
  }

  // Next full/new moon: once per response, anchored at the first forecast day
  if (include_astronomy && granularity === 'daily' && periods[0]?.startTime) {
    const firstDay = DateTime.fromISO(periods[0].startTime, { zone: timezone });
    output += formatNextQuarters(nextMoonQuarters(firstDay), timezone);
    output += `\n`;
  }

  output += `---\n`;
  output += `*Data source: NOAA National Weather Service (US)*\n`;

  // Fetch gridpoint data once for both severe weather and winter weather
  let gridpointData: Awaited<ReturnType<typeof noaaService.getGridpointDataByCoordinates>> | null = null;

  // Add severe weather probabilities if requested
  if (include_severe_weather) {
    try {
      gridpointData = await noaaService.getGridpointData(gridId, gridX, gridY);
      const severeWeatherSection = formatSevereWeather(gridpointData.properties);
      if (severeWeatherSection) {
        output += `\n${severeWeatherSection}`;
      }
    } catch (error) {
      // If severe weather data is unavailable, just note it without failing the whole request
      output += `\n*Note: Severe weather probability data is not available for this location.*\n`;
    }
  }

  // Add winter weather (snowfall/ice) if available
  try {
    // Fetch gridpoint data if we haven't already
    if (!gridpointData) {
      gridpointData = await noaaService.getGridpointData(gridId, gridX, gridY);
    }

    // Calculate time range for forecast period
    const now = new Date();
    const endTime = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // Extract snowfall and ice accumulation
    const snowfall = extractSnowfallForecast(gridpointData.properties, now, endTime);
    const ice = extractIceAccumulation(gridpointData.properties, now, endTime);

    const winterData = {
      snowfallAmount: snowfall,
      iceAccumulation: ice
    };

    if (hasWinterWeather(winterData)) {
      output += formatSnowData(winterData);
    }
  } catch (error) {
    // Winter weather data is optional, silently skip if unavailable
  }

  // Add climate normals if requested and for daily forecasts only
  if (include_normals && granularity === 'daily') {
    // Get the first forecast day to determine the date
    const firstPeriod = periods[0];
    if (firstPeriod && firstPeriod.startTime) {
      const { month, day } = getDateComponents(firstPeriod.startTime);

      // Get forecasted high/low for comparison (first day)
      let forecastHigh: number | undefined;
      let forecastLow: number | undefined;

      // NOAA gives day/night periods, so we need to find high (day) and low (night)
      for (const period of periods.slice(0, 2)) { // Check first 2 periods (day + night)
        if (period.isDaytime && period.temperature !== undefined) {
          forecastHigh = period.temperature;
        } else if (!period.isDaytime && period.temperature !== undefined) {
          forecastLow = period.temperature;
        }
      }

      output += await renderNormalsSection(
        openMeteoService,
        nceiService,
        latitude,
        longitude,
        month,
        day,
        { high: forecastHigh, low: forecastLow },
        prefs
      );

      // US temperature records: independent of the normals fetch above (D4/A5)
      // — a records line can render even if normals failed, and vice versa.
      if (isInUS(latitude, longitude) && acisService) {
        try {
          const recordsLine = await getRecordsLine(acisService, latitude, longitude, month, day, prefs);
          if (recordsLine) {
            output += `\n${recordsLine}\n`;
          }
        } catch (error) {
          // getRecordsLine never throws, but stay defensive per D4 — records
          // must never fail the primary forecast response.
        }
      }
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

/**
 * Format Open-Meteo forecast data for display
 */
async function formatOpenMeteoForecast(
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService | undefined,
  latitude: number,
  longitude: number,
  days: number,
  granularity: 'daily' | 'hourly',
  include_precipitation_probability: boolean,
  include_normals: boolean,
  include_astronomy: boolean,
  prefs: UnitPreferences,
  detail: DetailLevel,
  acisService?: AcisService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Unit labels for output (Open-Meteo returns values already in requested units)
  const tempU = temperatureLabel(prefs);
  const windU = windSpeedLabel(prefs);
  const precipU = precipitationLabel(prefs);

  // Get forecast data from Open-Meteo in the requested units
  const forecast = await openMeteoService.getForecast(
    latitude,
    longitude,
    days,
    granularity === 'hourly',
    prefs
  );

  let output = `# Weather Forecast (${granularity === 'hourly' ? 'Hourly' : 'Daily'})\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Elevation:** ${formatElevationFromM(forecast.elevation, prefs)}\n`;
  output += `**Timezone:** ${forecast.timezone}\n`;
  output += `**Forecast Days:** ${days}\n\n`;

  if (granularity === 'hourly' && forecast.hourly) {
    // Format hourly data (capped by verbosity unless detail="full")
    const hourly = forecast.hourly;
    const numHours = Math.min(hourly.time.length, hourlyEntryCap(detail, days));
    if (detail !== 'full' && hourly.time.length > numHours) {
      output += `*Hourly output capped at ${numHours} hours (detail="${detail}"). Use detail="full" for the full ${days}-day hourly forecast.*\n\n`;
    }

    for (let i = 0; i < numHours; i++) {
      output += `## ${formatInTimezone(hourly.time[i], forecast.timezone, 'short', prefs.timeFormat)}\n`;

      if (hourly.temperature_2m?.[i] !== undefined) {
        output += `**Temperature:** ${Math.round(hourly.temperature_2m[i])}${tempU}`;
        if (hourly.apparent_temperature?.[i] !== undefined) {
          output += ` (feels like ${Math.round(hourly.apparent_temperature[i])}${tempU})`;
        }
        output += `\n`;
      }

      if (include_precipitation_probability && hourly.precipitation_probability?.[i] !== undefined) {
        output += `**Precipitation Chance:** ${hourly.precipitation_probability[i]}%\n`;
      }

      if (hourly.precipitation?.[i] !== undefined && hourly.precipitation[i] > 0) {
        output += `**Precipitation:** ${hourly.precipitation[i].toFixed(2)} ${precipU}\n`;
      }

      if (hourly.wind_speed_10m?.[i] !== undefined) {
        const windDir = hourly.wind_direction_10m?.[i] !== undefined
          ? ` ${getWindDirection(hourly.wind_direction_10m[i])}`
          : '';
        output += `**Wind:** ${Math.round(hourly.wind_speed_10m[i])} ${windU}${windDir}\n`;

        if (hourly.wind_gusts_10m?.[i] !== undefined && hourly.wind_gusts_10m[i] > hourly.wind_speed_10m[i] * 1.2) {
          output += `**Wind Gusts:** ${Math.round(hourly.wind_gusts_10m[i])} ${windU}\n`;
        }
      }

      if (hourly.relative_humidity_2m?.[i] !== undefined) {
        output += `**Humidity:** ${hourly.relative_humidity_2m[i]}%\n`;
      }

      if (hourly.weather_code?.[i] !== undefined) {
        output += `**Conditions:** ${openMeteoService.getWeatherDescription(hourly.weather_code[i])}\n`;
      }

      output += `\n`;
    }
  } else if (forecast.daily) {
    // Format daily data with sunrise/sunset
    const daily = forecast.daily;
    const numDays = Math.min(daily.time.length, days);

    for (let i = 0; i < numDays; i++) {
      // Open-Meteo returns location-local naive timestamps; parse directly in the
      // forecast timezone to avoid a double offset shift via the server's zone
      const dt = DateTime.fromISO(daily.time[i], { zone: forecast.timezone });
      output += `## ${dt.toLocaleString({ weekday: 'long', month: 'long', day: 'numeric' })}\n`;

      if (daily.temperature_2m_max?.[i] !== undefined && daily.temperature_2m_min?.[i] !== undefined) {
        output += `**Temperature:** High ${Math.round(daily.temperature_2m_max[i])}${tempU} / Low ${Math.round(daily.temperature_2m_min[i])}${tempU}\n`;
      }

      if (daily.apparent_temperature_max?.[i] !== undefined && daily.apparent_temperature_min?.[i] !== undefined) {
        output += `**Feels Like:** High ${Math.round(daily.apparent_temperature_max[i])}${tempU} / Low ${Math.round(daily.apparent_temperature_min[i])}${tempU}\n`;
      }

      // Include sunrise/sunset data with timezone
      if (daily.sunrise?.[i]) {
        const sunrise = DateTime.fromISO(daily.sunrise[i], { zone: forecast.timezone });
        output += `**Sunrise:** ${formatLuxonTime(sunrise, prefs)}\n`;
      }

      if (daily.sunset?.[i]) {
        const sunset = DateTime.fromISO(daily.sunset[i], { zone: forecast.timezone });
        output += `**Sunset:** ${formatLuxonTime(sunset, prefs)}\n`;
      }

      // Astronomy block: moon phase/rise/set and twilight, right after the sun lines
      if (include_astronomy) {
        output += formatAstronomyBlock(computeDayAstronomy(latitude, longitude, dt), prefs);
      }

      if (daily.daylight_duration?.[i] !== undefined) {
        const hours = Math.floor(daily.daylight_duration[i] / 3600);
        const minutes = Math.floor((daily.daylight_duration[i] % 3600) / 60);
        output += `**Daylight Duration:** ${hours}h ${minutes}m\n`;
      }

      if (include_precipitation_probability && daily.precipitation_probability_max?.[i] !== undefined) {
        output += `**Precipitation Chance:** ${daily.precipitation_probability_max[i]}%\n`;
      }

      if (daily.precipitation_sum?.[i] !== undefined && daily.precipitation_sum[i] > 0) {
        output += `**Precipitation:** ${daily.precipitation_sum[i].toFixed(2)} ${precipU}\n`;
      }

      if (daily.wind_speed_10m_max?.[i] !== undefined) {
        const windDir = daily.wind_direction_10m_dominant?.[i] !== undefined
          ? ` ${getWindDirection(daily.wind_direction_10m_dominant[i])}`
          : '';
        output += `**Wind:** ${Math.round(daily.wind_speed_10m_max[i])} ${windU}${windDir}\n`;

        if (daily.wind_gusts_10m_max?.[i] !== undefined && daily.wind_gusts_10m_max[i] > daily.wind_speed_10m_max[i] * 1.2) {
          output += `**Wind Gusts:** ${Math.round(daily.wind_gusts_10m_max[i])} ${windU}\n`;
        }
      }

      if (daily.weather_code?.[i] !== undefined) {
        output += `**Conditions:** ${openMeteoService.getWeatherDescription(daily.weather_code[i])}\n`;
      }

      if (daily.uv_index_max?.[i] !== undefined) {
        output += `**UV Index:** ${daily.uv_index_max[i].toFixed(1)}\n`;
      }

      output += `\n`;
    }

    // Next full/new moon: once per response, anchored at the first forecast day
    if (include_astronomy && numDays > 0 && daily.time[0]) {
      const firstDay = DateTime.fromISO(daily.time[0], { zone: forecast.timezone });
      output += formatNextQuarters(nextMoonQuarters(firstDay), forecast.timezone);
      output += `\n`;
    }
  }

  output += `---\n`;
  output += `*Data source: Open-Meteo (Global)*\n`;

  // Add climate normals if requested and for daily forecasts only
  if (include_normals && granularity === 'daily' && forecast.daily) {
    // Get the first forecast day
    const firstDay = forecast.daily.time[0];
    if (firstDay) {
      const { month, day } = getDateComponents(firstDay);

      // Get forecasted high/low for comparison (first day)
      const currentTemps = {
        high: forecast.daily.temperature_2m_max?.[0] !== undefined
          ? Math.round(forecast.daily.temperature_2m_max[0])
          : undefined,
        low: forecast.daily.temperature_2m_min?.[0] !== undefined
          ? Math.round(forecast.daily.temperature_2m_min[0])
          : undefined
      };

      output += await renderNormalsSection(
        openMeteoService,
        nceiService,
        latitude,
        longitude,
        month,
        day,
        currentTemps,
        prefs
      );

      // US temperature records: independent of the normals fetch above (D4/A5)
      // — a records line can render even if normals failed, and vice versa.
      if (isInUS(latitude, longitude) && acisService) {
        try {
          const recordsLine = await getRecordsLine(acisService, latitude, longitude, month, day, prefs);
          if (recordsLine) {
            output += `\n${recordsLine}\n`;
          }
        } catch (error) {
          // getRecordsLine never throws, but stay defensive per D4 — records
          // must never fail the primary forecast response.
        }
      }
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

// ---------------------------------------------------------------------------
// Multi-model comparison rendering (D5)
// ---------------------------------------------------------------------------

/**
 * Short display names for the curated comparison models, used in per-day
 * lines and dissenter callouts. Keyed by the Open-Meteo model id.
 */
const MODEL_SHORT_NAMES: Record<string, string> = {
  gfs_seamless: 'GFS',
  ecmwf_ifs025: 'ECMWF',
  icon_seamless: 'ICON',
  gem_seamless: 'GEM',
  ukmo_seamless: 'UKMO'
};

/** Long-form model names with their issuing centre, for the header line. */
const MODEL_LONG_NAMES: Record<string, string> = {
  gfs_seamless: 'GFS (NOAA)',
  ecmwf_ifs025: 'ECMWF IFS',
  icon_seamless: 'ICON (DWD)',
  gem_seamless: 'GEM (Canada)',
  ukmo_seamless: 'UKMO (UK Met Office)'
};

function modelShortName(model: string): string {
  return MODEL_SHORT_NAMES[model] ?? model;
}

/** Human label for a coarse weather-code bucket (see `weatherCodeBucket`). */
const BUCKET_LABELS: Record<WeatherCodeBucket, string> = {
  clear: 'clear',
  cloudy: 'cloudy',
  fog: 'fog',
  rain: 'rain',
  snow: 'snow',
  thunderstorm: 'thunderstorms',
  other: 'mixed conditions'
};

/** Round a displayed temperature/wind figure the way the standard views do. */
function r0(value: number): string {
  return `${Math.round(value)}`;
}

/**
 * Render a min–max range, collapsing to a single figure when every model
 * agreed exactly — "82–82°F" reads as a formatting bug, "82°F" reads as
 * unanimity.
 */
function rangeText(min: number, max: number, unit: string): string {
  return Math.round(min) === Math.round(max)
    ? `${r0(min)}${unit}`
    : `${r0(min)}–${r0(max)}${unit}`;
}

function precipRangeText(min: number, max: number, unit: string): string {
  return min.toFixed(2) === max.toFixed(2)
    ? `${min.toFixed(2)} ${unit}`
    : `${min.toFixed(2)}–${max.toFixed(2)} ${unit}`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * Overall-agreement sentence shown under the header. Built deterministically
 * from the per-day labels: a leading run of good days is called out where one
 * exists, otherwise the day counts are stated plainly. The maximum daily-high
 * spread is always given so the reader can size the disagreement themselves.
 */
function overallAgreementLine(
  result: ModelComparisonResult,
  timezone: string,
  tempU: string
): string {
  const days = result.days;
  const assessable = days.filter(d => d.participantCount >= 2);
  const good = assessable.filter(d => d.agreement === 'Good').length;
  const moderate = assessable.filter(d => d.agreement === 'Moderate').length;
  const low = assessable.filter(d => d.agreement === 'Low').length;

  if (assessable.length === 0) {
    return `**Model agreement:** Not assessable — too few models returned data for these days.\n`;
  }

  const maxSpread = Math.max(...assessable.map(d => d.temperature.high.range));
  const spreadText = `temperature spread up to ${r0(maxSpread)}${tempU}`;

  let summary: string;
  if (good === assessable.length) {
    summary = `Good across all ${assessable.length} ${plural(assessable.length, 'day', 'days')}`;
  } else {
    // Leading run of good days — the practically useful shape of the answer
    // ("trust the next three days, watch the weekend").
    let run = 0;
    while (run < days.length && days[run].participantCount >= 2 && days[run].agreement === 'Good') {
      run++;
    }
    if (run > 0) {
      summary = `Good through ${shortDayLabel(days[run - 1].date, timezone)}, then `;
      summary += low > 0
        ? `diverging — ${low} low-agreement ${plural(low, 'day', 'days')}`
        : `less certain — ${moderate} moderate ${plural(moderate, 'day', 'days')}`;
    } else {
      summary = `Mixed across ${assessable.length} ${plural(assessable.length, 'day', 'days')} — `;
      summary += `${good} good, ${moderate} moderate, ${low} low`;
    }
  }

  return `**Model agreement:** ${summary} (${spreadText}).\n`;
}

function fullDayLabel(date: string, timezone: string): string {
  return DateTime.fromISO(date, { zone: timezone }).toLocaleString({
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
}

function shortDayLabel(date: string, timezone: string): string {
  return DateTime.fromISO(date, { zone: timezone }).toLocaleString({ weekday: 'short' });
}

/**
 * One compact line per day for `detail: "summary"`.
 */
function summaryDayLine(
  day: DayComparison,
  timezone: string,
  tempU: string,
  describeCode: (code: number) => string
): string {
  const label = shortDayLabel(day.date, timezone);
  if (day.participantCount < 2) {
    return `- **${label}:** only ${day.participantCount} ${plural(day.participantCount, 'model', 'models')} with data\n`;
  }
  const conditions = day.bestMatch?.code !== null && day.bestMatch !== null
    ? describeCode(day.bestMatch.code as number)
    : BUCKET_LABELS[day.conditions.bucket];
  const highs = rangeText(day.temperature.high.min, day.temperature.high.max, tempU);
  return `- **${label}:** ${conditions}, high ${highs} — ${day.agreement} agreement\n`;
}

/**
 * Full per-day block for `detail: "standard"` and `"full"` (the D5 sketch).
 */
function standardDayBlock(
  day: DayComparison,
  timezone: string,
  detail: DetailLevel,
  includeProbability: boolean,
  prefs: UnitPreferences,
  describeCode: (code: number) => string
): string {
  const tempU = temperatureLabel(prefs);
  const windU = windSpeedLabel(prefs);
  const precipU = precipitationLabel(prefs);

  // Reduced participation is stated in the heading so a shorter spread is
  // never mistaken for stronger agreement.
  const countSuffix = day.participantCount < day.totalModels
    ? ` (${day.participantCount} of ${day.totalModels} models)`
    : '';
  let output = `## ${fullDayLabel(day.date, timezone)}${countSuffix}\n`;

  if (day.bestMatch) {
    const low = day.bestMatch.low !== null ? ` / Low ${r0(day.bestMatch.low)}${tempU}` : '';
    const conditions = day.bestMatch.code !== null ? ` — ${describeCode(day.bestMatch.code)}` : '';
    output += `**Best match:** High ${r0(day.bestMatch.high)}${tempU}${low}${conditions}\n`;
  }

  // A single model is not a spread. Say so rather than rendering a zero-width
  // range that would read as perfect agreement.
  if (day.participantCount < 2) {
    output += `*Only ${day.participantCount} ${plural(day.participantCount, 'model', 'models')} returned data for this day — no spread to compare.*\n\n`;
    return output;
  }

  let agreementLine = `**Agreement:** ${day.agreement}`;
  if (day.temperature.outlierModel) {
    agreementLine += ` — driven by ${modelShortName(day.temperature.outlierModel)}`;
  } else if (day.temperature.outlierUnnamed) {
    agreementLine += ` — models broadly split`;
  }
  output += `${agreementLine}\n`;

  const high = day.temperature.high;
  let tempLine = `**Temperature (${high.count} ${plural(high.count, 'model', 'models')}):** `;
  tempLine += `high ${rangeText(high.min, high.max, tempU)} (spread ${r0(high.range)}${tempU} — ${day.temperature.band})`;
  if (day.temperature.low.count > 0) {
    tempLine += `, low ${rangeText(day.temperature.low.min, day.temperature.low.max, tempU)}`;
  }
  output += `${tempLine}\n`;

  const precip = day.precipitation;
  if (precip.wetParticipantCount > 0) {
    let precipLine = `**Precipitation:** ${precip.wetCount} of ${precip.wetParticipantCount} models `;
    precipLine += `${plural(precip.wetCount, 'predicts', 'predict')} measurable precipitation`;
    if (precip.wetCount > 0) {
      // The amount range covers only the models predicting precipitation.
      // Including the dry ones would pin every minimum to 0.00 and make a
      // confident 0.20–0.31 in forecast read as "anywhere from nothing".
      // "Wet" is a >= threshold test, so the wetCount largest values are
      // exactly the wet set.
      const wetValues = precip.perModelSum
        .map(v => v.value)
        .sort((a, b) => b - a)
        .slice(0, precip.wetCount);
      precipLine += ` (${precipRangeText(Math.min(...wetValues), Math.max(...wetValues), precipU)})`;
    }
    if (includeProbability && precip.probability && precip.probability.count > 0) {
      precipLine += `; probability ${r0(precip.probability.min)}–${r0(precip.probability.max)}%`;
      precipLine += ` (${precip.probability.count} ${plural(precip.probability.count, 'model', 'models')})`;
    }
    output += `${precipLine}\n`;
  }

  if (day.wind.max.count > 0) {
    output += `**Wind:** max ${rangeText(day.wind.max.min, day.wind.max.max, ` ${windU}`)}\n`;
  }

  if (day.conditions.participantCount > 0) {
    let conditionsLine = `**Conditions:** ${day.conditions.count} of ${day.conditions.participantCount} models `;
    conditionsLine += BUCKET_LABELS[day.conditions.bucket];
    if (day.conditions.dissenters.length > 0) {
      const named = day.conditions.dissenters
        .map(d => `${modelShortName(d.model)}: ${describeCode(d.code)}`)
        .join('; ');
      conditionsLine += `; ${named}`;
    }
    output += `${conditionsLine}\n`;
  }

  // detail="full" adds the per-model values behind each range — still one
  // compact line per variable group, never six full forecasts (D1).
  if (detail === 'full') {
    if (day.temperature.perModelHigh.length > 0) {
      const highs = day.temperature.perModelHigh.map(v => `${modelShortName(v.model)} ${r0(v.value)}`).join(', ');
      output += `**Per-model highs:** ${highs} ${tempU}\n`;
    }
    if (day.temperature.perModelLow.length > 0) {
      const lows = day.temperature.perModelLow.map(v => `${modelShortName(v.model)} ${r0(v.value)}`).join(', ');
      output += `**Per-model lows:** ${lows} ${tempU}\n`;
    }
    if (day.precipitation.perModelSum.length > 0) {
      const sums = day.precipitation.perModelSum.map(v => `${modelShortName(v.model)} ${v.value.toFixed(2)}`).join(', ');
      output += `**Per-model precipitation:** ${sums} ${precipU}\n`;
    }
    if (day.wind.perModel.length > 0) {
      const winds = day.wind.perModel.map(v => `${modelShortName(v.model)} ${r0(v.value)}`).join(', ');
      output += `**Per-model wind:** ${winds} ${windU}\n`;
    }
  }

  output += `\n`;
  return output;
}

/**
 * Format a multi-model agreement comparison for `get_forecast`'s
 * `compare_models` flag (design D5). Summarizes agreement and divergence
 * across the curated global model set — deliberately never N full forecasts.
 *
 * The honest-framing footer follows the FIRMS hotspots-not-incidents / GloFAS
 * model-not-gauge / Fosberg derived-not-official precedents: a tight spread is
 * a proxy for confidence, not a guarantee of accuracy.
 */
async function formatModelComparisonForecast(
  openMeteoService: OpenMeteoService,
  latitude: number,
  longitude: number,
  days: number,
  includeProbability: boolean,
  prefs: UnitPreferences,
  detail: DetailLevel
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const tempU = temperatureLabel(prefs);

  // Contract, not garnish (D7) — a transport failure propagates sanitized
  // rather than degrading to a plain single-model forecast.
  const response = await openMeteoService.getModelComparison(latitude, longitude, days, prefs);

  const comparison = buildModelComparison(response.daily, prefs.temperature, prefs.precipitation);

  // Fewer than 2 surviving comparison models, or nothing left after trimming,
  // is not a comparison — say so rather than render a one-model "spread" (D7).
  const survivingModels = comparison.totalModels - comparison.droppedModels.length;
  if (survivingModels < 2 || comparison.days.length === 0) {
    throw new DataNotFoundError('OpenMeteo', 'Model comparison data is unavailable for this location');
  }

  const timezone = response.timezone;
  const describeCode = (code: number): string => openMeteoService.getWeatherDescription(code);

  const comparedModels = COMPARISON_MODELS.filter(
    m => m !== 'best_match' && !comparison.droppedModels.includes(m)
  );

  let output = `# Weather Forecast (Model Comparison)\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Timezone:** ${timezone}\n`;
  output += `**Forecast Days:** ${days}\n`;
  output += `**Models compared:** ${comparedModels.map(m => MODEL_LONG_NAMES[m] ?? m).join(', ')}\n`;
  output += `**Reference:** Open-Meteo best_match blend\n\n`;

  // Never trust the HTTP 200 — a model can return all-null arrays at a given
  // location (live-verified), and silently comparing four models under a
  // "5 models" heading would overstate the sample.
  if (comparison.droppedModels.length > 0) {
    const dropped = comparison.droppedModels.map(modelShortName).join(', ');
    output += `*${dropped} returned no data for this location and ${plural(comparison.droppedModels.length, 'was', 'were')} excluded.*\n\n`;
  }

  output += overallAgreementLine(comparison, timezone, tempU);
  output += `\n`;

  if (detail === 'summary') {
    for (const day of comparison.days) {
      output += summaryDayLine(day, timezone, tempU, describeCode);
    }
    output += `\n`;
  } else {
    for (const day of comparison.days) {
      output += standardDayBlock(day, timezone, detail, includeProbability, prefs, describeCode);
    }
  }

  if (comparison.trimmedDays > 0) {
    output += `*Note: ${comparison.trimmedDays} further ${plural(comparison.trimmedDays, 'day', 'days')} beyond most models' horizon ${plural(comparison.trimmedDays, 'was', 'were')} omitted*\n\n`;
  }

  // Not every model publishes every product — UKMO has no precipitation
  // probability at all, so a short probability count is expected, not a fault.
  const probabilityShort = comparison.days.some(
    d => d.precipitation.wetParticipantCount > 0 &&
      (d.precipitation.probability?.count ?? 0) < d.precipitation.wetParticipantCount
  );
  if (includeProbability && probabilityShort) {
    output += `*Not every model publishes a precipitation probability (UKMO does not), so probability counts can be lower than the model count.*\n\n`;
  }

  output += `---\n`;
  let footer = `*Data source: Open-Meteo (Global). Compared models: `;
  footer += `${comparedModels.map(modelShortName).join(', ')}; reference line is Open-Meteo's `;
  footer += `best_match blend (not counted in spreads). Forecast spread across models is a proxy `;
  footer += `for uncertainty, not a guarantee — a tight spread can still be wrong. Model run times `;
  footer += `differ and are not shown.`;
  if (isInUS(latitude, longitude)) {
    footer += ` The NOAA/NWS point forecast is not among the compared models.`;
  }
  footer += `*\n`;
  output += footer;

  return { content: [{ type: 'text', text: output }] };
}

/**
 * Overall-confidence sentence shown under the ensemble header. Built
 * deterministically from the per-day labels, mirroring
 * `overallAgreementLine`'s shape: a leading run of high-confidence days is
 * called out where one exists, otherwise the day counts are stated plainly.
 * The widest daily-high interquartile spread is always given so the reader
 * can size the uncertainty themselves.
 */
function ensembleOverallLine(
  result: EnsembleSpreadResult,
  timezone: string,
  tempU: string
): string {
  const days = result.days;
  const assessable = days.filter(d => d.participantCount >= 2);
  const high = assessable.filter(d => d.confidence === 'High').length;
  const moderate = assessable.filter(d => d.confidence === 'Moderate').length;
  const low = assessable.filter(d => d.confidence === 'Low').length;

  if (assessable.length === 0) {
    return `**Forecast confidence:** Not assessable — too few members returned data for these days.\n`;
  }

  const maxSpread = Math.max(...assessable.map(d => d.temperature.high.p75 - d.temperature.high.p25));
  const spreadText = `temperature spread up to ${r0(maxSpread)}${tempU}`;

  let summary: string;
  if (high === assessable.length) {
    summary = `High across all ${assessable.length} ${plural(assessable.length, 'day', 'days')}`;
  } else {
    // Leading run of high-confidence days — the practically useful shape of
    // the answer ("trust the next three days, watch the weekend").
    let run = 0;
    while (run < days.length && days[run].participantCount >= 2 && days[run].confidence === 'High') {
      run++;
    }
    if (run > 0) {
      summary = `High through ${shortDayLabel(days[run - 1].date, timezone)}, then `;
      summary += low > 0
        ? `decreasing — ${low} low-confidence ${plural(low, 'day', 'days')}`
        : `less certain — ${moderate} moderate ${plural(moderate, 'day', 'days')}`;
    } else {
      summary = `Mixed across ${assessable.length} ${plural(assessable.length, 'day', 'days')} — `;
      summary += `${high} high, ${moderate} moderate, ${low} low`;
    }
  }

  return `**Forecast confidence:** ${summary} (${spreadText}).\n`;
}

/**
 * One compact line per day for `detail: "summary"`.
 */
function ensembleSummaryDayLine(
  day: EnsembleDay,
  timezone: string,
  tempU: string,
  describeCode: (code: number) => string
): string {
  const label = shortDayLabel(day.date, timezone);
  if (day.participantCount < 2) {
    return `- **${label}:** only ${day.participantCount} ${plural(day.participantCount, 'member', 'members')} with data\n`;
  }
  // The percentage counts members in the MODAL bucket, so the words it is
  // attached to have to be that bucket's. The control run's nicer wording is
  // borrowed only when the control falls in the modal bucket too — otherwise
  // the line would read "Slight rain (74% of members)" on a day when 74% of
  // members are cloudy and only 26% forecast rain.
  const controlBucket = day.control?.code != null ? weatherCodeBucket(day.control.code) : undefined;
  const conditions = controlBucket === day.conditions.bucket && day.control?.code != null
    ? describeCode(day.control.code)
    : BUCKET_LABELS[day.conditions.bucket];
  const pct = Math.round(day.conditions.percentage);
  const highs = rangeText(day.temperature.high.p25, day.temperature.high.p75, tempU);
  return `- **${label}:** ${conditions} (${pct}% of members), high ${highs} — ${day.confidence} confidence\n`;
}

/**
 * Full per-day block for `detail: "standard"` and `"full"` (the D5 sketch).
 *
 * Every range shown is the p25-p75 interquartile band rather than the
 * absolute envelope: with 50 members the extremes are single outlying runs,
 * so min-max would read as far more uncertainty than the ensemble actually
 * carries. `detail: "full"` adds the absolute envelope as its own line for
 * readers who want it.
 */
function ensembleDayBlock(
  day: EnsembleDay,
  timezone: string,
  detail: DetailLevel,
  prefs: UnitPreferences,
  describeCode: (code: number) => string
): string {
  const tempU = temperatureLabel(prefs);
  const windU = windSpeedLabel(prefs);
  const precipU = precipitationLabel(prefs);

  let output = `## ${fullDayLabel(day.date, timezone)}\n`;

  // The control run is the unperturbed reference, never counted in any
  // spread below (D6). A day whose control is null simply omits the line.
  if (day.control) {
    const low = day.control.low !== null ? ` / Low ${r0(day.control.low)}${tempU}` : '';
    const conditions = day.control.code !== null ? ` — ${describeCode(day.control.code)}` : '';
    output += `**Control run:** High ${r0(day.control.high)}${tempU}${low}${conditions}\n`;
  }

  // One member is not a spread. Say so rather than rendering a zero-width
  // band that would read as perfect confidence.
  if (day.participantCount < 2) {
    output += `*Only ${day.participantCount} ${plural(day.participantCount, 'member', 'members')} returned data for this day — no spread to summarize.*\n\n`;
    return output;
  }

  output += `**Confidence:** ${day.confidence}\n`;

  const high = day.temperature.high;
  let tempLine = `**Temperature (${high.count} ${plural(high.count, 'member', 'members')}):** `;
  tempLine += `high ${rangeText(high.p25, high.p75, tempU)} likely (p25–p75), median ${r0(high.median)}${tempU}`;
  if (day.temperature.low.count > 0) {
    tempLine += `; low ${rangeText(day.temperature.low.p25, day.temperature.low.p75, tempU)} likely`;
  }
  output += `${tempLine}\n`;

  const precip = day.precipitation;
  if (precip.participantCount > 0) {
    const pct = Math.round(precip.fraction * 100);
    let precipLine = `**Precipitation:** ${precip.wetCount} of ${precip.participantCount} members (${pct}%) `;
    precipLine += `produce measurable precipitation`;
    if (precip.wetCount > 0) {
      // Wet members only — including the dry ones would pin every minimum to
      // 0.00 and make a confident 0.05–0.31 in forecast read as "anywhere
      // from nothing" (the inherited compare_models gotcha).
      precipLine += `; ${precipRangeText(precip.amounts.min, precip.amounts.max, precipU)} among those`;
    }
    output += `${precipLine}\n`;
  }

  if (day.wind.max.count > 0) {
    output += `**Wind:** max typically ${rangeText(day.wind.max.p25, day.wind.max.p75, ` ${windU}`)}\n`;
  }

  if (day.conditions.participantCount > 0) {
    const pct = Math.round(day.conditions.percentage);
    let conditionsLine = `**Conditions:** ${pct}% of members ${BUCKET_LABELS[day.conditions.bucket]}`;
    if (day.conditions.runnerUp) {
      conditionsLine += `; ${Math.round(day.conditions.runnerUp.percentage)}% ${BUCKET_LABELS[day.conditions.runnerUp.bucket]}`;
    }
    output += `${conditionsLine}\n`;
  }

  // detail="full" adds the absolute envelope behind the interquartile bands —
  // still one compact line, never fifty member forecasts (D1).
  if (detail === 'full') {
    const parts: string[] = [`high ${rangeText(high.min, high.max, tempU)}`];
    if (day.temperature.low.count > 0) {
      parts.push(`low ${rangeText(day.temperature.low.min, day.temperature.low.max, tempU)}`);
    }
    if (day.wind.max.count > 0) {
      parts.push(`wind up to ${r0(day.wind.max.max)} ${windU}`);
    }
    if (day.precipitation.wetCount > 0) {
      parts.push(`precipitation up to ${day.precipitation.amounts.max.toFixed(2)} ${precipU}`);
    }
    output += `**Full range:** ${parts.join(', ')}\n`;
  }

  output += `\n`;
  return output;
}

/**
 * Format a single-model ensemble spread for `get_forecast`'s
 * `ensemble_spread` flag (design D5). Summarizes the distribution of the
 * model's perturbed members — deliberately never N member forecasts.
 *
 * The honest-framing footer follows the same precedents as the model
 * comparison (FIRMS hotspots-not-incidents, GloFAS model-not-gauge, Fosberg
 * derived-not-official): member fractions are raw model output, not
 * calibrated probabilities, and a confident ensemble can still be wrong.
 */
async function formatEnsembleSpreadForecast(
  openMeteoService: OpenMeteoService,
  latitude: number,
  longitude: number,
  days: number,
  prefs: UnitPreferences,
  detail: DetailLevel
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const tempU = temperatureLabel(prefs);

  // Contract, not garnish (D7) — a transport failure propagates sanitized
  // rather than degrading to a plain single-model forecast.
  const response = await openMeteoService.getEnsembleSpread(latitude, longitude, days, prefs);

  const spread = buildEnsembleSpread(response.daily, prefs.temperature, prefs.precipitation);

  // The pure module stays logger-free, so the defensive member ceiling it
  // reports is logged here (assumption A6).
  if (spread.truncatedMembers) {
    logger.warn('Ensemble member series exceeded the parse ceiling', {
      latitude,
      longitude,
      memberCount: spread.memberCount,
      securityEvent: true
    });
  }

  // Fewer than 2 perturbed members, or nothing left after trimming, is not a
  // spread — say so rather than render a one-member "distribution" (D7).
  if (spread.memberCount < 2 || spread.days.length === 0) {
    throw new DataNotFoundError('OpenMeteo', 'Ensemble spread data is unavailable for this location');
  }

  const timezone = response.timezone;
  const describeCode = (code: number): string => openMeteoService.getWeatherDescription(code);

  let output = `# Weather Forecast (Ensemble Spread)\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Timezone:** ${timezone}\n`;
  output += `**Forecast Days:** ${days}\n`;
  // Member count comes from the response, never from ENSEMBLE_MEMBER_COUNT —
  // a live run can publish a different number than the documentation does.
  output += `**Model:** ${ENSEMBLE_MODEL_LABEL} — ${spread.memberCount} perturbed members + control run\n\n`;

  output += ensembleOverallLine(spread, timezone, tempU);
  output += `\n`;

  if (detail === 'summary') {
    for (const day of spread.days) {
      output += ensembleSummaryDayLine(day, timezone, tempU, describeCode);
    }
    output += `\n`;
  } else {
    for (const day of spread.days) {
      output += ensembleDayBlock(day, timezone, detail, prefs, describeCode);
    }
  }

  if (spread.trimmedDays > 0) {
    output += `*Note: ${spread.trimmedDays} further ${plural(spread.trimmedDays, 'day', 'days')} beyond the model's horizon ${plural(spread.trimmedDays, 'was', 'were')} omitted*\n\n`;
  }

  output += `---\n`;
  let footer = `*Data source: Open-Meteo (Ensemble API). Single-model spread: `;
  footer += `${ENSEMBLE_MODEL_LABEL}, ${spread.memberCount} perturbed members; the control run is `;
  footer += `shown as reference and not counted in spreads. Member fractions are raw model output, `;
  footer += `not calibrated probabilities — a confident ensemble can still be wrong. Confidence `;
  footer += `labels and spread bands are project heuristics.`;
  if (isInUS(latitude, longitude)) {
    footer += ` The NOAA/NWS point forecast is not the model shown.`;
  }
  footer += `*\n`;
  output += footer;

  return { content: [{ type: 'text', text: output }] };
}

/**
 * Convert wind direction degrees to cardinal direction
 */
function getWindDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}
