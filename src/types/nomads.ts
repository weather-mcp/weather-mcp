export interface NomadsDailyForecast {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_probability_max: number[];
  precipitation_sum: number[];
  wind_speed_10m_max: number[];
  relative_humidity_2m_mean: number[];
}

export interface NomadsForecastResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  model: string;
  model_run: string;
  forecast_step_hours: number;
  daily: NomadsDailyForecast;
}
