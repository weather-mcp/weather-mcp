/**
 * Types for the aviationweather.gov METAR API
 * (https://aviationweather.gov/api/data/metar) — decoded worldwide station
 * observations, keyless JSON, v4.
 *
 * Field presence and types below are drawn from a live field survey across
 * 242 stations in one bbox response (2026-08-13) — see the "Verified API
 * contract" section of `docs/metar-plan.md`. Fields observed at 100%
 * presence are required; everything else is optional, matching what the API
 * actually returns rather than what the schema notionally promises.
 */

/** Re-exported for METAR callers; the shape is already used by lightning geohashing. */
export type { BoundingBox } from '../utils/geohash.js';

/**
 * A single decoded METAR (or SPECI) station observation.
 *
 * Units, where not obvious from the field name, are noted per-field below —
 * METAR units differ from every other data path in this project (knots,
 * hPa, statute miles, metres/feet AGL), so callers must convert explicitly
 * rather than assume the project's usual imperial/metric defaults.
 */
export interface MetarObservation {
  /** ICAO station identifier, e.g. "KSEA". Always present. */
  icaoId: string;
  /** Station name, e.g. "Seattle-Tacoma Intl". Always present. */
  name: string;
  /** Station latitude, degrees. Always present. */
  lat: number;
  /** Station longitude, degrees. Always present. */
  lon: number;
  /** Station elevation, **metres**. Always present. */
  elev: number;

  /**
   * Observation time as **epoch seconds** (a `number`) — NOT the same
   * format as `reportTime`/`receiptTime` below. This is the easiest field
   * in this type to get wrong: mixing it up with the ISO strings produces
   * a garbage "observed at" time. Always present.
   */
  obsTime: number;
  /**
   * Report time as an **ISO 8601 string** — a different time format from
   * `obsTime` above, in the same object. Always present.
   */
  reportTime: string;
  /**
   * Receipt time as an **ISO 8601 string** (same format as `reportTime`,
   * distinct from the epoch-seconds `obsTime`). Always present.
   */
  receiptTime: string;

  /** The raw METAR text, e.g. "METAR KSEA 131453Z 19006KT ...". Always present. */
  rawOb: string;
  /** Report type: "METAR" (routine) or "SPECI" (off-cycle special). Always present. */
  metarType: string;
  /** Quality-control field, passed through as-is. Always present. */
  qcField: string;

  /** Temperature, **°C**. ~99% presence. */
  temp?: number;
  /** Dew point, **°C**. ~99% presence. */
  dewp?: number;

  /** Wind direction, degrees, or `"VRB"` for variable. ~98% presence. */
  wdir?: number | string;
  /** Wind speed, **knots**. ~98% presence. */
  wspd?: number;
  /** Wind gust, **knots**. ~14% presence. */
  wgst?: number;

  /** Altimeter setting, **hPa**. ~97% presence. */
  altim?: number;
  /** Sea-level pressure, **hPa**. ~84% presence. */
  slp?: number;
  /** 3-hour pressure tendency, **hPa/3h**. ~76% presence. */
  presTend?: number;

  /**
   * Visibility in **statute miles**, or a string qualifier/fraction —
   * `"10+"` (majority case at good-visibility stations) or a fraction like
   * `"1/2"`. ~97% presence.
   */
  visib?: number | string;

  /**
   * Sky condition layers, low to high. `base` is **feet AGL** (verified:
   * `SCT110` → base `11000`, `BKN024` → base `2400`). ~96% presence.
   */
  clouds?: Array<{ cover: string; base?: number }>;

  /** Pre-computed flight category: VFR / MVFR / IFR / LIFR. ~96% presence. */
  fltCat?: string;

  /** Present-weather string, e.g. "FG", "FU". ~8% presence. */
  wxString?: string;

  /** 3-hour precipitation, **inches**. ~5-7% presence. */
  pcp3hr?: number;
  /** Precipitation (period per station practice), **inches**. ~5-7% presence. */
  precip?: number;
}
