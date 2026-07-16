/**
 * Handler for get_current_conditions tool
 */

import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { NCEIService } from '../services/ncei.js';
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
  temperatureLabel,
  windSpeedLabel,
  precipitationLabel,
  withLabel,
} from '../utils/unitFormat.js';
import { isInUS } from '../utils/geography.js';
import { UnitPreferences } from '../config/units.js';
import { DisplayThresholds } from '../config/displayThresholds.js';
import {
  getHainesCategory,
  getGrasslandFireDangerCategory,
  getRedFlagCategory,
  getCurrentFireWeatherValue,
  formatMixingHeight,
  interpretTransportWind,
  getFireWeatherContext
} from '../utils/fireWeather.js';
import { extractSnowDepth, formatSnowData, hasWinterWeather } from '../utils/snow.js';
import { formatInTimezone, guessTimezoneFromCoords } from '../utils/timezone.js';
import { getClimateNormals, formatNormals, getDateComponents } from '../utils/normals.js';

interface CurrentConditionsArgs extends UnitArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  include_fire_weather?: boolean;
  include_normals?: boolean;
  source?: 'auto' | 'noaa' | 'openmeteo';
}

export async function handleGetCurrentConditions(
  args: unknown,
  noaaService: NOAAService,
  openMeteoService: OpenMeteoService,
  nceiService: NCEIService,
  locationStore: LocationStore,
  geocodingService: GeocodingService
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

  const output = useNOAA
    ? await formatNOAACurrentConditions(
        noaaService,
        openMeteoService,
        nceiService,
        latitude,
        longitude,
        includeFireWeather,
        includeNormals,
        prefs
      )
    : await formatOpenMeteoCurrentConditions(
        openMeteoService,
        nceiService,
        latitude,
        longitude,
        includeFireWeather,
        includeNormals,
        prefs
      );

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
  prefs: UnitPreferences
): Promise<string> {
  // Get current observation
  const observation = await noaaService.getCurrentConditions(latitude, longitude);
  const props = observation.properties;

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

  // Format current conditions
  let output = `# Current Weather Conditions\n\n`;
  output += `**Station:** ${props.station}\n`;
  output += `**Time:** ${formatInTimezone(props.timestamp, timezone, 'medium', prefs.timeFormat)}\n\n`;

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
    try {
      // Get date components from observation timestamp
      const { month, day } = getDateComponents(props.timestamp);

      // Fetch climate normals using hybrid strategy
      const normals = await getClimateNormals(
        openMeteoService,
        nceiService,
        latitude,
        longitude,
        month,
        day
      );

      // Format and display normals with current temperature for comparison.
      // currentTemps must be in the caller's units to match formatNormals output.
      const toPref = (f: number): number =>
        prefs.temperature === 'C' ? Math.round(((f - 32) * 5) / 9) : Math.round(f);
      const currentTemps = {
        high: max24F !== null ? toPref(max24F) : undefined,
        low: min24F !== null ? toPref(min24F) : undefined
      };

      output += formatNormals(normals, currentTemps, prefs);
    } catch (error) {
      // If normals fetch fails, just skip it (don't error the whole request)
      output += `\n## Climate Normals\n\n`;
      output += `⚠️ Climate normals data not available for this location.\n`;
    }
  }

  output += `\n---\n`;
  output += `*Data source: NOAA National Weather Service*\n`;

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
  prefs: UnitPreferences
): Promise<string> {
  const tempU = temperatureLabel(prefs);
  const windU = windSpeedLabel(prefs);
  const precipU = precipitationLabel(prefs);

  const response = await openMeteoService.getCurrentConditions(latitude, longitude, prefs);
  // getCurrentConditions rejects responses without a `current` block.
  const current = response.current!;
  const timezone = response.timezone;

  let output = `# Current Weather Conditions\n\n`;
  output += `**Time:** ${formatInTimezone(current.time, timezone, 'medium', prefs.timeFormat)}\n\n`;

  if (current.weather_code !== undefined) {
    output += `**Conditions:** ${openMeteoService.getWeatherDescription(current.weather_code)}\n`;
  }

  if (current.temperature_2m !== undefined) {
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

  if (current.relative_humidity_2m !== undefined) {
    output += `**Humidity:** ${Math.round(current.relative_humidity_2m)}%\n`;
  }

  if (current.wind_speed_10m !== undefined) {
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

  // Precipitation section (only when there is something to report)
  const precipDecimals = prefs.precipitation === 'mm' ? 1 : 2;
  if (current.precipitation !== undefined && current.precipitation > 0) {
    output += `\n## Recent Precipitation\n`;
    output += `**Current:** ${withLabel(current.precipitation, precipU, precipDecimals)}\n`;

    if (current.rain !== undefined && current.rain > 0) {
      output += `**Rain:** ${withLabel(current.rain, precipU, precipDecimals)}\n`;
    }
    if (current.showers !== undefined && current.showers > 0) {
      output += `**Showers:** ${withLabel(current.showers, precipU, precipDecimals)}\n`;
    }
    if (current.snowfall !== undefined && current.snowfall > 0) {
      output += `**Snowfall:** ${withLabel(current.snowfall, precipU, precipDecimals)}\n`;
    }
  }

  // Fire Weather section (optional) — indices are US-only for now, so the
  // non-US path makes no NOAA call at all.
  if (includeFireWeather) {
    output += `\n## Fire Weather\n\n`;
    output += `Fire weather indices are currently available for US locations only.\n`;
  }

  // Climate Normals section (optional)
  if (includeNormals) {
    try {
      const { month, day } = getDateComponents(current.time);

      const normals = await getClimateNormals(
        openMeteoService,
        nceiService,
        latitude,
        longitude,
        month,
        day
      );

      // Daily values are already in the caller's units — no conversion needed.
      const currentTemps = {
        high: high !== undefined ? Math.round(high) : undefined,
        low: low !== undefined ? Math.round(low) : undefined
      };

      output += formatNormals(normals, currentTemps, prefs);
    } catch (error) {
      // If normals fetch fails, just skip it (don't error the whole request)
      output += `\n## Climate Normals\n\n`;
      output += `⚠️ Climate normals data not available for this location.\n`;
    }
  }

  output += `\n---\n`;
  output += `*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*\n`;

  return output;
}
