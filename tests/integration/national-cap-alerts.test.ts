/**
 * Live integration smoke for the national CAP 1.2 alert feeds (T8,
 * NDMA SACHET / India, PAGASA / Philippines, BMKG / Indonesia — see
 * `src/services/nationalCap.ts` and `src/utils/capParse.ts`).
 *
 * This file joins the project's live-network integration set: it makes real
 * HTTP requests to three government feeds with no mocking, so it can flake
 * independently of any diff in this repo (see the "Flaky live-network tests"
 * memory) — re-run before blaming a diff if only this file goes red.
 *
 * **Why SACHET and PAGASA are index-only here.** `vitest.config.ts` has no
 * `include` filter, so every file under `tests/integration/` — this one
 * included — runs on *every* `npm test`, paid for by every developer on
 * every gate run. SACHET's index alone carries close to `MAX_INDEX_ITEMS`
 * (200) entries, and its per-alert document lives behind a separate polygon
 * document (`getWarnings('in')` is therefore roughly N document fetches plus
 * N polygon fetches — ~200 requests for a full refresh). PAGASA's index is
 * smaller but its document fan-out is still unbounded here. Driving either
 * feed's full `getWarnings` path live is T9's job (a scratch driver run on
 * demand), not something every `npm test` invocation should pay for. This
 * file therefore calls only the cheap, unbounded-request-free `getIndex`
 * for `in` and `ph`, and reserves the (cheap, rate-limited) `getWarnings`
 * document path for BMKG only, and only when its index is small enough that
 * paying for it stays well inside the test timeout (see
 * `BMKG_SMOKE_MAX_ENTRIES` below).
 *
 * **Tolerant-but-not-silent.** Unlike `tests/integration/international-alerts.test.ts`
 * (whose live smoke wraps its `expect` calls *inside* the tolerant
 * `try/catch`, so a shape regression would be swallowed and logged as a
 * network flake), every `expect` in this file sits *after* its catch block,
 * gated on the result being defined. `isTransportFailure` decides, for each
 * caught error, whether it is one of the service's own fixed transport
 * strings (connection refused, timeout, rate limit, 5xx) — those are logged
 * and skipped — or anything else (an XML validation error, a root/envelope
 * shape error, an allowlist rejection, or a Vitest assertion failure), which
 * is rethrown and fails the suite. A genuine shape regression in
 * `capParse.ts` or a live host/path drift in `NATIONAL_CAP_FEEDS` must never
 * be swallowed as "the network was flaky".
 *
 * Assertions here are shape-only — array-ness, field presence/typeof, URL
 * allowlist membership, polygon-ring closure — never on live *content*
 * (alerts come and go; a specific event/count/identifier is never asserted).
 */

import { describe, expect, it } from 'vitest';
import { NATIONAL_CAP_FEEDS, NationalCapService } from '../../src/services/nationalCap.js';
import { isAllowedFeedUrl } from '../../src/utils/capParse.js';
import type { NationalCapResult, NormalizedCapIndexEntry } from '../../src/types/cap.js';

/** The three national CAP feeds this file smoke-tests. */
const FEED_CODES = ['in', 'ph', 'id'] as const;

/**
 * BMKG's document/polygon path (`getWarnings('id')`) is only exercised when
 * its index has this many entries or fewer. At BMKG's declared 1
 * request/second limiter (`requestsPerMinute: 60` in `NATIONAL_CAP_FEEDS`),
 * this bounds the document fan-out to roughly 6 seconds of sequential
 * requests plus one retry — comfortably inside this test's 45s timeout.
 * BMKG's index carried 2 entries on 2026-08-23 — an observation, not a
 * bound the live feed is expected to respect going forward.
 */
const BMKG_SMOKE_MAX_ENTRIES = 5;

interface IndexSmokeResult {
  entries: NormalizedCapIndexEntry[];
  trimmed: boolean;
  dropped: number;
}

/**
 * True only for the service's own fixed transport-failure strings (see
 * `NationalCapService['toFeedError']` in `src/services/nationalCap.ts`):
 * connection failure, timeout, rate limit, or a 5xx "server error (status".
 * Everything else — XML validation errors, root/envelope shape errors,
 * allowlist rejections, and Vitest assertion errors — returns `false`, so
 * the caller rethrows rather than swallowing a real regression as a
 * network flake.
 */
function isTransportFailure(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const message = err.message;
  return (
    message.includes('Unable to connect') ||
    message.includes('timed out') ||
    message.includes('rate limit') ||
    message.includes('server error (status')
  );
}

describe('National CAP alerts — live index smoke (tolerant of network flake)', () => {
  for (const cc of FEED_CODES) {
    it(`${cc}: index has the expected shape`, async () => {
      const service = new NationalCapService();
      const feed = NATIONAL_CAP_FEEDS[cc];
      let result: IndexSmokeResult | undefined;
      const start = Date.now();

      try {
        result = await service.getIndex(cc);
      } catch (err) {
        if (isTransportFailure(err)) {
          console.warn(
            `National CAP index smoke (${cc}) skipped — network error:`,
            err instanceof Error ? err.message : String(err)
          );
          result = undefined;
        } else {
          // Not a transport failure: a shape/allowlist/assertion problem
          // must fail the suite, never be logged as a skip.
          throw err;
        }
      }

      const elapsed = Date.now() - start;

      if (result) {
        console.log(
          `National CAP index (${cc}): ${result.entries.length} entries, ` +
            `trimmed=${result.trimmed}, dropped=${result.dropped}, ${elapsed}ms`
        );

        expect(Array.isArray(result.entries)).toBe(true);

        if (result.entries.length === 0) {
          // Declared explicitly rather than left as a silently-vacuous loop
          // below: an empty feed passing an all-entries check must be
          // distinguishable from a broken parser that also returns [].
          console.log(`National CAP index (${cc}) is empty right now.`);
        } else {
          for (const entry of result.entries) {
            expect(typeof entry.identifier).toBe('string');
            expect(entry.identifier.length).toBeGreaterThan(0);
            expect(entry.documentUrl.startsWith('https://')).toBe(true);
            expect(isAllowedFeedUrl(entry.documentUrl, feed)).toBe(true);
          }
        }

        expect(typeof result.trimmed).toBe('boolean');
      }
    }, 30000);
  }
});

describe('National CAP alerts — BMKG document path (fan-out guarded, tolerant of network flake)', () => {
  it('id: getWarnings has the expected shape, only when the index is small enough', async () => {
    const service = new NationalCapService();

    let indexResult: IndexSmokeResult | undefined;
    const indexStart = Date.now();
    try {
      indexResult = await service.getIndex('id');
    } catch (err) {
      if (isTransportFailure(err)) {
        console.warn(
          'National CAP BMKG document smoke skipped — index fetch network error:',
          err instanceof Error ? err.message : String(err)
        );
        indexResult = undefined;
      } else {
        throw err;
      }
    }
    console.log(
      `National CAP index (id, pre-check for document smoke): ` +
        `${indexResult ? indexResult.entries.length : 'n/a'} entries, ${Date.now() - indexStart}ms`
    );

    if (!indexResult) {
      return;
    }

    if (indexResult.entries.length > BMKG_SMOKE_MAX_ENTRIES) {
      console.log(
        `National CAP BMKG document smoke skipped — index has ${indexResult.entries.length} ` +
          `entries, exceeding the fan-out guard of ${BMKG_SMOKE_MAX_ENTRIES}; the uncapped ` +
          'live document path belongs to T9\'s scratch driver.'
      );
      return;
    }

    let result: NationalCapResult | undefined;
    const start = Date.now();
    try {
      result = await service.getWarnings('id');
    } catch (err) {
      if (isTransportFailure(err)) {
        console.warn(
          'National CAP BMKG document smoke skipped — network error:',
          err instanceof Error ? err.message : String(err)
        );
        result = undefined;
      } else {
        throw err;
      }
    }
    const elapsed = Date.now() - start;

    if (result) {
      console.log(
        `National CAP BMKG warnings (id): ${result.warnings.length} warning(s), ` +
          `unavailableCount=${result.unavailableCount}, ` +
          `polygonUnavailableCount=${result.polygonUnavailableCount}, ` +
          `indexTrimmed=${result.indexTrimmed}, ${elapsed}ms`
      );

      expect(Array.isArray(result.warnings)).toBe(true);

      if (result.warnings.length === 0) {
        console.log('National CAP BMKG warnings (id) list is empty right now.');
      } else {
        for (const warning of result.warnings) {
          expect(typeof warning.identifier).toBe('string');
          expect(warning.identifier.length).toBeGreaterThan(0);
          expect(warning.countryCode).toBe('id');

          for (const ring of warning.polygons) {
            expect(ring.length).toBeGreaterThan(0);
            const first = ring[0];
            const last = ring[ring.length - 1];
            // Every published ring must already be closed — `parseCapPolygon`
            // never auto-closes one.
            expect(first[0]).toBe(last[0]);
            expect(first[1]).toBe(last[1]);
            for (const [lat, lon] of ring) {
              expect(Number.isFinite(lat)).toBe(true);
              expect(Number.isFinite(lon)).toBe(true);
            }
          }
        }
      }

      expect(typeof result.unavailableCount).toBe('number');
      expect(Number.isInteger(result.unavailableCount)).toBe(true);
      expect(result.unavailableCount).toBeGreaterThanOrEqual(0);

      expect(typeof result.polygonUnavailableCount).toBe('number');
      expect(Number.isInteger(result.polygonUnavailableCount)).toBe(true);
      expect(result.polygonUnavailableCount).toBeGreaterThanOrEqual(0);

      expect(typeof result.indexTrimmed).toBe('boolean');
    }
  }, 45000);
});
