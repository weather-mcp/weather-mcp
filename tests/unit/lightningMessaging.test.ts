/**
 * Unit tests for lightning limited-coverage messaging (BUG-3, 2026-07-13).
 *
 * A first query to a fresh area reports near-zero monitoring coverage because the live
 * Blitzortung feed only buffers strikes after subscription. The output must clearly flag
 * this ("LIMITED DATA") and explain why, so a near-zero reading is not mistaken for
 * verified calm.
 */

import { describe, it, expect } from 'vitest';
import { formatLightningActivityResponse } from '../../src/handlers/lightningHandler.js';
import type { LightningActivityResponse } from '../../src/types/lightning.js';

function baseResponse(overrides: Partial<LightningActivityResponse> = {}): LightningActivityResponse {
  const now = new Date('2026-07-13T15:30:00Z');
  return {
    location: { latitude: 43.8195, longitude: -84.7686 },
    searchRadius: 100,
    timeWindow: 60,
    searchPeriod: { start: new Date(now.getTime() - 60 * 60 * 1000), end: now },
    strikes: [],
    statistics: {
      totalStrikes: 0,
      cloudToGroundStrikes: 0,
      intraCloudStrikes: 0,
      averageDistance: 0,
      nearestDistance: 0,
      strikesPerMinute: 0,
      densityPerSqKm: 0,
    },
    safety: {
      level: 'safe',
      message:
        'No lightning strikes observed during the limited monitoring period. ' +
        'This does NOT confirm the absence of lightning activity.',
      recommendations: [],
      nearestStrikeDistance: null,
      nearestStrikeTime: null,
      isActiveThunderstorm: false,
    },
    coverage: { monitoringSince: null, coverageMinutes: 0, isComplete: false },
    source: 'Blitzortung.org',
    generatedAt: now,
    disclaimer: 'test disclaimer',
    ...overrides,
  };
}

describe('formatLightningActivityResponse — limited-coverage messaging', () => {
  it('flags LIMITED DATA and explains why on incomplete coverage', () => {
    const out = formatLightningActivityResponse(baseResponse());

    expect(out).toContain('(LIMITED DATA)');
    expect(out).toContain('Limited monitoring coverage');
    expect(out).toContain('Why:');
    expect(out).toContain('pre-warmed at startup');
    expect(out).toContain('cannot be backfilled');
  });

  it('omits the limited-data explainer when coverage is complete', () => {
    const out = formatLightningActivityResponse(
      baseResponse({
        coverage: {
          monitoringSince: new Date('2026-07-13T14:00:00Z'),
          coverageMinutes: 60,
          isComplete: true,
        },
      }),
    );

    expect(out).not.toContain('(LIMITED DATA)');
    expect(out).not.toContain('Limited monitoring coverage');
    expect(out).not.toContain('Why:');
  });
});
