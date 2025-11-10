/**
 * Handler for get_weather_imagery tool
 * Provides weather radar, satellite, and precipitation imagery
 */

import { WeatherImageryParams, WeatherImageryResponse, ImageryType } from '../types/imagery.js';
import { rainViewerService } from '../services/rainviewer.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { ValidationError } from '../errors/ApiError.js';

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

  // Validate layers array if provided
  if (params.layers !== undefined) {
    if (!Array.isArray(params.layers)) {
      throw new ValidationError('layers parameter must be an array', 'layers', params.layers);
    }
    if (params.layers.length > 10) {
      throw new ValidationError('Maximum 10 layers allowed', 'layers', params.layers);
    }
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

  // For now, we'll focus on precipitation radar using RainViewer
  // Future enhancements can add NOAA radar and satellite imagery
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
      // Placeholder for satellite imagery
      // Future implementation can use NOAA GOES-16/17 or other satellite APIs
      throw new ValidationError(
        'Satellite imagery is not yet implemented. Use type="precipitation" or type="radar" for precipitation radar.',
        'type',
        type
      );
    }

    default: {
      throw new ValidationError(`Unsupported imagery type: ${type}`, 'type', type);
    }
  }
}

/**
 * Format weather imagery response for display
 */
export function formatWeatherImageryResponse(response: WeatherImageryResponse): string {
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

    // Show first, middle, and last frames for brevity
    const framesToShow = response.frames.length <= 5
      ? response.frames
      : [
          response.frames[0],
          response.frames[Math.floor(response.frames.length / 2)],
          response.frames[response.frames.length - 1]
        ];

    framesToShow.forEach((frame) => {
      const frameNumber = response.frames.indexOf(frame) + 1;
      lines.push(`### Frame ${frameNumber} - ${frame.timestamp.toISOString()}`);
      lines.push(`![${frame.description || 'Weather imagery'}](${frame.url})`);
      lines.push('');
    });

    if (response.frames.length > 5) {
      lines.push(`*Showing 3 of ${response.frames.length} frames for brevity*`);
      lines.push('');
    }
  } else if (response.frames.length > 0) {
    lines.push('## 📸 Current Imagery');
    lines.push('');
    const frame = response.frames[0];
    lines.push(`**Timestamp:** ${frame.timestamp.toISOString()}`);
    lines.push(`![${frame.description || 'Weather imagery'}](${frame.url})`);
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
