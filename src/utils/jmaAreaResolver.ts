/**
 * Resolve a coordinate to the JMA class10 warning area that contains it, and
 * load the geometry artifact that makes that possible.
 *
 * Two halves, deliberately separable:
 *
 *   - `resolveJmaArea` is pure and zero-I/O — it takes the area table as an
 *     argument, so a test can drive it with three hand-written rings and never
 *     touch the 285 KB artifact (design pattern 6 in CLAUDE.md).
 *   - `loadJmaAreas` is the artifact's single call site: a memoised dynamic
 *     `import()` of `../data/jmaAreas.js`, so a server that never answers a
 *     Japanese request never pays for parsing it.
 *
 * **This is not the optional-dependency pattern.** `src/data/jmaAreas.ts` is
 * committed and compiled beside every other module, so it is *always present*.
 * A failure to load it is therefore a **fault, not an absence**: it throws a
 * fixed message, it is deliberately **not** memoised (the next caller retries),
 * and it is never classified by `error.code` the way `blitzortung.ts` classifies
 * a missing `mqtt`. There is no third "absent" state here, and adding one would
 * turn a broken build into a silent no-coverage answer.
 *
 * **Contract, not garnish (G24).** Before this module existed the geometry
 * would have been a static import, failing loudly at startup for every reason
 * it might be unusable. A lazy import narrows that to the reasons the call site
 * explicitly handles and routes the rest into whatever `catch` sits above it.
 * So every failure here propagates as `JmaAreaDataUnavailableError`, and the
 * caller must never render it as "no warnings for this location" — that is a
 * fabricated all-clear on safety data.
 */

import { pointInAnyRing } from './pointInPolygon.js';
import { logger } from './logger.js';
import type { JmaClass10Area } from '../data/jmaAreas.js';

export type { JmaClass10Area };

/**
 * The geometry artifact could not be loaded.
 *
 * A plain `Error` with a fixed, pre-written message: `ApiServiceName` in
 * `src/errors/ApiError.ts` is a closed union and JMA stays outside it, exactly
 * as FIRMS and the other peripheral services do. The message names no path, no
 * module specifier and no underlying error — those go to the structured log.
 */
export class JmaAreaDataUnavailableError extends Error {
  constructor() {
    super('Japanese warning-area geometry is unavailable');
    this.name = 'JmaAreaDataUnavailableError';
  }
}

/**
 * Resolve `(latitude, longitude)` to the class10 area containing it, or
 * `undefined` when the point lies outside every area (at sea, or outside
 * Japan).
 *
 * Pure: no I/O, no module state, no dependency on load order.
 *
 * Two properties of the artifact make the naive first-match loop correct, and
 * both were verified against the real data when it was generated:
 *
 *   - **The areas do not overlap.** No point in 24-46 N / 122-154 E falls
 *     inside two areas, so "first match" and "the match" are the same answer
 *     and there is no tiebreak to get wrong.
 *   - **Every area is a candidate, including the one with no issuing office.**
 *     Code `hoppo` has no `officeCode`; it must still resolve here. Whether an
 *     area without an office renders as a coverage disclosure is the renderer's
 *     decision to disclose, never this function's to silently drop (G53) — a
 *     predicate that quietly skipped it would turn "no office publishes
 *     warnings for this area" into "no warnings", which is the opposite claim.
 *     Do not add an `if (!area.officeCode) continue` here.
 */
export function resolveJmaArea(
  latitude: number,
  longitude: number,
  areas: readonly JmaClass10Area[]
): JmaClass10Area | undefined {
  for (const area of areas) {
    if (pointInAnyRing(latitude, longitude, area.rings)) {
      return area;
    }
  }
  return undefined;
}

/**
 * Memoised loaded value. `undefined` means "not loaded yet" and is the only
 * unloaded state — unlike the optional-dependency memo in `blitzortung.ts`
 * there is no `null` "known absent" state, because the module cannot be absent.
 */
let loadedAreas: readonly JmaClass10Area[] | undefined;

/** The in-flight load, shared by every concurrent caller (G17). */
let loadPromise: Promise<readonly JmaClass10Area[]> | undefined;

/**
 * Load the committed class10 geometry, at most once per process.
 *
 * Concurrency: the in-flight promise is assigned **synchronously**, before the
 * first `await` anywhere in this function, so two callers racing on a cold
 * start receive the same promise and the `import()` happens once (G17, G20). An
 * `await` above that assignment would let every concurrent caller past the
 * guard and re-import — the exact shape that opened three MQTT connections in
 * v1.25.0.
 *
 * Failure: `loadPromise` is cleared in the rejection handler and `loadedAreas`
 * is left `undefined`, so the next caller retries rather than inheriting a
 * cached failure. Note the retry cannot heal a genuinely broken module in the
 * same process — Node caches the failed module record and replays the same
 * rejection — but it does cover a transient fault, and it keeps a one-off
 * failure from disabling Japanese coverage for the life of the server.
 */
export async function loadJmaAreas(): Promise<readonly JmaClass10Area[]> {
  if (loadedAreas !== undefined) {
    return loadedAreas;
  }
  if (loadPromise !== undefined) {
    return loadPromise;
  }

  // Assigned synchronously, before the first await, or the guard above is not
  // a guard at all (G20).
  loadPromise = import('../data/jmaAreas.js').then(
    (loaded) => {
      const areas = loaded.JMA_CLASS10_AREAS;

      // A positive control on the load itself (G47's shape, one level down).
      // A truncated or half-written artifact can import cleanly and export an
      // empty array, and an empty table resolves every Japanese coordinate to
      // `undefined` — which the renderer would show as a coverage disclosure
      // for the whole country rather than as the fault it is. Fail loudly, and
      // do not memoise, so this is retried rather than frozen in.
      if (!Array.isArray(areas) || areas.length === 0) {
        loadPromise = undefined;
        logger.error('Japanese warning-area geometry loaded but is empty', undefined, {
          module: 'src/data/jmaAreas.js',
          areas: Array.isArray(areas) ? areas.length : typeof areas
        });
        throw new JmaAreaDataUnavailableError();
      }

      loadedAreas = areas;
      loadPromise = undefined;
      return areas;
    },
    (error: unknown) => {
      // Not memoised as an absence: the memo stays `undefined` so the next
      // caller retries. This module is always present, so there is no absence
      // to record and no `error.code` worth classifying (G24).
      loadPromise = undefined;

      // `.then(onFulfilled, onRejected)` does not route a throw from
      // `onFulfilled` into `onRejected` — that only happens with
      // `.then(onFulfilled).catch(onRejected)`. So the empty/non-array guard's
      // `JmaAreaDataUnavailableError` above propagates directly out of
      // `onFulfilled` and never reaches this handler; this handler sees only a
      // rejection of the `import()` itself.
      //
      // The `Error` slot is left empty on purpose: the logger would serialise
      // the message and stack, and a module-resolution failure can carry a
      // `Require stack:` of absolute paths. Only the name and code are kept.
      const failure = error as NodeJS.ErrnoException | undefined;
      logger.error('Japanese warning-area geometry failed to load', undefined, {
        module: 'src/data/jmaAreas.js',
        name: failure?.name,
        code: failure?.code
      });
      throw new JmaAreaDataUnavailableError();
    }
  );

  return loadPromise;
}
