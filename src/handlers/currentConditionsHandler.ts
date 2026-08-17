/**
 * Handler for get_current_conditions tool
 */

import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { NCEIService } from '../services/ncei.js';
import { AcisService } from '../services/acis.js';
import { AviationWeatherService } from '../services/aviationWeather.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateOptionalBoolean } from '../utils/validation.js';
import { convertToFahrenheit } from '../utils/temperatureConversion.js';
import { resolveUnitPreferences, UnitArgs } from '../utils/unitPreferences.js';
import {
  formatTemperatureQV,
  formatWindSpeedQV,
  formatPressureQV,
  formatVisibilityQV,
  formatHeightFromFt,
  formatPrecipFromMm,
  formatPressureFromPa,
  formatTemperatureFromC,
  formatElevationFromM,
  convertWindFromMps,
  convertDistanceFromKm,
  temperatureLabel,
  windSpeedLabel,
  precipitationLabel,
  distanceLabel,
  withLabel,
  snowfallToPrecipUnit,
} from '../utils/unitFormat.js';
import { isInUS } from '../utils/geography.js';
import {
  SEARCH_TIERS,
  pickNearestStation,
  parseVisibilityMiles,
  parseWindDirection,
  type StationPick
} from '../utils/metarStation.js';
import {
  windDirectionFromDegrees,
  relativeHumidityFromDewpoint,
  celsiusToFahrenheit,
  kphToMph,
  mpsToMph,
  knotsToMph
} from '../utils/units.js';
import { milesToKm } from '../utils/distance.js';
import { DataNotFoundError, InvalidLocationError, ServiceUnavailableError } from '../errors/ApiError.js';
import { logger } from '../utils/logger.js';
import { UnitPreferences } from '../config/units.js';
import { DisplayThresholds } from '../config/displayThresholds.js';
import {
  getHainesCategory,
  getGrasslandFireDangerCategory,
  getRedFlagCategory,
  getCurrentFireWeatherValue,
  formatMixingHeight,
  interpretTransportWind,
  getFireWeatherContext,
  calculateFosbergIndex,
  getFosbergCategory,
  describeVpd,
  describeTopsoilMoisture
} from '../utils/fireWeather.js';
import { extractSnowDepth, formatSnowData, hasWinterWeather } from '../utils/snow.js';
import {
  formatInTimezone,
  guessTimezoneFromCoords,
  getTimezoneAbbreviation,
  formatObservationAge
} from '../utils/timezone.js';
import { renderNormalsSection, getDateComponents } from '../utils/normals.js';
import { getRecordsLine } from '../utils/records.js';
import type { ObservationResponse, StationResponse } from '../types/noaa.js';

interface CurrentConditionsArgs extends UnitArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  include_fire_weather?: boolean;
  include_normals?: boolean;
  source?: 'auto' | 'noaa' | 'openmeteo' | 'metar';
}

/** METAR reports wind in knots; every project converter takes m/s. */
const KNOTS_TO_MPS = 0.514444;

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

export async function handleGetCurrentConditions(
  args: unknown,
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService,
  locationStore: LocationStore,
  geocodingService: GeocodingService,
  acisService?: AcisService,
  aviationWeatherService?: AviationWeatherService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Resolve location from coordinates, a saved location name, or a geocoded city name
  const resolved = await resolveLocationAsync(args as CurrentConditionsArgs, locationStore, geocodingService);
  const { latitude, longitude } = resolved;
  const includeFireWeather = validateOptionalBoolean(
    (args as CurrentConditionsArgs)?.include_fire_weather,
    'include_fire_weather',
    false
  );
  const includeNormals = validateOptionalBoolean(
    (args as CurrentConditionsArgs)?.include_normals,
    'include_normals',
    false
  );
  const prefs = resolveUnitPreferences(args as CurrentConditionsArgs);

  // Get source preference or auto-detect (US = NOAA station observations,
  // elsewhere = Open-Meteo model data)
  const requestedSource = (args as CurrentConditionsArgs)?.source || 'auto';
  const useNOAA = requestedSource === 'auto'
    ? isInUS(latitude, longitude)
    : requestedSource === 'noaa';

  let output: string;
  if (requestedSource === 'metar') {
    // METAR is never auto-routed (D1): `auto` keeps its exact US-NOAA /
    // elsewhere-Open-Meteo semantics, and this arm is reached only on an
    // explicit request. A model estimate at the caller's coordinates and a
    // measurement at an airport 40 km away answer different questions.
    if (!aviationWeatherService) {
      throw new ServiceUnavailableError(
        'AviationWeather',
        'METAR station observations are not available in this server configuration.'
      );
    }
    output = await formatMetarCurrentConditions(
      aviationWeatherService,
      openMeteoService,
      nceiService,
      latitude,
      longitude,
      includeFireWeather,
      includeNormals,
      prefs,
      acisService
    );
  } else if (useNOAA) {
    try {
      output = await formatNOAACurrentConditions(
        noaaService,
        openMeteoService,
        nceiService,
        latitude,
        longitude,
        includeFireWeather,
        includeNormals,
        prefs,
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
      output = insertNoteAfterHeading(
        await formatOpenMeteoCurrentConditions(
          openMeteoService,
          nceiService,
          latitude,
          longitude,
          includeFireWeather,
          includeNormals,
          prefs,
          acisService
        ),
        NOAA_FALLBACK_NOTE
      );
    }
  } else {
    output = await formatOpenMeteoCurrentConditions(
      openMeteoService,
      nceiService,
      latitude,
      longitude,
      includeFireWeather,
      includeNormals,
      prefs,
      acisService
    );
  }

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
 * Format current conditions from NOAA station observations (US locations).
 */
async function formatNOAACurrentConditions(
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService,
  latitude: number,
  longitude: number,
  includeFireWeather: boolean,
  includeNormals: boolean,
  prefs: UnitPreferences,
  acisService?: AcisService
): Promise<string> {
  // One station-list fetch drives the freshness loop, the substitution note,
  // and the timezone — replacing the old getCurrentConditions wrapper call
  // plus a separate stations re-fetch for the clock (F2/D2).
  const stations = await noaaService.getStations(latitude, longitude);
  if (!stations.features || stations.features.length === 0) {
    throw new Error('No weather stations found near the specified location.');
  }

  const { staleWarningMinutes, staleAcceptanceMinutes, maxStationAttempts } =
    DisplayThresholds.currentConditions;
  const now = Date.now();

  interface ObservationCandidate {
    observation: ObservationResponse;
    station: StationResponse;
    ageMinutes: number;
  }

  // Walk the gridpoint's stations (nearest first). A fetch error skips to the
  // next station without consuming a retry attempt — the pre-existing error
  // tolerance covered the whole list, and capping it would let this path error
  // where it used to succeed. Only successfully fetched observations count
  // toward maxStationAttempts; the first success (the nearest that answered)
  // is kept as the fallback when nothing fresh turns up.
  let chosen: ObservationCandidate | null = null;
  let fallback: ObservationCandidate | null = null;
  let fetched = 0;
  for (const station of stations.features) {
    if (fetched >= maxStationAttempts) {
      break;
    }
    let obs: ObservationResponse;
    try {
      obs = await noaaService.getLatestObservation(station.properties.stationIdentifier);
    } catch (error) {
      continue; // Today's behavior: a dead station is silently skipped.
    }
    fetched++;
    // Future-dated observations (clock skew) are treated as current.
    const ageMinutes = Math.max(0, Math.round((now - Date.parse(obs.properties.timestamp)) / 60000));
    const candidate: ObservationCandidate = { observation: obs, station, ageMinutes };
    if (fallback === null) {
      fallback = candidate;
    }
    if (ageMinutes <= staleAcceptanceMinutes) {
      chosen = candidate;
      break;
    }
    logger.warn('Stale NOAA observation; trying next station', {
      station: station.properties.stationIdentifier,
      ageMinutes
    });
  }

  const picked = chosen ?? fallback;
  if (!picked) {
    // Every station fetch failed — exactly today's terminal error.
    throw new Error('Unable to retrieve current conditions from nearby stations.');
  }

  const props = picked.observation.properties;

  // Timezone from the chosen station (preferred), else a coordinate guess.
  const timezone = picked.station.properties.timeZone || guessTimezoneFromCoords(latitude, longitude);

  // D2c: a fresh observation from a non-nearest station means the nearest one
  // answered with stale data (it became the fallback candidate) — disclose the
  // substitution. When the literal nearest station's fetch errored instead,
  // there is no timestamp to show, so degrade to "recently". A pure error-skip
  // with no staleness involved stays silent, as today.
  let substitutionNote = '';
  if (chosen && fallback && chosen !== fallback) {
    const nearest = stations.features[0];
    const nearestId = nearest.properties.stationIdentifier;
    const chosenName = `${picked.station.properties.name} (${picked.station.properties.stationIdentifier})`;
    if (fallback.station === nearest) {
      const lastReport = formatInTimezone(
        fallback.observation.properties.timestamp, timezone, 'medium', prefs.timeFormat
      );
      substitutionNote = `*Nearest station (${nearestId}) has not reported since ${lastReport}; showing ${chosenName} instead.*`;
    } else {
      substitutionNote = `*Nearest station (${nearestId}) has not reported recently; showing ${chosenName} instead.*`;
    }
  }

  // Format current conditions
  let output = `# Current Weather Conditions\n\n`;
  output += `**Station:** ${props.station}\n`;
  // D2a: always show the observation's age beside its timestamp.
  output += `**Time:** ${formatInTimezone(props.timestamp, timezone, 'medium', prefs.timeFormat)} (${formatObservationAge(picked.ageMinutes)})\n`;
  if (substitutionNote) {
    output += `\n${substitutionNote}\n`;
  }
  // D2b: warn when even the best available observation is stale.
  if (picked.ageMinutes > staleWarningMinutes) {
    const duration = formatObservationAge(picked.ageMinutes).replace(/ ago$/, '');
    output += `\n⚠️ **This observation is ${duration} old** — the station may have stopped reporting. Conditions may have changed substantially.\n`;
  }
  output += `\n`;

  // Main conditions
  if (props.textDescription) {
    output += `**Conditions:** ${props.textDescription}\n`;
  }

  // Temperature section.
  // Canonical Fahrenheit values drive the display-threshold comparisons; the
  // strings shown to the user are formatted in the caller's preferred unit.
  const tempF = convertToFahrenheit(props.temperature.value, props.temperature.unitCode);
  if (tempF !== null) {
    output += `**Temperature:** ${formatTemperatureQV(props.temperature, prefs)}\n`;

    // Show heat index when temperature is high and heat index is available
    if (props.heatIndex) {
      const heatIndexF = convertToFahrenheit(props.heatIndex.value, props.heatIndex.unitCode);
      if (heatIndexF !== null && tempF > DisplayThresholds.temperature.showHeatIndex && heatIndexF > tempF) {
        output += `**Feels Like (Heat Index):** ${formatTemperatureQV(props.heatIndex, prefs)}\n`;
      }
    }

    // Show wind chill when temperature is low and wind chill is available
    if (props.windChill) {
      const windChillF = convertToFahrenheit(props.windChill.value, props.windChill.unitCode);
      if (windChillF !== null && tempF < DisplayThresholds.temperature.showWindChill && windChillF < tempF) {
        output += `**Feels Like (Wind Chill):** ${formatTemperatureQV(props.windChill, prefs)}\n`;
      }
    }
  }

  // 24-hour temperature range
  const max24F = props.maxTemperatureLast24Hours ? convertToFahrenheit(props.maxTemperatureLast24Hours.value, props.maxTemperatureLast24Hours.unitCode) : null;
  const min24F = props.minTemperatureLast24Hours ? convertToFahrenheit(props.minTemperatureLast24Hours.value, props.minTemperatureLast24Hours.unitCode) : null;
  if (max24F !== null || min24F !== null) {
    let range = `**24-Hour Range:**`;
    if (max24F !== null) range += ` High ${formatTemperatureQV(props.maxTemperatureLast24Hours, prefs)}`;
    if (max24F !== null && min24F !== null) range += ` /`;
    if (min24F !== null) range += ` Low ${formatTemperatureQV(props.minTemperatureLast24Hours, prefs)}`;
    output += `${range}\n`;
  }

  if (props.dewpoint.value !== null) {
    output += `**Dewpoint:** ${formatTemperatureQV(props.dewpoint, prefs)}\n`;
  }

  if (props.relativeHumidity.value !== null) {
    output += `**Humidity:** ${Math.round(props.relativeHumidity.value)}%\n`;
  }

  // Wind section (canonical mph drives the gust-significance comparison)
  if (props.windSpeed && props.windSpeed.value !== null) {
    const windMph = props.windSpeed.unitCode.includes('km_h')
      ? props.windSpeed.value * 0.621371
      : props.windSpeed.value * 2.23694; // m/s to mph
    const windDir = props.windDirection?.value ?? null;
    output += `**Wind:** ${formatWindSpeedQV(props.windSpeed, prefs)}`;
    if (windDir !== null) {
      output += ` from ${Math.round(windDir)}°`;
    }

    // Add wind gust if available and significant
    if (props.windGust && props.windGust.value !== null) {
      const gustMph = props.windGust.unitCode.includes('km_h')
        ? props.windGust.value * 0.621371
        : props.windGust.value * 2.23694;
      if (gustMph > windMph * DisplayThresholds.wind.gustSignificanceRatio) {
        output += `, gusting to ${formatWindSpeedQV(props.windGust, prefs)}`;
      }
    }
    output += `\n`;
  }

  if (props.barometricPressure && props.barometricPressure.value !== null) {
    output += `**Pressure:** ${formatPressureQV(props.barometricPressure, prefs)}\n`;
  }

  // Enhanced visibility and cloud cover (canonical miles drives the descriptors)
  if (props.visibility && props.visibility.value !== null) {
    const visibilityMiles = props.visibility.value * 0.000621371;
    output += `**Visibility:** ${formatVisibilityQV(props.visibility, prefs)}`;

    // Add descriptive text for visibility
    if (visibilityMiles < DisplayThresholds.visibility.denseFog) {
      output += ` (dense fog)`;
    } else if (visibilityMiles < DisplayThresholds.visibility.fog) {
      output += ` (fog)`;
    } else if (visibilityMiles < DisplayThresholds.visibility.hazeMist) {
      output += ` (haze/mist)`;
    } else if (visibilityMiles >= DisplayThresholds.visibility.clear) {
      output += ` (clear)`;
    }
    output += `\n`;
  }

  // Cloud cover details
  if (props.cloudLayers && props.cloudLayers.length > 0) {
    const cloudDescriptions: { [key: string]: string } = {
      'FEW': 'Few clouds',
      'SCT': 'Scattered clouds',
      'BKN': 'Broken clouds',
      'OVC': 'Overcast',
      'CLR': 'Clear',
      'SKC': 'Sky clear'
    };

    const clouds = props.cloudLayers
      .filter(layer => layer.amount)
      .map(layer => {
        const desc = cloudDescriptions[layer.amount] || layer.amount;
        if (layer.base?.value !== null && layer.base?.value !== undefined) {
          const heightFt = layer.base.unitCode.includes('m')
            ? layer.base.value * 3.28084
            : layer.base.value;
          return `${desc} at ${formatHeightFromFt(heightFt, prefs)}`;
        }
        return desc;
      });

    if (clouds.length > 0) {
      output += `**Cloud Cover:** ${clouds.join(', ')}\n`;
    }
  }

  // Precipitation section
  const precip1h = props.precipitationLastHour?.value ?? null;
  const precip3h = props.precipitationLast3Hours?.value ?? null;
  const precip6h = props.precipitationLast6Hours?.value ?? null;

  if (precip1h !== null || precip3h !== null || precip6h !== null) {
    output += `\n## Recent Precipitation\n`;

    if (precip1h !== null && props.precipitationLastHour) {
      const mm = props.precipitationLastHour.unitCode.includes('mm') ? precip1h : precip1h * 25.4;
      output += `**Last Hour:** ${formatPrecipFromMm(mm, prefs)}\n`;
    }

    if (precip3h !== null && props.precipitationLast3Hours) {
      const mm = props.precipitationLast3Hours.unitCode.includes('mm') ? precip3h : precip3h * 25.4;
      output += `**Last 3 Hours:** ${formatPrecipFromMm(mm, prefs)}\n`;
    }

    if (precip6h !== null && props.precipitationLast6Hours) {
      const mm = props.precipitationLast6Hours.unitCode.includes('mm') ? precip6h : precip6h * 25.4;
      output += `**Last 6 Hours:** ${formatPrecipFromMm(mm, prefs)}\n`;
    }
  }

  // Winter Weather section (snow depth if available)
  const snowDepth = extractSnowDepth(props);
  if (snowDepth) {
    const snowData = { snowDepth };
    if (hasWinterWeather(snowData)) {
      output += formatSnowData(snowData);
    }
  }

  // Fire Weather section (optional)
  if (includeFireWeather) {
    try {
      const gridpointData = await noaaService.getGridpointDataByCoordinates(latitude, longitude);
      const fireProps = gridpointData.properties;

      // Check if any fire weather data is available
      const hainesValue = getCurrentFireWeatherValue(fireProps.hainesIndex);
      const grasslandValue = getCurrentFireWeatherValue(fireProps.grasslandFireDangerIndex);
      const redFlagValue = getCurrentFireWeatherValue(fireProps.redFlagThreatIndex);
      const mixingHeightValue = getCurrentFireWeatherValue(fireProps.mixingHeight);
      const transportWindValue = getCurrentFireWeatherValue(fireProps.transportWindSpeed);

      // Get fire weather context
      const context = getFireWeatherContext(
        latitude,
        longitude,
        props.timestamp,
        hainesValue,
        grasslandValue,
        redFlagValue,
        props.relativeHumidity?.value ?? null
      );

      output += `\n## Fire Weather\n\n`;

      // If no fire danger indices, show contextual explanation
      if (!context.hasIndices) {
        const riskEmoji = context.seasonalRisk === 'Low' ? 'ℹ️' :
                         context.seasonalRisk === 'Moderate' ? '🟡' :
                         context.seasonalRisk === 'Elevated' ? '🟠' : '🔴';
        output += `${riskEmoji} **Seasonal Fire Risk:** ${context.seasonalRisk}\n`;
        output += `${context.explanatoryText}\n\n`;
      }

      // Display fire danger indices if available
      // Haines Index
      if (hainesValue !== null) {
        const hainesCategory = getHainesCategory(hainesValue);
        const emoji = hainesCategory.level === 'Low' ? '🟢' :
                      hainesCategory.level === 'Moderate' ? '🟡' :
                      hainesCategory.level === 'High' ? '🟠' : '🔴';

        output += `**${emoji} Haines Index:** ${hainesValue} (${hainesCategory.level})\n`;
        output += `${hainesCategory.fireGrowthPotential}\n\n`;
      }

      // Grassland Fire Danger Index
      if (grasslandValue !== null) {
        const grasslandCategory = getGrasslandFireDangerCategory(grasslandValue);
        const emoji = grasslandCategory.level === 'Low' ? '🟢' :
                      grasslandCategory.level === 'Moderate' ? '🟡' :
                      grasslandCategory.level === 'High' ? '🟠' : '🔴';

        output += `**${emoji} Grassland Fire Danger:** ${grasslandValue} (${grasslandCategory.level})\n`;
        output += `${grasslandCategory.description}\n\n`;
      }

      // Red Flag Threat Index
      if (redFlagValue !== null) {
        const redFlagCategory = getRedFlagCategory(redFlagValue);
        const emoji = redFlagCategory.level === 'Low' ? '🟢' :
                      redFlagCategory.level === 'Moderate' ? '🟡' :
                      redFlagCategory.level === 'High' ? '🟠' : '🔴';

        output += `**${emoji} Red Flag Threat:** ${Math.round(redFlagValue)} (${redFlagCategory.level})\n`;
        output += `${redFlagCategory.description}\n\n`;
      }

      // Atmospheric monitoring (always show if available)
      if (mixingHeightValue !== null || transportWindValue !== null) {
        if (!context.hasIndices) {
          output += `**Atmospheric Monitoring:**\n`;
        }

        // Mixing Height (important for smoke dispersion)
        if (mixingHeightValue !== null) {
          const mixingHeightFt = mixingHeightValue; // Already in feet from API
          output += `**Mixing Height:** ${formatMixingHeight(mixingHeightFt)}\n`;
        }

        // Transport Wind Speed (smoke transport)
        if (transportWindValue !== null) {
          output += `**Transport Wind:** ${interpretTransportWind(transportWindValue)}\n`;
        }

        if (!context.hasIndices) {
          output += `\n*Fire danger indices (Haines Index, Grassland Fire Danger, Red Flag Threat) are calculated during elevated fire risk periods, typically during dry seasons or when Red Flag conditions are possible.*\n`;
        }
      } else if (!context.hasIndices) {
        // No data at all available
        output += `No atmospheric monitoring data available for this location.\n`;
      }
    } catch (error) {
      // If fire weather data fetch fails, just skip it (don't error the whole request)
      output += `\n## Fire Weather\n\n`;
      output += `⚠️ Fire weather data not available for this location.\n`;
    }
  }

  // Climate Normals section (optional)
  if (includeNormals) {
    // Get date components from observation timestamp
    const { month, day } = getDateComponents(props.timestamp);

    // currentTemps must be in the caller's units to match the rendered normals.
    const toPref = (f: number): number =>
      prefs.temperature === 'C' ? Math.round(((f - 32) * 5) / 9) : Math.round(f);
    const currentTemps = {
      high: max24F !== null ? toPref(max24F) : undefined,
      low: min24F !== null ? toPref(min24F) : undefined
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
        // must never fail the primary current-conditions response.
      }
    }
  }

  output += `\n---\n`;
  output += `*Data source: NOAA National Weather Service*\n`;

  return output;
}

/**
 * Normalize a temperature that arrived in the caller's preferred unit back to
 * the fixed °F the Fosberg index requires.
 *
 * Open-Meteo converts server-side (`openMeteoUnitParams`), so the response
 * carries the caller's units. Normalizing here rather than issuing a second
 * fixed-unit fetch is design decision D4.
 */
function prefsTempToFahrenheit(value: number, prefs: UnitPreferences): number {
  return prefs.temperature === 'C' ? celsiusToFahrenheit(value) : value;
}

/** Normalize a wind speed from the caller's preferred unit to fixed mph (D4). */
function prefsWindToMph(value: number, prefs: UnitPreferences): number {
  switch (prefs.windSpeed) {
    case 'kmh':
      return kphToMph(value);
    case 'ms':
      return mpsToMph(value);
    case 'kn':
      return knotsToMph(value);
    default:
      return value;
  }
}

/**
 * Render the Fire Weather section for the Open-Meteo (model) path: a Fosberg
 * Fire Weather Index computed by this server from current values, plus dryness
 * context (D5), carrying the derivation disclosure (D6).
 *
 * `getFireWeatherContext` — US geography boxes and northern-hemisphere
 * seasonality — is deliberately never called here; the index reflects actual
 * current conditions and is hemisphere-proof by construction.
 *
 * Sustained wind feeds the index; gusts are display context only and are
 * already rendered above, so inputs are not repeated in this section.
 */
function formatOpenMeteoFireWeather(
  temperature: number | null | undefined,
  relativeHumidity: number | null | undefined,
  windSpeed: number | null | undefined,
  vpdKPa: number | null | undefined,
  topsoilMoisture: number | null | undefined,
  prefs: UnitPreferences
): string {
  let output = `\n## Fire Weather\n\n`;

  const ffwi =
    temperature != null && relativeHumidity != null && windSpeed != null
      ? calculateFosbergIndex(
          prefsTempToFahrenheit(temperature, prefs),
          relativeHumidity,
          prefsWindToMph(windSpeed, prefs)
        )
      : NaN;

  if (!Number.isFinite(ffwi)) {
    output += `⚠️ Fire weather inputs unavailable for this location.\n`;
    return output;
  }

  // Categorize the displayed (rounded) value so the number and the label
  // never disagree at a band edge.
  const index = Math.round(ffwi);
  const category = getFosbergCategory(index);
  const emoji =
    category.level === 'Low' ? '🟢' :
    category.level === 'Moderate' ? '🟡' :
    category.level === 'High' ? '🟠' : '🔴';

  output += `**${emoji} Fosberg Fire Weather Index:** ${index} (${category.level})\n`;
  output += `Computed from current temperature, humidity, and sustained wind. Higher values mean faster potential fire spread in fine fuels.\n\n`;

  // Open ocean returns HTTP 200 with null dryness fields (Flood-API
  // precedent): omit the line, or the whole block when both are missing.
  const hasVpd = vpdKPa !== undefined && vpdKPa !== null && Number.isFinite(vpdKPa);
  const hasSoil =
    topsoilMoisture !== undefined && topsoilMoisture !== null && Number.isFinite(topsoilMoisture);

  if (hasVpd || hasSoil) {
    output += `**Dryness context:**\n`;
    if (hasVpd) {
      output += `- **Vapour-pressure deficit:** ${vpdKPa!.toFixed(1)} kPa (${describeVpd(vpdKPa!)})\n`;
    }
    if (hasSoil) {
      output += `- **Topsoil moisture (top 1 cm):** ${topsoilMoisture!.toFixed(2)} m³/m³ (${describeTopsoilMoisture(topsoilMoisture!)})\n`;
    }
    output += `\n`;
  }

  output += `*Derived by this server from Open-Meteo model data — not an official fire-danger rating. Heed warnings from your national fire authority.*\n`;

  return output;
}

/**
 * Format current conditions from Open-Meteo model data (non-US locations).
 *
 * Values arrive already in the caller's preferred units (Open-Meteo converts
 * server-side), so they are formatted with the plain-number helpers rather than
 * the NOAA QuantitativeValue helpers. There is no station: the data-source
 * footer carries the model-interpolated caveat instead.
 */
async function formatOpenMeteoCurrentConditions(
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService,
  latitude: number,
  longitude: number,
  includeFireWeather: boolean,
  includeNormals: boolean,
  prefs: UnitPreferences,
  acisService?: AcisService
): Promise<string> {
  const tempU = temperatureLabel(prefs);
  const windU = windSpeedLabel(prefs);
  const precipU = precipitationLabel(prefs);

  const response = await openMeteoService.getCurrentConditions(
    latitude,
    longitude,
    prefs,
    includeFireWeather
  );
  // getCurrentConditions rejects responses without a `current` block.
  const current = response.current!;
  const timezone = response.timezone;

  let output = `# Current Weather Conditions\n\n`;
  output += `**Time:** ${formatInTimezone(current.time, timezone, 'medium', prefs.timeFormat)}\n\n`;

  if (current.weather_code !== undefined) {
    output += `**Conditions:** ${openMeteoService.getWeatherDescription(current.weather_code)}\n`;
  }

  if (current.temperature_2m != null) {
    output += `**Temperature:** ${Math.round(current.temperature_2m)}${tempU}\n`;

    // Feels-like only earns a line when it diverges meaningfully from actual.
    // The gap is unit-keyed: these values are already in the caller's unit.
    if (current.apparent_temperature !== undefined) {
      const gap = DisplayThresholds.temperature.feelsLikeGap[prefs.temperature];
      if (Math.abs(current.apparent_temperature - current.temperature_2m) > gap) {
        output += `**Feels Like:** ${Math.round(current.apparent_temperature)}${tempU}\n`;
      }
    }
  }

  // Today's range from the single-day daily block
  const high = response.daily?.temperature_2m_max?.[0];
  const low = response.daily?.temperature_2m_min?.[0];
  if (high !== undefined || low !== undefined) {
    let range = `**Today's Range:**`;
    if (high !== undefined) range += ` High ${Math.round(high)}${tempU}`;
    if (high !== undefined && low !== undefined) range += ` /`;
    if (low !== undefined) range += ` Low ${Math.round(low)}${tempU}`;
    output += `${range}\n`;
  }

  if (current.dew_point_2m !== undefined) {
    output += `**Dewpoint:** ${Math.round(current.dew_point_2m)}${tempU}\n`;
  }

  if (current.relative_humidity_2m != null) {
    output += `**Humidity:** ${Math.round(current.relative_humidity_2m)}%\n`;
  }

  if (current.wind_speed_10m != null) {
    output += `**Wind:** ${Math.round(current.wind_speed_10m)} ${windU}`;
    if (current.wind_direction_10m !== undefined) {
      output += ` from ${Math.round(current.wind_direction_10m)}°`;
    }
    if (
      current.wind_gusts_10m !== undefined &&
      current.wind_gusts_10m > current.wind_speed_10m * DisplayThresholds.wind.gustSignificanceRatio
    ) {
      output += `, gusting to ${Math.round(current.wind_gusts_10m)} ${windU}`;
    }
    output += `\n`;
  }

  if (current.pressure_msl !== undefined) {
    // Pressure is the one field Open-Meteo does NOT convert: openMeteoUnitParams
    // only carries temperature/wind/precipitation, so pressure_msl always comes
    // back in hPa regardless of preference. Convert it here (hPa -> Pa -> prefs).
    output += `**Pressure:** ${formatPressureFromPa(current.pressure_msl * 100, prefs)}\n`;
  }

  if (current.cloud_cover !== undefined) {
    output += `**Cloud Cover:** ${Math.round(current.cloud_cover)}%\n`;
  }

  // Precipitation section (only when there is something worth reporting).
  // Gated on a trace floor rather than `> 0`: raw drizzle otherwise renders
  // an all-zero section at display precision (e.g. "**Current:** 0.00 in").
  const precipDecimals = prefs.precipitation === 'mm' ? 1 : 2;
  const traceFloor = DisplayThresholds.precipitation.traceFloor[prefs.precipitation];
  // Snowfall is the other field (besides pressure_msl) that Open-Meteo does
  // not convert to the caller's precipitation unit — it reports cm unless
  // precipitation_unit=inch was requested. Convert before display/comparison
  // so the label and the trace-floor check both operate on the shown value.
  const snowfall = current.snowfall !== undefined
    ? snowfallToPrecipUnit(current.snowfall, prefs)
    : undefined;
  if (current.precipitation !== undefined && current.precipitation >= traceFloor) {
    output += `\n## Recent Precipitation\n`;
    output += `**Current:** ${withLabel(current.precipitation, precipU, precipDecimals)}\n`;

    if (current.rain !== undefined && current.rain >= traceFloor) {
      output += `**Rain:** ${withLabel(current.rain, precipU, precipDecimals)}\n`;
    }
    if (current.showers !== undefined && current.showers >= traceFloor) {
      output += `**Showers:** ${withLabel(current.showers, precipU, precipDecimals)}\n`;
    }
    if (snowfall !== undefined && snowfall >= traceFloor) {
      output += `**Snowfall:** ${withLabel(snowfall, precipU, precipDecimals)}\n`;
    }
  }

  // Fire Weather section (optional) — a server-computed Fosberg index off the
  // model values already in hand; this path never makes a NOAA call.
  if (includeFireWeather) {
    output += formatOpenMeteoFireWeather(
      current.temperature_2m,
      current.relative_humidity_2m,
      current.wind_speed_10m,
      current.vapour_pressure_deficit,
      current.soil_moisture_0_to_1cm,
      prefs
    );
  }

  // Climate Normals section (optional)
  if (includeNormals) {
    const { month, day } = getDateComponents(current.time);

    // Daily values are already in the caller's units — no conversion needed.
    const currentTemps = {
      high: high !== undefined ? Math.round(high) : undefined,
      low: low !== undefined ? Math.round(low) : undefined
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
    // This site is reachable for a US point via explicit source="openmeteo".
    if (isInUS(latitude, longitude) && acisService) {
      try {
        const recordsLine = await getRecordsLine(acisService, latitude, longitude, month, day, prefs);
        if (recordsLine) {
          output += `\n${recordsLine}\n`;
        }
      } catch (error) {
        // getRecordsLine never throws, but stay defensive per D4 — records
        // must never fail the primary current-conditions response.
      }
    }
  }

  output += `\n---\n`;
  output += `*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*\n`;

  return output;
}

/** Sky cover abbreviations as they appear in the decoded `clouds[].cover` field. */
const METAR_CLOUD_COVER: Record<string, string> = {
  SKC: 'Sky clear',
  CLR: 'Clear',
  NCD: 'No cloud detected',
  NSC: 'No significant cloud',
  FEW: 'Few clouds',
  SCT: 'Scattered clouds',
  BKN: 'Broken clouds',
  OVC: 'Overcast',
  OVX: 'Obscured'
};

/**
 * Present-weather abbreviations from the `wxString` field. Only the codes
 * that actually appear with any frequency are decoded; anything else falls
 * through as the raw token, which is still meaningful to a pilot and honest
 * to everyone else.
 */
const METAR_WEATHER_CODES: Record<string, string> = {
  BR: 'mist', FG: 'fog', FU: 'smoke', HZ: 'haze', DU: 'dust', SA: 'sand',
  VA: 'volcanic ash', PY: 'spray', PO: 'dust whirls', SQ: 'squalls',
  FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm',
  DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals',
  PL: 'ice pellets', GR: 'hail', GS: 'small hail', UP: 'unknown precipitation',
  TS: 'thunderstorm', SH: 'showers', FZ: 'freezing', BL: 'blowing',
  DR: 'drifting', MI: 'shallow', BC: 'patches', PR: 'partial'
};

/**
 * Decode a `wxString` such as `-RA BR` or `+TSRA` into readable text.
 * Intensity prefixes and the `VC` (vicinity) qualifier are handled; the
 * two-letter codes are then decoded in order and joined.
 */
function describeMetarWeather(wxString: string): string {
  const groups = wxString.trim().split(/\s+/).filter(Boolean);

  const described = groups.map(group => {
    let rest = group;
    const qualifiers: string[] = [];

    if (rest.startsWith('-')) {
      qualifiers.push('light');
      rest = rest.slice(1);
    } else if (rest.startsWith('+')) {
      qualifiers.push('heavy');
      rest = rest.slice(1);
    }
    if (rest.startsWith('VC')) {
      qualifiers.push('in the vicinity');
      rest = rest.slice(2);
    }

    const parts: string[] = [];
    for (let i = 0; i + 1 < rest.length + 1; i += 2) {
      const code = rest.slice(i, i + 2);
      if (code.length < 2) break;
      parts.push(METAR_WEATHER_CODES[code] ?? code);
    }

    if (parts.length === 0) return group;

    // "in the vicinity" reads as a suffix; intensity reads as a prefix.
    const vicinity = qualifiers.includes('in the vicinity');
    const intensity = qualifiers.filter(q => q !== 'in the vicinity');
    const body = [...intensity, ...parts].join(' ');
    return vicinity ? `${body} in the vicinity` : body;
  });

  const joined = described.join(', ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** Render the sky-condition layers, low to high, with bases in the caller's unit. */
function formatMetarSky(pick: StationPick, prefs: UnitPreferences): string | undefined {
  const clouds = pick.observation.clouds;
  if (!clouds || clouds.length === 0) return undefined;

  const layers = clouds.map(layer => {
    const description = METAR_CLOUD_COVER[layer.cover] ?? layer.cover;
    // `base` is feet AGL — verified against the raw text (SCT110 -> 11000).
    return layer.base === undefined
      ? description
      : `${description} at ${formatHeightFromFt(layer.base, prefs)}`;
  });

  return layers.join(', ');
}

/** Message shown when no station within any search tier can answer for this point. */
function noStationMessage(prefs: UnitPreferences): string {
  const far = withLabel(convertDistanceFromKm(250, prefs), distanceLabel(prefs), 0);

  let output = `# Current Conditions — No Station Nearby\n\n`;
  output += `ℹ️ **No reporting station near this location**\n\n`;
  output += `The nearest METAR station is more than ${far} away, or has not `;
  output += `reported in the last 6 hours. METAR coverage follows airports, so `;
  output += `remote land and open ocean have real gaps.\n\n`;
  output += `**Tip:** use \`source: "openmeteo"\` for model-interpolated conditions `;
  output += `at these exact coordinates. Those are an estimate rather than a `;
  output += `measurement, which is why they are not substituted automatically here.\n`;
  output += `\n---\n`;
  output += `*Data source: NOAA Aviation Weather Center (aviationweather.gov) — METAR station observation*\n`;

  return output;
}

/**
 * Format current conditions from a METAR station observation (worldwide).
 *
 * Station identity, distance, and observation age are not decoration on this
 * path — they are what makes the number interpretable. A METAR is a real
 * instrument reading, but it was taken at an airport that may be tens of
 * kilometres away, up to an hour ago. All three are always shown.
 *
 * See docs/metar-plan.md D5 (output) and D6 (units).
 */
async function formatMetarCurrentConditions(
  aviationWeatherService: AviationWeatherService,
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService,
  latitude: number,
  longitude: number,
  includeFireWeather: boolean,
  includeNormals: boolean,
  prefs: UnitPreferences,
  acisService?: AcisService
): Promise<string> {
  // Widen the search only as far as it has to go. Each tier is a superset of
  // the last, so a wider box can only find a nearer or fresher station; the
  // picker stays pure and this loop supplies the I/O (assumption A9).
  const now = new Date();
  let pick: StationPick | null = null;

  for (const tier of SEARCH_TIERS) {
    const stations = await aviationWeatherService.getMetarsInBoundingBox({
      minLat: latitude - tier,
      minLon: longitude - tier,
      maxLat: latitude + tier,
      maxLon: longitude + tier
    });

    pick = pickNearestStation(stations, latitude, longitude, now, tier);
    if (pick) break;
  }

  if (!pick) {
    logger.info('No usable METAR station within any search tier', {
      widestTierDegrees: SEARCH_TIERS[SEARCH_TIERS.length - 1]
    });
    return noStationMessage(prefs);
  }

  const obs = pick.observation;
  // The station's clock, not the caller's — matching how the NOAA path derives
  // its own. obsTime is epoch seconds, not milliseconds and not an ISO string.
  const timezone = guessTimezoneFromCoords(obs.lat, obs.lon);
  const observedIso = new Date(obs.obsTime * 1000).toISOString();

  let output = `# Current Conditions — ${obs.name} (${obs.icaoId})\n\n`;

  const distance = withLabel(convertDistanceFromKm(pick.distanceKm, prefs), distanceLabel(prefs), 0);
  output += `**Station:** ${obs.name} (${obs.icaoId}) — ${distance} ${pick.bearing} `;
  output += `of the requested point, elev ${formatElevationFromM(obs.elev, prefs)}\n`;

  const age = formatObservationAge(pick.ageMinutes);
  // The zone abbreviation is spelled out here, unlike the other two paths,
  // because this clock is the *station's* rather than the requested point's —
  // an unlabeled time would be ambiguous exactly where the station is distant.
  const zoneLabel = getTimezoneAbbreviation(timezone, new Date(obs.obsTime * 1000));
  output += `**Observed:** ${formatInTimezone(observedIso, timezone, 'medium', prefs.timeFormat)}`;
  output += `${zoneLabel ? ` ${zoneLabel}` : ''} (${age})\n`;

  // Caveats, each only when it applies. These are the difference between a
  // number a reader can trust and one they cannot.
  if (pick.far) {
    output += `\n⚠️ **Nearest station is ${distance} away** — conditions at your `;
    output += `exact location may differ substantially.\n`;
  }
  if (pick.stale) {
    output += `\n⚠️ **Observation is ${age}** — no station nearby has reported more recently.\n`;
  }
  if (obs.metarType === 'SPECI') {
    output += `\n**Special report (SPECI):** issued off the hourly cycle because `;
    output += `conditions changed significantly.\n`;
  }

  output += `\n`;

  // --- Measurements (D6 units). Absent fields are omitted, never blanked:
  // wgst appears in 14% of reports and wxString in 8%, so sparse is normal.
  if (obs.temp !== undefined) {
    const extras: string[] = [];
    if (obs.dewp !== undefined) {
      extras.push(`dew point ${formatTemperatureFromC(obs.dewp, prefs)}`);
      extras.push(`humidity ${relativeHumidityFromDewpoint(obs.temp, obs.dewp)}%`);
    }
    output += `**Temperature:** ${formatTemperatureFromC(obs.temp, prefs)}`;
    output += extras.length > 0 ? ` (${extras.join(', ')})\n` : `\n`;
  } else if (obs.dewp !== undefined) {
    output += `**Dew Point:** ${formatTemperatureFromC(obs.dewp, prefs)}\n`;
  }

  // Wind: knots natively, so kt -> m/s -> the caller's unit.
  const windDirection = parseWindDirection(obs.wdir);
  if (obs.wspd !== undefined) {
    const speed = withLabel(
      convertWindFromMps(obs.wspd * KNOTS_TO_MPS, prefs),
      windSpeedLabel(prefs),
      0
    );

    let wind: string;
    if (windDirection === 'variable') {
      // No compass point for a wind that has no direction.
      wind = `Variable at ${speed}`;
    } else if (windDirection !== undefined) {
      wind = `${windDirectionFromDegrees(windDirection)} (${Math.round(windDirection)}°) at ${speed}`;
    } else {
      wind = speed;
    }

    if (obs.wgst !== undefined) {
      wind += `, gusting to ${withLabel(
        convertWindFromMps(obs.wgst * KNOTS_TO_MPS, prefs),
        windSpeedLabel(prefs),
        0
      )}`;
    }

    output += `**Wind:** ${wind}\n`;
  }

  // Visibility: statute miles natively. The "+" qualifier is a floor, not a
  // measurement, so it survives conversion as a leading "+".
  const visibility = parseVisibilityMiles(obs.visib);
  if (visibility) {
    const value = convertDistanceFromKm(milesToKm(visibility.miles), prefs);
    const decimals = value < 10 ? 1 : 0;
    const shown = withLabel(value, distanceLabel(prefs), decimals);
    output += `**Visibility:** ${visibility.qualifier === 'plus' ? '+' : ''}${shown}\n`;
  }

  const sky = formatMetarSky(pick, prefs);
  if (sky) {
    output += `**Sky:** ${sky}\n`;
  }

  if (obs.wxString) {
    output += `**Weather:** ${describeMetarWeather(obs.wxString)}\n`;
  }

  // Pressure: hPa natively, so hPa -> Pa -> the caller's unit.
  if (obs.altim !== undefined) {
    output += `**Pressure:** ${formatPressureFromPa(obs.altim * 100, prefs)}`;
    output += obs.slp !== undefined
      ? ` (sea level ${formatPressureFromPa(obs.slp * 100, prefs)})\n`
      : `\n`;
  } else if (obs.slp !== undefined) {
    output += `**Pressure:** ${formatPressureFromPa(obs.slp * 100, prefs)} (sea level)\n`;
  }

  if (obs.fltCat) {
    output += `**Flight category:** ${obs.fltCat}\n`;
  }

  // The observation of record. This is the pilot-facing value, shipped without
  // a pilot-facing tool.
  output += `\n\`${obs.rawOb}\`\n`;

  // Fire weather (optional) — needs NOAA gridpoint inputs (transport wind,
  // Haines) that a METAR simply does not carry, so it is named rather than
  // silently dropped (D7).
  if (includeFireWeather) {
    output += `\n## Fire Weather\n\n`;
    output += `Fire weather indices are not available on the METAR source — they `;
    output += `require NOAA gridpoint data. Use \`source: "noaa"\` for a US location, `;
    output += `or omit \`source\` to get a server-computed Fosberg index from model data elsewhere.\n`;
  }

  // Climate normals (optional) — supported here exactly as on the other two
  // paths (D7): they need only the coordinates and the date.
  if (includeNormals) {
    const { month, day } = getDateComponents(observedIso);

    // No comparable station high/low on this path — normals render on their own.
    output += await renderNormalsSection(
      openMeteoService,
      nceiService,
      latitude,
      longitude,
      month,
      day,
      {},
      prefs
    );

    // US temperature records, independent of the normals fetch above — either
    // can render without the other. Non-US makes no ACIS request at all.
    if (isInUS(latitude, longitude) && acisService) {
      try {
        const recordsLine = await getRecordsLine(acisService, latitude, longitude, month, day, prefs);
        if (recordsLine) {
          output += `\n${recordsLine}\n`;
        }
      } catch (error) {
        // getRecordsLine never throws, but records must never fail the
        // primary response.
      }
    }
  }

  output += `\n---\n`;
  output += `*Data source: NOAA Aviation Weather Center (aviationweather.gov) — METAR station observation*\n`;

  return output;
}
