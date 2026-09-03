/**
 * Live integration smoke for the JMA (Japan Meteorological Agency) warning
 * feed (T11; see `src/services/jma.ts` and `src/handlers/alertsHandler.ts`'s
 * `handleJmaAlerts`).
 *
 * This file joins the project's live-network integration set: it makes real
 * HTTP requests to JMA's disaster-prevention XML service with no mocking, so
 * it can flake independently of any diff in this repo (see the "Flaky
 * live-network tests" memory) — re-run before blaming a diff if only this
 * file goes red.
 *
 * **Tolerant-but-not-silent, and this is the whole point of the file**
 * (precedent: `tests/integration/national-cap-alerts.test.ts`). Every
 * `expect` sits *after* its `try/catch`, gated on the result being defined.
 * `isTransportFailure` decides, for each caught error, whether it is one of
 * `JmaService['toJmaError']`'s own fixed transport strings — timeout,
 * connection failure, a 5xx "server error (status", rate limit, or an
 * oversize response, for either the index or a warning document — those are
 * logged and skipped; anything else (a Vitest assertion failure, a shape
 * regression, a parse error, or the positive-control rejection
 * "JMA alert index carries no warning bulletins") is rethrown and fails the
 * suite. A shape regression swallowed as a flake is the failure this rule
 * exists to prevent. Declaring an empty upstream explicitly, rather than
 * letting an all-items loop pass vacuously, follows the same file.
 *
 * **G64/G71: this file gates a future npm publish** (`publish.yml` runs bare
 * `npm test`, which includes `tests/integration/`, unlike `ci.yml`'s
 * unit-only run). So: strictly tolerant of transport failure, a generous
 * per-test timeout (the index is ~5.27 MB decompressed / ~271 KB on the
 * wire and took ~1.9 s cold from this machine on 2026-09-03 — a worse route
 * needs headroom), no build-time or CI fetch of JMA anywhere, and a single
 * shared `JmaService` instance across every test in this file so the whole
 * file costs one index fetch (plus at most two document fetches), not one
 * index fetch per test.
 *
 * Assertions here are shape-only — types, string non-emptiness, boolean-ness
 * — never on live *content* (which warnings are in force, for how long, come
 * and go and are never asserted).
 */

import { describe, expect, it } from 'vitest';
import { JmaService } from '../../src/services/jma.js';
import type { JmaWarningsResult } from '../../src/services/jma.js';

/** Real Japanese points, verified against the committed class10 artifact (src/data/jmaAreas.ts). */
const TOKYO_OFFICE = '130000'; // 東京地方 / Tokyo Region (35.6895, 139.6917)
const FUKUI_OFFICE = '180000'; // 嶺北 / Reihoku (36.0652, 136.2216)

/**
 * A single `JmaService` shared by every test below, so the whole file pays
 * for one index fetch (revalidated at most once per office lookup) rather
 * than one per test.
 */
const service = new JmaService();

/**
 * True only for `JmaService['toJmaError']`'s own fixed transport-failure
 * strings — see `src/services/jma.ts`: request timeout, unable to connect,
 * a 5xx server error, a rate limit, an oversize response, a non-5xx status,
 * or the unmapped-code residual, for either the "alert index" or the
 * "warning document". The last two are here because this file runs under
 * `npm test` in publish.yml, so anything it rethrows fails a publish *after*
 * the tag exists (G64/G71): a 403 is how an upstream refusing GitHub's runner
 * presents, and a transport code the service does not map reaches the
 * "Unknown error" string rather than a named one.
 *
 * Everything else — including the positive-control rejection "JMA alert index
 * carries no warning bulletins" or "JMA alert index is not in the expected
 * format", and any Vitest assertion error — returns `false`, so the caller
 * rethrows rather than swallowing a real regression as a network flake.
 */
function isTransportFailure(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const message = err.message;
  return (
    message.includes('timed out') ||
    message.includes('Unable to connect') ||
    message.includes('server error (status') ||
    message.includes('rate limit exceeded') ||
    message.includes('response too large') ||
    // A 4xx from an upstream refusing GitHub's runner — a 403 is exactly how
    // that presents — and the residual bucket for any transport code the
    // service does not map. Both are network conditions from CI's point of
    // view, and rethrowing them fails `npm test` in publish.yml *after* the
    // tag exists (G64/G71). A real regression still fails: every positive
    // control in this file rejects with a shape message ("carries no warning
    // bulletins", "is not in the expected format"), and a Vitest assertion
    // error matches none of these.
    message.includes('returned status') ||
    message.includes('Unknown error occurred while contacting')
  );
}

describe('JMA alerts — live smoke (tolerant of network flake)', () => {
  it('resolves a Japanese point (Tokyo) to a JmaWarningsResult with the expected shape', async () => {
    let result: JmaWarningsResult | undefined;

    try {
      result = await service.getWarnings(TOKYO_OFFICE);
    } catch (err) {
      if (isTransportFailure(err)) {
        console.warn(
          'JMA live smoke (Tokyo) skipped — network error:',
          err instanceof Error ? err.message : String(err)
        );
        result = undefined;
      } else {
        // Not a transport failure: a shape/parse/assertion problem must fail
        // the suite, never be logged as a skip.
        throw err;
      }
    }

    if (result) {
      console.log(
        `JMA live smoke (Tokyo): document=${Boolean(result.document)}, ` +
          `indexTrimmed=${result.indexTrimmed}, indexUnparsedEntries=${result.indexUnparsedEntries}, ` +
          `indexStale=${result.indexStale}`
      );

      expect(result.officeCode).toBe(TOKYO_OFFICE);
      expect(typeof result.indexStale).toBe('boolean');
      expect(typeof result.indexTrimmed).toBe('boolean');
      expect(typeof result.indexUnparsedEntries).toBe('number');
      expect(Number.isInteger(result.indexUnparsedEntries)).toBe(true);
      expect(result.indexUnparsedEntries).toBeGreaterThanOrEqual(0);

      // Every office publishes VPWW53 continuously (see the module header on
      // `src/services/jma.ts`), so Tokyo's own office having no current
      // bulletin in the index would itself be worth seeing in the log, not a
      // silently-passed vacuous check.
      if (!result.document) {
        console.log('JMA live smoke (Tokyo): no current bulletin found for this office right now.');
      } else {
        expect(typeof result.document.publishingOffice === 'string' || result.document.publishingOffice === undefined).toBe(
          true
        );
        expect(Array.isArray(result.document.areas)).toBe(true);
      }
    }
  }, 30000);

  it('carries string class10 area codes in the Tokyo document, when one is present', async () => {
    let result: JmaWarningsResult | undefined;

    try {
      result = await service.getWarnings(TOKYO_OFFICE);
    } catch (err) {
      if (isTransportFailure(err)) {
        console.warn(
          'JMA live smoke (Tokyo areas) skipped — network error:',
          err instanceof Error ? err.message : String(err)
        );
        result = undefined;
      } else {
        throw err;
      }
    }

    if (result && result.document) {
      const areas = result.document.areas;

      if (areas.length === 0) {
        // Declared explicitly rather than left as a silently-vacuous loop
        // below: an empty area list must be distinguishable in the log from
        // a broken parser that also returns [].
        console.log('JMA live smoke (Tokyo): document carries zero areas right now.');
      } else {
        for (const area of areas) {
          if (area.code !== undefined) {
            expect(typeof area.code).toBe('string');
            expect(area.code.length).toBeGreaterThan(0);
          }
          expect(Array.isArray(area.kinds)).toBe(true);
          for (const kind of area.kinds) {
            if (kind.name !== undefined) {
              expect(typeof kind.name).toBe('string');
            }
            if (kind.status !== undefined) {
              expect(typeof kind.status).toBe('string');
            }
          }
        }
      }
    }
  }, 30000);

  it('resolves a second office (Fukui) and reports index trim/unparsed counts sanely', async () => {
    let result: JmaWarningsResult | undefined;

    try {
      result = await service.getWarnings(FUKUI_OFFICE);
    } catch (err) {
      if (isTransportFailure(err)) {
        console.warn(
          'JMA live smoke (Fukui) skipped — network error:',
          err instanceof Error ? err.message : String(err)
        );
        result = undefined;
      } else {
        throw err;
      }
    }

    if (result) {
      console.log(
        `JMA live smoke (Fukui): document=${Boolean(result.document)}, ` +
          `indexTrimmed=${result.indexTrimmed}, indexUnparsedEntries=${result.indexUnparsedEntries}`
      );

      expect(result.officeCode).toBe(FUKUI_OFFICE);
      // A trim is a caveat, never an exclusion (G8) — just asserted here as a
      // well-formed boolean, not as false; a trimmed index on the day this
      // runs is not itself a failure.
      expect(typeof result.indexTrimmed).toBe('boolean');
      expect(typeof result.indexUnparsedEntries).toBe('number');
      expect(result.indexUnparsedEntries).toBeGreaterThanOrEqual(0);
    }
  }, 30000);
});
