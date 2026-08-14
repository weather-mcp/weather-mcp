/**
 * NASA GIBS (Global Imagery Browse Services) basemap client — the opaque
 * land/water base plus a transparent coastline/border outline layer, fetched
 * and stitched into one 512px composite for the radar-imagery overlay path.
 *
 * See `docs/plans/composited-imagery-plan.md` (D2, D6) and
 * `docs/plans/composited-imagery-implementation-plan.md` ("Findings that shape the
 * graph") for why this shape:
 *
 *   - **GIBS tile matrix sets are layer-specific.** `src/services/gibs.ts`
 *     hardcodes `GoogleMapsCompatible_Level7` for the GeoColor satellite
 *     layer, but that constant does not apply here — a wrong matrix set
 *     returns HTTP 400 `InvalidParameterValue TILEMATRIXSET` (verified
 *     live). `OSM_Land_Water_Map` uses `GoogleMapsCompatible_Level9`;
 *     `Reference_Features_15m` uses `GoogleMapsCompatible_Level13`. Each
 *     layer therefore carries its own matrix set constant below rather than
 *     sharing one.
 *   - **WMTS REST path order is `{z}/{row=y}/{col=x}`** — y before x — same
 *     convention as `gibs.ts`.
 *   - Output is a window **centered on the requested coordinates**, not a
 *     whole tile, so a location never lands against the edge of its own map.
 *     The covering 256px tiles at zoom `z+1` are assembled and cropped
 *     (`assembleTiles`/`cropTo`, from `src/utils/composite.ts`) — pixel-exact,
 *     no resampling, since zoom `z+1` at 256px is the same grid as zoom `z`
 *     at 512px.
 *   - The land/water layer is opaque (`flattenOpaque` forces alpha 255 after
 *     stitching, since GIBS occasionally emits antialiased seam pixels with
 *     alpha < 255); the features layer is intentionally transparent and is
 *     `blendOnto` the base afterward.
 *   - **Composite failures are garnish, not contract** (ACIS/NIFC
 *     precedent — see Findings): this service throws plain `Error`s, no
 *     retry ladder, no custom `ApiError` subclass. The imagery handler
 *     catches everything from this path and degrades to the normal
 *     URL-based text output.
 *
 * Raw tile buffers are cached individually, keyed `layer/z/y/x`, at
 * `CacheConfig.ttl.basemapTiles` — near-static reference layers, so caching
 * hard is safe and keeps repeat composites to zero additional GIBS fetches.
 */

import axios, { AxiosInstance } from 'axios';
import { Cache } from '../utils/cache.js';
import { CacheConfig } from '../config/cache.js';
import { VERSION } from '../utils/version.js';
import {
  PNG,
  assembleTiles,
  cropTo,
  flattenOpaque,
  blendOnto,
  encodePng,
  planTileWindow
} from '../utils/composite.js';

/** WMTS REST base for EPSG:3857 "best" imagery — same endpoint family as `gibs.ts`. */
const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

/** Descriptive User-Agent for this service only, per the METAR precedent — does not touch the shared `getUserAgent()`. */
const BASEMAP_USER_AGENT = `weather-mcp/${VERSION} (+https://github.com/weather-mcp/weather-mcp)`;

/** A GIBS layer's name and its (layer-specific) WMTS tile matrix set. */
interface GibsLayer {
  readonly name: string;
  readonly matrixSet: string;
  /**
   * When true, a **404** for one of this layer's tiles is treated as an empty
   * transparent tile instead of failing the composite — see
   * `MISSING_OPTIONAL_TILE`.
   */
  readonly optional?: boolean;
}

/** Opaque land/water base layer — required; without it there is no map. */
export const BASE_LAYER: GibsLayer = {
  name: 'OSM_Land_Water_Map',
  matrixSet: 'GoogleMapsCompatible_Level9',
};

/**
 * Transparent coastline/border outline layer, blended over the base.
 *
 * Marked optional because GIBS does not serve a tile everywhere: at extreme
 * polar rows there is no coastline or border to draw and the tile 404s
 * (observed live at `7/1/63` and `7/126/63`). Losing decorative outlines is
 * not a reason to lose the whole map, so a 404 here degrades to a blank tile.
 * **Only 404 is tolerated** — a wrong tile matrix set returns 400, which must
 * still fail loudly rather than silently rendering a base-only map.
 */
export const FEATURES_LAYER: GibsLayer = {
  name: 'Reference_Features_15m',
  matrixSet: 'GoogleMapsCompatible_Level13',
  optional: true,
};

/** A fully transparent 256px tile, standing in for an absent optional tile. */
const MISSING_OPTIONAL_TILE = encodePng(new PNG({ width: 256, height: 256 }));

/**
 * Build a WMTS REST tile URL for a specific layer/matrix set and address.
 * Path order is `{z}/{row=y}/{col=x}` (see module doc comment).
 */
function buildTileUrl(layer: GibsLayer, z: number, x: number, y: number): string {
  return `${GIBS_BASE}/${layer.name}/default/${layer.matrixSet}/${z}/${y}/${x}.png`;
}

/**
 * GIBS serves these layers as 256px tiles addressed at zoom `z + 1`, which is
 * the same grid as the 512px radar tiles at zoom `z` (see `worldPixelSize` in
 * `src/utils/composite.ts`) — so the base layers are always fetched one zoom
 * level in from the radar frame's own zoom.
 */
const BASE_TILE_PIXELS = 256;

export class BasemapService {
  private client: AxiosInstance;
  private cache: Cache<Buffer>;

  constructor() {
    this.cache = new Cache(CacheConfig.maxSize);
    this.client = axios.create({
      timeout: CacheConfig.apiTimeoutMs,
      headers: {
        'User-Agent': BASEMAP_USER_AGENT,
      },
    });
  }

  /**
   * Fetch one raw tile buffer, serving from cache when available. Any
   * network/HTTP failure is rethrown as a plain `Error` (garnish precedent —
   * see module doc comment); there is no retry ladder.
   * @private
   */
  private async fetchTile(layer: GibsLayer, z: number, x: number, y: number): Promise<Buffer> {
    const cacheKey = `${layer.name}/${z}/${y}/${x}`;

    if (CacheConfig.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const url = buildTileUrl(layer, z, x, y);
    let buffer: Buffer;
    try {
      const response = await this.client.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
      buffer = Buffer.from(response.data);
    } catch (error) {
      if (layer.optional && axios.isAxiosError(error) && error.response?.status === 404) {
        // Nothing to draw here (see FEATURES_LAYER) — carry on with a blank
        // tile, and cache it so the known-absent tile isn't re-requested.
        buffer = MISSING_OPTIONAL_TILE;
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`GIBS basemap tile fetch failed for ${layer.name} ${z}/${y}/${x}: ${detail}`);
      }
    }

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, buffer, CacheConfig.ttl.basemapTiles);
    }

    return buffer;
  }

  /**
   * Fetch a single layer's tiles covering `window` and assemble them into one
   * image (uncropped — the caller crops once, after blending).
   * @private
   */
  private async fetchLayerWindow(
    layer: GibsLayer,
    tileZ: number,
    window: ReturnType<typeof planTileWindow>
  ): Promise<PNG> {
    const addresses = window.tileYs.flatMap((ty) => window.tileXs.map((tx) => [tx, ty] as const));
    const buffers = await Promise.all(
      addresses.map(([tx, ty]) => this.fetchTile(layer, tileZ, tx, ty))
    );

    return assembleTiles(buffers, window.tileXs.length, window.tileYs.length, BASE_TILE_PIXELS);
  }

  /**
   * Build the base map for a `size`×`size` window whose top-left corner sits
   * at global pixel `(gx0, gy0)` in the zoom-`z` pixel space (see
   * `worldPixelSize` in `src/utils/composite.ts`).
   *
   * Fetches the covering tiles of `BASE_LAYER` and `FEATURES_LAYER` at zoom
   * `z + 1` (2x2 to 3x3 per layer depending on how the window straddles tile
   * boundaries — individually cached, so neighbouring requests and repeat
   * calls mostly hit cache), assembles each layer, flattens the land/water
   * base opaque, blends the outline layer over it, and crops to the window.
   *
   * Both layers' fetches run concurrently. If any tile fails the whole call
   * rejects — no partial base map is ever returned.
   */
  async getBaseWindow(z: number, gx0: number, gy0: number, size: number): Promise<PNG> {
    const tileZ = z + 1;
    const window = planTileWindow(gx0, gy0, size, BASE_TILE_PIXELS, z);

    const [base, features] = await Promise.all([
      this.fetchLayerWindow(BASE_LAYER, tileZ, window),
      this.fetchLayerWindow(FEATURES_LAYER, tileZ, window),
    ]);

    flattenOpaque(base);
    blendOnto(base, features);

    return cropTo(base, window.offsetX, window.offsetY, size, size);
  }
}

// Singleton instance
export const basemapService = new BasemapService();
