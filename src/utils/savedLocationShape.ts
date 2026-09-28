/**
 * The one record-shape contract for a saved location.
 *
 * `save_location` accepts a hand-typed request and `LocationStore` reads a
 * hand-editable JSON file — both are untrusted `unknown` at the boundary.
 * This module is the single place that decides what a well-formed
 * `SavedLocation` looks like, so the write side (`validateSavedLocationInput`)
 * and the read side (`describeSavedLocationDefect`) can never disagree about
 * which field is checked first or what "wrong" means for it. Both share the
 * same field-order constants below for exactly that reason.
 *
 * Pure and zero-I/O: no upstream call, no file access, no logging.
 */

import { validateLatitude, validateLongitude } from './validation.js';
import type { SavedLocation } from '../types/savedLocations.js';

/**
 * Optional string-valued fields, in the order both functions check them.
 */
const STRING_FIELDS = [
  'timezone',
  'country_code',
  'admin1',
  'admin2',
  'description',
  'notes',
] as const;

/**
 * Optional array-of-string fields, in the order both functions check them.
 */
const ARRAY_FIELDS = ['alternateNames', 'activities'] as const;

/**
 * A plain, non-null, non-array object — the only shape either function will
 * look at field-by-field. `typeof null === 'object'` and arrays are objects
 * too, so both are excluded explicitly rather than relying on `typeof` alone.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An array whose every element is a string. `[]` counts (vacuously true).
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Validate an untrusted `save_location` request body against the saved-location
 * record shape, in a fixed field order (object shape, `name`, `latitude`,
 * `longitude`, then the optional string fields, then the optional array
 * fields). The first failing field wins and throws immediately — this
 * function never collects multiple problems.
 *
 * Coordinate validation is delegated to `validateLatitude`/`validateLongitude`
 * rather than re-implemented, so the accepted range and message text can
 * never drift from every other caller of those two.
 *
 * `undefined` means a field is absent and is always accepted for an optional
 * field. `null` is present and satisfies neither the string check nor the
 * array check, so an explicit `null` on an optional field is rejected the
 * same as any other wrong-typed value.
 *
 * @param input Untrusted request body
 * @returns A shallow copy of `input` with `name` trimmed — no other
 *   normalisation, and no `saved_at`/`updated_at` added. Unknown extra
 *   fields (and any `saved_at`/`updated_at` already present) pass through
 *   untouched.
 * @throws {Error} A fixed, field-naming message for the first field that
 *   fails its check
 */
export function validateSavedLocationInput(
  input: unknown
): Omit<SavedLocation, 'saved_at' | 'updated_at'> {
  if (!isPlainObject(input)) {
    throw new Error('Saved location must be an object');
  }

  const { name } = input;
  if (typeof name !== 'string') {
    throw new Error('name must be a string');
  }
  const trimmedName = name.trim();
  if (trimmedName === '') {
    throw new Error('name cannot be empty');
  }

  validateLatitude(input.latitude);
  validateLongitude(input.longitude);

  for (const field of STRING_FIELDS) {
    const value = input[field];
    if (value !== undefined && typeof value !== 'string') {
      throw new Error(`${field} must be a string`);
    }
  }

  for (const field of ARRAY_FIELDS) {
    const value = input[field];
    if (value !== undefined && !isStringArray(value)) {
      throw new Error(`${field} must be an array of strings`);
    }
  }

  return {
    ...input,
    name: trimmedName,
  } as Omit<SavedLocation, 'saved_at' | 'updated_at'>;
}

/**
 * Describe the first defect in a possibly-malformed saved-location record —
 * for example one hand-edited into `~/.weather-mcp/locations.json` — without
 * throwing. Checks the same fields in the same order as
 * `validateSavedLocationInput`, so a record neither function objects to is
 * exactly the same record. `saved_at`/`updated_at` are never checked: a
 * record `validateSavedLocationInput` accepts, plus any timestamps and any
 * extra fields, always describes as `undefined`.
 *
 * Never throws and never mutates `entry`.
 *
 * @param entry A possibly-malformed record read back from storage
 * @returns The first offending field and a fixed, render-ready problem
 *   string, or `undefined` if the record is well-formed
 */
export function describeSavedLocationDefect(
  entry: unknown
): { field: string; problem: string } | undefined {
  if (!isPlainObject(entry)) {
    return { field: 'entry', problem: 'is not an object' };
  }

  const { name } = entry;
  if (typeof name !== 'string') {
    return { field: 'name', problem: 'is not text' };
  }
  if (name.trim() === '') {
    return { field: 'name', problem: 'is empty' };
  }

  try {
    validateLatitude(entry.latitude);
  } catch {
    return { field: 'latitude', problem: 'is not a finite number in range' };
  }

  try {
    validateLongitude(entry.longitude);
  } catch {
    return { field: 'longitude', problem: 'is not a finite number in range' };
  }

  for (const field of STRING_FIELDS) {
    const value = entry[field];
    if (value !== undefined && typeof value !== 'string') {
      return { field, problem: 'is not text' };
    }
  }

  for (const field of ARRAY_FIELDS) {
    const value = entry[field];
    if (value !== undefined && !isStringArray(value)) {
      return { field, problem: 'is not a list of text' };
    }
  }

  return undefined;
}
