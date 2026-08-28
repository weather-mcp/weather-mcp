/**
 * Handler for get_lightning_activity tool
 * Provides real-time lightning strike monitoring and safety assessment
 */

import {
  LightningActivityParams,
  LightningActivityResponse,
  LightningMonitoringCoverage,
  LightningStrike,
  LightningStatistics,
  LightningSafetyAssessment,
  LightningSafetyLevel
} from '../types/lightning.js';
import { blitzortungService } from '../services/blitzortung.js';
import { LocationStore } from '../services/locationStore.js';
import { GeocodingService } from '../services/geocoding.js';
import { resolveLocationAsync, prependLocationLine } from '../utils/locationResolver.js';
import { validateLatitude, validateLongitude, validateDetail, DetailLevel } from '../utils/validation.js';
import { logger, redactCoordinatesForLogging } from '../utils/logger.js';
import { displayValue } from '../utils/displayBanding.js';
import { ValidationError } from '../errors/ApiError.js';

interface LightningActivityArgs {
  latitude?: number;
  longitude?: number;
  location_name?: string;
  city_name?: string;
  radius?: number;
  timeWindow?: number;
  detail?: 'summary' | 'standard' | 'full';
}

/**
 * Tool entry point: resolve the location (coordinates, saved name, or geocoded
 * city), fetch lightning activity, and format it with a resolved-location header.
 */
export async function handleGetLightningActivity(
  args: unknown,
  locationStore: LocationStore,
  geocodingService: GeocodingService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const typedArgs = (args ?? {}) as LightningActivityArgs;
  const resolved = await resolveLocationAsync(typedArgs, locationStore, geocodingService);

  // Output verbosity: 'full' lifts the listed-strike cap to 25 (not unbounded).
  // Statistics are computed over ALL strikes at every level — unaffected.
  const detail = validateDetail(typedArgs.detail);

  const result = await getLightningActivity({
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    radius: typedArgs.radius,
    timeWindow: typedArgs.timeWindow
  });

  const formatted = formatLightningActivityResponse(result, detail);

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
 * Validate lightning activity request parameters
 */
function validateLightningParams(params: LightningActivityParams): void {
  // Validate coordinates
  validateLatitude(params.latitude);
  validateLongitude(params.longitude);

  // Validate radius
  if (params.radius !== undefined) {
    if (typeof params.radius !== 'number' || params.radius < 1 || params.radius > 500) {
      throw new ValidationError(
        'radius must be a number between 1 and 500 km',
        'radius',
        params.radius
      );
    }
  }

  // Validate time window
  if (params.timeWindow !== undefined) {
    if (typeof params.timeWindow !== 'number' || params.timeWindow < 5 || params.timeWindow > 120) {
      throw new ValidationError(
        'timeWindow must be a number between 5 and 120 minutes',
        'timeWindow',
        params.timeWindow
      );
    }
  }
}

/**
 * Calculate lightning activity statistics
 */
function calculateStatistics(strikes: LightningStrike[], radiusKm: number, timeWindowMinutes: number): LightningStatistics {
  if (strikes.length === 0) {
    return {
      totalStrikes: 0,
      cloudToGroundStrikes: 0,
      intraCloudStrikes: 0,
      averageDistance: 0,
      nearestDistance: 0,
      strikesPerMinute: 0,
      densityPerSqKm: 0
    };
  }

  // Count cloud-to-ground vs intra-cloud (based on polarity and amplitude)
  // Typically, stronger amplitude indicates cloud-to-ground
  const cloudToGround = strikes.filter(s => Math.abs(s.amplitude) > 20).length;
  const intraCloud = strikes.length - cloudToGround;

  // Mean over the strikes that actually carry a distance. `s.distance || 0` added 0 for a
  // distance-less strike while still counting it in the divisor, dragging the mean toward
  // zero (issue #83). A strike whose distance is unknown contributes nothing to either side.
  const located = strikes.filter((s): s is LightningStrike & { distance: number } => s.distance != null);
  const averageDistance = located.length > 0
    ? located.reduce((sum, s) => sum + s.distance, 0) / located.length
    : null;

  // Nearest distance. `??`, never `||`, for the same reason as assessSafety: a strike at exactly
  // 0 km is falsy, and `|| 0` also turns an *absent* distance into a printed `0.0 km` — the
  // opposite lie. Unknown is null, not zero (issue #83).
  const nearestDistance = strikes[0]?.distance ?? null;

  // Strikes per minute
  const strikesPerMinute = strikes.length / timeWindowMinutes;

  // Density per square km (area of search circle)
  const searchArea = Math.PI * radiusKm * radiusKm;
  const densityPerSqKm = strikes.length / searchArea;

  return {
    totalStrikes: strikes.length,
    cloudToGroundStrikes: cloudToGround,
    intraCloudStrikes: intraCloud,
    averageDistance,
    nearestDistance,
    strikesPerMinute,
    densityPerSqKm
  };
}

/**
 * Assess safety level based on lightning activity
 */
function assessSafety(strikes: LightningStrike[], statistics: LightningStatistics): LightningSafetyAssessment {
  const nearestStrike = strikes[0] || null;
  // `??`, never `||`: a strike at exactly 0 km is falsy, and `|| null` would send it down the
  // `nearestDistance === null` arm below and render a green SAFE all-clear for a strike overhead.
  const nearestDistance = nearestStrike?.distance ?? null;
  const nearestTime = nearestStrike?.timestamp || null;
  // Band on the number the report actually prints, not the raw measurement: every sentence below
  // renders `.toFixed(1)`, so banding on the raw value lets two reports show the same distance under
  // different verdicts (issue #80). Per the caller contract shared with getFrostbiteRisk/getWbgtCategory.
  const shownDistance = nearestDistance === null ? null : displayValue(nearestDistance, 1);

  // Determine if there's active thunderstorm activity
  // Active if: strikes in last 10 minutes OR high strike rate
  const recentStrikes = strikes.filter(s => {
    const ageMinutes = (Date.now() - s.timestamp.getTime()) / (1000 * 60);
    return ageMinutes <= 10;
  });
  const isActiveThunderstorm = recentStrikes.length > 0 || statistics.strikesPerMinute > 0.5;

  let level: LightningSafetyLevel;
  let message: string;
  const recommendations: string[] = [];

  // Safety assessment based on nearest strike distance
  if (shownDistance === null || shownDistance > 50) {
    level = 'safe';
    // `safe` covers two different facts, and they must not share a sentence: no strikes were
    // found at all, or strikes were found and the nearest is beyond the 50 km threshold. The
    // second must state the fact and claim only what the band means — never assert an absence
    // above a report that goes on to list the strikes.
    message = shownDistance === null
      ? 'No significant lightning activity detected in the area.'
      : `Nearest lightning ${shownDistance.toFixed(1)} km away — no immediate lightning threat at this location.`;
    recommendations.push('Continue to monitor weather conditions.');
    recommendations.push('Lightning can strike from distant storms, so stay alert to changing conditions.');
  } else if (shownDistance > 16) {
    level = 'elevated';
    message = `Lightning detected ${shownDistance.toFixed(1)} km away. Thunderstorm in the vicinity.`;
    recommendations.push('Move activities indoors if possible.');
    recommendations.push('Avoid open areas, tall objects, and bodies of water.');
    recommendations.push('If outdoors, seek shelter in a substantial building or hard-topped vehicle.');
    recommendations.push('Monitor conditions closely - storms can move quickly.');
  } else if (shownDistance > 8) {
    level = 'high';
    message = `Lightning strike detected ${shownDistance.toFixed(1)} km away. High risk - seek shelter immediately.`;
    recommendations.push('SEEK SHELTER IMMEDIATELY in a substantial building or hard-topped vehicle.');
    recommendations.push('Do NOT shelter under trees or in open-sided structures.');
    recommendations.push('Stay away from windows, doors, and electrical equipment.');
    recommendations.push('If caught outside, crouch low with feet together and hands on knees.');
    recommendations.push('Wait 30 minutes after the last thunder before resuming outdoor activities.');
  } else {
    level = 'extreme';
    message = `EXTREME DANGER: Lightning strike within ${shownDistance.toFixed(1)} km. You are in immediate danger.`;
    recommendations.push('⚠️ TAKE IMMEDIATE SHELTER - Lightning is striking nearby!');
    recommendations.push('Get inside a substantial building or hard-topped vehicle NOW.');
    recommendations.push('If no shelter available, crouch low immediately with feet together.');
    recommendations.push('Do NOT lie flat - minimize contact with ground.');
    recommendations.push('Stay away from tall objects, water, and metal objects.');
    recommendations.push('Remain in shelter for 30 minutes after the last thunder.');
  }

  // Add activity-specific recommendations
  if (isActiveThunderstorm) {
    if (level === 'safe') {
      recommendations.unshift('Active thunderstorm detected in the region. Conditions may change rapidly.');
    }
    recommendations.push('Thunderstorm is active - expect continued lightning activity.');
  }

  return {
    level,
    message,
    recommendations,
    nearestStrikeDistance: nearestDistance,
    nearestStrikeTime: nearestTime,
    isActiveThunderstorm
  };
}

/**
 * Get lightning activity for a location
 */
export async function getLightningActivity(params: LightningActivityParams): Promise<LightningActivityResponse> {
  // Validate parameters
  validateLightningParams(params);

  const { latitude, longitude, radius = 100, timeWindow = 60 } = params;

  // Redact coordinates for logging to protect user privacy
  const redacted = redactCoordinatesForLogging(latitude, longitude);
  logger.info('Lightning activity requested', {
    latitude: redacted.lat,
    longitude: redacted.lon,
    radius,
    timeWindow
  });

  // Fetch lightning strikes
  const strikes = await blitzortungService.getLightningStrikes(
    latitude,
    longitude,
    radius,
    timeWindow
  );

  // Calculate statistics
  const statistics = calculateStatistics(strikes, radius, timeWindow);

  // Assess safety
  const safety = assessSafety(strikes, statistics);

  const now = new Date();
  const searchStart = new Date(now.getTime() - timeWindow * 60 * 1000);

  // Strikes only accumulate while the area's live subscriptions are active. If
  // monitoring began after the start of the requested window (fresh server, or
  // first query for this area), a "no strikes" result is inconclusive — say so
  // instead of implying verified safety.
  const coverageStart = blitzortungService.getCoverageStart(latitude, longitude, radius);
  const coverageMinutes = coverageStart
    ? Math.max(0, Math.min(timeWindow, (now.getTime() - coverageStart.getTime()) / (1000 * 60)))
    : 0;
  // Keyed on the array this query returned, so an overlapping query's outcome can never be read
  // here. `!= null` rather than `!== null`: a bare `vi.fn()` stub returns `undefined`, and treating
  // that as an outage would flip every existing fixture onto the outage path.
  const feedUnavailable = blitzortungService.getFeedFailure(strikes) != null;
  const coverage: LightningMonitoringCoverage = {
    monitoringSince: coverageStart,
    coverageMinutes,
    // A failed feed cannot have covered the requested window, whatever the subscription stamps
    // say. `geohashFirstSubscribed` is written before the subscribe call, and mqtt reconnects in
    // the background, so an outage can otherwise coexist with a non-null coverage start and a
    // complete-looking window - and every caveat below is gated on `!isComplete`, so the outage
    // text would be skipped entirely. `coverageMinutes` stays honest about earlier monitoring.
    isComplete: coverageMinutes >= timeWindow && !feedUnavailable,
    feedUnavailable
  };

  if (!coverage.isComplete && safety.level === 'safe') {
    // Only the *message* is gated on whether there is a nearest-strike distance at all: with one
    // present this wording would deny the very list printed beneath it. Key on the same value
    // `assessSafety` banded on rather than on `strikes.length`, so the two can never disagree
    // about one report — a strike carrying no distance has `length === 1` and a null distance at
    // once. The coverage recommendation below is unconditional with respect to the strike count —
    // partial coverage makes the result inconclusive either way — but it stays inside the `safe`
    // gate, because "treat this as inconclusive" above an EXTREME DANGER warning would degrade a
    // life-safety message.
    if (coverage.feedUnavailable) {
      // An outage always leaves the buffer's own story intact, so both arms are needed. With no
      // distance there is nothing to report at all; with one, the `safe` band would otherwise
      // print "no immediate lightning threat at this location" - an affirmative all-clear - one
      // line under an UNKNOWN heading. `elevated`/`high`/`extreme` never reach this gate, so a
      // buffered urgent verdict is never weakened.
      safety.message = safety.nearestStrikeDistance === null
        ? 'The live lightning feed could not be reached, so no strikes could be observed for ' +
          'this area. This is not an all-clear.'
        : 'Buffered strikes from earlier monitoring are shown below, but the live lightning feed ' +
          'could not be reached for this query, so current conditions are unknown. This is not ' +
          'an all-clear.';
    } else if (safety.nearestStrikeDistance === null) {
      safety.message =
        'No lightning strikes observed during the limited monitoring period. ' +
        'This does NOT confirm the absence of lightning activity.';
    }
    safety.recommendations.unshift(
      coverage.feedUnavailable
        // No "re-check shortly": during an outage every re-check reads the same zero, so the
        // remedy that works is a different source, not a second look at this one.
        ? 'The live lightning feed was unreachable for this query — consult official weather ' +
          'services (the NWS or your national authority) before making safety decisions.'
        : `Live monitoring of this area covers only ${coverageMinutes.toFixed(1)} of the requested ` +
          `${timeWindow} minutes — treat this result as inconclusive and re-check shortly.`
    );
  }

  return {
    location: { latitude, longitude },
    searchRadius: radius,
    timeWindow,
    searchPeriod: {
      start: searchStart,
      end: now
    },
    strikes,
    statistics,
    safety,
    coverage,
    source: 'Blitzortung.org',
    generatedAt: now,
    disclaimer: 'Lightning data from Blitzortung.org community network. Data may have 5-15 minute delay. For life-safety decisions, consult official weather services and local emergency management. When thunder roars, go indoors!'
  };
}

/**
 * Format lightning activity response for display
 */
export function formatLightningActivityResponse(
  response: LightningActivityResponse,
  detail: DetailLevel = 'standard'
): string {
  const lines: string[] = [];

  lines.push('# ⚡ Lightning Activity Report');
  lines.push('');
  lines.push(`**Location:** ${response.location.latitude.toFixed(4)}, ${response.location.longitude.toFixed(4)}`);
  lines.push(`**Search Radius:** ${response.searchRadius} km`);
  lines.push(`**Time Window:** ${response.timeWindow} minutes (${response.searchPeriod.start.toISOString()} to ${response.searchPeriod.end.toISOString()})`);
  lines.push('');

  // Safety assessment
  const safetyIcon = {
    safe: '🟢',
    elevated: '🟡',
    high: '🟠',
    extreme: '🔴'
  }[response.safety.level];

  const limitedData = !response.coverage.isComplete;
  // Strict `=== true`, so a fixture built before this field existed reads as a cold start rather
  // than an outage. The internal safety level stays `safe` - this is a render-time substitution,
  // not a fifth level - and only `safe` is overridden, so a buffered EXTREME keeps its own heading.
  const feedDown = response.coverage.feedUnavailable === true;
  const statusSuffix = limitedData && response.safety.level === 'safe' ? ' (LIMITED DATA)' : '';
  if (feedDown && response.safety.level === 'safe') {
    lines.push('## ⚪ Safety Status: UNKNOWN (LIVE FEED UNAVAILABLE)');
  } else {
    lines.push(`## ${safetyIcon} Safety Status: ${response.safety.level.toUpperCase()}${statusSuffix}`);
  }
  lines.push('');
  lines.push(response.safety.message);
  lines.push('');

  if (limitedData) {
    const since = response.coverage.monitoringSince
      ? ` (since ${response.coverage.monitoringSince.toISOString()})`
      : '';
    // What partial coverage under-informs depends on what was found. With no nearest-strike
    // distance the caveat is about the absence; with one present the absence is not in doubt —
    // the under-informed number is that distance, which is what the verdict rests on. Key on the
    // same value the verdict was banded on, not on `strikes.length`, so the sentence can never
    // contradict the message above it. The distance itself is deliberately not repeated here: it
    // is rendered below, and a second copy is a second rounding site that could disagree with it.
    const coverageCaveat = response.safety.nearestStrikeDistance === null
      ? `An absence of strikes in this report does not confirm an absence of lightning. `
      : `The nearest-strike distance below is therefore a floor — a closer strike could have ` +
        `occurred during the minutes that were not monitored. `;
    // An outage selector above both existing variants, not a replacement for either: the two
    // states have different causes and different remedies, and telling someone to re-check in a
    // few minutes is advice that cannot work while the feed is down.
    if (feedDown) {
      lines.push(
        `⚠️ **Live feed unavailable:** The connection to the lightning detection feed failed for ` +
        `this query, so live strike collection for this area spans ` +
        `${response.coverage.coverageMinutes.toFixed(1)} of the requested ${response.timeWindow} minutes${since} — ` +
        `from earlier monitoring only, if any. ` +
        (response.safety.nearestStrikeDistance === null
          ? `No strikes could be observed; this is not an all-clear. `
          : coverageCaveat) +
        `Consult official weather services before making safety decisions.`
      );
      lines.push('');
      lines.push(
        '*Why: strikes come from a live Blitzortung.org feed, and the server could not reach it ' +
        'for this query. It reconnects automatically in the background; a later query may ' +
        'succeed. No strike data is fabricated while the feed is down.*'
      );
    } else {
      lines.push(
        `⚠️ **Limited monitoring coverage:** Live strike collection for this area spans ` +
        `${response.coverage.coverageMinutes.toFixed(1)} of the requested ${response.timeWindow} minutes${since}. ` +
        coverageCaveat +
        `Re-check in a few minutes or consult official weather services before making safety decisions.`
      );
      lines.push('');
      // Explain WHY coverage is limited so a fresh/near-zero reading is not mistaken for
      // verified calm — this is expected on a first query, not an error.
      lines.push(
        '*Why: lightning is monitored via a live feed that only begins buffering strikes once ' +
        'an area is first queried, so a location’s first lookup starts near zero coverage and ' +
        'builds over the following minutes. Saved locations are pre-warmed at startup. Historical ' +
        'strikes cannot be backfilled.*'
      );
    }
    lines.push('');
  }

  // Recommendations
  if (response.safety.recommendations.length > 0) {
    lines.push('### Safety Recommendations');
    lines.push('');
    response.safety.recommendations.forEach(rec => {
      lines.push(`- ${rec}`);
    });
    lines.push('');
  }

  // Statistics
  lines.push('## 📊 Lightning Statistics');
  lines.push('');
  lines.push(`**Total Strikes:** ${response.statistics.totalStrikes}`);
  lines.push(
    `**Monitoring Coverage:** ${response.coverage.coverageMinutes.toFixed(1)} of ${response.timeWindow} minutes` +
    (response.coverage.isComplete ? '' : ' ⚠️')
  );

  if (response.statistics.totalStrikes > 0) {
    lines.push(`**Cloud-to-Ground:** ${response.statistics.cloudToGroundStrikes}`);
    lines.push(`**Intra-Cloud:** ${response.statistics.intraCloudStrikes}`);
    lines.push(
      response.statistics.nearestDistance === null
        ? '**Nearest Strike:** distance unavailable'
        : `**Nearest Strike:** ${response.statistics.nearestDistance.toFixed(1)} km away`
    );
    lines.push(
      response.statistics.averageDistance === null
        ? '**Average Distance:** unavailable'
        : `**Average Distance:** ${response.statistics.averageDistance.toFixed(1)} km`
    );
    lines.push(`**Strike Rate:** ${response.statistics.strikesPerMinute.toFixed(2)} strikes/minute`);
    lines.push(`**Density:** ${response.statistics.densityPerSqKm.toFixed(4)} strikes/km²`);
    lines.push(`**Active Thunderstorm:** ${response.safety.isActiveThunderstorm ? 'Yes' : 'No'}`);
    lines.push('');

    // Recent strikes. detail="full" lifts the cap to 25 (still capped, not
    // unbounded — see D2 in docs/output-completeness-plan.md); the remainder
    // note stays accurate at every level, including full. Statistics above are
    // computed over ALL strikes regardless of detail level — unaffected here.
    lines.push('## 🌩️ Recent Strikes');
    lines.push('');
    const maxStrikesToShow = detail === 'full' ? 25 : 10;
    const strikesToShow = response.strikes.slice(0, maxStrikesToShow);

    strikesToShow.forEach((strike, index) => {
      const ageMinutes = (response.generatedAt.getTime() - strike.timestamp.getTime()) / (1000 * 60);
      const polaritySymbol = strike.polarity > 0 ? '+' : '−';
      lines.push(`### Strike ${index + 1}`);
      lines.push(strike.distance != null
        ? `- **Distance:** ${strike.distance.toFixed(1)} km`
        : '- **Distance:** unavailable');
      lines.push(`- **Time:** ${strike.timestamp.toISOString()} (${ageMinutes.toFixed(1)} minutes ago)`);
      lines.push(`- **Location:** ${strike.latitude.toFixed(4)}, ${strike.longitude.toFixed(4)}`);
      lines.push(`- **Polarity:** ${polaritySymbol} (${strike.polarity > 0 ? 'Positive' : 'Negative'})`);
      lines.push(`- **Amplitude:** ${strike.amplitude.toFixed(1)} kA`);
      if (strike.stationCount) {
        lines.push(`- **Detected by:** ${strike.stationCount} stations`);
      }
      lines.push('');
    });

    if (response.strikes.length > maxStrikesToShow) {
      if (detail === 'full') {
        lines.push(`*Showing ${maxStrikesToShow} of ${response.strikes.length} strikes detected*`);
      } else {
        lines.push(`*Showing ${maxStrikesToShow} of ${response.strikes.length} strikes detected — use detail="full" for more*`);
      }
      lines.push('');
    }
  } else {
    lines.push('');
    lines.push('No lightning strikes detected in the search area during the time window.');
    lines.push('');
  }

  // Disclaimer
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
