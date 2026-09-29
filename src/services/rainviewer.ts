/**
 * RainViewer API client for global precipitation radar imagery
 * Free API with no authentication required
 * @see https://www.rainviewer.com/api.html
 */

import axios, { AxiosInstance } from 'axios';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { RainViewerResponse, RainViewerFrame, ImageryFrame } from '../types/imagery.js';
import { ServiceUnavailableError } from '../errors/ApiError.js';

/** Metadata body cap. The live `weather-maps.json` measured 818 bytes (2026-09-28). */
export const RAINVIEWER_MAX_METADATA_BYTES = 256 * 1024;

/** Frame path length cap. Live paths measured 22 characters (2026-09-28). */
const MAX_FRAME_PATH_LENGTH = 128;

/**
 * Frame path grammar: one or more `/`-led segments of letters, digits, `_` and `-`.
 * No `@`, `\`, `%`, `.`, `:`, `?` or `#` can pass, so the URL built by joining the
 * path to the fixed tile host always keeps that host as its authority.
 */
const FRAME_PATH_PATTERN = /^(\/[A-Za-z0-9_-]+)+$/;

/** The largest `time` (seconds) for which `new Date(time * 1000)` is valid (ECMAScript limit). */
const MAX_FRAME_TIME_SECONDS = 8.64e12;

type FrameRejectReason = 'shape' | 'path' | 'time';

/**
 * Check one frame. Returns the reason it is invalid, or null when it is valid.
 */
function frameRejectReason(frame: unknown): FrameRejectReason | null {
  if (typeof frame !== 'object' || frame === null) {
    return 'shape';
  }
  const { path, time } = frame as { path?: unknown; time?: unknown };
  if (
    typeof path !== 'string' ||
    path.length > MAX_FRAME_PATH_LENGTH ||
    !FRAME_PATH_PATTERN.test(path)
  ) {
    return 'path';
  }
  if (
    typeof time !== 'number' ||
    !Number.isFinite(time) ||
    Math.abs(time) > MAX_FRAME_TIME_SECONDS
  ) {
    return 'time';
  }
  return null;
}

/**
 * Count the invalid frames in `past` and `nowcast`. An absent array is allowed;
 * a present value that is not an array is invalid. `reason` is the first failure's code.
 */
function countInvalidFrames(radar: { past?: unknown; nowcast?: unknown }): {
  count: number;
  reason: FrameRejectReason | null;
} {
  let count = 0;
  let reason: FrameRejectReason | null = null;
  for (const frames of [radar.past, radar.nowcast]) {
    if (frames === undefined) {
      continue;
    }
    if (!Array.isArray(frames)) {
      count += 1;
      reason ??= 'shape';
      continue;
    }
    for (const frame of frames) {
      const frameReason = frameRejectReason(frame);
      if (frameReason !== null) {
        count += 1;
        reason ??= frameReason;
      }
    }
  }
  return { count, reason };
}

export class RainViewerService {
  private client: AxiosInstance;
  private readonly baseUrl = 'https://api.rainviewer.com';
  private readonly tileHost = 'https://tilecache.rainviewer.com';

  constructor() {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      maxRedirects: 0,
      maxContentLength: RAINVIEWER_MAX_METADATA_BYTES,
      headers: {
        'User-Agent': 'weather-mcp-server/1.4.0'
      }
    });
  }

  /**
   * Get latest precipitation radar data
   * Returns timestamps and paths for animated radar
   */
  async getRadarData(): Promise<RainViewerResponse> {
    try {
      logger.info('Fetching RainViewer radar data');

      const response = await this.client.get<RainViewerResponse>('/public/weather-maps.json');

      if (!response.data || !response.data.radar) {
        throw new ServiceUnavailableError(
          'RainViewer',
          'Invalid response format from RainViewer API'
        );
      }

      // Every frame path is joined to the tile host and every time becomes a Date,
      // so one bad frame refuses the whole response rather than being dropped.
      const invalid = countInvalidFrames(response.data.radar);
      if (invalid.count > 0) {
        logger.warn('RainViewer radar metadata rejected', {
          invalidFrames: invalid.count,
          reason: invalid.reason,
          securityEvent: true
        });
        throw new ServiceUnavailableError(
          'RainViewer',
          'RainViewer returned radar frames in an unexpected format'
        );
      }

      logger.info('RainViewer radar data retrieved successfully', {
        pastFrames: response.data.radar.past?.length || 0,
        nowcastFrames: response.data.radar.nowcast?.length || 0
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.message;

        logger.error('RainViewer API request failed', error, {
          status,
          message
        });

        throw new ServiceUnavailableError(
          'RainViewer',
          `Failed to fetch radar data: ${message}`
        );
      }

      throw error;
    }
  }

  /**
   * Build tile URL for a specific frame
   * RainViewer uses tile-based system (similar to web maps)
   */
  buildTileUrl(frame: RainViewerFrame, size: number = 512, zoom: number = 4): string {
    // For global view, we use zoom 4 and tile coordinates for coverage
    // Format: {host}/v2/radar/{timestamp}/{size}/{zoom}/{x}/{y}/tile.png
    const centerX = Math.floor(2 ** (zoom - 1));
    const centerY = Math.floor(2 ** (zoom - 1));

    return `${this.tileHost}${frame.path}/${size}/${zoom}/${centerX}/${centerY}/4/1_1.png`;
  }

  /**
   * Build tile URL for a specific coordinate
   * Clamps latitude to Web Mercator projection range to prevent NaN tile coordinates
   */
  buildCoordinateTileUrl(
    frame: RainViewerFrame,
    latitude: number,
    longitude: number,
    zoom: number = 6
  ): string {
    // Web Mercator projection is undefined at the poles
    // Clamp latitude to safe range (±85.05112878°) to avoid division by zero
    const MAX_LATITUDE = 85.05112878;
    const clampedLat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));

    if (clampedLat !== latitude) {
      logger.warn('Latitude clamped to Web Mercator safe range', {
        original: redactCoordinatesForLogging(latitude, longitude).lat,
        clamped: clampedLat,
        maxLatitude: MAX_LATITUDE
      });
    }

    // Convert lat/lon to tile coordinates
    const x = Math.floor(((longitude + 180) / 360) * 2 ** zoom);
    const y = Math.floor(
      ((1 - Math.log(Math.tan((clampedLat * Math.PI) / 180) + 1 / Math.cos((clampedLat * Math.PI) / 180)) / Math.PI) / 2) *
        2 ** zoom
    );

    return `${this.tileHost}${frame.path}/512/${zoom}/${x}/${y}/4/1_1.png`;
  }

  /**
   * Convert RainViewer frames to standard ImageryFrame format
   */
  convertFrames(frames: RainViewerFrame[], latitude: number, longitude: number): ImageryFrame[] {
    return frames.map(frame => ({
      url: this.buildCoordinateTileUrl(frame, latitude, longitude),
      timestamp: new Date(frame.time * 1000),
      description: `Precipitation radar at ${new Date(frame.time * 1000).toISOString()}`
    }));
  }

  /**
   * Convert RainViewer nowcast frames to ImageryFrame format, labeling each
   * as a forecast frame with its offset in minutes from the latest past frame.
   */
  convertNowcastFrames(
    frames: RainViewerFrame[],
    latestPastTime: number,
    latitude: number,
    longitude: number
  ): ImageryFrame[] {
    return frames.map(frame => {
      const offsetMinutes = Math.round((frame.time - latestPastTime) / 60);
      const offsetLabel = offsetMinutes >= 0 ? `+${offsetMinutes}` : `${offsetMinutes}`;
      return {
        url: this.buildCoordinateTileUrl(frame, latitude, longitude),
        timestamp: new Date(frame.time * 1000),
        description: `${offsetLabel} min forecast (precipitation radar at ${new Date(frame.time * 1000).toISOString()})`
      };
    });
  }

  /**
   * Get recent precipitation radar imagery (past 2 hours)
   */
  async getPrecipitationRadar(
    latitude: number,
    longitude: number,
    animated: boolean = false
  ): Promise<ImageryFrame[]> {
    const data = await this.getRadarData();

    if (!data.radar.past || data.radar.past.length === 0) {
      logger.warn('No past radar data available from RainViewer');
      return [];
    }

    const latestFrame = data.radar.past[data.radar.past.length - 1];

    // If animated, return all past frames plus any forecast (nowcast) frames.
    // Missing/empty nowcast is the normal case — yields exactly today's behavior.
    if (animated) {
      const pastFrames = this.convertFrames(data.radar.past, latitude, longitude);

      if (!data.radar.nowcast || data.radar.nowcast.length === 0) {
        return pastFrames;
      }

      const forecastFrames = this.convertNowcastFrames(
        data.radar.nowcast,
        latestFrame.time,
        latitude,
        longitude
      );

      return [...pastFrames, ...forecastFrames];
    }

    // Otherwise, return only the most recent PAST frame (never nowcast)
    return this.convertFrames([latestFrame], latitude, longitude);
  }
}

// Singleton instance
export const rainViewerService = new RainViewerService();
