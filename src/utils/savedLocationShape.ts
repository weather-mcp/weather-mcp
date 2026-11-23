/**
 * The one record-shape contract for a saved location.
 *
 * `save_location` accepts a hand-typed request and `LocationStore` reads a
 * hand-editable JSON file — both are untrusted `unknown` at the boundary.
 * This module is the single place that decides what a well-formed
 * `SavedLocation` looks like, so the write side (`validateSavedLocationInput`)
 * and the read side (`describeSavedLocationDefect`) agree on **shape**: which
 * field is checked first and what "wrong" means for it. Both share the
 * same field-order constants below for exactly that reason.
 *
 * The size limits below are **write-only**. The two writers apply them
 * (`findSavedLocationLimitViolation`); the describer does not, so an
 * oversize record already on disk is well-formed and still readable.
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
export function isSavedLocationEntry(value: unknown): value is Record<string, unknown> {
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
  if (!isSavedLocationEntry(input)) {
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
  if (!isSavedLocationEntry(entry)) {
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

/**
 * Read the eight optional metadata fields of a stored entry by shape only.
 * `undefined` is absent (in neither list). A well-typed value is copied into
 * `fields`. Anything else, `null` included, is named in `dropped`, in field
 * order. No length check: oversize is not malformed. A non-entry yields
 * nothing; the whole-entry case belongs to the caller.
 */
export function readStoredMetadata(entry: unknown): {
  fields: Partial<
    Pick<
      SavedLocation,
      | 'timezone'
      | 'country_code'
      | 'admin1'
      | 'admin2'
      | 'description'
      | 'notes'
      | 'alternateNames'
      | 'activities'
    >
  >;
  dropped: string[];
} {
  const fields: Record<string, string | string[]> = {};
  const dropped: string[] = [];
  if (!isSavedLocationEntry(entry)) {
    return { fields: {}, dropped };
  }
  for (const field of STRING_FIELDS) {
    const value = entry[field];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      fields[field] = value;
    } else {
      dropped.push(field);
    }
  }
  for (const field of ARRAY_FIELDS) {
    const value = entry[field];
    if (value === undefined) continue;
    if (isStringArray(value)) {
      fields[field] = value;
    } else {
      dropped.push(field);
    }
  }
  return { fields, dropped };
}

/**
 * The coordinates of a stored entry, or `undefined` when the entry is not an
 * object or either coordinate fails validation. Never throws. A bad `name`
 * does not matter here: it does not stop a weather tool.
 */
export function readStoredCoordinates(
  entry: unknown
): { latitude: number; longitude: number } | undefined {
  if (!isSavedLocationEntry(entry)) {
    return undefined;
  }
  try {
    const { latitude, longitude } = entry;
    validateLatitude(latitude);
    validateLongitude(longitude);
    return { latitude, longitude };
  } catch {
    return undefined;
  }
}

/** Per-field text length limits (String.length), write side only. */
export const SAVED_LOCATION_TEXT_LIMITS = {
  name: 500,
  description: 500,
  notes: 2000,
  timezone: 200,
  country_code: 200,
  admin1: 200,
  admin2: 200,
} as const;

/** Per-list entry-count and per-entry length limits, write side only. */
export const SAVED_LOCATION_LIST_LIMITS = {
  alternateNames: { entries: 20, length: 100 },
  activities: { entries: 20, length: 50 },
} as const;

/** The most aliases the store accepts. */
export const MAX_SAVED_LOCATIONS = 100;

export type LimitViolation = {
  field: string;
  kind: 'length' | 'entries' | 'entry-length';
  limit: number;
  actual: number;
};

/**
 * The first limit a record breaks, or `undefined`. Text fields in
 * `SAVED_LOCATION_TEXT_LIMITS` key order, then each list (count, then each
 * element). A field that is absent or of the wrong type is skipped: shape is
 * the other function's job.
 */
export function findSavedLocationLimitViolation(
  record: Record<string, unknown>
): LimitViolation | undefined {
  for (const field of Object.keys(SAVED_LOCATION_TEXT_LIMITS) as Array<
    keyof typeof SAVED_LOCATION_TEXT_LIMITS
  >) {
    const value = record[field];
    const limit = SAVED_LOCATION_TEXT_LIMITS[field];
    if (typeof value === 'string' && value.length > limit) {
      return { field, kind: 'length', limit, actual: value.length };
    }
  }
  for (const field of Object.keys(SAVED_LOCATION_LIST_LIMITS) as Array<
    keyof typeof SAVED_LOCATION_LIST_LIMITS
  >) {
    const value = record[field];
    const limits = SAVED_LOCATION_LIST_LIMITS[field];
    if (!isStringArray(value)) continue;
    if (value.length > limits.entries) {
      return { field, kind: 'entries', limit: limits.entries, actual: value.length };
    }
    for (const item of value) {
      if (item.length > limits.length) {
        return { field, kind: 'entry-length', limit: limits.length, actual: item.length };
      }
    }
  }
  return undefined;
}

/** The one fixed message family for a limit violation. */
export function formatLimitViolation(v: LimitViolation): string {
  switch (v.kind) {
    case 'length':
      return `${v.field} must be ${v.limit} characters or less`;
    case 'entries':
      return `${v.field} must have ${v.limit} entries or fewer`;
    case 'entry-length':
      return `Each entry in ${v.field} must be ${v.limit} characters or less`;
  }
}
