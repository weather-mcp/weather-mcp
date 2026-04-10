import { DateTime } from 'luxon';
import { NOMADSService } from '../services/nomads.js';
import { LocationStore } from '../services/locationStore.js';
import { resolveLocation } from '../utils/locationResolver.js';
import { validateForecastDays } from '../utils/validation.js';

interface NomadsForecastArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  days?: number;
}

export async function handleGetNomadsForecast(
  args: unknown,
  nomadsService: NOMADSService,
  locationStore: LocationStore
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { latitude, longitude } = resolveLocation(args as NomadsForecastArgs, locationStore);
  const days = validateForecastDays(args);

  const forecast = await nomadsService.getForecast(latitude, longitude, days);

  let output = '# Forecast (NOMADS/NCEP GFS Current Model Run)\n\n';
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Model:** ${forecast.model}\n`;
  output += `**Model Run (UTC):** ${DateTime.fromISO(forecast.model_run).toUTC().toFormat('yyyy-LL-dd HH:mm')}Z\n`;
  output += `**Timezone:** ${forecast.timezone}\n`;
  output += `**Forecast Step:** every ${forecast.forecast_step_hours} hours\n\n`;

  for (let i = 0; i < forecast.daily.time.length; i++) {
    const day = forecast.daily.time[i];
    const dt = DateTime.fromISO(day, { zone: forecast.timezone });
    output += `## ${dt.toLocaleString({ weekday: 'long', month: 'long', day: 'numeric' })}\n`;

    const high = forecast.daily.temperature_2m_max[i];
    const low = forecast.daily.temperature_2m_min[i];
    const precipChance = forecast.daily.precipitation_probability_max[i];
    const precipSum = forecast.daily.precipitation_sum[i];
    const windMax = forecast.daily.wind_speed_10m_max[i];
    const humidityMean = forecast.daily.relative_humidity_2m_mean[i];

    if (Number.isFinite(high) && Number.isFinite(low)) {
      output += `**Temperature:** High ${Math.round(high)}°F / Low ${Math.round(low)}°F\n`;
    }

    output += `**Precipitation Chance:** ${Math.round(precipChance)}%\n`;
    output += `**Precipitation Total:** ${precipSum.toFixed(2)} in\n`;

    if (Number.isFinite(windMax)) {
      output += `**Wind:** up to ${Math.round(windMax)} mph\n`;
    }

    if (Number.isFinite(humidityMean)) {
      output += `**Humidity:** avg ${Math.round(humidityMean)}%\n`;
    }

    output += '\n';
  }

  output += '---\n';
  output += '*Data source: NOMADS/NCEP GFS (deterministic model run). Precipitation chance is derived from 6-hour forecast interval signals in the selected day.*\n';

  return {
    content: [
      {
        type: 'text',
        text: output,
      },
    ],
  };
}
