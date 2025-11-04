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
