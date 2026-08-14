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
  /**
   * Opt in to a finished picture: the radar overlay composited onto a NASA
   * GIBS base map with a location marker, returned as an MCP image content
   * block alongside the text. Radar/precipitation only, latest frame only —
   * see docs/plans/composited-imagery-plan.md (D1, D3).
   */
  composite?: boolean;
}

/**
 * A content block in a get_weather_imagery result.
 *
 * MCP allows mixed content arrays, so a composited request returns
 * `[text, image]`: clients that render images show the finished map, and
 * text-only clients ignore the image block per protocol and still get the
 * complete URL-based answer (D4).
 */
export type ImageryContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

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
    // Live checks (2026-07-16) found this empty and it may be absent
    // entirely — treat missing/empty as the normal case, not an error.
    nowcast?: RainViewerFrame[];
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
