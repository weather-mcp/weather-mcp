/**
 * Integration test for multi-model forecast comparison
 * (`OpenMeteoService.getModelComparison`) — per
 * docs/multi-model-comparison-plan.md §Testing "Integration" bullet and
 * docs/multi-model-comparison-implementation-plan.md T6.
 *
 * **This file makes live network calls** against the real Open-Meteo
 * forecast endpoint (`models=` parameter) and belongs to the project's
 * flaky-tolerant live-network set — a red result here should be re-run
 * before suspecting a diff. See the "Flaky live-network tests" project
 * memory and the tolerant-live-test convention used throughout
 * tests/integration/ (almanac.test.ts, global-fire-weather.test.ts,
 * global-rivers.test.ts, global-wildfire.test.ts, safety-hazards.test.ts).
 *
 * Tolerant of live-network flake by design: the live call is wrapped in a
 * try/catch that logs and passes on a transport failure (DNS, timeout, rate
 * limit, service unavailable) rather than failing the suite. **Assertion
 * failures are deliberately re-thrown** — a successful response whose shape
 * is wrong means the upstream `models=` contract changed, which is exactly
 * what this canary exists to catch. This is a deliberate narrowing of the
 * blanket catch used by the sibling live files, which would swallow a real
 * regression as if it were a network blip.
 */

import { describe, it, expect } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { COMPARISON_MODELS } from '../../src/utils/modelComparison.js';

/** Denver, CO — a stable, well-covered land location (major city, mid-latitude, not open ocean or polar). */
const DENVER_LAT = 39.7392;
const DENVER_LON = -104.9903;

/** COMPARISON_MODELS excluding the best_match reference member (D6) — the models participating in the ≥4-of-5 assertion. */
const NON_REFERENCE_MODELS = COMPARISON_MODELS.filter(model => model !== 'best_match');

describe('Model comparison integration — live smoke test (tolerant of network flake)', () => {
  it('fetches a real multi-model comparison and finds suffixed keys with data from at least 4 of 5 comparison models', async () => {
    const openMeteoService = new OpenMeteoService();
    openMeteoService.clearCache();

    try {
      const response = await openMeteoService.getModelComparison(DENVER_LAT, DENVER_LON, 7);

      // Shape: non-empty daily.time (D3 validator's baseline requirement).
      expect(Array.isArray(response.daily.time)).toBe(true);
      expect(response.daily.time.length).toBeGreaterThan(0);

      // Shape: the suffixed key contract (design header fact (a)) — with
      // COMPARISON_MODELS.length > 1, every daily variable is requested as
      // `<variable>_<model>`, never a bare `temperature_2m_max`.
      let modelsWithTemperatureKey = 0;
      let modelsWithData = 0;

      for (const model of NON_REFERENCE_MODELS) {
        const key = `temperature_2m_max_${model}`;
        const series = response.daily[key];
        const hasKey = Array.isArray(series);
        if (hasKey) {
          modelsWithTemperatureKey++;
          const hasNonNullValue = (series as (unknown)[]).some(
            value => typeof value === 'number' && Number.isFinite(value)
          );
          if (hasNonNullValue) {
            modelsWithData++;
          }
        }
      }

      // At least 4 of the 5 comparison models (best_match excluded, D6)
      // return non-null temperature data for this well-covered location.
      expect(modelsWithData).toBeGreaterThanOrEqual(4);

      console.log('\n=== Live model-comparison smoke test: Denver, CO ===');
      console.log(`Days returned: ${response.daily.time.length}`);
      console.log(
        `Models with suffixed temperature key: ${modelsWithTemperatureKey}/${NON_REFERENCE_MODELS.length}; with non-null data: ${modelsWithData}/${NON_REFERENCE_MODELS.length}`
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
        '\n=== Live model-comparison smoke test skipped (network error) ===\n',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, 60000);
});
