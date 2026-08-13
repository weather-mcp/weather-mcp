/**
 * Handler for get_weather_imagery tool
 * Provides weather radar, satellite, and precipitation imagery
 */

import axios from 'axios';
import {
  WeatherImageryParams,
  WeatherImageryResponse,
  ImageryType,
  ImageryFrame,
  ImageryContentBlock
} from '../types/imagery.js';
import { rainViewerService } from '../services/rainviewer.js';
import { gibsService } from '../services/gibs.js';
import { basemapService } from '../services/basemap.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateLatitude, validateLongitude, validateDetail, DetailLevel } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { ValidationError } from '../errors/ApiError.js';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { VERSION } from '../utils/version.js';
import {
  PNG,
  parseRadarTileUrl,
  latLonToTilePixel,
  blendOnto,
  drawMarker,
  encodePng,
  MAX_COMPOSITE_BYTES
} from '../utils/composite.js';

interface WeatherImageryArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  type?: ImageryType;
  animated?: boolean;
  composite?: boolean;
  detail?: DetailLevel;
}

/**
 * Encoded composites, keyed on (frame URL, tile address, marker pixel) — the
 * three things that fully determine the output image. Radar frames are
 * immutable once published under their timestamp, so a repeat call inside the
 * feed cycle is looking at the identical picture
 * (`CacheConfig.ttl.compositeImage`).
 */
const compositeCache = new Cache<Buffer>(CacheConfig.maxSize);

/** Descriptive User-Agent for overlay tile fetches, matching the basemap service. */
const COMPOSITE_USER_AGENT = `weather-mcp/${VERSION} (+https://github.com/weather-mcp/weather-mcp)`;

/**
 * Appended when compositing was requested but couldn't be produced. The tool
 * call itself never fails because the composite failed — the imagery the
 * caller asked for still arrives as URLs (garnish precedent, see
 * docs/composited-imagery-implementation-plan.md "Findings").
 */
const COMPOSITE_UNAVAILABLE_NOTE =
  '\n*Composite map unavailable for this request — the tile URLs and interactive-map link above still apply.*\n';

/**
 * The most recent frame that has actually been observed.
 *
 * With `animated: true` RainViewer may append nowcast (forecast) frames after
 * the observed ones, and a forecast tile is not what "the latest radar" means
 * — so pick the newest frame at or before now, which is exactly the frame a
 * non-animated request returns. Falls back to the last frame if every
 * timestamp somehow reads as future (clock skew).
 */
function latestObservedFrame(frames: ImageryFrame[]): ImageryFrame | undefined {
  if (frames.length === 0) {
    return undefined;
  }
  const now = Date.now();
  const observed = frames.filter((frame) => frame.timestamp.getTime() <= now);
  return observed.length > 0 ? observed[observed.length - 1] : frames[frames.length - 1];
}

/** Fetch a single RainViewer overlay tile as a raw buffer. */
async function fetchRadarTile(url: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: CacheConfig.apiTimeoutMs,
    headers: { 'User-Agent': COMPOSITE_USER_AGENT }
  });
  return Buffer.from(response.data);
}

/**
 * Composite one radar frame onto the GIBS base map and mark the requested
 * location, returning the PNG as base64.
 *
 * Throws on any failure (unparseable URL, fetch, decode, over-cap encode) —
 * the caller degrades to text-only output.
 */
async function renderComposite(
  frame: ImageryFrame,
  latitude: number,
  longitude: number
): Promise<{ base64: string; zoom: number }> {
  const tile = parseRadarTileUrl(frame.url);
  if (!tile) {
    throw new Error('Radar frame URL does not carry a parseable /512/{z}/{x}/{y}/ tile address');
  }

  const { z, x, y } = tile;
  const { px, py } = latLonToTilePixel(latitude, longitude, z, x, y);
  const markerX = Math.round(px);
  const markerY = Math.round(py);

  const cacheKey = `${frame.url}|${z}/${x}/${y}|${markerX},${markerY}`;
  if (CacheConfig.enabled) {
    const cached = compositeCache.get(cacheKey);
    if (cached) {
      return { base64: cached.toString('base64'), zoom: z };
    }
  }

  const overlay = PNG.sync.read(await fetchRadarTile(frame.url));
  const composited = await basemapService.getBaseComposite(z, x, y);

  blendOnto(composited, overlay);
  drawMarker(composited, markerX, markerY);

  const encoded = encodePng(composited);
  if (encoded.length > MAX_COMPOSITE_BYTES) {
    throw new Error(
      `Composite of ${encoded.length} bytes exceeds the ${MAX_COMPOSITE_BYTES}-byte cap`
    );
  }

  if (CacheConfig.enabled) {
    compositeCache.set(cacheKey, encoded, CacheConfig.ttl.compositeImage);
  }

  return { base64: encoded.toString('base64'), zoom: z };
}

/** Lines describing an attached composite, including the required attributions. */
function compositeAttachmentLines(frame: ImageryFrame, zoom: number, animated: boolean): string {
  const lines = [
    '',
    `**Composited map attached:** radar frame ${frame.timestamp.toISOString()} at zoom ${zoom}, rendered over a NASA GIBS base map with a marker at the requested location.`
  ];

  if (animated) {
    lines.push(
      '*The animation frames above stay URL-based — only the latest frame is composited.*'
    );
  }

  lines.push('');
  lines.push('*Radar imagery © RainViewer.*');
  lines.push(
    "*Imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).*"
  );

  return lines.join('\n');
}

/**
 * Tool entry point: resolve the location (coordinates, saved name, or geocoded
 * city), fetch imagery, and format it. Markdown image embeds are opt-in via
 * detail="full"; the default surfaces direct URLs and metadata (lighter for
 * text-only agents).
 *
 * With `composite: true` the result additionally carries an MCP image content
 * block — the radar overlay rendered onto a base map (see the composite
 * helpers above). Requests without it are unaffected: same single text block,
 * same bytes.
 */
export async function handleGetWeatherImagery(
  args: unknown,
  locationStore: LocationStore,
  geocodingService: GeocodingService
): Promise<{ content: ImageryContentBlock[] }> {
  const typedArgs = (args ?? {}) as WeatherImageryArgs;
  const resolved = await resolveLocationAsync(typedArgs, locationStore, geocodingService);
  const detail = validateDetail(typedArgs.detail);

  const result = await getWeatherImagery({
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    type: (typedArgs.type ?? 'precipitation') as ImageryType,
    animated: typedArgs.animated,
    composite: typedArgs.composite
  });

  let formatted = formatWeatherImageryResponse(result, detail);
  const content: ImageryContentBlock[] = [];

  if (typedArgs.composite === true) {
    if (result.type === 'satellite') {
      // A note, not an error — GeoColor is already a finished picture, so
      // there is nothing to composite it onto (D7).
      formatted +=
        '\n*Note: composite rendering is available for radar/precipitation only. Satellite imagery is already a complete picture and needs no base map.*\n';
    } else {
      const frame = latestObservedFrame(result.frames);

      if (!frame) {
        formatted += COMPOSITE_UNAVAILABLE_NOTE;
      } else {
        try {
          const { base64, zoom } = await renderComposite(
            frame,
            resolved.latitude,
            resolved.longitude
          );
          formatted += compositeAttachmentLines(frame, zoom, result.animated);
          content.push({ type: 'image', data: base64, mimeType: 'image/png' });
        } catch (error) {
          logger.warn('Composite imagery unavailable, returning URL-based output', {
            error: error instanceof Error ? error.message : String(error)
          });
          formatted += COMPOSITE_UNAVAILABLE_NOTE;
        }
      }
    }
  }

  content.unshift({ type: 'text', text: formatted });

  return prependLocationLine({ content }, resolved);
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

  if (params.composite !== undefined && typeof params.composite !== 'boolean') {
    throw new ValidationError('composite parameter must be a boolean', 'composite', params.composite);
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

  // Interactive-map link: a raw tile is a transparent overlay with no base map,
  // so point at a first-party browser viewer that layers it properly (URL
  // formats verified live 2026-08-13: RainViewer's own embed pages use
  // map.html?loc=lat,lon,zoom; NASA Worldview docs use v=minLon,minLat,maxLon,maxLat).
  const { latitude, longitude } = response.location;
  if (response.type === 'radar' || response.type === 'precipitation') {
    lines.push(`**Interactive map:** https://www.rainviewer.com/map.html?loc=${latitude.toFixed(4)},${longitude.toFixed(4)},7`);
    lines.push('*Opens live animated radar over a base map in the browser — the frame URLs above are transparent overlay tiles (blank where dry) and expire within about two hours.*');
    lines.push('');
  } else if (response.type === 'satellite') {
    const south = Math.max(latitude - 5, -90).toFixed(2);
    const north = Math.min(latitude + 5, 90).toFixed(2);
    lines.push(`**Interactive map:** https://worldview.earthdata.nasa.gov/?v=${(longitude - 7).toFixed(2)},${south},${(longitude + 7).toFixed(2)},${north}`);
    lines.push('*Opens NASA Worldview centered on this area — pan, zoom, and layer satellite imagery in the browser.*');
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
