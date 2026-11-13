/**
 * One live smoke test of get_lightning_activity against the real Blitzortung broker.
 *
 * It proves the default path still connects and renders a well-formed response.
 * It asserts no strike count above zero (G30): the feed only begins buffering an
 * area once it is first queried, so the first probe of any point reports zero.
 * Counting, radius and banding are pinned offline by
 * tests/integration/lightning-fixture-broker.test.ts.
 *
 * G9: only a transport failure skips (log and pass). A rendered feed-unavailable
 * result, or the service's own fixed connect/subscribe timeout, is transport.
 * Anything else is rethrown. Every expect sits after the try/catch.
 */

import { describe, it, expect } from 'vitest';
import { getLightningActivity } from '../../src/handlers/lightningHandler.js';
import type { LightningActivityResponse } from '../../src/types/lightning.js';

const TRANSPORT_MESSAGES = ['MQTT connection timeout', 'MQTT subscribe timeout'];

describe('get_lightning_activity against the live broker', () => {
  it('returns a well-formed response, or skips on a transport failure', async () => {
    let result: LightningActivityResponse | undefined;
    try {
      result = await getLightningActivity({ latitude: 25.7617, longitude: -80.1918, radius: 100, timeWindow: 60 });
    } catch (error) {
      if (error instanceof Error && TRANSPORT_MESSAGES.includes(error.message)) {
        console.warn(`Skipping: Blitzortung broker unreachable (${error.message})`);
        return;
      }
      throw error;
    }

    if (result.coverage.feedUnavailable) {
      console.warn('Skipping: Blitzortung feed unavailable (rendered outage result)');
      return;
    }

    expect(result.source).toBe('Blitzortung.org');
    expect(typeof result.statistics.totalStrikes).toBe('number');
    expect(result.statistics.totalStrikes).toBeGreaterThanOrEqual(0);
    expect(typeof result.coverage).toBe('object');
  });
});
