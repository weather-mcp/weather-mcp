import { describe, it, expect } from 'vitest';
import {
  isSavedLocationEntry,
  readStoredMetadata,
  readStoredCoordinates,
  findSavedLocationLimitViolation,
  formatLimitViolation,
  SAVED_LOCATION_TEXT_LIMITS,
  SAVED_LOCATION_LIST_LIMITS,
  MAX_SAVED_LOCATIONS,
} from '../../src/utils/savedLocationShape.js';

const BAD_VALUES: Array<[string, unknown]> = [
  ['null', null],
  ['0', 0],
  ['empty string', ''],
  ['false', false],
  ['"abc"', 'abc'],
  ['[]', []],
];

const validEntry = { name: 'Home', latitude: 47.6, longitude: -122.3 };

describe('entry readers over the bad-value matrix', () => {
  for (const [label, value] of BAD_VALUES) {
    it(`treats ${label} as not an entry in all three readers`, () => {
      expect(isSavedLocationEntry(value)).toBe(false);
      expect(readStoredMetadata(value)).toEqual({ fields: {}, dropped: [] });
      expect(readStoredCoordinates(value)).toBeUndefined();
    });
  }

  it('accepts a valid object in all three readers', () => {
    expect(isSavedLocationEntry(validEntry)).toBe(true);
    expect(readStoredMetadata(validEntry)).toEqual({ fields: {}, dropped: [] });
    expect(readStoredCoordinates(validEntry)).toEqual({ latitude: 47.6, longitude: -122.3 });
  });
});

describe('readStoredMetadata', () => {
  it('copies every well-formed optional field', () => {
    const entry = {
      ...validEntry,
      timezone: 'America/Los_Angeles',
      country_code: 'US',
      admin1: 'Washington',
      admin2: 'King',
      description: 'd',
      notes: 'n',
      alternateNames: ['a'],
      activities: ['hiking'],
    };
    const { fields, dropped } = readStoredMetadata(entry);
    expect(dropped).toEqual([]);
    expect(fields).toEqual({
      timezone: 'America/Los_Angeles',
      country_code: 'US',
      admin1: 'Washington',
      admin2: 'King',
      description: 'd',
      notes: 'n',
      alternateNames: ['a'],
      activities: ['hiking'],
    });
  });

  it('drops malformed fields in field order and keeps the rest', () => {
    const entry = {
      ...validEntry,
      timezone: 'UTC',
      country_code: 42,
      notes: null,
      alternateNames: 'oops',
      activities: ['x'],
    };
    const { fields, dropped } = readStoredMetadata(entry);
    expect(dropped).toEqual(['country_code', 'notes', 'alternateNames']);
    expect(fields).toEqual({ timezone: 'UTC', activities: ['x'] });
  });

  it('keeps a 2,001-character notes: oversize is not malformed', () => {
    const notes = 'a'.repeat(2001);
    const { fields, dropped } = readStoredMetadata({ ...validEntry, notes });
    expect(dropped).toEqual([]);
    expect(fields.notes).toBe(notes);
  });
});

describe('readStoredCoordinates', () => {
  it('returns coordinates when the name is bad', () => {
    expect(readStoredCoordinates({ name: 42, latitude: 10, longitude: 20 })).toEqual({
      latitude: 10,
      longitude: 20,
    });
  });

  it('returns undefined for a bad coordinate and never throws', () => {
    expect(readStoredCoordinates({ name: 'x', latitude: 91, longitude: 0 })).toBeUndefined();
    expect(readStoredCoordinates({ name: 'x', latitude: 0, longitude: 'z' })).toBeUndefined();
    expect(readStoredCoordinates({ name: 'x' })).toBeUndefined();
  });
});

describe('limit constants equal their literals', () => {
  it('text limits', () => {
    expect(SAVED_LOCATION_TEXT_LIMITS).toEqual({
      name: 500,
      description: 500,
      notes: 2000,
      timezone: 200,
      country_code: 200,
      admin1: 200,
      admin2: 200,
    });
  });
  it('list limits', () => {
    expect(SAVED_LOCATION_LIST_LIMITS).toEqual({
      alternateNames: { entries: 20, length: 100 },
      activities: { entries: 20, length: 50 },
    });
  });
  it('max saved locations', () => {
    expect(MAX_SAVED_LOCATIONS).toBe(100);
  });
});

describe('findSavedLocationLimitViolation', () => {
  const textLimits: Array<[string, number]> = [
    ['name', 500],
    ['description', 500],
    ['notes', 2000],
    ['timezone', 200],
    ['country_code', 200],
    ['admin1', 200],
    ['admin2', 200],
  ];
  for (const [field, limit] of textLimits) {
    it(`${field}: accepts ${limit}, refuses ${limit + 1}`, () => {
      expect(
        findSavedLocationLimitViolation({ [field]: 'a'.repeat(limit) })
      ).toBeUndefined();
      expect(findSavedLocationLimitViolation({ [field]: 'a'.repeat(limit + 1) })).toEqual({
        field,
        kind: 'length',
        limit,
        actual: limit + 1,
      });
    });
  }

  const lists: Array<[string, number, number]> = [
    ['alternateNames', 20, 100],
    ['activities', 20, 50],
  ];
  for (const [field, entries, length] of lists) {
    it(`${field}: entry count ${entries} accepted, ${entries + 1} refused`, () => {
      expect(
        findSavedLocationLimitViolation({ [field]: Array.from({ length: entries }, () => 'a') })
      ).toBeUndefined();
      expect(
        findSavedLocationLimitViolation({ [field]: Array.from({ length: entries + 1 }, () => 'a') })
      ).toEqual({ field, kind: 'entries', limit: entries, actual: entries + 1 });
    });
    it(`${field}: entry length ${length} accepted, ${length + 1} refused`, () => {
      expect(findSavedLocationLimitViolation({ [field]: ['a'.repeat(length)] })).toBeUndefined();
      expect(findSavedLocationLimitViolation({ [field]: ['a', 'a'.repeat(length + 1)] })).toEqual({
        field,
        kind: 'entry-length',
        limit: length,
        actual: length + 1,
      });
    });
  }

  it('skips absent and wrong-typed fields', () => {
    expect(findSavedLocationLimitViolation({})).toBeUndefined();
    expect(findSavedLocationLimitViolation({ notes: 5, activities: 'x' })).toBeUndefined();
  });

  it('first violation wins in text-key order', () => {
    expect(
      findSavedLocationLimitViolation({ notes: 'a'.repeat(2001), name: 'a'.repeat(501) })?.field
    ).toBe('name');
  });
});

describe('formatLimitViolation', () => {
  it('renders the three fixed messages', () => {
    expect(formatLimitViolation({ field: 'notes', kind: 'length', limit: 2000, actual: 2001 })).toBe(
      'notes must be 2000 characters or less'
    );
    expect(
      formatLimitViolation({ field: 'activities', kind: 'entries', limit: 20, actual: 21 })
    ).toBe('activities must have 20 entries or fewer');
    expect(
      formatLimitViolation({ field: 'alternateNames', kind: 'entry-length', limit: 100, actual: 101 })
    ).toBe('Each entry in alternateNames must be 100 characters or less');
  });
});
