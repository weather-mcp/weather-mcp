import axios, { AxiosError, AxiosInstance } from 'axios';
import { DateTime } from 'luxon';
import { parseMessagesFromBuffer } from '@mattnucc/gribberish';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { guessTimezoneFromCoords } from '../utils/timezone.js';
import { findNearestGridIndex, GridShape, GridLatLng } from '../utils/gribGrid.js';
import {
  ApiError,
  DataNotFoundError,
  InvalidLocationError,
  RateLimitError,
  ServiceUnavailableError,
} from '../errors/ApiError.js';
import type { NomadsForecastResponse } from '../types/nomads.js';

interface NomadsServiceConfig {
  timeout?: number;
  maxRetries?: number;
  userAgent?: string;
}

interface GribMessage {
  key: string;
  varAbbrev?: string;
  varName?: string;
  units?: string;
  data: number[];
  gridShape?: GridShape;
  latlng?: GridLatLng;
  referenceDate?: Date;
  forecastDate?: Date;
}

interface TimeStepData {
  timestamp: Date;
  temperatureF?: number;
  humidityPct?: number;
  windMph?: number;
  precipitationIn?: number;
}

interface ModelFetchConfig {
  cachePrefix: string;
  modelLabel: string;
  endpointUrl: string;
  horizonHours: number;
  stepHours: number;
  availableCycles: string[];
  candidateLookbackDays: number;
  fileNameBuilder: (cycle: string, forecastHour: number) => string;
  directoryBuilder: (date: string, cycle: string) => string;
}

const NOMADS_URL = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl';
const NAM_URL = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_nam.pl';
const HOURS_PER_STEP = 6;
const NAM_HOURS_PER_STEP = 3;
const MPS_TO_MPH = 2.2369362921;
const MM_TO_IN = 0.0393701;

export class NOMADSService {
  private readonly client: AxiosInstance;
  private readonly maxRetries: number;
  private readonly cache: Cache;

  constructor(config: NomadsServiceConfig = {}) {
    const {
      timeout = CacheConfig.apiTimeoutMs,
      maxRetries = 3,
      userAgent = 'weather-mcp/nomads-gfs',
    } = config;

    this.maxRetries = maxRetries;
    this.cache = new Cache(CacheConfig.maxSize);
    this.client = axios.create({
      timeout,
      headers: {
        'User-Agent': userAgent,
      },
      responseType: 'arraybuffer',
    });
  }

  clearCache(): void {
    this.cache.clear();
  }

  async getForecast(latitude: number, longitude: number, days: number): Promise<NomadsForecastResponse> {
    return this.getModelForecast(latitude, longitude, days, {
      cachePrefix: 'nomads-gfs-forecast',
      modelLabel: 'NCEP GFS 1.0 deg',
      endpointUrl: NOMADS_URL,
      horizonHours: 240,
      stepHours: HOURS_PER_STEP,
      availableCycles: ['18', '12', '06', '00'],
      candidateLookbackDays: 2,
      fileNameBuilder: (cycle: string, forecastHour: number) =>
        `gfs.t${cycle}z.pgrb2.1p00.f${forecastHour.toString().padStart(3, '0')}`,
      directoryBuilder: (date: string, cycle: string) => `/gfs.${date}/${cycle}/atmos`,
    });
  }

  async getNamForecast(latitude: number, longitude: number, days: number): Promise<NomadsForecastResponse> {
    return this.getModelForecast(latitude, longitude, days, {
      cachePrefix: 'nomads-nam-forecast',
      modelLabel: 'NCEP NAM (84h deterministic)',
      endpointUrl: NAM_URL,
      horizonHours: 84,
      stepHours: NAM_HOURS_PER_STEP,
      availableCycles: ['18', '12', '06', '00'],
      candidateLookbackDays: 2,
      fileNameBuilder: (cycle: string, forecastHour: number) =>
        `nam.t${cycle}z.awphys${forecastHour.toString().padStart(2, '0')}.tm00.grib2`,
      directoryBuilder: (date: string) => `/nam.${date}`,
    });
  }

  private async getModelForecast(
    latitude: number,
    longitude: number,
    days: number,
    model: ModelFetchConfig
  ): Promise<NomadsForecastResponse> {
    validateLatitude(latitude);
    validateLongitude(longitude);

    const maxDaysForModel = Math.max(1, Math.ceil(model.horizonHours / 24));
    const clampedDays = Math.max(1, Math.min(days, maxDaysForModel));
    const cacheKey = Cache.generateKey(model.cachePrefix, latitude.toFixed(2), longitude.toFixed(2), clampedDays);

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as NomadsForecastResponse;
      }
    }

    const run = await this.findLatestAvailableRun(latitude, longitude, model);
    const maxForecastHour = Math.min(clampedDays * 24, model.horizonHours);
    const points: TimeStepData[] = [];

    for (let hour = 0; hour <= maxForecastHour; hour += model.stepHours) {
      const messages = await this.fetchForecastMessages(run.date, run.cycle, hour, latitude, longitude, model);
      const point = this.extractPointData(messages, latitude, longitude, run.referenceDate, hour);
      points.push(point);
    }

    const timezone = guessTimezoneFromCoords(latitude, longitude);
    const daily = this.aggregateDaily(points, timezone, clampedDays);

    const response: NomadsForecastResponse = {
      latitude,
      longitude,
      timezone,
      model: model.modelLabel,
      model_run: run.referenceDate.toISOString(),
      forecast_step_hours: model.stepHours,
      daily,
    };

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, response, CacheConfig.ttl.forecast);
    }

    return response;
  }

  private async findLatestAvailableRun(
    latitude: number,
    longitude: number,
    model: ModelFetchConfig
  ): Promise<{ date: string; cycle: string; referenceDate: Date }> {
    const now = DateTime.utc();
    const candidateDates = Array.from({ length: model.candidateLookbackDays + 1 }, (_, idx) =>
      now.minus({ days: idx })
    );

    for (const candidateDate of candidateDates) {
      const dateStr = candidateDate.toFormat('yyyyLLdd');

      for (const cycle of model.availableCycles) {
        const probeHour = model.stepHours;

        try {
          const messages = await this.fetchForecastMessages(dateStr, cycle, probeHour, latitude, longitude, model);

          if (messages.length > 0) {
            const referenceDate = DateTime.fromFormat(`${dateStr}${cycle}`, 'yyyyLLddHH', { zone: 'utc' }).toJSDate();
            return { date: dateStr, cycle, referenceDate };
          }
        } catch (error) {
          // Continue probing older runs.
        }
      }
    }

    throw new ServiceUnavailableError(
      'NOMADS',
      `${model.modelLabel} runs were not reachable. Please try again shortly.`
    );
  }

  private async fetchForecastMessages(
    date: string,
    cycle: string,
    forecastHour: number,
    latitude: number,
    longitude: number,
    model: ModelFetchConfig
  ): Promise<GribMessage[]> {
    const file = model.fileNameBuilder(cycle, forecastHour);

    const params = {
      file,
      dir: model.directoryBuilder(date, cycle),
      lev_2_m_above_ground: 'on',
      lev_10_m_above_ground: 'on',
      lev_surface: 'on',
      var_TMP: 'on',
      var_RH: 'on',
      var_APCP: 'on',
      var_UGRD: 'on',
      var_VGRD: 'on',
      subregion: '',
      leftlon: (longitude - 2).toFixed(2),
      rightlon: (longitude + 2).toFixed(2),
      toplat: Math.min(90, latitude + 2).toFixed(2),
      bottomlat: Math.max(-90, latitude - 2).toFixed(2),
    };

    const raw = await this.requestWithRetry(model.endpointUrl, params);

    if (!raw || raw.length < 5 || raw.subarray(0, 4).toString('utf8') !== 'GRIB') {
      throw new DataNotFoundError('NOMADS', `NOMADS data file unavailable for ${file}`);
    }

    return parseMessagesFromBuffer(raw) as unknown as GribMessage[];
  }

  private async requestWithRetry(endpointUrl: string, params: Record<string, string>, retries = 0): Promise<Buffer> {
    try {
      const response = await this.client.get<ArrayBuffer>(endpointUrl, { params });
      return Buffer.from(response.data);
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.response?.status === 429) {
        throw new RateLimitError('NOMADS', 'NOMADS rate limit reached. Retry in a moment.');
      }

      if (axiosError.response?.status === 404 || axiosError.response?.status === 403) {
        throw new DataNotFoundError('NOMADS', 'Requested NOMADS model file was not found.');
      }

      if (retries < this.maxRetries) {
        const delayMs = Math.round((2 ** retries) * 500 + Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.requestWithRetry(endpointUrl, params, retries + 1);
      }

      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ENOTFOUND') {
        throw new ServiceUnavailableError('NOMADS', 'NOMADS endpoint timeout or DNS failure.');
      }

      throw new ApiError(
        `NOMADS request failed: ${(error as Error).message}`,
        500,
        'NOMADS',
        'NOMADS request failed. Please retry.',
        [],
        true
      );
    }
  }

  private extractPointData(
    messages: GribMessage[],
    latitude: number,
    longitude: number,
    referenceDate: Date,
    forecastHour: number
  ): TimeStepData {
    if (messages.length === 0) {
      throw new InvalidLocationError('NOMADS', 'No NOMADS messages returned for point extraction.');
    }

    const surfaceTemp = messages.find((m) => m.varAbbrev === 'TMP' && m.key.includes('2 in above ground'));
    const humidity = messages.find((m) => m.varAbbrev === 'RH' && m.key.includes('2 in above ground'));
    const ugrd = messages.find((m) => m.varAbbrev === 'UGRD' && m.key.includes('10 in above ground'));
    const vgrd = messages.find((m) => m.varAbbrev === 'VGRD' && m.key.includes('10 in above ground'));
    const precipCandidates = messages.filter((m) => m.varAbbrev === 'APCP');

    const timestamp = surfaceTemp?.forecastDate ?? new Date(referenceDate.getTime() + forecastHour * 3600 * 1000);

    const precipitationMmValues = precipCandidates
      .map((msg) => this.extractNearestValue(msg, latitude, longitude))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    const intervalPrecipMm = precipitationMmValues.length > 0 ? Math.max(...precipitationMmValues) : 0;

    const temperatureK = surfaceTemp ? this.extractNearestValue(surfaceTemp, latitude, longitude) : undefined;
    const humidityPct = humidity ? this.extractNearestValue(humidity, latitude, longitude) : undefined;

    const u = ugrd ? this.extractNearestValue(ugrd, latitude, longitude) : undefined;
    const v = vgrd ? this.extractNearestValue(vgrd, latitude, longitude) : undefined;

    const windMph = typeof u === 'number' && typeof v === 'number'
      ? Math.sqrt((u * u) + (v * v)) * MPS_TO_MPH
      : undefined;

    return {
      timestamp,
      temperatureF: typeof temperatureK === 'number' ? ((temperatureK - 273.15) * 9) / 5 + 32 : undefined,
      humidityPct,
      windMph,
      precipitationIn: intervalPrecipMm * MM_TO_IN,
    };
  }

  private extractNearestValue(message: GribMessage, latitude: number, longitude: number): number | undefined {
    const flatIndex = findNearestGridIndex(message.latlng, message.gridShape, latitude, longitude);

    if (flatIndex === undefined) {
      return undefined;
    }

    const value = message.data[flatIndex];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private aggregateDaily(points: TimeStepData[], timezone: string, days: number): NomadsForecastResponse['daily'] {
    const buckets = new Map<string, {
      highs: number[];
      lows: number[];
      precipIn: number;
      precipSteps: number;
      totalSteps: number;
      humidity: number[];
      wind: number[];
    }>();

    for (const point of points) {
      const dayKey = DateTime.fromJSDate(point.timestamp, { zone: 'utc' }).setZone(timezone).toISODate();
      if (!dayKey) {
        continue;
      }

      let bucket = buckets.get(dayKey);
      if (!bucket) {
        bucket = {
          highs: [],
          lows: [],
          precipIn: 0,
          precipSteps: 0,
          totalSteps: 0,
          humidity: [],
          wind: [],
        };
        buckets.set(dayKey, bucket);
      }

      if (typeof point.temperatureF === 'number') {
        bucket.highs.push(point.temperatureF);
        bucket.lows.push(point.temperatureF);
      }

      if (typeof point.precipitationIn === 'number') {
        bucket.precipIn += point.precipitationIn;
        if (point.precipitationIn >= 0.01) {
          bucket.precipSteps += 1;
        }
      }

      if (typeof point.humidityPct === 'number') {
        bucket.humidity.push(point.humidityPct);
      }

      if (typeof point.windMph === 'number') {
        bucket.wind.push(point.windMph);
      }

      bucket.totalSteps += 1;
    }

    const allSortedDays = Array.from(buckets.keys()).sort();
    const todayKey = DateTime.now().setZone(timezone).toISODate();
    const futureDays = todayKey
      ? allSortedDays.filter((day) => day >= todayKey)
      : allSortedDays;
    const sortedDays = (futureDays.length > 0 ? futureDays : allSortedDays).slice(0, days);

    return {
      time: sortedDays,
      temperature_2m_max: sortedDays.map((day) => {
        const values = buckets.get(day)?.highs ?? [];
        return values.length > 0 ? Math.round(Math.max(...values)) : NaN;
      }),
      temperature_2m_min: sortedDays.map((day) => {
        const values = buckets.get(day)?.lows ?? [];
        return values.length > 0 ? Math.round(Math.min(...values)) : NaN;
      }),
      precipitation_probability_max: sortedDays.map((day) => {
        const bucket = buckets.get(day);
        if (!bucket || bucket.totalSteps === 0) {
          return 0;
        }

        return Math.round((bucket.precipSteps / bucket.totalSteps) * 100);
      }),
      precipitation_sum: sortedDays.map((day) => {
        const bucket = buckets.get(day);
        return bucket ? Number(bucket.precipIn.toFixed(2)) : 0;
      }),
      wind_speed_10m_max: sortedDays.map((day) => {
        const values = buckets.get(day)?.wind ?? [];
        return values.length > 0 ? Math.round(Math.max(...values)) : NaN;
      }),
      relative_humidity_2m_mean: sortedDays.map((day) => {
        const values = buckets.get(day)?.humidity ?? [];
        if (values.length === 0) {
          return NaN;
        }

        const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
        return Math.round(avg);
      }),
    };
  }
}
