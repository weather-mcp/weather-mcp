/**
 * Response shape for MET Norway (met.no) Locationforecast
 * (`https://api.met.no/weatherapi/locationforecast/2.0/complete`).
 *
 * Every field of an upstream shape is optional, per the project rule for
 * third-party JSON: the parser's job is to narrow, and a required field here
 * would be a promise about someone else's server.
 *
 * Verified live 2026-09-03 against Oslo, Tokyo, and Denver; see
 * `.devdocs/plan-metno-fallback.md` D3 for the observed timeseries shapes,
 * entry counts, and the location-dependent 1-hour/6-hour aggregation seam.
 */

/**
 * Instantaneous observation/forecast values, published under
 * `timeseries[].data.instant.details`.
 *
 * Every field is `number | null | undefined`, not just `number | undefined`:
 * met.no's own missing-data encoding is a JSON `null`, and a guard that only
 * excludes `undefined` admits it, after which it coerces to `0` in
 * arithmetic (G56). The `| null` here is load-bearing, not defensive —
 * declaring it is what forces every downstream reader to guard correctly.
 */
export interface MetnoInstantDetails {
  air_temperature?: number | null;
  wind_speed?: number | null;
  wind_from_direction?: number | null;
  relative_humidity?: number | null;
  air_pressure_at_sea_level?: number | null;
  cloud_area_fraction?: number | null;
}

/**
 * `next_1_hours.details` — **precipitation-only**. Confirmed live (D3):
 * this block carries no temperature field at all. A daily aggregator that
 * expects `air_temperature_max`/`_min` here will silently read `undefined`
 * from every hourly-segment entry; the min/max for that part of the series
 * comes from `instant.air_temperature` instead. See `MetnoSixHourDetails`
 * for the block that does carry temperature.
 */
export interface MetnoOneHourDetails {
  precipitation_amount?: number | null;
  probability_of_precipitation?: number | null;
  probability_of_thunder?: number | null;
}

/**
 * `next_6_hours.details` (and, per met.no's schema, `next_12_hours.details`)
 * — the only aggregation windows that carry temperature extrema. Kept as a
 * separate interface from `MetnoOneHourDetails` rather than one
 * union-of-everything, so the two-source-for-one-column problem (D3: a
 * rendered daily min/max is fed by `instant` in the hourly segment and by
 * this block beyond the 1h/6h seam) is visible on the type itself instead of
 * hidden behind optional chaining into a single shape.
 */
export interface MetnoSixHourDetails {
  air_temperature_max?: number | null;
  air_temperature_min?: number | null;
  precipitation_amount?: number | null;
  probability_of_precipitation?: number | null;
}

/** `summary`/`details` pairing shared by every `next_*` aggregation block. */
export interface MetnoPeriod<TDetails> {
  summary?: {
    /** met.no's own icon vocabulary (`clearsky_day`, `partlycloudy_night`, …) — not WMO codes. */
    symbol_code?: string;
  };
  details?: TDetails;
}

/** One `timeseries[].data` block: one instantaneous reading plus whichever aggregation windows this entry carries. */
export interface MetnoTimeseriesData {
  instant?: {
    details?: MetnoInstantDetails;
  };
  /** Precipitation-only — see `MetnoOneHourDetails`. */
  next_1_hours?: MetnoPeriod<MetnoOneHourDetails>;
  /** Carries temperature extrema — see `MetnoSixHourDetails`. */
  next_6_hours?: MetnoPeriod<MetnoSixHourDetails>;
  /** Same shape as `next_6_hours`, published for a subset of entries. */
  next_12_hours?: MetnoPeriod<MetnoSixHourDetails>;
}

/**
 * One entry of `properties.timeseries`. D3: the final entry of the series
 * carries no aggregation window at all (`data.next_1_hours`,
 * `next_6_hours`, and `next_12_hours` all absent) — a consumer that assumes
 * every entry has a `next_*` block produces a degenerate final day.
 */
export interface MetnoTimeseriesEntry {
  /** ISO 8601 UTC timestamp for this entry. */
  time?: string;
  data?: MetnoTimeseriesData;
}

/** `properties.meta` — met.no publishes the parse timestamp and the series' units table here. */
export interface MetnoMeta {
  updated_at?: string;
  units?: Record<string, string>;
}

export interface MetnoProperties {
  meta?: MetnoMeta;
  timeseries?: MetnoTimeseriesEntry[];
}

/**
 * `geometry.coordinates` — **`[longitude, latitude, altitude?]`**, GeoJSON
 * order. This is the reverse of every other location tuple in this project
 * (which take latitude first); read positionally, not by convention.
 */
export interface MetnoGeometry {
  type?: string;
  coordinates?: [number, number, number?];
}

/** Top-level response of `GET /weatherapi/locationforecast/2.0/complete`. */
export interface MetnoForecastResponse {
  type?: string;
  geometry?: MetnoGeometry;
  properties?: MetnoProperties;
}
