/**
 * TypeScript type definitions for Open-Meteo Historical Weather API
 * API Documentation: https://open-meteo.com/en/docs/historical-weather-api
 */

/**
 * Hourly weather variables available from Open-Meteo
 */
export interface OpenMeteoHourlyData {
  time: string[];
  temperature_2m?: (number | null)[];
  relative_humidity_2m?: (number | null)[];
  dewpoint_2m?: (number | null)[];
  apparent_temperature?: (number | null)[];
  precipitation?: (number | null)[];
  rain?: (number | null)[];
  snowfall?: (number | null)[];
  snow_depth?: (number | null)[];
  weather_code?: (number | null)[];
  pressure_msl?: (number | null)[];
  surface_pressure?: (number | null)[];
  cloud_cover?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
  wind_gusts_10m?: (number | null)[];
  soil_temperature_0_to_7cm?: (number | null)[];
  soil_moisture_0_to_7cm?: (number | null)[];
}

/**
 * Daily weather variables available from Open-Meteo
 */
export interface OpenMeteoDailyData {
  time: string[];
  temperature_2m_max?: (number | null)[];
  temperature_2m_min?: (number | null)[];
  temperature_2m_mean?: (number | null)[];
  apparent_temperature_max?: (number | null)[];
  apparent_temperature_min?: (number | null)[];
  apparent_temperature_mean?: (number | null)[];
  precipitation_sum?: (number | null)[];
  rain_sum?: (number | null)[];
  snowfall_sum?: (number | null)[];
  precipitation_hours?: (number | null)[];
  weather_code?: (number | null)[];
  sunrise?: string[];
  sunset?: string[];
  sunshine_duration?: (number | null)[];
  wind_speed_10m_max?: (number | null)[];
  wind_gusts_10m_max?: (number | null)[];
  wind_direction_10m_dominant?: (number | null)[];
}

/**
 * Units used in the API response
 */
export interface OpenMeteoHourlyUnits {
  time?: string;
  temperature_2m?: string;
  relative_humidity_2m?: string;
  dewpoint_2m?: string;
  apparent_temperature?: string;
  precipitation?: string;
  rain?: string;
  snowfall?: string;
  snow_depth?: string;
  weather_code?: string;
  pressure_msl?: string;
  surface_pressure?: string;
  cloud_cover?: string;
  wind_speed_10m?: string;
  wind_direction_10m?: string;
  wind_gusts_10m?: string;
  soil_temperature_0_to_7cm?: string;
  soil_moisture_0_to_7cm?: string;
}

export interface OpenMeteoDailyUnits {
  time?: string;
  temperature_2m_max?: string;
  temperature_2m_min?: string;
  temperature_2m_mean?: string;
  apparent_temperature_max?: string;
  apparent_temperature_min?: string;
  apparent_temperature_mean?: string;
  precipitation_sum?: string;
  rain_sum?: string;
  snowfall_sum?: string;
  precipitation_hours?: string;
  weather_code?: string;
  sunrise?: string;
  sunset?: string;
  sunshine_duration?: string;
  wind_speed_10m_max?: string;
  wind_gusts_10m_max?: string;
  wind_direction_10m_dominant?: string;
}

/**
 * Complete API response from Open-Meteo Historical Weather API
 */
export interface OpenMeteoHistoricalResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  hourly_units?: OpenMeteoHourlyUnits;
  hourly?: OpenMeteoHourlyData;
  daily_units?: OpenMeteoDailyUnits;
  daily?: OpenMeteoDailyData;
}

/**
 * Error response from Open-Meteo API
 */
export interface OpenMeteoErrorResponse {
  error: boolean;
  reason: string;
}

/**
 * Location result from Open-Meteo Geocoding API
 */
export interface GeocodingLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number | null;
  feature_code?: string;
  country_code?: string;
  country?: string;
  country_id?: number | null;
  timezone?: string;
  population?: number | null;
  postcodes?: string[];
  admin1?: string;
  admin2?: string;
  admin3?: string;
  admin4?: string;
  admin1_id?: number | null;
  admin2_id?: number | null;
  admin3_id?: number | null;
  admin4_id?: number | null;
}

/**
 * Response from Open-Meteo Geocoding API
 */
export interface GeocodingResponse {
  results?: GeocodingLocation[];
  generationtime_ms?: number | null;
}

/**
 * Hourly forecast data from Open-Meteo Forecast API
 */
export interface OpenMeteoForecastHourlyData {
  time: string[];
  temperature_2m?: (number | null)[];
  relative_humidity_2m?: (number | null)[];
  dewpoint_2m?: (number | null)[];
  apparent_temperature?: (number | null)[];
  precipitation_probability?: (number | null)[];
  precipitation?: (number | null)[];
  rain?: (number | null)[];
  showers?: (number | null)[];
  snowfall?: (number | null)[];
  snow_depth?: (number | null)[];
  weather_code?: (number | null)[];
  pressure_msl?: (number | null)[];
  surface_pressure?: (number | null)[];
  cloud_cover?: (number | null)[];
  cloud_cover_low?: (number | null)[];
  cloud_cover_mid?: (number | null)[];
  cloud_cover_high?: (number | null)[];
  visibility?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
  wind_gusts_10m?: (number | null)[];
  uv_index?: (number | null)[];
  is_day?: (number | null)[];
}

/**
 * Daily forecast data from Open-Meteo Forecast API
 */
export interface OpenMeteoForecastDailyData {
  time: string[];
  weather_code?: (number | null)[];
  temperature_2m_max?: (number | null)[];
  temperature_2m_min?: (number | null)[];
  apparent_temperature_max?: (number | null)[];
  apparent_temperature_min?: (number | null)[];
  sunrise?: string[];
  sunset?: string[];
  daylight_duration?: (number | null)[];
  sunshine_duration?: (number | null)[];
  uv_index_max?: (number | null)[];
  precipitation_sum?: (number | null)[];
  rain_sum?: (number | null)[];
  showers_sum?: (number | null)[];
  snowfall_sum?: (number | null)[];
  precipitation_hours?: (number | null)[];
  precipitation_probability_max?: (number | null)[];
  wind_speed_10m_max?: (number | null)[];
  wind_gusts_10m_max?: (number | null)[];
  wind_direction_10m_dominant?: (number | null)[];
}

/**
 * Units for forecast hourly data
 */
export interface OpenMeteoForecastHourlyUnits {
  time?: string;
  temperature_2m?: string;
  relative_humidity_2m?: string;
  dewpoint_2m?: string;
  apparent_temperature?: string;
  precipitation_probability?: string;
  precipitation?: string;
  rain?: string;
  showers?: string;
  snowfall?: string;
  snow_depth?: string;
  weather_code?: string;
  pressure_msl?: string;
  surface_pressure?: string;
  cloud_cover?: string;
  cloud_cover_low?: string;
  cloud_cover_mid?: string;
  cloud_cover_high?: string;
  visibility?: string;
  wind_speed_10m?: string;
  wind_direction_10m?: string;
  wind_gusts_10m?: string;
  uv_index?: string;
  is_day?: string;
}

/**
 * Units for forecast daily data
 */
export interface OpenMeteoForecastDailyUnits {
  time?: string;
  weather_code?: string;
  temperature_2m_max?: string;
  temperature_2m_min?: string;
  apparent_temperature_max?: string;
  apparent_temperature_min?: string;
  sunrise?: string;
  sunset?: string;
  daylight_duration?: string;
  sunshine_duration?: string;
  uv_index_max?: string;
  precipitation_sum?: string;
  rain_sum?: string;
  showers_sum?: string;
  snowfall_sum?: string;
  precipitation_hours?: string;
  precipitation_probability_max?: string;
  wind_speed_10m_max?: string;
  wind_gusts_10m_max?: string;
  wind_direction_10m_dominant?: string;
}

/**
 * Current weather data from Open-Meteo Weather API
 */
export interface OpenMeteoCurrentWeather {
  time: string;
  interval: number;
  /** Fire-weather input (Fosberg index). Open-Meteo returns `null` when absent. */
  temperature_2m?: number | null;
  /** Fire-weather input (Fosberg index). Open-Meteo returns `null` when absent. */
  relative_humidity_2m?: number | null;
  apparent_temperature?: number | null;
  dew_point_2m?: number | null;
  is_day?: number | null;
  precipitation?: number | null;
  rain?: number | null;
  showers?: number | null;
  snowfall?: number | null;
  weather_code?: number | null;
  cloud_cover?: number | null;
  pressure_msl?: number | null;
  /** Fire-weather input (Fosberg index). Open-Meteo returns `null` when absent. */
  wind_speed_10m?: number | null;
  wind_direction_10m?: number | null;
  wind_gusts_10m?: number | null;
  /** Fire-weather input (Fosberg index). Fixed units (m³/m³), only present when requested. */
  soil_moisture_0_to_1cm?: number | null;
  /** Fire-weather input (Fosberg index). Fixed units (kPa), only present when requested. */
  vapour_pressure_deficit?: number | null;
}

/**
 * Units for current weather data
 */
export interface OpenMeteoCurrentWeatherUnits {
  time?: string;
  interval?: string;
  temperature_2m?: string;
  relative_humidity_2m?: string;
  apparent_temperature?: string;
  dew_point_2m?: string;
  is_day?: string;
  precipitation?: string;
  rain?: string;
  showers?: string;
  snowfall?: string;
  weather_code?: string;
  cloud_cover?: string;
  pressure_msl?: string;
  wind_speed_10m?: string;
  wind_direction_10m?: string;
  wind_gusts_10m?: string;
  soil_moisture_0_to_1cm?: string;
  vapour_pressure_deficit?: string;
}

/**
 * Complete API response from Open-Meteo Forecast API
 */
export interface OpenMeteoForecastResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  current_units?: OpenMeteoCurrentWeatherUnits;
  current?: OpenMeteoCurrentWeather;
  hourly_units?: OpenMeteoForecastHourlyUnits;
  hourly?: OpenMeteoForecastHourlyData;
  daily_units?: OpenMeteoForecastDailyUnits;
  daily?: OpenMeteoForecastDailyData;
}

/**
 * Current air quality data from Open-Meteo Air Quality API
 */
export interface OpenMeteoAirQualityCurrentData {
  time: string;
  interval: number;
  pm10?: number | null;
  pm2_5?: number | null;
  carbon_monoxide?: number | null;
  nitrogen_dioxide?: number | null;
  sulphur_dioxide?: number | null;
  ozone?: number | null;
  aerosol_optical_depth?: number | null;
  dust?: number | null;
  uv_index?: number | null;
  uv_index_clear_sky?: number | null;
  ammonia?: number | null;
  alder_pollen?: number | null;
  birch_pollen?: number | null;
  grass_pollen?: number | null;
  mugwort_pollen?: number | null;
  olive_pollen?: number | null;
  ragweed_pollen?: number | null;
  european_aqi?: number | null;
  european_aqi_pm2_5?: number | null;
  european_aqi_pm10?: number | null;
  european_aqi_nitrogen_dioxide?: number | null;
  european_aqi_ozone?: number | null;
  european_aqi_sulphur_dioxide?: number | null;
  us_aqi?: number | null;
  us_aqi_pm2_5?: number | null;
  us_aqi_pm10?: number | null;
  us_aqi_nitrogen_dioxide?: number | null;
  us_aqi_ozone?: number | null;
  us_aqi_sulphur_dioxide?: number | null;
  us_aqi_carbon_monoxide?: number | null;
}

/**
 * Hourly air quality data from Open-Meteo Air Quality API
 */
export interface OpenMeteoAirQualityHourlyData {
  time: string[];
  pm10?: (number | null)[];
  pm2_5?: (number | null)[];
  carbon_monoxide?: (number | null)[];
  nitrogen_dioxide?: (number | null)[];
  sulphur_dioxide?: (number | null)[];
  ozone?: (number | null)[];
  aerosol_optical_depth?: (number | null)[];
  dust?: (number | null)[];
  uv_index?: (number | null)[];
  uv_index_clear_sky?: (number | null)[];
  ammonia?: (number | null)[];
  alder_pollen?: (number | null)[];
  birch_pollen?: (number | null)[];
  grass_pollen?: (number | null)[];
  mugwort_pollen?: (number | null)[];
  olive_pollen?: (number | null)[];
  ragweed_pollen?: (number | null)[];
  european_aqi?: (number | null)[];
  european_aqi_pm2_5?: (number | null)[];
  european_aqi_pm10?: (number | null)[];
  european_aqi_nitrogen_dioxide?: (number | null)[];
  european_aqi_ozone?: (number | null)[];
  european_aqi_sulphur_dioxide?: (number | null)[];
  us_aqi?: (number | null)[];
  us_aqi_pm2_5?: (number | null)[];
  us_aqi_pm10?: (number | null)[];
  us_aqi_nitrogen_dioxide?: (number | null)[];
  us_aqi_ozone?: (number | null)[];
  us_aqi_sulphur_dioxide?: (number | null)[];
  us_aqi_carbon_monoxide?: (number | null)[];
}

/**
 * Units for current air quality data
 */
export interface OpenMeteoAirQualityCurrentUnits {
  time?: string;
  interval?: string;
  pm10?: string;
  pm2_5?: string;
  carbon_monoxide?: string;
  nitrogen_dioxide?: string;
  sulphur_dioxide?: string;
  ozone?: string;
  aerosol_optical_depth?: string;
  dust?: string;
  uv_index?: string;
  uv_index_clear_sky?: string;
  ammonia?: string;
  alder_pollen?: string;
  birch_pollen?: string;
  grass_pollen?: string;
  mugwort_pollen?: string;
  olive_pollen?: string;
  ragweed_pollen?: string;
  european_aqi?: string;
  european_aqi_pm2_5?: string;
  european_aqi_pm10?: string;
  european_aqi_nitrogen_dioxide?: string;
  european_aqi_ozone?: string;
  european_aqi_sulphur_dioxide?: string;
  us_aqi?: string;
  us_aqi_pm2_5?: string;
  us_aqi_pm10?: string;
  us_aqi_nitrogen_dioxide?: string;
  us_aqi_ozone?: string;
  us_aqi_sulphur_dioxide?: string;
  us_aqi_carbon_monoxide?: string;
}

/**
 * Units for hourly air quality data
 */
export interface OpenMeteoAirQualityHourlyUnits {
  time?: string;
  pm10?: string;
  pm2_5?: string;
  carbon_monoxide?: string;
  nitrogen_dioxide?: string;
  sulphur_dioxide?: string;
  ozone?: string;
  aerosol_optical_depth?: string;
  dust?: string;
  uv_index?: string;
  uv_index_clear_sky?: string;
  ammonia?: string;
  alder_pollen?: string;
  birch_pollen?: string;
  grass_pollen?: string;
  mugwort_pollen?: string;
  olive_pollen?: string;
  ragweed_pollen?: string;
  european_aqi?: string;
  european_aqi_pm2_5?: string;
  european_aqi_pm10?: string;
  european_aqi_nitrogen_dioxide?: string;
  european_aqi_ozone?: string;
  european_aqi_sulphur_dioxide?: string;
  us_aqi?: string;
  us_aqi_pm2_5?: string;
  us_aqi_pm10?: string;
  us_aqi_nitrogen_dioxide?: string;
  us_aqi_ozone?: string;
  us_aqi_sulphur_dioxide?: string;
  us_aqi_carbon_monoxide?: string;
}

/**
 * Complete API response from Open-Meteo Air Quality API
 */
export interface OpenMeteoAirQualityResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  current_units?: OpenMeteoAirQualityCurrentUnits;
  current?: OpenMeteoAirQualityCurrentData;
  hourly_units?: OpenMeteoAirQualityHourlyUnits;
  hourly?: OpenMeteoAirQualityHourlyData;
}

/**
 * Current marine data from Open-Meteo Marine API
 */
export interface OpenMeteoMarineCurrentData {
  time: string;
  interval: number;
  wave_height?: number | null;
  wave_direction?: number | null;
  wave_period?: number | null;
  wind_wave_height?: number | null;
  wind_wave_direction?: number | null;
  wind_wave_period?: number | null;
  wind_wave_peak_period?: number | null;
  swell_wave_height?: number | null;
  swell_wave_direction?: number | null;
  swell_wave_period?: number | null;
  swell_wave_peak_period?: number | null;
  ocean_current_velocity?: number | null;
  ocean_current_direction?: number | null;
}

/**
 * Hourly marine data from Open-Meteo Marine API
 */
export interface OpenMeteoMarineHourlyData {
  time: string[];
  wave_height?: (number | null)[];
  wave_direction?: (number | null)[];
  wave_period?: (number | null)[];
  wind_wave_height?: (number | null)[];
  wind_wave_direction?: (number | null)[];
  wind_wave_period?: (number | null)[];
  wind_wave_peak_period?: (number | null)[];
  swell_wave_height?: (number | null)[];
  swell_wave_direction?: (number | null)[];
  swell_wave_period?: (number | null)[];
  swell_wave_peak_period?: (number | null)[];
  ocean_current_velocity?: (number | null)[];
  ocean_current_direction?: (number | null)[];
}

/**
 * Daily marine data from Open-Meteo Marine API
 */
export interface OpenMeteoDailyMarineData {
  time: string[];
  wave_height_max?: (number | null)[];
  wave_direction_dominant?: (number | null)[];
  wave_period_max?: (number | null)[];
  wind_wave_height_max?: (number | null)[];
  wind_wave_direction_dominant?: (number | null)[];
  wind_wave_period_max?: (number | null)[];
  wind_wave_peak_period_max?: (number | null)[];
  swell_wave_height_max?: (number | null)[];
  swell_wave_direction_dominant?: (number | null)[];
  swell_wave_period_max?: (number | null)[];
  swell_wave_peak_period_max?: (number | null)[];
}

/**
 * Units for current marine data
 */
export interface OpenMeteoMarineCurrentUnits {
  time?: string;
  interval?: string;
  wave_height?: string;
  wave_direction?: string;
  wave_period?: string;
  wind_wave_height?: string;
  wind_wave_direction?: string;
  wind_wave_period?: string;
  wind_wave_peak_period?: string;
  swell_wave_height?: string;
  swell_wave_direction?: string;
  swell_wave_period?: string;
  swell_wave_peak_period?: string;
  ocean_current_velocity?: string;
  ocean_current_direction?: string;
}

/**
 * Units for hourly marine data
 */
export interface OpenMeteoMarineHourlyUnits {
  time?: string;
  wave_height?: string;
  wave_direction?: string;
  wave_period?: string;
  wind_wave_height?: string;
  wind_wave_direction?: string;
  wind_wave_period?: string;
  wind_wave_peak_period?: string;
  swell_wave_height?: string;
  swell_wave_direction?: string;
  swell_wave_period?: string;
  swell_wave_peak_period?: string;
  ocean_current_velocity?: string;
  ocean_current_direction?: string;
}

/**
 * Units for daily marine data
 */
export interface OpenMeteoDailyMarineUnits {
  time?: string;
  wave_height_max?: string;
  wave_direction_dominant?: string;
  wave_period_max?: string;
  wind_wave_height_max?: string;
  wind_wave_direction_dominant?: string;
  wind_wave_period_max?: string;
  wind_wave_peak_period_max?: string;
  swell_wave_height_max?: string;
  swell_wave_direction_dominant?: string;
  swell_wave_period_max?: string;
  swell_wave_peak_period_max?: string;
}

/**
 * Complete API response from Open-Meteo Marine API
 */
export interface OpenMeteoMarineResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  current_units?: OpenMeteoMarineCurrentUnits;
  current?: OpenMeteoMarineCurrentData;
  hourly_units?: OpenMeteoMarineHourlyUnits;
  hourly?: OpenMeteoMarineHourlyData;
  daily_units?: OpenMeteoDailyMarineUnits;
  daily?: OpenMeteoDailyMarineData;
}

/**
 * Units for daily river discharge data (Open-Meteo Flood API).
 * Unit strings may contain the Unicode "³" character (e.g. "m³/s") — treat
 * these as opaque display strings, never parse them.
 */
export interface OpenMeteoFloodDailyUnits {
  time?: string;
  river_discharge?: string;
  river_discharge_mean?: string;
  river_discharge_median?: string;
  river_discharge_max?: string;
  river_discharge_min?: string;
  river_discharge_p25?: string;
  river_discharge_p75?: string;
}

/**
 * Daily river discharge series from the Open-Meteo Flood API (GloFAS v4
 * model). Each series is nullable per-day: a grid cell with no river
 * running through it returns null values rather than an error (a
 * legitimate ocean/desert response), so entries are `number | null`.
 */
export interface OpenMeteoFloodDailyData {
  time: string[];
  river_discharge?: Array<number | null>;
  river_discharge_mean?: Array<number | null>;
  river_discharge_median?: Array<number | null>;
  river_discharge_max?: Array<number | null>;
  river_discharge_min?: Array<number | null>;
  river_discharge_p25?: Array<number | null>;
  river_discharge_p75?: Array<number | null>;
}

/**
 * Complete API response from the Open-Meteo Flood API (GloFAS v4 river
 * discharge model, ~5km grid). Open-Meteo returns a bare object for a
 * single-coordinate request and an array of these for a multi-point
 * request — OpenMeteoService.getRiverDischarge always normalizes the
 * response to an array regardless of how many coordinates were requested.
 */
export interface OpenMeteoFloodResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  daily_units?: OpenMeteoFloodDailyUnits;
  daily?: OpenMeteoFloodDailyData;
}

/**
 * Daily data block from a multi-model comparison request (`models=` with more
 * than one model, e.g. `get_forecast`'s `compare_models` flag). Deliberately
 * **not** a widening of `OpenMeteoForecastDailyData` — with multiple models
 * requested, Open-Meteo suffixes every key per model (e.g.
 * `temperature_2m_max_gfs_seamless`), so the unsuffixed keys on the closed
 * forecast-daily shape do not apply here. `time` is the only key whose name is
 * known ahead of time; every other key is `<variable>_<model>` and is read
 * exclusively through `extractModelSeries` (`src/utils/modelComparison.ts`,
 * D-types) rather than by direct property access.
 */
export interface OpenMeteoModelComparisonDaily {
  time: string[];
  [key: string]: string[] | (number | null)[] | undefined;
}

/**
 * Complete API response from an Open-Meteo multi-model comparison request
 * (`OpenMeteoService.getModelComparison`). See `OpenMeteoModelComparisonDaily`
 * for why this is a separate type from `OpenMeteoForecastResponse` rather than
 * a reuse.
 */
export interface OpenMeteoModelComparisonResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  timezone_abbreviation: string;
  utc_offset_seconds: number;
  daily: OpenMeteoModelComparisonDaily;
  daily_units?: Record<string, string>;
}

/**
 * Daily data block from a single-model ensemble request
 * (`OpenMeteoService.getEnsembleSpread`, `get_forecast`'s `ensemble_spread`
 * flag). Deliberately **not** a widening of `OpenMeteoForecastDailyData` —
 * the ensemble endpoint returns one unsuffixed control-run series per
 * variable plus `<variable>_memberNN` series (zero-padded from `member01`,
 * design "Upstream verification" b), so most keys are not known ahead of
 * time. `time` is the only key whose name is fixed; every other key is read
 * exclusively through `extractMemberSeries` (`src/utils/ensembleSpread.ts`,
 * D-types) rather than by direct property access — mirroring
 * `OpenMeteoModelComparisonDaily`.
 */
export interface OpenMeteoEnsembleDaily {
  time: string[];
  [key: string]: string[] | (number | null)[] | undefined;
}

/**
 * Complete API response from an Open-Meteo single-model ensemble request
 * (`OpenMeteoService.getEnsembleSpread`). See `OpenMeteoEnsembleDaily` for why
 * this is a separate type from `OpenMeteoForecastResponse` and
 * `OpenMeteoModelComparisonResponse` rather than a reuse of either.
 */
export interface OpenMeteoEnsembleResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  timezone_abbreviation: string;
  utc_offset_seconds: number;
  daily: OpenMeteoEnsembleDaily;
  daily_units?: Record<string, string>;
}

/**
 * Climate normals data (30-year averages)
 * Used for comparing current/forecast conditions to historical averages
 */
export interface ClimateNormals {
  /** Normal high temperature in °F */
  tempHigh: number;
  /** Normal low temperature in °F */
  tempLow: number;
  /** Normal precipitation in inches */
  precipitation: number;
  /** Source of normals data */
  source: 'NCEI' | 'Open-Meteo';
  /** Month (1-12) */
  month: number;
  /** Day of month (1-31) */
  day: number;
}
