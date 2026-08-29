/**
 * Handler for get_river_conditions tool
 */

import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveCountryCode, resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { NominatimService } from '../services/nominatim.js';
import { validateDetail, validatePositiveInteger } from '../utils/validation.js';
import { formatInTimezone, guessTimezoneFromCoords } from '../utils/timezone.js';
import { calculateDistance } from '../utils/distance.js';
import { displayValue } from '../utils/displayBanding.js';
import { isInUS } from '../utils/geography.js';
import { resolveUnitPreferences, UnitArgs } from '../utils/unitPreferences.js';
import { cubicMetersPerSecondToCubicFeetPerSecond } from '../utils/units.js';
import { UnitPreferences } from '../config/units.js';
import {
  buildProbeGrid,
  pickChannelCell,
  findTodayIndex,
  pastWindowValues,
  recentWindowValues,
  classifyDischargeTrend,
  formatDischargeTrend,
  classifyAgainstRecentMean,
  describeMinorDrainage,
  formatSnapNote,
  PROBE_GRID_CENTER_INDEX
} from '../utils/riverDischarge.js';
import { RateLimitError } from '../errors/ApiError.js';
import type { NWPSGauge, GaugeStatus, NWPSStageFlowResponse, StageFlowDataPoint, FloodCategories } from '../types/noaa.js';
import type { OpenMeteoFloodResponse } from '../types/openmeteo.js';
import type { DetailLevel } from '../utils/validation.js';

/**
 * Countries NWPS actually gauges. Measured live 2026-08-28 against
 * api.water.noaa.gov/nwps/v1/gauges (with a known-non-zero control in the same
 * batch): Puerto Rico 116 gauges, US Virgin Islands 0, Guam 0.
 *
 * This set alone cannot separate a territory from the mainland, and `pr` is
 * currently unreachable. The live resolver — Nominatim `reverseCountry` at
 * `zoom: 3`, and the forward path's `country_code` on a saved or geocoded
 * location — emits `us` for **every** US territory, because OpenStreetMap's
 * `country_code` is the admin-level-2 relation (measured 2026-08-29 at Guam,
 * St Croix, San Juan and Pago Pago: `us` at both zoom 3 and zoom 5; the
 * territory is visible only as `ISO3166-2-lvl4` at zoom ≥ 5). So `pr` never
 * matches in production and is kept only against OSM ever emitting it at
 * country zoom — Puerto Rico is covered today because it resolves to `us`.
 *
 * What actually separates Guam, the USVI, American Samoa and the Northern
 * Marianas from the mainland and Puerto Rico is the `isInUS` box check below
 * (design D1, issue #86). Coverage requires **both** signals.
 */
const NWPS_COVERED_COUNTRIES = new Set(['us', 'pr']);

/**
 * NWPS emits large negative sentinels (e.g. -999, -999999) for missing stage/flow
 * values. Any real river stage or flow is well above this threshold, so treat values
 * at or below it as "no data".
 */
const NWPS_SENTINEL_THRESHOLD = -900;

/**
 * True only for a real, present numeric reading (not null, not a missing-data sentinel).
 */
export function isRealValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > NWPS_SENTINEL_THRESHOLD;
}

/**
 * True when a gauge's validTime is a real, plausible timestamp. NWPS uses a year-0001
 * placeholder (renders as "Dec 31, 1") for stale/absent forecasts, so reject anything
 * that fails to parse or predates 2000.
 */
function hasPlausibleValidTime(validTime: string | undefined): boolean {
  if (!validTime) return false;
  const parsed = Date.parse(validTime);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).getUTCFullYear() >= 2000;
}

/**
 * A status block (observed or forecast) is worth displaying only if it carries at
 * least one real value AND a plausible timestamp. Otherwise NWPS is returning a
 * placeholder (-999 values, year-0001 time, "fcst_not_current"/"obs_not_current"
 * category) that should be suppressed rather than rendered raw.
 */
export function isUsableForecast(status: GaugeStatus): boolean {
  return (isRealValue(status.primary) || isRealValue(status.secondary)) && hasPlausibleValidTime(status.validTime);
}

/** Below this stage change (ft) over the trend window, the river reads "steady". */
const TREND_STEADY_THRESHOLD_FT = 0.05;
/** Preferred lookback window for the observed trend, in hours. */
const TREND_WINDOW_HOURS = 6;
/** Stageflow fetches per batch — keeps request bursts small; NWPS rate-limits. */
const TREND_FETCH_BATCH = 5;
/**
 * Max forecast-series points rendered at detail="full". Live NWPS forecast series run
 * 20-72 points at ~6h intervals (docs/output-completeness-plan.md D4 probe); 80 is a
 * defensive ceiling that should never bind in practice.
 */
const FORECAST_SERIES_CAP = 80;

/**
 * The flood-category levels, in ascending severity, paired with their rendered
 * labels. Ordering is the render order for `### Flood Stages`; `deriveFloodCategory`
 * walks the same set in the opposite direction.
 */
const FLOOD_LEVEL_LABELS: ReadonlyArray<readonly [keyof FloodCategories, string]> = [
  ['action', 'Action Stage'],
  ['minor', 'Minor Flood'],
  ['moderate', 'Moderate Flood'],
  ['major', 'Major Flood']
];

/**
 * One settled result from the per-gauge batch. The two calls are tagged and carry
 * their own lid rather than being matched by array position, so one rejection can
 * never be mistaken for the other's result.
 */
type GaugeFetchOutcome =
  | { kind: 'stageflow'; lid: string; stageflow: NWPSStageFlowResponse }
  | { kind: 'detail'; lid: string; detail: NWPSGauge };

export interface StageTrend {
  direction: 'rising' | 'falling' | 'steady';
  delta: number; // ft, latest minus baseline
  windowHours: number; // actual window used (may differ from TREND_WINDOW_HOURS)
}

/**
 * Derive a rise/fall trend from an observed stage series: latest real reading
 * vs. the earliest real reading inside the lookback window (or the nearest
 * predecessor when the series is sparse, labeled with the actual window).
 * Sentinel values (-999) and implausible timestamps are excluded per-point.
 * Returns undefined when fewer than two real points exist.
 */
export function computeStageTrend(
  points: StageFlowDataPoint[] | undefined,
  windowHours: number = TREND_WINDOW_HOURS
): StageTrend | undefined {
  if (!points || points.length === 0) {
    return undefined;
  }

  const usable = points
    .filter(p => isRealValue(p.primary) && hasPlausibleValidTime(p.validTime))
    .map(p => ({ time: Date.parse(p.validTime), stage: p.primary as number }))
    .sort((a, b) => a.time - b.time);

  if (usable.length < 2) {
    return undefined;
  }

  const latest = usable[usable.length - 1];
  const cutoff = latest.time - windowHours * 3600_000;
  const inWindow = usable.filter(p => p.time >= cutoff && p.time < latest.time);
  const baseline = inWindow.length > 0 ? inWindow[0] : usable[usable.length - 2];

  if (baseline.time >= latest.time) {
    return undefined;
  }

  const delta = latest.stage - baseline.stage;
  const actualHours = Math.max(1, Math.round((latest.time - baseline.time) / 3600_000));
  const direction: StageTrend['direction'] =
    Math.abs(delta) < TREND_STEADY_THRESHOLD_FT ? 'steady' : delta > 0 ? 'rising' : 'falling';

  return { direction, delta, windowHours: actualHours };
}

/**
 * Render a trend as an inline clause, e.g. "↘ falling (-0.4 ft / 6h)".
 * Steady trends omit the near-zero magnitude.
 */
export function formatStageTrend(trend: StageTrend): string {
  if (trend.direction === 'steady') {
    return `→ steady (last ${trend.windowHours}h)`;
  }
  const arrow = trend.direction === 'rising' ? '↗' : '↘';
  const signed = `${trend.delta >= 0 ? '+' : ''}${trend.delta.toFixed(1)}`;
  return `${arrow} ${trend.direction} (${signed} ft / ${trend.windowHours}h)`;
}

interface RiverConditionsArgs extends UnitArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  radius?: number; // search radius in km (default: 50) — NOAA path only
  detail?: 'summary' | 'standard' | 'full';
  source?: 'auto' | 'noaa' | 'openmeteo';
  forecast_days?: number; // 1-210, default 7 — Open-Meteo path only
}

/**
 * Route a river request to gauge observations or to the global discharge model.
 *
 * `auto` sends US coordinates to NOAA's NWPS gauge network (unchanged) and
 * everywhere else to the Open-Meteo Flood API. An explicit `source` forces the
 * branch. There is deliberately no cross-fallback: an observed river stage in
 * feet against official flood categories and a modeled discharge in m³/s
 * against its own history are different claims, and silently swapping one for
 * the other would misrepresent the data (design D1).
 */
export async function handleGetRiverConditions(
  args: unknown,
  noaaService: NOAAService,
  locationStore: LocationStore,
  geocodingService: GeocodingService,
  openMeteoService?: OpenMeteoService,
  nominatimService?: NominatimService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Resolve location from coordinates, a saved location name, or a geocoded city name
  const resolved = await resolveLocationAsync(args as RiverConditionsArgs, locationStore, geocodingService);
  const { latitude, longitude } = resolved;

  // Output verbosity: 'full' lifts the gauge/crest display caps to 25 (not unbounded).
  const detail = validateDetail((args as RiverConditionsArgs)?.detail);

  const requestedSource = (args as RiverConditionsArgs)?.source || 'auto';
  const useNOAA = requestedSource === 'auto'
    ? isInUS(latitude, longitude)
    : requestedSource === 'noaa';

  const output = useNOAA
    ? await formatNOAARiverConditions(noaaService, latitude, longitude, args, detail, resolved.country_code, nominatimService)
    : await formatOpenMeteoRiverConditions(openMeteoService, latitude, longitude, args, detail);

  return prependLocationLine({
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  }, resolved);
}

/**
 * The US path: NWPS gauge observations, flood categories, and crest history.
 * Byte-identical to the pre-global behavior — `radius` and the Search Radius
 * line belong to this path only.
 */
async function formatNOAARiverConditions(
  noaaService: NOAAService,
  latitude: number,
  longitude: number,
  args: unknown,
  detail: DetailLevel,
  resolvedCountryCode?: string,
  nominatimService?: NominatimService
): Promise<string> {
  // Validate radius parameter
  let radius = (args as RiverConditionsArgs)?.radius ?? 50; // default 50 km
  if (typeof radius !== 'number' || isNaN(radius) || !isFinite(radius)) {
    radius = 50;
  }
  // Clamp to valid range (1-500 km)
  radius = Math.max(1, Math.min(radius, 500));

  // Get timezone for proper time formatting
  const timezone = guessTimezoneFromCoords(latitude, longitude);

  let output = `# River Conditions Report\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `**Search Radius:** ${radius} km (${(radius * 0.621371).toFixed(1)} miles)\n\n`;

  try {
    // Calculate bounding box for the search radius
    // 1 degree of latitude ≈ 111 km, 1 degree of longitude varies by latitude
    const latDelta = radius / 111; // Convert radius from km to degrees latitude
    const lonDelta = radius / (111 * Math.cos(latitude * Math.PI / 180)); // Adjust for latitude

    const west = Math.max(-180, longitude - lonDelta);
    const east = Math.min(180, longitude + lonDelta);
    const south = Math.max(-90, latitude - latDelta);
    const north = Math.min(90, latitude + latDelta);

    // Get gauges within bounding box (much more efficient than downloading all gauges)
    const gaugesInBox = await noaaService.getNWPSGaugesInBoundingBox(west, south, east, north);

    // Calculate precise distance to each gauge and filter by radius
    // (bounding box is a square, but we want a circle)
    const gaugesWithDistance = gaugesInBox
      .map(gauge => ({
        gauge,
        distance: calculateDistance(latitude, longitude, gauge.latitude, gauge.longitude)
      }))
      .filter(item => item.distance <= radius)
      .sort((a, b) => a.distance - b.distance); // Sort by nearest first

    if (gaugesWithDistance.length === 0) {
      // Coverage needs both signals: the country set cannot tell a US territory from the
      // mainland (see NWPS_COVERED_COUNTRIES above), and the boxes cannot tell Toronto
      // from Detroit. Outside the boxes the answer is already decided whatever the country
      // says, so the lookup is skipped there entirely — Nominatim is rate-limited to
      // 1 req/sec server-wide (design D2, issue #86). Inside the boxes it stays lazy and
      // local to this branch: the answer only ever chooses between two renderings of an
      // empty result. `lookupFailed` is deliberately discarded at the one place the call
      // is still made — the fallback is `isInUS`, exactly what this code did before, so a
      // note would describe a non-event (design D7).
      const inUsBoxes = isInUS(latitude, longitude);
      const countryCode = inUsBoxes
        ? (await resolveCountryCode(resolvedCountryCode, latitude, longitude, nominatimService)).countryCode
        : null;
      const outsideCoverage = !inUsBoxes
        || (countryCode !== null && !NWPS_COVERED_COUNTRIES.has(countryCode));

      if (outsideCoverage) {
        // A successful-but-empty NWPS response outside its coverage. "No gauges" here means
        // "this authority does not gauge rivers at this location", which is emphatically not
        // an all-clear — so no ℹ️, and none of the in-coverage advice, which cannot succeed
        // at any radius. The forced source (or the CONUS-box auto route) is honoured as
        // asked: disclose rather than error or silently swap authorities (design D1/D5).
        output += `**NOAA's National Water Prediction Service gauges rivers in the United `;
        output += `States and Puerto Rico only, and this location appears to be outside that `;
        output += `coverage.**\n\n`;
        output += `No gauges were returned — but that is an absence of coverage, not an `;
        output += `all-clear. Rivers here may be in flood; NWPS simply does not gauge them.\n\n`;
        output += `Use \`source: "openmeteo"\` for Open-Meteo Flood (GloFAS) `;
        output += `modeled river discharge, which is global.\n`;
      } else {
        // Inside coverage, widening a 50 km radius genuinely can find a gauge, so the
        // advice is actionable here and this output stays byte-identical.
        output += `ℹ️ **No river gauges found within ${radius} km**\n\n`;
        output += `Try expanding the search radius or choosing a location closer to rivers or streams.\n\n`;
        output += `**Tip:** River gauges are typically located along major rivers and waterways.\n`;
      }
    } else {
      output += `📊 **Found ${gaugesWithDistance.length} river gauge${gaugesWithDistance.length > 1 ? 's' : ''}**\n\n`;

      // Show details for nearest gauges. detail="full" lifts the cap to 25 (still
      // capped, not unbounded — see D2 in docs/output-completeness-plan.md); the
      // remainder note stays accurate at every level, including full.
      const maxGaugesToShow = detail === 'full' ? 25 : 5;
      const crestCap = detail === 'full' ? 25 : 3;
      const gaugesToShow = gaugesWithDistance.slice(0, maxGaugesToShow);

      // Fetch each shown gauge's stage/flow series for the observed trend (30-min
      // cache in the service) and its per-gauge detail, which is the only endpoint
      // carrying flood-stage thresholds and crests — the bounding-box list response
      // has no `flood` object at all. Both calls go in the same batch so they
      // overlap rather than doubling wall-clock, and they share one rate-limit
      // state: a 429 from either stops asking for both.
      //
      // Nearest-first in small batches; NWPS rate-limits (429s observed live), so
      // stop after the first rate-limit rejection. Thresholds are garnish (D6) — a
      // gauge whose detail call failed renders exactly as it does today: no
      // threshold section, no crest section, and NOAA's own **Flood Category:**
      // line, which comes from the bbox response, intact. No retries: these
      // methods do not route through `makeRequest` and must not gain any.
      const stageflowByLid = new Map<string, NWPSStageFlowResponse>();
      const floodByLid = new Map<string, NWPSGauge['flood']>();
      for (let i = 0; i < gaugesToShow.length; i += TREND_FETCH_BATCH) {
        const batch = gaugesToShow.slice(i, i + TREND_FETCH_BATCH);
        // Each call is settled independently and carries its own lid, so a rejected
        // detail call can never suppress the same gauge's trend, or vice versa. The
        // async wrappers matter: they turn a synchronous throw (a service missing
        // the method) into a rejection this batch swallows, rather than one that
        // escapes into the handler's catch and replaces the whole gauge list with
        // an error block.
        const results = await Promise.allSettled(
          batch.flatMap(({ gauge }) => [
            (async (): Promise<GaugeFetchOutcome> => ({
              kind: 'stageflow',
              lid: gauge.lid,
              stageflow: await noaaService.getNWPSStageFlow(gauge.lid)
            }))(),
            (async (): Promise<GaugeFetchOutcome> => ({
              kind: 'detail',
              lid: gauge.lid,
              detail: await noaaService.getNWPSGauge(gauge.lid)
            }))()
          ])
        );
        let rateLimited = false;
        for (const result of results) {
          if (result.status === 'fulfilled') {
            const outcome = result.value;
            if (outcome.kind === 'stageflow') {
              stageflowByLid.set(outcome.lid, outcome.stageflow);
            } else {
              floodByLid.set(outcome.lid, outcome.detail.flood);
            }
          } else if (result.reason instanceof RateLimitError) {
            rateLimited = true;
          }
        }
        if (rateLimited) {
          break;
        }
      }

      for (const { gauge, distance } of gaugesToShow) {
        const trend = computeStageTrend(stageflowByLid.get(gauge.lid)?.observed?.data);
        // Multi-point forecast series is a detail="full"-only addition (D4); at lower
        // detail levels the existing single-point Forecast block is byte-identical to
        // pre-T7 behavior.
        const forecastSeries = detail === 'full' ? stageflowByLid.get(gauge.lid)?.forecast?.data : undefined;
        // G7 — spread the BBOX gauge and take ONLY `flood` from the detail response.
        // Never `{ ...detail }` and never mutate the gauge in the bbox array: that
        // array is cached for 24h and the detail response is too, while both carry
        // `status.observed`/`status.forecast`, which are per-refresh state on a
        // 30-minute cache. Importing the detail response's status would freeze a
        // 30-minute observation into a 24-hour entry.
        const enriched: NWPSGauge = { ...gauge, flood: floodByLid.get(gauge.lid) };
        output += formatGaugeDetails(enriched, distance, timezone, crestCap, trend, forecastSeries);
      }

      if (gaugesWithDistance.length > maxGaugesToShow) {
        const remaining = gaugesWithDistance.length - maxGaugesToShow;
        const plural = remaining > 1 ? 's' : '';
        if (detail === 'full') {
          output += `\n*Note: ${remaining} additional gauge${plural} found within radius (showing nearest ${maxGaugesToShow})*\n`;
        } else {
          output += `\n*Note: ${remaining} additional gauge${plural} found within radius (showing nearest ${maxGaugesToShow} only — use detail="full" for more)*\n`;
        }
      }
    }
  } catch (error) {
    output += `❌ **Error retrieving river gauge data**\n\n`;
    output += `Unable to fetch river conditions. This may be due to:\n`;
    output += `- Temporary service unavailability\n`;
    output += `- Network connectivity issues\n`;
    output += `- Location outside NOAA coverage area (US only)\n\n`;
    output += `Error details: ${error instanceof Error ? error.message : String(error)}\n`;
  }

  output += `\n---\n`;
  output += `*Data source: NOAA National Water Prediction Service (NWPS)*\n`;
  output += `*River conditions are updated hourly. Always consult official sources for critical decisions.*\n`;

  return output;
}

/** Header line naming the model behind the global path. */
const OPENMETEO_SOURCE_LINE =
  '**Source:** Open-Meteo Flood API (GloFAS v4, ~5 km model grid)';

/**
 * The caveat that has to lead this path: GloFAS publishes no flood-stage
 * thresholds, so there is no "minor/moderate/major" to report and nothing here
 * should be read as a gauge reading.
 */
const OPENMETEO_MODEL_CAVEAT =
  '⚠️ Model-estimated river discharge — not gauge observations. No official ' +
  'flood-stage thresholds exist for this data; levels are shown relative to ' +
  'recent history and the forecast ensemble.';

/**
 * Render a discharge value at a sensible precision for its magnitude — large
 * rivers run to five figures, minor drainage to two decimal places.
 */
function formatDischargeValue(cms: number): string {
  if (cms >= 100) {
    return Math.round(cms).toLocaleString('en-US');
  }
  if (cms >= 1) {
    return cms.toFixed(1);
  }
  return cms.toFixed(2);
}

/**
 * Discharge in the API's native m³/s, with ft³/s alongside under imperial
 * preferences. Discharge takes no per-call unit parameter (design D5); it
 * follows WEATHER_UNITS, using the same imperial/metric resolution as distance.
 */
function formatDischarge(cms: number, prefs: UnitPreferences): string {
  const metric = `${formatDischargeValue(cms)} m³/s`;
  if (prefs.distance !== 'mi') {
    return metric;
  }
  const cfs = cubicMetersPerSecondToCubicFeetPerSecond(cms);
  return `${metric} (${formatDischargeValue(cfs)} ft³/s)`;
}

/**
 * Locate the most recent real reading at or before today, so a null value for
 * today falls back to the latest actual observation rather than reading as zero.
 */
function findLatestRealValue(
  series: Array<number | null> | undefined,
  todayIndex: number
): { value: number; index: number } | undefined {
  if (!series) {
    return undefined;
  }
  for (let i = Math.min(todayIndex, series.length - 1); i >= 0; i--) {
    const value = series[i];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { value, index: i };
    }
  }
  return undefined;
}

/**
 * The global path: GloFAS modeled discharge, snapped to the river channel and
 * presented against its own recent history (design D3/D4/D6).
 */
async function formatOpenMeteoRiverConditions(
  openMeteoService: OpenMeteoService | undefined,
  latitude: number,
  longitude: number,
  args: unknown,
  detail: DetailLevel
): Promise<string> {
  if (!openMeteoService) {
    throw new Error('Open-Meteo service is required for river conditions outside the US');
  }

  // Validation errors propagate — this path has no try/catch swallowing them.
  const rawForecastDays = (args as RiverConditionsArgs)?.forecast_days;
  const forecastDays = rawForecastDays === undefined
    ? 7
    : validatePositiveInteger(rawForecastDays, 'forecast_days', 1, 210);

  const prefs = resolveUnitPreferences(args as UnitArgs);

  // One multi-point request covers the whole 3x3 neighborhood (design D3).
  const grid = buildProbeGrid(latitude, longitude);
  const cells = await openMeteoService.getRiverDischarge(
    grid.map(p => p.latitude),
    grid.map(p => p.longitude),
    forecastDays
  );

  let output = `# River Conditions Report\n\n`;
  output += `**Location:** ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n`;
  output += `${OPENMETEO_SOURCE_LINE}\n\n`;
  output += `${OPENMETEO_MODEL_CAVEAT}\n\n`;

  const pick = pickChannelCell(cells, PROBE_GRID_CENTER_INDEX);

  if (!pick) {
    // Ocean, desert, or anywhere else GloFAS models no channel. The API returns
    // HTTP 200 with null-filled arrays here, so this is a result, not an error.
    output += `ℹ️ **No river data for this location**\n\n`;
    output += `The flood model has no river channel within ~8 km of this point. `;
    output += `This is expected over open ocean, arid regions, and small islands.\n\n`;
    output += `**Tip:** Try a point closer to a named river, or use `;
    output += `get_marine_conditions for coastal and open-water conditions.\n`;
    return output + formatOpenMeteoFooter();
  }

  const cell = cells[pick.index];
  const daily = cell.daily;
  const series = daily?.river_discharge;
  const todayIndex = findTodayIndex(daily?.time, cell.utc_offset_seconds);

  const snapNote = formatSnapNote(pick.snapDistanceKm, pick.snapBearing);
  if (snapNote) {
    output += `${snapNote}\n\n`;
  }

  const minorDrainage = describeMinorDrainage(pick.meanDischarge);
  if (minorDrainage) {
    output += `⚠️ **${minorDrainage}**\n\n`;
  }

  output += `## Current Discharge\n\n`;

  const latest = findLatestRealValue(series, todayIndex);
  if (!latest) {
    output += `*No current discharge value available for this cell.*\n\n`;
  } else {
    const trend = classifyDischargeTrend(recentWindowValues(series, todayIndex, 7));
    const trendClause = trend ? `  ${formatDischargeTrend(trend)}` : '';
    output += `**Discharge:** ${formatDischarge(latest.value, prefs)}${trendClause}\n`;

    // A null value for today falls back to the latest real day — say which.
    const latestDate = daily?.time?.[latest.index];
    if (latest.index !== todayIndex && latestDate) {
      output += `**As of:** ${latestDate} (most recent modeled day)\n`;
    }

    const mean31 = meanOfSeries(pastWindowValues(series, todayIndex));
    const context = classifyAgainstRecentMean(latest.value, mean31);
    if (context && mean31 !== undefined) {
      // Em-dash rather than parentheses: the discharge value already carries its
      // own imperial parenthetical, and nesting them reads badly.
      output += `**vs. recent history:** ${context.label} `;
      output += `— 31-day mean ${formatDischarge(mean31, prefs)}\n`;
    }
    output += `\n`;
  }

  output += formatEnsembleForecast(cell, todayIndex, detail, prefs);

  return output + formatOpenMeteoFooter();
}

/** Mean of the real values in a series, or undefined when there are none. */
function meanOfSeries(values: Array<number | null>): number | undefined {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      sum += value;
      count++;
    }
  }
  return count === 0 ? undefined : sum / count;
}

/** Forecast rows rendered below detail="full". */
const FORECAST_SUMMARY_DAYS = 7;

/** True for a real, present numeric reading in a nullable model series. */
function isRealNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Discharge in whichever unit the resolved preferences call for. */
function dischargeInPrefUnit(cms: number, prefs: UnitPreferences): number {
  return prefs.distance === 'mi' ? cubicMetersPerSecondToCubicFeetPerSecond(cms) : cms;
}

/** Label for the unit `dischargeInPrefUnit` returns. */
function dischargeUnitLabel(prefs: UnitPreferences): string {
  return prefs.distance === 'mi' ? 'ft³/s' : 'm³/s';
}

/** Render one value in the preferred unit, without repeating the unit label. */
function forecastValue(cms: number, prefs: UnitPreferences): string {
  return formatDischargeValue(dischargeInPrefUnit(cms, prefs));
}

/** "2026-08-13" -> "Aug 13", without dragging the local timezone into it. */
function formatDayLabel(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
    return iso;
  }
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The GloFAS ensemble forecast (design D4). There are no flood categories to
 * report, so the forecast is expressed as a daily median inside its p25-p75
 * band. Ensemble members stay tightly clustered for the first few days and only
 * diverge from about day 4 — the band is shown from day 1 regardless, with the
 * section wording carrying the caveat rather than hiding the early rows.
 *
 * Rows use a single unit (the resolved preference, named once in the header):
 * repeating a dual-unit parenthetical on every median, band, and envelope value
 * would be unreadable. The headline Current Discharge line keeps both.
 */
function formatEnsembleForecast(
  cell: OpenMeteoFloodResponse,
  todayIndex: number,
  detail: DetailLevel,
  prefs: UnitPreferences
): string {
  const daily = cell.daily;
  const time = daily?.time;
  const median = daily?.river_discharge_median ?? daily?.river_discharge;
  if (!time || !median) {
    return '';
  }

  const p25 = daily?.river_discharge_p25;
  const p75 = daily?.river_discharge_p75;
  const low = daily?.river_discharge_min;
  const high = daily?.river_discharge_max;

  // `forecast_days=N` returns N days starting with the location's local today
  // (live-verified: forecast_days=1 returns today and nothing else), so day 1
  // of the ensemble is today. Today therefore appears both here and under
  // Current Discharge — and legitimately differs, since the current level is
  // the deterministic run while this row is the ensemble median.
  const start = todayIndex;

  // Trim trailing days the model returned as null rather than rendering them as
  // 0 m³/s (same null-horizon handling as the marine and air-quality paths).
  let end = Math.min(time.length, median.length);
  while (end > start && !isRealNumber(median[end - 1])) {
    end--;
  }
  const trimmedDays = Math.min(time.length, median.length) - end;

  const rows: string[] = [];
  for (let i = start; i < end; i++) {
    const value = median[i];
    if (!isRealNumber(value)) {
      continue; // interior gap — skip the day rather than invent a zero
    }

    let row = `- **${formatDayLabel(time[i])}:** ${forecastValue(value, prefs)}`;

    if (isRealNumber(p25?.[i]) && isRealNumber(p75?.[i])) {
      row += ` · p25–p75 ${forecastValue(p25[i] as number, prefs)}–${forecastValue(p75[i] as number, prefs)}`;
    }

    // The full min/max envelope is detail="full" only — it is much wider than
    // the interquartile band and would swamp the summary view.
    if (detail === 'full' && isRealNumber(low?.[i]) && isRealNumber(high?.[i])) {
      row += ` · range ${forecastValue(low[i] as number, prefs)}–${forecastValue(high[i] as number, prefs)}`;
    }

    rows.push(row);
  }

  if (rows.length === 0) {
    // Reachable when the whole horizon is null, or when local "today" has
    // rolled past the model run's issue date and consumed a short horizon.
    // Say so rather than dropping the section without explanation.
    let empty = `## Ensemble Forecast\n\n`;
    empty += trimmedDays > 0
      ? `*The model returned no values for the ${trimmedDays} requested forecast day${trimmedDays > 1 ? 's' : ''}.*\n`
      : `*No modeled forecast days were returned for this location.*\n`;
    return empty;
  }

  const cap = detail === 'full' ? rows.length : FORECAST_SUMMARY_DAYS;
  const shown = rows.slice(0, cap);

  let output = `## Ensemble Forecast\n\n`;
  output += `Daily median with the p25–p75 ensemble band, in ${dischargeUnitLabel(prefs)}, starting today. `;
  output += `Members stay tightly clustered for the first few days and diverge from about `;
  output += `day 4, so a near-zero band early on reflects that clustering, not certainty.\n\n`;
  output += `${shown.join('\n')}\n`;

  if (rows.length > shown.length) {
    const remaining = rows.length - shown.length;
    output += `\n*Note: ${remaining} more forecast day${remaining > 1 ? 's' : ''} available — use detail="full" for the full range and the min/max envelope*\n`;
  }

  if (trimmedDays > 0) {
    output += `\n*Note: ${trimmedDays} further day${trimmedDays > 1 ? 's' : ''} returned no modeled values and ${trimmedDays > 1 ? 'were' : 'was'} omitted*\n`;
  }

  return output;
}

/**
 * Footer for the global path. The CC-BY credit replaces the NWPS credit here
 * and only here — the US path keeps its own attribution.
 */
function formatOpenMeteoFooter(): string {
  let output = `\n---\n`;
  output += `*River discharge data by Open-Meteo.com (CC-BY 4.0)*\n`;
  output += `*Always consult official sources for flood-critical decisions.*\n`;
  return output;
}

/**
 * Format detailed information for a single river gauge
 */
function formatGaugeDetails(
  gauge: NWPSGauge,
  distance: number,
  timezone: string,
  crestCap: number,
  trend?: StageTrend,
  forecastSeries?: StageFlowDataPoint[]
): string {
  let output = `## ${gauge.name}\n\n`;
  output += `**Distance:** ${distance.toFixed(1)} km (${(distance * 0.621371).toFixed(1)} mi)\n`;
  output += `**Location:** ${gauge.state?.abbreviation ?? 'Unknown'}${gauge.county ? `, ${gauge.county} County` : ''}\n`;
  output += `**Coordinates:** ${gauge.latitude.toFixed(4)}, ${gauge.longitude.toFixed(4)}\n`;
  output += `**Gauge ID:** ${gauge.lid}${gauge.usgsId ? ` (USGS: ${gauge.usgsId})` : ''}\n`;
  // inService is only present on the per-gauge detail endpoint; gauges returned
  // by the bounding-box query are active by definition, so default to Active.
  output += `**Status:** ${gauge.inService === false ? '❌ Out of Service' : '✅ Active'}\n\n`;

  // Current conditions. An observed status can be a placeholder too (year-0001
  // validTime, no real values, "obs_not_current" category) — treat it exactly
  // like an absent observation instead of rendering the raw sentinel row.
  if (gauge.status.observed && isUsableForecast(gauge.status.observed)) {
    const obs = gauge.status.observed;
    output += `### Current Conditions\n`;
    output += `**Observed:** ${formatInTimezone(obs.validTime, timezone)}\n`;

    if (isRealValue(obs.primary)) {
      output += `**River Stage:** ${obs.primary.toFixed(2)} ft${trend ? `  ${formatStageTrend(trend)}` : ''}\n`;
    } else if (trend) {
      output += `**Trend:** ${formatStageTrend(trend)}\n`;
    }

    if (isRealValue(obs.secondary)) {
      output += `**Flow Rate:** ${obs.secondary.toFixed(2)} kcfs (${(obs.secondary * 1000).toFixed(0)} cfs)\n`;
    }

    // Flood category with emoji
    const floodEmoji = getFloodEmoji(obs.floodCategory);
    const floodText = obs.floodCategory ? obs.floodCategory.replace(/_/g, ' ').toUpperCase() : 'NO FLOODING';
    output += `**Flood Category:** ${floodEmoji} ${floodText}\n\n`;
  } else {
    output += `### Current Conditions\n`;
    output += `*No current observations available*\n`;
    if (trend) {
      output += `**Trend:** ${formatStageTrend(trend)}\n`;
    }
    output += `\n`;
  }

  // Flood stages. The section is gated on having a per-gauge detail response at all
  // (`gauge.flood`), not on the thresholds being real: a gauge NOAA publishes nothing
  // for gets an explicit line (D5), while a gauge whose detail fetch failed or was
  // rate-limited has no `flood` and renders no section at all (D6). Those are
  // different statements and a reader on a rising river needs to tell them apart.
  if (gauge.flood) {
    const cat = gauge.flood.categories;
    const stageUnits = gauge.flood.stageUnits ?? 'ft';

    // One row per level NOAA actually publishes, in ascending severity. Thresholds
    // print unrounded — they are NOAA's published gauge metadata at NOAA's own
    // precision (the v1.25.6 contract rounds the *reading*, never the threshold).
    const publishedLevels: Array<{ label: string; stage: number }> = [];
    for (const [key, label] of FLOOD_LEVEL_LABELS) {
      const levelStage = cat?.[key]?.stage;
      if (isRealValue(levelStage)) {
        publishedLevels.push({ label, stage: levelStage });
      }
    }

    output += `### Flood Stages\n`;
    if (publishedLevels.length > 0) {
      for (const level of publishedLevels) {
        output += `**${level.label}:** ${level.stage.toFixed(1)} ${stageUnits}\n`;
      }
      output += `\n`;

      // Show stage relative to flood levels if we have both a current stage and a
      // real action stage to measure it against. A sentinel action stage yields no
      // line rather than `NaN%`.
      const actionStage = cat?.action?.stage;
      if (isRealValue(gauge.status.observed?.primary) && isRealValue(actionStage)) {
        const currentStage = gauge.status.observed.primary;
        const pctToAction = ((currentStage / actionStage) * 100).toFixed(0);
        output += `**Current stage is ${pctToAction}% of action stage**\n\n`;
      }
    } else {
      output += `*NOAA publishes no flood-stage thresholds for this gauge. That is an absence of published thresholds, not an absence of flood risk — the **Flood Category:** line above comes from NOAA's own status.*\n\n`;
    }
  }

  // Forecast (only when NWPS returns a real, current forecast — placeholder rows with
  // -999 values and a year-0001 validTime are suppressed rather than rendered raw).
  if (gauge.status.forecast && isUsableForecast(gauge.status.forecast)) {
    const forecast = gauge.status.forecast;
    output += `### Forecast\n`;
    output += `**Valid Time:** ${formatInTimezone(forecast.validTime, timezone)}\n`;

    if (isRealValue(forecast.primary)) {
      output += `**Forecasted Stage:** ${forecast.primary.toFixed(2)} ft\n`;
    }

    if (isRealValue(forecast.secondary)) {
      output += `**Forecasted Flow:** ${forecast.secondary.toFixed(2)} kcfs\n`;
    }

    const forecastFloodEmoji = getFloodEmoji(forecast.floodCategory);
    const forecastFloodText = forecast.floodCategory ? forecast.floodCategory.replace(/_/g, ' ').toUpperCase() : 'NO FLOODING';
    output += `**Forecasted Category:** ${forecastFloodEmoji} ${forecastFloodText}\n\n`;
  }

  // Multi-point NWPS forecast series (detail="full" only — see D4). Most gauges have
  // no forecast series at all (~4/5 in the live probe); when that's true, render
  // nothing — no header, no empty section — so the vast majority of gauges are
  // visually unchanged even at full detail.
  if (forecastSeries && forecastSeries.length > 0) {
    const usablePoints = forecastSeries.filter(
      p => isRealValue(p.primary) && hasPlausibleValidTime(p.validTime)
    );
    if (usablePoints.length > 0) {
      output += `### Forecast Series\n`;
      const shown = usablePoints.slice(0, FORECAST_SERIES_CAP);
      for (const point of shown) {
        const stage = point.primary as number;
        const category = gauge.flood?.categories ? deriveFloodCategory(stage, gauge.flood.categories) : null;
        const categoryClause = category ? ` ${getFloodEmoji(category)} ${category.toUpperCase()}` : '';
        output += `- **${formatInTimezone(point.validTime, timezone)}:** ${stage.toFixed(2)} ft${categoryClause}\n`;
      }
      if (usablePoints.length > FORECAST_SERIES_CAP) {
        output += `*…${usablePoints.length - FORECAST_SERIES_CAP} more forecast points*\n`;
      }
      output += `\n`;
    }
  }

  // Historic crests (if available and significant). A crest with no real stage, or
  // with an unparseable date, is skipped rather than rendered as a row with a
  // missing number — the cap counts rows actually printed. The flow clause is
  // guarded by `isRealValue`, not by truthiness: live crest flows include -9999,
  // which is truthy and would otherwise print as `(-9999 cfs)`.
  if (gauge.flood?.crests?.recent && gauge.flood.crests.recent.length > 0) {
    const stageUnits = gauge.flood.stageUnits ?? 'ft';
    const flowUnits = gauge.flood.flowUnits ?? 'cfs';
    const crestRows: string[] = [];
    for (const crest of gauge.flood.crests.recent) {
      if (crestRows.length >= crestCap) break;
      if (!isRealValue(crest.stage)) continue;
      if (!crest.occurredTime) continue;
      const crestDate = new Date(crest.occurredTime);
      if (Number.isNaN(crestDate.getTime())) continue;

      let row = `- **${crestDate.getFullYear()}:** ${crest.stage.toFixed(2)} ${stageUnits}`;
      // NWPS encodes an unrecorded crest flow as BOTH -9999 and 0 — 20 of PRTO3's 26
      // recent crests carry `flow: 0`, including the 1996 flood at 28.55 ft. A river
      // crest is a peak, so a zero flow is never a real measurement, only a missing
      // one. The pre-fix truthy check suppressed these by luck; `isRealValue` alone
      // would un-suppress them and print `(0 cfs)` on two thirds of the rows.
      if (isRealValue(crest.flow) && crest.flow !== 0) {
        row += ` (${crest.flow.toFixed(0)} ${flowUnits})`;
      }
      crestRows.push(row);
    }
    if (crestRows.length > 0) {
      output += `### Recent Historic Crests\n`;
      output += `${crestRows.join('\n')}\n\n`;
    }
  }

  output += `---\n\n`;
  return output;
}

/**
 * Derive a flood category label from a stage reading and the gauge's flood thresholds,
 * for per-point classification of a forecast series. Returns null when the stage is
 * below action stage (no flooding label needed inline).
 */
function deriveFloodCategory(stage: number, categories: FloodCategories): 'major' | 'moderate' | 'minor' | 'action' | null {
  // Band on the figure the series line prints (`toFixed(2)` at the one call site),
  // not the raw stage. The thresholds stay raw — they are NOAA's published gauge
  // metadata at NOAA's own precision, and rounding them would move the official
  // action stage.
  const shown = displayValue(stage, 2);

  // Skip any level NOAA does not publish and keep descending. The skip is
  // load-bearing: on an action+minor-only gauge a stage above minor must label
  // MINOR rather than falling through to null.
  const major = categories.major?.stage;
  if (isRealValue(major) && shown >= major) return 'major';
  const moderate = categories.moderate?.stage;
  if (isRealValue(moderate) && shown >= moderate) return 'moderate';
  const minor = categories.minor?.stage;
  if (isRealValue(minor) && shown >= minor) return 'minor';
  const action = categories.action?.stage;
  if (isRealValue(action) && shown >= action) return 'action';
  return null;
}

/**
 * Get emoji for flood category
 */
function getFloodEmoji(category: string | null | undefined): string {
  // NWPS uses underscore-delimited categories (e.g. "no_flooding", "not_defined")
  const normalized = category?.replace(/_/g, ' ');
  if (!normalized || normalized === 'no flooding' || normalized === 'not defined') return '✅';
  if (normalized === 'action') return '🟡';
  if (normalized === 'minor') return '🟠';
  if (normalized === 'moderate') return '🔴';
  if (normalized === 'major') return '🔴🔴';
  return '⚪';
}
