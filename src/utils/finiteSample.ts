/**
 * Shared accessor for one sample of an Open-Meteo series.
 *
 * Open-Meteo answers HTTP 200 with JSON `null` for a sample past a model's
 * horizon or outside its coverage, so a missing sample and a present one are
 * both normal wire shapes rather than errors. Every render site that reads a
 * series by index needs the same three-line test, and before this module it
 * was written privately in `normals.ts` and `marineConditionsHandler.ts` under
 * two different names.
 */

/**
 * One sample from an Open-Meteo series, or `undefined` when the model did not
 * publish it.
 *
 * A JSON `null`, a `NaN`, a missing array and an index past the end all read
 * as "no sample" — the `typeof` plus `Number.isFinite` pair covers all four in
 * one expression.
 */
export function finiteSampleAt(
  series: (number | null)[] | undefined,
  index: number
): number | undefined {
  const value = series?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
