/**
 * Handler for get_weather_imagery tool
 * Provides weather radar, satellite, and precipitation imagery
 */

import { WeatherImageryParams, WeatherImageryResponse, ImageryType } from '../types/imagery.js';
import { rainViewerService } from '../services/rainviewer.js';
import { gibsService } from '../services/gibs.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateLatitude, validateLongitude, validateDetail, DetailLevel } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { ValidationError } from '../errors/ApiError.js';

interface WeatherImageryArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  type?: ImageryType;
  animated?: boolean;
  detail?: DetailLevel;
}

/**
 * Tool entry point: resolve the location (coordinates, saved name, or geocoded
 * city), fetch imagery, and format it. Markdown image embeds are opt-in via
 * detail="full"; the default surfaces direct URLs and metadata (lighter for
 * text-only agents).
 */
export async function handleGetWeatherImagery(
  args: unknown,
  locationStore: LocationStore,
  geocodingService: GeocodingService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const typedArgs = (args ?? {}) as WeatherImageryArgs;
  const resolved = await resolveLocationAsync(typedArgs, locationStore, geocodingService);
  const detail = validateDetail(typedArgs.detail);

  const result = await getWeatherImagery({
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    type: (typedArgs.type ?? 'precipitation') as ImageryType,
    animated: typedArgs.animated
  });

  const formatted = formatWeatherImageryResponse(result, detail);

  return prependLocationLine({
    content: [
      {
        type: 'text',
        text: formatted
      }
    ]
  }, resolved);
}

/**
 * Validate imagery request parameters
 */
function validateImageryParams(params: WeatherImageryParams): void {
  // Validate coordinates
  validateLatitude(params.latitude);
  validateLongitude(params.longitude);

  // Validate imagery type
  const validTypes: ImageryType[] = ['radar', 'satellite', 'precipitation'];
  if (!validTypes.includes(params.type)) {
    throw new ValidationError(
      `Invalid imagery type: ${params.type}. Must be one of: ${validTypes.join(', ')}`,
      'type',
      params.type
    );
  }

  // Validate boolean parameters
  if (params.animated !== undefined && typeof params.animated !== 'boolean') {
    throw new ValidationError('animated parameter must be a boolean', 'animated', params.animated);
  }
}

/**
 * Get weather imagery based on type
 */
export async function getWeatherImagery(params: WeatherImageryParams): Promise<WeatherImageryResponse> {
  // Validate parameters
  validateImageryParams(params);

  const { latitude, longitude, type, animated = false } = params;

  // Redact coordinates for logging to protect user privacy
  const redacted = redactCoordinatesForLogging(latitude, longitude);
  logger.info('Weather imagery requested', {
    latitude: redacted.lat,
    longitude: redacted.lon,
    type,
    animated
  });

  // Precipitation/radar via RainViewer (global); satellite via NASA GIBS GOES.
  switch (type) {
    case 'precipitation':
    case 'radar': {
      const frames = await rainViewerService.getPrecipitationRadar(latitude, longitude, animated);

      return {
        type,
        location: { latitude, longitude },
        coverage: 'Global',
        resolution: animated ? `${frames.length} frames` : 'Latest snapshot',
        source: 'RainViewer',
        animated,
        frames,
        generatedAt: new Date(),
        disclaimer: 'RainViewer provides global precipitation radar. Data may have 5-10 minute delay. For official forecasts, consult local meteorological services.'
      };
    }

    case 'satellite': {
      // NOAA GOES-East/West ABI GeoColor via NASA GIBS (Western Hemisphere).
      // Satellite returns the latest snapshot only (no animation — GIBS sub-daily
      // timestamps are irregular; use type="radar" for animated loops).
      const frames = gibsService.getSatelliteImagery(latitude, longitude);

      return {
        type,
        location: { latitude, longitude },
        coverage: 'Western Hemisphere (Americas / eastern Pacific)',
        resolution: 'Latest snapshot',
        source: 'NASA GIBS (NOAA GOES GeoColor)',
        animated: false,
        frames,
        generatedAt: new Date(),
        disclaimer: 'Satellite imagery from NASA GIBS using NOAA GOES-East/West ABI GeoColor. Coverage is the Western Hemisphere; locations outside GOES range may appear blank. Shows the latest snapshot only (animation not available for satellite). Imagery has a processing delay of roughly 20-30 minutes.'
      };
    }

    default: {
      throw new ValidationError(`Unsupported imagery type: ${type}`, 'type', type);
    }
  }
}

/**
 * Render a single imagery frame line.
 * At detail="full" the image is embedded as Markdown so rich clients render it;
 * otherwise the direct URL is shown as text (cheaper, and usable by text-only
 * agents that would otherwise carry an un-renderable image tag).
 */
function formatFrameLine(
  frame: { url: string; description?: string },
  detail: DetailLevel
): string {
  if (detail === 'full') {
    return `![${frame.description || 'Weather imagery'}](${frame.url})`;
  }
  return `**Image URL:** ${frame.url}`;
}

/**
 * Format weather imagery response for display
 * @param response - Imagery result to render
 * @param detail - Verbosity; "full" embeds Markdown images, otherwise URLs are text
 */
export function formatWeatherImageryResponse(
  response: WeatherImageryResponse,
  detail: DetailLevel = 'standard'
): string {
  const lines: string[] = [];

  lines.push('# Weather Imagery');
  lines.push('');
  lines.push(`**Location:** ${response.location.latitude.toFixed(4)}, ${response.location.longitude.toFixed(4)}`);
  lines.push(`**Type:** ${response.type.charAt(0).toUpperCase() + response.type.slice(1)}`);
  lines.push(`**Coverage:** ${response.coverage}`);

  if (response.resolution) {
    lines.push(`**Resolution:** ${response.resolution}`);
  }

  lines.push(`**Source:** ${response.source}`);
  lines.push(`**Animated:** ${response.animated ? 'Yes' : 'No'}`);
  lines.push('');

  // Display frames
  if (response.animated && response.frames.length > 1) {
    lines.push(`## 🎬 Animation Frames (${response.frames.length} frames)`);
    lines.push('');

    // detail="full" lists every frame; summary/standard show first, middle,
    // and last for brevity (all frames when there are 5 or fewer either way).
    const showAllFrames = detail === 'full' || response.frames.length <= 5;
    const indicesToShow = showAllFrames
      ? response.frames.map((_, index) => index)
      : [0, Math.floor(response.frames.length / 2), response.frames.length - 1];

    indicesToShow.forEach((index) => {
      const frame = response.frames[index];
      const frameNumber = index + 1;
      lines.push(`### Frame ${frameNumber} - ${frame.timestamp.toISOString()}`);
      lines.push(formatFrameLine(frame, detail));
      lines.push('');
    });

    if (!showAllFrames) {
      lines.push(`*Showing 3 of ${response.frames.length} frames for brevity — use detail="full" for all frames*`);
      lines.push('');
    }
  } else if (response.frames.length > 0) {
    lines.push('## 📸 Current Imagery');
    lines.push('');
    const frame = response.frames[0];
    lines.push(`**Timestamp:** ${frame.timestamp.toISOString()}`);
    lines.push(formatFrameLine(frame, detail));
    lines.push('');
  } else {
    lines.push('## ⚠️ No Imagery Available');
    lines.push('');
    lines.push('No imagery data is currently available for this location and time.');
    lines.push('');
  }

  // Add disclaimer if present
  if (response.disclaimer) {
    lines.push('---');
    lines.push('');
    lines.push(`⚠️ **DISCLAIMER:** ${response.disclaimer}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated: ${response.generatedAt.toISOString()}*`);
  lines.push(`*Data source: ${response.source}*`);

  return lines.join('\n');
}
