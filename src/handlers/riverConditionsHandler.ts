/**
 * Handler for get_river_conditions tool
 */

import { NOAAService } from '../services/noaa.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateDetail } from '../utils/validation.js';
import { formatInTimezone, guessTimezoneFromCoords } from '../utils/timezone.js';
import { calculateDistance } from '../utils/distance.js';
import { RateLimitError } from '../errors/ApiError.js';
import type { NWPSGauge, GaugeStatus, NWPSStageFlowResponse, StageFlowDataPoint, FloodCategories } from '../types/noaa.js';

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
 * A forecast is worth displaying only if it carries at least one real value AND a
 * plausible timestamp. Otherwise NWPS is returning a placeholder (-999 values, year-0001
 * time, "fcst_not_current" category) that should be suppressed rather than rendered raw.
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

interface RiverConditionsArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  radius?: number; // search radius in km (default: 50)
  detail?: 'summary' | 'standard' | 'full';
}

export async function handleGetRiverConditions(
  args: unknown,
  noaaService: NOAAService,
  locationStore: LocationStore,
  geocodingService: GeocodingService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Resolve location from coordinates, a saved location name, or a geocoded city name
  const resolved = await resolveLocationAsync(args as RiverConditionsArgs, locationStore, geocodingService);
  const { latitude, longitude } = resolved;

  // Output verbosity: 'full' lifts the gauge/crest display caps to 25 (not unbounded).
  const detail = validateDetail((args as RiverConditionsArgs)?.detail);

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
      output += `ℹ️ **No river gauges found within ${radius} km**\n\n`;
      output += `Try expanding the search radius or choosing a location closer to rivers or streams.\n\n`;
      output += `**Tip:** River gauges are typically located along major rivers and waterways.\n`;
    } else {
      output += `📊 **Found ${gaugesWithDistance.length} river gauge${gaugesWithDistance.length > 1 ? 's' : ''}**\n\n`;

      // Show details for nearest gauges. detail="full" lifts the cap to 25 (still
      // capped, not unbounded — see D2 in docs/output-completeness-plan.md); the
      // remainder note stays accurate at every level, including full.
      const maxGaugesToShow = detail === 'full' ? 25 : 5;
      const crestCap = detail === 'full' ? 25 : 3;
      const gaugesToShow = gaugesWithDistance.slice(0, maxGaugesToShow);

      // Fetch each shown gauge's stage/flow series for the observed trend
      // (30-min cache in the service). Nearest-first in small batches; NWPS
      // rate-limits (429s observed live), so stop asking after the first
      // rate-limit rejection — any gauge without a series just shows no trend.
      const stageflowByLid = new Map<string, NWPSStageFlowResponse>();
      for (let i = 0; i < gaugesToShow.length; i += TREND_FETCH_BATCH) {
        const batch = gaugesToShow.slice(i, i + TREND_FETCH_BATCH);
        const results = await Promise.allSettled(
          batch.map(async ({ gauge }) => noaaService.getNWPSStageFlow(gauge.lid))
        );
        let rateLimited = false;
        results.forEach((result, j) => {
          if (result.status === 'fulfilled') {
            stageflowByLid.set(batch[j].gauge.lid, result.value);
          } else if (result.reason instanceof RateLimitError) {
            rateLimited = true;
          }
        });
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
        output += formatGaugeDetails(gauge, distance, timezone, crestCap, trend, forecastSeries);
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

  // Current conditions
  if (gauge.status.observed) {
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

  // Flood stages
  if (gauge.flood?.categories) {
    const cat = gauge.flood.categories;
    output += `### Flood Stages\n`;
    output += `**Action Stage:** ${cat.action.toFixed(1)} ft\n`;
    output += `**Minor Flood:** ${cat.minor.toFixed(1)} ft\n`;
    output += `**Moderate Flood:** ${cat.moderate.toFixed(1)} ft\n`;
    output += `**Major Flood:** ${cat.major.toFixed(1)} ft\n\n`;

    // Show stage relative to flood levels if we have current stage
    if (isRealValue(gauge.status.observed?.primary)) {
      const currentStage = gauge.status.observed.primary;
      const pctToAction = ((currentStage / cat.action) * 100).toFixed(0);
      output += `**Current stage is ${pctToAction}% of action stage**\n\n`;
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

  // Historic crests (if available and significant)
  if (gauge.flood?.crests?.recent && gauge.flood.crests.recent.length > 0) {
    output += `### Recent Historic Crests\n`;
    const recentCrests = gauge.flood.crests.recent.slice(0, crestCap);
    for (const crest of recentCrests) {
      const crestDate = new Date(crest.date);
      output += `- **${crestDate.getFullYear()}:** ${crest.value.toFixed(2)} ft`;
      if (crest.flow) {
        output += ` (${crest.flow.toFixed(0)} cfs)`;
      }
      if (crest.description) {
        output += ` - ${crest.description}`;
      }
      output += `\n`;
    }
    output += `\n`;
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
  if (stage >= categories.major) return 'major';
  if (stage >= categories.moderate) return 'moderate';
  if (stage >= categories.minor) return 'minor';
  if (stage >= categories.action) return 'action';
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
