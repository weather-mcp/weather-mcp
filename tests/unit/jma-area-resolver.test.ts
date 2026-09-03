/**
 * Unit tests for src/utils/jmaAreaResolver.ts:
 *
 *   - `resolveJmaArea` — pure point-in-area resolution over a hand-written
 *     area table (never the real 285 KB artifact).
 *   - `loadJmaAreas` — the memoised single dynamic `import()` of
 *     `src/data/jmaAreas.js`, and its failure/empty-load handling.
 *   - One smoke test against the real committed artifact.
 *
 * Mechanism for the load-memo tests: `vi.doMock('../../src/data/jmaAreas.js',
 * factory)` + `vi.resetModules()` + a fresh dynamic
 * `import('../../src/utils/jmaAreaResolver.js')`, so the module-level memo
 * (`loadedAreas` / `loadPromise`) starts undefined every time (precedent:
 * tests/unit/mqtt-optional.test.ts). `vi.doMock` resolves its specifier
 * relative to *this* file and matches by resolved absolute path, so it
 * intercepts jmaAreaResolver.ts's own `import('../data/jmaAreas.js')` call
 * even though that string is written relative to src/utils/, not tests/unit/
 * (the same cross-relative-path matching tests/unit/lightning-feed-outage.test.ts
 * already relies on).
 *
 * Epoch note (G21): `JmaAreaDataUnavailableError` is defined inside
 * jmaAreaResolver.ts itself (unlike blitzortung.ts's error classes, which live
 * in a separate ApiError.ts). A fresh `vi.resetModules()` + re-import of
 * jmaAreaResolver.js therefore already gives a same-epoch class via its own
 * export — there is no second module to re-import for `instanceof` to work.
 * No timer-leak concern either: unlike blitzortung.ts, this module ends in a
 * `let`, not `export const x = new Thing()`, so re-importing it starts no timer.
 *
 * G25 note: the "not memoised" tests below establish only that OUR memo does
 * not cache a bad result (a rejected import, or a resolved-but-empty/
 * non-array one). They are not a claim that a genuinely broken
 * `src/data/jmaAreas.js` would heal without a process restart — Node caches
 * a module that failed to load and would replay the same rejection; only
 * `vi.doMock`'s per-import re-invocation on a REJECTED import lets us observe
 * the memo's retry behavior in isolation, exactly as the module's own
 * docblock says. For a RESOLVED-but-badly-shaped import (empty array,
 * non-array), the underlying `import()` itself succeeded, so Node's own
 * module cache — not vi.doMock — governs a second call: the mock factory is
 * NOT re-invoked, but the code still re-validates and re-rejects rather than
 * trusting a one-time-cached bad shape as if it were good data. Each test
 * below says explicitly which of these two shapes it is proving.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveJmaArea, loadJmaAreas } from '../../src/utils/jmaAreaResolver.js';
import type { JmaClass10Area } from '../../src/utils/jmaAreaResolver.js';

const DATA_MODULE_SPECIFIER = '../../src/data/jmaAreas.js';
const RESOLVER_MODULE_SPECIFIER = '../../src/utils/jmaAreaResolver.js';

// Ring, lat 30-40 / lon 130-140 — deliberately non-overlapping ranges, so a
// (latitude, longitude) argument swap lands nowhere near the polygon and
// cannot pass by luck. Shape: the proven NOTCHED_SQUARE from
// tests/unit/point-in-polygon.test.ts ([0,0],[0,10],[10,10],[10,6],[6,6],
// [6,4],[10,4],[10,0], notch cavity lat 6-10/lon 4-6), translated +30 lat /
// +130 lon (translation does not change ray-casting topology). The notch
// cavity sits inside the ring's overall bounding box (lat 30-40, lon 130-140)
// but outside the polygon itself — the case a bounding-box check gets wrong.
const ASYMMETRIC_NOTCHED_RING: ReadonlyArray<readonly [number, number]> = [
  [30, 130],
  [30, 140],
  [40, 140],
  [40, 136],
  [36, 136],
  [36, 134],
  [40, 134],
  [40, 130],
];

/** In the polygon body, away from the notch (translated (8,1) from the source ring). */
const INSIDE_POINT: readonly [number, number] = [38, 131];
/** In the notch cavity: inside the bounding box, outside the polygon (translated (8,5)). */
const NOTCH_POINT: readonly [number, number] = [38, 135];
/** Outside the ring's bounding box entirely, in both dimensions. */
const FAR_OUTSIDE_POINT: readonly [number, number] = [10, 10];

const AREA_WITH_OFFICE: JmaClass10Area = {
  code: '999001',
  name: 'Test Area (with office)',
  enName: 'Test Area With Office',
  officeCode: '999000',
  rings: [ASYMMETRIC_NOTCHED_RING],
};

// A separate, non-overlapping simple square far from AREA_WITH_OFFICE, used
// to pin the no-officeCode contract on its own fixture.
const NO_OFFICE_RING: ReadonlyArray<readonly [number, number]> = [
  [50, 150],
  [50, 155],
  [55, 155],
  [55, 150],
];
const NO_OFFICE_INSIDE_POINT: readonly [number, number] = [52, 152];

const AREA_NO_OFFICE: JmaClass10Area = {
  code: 'test-hoppo',
  name: 'Test Area (no office)',
  enName: 'Test Area Without Office',
  // officeCode intentionally omitted — this is the fixture for G53.
  rings: [NO_OFFICE_RING],
};

describe('resolveJmaArea (pure)', () => {
  it('resolves a point inside a known area to that area record', () => {
    const [lat, lon] = INSIDE_POINT;
    const result = resolveJmaArea(lat, lon, [AREA_WITH_OFFICE, AREA_NO_OFFICE]);
    expect(result).toBe(AREA_WITH_OFFICE);
  });

  it('returns undefined for a point outside every area (outside every bounding box)', () => {
    const [lat, lon] = FAR_OUTSIDE_POINT;
    const result = resolveJmaArea(lat, lon, [AREA_WITH_OFFICE, AREA_NO_OFFICE]);
    expect(result).toBeUndefined();
  });

  it(
    "returns undefined for a point inside a ring's bounding box but outside the polygon " +
      '(the notch) — the case a bounding-box-only containment check gets wrong',
    () => {
      const [lat, lon] = NOTCH_POINT;
      const result = resolveJmaArea(lat, lon, [AREA_WITH_OFFICE]);
      expect(result).toBeUndefined();
    }
  );

  it('pins coordinate order with an asymmetric fixture: (lat, lon) resolves, (lon, lat) does not', () => {
    const [lat, lon] = INSIDE_POINT;

    // Correct order: resolves.
    expect(resolveJmaArea(lat, lon, [AREA_WITH_OFFICE])).toBe(AREA_WITH_OFFICE);

    // Same two numbers, arguments swapped: the ring's lat range (30-40) and
    // lon range (130-140) do not overlap, so a swapped call cannot land
    // inside the polygon by coincidence.
    expect(resolveJmaArea(lon, lat, [AREA_WITH_OFFICE])).toBeUndefined();
  });

  it(
    'resolves an area with no officeCode rather than skipping it (G53: dropping it would turn ' +
      '"no office publishes warnings" into "no warnings")',
    () => {
      const [lat, lon] = NO_OFFICE_INSIDE_POINT;
      const result = resolveJmaArea(lat, lon, [AREA_WITH_OFFICE, AREA_NO_OFFICE]);
      expect(result).toBe(AREA_NO_OFFICE);
      expect(result?.officeCode).toBeUndefined();
    }
  );

  it('returns undefined for an empty areas array and does not throw', () => {
    const [lat, lon] = INSIDE_POINT;
    expect(() => resolveJmaArea(lat, lon, [])).not.toThrow();
    expect(resolveJmaArea(lat, lon, [])).toBeUndefined();
  });
});

/**
 * Re-import jmaAreaResolver.js (and logger.js, for spies to observe the same
 * singleton) from a clean module registry so the module-level load memo
 * starts undefined. See file header for why no separate error-class
 * re-import is needed here (unlike tests/unit/mqtt-optional.test.ts).
 */
async function importFreshResolver() {
  vi.resetModules();
  const resolverModule = await import(RESOLVER_MODULE_SPECIFIER);
  const loggerModule = await import('../../src/utils/logger.js');
  return { ...resolverModule, logger: loggerModule.logger };
}

describe('loadJmaAreas (memoised load)', () => {
  afterEach(() => {
    vi.doUnmock(DATA_MODULE_SPECIFIER);
    vi.restoreAllMocks();
  });

  it('two concurrent first calls trigger exactly one import(), and both callers receive the same value', async () => {
    const fakeAreas = [AREA_WITH_OFFICE];
    const factory = vi.fn(() => ({ JMA_CLASS10_AREAS: fakeAreas }));
    vi.doMock(DATA_MODULE_SPECIFIER, factory);
    const { loadJmaAreas: freshLoad } = await importFreshResolver();

    const [a, b] = await Promise.all([freshLoad(), freshLoad()]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(fakeAreas);
    expect(b).toBe(fakeAreas);
  });

  it('a load failure throws JmaAreaDataUnavailableError and is NOT memoised as a cached absence (our memo retries)', async () => {
    let attempts = 0;
    const factory = vi.fn(() => {
      attempts += 1;
      throw new Error('simulated module load failure');
    });
    vi.doMock(DATA_MODULE_SPECIFIER, factory);
    const { loadJmaAreas: freshLoad, JmaAreaDataUnavailableError, logger } =
      await importFreshResolver();
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(freshLoad()).rejects.toBeInstanceOf(JmaAreaDataUnavailableError);
    expect(attempts).toBe(1);

    // Memo claim only (G25): the factory being invoked again proves our own
    // memo did not cache the failure. It is not a claim that a real broken
    // artifact heals without a process restart.
    await expect(freshLoad()).rejects.toBeInstanceOf(JmaAreaDataUnavailableError);
    expect(attempts).toBe(2);
  });

  it('a successful load that yields an empty array throws JmaAreaDataUnavailableError on every call, and never gets cached as a valid (empty) result', async () => {
    let attempts = 0;
    const factory = vi.fn(() => {
      attempts += 1;
      return { JMA_CLASS10_AREAS: [] };
    });
    vi.doMock(DATA_MODULE_SPECIFIER, factory);
    const { loadJmaAreas: freshLoad, JmaAreaDataUnavailableError, logger } =
      await importFreshResolver();
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(freshLoad()).rejects.toBeInstanceOf(JmaAreaDataUnavailableError);

    // A second call rejects again rather than silently resolving to the
    // (bad) cached `[]` — proving `loadedAreas` was never set to it. This is
    // the "not memoised" claim at the `loadedAreas` level, distinct from the
    // genuine-throw case above: here the underlying `import()` itself
    // *succeeded* (it resolved to a badly-shaped module), so Node's own
    // module cache — not vi.doMock's re-invocation-per-import — governs the
    // second call, and the factory is NOT called again (`attempts` stays 1).
    // The module-level code still re-validates and re-rejects independently
    // every time rather than trusting a one-time-cached bad shape.
    await expect(freshLoad()).rejects.toBeInstanceOf(JmaAreaDataUnavailableError);
    expect(attempts).toBe(1);
  });

  it('the empty-array guard logs exactly once, from onFulfilled — the rejection handler is never reached', async () => {
    // Pins the DEADNESS of the `instanceof JmaAreaDataUnavailableError` branch
    // in the module's `onRejected` handler. `.then(onFulfilled, onRejected)`
    // does not route a throw from `onFulfilled` into `onRejected`, so the
    // empty-array guard's throw propagates directly and that handler never
    // runs. The only observable difference between the two control flows is
    // the number of `logger.error` calls: one here, two if the guard's throw
    // were routed through the rejection handler (which logs '…failed to load'
    // before rethrowing).
    //
    // ONE call to freshLoad(), deliberately: the empty-array test above calls
    // it twice and therefore logs twice by design, which makes the count
    // unreadable as evidence. That test is the lock for the not-memoised
    // claim and is left unedited.
    const factory = vi.fn(() => ({ JMA_CLASS10_AREAS: [] }));
    vi.doMock(DATA_MODULE_SPECIFIER, factory);
    const { loadJmaAreas: freshLoad, JmaAreaDataUnavailableError, logger } =
      await importFreshResolver();
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(freshLoad()).rejects.toBeInstanceOf(JmaAreaDataUnavailableError);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe('Japanese warning-area geometry loaded but is empty');
    expect(errorSpy.mock.calls[0]?.[0]).not.toBe('Japanese warning-area geometry failed to load');
  });

  it('a successful load that yields a non-array export throws JmaAreaDataUnavailableError on every call, and never gets cached as a valid result', async () => {
    let attempts = 0;
    const factory = vi.fn(() => {
      attempts += 1;
      return { JMA_CLASS10_AREAS: 'not-an-array' };
    });
    vi.doMock(DATA_MODULE_SPECIFIER, factory);
    const { loadJmaAreas: freshLoad, JmaAreaDataUnavailableError, logger } =
      await importFreshResolver();
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(freshLoad()).rejects.toBeInstanceOf(JmaAreaDataUnavailableError);

    // Same "not memoised at the loadedAreas level" claim as the empty-array
    // case above — see that test's comment for why `attempts` stays 1 here
    // rather than incrementing.
    await expect(freshLoad()).rejects.toBeInstanceOf(JmaAreaDataUnavailableError);
    expect(attempts).toBe(1);
  });

  it('the thrown error message names no file path or module specifier', async () => {
    const factory = vi.fn(() => {
      throw new Error("Cannot find module '/home/user/project/src/data/jmaAreas.js'");
    });
    vi.doMock(DATA_MODULE_SPECIFIER, factory);
    const { loadJmaAreas: freshLoad, logger } = await importFreshResolver();
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    const caught: unknown = await freshLoad().catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toBe('Japanese warning-area geometry is unavailable');
    expect(message).not.toMatch(/\//);
    expect(message.toLowerCase()).not.toContain('jmaareas');
    expect(message.toLowerCase()).not.toContain('.js');
  });
});

describe('loadJmaAreas (real artifact smoke test)', () => {
  it('loads the real committed geometry: non-empty, and every record has code/name/enName/rings', async () => {
    const areas = await loadJmaAreas();

    // Not the exact count (143) — that is upstream's number and will drift
    // when the artifact is regenerated. A floor only.
    expect(areas.length).toBeGreaterThanOrEqual(140);

    for (const area of areas) {
      expect(typeof area.code).toBe('string');
      expect(area.code.length).toBeGreaterThan(0);
      expect(typeof area.name).toBe('string');
      expect(area.name.length).toBeGreaterThan(0);
      expect(typeof area.enName).toBe('string');
      expect(area.enName.length).toBeGreaterThan(0);
      expect(Array.isArray(area.rings)).toBe(true);
      expect(area.rings.length).toBeGreaterThan(0);
    }
  });
});
