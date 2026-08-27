/**
 * Round a raw computed value to the same precision the render site will
 * display it at, mirroring `toFixed` rather than `Math.round`.
 *
 * `toFixed` and `Math.round` disagree on negative halves — `(-2.5).toFixed(0)`
 * is `"-3"` while `Math.round(-2.5)` is `-2` — so this helper matches the
 * render site's own rounding rather than a generic round, which is the
 * entire point of having it.
 *
 * Per the caller contract: pass this value to the band, and pass the same
 * `decimals` the render site passes to `toFixed`. That is the invariant
 * this helper exists to hold — the number the user reads and the band it
 * falls in can never disagree at an edge.
 *
 * **Two conventions exist for *where* that rounding happens, and both are
 * correct — choose by call-site count.** With a single caller, round at the
 * caller and pass the rounded value into the band function
 * (`assessSafety`/`getFrostbiteRisk` in `thermalStress.ts`). With several
 * callers, round **inside** the band function instead
 * (`getWaveHeightCategory` and `getSafetyAssessment` in `marine.ts`, three
 * call sites between them; `deriveFloodCategory` in
 * `riverConditionsHandler.ts` takes the same shape for symmetry). The reason
 * is that a caller-side contract several sites must remember is exactly how
 * the convention drifted in the first place — every one of those sites is a
 * chance to forget. These are not an inconsistency: the invariant is the
 * same either way, and only the place that enforces it moves.
 *
 * **A third shape applies when the band function's own seam tests are a lock.**
 * Round at the call site, but through one module-private helper that pairs the
 * rounding with the band (`bandAqi`/`bandUv` in `airQualityHandler.ts`), so
 * several call sites share one contract without the band function changing.
 * This is what to reach for when rounding *inside* the band function would
 * rewrite what its existing tests pin.
 *
 * `decimals` must be an integer in `toFixed`'s own valid range (0-100);
 * this helper does not re-validate it, because every call site is in-repo
 * and passes a literal.
 *
 * @param raw The raw computed value
 * @param decimals The number of decimal places the render site formats to
 * @returns `raw` rounded to `decimals` places via `toFixed`, or `raw`
 *   unchanged when it is not finite (NaN or +/-Infinity), so a non-finite
 *   value is never converted into a number the caller would then band
 */
export function displayValue(raw: number, decimals: number): number {
  if (!Number.isFinite(raw)) {
    return raw;
  }

  return Number(raw.toFixed(decimals));
}
