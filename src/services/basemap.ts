/**
 * NASA GIBS (Global Imagery Browse Services) basemap client — the opaque
 * land/water base plus a transparent coastline/border outline layer, fetched
 * and stitched into one 512px composite for the radar-imagery overlay path.
 *
 * See `docs/composited-imagery-plan.md` (D2, D6) and
 * `docs/composited-imagery-implementation-plan.md` ("Findings that shape the
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
 *   - A 512px composite tile at zoom `z` is assembled from the four 256px
 *     children of each layer at zoom `z+1` (`stitch512`, from
 *     `src/utils/composite.ts`), in TL/TR/BL/BR order — pixel-exact, no
 *     resampling.
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
import { PNG, stitch512, flattenOpaque, blendOnto } from '../utils/composite.js';

/** WMTS REST base for EPSG:3857 "best" imagery — same endpoint family as `gibs.ts`. */
const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

/** Descriptive User-Agent for this service only, per the METAR precedent — does not touch the shared `getUserAgent()`. */
const BASEMAP_USER_AGENT = `weather-mcp/${VERSION} (+https://github.com/weather-mcp/weather-mcp)`;

/** A GIBS layer's name and its (layer-specific) WMTS tile matrix set. */
interface GibsLayer {
  readonly name: string;
  readonly matrixSet: string;
}

/** Opaque land/water base layer. */
export const BASE_LAYER: GibsLayer = {
  name: 'OSM_Land_Water_Map',
  matrixSet: 'GoogleMapsCompatible_Level9',
};

/** Transparent coastline/border outline layer, blended over the base. */
export const FEATURES_LAYER: GibsLayer = {
  name: 'Reference_Features_15m',
  matrixSet: 'GoogleMapsCompatible_Level13',
};

/**
 * Build a WMTS REST tile URL for a specific layer/matrix set and address.
 * Path order is `{z}/{row=y}/{col=x}` (see module doc comment).
 */
function buildTileUrl(layer: GibsLayer, z: number, x: number, y: number): string {
  return `${GIBS_BASE}/${layer.name}/default/${layer.matrixSet}/${z}/${y}/${x}.png`;
}

/**
 * The four z+1 web-mercator children of tile `(x, y)`, in TL/TR/BL/BR order
 * — the order `stitch512` expects.
 */
function childTileAddresses(x: number, y: number): Array<[number, number]> {
  return [
    [2 * x, 2 * y], // TL
    [2 * x + 1, 2 * y], // TR
    [2 * x, 2 * y + 1], // BL
    [2 * x + 1, 2 * y + 1], // BR
  ];
}

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
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`GIBS basemap tile fetch failed for ${layer.name} ${z}/${y}/${x}: ${detail}`);
    }

    if (CacheConfig.enabled) {
      this.cache.set(cacheKey, buffer, CacheConfig.ttl.basemapTiles);
    }

    return buffer;
  }

  /**
   * Fetch, stitch, and blend the 512px base composite for the tile at
   * `(z, x, y)`: the four z+1 children of `BASE_LAYER` and `FEATURES_LAYER`
   * (8 tile fetches total, cached individually), stitched with `stitch512`,
   * the base flattened opaque, and the features layer blended on top.
   *
   * Fetches for both layers' four children run concurrently. If any of the 8
   * fetches fails, the whole call rejects — no partial composite is ever
   * returned.
   */
  async getBaseComposite(z: number, x: number, y: number): Promise<PNG> {
    const childZ = z + 1;
    const children = childTileAddresses(x, y);

    const [baseTiles, featureTiles] = await Promise.all([
      Promise.all(children.map(([cx, cy]) => this.fetchTile(BASE_LAYER, childZ, cx, cy))),
      Promise.all(children.map(([cx, cy]) => this.fetchTile(FEATURES_LAYER, childZ, cx, cy))),
    ]);

    const base = stitch512(baseTiles as [Buffer, Buffer, Buffer, Buffer]);
    const features = stitch512(featureTiles as [Buffer, Buffer, Buffer, Buffer]);

    flattenOpaque(base);
    blendOnto(base, features);

    return base;
  }
}

// Singleton instance
export const basemapService = new BasemapService();
