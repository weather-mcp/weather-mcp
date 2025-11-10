/**
 * Type definitions for weather imagery data
 * Supports NOAA radar/satellite and RainViewer precipitation radar
 */

/**
 * Weather imagery type
 */
export type ImageryType = 'radar' | 'satellite' | 'precipitation';

/**
 * Satellite imagery layer options
 */
export type SatelliteLayer = 'visible' | 'infrared' | 'water_vapor' | 'shortwave_infrared';

/**
 * Radar layer options
 */
export type RadarLayer = 'base_reflectivity' | 'composite_reflectivity' | 'precipitation';

/**
 * Weather imagery request parameters
 */
export interface WeatherImageryParams {
  latitude: number;
  longitude: number;
  type: ImageryType;
  animated?: boolean;
  layers?: string[];
}

/**
 * Single imagery frame
 */
export interface ImageryFrame {
  url: string;
  timestamp: Date;
  description?: string;
}

/**
 * Weather imagery response
 */
export interface WeatherImageryResponse {
  type: ImageryType;
  location: {
    latitude: number;
    longitude: number;
  };
  coverage: string;
  resolution?: string;
  source: string;
  animated: boolean;
  frames: ImageryFrame[];
  generatedAt: Date;
  disclaimer?: string;
}

/**
 * RainViewer API response types
 */
export interface RainViewerFrame {
  time: number;  // Unix timestamp
  path: string;  // Relative path to tile
}

export interface RainViewerResponse {
  version: string;
  generated: number;  // Unix timestamp
  host: string;
  radar: {
    past: RainViewerFrame[];
    nowcast: RainViewerFrame[];
  };
  satellite?: {
    infrared: RainViewerFrame[];
  };
}

/**
 * NOAA radar station information
 */
export interface NOAARadarStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number;
  distance?: number;  // Distance from query point in km
}
