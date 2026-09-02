/**
 * Handler for get_air_quality tool
 */

import { OpenMeteoService } from '../services/openmeteo.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateOptionalBoolean, validatePositiveInteger } from '../utils/validation.js';
import {
  getUSAQICategory,
  getEuropeanAQICategory,
  getUVIndexCategory,
  getPollutantInfo,
  formatPollutantConcentration,
  shouldUseUSAQI
} from '../utils/airQuality.js';
import type { AQICategory, UVIndexCategory } from '../utils/airQuality.js';
import { displayValue } from '../utils/displayBanding.js';
import type {
  OpenMeteoAirQualityResponse,
  OpenMeteoAirQualityHourlyData,
  OpenMeteoAirQualityCurrentData
} from '../types/openmeteo.js';
import type { GooglePollenService } from '../services/googlePollen.js';
import { GooglePollenKeyRejectedError } from '../services/googlePollen.js';
import type { GooglePollenDailyInfo } from '../types/googlePollen.js';
import { logger } from '../utils/logger.js';

interface AirQualityArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  forecast?: boolean;
  forecast_days?: number;
}

const DEFAULT_FORECAST_DAYS = 5;
const MAX_FORECAST_DAYS = 7; // Open-Meteo air quality API limit (168 hours)

/** Round an AQI the way every render site prints it (Math.round) and band that figure. */
function bandAqi(raw: number, useUSAQI: boolean): { shown: number; category: AQICategory } {
  const shown = Math.round(raw);
  return { shown, category: useUSAQI ? getUSAQICategory(shown) : getEuropeanAQICategory(shown) };
}

/** Same for UV: `decimals` is what the render site passes to toFixed (0 => Math.round). */
function bandUv(raw: number, decimals: 0 | 1): { shown: number; category: UVIndexCategory } {
  const shown = decimals === 0 ? Math.round(raw) : displayValue(raw, decimals);
  return { shown, category: getUVIndexCategory(shown) };
}

/**
 * The six CAMS European-model pollen species, filtered to those carrying a
 * real number. Non-European points return HTTP 200 with every species null,
 * so an empty result is the "no CAMS coverage here" signal — shared by the
 * render block and the Google-fallback trigger so the two can never drift
 * (design plan D1).
 */
function finiteCamsPollen(
  current: OpenMeteoAirQualityCurrentData
): Array<{ label: string; value: number }> {
  return [
    { label: 'Alder', value: current.alder_pollen },
    { label: 'Birch', value: current.birch_pollen },
    { label: 'Grass', value: current.grass_pollen },
    { label: 'Mugwort', value: current.mugwort_pollen },
    { label: 'Olive', value: current.olive_pollen },
    { label: 'Ragweed', value: current.ragweed_pollen }
  ].filter(
    (species): species is { label: string; value: number } =>
      typeof species.value === 'number' && Number.isFinite(species.value)
  );
}

export async function handleGetAirQuality(
  args: unknown,
  openMeteoService: OpenMeteoService,
  locationStore: LocationStore,
  geocodingService: GeocodingService,
  googlePollenService?: GooglePollenService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Resolve location from coordinates, a saved location name, or a geocoded city name
  const resolved = await resolveLocationAsync(args as AirQualityArgs, locationStore, geocodingService);
  const { latitude, longitude } = resolved;
  const forecast = validateOptionalBoolean(
    (args as AirQualityArgs)?.forecast,
    'forecast',
    false
  );
  const rawForecastDays = (args as AirQualityArgs)?.forecast_days;
  const forecastDays = rawForecastDays === undefined
    ? DEFAULT_FORECAST_DAYS
    : validatePositiveInteger(rawForecastDays, 'forecast_days', 1, MAX_FORECAST_DAYS);

  // Get air quality data
  const airQualityData = await openMeteoService.getAirQuality(
    latitude,
    longitude,
    forecast,
    forecastDays
  );

  // Optional keyed global pollen fallback (design plan D1/D6). Fires only
  // when a key is configured AND the CAMS European model returned nothing
  // for this point — Europe keeps the richer keyless grains/m³ data and
  // never contacts Google. Sequential by necessity: the trigger needs the
  // CAMS answer first.
  //
  // The Google data is garnish, not contract: the whole fetch sits in one
  // try/catch and the air-quality call never fails because of it.
  let googlePollen: GooglePollenDailyInfo | undefined;
  let googleKeyRejected = false;

  if (
    googlePollenService &&
    googlePollenService.isKeyAvailable() &&
    airQualityData.current &&
    finiteCamsPollen(airQualityData.current).length === 0
  ) {
    try {
      googlePollen = await googlePollenService.getCurrentPollen(latitude, longitude);
      if (!googlePollen) {
        // Expected outside Google's 65+ covered countries — not a fault.
        logger.info('Google Pollen returned no data for this location');
      }
    } catch (error) {
      if (error instanceof GooglePollenKeyRejectedError) {
        googleKeyRejected = true;
        logger.warn('Google Pollen API key was rejected', {
          service: 'GooglePollen',
          securityEvent: true
        });
      } else {
        logger.warn('Google Pollen fallback failed; rendering no pollen section', {
          service: 'GooglePollen'
        });
      }
    }
  }

  // Format the air quality data for display
  const output = formatAirQuality(
    airQualityData,
    latitude,
    longitude,
    forecast,
    googlePollen,
    googleKeyRejected
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
 * Format air quality data as markdown
 */
function formatAirQuality(
  data: OpenMeteoAirQualityResponse,
  latitude: number,
  longitude: number,
  includeForecast: boolean,
  googlePollen?: GooglePollenDailyInfo,
  googleKeyRejected?: boolean
): string {
  let output = `# Air Quality Report\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Timezone:** ${data.timezone}\n`;
  output += `**Elevation:** ${Math.round(data.elevation)}m\n`;
  output += `\n`;

  // Determine which AQI to show primarily based on location
  const useUSAQI = shouldUseUSAQI(latitude, longitude);

  if (!data.current) {
    output += `⚠️ **No current air quality data available for this location.**\n`;
    return output;
  }

  const current = data.current;
  const currentTime = new Date(current.time);
  output += `**Observation Time:** ${currentTime.toLocaleString()}\n\n`;

  // Display primary AQI with health information
  if (useUSAQI && current.us_aqi != null) {
    const { shown, category } = bandAqi(current.us_aqi, true);
    const emoji = category.level === 'Good' ? '🟢' :
                  category.level === 'Moderate' ? '🟡' :
                  category.level === 'Unhealthy for Sensitive Groups' ? '🟠' :
                  category.level === 'Unhealthy' ? '🔴' :
                  category.level === 'Very Unhealthy' ? '🟣' : '🟤';

    output += `## ${emoji} US Air Quality Index: ${shown}\n\n`;
    output += `**Category:** ${category.level} (${category.color})\n`;
    output += `**Description:** ${category.description}\n\n`;
    output += `**Health Implications:**\n${category.healthImplications}\n\n`;
    if (category.cautionaryStatement !== 'None') {
      output += `⚠️ **Caution:** ${category.cautionaryStatement}\n\n`;
    }
  } else if (current.european_aqi != null) {
    const { shown, category } = bandAqi(current.european_aqi, false);
    const emoji = category.level === 'Good' ? '🟢' :
                  category.level === 'Fair' ? '🟢' :
                  category.level === 'Moderate' ? '🟡' :
                  category.level === 'Poor' ? '🟠' :
                  category.level === 'Very Poor' ? '🔴' : '🟣';

    output += `## ${emoji} European Air Quality Index: ${shown}\n\n`;
    output += `**Category:** ${category.level} (${category.color})\n`;
    output += `**Description:** ${category.description}\n\n`;
    output += `**Health Implications:**\n${category.healthImplications}\n\n`;
    if (category.cautionaryStatement !== 'None') {
      output += `⚠️ **Caution:** ${category.cautionaryStatement}\n\n`;
    }
  }

  // UV Index
  if (current.uv_index != null) {
    const { shown: uvShown, category: uvCategory } = bandUv(current.uv_index, 1);
    const uvEmoji = uvCategory.level === 'Low' ? '🟢' :
                    uvCategory.level === 'Moderate' ? '🟡' :
                    uvCategory.level === 'High' ? '🟠' :
                    uvCategory.level === 'Very High' ? '🔴' : '🟣';

    output += `## ${uvEmoji} UV Index: ${uvShown.toFixed(1)}\n\n`;
    output += `**Level:** ${uvCategory.level}\n`;
    output += `**Description:** ${uvCategory.description}\n`;
    output += `**Recommendation:** ${uvCategory.recommendation}\n\n`;

    if (current.uv_index_clear_sky != null && Math.abs(current.uv_index_clear_sky - current.uv_index) > 1) {
      output += `*Note: UV index under clear sky would be ${current.uv_index_clear_sky.toFixed(1)}*\n\n`;
    }
  }

  // Pollutant Concentrations
  output += `## Pollutant Concentrations\n\n`;

  const pollutants = [
    { key: 'pm2_5', value: current.pm2_5, units: data.current_units?.pm2_5 },
    { key: 'pm10', value: current.pm10, units: data.current_units?.pm10 },
    { key: 'ozone', value: current.ozone, units: data.current_units?.ozone },
    { key: 'nitrogen_dioxide', value: current.nitrogen_dioxide, units: data.current_units?.nitrogen_dioxide },
    { key: 'sulphur_dioxide', value: current.sulphur_dioxide, units: data.current_units?.sulphur_dioxide },
    { key: 'carbon_monoxide', value: current.carbon_monoxide, units: data.current_units?.carbon_monoxide }
  ];

  for (const pollutant of pollutants) {
    if (pollutant.value != null) {
      const info = getPollutantInfo(pollutant.key);
      const concentration = formatPollutantConcentration(pollutant.value, pollutant.units);

      output += `**${info.name}:** ${concentration}\n`;
    }
  }

  if (current.ammonia != null && data.current_units?.ammonia) {
    const info = getPollutantInfo('ammonia');
    const concentration = formatPollutantConcentration(current.ammonia, data.current_units.ammonia);
    output += `**${info.name}:** ${concentration}\n`;
  }

  if (current.aerosol_optical_depth != null) {
    output += `**Aerosol Optical Depth:** ${current.aerosol_optical_depth.toFixed(3)} (atmospheric haze indicator)\n`;
  }

  output += `\n`;

  // Pollen (CAMS European model). Non-European points return HTTP 200 with
  // every species null, so the section renders only when at least one species
  // carries a real value — never trust the 200 alone. In-season zeros are
  // meaningful ("none detected") and do render.
  const pollenSpecies = finiteCamsPollen(current);

  if (pollenSpecies.length > 0) {
    output += `## 🌾 Pollen\n\n`;
    for (const species of pollenSpecies) {
      const rounded = Math.round(species.value * 10) / 10;
      output += `**${species.label}:** ${rounded} grains/m³\n`;
    }
    output += `\n*Pollen from the CAMS European forecast — available for European locations only.*\n\n`;
  } else {
    // No CAMS coverage here. Fall back to the optional keyed Google Pollen
    // section, or — if the configured key was rejected — a single
    // misconfiguration note (design plan D5/D6). Otherwise nothing renders,
    // exactly as before.
    const googleSection = formatGooglePollen(googlePollen);
    if (googleSection) {
      output += googleSection;
    } else if (googleKeyRejected) {
      output += `*Note: GOOGLE_POLLEN_API_KEY was rejected; global pollen data is unavailable.*\n\n`;
    }
  }

  // Show secondary AQI for reference
  if (useUSAQI && current.european_aqi != null) {
    const { shown, category } = bandAqi(current.european_aqi, false);
    output += `*European AQI: ${shown} (${category.level})*\n\n`;
  } else if (!useUSAQI && current.us_aqi != null) {
    const { shown, category } = bandAqi(current.us_aqi, true);
    output += `*US AQI: ${shown} (${category.level})*\n\n`;
  }

  // Add forecast summary if requested
  if (includeForecast && data.hourly && data.hourly.time && data.hourly.time.length > 0) {
    output += `---\n\n`;
    output += `## Air Quality Forecast\n\n`;
    output += formatHourlyForecast(data.hourly, useUSAQI, current.time);
  }

  return output;
}

/**
 * Render the Google Pollen day-1 section that fills the CAMS slot outside
 * Europe (design plan D5). Returns an empty string when there is nothing
 * worth showing, so the caller can fall through to the key-rejected note.
 *
 * Only types whose `indexInfo.value` is a finite number render: Google omits
 * `indexInfo` entirely for out-of-season types (upstream (c)), while a zero
 * UPI that *does* carry `indexInfo` is meaningful ("none detected") and
 * renders — mirroring the CAMS olive-0 rule.
 *
 * The attribution sentence is **mandatory and exact** — the Google Pollen
 * API policies require the string "Source: Includes pollen data from Google"
 * on or next to the data (upstream (d)). Do not reword it.
 */
function formatGooglePollen(daily: GooglePollenDailyInfo | undefined): string {
  if (!daily) {
    return '';
  }

  const types = (daily.pollenTypeInfo ?? []).filter(
    type => typeof type.indexInfo?.value === 'number' && Number.isFinite(type.indexInfo.value)
  );

  if (types.length === 0) {
    return '';
  }

  let section = `## 🌾 Pollen\n\n`;

  for (const type of types) {
    // Google sends "Grass"/"Tree"/"Weed" as displayName; fall back to the
    // enum code (GRASS) title-cased if a response ever omits it.
    const label = type.displayName ?? titleCase(type.code ?? 'Pollen');
    const category = type.indexInfo?.category;
    const seasonSuffix = type.inSeason === true ? ' — in season' : '';

    section += `**${label}:** ${type.indexInfo?.value}`;
    section += category ? ` (${category})` : '';
    section += `${seasonSuffix}\n`;
  }

  const inSeasonPlants = (daily.plantInfo ?? [])
    .filter(plant => plant.inSeason === true && plant.displayName)
    .map(plant => {
      const category = plant.indexInfo?.category;
      return category ? `${plant.displayName} (${category})` : `${plant.displayName}`;
    });

  if (inSeasonPlants.length > 0) {
    section += `\nIn season: ${inSeasonPlants.join(', ')}\n`;
  }

  section += `\n*Universal Pollen Index (0–5) for today. Source: Includes pollen data from Google.*\n\n`;

  return section;
}

/**
 * "GRASS" -> "Grass". Only used as a defensive fallback when a pollen type
 * arrives without a displayName.
 */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/**
 * Format the hourly AQI forecast grouped by local calendar day, with 6-hour
 * period ranges inside each day. Hours before the current observation time
 * are skipped. Open-Meteo returns location-local ISO timestamps
 * ("YYYY-MM-DDTHH:mm" with timezone=auto), so dates and hours are read
 * directly from the strings instead of being parsed through the server's
 * local timezone.
 */
function formatHourlyForecast(
  hourly: OpenMeteoAirQualityHourlyData,
  useUSAQI: boolean,
  currentTime: string
): string {
  const times = hourly.time;
  let output = '';

  // The series are declared (number | null)[], because past the model's real
  // horizon the API pads the arrays with nulls — which would coerce to 0
  // ("Good") in Math.min/max. Treat anything non-finite as missing.
  const aqiAt = (i: number): number | undefined => {
    const value = useUSAQI ? hourly.us_aqi?.[i] : hourly.european_aqi?.[i];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };

  const uvAt = (i: number): number | undefined => {
    const value = hourly.uv_index?.[i];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };

  // Skip hours already past. ISO local timestamps compare lexicographically.
  const nowHour = currentTime.slice(0, 13);
  let startIdx = times.findIndex((t) => t.slice(0, 13) >= nowHour);
  if (startIdx === -1) {
    startIdx = 0;
  }

  // Trim trailing hours with no AQI data (nulls past the model horizon)
  let lastIdx = times.length - 1;
  while (lastIdx >= startIdx && aqiAt(lastIdx) === undefined) {
    lastIdx--;
  }
  if (lastIdx < startIdx) {
    return `*No AQI forecast data available for this location.*\n`;
  }

  // Group remaining hourly indices by local calendar date
  const dayOrder: string[] = [];
  const dayIndices = new Map<string, number[]>();
  for (let i = startIdx; i <= lastIdx; i++) {
    const date = times[i].slice(0, 10);
    let indices = dayIndices.get(date);
    if (!indices) {
      indices = [];
      dayIndices.set(date, indices);
      dayOrder.push(date);
    }
    indices.push(i);
  }

  const aqiScale = useUSAQI ? 'US' : 'EU';

  for (const date of dayOrder) {
    const indices = dayIndices.get(date)!;

    let dayPeak = -Infinity;
    let dayPeakUV = -Infinity;
    for (const i of indices) {
      const value = aqiAt(i);
      if (value !== undefined) {
        dayPeak = Math.max(dayPeak, value);
      }
      const uv = uvAt(i);
      if (uv !== undefined) {
        dayPeakUV = Math.max(dayPeakUV, uv);
      }
    }

    if (dayPeak === -Infinity) {
      output += `### ${formatDayLabel(date)}\n\n*No AQI data available for this day*\n\n`;
      continue;
    }

    // A day with no real UV data omits the UV clause entirely — never "UV 0 (Low)".
    let uvClause = '';
    if (dayPeakUV !== -Infinity) {
      const { shown: uvShown, category: uvCategory } = bandUv(dayPeakUV, 0);
      uvClause = ` · UV ${uvShown} (${uvCategory.level})`;
    }

    const { shown: peakShown, category: peakCategory } = bandAqi(dayPeak, useUSAQI);
    output += `### ${formatDayLabel(date)} — peak ${aqiScale} AQI ${peakShown} (${peakCategory.level})${uvClause}\n\n`;

    // 6-hour periods aligned to the local clock (12 AM / 6 AM / 12 PM / 6 PM)
    const periods = new Map<number, number[]>();
    for (const i of indices) {
      const hour = parseInt(times[i].slice(11, 13), 10);
      const period = Math.floor(hour / 6);
      let periodIndices = periods.get(period);
      if (!periodIndices) {
        periodIndices = [];
        periods.set(period, periodIndices);
      }
      periodIndices.push(i);
    }

    for (const [, periodIndices] of [...periods.entries()].sort((a, b) => a[0] - b[0])) {
      let minAQI = Infinity;
      let maxAQI = -Infinity;
      for (const i of periodIndices) {
        const value = aqiAt(i);
        if (value !== undefined) {
          minAQI = Math.min(minAQI, value);
          maxAQI = Math.max(maxAQI, value);
        }
      }
      if (maxAQI === -Infinity) {
        continue;
      }

      const startHour = parseInt(times[periodIndices[0]].slice(11, 13), 10);
      const endHour = parseInt(times[periodIndices[periodIndices.length - 1]].slice(11, 13), 10);
      const { shown, category } = bandAqi(maxAQI, useUSAQI);
      const range = Math.round(minAQI) === shown
        ? `${shown}`
        : `${Math.round(minAQI)}-${shown}`;

      output += `- **${formatHour(startHour)} – ${formatHour(endHour)}:** ${aqiScale} AQI ${range} (${category.level})\n`;
    }

    output += `\n`;
  }

  const hoursShown = lastIdx - startIdx + 1;
  output += `*Forecast covers ${hoursShown} hours across ${dayOrder.length} day(s). `;
  output += `Each period's category reflects its peak AQI.*\n`;
  if (lastIdx < times.length - 1) {
    const missing = times.length - 1 - lastIdx;
    output += `*The air quality model provided no data for the final ${missing} requested hour(s).*\n`;
  }

  return output;
}

/**
 * Format a local hour (0-23) as a 12-hour clock label
 */
function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * Format a "YYYY-MM-DD" date as a weekday + date label. Anchored to noon UTC
 * so the printed day never shifts with the server's timezone.
 */
function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}
