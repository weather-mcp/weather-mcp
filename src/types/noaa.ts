/**
 * Type definitions for NOAA Weather API responses
 */

/**
 * Common properties in NOAA API responses
 */
export interface NOAAResponse<T> {
  '@context'?: unknown;
  type?: string;
  geometry?: {
    type: string;
    coordinates: number[];
  };
  properties: T;
}

/**
 * Response from /points/{lat},{lon} endpoint
 */
export interface PointsProperties {
  '@id': string;
  cwa: string; // Weather office ID
  forecastOffice: string;
  gridId: string;
  gridX: number;
  gridY: number;
  forecast: string; // URL to forecast
  forecastHourly: string; // URL to hourly forecast
  forecastGridData: string;
  observationStations: string; // URL to stations
  relativeLocation: {
    type: string;
    geometry: {
      type: string;
      coordinates: number[];
    };
    properties: {
      city: string;
      state: string;
      distance: {
        unitCode: string;
        value: number;
      };
      bearing: {
        unitCode: string;
        value: number;
      };
    };
  };
  forecastZone: string;
  county: string;
  fireWeatherZone: string;
  timeZone: string;
  radarStation: string;
}

export type PointsResponse = NOAAResponse<PointsProperties>;

/**
 * Forecast period from /gridpoints/{office}/{x},{y}/forecast
 */
export interface ForecastPeriod {
  number: number;
  name: string; // "Tonight", "Thursday", etc.
  startTime: string; // ISO 8601 datetime
  endTime: string; // ISO 8601 datetime
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: 'F' | 'C';
  temperatureTrend?: string | null;
  probabilityOfPrecipitation: {
    unitCode: string;
    value: number | null;
  };
  dewpoint: {
    unitCode: string;
    value: number;
  };
  relativeHumidity: {
    unitCode: string;
    value: number;
  };
  windSpeed: string; // "10 to 15 mph"
  windDirection: string; // "N", "SW", etc.
  icon: string; // URL to icon
  shortForecast: string;
  detailedForecast: string;
}

/**
 * Response from forecast endpoints
 */
export interface ForecastProperties {
  updated: string;
  units: string;
  forecastGenerator: string;
  generatedAt: string;
  updateTime: string;
  validTimes: string;
  elevation: {
    unitCode: string;
    value: number;
  };
  periods: ForecastPeriod[];
}

export type ForecastResponse = NOAAResponse<ForecastProperties>;

/**
 * Quantitative value with unit
 */
export interface QuantitativeValue {
  unitCode: string;
  value: number | null;
  qualityControl?: string;
}

/**
 * Observation data from /stations/{id}/observations
 */
export interface ObservationProperties {
  '@id': string;
  '@type': string;
  elevation: QuantitativeValue;
  station: string;
  timestamp: string; // ISO 8601 datetime
  rawMessage?: string;
  textDescription?: string;
  icon?: string;
  presentWeather?: Array<{
    intensity?: string;
    modifier?: string;
    weather: string;
    rawString: string;
  }>;
  temperature: QuantitativeValue;
  dewpoint: QuantitativeValue;
  windDirection?: QuantitativeValue;
  windSpeed: QuantitativeValue;
  windGust?: QuantitativeValue;
  barometricPressure?: QuantitativeValue;
  seaLevelPressure?: QuantitativeValue;
  visibility?: QuantitativeValue;
  maxTemperatureLast24Hours?: QuantitativeValue;
  minTemperatureLast24Hours?: QuantitativeValue;
  precipitationLastHour?: QuantitativeValue;
  precipitationLast3Hours?: QuantitativeValue;
  precipitationLast6Hours?: QuantitativeValue;
  relativeHumidity: QuantitativeValue;
  windChill?: QuantitativeValue;
  heatIndex?: QuantitativeValue;
  cloudLayers?: Array<{
    base: QuantitativeValue;
    amount: string; // "FEW", "SCT", "BKN", "OVC"
  }>;
}

export type ObservationResponse = NOAAResponse<ObservationProperties>;

/**
 * Collection of observations
 */
export interface ObservationCollectionResponse {
  '@context'?: unknown;
  type: string;
  features: ObservationResponse[];
}

/**
 * Weather station information
 */
export interface StationProperties {
  '@id': string;
  '@type': string;
  elevation: QuantitativeValue;
  stationIdentifier: string;
  name: string;
  timeZone: string;
  forecast?: string;
  county?: string;
  fireWeatherZone?: string;
}

export type StationResponse = NOAAResponse<StationProperties>;

/**
 * Collection of stations
 */
export interface StationCollectionResponse {
  '@context'?: unknown;
  type: string;
  features: StationResponse[];
  observationStations?: string[];
}

/**
 * Error response from NOAA API
 */
export interface NOAAErrorResponse {
  correlationId: string;
  title: string;
  type: string;
  status: number;
  detail: string;
  instance?: string;
}

/**
 * Weather alert properties from /alerts endpoint
 */
export interface AlertProperties {
  '@id': string;
  '@type': string;
  id: string;
  areaDesc: string; // Affected area description
  geocode: {
    SAME?: string[]; // SAME (Specific Area Message Encoding) codes
    UGC?: string[]; // Universal Geographic Code
  };
  affectedZones: string[]; // URLs to affected zones
  references: Array<{
    '@id': string;
    identifier: string;
    sender: string;
    sent: string;
  }>;
  sent: string; // ISO 8601 datetime
  effective: string; // ISO 8601 datetime
  onset: string | null; // ISO 8601 datetime
  expires: string; // ISO 8601 datetime
  ends: string | null; // ISO 8601 datetime
  status: 'Actual' | 'Exercise' | 'System' | 'Test' | 'Draft';
  messageType: 'Alert' | 'Update' | 'Cancel' | 'Ack' | 'Error';
  category: 'Met' | 'Geo' | 'Safety' | 'Security' | 'Rescue' | 'Fire' | 'Health' | 'Env' | 'Transport' | 'Infra' | 'CBRNE' | 'Other';
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  certainty: 'Observed' | 'Likely' | 'Possible' | 'Unlikely' | 'Unknown';
  urgency: 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';
  event: string; // Event type (e.g., "Tornado Warning", "Winter Storm Watch")
  sender: string;
  senderName: string;
  headline: string | null;
  description: string;
  instruction: string | null;
  response: 'Shelter' | 'Evacuate' | 'Prepare' | 'Execute' | 'Avoid' | 'Monitor' | 'Assess' | 'AllClear' | 'None';
  parameters: {
    [key: string]: string[];
  };
}

export type AlertResponse = NOAAResponse<AlertProperties>;

/**
 * Collection of alerts from /alerts endpoint
 */
export interface AlertCollectionResponse {
  '@context'?: unknown;
  type: string;
  features: AlertResponse[];
  title?: string;
  updated?: string;
}

/**
 * Helper type for converting units
 */
export type TemperatureUnit = 'F' | 'C' | 'K';
export type SpeedUnit = 'mph' | 'kph' | 'mps' | 'knots';
export type DistanceUnit = 'miles' | 'km' | 'meters' | 'feet';
export type PressureUnit = 'mb' | 'hPa' | 'inHg' | 'Pa';

/**
 * Gridpoint data value with time range
 */
export interface GridpointValue {
  validTime: string; // ISO 8601 time interval (e.g., "2025-11-06T06:00:00+00:00/PT12H")
  value: number;
}

/**
 * Gridpoint data series
 */
export interface GridpointDataSeries {
  uom?: string; // Unit of measure
  values: GridpointValue[];
}

/**
 * Fire weather properties from gridpoint data
 */
export interface GridpointFireWeather {
  grasslandFireDangerIndex?: GridpointDataSeries;
  hainesIndex?: GridpointDataSeries;
  redFlagThreatIndex?: GridpointDataSeries;
  atmosphericDispersionIndex?: GridpointDataSeries;
  mixingHeight?: GridpointDataSeries;
  transportWindSpeed?: GridpointDataSeries;
  transportWindDirection?: GridpointDataSeries;
  twentyFootWindSpeed?: GridpointDataSeries;
  twentyFootWindDirection?: GridpointDataSeries;
}

/**
 * Severe weather properties from gridpoint data
 */
export interface GridpointSevereWeather {
  probabilityOfThunder?: GridpointDataSeries;
  probabilityOfTropicalStormWinds?: GridpointDataSeries;
  probabilityOfHurricaneWinds?: GridpointDataSeries;
  potentialOf15mphWinds?: GridpointDataSeries;
  potentialOf20mphWindGusts?: GridpointDataSeries;
  potentialOf25mphWinds?: GridpointDataSeries;
  potentialOf30mphWindGusts?: GridpointDataSeries;
  potentialOf35mphWinds?: GridpointDataSeries;
  potentialOf40mphWindGusts?: GridpointDataSeries;
  potentialOf45mphWinds?: GridpointDataSeries;
  potentialOf50mphWindGusts?: GridpointDataSeries;
  potentialOf60mphWindGusts?: GridpointDataSeries;
  lightningActivityLevel?: GridpointDataSeries;
}

/**
 * Gridpoint properties from /gridpoints/{office}/{gridX},{gridY} endpoint
 * Contains detailed forecast data including fire weather indices and severe weather
 */
export interface GridpointProperties extends GridpointFireWeather, GridpointSevereWeather {
  '@id': string;
  '@type': string;
  updateTime: string;
  validTimes: string;
  elevation: QuantitativeValue;
  forecastOffice: string;
  gridId: string;
  gridX: number;
  gridY: number;
  temperature?: GridpointDataSeries;
  dewpoint?: GridpointDataSeries;
  relativeHumidity?: GridpointDataSeries;
  apparentTemperature?: GridpointDataSeries;
  heatIndex?: GridpointDataSeries;
  windChill?: GridpointDataSeries;
  skyCover?: GridpointDataSeries;
  windDirection?: GridpointDataSeries;
  windSpeed?: GridpointDataSeries;
  windGust?: GridpointDataSeries;
  weather?: {
    values: Array<{
      validTime: string;
      value: Array<{
        coverage: string | null;
        weather: string | null;
        intensity: string | null;
        visibility: QuantitativeValue | null;
        attributes: string[];
      }>;
    }>;
  };
  hazards?: {
    values: Array<{
      validTime: string;
      value: Array<{
        phenomenon: string;
        significance: string;
        event_number: number | null;
      }>;
    }>;
  };
}

export type GridpointResponse = NOAAResponse<GridpointProperties>;
