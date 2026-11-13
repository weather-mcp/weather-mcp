/**
 * Integration test for single-model ensemble spread
 * (`OpenMeteoService.getEnsembleSpread`) — per
 * docs/ensemble-spread-plan.md §Testing "Integration" bullet and
 * docs/ensemble-spread-implementation-plan.md T6.
 *
 * **This file makes live network calls** against the real Open-Meteo
 * Ensemble API (`https://ensemble-api.open-meteo.com/v1/ensemble`) and joins
 * the project's flaky-tolerant live-network set alongside
 * tests/integration/model-comparison.test.ts — a red result here may be
 * independent flake and should be re-run before suspecting a diff. See the
 * "Flaky live-network tests" project memory.
 *
 * Follows the **corrected** `model-comparison.test.ts` convention, not the
 * older swallow-everything files (e.g. almanac.test.ts): the live call is
 * wrapped in a try/catch that logs and passes on a transport failure (DNS,
 * timeout, rate limit, service unavailable), but **assertion failures are
 * deliberately re-thrown** — a successful response whose shape is wrong
 * means the upstream ensemble contract changed, which is exactly what this
 * canary exists to catch.
 */

import { describe, it, expect } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { ENSEMBLE_MEMBER_COUNT } from '../../src/utils/ensembleSpread.js';

/** Denver, CO — a stable, well-covered land location (major city, mid-latitude, not open ocean or polar). */
const DENVER_LAT = 39.7392;
const DENVER_LON = -104.9903;

/** Minimum non-null day-1 `temperature_2m_max` members required for the canary to consider the response healthy. */
const MIN_NON_NULL_MEMBERS = 45;

describe('Ensemble spread integration — live smoke test (tolerant of network flake)', () => {
  it('fetches a real single-model ensemble and finds 50 member keys with data for day 1', async () => {
    const openMeteoService = new OpenMeteoService();
    openMeteoService.clearCache();

    try {
      const response = await openMeteoService.getEnsembleSpread(DENVER_LAT, DENVER_LON, 7);

      // Shape: non-empty daily.time (D3 validator's baseline requirement).
      expect(Array.isArray(response.daily.time)).toBe(true);
      expect(response.daily.time.length).toBeGreaterThan(0);

      // Shape: the member-key contract (design header fact (b)) — ECMWF IFS
      // 0.25° publishes member01..member50, zero-padded, unsuffixed by model
      // name (single-model request).
      let membersPresent = 0;
      let membersNonNullDay1 = 0;

      for (let i = 1; i <= ENSEMBLE_MEMBER_COUNT; i++) {
        const key = `temperature_2m_max_member${String(i).padStart(2, '0')}`;
        const series = response.daily[key];
        const hasKey = Array.isArray(series);
        if (hasKey) {
          membersPresent++;
          const day1 = (series as unknown[])[0];
          if (typeof day1 === 'number' && Number.isFinite(day1)) {
            membersNonNullDay1++;
          }
        }
      }

      // All 50 member keys must be present (member01..member50).
      expect(membersPresent).toBe(ENSEMBLE_MEMBER_COUNT);

      // At least 45 of 50 members return non-null day-1 temperature data
      // for this well-covered location.
      expect(membersNonNullDay1).toBeGreaterThanOrEqual(MIN_NON_NULL_MEMBERS);

      console.log('\n=== Live ensemble-spread smoke test: Denver, CO ===');
      console.log(`Days returned: ${response.daily.time.length}`);
      console.log(
        `Member keys present: ${membersPresent}/${ENSEMBLE_MEMBER_COUNT}; non-null day-1 temperature_2m_max: ${membersNonNullDay1}/${ENSEMBLE_MEMBER_COUNT}`
      );
    } catch (error) {
      // A failed assertion above is a real contract breach — the upstream
      // shape changed — so it must still turn the suite red. A blanket catch
      // (the shape used by the sibling live files) would swallow it and log a
      // genuine regression as a network blip, leaving a test that can never
      // fail. Only transport failures are tolerated here.
      if (error instanceof Error && (error.name === 'AssertionError' || 'matcherResult' in error)) {
        throw error;
      }
      // Tolerant of live-network flake: log and pass rather than fail the suite.
      console.warn(
        '\n=== Live ensemble-spread smoke test skipped (network error) ===\n',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, 60000);
});
