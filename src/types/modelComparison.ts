export type ComparisonModel = 'gfs' | 'nam' | 'ecmwf_proxy';

export interface ComparisonDayValues {
  temperatureHighF?: number;
  temperatureLowF?: number;
  precipitationChancePct?: number;
  precipitationTotalIn?: number;
  windMaxMph?: number;
  humidityMeanPct?: number;
}

export interface ComparisonModelSeries {
  model: ComparisonModel;
  label: string;
  modelRun: string;
  horizonHours: number;
  timezone: string;
  daily: Record<string, ComparisonDayValues>;
  note?: string;
}

export interface ModelComparisonResult {
  latitude: number;
  longitude: number;
  timezone: string;
  requestedDays: number;
  days: string[];
  series: ComparisonModelSeries[];
  notes: string[];
}
