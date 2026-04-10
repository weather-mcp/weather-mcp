import { DateTime } from 'luxon';
import { NOMADSService } from './nomads.js';
import { OpenMeteoService } from './openmeteo.js';
import type {
  ComparisonModel,
  ComparisonModelSeries,
  ComparisonDayValues,
  ModelComparisonResult,
} from '../types/modelComparison.js';

export class ModelComparisonService {
  constructor(
    private readonly nomadsService: NOMADSService,
    private readonly openMeteoService: OpenMeteoService
  ) {}

  async compare(
    latitude: number,
    longitude: number,
    days: number,
    models: ComparisonModel[]
  ): Promise<ModelComparisonResult> {
    const requestedDays = Math.max(1, Math.min(days, 10));

    const requestedModels = models.length > 0
      ? Array.from(new Set(models))
      : ['gfs', 'nam', 'ecmwf_proxy'];

    const notes: string[] = [];
    const series: ComparisonModelSeries[] = [];

    const modelFetches = requestedModels.map(async (model) => {
      try {
        switch (model) {
          case 'gfs':
            return await this.fetchGfsSeries(latitude, longitude, requestedDays);
          case 'nam':
            return await this.fetchNamSeries(latitude, longitude, requestedDays);
          case 'ecmwf_proxy':
            return await this.fetchEcmwfProxySeries(latitude, longitude, requestedDays);
          default:
            return null;
        }
      } catch (error) {
        notes.push(`${model.toUpperCase()} unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
      }
    });

    const fetchedSeries = await Promise.all(modelFetches);
    for (const item of fetchedSeries) {
      if (item) {
        series.push(item);
      }
    }

    const timezone = series[0]?.timezone || 'UTC';
    const dayKeys = this.buildDayKeys(timezone, requestedDays);

    const namSeries = series.find((item) => item.model === 'nam');
    if (namSeries) {
      notes.push('NAM deterministic horizon is limited to approximately 84 hours; later days are shown as N/A.');
    }

    const ecmwfSeries = series.find((item) => item.model === 'ecmwf_proxy');
    if (ecmwfSeries) {
      notes.push('ECMWF values are proxy guidance via Open-Meteo and do not include raw deterministic ECMWF run metadata.');
    }

    return {
      latitude,
      longitude,
      timezone,
      requestedDays,
      days: dayKeys,
      series,
      notes,
    };
  }

  private async fetchGfsSeries(latitude: number, longitude: number, days: number): Promise<ComparisonModelSeries> {
    const forecast = await this.nomadsService.getForecast(latitude, longitude, days);

    return {
      model: 'gfs',
      label: 'GFS (NOMADS)',
      modelRun: forecast.model_run,
      horizonHours: 240,
      timezone: forecast.timezone,
      daily: this.convertNomadsDailyToMap(forecast.daily),
    };
  }

  private async fetchNamSeries(latitude: number, longitude: number, days: number): Promise<ComparisonModelSeries> {
    const forecast = await this.nomadsService.getNamForecast(latitude, longitude, days);

    return {
      model: 'nam',
      label: 'NAM (NOMADS)',
      modelRun: forecast.model_run,
      horizonHours: 84,
      timezone: forecast.timezone,
      daily: this.convertNomadsDailyToMap(forecast.daily),
      note: 'Limited deterministic horizon (~84h).',
    };
  }

  private async fetchEcmwfProxySeries(latitude: number, longitude: number, days: number): Promise<ComparisonModelSeries> {
    const forecast = await this.openMeteoService.getForecast(latitude, longitude, days, false);

    const daily: Record<string, ComparisonDayValues> = {};
    const entries = forecast.daily?.time || [];

    for (let i = 0; i < entries.length; i++) {
      const day = entries[i];
      daily[day] = {
        temperatureHighF: forecast.daily?.temperature_2m_max?.[i],
        temperatureLowF: forecast.daily?.temperature_2m_min?.[i],
        precipitationChancePct: forecast.daily?.precipitation_probability_max?.[i],
        precipitationTotalIn: forecast.daily?.precipitation_sum?.[i],
        windMaxMph: forecast.daily?.wind_speed_10m_max?.[i],
      };
    }

    return {
      model: 'ecmwf_proxy',
      label: 'ECMWF Proxy (Open-Meteo)',
      modelRun: DateTime.utc().toISO() || new Date().toISOString(),
      horizonHours: days * 24,
      timezone: forecast.timezone,
      daily,
      note: 'Proxy guidance, not raw deterministic ECMWF run metadata.',
    };
  }

  private convertNomadsDailyToMap(daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    precipitation_sum: number[];
    wind_speed_10m_max: number[];
    relative_humidity_2m_mean: number[];
  }): Record<string, ComparisonDayValues> {
    const mapped: Record<string, ComparisonDayValues> = {};

    for (let i = 0; i < daily.time.length; i++) {
      const key = daily.time[i];
      mapped[key] = {
        temperatureHighF: Number.isFinite(daily.temperature_2m_max[i]) ? daily.temperature_2m_max[i] : undefined,
        temperatureLowF: Number.isFinite(daily.temperature_2m_min[i]) ? daily.temperature_2m_min[i] : undefined,
        precipitationChancePct: Number.isFinite(daily.precipitation_probability_max[i]) ? daily.precipitation_probability_max[i] : undefined,
        precipitationTotalIn: Number.isFinite(daily.precipitation_sum[i]) ? daily.precipitation_sum[i] : undefined,
        windMaxMph: Number.isFinite(daily.wind_speed_10m_max[i]) ? daily.wind_speed_10m_max[i] : undefined,
        humidityMeanPct: Number.isFinite(daily.relative_humidity_2m_mean[i]) ? daily.relative_humidity_2m_mean[i] : undefined,
      };
    }

    return mapped;
  }

  private buildDayKeys(timezone: string, days: number): string[] {
    const start = DateTime.now().setZone(timezone).startOf('day');
    const keys: string[] = [];

    for (let i = 0; i < days; i++) {
      const key = start.plus({ days: i }).toISODate();
      if (key) {
        keys.push(key);
      }
    }

    return keys;
  }
}
