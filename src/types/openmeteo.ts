/**
 * TypeScript type definitions for Open-Meteo Historical Weather API
 * API Documentation: https://open-meteo.com/en/docs/historical-weather-api
 */

/**
 * Hourly weather variables available from Open-Meteo
 */
export interface OpenMeteoHourlyData {
  time: string[];
  temperature_2m?: number[];
  relative_humidity_2m?: number[];
  dewpoint_2m?: number[];
  apparent_temperature?: number[];
  precipitation?: number[];
  rain?: number[];
  snowfall?: number[];
  snow_depth?: number[];
  weather_code?: number[];
  pressure_msl?: number[];
  surface_pressure?: number[];
  cloud_cover?: number[];
  wind_speed_10m?: number[];
  wind_direction_10m?: number[];
  wind_gusts_10m?: number[];
  soil_temperature_0_to_7cm?: number[];
  soil_moisture_0_to_7cm?: number[];
}

/**
 * Daily weather variables available from Open-Meteo
 */
export interface OpenMeteoDailyData {
  time: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  temperature_2m_mean?: number[];
  apparent_temperature_max?: number[];
  apparent_temperature_min?: number[];
  apparent_temperature_mean?: number[];
  precipitation_sum?: number[];
  rain_sum?: number[];
  snowfall_sum?: number[];
  precipitation_hours?: number[];
  weather_code?: number[];
  sunrise?: string[];
  sunset?: string[];
  sunshine_duration?: number[];
  wind_speed_10m_max?: number[];
  wind_gusts_10m_max?: number[];
  wind_direction_10m_dominant?: number[];
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
  elevation?: number;
  feature_code?: string;
  country_code?: string;
  country?: string;
  country_id?: number;
  timezone?: string;
  population?: number;
  postcodes?: string[];
  admin1?: string;
  admin2?: string;
  admin3?: string;
  admin4?: string;
  admin1_id?: number;
  admin2_id?: number;
  admin3_id?: number;
  admin4_id?: number;
}

/**
 * Response from Open-Meteo Geocoding API
 */
export interface GeocodingResponse {
  results?: GeocodingLocation[];
  generationtime_ms?: number;
}

/**
 * Hourly forecast data from Open-Meteo Forecast API
 */
export interface OpenMeteoForecastHourlyData {
  time: string[];
  temperature_2m?: number[];
  relative_humidity_2m?: number[];
  dewpoint_2m?: number[];
  apparent_temperature?: number[];
  precipitation_probability?: number[];
  precipitation?: number[];
  rain?: number[];
  showers?: number[];
  snowfall?: number[];
  snow_depth?: number[];
  weather_code?: number[];
  pressure_msl?: number[];
  surface_pressure?: number[];
  cloud_cover?: number[];
  cloud_cover_low?: number[];
  cloud_cover_mid?: number[];
  cloud_cover_high?: number[];
  visibility?: number[];
  wind_speed_10m?: number[];
  wind_direction_10m?: number[];
  wind_gusts_10m?: number[];
  uv_index?: number[];
  is_day?: number[];
}

/**
 * Daily forecast data from Open-Meteo Forecast API
 */
export interface OpenMeteoForecastDailyData {
  time: string[];
  weather_code?: number[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  apparent_temperature_max?: number[];
  apparent_temperature_min?: number[];
  sunrise?: string[];
  sunset?: string[];
  daylight_duration?: number[];
  sunshine_duration?: number[];
  uv_index_max?: number[];
  precipitation_sum?: number[];
  rain_sum?: number[];
  showers_sum?: number[];
  snowfall_sum?: number[];
  precipitation_hours?: number[];
  precipitation_probability_max?: number[];
  wind_speed_10m_max?: number[];
  wind_gusts_10m_max?: number[];
  wind_direction_10m_dominant?: number[];
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
  pm10?: number;
  pm2_5?: number;
  carbon_monoxide?: number;
  nitrogen_dioxide?: number;
  sulphur_dioxide?: number;
  ozone?: number;
  aerosol_optical_depth?: number;
  dust?: number;
  uv_index?: number;
  uv_index_clear_sky?: number;
  ammonia?: number;
  alder_pollen?: number;
  birch_pollen?: number;
  grass_pollen?: number;
  mugwort_pollen?: number;
  olive_pollen?: number;
  ragweed_pollen?: number;
  european_aqi?: number;
  european_aqi_pm2_5?: number;
  european_aqi_pm10?: number;
  european_aqi_nitrogen_dioxide?: number;
  european_aqi_ozone?: number;
  european_aqi_sulphur_dioxide?: number;
  us_aqi?: number;
  us_aqi_pm2_5?: number;
  us_aqi_pm10?: number;
  us_aqi_nitrogen_dioxide?: number;
  us_aqi_ozone?: number;
  us_aqi_sulphur_dioxide?: number;
  us_aqi_carbon_monoxide?: number;
}

/**
 * Hourly air quality data from Open-Meteo Air Quality API
 */
export interface OpenMeteoAirQualityHourlyData {
  time: string[];
  pm10?: number[];
  pm2_5?: number[];
  carbon_monoxide?: number[];
  nitrogen_dioxide?: number[];
  sulphur_dioxide?: number[];
  ozone?: number[];
  aerosol_optical_depth?: number[];
  dust?: number[];
  uv_index?: number[];
  uv_index_clear_sky?: number[];
  ammonia?: number[];
  alder_pollen?: number[];
  birch_pollen?: number[];
  grass_pollen?: number[];
  mugwort_pollen?: number[];
  olive_pollen?: number[];
  ragweed_pollen?: number[];
  european_aqi?: number[];
  european_aqi_pm2_5?: number[];
  european_aqi_pm10?: number[];
  european_aqi_nitrogen_dioxide?: number[];
  european_aqi_ozone?: number[];
  european_aqi_sulphur_dioxide?: number[];
  us_aqi?: number[];
  us_aqi_pm2_5?: number[];
  us_aqi_pm10?: number[];
  us_aqi_nitrogen_dioxide?: number[];
  us_aqi_ozone?: number[];
  us_aqi_sulphur_dioxide?: number[];
  us_aqi_carbon_monoxide?: number[];
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
