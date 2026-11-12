/**
 * A strike up to the parser's 5-minute skew ahead of the host clock renders a displayed age of
 * 0.0, never a negative one (the render half of the parser's rule, G68). Only the derived age is
 * floored: the published timestamp prints verbatim, and every non-negative age renders exactly
 * as before (byte identity against the base render, captured before the edit).
 *
 * Reached through `get_lightning_activity` and through `get_weather_summary`'s lightning section
 * (G19, G126). The service is stubbed; the clock is pinned.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import type { LightningStrike } from '../../src/types/lightning.js';

vi.mock('../../src/services/blitzortung.js', () => ({
  blitzortungService: {
    getLightningStrikes: vi.fn(),
    getCoverageStart: vi.fn(),
    getFeedFailure: vi.fn(() => null)
  }
}));

const otherSection = vi.fn();
vi.mock('../../src/handlers/currentConditionsHandler.js', () => ({
  handleGetCurrentConditions: (...args: unknown[]) => otherSection(...args)
}));
vi.mock('../../src/handlers/forecastHandler.js', () => ({
  handleGetForecast: (...args: unknown[]) => otherSection(...args)
}));
vi.mock('../../src/handlers/alertsHandler.js', () => ({
  handleGetAlerts: (...args: unknown[]) => otherSection(...args)
}));
vi.mock('../../src/handlers/airQualityHandler.js', () => ({
  handleGetAirQuality: (...args: unknown[]) => otherSection(...args)
}));

import { handleGetLightningActivity } from '../../src/handlers/lightningHandler.js';
import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import { blitzortungService } from '../../src/services/blitzortung.js';

const NOW = new Date('2026-06-15T18:00:00.000Z').getTime();
const LAT = 40.0;
const LON = -74.0;

function strikeAt(offsetMs: number, distance: number): LightningStrike {
  return {
    timestamp: new Date(NOW + offsetMs),
    latitude: 40.01,
    longitude: -74.0,
    polarity: -1,
    amplitude: 0,
    distance
  };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map(c => c.text ?? '').join('\n');
}

async function render(strikes: LightningStrike[]): Promise<string> {
  (blitzortungService.getLightningStrikes as Mock).mockResolvedValue(strikes);
  return textOf(await handleGetLightningActivity({ latitude: LAT, longitude: LON, radius: 50, timeWindow: 60 }));
}

/** A negative number inside a "(… minutes ago)" construct, never a bare `-` (G62, G96). */
const NEGATIVE_AGE = /\(-\d[\d.]* minutes ago\)/;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  (blitzortungService.getCoverageStart as Mock).mockReturnValue(new Date(NOW - 3 * 60 * 60 * 1000));
  otherSection.mockResolvedValue({ content: [{ type: 'text', text: '# Other\nok' }] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Displayed strike age is floored at zero', () => {
  it('renders a strike 2 minutes ahead as 0.0 minutes ago, with its timestamp verbatim', async () => {
    const text = await render([strikeAt(2 * 60_000, 1.1)]);
    expect(text).toContain(`- **Time:** ${new Date(NOW + 2 * 60_000).toISOString()} (0.0 minutes ago)`);
    expect(text).not.toMatch(NEGATIVE_AGE);
  });

  it('renders a strike 3 seconds ahead as 0.0 minutes ago', async () => {
    const text = await render([strikeAt(3_000, 1.1)]);
    expect(text).toContain('(0.0 minutes ago)');
    expect(text).not.toMatch(NEGATIVE_AGE);
  });

  it('leaves a past strike age as it was', async () => {
    // 78 s = 1.3 min: not an exact binary half (G36).
    const text = await render([strikeAt(-78_000, 1.1)]);
    expect(text).toContain('(1.3 minutes ago)');
  });

  it('renders non-negative ages byte-identical to the base', async () => {
    const text = await render([strikeAt(-78_000, 1.1), strikeAt(-7 * 60_000, 4.2), strikeAt(-2_004_000, 12.5)]);
    expect(text).toContain('**Total Strikes:** 3');
    expect(createHash('md5').update(text).digest('hex')).toBe(BASE_MD5);
  });

  it('floors the age on the get_weather_summary lightning section too', async () => {
    (blitzortungService.getLightningStrikes as Mock).mockResolvedValue([strikeAt(2 * 60_000, 1.1)]);
    const result = await handleGetWeatherSummary(
      { latitude: LAT, longitude: LON, include: ['lightning'] },
      {} as never, {} as never, {} as never, {} as never, {} as never
    );
    const text = textOf(result);
    expect(text).toContain('(0.0 minutes ago)');
    expect(text).not.toMatch(NEGATIVE_AGE);
  });
});

/** md5 of the render above on the base (`main` @ 1bb3652), captured before the floor landed. */
const BASE_MD5 = '6b109c6ffd40c33dd3cdbf5ebcb0a29b';
